"use client";

import { useActionState } from "react";
import { saveAccountAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { idleForm, type FormState } from "@/lib/form-state";
import { ACCOUNT_KINDS } from "@/lib/labels";

export interface AccountDefaults {
  id: string;
  name: string;
  kind: string;
  institution: string;
  last4: string;
  creditLimit: string;
  statementDay: string;
  dueDay: string;
}

const input =
  "mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";
const label = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

export function AccountForm({ defaults }: { defaults?: AccountDefaults }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveAccountAction, idleForm);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <label className={label}>
        Name
        <input name="name" required defaultValue={defaults?.name ?? ""} placeholder="HDFC Savings" className={input} />
      </label>
      <label className={label}>
        Kind
        <select name="kind" defaultValue={defaults?.kind ?? "bank"} className={input}>
          {ACCOUNT_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Institution
        <input name="institution" defaultValue={defaults?.institution ?? ""} placeholder="HDFC" className={input} />
      </label>
      <label className={label}>
        Last 4
        <input
          name="last4"
          defaultValue={defaults?.last4 ?? ""}
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="1234"
          className={input}
        />
      </label>
      <label className={label}>
        Credit limit (₹, cards only)
        <input
          name="creditLimit"
          defaultValue={defaults?.creditLimit ?? ""}
          inputMode="decimal"
          placeholder="50000"
          className={input}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Statement day
          <input
            name="statementDay"
            type="number"
            min={1}
            max={31}
            defaultValue={defaults?.statementDay ?? ""}
            placeholder="20"
            className={input}
          />
        </label>
        <label className={label}>
          Due day
          <input
            name="dueDay"
            type="number"
            min={1}
            max={31}
            defaultValue={defaults?.dueDay ?? ""}
            placeholder="5"
            className={input}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : defaults ? "Save changes" : "Add account"}
        </Button>
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        ) : null}
        {state.status === "ok" ? <p className="text-sm text-primary">{state.message}</p> : null}
      </div>
    </form>
  );
}
