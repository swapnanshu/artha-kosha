import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getUserDoc } from '@/src/lib/firestore';
import { adminAuth } from '@/src/lib/firebase-admin';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    
    // Fetch detailed user info from Firebase Admin to get displayName
    const userRecord = await adminAuth.getUser(uid);
    const email = userRecord.email || '';
    const displayName = userRecord.displayName || '';

    // Upsert user in Firestore
    const userDocRef = getUserDoc(uid);
    const docSnap = await userDocRef.get();

    if (!docSnap.exists) {
      await userDocRef.set({
        email,
        displayName,
        createdAt: new Date().toISOString(),
        settings: {
          currency: 'INR',
          defaultView: 'dashboard',
          notificationsEnabled: true
        }
      });
    } else {
      await userDocRef.set({
        email,
        displayName,
      }, { merge: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error syncing user:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
