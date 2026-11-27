/**
 * Clean-slate rebuild: delete every derived document, then re-run the 12-month
 * Gmail backfill with the parser as it is right now.
 *
 * Deleted: txn, rawAlerts, dedupeKeys, stats_months, ingestRuns, audit.
 * Kept:    users, sources (the sealed Gmail refresh token), accounts,
 *          categories, merchantRules.
 *
 *   bun --conditions react-server scripts/rebuild-ledger.ts           # dry run
 *   bun --conditions react-server scripts/rebuild-ledger.ts --yes     # rebuild
 *   bun --conditions react-server scripts/rebuild-ledger.ts --resume  # continue a
 *       backfill that stopped part way (no wipe; the stored page token is kept)
 *   bun --conditions react-server scripts/rebuild-ledger.ts --rescan  # re-walk
 *       the 12 months with the current sender list; existing alerts and rows are
 *       untouched, so only messages the old run could not see are added
 *   bun --conditions react-server scripts/rebuild-ledger.ts --repair  # drop the
 *       rows the current parser calls noise, and the alerts it can now read, so
 *       the next --rescan ingests them again from Gmail
 *
 * Parsing happens at ingest time only, so old rawAlerts keep whatever the old
 * parser decided. A clean slate is the only way to apply parser fixes to
 * messages that were already read.
 */
import { readFileSync } from "node:fs";
import type { Query } from "firebase-admin/firestore";
import type { RawAlert, Source } from "@/lib/types";

const resume = process.argv.includes("--resume");
const rescan = process.argv.includes("--rescan");
const repair = process.argv.includes("--repair");
const apply = resume || rescan || repair || process.argv.includes("--yes");

const env = readFileSync(".env.local", "utf8");
for (const line of env.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
    process.env[match[1]] = match[2];
  }
}
process.env.NEXT_PUBLIC_USE_EMULATORS = "false";
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const { Timestamp } = await import("firebase-admin/firestore");
const { adminDb } = await import("@/lib/firebase/admin");
const { collections } = await import("@/lib/firestore/collections");
const { backfillQuery, syncGmailSource } = await import("@/lib/ingest/gmail");
const { recomputeMonth } = await import("@/lib/firestore/stats");

const db = adminDb();

const DERIVED = [
  ["txn", "transactions"],
  ["rawAlerts", "raw alerts"],
  ["dedupeKeys", "dedupe keys"],
  ["stats_months", "month stats"],
  ["ingestRuns", "ingest runs"],
  ["audit", "audit entries"],
] as const;

const PARSE_STATUSES = ["parsed", "parsed_incomplete", "unparsed", "manual", "ignored"] as const;

interface Totals {
  fetched: number;
  created: number;
  merged: number;
  review: number;
  ignored: number;
  duplicate: number;
  failed: number;
}

async function countCollection(path: string, field?: string, value?: string): Promise<number> {
  let query: Query = db.collection(path);
  if (field && value !== undefined) query = query.where(field, "==", value);
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

async function wipe(path: string, label: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const page = await db.collection(path).limit(400).get();
    if (page.empty) break;
    const batch = db.batch();
    for (const doc of page.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += page.size;
  }
  console.log(`  ${label.padEnd(14)} ${removed} deleted`);
  return removed;
}

/** One page per call so a restart loses at most one page of work. */
async function backfill(gmailSources: Array<{ id: string }>): Promise<Totals> {
  const totals: Totals = {
    fetched: 0,
    created: 0,
    merged: 0,
    review: 0,
    ignored: 0,
    duplicate: 0,
    failed: 0,
  };

  for (const source of gmailSources) {
    for (;;) {
      const summary = await syncGmailSource(source.id, { maxMessages: 100 });
      if (summary.error) throw new Error(`${source.id}: ${summary.error}`);

      totals.fetched += summary.fetched;
      totals.created += summary.created;
      totals.merged += summary.merged;
      totals.review += summary.review;
      totals.ignored += summary.ignored;
      totals.duplicate += summary.duplicate;
      totals.failed += summary.failed;
      console.log(
        `  ${source.id}: ${summary.fetched} fetched -> ${summary.created} new, ${summary.merged} merged, ` +
          `${summary.review} review, ${summary.duplicate} dup, ${summary.failed} failed`,
      );

      const snapshot = await collections.sources().doc(source.id).get();
      const state = (snapshot.data() as Source | undefined)?.backfill;
      if (!state || state.done) break;
    }
  }

  return totals;
}

/**
 * Parsing happens once, at ingest time, so a parser fix only reaches mail that
 * is ingested again. This drops exactly three kinds of document and nothing
 * else: a row every one of whose alerts is now noise, the alerts behind it, and
 * an alert the parser can now read but never turned into a row.
 */
async function repairLedger(): Promise<void> {
  const { isDepositSweep, isNonTransactionalNoise } = await import("@/lib/ingest/parse");
  const alertSnapshot = await db.collection("rawAlerts").get();
  const alerts = new Map<string, RawAlert>();
  for (const doc of alertSnapshot.docs) alerts.set(doc.id, doc.data() as RawAlert);

  const txnSnapshot = await db.collection("txn").get();
  let droppedRows = 0;
  let droppedAlerts = 0;
  let skipped = 0;

  for (const doc of txnSnapshot.docs) {
    const txn = doc.data();
    const linked = (txn.alertIds as string[]).map((id) => ({ id, alert: alerts.get(id) }));
    if (linked.length === 0) continue;
    if (!linked.every((entry) => entry.alert && isNonTransactionalNoise(entry.alert.body))) {
      // One alert in this row is a real bank alert: the row is real, and the
      // noise alert that merged into it does not add a second row.
      if (linked.some((entry) => entry.alert && isNonTransactionalNoise(entry.alert.body))) skipped += 1;
      continue;
    }

    const keys = await db.collection("dedupeKeys").where("txnId", "==", doc.id).get();
    const batch = db.batch();
    batch.delete(doc.ref);
    for (const key of keys.docs) batch.delete(key.ref);
    for (const entry of linked) if (entry.alert) batch.delete(db.collection("rawAlerts").doc(entry.id));
    await batch.commit();
    droppedRows += 1;
    droppedAlerts += linked.length;
    console.log(`  dropped ₹${(txn.amountPaise / 100).toFixed(2)} ${txn.direction} on ${txn.yearMonth}: ${linked.map((entry) => entry.alert?.from ?? "?").join(", ")}`);
  }

  for (const [id, alert] of alerts) {
    if (alert.txnId || alert.parseStatus === "ignored") continue;
    if (!isDepositSweep(alert.body)) continue;
    await db.collection("rawAlerts").doc(id).delete();
    droppedAlerts += 1;
    console.log(`  re-reading ${id}: deposit sweep the parser can now record`);
  }

  console.log(`\n  ${droppedRows} rows and ${droppedAlerts} alerts dropped, ${skipped} mixed rows kept`);
  console.log("  run --rescan next so Gmail recreates those alerts with the current parser");
}

async function report(totals: Totals): Promise<void> {
  // Counters are incremented during ingest; rebuilding each month from the
  // ledger proves they agree before the owner looks at the dashboard.
  console.log("recomputing month stats from the ledger");
  const monthSnapshot = await collections.txn().get();
  const months = new Set<string>();
  for (const doc of monthSnapshot.docs) {
    const row = doc.data();
    if (!row.deletedAt) months.add(row.yearMonth);
  }
  for (const yearMonth of [...months].sort()) {
    const stats = await recomputeMonth(yearMonth);
    console.log(
      `  ${yearMonth}  ${String(stats.txnCount).padStart(4)} txns  ` +
        `in ₹${(stats.inflowPaise / 100).toFixed(2)}  out ₹${(stats.outflowLivingPaise / 100).toFixed(2)}`,
    );
  }
  console.log("");

  const statuses = await Promise.all(
    PARSE_STATUSES.map(
      async (status) => [status, await countCollection("rawAlerts", "parseStatus", status)] as const,
    ),
  );
  console.log("result");
  console.log(
    `  ${totals.fetched} messages -> ${totals.created} transactions, ${totals.merged} merged, ` +
      `${totals.review} in review, ${totals.duplicate} duplicates, ${totals.failed} failed`,
  );
  console.log(`  alerts by status: ${statuses.map(([status, n]) => `${status}=${n}`).join(", ")}`);
  console.log(`  months: ${[...months].sort().join(", ")}`);
}

async function main() {
  const sourceSnapshot = await collections.sources().get();
  const sources = sourceSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  console.log(`project   ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(
    `mode      ${
      resume
        ? "RESUME (no wipe, continues the backfill)"
        : rescan
          ? "RESCAN (no wipe, re-walks the 12 months for messages not seen yet)"
          : repair
            ? "REPAIR (dropping rows the parser rejects)"
            : apply
            ? "REBUILD (deleting)"
            : "dry run (nothing deleted)"
    }`,
  );
  console.log("");

  console.log("sources");
  for (const source of sources) {
    const alerts = await countCollection("rawAlerts", "sourceId", source.id);
    const state = source.gmail ? "gmail connected" : source.backfill ? "gmail, no token" : "no gmail token";
    console.log(
      `  ${source.id.padEnd(16)} ${String(alerts).padStart(5)} alerts  ${source.isActive ? "active" : "inactive"}, ${state}`,
    );
    if (source.kind === "sms" && alerts > 0) {
      console.log("    note: SMS alerts cannot be fetched again; this source really is wiped.");
    }
  }
  console.log("");

  console.log("derived data");
  for (const [path, label] of DERIVED) {
    console.log(`  ${label.padEnd(14)} ${await countCollection(path)} documents`);
  }
  if (await countCollection("rawAlerts")) {
    const counts = await Promise.all(
      PARSE_STATUSES.map(
        async (status) => [status, await countCollection("rawAlerts", "parseStatus", status)] as const,
      ),
    );
    console.log(`  by parse status  ${counts.map(([status, n]) => `${status}=${n}`).join(", ")}`);
  }
  console.log("");

  console.log("kept as is");
  for (const [path, label] of [
    ["accounts", "accounts"],
    ["categories", "categories"],
    ["merchantRules", "merchant rules"],
    ["users", "users"],
  ] as const) {
    console.log(`  ${label.padEnd(14)} ${await countCollection(path)} documents`);
  }
  console.log("");

  if (!apply) {
    console.log("Dry run only. Re-run with --yes to wipe the derived data and backfill 12 months.");
    return;
  }

  const gmailSources = sources.filter((source) => source.gmail);
  if (gmailSources.length === 0) {
    throw new Error("No connected Gmail source, so a 12-month backfill cannot run.");
  }

  if (resume) {
    console.log("backfill (resume)");
    await report(await backfill(gmailSources));
    return;
  }

  if (repair) {
    console.log("dropping rows and alerts the current parser rejects");
    await repairLedger();
    return;
  }

  if (rescan) {
    // The stored backfill query is frozen, so a widened sender allowlist would
    // never reach mail it had already skipped. Re-issuing the query walks the
    // window again; every message already stored comes back as "duplicate",
    // which is harmless because the alert id is the Gmail message id.
    console.log("re-walking the window with the current sender list");
    const query = backfillQuery();
    for (const source of gmailSources) {
      await collections.sources().doc(source.id).set(
        {
          backfill: {
            query,
            pageToken: null,
            done: false,
            startedAt: Timestamp.now(),
            completedAt: null,
            messagesSeen: 0,
          },
          lastError: null,
        },
        { merge: true },
      );
      console.log(`  ${source.id}: ${query.slice(0, 48)}…`);
    }
    console.log("");
    await report(await backfill(gmailSources));
    return;
  }

  console.log("wiping");
  for (const [path, label] of DERIVED) await wipe(path, label);
  console.log("");

  console.log("resetting backfill cursors");
  const query = backfillQuery();
  for (const source of sources) {
    if (source.gmail) {
      await collections.sources().doc(source.id).set(
        {
          cursor: null,
          backfill: {
            query,
            pageToken: null,
            done: false,
            startedAt: Timestamp.now(),
            completedAt: null,
            messagesSeen: 0,
          },
          lastSyncedAt: null,
          lastError: null,
        },
        { merge: true },
      );
      console.log(`  ${source.id}: backfill from scratch (${query.slice(0, 40)}…)`);
    } else {
      await collections.sources().doc(source.id).set(
        { cursor: null, backfill: null, lastSyncedAt: null, lastError: null },
        { merge: true },
      );
      console.log(`  ${source.id}: cursor cleared`);
    }
  }
  console.log("");

  console.log("backfill");
  await report(await backfill(gmailSources));
}

main().catch((error) => {
  console.error("Rebuild failed:", error);
  process.exitCode = 1;
});
