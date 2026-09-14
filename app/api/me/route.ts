import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getUserDoc } from '@/src/lib/firestore';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const userRef = getUserDoc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      return NextResponse.json({ onboardingComplete: false });
    }

    const data = snap.data() as any;
    return NextResponse.json({
      onboardingComplete: Boolean(data?.onboardingComplete),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching /api/me:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
