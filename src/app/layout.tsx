import type { Metadata } from 'next'
import './globals.css'
import ToastProvider from '@/components/ToastProvider'
import CookieConsent from '@/components/CookieConsent'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  metadataBase: new URL('https://mirax.it'),
  title: {
    default: 'MIRAX | Trova Aziende con Problemi Digitali',
    template: '%s | MIRAX',
  },
  description: 'Il motore di ricerca intelligente per lead B2B italiani. Trova aziende con problemi digitali e chiudi clienti in meno di 2 minuti.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    url: 'https://mirax.it',
    siteName: 'MIRAX',
    title: 'MIRAX | Lead B2B Qualificati per Agency Italiane',
    description: 'Trova aziende con problemi digitali e chiudi clienti in meno di 2 minuti. Pitch AI incluso.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MIRAX | Lead B2B per Agency Italiane',
    description: 'Dal target al pitch in meno di 2 minuti. Nessuna lista fredda.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-video-preview': -1, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: {
    canonical: 'https://mirax.it',
  },
  verification: {
    google: 'INSERISCI_GOOGLE_VERIFICATION_CODE',
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
