
'use client'

import { useRef } from 'react'
import { Crosshair, Radar, BadgeCheck } from 'lucide-react'

const steps = [
  {
    icon: Crosshair,
    step: '01',
    title: 'Descrivi il Tuo Target',
    description: "Scrivi in italiano naturale: 'Dentisti a Milano con recensioni sotto il 4 e senza pixel Facebook'. Il motore AI interpreta, filtra e trova per te.",
    tag: 'Natural Language AI',
    color: '#6366F1',
    bg: '#EEF2FF',
  },
  {
    icon: Radar,
    step: '02',
    title: "L'AI Scansiona e Profila",
    description: "In tempo reale analizziamo SEO, Pixel, SSL, DMARC, velocità e social. Ogni lead ha uno score da 0 a 100 che indica quanto è pronto ad ascoltarti.",
    tag: 'Real-time Audit',
    color: '#0EA5E9',
    bg: '#F0F9FF',
  },
  {
    icon: BadgeCheck,
    step: '03',
    title: 'Chiama. Chiudi. Incassa.',
    description: "Hai il cellulare diretto, l'email del titolare, e un pitch personalizzato pronto. Sai esattamente cosa dirgli prima ancora di alzare il telefono.",
    tag: 'AI Pitch Generator',
    color: '#10B981',
    bg: '#F0FDF4',
  },
] as const

export default function HowItWorks() {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  return (
    <section
      id="how-it-works"
      style={{
        background: '#F8FAFC',
        padding: '96px 32px',
        borderBottom: '1px solid #F1F5F9',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'white', border: '1px solid #E2E8F0',
            borderRadius: 999, padding: '6px 16px',
            fontSize: 11, fontWeight: 600,
            color: '#64748B', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 20,
            fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            Il Processo
          </div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: '#0F172A',
            marginBottom: 16,
          }}>
            Tre passi.{' '}
            <span style={{ color: '#6366F1' }}>
              Zero sprechi di tempo.
            </span>
          </h2>
          <p style={{
            fontSize: 17, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
            maxWidth: 540, margin: '0 auto',
            lineHeight: 1.65,
          }}>
            Dal target al pitch in meno di due minuti.
            Mentre i tuoi competitor chiamano a freddo,
            tu chiami chi ha già bisogno di te.
          </p>
        </div>

        {/* Content */}
        <div style={{
          display: 'grid',
          alignItems: 'center',
        }} className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {steps.map((s, idx) => (
              <div key={s.title} style={{
                background: 'white',
                border: '1px solid #F1F5F9',
                borderRadius: 16,
                padding: '24px 28px',
                position: 'relative',
                boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
                transition: 'all 0.2s',
              }}>
                {/* Step number */}
                <div style={{
                  position: 'absolute', top: -10, left: 24,
                  width: 24, height: 24, borderRadius: '50%',
                  background: s.color,
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10, fontWeight: 800,
                  color: 'white',
                  fontFamily: 'DM Sans, sans-serif',
                  boxShadow: `0 4px 8px ${s.color}40`,
                }}>
                  {idx + 1}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  {/* Icon */}
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: s.bg,
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                  }}>
                    <s.icon size={22} color={s.color} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      gap: 10, marginBottom: 8,
                    }}>
                      <span style={{
                        fontSize: 15, fontWeight: 700,
                        color: '#0F172A',
                        fontFamily: 'Syne, sans-serif',
                      }}>
                        {s.title}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        padding: '2px 8px', borderRadius: 999,
                        background: s.bg, color: s.color,
                        fontFamily: 'DM Sans, sans-serif',
                        letterSpacing: '0.02em',
                      }}>
                        {s.tag}
                      </span>
                    </div>
                    <p style={{
                      fontSize: 14, color: '#64748B',
                      lineHeight: 1.65,
                      fontFamily: 'DM Sans, sans-serif',
                      margin: 0,
                    }}>
                      {s.description}
                    </p>
                  </div>
                </div>

                {/* Connector */}
                {idx < steps.length - 1 && (
                  <div style={{
                    position: 'absolute', bottom: -17,
                    left: 35, width: 1, height: 18,
                    background: 'linear-gradient(to bottom, #E2E8F0, transparent)',
                  }} />
                )}
              </div>
            ))}
          </div>

          {/* Video */}
          <div style={{
            background: 'white',
            border: '1px solid #E2E8F0',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(99,102,241,0.1)',
          }}>
            <video
              ref={videoRef}
              src="/mirax-demo.mp4"
              style={{ width: '100%', display: 'block' }}
              autoPlay loop muted playsInline controls
            />
          </div>

        </div>
      </div>
    </section>
  )
}
