"use server";

import { revalidatePath } from "next/cache";
import { Timestamp } from "firebase-admin/firestore";
import { requireOwner } from "@/lib/auth/verify-owner";
import { collections } from "@/lib/firestore/collections";
import { disconnectGmail, syncAllSources } from "@/lib/ingest/gmail";
import type { FormState } from "@/lib/form-state";
import type { RawAlert } from "@/lib/types";

export async function syncNowAction(previous: FormState): Promise<FormState> {
  void previous;
  await requireOwner();

  try {
    const results = await syncAllSources();
    revalidatePath("/sources");
    revalidatePath("/ledger");
    revalidatePath("/dashboard");

    if (results.length === 0) {
      return { status: "ok", message: "No active Gmail inboxes to sync yet." };
    }

    const created = results.reduce((total, result) => total + result.created, 0);
    const merged = results.reduce((total, result) => total + result.merged, 0);
    const review = results.reduce((total, result) => total + result.review, 0);
    const errors = results.filter((result) => result.error);

    const summary = `${created} new, ${merged} merged, ${review} need review.`;
    if (errors.length > 0) {
      return { status: "error", message: `${summary} ${errors[0]?.error ?? ""}`.trim() };
    }
    return { status: "ok", message: summary };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Sync failed.",
    };
  }
}

export async function disconnectSourceAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = formData.get("id");
  if (typeof id !== "string" || !id.startsWith("gmail-")) return;

  await disconnectGmail(id);
  revalidatePath("/sources");
}

/** A message the parser could not read is kept, marked, and dismissible. */
export async function dismissAlertAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) return;

  await collections.rawAlerts().doc(id).set(
    { parseStatus: "ignored", reviewedAt: Timestamp.now() } as unknown as RawAlert,
    { merge: true },
  );
  revalidatePath("/sources");
}
