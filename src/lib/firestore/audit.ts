import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { collections } from "@/lib/firestore/collections";
import type { AuditEntry } from "@/lib/types";

export interface AuditInput {
  actor: string;
  action: string;
  txnId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Every mutation writes one of these. `at` uses the server timestamp so the
 * ordering is Firestore's, not the caller's clock.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  await collections.audit().add({
    actor: input.actor,
    action: input.action,
    txnId: input.txnId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    at: FieldValue.serverTimestamp(),
  } as unknown as AuditEntry);
}
