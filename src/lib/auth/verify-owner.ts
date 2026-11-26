import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";
import { ownerEmail } from "@/lib/env";

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export interface OwnerSession {
  uid: string;
  email: string;
}

/**
 * The one gate. Four independent conditions must all hold:
 *   1. the session cookie verifies (with revocation checked),
 *   2. the email is verified,
 *   3. it is the OWNER_EMAIL from the server env,
 *   4. the user carries the `owner === true` custom claim.
 *
 * Nothing else in the app is allowed to make this decision.
 */
export async function getOwnerSession(): Promise<OwnerSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  let expected: string;
  try {
    expected = ownerEmail();
  } catch (error) {
    console.error("[auth] refusing every session:", error);
    return null;
  }

  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    if (decoded.email_verified !== true) return null;
    if (decoded.email !== expected) return null;
    if (decoded.owner !== true) return null;
    return { uid: decoded.uid, email: decoded.email ?? expected };
  } catch {
    // Expired, revoked, tampered with, or minted by another project.
    return null;
  }
}

export class NotOwnerError extends Error {
  readonly status = 403;
  constructor() {
    super("Not the owner.");
    this.name = "NotOwnerError";
  }
}

/**
 * Call this FIRST inside every Server Action and every API handler. Layout
 * auth does not protect them: a Server Action is a public HTTP endpoint.
 */
export async function requireOwner(): Promise<OwnerSession> {
  const session = await getOwnerSession();
  if (!session) throw new NotOwnerError();
  return session;
}
