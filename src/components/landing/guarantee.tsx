'use client'

import { Shield, CreditCard, RotateCcw, ArrowRight } from 'lucide-react'
import CtaLink from '@/components/CtaLink'

const guarantees = [
  {
    icon: RotateCcw,
    title: '14 Giorni Soddisfatto o Rimborsato',
    description: 'Non ti piace? Ti rimborsiamo tutto. Nessuna domanda.',
    accent: '#6366F1',
    bg: '#EEF2FF',
  },
  {
    icon: CreditCard,
    title: 'Cancella Quando Vuoi',
    description: '1 click per disdire. Zero penali, zero vincoli contrattuali.',
    accent: '#0EA5E9',
    bg: '#F0F9FF',
  },
  {
    icon: Shield,
    title: 'Inizia Gratis Senza Carta',
    description: '10 lead gratuiti per sempre. Nessuna carta richiesta.',
    accent: '#10B981',
    bg: '#F0FDF4',
  },
] as const

export function Guarantee() {
  return (
    <section style={{
      background: '#F8FAFC',
      padding: '96px 32px',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Card principale */}
        <div style={{
          background: 'white',
          border: '1px solid #E2E8F0',
          borderRadius: 24,
          padding: '56px 48px',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          position: 'relative',
          overflow: 'hidden',
        }}>

          {/* Top accent line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 4,
            background: 'linear-gradient(90deg, #6366F1, #10B981)',
            borderRadius: '24px 24px 0 0',
          }} />

          {/* Shield icon */}
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #10B981, #059669)',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 28px',
            boxShadow: '0 8px 24px rgba(16,185,129,0.25)',
          }}>
            <Shield size={32} color="white" />
          </div>

          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: '#0F172A',
            marginBottom: 12,
          }}>
            Zero Rischi.{" "}
            <span style={{ color: '#10B981' }}>Garantito.</span>
          </h2>

          <p style={{
            fontSize: 17, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
            maxWidth: 440, margin: '0 auto 48px',
            lineHeight: 1.65,
          }}>
            Se MIRAX non ti fa risparmiare tempo e chiudere
            più clienti, non paghi nulla.
          </p>

          {/* 3 card garanzie */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16, marginBottom: 40,
          }} className="grid-cols-1 sm:grid-cols-3">
            {guarantees.map((g) => (
              <div key={g.title} style={{
                background: '#F8FAFC',
                border: '1px solid #F1F5F9',
                borderRadius: 16,
                padding: '24px 20px',
                textAlign: 'center',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = `${g.accent}30` 
                ;(e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px ${g.accent}12` 
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#F1F5F9'
                ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
              }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: g.bg,
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px',
                }}>
                  <g.icon size={20} color={g.accent} />
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 700,
                  color: '#0F172A', marginBottom: 6,
                  fontFamily: 'Syne, sans-serif',
                }}>
                  {g.title}
                </div>
                <div style={{
                  fontSize: 13, color: '#64748B',
                  fontFamily: 'DM Sans, sans-serif',
                  lineHeight: 1.55,
                }}>
                  {g.description}
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <CtaLink>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#6366F1', color: 'white',
              fontSize: 15, fontWeight: 600,
              padding: '13px 32px', borderRadius: 12,
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
              cursor: 'pointer',
            }}>
              Inizia Gratis — Zero Rischi
              <ArrowRight size={16} />
            </span>
          </CtaLink>

          <p style={{
            fontSize: 12, color: '#94A3B8',
            fontFamily: 'DM Sans, sans-serif',
            marginTop: 14,
          }}>
            Già scelto da 200+ agency in tutta Italia
          </p>

        </div>
      </div>
    </section>
  )
}
