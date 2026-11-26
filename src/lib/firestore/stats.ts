import "server-only";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Transaction,
  type WriteBatch,
} from "firebase-admin/firestore";
import { collections } from "@/lib/firestore/collections";
import type { CategoryKind, MonthStats, Txn } from "@/lib/types";

/** A real key, never a null case: the ledger groups "no category" under it. */
export const UNCATEGORISED = "uncategorised";

export type CategoryKindLookup = (categoryId: string | null) => CategoryKind;

/** One read of the 12 system categories per request; no cache to invalidate. */
export async function categoryKindLookup(): Promise<CategoryKindLookup> {
  const snapshot = await collections.categories().get();
  const kinds = new Map<string, CategoryKind>();
  for (const doc of snapshot.docs) {
    kinds.set(doc.id, (doc.data().kind ?? "expense") as CategoryKind);
  }
  return (categoryId) => (categoryId ? (kinds.get(categoryId) ?? "expense") : "uncategorised");
}

export interface StatsDelta {
  inflowPaise: number;
  outflowLivingPaise: number;
  outflowInvestmentPaise: number;
  txnCount: number;
  byCategory: Record<string, number>;
  byMode: Record<string, number>;
}

export function emptyDelta(): StatsDelta {
  return {
    inflowPaise: 0,
    outflowLivingPaise: 0,
    outflowInvestmentPaise: 0,
    txnCount: 0,
    byCategory: {},
    byMode: {},
  };
}

function bump(map: Record<string, number>, key: string, amount: number): void {
  map[key] = (map[key] ?? 0) + amount;
}

/**
 * What one live txn adds to its month. Transfers (own-account moves and
 * credit-card bill payments) are counted in the ledger but never as inflow or
 * outflow, because that money never left the owner.
 */
export function contributionOf(txn: Txn, kindOf: CategoryKindLookup): StatsDelta {
  const delta = emptyDelta();
  const kind = kindOf(txn.categoryId);
  if (kind === "transfer") return delta;

  delta.txnCount = 1;
  if (txn.direction === "credit") {
    delta.inflowPaise += txn.amountPaise;
  } else if (kind === "investment") {
    delta.outflowInvestmentPaise += txn.amountPaise;
  } else {
    delta.outflowLivingPaise += txn.amountPaise;
  }

  const splits = Array.isArray(txn.splits) ? txn.splits : [];
  const lines =
    splits.length > 0
      ? splits
      : [
          {
            amountPaise: txn.amountPaise,
            categoryId: txn.categoryId ?? UNCATEGORISED,
            notes: null,
          },
        ];
  for (const line of lines) {
    bump(delta.byCategory, line.categoryId || UNCATEGORISED, line.amountPaise);
  }
  bump(delta.byMode, txn.paymentMode, txn.amountPaise);
  return delta;
}

export function addDelta(target: StatsDelta, delta: StatsDelta, sign: 1 | -1): void {
  target.inflowPaise += sign * delta.inflowPaise;
  target.outflowLivingPaise += sign * delta.outflowLivingPaise;
  target.outflowInvestmentPaise += sign * delta.outflowInvestmentPaise;
  target.txnCount += sign * delta.txnCount;
  for (const [key, value] of Object.entries(delta.byCategory)) {
    bump(target.byCategory, key, sign * value);
  }
  for (const [key, value] of Object.entries(delta.byMode)) {
    bump(target.byMode, key, sign * value);
  }
}

function isEmpty(delta: StatsDelta): boolean {
  return (
    delta.inflowPaise === 0 &&
    delta.outflowLivingPaise === 0 &&
    delta.outflowInvestmentPaise === 0 &&
    delta.txnCount === 0 &&
    Object.keys(delta.byCategory).length === 0 &&
    Object.keys(delta.byMode).length === 0
  );
}

/**
 * Field-path increments for one month document. Every write stamps
 * `recomputedAt`, so the counters are always known-current; a document that
 * does not exist yet is a different case (see `getMonthStats`).
 */
function deltaFields(delta: StatsDelta, sign: 1 | -1): Record<string, unknown> {
  const fields: Record<string, unknown> = { recomputedAt: FieldValue.serverTimestamp() };
  if (delta.inflowPaise !== 0) fields.inflowPaise = FieldValue.increment(sign * delta.inflowPaise);
  if (delta.outflowLivingPaise !== 0) {
    fields.outflowLivingPaise = FieldValue.increment(sign * delta.outflowLivingPaise);
  }
  if (delta.outflowInvestmentPaise !== 0) {
    fields.outflowInvestmentPaise = FieldValue.increment(sign * delta.outflowInvestmentPaise);
  }
  if (delta.txnCount !== 0) fields.txnCount = FieldValue.increment(sign * delta.txnCount);

  // Nested maps, not dotted keys: `set()` treats "a.b" as one literal field
  // name, while a nested object merges recursively under { merge: true }.
  const byCategory: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(delta.byCategory)) {
    if (value !== 0) byCategory[key] = FieldValue.increment(sign * value);
  }
  if (Object.keys(byCategory).length > 0) fields.byCategory = byCategory;

  const byMode: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(delta.byMode)) {
    if (value !== 0) byMode[key] = FieldValue.increment(sign * value);
  }
  if (Object.keys(byMode).length > 0) fields.byMode = byMode;

  return fields;
}

/** Apply one delta inside the same atomic write as the txn it describes. */
export function applyStats(
  writer: Transaction | WriteBatch,
  yearMonth: string,
  delta: StatsDelta,
  sign: 1 | -1,
): void {
  if (isEmpty(delta)) return;

  const ref = collections.statsMonths().doc(yearMonth);
  const fields = deltaFields(delta, sign);

  // Transaction.set and WriteBatch.set are separate overload sets that TS will
  // not unify through a union, so the call is made through one shared shape.
  const set = writer.set.bind(writer) as (
    documentRef: typeof ref,
    data: Record<string, unknown>,
    options: { merge: true },
  ) => unknown;
  set(ref, fields, { merge: true });
}

export function normalizeStats(data: Partial<MonthStats> | undefined): MonthStats {
  return {
    inflowPaise: data?.inflowPaise ?? 0,
    outflowLivingPaise: data?.outflowLivingPaise ?? 0,
    outflowInvestmentPaise: data?.outflowInvestmentPaise ?? 0,
    byCategory: data?.byCategory ?? {},
    byMode: data?.byMode ?? {},
    txnCount: data?.txnCount ?? 0,
    recomputedAt: data?.recomputedAt ?? null,
  };
}

/**
 * A month with no document has never been written; rebuild it from the ledger
 * instead of showing zeros.
 */
export async function getMonthStats(yearMonth: string): Promise<MonthStats> {
  const snapshot = await collections.statsMonths().doc(yearMonth).get();
  if (!snapshot.exists) return recomputeMonth(yearMonth);
  return normalizeStats(snapshot.data());
}

/** The repair path: sum the month's live txns from scratch. */
export async function recomputeMonth(yearMonth: string): Promise<MonthStats> {
  const kindOf = await categoryKindLookup();
  const snapshot = await collections.txn().where("yearMonth", "==", yearMonth).limit(5000).get();

  const total = emptyDelta();
  for (const doc of snapshot.docs) {
    addDelta(total, contributionOf(doc.data(), kindOf), 1);
  }

  const stats: MonthStats = { ...total, recomputedAt: Timestamp.now() };
  await collections.statsMonths().doc(yearMonth).set(stats);
  return stats;
}

/** Newest months first, by document id ('2026-11' sorts as a date string). */
export async function recentMonths(
  limit: number,
): Promise<Array<{ yearMonth: string; stats: MonthStats }>> {
  const snapshot = await collections
    .statsMonths()
    .orderBy(FieldPath.documentId(), "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => ({
    yearMonth: doc.id,
    stats: normalizeStats(doc.data()),
  }));
}
