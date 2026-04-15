'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Radar, Sparkles, BarChart3, Send } from 'lucide-react'

const tabs = [
  {
    id: 'search',
    label: 'Ricerca AI',
    icon: Search,
    headline: 'Scrivi in italiano. Trova in secondi.',
    description: 'Basta digitare "trasportatori Veneto senza D&O" e il nostro motore NLP interpreta settore, territorio e gap assicurativi in tempo reale.',
    accent: 'indigo',
  },
  {
    id: 'audit',
    label: 'Analisi Rischio',
    icon: Radar,
    headline: 'Radiografia assicurativa completa.',
    description: 'Per ogni azienda analizziamo ATECO, fatturato, dipendenti, rischio territoriale, forma giuridica e coperture mancanti.',
    accent: 'cyan',
  },
  {
    id: 'pitch',
    label: 'Pitch AI',
    icon: Sparkles,
    headline: 'La proposta perfetta, scritta per te.',
    description: "L'AI analizza i gap assicurativi dell'azienda e genera una proposta commerciale personalizzata. Copia, incolla, invia.",
    accent: 'violet',
  },
  {
    id: 'score',
    label: 'Score AI',
    icon: BarChart3,
    headline: 'Sai chi chiamare per primo.',
    description: 'Ogni azienda riceve un risk score 0-100 basato sui gap assicurativi e sul profilo di rischio. Prioritizza le più scoperte.',
    accent: 'emerald',
  },
  {
    id: 'contact',
    label: 'Contatti Diretti',
    icon: Send,
    headline: 'Cellulare del titolare. Non il centralino.',
    description: 'Identifichiamo titolari e amministratori, troviamo cellulari, PEC e email dirette. Parla con chi decide.',
    accent: 'amber',
  },
]

const accentMap: Record<string, { bg: string; text: string; border: string; light: string; gradient: string }> = {
  indigo: { bg: 'bg-indigo-500', text: 'text-indigo-600', border: 'border-indigo-500', light: 'bg-indigo-50', gradient: 'from-indigo-500 to-violet-500' },
  cyan: { bg: 'bg-cyan-500', text: 'text-cyan-600', border: 'border-cyan-500', light: 'bg-cyan-50', gradient: 'from-cyan-500 to-blue-500' },
  violet: { bg: 'bg-violet-500', text: 'text-violet-600', border: 'border-violet-500', light: 'bg-violet-50', gradient: 'from-violet-500 to-purple-500' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600', border: 'border-emerald-500', light: 'bg-emerald-50', gradient: 'from-emerald-500 to-teal-500' },
  amber: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-500', light: 'bg-amber-50', gradient: 'from-amber-500 to-orange-500' },
}

function SearchMockup() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
        <Search size={16} className="text-slate-400" />
        <span className="text-sm text-slate-800 font-['DM_Sans'] font-medium">trasportatori Veneto senza D&O</span>
        <div className="ml-auto bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-lg">Cerca</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Settore', value: 'Trasporti', color: 'bg-indigo-50 text-indigo-700' },
          { label: 'Territorio', value: 'Veneto', color: 'bg-blue-50 text-blue-700' },
          { label: 'Gap', value: 'No D&O', color: 'bg-red-50 text-red-700' },
        ].map(f => (
          <div key={f.label} className={`${f.color} rounded-lg px-3 py-2 text-center`}>
            <div className="text-[10px] opacity-60 font-['DM_Sans']">{f.label}</div>
            <div className="text-xs font-bold font-['DM_Sans']">{f.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
        <div className="text-[10px] text-slate-400 font-['DM_Sans'] mb-2 uppercase tracking-wider font-semibold">Interpretazione AI</div>
        <div className="text-xs text-slate-600 font-['DM_Sans'] leading-relaxed">
          ✓ Settore: <strong>autotrasporti</strong> · Territorio: <strong>Veneto</strong> · Gap: <strong>polizza D&O assente</strong>
        </div>
      </div>
    </div>
  )
}

function AuditMockup() {
  const items = [
    { label: 'RC Generale', status: true, severity: 'ok' },
    { label: 'RC Vettoriale', status: true, severity: 'ok' },
    { label: 'D&O', status: false, severity: 'high' },
    { label: 'Cyber Risk', status: false, severity: 'medium' },
    { label: 'Infortuni', status: false, severity: 'high' },
    { label: 'Fatturato', value: '€5.1M', severity: 'medium' },
  ]
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold">72</div>
        <div>
          <div className="text-sm font-bold text-slate-800 font-['DM_Sans']">Logistica Nord S.r.l.</div>
          <div className="text-xs text-slate-400 font-['DM_Sans']">ATECO 49.41 · Verona · 78 dip.</div>
        </div>
      </div>
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white border border-slate-100">
          <span className="text-xs font-medium text-slate-600 font-['DM_Sans']">{item.label}</span>
          {'value' in item && item.value ? (
            <span className="text-xs font-bold text-amber-600 font-['DM_Sans']">{item.value}</span>
          ) : (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              item.status ? 'bg-emerald-50 text-emerald-600' : item.severity === 'high' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {item.status ? '✓ OK' : '✗ ASSENTE'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function PitchMockup() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <Sparkles size={14} className="text-violet-500" />
        <span className="text-xs font-bold text-slate-700 font-['DM_Sans']">Pitch AI Generato</span>
        <span className="ml-auto text-[10px] text-emerald-600 font-semibold font-['DM_Sans']">● Generato in 3.2s</span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <div className="text-[10px] text-slate-400 font-['DM_Sans'] mb-1">OGGETTO</div>
          <div className="text-xs font-semibold text-slate-800 font-['DM_Sans']">
            Analisi rischio Logistica Nord — 3 gap assicurativi critici
          </div>
        </div>
        <div className="h-px bg-slate-100" />
        <div className="text-xs text-slate-600 font-['DM_Sans'] leading-relaxed">
          <p>Buongiorno Dott. Verdi,</p>
          <p className="mt-2">ho analizzato il profilo di rischio di <strong>Logistica Nord S.r.l.</strong> e ho individuato:</p>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            <li>Manca la <strong>polizza D&O</strong> — con 78 dipendenti il rischio patrimoniale per gli amministratori è elevato</li>
            <li>Assente <strong>copertura Cyber Risk</strong> — nel settore trasporti i dati logistici sono un target frequente</li>
            <li>Nessuna <strong>polizza Infortuni collettiva</strong> — il settore ha indice di sinistrosità sopra la media</li>
          </ul>
          <p className="mt-2">Posso prepararle una proposta su misura. Le va un confronto di 15 minuti?</p>
        </div>
        <div className="flex gap-2 mt-3">
          <span className="text-[10px] font-bold text-white bg-violet-500 px-3 py-1.5 rounded-lg">Copia Pitch</span>
          <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg border border-violet-100">Personalizza</span>
        </div>
      </div>
    </div>
  )
}

function ScoreMockup() {
  const leads = [
    { nome: 'Logistica Nord', score: 87, trend: '+12' },
    { nome: 'Tecnofer Srl', score: 72, trend: '+5' },
    { nome: 'Edilstrade SpA', score: 64, trend: '+8' },
    { nome: 'Agrifood Italia', score: 58, trend: '+3' },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 mb-2">
        {[
          { label: 'Aziende', value: '127', sub: 'in questa ricerca' },
          { label: 'Risk score', value: '72', sub: 'medio' },
          { label: 'Gap critici', value: '34', sub: 'score > 75' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-slate-100 p-3 text-center">
            <div className="text-lg font-bold text-slate-800 font-['Syne']">{s.value}</div>
            <div className="text-[10px] text-slate-400 font-['DM_Sans']">{s.sub}</div>
          </div>
        ))}
      </div>
      {leads.map((l, i) => (
        <div key={l.nome} className="flex items-center gap-3 bg-white rounded-lg border border-slate-100 px-3 py-2.5">
          <span className="text-xs font-bold text-slate-400 font-['DM_Sans'] w-4">{i + 1}</span>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
            l.score >= 80 ? 'bg-gradient-to-br from-red-500 to-orange-500' :
            l.score >= 65 ? 'bg-gradient-to-br from-orange-400 to-amber-400' :
            'bg-gradient-to-br from-amber-400 to-yellow-400'
          }`}>{l.score}</div>
          <span className="text-xs font-semibold text-slate-700 font-['DM_Sans'] flex-1">{l.nome}</span>
          <span className="text-[10px] font-bold text-emerald-600 font-['DM_Sans']">{l.trend}%</span>
        </div>
      ))}
    </div>
  )
}

function ContactMockup() {
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold">AV</div>
          <div>
            <div className="text-sm font-bold text-slate-800 font-['DM_Sans']">Andrea Verdi</div>
            <div className="text-xs text-slate-400 font-['DM_Sans']">Amministratore · Logistica Nord S.r.l.</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: '📱', label: 'Cellulare', value: '348 123 ****', verified: true },
            { icon: '📧', label: 'PEC', value: 'logisticanord@pec.it', verified: true },
            { icon: '📞', label: 'Fisso', value: '045 891 2345', verified: false },
            { icon: '�', label: 'REA', value: 'VR-345678', verified: false },
          ].map(c => (
            <div key={c.label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs">{c.icon}</span>
                <span className="text-[10px] text-slate-400 font-['DM_Sans']">{c.label}</span>
                {c.verified && <span className="text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full ml-auto">✓</span>}
              </div>
              <div className="text-xs font-semibold text-slate-700 font-['DM_Sans']">{c.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <span className="flex-1 text-center text-[10px] font-bold text-white bg-emerald-500 px-3 py-2 rounded-lg">📱 Chiama Cellulare</span>
        <span className="flex-1 text-center text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg border border-indigo-100">📧 Invia Email</span>
      </div>
    </div>
  )
}

const mockups: Record<string, () => React.ReactNode> = {
  search: SearchMockup,
  audit: AuditMockup,
  pitch: PitchMockup,
  score: ScoreMockup,
  contact: ContactMockup,
}

export default function ProductShowcase() {
  const [active, setActive] = useState('search')
  const tab = tabs.find(t => t.id === active)!
  const colors = accentMap[tab.accent]
  const MockupComponent = mockups[active]

  return (
    <section className="relative py-24 lg:py-32 bg-slate-950 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-indigo-950/50 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-violet-950/30 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span className="text-xs font-semibold text-indigo-400 font-['DM_Sans'] uppercase tracking-wider">Piattaforma</span>
          </div>
          <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 tracking-tight">
            Un arsenale completo.{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Una sola piattaforma.
            </span>
          </h2>
          <p className="text-lg text-slate-400 font-['DM_Sans'] max-w-xl mx-auto">
            Dalla ricerca al contatto, tutto in un flusso continuo.
            Vedi esattamente cosa fa CKB per te.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {tabs.map(t => {
            const isActive = t.id === active
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold font-['DM_Sans'] transition-all duration-200 ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-lg shadow-white/10'
                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5'
                }`}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: text */}
          <AnimatePresence mode="wait">
            <motion.div
              key={active + '-text'}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.35 }}
            >
              <div className={`inline-flex items-center gap-2 ${colors.light} rounded-full px-3 py-1 mb-6`}>
                <tab.icon size={14} className={colors.text} />
                <span className={`text-xs font-bold ${colors.text} font-['DM_Sans'] uppercase tracking-wider`}>{tab.label}</span>
              </div>

              <h3 className="font-['Syne'] text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-4 tracking-tight leading-tight">
                {tab.headline}
              </h3>

              <p className="text-base text-slate-400 font-['DM_Sans'] leading-relaxed mb-8 max-w-md">
                {tab.description}
              </p>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colors.gradient} flex items-center justify-center`}>
                    <span className="text-white text-xs font-bold">✓</span>
                  </div>
                  <span className="text-sm text-slate-300 font-['DM_Sans']">Tempo reale</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colors.gradient} flex items-center justify-center`}>
                    <span className="text-white text-xs font-bold">AI</span>
                  </div>
                  <span className="text-sm text-slate-300 font-['DM_Sans']">Powered by AI</span>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Right: mockup */}
          <AnimatePresence mode="wait">
            <motion.div
              key={active + '-mockup'}
              className="bg-slate-900 rounded-2xl border border-white/10 p-5 shadow-2xl"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <MockupComponent />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
