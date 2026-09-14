'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { Loader2 } from 'lucide-react';

const CATEGORIES = [
  'Income',
  'Food',
  'Groceries',
  'Shopping',
  'Transport',
  'Utilities',
  'Healthcare',
  'Entertainment',
  'Travel',
  'Investments',
  'Insurance',
  'Education',
  'Transfers',
  'Taxes',
  'Rent',
  'EMI',
  'Subscriptions',
  'Miscellaneous',
];

function isoMonth(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function addMonths(yyyyMm: string, delta: number) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() + delta);
  return isoMonth(dt);
}

export default function BudgetTab() {
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [month, setMonth] = useState(() => isoMonth(new Date()));
  const [budget, setBudget] = useState<Record<string, number>>({});
  const [budgetTotal, setBudgetTotal] = useState(0);

  const [spentByCategory, setSpentByCategory] = useState<Record<string, number>>({});
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);

  const [alerts, setAlerts] = useState<{ [cat: string]: '80' | '100' | null }>({});

  const monthExpensesTotal = useMemo(() => {
    return Object.values(spentByCategory).reduce((a, v) => a + Number(v || 0), 0);
  }, [spentByCategory]);

  const daysElapsedInMonth = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const now = new Date();
    // For historical months, approximate days elapsed as full month
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const fullMonthDays = monthEnd.getDate();

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m - 1;

    if (!isCurrentMonth) return fullMonthDays;

    const diff = Math.max(1, Math.floor((today.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    return diff;
  }, [month]);

  const totalDaysInMonth = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const monthEnd = new Date(y, m, 0);
    return monthEnd.getDate();
  }, [month]);

  const projectedOverspend = useMemo(() => {
    const currentSpend = monthExpensesTotal;
    if (daysElapsedInMonth <= 0) return 0;
    const projected = (currentSpend / daysElapsedInMonth) * totalDaysInMonth;
    const totalBudget = budgetTotal || 0;
    return Math.max(0, projected - totalBudget);
  }, [monthExpensesTotal, daysElapsedInMonth, totalDaysInMonth, budgetTotal]);

  const fetchData = async (targetMonth: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const [budgetRes, txRes] = await Promise.all([
        fetch(`/api/budgets?month=${encodeURIComponent(targetMonth)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/transactions`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const budgetJson = budgetRes.ok ? await budgetRes.json() : null;
      const txJson = txRes.ok ? await txRes.json() : [];

      const serverBudget = budgetJson?.budget?.categoryBudgets || {};
      const b: Record<string, number> = {};
      for (const cat of CATEGORIES) b[cat] = Number(serverBudget[cat] || 0);
      setBudget(b);

      const total = Object.values(b).reduce((acc, v) => acc + Number(v || 0), 0);
      setBudgetTotal(total);

      const spent: Record<string, number> = {};
      for (const cat of CATEGORIES) spent[cat] = 0;

      const monthPrefix = `${targetMonth}-`;
      for (const t of txJson || []) {
        if (t?.type !== 'expense') continue;
        if (!String(t?.date || '').startsWith(monthPrefix)) continue;
        const cat = t.category;
        if (!spent[cat] && spent[cat] !== 0) continue;
        spent[cat] = Number(spent[cat] || 0) + Number(t.amount || 0);
      }

      setSpentByCategory(spent);
      setTransactionsLoaded(true);

      // Alerts
      const nextAlerts: any = {};
      for (const cat of CATEGORIES) {
        const bgt = Number(b[cat] || 0);
        const sp = Number(spent[cat] || 0);
        if (bgt <= 0) {
          nextAlerts[cat] = null;
          continue;
        }
        const pct = sp / bgt;
        if (pct >= 1) nextAlerts[cat] = '100';
        else if (pct >= 0.8) nextAlerts[cat] = '80';
        else nextAlerts[cat] = null;
      }
      setAlerts(nextAlerts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    // Avoid calling setState synchronously during the effect body.
    const t = setTimeout(() => {
      fetchData(month);
    }, 0);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const categoryBudgets: Record<string, number> = {};
      for (const cat of CATEGORIES) {
        categoryBudgets[cat] = Number(budget[cat] || 0);
      }

      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ month, categoryBudgets }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error || 'Failed to save budget');
        return;
      }

      await fetchData(month);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPreviousMonth = async () => {
    const prev = addMonths(month, -1);
    setLoading(true);
    try {
      if (!token) return;

      const res = await fetch(`/api/budgets?month=${encodeURIComponent(prev)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = res.ok ? await res.json() : null;
      const prevBud = json?.budget?.categoryBudgets || {};

      const next: Record<string, number> = {};
      for (const cat of CATEGORIES) next[cat] = Number(prevBud[cat] || 0);
      setBudget(next);

      const total = Object.values(next).reduce((a, v) => a + Number(v || 0), 0);
      setBudgetTotal(total);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <Card className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-gray-200">Budget Tracker</h2>
              <p className="text-xs text-gray-500 mt-1">Category-wise monthly budgets with alerts.</p>
            </div>

            <div className="flex gap-2 items-center">
              <div className="w-[170px]">
                <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-widest">Month</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="mt-1 w-full p-2 h-10 border border-gray-800 bg-gray-950 rounded-md text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
                >
                  {Array.from({ length: 7 }).map((_, i) => {
                    const m = addMonths(isoMonth(new Date()), -i);
                    return (
                      <option key={m} value={m} className="bg-gray-950 text-gray-300">
                        {m}
                      </option>
                    );
                  })}
                  <option value={month} className="bg-gray-950 text-gray-300">
                    {month}
                  </option>
                </select>
              </div>

              <Button
                variant="outline"
                className="h-10 text-xs font-semibold bg-gray-900 border border-gray-800 text-gray-300 hover:bg-gray-800"
                onClick={handleCopyPreviousMonth}
                disabled={loading}
              >
                Copy prev month
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs text-gray-500">Projected overspend</p>
                <p className={`text-lg font-bold ${projectedOverspend > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  ₹{projectedOverspend.toLocaleString('en-IN')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 h-9"
                  onClick={handleSave}
                  disabled={saving || loading}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save budgets'}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CATEGORIES.map((cat) => {
                const budgetAmt = Number(budget[cat] || 0);
                const spentAmt = Number(spentByCategory[cat] || 0);
                const pct = budgetAmt > 0 ? spentAmt / budgetAmt : 0;
                const pctLabel =
                  budgetAmt <= 0 ? '—' : `${Math.min(100, Math.round(pct * 100))}%`;

                const barColor =
                  budgetAmt <= 0
                    ? 'bg-gray-700'
                    : pct >= 1
                      ? 'bg-red-500'
                      : pct >= 0.8
                        ? 'bg-yellow-500'
                        : 'bg-emerald-500';

                const alertLevel = alerts[cat];

                return (
                  <div key={cat} className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-gray-200">{cat}</p>
                        <p className="text-[10px] text-gray-500 mt-1">
                          Spent: ₹{spentAmt.toLocaleString('en-IN')} • {pctLabel}
                        </p>
                      </div>

                      {alertLevel && (
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                            alertLevel === '100' ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                          }`}
                        >
                          {alertLevel === '100' ? '100%' : '80%'}
                        </span>
                      )}
                    </div>

                    <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden mt-3">
                      <div
                        className={`h-full ${barColor}`}
                        style={{ width: `${budgetAmt <= 0 ? 0 : Math.min(100, pct * 100)}%` }}
                      />
                    </div>

                    <div className="mt-3">
                      <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-widest">
                        Budget (₹)
                      </label>
                      <Input
                        value={String(budget[cat] ?? 0)}
                        onChange={(e) => {
                          const v = Number(e.target.value || 0);
                          setBudget((prev) => ({ ...prev, [cat]: Number.isFinite(v) ? v : 0 }));
                        }}
                        type="number"
                        min={0}
                        step={100}
                        className="mt-1 bg-gray-950 text-gray-200 border-gray-800 focus:border-indigo-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500">Total budget (all categories)</p>
              <p className="text-sm font-bold text-white">₹{budgetTotal.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!transactionsLoaded && (
        <div className="text-center text-xs text-gray-500 mt-2">
          Loading budget & spend for {month}…
        </div>
      )}
    </div>
  );
}
