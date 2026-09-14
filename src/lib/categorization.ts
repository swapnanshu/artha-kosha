import { getMerchantsCollection } from './firestore';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const CATEGORY_TAXONOMY: Record<string, string[]> = {
  Income: ['Salary', 'Freelance', 'Refund', 'Interest', 'Dividend'],
  Food: ['Restaurants', 'Delivery', 'Snacks', 'Coffee'],
  Groceries: ['Supermarket', 'Vegetables', 'Dairy'],
  Shopping: ['Clothing', 'Electronics', 'Home', 'Amazon', 'Flipkart'],
  Transport: ['Fuel', 'Cab', 'Auto', 'Metro', 'Parking'],
  Utilities: ['Electricity', 'Water', 'Gas', 'Internet', 'Phone'],
  Healthcare: ['Doctor', 'Medicine', 'Lab', 'Insurance Premium'],
  Entertainment: ['Movies', 'OTT', 'Gaming', 'Events'],
  Travel: ['Flights', 'Hotels', 'Local Transport', 'Visa'],
  Investments: ['Mutual Funds', 'Stocks', 'FD', 'PPF', 'NPS'],
  Insurance: ['Life', 'Health', 'Vehicle', 'Term'],
  Education: ['Courses', 'Books', 'Coaching'],
  Transfers: ['Bank Transfer', 'Self-Transfer', 'Family'],
  Taxes: ['Income Tax', 'GST', 'Property Tax'],
  Rent: ['House Rent', 'Maintenance', 'Parking'],
  EMI: ['Home Loan', 'Car Loan', 'Personal Loan'],
  Subscriptions: ['Netflix', 'Spotify', 'ChatGPT', 'Google One', 'iCloud'],
  Miscellaneous: ['ATM Withdrawal', 'Charges', 'Fees']
};

interface CategorizationResult {
  category: string;
  subcategory: string;
  confidenceScore: number;
}

export async function categorizeTransaction(
  uid: string,
  merchantName: string,
  amount: number
): Promise<CategorizationResult> {
  const normalizedMerchant = merchantName.toLowerCase().replace(/\b(ltd|pvt|india|private|limited|co|inc|corp)\b/g, '').trim();

  // Tier 1: Merchant Lookup in Firestore
  try {
    const merchantsCol = getMerchantsCollection(uid);
    
    // Check direct name match
    let mQuery = await merchantsCol.where('name', '==', merchantName).limit(1).get();
    
    // If not found, try searching by alias arrays containing this name
    if (mQuery.empty) {
      mQuery = await merchantsCol.where('aliases', 'array-contains', merchantName.toUpperCase()).limit(1).get();
    }

    if (!mQuery.empty) {
      const mData = mQuery.docs[0].data();
      return {
        category: mData.defaultCategory || 'Miscellaneous',
        subcategory: mData.defaultSubcategory || 'Fees',
        confidenceScore: 0.95 // High confidence from user database match
      };
    }
  } catch (dbErr) {
    console.error('Firestore merchant lookup error:', dbErr);
  }

  // Tier 2: Gemini Classification Fallback
  try {
    const prompt = `
Categorize this transaction:
Merchant: "${merchantName}"
Amount: INR ${amount}

Here is the category taxonomy (Category -> Subcategories):
${JSON.stringify(CATEGORY_TAXONOMY, null, 2)}

Classify the merchant into exactly one Category and one Subcategory from the list above.
Provide a confidence score between 0 and 1.
Return ONLY a raw JSON object with fields: "category", "subcategory", "confidenceScore".
Do not include markdown headers like \`\`\`json.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: "object",
          properties: {
            category: { type: "string" },
            subcategory: { type: "string" },
            confidenceScore: { type: "number" }
          },
          required: ["category", "subcategory", "confidenceScore"]
        }
      }
    });

    const resText = response.text?.trim();
    if (resText) {
      const parsed = JSON.parse(resText);
      
      // Auto-learn: Save this merchant to database to prevent future API calls
      try {
        const merchantsCol = getMerchantsCollection(uid);
        const newMerchantRef = merchantsCol.doc();
        await newMerchantRef.set({
          id: newMerchantRef.id,
          name: merchantName,
          aliases: [merchantName.toUpperCase()],
          defaultCategory: parsed.category,
          defaultSubcategory: parsed.subcategory,
          transactionCount: 1,
          totalSpent: amount,
          lastSeenAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        });
      } catch (saveErr) {
        console.error('Failed to auto-save new merchant alias:', saveErr);
      }

      return {
        category: parsed.category || 'Miscellaneous',
        subcategory: parsed.subcategory || 'Fees',
        confidenceScore: parsed.confidenceScore || 0.80
      };
    }
  } catch (aiErr) {
    console.error('Gemini categorization failed:', aiErr);
  }

  // Tier 3: Hardcoded Fallback
  return {
    category: 'Miscellaneous',
    subcategory: 'Fees',
    confidenceScore: 0.50
  };
}
