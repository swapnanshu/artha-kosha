import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "@/lib/firestore/collections";
import { ingestAlert, loadIngestContext, type IngestContext, type IngestResult } from "@/lib/ingest/ingest";
import { openSecret, sealSecret, signState, verifyState } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import type { IngestRun, Source } from "@/lib/types";

/**
 * Gmail is read-only. The refresh token is the only long-lived credential and
 * it is sealed with TOKEN_ENC_KEY before it touches Firestore.
 */
export const GMAIL_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly openid email";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const BACKFILL_DAYS = 365;
const BACKFILL_PAGE = 100;

/**
 * Sender allowlist for both inboxes. Gmail's `from:` matches the address, so a
 * domain is enough; the parser still decides whether a message is a real alert.
 */
const SENDER_FILTER = [
  "hdfcbank.com",
  "hdfcbank.net",
  "icicibank.com",
  "axisbank.com",
  // RBL and SBI also alert from their newer `*.bank.in` domains, not just the
  // legacy `rblbank.com` / `sbi.co.in`: a refund or NEFT credited there is a
  // real ledger row, and the old list dropped it silently.
  "rblbank.com",
  "rbl.bank.in",
  "indusind.com",
  "kotak.com",
  "kotak.bank.in",
  "aubank.in",
  "sbi.co.in",
  "sbi.bank.in",
  "onlinesbi.com",
  "sbicard.com",
  "niyo.com",
  "googlealerts-noreply@google.com",
  "phonepe.com",
  "cred.club",
  "samsung.com",
  "amazonpay.in",
  "idfcbank.com",
  "yesbank.in",
  "americanexpress.com",
  "paytm.com",
  "paytmbank.com",
].join(" OR ");

/** Both the backfill and the incremental pull are scoped to these senders. */
function senderFilter(): string {
  return `from:(${SENDER_FILTER})`;
}

export function backfillQuery(now = Date.now()): string {
  const after = Math.floor((now - BACKFILL_DAYS * 24 * 60 * 60 * 1000) / 1000);
  return `after:${after} ${senderFilter()}`;
}

function googleConfig(): { clientId: string; clientSecret: string } {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = serverEnv();
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not set, so Gmail cannot be connected.",
    );
  }
  return { clientId: GOOGLE_OAUTH_CLIENT_ID, clientSecret: GOOGLE_OAUTH_CLIENT_SECRET };
}

export function redirectUri(origin: string): string {
  return `${origin}/api/ingest/gmail/callback`;
}

export function buildAuthUrl(origin: string, sourceId: string, loginHint?: string): string {
  const { clientId } = googleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    // Without prompt=consent Google returns no refresh token on a re-connect.
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(JSON.stringify({ sourceId, at: Date.now() })),
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: clientId, client_secret: clientSecret }),
  });

  const json = (await response.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new Error(json.error_description ?? json.error ?? `Google token exchange failed (${response.status})`);
  }
  return json;
}

export function exchangeCode(code: string, origin: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin),
  });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** The openid scope gives an id_token; its payload carries the inbox address. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

export function decodeState(state: string | null): { sourceId: string; at: number } | null {
  const payload = verifyState(state);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { sourceId?: string; at?: number };
    if (!parsed.sourceId || !parsed.at) return null;
    // The round trip should take seconds; an hour is generous, a day is not.
    if (Date.now() - parsed.at > 60 * 60 * 1000) return null;
    return { sourceId: parsed.sourceId, at: parsed.at };
  } catch {
    return null;
  }
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: Array<{ name?: string; value?: string }>;
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8377;/g, "₹")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectBodies(part: GmailPart | undefined, out: { text: string[]; html: string[] }): void {
  if (!part) return;
  const data = part.body?.data;
  if (data) {
    if (part.mimeType === "text/plain") out.text.push(decodeBase64Url(data));
    else if (part.mimeType === "text/html") out.html.push(decodeBase64Url(data));
  }
  for (const child of part.parts ?? []) collectBodies(child, out);
}

function header(part: GmailPart | undefined, name: string): string | null {
  const hit = part?.headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? null;
}

function messageText(message: GmailMessage): string {
  const bodies = { text: [] as string[], html: [] as string[] };
  collectBodies(message.payload, bodies);
  if (bodies.text.length > 0) return bodies.text.join("\n").slice(0, 8000);
  if (bodies.html.length > 0) return stripHtml(bodies.html.join("\n")).slice(0, 8000);
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GmailErrorBody {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

/**
 * A backfill reads hundreds of messages, and Gmail answers a burst with 403
 * `userRateLimitExceeded` or 429 rather than a permanent failure. Those are
 * retried with backoff so one throttle does not abandon a 12-month sync.
 */
async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${GMAIL}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return (await response.json()) as T;

    const text = await response.text();
    let detail = text.slice(0, 300);
    let reason: string | undefined;
    try {
      const body = JSON.parse(text) as GmailErrorBody;
      reason = body.error?.errors?.[0]?.reason;
      detail = body.error?.message ?? detail;
    } catch {
      // Not JSON; the truncated body is the best detail available.
    }

    const throttled =
      response.status === 429 ||
      response.status >= 500 ||
      reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded";
    if (throttled && attempt < 4) {
      const wait = 2000 * 2 ** attempt;
      console.warn(`[ingest] gmail ${response.status} on ${path.split("?")[0]}, retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }

    if (response.status === 401) throw new Error("Gmail rejected the access token.");
    throw new Error(
      `Gmail request failed (${response.status}) on ${path.split("?")[0]}: ${reason ?? "unknown"} ${detail}`.trim(),
    );
  }
}

interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

function gmailList(
  accessToken: string,
  query: string,
  pageToken: string | null,
  maxResults: number,
): Promise<GmailListResponse> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  return gmailGet<GmailListResponse>(accessToken, `/messages?${params.toString()}`);
}

export interface SyncSummary {
  sourceId: string;
  label: string;
  fetched: number;
  created: number;
  merged: number;
  review: number;
  ignored: number;
  duplicate: number;
  failed: number;
  error: string | null;
}

function emptySummary(sourceId: string, label: string): SyncSummary {
  return {
    sourceId,
    label,
    fetched: 0,
    created: 0,
    merged: 0,
    review: 0,
    ignored: 0,
    duplicate: 0,
    failed: 0,
    error: null,
  };
}

function count(summary: SyncSummary, result: IngestResult): void {
  if (result.outcome === "created") summary.created += 1;
  else if (result.outcome === "merged") summary.merged += 1;
  else if (result.outcome === "review") summary.review += 1;
  else if (result.outcome === "ignored") summary.ignored += 1;
  else if (result.outcome === "duplicate") summary.duplicate += 1;
}

async function ingestMessages(
  accessToken: string,
  ids: string[],
  sourceId: string,
  ctx: IngestContext,
  summary: SyncSummary,
): Promise<number> {
  let newest = 0;

  for (const id of ids) {
    try {
      const message = await gmailGet<GmailMessage>(accessToken, `/messages/${id}?format=full`);
      const internalDate = Number(message.internalDate ?? Date.now());
      newest = Math.max(newest, internalDate);

      const result = await ingestAlert(
        {
          sourceId,
          kind: "gmail",
          externalId: id,
          from: header(message.payload, "From"),
          subject: header(message.payload, "Subject"),
          body: messageText(message),
          receivedAt: new Date(internalDate),
        },
        ctx,
      );
      summary.fetched += 1;
      count(summary, result);
    } catch (error) {
      summary.failed += 1;
      console.error(`[ingest] gmail message ${id} failed`, error);
    }
  }

  return newest;
}

export async function syncGmailSource(
  sourceId: string,
  options: { maxMessages?: number } = {},
): Promise<SyncSummary> {
  const started = Date.now();
  const maxMessages = options.maxMessages ?? 40;
  const ref = collections.sources().doc(sourceId);
  const snapshot = await ref.get();
  const source = snapshot.data() as Source | undefined;

  if (!snapshot.exists || !source) throw new Error(`No such source: ${sourceId}`);
  if (!source.gmail?.refreshTokenEnc) throw new Error("This inbox is not connected to Gmail yet.");

  const summary = emptySummary(sourceId, source.label);
  const ctx = await loadIngestContext();

  try {
    const refreshToken = openSecret({
      enc: source.gmail.refreshTokenEnc,
      iv: source.gmail.iv,
      tag: source.gmail.tag,
    });
    const tokens = await refreshAccessToken(refreshToken);

    const backfill = source.backfill;
    if (backfill && !backfill.done) {
      const page = await gmailList(
        tokens.access_token,
        backfill.query,
        backfill.pageToken,
        Math.min(BACKFILL_PAGE, maxMessages),
      );
      const ids = (page.messages ?? []).map((message) => message.id);
      await ingestMessages(tokens.access_token, ids, sourceId, ctx, summary);

      await ref.set(
        {
          backfill: {
            ...backfill,
            pageToken: page.nextPageToken ?? null,
            done: !page.nextPageToken,
            messagesSeen: (backfill.messagesSeen ?? 0) + summary.fetched,
            completedAt: page.nextPageToken ? null : Timestamp.now(),
          },
          // The frozen backfill query already covers the last 12 months, so the
          // incremental cursor can start from now.
          cursor: { internalDateMs: Date.now(), messageId: null },
          lastSyncedAt: Timestamp.now(),
          lastError: null,
        },
        { merge: true },
      );
    } else {
      const cursorMs = source.cursor?.internalDateMs ?? Date.now() - 3 * 24 * 60 * 60 * 1000;
      // A minute of overlap plus the alert document id make a re-read harmless.
      const after = Math.max(0, Math.floor(cursorMs / 1000) - 60);
      // Without the allowlist every personal email that arrives would become a
      // review item, because an alert with no amount is stored as unparsed.
      const page = await gmailList(
        tokens.access_token,
        `after:${after} ${senderFilter()}`,
        null,
        maxMessages,
      );
      const ids = (page.messages ?? []).map((message) => message.id).reverse();
      const newest = await ingestMessages(tokens.access_token, ids, sourceId, ctx, summary);

      await ref.set(
        {
          // Never jump to wall-clock now: a message delivered mid-sync with an
          // earlier internalDate must stay ahead of the cursor's overlap.
          cursor: {
            internalDateMs: Math.max(newest, cursorMs),
            messageId: null,
          },
          lastSyncedAt: Timestamp.now(),
          lastError: null,
        },
        { merge: true },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.error = message;
    const expired = /invalid_grant|invalid_request|expired or revoked/i.test(message);
    await ref.set(
      {
        lastSyncedAt: Timestamp.now(),
        lastError: message.slice(0, 500),
        ...(expired
          ? {
              isActive: false,
              gmail: null,
              backfill: null,
            }
          : {}),
      },
      { merge: true },
    );
  }

  const run: IngestRun = {
    kind: "gmail",
    sourceId,
    fetched: summary.fetched,
    created: summary.created,
    merged: summary.merged,
    failed: summary.failed,
    messagesSeen: summary.fetched,
    error: summary.error,
    durationMs: Date.now() - started,
    startedAt: Timestamp.fromMillis(started),
  };
  await collections.ingestRuns().add(run);

  return summary;
}

/** Every active Gmail source, one after another, each with its own receipt. */
export async function syncAllSources(): Promise<SyncSummary[]> {
  const snapshot = await collections.sources().where("isActive", "==", true).get();
  const results: SyncSummary[] = [];

  for (const doc of snapshot.docs) {
    const source = doc.data();
    if (source.kind !== "gmail" || !source.gmail) continue;
    try {
      results.push(await syncGmailSource(doc.id));
    } catch (error) {
      const summary = emptySummary(doc.id, source.label);
      summary.error = error instanceof Error ? error.message : String(error);
      results.push(summary);
    }
  }

  return results;
}

/** Drop the sealed token and stop syncing, keeping the audit history. */
export async function disconnectGmail(sourceId: string): Promise<void> {
  await collections.sources().doc(sourceId).set(
    { gmail: null, backfill: null, isActive: false, lastError: null },
    { merge: true },
  );
}

export function sealRefreshToken(refreshToken: string) {
  return sealSecret(refreshToken);
}
