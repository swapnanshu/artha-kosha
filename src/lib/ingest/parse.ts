import type { Direction, ParseStatus, PaymentMode } from "@/lib/types";

/**
 * Bank SMS and email alerts are the only source of truth for an ingested row.
 * Everything here is deterministic: no LLM, no network, no guessing in a
 * branch. A message that cannot be read is stored with `parseStatus` set and
 * surfaced for a human, never silently dropped.
 */

export interface ParsedAlert {
  amountPaise: number | null;
  direction: Direction | null;
  merchantRaw: string | null;
  last4: string | null;
  paymentMode: PaymentMode;
  referenceId: string | null;
  occurredAt: Date | null;
  isCardBillPayment: boolean;
  isSelfTransfer: boolean;
  parseStatus: ParseStatus;
  confidence: number;
  templateId: string;
  templateVersion: number;
}

export interface AlertText {
  from: string | null;
  subject: string | null;
  body: string;
  receivedAt: Date;
}

/** Tier order from the plan: bank domains first, then wallets/UPI apps. */
const SENDERS: Array<{ id: string; pattern: RegExp; institution: string | null }> = [
  { id: "hdfc", pattern: /hdfcbank|hdfc/i, institution: "HDFC" },
  { id: "icici", pattern: /icicibank|icici/i, institution: "ICICI" },
  { id: "axis", pattern: /axisbank|axis/i, institution: "Axis" },
  { id: "rbl", pattern: /rblbank|rbl/i, institution: "RBL" },
  { id: "indusind", pattern: /indusind/i, institution: "IndusInd" },
  { id: "kotak", pattern: /kotak/i, institution: "Kotak" },
  { id: "au", pattern: /aubank|au small/i, institution: "AU" },
  { id: "sbi", pattern: /sbicard|onlinesbi|sbi/i, institution: "SBI" },
  { id: "niyo", pattern: /niyo/i, institution: "Niyo" },
  { id: "gpay", pattern: /googlepay|google pay|gpay/i, institution: null },
  { id: "phonepe", pattern: /phonepe/i, institution: null },
  { id: "cred", pattern: /cred\.club|credclub|cred /i, institution: null },
  { id: "samsung", pattern: /samsung/i, institution: null },
  { id: "amazonpay", pattern: /amazonpay|amazon pay/i, institution: null },
  { id: "idfc", pattern: /idfc/i, institution: "IDFC" },
  { id: "yes", pattern: /yesbank|yes bank/i, institution: "Yes" },
  { id: "amex", pattern: /americanexpress|amex/i, institution: "Amex" },
  { id: "paytm", pattern: /paytm/i, institution: null },
];

export function senderTemplate(from: string | null): { id: string; institution: string | null } {
  if (!from) return { id: "generic", institution: null };
  const hit = SENDERS.find((sender) => sender.pattern.test(from));
  return hit ? { id: hit.id, institution: hit.institution } : { id: "generic", institution: null };
}

/** Retailer/marketing senders that never carry a bank-money alert. */
const PROMO_ONLY_SENDERS = new Set(["samsung"]);

const DEBIT_WORDS =
  /\b(debited|debit|spent|withdrawn|withdrawal|purchase|paid|sent|transferred to|dr)\b/gi;
const CREDIT_WORDS =
  /\b(credited|credit|received|refund|refunded|cashback|reversed|reversal|deposited|cr)\b/gi;

const OTP = /\b(otp|one[- ]time password|verification code|do not share|never share)\b/i;
const PROMO =
  /\b(offer|discount|cashback offer|apply now|click here|limited period|win |congratulations)\b/i;

const CARD_BILL =
  /\b(credit card bill|cc bill|card bill|bill payment|payment received|payment successful|thank you for your payment)\b/i;
const SELF_TRANSFER =
  /\b(self transfer|own account|own a\/c|between your accounts|to your own|transfer to self)\b/i;

/**
 * "Multi Option Dep (FD) of Rs 3,50,000.00 created on 30/10/26 by Auto Sweep
 * out of your SB A/c" moves the owner's own money into a deposit: a transfer,
 * not a spend, but still a movement that must not vanish from the ledger.
 */
const FD_SWEEP = /\b(auto\s*sweep|multi\s*option\s*dep(?:osit)?)\b/i;

/**
 * Bank complaint desks answer with the amount quoted back to the owner ("the
 * ₹199 EMI processing fee ... transaction of ₹35,780.39"): that is
 * correspondence about a past row, never a new movement.
 */
const CORRESPONDENCE =
  /\b(?:system-generated\s+(?:response|email|e-mail)|acknowledge\s+receipt\s+of\s+your\s+e-?mail|writing\s+with\s+reference\s+to\s+your\s+(?:concern|query|complaint)|reference\s+to\s+your\s+(?:e-?mail|concern|query|complaint)\s+regarding|escalate\s+your\s+(?:concern|complaint|grievance)|nodal\s+officer|non-resolution\s+of\s+your\s+(?:complaint|concern|grievance))\b/i;

/**
 * Promotional mail quotes rupee figures ("save up to ₹3,000", "bonus offers of
 * ₹250") and spend verbs ("every ₹200 spent"), so one keyword proves nothing.
 * Several markers together are conclusive: a real alert carries none of them.
 */
const PROMO_MARKERS: RegExp[] = [
  /\bunsubscribe\b/i,
  /to view this message in html/i,
  /\bt\s*&\s*c\s+apply\b|\bterms\s*(?:&|and)\s*conditions apply\b/i,
  /\ball brand names and logos\b/i,
  /\bfor illustration purposes?\b/i,
  /\b(?:shop|buy|book)\s+now\b/i,
  /\bfollow us\b/i,
  /\b(?:deliverylabel|campaignname)\b/i,
];

/**
 * A real alert names the instrument that moved: "credit card (5278)", "A/c
 * XX9711", "card ending 78". Promotional footers put "unsubscribe" and "T&C
 * apply" under a genuine alert, so the markers alone cannot condemn a message
 * that names its account.
 */
const ACCOUNT_MENTION =
  /\b(?:a\/c|account|acct)\b|\b(?:credit|debit)?\s*card\b[^.\n]{0,30}\d{2,}|\bending\s+(?:with|in)?\s*\d{2,}|\b(?:x{2,}|\*{2,})\s*\d{2,}/i;

function isPromotional(text: string): boolean {
  let hits = 0;
  for (const marker of PROMO_MARKERS) {
    if (marker.test(text)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

/** Mail that can never be a transaction, whatever amount it quotes. */
export function isNonTransactionalNoise(text: string): boolean {
  return CORRESPONDENCE.test(text) || (isPromotional(text) && !ACCOUNT_MENTION.test(text));
}

/** A deposit sweep the ledger should record as a transfer. */
export function isDepositSweep(text: string): boolean {
  return FD_SWEEP.test(text) && /\b(?:out of|from)\s+your\b/i.test(text);
}

/** Direction words after removing "credit card", which is not a credit. */
function detectDirection(text: string): Direction | null {
  // Money swept out of the savings account into the owner's own deposit.
  if (isDepositSweep(text)) return "debit";

  // "Payment of Rs 15,000 received on your credit card" is money coming back
  // to the owner's card account, not a purchase, even if "payment" reads as a
  // debit word.
  const billReceived =
    /credit\s*card|card bill/i.test(text) &&
    /(?:payment[^.]{0,60}received|thank you for your payment|payment successful|bill paid)/i.test(text);
  if (billReceived && !/\b(debited|spent|withdrawn)\b/i.test(text)) return "credit";

  const cleaned = text.replace(/credit\s*card/gi, "card");
  const debits = (cleaned.match(DEBIT_WORDS) ?? []).length;
  const credits = (cleaned.match(CREDIT_WORDS) ?? []).length;
  if (debits === 0 && credits === 0) return null;
  return debits >= credits ? "debit" : "credit";
}

function detectMode(text: string, isCardBill: boolean): PaymentMode {
  if (isCardBill) return "auto_debit";
  if (/\b(upi|vpa)\b/i.test(text) || VPA.test(text)) return "upi";
  if (/\bcredit\s*card\b|\bcc\b/i.test(text)) return "credit_card";
  if (/\bdebit\s*card\b|\batm\b/i.test(text)) return "debit_card";
  if (/\b(neft|imps|rtgs)\b/i.test(text)) return "imps_neft";
  if (/\b(autopay|auto[- ]debit|mandate|e-?nach|standing instruction)\b/i.test(text)) {
    return "auto_debit";
  }
  if (/\b(netbanking|net banking|internet banking)\b/i.test(text)) return "netbanking";
  if (/\b(wallet|amazon pay balance|paytm balance)\b/i.test(text)) return "wallet";
  return "other";
}

/**
 * A UPI handle, not an email address: `ramesh@ybl` is a handle, while
 * `unauthorisedtransaction@sbi.co.in` is a mailbox the alert merely mentions.
 */
const VPA =
  /\b[a-z0-9][a-z0-9._-]{2,30}@(?:ok(?:hdfcbank|icici|axis|sbi)?|ybl|paytm|axl|ibl|apl|upi|sbi|hdfcbank|icicibank|axisbank|yesbank|kotak|indusind|airtel)(?![a-z0-9.])/i;

const AMOUNT_PATTERNS: RegExp[] = [
  /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])/i,
  /\b(?:debited|credited|spent|paid|received|withdrawn)(?:\s+(?:by|for|with))?\s+(?:rs\.?\s*|inr\s*)?([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])/i,
  // Label-first templates, e.g. SBI's flattened table: "Amount (INR) 7550.00".
  /\bamount\s*(?:\(\s*(?:inr|₹)\s*\)|(?:inr|₹))?\s*[:#]?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])/i,
];

interface AmountMatch {
  paise: number;
  index: number;
}

function findAmount(text: string): AmountMatch | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    const raw = match?.[1];
    if (!raw || match?.index === undefined) continue;
    const rupees = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(rupees) || rupees <= 0) continue;
    const paise = Math.round(rupees * 100);
    // A bank alert above one crore is far more likely a misread reference.
    if (paise > 1_00_00_00_000_00) continue;
    return { paise, index: match.index };
  }
  return null;
}

export function detectAmountPaise(text: string): number | null {
  return findAmount(text)?.paise ?? null;
}

const LAST4_PATTERNS: RegExp[] = [
  // Cards print the mask as "XX8812", "x7449" or just "ending 8812".
  /\bending(?:\s+(?:with|in))?\.?\s*[:#]?\s*(?:x{1,2}|\*+)?\s*(\d{4})\b/i,
  /\b(?:a\/c|account|card|ac)\s*(?:no\.?|number)?\s*[:#]?\s*(?:xx|x{1,4}|\*+)?(\d{4})\b/i,
  /\b(?:xx|\*{2,})(\d{4})\b/i,
];

function detectLast4(text: string): string | null {
  for (const pattern of LAST4_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

const MERCHANT_PATTERNS: RegExp[] = [
  // UPI/IMPS/P2M/<ref>/MERCHANT style tokens used by several bank templates.
  /\b(?:upi|imps|neft|p2m|p2a)\/[^/\s]*\/[^/\s]*\/([A-Za-z0-9 .&_-]{3,40})/i,
  // Labelled fields from tabular templates, e.g. SBI's "Terminal Owner Name".
  /\b(?:terminal owner name|merchant name|payee name|payee|terminal)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9&.'_\- ]{2,48}?)(?=\s+(?:terminal|date|transaction|amount|last|channel|city|location|if not|you may)\b|[.,;\n]|$)/i,
  // A VPA handle is the most reliable merchant identity when present.
  VPA,
  // Bare "merchant" is prose ("merchant credit refund of INR 1330"); only the
  // labelled form and real prepositional phrases name a payee.
  /\b(?:at|towards|paid to|sent to|to merchant|merchant name)\s+([A-Za-z0-9][A-Za-z0-9&.'_\- ]{1,48}?)(?=\s+(?:on|via|using|from|ref|for|dt\.?|dated|successful|success|has been)\b|[.,;\n]|$)/i,
  /\bto\s+([A-Za-z0-9][A-Za-z0-9&.'_\- ]{1,40}?)(?=\s+(?:on|via|using|ref|from|for)\b|[.,;\n]|$)/i,
  /\bfrom\s+([A-Za-z0-9][A-Za-z0-9&.'_\- ]{1,40}?)(?=\s+(?:on|via|using|ref|for)\b|[.,;\n]|$)/i,
];

/**
 * Marketing mail is allowed through the sender filter and often carries a rupee
 * figure ("save up to ₹7,000"), but it never names the account it debited or a
 * transaction reference, so it must stay out of the ledger.
 */
const TRANSACTION_VERB =
  /\b(?:debited|credited|spent|withdrawn|refund(?:ed)?|reversed|reversal|has\s+(?:a\s+)?(?:debit|credit)|has\s+been\s+(?:debited|credited)|transaction\s+of|payment\s+of)\b/i;

const JUNK_MERCHANT =
  /html\s*format|click\s*here|unsubscribe|terms\s*(?:and|&)\s*conditions|privacy\s*policy|discretion|warranty|password|kyc|additional\s+cost|toll\s*free|auto\s*generated|do\s+not\s+reply|customer\s*care|contact\s+us|report\s+fraud|available\s+credit|capping|https?:|www\.|@[a-z0-9-]+\./i;

/** A candidate that opens with a function word came from prose, not a payee. */
const PROSE_START =
  /^(?:the|their|this|that|these|and|all|some|any|no|not|be|is|are|was|were|will|would|can|could|should|may|might|must|it|its|if|for|to|at|in|on|of|or|as|by|from|with|view|receive|exercise|report|click|please|your|you|we|our|us|contact|download|update|ensure|know|get|see|read|track|manage|activate|apply|verify|pay|make|continue|check|avail|join|explore|discover|shop|buy|order|book|register|subscribe|call|visit|write|send|reply|qualify|location)\b/i;

const MERCHANT_STOP = new Set([
  "rs",
  "inr",
  "upi",
  "neft",
  "imps",
  "your",
  "the",
  "account",
  "card",
  "bank",
  "ac",
  "a/c",
  "ending",
  "ref",
  "refno",
  "vpa",
  "payment",
  "transaction",
  "successful",
  "success",
  "creditcard",
  "credit card",
  "debit card",
  "credit refund",
]);

export function cleanMerchant(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^[-:.\s]+|[-:.,;\s]+$/g, "")
    .replace(/\b(?:on|via|ref|dt|dated)\b.*$/i, "")
    .trim();
  if (cleaned.length < 3 || cleaned.length > 60) return null;
  if (MERCHANT_STOP.has(cleaned.toLowerCase())) return null;
  // Digit groups with spaces are phone/toll-free numbers, never payees.
  if (/^[\d\s()+./-]{3,}$/.test(cleaned)) return null;
  // A long digit run is a phone number, OTP or account id, not a payee.
  if (/\d{5,}/.test(cleaned)) return null;
  if (PROSE_START.test(cleaned) || JUNK_MERCHANT.test(cleaned)) return null;
  return cleaned;
}

function detectMerchant(text: string): string | null {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = text.match(pattern);
    const candidate = cleanMerchant(match?.[1] ?? null);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * `ref` needs a boundary of its own: "refreshed every day" and "preferred"
 * are prose, and a captured fragment there anchors a marketing mail.
 */
const REFERENCE =
  /\b(?:rrn|utr|ref(?:erence)?|txn\s*id|transaction\s*(?:no|number|id))\b\.?\s*(?:(?:no|id|number)\b\.?)?\s*[:#]?\s*([A-Za-z0-9]{6,24})\b/i;

function detectReference(text: string): string | null {
  return text.match(REFERENCE)?.[1] ?? null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A body date is only trusted when it is plausible for the message: up to two
 * days ahead (clock skew, timezone) and up to 400 days back (12-month
 * backfill). A stray "2026" in a marketing footer must never become a txn date.
 */
function plausible(parsed: Date, fallback: Date): boolean {
  const delta = parsed.getTime() - fallback.getTime();
  return delta <= 2 * 24 * 60 * 60 * 1000 && delta >= -400 * 24 * 60 * 60 * 1000;
}

/** dd-mm-yy, dd/mm/yyyy or 12-Nov-26 with an optional HH:MM, read as IST. */
export function detectOccurredAt(text: string, fallback: Date): Date | null {
  const numeric = text.match(
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,](\d{1,2}):(\d{2}))?/,
  );
  if (numeric) {
    const [, day, month, year, hour, minute] = numeric;
    const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    const iso = `${fullYear}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}T${String(Number(hour ?? "0")).padStart(2, "0")}:${String(Number(minute ?? "0")).padStart(2, "0")}`;
    const parsed = istWallClock(iso);
    if (parsed && plausible(parsed, fallback)) return parsed;
  }

  const named = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s-](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]+(\d{2,4})(?:[ T,](\d{1,2}):(\d{2}))?/i,
  );
  if (named) {
    const [, day, monthName, year, hour, minute] = named;
    const month = (MONTHS.indexOf((monthName ?? "").toLowerCase()) + 1).toString().padStart(2, "0");
    const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    const iso = `${fullYear}-${month}-${String(Number(day)).padStart(2, "0")}T${String(Number(hour ?? "0")).padStart(2, "0")}:${String(Number(minute ?? "0")).padStart(2, "0")}`;
    const parsed = istWallClock(iso);
    if (parsed && plausible(parsed, fallback)) return parsed;
  }

  // Month-first templates, e.g. SBI's "Date & Time Nov 23, 2026, 13:06".
  const monthFirst = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2}))?/i,
  );
  if (monthFirst) {
    const [, monthName, day, year, hour, minute] = monthFirst;
    const month = (MONTHS.indexOf((monthName ?? "").toLowerCase()) + 1).toString().padStart(2, "0");
    const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    const iso = `${fullYear}-${month}-${String(Number(day)).padStart(2, "0")}T${String(Number(hour ?? "0")).padStart(2, "0")}:${String(Number(minute ?? "0")).padStart(2, "0")}`;
    const parsed = istWallClock(iso);
    if (parsed && plausible(parsed, fallback)) return parsed;
  }

  return null;
}

/** Local copy so the parser has no Next.js-only imports and stays testable. */
function istWallClock(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d, h ?? 0, mi ?? 0) - 5.5 * 60 * 60 * 1000);
}

export function parseAlert(alert: AlertText): ParsedAlert {
  const text = `${alert.subject ?? ""}\n${alert.body}`.trim();
  const sender = senderTemplate(alert.from);

  const amount = findAmount(text);
  const amountPaise = amount?.paise ?? null;
  // Money is described next to its amount. A payee, card number or verb only
  // counts when it sits in that neighbourhood; footers talk about "offers that
  // may be withdrawn" and toll-free numbers, and must not fake a transaction.
  const focus = amount
    ? text.slice(Math.max(0, amount.index - 260), amount.index + 320)
    : text;

  const direction = detectDirection(text);
  const isCardBill = CARD_BILL.test(text) && Boolean(direction);
  const isSelfTransfer = SELF_TRANSFER.test(text) || isDepositSweep(text);
  const paymentMode = detectMode(text, isCardBill);
  let merchantRaw = detectMerchant(focus);

  // A card-bill alert is a move between the owner's own accounts: the "merchant"
  // is the card issuer and is misleading in the ledger.
  if (isCardBill) merchantRaw = null;

  const last4 = detectLast4(focus);
  const referenceId = detectReference(focus);
  const occurredAt = detectOccurredAt(text, alert.receivedAt);

  // A card number alone is not money moving: "Credit Limit: ₹1,12,000 on your
  // card ending 6419" and "Min. Cumulative Spend: Rs.5,000" both name a card.
  // Only a reference or a verb that says what happened can anchor a row.
  const anchor = Boolean(referenceId) || TRANSACTION_VERB.test(focus) || isDepositSweep(text);
  const transactional = amountPaise !== null && direction !== null && anchor;

  // Money-shaped prose without an account, a reference or a transaction verb is
  // a promotion, not a payment: it goes to the review queue, never the ledger.
  let parseStatus: ParseStatus = isNonTransactionalNoise(text)
    ? "ignored"
    : transactional
      ? merchantRaw !== null
        ? "parsed"
        : "parsed_incomplete"
      : OTP.test(text) || PROMO.test(text)
        ? "ignored"
        : amountPaise !== null && direction === null
          ? "parsed_incomplete"
          : "unparsed";

  // Retailer marketing (Samsung) names an "account" and a rupee figure, so it
  // slips past the promotion filter; it is still never a bank transaction.
  if (PROMO_ONLY_SENDERS.has(sender.id) && isPromotional(text)) parseStatus = "ignored";

  const confidence =
    parseStatus === "parsed"
      ? 0.9
      : parseStatus === "parsed_incomplete"
        ? direction !== null
          ? 0.55
          : 0.4
        : parseStatus === "ignored"
          ? 0.05
          : 0.1;

  return {
    amountPaise,
    direction,
    merchantRaw,
    last4,
    paymentMode,
    referenceId,
    occurredAt,
    isCardBillPayment: isCardBill,
    isSelfTransfer,
    parseStatus,
    confidence,
    templateId: sender.id,
    templateVersion: 1,
  };
}
