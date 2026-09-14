'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Register service worker if not already registered
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.error('ServiceWorker registration failed: ', err);
        });
      });
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Check if we should show it (e.g., not previously dismissed)
      const hasDismissed = localStorage.getItem('artha_kosha_pwa_dismissed');
      if (!hasDismissed) {
        setShowPrompt(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem('artha_kosha_pwa_dismissed', 'true');
    setShowPrompt(false);
  };

  return (
    <Dialog open={showPrompt} onOpenChange={(open) => {
      if (!open) handleDismiss();
      else setShowPrompt(true);
    }}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Download className="w-5 h-5 text-indigo-400" />
            Install Artha Kosha
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Install the Artha Kosha app on your device for a faster, full-screen experience and easy access to your financial dashboard.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" onClick={handleDismiss} className="w-full sm:w-auto bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800 hover:text-white">
            Not now
          </Button>
          <Button onClick={handleInstall} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white">
            Install App
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
