import type { Metadata } from "next";
import Link from "next/link";
import { listAccountsWithSpend } from "@/lib/queries/accounts";
import { AccountForm } from "@/components/account-form";
import { toggleAccountAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { formatPaise, paiseToInput } from "@/lib/money";
import { accountKindLabel } from "@/lib/labels";
import { yearMonthInIst } from "@/lib/dates";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const editingId = typeof params.edit === "string" ? params.edit : null;

  const accounts = await listAccountsWithSpend();
  const editing = editingId ? accounts.find((account) => account.id === editingId) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Cycle spend for {yearMonthInIst(new Date())}, IST. Credit cards use their own statement window; nothing else
          uses the calendar month.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-[var(--radius)] border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{account.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {accountKindLabel(account.kind)}
                  {account.institution ? ` · ${account.institution}` : ""}
                  {account.last4 ? ` · ••${account.last4}` : ""}
                </p>
              </div>
              <span
                className={
                  account.isActive
                    ? "rounded-full bg-accent px-2 py-0.5 text-[11px] text-primary"
                    : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                }
              >
                {account.isActive ? "active" : "inactive"}
              </span>
            </div>

            <p className="mt-3 text-lg font-semibold">{formatPaise(account.cycleSpendPaise)}</p>
            <p className="text-xs text-muted-foreground">{account.cycle}</p>

            {account.kind === "credit_card" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Statement day {account.statementDay ?? "—"} · due day {account.dueDay ?? "—"}
              </p>
            ) : null}

            <div className="mt-3 flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/accounts?edit=${account.id}`}>Edit</Link>
              </Button>
              <form action={toggleAccountAction}>
                <input type="hidden" name="id" value={account.id} />
                <input type="hidden" name="active" value={String(account.isActive)} />
                <Button type="submit" variant="ghost" size="sm">
                  {account.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-[var(--radius)] border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{editing ? `Edit ${editing.name}` : "Add an account"}</h2>
          {editing ? (
            <Link href="/accounts" className="text-xs text-muted-foreground underline">
              Cancel edit
            </Link>
          ) : null}
        </div>
        <AccountForm
          key={editing?.id ?? "new"}
          defaults={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  kind: editing.kind,
                  institution: editing.institution ?? "",
                  last4: editing.last4 ?? "",
                  creditLimit: editing.creditLimitPaise ? paiseToInput(editing.creditLimitPaise) : "",
                  statementDay: editing.statementDay ? String(editing.statementDay) : "",
                  dueDay: editing.dueDay ? String(editing.dueDay) : "",
                }
              : undefined
          }
        />
      </section>
    </div>
  );
}
