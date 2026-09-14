'use client';

import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleAuthProvider } from '@/src/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Dashboard from '@/components/dashboard';
import OnboardingFlow from '@/components/onboarding-flow';
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function Page() {
  const { user, token, loading } = useAuth();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);

  useEffect(() => {
    if (!user || !token) {
      return;
    }

    const check = async () => {
      setCheckingOnboarding(true);
      try {
        const res = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setOnboardingComplete(Boolean(data?.onboardingComplete));
        } else {
          setOnboardingComplete(false);
        }
      } catch {
        setOnboardingComplete(false);
      } finally {
        setCheckingOnboarding(false);
      }
    };

    check();
  }, [user, token]);

  const handleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        localStorage.setItem('googleAccessToken', credential.accessToken);
      }
    } catch (error) {
      console.error('Error signing in:', error);
    }
  };

  if (loading || checkingOnboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
        <Card className="w-full max-w-md border-gray-800 bg-gray-900">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold tracking-tight text-white">Artha Kosha</CardTitle>
            <CardDescription className="text-gray-400 mt-2">
              Your autonomous personal accountant. Track, categorize, and grow your wealth effortlessly.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center flex-col gap-4 mt-4">
            <Button onClick={handleSignIn} size="lg" className="w-full font-medium bg-indigo-600 hover:bg-indigo-700 text-white">
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (onboardingComplete === false) {
    return <OnboardingFlow onComplete={() => setOnboardingComplete(true)} />;
  }

  return <Dashboard />;
}
