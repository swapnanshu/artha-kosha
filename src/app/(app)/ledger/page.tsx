import type { Metadata } from "next";
import Link from "next/link";
import { collections } from "@/lib/firestore/collections";
import { getMonthStats } from "@/lib/firestore/stats";
import { listTxns } from "@/lib/queries/ledger";
import { formatDateInIst, formatYearMonth, toDatetimeLocalIst, yearMonthInIst } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { paymentModeLabel } from "@/lib/labels";
import { TxnForm } from "@/components/txn-form";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

/** The last 12 IST months, plus whatever month is being viewed. */
function monthOptions(current: string): string[] {
  const options: string[] = [];
  const [year, month] = current.split("-").map(Number);
  const cursor = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1));
  for (let index = 0; index < 12; index += 1) {
    const shifted = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    options.push(`${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

export default async function LedgerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const monthParam = first(params.month);
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : yearMonthInIst(new Date());

  const values = {
    month,
    categoryId: first(params.categoryId),
    accountId: first(params.accountId),
    paymentMode: first(params.paymentMode),
    q: first(params.q),
  };
  const cursor = first(params.cursor) || null;

  const [categoriesSnap, accountsSnap, page, stats] = await Promise.all([
    collections.categories().orderBy("sortOrder", "asc").get(),
    collections.accounts().orderBy("name", "asc").get(),
    listTxns(
      {
        month: values.month,
        categoryId: values.categoryId || null,
        accountId: values.accountId || null,
        paymentMode: values.paymentMode || null,
        q: values.q || null,
      },
      cursor,
    ),
    getMonthStats(month),
  ]);

  const categories = categoriesSnap.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name,
    kind: doc.data().kind,
  }));
  const accounts = accountsSnap.docs
    .map((doc) => ({ id: doc.id, name: doc.data().name, isActive: doc.data().isActive }))
    .filter((account) => account.isActive);

  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));

  const exportQuery = new URLSearchParams({ month: values.month });
  if (values.categoryId) exportQuery.set("categoryId", values.categoryId);
  if (values.accountId) exportQuery.set("accountId", values.accountId);
  if (values.paymentMode) exportQuery.set("paymentMode", values.paymentMode);
  if (values.q) exportQuery.set("q", values.q);

  const nextQuery = new URLSearchParams({ ...values, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ledger</h1>
          <p className="text-sm text-muted-foreground">
            {formatYearMonth(month)} · {stats.txnCount} transactions · in {formatPaise(stats.inflowPaise)} · out{" "}
            {formatPaise(stats.outflowLivingPaise + stats.outflowInvestmentPaise)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/export?${exportQuery.toString()}`}
            className="inline-flex h-9 items-center rounded-md border bg-card px-4 text-sm hover:bg-muted"
          >
            Export CSV
          </a>
        </div>
      </div>

      <section className="rounded-[var(--radius)] border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Quick add</h2>
        <TxnForm
          mode="create"
          categories={categories}
          accounts={accounts}
          nowLocal={toDatetimeLocalIst(new Date())}
        />
      </section>

      <section className="space-y-3">
        <FilterBar
          values={values}
          months={monthOptions(month)}
          categories={categories}
          accounts={accounts}
        />
        {page.ignored.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {page.ignored.join(" and ")} ignored: this index set combines month with account and category only. Clear
            one to use it.
          </p>
        ) : null}
      </section>

      <div className="overflow-x-auto rounded-[var(--radius)] border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Merchant</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Mode</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  Nothing in {formatYearMonth(month)} for these filters.
                </td>
              </tr>
            ) : null}
            {page.rows.map((row) => {
              const label = categoryName.get(row.categoryId ?? "") ?? "Uncategorised";
              return (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {formatDateInIst(row.occurredAt.toDate())}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/ledger/${row.id}`} className="font-medium hover:underline">
                      {row.merchantRaw ?? "—"}
                    </Link>
                    {row.splits && row.splits.length > 0 ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        split {row.splits.length}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">{label}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {accountName.get(row.accountId ?? "") ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{paymentModeLabel(row.paymentMode)}</td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 text-right font-medium",
                      row.direction === "credit" ? "text-primary" : "text-foreground",
                    )}
                  >
                    {row.direction === "credit" ? "+" : "−"}
                    {formatPaise(row.amountPaise)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">50 rows per page.</p>
        {page.nextCursor ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/ledger?${nextQuery.toString()}`}>Next 50 →</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
