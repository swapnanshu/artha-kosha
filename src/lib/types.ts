import type { Timestamp } from "firebase-admin/firestore";

/** Money is always integer paise: ₹1,249.50 -> 124950. */
export type Paise = number;

export type Direction = "debit" | "credit";

export type PaymentMode =
  | "upi"
  | "credit_card"
  | "debit_card"
  | "netbanking"
  | "imps_neft"
  | "cash"
  | "wallet"
  | "auto_debit"
  | "other";

export type CategorySource = "rule" | "manual" | "default";

export type ParseStatus = "parsed" | "parsed_incomplete" | "unparsed" | "manual" | "ignored";

export type SourceKind = "gmail" | "sms";

export interface Txn {
  occurredAt: Timestamp;
  /** '2026-11', computed in Asia/Kolkata on the server only. */
  yearMonth: string;
  amountPaise: Paise;
  direction: Direction;
  categoryId: string | null;
  accountId: string | null;
  merchantRaw: string | null;
  merchantNorm: string | null;
  merchantTokens: string[];
  paymentMode: PaymentMode;
  last4: string | null;
  referenceId: string | null;
  isInternalTransfer: boolean;
  transferGroupId: string | null;
  isInvestment: boolean;
  categorySource: CategorySource;
  notes: string | null;
  /** Empty for a normal row; 2+ lines once split. They sum to amountPaise. */
  splits: TxnSplitLine[];
  alertIds: string[];
  alertCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
}

/**
 * Split lines live inside the txn document, not in a subcollection, so the row
 * and its category breakdown are written in one atomic operation.
 */
export interface TxnSplitLine {
  amountPaise: Paise;
  categoryId: string;
  notes: string | null;
}

export interface MonthStats {
  inflowPaise: Paise;
  /** Debit that is not an investment. */
  outflowLivingPaise: Paise;
  outflowInvestmentPaise: Paise;
  /** Keyed by categoryId; 'uncategorised' is a real key, never a null case. */
  byCategory: Record<string, Paise>;
  byMode: Record<string, Paise>;
  txnCount: number;
  /** null means the counters are known to be stale; run Recalculate. */
  recomputedAt: Timestamp | null;
}

export interface Source {
  kind: SourceKind;
  label: string;
  identifier: string;
  isActive: boolean;
  cursor: { internalDateMs: number; messageId: string | null } | null;
  backfill: {
    /** Frozen at first connect: 'after:<ms> from:(<sender allowlist>)'. */
    query: string;
    /** A Gmail nextPageToken is only valid together with `query`. */
    pageToken: string | null;
    done: boolean;
    startedAt: Timestamp;
    completedAt: Timestamp | null;
    messagesSeen: number;
  } | null;
  gmail: {
    refreshTokenEnc: string;
    iv: string;
    tag: string;
    scope: string;
    connectedAt: Timestamp;
  } | null;
  lastSyncedAt: Timestamp | null;
  lastError: string | null;
}

export interface RawAlert {
  sourceId: string;
  externalId: string;
  from: string | null;
  receivedAt: Timestamp;
  /** Immutable, capped at 4 KB. */
  body: string;
  parseStatus: ParseStatus;
  confidence: number;
  templateId: string | null;
  templateVersion: number | null;
  candidate: {
    amountPaise: number | null;
    direction: Direction | null;
    merchantRaw: string | null;
    last4: string | null;
  } | null;
  txnId: string | null;
  reviewedAt: Timestamp | null;
}

export type AccountKind = "bank" | "wallet" | "credit_card" | "cash";

export interface Account {
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  /** Stored for later; no utilisation gauge is rendered in v1. */
  creditLimitPaise: Paise | null;
  statementDay: number | null;
  dueDay: number | null;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type CategoryKind = "expense" | "income" | "transfer" | "investment" | "uncategorised";

export interface Category {
  name: string;
  slug: string;
  kind: CategoryKind;
  color: string;
  sortOrder: number;
  isSystem: boolean;
}

export interface MerchantRule {
  /** Normalized token, e.g. 'swiggy'. */
  token: string;
  categoryId: string | null;
  accountId: string | null;
  autoApply: boolean;
  hitCount: number;
  lastUsedAt: Timestamp | null;
}

export interface IngestRun {
  kind: "gmail" | "sms" | "backup" | "reparse";
  sourceId: string | null;
  fetched: number;
  created: number;
  merged: number;
  failed: number;
  messagesSeen: number;
  error: string | null;
  durationMs: number;
  startedAt: Timestamp;
}

export interface AuditEntry {
  actor: string;
  action: string;
  txnId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: Timestamp;
}

/**
 * One document per (amount, direction, IST day). The transaction reads the
 * neighbouring days, so a Gmail alert and an SMS about the same payment merge
 * into one ledger row instead of double counting.
 */
export interface DedupeKey {
  txnId: string;
  amountPaise: number;
  direction: Direction;
  last4: string | null;
  merchantNorm: string | null;
  createdAt?: Timestamp;
}

/** The doc id for an alert: deterministic, so `create()` is the idempotency lock. */
export function alertDocId(sourceId: string, externalId: string): string {
  return `${sourceId}_${externalId}`;
}
