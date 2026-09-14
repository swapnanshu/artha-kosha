import type { Metadata } from 'next';
import './globals.css';
import { Inter, Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { NotificationProvider } from '@/components/notification-provider';
import PwaInstallPrompt from '@/components/pwa-install-prompt';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

export const metadata: Metadata = {
  title: 'Artha Kosha',
  description: 'Sanskrit inspired AI-powered personal finance assistant',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Artha Kosha',
  },
  icons: {
    apple: '/icon-192.png',
  },
};

export const viewport = {
  themeColor: '#030712',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${space.variable}`}>
      <body suppressHydrationWarning className="font-sans text-gray-100 bg-gray-950 flex flex-col min-h-screen antialiased">
        <NotificationProvider>
          <AuthProvider>
            {children}
            <PwaInstallPrompt />
          </AuthProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
