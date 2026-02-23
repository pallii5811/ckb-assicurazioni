import type { Metadata } from 'next'
import './globals.css'
import ToastProvider from '@/components/ToastProvider'
import CookieConsent from '@/components/CookieConsent'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  title: "MIRAX | Trova Aziende con Problemi Digitali",
  description: "Il motore di ricerca intelligente per lead B2B italiani. Trova aziende con problemi digitali e chiudi clienti in meno di 2 minuti.",
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body
        className="antialiased"
      >
        <ToastProvider>
          {children}
          <CookieConsent />
          <Analytics />
        </ToastProvider>
      </body>
    </html>
  );
}
