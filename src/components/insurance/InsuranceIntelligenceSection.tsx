'use client'

/**
 * Sezione "Insurance Intelligence" — espandibile, lazy-loaded.
 *
 * Mostra trigger commerciali calcolati da /api/insurance/triggers:
 *  - Hotness score 0-100 con badge colorato
 *  - Trigger commerciali ordinati per severity (gara recente, P.IVA giovane,
 *    cambio lavoro, news azienda, acquisizioni, espansioni, finanziamenti)
 *  - Network: top colleghi LinkedIn (per referrals/lookalike) + albi probabili
 *  - Capacità di spesa stimata (reddito, patrimonio, % spesa attesa)
 *  - Eventi recenti (timeline)
 *
 * Default: COLLAPSED (zero impatto su perf).
 * Theme-aware: usa solo classi semantiche shadcn (foreground / muted / card / border).
 *
 * Riusa pattern di InsuranceProfileSection per coerenza visuale.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Flame,
  TrendingUp,
  Users,
  Briefcase,
  Calendar,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Target,
  Sparkles,
  Award,
  Building2,
  Zap,
  Banknote,
  HelpCircle,
} from 'lucide-react'
import type {
  TriggersOutput,
  CommercialTrigger,
  TriggerSeverity,
} from '@/lib/insurance/triggers'

// ─────────────────────────────────────────────────────────────────────────────
//  PROPS
// ─────────────────────────────────────────────────────────────────────────────

export interface InsuranceIntelligenceSectionProps {
  /** Ragione sociale (obbligatoria) */
  ragioneSociale: string | null | undefined
  /** P.IVA (opzionale ma altamente consigliata) */
  partitaIva?: string | null
  citta?: string | null
  ateco?: string | null
  /** Fatturato in EUR. Accetta number, stringa formattata (es. "€1.234.567") o "1234567" */
  fatturato?: number | string | null
  /** Dipendenti. Accetta number, "30" o range "30-50" (verrà preso il midpoint) */
  dipendenti?: number | string | null
  /** Data costituzione "YYYY-MM-DD" o "YYYY". Estraiamo anno e mese */
  dataCostituzione?: string | null
  ruolo?: 'titolare' | 'amministratore' | 'dipendente' | 'libero_professionista' | 'unknown'
  titolareNome?: string | null
  hasLinkedinPresence?: boolean
  /** Auto-espandi al mount (es. se il referente o lead è già caricato) */
  defaultExpanded?: boolean
  /** Variante compatta */
  compact?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSERS (per accettare i payload grezzi dei vari endpoint)
// ─────────────────────────────────────────────────────────────────────────────

function parseFatturato(input: number | string | null | undefined): number | undefined {
  if (input === null || input === undefined) return undefined
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : undefined
  const s = String(input).trim()
  if (!s) return undefined
  // "€1.234.567" / "1.234.567" / "1234567,89" / "1.5M" / "5 mln"
  const millions = s.match(/(\d+(?:[.,]\d+)?)\s*(?:M|mln|mil|million[ie]?)/i)
  if (millions) {
    const n = parseFloat(millions[1].replace(',', '.'))
    if (Number.isFinite(n)) return Math.round(n * 1_000_000)
  }
  const cleaned = s.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

function parseDipendenti(input: number | string | null | undefined): number | undefined {
  if (input === null || input === undefined) return undefined
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input) : undefined
  const s = String(input).trim()
  if (!s) return undefined
  // "30-50" → midpoint
  const range = s.match(/(\d+)\s*[-–—]\s*(\d+)/)
  if (range) {
    const lo = parseInt(range[1], 10)
    const hi = parseInt(range[2], 10)
    return Math.round((lo + hi) / 2)
  }
  const m = s.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : undefined
}

function parseCostituzione(input: string | null | undefined): { anno?: number; mese?: number } {
  if (!input) return {}
  const s = String(input).trim()
  if (!s) return {}
  // "2022-03-15"
  const iso = s.match(/^(\d{4})(?:-(\d{1,2}))?/)
  if (iso) {
    const anno = parseInt(iso[1], 10)
    const mese = iso[2] ? parseInt(iso[2], 10) : undefined
    if (anno >= 1900 && anno <= 2100) return { anno, mese: mese && mese >= 1 && mese <= 12 ? mese : undefined }
  }
  // "15/03/2022" or "15-03-2022"
  const eu = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)
  if (eu) {
    const anno = parseInt(eu[3], 10)
    const mese = parseInt(eu[2], 10)
    if (anno >= 1900 && anno <= 2100) return { anno, mese: mese >= 1 && mese <= 12 ? mese : undefined }
  }
  // Solo anno "2022"
  const annoOnly = s.match(/\b(19|20)\d{2}\b/)
  if (annoOnly) return { anno: parseInt(annoOnly[0], 10) }
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatEUR(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatRange(r: { min: number; max: number; mid?: number }): string {
  if (r.min === r.max) return formatEUR(r.mid ?? r.min)
  return `${formatEUR(r.min)} – ${formatEUR(r.max)}`
}

function severityColor(s: TriggerSeverity): {
  bg: string
  border: string
  text: string
  badge: string
  icon: string
} {
  switch (s) {
    case 'critico':
      return {
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/40',
        text: 'text-rose-300',
        badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        icon: 'text-rose-400',
      }
    case 'alto':
      return {
        bg: 'bg-orange-500/10',
        border: 'border-orange-500/40',
        text: 'text-orange-300',
        badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
        icon: 'text-orange-400',
      }
    case 'medio':
      return {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/40',
        text: 'text-amber-300',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        icon: 'text-amber-400',
      }
    case 'basso':
      return {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/40',
        text: 'text-blue-300',
        badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        icon: 'text-blue-400',
      }
    default:
      return {
        bg: 'bg-muted/40',
        border: 'border-border',
        text: 'text-muted-foreground',
        badge: 'bg-muted text-muted-foreground border-border',
        icon: 'text-muted-foreground',
      }
  }
}

function HotnessBadge({ score, label }: { score: number; label: TriggersOutput['hotnessLabel'] }) {
  let cls = 'bg-muted text-muted-foreground border-border'
  if (label === 'CALDISSIMO') cls = 'bg-rose-500/20 text-rose-300 border-rose-500/40'
  else if (label === 'CALDO') cls = 'bg-orange-500/20 text-orange-300 border-orange-500/40'
  else if (label === 'TIEPIDO') cls = 'bg-amber-500/20 text-amber-300 border-amber-500/40'

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${cls}`}>
      <Flame className="w-4 h-4" />
      <span className="font-bold text-sm">{label}</span>
      <span className="font-mono text-xs opacity-80">({score}/100)</span>
    </div>
  )
}

function triggerIcon(t: CommercialTrigger) {
  switch (t.type) {
    case 'gara_recente':
      return <Award className="w-4 h-4" />
    case 'piva_aperta_recente':
      return <Sparkles className="w-4 h-4" />
    case 'cambio_lavoro_titolare':
      return <Users className="w-4 h-4" />
    case 'news_acquisizione':
    case 'fusione':
      return <Building2 className="w-4 h-4" />
    case 'news_espansione':
    case 'nuova_sede':
      return <TrendingUp className="w-4 h-4" />
    case 'aumento_capitale':
    case 'news_finanziamento':
      return <Banknote className="w-4 h-4" />
    case 'news_premio_award':
      return <Award className="w-4 h-4" />
    case 'crisi_finanziaria':
      return <AlertTriangle className="w-4 h-4" />
    default:
      return <Zap className="w-4 h-4" />
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function InsuranceIntelligenceSection(props: InsuranceIntelligenceSectionProps) {
  const [expanded, setExpanded] = useState<boolean>(!!props.defaultExpanded)
  const [loading, setLoading] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)
  const [data, setData] = useState<TriggersOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Se i props identificativi cambiano, resetta lo stato
  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setData(null)
    setError(null)
    setHasFetched(false)
    setLoading(false)
    // Manteniamo lo stato expanded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.partitaIva, props.ragioneSociale])

  async function fetchTriggers() {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const fattNum = parseFatturato(props.fatturato)
      const dipNum = parseDipendenti(props.dipendenti)
      const cost = parseCostituzione(props.dataCostituzione)
      const res = await fetch('/api/insurance/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ragioneSociale: props.ragioneSociale || '',
          partitaIva: props.partitaIva || undefined,
          citta: props.citta || undefined,
          ateco: props.ateco || undefined,
          fatturato: fattNum,
          dipendenti: dipNum,
          costituzioneAnno: cost.anno,
          costituzioneMese: cost.mese,
          ruolo: props.ruolo,
          titolareNome: props.titolareNome || undefined,
          hasLinkedinPresence: props.hasLinkedinPresence,
        }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const txt = await res.text()
        setError(`Errore ${res.status}: ${txt.slice(0, 100)}`)
        return
      }
      const json = (await res.json()) as TriggersOutput
      setData(json)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(`Errore di rete: ${(e as Error).message}`)
    } finally {
      setLoading(false)
      setHasFetched(true)
    }
  }

  function handleToggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !hasFetched && !loading) void fetchTriggers()
  }

  // Auto-fetch se defaultExpanded
  useEffect(() => {
    if (props.defaultExpanded && !hasFetched && !loading && props.ragioneSociale) {
      void fetchTriggers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.defaultExpanded, props.ragioneSociale])

  return (
    <div className="bg-card text-foreground rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* HEADER */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-3 p-5 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-orange-500 to-rose-600 p-2.5 rounded-xl">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className={`font-bold text-foreground ${props.compact ? 'text-base' : 'text-lg'}`}>
              Insurance Intelligence
            </h3>
            <p className="text-xs text-muted-foreground">
              {hasFetched && data
                ? `Hotness ${data.hotnessLabel} (${data.hotnessScore}/100) · ${data.triggers.length} trigger · ${data.recentEvents.length} eventi`
                : 'Trigger commerciali, news azienda, network, capacità di spesa stimata, gare recenti'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-orange-400" />}
          {hasFetched && !loading && data && (
            <HotnessBadge score={data.hotnessScore} label={data.hotnessLabel} />
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* BODY */}
      {expanded && (
        <div className="border-t border-border p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-10 h-10 animate-spin text-orange-400 mb-2" />
              <p className="text-sm font-medium text-foreground">Analisi trigger commerciali...</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sto cercando news azienda, profili LinkedIn pubblici, gare ANAC recenti, cambi lavoro.
                Tempo: 15-30 secondi.
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 px-3 py-2 rounded-lg border border-rose-500/30">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}

          {!loading && data && (
            <>
              <RationaleBox
                hotnessScore={data.hotnessScore}
                hotnessLabel={data.hotnessLabel}
                rationale={data.hotnessRationale}
              />

              {data.triggers.length > 0 && <TriggersList triggers={data.triggers} />}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.spendingCapacity && <SpendingCapacityCard data={data.spendingCapacity} />}
                <NetworkCard network={data.network} />
              </div>

              {data.recentEvents.length > 0 && <RecentEventsTimeline events={data.recentEvents} />}

              {data.meta.warnings.length > 0 && (
                <details className="text-xs text-muted-foreground border border-border rounded-lg p-2">
                  <summary className="cursor-pointer font-semibold">
                    {data.meta.warnings.length} avvisi tecnici
                  </summary>
                  <ul className="mt-1 list-disc list-inside space-y-0.5">
                    {data.meta.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="text-[10px] text-muted-foreground border-t border-border pt-2 flex items-center justify-between flex-wrap gap-2">
                <span>
                  Fonti: {data.meta.sourcesUsed.slice(0, 6).join(', ') || 'nessuna fonte aggregata'}
                </span>
                <span>{(data.meta.durationMs / 1000).toFixed(1)}s</span>
              </div>
            </>
          )}

          {!loading && !data && !error && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              Nessun dato. Riprova in qualche secondo.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function RationaleBox({
  hotnessScore,
  hotnessLabel,
  rationale,
}: {
  hotnessScore: number
  hotnessLabel: TriggersOutput['hotnessLabel']
  rationale: string
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 flex items-start gap-3">
      <div className="bg-gradient-to-br from-orange-500 to-rose-600 p-2 rounded-lg">
        <Flame className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold text-foreground">Hotness commerciale: {hotnessLabel}</span>
          <span className="text-xs font-mono text-muted-foreground">{hotnessScore}/100</span>
        </div>
        <p className="text-xs text-foreground/80 leading-relaxed">{rationale}</p>
      </div>
    </div>
  )
}

function TriggersList({ triggers }: { triggers: CommercialTrigger[] }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
        <Zap className="w-4 h-4 text-orange-400" />
        Trigger commerciali ({triggers.length})
      </h4>
      <div className="space-y-2">
        {triggers.map((t, i) => (
          <TriggerCard key={i} trigger={t} />
        ))}
      </div>
    </div>
  )
}

function TriggerCard({ trigger }: { trigger: CommercialTrigger }) {
  const c = severityColor(trigger.severity)
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${c.icon}`}>{triggerIcon(trigger)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-bold text-sm text-foreground">{trigger.title}</span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${c.badge} uppercase`}
            >
              {trigger.severity}
            </span>
            {trigger.date && (
              <span className="text-[10px] text-muted-foreground">{trigger.date}</span>
            )}
          </div>
          <p className="text-xs text-foreground/80 mb-2 leading-relaxed">{trigger.description}</p>
          <div className="rounded bg-background/40 border border-border px-2 py-1.5 mb-2">
            <div className="text-[10px] font-bold uppercase text-muted-foreground mb-0.5">
              Cosa significa
            </div>
            <p className="text-[11px] text-foreground/90 leading-relaxed">{trigger.insuranceImplication}</p>
          </div>
          {trigger.suggestedActions.length > 0 && (
            <ul className="space-y-0.5">
              {trigger.suggestedActions.map((a, i) => (
                <li key={i} className="text-[11px] text-foreground/80 flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}
          {trigger.source && (
            <a
              href={trigger.source}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-muted-foreground hover:text-emerald-400 inline-flex items-center gap-1 mt-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              Fonte
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function SpendingCapacityCard({ data }: { data: NonNullable<TriggersOutput['spendingCapacity']> }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <Banknote className="w-4 h-4 text-emerald-400" />
        Capacità di spesa stimata
      </h4>
      <div className="space-y-2.5 text-xs">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5">
          <div className="text-[10px] font-bold uppercase text-emerald-300 mb-0.5">
            Spesa annua attesa polizze (azienda)
          </div>
          <div className="text-base font-bold text-foreground">
            {formatRange(data.capacitaTotaleAnnualePolizze)}
          </div>
          <div className="text-[10px] text-foreground/70 mt-1">
            Segmento{' '}
            <span className="font-semibold text-emerald-300">
              {data.propensioneAssicurativa.segmento}
            </span>{' '}
            · {data.propensioneAssicurativa.percentualeSpesaAttesa}% del fatturato (benchmark ANIA)
          </div>
        </div>

        {data.redditoTitolareStimato && (
          <div className="bg-muted/40 border border-border rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-muted-foreground mb-0.5">
              Reddito titolare stimato (lordo annuo)
            </div>
            <div className="text-sm font-bold text-foreground">
              {formatRange(data.redditoTitolareStimato)}
            </div>
            <div className="text-[10px] text-foreground/70">
              Mid: {formatEUR(data.redditoTitolareStimato.mid)}
            </div>
          </div>
        )}

        {data.patrimonioMobiliareStimato && (
          <div className="bg-muted/40 border border-border rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-muted-foreground mb-0.5">
              Patrimonio mobiliare stimato
            </div>
            <div className="text-sm font-bold text-foreground">
              {formatRange(data.patrimonioMobiliareStimato)}
            </div>
            <div className="text-[10px] text-foreground/60">Proxy: 4-10× reddito annuo</div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground italic">
          {data.propensioneAssicurativa.rationale}
        </div>
      </div>
    </div>
  )
}

function NetworkCard({ network }: { network: TriggersOutput['network'] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <Users className="w-4 h-4 text-indigo-400" />
        Network professionale
      </h4>

      {network.colleghiLinkedin.length > 0 ? (
        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5">
            Profili LinkedIn pubblici ({network.colleghiLinkedin.length})
          </div>
          <div className="space-y-1">
            {network.colleghiLinkedin.slice(0, 6).map((c, i) => (
              <a
                key={i}
                href={c.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/40 transition-colors group"
              >
                <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-300 flex-shrink-0">
                  {c.nome.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground group-hover:text-indigo-300 truncate">
                    {c.nome}
                  </div>
                  {c.ruolo && (
                    <div className="text-[10px] text-muted-foreground truncate">{c.ruolo}</div>
                  )}
                </div>
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-50 group-hover:opacity-100 mt-1" />
              </a>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic mb-3">
          Nessun profilo LinkedIn pubblico individuato dalla SERP.
        </p>
      )}

      {network.albiProfessionali.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5">
            Albi professionali probabili ({network.albiProfessionali.length})
          </div>
          <div className="space-y-1.5">
            {network.albiProfessionali.map((a, i) => {
              const sevCls =
                a.severity === 'obbligatorio'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : a.severity === 'probabile'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-muted/40 border-border text-muted-foreground'
              return (
                <div key={i} className={`rounded border p-1.5 ${sevCls}`}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-foreground">{a.nome}</span>
                    <span className="text-[9px] uppercase opacity-80">{a.severity}</span>
                  </div>
                  <div className="text-[10px] text-foreground/70 mt-0.5">{a.descrizione}</div>
                  <a
                    href={a.verificaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-emerald-400 hover:underline inline-flex items-center gap-1 mt-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Verifica iscrizione
                  </a>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {network.colleghiLinkedin.length === 0 && network.albiProfessionali.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">Nessun segnale network rilevato.</p>
      )}
    </div>
  )
}

function RecentEventsTimeline({ events }: { events: TriggersOutput['recentEvents'] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-blue-400" />
        Eventi recenti ({events.length})
      </h4>
      <div className="space-y-2">
        {events.slice(0, 8).map((e, i) => {
          const icon =
            e.category === 'gara_anac' ? (
              <Award className="w-3 h-3 text-emerald-400" />
            ) : e.category === 'comunicato_stampa' ? (
              <Briefcase className="w-3 h-3 text-blue-400" />
            ) : e.category === 'linkedin_post' ? (
              <Users className="w-3 h-3 text-indigo-400" />
            ) : (
              <Target className="w-3 h-3 text-orange-400" />
            )
          return (
            <a
              key={i}
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 p-2 rounded hover:bg-muted/40 transition-colors group"
            >
              <div className="mt-0.5 flex-shrink-0">{icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground group-hover:text-blue-300 line-clamp-1">
                  {e.title}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <span>{e.date}</span>
                  <span>·</span>
                  <span className="truncate">{e.source}</span>
                </div>
              </div>
              <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 mt-1" />
            </a>
          )
        })}
      </div>
    </div>
  )
}
