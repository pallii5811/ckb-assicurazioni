import type { Metadata } from 'next'
import LandingFooter from '@/components/landing/LandingFooter'
import ArsenalSection from '@/components/landing/ArsenalSection'
import FaqComplianceSection from '@/components/landing/FaqComplianceSection'
import HeroSection from '@/components/landing/HeroSection'
import HowItWorks from '@/components/landing/HowItWorks'
import ImpactStatsSection from '@/components/landing/ImpactStatsSection'
import LandingNavbar from '@/components/landing/LandingNavbar'
import PricingSection from '@/components/landing/PricingSection'
import SocialProofBar from '@/components/landing/SocialProofBar'
import ProductShowcase from '@/components/landing/ProductShowcase'
import { LogoBarSection } from '@/components/landing/LogoBarSection'
import { TestimonialSection } from '@/components/landing/TestimonialSection'
import { VsSection } from '@/components/landing/VsSection'
import { ScrollAnimationObserver } from '@/components/ui/use-scroll-animation'
import { ROICalculator } from '@/components/landing/roi-calculator'
import { UseCases } from '@/components/landing/use-cases'
import { Guarantee } from '@/components/landing/guarantee'
import { TrustBadges } from '@/components/landing/trust-badges'

export const metadata: Metadata = {
  title: 'MIRAX | Trova Aziende con Problemi Digitali in 2 Minuti',
  description:
    'MIRAX analizza milioni di aziende italiane e ti consegna una lista di potenziali clienti con problemi tecnici reali. Per agenzie, freelance e consulenti digitali.',
  keywords: [
    'lead generation italia',
    'trovare clienti agenzia',
    'outbound b2b italia',
    'audit seo automatico',
    'prospecting agency italiana',
    'lead qualificati ricerca intelligente',
    'pitch ai vendita',
    'crm lead agency',
    'lead generation b2b',
    'trovare clienti online',
    'software lead generation italiano',
    'agenzia marketing trovare clienti',
    'lead qualificati italia',
    'generare contatti b2b',
    'strumento prospecting italia',
    'email marketing b2b italia',
    'audit sito web automatico',
    'trovare aziende senza sito',
    'contatti aziende italiane',
    'database aziende italia',
    'ricerca lead freelance',
    'consulente digitale lead',
    'scraping lead legale gdpr',
  ],
  openGraph: {
    title: 'Mirax — Lead B2B Qualificati per Agency Italiane',
    description: 'Trova aziende con problemi digitali e chiudi clienti in meno di 2 minuti. Pitch AI incluso.',
    url: 'https://mirax.it',
    siteName: 'Mirax',
    locale: 'it_IT',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mirax — Lead B2B per Agency Italiane',
    description: 'Dal target al pitch in meno di 2 minuti. Nessuna lista fredda.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: 'https://mirax.it',
  },
}

export default function Home() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'MIRAX',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: 'https://mirax.it',
    description:
      "MIRAX è il motore di ricerca intelligente per lead B2B italiani. Trova aziende con problemi digitali (SEO, pixel, DMARC), le profila in tempo reale e genera pitch AI personalizzati. Dal target al contatto qualificato in meno di 2 minuti.",
    offers: [
      {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'EUR',
        name: 'Esplora',
        description: 'Piano gratuito con 10 lead',
      },
      {
        '@type': 'Offer',
        price: '29',
        priceCurrency: 'EUR',
        name: 'Starter',
        description: '500 crediti al mese per freelance e consulenti',
      },
      {
        '@type': 'Offer',
        price: '99',
        priceCurrency: 'EUR',
        name: 'PRO',
        description: '3000 crediti al mese con Pitch AI e email decision maker',
      },
      {
        '@type': 'Offer',
        price: '249',
        priceCurrency: 'EUR',
        name: 'Agency',
        description: '10000 crediti al mese con API e integrazioni CRM',
      },
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      ratingCount: '200',
      bestRating: '5',
    },
  }

  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'MIRAX',
    url: 'https://mirax.it',
    logo: 'https://mirax.it/mirax-logo.svg',
    description: 'Il motore di intelligence B2B più potente d\'Italia. Trova, analizza e chiudi clienti in 2 minuti.',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'supporto@mirax.it',
      contactType: 'customer service',
      availableLanguage: 'Italian',
    },
    sameAs: [],
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Da dove provengono i dati?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'I dati provengono da directory pubbliche italiane e fonti pubbliche verificate, aggiornati in tempo reale. Nessun dato acquistato da terze parti.',
        },
      },
      {
        '@type': 'Question',
        name: 'I numeri di telefono sono reali?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sì. Il nostro algoritmo distingue cellulari da fissi e verifica ogni numero mobile. Zero sprechi di crediti su numeri spenti o centralini.',
        },
      },
      {
        '@type': 'Question',
        name: 'Come funzionano i crediti?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Ogni ricerca consuma crediti in base ai lead restituiti. I crediti si rinnovano ogni mese. Non si accumulano ma non scadono a metà mese.',
        },
      },
      {
        '@type': 'Question',
        name: "Posso cancellare l'abbonamento?",
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sì, in qualsiasi momento con un click. Nessun vincolo contrattuale. Garanzia 14 giorni soddisfatti o rimborsati su tutti i piani.',
        },
      },
      {
        '@type': 'Question',
        name: 'Come funziona il Pitch AI?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: "Per ogni lead, l'AI genera un messaggio personalizzato basato sui problemi specifici del sito (SEO, pixel mancanti, DMARC). Copi, incolli, invii.",
        },
      },
    ],
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="text-slate-900">
        <ScrollAnimationObserver />
        <LandingNavbar />
        <main className="pb-24">
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
          <HeroSection />
          <LogoBarSection />
          <SocialProofBar />
          <ProductShowcase />
          <ImpactStatsSection />
          <HowItWorks />
          <UseCases />
          <TestimonialSection />
          <ArsenalSection />
          <VsSection />
          <ROICalculator />
          <PricingSection />
          <Guarantee />
          <TrustBadges />
          <FaqComplianceSection />
        </main>
        <LandingFooter />
      </div>
    </div>
  )
}
