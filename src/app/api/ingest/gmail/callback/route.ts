import { Timestamp } from "firebase-admin/firestore";
import { requireOwner } from "@/lib/auth/verify-owner";
import { collections } from "@/lib/firestore/collections";
import {
  backfillQuery,
  decodeState,
  emailFromIdToken,
  exchangeCode,
  sealRefreshToken,
} from "@/lib/ingest/gmail";
import type { Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(origin: string, key: string, value: string): Response {
  return Response.redirect(`${origin}/sources?${key}=${encodeURIComponent(value)}`, 302);
}

/**
 * Google redirects the browser here. The owner session is re-checked, the
 * signed state proves this callback belongs to a connect we started, and the
 * refresh token is sealed before it is stored.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    await requireOwner();
  } catch {
    return back(url.origin, "error", "Not signed in as the owner. Connect Gmail from /sources.");
  }

  const denied = url.searchParams.get("error");
  if (denied) return back(url.origin, "error", `Google refused: ${denied}`);

  const state = decodeState(url.searchParams.get("state"));
  if (!state) return back(url.origin, "error", "The connect link expired. Try again.");

  const code = url.searchParams.get("code");
  if (!code) return back(url.origin, "error", "Google sent no authorization code.");

  try {
    const tokens = await exchangeCode(code, url.origin);
    if (!tokens.refresh_token) {
      return back(
        url.origin,
        "error",
        "Google returned no refresh token. Remove the app's access at myaccount.google.com/permissions and reconnect.",
      );
    }

    const email = emailFromIdToken(tokens.id_token);
    const sealed = sealRefreshToken(tokens.refresh_token);
    const now = Timestamp.now();

    const source: Source = {
      kind: "gmail",
      label: email ? `Gmail — ${email}` : `Gmail — ${state.sourceId}`,
      identifier: email ?? state.sourceId,
      isActive: true,
      cursor: { internalDateMs: Date.now(), messageId: null },
      backfill: {
        query: backfillQuery(),
        pageToken: null,
        done: false,
        startedAt: now,
        completedAt: null,
        messagesSeen: 0,
      },
      gmail: {
        refreshTokenEnc: sealed.enc,
        iv: sealed.iv,
        tag: sealed.tag,
        scope: tokens.scope,
        connectedAt: now,
      },
      lastSyncedAt: null,
      lastError: null,
    };

    await collections.sources().doc(state.sourceId).set(source, { merge: false });
    return back(url.origin, "connected", email ?? state.sourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail connect failed";
    console.error("[ingest] gmail callback failed", message);
    return back(url.origin, "error", message);
  }
}
