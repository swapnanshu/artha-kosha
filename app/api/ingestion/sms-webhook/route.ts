import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsCollection, getMerchantsCollection, getUserDoc } from '@/src/lib/firestore';
import { parseTransactionFromText } from '@/src/lib/bank-parsers';
import { generateDedupHash } from '@/src/lib/dedup';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const geminiSchema = {
  type: "object",
  properties: {
    merchantName: { type: "string" },
    amount: { type: "number" },
    type: { type: "string", enum: ["expense", "income", "transfer"] },
    category: { type: "string" },
    date: { type: "string", description: "YYYY-MM-DD" },
    paymentMethod: { type: "string", enum: ["UPI", "credit_card", "debit_card", "net_banking", "cash"] }
  },
  required: ["merchantName", "amount", "type", "category", "date"]
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sender, body: smsBody, timestamp, authToken, uid } = body;

    // 1. Verify User UID and Authentication Token
    if (!uid || typeof uid !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid User UID' }, { status: 400 });
    }

    if (!authToken || typeof authToken !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid authentication token' }, { status: 401 });
    }

    const userRef = getUserDoc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const userData = userSnap.data() as any;
    const storedSecret = userData?.smsWebhookSecret;
    const globalSecret = process.env.SMS_WEBHOOK_SECRET;

    const isValidSecret = (storedSecret && authToken === storedSecret) || (globalSecret && authToken === globalSecret);
    if (!isValidSecret) {
      return NextResponse.json({ error: 'Unauthorized: Invalid webhook secret' }, { status: 401 });
    }

    // 2. Parse SMS content
    let amount = 0;
    let merchantName = "Unknown Merchant";
    let type: 'expense' | 'income' = 'expense';
    let paymentMethod = 'UPI';
    let date = new Date(timestamp || Date.now()).toISOString().split('T')[0];
    let confidenceScore = 1.0;
    let bankName = 'Unknown';

    const regexParsed = parseTransactionFromText(smsBody);
    if (regexParsed) {
      amount = regexParsed.amount;
      merchantName = regexParsed.merchantName;
      type = regexParsed.type;
      paymentMethod = regexParsed.paymentMethod || 'UPI';
      bankName = regexParsed.bank || 'Unknown';
      if (regexParsed.date) {
        date = regexParsed.date;
      }
    } else {
      // Fallback to Gemini
      const prompt = `Extract transaction details from this SMS text: "${smsBody}". Assume transaction date is ${date} if not specified. Output appropriate category.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: geminiSchema
        }
      });

      const parsedText = response.text;
      if (!parsedText) {
        return NextResponse.json({ error: 'Failed to extract transaction using AI' }, { status: 500 });
      }

      const aiData = JSON.parse(parsedText);
      amount = aiData.amount;
      merchantName = aiData.merchantName;
      type = aiData.type;
      paymentMethod = aiData.paymentMethod || 'UPI';
      date = aiData.date;
      confidenceScore = 0.85;
    }

    // 3. Deduplication Check
    const dedupHash = generateDedupHash(date, amount, merchantName);
    const txCol = getTransactionsCollection(uid);
    const existingTx = await txCol.where('dedupHash', '==', dedupHash).limit(1).get();

    if (!existingTx.empty) {
      // Log duplicate event (audit trail)
      await userRef.collection('dedupLog').add({
        smsBody,
        dedupHash,
        timestamp: new Date().toISOString(),
        reason: 'Duplicate SMS transaction ignored'
      });
      return NextResponse.json({ success: true, skipped: true, reason: 'duplicate' });
    }

    // 4. Get or Create Merchant
    const merchantsCol = getMerchantsCollection(uid);
    let merchantId = "";
    const merchantQuery = await merchantsCol.where('name', '==', merchantName).limit(1).get();
    const nowIso = new Date().toISOString();

    let category = regexParsed ? 'Other' : 'Other'; // default category
    if (regexParsed) {
      // basic fallback category mapping
      if (/swiggy|zomato/i.test(merchantName)) category = 'Food';
      else if (/amazon|flipkart/i.test(merchantName)) category = 'Shopping';
    }

    if (!merchantQuery.empty) {
      const doc = merchantQuery.docs[0];
      merchantId = doc.id;
      const mData = doc.data();
      category = mData.defaultCategory || category;
      await doc.ref.update({
        transactionCount: (mData.transactionCount || 0) + 1,
        totalSpent: (mData.totalSpent || 0) + amount,
        lastSeenAt: nowIso
      });
    } else {
      const newMerchantRef = merchantsCol.doc();
      merchantId = newMerchantRef.id;
      await newMerchantRef.set({
        id: merchantId,
        name: merchantName,
        aliases: [merchantName.toUpperCase()],
        defaultCategory: category,
        transactionCount: 1,
        totalSpent: amount,
        lastSeenAt: nowIso,
        createdAt: nowIso
      });
    }

    // 5. Save Transaction to Firestore
    const newTxRef = txCol.doc();
    const newTx = {
      id: newTxRef.id,
      date,
      amount,
      currency: 'INR',
      type,
      source: 'sms',
      merchantRef: `merchants/${merchantId}`,
      merchantName,
      category,
      paymentMethod,
      confidenceScore,
      isVerified: false,
      dedupHash,
      rawSourceText: smsBody,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await newTxRef.set(newTx);

    return NextResponse.json({ success: true, transaction: newTx });
  } catch (error) {
    console.error('SMS Webhook Ingestion Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
