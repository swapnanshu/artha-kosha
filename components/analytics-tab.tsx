'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import SubscriptionsPanel from './subscriptions-panel';

type Tx = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  category: string;
  merchantName: string;
};

function ymFromDate(dateStr: string) {
  // expects YYYY-MM-DD
  return String(dateStr || '').slice(0, 7);
}

function formatINR(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function donutSegments(values: number[]) {
  const total = values.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
  const safeTotal = total <= 0 ? 1 : total;
  return values.map((v) => ({
    value: v,
    pct: (Number.isFinite(v) ? v : 0) / safeTotal,
  }));
}

function DonutChart({
  data,
}: {
  data: { label: string; value: number; color: string }[];
}) {
  const size = 140;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const segments = donutSegments(data.map((d) => d.value));

  const offsets = segments.reduce(
    (acc, seg) => {
      acc.push(-acc.length * 0); // placeholder; will be replaced below
      return acc;
    },
    [] as number[]
  );

  // Compute cumulative offsets without mutating during render
  const offsetByIdx = segments.reduce(
    (acc, seg) => {
      const nextOffset = acc.runningOffset;
      acc.offsets.push(nextOffset);
      return {
        runningOffset: nextOffset - seg.pct * c,
        offsets: acc.offsets,
      };
    },
    { runningOffset: 0, offsets: [] as number[] }
  ).offsets;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(148,163,184,0.25)" strokeWidth={stroke} fill="none" />
        {data.map((d, idx) => {
          const seg = segments[idx];
          const dash = `${seg.pct * c} ${c}`;
          const offset = offsetByIdx[idx];

          return (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={d.color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={dash}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
        })}
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="12" fontWeight="700">
          Spend
        </text>
      </svg>

      <div className="space-y-2">
        {data.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-[120px]">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
              <span className="text-xs text-gray-300 truncate">{d.label}</span>
            </div>
            <span className="text-xs font-mono text-gray-400">{formatINR(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsTab() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const fetchTransactions = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/transactions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTxs((data || []).map((t: any) => t as Tx));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => {
      fetchTransactions();
    }, 0);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const monthTxs = useMemo(() => {
    return txs.filter((t) => ymFromDate(t.date) === month);
  }, [txs, month]);

  const monthExpenseTxs = useMemo(() => monthTxs.filter((t) => t.type === 'expense'), [monthTxs]);

  const monthIncome = useMemo(() => {
    return monthTxs.filter((t) => t.type === 'income').reduce((a, t) => a + Number(t.amount || 0), 0);
  }, [monthTxs]);

  const monthExpense = useMemo(() => monthExpenseTxs.reduce((a, t) => a + Number(t.amount || 0), 0), [monthExpenseTxs]);

  const savingsRate = useMemo(() => {
    if (monthIncome <= 0) return 0;
    const net = monthIncome - monthExpense;
    return (net / monthIncome) * 100;
  }, [monthIncome, monthExpense]);

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of monthExpenseTxs) {
      const cat = t.category || 'Miscellaneous';
      map[cat] = (map[cat] || 0) + Number(t.amount || 0);
    }
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 7);
    return entries;
  }, [monthExpenseTxs]);

  const donutData = useMemo(() => {
    const palette = ['#6366F1', '#10B981', '#F59E0B', '#F43F5E', '#60A5FA', '#A78BFA', '#22C55E'];
    return categoryBreakdown.map(([label, value], idx) => ({
      label,
      value,
      color: palette[idx % palette.length],
    }));
  }, [categoryBreakdown]);

  const topMerchants = useMemo(() => {
    const map: Record<string, { spent: number; count: number }> = {};
    for (const t of monthExpenseTxs) {
      const m = t.merchantName || 'Unknown';
      map[m] = map[m] || { spent: 0, count: 0 };
      map[m].spent += Number(t.amount || 0);
      map[m].count += 1;
    }
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10);
  }, [monthExpenseTxs]);

  const cashFlow = useMemo(() => {
    // Keep it simple using client-side filter.
    // Burn rate: expenses / days elapsed × remaining days
    const [y, m] = month.split('-').map(Number);
    const now = new Date();
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const totalDays = monthEnd.getDate();

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m - 1;

    const daysElapsed = isCurrentMonth
      ? Math.max(1, Math.floor((today.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      : totalDays;

    const burnPerDay = monthExpense / daysElapsed;
    const remainingDays = Math.max(0, totalDays - daysElapsed);
    const projectedRemaining = burnPerDay * remainingDays;

    return {
      burnRate: burnPerDay,
      projectedRemaining,
      remainingDays,
      daysElapsed,
      totalDays,
    };
  }, [month, monthExpense]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-7 h-7 animate-spin text-gray-500" />
      </div>
    );
  }

  // For UI completeness, we show 3 placeholders for charts/trends derived from same data.
  const lastMonths = (() => {
    // show last 6 months based on current month
    const [y, m] = month.split('-').map(Number);
    const base = new Date(y, m - 1, 1);
    const arr: string[] = [];
    for (let i = 0; i < 6; i++) {
      const dt = new Date(base);
      dt.setMonth(dt.getMonth() - (5 - i));
      arr.push(dt.toISOString().slice(0, 7));
    }
    return arr;
  })();

  const monthlySpendSeries = lastMonths.map((ym) => {
    const spend = txs
      .filter((t) => t.type === 'expense' && ymFromDate(t.date) === ym)
      .reduce((a, t) => a + Number(t.amount || 0), 0);
    return { ym, spend };
  });

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-gray-200">Analytics & Charts</h2>
          <p className="text-xs text-gray-500 mt-1">Real numbers from your Firestore transactions.</p>
        </div>

        <div className="w-[200px]">
          <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-widest">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 w-full p-2 h-10 border border-gray-800 bg-gray-950 rounded-md text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            {lastMonths
              .slice()
              .reverse()
              .map((m) => (
                <option key={m} value={m} className="bg-gray-950 text-gray-300">
                  {m}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-auto pr-1">
        <Card className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm">
          <CardHeader className="px-4 py-3 border-b border-gray-800">
            <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Category breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <DonutChart data={donutData.length ? donutData : [{ label: 'No data', value: 1, color: '#334155' }]} />
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm">
          <CardHeader className="px-4 py-3 border-b border-gray-800">
            <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Cash flow summary</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Income</div>
                <div className="text-lg font-bold text-emerald-300 mt-1">{formatINR(monthIncome)}</div>
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Expenses</div>
                <div className="text-lg font-bold text-rose-300 mt-1">{formatINR(monthExpense)}</div>
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Savings rate</div>
                <div className="text-lg font-bold text-indigo-300 mt-1">{savingsRate.toFixed(1)}%</div>
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Burn projection</div>
                <div className="text-lg font-bold text-orange-300 mt-1">{formatINR(cashFlow.projectedRemaining)}</div>
              </div>
            </div>

            <div className="mt-4 text-xs text-gray-500">
              Burn rate: {formatINR(cashFlow.burnRate)}/day • Days elapsed: {cashFlow.daysElapsed}/{cashFlow.totalDays}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm">
          <CardHeader className="px-4 py-3 border-b border-gray-800">
            <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Top 10 merchants</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {topMerchants.length === 0 ? (
              <div className="text-sm text-gray-500">No expenses for this month yet.</div>
            ) : (
              <div className="space-y-2">
                {topMerchants.map((m) => (
                  <div key={m.name} className="flex items-center justify-between gap-3 bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-200 truncate">{m.name}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{m.count} txns</div>
                    </div>
                    <div className="text-xs font-mono text-gray-400">{formatINR(m.spent)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm">
          <CardHeader className="px-4 py-3 border-b border-gray-800">
            <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Monthly trend</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-2">
              {monthlySpendSeries.map((p) => (
                <div key={p.ym} className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-gray-400">{p.ym}</div>
                  <div className="text-[11px] text-gray-400 font-mono">{formatINR(p.spend)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500">Charts are simplified in this Phase 4 implementation.</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 overflow-auto pr-1">
        <SubscriptionsPanel />
      </div>
    </div>
  );
}
