import { adminDb } from './firebase-admin';
import { 
  UserProfile, 
  Transaction, 
  Merchant, 
  Budget, 
  Subscription, 
  Account, 
  ChatLog 
} from '../types';

// Helper to get typed collections
export const getUserDoc = (uid: string) => adminDb.collection('users').doc(uid);

export const getTransactionsCollection = (uid: string) => 
  getUserDoc(uid).collection('transactions');

export const getMerchantsCollection = (uid: string) => 
  getUserDoc(uid).collection('merchants');

export const getBudgetsCollection = (uid: string) => 
  getUserDoc(uid).collection('budgets');

export const getSubscriptionsCollection = (uid: string) => 
  getUserDoc(uid).collection('subscriptions');

export const getAccountsCollection = (uid: string) => 
  getUserDoc(uid).collection('accounts');

export const getChatLogsCollection = (uid: string) => 
  getUserDoc(uid).collection('chatLogs');

// Data fetching helpers
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const doc = await getUserDoc(uid).get();
  if (!doc.exists) return null;
  return { uid, ...doc.data() } as UserProfile;
}

export async function getTransactions(
  uid: string, 
  options?: { limit?: number; orderByField?: string; orderDirection?: 'asc' | 'desc' }
): Promise<Transaction[]> {
  let query: any = getTransactionsCollection(uid);
  
  const field = options?.orderByField || 'date';
  const direction = options?.orderDirection || 'desc';
  query = query.orderBy(field, direction);
  
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  
  const snapshot = await query.get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Transaction));
}

export async function getAccounts(uid: string): Promise<Account[]> {
  const snapshot = await getAccountsCollection(uid).get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Account));
}

export async function getMerchants(uid: string): Promise<Merchant[]> {
  const snapshot = await getMerchantsCollection(uid).get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Merchant));
}

export async function getBudgets(uid: string): Promise<Budget[]> {
  const snapshot = await getBudgetsCollection(uid).get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Budget));
}

export async function getSubscriptions(uid: string): Promise<Subscription[]> {
  const snapshot = await getSubscriptionsCollection(uid).get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Subscription));
}
