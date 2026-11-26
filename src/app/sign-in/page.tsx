import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth/verify-owner";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await getOwnerSession();
  if (session) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
      <div className="rounded-[var(--radius)] border bg-card p-6">
        <h1 className="text-lg font-semibold tracking-tight">Artha-Kosha</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A private ledger. Sign in with the owner Google account.
        </p>
        <div className="mt-6">
          <SignInForm />
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Any other Google account is refused by the server, not just hidden in the UI.
      </p>
    </main>
  );
}
