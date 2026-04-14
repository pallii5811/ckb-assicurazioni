import type { Metadata } from 'next'
import './globals.css'
import ToastProvider from '@/components/ToastProvider'
import CookieConsent from '@/components/CookieConsent'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  metadataBase: new URL('https://ckbassicurazione.it'),
  title: {
    default: 'CKB Assicurazione | Intelligence per Broker e Consulenti Assicurativi',
    template: '%s | CKB Assicurazione',
  },
  description: 'La piattaforma di intelligence assicurativa per broker e consulenti. Trova aziende, analizza rischi, genera proposte personalizzate.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    url: 'https://ckbassicurazione.it',
    siteName: 'CKB Assicurazione',
    title: 'CKB Assicurazione | Intelligence per Broker Assicurativi',
    description: 'Trova aziende, analizza gap assicurativi, genera proposte commerciali su misura. Il software n.1 per intermediari.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CKB Assicurazione | Intelligence per Broker',
    description: 'Dall\'analisi del rischio alla proposta commerciale in pochi minuti.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-video-preview': -1, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: {
    canonical: 'https://ckbassicurazione.it',
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
