'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, Plus, IndianRupee, TrendingUp, CreditCard, PieChart, RefreshCw, Loader2 } from 'lucide-react';
import { auth } from '@/src/lib/firebase';
import { signOut } from 'firebase/auth';
import TransactionsTab from './transactions-tab';
import InsightsTab from './insights-tab';
import BudgetTab from './budget-tab';
import AnalyticsTab from './analytics-tab';

export default function Dashboard() {
  const { user, token } = useAuth();
  const [activeSection, setActiveSection] = useState('dashboard');

  const [currentBalance, setCurrentBalance] = useState(0);
  const [isSyncingBalance, setIsSyncingBalance] = useState(false);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [creditUsage, setCreditUsage] = useState(0);
  const [creditCardCount, setCreditCardCount] = useState(0);
  const [recentTx, setRecentTx] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;

    const run = async () => {
      // Accounts total balance & credit utilization
      const accRes = await fetch('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
      if (accRes.ok) {
        const accJson = await accRes.json();
        setCurrentBalance(Number(accJson?.totalBalance || 0));

        const ccAccounts = (accJson?.accounts || []).filter((a: any) => a.type === 'credit_card' && a.isActive);
        const totalLimit = ccAccounts.reduce((acc: number, a: any) => acc + Number(a.creditLimit || 0), 0);
        const totalUsed = ccAccounts.reduce((acc: number, a: any) => acc + Math.abs(Number(a.currentBalance || 0)), 0);
        if (totalLimit > 0) {
          setCreditUsage(Math.round((totalUsed / totalLimit) * 100));
        } else {
          setCreditUsage(0);
        }
        setCreditCardCount(ccAccounts.length);
      }

      // Transactions for current month + recent activity
      const txRes = await fetch('/api/transactions', { headers: { Authorization: `Bearer ${token}` } });
      const txJson = txRes.ok ? await txRes.json() : [];

      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      if (Array.isArray(txJson)) {
        const monthTx = txJson.filter((t: any) => String(t?.date || '').startsWith(`${ym}-`));
        const spend = monthTx.filter((t: any) => t.type === 'expense').reduce((acc: number, t: any) => acc + Number(t.amount || 0), 0);
        const income = monthTx.filter((t: any) => t.type === 'income').reduce((acc: number, t: any) => acc + Number(t.amount || 0), 0);

        setMonthlySpend(spend);
        setMonthlyIncome(income);

        // Recent activity (last 5 by date desc already from API, but keep safe)
        setRecentTx((txJson || []).slice(0, 5));
      }
    };

    run().catch(console.error);
  }, [token]);

  const savingsRate = useMemo(() => {
    const income = monthlyIncome || 0;
    if (income <= 0) return '0.0';
    const net = income - (monthlySpend || 0);
    return (net / income * 100).toFixed(1);
  }, [monthlyIncome, monthlySpend]);

  const handleSyncBalance = async () => {
    setIsSyncingBalance(true);
    try {
      // Keep existing UX without adding new ingestion. Re-fetch accounts.
      const accRes = await fetch('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
      if (accRes.ok) {
        const accJson = await accRes.json();
        setCurrentBalance(Number(accJson?.totalBalance || 0));
      }
    } finally {
      setIsSyncingBalance(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-950 text-gray-100 font-sans overflow-hidden">
      {/* Sidebar from theme */}
      <aside className="hidden md:flex w-16 bg-gray-900 flex-col items-center py-6 gap-8 border-r border-gray-800 shrink-0">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl mb-4">F</div>
        <div className="flex flex-col gap-6">
          <div onClick={() => setActiveSection('dashboard')} className={`p-2 rounded-lg cursor-pointer ${activeSection === 'dashboard' ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-400 hover:text-white'}`}><PieChart className="w-6 h-6" /></div>
          <div onClick={() => setActiveSection('accounts')} className={`p-2 rounded-lg cursor-pointer ${activeSection === 'accounts' ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-400 hover:text-white'}`}><CreditCard className="w-6 h-6" /></div>
          <div onClick={() => setActiveSection('analytics')} className={`p-2 rounded-lg cursor-pointer ${activeSection === 'analytics' ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-400 hover:text-white'}`}><TrendingUp className="w-6 h-6" /></div>
        </div>
        <div className="mt-auto mb-6">
          <div className="w-8 h-8 rounded-full bg-indigo-900 border-2 border-indigo-500 flex items-center justify-center cursor-pointer" onClick={() => { localStorage.removeItem('googleAccessToken'); signOut(auth); }}>
            <LogOut className="w-4 h-4 text-indigo-300 ml-0.5" />
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden mb-16 md:mb-0">
        <div className="w-full max-w-7xl mx-auto flex flex-col h-full">
          {/* Header */}
          <header className="flex justify-between items-start sm:items-end mb-6 shrink-0 flex-col sm:flex-row gap-4 sm:gap-0">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white font-sans">
                Welcome back, {user?.displayName?.split(' ')[0] || 'User'}
              </h1>
              <p className="text-sm text-gray-400 mt-1">AI analyzed your recent transactions.</p>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <Button variant="outline" className="flex-1 sm:flex-none px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-xs font-semibold uppercase tracking-wider text-gray-300 hover:bg-gray-800 shadow-sm" onClick={() => { localStorage.removeItem('googleAccessToken'); signOut(auth); }}>
                Sign Out
              </Button>
              <Button className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold uppercase tracking-wider shadow-md hover:bg-indigo-700">
                <Plus className="w-4 h-4 mr-2" /> Data
              </Button>
            </div>
          </header>

          {activeSection === 'dashboard' && (
            <>
              {/* Overview Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 shrink-0">
                <StatCard 
                   title="Current Balance (SBI)" 
                   value={`₹${currentBalance.toLocaleString('en-IN')}`} 
                   valClass="text-emerald-400" 
                   subtitle="Direct Deposit Detected" 
                   subtitleClass="text-[10px] text-gray-500 mt-2 italic"
                   actionIcon={isSyncingBalance ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" /> : <RefreshCw className="w-4 h-4 text-gray-400 hover:text-emerald-400 cursor-pointer" />}
                   onAction={handleSyncBalance}
                />
                <StatCard 
                   title="Monthly Spend" 
                   value={`₹${monthlySpend.toLocaleString('en-IN')}`} 
                   valClass="text-white" 
                   progress={true} 
                />
                <StatCard title="Savings Rate" value={`${savingsRate}%`} valClass="text-indigo-400" subtitle="Estimated vs Spend" subtitleClass="text-[10px] text-emerald-400 mt-2" />
                <StatCard 
                  title="Credit Usage" 
                  value={`${creditUsage}%`} 
                  valClass={creditUsage > 80 ? "text-red-400" : creditUsage > 50 ? "text-orange-400" : "text-emerald-400"} 
                  subtitle={`Across ${creditCardCount} card${creditCardCount !== 1 ? 's' : ''}`} 
                  subtitleClass="text-[10px] text-gray-500 mt-2" 
                />
              </div>

              {/* Main Content Tabs */}
              <Tabs defaultValue="transactions" className="w-full flex-1 flex flex-col overflow-hidden">
                <TabsList className="mb-4 self-start shrink-0 bg-gray-900 border border-gray-800">
                  <TabsTrigger value="transactions" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400">Transactions</TabsTrigger>
                  <TabsTrigger value="insights" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400">Insights</TabsTrigger>
                  <TabsTrigger value="budget" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400">Budget</TabsTrigger>
                  <TabsTrigger value="analytics" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400">Analytics</TabsTrigger>
                </TabsList>
                
                <TabsContent value="transactions" className="flex-1 overflow-hidden m-0 data-[state=active]:flex data-[state=active]:flex-col">
                  <TransactionsTab />
                </TabsContent>
                <TabsContent value="insights" className="flex-1 overflow-y-auto m-0">
                  <InsightsTab currentBalance={currentBalance} />
                </TabsContent>
                <TabsContent value="budget" className="flex-1 overflow-y-auto m-0">
                  <BudgetTab />
                </TabsContent>
                <TabsContent value="analytics" className="flex-1 overflow-y-auto m-0">
                  <AnalyticsTab />
                </TabsContent>
              </Tabs>
            </>
          )}

          {activeSection === 'accounts' && (
             <div className="flex-1 bg-gray-900 p-6 rounded-xl border border-gray-800 flex items-center justify-center text-gray-500">
                Account Management Module (Coming Soon)
             </div>
          )}

          {activeSection === 'analytics' && (
             <div className="flex-1 bg-gray-900 p-6 rounded-xl border border-gray-800 flex items-center justify-center text-gray-500">
                Advanced Analytics Module (Coming Soon)
             </div>
          )}

        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 w-full bg-gray-900 border-t border-gray-800 flex justify-around p-3 pb-safe z-50">
        <div onClick={() => setActiveSection('dashboard')} className={`p-2 flex flex-col items-center gap-1 cursor-pointer ${activeSection === 'dashboard' ? 'text-indigo-400' : 'text-gray-500'}`}>
          <PieChart className="w-5 h-5" />
          <span className="text-[10px] uppercase font-bold">Home</span>
        </div>
        <div onClick={() => setActiveSection('accounts')} className={`p-2 flex flex-col items-center gap-1 cursor-pointer ${activeSection === 'accounts' ? 'text-indigo-400' : 'text-gray-500'}`}>
          <CreditCard className="w-5 h-5" />
          <span className="text-[10px] uppercase font-bold">Cards</span>
        </div>
        <div onClick={() => setActiveSection('analytics')} className={`p-2 flex flex-col items-center gap-1 cursor-pointer ${activeSection === 'analytics' ? 'text-indigo-400' : 'text-gray-500'}`}>
          <TrendingUp className="w-5 h-5" />
          <span className="text-[10px] uppercase font-bold">Stats</span>
        </div>
      </nav>
    </div>
  );
}

function StatCard({ title, value, valClass, progress, subtitle, subtitleClass, actionIcon, onAction }: any) {
  return (
    <div className="bg-gray-900 p-4 rounded-xl border border-gray-800 shadow-sm flex flex-col justify-center">
      <div className="flex justify-between items-center mb-1">
        <p className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest truncate">{title}</p>
        {actionIcon && (
           <div onClick={onAction}>{actionIcon}</div>
        )}
      </div>
      <p className={`text-xl sm:text-2xl font-bold ${valClass}`}>{value}</p>
      {progress && (
        <div className="h-1.5 w-full bg-gray-800 rounded-full mt-3 overflow-hidden">
          <div className="bg-indigo-500 h-full w-2/3"></div>
        </div>
      )}
      {subtitle && (
        <p className={subtitleClass}>{subtitle}</p>
      )}
    </div>
  );
}
