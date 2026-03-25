'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Send, Loader2, Copy, CheckCircle, Mail, Clock, ChevronDown, ChevronUp,
  Sparkles, RotateCcw, User, Building2, Palette, Globe, Wrench, ArrowLeft
} from 'lucide-react'
import Link from 'next/link'

type EmailStep = {
  step: number
  subject: string
  body: string
  waitDays: number
}

const TONES = [
  { value: 'professionale', label: 'Professionale' },
  { value: 'amichevole', label: 'Amichevole' },
  { value: 'diretto', label: 'Diretto / Urgente' },
  { value: 'consulenziale', label: 'Consulenziale' },
]

function EmailCard({ email, index, onEdit }: { email: EmailStep; index: number; onEdit: (idx: number, field: 'subject' | 'body', value: string) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const copyEmail = () => {
    const text = `Oggetto: ${email.subject}\n\n${email.body}`
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  const dayLabel = email.waitDays === 0 ? 'Giorno 1 — Primo contatto' : `Giorno ${email.waitDays + 1} — +${email.waitDays} giorni`

  const stepColors = [
    'border-violet-300 bg-violet-50/50',
    'border-blue-300 bg-blue-50/50',
    'border-amber-300 bg-amber-50/50',
    'border-emerald-300 bg-emerald-50/50',
    'border-orange-300 bg-orange-50/50',
    'border-pink-300 bg-pink-50/50',
  ]
  const colorClass = stepColors[index % stepColors.length]

  return (
    <div className={`rounded-xl border-2 ${colorClass} overflow-hidden transition-all`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between p-4 hover:bg-white/50 transition">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-sm font-black text-slate-700">
            {email.step}
          </div>
          <div className="text-left">
            <div className="text-sm font-bold text-slate-900">Email {email.step}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{dayLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); copyEmail() }}
            className="text-xs px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition">
            {copied ? <><CheckCircle className="w-3 h-3 text-emerald-500" /> Copiato</> : <><Copy className="w-3 h-3" /> Copia</>}
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wider">Oggetto</label>
            <input value={email.subject} onChange={(e) => onEdit(index, 'subject', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none bg-white" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wider">Corpo Email</label>
            <textarea value={email.body} onChange={(e) => onEdit(index, 'body', e.target.value)} rows={6}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none bg-white resize-none" />
          </div>
        </div>
      )}
    </div>
  )
}

function SequencesContent() {
  const searchParams = useSearchParams()
  const [companyName, setCompanyName] = useState('')
  const [website, setWebsite] = useState('')
  const [service, setService] = useState('')
  const [senderName, setSenderName] = useState('')
  const [senderCompany, setSenderCompany] = useState('')
  const [tone, setTone] = useState('professionale')
  const [steps, setSteps] = useState(4)
  const [sequence, setSequence] = useState<EmailStep[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allCopied, setAllCopied] = useState(false)

  useEffect(() => {
    const n = searchParams.get('name')
    const w = searchParams.get('website')
    const s = searchParams.get('service')
    if (n) setCompanyName(n)
    if (w) setWebsite(w)
    if (s) setService(s)
  }, [searchParams])

  const generate = useCallback(async () => {
    if (!companyName.trim()) return
    setLoading(true)
    setError(null)
    setSequence([])
    try {
      const res = await fetch('/api/ai/generate-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, website, service, senderName, senderCompany, tone, steps }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Errore generazione')
      setSequence(data.sequence || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [companyName, website, service, senderName, senderCompany, tone, steps])

  const handleEdit = (idx: number, field: 'subject' | 'body', value: string) => {
    setSequence(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e))
  }

  const copyAll = () => {
    const text = sequence.map(e =>
      `--- Email ${e.step} (Giorno ${e.waitDays === 0 ? '1' : e.waitDays + 1}) ---\nOggetto: ${e.subject}\n\n${e.body}`
    ).join('\n\n')
    navigator.clipboard.writeText(text).then(() => { setAllCopied(true); setTimeout(() => setAllCopied(false), 2000) }).catch(() => {})
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-violet-600 transition mb-3">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
          <Send className="w-7 h-7 text-violet-600" /> Sequenze Email AI
        </h1>
        <p className="mt-1 text-sm text-slate-500">Genera campagne di cold email multi-step personalizzate con l'AI. Ogni email è editabile e pronta per l'invio.</p>
      </div>

      {/* Config Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-bold text-sm text-slate-900 mb-4 flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" /> Configura la Sequenza</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Building2 className="w-3 h-3 inline mr-1" />Azienda Target *</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Es. Ristorante Da Mario"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Globe className="w-3 h-3 inline mr-1" />Sito Web</label>
            <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="www.example.com"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Wrench className="w-3 h-3 inline mr-1" />Servizio da Vendere</label>
            <input value={service} onChange={e => setService(e.target.value)} placeholder="Es. Gestione Social Media"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><User className="w-3 h-3 inline mr-1" />Il Tuo Nome</label>
            <input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Mario Rossi"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Building2 className="w-3 h-3 inline mr-1" />La Tua Azienda</label>
            <input value={senderCompany} onChange={e => setSenderCompany(e.target.value)} placeholder="Digital Agency SRL"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Palette className="w-3 h-3 inline mr-1" />Tono</label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none bg-white">
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Mail className="w-3 h-3 inline mr-1" />Numero Email (2-6)</label>
            <input type="number" min={2} max={6} value={steps} onChange={e => setSteps(Number(e.target.value) || 4)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
          </div>
        </div>

        <button onClick={generate} disabled={loading || !companyName.trim()}
          className="mt-5 inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Generazione in corso...' : sequence.length > 0 ? 'Rigenera Sequenza' : 'Genera Sequenza Email'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Chiudi</button>
        </div>
      )}

      {/* Generated Sequence */}
      {sequence.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg text-slate-900">La Tua Sequenza ({sequence.length} email)</h2>
            <div className="flex items-center gap-2">
              <button onClick={copyAll}
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition">
                {allCopied ? <><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Copiato Tutto</> : <><Copy className="w-3.5 h-3.5" /> Copia Tutto</>}
              </button>
              <button onClick={generate} disabled={loading}
                className="text-sm px-3 py-1.5 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50 flex items-center gap-1 transition disabled:opacity-50">
                <RotateCcw className="w-3.5 h-3.5" /> Rigenera
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {sequence.map((e, i) => (
              <div key={i} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-violet-100 border-2 border-violet-300 flex items-center justify-center text-xs font-bold text-violet-700">{e.step}</div>
                  <span className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                    {e.waitDays === 0 ? 'Giorno 1' : `+${e.waitDays}gg`}
                  </span>
                </div>
                {i < sequence.length - 1 && <div className="w-8 h-0.5 bg-violet-200 mx-1 mt-[-12px]" />}
              </div>
            ))}
          </div>

          {sequence.map((email, i) => (
            <EmailCard key={i} email={email} index={i} onEdit={handleEdit} />
          ))}
        </div>
      )}

      {/* Tips */}
      {sequence.length === 0 && !loading && (
        <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-xl border border-violet-200 p-5">
          <h3 className="font-bold text-sm text-violet-900 mb-2">Suggerimenti per sequenze efficaci</h3>
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li className="flex items-start gap-2"><span className="text-violet-500 mt-0.5">•</span> Specifica il servizio che vuoi vendere per email più mirate</li>
            <li className="flex items-start gap-2"><span className="text-violet-500 mt-0.5">•</span> Inserisci il sito web del target per riferimenti personalizzati</li>
            <li className="flex items-start gap-2"><span className="text-violet-500 mt-0.5">•</span> 4 email è il numero ottimale: intro → valore → social proof → urgenza</li>
            <li className="flex items-start gap-2"><span className="text-violet-500 mt-0.5">•</span> Dopo la generazione puoi modificare ogni email liberamente</li>
            <li className="flex items-start gap-2"><span className="text-violet-500 mt-0.5">•</span> Usa il tono "diretto" per settori competitivi, "consulenziale" per B2B premium</li>
          </ul>
        </div>
      )}
    </div>
  )
}

export default function SequencesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-500">Caricamento...</div>}>
      <SequencesContent />
    </Suspense>
  )
}
