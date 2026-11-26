"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/verify-owner";
import { parseIstDateTime } from "@/lib/dates";
import { parseRupeesToPaise } from "@/lib/money";
import { txnInputSchema } from "@/lib/schemas";
import { createTxn, setSplits, softDeleteTxn, updateTxn } from "@/lib/firestore/txnWrite";
import { recomputeMonth } from "@/lib/firestore/stats";
import type { FormState } from "@/lib/form-state";
import type { TxnSplitLine } from "@/lib/types";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function refresh(): void {
  revalidatePath("/dashboard");
  revalidatePath("/ledger");
  revalidatePath("/accounts");
}

interface ParsedTxn {
  ok: true;
  values: Parameters<typeof createTxn>[0];
  remember: boolean;
}

function parseTxnForm(formData: FormData): ParsedTxn | { ok: false; message: string } {
  const amountPaise = parseRupeesToPaise(field(formData, "amount"));
  if (amountPaise === null) {
    return { ok: false, message: "Enter a positive amount, for example 249.50." };
  }

  const rawDate = field(formData, "occurredAt");
  const occurredAt = rawDate === "" ? new Date() : parseIstDateTime(rawDate);
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
    return { ok: false, message: "That date and time could not be read." };
  }

  const parsed = txnInputSchema.safeParse({
    amountPaise,
    direction: field(formData, "direction") || "debit",
    categoryId: nullable(field(formData, "categoryId")),
    accountId: nullable(field(formData, "accountId")),
    occurredAt,
    paymentMode: field(formData, "paymentMode") || "upi",
    merchantRaw: nullable(field(formData, "merchantRaw")),
    last4: nullable(field(formData, "last4")),
    referenceId: null,
    notes: nullable(field(formData, "notes")),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That entry is not valid." };
  }

  return { ok: true, values: parsed.data, remember: field(formData, "remember") === "on" };
}

export async function createTxnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const parsed = parseTxnForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  try {
    const id = await createTxn(parsed.values, session.email, parsed.remember);
    refresh();
    return { status: "ok", message: "Saved.", id };
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
}

export async function updateTxnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const id = field(formData, "id");
  if (!id) return { status: "error", message: "Missing transaction id." };

  const parsed = parseTxnForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  try {
    const values = parsed.values;
    await updateTxn(
      id,
      {
        amountPaise: values.amountPaise,
        direction: values.direction,
        categoryId: values.categoryId,
        accountId: values.accountId,
        occurredAt: values.occurredAt,
        paymentMode: values.paymentMode,
        merchantRaw: values.merchantRaw,
        last4: values.last4,
        referenceId: values.referenceId,
        notes: values.notes,
      },
      session.email,
      parsed.remember,
    );
    refresh();
    revalidatePath(`/ledger/${id}`);
    return { status: "ok", message: "Updated.", id };
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
}

/** Soft delete from the ledger row or the edit page. */
export async function deleteTxnAction(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const id = field(formData, "id");
  if (!id) return;
  await softDeleteTxn(id, session.email);
  refresh();
  revalidatePath(`/ledger/${id}`);
  redirect("/ledger");
}

export async function saveSplitsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const id = field(formData, "id");
  if (!id) return { status: "error", message: "Missing transaction id." };

  const splits: TxnSplitLine[] = [];
  for (let index = 0; index < 12; index += 1) {
    const amount = field(formData, `line-amount-${index}`);
    const categoryId = field(formData, `line-category-${index}`);
    if (amount === "" && categoryId === "") continue;

    const amountPaise = parseRupeesToPaise(amount);
    if (amountPaise === null) {
      return { status: "error", message: `Line ${index + 1} needs an amount above zero.` };
    }
    if (!categoryId) {
      return { status: "error", message: `Line ${index + 1} needs a category.` };
    }
    splits.push({
      amountPaise,
      categoryId,
      notes: nullable(field(formData, `line-notes-${index}`)),
    });
  }

  if (splits.length < 2) {
    return { status: "error", message: "A split needs at least two lines." };
  }

  try {
    await setSplits(id, splits, session.email);
    refresh();
    revalidatePath(`/ledger/${id}`);
    return { status: "ok", message: `Split into ${splits.length} lines.` };
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
}

/** The repair button: rebuild one month's counters from the ledger itself. */
export async function recalcMonthAction(formData: FormData): Promise<void> {
  await requireOwner();
  const month = field(formData, "month");
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  await recomputeMonth(month);
  refresh();
}
