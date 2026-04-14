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
    description: 'Basta digitare "dentisti a Milano senza pixel" e il nostro motore NLP interpreta, filtra e trova lead qualificati in tempo reale.',
    accent: 'indigo',
  },
  {
    id: 'audit',
    label: 'Audit Tecnico',
    icon: Radar,
    headline: 'Radiografia digitale completa.',
    description: 'Per ogni lead analizziamo SEO, Meta Pixel, GTM, SSL, DMARC, velocità di caricamento, Google Ads, Analytics e social media.',
    accent: 'cyan',
  },
  {
    id: 'pitch',
    label: 'Pitch AI',
    icon: Sparkles,
    headline: "L'email perfetta, scritta per te.",
    description: "L'AI analizza i problemi specifici del lead e genera un pitch personalizzato con oggetto, corpo e CTA. Copia, incolla, invia.",
    accent: 'violet',
  },
  {
    id: 'score',
    label: 'Score AI',
    icon: BarChart3,
    headline: 'Sai chi chiamare per primo.',
    description: 'Ogni lead riceve uno score 0-100 basato sulla gravità dei problemi e sulla probabilità di conversione. Prioritizza i più caldi.',
    accent: 'emerald',
  },
  {
    id: 'contact',
    label: 'Contatti Diretti',
    icon: Send,
    headline: 'Cellulare del titolare. Non il centralino.',
    description: 'Identifichiamo decision maker, separiamo cellulari da fissi, e troviamo email dirette. Bypassa i filtri. Parla con chi firma.',
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
        <span className="text-sm text-slate-800 font-['DM_Sans'] font-medium">dentisti Milano senza pixel</span>
        <div className="ml-auto bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-lg">Cerca</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Categoria', value: 'Dentisti', color: 'bg-indigo-50 text-indigo-700' },
          { label: 'Città', value: 'Milano', color: 'bg-blue-50 text-blue-700' },
          { label: 'Filtro', value: 'No Pixel', color: 'bg-red-50 text-red-700' },
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
          ✓ Categoria: <strong>studi dentistici</strong> · Luogo: <strong>Milano</strong> · Filtro tecnico: <strong>Meta Pixel assente</strong>
        </div>
      </div>
    </div>
  )
}

function AuditMockup() {
  const items = [
    { label: 'Meta Pixel', status: false, severity: 'high' },
    { label: 'Google Analytics', status: true, severity: 'ok' },
    { label: 'SSL Certificate', status: true, severity: 'ok' },
    { label: 'Google Tag Manager', status: false, severity: 'medium' },
    { label: 'DMARC Record', status: false, severity: 'high' },
    { label: 'Page Speed', value: '4.2s', severity: 'medium' },
  ]
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold">72</div>
        <div>
          <div className="text-sm font-bold text-slate-800 font-['DM_Sans']">Studio Dentistico Rossi</div>
          <div className="text-xs text-slate-400 font-['DM_Sans']">studiodentisticorossi.it</div>
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
            Ho analizzato il vostro sito — 3 opportunità di crescita
          </div>
        </div>
        <div className="h-px bg-slate-100" />
        <div className="text-xs text-slate-600 font-['DM_Sans'] leading-relaxed">
          <p>Buongiorno Dott. Rossi,</p>
          <p className="mt-2">ho fatto un&apos;analisi tecnica del sito <strong>studiodentisticorossi.it</strong> e ho notato che:</p>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            <li>Il <strong>Meta Pixel</strong> non è installato — state perdendo dati preziosi per il remarketing</li>
            <li>Manca il <strong>DMARC</strong> — le vostre email rischiano di finire in spam</li>
            <li>Il sito carica in <strong>4.2 secondi</strong> — il 53% degli utenti abbandona dopo 3s</li>
          </ul>
          <p className="mt-2">Possiamo risolvere tutto in una settimana. Le va un caffè virtuale di 15 minuti?</p>
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
    { nome: 'Studio Rossi', score: 87, trend: '+12' },
    { nome: 'Dental Care', score: 72, trend: '+5' },
    { nome: 'Sorriso Perfetto', score: 64, trend: '+8' },
    { nome: 'Clinica Brera', score: 58, trend: '+3' },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 mb-2">
        {[
          { label: 'Lead trovati', value: '47', sub: 'in questa ricerca' },
          { label: 'Score medio', value: '68', sub: 'su 100' },
          { label: 'HOT lead', value: '12', sub: 'score > 75' },
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
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold">MR</div>
          <div>
            <div className="text-sm font-bold text-slate-800 font-['DM_Sans']">Marco Rossi</div>
            <div className="text-xs text-slate-400 font-['DM_Sans']">Titolare · Studio Dentistico Rossi</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: '📱', label: 'Cellulare', value: '348 123 ****', verified: true },
            { icon: '📧', label: 'Email', value: 'marco.rossi@...', verified: true },
            { icon: '📞', label: 'Fisso', value: '02 8595 6321', verified: false },
            { icon: '🌐', label: 'Sito', value: 'studiodent...', verified: false },
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
