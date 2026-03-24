'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Users, Clock, Database, Zap, Target } from 'lucide-react'

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
    const duration = 1800
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 4)
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
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.2 })
  const targets = useMemo(() => ({ analyzed: 3_000_000, leads: 1_500_000, agencies: 200 }), [])
  const analyzed = useCountUp(targets.analyzed, inView)
  const leads = useCountUp(targets.leads, inView)
  const agencies = useCountUp(targets.agencies, inView)

  return (
    <section className="relative py-24 lg:py-32 overflow-hidden bg-gradient-to-b from-white via-indigo-50/50 to-white">
      <div ref={ref} className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Main stats — large format */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12 mb-20">
          {[
            {
              icon: Database,
              value: `${fmt(analyzed)}+`,
              label: 'Aziende italiane profilate',
              sub: 'Dataset auto-aggiornato',
              color: 'from-indigo-500 to-violet-500',
              delay: 0,
            },
            {
              icon: Target,
              value: `${fmt(leads)}+`,
              label: 'Lead ad alta intenzione',
              sub: 'Filtrati per problema reale',
              color: 'from-violet-500 to-purple-500',
              delay: 0.15,
            },
            {
              icon: Clock,
              value: '< 2 min',
              label: 'Dal target al pitch',
              sub: 'Zero ricerca manuale',
              color: 'from-purple-500 to-pink-500',
              delay: 0.3,
            },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              className="text-center"
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: stat.delay, duration: 0.6 }}
            >
              <div className={`inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br ${stat.color} items-center justify-center mb-6 shadow-lg`}>
                <stat.icon size={24} className="text-white" />
              </div>
              <div className="font-['Syne'] text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight mb-3">
                {stat.value}
              </div>
              <div className="text-base font-semibold text-slate-700 font-['DM_Sans'] mb-1">
                {stat.label}
              </div>
              <div className="text-sm text-slate-400 font-['DM_Sans']">
                {stat.sub}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom row — secondary metrics */}
        <motion.div
          className="bg-slate-900 rounded-2xl p-8 lg:p-10 grid grid-cols-2 md:grid-cols-4 gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          {[
            { icon: Users, value: `${agencies}+`, label: 'Agenzie attive' },
            { icon: TrendingUp, value: '10-20%', label: 'Tasso di risposta' },
            { icon: Zap, value: '47K+', label: 'Audit oggi' },
            { icon: Database, value: '99.2%', label: 'Dati verificati' },
          ].map((m, i) => (
            <div key={m.label} className="text-center">
              <m.icon size={18} className="text-indigo-400 mx-auto mb-3" />
              <div className="font-['Syne'] text-2xl lg:text-3xl font-bold text-white tracking-tight mb-1">
                {m.value}
              </div>
              <div className="text-xs text-slate-400 font-['DM_Sans']">
                {m.label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
