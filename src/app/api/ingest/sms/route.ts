import { z } from "zod";
import { createHash, createHmac } from "node:crypto";
import { secretMatches } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { ensureSmsSource, ingestAlert, loadIngestContext, SMS_SOURCE_ID } from "@/lib/ingest/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two shapes are accepted on purpose:
 *
 * 1. This app's own contract:   { from, body, receivedAt: ISO-8601 }
 * 2. The default payload of the Android forwarder (SMS to URL Forwarder,
 *    tech.bogomolov.incomingsmsgateway): { from, text, sentStamp, receivedStamp }
 *    where the stamps are epoch milliseconds.
 *
 * The phone app is the only sender, so the body is normalised here rather than
 * requiring the owner to hand-edit a JSON template on a phone keyboard - a
 * typo in that template is a silently broken ingest, not a visible error.
 */
const stamp = z.union([z.number(), z.string().max(32)]).nullish();

const bodySchema = z.object({
  from: z.string().max(120).nullish(),
  sender: z.string().max(120).nullish(),
  address: z.string().max(120).nullish(),
  body: z.string().max(8000).nullish(),
  text: z.string().max(8000).nullish(),
  message: z.string().max(8000).nullish(),
  receivedAt: z.string().datetime({ offset: true }).nullish(),
  receivedStamp: stamp,
  sentStamp: stamp,
  timestamp: stamp,
});

const noStore = { "cache-control": "private, no-store" } as const;

function pickText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** Epoch milliseconds (the Android convention) or a parseable date string. */
function toDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) {
    // Epoch seconds are 10 digits, epoch millis 13; anything smaller is junk.
    const ms = numeric < 1e11 ? numeric * 1000 : numeric;
    const fromEpoch = new Date(ms);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The shared secret is the only credential; there is no browser session here.
 * Three carriers are accepted so the phone app can use whichever it supports:
 * a custom header, an Authorization header, or its built-in HMAC signature.
 */
function authorized(request: Request, raw: string, expected: string): boolean {
  if (secretMatches(request.headers.get("x-webhook-secret"), expected)) return true;

  const bearer = request.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    if (secretMatches(bearer.slice(7).trim(), expected)) return true;
  }

  const signature = request.headers.get("x-signature");
  if (signature) {
    const hmac = createHmac("sha256", expected).update(raw, "utf8").digest("hex");
    if (secretMatches(signature.trim().toLowerCase(), hmac)) return true;
  }

  return false;
}

export async function POST(request: Request) {
  const expected = serverEnv().SMS_WEBHOOK_SECRET;
  if (!expected) {
    return Response.json({ error: "SMS_WEBHOOK_SECRET is not set" }, { status: 503, headers: noStore });
  }

  const raw = await request.text();
  if (!authorized(request, raw, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400, headers: noStore });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400, headers: noStore });
  }

  const body = pickText(parsed.data.body, parsed.data.text, parsed.data.message);
  if (!body) {
    return Response.json({ error: "missing message body" }, { status: 400, headers: noStore });
  }

  const from = pickText(parsed.data.from, parsed.data.sender, parsed.data.address);
  const receivedAt =
    (parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : null) ??
    toDate(parsed.data.receivedStamp) ??
    toDate(parsed.data.sentStamp) ??
    toDate(parsed.data.timestamp) ??
    new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    return Response.json({ error: "invalid receivedAt" }, { status: 400, headers: noStore });
  }

  await ensureSmsSource();
  const ctx = await loadIngestContext();

  // Content-addressed id: a retried webhook is the same alert, not a new row.
  const externalId = createHash("sha256")
    .update(`${from ?? ""}|${receivedAt.toISOString()}|${body}`)
    .digest("hex")
    .slice(0, 32);

  const result = await ingestAlert(
    {
      sourceId: SMS_SOURCE_ID,
      kind: "sms",
      externalId,
      from,
      subject: null,
      body,
      receivedAt,
    },
    ctx,
  );

  await reloadSources();
  return Response.json({ ok: true, outcome: result.outcome }, { headers: noStore });
}

async function reloadSources(): Promise<void> {
  // Touch the source so the Sources page shows a fresh heartbeat even when the
  // alert itself was a duplicate.
  const { collections } = await import("@/lib/firestore/collections");
  const { Timestamp } = await import("firebase-admin/firestore");
  await collections.sources().doc(SMS_SOURCE_ID).set(
    { lastSyncedAt: Timestamp.now() },
    { merge: true },
  );
}
