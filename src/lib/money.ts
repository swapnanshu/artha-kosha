/**
 * Money is an integer number of paise everywhere: ₹1,249.50 -> 124950.
 * Floating point rupees never touch Firestore or arithmetic.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,24,950.00 style, with the rupee symbol and Indian digit grouping. */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

/** Compact form for summary cards: ₹1.2L / ₹24.5K. */
export function formatPaiseCompact(paise: number): string {
  const abs = Math.abs(paise);
  const sign = paise < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return formatPaise(paise);
}

/** Rupees (from a form input) to integer paise, rounded to the nearest paisa. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * A form field to integer paise. Accepts "1,249.50", "₹1249.5", " 1200 ".
 * Returns null for anything that is not a positive amount, so the action can
 * refuse rather than silently record a zero.
 */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

/** Paise for display inside a plain form field: 124950 -> "1249.50". */
export function paiseToInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Paise to a plain decimal string for CSV export (Excel-friendly). */
export function paiseToCsv(paise: number): string {
  return (paise / 100).toFixed(2);
}
