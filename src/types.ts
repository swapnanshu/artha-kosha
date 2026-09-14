export interface UserSettings {
  currency: string;
  defaultView: string;
  notificationsEnabled: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  gmailRefreshTokens?: string[]; // encrypted
  gmailWatchExpirations?: string[]; // ISO strings or string representations
  connectedEmails?: string[]; // all connected Gmail account addresses
  gmailLastHistoryId?: Record<string, string>; // emailAddress -> historyId watermark
  smsWebhookSecret?: string;
  onboardingComplete?: boolean;
  settings?: UserSettings;
  createdAt: string; // ISO string
  updatedAt?: string;
}

export interface Account {
  id: string;
  name: string; // "ICICI Credit Card", "SBI Savings", etc.
  type: 'credit_card' | 'savings' | 'wallet';
  bank: 'RBL' | 'ICICI' | 'SBI' | 'Kotak' | 'IndusInd' | 'Axis' | 'Unknown';
  lastFourDigits: string;
  creditLimit?: number;
  currentBalance: number;
  lastSynced?: string; // ISO string
  isActive: boolean;
}

export interface EditHistoryEntry {
  field: string;
  oldValue: any;
  newValue: any;
  editedAt: string; // ISO string
}

export interface Transaction {
  id: string;
  date: string; // "YYYY-MM-DD"
  amount: number; // always positive
  currency: string; // "INR"
  type: 'income' | 'expense' | 'transfer';
  source: 'gmail' | 'sms' | 'manual' | 'pdf_statement';
  sourceEmailAccount?: string; // which email account
  accountRef?: string; // e.g. "accounts/accountId"
  merchantRef?: string; // e.g. "merchants/merchantId"
  merchantName: string; // denormalized
  category: string;
  subcategory?: string;
  paymentMethod?: 'UPI' | 'credit_card' | 'debit_card' | 'net_banking' | 'cash';
  notes?: string;
  confidenceScore: number; // 0-1
  isVerified: boolean;
  dedupHash: string; // SHA-256 hash
  rawSourceText?: string;
  editHistory?: EditHistoryEntry[];
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export interface Merchant {
  id: string;
  name: string; // canonical name: "Swiggy"
  aliases: string[]; // ["SWIGGY LTD", "SWIGGY INSTAMART"]
  defaultCategory: string;
  defaultSubcategory?: string;
  transactionCount: number;
  totalSpent: number;
  lastSeenAt: string; // ISO string
  createdAt: string; // ISO string
}

export interface Budget {
  id: string; // e.g., "2025-06"
  month: string; // "2025-06"
  categoryBudgets: Record<string, number>;
  totalBudget: number;
  createdAt: string; // ISO string
}

export interface Subscription {
  id: string;
  merchantRef?: string;
  merchantName: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'quarterly' | 'weekly';
  nextExpectedDate: string; // "YYYY-MM-DD"
  isActive: boolean;
  detectedFromTxIds: string[];
  createdAt: string; // ISO string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string; // ISO string
}

export interface ChatLog {
  id: string;
  messages: ChatMessage[];
  sessionDate: string; // "YYYY-MM-DD"
  createdAt: string; // ISO string
}

export interface ParsedTransaction {
  amount: number;
  merchantName: string;
  type: 'expense' | 'income';
  paymentMethod?: 'UPI' | 'credit_card' | 'debit_card' | 'net_banking' | 'cash';
  accountLastFour?: string;
  date?: string; // "YYYY-MM-DD"
  bank?: 'RBL' | 'ICICI' | 'SBI' | 'Kotak' | 'IndusInd' | 'Axis' | 'Unknown';
}
