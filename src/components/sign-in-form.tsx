"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string };

export function SignInForm() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSignIn() {
    setState({ kind: "busy" });
    try {
      const auth = clientAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const result = await signInWithPopup(auth, provider);
      const ownerEmail = process.env.NEXT_PUBLIC_OWNER_EMAIL;
      if (ownerEmail && result.user.email !== ownerEmail) {
        await signOut(auth);
        setState({ kind: "error", message: "That Google account is not the owner of this ledger." });
        return;
      }

      const idToken = await result.user.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        await signOut(auth);
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: "error", message: payload?.error ?? "Sign-in was refused." });
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      console.error(error);
      setState({ kind: "error", message: "Sign-in failed. Check the console and try again." });
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={handleSignIn} disabled={state.kind === "busy"} className="w-full">
        {state.kind === "busy" ? "Signing in…" : "Continue with Google"}
      </Button>
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
