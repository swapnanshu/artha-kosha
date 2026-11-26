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

/** Direction words after removing "credit card", which is not a credit. */
function detectDirection(text: string): Direction | null {
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

function detectAmountPaise(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    const raw = match?.[1];
    if (!raw) continue;
    const rupees = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(rupees) || rupees <= 0) continue;
    const paise = Math.round(rupees * 100);
    // A bank alert above one crore is far more likely a misread reference.
    if (paise > 1_00_00_00_000_00) continue;
    return paise;
  }
  return null;
}

const LAST4_PATTERNS: RegExp[] = [
  /\b(?:ending(?:\s+(?:with|in))?|ending\.?)\s*[:#]?\s*(?:xx|xx\*+|\*+)?\s*(\d{4})\b/i,
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
  /\b(?:at|towards|paid to|sent to|to merchant|merchant)\s+([A-Za-z0-9][A-Za-z0-9&.'_\- ]{1,48}?)(?=\s+(?:on|via|using|from|ref|for|dt\.?|dated|successful|success|has been)\b|[.,;\n]|$)/i,
  /\bto\s+([A-Za-z0-9][A-Za-z0-9&.'_\- ]{1,40}?)(?=\s+(?:on|via|using|ref|from|for)\b|[.,;\n]|$)/i,
  /\bfrom\s+([A-Za-z0-9][A-Za-z0-9&.'_\- ]{1,40}?)(?=\s+(?:on|via|using|ref|for)\b|[.,;\n]|$)/i,
];

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
]);

export function cleanMerchant(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^[-:.\s]+|[-:.,;\s]+$/g, "")
    .replace(/\b(?:on|via|ref|dt|dated)\b.*$/i, "")
    .trim();
  if (cleaned.length < 3 || cleaned.length > 60) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (MERCHANT_STOP.has(cleaned.toLowerCase())) return null;
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

function detectReference(text: string): string | null {
  const match = text.match(
    /\b(?:rrn|utr|ref(?:erence)?(?:\s*(?:no\.?|id|number))?|txn\s*id)\s*[:#]?\s*([A-Za-z0-9]{6,24})\b/i,
  );
  return match?.[1] ?? null;
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
    /\b(\d{1,2})[\s-](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]+(\d{2,4})(?:[ T,](\d{1,2}):(\d{2}))?/i,
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

  const amountPaise = detectAmountPaise(text);
  const direction = detectDirection(text);
  const isCardBill = CARD_BILL.test(text) && Boolean(direction);
  const isSelfTransfer = SELF_TRANSFER.test(text);
  const paymentMode = detectMode(text, isCardBill);
  let merchantRaw = detectMerchant(text);

  // A card-bill alert is a move between the owner's own accounts: the "merchant"
  // is the card issuer and is misleading in the ledger.
  if (isCardBill) merchantRaw = null;

  const last4 = detectLast4(text);
  const referenceId = detectReference(text);
  const occurredAt = detectOccurredAt(text, alert.receivedAt);

  const ignored = amountPaise === null && (OTP.test(text) || PROMO.test(text));
  const parseStatus: ParseStatus = ignored
    ? "ignored"
    : amountPaise !== null && direction !== null && merchantRaw !== null
      ? "parsed"
      : amountPaise !== null
        ? "parsed_incomplete"
        : "unparsed";

  const confidence =
    parseStatus === "parsed"
      ? 0.9
      : parseStatus === "parsed_incomplete"
        ? direction !== null
          ? 0.55
          : 0.4
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
