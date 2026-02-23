'use client'

import { ArrowRight } from 'lucide-react'
import CtaLink from '@/components/CtaLink'

const comparisons = [
  { before: '3-4 ore', after: '< 2 min', label: 'Per trovare 10 lead' },
  { before: '1-3%', after: '10-20%', label: 'Tasso di risposta' },
  { before: '€0', after: '+€4.800', label: 'Revenue media/mese' },
  { before: 'Mai', after: 'Sempre', label: 'Pitch personalizzato' },
] as const

export function ROICalculator() {
  return (
    <section style={{
      background: '#0F172A',
      padding: '96px 32px',
      position: 'relative',
      overflow: 'hidden',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute', top: -200, left: '50%',
        transform: 'translateX(-50%)',
        width: 800, height: 400,
        background: 'radial-gradient(ellipse, rgba(99,102,241,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        maxWidth: 860, margin: '0 auto',
        position: 'relative', zIndex: 1,
        textAlign: 'center',
      }}>

        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center',
          background: 'rgba(99,102,241,0.12)',
          border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 999, padding: '6px 16px',
          fontSize: 11, fontWeight: 700,
          color: '#A5B4FC',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: 'DM Sans, sans-serif',
          marginBottom: 28,
        }}>
          Calcola il tuo ROI
        </div>

        {/* Titolo */}
        <h2 style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: 'clamp(2rem, 4.5vw, 3.4rem)',
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: 'white',
          marginBottom: 20,
          lineHeight: 1.1,
        }}>
          Quanto vale{' '}
          <span style={{
            color: 'rgba(255,255,255,0.3)',
            textDecoration: 'line-through',
            textDecorationColor: '#EF4444',
            textDecorationThickness: 3,
          }}>
            1 ora di ricerca manuale?
          </span>
          <br />
          <span style={{ color: '#A5B4FC' }}>
            Zero con MIRAX.
          </span>
        </h2>

        <p style={{
          fontSize: 17, color: 'rgba(255,255,255,0.5)',
          fontFamily: 'DM Sans, sans-serif',
          maxWidth: 480, margin: '0 auto 52px',
          lineHeight: 1.65,
        }}>
          Ogni ora persa a cercare lead manualmente
          è un'ora che non stai chiudendo contratti.
          ONLID te ne risparmia almeno 2 al giorno.
        </p>

        {/* Confronto card */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12, marginBottom: 48,
        }} className="grid-cols-2 sm:grid-cols-4">
          {comparisons.map((item) => (
            <div key={item.label} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14,
              padding: '20px 16px',
              textAlign: 'left',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.background = 'rgba(99,102,241,0.1)'
              ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(99,102,241,0.3)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'
              ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)'
            }}
            >
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.25)',
                textDecoration: 'line-through',
                textDecorationColor: '#EF4444',
                fontFamily: 'DM Sans, sans-serif',
                marginBottom: 6,
              }}>
                {item.before}
              </div>
              <div style={{
                fontFamily: 'Syne, sans-serif',
                fontSize: 22, fontWeight: 700,
                color: '#A5B4FC',
                marginBottom: 6,
                letterSpacing: '-0.02em',
              }}>
                {item.after}
              </div>
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.35)',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <CtaLink>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: 'white', color: '#6366F1',
            fontSize: 15, fontWeight: 700,
            padding: '16px 36px', borderRadius: 14,
            fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            Inizia Gratis — Zero Rischi
            <ArrowRight size={16} />
          </span>
        </CtaLink>

        <p style={{
          fontSize: 13, color: 'rgba(255,255,255,0.2)',
          fontFamily: 'DM Sans, sans-serif',
          marginTop: 16,
        }}>
          Nessuna carta richiesta · 10 lead gratis · Cancella quando vuoi
        </p>

      </div>
    </section>
  )
}
