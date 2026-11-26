import "server-only";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { collections } from "@/lib/firestore/collections";
import type { Txn } from "@/lib/types";

export interface LedgerFilters {
  month: string;
  categoryId: string | null;
  accountId: string | null;
  paymentMode: string | null;
  q: string | null;
}

export interface LedgerRow extends Txn {
  id: string;
}

export interface LedgerPage {
  rows: LedgerRow[];
  nextCursor: string | null;
  /** Facets the index set cannot combine, dropped so the query stays valid. */
  ignored: string[];
}

export const LEDGER_PAGE = 50;
export const EXPORT_LIMIT = 1000;

/**
 * Firestore can serve newsroom-style filters only over deployed indexes, so the
 * facet set is deliberate: month is always present, account+category combine,
 * and payment mode or merchant search only run alone. Anything else is reported
 * back rather than silently returning a wrong subset.
 */
function buildQuery(filters: LedgerFilters, limit: number) {
  let query = collections.txn().where("yearMonth", "==", filters.month);
  const ignored: string[] = [];

  if (filters.accountId) query = query.where("accountId", "==", filters.accountId);
  if (filters.categoryId) query = query.where("categoryId", "==", filters.categoryId);

  if (filters.accountId || filters.categoryId) {
    if (filters.paymentMode) ignored.push("mode");
    if (filters.q) ignored.push("search");
  } else if (filters.paymentMode) {
    query = query.where("paymentMode", "==", filters.paymentMode);
  } else if (filters.q) {
    query = query.where("merchantTokens", "array-contains", filters.q.toLowerCase());
  }

  query = query
    .orderBy("occurredAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(limit);

  return { query, ignored };
}

function encodeCursor(row: LedgerRow): string {
  return `${row.occurredAt.toMillis()}:${row.id}`;
}

function decodeCursor(cursor: string): { ms: number; id: string } | null {
  const index = cursor.indexOf(":");
  if (index < 1) return null;
  const ms = Number(cursor.slice(0, index));
  const id = cursor.slice(index + 1);
  if (!Number.isFinite(ms) || !id) return null;
  return { ms, id };
}

export async function listTxns(filters: LedgerFilters, cursor: string | null): Promise<LedgerPage> {
  const { query, ignored } = buildQuery(filters, LEDGER_PAGE + 1);

  let paged = query;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) paged = paged.startAfter(Timestamp.fromMillis(decoded.ms), decoded.id);
  }

  const snapshot = await paged.get();
  const docs = snapshot.docs.slice(0, LEDGER_PAGE);
  const rows: LedgerRow[] = docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  const last = rows.at(-1);
  const nextCursor = snapshot.docs.length > LEDGER_PAGE && last ? encodeCursor(last) : null;

  return { rows, nextCursor, ignored };
}

/** CSV export walks the same paged query so it never loads the whole ledger. */
export async function listTxnRange(filters: LedgerFilters, max: number): Promise<LedgerRow[]> {
  const collected: LedgerRow[] = [];
  let cursor: string | null = null;

  while (collected.length < max) {
    const page = await listTxns(filters, cursor);
    collected.push(...page.rows);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return collected.slice(0, max);
}
