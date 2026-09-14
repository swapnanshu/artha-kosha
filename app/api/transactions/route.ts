import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getTransactions, getTransactionsCollection, getMerchantsCollection } from '@/src/lib/firestore';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    
    // Fetch user transactions from Firestore
    const userTx = await getTransactions(uid, {
      limit: 50,
      orderByField: 'date',
      orderDirection: 'desc'
    });

    return NextResponse.json(userTx);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();
    const { id, category, merchantName, subcategory } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing transaction ID' }, { status: 400 });
    }

    const txCol = getTransactionsCollection(uid);
    const txDocRef = txCol.doc(id);
    const txSnap = await txDocRef.get();

    if (!txSnap.exists) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const currentTxData = txSnap.data();
    const updateData: Record<string, any> = {
      updatedAt: new Date().toISOString()
    };

    const editHistory = currentTxData?.editHistory || [];
    const nowIso = new Date().toISOString();

    // 1. If Category changes
    if (category && category !== currentTxData?.category) {
      editHistory.push({
        field: 'category',
        oldValue: currentTxData?.category || '',
        newValue: category,
        editedAt: nowIso
      });
      updateData.category = category;
      updateData.isVerified = true; // Mark as verified since user corrected it

      // Auto-learn: Update default category of the merchant
      const merchantRefPath = currentTxData?.merchantRef; // e.g. "merchants/merchantId"
      if (merchantRefPath) {
        const merchantId = merchantRefPath.split('/')[1];
        if (merchantId) {
          const merchantsCol = getMerchantsCollection(uid);
          await merchantsCol.doc(merchantId).update({
            defaultCategory: category,
            lastSeenAt: nowIso
          });
        }
      }
    }

    // 2. If Subcategory changes
    if (subcategory && subcategory !== currentTxData?.subcategory) {
      editHistory.push({
        field: 'subcategory',
        oldValue: currentTxData?.subcategory || '',
        newValue: subcategory,
        editedAt: nowIso
      });
      updateData.subcategory = subcategory;
    }

    // 3. If Merchant Name changes
    if (merchantName && merchantName !== currentTxData?.merchantName) {
      editHistory.push({
        field: 'merchantName',
        oldValue: currentTxData?.merchantName || '',
        newValue: merchantName,
        editedAt: nowIso
      });
      updateData.merchantName = merchantName;
      updateData.isVerified = true;

      // Update merchant entry or alias
      const merchantRefPath = currentTxData?.merchantRef;
      if (merchantRefPath) {
        const merchantId = merchantRefPath.split('/')[1];
        if (merchantId) {
          const merchantsCol = getMerchantsCollection(uid);
          const merchantDoc = await merchantsCol.doc(merchantId).get();
          if (merchantDoc.exists) {
            const mData = merchantDoc.data();
            const aliases = mData?.aliases || [];
            
            // Add original name to aliases list for future matching
            const oldNameUpper = (currentTxData?.merchantName || '').toUpperCase();
            if (oldNameUpper && !aliases.includes(oldNameUpper)) {
              aliases.push(oldNameUpper);
            }
            
            await merchantsCol.doc(merchantId).update({
              name: merchantName,
              aliases,
              lastSeenAt: nowIso
            });
          }
        }
      }
    }

    updateData.editHistory = editHistory;
    await txDocRef.update(updateData);

    return NextResponse.json({ success: true, updatedFields: updateData });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating transaction:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
