'use client'

import { Search, Palette, BarChart3, Share2, Building2, MessageSquare, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'

const useCases = [
  {
    icon: Search,
    title: 'SEO Specialist',
    query: '"studi dentistici Milano senza meta description"',
    problem: 'Ore perse a cercare aziende senza SEO',
    solution: 'Filtri tecnici istantanei: niente H1, meta mancanti, errori critici.',
    result: '+€4.200',
    period: '/mese',
    gradient: 'from-indigo-500 to-violet-500',
    light: 'bg-indigo-50',
    textColor: 'text-indigo-600',
  },
  {
    icon: Palette,
    title: 'Web Designer',
    query: '"ristoranti Roma sito lento no mobile"',
    problem: 'Clienti con siti vecchi ma come trovarli?',
    solution: 'Trova aziende con siti lenti e non responsive. Restyling assicurato.',
    result: '+€5.800',
    period: '/mese',
    gradient: 'from-violet-500 to-purple-500',
    light: 'bg-violet-50',
    textColor: 'text-violet-600',
  },
  {
    icon: BarChart3,
    title: 'Ads Manager',
    query: '"palestre Napoli senza Google Ads senza pixel"',
    problem: 'Chiami aziende che già fanno ads con altri',
    solution: 'Zero Pixel + Zero Google Ads = campo completamente libero per te.',
    result: '+€6.500',
    period: '/mese',
    gradient: 'from-cyan-500 to-blue-500',
    light: 'bg-cyan-50',
    textColor: 'text-cyan-600',
  },
  {
    icon: Share2,
    title: 'Social Media Manager',
    query: '"negozi Firenze senza Instagram"',
    problem: 'Difficile trovare chi non ha presenza social',
    solution: 'Vedi Instagram e Facebook di ogni lead. Proposta mirata su chi manca.',
    result: '+€2.800',
    period: '/mese',
    gradient: 'from-pink-500 to-rose-500',
    light: 'bg-pink-50',
    textColor: 'text-pink-600',
  },
  {
    icon: Building2,
    title: 'Agenzia Marketing',
    query: '"aziende Lombardia con errori SEO"',
    problem: 'Pipeline vuota, dipendenza da referral',
    solution: 'Ricerche illimitate, 5 utenti, flusso costante di lead qualificati.',
    result: '+€18K',
    period: '/mese',
    gradient: 'from-emerald-500 to-teal-500',
    light: 'bg-emerald-50',
    textColor: 'text-emerald-600',
  },
  {
    icon: MessageSquare,
    title: 'Consulente Digitale',
    query: '"commercialisti Torino senza DMARC"',
    problem: 'Arrivi impreparato alle call',
    solution: 'Audit completo + pitch AI = sai tutto prima di alzare il telefono.',
    result: '+€3.900',
    period: '/mese',
    gradient: 'from-amber-500 to-orange-500',
    light: 'bg-amber-50',
    textColor: 'text-amber-600',
  },
]

export function UseCases() {
  return (
    <section className="py-24 lg:py-32 bg-slate-50 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 w-[800px] h-[400px] -translate-x-1/2 bg-indigo-50/40 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Header — left-aligned for variety */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-end mb-16">
          <div>
            <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 mb-6 shadow-sm">
              <span className="text-xs font-semibold text-slate-600 font-['DM_Sans'] uppercase tracking-wider">Per chi è MIRAX</span>
            </div>
            <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
              Costruito per chi{' '}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                chiude contratti.
              </span>
            </h2>
          </div>
          <p className="text-lg text-slate-500 font-['DM_Sans'] leading-relaxed lg:text-right">
            Che tu sia freelance, consulente o agenzia —
            MIRAX si adatta al tuo settore e al tuo workflow.
          </p>
        </div>

        {/* Top row: 2 large featured cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          {useCases.slice(0, 2).map((u, idx) => (
            <motion.div
              key={u.title}
              className="bg-white rounded-2xl border border-slate-200 p-7 relative overflow-hidden group hover:shadow-xl hover:shadow-slate-200/60 transition-all duration-300 hover:-translate-y-1"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1, duration: 0.5 }}
            >
              {/* Gradient accent bar */}
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${u.gradient}`} />

              <div className="flex items-start justify-between mb-5">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${u.gradient} flex items-center justify-center shadow-lg`}>
                  <u.icon size={22} className="text-white" />
                </div>
                <div className="text-right">
                  <div className="font-['Syne'] text-2xl font-bold text-slate-900">{u.result}</div>
                  <div className="text-xs text-slate-400 font-['DM_Sans']">{u.period}</div>
                </div>
              </div>

              <h3 className="font-['Syne'] text-xl font-bold text-slate-900 mb-2">{u.title}</h3>
              <p className="text-sm text-slate-400 font-['DM_Sans'] line-through mb-2">{u.problem}</p>
              <p className="text-sm text-slate-600 font-['DM_Sans'] leading-relaxed mb-4">{u.solution}</p>

              {/* Example query */}
              <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                <div className="text-[10px] text-slate-400 font-['DM_Sans'] mb-0.5 uppercase tracking-wider font-semibold">Esempio ricerca</div>
                <div className={`text-xs font-semibold ${u.textColor} font-['DM_Sans']`}>{u.query}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom row: 4 compact cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {useCases.slice(2).map((u, idx) => (
            <motion.div
              key={u.title}
              className="bg-white rounded-2xl border border-slate-200 p-5 relative overflow-hidden group hover:shadow-lg hover:shadow-slate-200/50 transition-all duration-300 hover:-translate-y-1"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + idx * 0.1, duration: 0.5 }}
            >
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${u.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />

              <div className="flex items-center justify-between mb-4">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${u.gradient} flex items-center justify-center`}>
                  <u.icon size={18} className="text-white" />
                </div>
                <span className="font-['Syne'] text-lg font-bold text-emerald-600">{u.result}<span className="text-xs text-slate-400">{u.period}</span></span>
              </div>

              <h3 className="font-['Syne'] text-base font-bold text-slate-900 mb-1.5">{u.title}</h3>
              <p className="text-xs text-slate-400 font-['DM_Sans'] line-through mb-1">{u.problem}</p>
              <p className="text-xs text-slate-600 font-['DM_Sans'] leading-relaxed">{u.solution}</p>
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <motion.div
          className="text-center mt-14"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          <a href="/auth" className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-semibold font-['DM_Sans'] text-sm transition-colors">
            MIRAX funziona per qualsiasi settore
            <ArrowRight size={16} />
          </a>
        </motion.div>
      </div>
    </section>
  )
}
