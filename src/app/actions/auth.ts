"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/lib/auth/verify-owner";

export async function signOutAction() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE)?.value;

  if (cookie) {
    try {
      const decoded = await adminAuth().verifySessionCookie(cookie, false);
      await adminAuth().revokeRefreshTokens(decoded.uid);
    } catch {
      // Nothing to revoke.
    }
  }

  cookieStore.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
