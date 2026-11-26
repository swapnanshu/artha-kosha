import { requireOwner } from "@/lib/auth/verify-owner";
import { buildAuthUrl } from "@/lib/ingest/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = /^gmail-[a-z0-9-]{1,32}$/;

export async function GET(request: Request) {
  try {
    await requireOwner();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const sourceId = url.searchParams.get("source") ?? "gmail-primary";
  if (!ALLOWED.test(sourceId)) {
    return Response.redirect(`${url.origin}/sources?error=invalid+source`, 302);
  }

  try {
    const hint = url.searchParams.get("hint") ?? undefined;
    return Response.redirect(buildAuthUrl(url.origin, sourceId, hint), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail is not configured";
    console.error("[ingest] gmail connect failed", message);
    return Response.redirect(`${url.origin}/sources?error=${encodeURIComponent(message)}`, 302);
  }
}
