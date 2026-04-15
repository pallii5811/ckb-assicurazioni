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
  title: 'CKB Assicurazione | Intelligence per Broker e Consulenti Assicurativi',
  description:
    'CKB Assicurazione analizza aziende italiane, identifica gap assicurativi e genera proposte commerciali su misura. Per broker, agenti e consulenti assicurativi.',
  keywords: [
    'software broker assicurativo',
    'lead generation assicurazioni',
    'trovare clienti assicurazione',
    'prospecting assicurativo italia',
    'gap analysis assicurativa',
    'intelligence assicurativa',
    'crm broker assicurativo',
    'analisi rischio aziende',
    'proposta commerciale assicurazione',
    'software intermediari assicurativi',
    'lead qualificati assicurazioni',
    'consulente assicurativo software',
    'polizze aziendali prospecting',
    'risk assessment italia',
    'sales intelligence assicurazioni',
    'database aziende italia assicurazione',
    'ATECO analisi rischio',
    'D&O cyber insurance prospecting',
    'RC professionale lead',
    'welfare aziendale broker',
  ],
  openGraph: {
    title: 'CKB Assicurazione — Intelligence per Broker Assicurativi',
    description: 'Trova aziende, analizza gap assicurativi e genera proposte su misura. Il software n.1 per intermediari.',
    url: 'https://ckbassicurazione.it',
    siteName: 'CKB Assicurazione',
    locale: 'it_IT',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CKB Assicurazione — Intelligence per Broker',
    description: 'Dall\'analisi del rischio alla proposta commerciale in pochi minuti.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: 'https://ckbassicurazione.it',
  },
}

export default function Home() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'CKB Assicurazione',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: 'https://ckbassicurazione.it',
    description:
      "CKB Assicurazione è la piattaforma di intelligence assicurativa per broker e consulenti. Analizza aziende italiane, identifica gap assicurativi, calcola rischio territoriale e genera proposte commerciali personalizzate.",
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
    name: 'CKB Assicurazione',
    url: 'https://ckbassicurazione.it',
    logo: 'https://ckbassicurazione.it/logo.svg',
    description: 'La piattaforma di intelligence assicurativa n.1 in Italia per broker e consulenti.',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'supporto@ckbassicurazione.it',
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
          text: "Per ogni prospect, l'AI genera una proposta commerciale personalizzata basata sui gap assicurativi reali dell'azienda. Copi, incolli, invii.",
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
