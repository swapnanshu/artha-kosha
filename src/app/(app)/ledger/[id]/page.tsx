import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { collections } from "@/lib/firestore/collections";
import { getTxn } from "@/lib/firestore/txnWrite";
import { deleteTxnAction } from "@/app/actions/txn";
import { TxnForm } from "@/components/txn-form";
import { SplitEditor } from "@/components/split-editor";
import { Button } from "@/components/ui/button";
import { formatDateInIst, toDatetimeLocalIst } from "@/lib/dates";
import { formatPaise, paiseToInput } from "@/lib/money";
import { paymentModeLabel } from "@/lib/labels";

export const metadata: Metadata = { title: "Transaction" };
export const dynamic = "force-dynamic";

export default async function TxnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [txn, categoriesSnap, accountsSnap] = await Promise.all([
    getTxn(id),
    collections.categories().orderBy("sortOrder", "asc").get(),
    collections.accounts().orderBy("name", "asc").get(),
  ]);

  if (!txn) notFound();

  const categories = categoriesSnap.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name,
    kind: doc.data().kind,
  }));
  const accounts = accountsSnap.docs
    .map((doc) => ({ id: doc.id, name: doc.data().name, isActive: doc.data().isActive }))
    .filter((account) => account.isActive);

  const initialSplits =
    txn.splits?.map((line) => ({
      amount: paiseToInput(line.amountPaise),
      categoryId: line.categoryId,
      notes: line.notes ?? "",
    })) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/ledger" className="text-sm text-muted-foreground underline">
            ← Ledger
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {txn.merchantRaw ?? "Transaction"} · {formatPaise(txn.amountPaise)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateInIst(txn.occurredAt.toDate())} · {paymentModeLabel(txn.paymentMode)} ·{" "}
            {txn.direction === "credit" ? "credit" : "debit"}
            {txn.isInternalTransfer ? " · internal transfer" : ""}
            {txn.isInvestment ? " · investment" : ""}
          </p>
        </div>
        {txn.deletedAt ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">deleted</span>
        ) : null}
      </div>

      <section className="rounded-[var(--radius)] border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Edit</h2>
        <TxnForm
          mode="edit"
          categories={categories}
          accounts={accounts}
          nowLocal={toDatetimeLocalIst(txn.occurredAt.toDate())}
          defaults={{
            id: txn.id,
            amount: paiseToInput(txn.amountPaise),
            direction: txn.direction,
            categoryId: txn.categoryId,
            accountId: txn.accountId,
            occurredAtLocal: toDatetimeLocalIst(txn.occurredAt.toDate()),
            paymentMode: txn.paymentMode,
            merchantRaw: txn.merchantRaw,
            last4: txn.last4,
            notes: txn.notes,
          }}
        />
      </section>

      <section className="rounded-[var(--radius)] border bg-card p-4">
        <h2 className="text-sm font-medium">Split across categories</h2>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          Lines must add up to exactly {formatPaise(txn.amountPaise)}. The category totals follow the split; the
          transaction still counts once.
        </p>
        <SplitEditor
          id={txn.id}
          amount={paiseToInput(txn.amountPaise)}
          categories={categories}
          initial={initialSplits}
        />
      </section>

      <section className="rounded-[var(--radius)] border bg-card p-4">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-danger">Delete this transaction</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Soft delete: the row is hidden and this month&apos;s totals are corrected. The document and its audit
            entry stay in Firestore.
          </p>
          <form action={deleteTxnAction} className="mt-3">
            <input type="hidden" name="id" value={txn.id} />
            <Button type="submit" variant="outline" size="sm" className="text-danger">
              Delete
            </Button>
          </form>
        </details>
      </section>

      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="uppercase tracking-wide">Source</dt>
          <dd>manual entry · category source {txn.categorySource}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide">Links</dt>
          <dd>
            {txn.alertCount > 0 ? `${txn.alertCount} alert(s)` : "no linked alerts"} · reference{" "}
            {txn.referenceId ?? "none"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
