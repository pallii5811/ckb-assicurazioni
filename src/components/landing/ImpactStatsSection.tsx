
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function useInView<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setInView(true)
    }, options)
    obs.observe(el)
    return () => obs.disconnect()
  }, [options])
  return { ref, inView }
}

function useCountUp(target: number, startWhen: boolean) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!startWhen) return
    let raf = 0
    const start = performance.now()
    const duration = 1200
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [startWhen, target])
  return value
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1).replace('.0','')}M` 
  if (n >= 1_000) return `${(n/1_000).toFixed(1).replace('.0','')}K` 
  return `${n}` 
}

export default function ImpactStatsSection() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.25 })
  const targets = useMemo(() => ({ analyzed: 3_000_000, leads: 1_500_000 }), [])
  const analyzed = useCountUp(targets.analyzed, inView)
  const leads = useCountUp(targets.leads, inView)

  const stats = [
    { value: `${fmt(analyzed)}+`, label: 'Aziende italiane profilate', sub: 'Dataset aggiornato in tempo reale' },
    { value: `${fmt(leads)}+`, label: 'Lead ad alta intenzione', sub: 'Filtrati per problema tecnico reale' },
    { value: '< 2 min', label: 'Dal target al pitch', sub: 'Senza ricerca manuale' },
  ]

  return (
    <section style={{
      background: 'white',
      padding: '72px 32px',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div ref={ref} style={{ maxWidth: 1280, margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: '#F8FAFC', border: '1px solid #E2E8F0',
            borderRadius: 999, padding: '6px 16px',
            fontSize: 11, fontWeight: 600,
            color: '#64748B', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 16,
            fontFamily: 'DM Sans, sans-serif',
          }}>
            I Numeri
          </div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
            fontWeight: 600, letterSpacing: '-0.025em',
            color: '#0F172A', marginBottom: 12,
          }}>
            La piattaforma che{' '}
            <span style={{ color: '#6366F1' }}>lavora per te</span>
          </h2>
          <p style={{
            fontSize: 16, color: '#64748B',
            fontFamily: 'DM Sans, sans-serif',
            maxWidth: 480, margin: '0 auto',
          }}>
            Dati reali, aggiornati ogni giorno.
            Nessuna lista comprata. Nessun dato inventato.
          </p>
        </div>

        {/* Stats grid */}
        <div style={{
          display: 'grid',
        }} className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
          {stats.map((s, i) => (
            <div key={i} style={{
              background: '#F8FAFC',
              border: '1px solid #F1F5F9',
              borderRadius: 16,
              padding: '36px 32px',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Accent top border */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                height: 3,
                background: 'linear-gradient(90deg, #6366F1, #8B5CF6)',
                borderRadius: '16px 16px 0 0',
              }} />
              
              <div style={{
                fontFamily: 'Syne, sans-serif',
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 700,
                color: '#0F172A',
                letterSpacing: '-0.03em',
                marginBottom: 8,
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 600,
                color: '#334155',
                fontFamily: 'DM Sans, sans-serif',
                marginBottom: 6,
              }}>
                {s.label}
              </div>
              <div style={{
                fontSize: 12, color: '#94A3B8',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {s.sub}
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
