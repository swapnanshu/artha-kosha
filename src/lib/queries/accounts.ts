import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "@/lib/firestore/collections";
import { currentCardCycle, yearMonthInIst } from "@/lib/dates";
import type { Account } from "@/lib/types";

export interface AccountWithSpend extends Account {
  id: string;
  cycle: string;
  cycleSpendPaise: number;
}

async function spendThisCycle(account: Account & { id: string }): Promise<{ cycle: string; paise: number }> {
  const now = new Date();
  const month = yearMonthInIst(now);

  // A statement cycle spans two calendar months, so it ranges over
  // `occurredAt`, and a range plus an equality on another field needs its own
  // composite index. One card's month is a few hundred rows: range by date and
  // match the account here instead, which needs no index at all.
  const snapshot =
    account.kind === "credit_card" && account.statementDay
      ? await (() => {
          const window = currentCardCycle(account.statementDay, now);
          return collections
            .txn()
            .where("occurredAt", ">=", Timestamp.fromDate(window.start))
            .where("occurredAt", "<", Timestamp.fromDate(window.end))
            .limit(2000)
            .get();
        })()
      : await collections.txn().where("yearMonth", "==", month).where("accountId", "==", account.id).get();

  let paise = 0;
  for (const doc of snapshot.docs) {
    const txn = doc.data();
    if (txn.accountId !== account.id) continue;
    if (txn.deletedAt || txn.isInternalTransfer) continue;
    if (txn.direction !== "debit") continue;
    paise += txn.amountPaise;
  }

  const cycle =
    account.kind === "credit_card" && account.statementDay
      ? (() => {
          const window = currentCardCycle(account.statementDay, now);
          const fmt = new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
          });
          const end = new Date(window.end.getTime() - 24 * 60 * 60 * 1000);
          return `Cycle ${fmt.format(window.start)} – ${fmt.format(end)}`;
        })()
      : "This month";

  return { cycle, paise };
}

export async function listAccountsWithSpend(): Promise<AccountWithSpend[]> {
  const snapshot = await collections.accounts().orderBy("name", "asc").get();
  const accounts = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));

  const spend = await Promise.all(accounts.map((account) => spendThisCycle(account)));

  return accounts.map((account, index) => {
    const cycle = spend[index];
    return {
      ...account,
      cycle: cycle?.cycle ?? "This month",
      cycleSpendPaise: cycle?.paise ?? 0,
    };
  });
}
