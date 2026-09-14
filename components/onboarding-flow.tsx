'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useNotifications } from './notification-provider';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
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

type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;

function mkSecret() {
  // Simple random secret for webhook auth. (Length chosen for readability.)
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fetchJson(url: string, token: string, options: RequestInit = {}) {
  const res = fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res.then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || 'Request failed');
    return data;
  });
}

export default function OnboardingFlow({ onComplete }: { onComplete?: () => void }) {
  const { user, token, loading } = useAuth();
  const { addToast } = useNotifications();

  const [step, setStep] = useState<OnboardingStep>(1);

  const [oauthLoading, setOauthLoading] = useState<'gmail1' | 'gmail2' | null>(null);
  const [gmail1Connected, setGmail1Connected] = useState(false);
  const [gmail2Connected, setGmail2Connected] = useState(false);

  const [smsSecret, setSmsSecret] = useState<string | null>(null);
  const [smsSaved, setSmsSaved] = useState(false);
  const [smsSaving, setSmsSaving] = useState(false);

  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<'credit_card' | 'savings' | 'wallet'>('savings');
  const [accountBank, setAccountBank] = useState<'RBL' | 'ICICI' | 'SBI' | 'Kotak' | 'IndusInd' | 'Axis' | 'Unknown'>('SBI');
  const [accountLastFour, setAccountLastFour] = useState('');
  const [accountCreditLimit, setAccountCreditLimit] = useState<string>('');
  const [accountCurrentBalance, setAccountCurrentBalance] = useState<string>('0');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [budgetAmounts, setBudgetAmounts] = useState<Record<string, string>>({});

  const [savingDone, setSavingDone] = useState(false);

  const hasSmsSecret = Boolean(smsSecret);
  const canProceedStep2 = gmail1Connected || gmail2Connected;
  const canProceedStep3 = smsSaved;

  const canAddAccount = accountName.trim() && accountBank && accountLastFour.trim().length === 4;

  useEffect(() => {
    const run = () => {
      const s1 = typeof window !== 'undefined' ? window.localStorage.getItem('gmail1Connected') : null;
      const s2 = typeof window !== 'undefined' ? window.localStorage.getItem('gmail2Connected') : null;
      setGmail1Connected(s1 === 'true');
      setGmail2Connected(s2 === 'true');
    };
    setTimeout(run, 0);
  }, []);

  useEffect(() => {
    if (!token) return;
    const run = async () => {
      try {
        setAccountsLoading(true);
        const res = await fetch('/api/accounts', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data?.accounts)) setAccounts(data.accounts);
      } catch {
        // ignore
      } finally {
        setAccountsLoading(false);
      }
    };
    run();
  }, [token]);

  useEffect(() => {
    const run = () => {
      // init budget defaults once
      if (Object.keys(budgetAmounts).length > 0) return;

      const base: Record<string, string> = {};
      for (const c of CATEGORIES) base[c] = '';
      base['Food'] = '0';
      base['Groceries'] = '0';
      base['Shopping'] = '0';
      base['Utilities'] = '0';
      base['Transport'] = '0';
      base['Subscriptions'] = '0';
      base['Miscellaneous'] = '0';
      base['Rent'] = '0';
      base['EMI'] = '0';
      base['Healthcare'] = '0';
      base['Entertainment'] = '0';
      base['Travel'] = '0';
      setBudgetAmounts(base);
    };
    setTimeout(run, 0);
  }, [budgetAmounts]);

  const beginGmailOAuth = async (which: 'gmail1' | 'gmail2') => {
    if (!token) return;
    setOauthLoading(which);
    
    // Open a blank popup immediately to avoid popup blockers
    const popup = window.open('', '_blank', 'width=500,height=600');
    
    try {
      const state = which === 'gmail1' ? 'gmail1' : 'gmail2';
      const res = await fetch(`/api/ingestion/oauth-start?state=${encodeURIComponent(state)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to start OAuth');

      // Redirect the popup to Google
      if (popup) {
        popup.location.href = data.url;
      } else {
        // Fallback if popup was blocked
        window.open(data.url, '_blank', 'width=500,height=600');
      }
    } catch (err) {
      if (popup) popup.close();
    } finally {
      setOauthLoading(null);
    }
  };

  const ensureSecret = () => {
    if (!smsSecret) setSmsSecret(mkSecret());
  };

  const saveSmsSecret = async () => {
    if (!token) return;
    if (!smsSecret) return;

    setSmsSaving(true);
    try {
      await fetchJson('/api/onboarding', token, {
        method: 'POST',
        body: JSON.stringify({ smsWebhookSecret: smsSecret }),
      });
      setSmsSaved(true);
      addToast({ title: 'SMS forwarding saved', message: 'Webhook secret stored successfully.', kind: 'success' });
    } catch (e: any) {
      addToast({ title: 'Failed to save SMS secret', message: e?.message || 'Unknown error', kind: 'error' });
      throw e;
    } finally {
      setSmsSaving(false);
    }
  };

  const addAccount = async () => {
    if (!token) return;
    if (!canAddAccount) return;

    setAccountsLoading(true);
    try {
      const res = await fetchJson('/api/accounts', token, {
        method: 'POST',
        body: JSON.stringify({
          name: accountName.trim(),
          type: accountType,
          bank: accountBank,
          lastFourDigits: accountLastFour.trim(),
          creditLimit: accountType === 'credit_card' ? Number(accountCreditLimit || 0) : undefined,
          currentBalance: Number(accountCurrentBalance || 0),
          isActive: true,
        }),
      });

      addToast({ title: 'Account added', message: 'Account saved to Firestore.', kind: 'success' });
      // refresh accounts
      const res2 = await fetch('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
      const data2 = await res2.json().catch(() => ({}));
      if (Array.isArray(data2?.accounts)) setAccounts(data2.accounts);

      // reset fields
      setAccountName('');
      setAccountLastFour('');
      setAccountCreditLimit('');
      setAccountCurrentBalance('0');
    } finally {
      setAccountsLoading(false);
    }
  };

  const saveBudget = async () => {
    if (!token) return;

    const monthId = month;
    const categoryBudgets: Record<string, number> = {};
    for (const [cat, v] of Object.entries(budgetAmounts)) {
      const num = v === '' ? 0 : Number(v);
      categoryBudgets[cat] = Number.isFinite(num) ? num : 0;
    }

    await fetchJson('/api/budgets', token, {
      method: 'POST',
      body: JSON.stringify({ month: monthId, categoryBudgets }),
    });

    addToast({ title: 'Budget saved', message: `Budget stored for ${monthId}.`, kind: 'success' });
  };

  const done = async () => {
    if (!token) return;
    setSavingDone(true);
    try {
      await fetchJson('/api/onboarding', token, {
        method: 'POST',
        body: JSON.stringify({ onboardingComplete: true }),
      });
      addToast({ title: 'All set!', message: 'Onboarding completed.', kind: 'success' });
      onComplete?.();
      setTimeout(() => window.location.reload(), 800);
    } finally {
      setSavingDone(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 flex flex-col items-center">
      <div className="w-full max-w-3xl">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-xl">Welcome{user?.displayName ? `, ${user.displayName}` : ''} 👋</CardTitle>
            <CardDescription className="text-gray-400">
              Let’s set up your personal accountant.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <button
                  key={s}
                  onClick={() => setStep(s as OnboardingStep)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                    step === s ? 'bg-indigo-600/20 border-indigo-400/30 text-indigo-200' : 'bg-gray-950/30 border-gray-800 text-gray-400'
                  }`}
                  disabled={
                    s === 2 ? !canProceedStep2 : s === 3 ? !canProceedStep3 : false
                  }
                >
                  Step {s}
                </button>
              ))}
            </div>

            {step === 1 && (
              <div className="space-y-3">
                <div className="text-sm text-gray-300">
                  This takes a few minutes. We’ll connect Gmail (2 accounts), set SMS forwarding, and configure accounts + budget.
                </div>
                <Button onClick={() => setStep(2)}>Start</Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="text-sm text-gray-300">Connect your 2 Gmail accounts for automatic transaction ingestion.</div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold">Gmail Account 1</div>
                      <div className="text-xs text-gray-400">{gmail1Connected ? 'Connected ✓' : 'Not connected yet'}</div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => beginGmailOAuth('gmail1')}
                      disabled={oauthLoading !== null}
                    >
                      {oauthLoading === 'gmail1' ? 'Connecting...' : 'Connect Gmail 1'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold">Gmail Account 2</div>
                      <div className="text-xs text-gray-400">{gmail2Connected ? 'Connected ✓' : 'Not connected yet'}</div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => beginGmailOAuth('gmail2')}
                      disabled={oauthLoading !== null}
                    >
                      {oauthLoading === 'gmail2' ? 'Connecting...' : 'Connect Gmail 2'}
                    </Button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                  <Button onClick={() => setStep(3)} disabled={!canProceedStep2}>
                    Continue
                  </Button>
                  {!gmail2Connected && (
                    <Button variant="ghost" onClick={() => setStep(3)}>
                      Skip Secondary Gmail
                    </Button>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="text-sm text-gray-300">
                  Setup SMS forwarding using MacroDroid. We’ll use a secret to authenticate incoming webhooks.
                </div>

                <div className="space-y-2 bg-gray-950/30 border border-gray-800 rounded-xl p-4">
                  <div className="text-xs font-bold text-gray-300">Webhook Secret</div>
                  <div className="text-xs text-gray-400 break-all">
                    {smsSecret || 'Generate a secret to use in MacroDroid'}
                  </div>
                  <div className="flex gap-3 mt-2">
                    <Button variant="secondary" onClick={ensureSecret}>
                      Generate Secret
                    </Button>
                    <Button
                      onClick={saveSmsSecret}
                      disabled={!smsSecret || smsSaving}
                    >
                      {smsSaving ? 'Saving...' : smsSaved ? 'Saved ✓' : 'Save Secret'}
                    </Button>
                  </div>
                </div>

                <Card className="bg-gray-950/20 border-gray-800">
                  <CardContent className="space-y-2">
                    <div className="text-xs font-bold text-gray-300">MacroDroid HTTP Request (POST)</div>
                    <div className="text-[11px] text-gray-400 leading-relaxed">
                      URL: <span className="text-gray-200">/api/ingestion/sms-webhook</span> (use your deployed domain)<br />
                      Method: POST<br />
                      Content-Type: application/json<br />
                      Body:<br />
                      <pre className="text-[10px] whitespace-pre-wrap text-gray-300">
{"{ \"sender\": \"[sender_number]\", \"body\": \"[sms_body]\", \"timestamp\": 1718450000000, \"authToken\": \"YOUR_SECRET_HERE\" }"}
                      </pre>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Note: QR rendering is intentionally omitted here to avoid new dependencies; copy the config manually.
                    </div>
                  </CardContent>
                </Card>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                  <Button onClick={() => setStep(4)} disabled={!canProceedStep3}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="text-sm text-gray-300">Add your bank accounts and credit cards.</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name (e.g., SBI Savings)" />
                  <Select value={accountType} onValueChange={(v) => setAccountType(v as any)}>
                    <SelectTrigger className="w-full bg-transparent border border-gray-800 rounded-lg px-3 py-2 text-xs">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="savings">Savings</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="wallet">Wallet</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={accountBank} onValueChange={(v) => setAccountBank(v as any)}>
                    <SelectTrigger className="w-full bg-transparent border border-gray-800 rounded-lg px-3 py-2 text-xs">
                      <SelectValue placeholder="Bank" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SBI">SBI</SelectItem>
                      <SelectItem value="ICICI">ICICI</SelectItem>
                      <SelectItem value="RBL">RBL</SelectItem>
                      <SelectItem value="Kotak">Kotak</SelectItem>
                      <SelectItem value="IndusInd">IndusInd</SelectItem>
                      <SelectItem value="Axis">Axis</SelectItem>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input value={accountLastFour} onChange={(e) => setAccountLastFour(e.target.value)} placeholder="Last 4 digits" />
                  <Input
                    value={accountCreditLimit}
                    onChange={(e) => setAccountCreditLimit(e.target.value)}
                    placeholder={accountType === 'credit_card' ? 'Credit limit (optional)' : 'Credit limit (n/a)'}
                    disabled={accountType !== 'credit_card'}
                  />
                  <Input value={accountCurrentBalance} onChange={(e) => setAccountCurrentBalance(e.target.value)} placeholder="Current balance" />
                </div>

                <div className="flex gap-3">
                  <Button onClick={addAccount} disabled={accountsLoading || !canAddAccount}>
                    {accountsLoading ? 'Saving...' : 'Add Account'}
                  </Button>
                </div>

                <div className="text-xs text-gray-500">
                  Added accounts: {accounts.length}
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
                  <Button onClick={() => setStep(5)}>Continue</Button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <div className="text-sm text-gray-300">Set category-wise monthly budget.</div>

                <div className="flex gap-3 items-center">
                  <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
                  <Button variant="secondary" onClick={() => addToast({ message: 'Copy from previous month is omitted in minimal Phase 7 UI.' })}>
                    Copy prev
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {CATEGORIES.filter((c) => c !== 'Income' && c !== 'Transfers' && c !== 'Miscellaneous').slice(0, 10).map((cat) => (
                    <div key={cat} className="flex items-center justify-between gap-3 bg-gray-950/20 border border-gray-800 rounded-lg px-3 py-2">
                      <div className="text-xs font-bold text-gray-200">{cat}</div>
                      <Input
                        value={budgetAmounts[cat] ?? ''}
                        onChange={(e) => setBudgetAmounts((prev) => ({ ...prev, [cat]: e.target.value }))}
                        placeholder="0"
                        className="w-28"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <Button onClick={saveBudget}>Save Budget</Button>
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(4)}>Back</Button>
                  <Button onClick={() => setStep(6)}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-4">
                <div className="text-sm text-gray-300">Confirm to finish onboarding.</div>
                <div className="text-xs text-gray-500 leading-relaxed">
                  After this, Artha Kosha will start tracking transactions automatically from Gmail and your SMS webhook.
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(5)}>Back</Button>
                  <Button onClick={done} disabled={savingDone}>
                    {savingDone ? 'Completing...' : 'Done'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
