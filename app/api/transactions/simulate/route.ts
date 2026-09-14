import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getMerchantsCollection, getTransactionsCollection } from '@/src/lib/firestore';
import { categorizeTransaction } from '@/src/lib/categorization';
import { generateDedupHash } from '@/src/lib/dedup';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const schema = {
  type: "object",
  properties: {
    merchantName: { type: "string" },
    amount: { type: "number" },
    type: { type: "string", enum: ["expense", "income", "transfer"] },
    category: { type: "string", description: "e.g. Food, Groceries, Shopping, Transport, Utilities" },
    date: { type: "string", description: "YYYY-MM-DD" }
  },
  required: ["merchantName", "amount", "type", "category", "date"]
};

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();
    const { message } = body;
    const nowIso = new Date().toISOString();


    // Use Gemini to parse SMS/Email
    const prompt = `Extract transaction details from this message: "${message}". Assume today's date is ${new Date().toISOString().split('T')[0]} if not specified. Categorize it appropriately.`;
    
    // Call Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      }
    });

    const parsedText = response.text;
    if (!parsedText) throw new Error("No response from AI");
    
    const data = JSON.parse(parsedText);

    // 1. Categorize transaction and get or create merchant
    const categoryInfo = await categorizeTransaction(uid, data.merchantName, data.amount);
    
    // Find the merchant reference to associate with transaction
    const merchantsCol = getMerchantsCollection(uid);
    const merchantSnap = await merchantsCol.where("name", "==", data.merchantName).limit(1).get();
    const merchantId = merchantSnap.empty ? "" : merchantSnap.docs[0].id;

    // Generate dedup hash
    const dedupHash = generateDedupHash(data.date, Number(data.amount), data.merchantName);

    // Check for duplicate
    const txCol = getTransactionsCollection(uid);
    const existingTx = await txCol.where("dedupHash", "==", dedupHash).limit(1).get();

    if (!existingTx.empty) {
      return NextResponse.json({ 
        success: true, 
        skipped: true, 
        reason: "duplicate", 
        extracted: data 
      });
    }

    // 2. Create Transaction
    const newTxRef = txCol.doc();
    const transactionData = {
      id: newTxRef.id,
      date: data.date,
      amount: data.amount,
      currency: "INR",
      type: data.type,
      category: categoryInfo.category,
      subcategory: categoryInfo.subcategory,
      merchantName: data.merchantName,
      merchantRef: merchantId ? `merchants/${merchantId}` : "",
      source: 'manual',
      confidenceScore: categoryInfo.confidenceScore,
      isVerified: false,
      dedupHash,
      rawSourceText: message,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await newTxRef.set(transactionData);

    return NextResponse.json({ success: true, extracted: data, transaction: transactionData });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error simulating sms:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
