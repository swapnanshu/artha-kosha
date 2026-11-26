import type { Metadata } from "next";
import Link from "next/link";
import { collections } from "@/lib/firestore/collections";
import { getMonthStats } from "@/lib/firestore/stats";
import { listAccountsWithSpend } from "@/lib/queries/accounts";
import { recalcMonthAction } from "@/app/actions/txn";
import { Button } from "@/components/ui/button";
import { formatDateInIst, formatYearMonth, yearMonthInIst } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { paymentModeLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function previousMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const safeYear = year ?? 2026;
  const safeMonth = month ?? 1;
  return safeMonth === 1
    ? `${safeYear - 1}-12`
    : `${safeYear}-${String(safeMonth - 1).padStart(2, "0")}`;
}

function change(now: number, before: number): string {
  if (before === 0) return now === 0 ? "no change" : "new";
  const percent = Math.round(((now - before) / before) * 100);
  return `${percent > 0 ? "+" : ""}${percent}% vs last month`;
}

export default async function DashboardPage() {
  const month = yearMonthInIst(new Date());
  const previous = previousMonth(month);

  const [stats, prev, recentSnap, categoriesSnap, accounts] = await Promise.all([
    getMonthStats(month),
    getMonthStats(previous),
    collections.txn().where("yearMonth", "==", month).orderBy("occurredAt", "desc").limit(6).get(),
    collections.categories().orderBy("sortOrder", "asc").get(),
    listAccountsWithSpend(),
  ]);

  const categoryName = new Map(categoriesSnap.docs.map((doc) => [doc.id, doc.data().name]));
  const recent = recentSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));

  const outflow = stats.outflowLivingPaise + stats.outflowInvestmentPaise;
  const surplus = stats.inflowPaise - outflow;

  const cards = [
    { label: "Inflow", paise: stats.inflowPaise, note: change(stats.inflowPaise, prev.inflowPaise) },
    {
      label: "Living outflow",
      paise: stats.outflowLivingPaise,
      note: change(stats.outflowLivingPaise, prev.outflowLivingPaise),
    },
    {
      label: "Investments",
      paise: stats.outflowInvestmentPaise,
      note: change(stats.outflowInvestmentPaise, prev.outflowInvestmentPaise),
    },
    {
      label: "Net surplus",
      paise: surplus,
      note: surplus >= 0 ? "money kept" : "spent from savings",
    },
  ];

  const categoryRows = Object.entries(stats.byCategory)
    .filter(([, paise]) => paise > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxCategory = categoryRows[0]?.[1] ?? 0;

  const modeRows = Object.entries(stats.byMode)
    .filter(([, paise]) => paise > 0)
    .sort((a, b) => b[1] - a[1]);

  const cardAccounts = accounts.filter((account) => account.kind === "credit_card" && account.isActive);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{formatYearMonth(month)}</h1>
          <p className="text-sm text-muted-foreground">
            {stats.txnCount} transactions · computed in Asia/Kolkata · manual entries only so far
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/ledger">Quick add</Link>
          </Button>
          <form action={recalcMonthAction}>
            <input type="hidden" name="month" value={month} />
            <Button type="submit" variant="outline" size="sm">
              Recalculate
            </Button>
          </form>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-[var(--radius)] border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className={cn("mt-2 text-2xl font-semibold", card.paise < 0 ? "text-danger" : "")}>
              {formatPaise(card.paise)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-[var(--radius)] border bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Spend by category</h2>
            <Link href="/ledger" className="text-xs text-muted-foreground underline">
              Ledger
            </Link>
          </div>
          {categoryRows.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No spend recorded this month yet.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {categoryRows.map(([id, paise]) => (
                <li key={id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{categoryName.get(id) ?? "Uncategorised"}</span>
                    <span className="font-medium">{formatPaise(paise)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${maxCategory > 0 ? Math.round((paise / maxCategory) * 100) : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius)] border bg-card p-4">
          <h2 className="text-sm font-medium">By mode</h2>
          {modeRows.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {modeRows.map(([mode, paise]) => (
                <li key={mode} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{paymentModeLabel(mode)}</span>
                  <span className="font-medium">{formatPaise(paise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-[var(--radius)] border bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Latest transactions</h2>
            <Link href="/ledger" className="text-xs text-muted-foreground underline">
              All
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              Nothing yet — add your first entry from the ledger.
            </p>
          ) : (
            <ul className="mt-3 divide-y">
              {recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/ledger/${row.id}`} className="block truncate font-medium hover:underline">
                      {row.merchantRaw ?? categoryName.get(row.categoryId ?? "") ?? "Uncategorised"}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {formatDateInIst(row.occurredAt.toDate())} · {paymentModeLabel(row.paymentMode)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "whitespace-nowrap font-medium",
                      row.direction === "credit" ? "text-primary" : "",
                    )}
                  >
                    {row.direction === "credit" ? "+" : "−"}
                    {formatPaise(row.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <div className="rounded-[var(--radius)] border bg-card p-4">
            <h2 className="text-sm font-medium">Cards</h2>
            {cardAccounts.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No credit cards yet. <Link href="/accounts" className="underline">Add one</Link>.
              </p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {cardAccounts.map((account) => (
                  <li key={account.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span>{account.name}</span>
                      <span className="font-medium">{formatPaise(account.cycleSpendPaise)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {account.cycle} · due day {account.dueDay ?? "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[var(--radius)] border bg-card p-4">
            <h2 className="text-sm font-medium">Sources</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {["Gmail #1", "Gmail #2", "SMS"].map((source) => (
                <li key={source} className="flex items-center justify-between gap-2">
                  <span>{source}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    not connected
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
