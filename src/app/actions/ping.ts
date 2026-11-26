"use server";

import { requireOwner } from "@/lib/auth/verify-owner";

/**
 * Deliberately tiny. It exists so M1 can prove that a Server Action called
 * directly (curl / a crafted POST) is refused without an owner session,
 * because a Server Action is a public HTTP endpoint.
 */
export async function pingOwner(): Promise<{ ok: true }> {
  await requireOwner();
  return { ok: true };
}
