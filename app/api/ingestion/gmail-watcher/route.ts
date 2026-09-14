import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/src/lib/firebase-admin';
import { decrypt } from '@/src/lib/encryption';
import { getTransactionsCollection, getMerchantsCollection } from '@/src/lib/firestore';
import { parseTransactionFromText } from '@/src/lib/bank-parsers';
import { generateDedupHash } from '@/src/lib/dedup';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';
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

const BANK_EMAIL_SENDERS = [
  'alerts@icicibank.com',
  'alerts@axisbank.com',
  'alerts@sbicard.com',
  'alerts@kotak.com',
  'noreply@rblbank.com',
  'alerts@indusind.com',
  'noreply@hdfcbank.net',
  'alerts@upi',
  'noreply@paytm.com'
];

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    if (!payload.message || !payload.message.data) {
      return NextResponse.json({ error: 'Invalid Pub/Sub message format' }, { status: 400 });
    }

    // Decode message data
    const decodedStr = Buffer.from(payload.message.data, 'base64').toString('utf-8');
    const pubsubData = JSON.parse(decodedStr);
    const emailAddress = pubsubData.emailAddress;

    if (!emailAddress) {
      return NextResponse.json({ error: 'Missing emailAddress in pubsub message data' }, { status: 400 });
    }

    // 1. Find user in Firestore matching the email (checks connectedEmails array first, then primary email)
    let usersSnap = await adminDb.collection('users').where('connectedEmails', 'array-contains', emailAddress).limit(1).get();
    if (usersSnap.empty) {
      usersSnap = await adminDb.collection('users').where('email', '==', emailAddress).limit(1).get();
    }
    if (usersSnap.empty) {
      return NextResponse.json({ error: 'User profile not found for email' }, { status: 404 });
    }

    const userDoc = usersSnap.docs[0];
    const uid = userDoc.id;
    const userData = userDoc.data();
    const encryptedTokens = userData.gmailRefreshTokens || [];

    if (encryptedTokens.length === 0) {
      return NextResponse.json({ error: 'No refresh tokens stored for this user' }, { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('Google OAuth credentials not configured in environment. Cannot fetch emails.');
      return NextResponse.json({ error: 'OAuth Credentials missing on server' }, { status: 500 });
    }

    // Decrypt the refresh token(s)
    let authenticatedEmail = false;
    let oauth2Client = null;

    for (const encryptedToken of encryptedTokens) {
      try {
        const decryptedToken = decrypt(encryptedToken);
        const client = new google.auth.OAuth2(clientId, clientSecret);
        client.setCredentials({ refresh_token: decryptedToken });
        
        // Test credentials by requesting a new access token
        const tokenRes = await client.getAccessToken();
        if (tokenRes.token) {
          // Double check email address matches
          const oauth2 = google.oauth2({ version: 'v2', auth: client });
          const userInfo = await oauth2.userinfo.get();
          if (userInfo.data.email === emailAddress) {
            oauth2Client = client;
            authenticatedEmail = true;
            break;
          }
        }
      } catch (tokenErr) {
        console.error('Token decryption or verification failed:', tokenErr);
      }
    }

    if (!authenticatedEmail || !oauth2Client) {
      return NextResponse.json({ error: 'Could not authenticate matching Gmail account' }, { status: 401 });
    }

    // 2. Fetch new emails using historyId watermark if available
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const lastHistoryIdStr = userData.gmailLastHistoryId?.[emailAddress];
    const lastHistoryId = lastHistoryIdStr ? String(lastHistoryIdStr) : null;
    const newHistoryId = pubsubData.historyId ? String(pubsubData.historyId) : null;

    let messageIds: string[] = [];

    if (lastHistoryId) {
      try {
        const historyRes = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: lastHistoryId,
          historyTypes: ['messageAdded'],
          labelId: 'INBOX',
        });

        const historyItems = historyRes.data.history || [];
        for (const item of historyItems) {
          for (const msgAdded of (item.messagesAdded || [])) {
            if (msgAdded.message?.id) {
              messageIds.push(msgAdded.message.id);
            }
          }
        }
      } catch (histErr: any) {
        if (histErr?.code === 404 || histErr?.status === 404) {
          console.warn('historyId expired or invalid, falling back to recent query');
          const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: `newer_than:1d SUBJECT:("alert" OR "debit" OR "credit" OR "paid" OR "spent" OR "transaction")`,
            maxResults: 10,
          });
          messageIds = (listRes.data.messages || []).map(m => m.id!).filter(Boolean);
        } else {
          console.error('Error fetching Gmail history:', histErr);
        }
      }
    } else {
      // First time watermark not set - fetch recent bank alerts
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: `newer_than:1d SUBJECT:("alert" OR "debit" OR "credit" OR "paid" OR "spent" OR "transaction")`,
        maxResults: 10,
      });
      messageIds = (listRes.data.messages || []).map(m => m.id!).filter(Boolean);
    }

    // Deduplicate messageIds
    messageIds = [...new Set(messageIds)];

    if (messageIds.length === 0) {
      if (newHistoryId) {
        await userDoc.ref.update({
          [`gmailLastHistoryId.${emailAddress}`]: newHistoryId
        });
      }
      return NextResponse.json({ success: true, count: 0, message: 'No new transaction emails' });
    }

    let addedCount = 0;
    const nowIso = new Date().toISOString();
    const txCol = getTransactionsCollection(uid);
    const merchantsCol = getMerchantsCollection(uid);

    for (const msgId of messageIds) {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'full'
      });

      const msgData = msgRes.data;
      const headers = msgData.payload?.headers || [];
      const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
      
      // Filter out email senders not from known banks
      const isBankEmail = BANK_EMAIL_SENDERS.some(sender => fromHeader.toLowerCase().includes(sender));
      if (!isBankEmail) continue;

      const bodyText = msgData.snippet || '';
      
      // Parse transaction
      let amount = 0;
      let merchantName = "Unknown Merchant";
      let type: 'expense' | 'income' = 'expense';
      let paymentMethod = 'UPI';
      let date = new Date().toISOString().split('T')[0];
      let confidenceScore = 1.0;

      const regexParsed = parseTransactionFromText(bodyText);
      if (regexParsed) {
        amount = regexParsed.amount;
        merchantName = regexParsed.merchantName;
        type = regexParsed.type;
        paymentMethod = regexParsed.paymentMethod || 'credit_card';
        if (regexParsed.date) {
          date = regexParsed.date;
        }
      } else {
        // Fallback to Gemini
        const prompt = `Extract transaction details from this bank notification email body: "${bodyText}". Assume transaction date is today (${date}) if not specified. Output appropriate category.`;
        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: geminiSchema
          }
        });

        const parsedText = response.text;
        if (!parsedText) continue;

        const aiData = JSON.parse(parsedText);
        amount = aiData.amount;
        merchantName = aiData.merchantName;
        type = aiData.type;
        paymentMethod = aiData.paymentMethod || 'credit_card';
        date = aiData.date;
        confidenceScore = 0.85;
      }

      // Check duplicate
      const dedupHash = generateDedupHash(date, amount, merchantName);
      const existingTx = await txCol.where('dedupHash', '==', dedupHash).limit(1).get();

      if (!existingTx.empty) {
        continue; // duplicate, skip
      }

      // Create Merchant if doesn't exist
      let merchantId = "";
      const merchantQuery = await merchantsCol.where('name', '==', merchantName).limit(1).get();
      let category = 'Other';

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

      // Save Transaction
      const newTxRef = txCol.doc();
      await newTxRef.set({
        id: newTxRef.id,
        date,
        amount,
        currency: 'INR',
        type,
        source: 'gmail',
        sourceEmailAccount: emailAddress,
        merchantRef: `merchants/${merchantId}`,
        merchantName,
        category,
        paymentMethod,
        confidenceScore,
        isVerified: false,
        dedupHash,
        rawSourceText: bodyText,
        createdAt: nowIso,
        updatedAt: nowIso
      });

      addedCount++;
    }

    if (newHistoryId) {
      await userDoc.ref.update({
        [`gmailLastHistoryId.${emailAddress}`]: newHistoryId
      });
    }

    return NextResponse.json({ success: true, count: addedCount });
  } catch (error) {
    console.error('Gmail PubSub Watcher Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
