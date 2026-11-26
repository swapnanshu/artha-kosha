import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firestore/collections";
import { applyStats, categoryKindLookup, contributionOf, type CategoryKindLookup } from "@/lib/firestore/stats";
import { yearMonthInIst } from "@/lib/dates";
import { merchantRuleKey, merchantTokens, normalizeMerchant } from "@/lib/merchant";
import { alertDocId, type Account, type Category, type Direction, type MerchantRule, type RawAlert, type Source, type Txn } from "@/lib/types";
import { parseAlert, senderTemplate, type ParsedAlert } from "@/lib/ingest/parse";

export const CARD_BILL_CATEGORY = "card-bill";
export const SELF_TRANSFER_CATEGORY = "self-transfer";
export const SMS_SOURCE_ID = "sms-phone";

export type IngestOutcome = "created" | "merged" | "review" | "ignored" | "duplicate";
export type IngestKind = "gmail" | "sms";

export interface IngestInput {
  sourceId: string;
  kind: IngestKind;
  externalId: string;
  from: string | null;
  subject: string | null;
  body: string;
  receivedAt: Date;
}

export interface IngestResult {
  outcome: IngestOutcome;
  txnId: string | null;
}

export interface IngestContext {
  accounts: Array<Account & { id: string }>;
  categories: Map<string, Category>;
  rules: Array<MerchantRule & { id: string }>;
  kindOf: CategoryKindLookup;
}

export async function loadIngestContext(): Promise<IngestContext> {
  const db = adminDb();
  const [accountSnapshot, categorySnapshot, ruleSnapshot] = await Promise.all([
    db.collection("accounts").where("isActive", "==", true).get(),
    collections.categories().get(),
    collections.merchantRules().limit(500).get(),
  ]);

  const categories = new Map<string, Category>();
  for (const doc of categorySnapshot.docs) categories.set(doc.id, doc.data());

  const rules = ruleSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));

  return {
    accounts: accountSnapshot.docs.map((doc) => ({ ...(doc.data() as Account), id: doc.id })),
    categories,
    rules,
    kindOf: await categoryKindLookup(),
  };
}

/**
 * The card/bank that moved the money. A last-4 match wins; otherwise the
 * sender's institution plus the payment mode picks the account of that kind.
 */
export function resolveAccount(parsed: ParsedAlert, from: string | null, ctx: IngestContext) {
  const institution = senderTemplate(from).institution;

  if (parsed.last4) {
    const matches = ctx.accounts.filter((account) => account.last4 === parsed.last4);
    if (matches.length === 1) return matches[0] ?? null;
    if (matches.length > 1) {
      const byKind = matches.find((account) =>
        parsed.paymentMode === "credit_card"
          ? account.kind === "credit_card"
          : account.kind !== "credit_card",
      );
      return byKind ?? matches[0] ?? null;
    }
  }

  if (institution) {
    const byInstitution = ctx.accounts.filter(
      (account) =>
        account.institution?.toLowerCase().includes(institution.toLowerCase()) &&
        (parsed.paymentMode === "credit_card"
          ? account.kind === "credit_card"
          : account.kind !== "credit_card"),
    );
    if (byInstitution.length === 1) return byInstitution[0] ?? null;
  }

  return null;
}

const KEYWORDS: Array<[RegExp, string]> = [
  [/swiggy|zomato|dominos|pizza|restaurant|cafe|bakery|eatery|food/i, "dining"],
  [/bigbasket|blinkit|zepto|dmart|grofers|instamart|kirana|supermarket|grocer/i, "groceries"],
  [/uber|ola|rapido|irctc|makemytrip|goibibo|redbus|indigo|airindia|hotel|travel/i, "travel"],
  [/petrol|fuel|hpcl|iocl|bpcl|indianoil|shell/i, "fuel"],
  [/electricity|water bill|broadband|airtel|jio|vodafone|act fiber|gas bill|recharge|dth/i, "utilities"],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|decathlon|croma|reliance digital/i, "shopping"],
  [/apollo|pharmacy|hospital|clinic|medplus|diagnostic|1mg|pharmeasy|doctor/i, "healthcare"],
  [/rent|landlord|housing society|maintenance/i, "rent"],
  [/emi|loan|bajaj finance|hdb financial/i, "emis"],
  [/salary|payroll|stipend/i, "salary"],
  [/refund|cashback|reversal/i, "cashback"],
  [/zerodha|groww|upstox|mutual fund|\bsip\b|smallcase|kuvera|indmoney/i, "investments"],
];

export interface CategoryChoice {
  categoryId: string | null;
  source: "rule" | "default";
}

/**
 * Order matters: a transfer is structural, not a spending choice, so it wins
 * over any merchant rule. Then a rule the owner taught us, then keywords.
 */
export function resolveCategory(parsed: ParsedAlert, ctx: IngestContext): CategoryChoice {
  if (parsed.isCardBillPayment && ctx.categories.has(CARD_BILL_CATEGORY)) {
    return { categoryId: CARD_BILL_CATEGORY, source: "rule" };
  }
  if (parsed.isSelfTransfer && ctx.categories.has(SELF_TRANSFER_CATEGORY)) {
    return { categoryId: SELF_TRANSFER_CATEGORY, source: "rule" };
  }

  const normalised = normalizeMerchant(parsed.merchantRaw);
  if (normalised) {
    const ruleKey = merchantRuleKey(normalised);
    const exact = ctx.rules.find((rule) => rule.id === ruleKey);
    if (exact?.categoryId && exact.autoApply) {
      return { categoryId: exact.categoryId, source: "rule" };
    }

    // Longest matching learnt token: "amazon pay" beats "amazon".
    const learnt = ctx.rules
      .filter(
        (rule) =>
          rule.autoApply &&
          rule.categoryId &&
          rule.token.length >= 3 &&
          normalised.includes(rule.token),
      )
      .sort((a, b) => b.token.length - a.token.length)[0];
    if (learnt?.categoryId) return { categoryId: learnt.categoryId, source: "rule" };
  }

  if (parsed.merchantRaw) {
    for (const [pattern, slug] of KEYWORDS) {
      if (pattern.test(parsed.merchantRaw) && ctx.categories.has(slug)) {
        return { categoryId: slug, source: "default" };
      }
    }
  }

  return { categoryId: null, source: "default" };
}

function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/** First meaningful merchant word, short enough for a document id. */
function dedupeToken(merchantNorm: string | null): string | null {
  const token = merchantNorm?.split(" ").find((word) => word.length >= 3);
  return token ? token.slice(0, 24) : null;
}

/**
 * A key is written for every known/unknown combination of merchant word and
 * last-4, so two different merchants with the same amount on the same day can
 * never overwrite each other's key and cross-match later.
 */
function dedupeId(
  amountPaise: number,
  direction: Direction,
  day: number,
  token: string | null,
  last4: string | null,
): string {
  return `amt-${amountPaise}-${direction}-${day}-${token ?? "none"}-${last4 ?? "none"}`;
}

interface DedupeDoc {
  txnId: string;
  amountPaise: number;
  direction: Direction;
  last4: string | null;
  merchantNorm: string | null;
}

/** Both last-4 values known and different: not the same event. */
function sameEvent(existing: DedupeDoc, candidate: DedupeDoc): boolean {
  if (existing.amountPaise !== candidate.amountPaise) return false;
  if (existing.direction !== candidate.direction) return false;
  if (existing.last4 && candidate.last4 && existing.last4 !== candidate.last4) return false;

  if (existing.merchantNorm && candidate.merchantNorm) {
    const a = new Set(existing.merchantNorm.split(" "));
    const b = candidate.merchantNorm.split(" ");
    if (!b.some((token) => token.length >= 3 && a.has(token))) return false;
  }
  return true;
}

function serverNow(): Timestamp {
  return FieldValue.serverTimestamp() as unknown as Timestamp;
}

function alertCandidate(parsed: ParsedAlert) {
  return {
    amountPaise: parsed.amountPaise,
    direction: parsed.direction,
    merchantRaw: parsed.merchantRaw,
    last4: parsed.last4,
  };
}

/**
 * One alert becomes one ledger row, or joins the row the other channel already
 * created. The whole decision runs in a transaction keyed by a deterministic
 * dedupe document, so a Gmail sync and an SMS arriving together cannot produce
 * two rows for one payment.
 */
export async function ingestAlert(input: IngestInput, ctx: IngestContext): Promise<IngestResult> {
  const db = adminDb();
  const alertId = alertDocId(input.sourceId, input.externalId);
  const alertRef = collections.rawAlerts().doc(alertId);

  const parsed = parseAlert({
    from: input.from,
    subject: input.subject,
    body: input.body,
    receivedAt: input.receivedAt,
  });

  const rawAlert: RawAlert = {
    sourceId: input.sourceId,
    externalId: input.externalId,
    from: input.from,
    receivedAt: Timestamp.fromDate(input.receivedAt),
    body: input.body.slice(0, 4096),
    parseStatus: parsed.parseStatus,
    confidence: parsed.confidence,
    templateId: parsed.templateId,
    templateVersion: parsed.templateVersion,
    candidate: alertCandidate(parsed),
    txnId: null,
    reviewedAt: null,
  };

  // `create()` is the idempotency lock: a re-synced Gmail message is a no-op.
  try {
    await alertRef.create(rawAlert);
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 6 || code === "6" || code === "already-exists") {
      return { outcome: "duplicate", txnId: null };
    }
    throw error;
  }

  if (parsed.parseStatus === "ignored") return { outcome: "ignored", txnId: null };
  if (parsed.parseStatus === "unparsed") return { outcome: "review", txnId: null };
  if (parsed.amountPaise === null || parsed.direction === null) {
    return { outcome: "review", txnId: null };
  }

  const occurredAt = parsed.occurredAt ?? input.receivedAt;
  const account = resolveAccount(parsed, input.from, ctx);
  const category = resolveCategory(parsed, ctx);

  const merchantNorm = normalizeMerchant(parsed.merchantRaw);
  const candidateDoc: DedupeDoc = {
    txnId: "",
    amountPaise: parsed.amountPaise,
    direction: parsed.direction,
    last4: parsed.last4,
    merchantNorm,
  };

  const day = dayIndex(occurredAt);
  const token = dedupeToken(merchantNorm);
  const lookupIds = [
    ...new Set(
      [day - 1, day, day + 1].flatMap((d) =>
        [token, null].flatMap((t) =>
          [parsed.last4, null].map((l) => dedupeId(parsed.amountPaise!, parsed.direction!, d, t, l)),
        ),
      ),
    ),
  ];

  const actor = `ingest:${input.kind}`;
  const newRef = collections.txn().doc();

  return db.runTransaction(async (transaction) => {
    const dedupeRefs = lookupIds.map((id) => collections.dedupeKeys().doc(id));
    const dedupeDocs = await transaction.getAll(...dedupeRefs);

    let matchId: string | null = null;
    for (const snapshot of dedupeDocs) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() as DedupeDoc | undefined;
      if (data && sameEvent(data, candidateDoc)) {
        matchId = data.txnId;
        break;
      }
    }

    if (matchId) {
      const matchedRef = collections.txn().doc(matchId);
      const matched = await transaction.get(matchedRef);
      const before = matched.data() as Txn | undefined;

      if (before && !before.deletedAt) {
        const after: Txn = {
          ...before,
          // Fill gaps from the second channel without overwriting the first.
          accountId: before.accountId ?? account?.id ?? null,
          last4: before.last4 ?? parsed.last4,
          referenceId: before.referenceId ?? parsed.referenceId,
          merchantRaw: before.merchantRaw ?? parsed.merchantRaw,
          merchantNorm: before.merchantNorm ?? merchantNorm,
          merchantTokens:
            Array.isArray(before.merchantTokens) && before.merchantTokens.length > 0
              ? before.merchantTokens
              : merchantTokens(parsed.merchantRaw),
          alertIds: [...(before.alertIds ?? []), alertId],
          alertCount: (before.alertCount ?? 0) + 1,
          updatedAt: serverNow(),
        };

        // A second channel may teach us the category the first one lacked.
        if (!before.categoryId && category.categoryId) {
          after.categoryId = category.categoryId;
          after.categorySource = category.source;
          after.isInternalTransfer = ctx.kindOf(category.categoryId) === "transfer";
        }

        applyStats(transaction, before.yearMonth, contributionOf(before, ctx.kindOf), -1);
        applyStats(transaction, after.yearMonth, contributionOf(after, ctx.kindOf), 1);

        transaction.set(matchedRef, after);
        transaction.set(
          collections.audit().doc(),
          {
            actor,
            action: "txn.merge",
            txnId: matchId,
            before: { amountPaise: before.amountPaise, alertCount: before.alertCount ?? 0 },
            after: { amountPaise: after.amountPaise, alertCount: after.alertCount },
            at: serverNow(),
          },
        );
        transaction.set(
          alertRef,
          { txnId: matchId, parseStatus: parsed.parseStatus } as unknown as RawAlert,
          { merge: true },
        );
        return { outcome: "merged" as IngestOutcome, txnId: matchId };
      }
    }

    const kind = ctx.kindOf(category.categoryId);
    const txn: Txn = {
      occurredAt: Timestamp.fromDate(occurredAt),
      yearMonth: yearMonthInIst(occurredAt),
      amountPaise: parsed.amountPaise!,
      direction: parsed.direction!,
      categoryId: category.categoryId,
      accountId: account?.id ?? null,
      merchantRaw: parsed.merchantRaw,
      merchantNorm,
      merchantTokens: merchantTokens(parsed.merchantRaw),
      paymentMode: parsed.paymentMode,
      last4: parsed.last4,
      referenceId: parsed.referenceId,
      isInternalTransfer: kind === "transfer",
      transferGroupId: null,
      isInvestment: kind === "investment",
      categorySource: category.source,
      notes: null,
      splits: [],
      alertIds: [alertId],
      alertCount: 1,
      createdAt: serverNow(),
      updatedAt: serverNow(),
      deletedAt: null,
    };

    transaction.set(newRef, txn);
    applyStats(transaction, txn.yearMonth, contributionOf(txn, ctx.kindOf), 1);
    transaction.set(
      collections.audit().doc(),
      {
        actor,
        action: "txn.ingest",
        txnId: newRef.id,
        before: null,
        after: { amountPaise: txn.amountPaise, direction: txn.direction, month: txn.yearMonth },
        at: serverNow(),
      },
    );
    transaction.set(alertRef, { txnId: newRef.id } as unknown as RawAlert, { merge: true });

    for (const ref of dedupeRefs) {
      transaction.set(ref, { ...candidateDoc, txnId: newRef.id });
    }

    return { outcome: "created" as IngestOutcome, txnId: newRef.id };
  }).then(async (result) => {
    // Pairing is an enrichment: a missing index or a slow query must never
    // fail an ingest that already committed its row and counters.
    if (result.txnId) {
      try {
        await tryPairTransfer(result.txnId, ctx, actor);
      } catch (error) {
        console.error("[ingest] transfer pairing deferred", error);
      }
    }
    return result;
  });
}

/**
 * Internal move or card-bill settlement: two rows, opposite directions, same
 * amount, different accounts. Both are re-categorised as transfers, which
 * removes them from inflow/outflow and from the category breakdown.
 */
export async function tryPairTransfer(
  txnId: string,
  ctx: IngestContext,
  actor: string,
): Promise<string | null> {
  const db = adminDb();
  const ref = collections.txn().doc(txnId);

  const snapshot = await ref.get();
  const txn = snapshot.data() as Txn | undefined;
  if (!snapshot.exists || !txn || txn.deletedAt || txn.transferGroupId) return null;
  if (!txn.accountId || txn.amountPaise <= 0) return null;

  const account = ctx.accounts.find((entry) => entry.id === txn.accountId);
  const windowMs = 5 * 24 * 60 * 60 * 1000;
  const start = Timestamp.fromMillis(txn.occurredAt.toMillis() - windowMs);
  const end = Timestamp.fromMillis(txn.occurredAt.toMillis() + windowMs);

  const candidates = await collections
    .txn()
    .where("amountPaise", "==", txn.amountPaise)
    .where("direction", "==", txn.direction === "debit" ? "credit" : "debit")
    .where("occurredAt", ">=", start)
    .where("occurredAt", "<=", end)
    .limit(20)
    .get();

  const counterpart = candidates.docs
    .map((doc) => ({ ...(doc.data() as Txn), id: doc.id }))
    .find((row) => {
      if (row.deletedAt || row.transferGroupId) return false;
      if (!row.accountId || row.accountId === txn.accountId) return false;
      const other = ctx.accounts.find((entry) => entry.id === row.accountId);
      if (!other) return false;
      // A pair is only safe when a card is involved or the alert itself said
      // "bill payment"/"self transfer". Two unrelated ₹500 rows must not merge.
      const cardInvolved = account?.kind === "credit_card" || other.kind === "credit_card";
      const signal = txn.isInternalTransfer || row.isInternalTransfer;
      return cardInvolved || signal;
    });

  if (!counterpart) return null;

  const counterpartAccount = ctx.accounts.find((entry) => entry.id === counterpart.accountId);
  const bothCards = account?.kind === "credit_card" && counterpartAccount?.kind === "credit_card";
  const targetCategory =
    account?.kind === "credit_card" || counterpartAccount?.kind === "credit_card" || bothCards
      ? CARD_BILL_CATEGORY
      : SELF_TRANSFER_CATEGORY;
  const categoryId = ctx.categories.has(targetCategory) ? targetCategory : null;
  if (!categoryId) return null;

  const groupId = `tg_${txnId}`;
  const counterpartRef = collections.txn().doc(counterpart.id);

  return db.runTransaction(async (transaction) => {
    const [aSnap, bSnap] = await transaction.getAll(ref, counterpartRef);
    if (!aSnap || !bSnap) return null;
    const a = aSnap.data() as Txn | undefined;
    const b = bSnap.data() as Txn | undefined;
    if (!a || !b || a.transferGroupId || b.transferGroupId) return null;

    const aAfter: Txn = {
      ...a,
      categoryId,
      categorySource: "rule",
      isInternalTransfer: true,
      transferGroupId: groupId,
      updatedAt: serverNow(),
    };
    const bAfter: Txn = {
      ...b,
      categoryId,
      categorySource: "rule",
      isInternalTransfer: true,
      transferGroupId: groupId,
      updatedAt: serverNow(),
    };

    applyStats(transaction, a.yearMonth, contributionOf(a, ctx.kindOf), -1);
    applyStats(transaction, aAfter.yearMonth, contributionOf(aAfter, ctx.kindOf), 1);
    applyStats(transaction, b.yearMonth, contributionOf(b, ctx.kindOf), -1);
    applyStats(transaction, bAfter.yearMonth, contributionOf(bAfter, ctx.kindOf), 1);

    transaction.set(ref, aAfter);
    transaction.set(counterpartRef, bAfter);
    transaction.set(collections.audit().doc(), {
      actor,
      action: "txn.transfer_pair",
      txnId,
      before: null,
      after: { groupId, counterpartId: counterpart.id, categoryId },
      at: serverNow(),
    });

    return groupId;
  });
}

/** The SMS source is created lazily so the webhook works before any UI visit. */
export async function ensureSmsSource(): Promise<Source> {
  const ref = collections.sources().doc(SMS_SOURCE_ID);
  const snapshot = await ref.get();
  if (snapshot.exists) return snapshot.data() as Source;

  const source: Source = {
    kind: "sms",
    label: "Phone SMS",
    identifier: SMS_SOURCE_ID,
    isActive: true,
    cursor: null,
    backfill: null,
    gmail: null,
    lastSyncedAt: null,
    lastError: null,
  };
  await ref.set(source, { merge: true });
  return source;
}
