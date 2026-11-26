/**
 * Seeds the system categories and the starter accounts.
 * Idempotent: categories use fixed slugs as ids and accounts fixed ids, so a
 * second run overwrites rather than duplicating.
 *
 *   bun run seed          # Firebase Emulator Suite (needs a JDK)
 *   bun run seed:remote   # the real project in .env.local
 */
const remote = process.argv.includes("--remote");

if (!remote) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}

import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** The emulator needs only a project id; the real project needs the key. */
function initApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "artha-kosha-dev";
  if (!remote) return initializeApp({ projectId });

  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is empty, so --remote cannot authenticate. Fill it in .env.local first.",
    );
  }
  const sa = JSON.parse(
    raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"),
  ) as ServiceAccount;
  return initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
    projectId: sa.project_id,
  });
}

const app = initApp();
const db = getFirestore(app);

const categories = [
  { slug: "groceries", name: "Groceries", kind: "expense", color: "#16a34a", sortOrder: 1 },
  { slug: "dining", name: "Dining & Food Delivery", kind: "expense", color: "#f97316", sortOrder: 2 },
  { slug: "fuel", name: "Fuel & Commute", kind: "expense", color: "#0ea5e9", sortOrder: 3 },
  { slug: "utilities", name: "Utilities & Bills", kind: "expense", color: "#6366f1", sortOrder: 4 },
  { slug: "shopping", name: "Shopping", kind: "expense", color: "#ec4899", sortOrder: 5 },
  { slug: "travel", name: "Travel", kind: "expense", color: "#14b8a6", sortOrder: 6 },
  { slug: "rent", name: "Rent & Housing", kind: "expense", color: "#a855f7", sortOrder: 7 },
  { slug: "healthcare", name: "Healthcare", kind: "expense", color: "#ef4444", sortOrder: 8 },
  { slug: "emis", name: "EMIs", kind: "expense", color: "#78716c", sortOrder: 9 },
  { slug: "salary", name: "Salary/Income", kind: "income", color: "#059669", sortOrder: 10 },
  { slug: "cashback", name: "Cashback/Refunds", kind: "income", color: "#84cc16", sortOrder: 11 },
  { slug: "investments", name: "Investments", kind: "investment", color: "#0f766e", sortOrder: 12 },
  // `kind: "transfer"` is what keeps own-account moves and card-bill payments
  // out of inflow/outflow: the money never left the owner.
  { slug: "self-transfer", name: "Own Account Transfer", kind: "transfer", color: "#94a3b8", sortOrder: 13 },
  { slug: "card-bill", name: "Credit Card Bill Payment", kind: "transfer", color: "#64748b", sortOrder: 14 },
] as const;

const accounts = [
  {
    id: "hdfc-savings",
    name: "HDFC Savings",
    kind: "bank",
    institution: "HDFC Bank",
    last4: "4321",
    creditLimitPaise: null,
    statementDay: null,
    dueDay: null,
  },
  {
    id: "icici-credit-card",
    name: "ICICI Credit Card",
    kind: "credit_card",
    institution: "ICICI Bank",
    last4: "8812",
    creditLimitPaise: 20_00_000_00,
    statementDay: 12,
    dueDay: 2,
  },
  {
    id: "cash",
    name: "Cash",
    kind: "cash",
    institution: null,
    last4: null,
    creditLimitPaise: null,
    statementDay: null,
    dueDay: null,
  },
] as const;

async function main() {
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const category of categories) {
    batch.set(
      db.collection("categories").doc(category.slug),
      { ...category, isSystem: true },
      { merge: true },
    );
  }

  for (const { id, ...account } of accounts) {
    batch.set(
      db.collection("accounts").doc(id),
      { ...account, isActive: true, createdAt: now, updatedAt: now },
      { merge: true },
    );
  }

  await batch.commit();
  console.log(
    `Seeded ${categories.length} categories and ${accounts.length} accounts into ${remote ? `the real project (${process.env.FIREBASE_PROJECT_ID})` : "the emulator"}.`,
  );
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
