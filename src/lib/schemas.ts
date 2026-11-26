import { z } from "zod";

export const directionSchema = z.enum(["debit", "credit"]);

export const paymentModeSchema = z.enum([
  "upi",
  "credit_card",
  "debit_card",
  "netbanking",
  "imps_neft",
  "cash",
  "wallet",
  "auto_debit",
  "other",
]);

export const accountKindSchema = z.enum(["bank", "wallet", "credit_card", "cash"]);

/** Quick-add input. Amounts arrive in rupees from the form, paise after parse. */
export const txnInputSchema = z.object({
  amountPaise: z.number().int().positive().max(1_00_00_00_000_00),
  direction: directionSchema,
  categoryId: z.string().min(1).nullable(),
  accountId: z.string().min(1).nullable(),
  occurredAt: z.coerce.date(),
  paymentMode: paymentModeSchema.default("upi"),
  merchantRaw: z.string().max(200).nullable().default(null),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .default(null),
  referenceId: z.string().max(64).nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
});

export type TxnInput = z.infer<typeof txnInputSchema>;

export const accountInputSchema = z.object({
  name: z.string().min(1).max(80),
  kind: accountKindSchema,
  institution: z.string().max(80).nullable().default(null),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .default(null),
  creditLimitPaise: z.number().int().nonnegative().nullable().default(null),
  statementDay: z.number().int().min(1).max(31).nullable().default(null),
  dueDay: z.number().int().min(1).max(31).nullable().default(null),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

export const sessionRequestSchema = z.object({ idToken: z.string().min(20) });
