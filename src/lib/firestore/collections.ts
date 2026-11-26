import "server-only";
import type { CollectionReference, Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type {
  Account,
  AuditEntry,
  Category,
  DedupeKey,
  IngestRun,
  MerchantRule,
  MonthStats,
  RawAlert,
  Source,
  Txn,
} from "@/lib/types";

function col<T>(db: Firestore, path: string): CollectionReference<T> {
  return db.collection(path) as CollectionReference<T>;
}

export const collections = {
  users: () => col<Record<string, unknown>>(adminDb(), "users"),
  sources: () => col<Source>(adminDb(), "sources"),
  accounts: () => col<Account>(adminDb(), "accounts"),
  categories: () => col<Category>(adminDb(), "categories"),
  merchantRules: () => col<MerchantRule>(adminDb(), "merchantRules"),
  txn: () => col<Txn>(adminDb(), "txn"),
  rawAlerts: () => col<RawAlert>(adminDb(), "rawAlerts"),
  dedupeKeys: () => col<DedupeKey>(adminDb(), "dedupeKeys"),
  statsMonths: () => col<MonthStats>(adminDb(), "stats_months"),
  ingestRuns: () => col<IngestRun>(adminDb(), "ingestRuns"),
  audit: () => col<AuditEntry>(adminDb(), "audit"),
  idempotency: () => col<{ expiresAt: FirebaseFirestore.Timestamp }>(adminDb(), "idempotency"),
} as const;
