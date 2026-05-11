'use client'

import { ArrowRight, X, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

const comparisons = [
  { label: 'Qualità dei prospect', cold: 'Lista acquistata, dati vecchi', ckb: 'Profilati con aree assicurative da verificare' },
  { label: 'Tempo per 10 prospect', cold: '3-4 ore di ricerca manuale', ckb: 'Meno di 2 minuti' },
  { label: 'Sai cosa verificare?', cold: 'No — parli al buio', ckb: 'Checklist consulenziale + rischio territoriale' },
  { label: 'Proposta personalizzata', cold: 'La scrivi tu da zero', ckb: 'Generata con AI + dati reali' },
  { label: 'Contatto titolare', cold: 'Spesso centralino', ckb: 'Cellulare verificato + email + PEC' },
  { label: 'Tasso di risposta', cold: '1-3%', ckb: '10-20%' },
]

export function VsSection() {
  return (
    <section className="py-24 lg:py-32 bg-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-indigo-50/30 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 mb-6">
            <span className="text-xs font-semibold text-slate-600 font-['DM_Sans'] uppercase tracking-wider">Il confronto</span>
          </div>
          <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 mb-5">
            CKB vs{' '}
            <span className="text-slate-300 line-through decoration-red-400 decoration-3">
              Lista Fredda
            </span>
          </h2>
          <p className="text-lg text-slate-500 font-['DM_Sans'] max-w-lg mx-auto">
            Non è una questione di strumenti. È una questione di
            <strong className="text-slate-700"> chi chiami</strong> — e <strong className="text-slate-700">cosa gli dici</strong>.
          </p>
        </div>

        {/* Visual comparison: two side-by-side cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-16">
          {/* Cold list card */}
          <motion.div
            className="bg-slate-50 rounded-2xl border border-slate-200 p-6 lg:p-8 relative overflow-hidden"
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 to-red-300" />
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                <X size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-['Syne'] text-lg font-bold text-slate-400 line-through decoration-red-400">Lista Fredda</h3>
                <div className="text-xs text-red-400 font-bold font-['DM_Sans']">1-3% tasso risposta</div>
              </div>
            </div>
            <div className="space-y-3">
              {comparisons.map((c) => (
                <div key={c.label} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <X size={10} className="text-red-400" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-400 font-['DM_Sans'] mb-0.5">{c.label}</div>
                    <div className="text-sm text-slate-400 font-['DM_Sans']">{c.cold}</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* CKB card */}
          <motion.div
            className="bg-white rounded-2xl border-2 border-indigo-200 p-6 lg:p-8 relative overflow-hidden shadow-xl shadow-indigo-100/50"
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
            {/* Popular badge */}
            <div className="absolute top-4 right-4 bg-indigo-500 text-white text-[10px] font-bold px-3 py-1 rounded-full font-['DM_Sans'] uppercase tracking-wider">
              Consigliato
            </div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg">
                <Check size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-['Syne'] text-lg font-bold text-slate-900">CKB Assicurazione</h3>
                <div className="text-xs text-indigo-600 font-bold font-['DM_Sans']">10-20% tasso risposta</div>
              </div>
            </div>
            <div className="space-y-3">
              {comparisons.map((c) => (
                <div key={c.label} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check size={10} className="text-indigo-600" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-500 font-['DM_Sans'] mb-0.5">{c.label}</div>
                    <div className="text-sm font-medium text-slate-800 font-['DM_Sans']">{c.ckb}</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Big stat callout */}
        <motion.div
          className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-8 lg:p-10 text-center mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12">
            <div>
              <div className="font-['Syne'] text-4xl lg:text-5xl font-bold text-white/30 line-through decoration-white/40">1-3%</div>
              <div className="text-sm text-white/50 font-['DM_Sans']">Lista fredda</div>
            </div>
            <ArrowRight size={24} className="text-white/40 rotate-90 sm:rotate-0" />
            <div>
              <div className="font-['Syne'] text-4xl lg:text-5xl font-bold text-white">10-20%</div>
              <div className="text-sm text-white/70 font-['DM_Sans'] font-semibold">Con CKB</div>
            </div>
          </div>
        </motion.div>

        {/* CTA */}
        <div className="text-center">
          <CtaLink>
            <span className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-base font-semibold px-8 py-3.5 rounded-xl font-['DM_Sans'] shadow-lg shadow-indigo-500/30 transition-all cursor-pointer hover:-translate-y-0.5">
              Prova CKB Gratis
              <ArrowRight size={16} />
            </span>
          </CtaLink>
          <p className="text-xs text-slate-400 font-['DM_Sans'] mt-3">Nessuna carta richiesta · 10 lead gratis</p>
        </div>
      </div>
    </section>
  )
}
