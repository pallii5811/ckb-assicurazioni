'use client'

import { ArrowRight, Search, Zap, Shield, Sparkles } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

const queries = [
  'aziende edili Milano verifica RC',
  'studi legali Napoli verifica D&O',
  'ristoranti Roma verifica RCT/O',
  'trasportatori Torino verifica flotta',
  'commercialisti Bologna verifica RC professionale',
]

const demoLeads = [
  { nome: 'Edilizia Rossi Srl', citta: 'Milano', score: 92, problems: ['RC DA VERIFICARE', 'D&O DA VERIFICARE'], tel: '02 8595 ****', email: 'info@edilizi...', hasWebsite: true },
  { nome: 'Trasporti Centrali Spa', citta: 'Milano', score: 78, problems: ['FLOTTA DA VERIFICARE', 'CYBER DA VERIFICARE'], tel: '347 123 ****', email: 'marco@trasp...', hasWebsite: true },
  { nome: 'Studio Legale Bianchi', citta: 'Milano', score: 71, problems: ['RC PROF DA VERIFICARE', 'KEY PERSON DA VERIFICARE'], tel: '02 4567 ****', email: 'avv@studio...', hasWebsite: true },
  { nome: 'Tech Solutions Srl', citta: 'Milano', score: 65, problems: ['CYBER DA VERIFICARE', 'D&O DA VERIFICARE'], tel: '340 987 ****', email: 'info@techso...', hasWebsite: true },
]

function TypingText({ texts }: { texts: string[] }) {
  const [index, setIndex] = useState(0)
  const [displayed, setDisplayed] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    const current = texts[index]
    let timeout: NodeJS.Timeout

    if (!isDeleting && displayed.length < current.length) {
      timeout = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 60)
    } else if (!isDeleting && displayed.length === current.length) {
      timeout = setTimeout(() => setIsDeleting(true), 2000)
    } else if (isDeleting && displayed.length > 0) {
      timeout = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 30)
    } else if (isDeleting && displayed.length === 0) {
      setIsDeleting(false)
      setIndex((index + 1) % texts.length)
    }
    return () => clearTimeout(timeout)
  }, [displayed, isDeleting, index, texts])

  return (
    <span className="text-indigo-500">{displayed}<span className="animate-pulse">|</span></span>
  )
}

function DashboardMockup() {
  const [activeRow, setActiveRow] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setActiveRow(p => (p + 1) % demoLeads.length), 2500)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="relative w-full">
      {/* Browser chrome */}
      <div className="bg-slate-800 rounded-t-2xl px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 mx-4">
          <div className="bg-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-400 font-mono">
            app.ckbassicurazione.it/dashboard
          </div>
        </div>
      </div>

      {/* App content */}
      <div className="bg-white rounded-b-2xl border border-slate-200 border-t-0 overflow-hidden shadow-2xl shadow-indigo-500/10">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2">
            <Search size={14} className="text-slate-400" />
            <span className="text-sm text-slate-500 font-['DM_Sans']">
              <TypingText texts={queries} />
            </span>
          </div>
          <div className="bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg font-['DM_Sans'] flex items-center gap-1.5">
            <Zap size={12} />
            Cerca
          </div>
        </div>

        {/* Results header */}
        <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800 font-['DM_Sans']">4 risultati</span>
            <span className="text-xs text-emerald-600 font-medium font-['DM_Sans'] flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Live
            </span>
          </div>
          <div className="flex gap-1.5">
            {['Score', 'Problemi', 'Contatti'].map(f => (
              <span key={f} className="text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded font-['DM_Sans']">{f}</span>
            ))}
          </div>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-12 px-5 py-2 bg-slate-50/50 text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-['DM_Sans'] border-b border-slate-100">
          <div className="col-span-4">Azienda</div>
          <div className="col-span-2 text-center">Score</div>
          <div className="col-span-3">Problemi</div>
          <div className="col-span-3 text-right">Contatto</div>
        </div>

        {/* Rows */}
        {demoLeads.map((lead, i) => (
          <motion.div
            key={lead.nome}
            className={`grid grid-cols-12 px-5 py-3 items-center border-b border-slate-50 cursor-pointer transition-colors duration-200 ${
              i === activeRow ? 'bg-indigo-50/60' : 'hover:bg-slate-50/60'
            }`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 * i, duration: 0.4 }}
          >
            <div className="col-span-4">
              <div className="text-xs font-semibold text-slate-800 font-['DM_Sans'] truncate">{lead.nome}</div>
              <div className="text-[10px] text-slate-400 font-['DM_Sans']">{lead.citta}</div>
            </div>
            <div className="col-span-2 flex justify-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                lead.score >= 80 ? 'bg-gradient-to-br from-red-500 to-orange-500' :
                lead.score >= 60 ? 'bg-gradient-to-br from-orange-400 to-amber-400' :
                'bg-gradient-to-br from-amber-400 to-yellow-400'
              }`}>
                {lead.score}
              </div>
            </div>
            <div className="col-span-3 flex gap-1 flex-wrap">
              {lead.problems.map(p => (
                <span key={p} className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-['DM_Sans']">{p}</span>
              ))}
            </div>
            <div className="col-span-3 text-right">
              <div className="text-[10px] text-emerald-600 font-medium font-['DM_Sans']">{lead.tel}</div>
              <div className="text-[10px] text-slate-400 font-['DM_Sans']">{lead.email}</div>
            </div>
          </motion.div>
        ))}

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50/60 border-t border-slate-100">
          <span className="text-[10px] text-slate-400 font-mono">CKB Assicurazione · ai-powered</span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-indigo-500 font-semibold font-['DM_Sans'] flex items-center gap-1">
              <Sparkles size={10} />
              Genera Pitch
            </span>
            <span className="text-[10px] text-slate-400 font-['DM_Sans']">Esporta CSV</span>
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <motion.div
        className="absolute -right-4 top-20 bg-white rounded-xl shadow-lg shadow-slate-200/60 border border-slate-100 px-3 py-2 hidden lg:block"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.2, duration: 0.5 }}
      >
        <div className="text-[10px] text-slate-400 font-['DM_Sans'] mb-1">Score AI</div>
        <div className="text-lg font-bold text-indigo-600 font-['Syne']">87<span className="text-xs text-slate-400">/100</span></div>
      </motion.div>

      <motion.div
        className="absolute -left-4 bottom-24 bg-white rounded-xl shadow-lg shadow-slate-200/60 border border-slate-100 px-3 py-2 hidden lg:block"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.5, duration: 0.5 }}
      >
        <div className="text-[10px] text-slate-400 font-['DM_Sans'] mb-1">Pitch generato</div>
        <div className="text-[10px] text-emerald-600 font-semibold font-['DM_Sans'] flex items-center gap-1">
          <Sparkles size={10} /> Pronto in 3 sec
        </div>
      </motion.div>
    </div>
  )
}

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white">
      {/* Mesh gradient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-indigo-100/40 rounded-full blur-3xl" />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] bg-violet-100/30 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-50/40 rounded-full blur-3xl" />
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(#6366F1 1px, transparent 1px), linear-gradient(90deg, #6366F1 1px, transparent 1px)',
          backgroundSize: '60px 60px'
        }} />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8 pt-20 pb-28 lg:pt-28 lg:pb-36">
        {/* Top center text */}
        <motion.div
          className="text-center mb-16 lg:mb-20"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          {/* Badge */}
          <motion.div
            className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-full px-4 py-1.5 mb-8"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-indigo-600 font-['DM_Sans']">
              47.293 aziende analizzate oggi — aree assicurative qualificate
            </span>
          </motion.div>

          {/* Main headline */}
          <h1 className="font-['Syne'] text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight text-slate-900 mb-6 leading-[1.08]">
            L'intelligence assicurativa
            <br />
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 bg-clip-text text-transparent">
              che chiude i contratti.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-slate-500 font-['DM_Sans'] max-w-2xl mx-auto mb-10 leading-relaxed">
            CKB analizza milioni di aziende italiane, qualifica aree assicurative da verificare
            e ti consegna prospect con proposta consulenziale già pronta.
          </p>

          {/* CTA row */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CtaLink>
              <span className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-base font-semibold px-8 py-3.5 rounded-xl font-['DM_Sans'] shadow-lg shadow-indigo-500/30 transition-all duration-200 cursor-pointer hover:shadow-xl hover:shadow-indigo-500/40 hover:-translate-y-0.5">
                Inizia Gratis — 10 Prospect
                <ArrowRight size={18} />
              </span>
            </CtaLink>
            <button
              type="button"
              onClick={() => document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-medium font-['DM_Sans'] transition-colors"
            >
              <span className="w-9 h-9 rounded-full border border-slate-200 bg-white flex items-center justify-center shadow-sm">
                <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><polygon points="0,0 10,6 0,12" /></svg>
              </span>
              Vedi come funziona
            </button>
          </div>

          {/* Trust row */}
          <div className="flex flex-wrap items-center justify-center gap-6 mt-10 text-sm text-slate-400 font-['DM_Sans']">
            <span className="flex items-center gap-1.5"><Shield size={14} className="text-emerald-500" /> GDPR Compliant</span>
            <span className="text-slate-200">|</span>
            <span>Nessuna carta richiesta</span>
            <span className="text-slate-200">|</span>
            <span className="flex items-center gap-1">★★★★★ <strong className="text-slate-600">4.9/5</strong> da 200+ broker</span>
          </div>
        </motion.div>

        {/* Product mockup */}
        <motion.div
          className="max-w-4xl mx-auto"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <DashboardMockup />
        </motion.div>
      </div>
    </section>
  )
}
