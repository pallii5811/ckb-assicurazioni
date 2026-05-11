'use client'

import { Search, Radar, Sparkles, ArrowRight, Phone, Mail, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

const steps = [
  {
    number: '01',
    title: 'Descrivi il tuo target in italiano',
    description: "Scrivi quello che cerchi come lo diresti a un collega. \"Aziende metalmeccaniche Lombardia verifica RC prodotti\" — il nostro motore NLP capisce settore, territorio e aree assicurative.",
    tag: 'Natural Language AI',
    icon: Search,
    gradient: 'from-indigo-500 to-violet-500',
    light: 'bg-indigo-50',
    textColor: 'text-indigo-600',
    mockup: () => (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Search size={14} className="text-slate-400" />
            <div className="text-sm text-slate-800 font-['DM_Sans']">
              <span className="font-semibold">metalmeccaniche Lombardia verifica RC</span>
              <span className="animate-pulse text-indigo-500 ml-0.5">|</span>
            </div>
          </div>
          <div className="flex gap-2">
            {[
              { label: 'Metalmeccanica', color: 'bg-indigo-100 text-indigo-700' },
              { label: 'Lombardia', color: 'bg-blue-100 text-blue-700' },
              { label: 'RC Prodotti', color: 'bg-red-100 text-red-700' },
            ].map(c => (
              <span key={c.label} className={`${c.color} text-[10px] font-bold px-2.5 py-1 rounded-full font-['DM_Sans']`}>{c.label}</span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['127 aziende trovate', 'Priorità: 72', '34 verifiche critiche'].map((t, i) => (
            <div key={t} className="bg-white/80 rounded-lg border border-slate-100 px-3 py-2.5 text-center">
              <div className="text-sm font-bold text-slate-800 font-['Syne']">{t.split(':')[0].split(' ')[0]}</div>
              <div className="text-[10px] text-slate-400 font-['DM_Sans']">{t.includes(':') ? t.split(':')[1].trim() : t.split(' ').slice(1).join(' ')}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    number: '02',
    title: "L'AI analizza rischio e aree da verificare",
    description: "In tempo reale analizziamo ATECO, fatturato, dipendenti, territorio, forma giuridica e aree assicurative da verificare. Ogni azienda riceve priorità consulenziale e checklist di domande.",
    tag: 'Risk Analysis AI',
    icon: Radar,
    gradient: 'from-cyan-500 to-blue-500',
    light: 'bg-cyan-50',
    textColor: 'text-cyan-600',
    mockup: () => (
      <div className="space-y-2">
        <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold shadow-lg">82</div>
          <div>
            <div className="text-sm font-bold text-slate-800 font-['DM_Sans']">Tecnofer S.r.l.</div>
            <div className="text-xs text-slate-400 font-['DM_Sans']">ATECO 25.11 · Brescia · 45 dip.</div>
          </div>
        </div>
        {[
          { label: 'RC Prodotti', ok: false },
          { label: 'RC Generale', ok: true },
          { label: 'Incendio', ok: true },
          { label: 'D&O', ok: false },
          { label: 'Cyber Risk', ok: false },
          { label: 'Fatturato', value: '€3.2M' },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white border border-slate-100">
            <span className="text-xs font-medium text-slate-600 font-['DM_Sans']">{item.label}</span>
            {'value' in item ? (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-['DM_Sans']">{item.value}</span>
            ) : (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-['DM_Sans'] ${
                item.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
              }`}>{item.ok ? '✓ VERIFICATO' : 'DA VERIFICARE'}</span>
            )}
          </div>
        ))}
      </div>
    ),
  },
  {
    number: '03',
    title: 'Chiama con la proposta già pronta.',
    description: "Hai il cellulare del titolare, la PEC, e un pitch AI personalizzato sulle aree assicurative da verificare. Sai quali domande fare prima di alzare il telefono.",
    tag: 'AI Pitch + Contatti',
    icon: Sparkles,
    gradient: 'from-emerald-500 to-teal-500',
    light: 'bg-emerald-50',
    textColor: 'text-emerald-600',
    mockup: () => (
      <div className="space-y-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold">LB</div>
            <div>
              <div className="text-sm font-bold text-slate-800 font-['DM_Sans']">Luigi Bianchi</div>
              <div className="text-[11px] text-slate-400 font-['DM_Sans']">Amministratore · Tecnofer S.r.l.</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100">
              <Phone size={12} className="text-emerald-600" />
              <div>
                <div className="text-[9px] text-emerald-600/60 font-['DM_Sans']">Cellulare ✓</div>
                <div className="text-xs font-bold text-emerald-700 font-['DM_Sans']">348 123 ****</div>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
              <Mail size={12} className="text-blue-600" />
              <div>
                <div className="text-[9px] text-blue-600/60 font-['DM_Sans']">Email diretta</div>
                <div className="text-xs font-bold text-blue-700 font-['DM_Sans']">marco@studi...</div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={12} className="text-violet-500" />
            <span className="text-[10px] font-bold text-slate-600 font-['DM_Sans']">PITCH AI</span>
          </div>
          <div className="text-xs text-slate-600 font-['DM_Sans'] leading-relaxed italic">
            &quot;Buongiorno Dott. Bianchi, D&O e Cyber Risk risultano aree da verificare — con 45 dipendenti e €3.2M di fatturato conviene controllare massimali, esclusioni e scadenze...&quot;
          </div>
        </div>
      </div>
    ),
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 bg-white relative overflow-hidden">
      {/* Subtle background */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-50/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-50/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-1.5 mb-6">
            <Zap size={12} className="text-indigo-500" />
            <span className="text-xs font-semibold text-slate-600 font-['DM_Sans'] uppercase tracking-wider">Come funziona</span>
          </div>
          <h2 className="font-['Syne'] text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 mb-5">
            Tre passi.{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Zero sprechi di tempo.
            </span>
          </h2>
          <p className="text-lg text-slate-500 font-['DM_Sans'] max-w-xl mx-auto leading-relaxed">
            Dal target al pitch in meno di due minuti.
            Mentre i competitor chiamano a freddo, tu chiami con una checklist consulenziale pronta.
          </p>
        </div>

        {/* Steps — alternating layout */}
        <div className="space-y-24 lg:space-y-32">
          {steps.map((step, idx) => {
            const isReversed = idx % 2 === 1
            const MockupEl = step.mockup
            return (
              <motion.div
                key={step.number}
                className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center ${isReversed ? 'lg:direction-rtl' : ''}`}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ duration: 0.6 }}
              >
                {/* Text side */}
                <div className={isReversed ? 'lg:order-2' : ''}>
                  <div className="flex items-center gap-4 mb-6">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${step.gradient} flex items-center justify-center shadow-lg`}>
                      <step.icon size={22} className="text-white" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-400 font-['DM_Sans'] uppercase tracking-widest">Passo {step.number}</span>
                      <span className={`ml-3 text-[10px] font-bold ${step.textColor} ${step.light} px-2.5 py-0.5 rounded-full font-['DM_Sans']`}>{step.tag}</span>
                    </div>
                  </div>

                  <h3 className="font-['Syne'] text-2xl sm:text-3xl font-bold text-slate-900 mb-4 tracking-tight leading-tight">
                    {step.title}
                  </h3>

                  <p className="text-base text-slate-500 font-['DM_Sans'] leading-relaxed mb-6 max-w-md">
                    {step.description}
                  </p>

                  {idx === steps.length - 1 && (
                    <CtaLink>
                      <span className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-3 rounded-xl font-['DM_Sans'] shadow-lg shadow-indigo-500/25 transition-all cursor-pointer hover:-translate-y-0.5">
                        Provalo Gratis
                        <ArrowRight size={16} />
                      </span>
                    </CtaLink>
                  )}
                </div>

                {/* Mockup side */}
                <div className={`${isReversed ? 'lg:order-1' : ''}`}>
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 lg:p-6 shadow-xl shadow-slate-200/50">
                    <MockupEl />
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
