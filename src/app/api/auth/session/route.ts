import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";
import { ownerEmail } from "@/lib/env";
import {
  getOwnerSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
} from "@/lib/auth/verify-owner";
import { sessionRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "private, no-store" } as const;

/** Current session, for the client to confirm it really is signed in. */
export async function GET() {
  const session = await getOwnerSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401, headers: noStore });
  }
  return Response.json({ ok: true, email: session.email }, { headers: noStore });
}

export async function POST(request: Request) {
  const parsed = sessionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400, headers: noStore });
  }

  let expected: string;
  try {
    expected = ownerEmail();
  } catch {
    return Response.json({ error: "server is not configured" }, { status: 500, headers: noStore });
  }

  try {
    // checkRevoked on the ID token: a disabled or revoked user cannot mint a session.
    const decoded = await adminAuth().verifyIdToken(parsed.data.idToken, true);

    if (decoded.email_verified !== true || decoded.email !== expected) {
      return Response.json({ error: "not the owner" }, { status: 403, headers: noStore });
    }
    if (decoded.owner !== true) {
      return Response.json(
        { error: "owner claim missing — run scripts/set-owner-claim.ts" },
        { status: 403, headers: noStore },
      );
    }

    const sessionCookie = await adminAuth().createSessionCookie(parsed.data.idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
    });

    return Response.json({ ok: true, redirect: "/dashboard" }, { headers: noStore });
  } catch (error) {
    console.error("[auth] session mint failed", error);
    return Response.json({ error: "sign-in refused" }, { status: 401, headers: noStore });
  }
}

/** Sign out: revoke refresh tokens, then clear the cookie. */
export async function DELETE() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE)?.value;

  if (cookie) {
    try {
      const decoded = await adminAuth().verifySessionCookie(cookie, false);
      await adminAuth().revokeRefreshTokens(decoded.uid);
    } catch {
      // Already invalid: clearing the cookie is the whole job.
    }
  }

  cookieStore.delete(SESSION_COOKIE);
  return Response.json({ ok: true }, { headers: noStore });
}
