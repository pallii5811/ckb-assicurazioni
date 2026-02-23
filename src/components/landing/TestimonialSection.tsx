'use client'

import { useState } from 'react'

const testimonials = [
  {
    quote: 'In 3 giorni ho trovato 14 ristoranti a Milano con pixel Facebook mancante. Ne ho contattati 10, ne ho chiusi 3. Quasi €5.000 di contratti nuovi partendo da zero chiamate a freddo.',
    name: 'Marco T.',
    role: 'Titolare agenzia SEO · Roma',
    avatar: 'MT',
    score: '+€4.800',
    tag: 'Ristorazione',
    metric: '3 clienti in 3 giorni',
    accent: '#6366F1',
  },
  {
    quote: 'Usavo liste comprate. Tasso di risposta era il 2%. Con ONLID cerco "dentisti a Torino senza sito aggiornato" e mi escono 30 lead con email del titolare e pitch già pronto.',
    name: 'Sara B.',
    role: 'Consulente digitale · Torino',
    avatar: 'SB',
    score: '15x risposta',
    tag: 'Healthcare',
    metric: '15x tasso risposta',
    accent: '#0EA5E9',
  },
  {
    quote: 'La funzione Pitch AI mi risparmia 2 ore al giorno. Prima scrivevo ogni email da zero. Adesso: trovo il lead, leggo i suoi problemi, clicco Genera Pitch, copio, invio. 90 secondi.',
    name: 'Luca M.',
    role: 'Freelance Web · Milano',
    avatar: 'LM',
    score: '-2h/giorno',
    tag: 'Efficienza',
    metric: '90s dal lead al pitch',
    accent: '#10B981',
  },
]

const stats = [
  { value: '200+', label: 'Agency italiane' },
  { value: '50K+', label: 'Lead/mese' },
  { value: '4.9/5', label: 'Rating utenti' },
  { value: '< 2min', label: 'Target → pitch' },
]

export function TestimonialSection() {
  const [active, setActive] = useState(0)
  const t = testimonials[active]

  return (
    <section style={{
      background: 'white',
      padding: '96px 32px',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: '#F8FAFC', border: '1px solid #E2E8F0',
            borderRadius: 999, padding: '6px 16px',
            fontSize: 11, fontWeight: 600,
            color: '#64748B', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 20,
            fontFamily: 'DM Sans, sans-serif',
          }}>
            Risultati Reali
          </div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: '#0F172A', marginBottom: 16,
          }}>
            Chi usa MIRAX{' '}
            <span style={{ color: '#6366F1' }}>chiude di più</span>
          </h2>
          <p style={{
            fontSize: 17, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
            maxWidth: 480, margin: '0 auto',
          }}>
            Non promesse. Risultati concreti da agency
            e consulenti italiani.
          </p>
        </div>

        {/* Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16, marginBottom: 48,
        }} className="grid-cols-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} style={{
              background: '#F8FAFC',
              border: '1px solid #F1F5F9',
              borderRadius: 14, padding: '24px',
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: 'Syne, sans-serif',
                fontSize: 28, fontWeight: 700,
                color: '#0F172A', letterSpacing: '-0.02em',
                marginBottom: 4,
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize: 11, color: '#94A3B8',
                fontFamily: 'DM Sans, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.06em', fontWeight: 600,
              }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Main testimonial card */}
        <div style={{
          background: '#0F172A',
          borderRadius: 20,
          overflow: 'hidden',
          marginBottom: 20,
          boxShadow: '0 20px 60px rgba(15,23,42,0.15)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr',
          }} className="grid-cols-1 lg:grid-cols-[240px_1fr]">

            {/* Left metric */}
            <div style={{
              padding: '48px 32px',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <div style={{
                fontFamily: 'Syne, sans-serif',
                fontSize: 40, fontWeight: 700,
                color: t.accent,
                letterSpacing: '-0.03em',
                marginBottom: 8,
              }}>
                {t.score}
              </div>
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.4)',
                fontFamily: 'DM Sans, sans-serif',
                marginBottom: 16,
              }}>
                {t.metric}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700,
                padding: '4px 12px', borderRadius: 999,
                background: `${t.accent}20`,
                color: t.accent,
                border: `1px solid ${t.accent}40`,
                fontFamily: 'DM Sans, sans-serif',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                {t.tag}
              </div>
            </div>

            {/* Right quote */}
            <div style={{ padding: '48px' }}>
              <div style={{
                fontSize: 72, lineHeight: 0.5,
                color: 'rgba(255,255,255,0.08)',
                fontFamily: 'Georgia, serif',
                marginBottom: 16,
              }}>
                "
              </div>
              <p style={{
                fontSize: 18, lineHeight: 1.7,
                color: 'rgba(255,255,255,0.85)',
                fontFamily: 'DM Sans, sans-serif',
                marginBottom: 32,
              }}>
                {t.quote}
              </p>
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap', gap: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: t.accent,
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: 'white',
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    {t.avatar}
                  </div>
                  <div>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      color: 'white', fontFamily: 'DM Sans, sans-serif',
                    }}>
                      {t.name}
                    </div>
                    <div style={{
                      fontSize: 12, color: 'rgba(255,255,255,0.4)',
                      fontFamily: 'DM Sans, sans-serif',
                    }}>
                      {t.role}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0,1,2,3,4].map(i => (
                    <span key={i} style={{ color: '#F59E0B', fontSize: 16 }}>★</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Selector */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {testimonials.map((test, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px', borderRadius: 12,
                border: active === i ? '1px solid #6366F1' : '1px solid #E2E8F0',
                background: active === i ? '#EEF2FF' : 'white',
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: active === i ? '0 4px 12px rgba(99,102,241,0.15)' : 'none',
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: test.accent,
                display: 'flex', alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'white',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {test.avatar}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: active === i ? '#6366F1' : '#0F172A',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {test.name}
                </div>
                <div style={{
                  fontSize: 11, color: '#94A3B8',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {test.score}
                </div>
              </div>
            </button>
          ))}
        </div>

      </div>
    </section>
  )
}
