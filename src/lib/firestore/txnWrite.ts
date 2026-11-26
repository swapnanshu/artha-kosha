import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firestore/collections";
import { applyStats, categoryKindLookup, contributionOf } from "@/lib/firestore/stats";
import { yearMonthInIst } from "@/lib/dates";
import { merchantRuleKey, merchantTokens, normalizeMerchant } from "@/lib/merchant";
import type { TxnInput } from "@/lib/schemas";
import type { CategoryKind, Direction, MerchantRule, PaymentMode, Txn, TxnSplitLine } from "@/lib/types";

/**
 * Soft-deleted rows leave their month by moving here, so every list query that
 * filters `yearMonth == '2026-11'` never has to add a second facet for
 * `deletedAt`. The document and its audit trail are kept.
 */
export const DELETED_MONTH = "zz-deleted";

export interface TxnPatch {
  amountPaise: number;
  direction: Direction;
  categoryId: string | null;
  accountId: string | null;
  occurredAt: Date;
  paymentMode: PaymentMode;
  merchantRaw: string | null;
  last4: string | null;
  referenceId: string | null;
  notes: string | null;
}

function serverNow(): Timestamp {
  return FieldValue.serverTimestamp() as unknown as Timestamp;
}

function auditDoc(
  action: string,
  txnId: string,
  actor: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  return {
    actor,
    action,
    txnId,
    before,
    after,
    at: FieldValue.serverTimestamp(),
  };
}

/** A tiny, timestamp-free snapshot for the audit log. */
function snapshotOf(txn: Txn): Record<string, unknown> {
  return {
    amountPaise: txn.amountPaise,
    direction: txn.direction,
    categoryId: txn.categoryId,
    accountId: txn.accountId,
    yearMonth: txn.yearMonth,
    paymentMode: txn.paymentMode,
    merchantRaw: txn.merchantRaw,
    last4: txn.last4,
    notes: txn.notes,
    splits: txn.splits?.length ?? 0,
  };
}

function buildTxn(input: TxnInput, kind: CategoryKind): Txn {
  return {
    occurredAt: Timestamp.fromDate(input.occurredAt),
    yearMonth: yearMonthInIst(input.occurredAt),
    amountPaise: input.amountPaise,
    direction: input.direction,
    categoryId: input.categoryId,
    accountId: input.accountId,
    merchantRaw: input.merchantRaw,
    merchantNorm: normalizeMerchant(input.merchantRaw),
    merchantTokens: merchantTokens(input.merchantRaw),
    paymentMode: input.paymentMode,
    last4: input.last4,
    referenceId: input.referenceId,
    isInternalTransfer: kind === "transfer",
    transferGroupId: null,
    isInvestment: kind === "investment",
    categorySource: "manual",
    notes: input.notes,
    alertIds: [],
    alertCount: 0,
    splits: [],
    createdAt: serverNow(),
    updatedAt: serverNow(),
    deletedAt: null,
  };
}

function rememberMerchant(txn: Txn): { key: string; rule: MerchantRule } | null {
  if (!txn.merchantNorm || !txn.categoryId) return null;
  const key = merchantRuleKey(txn.merchantNorm);
  if (!key) return null;
  return {
    key,
    rule: {
      token: txn.merchantNorm,
      categoryId: txn.categoryId,
      accountId: txn.accountId,
      autoApply: true,
      hitCount: 1,
      lastUsedAt: serverNow(),
    },
  };
}

/** One atomic write: the txn, its month counters, the audit row, the rule. */
export async function createTxn(
  input: TxnInput,
  actor: string,
  remember: boolean,
): Promise<string> {
  const kindOf = await categoryKindLookup();
  const txn = buildTxn(input, kindOf(input.categoryId));
  const ref = collections.txn().doc();

  const batch = adminDb().batch();
  batch.set(ref, txn);
  applyStats(batch, txn.yearMonth, contributionOf(txn, kindOf), 1);
  batch.set(collections.audit().doc(), auditDoc("txn.create", ref.id, actor, null, snapshotOf(txn)));

  if (remember) {
    const rule = rememberMerchant(txn);
    if (rule) {
      batch.set(
        collections.merchantRules().doc(rule.key),
        { ...rule.rule, hitCount: FieldValue.increment(1) } as unknown as MerchantRule,
        { merge: true },
      );
    }
  }

  await batch.commit();
  return ref.id;
}

export async function getTxn(id: string): Promise<(Txn & { id: string }) | null> {
  const snapshot = await collections.txn().doc(id).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!data) return null;
  return { ...data, id };
}

/**
 * Moves the old contribution out and the new one in, in one transaction, so a
 * failed write can never leave a month's counters off by an amount.
 */
export async function updateTxn(
  id: string,
  patch: TxnPatch,
  actor: string,
  remember: boolean,
): Promise<void> {
  const kindOf = await categoryKindLookup();
  const ref = collections.txn().doc(id);
  const db = adminDb();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const before = snapshot.data();
    if (!snapshot.exists || !before) throw new Error("That transaction no longer exists.");

    const kind = kindOf(patch.categoryId);
    const after: Txn = {
      ...before,
      amountPaise: patch.amountPaise,
      direction: patch.direction,
      categoryId: patch.categoryId,
      accountId: patch.accountId,
      occurredAt: Timestamp.fromDate(patch.occurredAt),
      yearMonth: yearMonthInIst(patch.occurredAt),
      paymentMode: patch.paymentMode,
      merchantRaw: patch.merchantRaw,
      merchantNorm: normalizeMerchant(patch.merchantRaw),
      merchantTokens: merchantTokens(patch.merchantRaw),
      last4: patch.last4,
      referenceId: patch.referenceId,
      notes: patch.notes,
      isInternalTransfer: kind === "transfer",
      isInvestment: kind === "investment",
      categorySource: "manual",
      splits: Array.isArray(before.splits) ? before.splits : [],
      updatedAt: serverNow(),
    };

    applyStats(transaction, before.yearMonth, contributionOf(before, kindOf), -1);
    applyStats(transaction, after.yearMonth, contributionOf(after, kindOf), 1);
    transaction.set(ref, after);
    transaction.set(
      collections.audit().doc(),
      auditDoc("txn.update", id, actor, snapshotOf(before), snapshotOf(after)),
    );

    if (remember) {
      const rule = rememberMerchant(after);
      if (rule) {
        transaction.set(
          collections.merchantRules().doc(rule.key),
          { ...rule.rule, hitCount: FieldValue.increment(1) } as unknown as MerchantRule,
          { merge: true },
        );
      }
    }
  });
}

/** Soft delete: the row, its audit trail and the month history all survive. */
export async function softDeleteTxn(id: string, actor: string): Promise<void> {
  const kindOf = await categoryKindLookup();
  const ref = collections.txn().doc(id);
  const db = adminDb();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const before = snapshot.data();
    if (!snapshot.exists || !before) throw new Error("That transaction no longer exists.");
    if (before.deletedAt) return;

    const after: Txn = {
      ...before,
      yearMonth: DELETED_MONTH,
      deletedAt: serverNow(),
      updatedAt: serverNow(),
    };

    applyStats(transaction, before.yearMonth, contributionOf(before, kindOf), -1);
    transaction.set(ref, after);
    transaction.set(
      collections.audit().doc(),
      auditDoc("txn.soft_delete", id, actor, snapshotOf(before), null),
    );
  });
}

/**
 * Splits must add up to the original amount exactly; the primary category stays
 * on the row for reference while `byCategory` follows the split lines.
 */
export async function setSplits(
  id: string,
  splits: TxnSplitLine[],
  actor: string,
): Promise<void> {
  const kindOf = await categoryKindLookup();
  const ref = collections.txn().doc(id);
  const db = adminDb();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const before = snapshot.data();
    if (!snapshot.exists || !before) throw new Error("That transaction no longer exists.");
    if (before.deletedAt) throw new Error("That transaction is deleted.");

    const sum = splits.reduce((total, line) => total + line.amountPaise, 0);
    if (sum !== before.amountPaise) {
      throw new Error("The split lines must add up to exactly the transaction amount.");
    }

    const after: Txn = {
      ...before,
      splits,
      updatedAt: serverNow(),
    };

    applyStats(transaction, before.yearMonth, contributionOf(before, kindOf), -1);
    applyStats(transaction, after.yearMonth, contributionOf(after, kindOf), 1);
    transaction.set(ref, after);
    transaction.set(
      collections.audit().doc(),
      auditDoc("txn.split", id, actor, snapshotOf(before), snapshotOf(after)),
    );
  });
}
