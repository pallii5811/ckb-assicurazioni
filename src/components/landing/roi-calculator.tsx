'use client'

import { ArrowRight, TrendingUp } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

const comparisons = [
  { before: '3-4 ore', after: '< 2 min', label: 'Per trovare 10 lead' },
  { before: '1-3%', after: '10-20%', label: 'Tasso di risposta' },
  { before: '€0', after: '+€4.800', label: 'Revenue media/mese' },
  { before: 'Mai', after: 'Sempre', label: 'Pitch personalizzato' },
]

export function ROICalculator() {
  return (
    <section className="py-24 lg:py-32 bg-slate-950 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-950/60 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
        }} />
      </div>

      <div className="relative max-w-4xl mx-auto px-6 sm:px-8 text-center">
        {/* Badge */}
        <motion.div
          className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-8"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <TrendingUp size={12} className="text-indigo-400" />
          <span className="text-xs font-bold text-indigo-400 font-['DM_Sans'] uppercase tracking-wider">Il tuo ROI</span>
        </motion.div>

        {/* Headline */}
        <motion.h2
          className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-5 leading-tight"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
        >
          Quanto vale{' '}
          <span className="text-white/25 line-through decoration-red-500 decoration-3">
            1 ora di ricerca manuale?
          </span>
          <br />
          <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            Zero con MIRAX.
          </span>
        </motion.h2>

        <motion.p
          className="text-lg text-slate-400 font-['DM_Sans'] max-w-md mx-auto mb-14 leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          Ogni ora persa a cercare lead manualmente è un&apos;ora che non stai chiudendo contratti.
        </motion.p>

        {/* Comparison cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-12">
          {comparisons.map((item, i) => (
            <motion.div
              key={item.label}
              className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-5 text-left hover:bg-indigo-500/10 hover:border-indigo-500/20 transition-all duration-200"
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.08 }}
            >
              <div className="text-xs text-white/20 line-through decoration-red-500 font-['DM_Sans'] mb-2">
                {item.before}
              </div>
              <div className="font-['Syne'] text-2xl font-bold text-indigo-400 tracking-tight mb-1">
                {item.after}
              </div>
              <div className="text-xs text-white/30 font-['DM_Sans']">
                {item.label}
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          <CtaLink>
            <span className="inline-flex items-center gap-2 bg-white text-indigo-600 font-bold text-base px-8 py-4 rounded-xl font-['DM_Sans'] shadow-lg shadow-black/20 cursor-pointer hover:shadow-xl hover:-translate-y-0.5 transition-all">
              Inizia Gratis — Zero Rischi
              <ArrowRight size={16} />
            </span>
          </CtaLink>
          <p className="text-sm text-white/20 font-['DM_Sans'] mt-4">
            Nessuna carta richiesta · 10 lead gratis · Cancella quando vuoi
          </p>
        </motion.div>
      </div>
    </section>
  )
}
