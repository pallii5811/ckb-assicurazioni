'use client'

import {
  Radar, Users, Smartphone, Star, Sparkles, RefreshCcw, ArrowRight,
} from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

export default function ArsenalSection() {
  return (
    <section id="arsenal" className="py-24 lg:py-32 bg-slate-50 relative overflow-hidden">
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-violet-50/40 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 mb-6 shadow-sm">
            <Radar size={12} className="text-indigo-500" />
            <span className="text-xs font-semibold text-slate-600 font-['DM_Sans'] uppercase tracking-wider">L&apos;arsenale completo</span>
          </div>
          <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 mb-5">
            Tutto quello che serve{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              per chiudere contratti.
            </span>
          </h2>
          <p className="text-lg text-slate-500 font-['DM_Sans'] max-w-lg mx-auto">
            Non cerchi contatti. Trovi aziende che hanno già bisogno di te.
          </p>
        </div>

        {/* Bento Grid — varied layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Card 1 — Radar X (large, with mini audit preview) */}
          <motion.div
            className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-7 relative overflow-hidden group hover:shadow-xl hover:shadow-indigo-100/50 transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mb-5 shadow-lg">
                  <Radar size={22} className="text-white" />
                </div>
                <h3 className="font-['Syne'] text-xl font-bold text-slate-900 mb-2">Radar X Tecnologico</h3>
                <p className="text-sm text-slate-500 font-['DM_Sans'] leading-relaxed mb-4">
                  Vedi istantaneamente se usano Meta Pixel, Google Ads, GTM o se hanno un sito che fa scappare i visitatori.
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {['Meta Pixel', 'Google Ads', 'GTM', 'SSL', 'DMARC', 'SEO'].map(tag => (
                    <span key={tag} className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full font-['DM_Sans']">{tag}</span>
                  ))}
                </div>
              </div>
              {/* Mini audit mockup */}
              <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-2">
                {[
                  { label: 'Meta Pixel', ok: false },
                  { label: 'SSL', ok: true },
                  { label: 'GTM', ok: false },
                  { label: 'DMARC', ok: false },
                  { label: 'Analytics', ok: true },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-1.5 px-2.5 rounded bg-white border border-slate-50">
                    <span className="text-[11px] font-medium text-slate-600 font-['DM_Sans']">{item.label}</span>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${item.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      {item.ok ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Card 2 — Decision Maker */}
          <motion.div
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden group hover:shadow-lg hover:shadow-cyan-100/50 transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center mb-4">
              <Users size={20} className="text-white" />
            </div>
            <h3 className="font-['Syne'] text-lg font-bold text-slate-900 mb-2">Decision Maker</h3>
            <p className="text-sm text-slate-500 font-['DM_Sans'] leading-relaxed mb-4">
              Identifichiamo titolari e contatti diretti. Bypassa i centralini.
            </p>
            {/* Mini contact preview */}
            <div className="flex items-center gap-2.5 bg-slate-50 rounded-lg p-2.5 border border-slate-100">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold">MR</div>
              <div>
                <div className="text-[11px] font-bold text-slate-700 font-['DM_Sans']">Marco Rossi</div>
                <div className="text-[10px] text-slate-400 font-['DM_Sans']">Titolare · 348 *** ****</div>
              </div>
            </div>
          </motion.div>

          {/* Card 3 — Cellulari Verificati */}
          <motion.div
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden group hover:shadow-lg hover:shadow-emerald-100/50 transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center justify-between mb-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                <Smartphone size={20} className="text-white" />
              </div>
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full font-['DM_Sans'] uppercase tracking-wider">Verificato</span>
            </div>
            <h3 className="font-['Syne'] text-lg font-bold text-slate-900 mb-2">Cellulari Verificati</h3>
            <p className="text-sm text-slate-500 font-['DM_Sans'] leading-relaxed">
              Il nostro algoritmo separa cellulari dai fissi. Zero sprechi su numeri spenti.
            </p>
          </motion.div>

          {/* Card 4 — Pitch AI (large, with preview) */}
          <motion.div
            className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-7 relative overflow-hidden group hover:shadow-xl hover:shadow-violet-100/50 transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg">
                    <Sparkles size={22} className="text-white" />
                  </div>
                  <span className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-2.5 py-1 rounded-full font-['DM_Sans'] uppercase tracking-wider">AI Powered</span>
                </div>
                <h3 className="font-['Syne'] text-xl font-bold text-slate-900 mb-2">Pitch AI Personalizzato</h3>
                <p className="text-sm text-slate-500 font-['DM_Sans'] leading-relaxed">
                  Un messaggio scritto su misura per ogni lead, basato sui problemi specifici. Oggetto, corpo e CTA. Copia, incolla, manda.
                </p>
              </div>
              {/* Mini pitch preview */}
              <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={11} className="text-violet-500" />
                  <span className="text-[10px] font-bold text-slate-500 font-['DM_Sans']">PITCH GENERATO</span>
                </div>
                <div className="text-[11px] text-slate-600 font-['DM_Sans'] leading-relaxed italic">
                  &quot;Buongiorno Marco, ho analizzato il sito di Studio Rossi e ho notato che manca il pixel di tracciamento. State perdendo dati preziosi per...&quot;
                </div>
                <div className="flex gap-2 mt-3">
                  <span className="text-[9px] font-bold text-white bg-violet-500 px-2.5 py-1 rounded-lg">Copia</span>
                  <span className="text-[9px] font-bold text-violet-600 bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-100">Modifica</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Card 5 — Reputazione */}
          <motion.div
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden group hover:shadow-lg hover:shadow-amber-100/50 transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25, duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center mb-4">
              <Star size={20} className="text-white" />
            </div>
            <h3 className="font-['Syne'] text-lg font-bold text-slate-900 mb-2">Analisi Reputazione</h3>
            <p className="text-sm text-slate-500 font-['DM_Sans'] leading-relaxed mb-3">
              Trova aziende con rating in calo. Le più facili da chiudere.
            </p>
            <div className="flex items-center gap-1">
              {[1,2,3,4].map(i => (
                <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
              ))}
              <Star size={14} className="text-slate-200" />
              <span className="text-[10px] text-slate-400 font-['DM_Sans'] ml-1">3.2 · in calo</span>
            </div>
          </motion.div>

          {/* Card 6 — Freschezza */}
          <motion.div
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden group hover:shadow-lg hover:shadow-pink-100/50 transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 to-rose-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center justify-between mb-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
                <RefreshCcw size={20} className="text-white" />
              </div>
              <span className="text-[9px] font-bold text-pink-600 bg-pink-50 border border-pink-100 px-2.5 py-1 rounded-full font-['DM_Sans'] uppercase tracking-wider">Auto-sync</span>
            </div>
            <h3 className="font-['Syne'] text-lg font-bold text-slate-900 mb-2">Freschezza Garantita</h3>
            <p className="text-sm text-slate-500 font-['DM_Sans'] leading-relaxed">
              Dati aggiornati ogni 30 giorni. Zero lead obsoleti, zero tempo sprecato.
            </p>
          </motion.div>

          {/* Card 7 — Scoring */}
          <motion.div
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.35, duration: 0.5 }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-600 to-slate-800 opacity-0 group-hover:opacity-100 transition-opacity" />
            <h3 className="font-['Syne'] text-lg font-bold text-slate-900 mb-3">Score di Priorità</h3>
            <p className="text-xs text-slate-500 font-['DM_Sans'] leading-relaxed mb-3">Ogni lead con uno score 0-100 per sapere chi chiamare prima.</p>
            <div className="flex items-end gap-1.5">
              {[45, 58, 72, 87, 64, 91, 53].map((v, i) => (
                <div key={i} className="flex-1 rounded-t" style={{
                  height: `${v * 0.5}px`,
                  background: v >= 80 ? 'linear-gradient(to top, #ef4444, #f97316)' :
                             v >= 60 ? 'linear-gradient(to top, #f59e0b, #eab308)' :
                             'linear-gradient(to top, #94a3b8, #cbd5e1)',
                }} />
              ))}
            </div>
          </motion.div>

          {/* CTA Banner */}
          <motion.div
            className="col-span-1 md:col-span-2 lg:col-span-3 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 rounded-2xl p-8 lg:p-10 flex flex-col sm:flex-row items-center justify-between gap-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            <div>
              <h3 className="font-['Syne'] text-xl lg:text-2xl font-bold text-white mb-2">
                Pronto a chiudere i tuoi prossimi clienti?
              </h3>
              <p className="text-sm text-white/60 font-['DM_Sans']">
                Unisciti a 200+ agency italiane che usano MIRAX ogni giorno.
              </p>
            </div>
            <CtaLink>
              <span className="inline-flex items-center gap-2 bg-white text-indigo-600 font-bold text-sm px-7 py-3.5 rounded-xl font-['DM_Sans'] shadow-lg hover:shadow-xl transition-all cursor-pointer hover:-translate-y-0.5">
                Inizia Gratis
                <ArrowRight size={16} />
              </span>
            </CtaLink>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
