/**
 * Merchant names arrive as "UPI/SWIGGY/1234@ybl" or "AMAZON PAY INDIA". The
 * ledger groups by a normalised key and searches by tokens, never by the raw
 * string, so a rule learnt once keeps matching noisy variants.
 */

const NOISE = new Set([
  "upi",
  "vpa",
  "pay",
  "payment",
  "payments",
  "pos",
  "ach",
  "neft",
  "imps",
  "ref",
  "refno",
  "txn",
  "transaction",
  "the",
  "and",
  "pvt",
  "ltd",
  "limited",
  "india",
  "in",
  "com",
  "www",
]);

/** Lowercase, collapse everything that is not a letter or digit. */
export function normalizeMerchant(raw: string | null): string | null {
  if (!raw) return null;
  const normalised = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalised.length > 0 ? normalised : null;
}

/**
 * Tokens used for `array-contains` search. `array-contains` matches the whole
 * element, so each token is a standalone word, never a prefix.
 */
export function merchantTokens(raw: string | null): string[] {
  const normalised = normalizeMerchant(raw);
  if (!normalised) return [];
  const seen = new Set<string>();
  for (const token of normalised.split(" ")) {
    if (token.length < 3 || NOISE.has(token)) continue;
    seen.add(token);
    if (seen.size === 8) break;
  }
  return [...seen];
}

/** A Firestore-safe document id for a merchant rule. */
export function merchantRuleKey(normalised: string): string {
  return normalised.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
