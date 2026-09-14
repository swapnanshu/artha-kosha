import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getTransactionsCollection, getSubscriptionsCollection } from '@/src/lib/firestore';

function getDaysDiff(date1: string, date2: string): number {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  return Math.abs(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
}

function detectFrequency(daysDiff: number): 'monthly' | 'quarterly' | 'yearly' | 'weekly' | null {
  if (daysDiff >= 26 && daysDiff <= 35) return 'monthly';
  if (daysDiff >= 85 && daysDiff <= 96) return 'quarterly';
  if (daysDiff >= 355 && daysDiff <= 375) return 'yearly';
  if (daysDiff >= 6 && daysDiff <= 8) return 'weekly';
  return null;
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const FREQ_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 91,
  yearly: 365,
  weekly: 7,
};

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);

    // Fetch expense transactions ordered by date descending
    const txSnap = await getTransactionsCollection(uid)
      .where('type', '==', 'expense')
      .orderBy('date', 'desc')
      .limit(500)
      .get();

    const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // Group transactions by normalized merchant name
    const byMerchant: Record<string, any[]> = {};
    for (const tx of transactions) {
      const key = (tx.merchantName || '').toLowerCase().trim();
      if (!key) continue;
      if (!byMerchant[key]) byMerchant[key] = [];
      byMerchant[key].push(tx);
    }

    const subscriptionsCol = getSubscriptionsCollection(uid);
    let detected = 0;

    for (const [, txs] of Object.entries(byMerchant)) {
      if (txs.length < 2) continue; // Minimum 2 occurrences needed

      // Sort by date ascending
      const sorted = txs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      // Check consecutive pairs for recurring subscription pattern
      for (let i = 0; i < sorted.length - 1; i++) {
        const t1 = sorted[i];
        const t2 = sorted[i + 1];

        const daysDiff = getDaysDiff(t1.date, t2.date);
        const frequency = detectFrequency(daysDiff);
        if (!frequency) continue;

        // Check amount variance (within ±10%)
        const a1 = Number(t1.amount || 0);
        const a2 = Number(t2.amount || 0);
        if (a1 <= 0) continue;
        const amountDiff = Math.abs(a1 - a2) / a1;
        if (amountDiff > 0.10) continue;

        const avgAmount = (a1 + a2) / 2;
        const freqDays = FREQ_DAYS[frequency];
        const nextExpectedDate = addDays(t2.date, freqDays);

        // Check if subscription already registered
        const existingSub = await subscriptionsCol
          .where('merchantName', '==', t1.merchantName)
          .where('frequency', '==', frequency)
          .limit(1)
          .get();

        const nowIso = new Date().toISOString();

        if (existingSub.empty) {
          const newSubRef = subscriptionsCol.doc();
          await newSubRef.set({
            id: newSubRef.id,
            merchantName: t1.merchantName,
            amount: Math.round(avgAmount * 100) / 100,
            frequency,
            nextExpectedDate,
            isActive: true,
            detectedFromTxIds: [t1.id, t2.id],
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          detected++;
        } else {
          await existingSub.docs[0].ref.update({
            nextExpectedDate,
            amount: Math.round(avgAmount * 100) / 100,
            updatedAt: nowIso,
          });
        }
      }
    }

    return NextResponse.json({ success: true, detected });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Subscription detection error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
