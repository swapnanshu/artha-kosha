import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getBudgetsCollection, getTransactionsCollection } from '@/src/lib/firestore';
import { getBudgets } from '@/src/lib/firestore';

function monthToId(month: string) {
  // Expect "YYYY-MM"
  return month;
}

function sumSpentForMonth(transactions: any[], month: string) {
  // transactions.date is expected "YYYY-MM-DD"
  return transactions
    .filter((t) => t.type === 'expense' && String(t.date || '').startsWith(`${month}-`))
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
}

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7); // YYYY-MM
    const monthId = monthToId(month);

    const budgets = await getBudgets(uid);
    const budgetForMonth = budgets.find((b) => b.id === monthId) || null;

    return NextResponse.json({
      budget: budgetForMonth,
      month,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching budgets:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { month, categoryBudgets } = body as {
      month: string; // YYYY-MM
      categoryBudgets: Record<string, number>;
    };

    if (!month || !categoryBudgets || typeof categoryBudgets !== 'object') {
      return NextResponse.json({ error: 'Missing month or categoryBudgets' }, { status: 400 });
    }

    const monthId = monthToId(month);
    const budgetsCol = getBudgetsCollection(uid);
    const docRef = budgetsCol.doc(monthId);

    const totalBudget = Object.values(categoryBudgets).reduce((acc, v) => acc + Number(v || 0), 0);

    await docRef.set(
      {
        id: monthId,
        month,
        categoryBudgets,
        totalBudget,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true, id: monthId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error upserting budget:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { id, categoryBudgets } = body as {
      id: string; // budget id = "YYYY-MM"
      categoryBudgets?: Record<string, number>;
    };

    if (!id) {
      return NextResponse.json({ error: 'Missing budget id' }, { status: 400 });
    }

    const budgetsCol = getBudgetsCollection(uid);
    const docRef = budgetsCol.doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
    }

    const next: any = {};
    if (categoryBudgets) {
      next.categoryBudgets = categoryBudgets;
      next.totalBudget = Object.values(categoryBudgets).reduce((acc, v) => acc + Number(v || 0), 0);
    }

    next.updatedAt = new Date().toISOString();

    await docRef.update(next);

    return NextResponse.json({ success: true, updated: next });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating budget:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Minimal DELETE (not explicitly used by Phase 4 UI, but completes CRUD requirement)
export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const body = await req.json();

    const { id } = body as { id: string };
    if (!id) return NextResponse.json({ error: 'Missing budget id' }, { status: 400 });

    const budgetsCol = getBudgetsCollection(uid);
    const docRef = budgetsCol.doc(id);

    await docRef.delete();

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting budget:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
