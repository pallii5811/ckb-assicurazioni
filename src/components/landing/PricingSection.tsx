
'use client'

import { Check, Zap } from 'lucide-react'
import CtaLink from '@/components/CtaLink'
import Link from 'next/link'

type Plan = {
  name: string
  price: string
  originalPrice?: string
  period: string
  desc: string
  features: string[]
  cta: string
  href?: string
  note: string
  highlight: boolean
  badge?: string
}

const plans: Plan[] = [
  {
    name: 'Esplora',
    price: '€0',
    period: 'per sempre',
    desc: 'Per capire cosa puoi fare',
    features: [
      '10 lead gratuiti una tantum',
      'Ricerca base per categoria e città',
      'Export CSV',
      'Nessuna carta richiesta',
    ],
    cta: 'Inizia Gratis',
    href: '/dashboard',
    note: '847 agency hanno iniziato così',
    highlight: false,
  },
  {
    name: 'Starter',
    price: '€29',
    originalPrice: '€49',
    period: '/ mese',
    desc: 'Per freelance e consulenti',
    features: [
      '500 crediti / mese',
      'Ricerca iper-localizzata',
      'Cellulari verificati',
      'Export CSV/Excel',
      'Supporto email',
    ],
    cta: 'Inizia Ora',
    note: '312 agency attive su questo piano',
    highlight: false,
    badge: '🔥 50% sconto lancio',
  },
  {
    name: 'PRO',
    price: '€99',
    period: '/ mese',
    desc: 'Per agency in crescita',
    highlight: true,
    badge: 'Più Scelto',
    features: [
      '3.000 crediti / mese',
      'Email decision maker',
      'Pitch AI personalizzato',
      'Freshness score & re-audit',
      'Export CSV/Excel',
      'Priorità supporto',
    ],
    cta: 'Inizia Ora',
    note: '189 agency chiudono clienti ogni giorno',
  },
  {
    name: 'Agency',
    price: '€249',
    period: '/ mese',
    desc: 'Per team e grandi volumi',
    features: [
      '10.000 crediti / mese',
      'Tutto del PRO',
      'Multi-utente & permessi',
      'API access',
      'Integrazioni CRM',
      'Account manager dedicato',
    ],
    cta: 'Parla con Noi',
    note: '43 agency enterprise attive',
    highlight: false,
  },
]

export default function PricingSection() {
  return (
    <section id="pricing" style={{
      background: '#F8FAFC',
      padding: '96px 32px',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'white', border: '1px solid #E2E8F0',
            borderRadius: 999, padding: '6px 16px',
            fontSize: 11, fontWeight: 600,
            color: '#64748B', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 20,
            fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <Zap size={11} color="#6366F1" />
            Prezzi
          </div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: '#0F172A', marginBottom: 12,
          }}>
            Scegli il tuo{' '}
            <span style={{ color: '#6366F1' }}>piano di crescita</span>
          </h2>
          <p style={{
            fontSize: 17, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            Parti gratis. Scala quando vuoi. Cancella in 1 click.
          </p>
        </div>

        {/* Plans grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16, alignItems: 'stretch',
          marginBottom: 32,
        }} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => (
            <div key={p.name} style={{
              background: 'white',
              border: p.highlight ? '2px solid #6366F1' : '1px solid #E2E8F0',
              borderRadius: 16,
              padding: '28px 24px',
              display: 'flex', flexDirection: 'column',
              position: 'relative',
              boxShadow: p.highlight
                ? '0 8px 40px rgba(99,102,241,0.15)'
                : '0 1px 8px rgba(0,0,0,0.04)',
            }}>

              {/* Popular badge */}
              {p.highlight && (
                <div style={{
                  position: 'absolute', top: -12,
                  left: '50%', transform: 'translateX(-50%)',
                  background: '#6366F1', color: 'white',
                  fontSize: 11, fontWeight: 700,
                  padding: '4px 14px', borderRadius: 999,
                  fontFamily: 'DM Sans, sans-serif',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
                }}>
                  ⭐ Più Scelto
                </div>
              )}

              {/* Plan name */}
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 16,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: p.highlight ? '#6366F1' : '#94A3B8',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {p.name}
                </span>
                {p.badge && !p.highlight && (
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    padding: '3px 8px', borderRadius: 999,
                    background: '#FFF7ED', color: '#EA580C',
                    border: '1px solid #FED7AA',
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    {p.badge}
                  </span>
                )}
              </div>

              {/* Price */}
              <div style={{ marginBottom: 8 }}>
                {p.originalPrice && (
                  <span style={{
                    fontSize: 14, color: '#CBD5E1',
                    textDecoration: 'line-through',
                    fontFamily: 'DM Sans, sans-serif',
                    marginRight: 6,
                  }}>
                    {p.originalPrice}
                  </span>
                )}
                <span style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: 36, fontWeight: 700,
                  color: p.highlight ? '#6366F1' : '#0F172A',
                  letterSpacing: '-0.03em',
                }}>
                  {p.price}
                </span>
                <span style={{
                  fontSize: 13, color: '#94A3B8',
                  fontFamily: 'DM Sans, sans-serif',
                  marginLeft: 4,
                }}>
                  {p.period}
                </span>
              </div>

              <p style={{
                fontSize: 13, color: '#64748B',
                fontFamily: 'DM Sans, sans-serif',
                marginBottom: 20,
              }}>
                {p.desc}
              </p>

              {/* Divider */}
              <div style={{
                height: 1,
                background: p.highlight ? '#EEF2FF' : '#F1F5F9',
                marginBottom: 20,
              }} />

              {/* Features */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {p.features.map((f) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: p.highlight ? '#EEF2FF' : '#F0FDF4',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0,
                      marginTop: 1,
                    }}>
                      <Check size={10} color={p.highlight ? '#6366F1' : '#10B981'} strokeWidth={3} />
                    </div>
                    <span style={{
                      fontSize: 13, color: '#475569',
                      fontFamily: 'DM Sans, sans-serif',
                      lineHeight: 1.5,
                    }}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div style={{ marginTop: 24 }}>
                {p.href ? (
                  <Link href={p.href} style={{
                    display: 'block', textAlign: 'center',
                    padding: '12px', borderRadius: 10,
                    fontSize: 14, fontWeight: 600,
                    fontFamily: 'DM Sans, sans-serif',
                    textDecoration: 'none',
                    background: p.highlight ? '#6366F1' : 'transparent',
                    color: p.highlight ? 'white' : '#6366F1',
                    border: p.highlight ? 'none' : '1.5px solid #E2E8F0',
                    boxShadow: p.highlight ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
                  }}>
                    {p.cta}
                  </Link>
                ) : (
                  <CtaLink>
                    <span style={{
                      display: 'block', textAlign: 'center',
                      padding: '12px', borderRadius: 10,
                      fontSize: 14, fontWeight: 600,
                      fontFamily: 'DM Sans, sans-serif',
                      cursor: 'pointer',
                      background: p.highlight ? '#6366F1' : p.name === 'Agency' ? '#0F172A' : 'transparent',
                      color: p.highlight || p.name === 'Agency' ? 'white' : '#6366F1',
                      border: p.highlight || p.name === 'Agency' ? 'none' : '1.5px solid #E2E8F0',
                      boxShadow: p.highlight ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
                    }}>
                      {p.cta}
                    </span>
                  </CtaLink>
                )}
                <p style={{
                  fontSize: 11, color: '#94A3B8',
                  textAlign: 'center', marginTop: 8,
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {p.note}
                </p>
              </div>

            </div>
          ))}
        </div>

        {/* Guarantee */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 12,
          background: '#F0FDF4', border: '1px solid #BBF7D0',
          borderRadius: 12, padding: '16px 28px',
          maxWidth: 520, margin: '0 auto',
        }}>
          <span style={{ fontSize: 20 }}>🛡️</span>
          <span style={{
            fontSize: 13, color: '#166534',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            <strong>Garanzia 14 giorni</strong> soddisfatti o rimborsati.
            Nessun vincolo contrattuale.
          </span>
        </div>

      </div>
    </section>
  )
}
