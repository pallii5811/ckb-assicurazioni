

'use client'

import { ArrowRight, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import CtaLink from '@/components/CtaLink'

const snapshots = [
  {
    query: 'dentisti Milano senza pixel',
    leads: [
      { nome: 'Studio Dentistico Rossi', score: 72, label: 'HOT', tel: '02 8595 6321', chips: ['NO PIXEL', 'ERRORI SEO'] },
      { nome: 'Odontoiatria Centrale Milano', score: 54, label: 'WARM', tel: '347 123 4567', chips: ['NO PIXEL', 'NO GTM'] },
      { nome: 'Dentisti Associati Brera', score: 41, label: 'WARM', tel: '02 4567 8901', chips: ['ERRORI SEO'] },
    ],
  },
  {
    query: 'avvocati Napoli senza Google Ads',
    leads: [
      { nome: 'Studio Legale Esposito', score: 71, label: 'HOT', tel: '340 123 4567', chips: ['NO GOOGLE ADS', 'NO PIXEL'] },
      { nome: 'Avvocati Associati Napoli', score: 49, label: 'WARM', tel: '081 234 5678', chips: ['NO GOOGLE ADS'] },
      { nome: 'Foro Napoletano Srl', score: 35, label: 'WARM', tel: '328 987 6543', chips: ['ERRORI SEO'] },
    ],
  },
  {
    query: 'ristoranti Roma con errori SEO',
    leads: [
      { nome: "Trattoria Campo de' Fiori", score: 63, label: 'HOT', tel: '338 987 6543', chips: ['ERRORI SEO', 'NO GTM'] },
      { nome: 'Ristorante Testaccio', score: 58, label: 'WARM', tel: '06 5678 9012', chips: ['ERRORI SEO'] },
      { nome: 'Osteria Prati', score: 41, label: 'WARM', tel: '345 123 4567', chips: ['ERRORI SEO', 'NO PIXEL'] },
    ],
  },
]

function LeadCard({ lead, index }: { lead: typeof snapshots[0]['leads'][0], index: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      background: index === 0 ? '#FAFBFF' : 'white',
      borderRadius: 10,
      border: '1px solid #EEF2FF',
      marginBottom: 8,
      boxShadow: '0 1px 4px rgba(99,102,241,0.06)',
      transition: 'all 0.2s',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: '#1E293B', marginBottom: 4,
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {lead.nome}
        </div>
        <div style={{
          fontSize: 11, color: '#10B981',
          fontWeight: 500, marginBottom: 5,
          display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: 'DM Sans, sans-serif',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#10B981', display: 'inline-block',
            boxShadow: '0 0 0 2px rgba(16,185,129,0.2)',
          }} />
          {lead.tel}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
          {lead.chips.map((chip, i) => (
            <span key={i} style={{
              fontSize: 9, fontWeight: 700,
              padding: '2px 7px', borderRadius: 4,
              letterSpacing: '0.03em',
              background: chip.includes('PIXEL') || chip.includes('SEO') ? '#FEF2F2' :
                          chip.includes('GTM') ? '#FFF7ED' : '#EFF6FF',
              color: chip.includes('PIXEL') || chip.includes('SEO') ? '#DC2626' :
                     chip.includes('GTM') ? '#C2410C' : '#4F46E5',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              {chip}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginLeft: 12 }}>
        <span style={{
          fontSize: 11, fontWeight: 700,
          padding: '3px 9px', borderRadius: 6,
          background: lead.label === 'HOT' ? '#FEF2F2' : '#FFF7ED',
          color: lead.label === 'HOT' ? '#DC2626' : '#EA580C',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {lead.label} {lead.score}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          padding: '3px 10px', borderRadius: 6,
          background: '#EEF2FF', color: '#6366F1',
          fontFamily: 'DM Sans, sans-serif',
          cursor: 'pointer',
        }}>
          Pitch →
        </span>
      </div>
    </div>
  )
}

function SearchWidget({ snap }: { snap: typeof snapshots[0] }) {
  return (
    <div style={{ width: '100%' }}>
      {/* Search bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#F8FAFF', borderRadius: 10,
        border: '1px solid #E0E7FF',
        padding: '9px 14px', marginBottom: 12,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span style={{
          flex: 1, fontSize: 12, color: '#475569',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {snap.query}
        </span>
        <span style={{
          background: '#6366F1', color: 'white',
          fontSize: 11, fontWeight: 600,
          padding: '4px 12px', borderRadius: 7,
          fontFamily: 'DM Sans, sans-serif',
        }}>
          Cerca
        </span>
      </div>

      {/* Lead cards */}
      {snap.leads.map((lead, i) => (
        <LeadCard key={i} lead={lead} index={i} />
      ))}

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 8, padding: '0 2px',
        fontSize: 10, color: '#94A3B8',
        fontFamily: 'monospace',
      }}>
        <span>onlid · ai-search</span>
        <span style={{ color: '#10B981', fontWeight: 600 }}>● live</span>
      </div>
    </div>
  )
}

function HeroWidget() {
  const [current, setCurrent] = useState(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const t = setInterval(() => {
      setExiting(true)
      setTimeout(() => {
        setCurrent(p => (p + 1) % snapshots.length)
        setExiting(false)
      }, 380)
    }, 3800)
    return () => clearInterval(t)
  }, [])

  const n1 = (current + 1) % snapshots.length
  const n2 = (current + 2) % snapshots.length

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 500, height: 360, margin: '0 auto' }}>
      
      {/* Card 3 — retro */}
      <div style={{
        position: 'absolute', top: 28, left: 28, right: -20,
        background: 'white',
        borderRadius: 16, border: '1px solid #EEF2FF',
        padding: '16px 18px', zIndex: 1,
        opacity: 0.45, transform: 'scale(0.92)',
        transformOrigin: 'top center',
        boxShadow: '0 8px 30px rgba(99,102,241,0.08)',
        overflow: 'hidden', height: 320, pointerEvents: 'none',
      }}>
        <SearchWidget snap={snapshots[n2]} />
      </div>

      {/* Card 2 — medio */}
      <div style={{
        position: 'absolute', top: 14, left: 14, right: -10,
        background: 'white',
        borderRadius: 16, border: '1px solid #E0E7FF',
        padding: '16px 18px', zIndex: 2,
        opacity: 0.7, transform: 'scale(0.96)',
        transformOrigin: 'top center',
        boxShadow: '0 12px 40px rgba(99,102,241,0.1)',
        overflow: 'hidden', height: 320, pointerEvents: 'none',
      }}>
        <SearchWidget snap={snapshots[n1]} />
      </div>

      {/* Card 1 — primo piano */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        background: 'white',
        borderRadius: 16, border: '1px solid #E0E7FF',
        padding: '18px 20px', zIndex: 3,
        opacity: exiting ? 0 : 1,
        transform: exiting
          ? 'translateY(-20px) translateX(-12px) rotate(-3deg) scale(0.95)'
          : 'translateY(0) rotate(0) scale(1)',
        transition: 'all 0.38s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: '0 20px 60px rgba(99,102,241,0.15), 0 4px 20px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}>
        <SearchWidget snap={snapshots[current]} />
      </div>
    </div>
  )
}

export default function HeroSection() {
  return (
    <section style={{
      background: 'white',
      borderBottom: '1px solid #F1F5F9',
      padding: '80px 0 100px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background decoration */}
      <div style={{
        position: 'absolute', top: -200, right: -200,
        width: 600, height: 600,
        background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -100, left: -100,
        width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '0 32px',
        display: 'grid',
        alignItems: 'center',
      }} className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-20">

        {/* LEFT */}
        <div>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#EEF2FF', border: '1px solid #C7D2FE',
            borderRadius: 999, padding: '6px 14px', marginBottom: 28,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#10B981',
              boxShadow: '0 0 0 3px rgba(16,185,129,0.15)',
              display: 'inline-block',
            }} />
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: '#6366F1',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              Live · 47.293 aziende analizzate oggi
            </span>
          </div>

          {/* Titolo — stile Lusha: peso 400-500, grande, leggibile */}
          <h1 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(2.2rem, 4.5vw, 3.4rem)',
            fontWeight: 500,
            lineHeight: 1.12,
            letterSpacing: '-0.025em',
            color: '#0F172A',
            marginBottom: 20,
          }}>
            Trova aziende italiane
            <br />
            <span style={{ color: '#6366F1' }}>
              pronte ad ascoltarti.
            </span>
            <br />
            Prima di chiamare.
          </h1>

          {/* Sottotitolo */}
          <p style={{
            fontSize: 17, lineHeight: 1.65,
            color: '#64748B', maxWidth: 480,
            fontFamily: 'DM Sans, sans-serif',
            fontWeight: 400, marginBottom: 36,
          }}>
            MIRAX analizza milioni di PMI italiane, 
            rileva i problemi tecnici reali e ti consegna 
            una lista di potenziali clienti con il pitch già scritto.
          </p>

          {/* CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 36 }}>
            <CtaLink>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#6366F1', color: 'white',
                fontSize: 15, fontWeight: 600,
                padding: '13px 28px', borderRadius: 10,
                fontFamily: 'DM Sans, sans-serif',
                boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
                cursor: 'pointer',
              }}>
                Inizia Gratis
                <ArrowRight size={16} />
              </span>
            </CtaLink>

            <button
              type="button"
              onClick={() => {
                const el = document.querySelector('#how-it-works')
                if (el) el.scrollIntoView({ behavior: 'smooth' })
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 500, color: '#64748B',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              <span style={{
                width: 36, height: 36,
                borderRadius: '50%', border: '1.5px solid #E2E8F0',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                <Play size={12} fill="#64748B" color="#64748B" />
              </span>
              Guarda demo (90 sec)
            </button>
          </div>

          {/* Social proof */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex' }}>
                {['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981'].map((color, i) => (
                  <div key={i} style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: color, border: '2px solid white',
                    marginLeft: i === 0 ? 0 : -8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: 'white',
                  }}>
                    {['A','B','C','D','E'][i]}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', fontFamily: 'DM Sans, sans-serif' }}>
                  ★★★★★ <span style={{ color: '#6366F1' }}>4.9/5</span>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'DM Sans, sans-serif' }}>
                  200+ agenzie italiane
                </div>
              </div>
            </div>

            <div style={{ width: 1, height: 32, background: '#E2E8F0' }} />

            {['🔒 GDPR', '💳 No carta', '⚡ 10 gratis'].map((badge) => (
              <span key={badge} style={{
                fontSize: 12, color: '#64748B', fontFamily: 'DM Sans, sans-serif',
              }}>
                {badge}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT — Widget */}
        <div style={{ position: 'relative' }}>
          <HeroWidget />
        </div>

      </div>
    </section>
  )
}
