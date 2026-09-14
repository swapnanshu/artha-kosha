import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getSubscriptionsCollection, getSubscriptions } from '@/src/lib/firestore';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const subs = await getSubscriptions(uid);

    // Plan Phase 4 UI expects active subscriptions; frontend can filter,
    // but we return both for flexibility.
    return NextResponse.json({
      subscriptions: subs,
      activeSubscriptions: subs.filter((s) => s.isActive),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { id, action } = body as { id: string; action?: 'pause' | 'cancel' };

    if (!id) {
      return NextResponse.json({ error: 'Missing subscription id' }, { status: 400 });
    }

    const subsCol = getSubscriptionsCollection(uid);
    const docRef = subsCol.doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const current = snap.data() as any;

    // Minimal actions as required by plan:
    // - pause: isActive=false
    // - cancel: isActive=false (we do not implement extra history fields to avoid overreach)
    const nextIsActive = action === 'pause' || action === 'cancel' ? false : current?.isActive;

    await docRef.update({
      isActive: nextIsActive,
      updatedAt: nowIso,
    });

    return NextResponse.json({ success: true, id, isActive: nextIsActive });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating subscription:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
