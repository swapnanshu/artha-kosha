export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, service: "artha-kosha", time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
