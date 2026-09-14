import { openDB } from 'idb';

type PendingQueueAction =
  | {
      action: 'addTransaction';
      payload: {
        // matches /api/transactions POST body shape if/when UI wires it
        date: string;
        amount: number;
        currency: string;
        type: 'income' | 'expense' | 'transfer';
        source: 'manual';
        merchantName: string;
        category: string;
        subcategory?: string;
        paymentMethod?: string;
        notes?: string;
      };
      timestamp: number;
    };

const DB_NAME = 'artha-kosha-offline-db';
const DB_VERSION = 1;

const STORES = {
  pending: 'pendingQueue',
  txCache: 'txCache',
};

export async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORES.pending)) {
        db.createObjectStore(STORES.pending, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.txCache)) {
        // Cache last 100 transactions for offline viewing
        db.createObjectStore(STORES.txCache, { keyPath: 'id' });
      }
    },
  });
}

function createId() {
  return `q_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Pending operations queue
 */
export async function enqueuePendingAction(action: PendingQueueAction) {
  const db = await getDb();
  await db.put(STORES.pending, { id: createId(), ...action });
}

export async function getPendingActions() {
  const db = await getDb();
  const all = (await db.getAll(STORES.pending)) as Array<
    PendingQueueAction & { id: string }
  >;
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearPendingAction(id: string) {
  const db = await getDb();
  await db.delete(STORES.pending, id);
}

/**
 * Transaction cache (last 100 transactions)
 */
export type CachedTransaction = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  type: 'income' | 'expense' | 'transfer';
  merchantName: string;
  category: string;
  subcategory?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function cacheTransaction(tx: CachedTransaction) {
  const db = await getDb();
  await db.put(STORES.txCache, tx);

  // trim to last 100 by date (best-effort)
  const all = (await db.getAll(STORES.txCache)) as CachedTransaction[];
  if (all.length <= 100) return;

  const sorted = all
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 100);
  const keep = new Set(sorted.map((t) => t.id));
  const toRemove = all.filter((t) => !keep.has(t.id));
  await Promise.all(toRemove.map((t) => db.delete(STORES.txCache, t.id)));
}

export async function getCachedTransactions() {
  const db = await getDb();
  const all = (await db.getAll(STORES.txCache)) as CachedTransaction[];
  return all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
