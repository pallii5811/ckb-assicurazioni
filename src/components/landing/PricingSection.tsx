'use client'

import { Check, Zap, Shield } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'
import Link from 'next/link'

type Plan = {
  name: string
  price: string
  originalPrice?: string
  period: string
  desc: string
  features: string[]
  cta: string
  href?: string
  note: string
  highlight: boolean
  badge?: string
}

const plans: Plan[] = [
  {
    name: 'Esplora',
    price: '€0',
    period: 'per sempre',
    desc: 'Per capire cosa puoi fare',
    features: [
      '10 lead gratuiti una tantum',
      'Ricerca base per categoria e città',
      'Export CSV',
      'Nessuna carta richiesta',
    ],
    cta: 'Inizia Gratis',
    href: '/dashboard',
    note: '847 agency hanno iniziato così',
    highlight: false,
  },
  {
    name: 'Starter',
    price: '€29',
    originalPrice: '€49',
    period: '/ mese',
    desc: 'Per freelance e consulenti',
    features: [
      '500 crediti / mese',
      'Ricerca iper-localizzata',
      'Cellulari verificati',
      'Export CSV/Excel',
      'Supporto email',
    ],
    cta: 'Inizia Ora',
    note: '312 agency attive su questo piano',
    highlight: false,
    badge: '50% sconto lancio',
  },
  {
    name: 'PRO',
    price: '€99',
    period: '/ mese',
    desc: 'Per agency in crescita',
    highlight: true,
    badge: 'Più Scelto',
    features: [
      '3.000 crediti / mese',
      'Email decision maker',
      'Pitch AI personalizzato',
      'Freshness score & re-audit',
      'Export CSV/Excel',
      'Priorità supporto',
    ],
    cta: 'Inizia Ora',
    note: '189 agency chiudono clienti ogni giorno',
  },
  {
    name: 'Agency',
    price: '€249',
    period: '/ mese',
    desc: 'Per team e grandi volumi',
    features: [
      '10.000 crediti / mese',
      'Tutto del PRO',
      'Multi-utente & permessi',
      'API access',
      'Integrazioni CRM',
      'Account manager dedicato',
    ],
    cta: 'Parla con Noi',
    note: '43 agency enterprise attive',
    highlight: false,
  },
]

export default function PricingSection() {
  return (
    <section id="pricing" className="py-24 lg:py-32 bg-white relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-50/30 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 mb-6">
            <Zap size={12} className="text-indigo-500" />
            <span className="text-xs font-semibold text-slate-600 font-['DM_Sans'] uppercase tracking-wider">Prezzi</span>
          </div>
          <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 mb-4">
            Scegli il tuo{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              piano di crescita.
            </span>
          </h2>
          <p className="text-lg text-slate-500 font-['DM_Sans']">
            Parti gratis. Scala quando vuoi. Cancella in 1 click.
          </p>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {plans.map((p, idx) => (
            <motion.div
              key={p.name}
              className={`bg-white rounded-2xl flex flex-col relative ${
                p.highlight
                  ? 'border-2 border-indigo-500 shadow-xl shadow-indigo-100/50'
                  : 'border border-slate-200 shadow-sm hover:shadow-lg hover:shadow-slate-100/60'
              } transition-all duration-300 hover:-translate-y-1`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.08, duration: 0.5 }}
            >
              {/* Gradient top bar */}
              {p.highlight && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500 rounded-t-2xl" />
              )}

              {/* Popular badge */}
              {p.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-[10px] font-bold px-4 py-1 rounded-full font-['DM_Sans'] shadow-lg shadow-indigo-500/30 whitespace-nowrap">
                  Più Scelto
                </div>
              )}

              <div className="p-6 flex-1 flex flex-col">
                {/* Plan name + badge */}
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-[11px] font-bold uppercase tracking-widest font-['DM_Sans'] ${
                    p.highlight ? 'text-indigo-600' : 'text-slate-400'
                  }`}>
                    {p.name}
                  </span>
                  {p.badge && !p.highlight && (
                    <span className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-100 px-2.5 py-0.5 rounded-full font-['DM_Sans']">
                      {p.badge}
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="mb-2">
                  {p.originalPrice && (
                    <span className="text-sm text-slate-300 line-through font-['DM_Sans'] mr-1.5">{p.originalPrice}</span>
                  )}
                  <span className={`font-['Syne'] text-4xl font-bold tracking-tight ${
                    p.highlight ? 'text-indigo-600' : 'text-slate-900'
                  }`}>
                    {p.price}
                  </span>
                  <span className="text-sm text-slate-400 font-['DM_Sans'] ml-1">{p.period}</span>
                </div>

                <p className="text-sm text-slate-500 font-['DM_Sans'] mb-5">{p.desc}</p>

                <div className={`h-px mb-5 ${p.highlight ? 'bg-indigo-100' : 'bg-slate-100'}`} />

                {/* Features */}
                <div className="flex-1 space-y-2.5">
                  {p.features.map((f) => (
                    <div key={f} className="flex items-start gap-2.5">
                      <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        p.highlight ? 'bg-indigo-50' : 'bg-emerald-50'
                      }`}>
                        <Check size={10} className={p.highlight ? 'text-indigo-600' : 'text-emerald-600'} strokeWidth={3} />
                      </div>
                      <span className="text-sm text-slate-600 font-['DM_Sans'] leading-relaxed">{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div className="mt-6">
                  {p.href ? (
                    <Link
                      href={p.href}
                      className={`block text-center py-3 rounded-xl text-sm font-semibold font-['DM_Sans'] transition-all ${
                        p.highlight
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-700'
                          : 'border border-slate-200 text-slate-700 hover:border-indigo-200 hover:text-indigo-600'
                      }`}
                    >
                      {p.cta}
                    </Link>
                  ) : (
                    <CtaLink>
                      <span className={`block text-center py-3 rounded-xl text-sm font-semibold font-['DM_Sans'] cursor-pointer transition-all ${
                        p.highlight
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-700'
                          : p.name === 'Agency'
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'border border-slate-200 text-slate-700 hover:border-indigo-200 hover:text-indigo-600'
                      }`}>
                        {p.cta}
                      </span>
                    </CtaLink>
                  )}
                  <p className="text-[11px] text-slate-400 text-center mt-2.5 font-['DM_Sans']">{p.note}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Guarantee bar */}
        <motion.div
          className="flex items-center justify-center gap-3 bg-emerald-50 border border-emerald-100 rounded-xl px-6 py-4 max-w-lg mx-auto"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
        >
          <Shield size={18} className="text-emerald-600 flex-shrink-0" />
          <span className="text-sm text-emerald-800 font-['DM_Sans']">
            <strong>Garanzia 14 giorni</strong> soddisfatti o rimborsati. Nessun vincolo contrattuale.
          </span>
        </motion.div>
      </div>
    </section>
  )
}
