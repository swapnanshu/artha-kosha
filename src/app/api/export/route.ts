import { collections } from "@/lib/firestore/collections";
import { requireOwner } from "@/lib/auth/verify-owner";
import { formatDateInIst, yearMonthInIst } from "@/lib/dates";
import { paiseToCsv } from "@/lib/money";
import { paymentModeLabel } from "@/lib/labels";
import { listTxnRange } from "@/lib/queries/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function param(url: URL, name: string): string {
  return (url.searchParams.get(name) ?? "").trim();
}

/** RFC 4180: quote everything, double the quotes inside. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    await requireOwner();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const month = /^\d{4}-\d{2}$/.test(param(url, "month")) ? param(url, "month") : yearMonthInIst(new Date());

  const [categories, accounts, rows] = await Promise.all([
    collections.categories().get(),
    collections.accounts().get(),
    listTxnRange(
      {
        month,
        categoryId: param(url, "categoryId") || null,
        accountId: param(url, "accountId") || null,
        paymentMode: param(url, "paymentMode") || null,
        q: param(url, "q") || null,
      },
      1000,
    ),
  ]);

  const categoryName = new Map(categories.docs.map((doc) => [doc.id, doc.data().name]));
  const accountName = new Map(accounts.docs.map((doc) => [doc.id, doc.data().name]));

  const header = [
    "Date",
    "Merchant",
    "Category",
    "Account",
    "Mode",
    "Direction",
    "Amount (INR)",
    "Notes",
    "Reference",
    "Split lines",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(formatDateInIst(row.occurredAt.toDate())),
        csvCell(row.merchantRaw ?? ""),
        csvCell(categoryName.get(row.categoryId ?? "") ?? (row.categoryId ?? "Uncategorised")),
        csvCell(accountName.get(row.accountId ?? "") ?? ""),
        csvCell(paymentModeLabel(row.paymentMode)),
        csvCell(row.direction),
        csvCell(paiseToCsv(row.amountPaise)),
        csvCell(row.notes ?? ""),
        csvCell(row.referenceId ?? ""),
        csvCell(
          row.splits
            ?.map((line) => `${categoryName.get(line.categoryId) ?? line.categoryId}:${paiseToCsv(line.amountPaise)}`)
            .join(" | ") ?? "",
        ),
      ].join(","),
    );
  }

  // The BOM keeps Excel from mangling the rupee symbols and Devanagari names.
  const body = "\uFEFF" + lines.join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="artha-kosha-${month}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
