"use server";

import { revalidatePath } from "next/cache";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireOwner } from "@/lib/auth/verify-owner";
import { collections } from "@/lib/firestore/collections";
import { parseRupeesToPaise } from "@/lib/money";
import { accountInputSchema } from "@/lib/schemas";
import type { FormState } from "@/lib/form-state";
import type { Account } from "@/lib/types";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

function optionalInt(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function saveAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();

  const id = field(formData, "id");
  const limitRaw = field(formData, "creditLimit");

  const parsed = accountInputSchema.safeParse({
    name: field(formData, "name"),
    kind: field(formData, "kind") || "bank",
    institution: nullable(field(formData, "institution")),
    last4: nullable(field(formData, "last4")),
    creditLimitPaise: limitRaw === "" ? null : parseRupeesToPaise(limitRaw),
    statementDay: optionalInt(field(formData, "statementDay")),
    dueDay: optionalInt(field(formData, "dueDay")),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "That account is not valid." };
  }

  const values = parsed.data;
  try {
    if (id) {
      await collections.accounts().doc(id).set(
        {
          ...values,
          updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      );
    } else {
      await collections.accounts().add({
        ...values,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      } as unknown as Account);
    }
    revalidatePath("/accounts");
    revalidatePath("/ledger");
    revalidatePath("/dashboard");
    return { status: "ok", message: id ? "Account updated." : "Account added." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save that account.",
    };
  }
}

/** Accounts are never deleted while transactions point at them; they go inactive. */
export async function toggleAccountAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = field(formData, "id");
  if (!id) return;
  const active = field(formData, "active") === "true";

  await collections.accounts().doc(id).set(
    {
      isActive: !active,
      updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    },
    { merge: true },
  );

  revalidatePath("/accounts");
  revalidatePath("/ledger");
}
