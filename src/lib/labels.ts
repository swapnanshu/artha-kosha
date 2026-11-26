import type { AccountKind, CategoryKind, PaymentMode } from "@/lib/types";

export const PAYMENT_MODES: Array<{ value: PaymentMode; label: string }> = [
  { value: "upi", label: "UPI" },
  { value: "credit_card", label: "Credit card" },
  { value: "debit_card", label: "Debit card" },
  { value: "imps_neft", label: "NEFT / IMPS" },
  { value: "netbanking", label: "Net banking" },
  { value: "cash", label: "Cash" },
  { value: "wallet", label: "Wallet" },
  { value: "auto_debit", label: "Auto debit" },
  { value: "other", label: "Other" },
];

export function paymentModeLabel(mode: string): string {
  return PAYMENT_MODES.find((entry) => entry.value === mode)?.label ?? mode;
}

export const CATEGORY_KINDS: Array<{ value: CategoryKind; label: string }> = [
  { value: "expense", label: "Expense" },
  { value: "investment", label: "Investment" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "uncategorised", label: "Uncategorised" },
];

export function categoryKindLabel(kind: string): string {
  return CATEGORY_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

export const ACCOUNT_KINDS: Array<{ value: AccountKind; label: string }> = [
  { value: "bank", label: "Bank account" },
  { value: "credit_card", label: "Credit card" },
  { value: "wallet", label: "Wallet" },
  { value: "cash", label: "Cash" },
];

export function accountKindLabel(kind: string): string {
  return ACCOUNT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}
