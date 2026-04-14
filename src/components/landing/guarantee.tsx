'use client'

import { Shield, CreditCard, RotateCcw, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

const guarantees = [
  {
    icon: RotateCcw,
    title: '14 Giorni Soddisfatto o Rimborsato',
    description: 'Non ti piace? Ti rimborsiamo tutto. Nessuna domanda.',
    gradient: 'from-indigo-500 to-violet-500',
  },
  {
    icon: CreditCard,
    title: 'Cancella Quando Vuoi',
    description: '1 click per disdire. Zero penali, zero vincoli contrattuali.',
    gradient: 'from-cyan-500 to-blue-500',
  },
  {
    icon: Shield,
    title: 'Inizia Gratis Senza Carta',
    description: '10 lead gratuiti per sempre. Nessuna carta richiesta.',
    gradient: 'from-emerald-500 to-teal-500',
  },
]

export function Guarantee() {
  return (
    <section className="py-24 lg:py-32 bg-gradient-to-b from-white to-slate-50 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-emerald-50/30 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-6 sm:px-8">
        <motion.div
          className="bg-white rounded-3xl border border-slate-200 p-10 lg:p-14 text-center shadow-xl shadow-slate-200/40 relative overflow-hidden"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          {/* Top gradient line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-emerald-500 to-violet-500" />

          {/* Shield */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-7 shadow-lg shadow-emerald-500/25">
            <Shield size={28} className="text-white" />
          </div>

          <h2 className="font-['Syne'] text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-3">
            Zero Rischi.{' '}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">Garantito.</span>
          </h2>

          <p className="text-base text-slate-500 font-['DM_Sans'] max-w-md mx-auto mb-10 leading-relaxed">
            Se CKB non ti fa risparmiare tempo e chiudere più clienti, non paghi nulla.
          </p>

          {/* 3 guarantee cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            {guarantees.map((g, i) => (
              <motion.div
                key={g.title}
                className="bg-slate-50 rounded-xl border border-slate-100 p-5 text-center group hover:bg-white hover:shadow-md hover:border-slate-200 transition-all duration-200"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 * i, duration: 0.4 }}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${g.gradient} flex items-center justify-center mx-auto mb-3 shadow-md`}>
                  <g.icon size={18} className="text-white" />
                </div>
                <h3 className="font-['Syne'] text-sm font-bold text-slate-900 mb-1.5">{g.title}</h3>
                <p className="text-xs text-slate-500 font-['DM_Sans'] leading-relaxed">{g.description}</p>
              </motion.div>
            ))}
          </div>

          {/* CTA */}
          <CtaLink>
            <span className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-base font-semibold px-8 py-3.5 rounded-xl font-['DM_Sans'] shadow-lg shadow-indigo-500/30 transition-all cursor-pointer hover:-translate-y-0.5">
              Inizia Gratis — Zero Rischi
              <ArrowRight size={16} />
            </span>
          </CtaLink>
          <p className="text-xs text-slate-400 font-['DM_Sans'] mt-4">
            Già scelto da 200+ agency in tutta Italia
          </p>
        </motion.div>
      </div>
    </section>
  )
}
