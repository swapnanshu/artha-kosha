import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { 
  getAccounts, 
  getAccountsCollection 
} from '@/src/lib/firestore';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const accounts = await getAccounts(uid);

    const totalBalance = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);

    return NextResponse.json({
      accounts,
      totalBalance,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching accounts:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const {
      name,
      type,
      bank,
      lastFourDigits,
      creditLimit,
      currentBalance,
      isActive,
    } = body as {
      name?: string;
      type?: 'credit_card' | 'savings' | 'wallet';
      bank?: 'RBL' | 'ICICI' | 'SBI' | 'Kotak' | 'IndusInd' | 'Axis' | 'Unknown';
      lastFourDigits?: string;
      creditLimit?: number;
      currentBalance?: number;
      isActive?: boolean;
    };

    if (!name || !type || !bank || !lastFourDigits) {
      return NextResponse.json(
        { error: 'Missing required fields: name, type, bank, lastFourDigits' },
        { status: 400 }
      );
    }

    if (!/^\d{4}$/.test(lastFourDigits.trim())) {
      return NextResponse.json(
        { error: 'lastFourDigits must be exactly 4 numeric digits' },
        { status: 400 }
      );
    }

    if (typeof creditLimit !== 'undefined' && (typeof creditLimit !== 'number' || creditLimit < 0)) {
      return NextResponse.json(
        { error: 'creditLimit must be a non-negative number' },
        { status: 400 }
      );
    }

    if (typeof currentBalance !== 'undefined' && typeof currentBalance !== 'number') {
      return NextResponse.json(
        { error: 'currentBalance must be a valid number' },
        { status: 400 }
      );
    }

    const accountsCol = getAccountsCollection(uid);
    const id = `${bank}_${lastFourDigits}_${Date.now()}`;

    await accountsCol.doc(id).set(
      {
        id,
        name,
        type,
        bank,
        lastFourDigits,
        creditLimit: typeof creditLimit === 'number' ? creditLimit : undefined,
        currentBalance: typeof currentBalance === 'number' ? currentBalance : 0,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        lastSynced: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating account:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { id, ...rest } = body as {
      id?: string;
    } & Partial<{
      name: string;
      type: 'credit_card' | 'savings' | 'wallet';
      bank: 'RBL' | 'ICICI' | 'SBI' | 'Kotak' | 'IndusInd' | 'Axis' | 'Unknown';
      lastFourDigits: string;
      creditLimit: number;
      currentBalance: number;
      isActive: boolean;
    }>;

    if (!id) {
      return NextResponse.json({ error: 'Missing account id' }, { status: 400 });
    }

    const accountsCol = getAccountsCollection(uid);
    await accountsCol.doc(id).update({
      ...rest,
      lastSynced: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, updated: rest });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating account:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { id } = body as { id?: string };
    if (!id) {
      return NextResponse.json({ error: 'Missing account id' }, { status: 400 });
    }

    const accountsCol = getAccountsCollection(uid);
    await accountsCol.doc(id).delete();

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
