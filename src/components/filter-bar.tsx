import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PAYMENT_MODES } from "@/lib/labels";
import { formatYearMonth } from "@/lib/dates";

export interface FilterValues {
  month: string;
  categoryId: string;
  accountId: string;
  paymentMode: string;
  q: string;
}

const select =
  "h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";
const label = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

export function FilterBar({
  values,
  months,
  categories,
  accounts,
}: {
  values: FilterValues;
  months: string[];
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
}) {
  return (
    <form method="get" action="/ledger" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      <label className={label}>
        Month
        <select name="month" defaultValue={values.month} className={select}>
          {months.map((month) => (
            <option key={month} value={month}>
              {formatYearMonth(month)}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Category
        <select name="categoryId" defaultValue={values.categoryId} className={select}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Account
        <select name="accountId" defaultValue={values.accountId} className={select}>
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Mode
        <select name="paymentMode" defaultValue={values.paymentMode} className={select}>
          <option value="">All modes</option>
          {PAYMENT_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Merchant
        <input
          name="q"
          defaultValue={values.q}
          placeholder="swiggy"
          className={select}
          autoComplete="off"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" className="w-full">
          Filter
        </Button>
        <Link href="/ledger" className="whitespace-nowrap px-2 text-sm text-muted-foreground underline">
          Clear
        </Link>
      </div>
    </form>
  );
}
