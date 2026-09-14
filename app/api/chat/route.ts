import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getAccounts, getBudgets, getSubscriptions, getTransactions } from '@/src/lib/firestore';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function toISODate(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toMonthKey(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthKeyToDateRange(monthKey: string) {
  // monthKey: YYYY-MM
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59)); // last day of month
  return { startISO: toISODate(start), endISO: toISODate(end) };
}

function normalizeQueryString(s: string) {
  return (s || '').trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const { message } = await req.json();

    const now = new Date();
    const currentMonth = toMonthKey(now);

    // Fetch data for context injection.
    // Keep it simple: transactions are the most important; budgets/subscriptions/accounts are also needed.
    const [allRecentTxs, accounts, budgetsAll, subscriptionsAll] = await Promise.all([
      getTransactions(uid, {
        limit: 200,
        orderByField: 'date',
        orderDirection: 'desc',
      }),
      getAccounts(uid),
      getBudgets(uid),
      getSubscriptions(uid),
    ]);

    const recentTransactions = allRecentTxs.slice(0, 50);

    const txsThisMonth = allRecentTxs.filter((t) => (t.date || '').startsWith(currentMonth));
    const incomeThisMonth = txsThisMonth
      .filter((t) => t.type === 'income')
      .reduce((acc, t) => acc + Number(t.amount || 0), 0);

    const expenseThisMonth = txsThisMonth
      .filter((t) => t.type === 'expense')
      .reduce((acc, t) => acc + Number(t.amount || 0), 0);

    const currentMonthSpend = expenseThisMonth;
    const currentMonthIncome = incomeThisMonth;

    const savingsRate =
      currentMonthIncome > 0 ? ((currentMonthIncome - currentMonthSpend) / currentMonthIncome) * 100 : 0;

    const totalBalance = accounts
      .filter((a) => a.isActive)
      .reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);

    // Budget status for current month
    const budgetForMonth = budgetsAll.find((b) => b.month === currentMonth) || null;
    const budgetStatus: Record<
      string,
      { budget: number; spent: number; remaining: number }
    > = {};

    if (budgetForMonth?.categoryBudgets) {
      // Compute spent by category for this month expenses
      const spentByCategory: Record<string, number> = {};
      for (const t of txsThisMonth) {
        if (t.type !== 'expense') continue;
        const cat = t.category || 'Miscellaneous';
        spentByCategory[cat] = (spentByCategory[cat] || 0) + Number(t.amount || 0);
      }

      for (const [cat, budget] of Object.entries(budgetForMonth.categoryBudgets)) {
        const spent = spentByCategory[cat] || 0;
        const remaining = Number(budget || 0) - spent;
        budgetStatus[cat] = { budget: Number(budget || 0), spent, remaining };
      }
    }

    // Top spending categories (this month)
    const spentByCategoryAll: Record<string, number> = {};
    for (const t of txsThisMonth) {
      if (t.type !== 'expense') continue;
      const cat = t.category || 'Miscellaneous';
      spentByCategoryAll[cat] = (spentByCategoryAll[cat] || 0) + Number(t.amount || 0);
    }

    const topCategories = Object.entries(spentByCategoryAll)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([category, spent]) => ({ category, spent }));

    // Monthly trends (last 3 months including current)
    const monthKeys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (2 - i), 1));
      monthKeys.push(toMonthKey(d));
    }

    const monthlyTrends = monthKeys.map((mk) => {
      const txs = allRecentTxs.filter((t) => (t.date || '').startsWith(mk));
      const income = txs.filter((t) => t.type === 'income').reduce((acc, t) => acc + Number(t.amount || 0), 0);
      const expense = txs.filter((t) => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount || 0), 0);
      return { month: mk, income, expense, net: income - expense };
    });

    // Active subscriptions
    const activeSubscriptions = subscriptionsAll.filter((s) => s.isActive);

    // Context object (compact)
    const context = {
      currentMonthSpend,
      currentMonthIncome,
      savingsRate: Number(savingsRate.toFixed(2)),
      totalBalance,
      budgetStatus,
      accounts: accounts.map((a) => ({
        name: a.name,
        type: a.type,
        bank: a.bank,
        lastFourDigits: a.lastFourDigits,
        balance: a.currentBalance,
      })),
      subscriptions: activeSubscriptions.map((s) => ({
        merchantName: s.merchantName,
        amount: s.amount,
        frequency: s.frequency,
        nextExpectedDate: s.nextExpectedDate,
        isActive: s.isActive,
      })),
      topCategories,
      recentTransactions: recentTransactions.map((t) => ({
        date: t.date,
        amount: t.amount,
        type: t.type,
        category: t.category,
        merchantName: t.merchantName,
        isVerified: t.isVerified,
      })),
      monthlyTrends,
      currentMonth,
    };

    // Tool implementations (best-effort, using already-fetched data)
    const toolSearchTransactions = (params: { query: string; dateRange?: { start?: string; end?: string } }) => {
      const q = normalizeQueryString(params.query || '');
      const { start, end } = params.dateRange || {};
      const startISO = start || '0000-01-01';
      const endISO = end || '9999-12-31';

      const matches = allRecentTxs
        .filter((t) => (t.date || '') >= startISO && (t.date || '') <= endISO)
        .filter((t) => {
          if (!q) return true;
          const hay = `${t.merchantName || ''} ${t.category || ''} ${t.subcategory || ''} ${t.type || ''}`.toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 25);

      return matches.map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        type: t.type,
        category: t.category,
        merchantName: t.merchantName,
      }));
    };

    const toolGetSpendingByCategory = (params: { month: string }) => {
      const month = params.month;
      const txs = allRecentTxs.filter((t) => (t.date || '').startsWith(month) && t.type === 'expense');
      const spentByCat: Record<string, number> = {};
      for (const t of txs) {
        const cat = t.category || 'Miscellaneous';
        spentByCat[cat] = (spentByCat[cat] || 0) + Number(t.amount || 0);
      }
      const rows = Object.entries(spentByCat)
        .sort((a, b) => b[1] - a[1])
        .map(([category, spent]) => ({ category, spent }));
      return { month, rows };
    };

    const toolComparePeriods = (params: { period1: string; period2: string }) => {
      const p1 = params.period1;
      const p2 = params.period2;
      const [r1, r2] = [toolGetSpendingByCategory({ month: p1 }), toolGetSpendingByCategory({ month: p2 })];

      const total1 = r1.rows.reduce((acc, x) => acc + x.spent, 0);
      const total2 = r2.rows.reduce((acc, x) => acc + x.spent, 0);

      const pct = total1 > 0 ? ((total2 - total1) / total1) * 100 : 0;
      return { period1: p1, period2: p2, totalSpendingPeriod1: total1, totalSpendingPeriod2: total2, changePct: pct };
    };

    const toolGetSubscriptions = () => {
      return activeSubscriptions.map((s) => ({
        merchantName: s.merchantName,
        amount: s.amount,
        frequency: s.frequency,
        nextExpectedDate: s.nextExpectedDate,
        isActive: s.isActive,
      }));
    };

    const toolGetMerchantHistory = (params: { merchantName: string }) => {
      const mn = (params.merchantName || '').trim().toLowerCase();
      if (!mn) return [];
      const matches = allRecentTxs
        .filter((t) => (t.merchantName || '').toLowerCase() === mn)
        .slice(0, 50);
      if (matches.length > 0) return matches;

      // fallback fuzzy include
      return allRecentTxs.filter((t) => (t.merchantName || '').toLowerCase().includes(mn)).slice(0, 50);
    };

    const tools = [
      {
        name: 'searchTransactions',
        description: 'Search transactions by natural language query and optional date range.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query text (merchant/category/type)' },
            dateRange: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'YYYY-MM-DD' },
                end: { type: 'string', description: 'YYYY-MM-DD' },
              },
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'getSpendingByCategory',
        description: 'Get expense totals by category for a given month (YYYY-MM).',
        parameters: {
          type: 'object',
          properties: {
            month: { type: 'string', description: 'YYYY-MM' },
          },
          required: ['month'],
        },
      },
      {
        name: 'comparePeriods',
        description: 'Compare total spending between two months (YYYY-MM).',
        parameters: {
          type: 'object',
          properties: {
            period1: { type: 'string', description: 'YYYY-MM' },
            period2: { type: 'string', description: 'YYYY-MM' },
          },
          required: ['period1', 'period2'],
        },
      },
      {
        name: 'getSubscriptions',
        description: 'List active subscriptions.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'getMerchantHistory',
        description: 'Get transactions history for a merchant name.',
        parameters: {
          type: 'object',
          properties: {
            merchantName: { type: 'string', description: 'Merchant canonical name (or close match)' },
          },
          required: ['merchantName'],
        },
      },
    ];

    const systemPrompt = `You are "Artha Kosha AI", a personal finance copilot for an Indian salaried professional.
You have COMPLETE access to the user's financial data including transactions, budgets, subscriptions, and account balances.

Your personality: concise, actionable, data-driven, encouraging.
When analyzing spending, always reference specific numbers and merchants.
When suggesting savings, be realistic — don't suggest cutting essential expenses.
For investment advice, disclaim that you're not a certified financial advisor.

Format: Use plain text with bullet points. Keep answers under 5 sentences unless the user asks for a detailed breakdown.`;

    const userPrompt = `User question: "${message}"

Financial context (JSON):
${JSON.stringify(context)}`;

    // Best-effort function calling: if tool calls cannot be parsed, we fall back to context-only response.
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }, { text: userPrompt }] },
      ],
      tools: tools,
    } as any);

    // Try to extract function calls and handle them.
    // SDK response shape can vary; we attempt defensive parsing.
    const candidate = (response as any)?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCalls: Array<{ name: string; args: any }> = [];

    for (const p of parts) {
      if (p?.functionCall?.name) {
        functionCalls.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
      }
    }

    if (functionCalls.length > 0) {
      const toolResults: Record<string, any> = {};
      for (const fc of functionCalls) {
        try {
          if (fc.name === 'searchTransactions') toolResults[fc.name] = toolSearchTransactions(fc.args);
          else if (fc.name === 'getSpendingByCategory') toolResults[fc.name] = toolGetSpendingByCategory(fc.args);
          else if (fc.name === 'comparePeriods') toolResults[fc.name] = toolComparePeriods(fc.args);
          else if (fc.name === 'getSubscriptions') toolResults[fc.name] = toolGetSubscriptions();
          else if (fc.name === 'getMerchantHistory') toolResults[fc.name] = toolGetMerchantHistory(fc.args);
        } catch (e) {
          toolResults[fc.name] = { error: 'tool_execution_failed' };
        }
      }

      const followUp = `Tool results (JSON):
${JSON.stringify(toolResults)}

Using the tool results and the financial context, answer the user question precisely.`;

      const final = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }, { text: followUp }] },
        ],
      });

      const finalText =
        (final as any)?.text?.() ?? (final as any)?.text ?? '';

      return NextResponse.json({ text: finalText });
    }

    const responseText =
      typeof (response as any)?.text === 'function'
        ? (response as any).text()
        : (response as any)?.text;

    return NextResponse.json({ text: responseText ?? '' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
