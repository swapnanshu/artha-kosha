'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

type SubscriptionRow = {
  id: string;
  merchantName: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'quarterly' | 'weekly';
  nextExpectedDate: string;
  isActive: boolean;
};

export default function SubscriptionsPanel() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);

  const [detecting, setDetecting] = useState(false);

  const fetchSubs = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSubs(data?.subscriptions || []);
    } finally {
      setLoading(false);
    }
  };

  const handleDetect = async () => {
    if (!token) return;
    setDetecting(true);
    try {
      await fetch('/api/subscriptions/detect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchSubs();
    } catch (err) {
      console.error('Failed to detect subscriptions:', err);
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => {
      fetchSubs();
    }, 0);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const act = async (id: string, action: 'pause' | 'cancel') => {
    if (!token) return;
    const res = await fetch('/api/subscriptions', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id, action }),
    });

    if (!res.ok) return;
    await fetchSubs();
  };

  const active = subs.filter((s) => s.isActive);

  return (
    <Card className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm">
      <CardHeader className="px-4 py-3 border-b border-gray-800 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Subscriptions</CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] bg-gray-950/60 border-gray-800 text-gray-300 hover:bg-gray-800"
          onClick={handleDetect}
          disabled={detecting || loading}
        >
          {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          {detecting ? 'Scanning...' : 'Scan Subscriptions'}
        </Button>
      </CardHeader>
      <CardContent className="p-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : active.length === 0 ? (
          <div className="text-sm text-gray-500">No active subscriptions detected yet.</div>
        ) : (
          <div className="space-y-3">
            {active.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                <div>
                  <div className="text-sm font-bold text-gray-200">{s.merchantName}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    ₹{Number(s.amount || 0).toLocaleString('en-IN')} • {s.frequency}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1">Next: {s.nextExpectedDate}</div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="h-8 px-2 text-[11px] border-gray-800 bg-gray-900 hover:bg-gray-800 text-gray-200"
                    onClick={() => act(s.id, 'pause')}
                  >
                    Pause
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 px-2 text-[11px] border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-red-300"
                    onClick={() => act(s.id, 'cancel')}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
