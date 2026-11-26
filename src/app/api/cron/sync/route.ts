import { secretMatches } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { syncAllSources } from "@/lib/ingest/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hit by Cloud Scheduler every 15 minutes with the CRON_SECRET header. Any
 * caller without the secret gets a 401 and learns nothing about the ledger.
 */
export async function GET(request: Request) {
  const expected = serverEnv().CRON_SECRET;
  if (!expected) {
    return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const header = request.headers.get("x-cron-secret") ?? bearer;
  if (!secretMatches(header, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllSources();
  return Response.json(
    { ok: true, at: new Date().toISOString(), results },
    { headers: { "cache-control": "private, no-store" } },
  );
}
