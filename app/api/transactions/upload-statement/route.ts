import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getMerchantsCollection, getTransactionsCollection } from '@/src/lib/firestore';
import { categorizeTransaction } from '@/src/lib/categorization';
import { generateDedupHash } from '@/src/lib/dedup';
import { GoogleGenAI } from '@google/genai';
import { PDFDocument } from 'pdf-lib';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;
    const bank = formData.get('bank') as string;

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    // Read the PDF buffer
    const arrayBuffer = await file.arrayBuffer();
    let pdfBuffer = new Uint8Array(arrayBuffer);

    // If password provided, attempt to decrypt with pdf-lib
    if (password) {
      try {
        const pdfDoc = await PDFDocument.load(pdfBuffer, { password } as any);
        pdfBuffer = await pdfDoc.save() as any;
      } catch (err) {
        console.error('PDF Decryption Error:', err);
        return NextResponse.json({ error: 'Failed to decrypt PDF. Incorrect password?' }, { status: 400 });
      }
    }

    // Convert decrypted PDF to base64
    const base64Pdf = Buffer.from(pdfBuffer).toString('base64');

    const prompt = `
You are an expert at extracting financial transactions from credit card statements.
Attached is a PDF statement for ${bank || 'the bank'}.

Extract ALL individual transactions from the PDF statement.
Return ONLY a raw JSON array of objects. Do not include markdown code blocks.

Each transaction object must have:
- date: 'YYYY-MM-DD'
- merchantName: string
- amount: number (always positive)
- type: "expense" or "income" (payments or refunds are "income", card purchases are "expense")
- category: short 1-word category (e.g. "Food", "Groceries", "Shopping", "Transport", "Utilities", "Other")

If no transactions are found, return [].
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Pdf,
          }
        },
        prompt
      ],
    });

    let rawText = response.text?.trim() || '[]';
    if (rawText.startsWith('```json')) {
      rawText = rawText.substring(7);
      if (rawText.endsWith('```')) {
        rawText = rawText.substring(0, rawText.length - 3);
      }
    } else if (rawText.startsWith('```')) {
      rawText = rawText.substring(3);
      if (rawText.endsWith('```')) {
        rawText = rawText.substring(0, rawText.length - 3);
      }
    }

    const newTransactions = JSON.parse(rawText.trim());

    if (newTransactions.length > 0) {
      const merchantsCol = getMerchantsCollection(uid);
      const txCol = getTransactionsCollection(uid);
      const nowIso = new Date().toISOString();

      for (const tx of newTransactions) {
        let merchantName = tx.merchantName || "Unknown Merchant";
        
        // 1. Categorize transaction and get or create merchant
        const categoryInfo = await categorizeTransaction(uid, merchantName, Number(tx.amount));
        
        // Find merchant reference
        const merchantQuery = await merchantsCol.where("name", "==", merchantName).limit(1).get();
        const merchantId = merchantQuery.empty ? "" : merchantQuery.docs[0].id;

        // 2. Generate dedup hash & check duplication
        const txDate = tx.date || new Date().toISOString().split('T')[0];
        const dedupHash = generateDedupHash(txDate, Number(tx.amount), merchantName);

        const existingTxQuery = await txCol.where("dedupHash", "==", dedupHash).limit(1).get();
        if (existingTxQuery.empty) {
          const newTxRef = txCol.doc();
          await newTxRef.set({
            id: newTxRef.id,
            date: tx.date || new Date().toISOString().split('T')[0],
            amount: Number(tx.amount),
            currency: "INR",
            type: tx.type === 'income' ? 'income' : 'expense',
            category: categoryInfo.category,
            subcategory: categoryInfo.subcategory,
            merchantName: merchantName,
            merchantRef: merchantId ? `merchants/${merchantId}` : "",
            source: 'pdf_statement',
            confidenceScore: categoryInfo.confidenceScore,
            isVerified: false,
            dedupHash,
            createdAt: nowIso,
            updatedAt: nowIso
          });
        }
      }
    }

    return NextResponse.json({ success: true, count: newTransactions.length });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
