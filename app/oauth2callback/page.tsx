'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Loader2 } from 'lucide-react';

function OAuth2CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, loading } = useAuth();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Connecting Gmail...');

  const code = useMemo(() => searchParams.get('code') || '', [searchParams]);
  const oauthState = useMemo(() => searchParams.get('state') || '', [searchParams]);

  useEffect(() => {
    const run = async () => {
      try {
        if (loading) return;
        if (!token) {
          setStatus('error');
          setMessage('Not authenticated. Please sign in again.');
          return;
        }
        if (!code) {
          setStatus('error');
          setMessage('Missing authorization code. Please try again.');
          return;
        }

        const redirectUri = `${window.location.origin}/oauth2callback`;

        const res = await fetch('/api/ingestion/gmail-setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code, redirectUri }),
        });

        const data = await res.json();

        if (!res.ok) {
          setStatus('error');
          setMessage(data?.error || 'Failed to connect Gmail.');
          return;
        }

        if (typeof window !== 'undefined' && oauthState) {
          if (oauthState === 'gmail1') window.localStorage.setItem('gmail1Connected', 'true');
          if (oauthState === 'gmail2') window.localStorage.setItem('gmail2Connected', 'true');
        }

        setStatus('success');
        setMessage('Gmail connected successfully.');
        setTimeout(() => router.push('/'), 1200);
      } catch (err: any) {
        console.error(err);
        setStatus('error');
        setMessage(err?.message || 'Unexpected error connecting Gmail.');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, oauthState, token, loading]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-950 text-gray-100 p-4">
      <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          {status === 'loading' ? (
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
          ) : status === 'success' ? (
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          ) : (
            <div className="w-3 h-3 rounded-full bg-red-400" />
          )}
          <div className="text-sm font-bold">
            {status === 'loading' ? 'Working...' : status === 'success' ? 'Success' : 'Error'}
          </div>
        </div>
        <div className="text-xs text-gray-400 leading-relaxed">{message}</div>
      </div>
    </div>
  );
}

export default function OAuth2CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-gray-950 text-gray-100 p-4">
          <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-xl p-6 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
            <div className="text-sm font-bold">Loading authorization...</div>
          </div>
        </div>
      }
    >
      <OAuth2CallbackContent />
    </Suspense>
  );
}
