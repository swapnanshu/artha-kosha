import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getUserDoc } from '@/src/lib/firestore';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { smsWebhookSecret, onboardingComplete } = body as {
      smsWebhookSecret?: string;
      onboardingComplete?: boolean;
    };

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (typeof smsWebhookSecret === 'string' && smsWebhookSecret.trim().length > 0) {
      updates.smsWebhookSecret = smsWebhookSecret.trim();
    }

    if (typeof onboardingComplete === 'boolean') {
      updates.onboardingComplete = onboardingComplete;
    }

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
    }

    const userRef = getUserDoc(uid);
    await userRef.set(updates, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating onboarding:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
