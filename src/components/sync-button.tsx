"use client";

import { useActionState } from "react";
import { syncNowAction } from "@/app/actions/sources";
import { Button } from "@/components/ui/button";
import { idleForm, type FormState } from "@/lib/form-state";

export function SyncNowButton() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(syncNowAction, idleForm);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={state.status === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
