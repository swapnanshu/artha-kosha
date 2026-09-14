import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { accessToken } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'Missing access token' }, { status: 401 });
    }

    // 1. Fetch recent emails matching transaction keywords
    const query = 'subject:("alert" OR "debit" OR "credit" OR "paid") (bank OR upi OR amount) newer_than:7d';
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!listRes.ok) {
      const errorText = await listRes.text();
      console.error('Gmail API error:', errorText);
      return NextResponse.json({ error: 'Failed to access Gmail. Please ensure you granted permission.' }, { status: listRes.status });
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];

    if (messages.length === 0) {
      return NextResponse.json({ transactions: [] });
    }

    // 2. Fetch content for each message
    const emailTexts = [];
    for (const msg of messages) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        const snippet = msgData.snippet || '';
        emailTexts.push(snippet);
      }
    }

    if (emailTexts.length === 0) {
      return NextResponse.json({ transactions: [] });
    }

    // 3. Process with Gemini
    const prompt = `
    You are an expert at extracting financial transaction details from bank alerts/emails.
    I have the following email snippets:
    ${emailTexts.map((e, i) => `Email ${i+1}: ${e}`).join('\n')}

    Extract all distinct transactions. 
    Return a list of JSON objects (do not include markdown blocks, just a raw JSON array).
    Each object must have:
    - id: a unique string
    - date: approximate date like 'Today' or 'Yesterday' or short date like 'Oct 24'
    - merchantName: string
    - amount: string representing number (e.g. "1200", "50")
    - type: "expense" or "income"
    - category: short 1-word category (e.g. "Food", "Utility", "Transport", "Shopping", "Other")

    Only return the JSON array.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
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

    const transactions = JSON.parse(rawText.trim());

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error('Email Sync Error:', error);
    return NextResponse.json({ error: 'Failed to process emails' }, { status: 500 });
  }
}
