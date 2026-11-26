import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { collections } from "@/lib/firestore/collections";
import { serverEnv } from "@/lib/env";
import { dismissAlertAction, disconnectSourceAction } from "@/app/actions/sources";
import { SyncNowButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import { formatDateInIst } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { Source } from "@/lib/types";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

const SLOTS = [
  { id: "gmail-primary", label: "Gmail inbox 1" },
  { id: "gmail-secondary", label: "Gmail inbox 2" },
];

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const connected = first(params.connected);
  const error = first(params.error);
  const env = serverEnv();

  const [sourcesSnap, reviewSnap, runsSnap, headerList] = await Promise.all([
    collections.sources().get(),
    collections.rawAlerts().where("parseStatus", "in", ["parsed_incomplete", "unparsed"]).limit(50).get(),
    collections.ingestRuns().orderBy("startedAt", "desc").limit(6).get(),
    headers(),
  ]);

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3100";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const sources = new Map<string, Source>(
    sourcesSnap.docs.map((doc) => [doc.id, doc.data() as Source]),
  );

  const review = reviewSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => b.receivedAt.toMillis() - a.receivedAt.toMillis())
    .slice(0, 20);

  const runs = runsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="text-sm text-muted-foreground">
            Two Gmail inboxes and one phone, parsed into the same ledger.
          </p>
        </div>
        <SyncNowButton />
      </div>

      {connected ? (
        <p className="rounded-md border border-primary/40 bg-accent px-3 py-2 text-sm">
          Connected {connected}. Sync now pulls the first page of the 12-month backfill.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Gmail</h2>
        {SLOTS.map((slot) => {
          const source = sources.get(slot.id);
          const active = Boolean(source?.gmail);
          const backfill = source?.backfill;

          return (
            <div key={slot.id} className="rounded-[var(--radius)] border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{source?.label ?? slot.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {active ? (
                      <>
                        Read-only ·{" "}
                        {source?.lastSyncedAt
                          ? `last synced ${formatDateInIst(source.lastSyncedAt.toDate())}`
                          : "not synced yet"}
                        {backfill && !backfill.done
                          ? ` · backfill ${backfill.messagesSeen} messages so far`
                          : backfill?.done
                            ? " · backfill complete"
                            : ""}
                      </>
                    ) : (
                      "Not connected"
                    )}
                  </p>
                  {source?.lastError ? (
                    <p className="mt-1 text-xs text-danger">{source.lastError}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  {active ? (
                    <form action={disconnectSourceAction}>
                      <input type="hidden" name="id" value={slot.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Disconnect
                      </Button>
                    </form>
                  ) : (
                    <Button asChild size="sm" disabled={!env.GOOGLE_OAUTH_CLIENT_ID}>
                      <a href={`/api/ingest/gmail/connect?source=${slot.id}`}>Connect Gmail</a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET ? (
          <p className="text-xs text-muted-foreground">
            Gmail needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the server env. Register this
            redirect URI in Google Cloud: <code className="break-all">{origin}/api/ingest/gmail/callback</code>
          </p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-[var(--radius)] border bg-card p-4">
        <h2 className="text-sm font-medium">Phone SMS</h2>
        <p className="text-xs text-muted-foreground">
          Use <strong>SMS to URL Forwarder</strong> (F-Droid, MIT, free, no account). POST URL{" "}
          <code>{origin}/api/ingest/sms</code>, sender <code>(?i)hdfc|icici|axis|sbi|kotak|rbl|idfc|indusind|niyo|cred|paytm|phonepe|gpay|aubank|yes</code>{" "}
          with <em>Sender is a regular expression</em> ticked, and the default payload. Add the header{" "}
          <code>{`{"x-webhook-secret":"<SMS_WEBHOOK_SECRET>"}`}</code>. The app&apos;s own payload and this app&apos;s{" "}
          <code>{`{"from","body","receivedAt"}`}</code> are both accepted.
        </p>
        <p className="text-xs text-muted-foreground">
          {env.SMS_WEBHOOK_SECRET
            ? "Webhook secret is set on the server (never shown here)."
            : "SMS_WEBHOOK_SECRET is not set, so the endpoint returns 503."}
        </p>
      </section>

      <section className="space-y-2 rounded-[var(--radius)] border bg-card p-4">
        <h2 className="text-sm font-medium">Scheduled sync</h2>
        <p className="text-xs text-muted-foreground">
          Cloud Scheduler calls this every 15 minutes with{" "}
          <code>Authorization: Bearer $CRON_SECRET</code>.
        </p>
        <p className="break-all text-xs">
          <code>{origin}/api/cron/sync</code>
        </p>
        <p className="text-xs text-muted-foreground">
          {env.CRON_SECRET ? "CRON_SECRET is set." : "CRON_SECRET is not set, so the route returns 503."}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Needs review ({review.length})</h2>
        {review.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting. Messages that never parsed are listed here instead of being silently dropped.
          </p>
        ) : (
          <div className="divide-y rounded-[var(--radius)] border bg-card">
            {review.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {alert.sourceId} · {formatDateInIst(alert.receivedAt.toDate())} ·{" "}
                    {alert.parseStatus}
                  </p>
                  <p className="mt-1 line-clamp-3 break-words text-muted-foreground">{alert.body}</p>
                  {alert.candidate?.amountPaise ? (
                    <p className="mt-1 text-xs">
                      Read: {formatPaise(alert.candidate.amountPaise)} {alert.candidate.direction ?? ""}{" "}
                      {alert.candidate.merchantRaw ?? ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/ledger" className="text-xs underline">
                    Add manually
                  </Link>
                  <form action={dismissAlertAction}>
                    <input type="hidden" name="id" value={alert.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Dismiss
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sync has run yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius)] border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Fetched</th>
                  <th className="px-3 py-2 text-right font-medium">New</th>
                  <th className="px-3 py-2 text-right font-medium">Merged</th>
                  <th className="px-3 py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateInIst(run.startedAt.toDate())}
                    </td>
                    <td className="px-3 py-2">
                      {run.sourceId ?? run.kind}
                      {run.error ? <span className="ml-2 text-xs text-danger">{run.error}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">{run.fetched}</td>
                    <td className="px-3 py-2 text-right">{run.created}</td>
                    <td className="px-3 py-2 text-right">{run.merged}</td>
                    <td className="px-3 py-2 text-right">{run.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
