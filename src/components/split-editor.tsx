"use client";

import { useActionState, useState } from "react";
import { saveSplitsAction } from "@/app/actions/txn";
import { Button } from "@/components/ui/button";
import { idleForm, type FormState } from "@/lib/form-state";
import type { CategoryOption } from "@/components/txn-form";

interface Row {
  amount: string;
  categoryId: string;
  notes: string;
}

const input =
  "h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

export function SplitEditor({
  id,
  amount,
  categories,
  initial,
}: {
  id: string;
  amount: string;
  categories: CategoryOption[];
  initial: Row[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveSplitsAction, idleForm);
  const [rows, setRows] = useState<Row[]>(
    initial.length >= 2
      ? initial
      : [
          { amount, categoryId: "", notes: "" },
          { amount: "", categoryId: "", notes: "" },
        ],
  );

  const total = rows.reduce((sum, row) => {
    const value = Number(row.amount.replace(/[₹,\s]/g, ""));
    return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0);
  }, 0);
  const target = Math.round(Number(amount.replace(/[₹,\s]/g, "")) * 100);
  const difference = target - total;

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            type="hidden"
            name={`line-slot-${index}`}
            value={index}
          />
          <input
            name={`line-amount-${index}`}
            value={row.amount}
            onChange={(event) => update(index, { amount: event.target.value })}
            inputMode="decimal"
            placeholder="Amount"
            className={input}
          />
          <select
            name={`line-category-${index}`}
            value={row.categoryId}
            onChange={(event) => update(index, { categoryId: event.target.value })}
            className={input}
          >
            <option value="">Category…</option>
            {categories
              .filter((category) => category.kind !== "transfer")
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
          <input
            name={`line-notes-${index}`}
            value={row.notes}
            onChange={(event) => update(index, { notes: event.target.value })}
            placeholder="Note (optional)"
            className={input}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            disabled={rows.length <= 2}
          >
            Remove
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((current) => [...current, { amount: "", categoryId: "", notes: "" }])}
          disabled={rows.length >= 12}
        >
          Add line
        </Button>
        <span className={difference === 0 ? "text-primary" : "text-muted-foreground"}>
          {difference === 0
            ? "Split adds up exactly."
            : `₹${(Math.abs(difference) / 100).toFixed(2)} ${difference > 0 ? "left" : "over"}`}
        </span>
        <Button type="submit" size="sm" disabled={pending || difference !== 0}>
          {pending ? "Saving…" : "Save split"}
        </Button>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      {state.status === "ok" ? <p className="text-sm text-primary">{state.message}</p> : null}
    </form>
  );
}
