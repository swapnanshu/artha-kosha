"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { createTxnAction, updateTxnAction } from "@/app/actions/txn";
import { Button } from "@/components/ui/button";
import { idleForm, type FormState } from "@/lib/form-state";
import { PAYMENT_MODES } from "@/lib/labels";
import { cn } from "@/lib/utils";

export interface CategoryOption {
  id: string;
  name: string;
  kind: string;
}

export interface AccountOption {
  id: string;
  name: string;
}

export interface TxnDefaults {
  id: string;
  amount: string;
  direction: "debit" | "credit";
  categoryId: string | null;
  accountId: string | null;
  occurredAtLocal: string;
  paymentMode: string;
  merchantRaw: string | null;
  last4: string | null;
  notes: string | null;
}

interface TxnFormProps {
  mode: "create" | "edit";
  categories: CategoryOption[];
  accounts: AccountOption[];
  nowLocal: string;
  defaults?: TxnDefaults;
}

const input =
  "mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";
const label = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

function CategorySelect({ categories, value }: { categories: CategoryOption[]; value: string | undefined }) {
  const groups = [
    { kind: "expense", label: "Expenses" },
    { kind: "investment", label: "Investments" },
    { kind: "income", label: "Income" },
    { kind: "transfer", label: "Transfers" },
  ];

  return (
    <select name="categoryId" defaultValue={value ?? ""} className={input}>
      <option value="">Uncategorised</option>
      {groups.map((group) => {
        const items = categories.filter((category) => category.kind === group.kind);
        if (items.length === 0) return null;
        return (
          <optgroup key={group.kind} label={group.label}>
            {items.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function TxnForm({ mode, categories, accounts, nowLocal, defaults }: TxnFormProps) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    mode === "create" ? createTxnAction : updateTxnAction,
    idleForm,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // Quick-add stays out of the way: after a save the form is empty and the
  // cursor is back in the amount box, ready for the next entry.
  useEffect(() => {
    if (mode !== "create" || state.status !== "ok") return;
    formRef.current?.reset();
    amountRef.current?.focus();
  }, [mode, state]);

  const defaultCategory = defaults?.categoryId ?? categories.find((c) => c.kind === "expense")?.id ?? "";
  const defaultAccount = defaults?.accountId ?? accounts[0]?.id ?? "";

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className={label}>
          Amount (₹)
          <input
            ref={amountRef}
            name="amount"
            defaultValue={defaults?.amount ?? ""}
            inputMode="decimal"
            autoComplete="off"
            required
            placeholder="0.00"
            className={cn(input, "h-12 text-lg font-semibold")}
          />
        </label>

        <fieldset className="flex gap-2">
          <legend className="sr-only">Direction</legend>
          {(["debit", "credit"] as const).map((direction) => (
            <label
              key={direction}
              className="flex h-12 cursor-pointer items-center gap-2 rounded-md border bg-background px-4 text-sm capitalize has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:font-medium"
            >
              <input
                type="radio"
                name="direction"
                value={direction}
                defaultChecked={(defaults?.direction ?? "debit") === direction}
                className="accent-[var(--primary)]"
              />
              {direction}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Category
          <CategorySelect categories={categories} value={defaultCategory} />
        </label>
        <label className={label}>
          Account
          <select name="accountId" defaultValue={defaultAccount} className={input}>
            <option value="">No account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="rounded-md border bg-background/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          More (date, mode, merchant, notes)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={label}>
            When (IST)
            <input
              type="datetime-local"
              name="occurredAt"
              defaultValue={defaults?.occurredAtLocal ?? nowLocal}
              className={input}
            />
          </label>
          <label className={label}>
            Mode
            <select name="paymentMode" defaultValue={defaults?.paymentMode ?? "upi"} className={input}>
              {PAYMENT_MODES.map((mode_) => (
                <option key={mode_.value} value={mode_.value}>
                  {mode_.label}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Merchant
            <input
              name="merchantRaw"
              defaultValue={defaults?.merchantRaw ?? ""}
              maxLength={200}
              placeholder="Swiggy"
              className={input}
            />
          </label>
          <label className={label}>
            Card / account last 4
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
          <label className={cn(label, "sm:col-span-2")}>
            Notes
            <input
              name="notes"
              defaultValue={defaults?.notes ?? ""}
              maxLength={500}
              placeholder="Optional"
              className={input}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="remember" className="accent-[var(--primary)]" />
            Always use this category for this merchant
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add transaction" : "Save changes"}
        </Button>
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        ) : null}
        {state.status === "ok" ? (
          <p className="text-sm text-primary">
            {state.message}
            {state.id ? (
              <>
                {" "}
                <Link href={`/ledger/${state.id}`} className="underline">
                  Open
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </form>
  );
}
