'use client'

/**
 * Sezione "Profilo Assicurativo" da incastonare nei dossier azienda esistenti
 * (Ricerca Singola Azienda, Ricerca Referente, ecc.).
 *
 * REGOLE CRITICHE PER NON ROMPERE NULLA:
 *   1. Default: COLLAPSED. Zero impatto su performance/quote API se l'utente non apre.
 *   2. Riceve l'anagrafica come props (P.IVA + Ragione Sociale + Città già risolti
 *      dal lookup esistente) → niente doppio fetch a /api/lead-registry.
 *   3. Le 4 chiamate /api/insurance/* sono in parallelo con AbortController per
 *      cancellare se l'utente cambia pagina.
 *   4. Errori per ogni endpoint sono ISOLATI: se /risk-score fallisce, /premiums
 *      mostra comunque i suoi dati.
 *   5. Auto-cleanup dello state se i props (piva/ragioneSociale) cambiano.
 *
 * Le card sotto sono una versione condensata e auto-contenuta del Radar.
 * Questa è l'unica vista del Profilo Assicurativo nell'app: la vecchia pagina
 * standalone /dashboard/insurance-radar è stata rimossa in favore dell'integrazione
 * nei dossier di Ricerca Azienda / Ricerca Referente.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Shield,
  TrendingUp,
  Users,
  Hammer,
  MapPin,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Target,
  Briefcase,
  Info,
  CheckCircle2,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
//  TIPI (mirror dei payload server-side)
// ─────────────────────────────────────────────────────────────────────────────

interface RangeFact {
  min: number
  mid: number
  max: number
  confidence: 'declared' | 'computed' | 'estimated' | 'unknown'
  source?: string
  rationale?: string
}

interface ValuedFact<T = number> {
  value: T
  confidence: 'declared' | 'computed' | 'estimated' | 'unknown'
  source?: string
  year?: number
  note?: string
}

interface PremiumsData {
  piva: string
  ragioneSociale?: string
  ateco?: string
  atecoDescription?: string
  sectorMacro?: string
  premiums: {
    declared?: ValuedFact
    estimated?: RangeFact
    fairMarket?: RangeFact
    savingOpportunity?: RangeFact
  }
  assets: {
    tangibleAssetsValue?: ValuedFact
    locations?: ValuedFact
    estimatedVehicles?: RangeFact
    employees?: ValuedFact
    payroll?: ValuedFact
  }
  opportunities: Array<{
    ramo: string
    estimatedAnnualPremium: RangeFact
    priority: 1 | 2 | 3 | 4 | 5
    rationale: string
    category: string
  }>
  meta: { sourcesUsed: string[]; warnings: string[]; durationMs: number }
}

interface WorkforceData {
  ragioneSociale?: string
  employees?: ValuedFact | null
  payroll?: ValuedFact | null
  avgCostPerEmployee?: ValuedFact | null
  tfrAccrual?: ValuedFact | null
  socialContributionsEstimate?: ValuedFact | null
  referenceYear?: number
  probableCCNL: Array<{ code: string; name: string; signatories: string[]; riskCategory: string }>
  welfareOpportunities: Array<{
    ramo: string
    totalAnnualPremium: RangeFact
    premiumPerEmployee: RangeFact
    taxBenefit: string
    priority: 1 | 2 | 3 | 4 | 5
    rationale: string
  }>
  warnings: string[]
}

interface CauzioniData {
  vinceAppaltiPubblici: boolean
  gareCount: number
  message?: string
  summary?: {
    cigCount: number
    importoTotaleAggiudicato: number
    cauzioniProvvisorieTotali: number
    cauzioniDefinitiveTotali: number
    decennaliEdiliziaTotali: number
    rcLavoriCount: number
    gareInCorso: Array<{
      cigOrCup: string
      oggetto: string
      stazioneAppaltante: string
      importoAggiudicato: number
      cauzioneProvvisoriaStimata: number
      cauzioneDefinitivaStimata: number
      decennaleEdilizia?: number
      dataAggiudicazione: string
    }>
    premiCauzioniAnnualiStimati: RangeFact
  } | null
  obblighiAssicurativiText: string[]
}

interface RiskData {
  addressUsed: string
  risk: {
    address: string
    comune?: string
    provincia?: string
    seismic?: { zone: 1 | 2 | 3 | 4; pga?: number; label: string; source: string }
    globalScore: number
    premiumImpact?: { direction: 'discount' | 'premium' | 'neutral'; percentMin: number; percentMax: number; rationale: string }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS UI
// ─────────────────────────────────────────────────────────────────────────────

function formatEUR(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

function formatRange(r: RangeFact): string {
  if (r.min === r.max) return formatEUR(r.mid)
  return `${formatEUR(r.min)} – ${formatEUR(r.max)}`
}

function ConfidenceBadge({ c }: { c: 'declared' | 'computed' | 'estimated' | 'unknown' }) {
  const map = {
    declared: { label: 'DICHIARATO', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    computed: { label: 'CALCOLATO', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    estimated: { label: 'STIMATO', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    unknown: { label: 'N/D', cls: 'bg-muted text-muted-foreground border-border' },
  }
  const m = map[c]
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
}

function PriorityStars({ p }: { p: 1 | 2 | 3 | 4 | 5 }) {
  return <span className="text-amber-500 text-xs">{'★'.repeat(p) + '☆'.repeat(5 - p)}</span>
}

function ZoneBadge({ zone }: { zone: 1 | 2 | 3 | 4 }) {
  const colors: Record<number, string> = {
    1: 'bg-red-100 text-red-800 border-red-300',
    2: 'bg-orange-100 text-orange-800 border-orange-300',
    3: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    4: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colors[zone]}`}>
      ZONA {zone}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export interface InsuranceProfileProps {
  /** P.IVA o ragione sociale già risolti — almeno uno è obbligatorio */
  piva?: string | null
  ragioneSociale?: string | null
  citta?: string | null
  /** Stile compact: card meno alta, font più piccoli */
  compact?: boolean
  /** Auto-espandi all'apertura (default: false → utente clicca per espandere) */
  defaultExpanded?: boolean
}

export default function InsuranceProfileSection({
  piva,
  ragioneSociale,
  citta,
  compact = false,
  defaultExpanded = false,
}: InsuranceProfileProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loading, setLoading] = useState(false)
  const [premiums, setPremiums] = useState<PremiumsData | null>(null)
  const [workforce, setWorkforce] = useState<WorkforceData | null>(null)
  const [cauzioni, setCauzioni] = useState<CauzioniData | null>(null)
  const [risk, setRisk] = useState<RiskData | null>(null)
  const [hasFetched, setHasFetched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Reset quando cambia l'azienda
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort()
    setPremiums(null)
    setWorkforce(null)
    setCauzioni(null)
    setRisk(null)
    setHasFetched(false)
    setError(null)
    if (!defaultExpanded) setExpanded(false)
    // intenzionale: non ri-eseguo il fetch se cambia solo defaultExpanded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piva, ragioneSociale])

  async function fetchAll() {
    if (!piva && !ragioneSociale) {
      setError('Manca P.IVA o ragione sociale.')
      return
    }
    setLoading(true)
    setError(null)
    setPremiums(null)
    setWorkforce(null)
    setCauzioni(null)
    setRisk(null)

    const controller = new AbortController()
    abortRef.current = controller
    const body = JSON.stringify({
      piva: (piva || '').trim(),
      ragioneSociale: (ragioneSociale || '').trim(),
      citta: (citta || '').trim(),
    })

    async function safeCall<T>(path: string): Promise<T | null> {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        })
        if (!res.ok) return null
        return (await res.json()) as T
      } catch {
        return null
      }
    }

    const [pRes, wRes, cRes, rRes] = await Promise.all([
      safeCall<PremiumsData>('/api/insurance/premiums'),
      safeCall<WorkforceData>('/api/insurance/workforce'),
      safeCall<CauzioniData>('/api/insurance/cauzioni'),
      safeCall<RiskData>('/api/insurance/risk-score'),
    ])

    if (controller.signal.aborted) return

    setPremiums(pRes)
    setWorkforce(wRes)
    setCauzioni(cRes)
    setRisk(rRes)
    setLoading(false)
    setHasFetched(true)

    if (!pRes && !wRes && !cRes && !rRes) {
      setError('Nessuna informazione assicurativa disponibile per questa azienda.')
    }
  }

  function handleToggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !hasFetched && !loading) {
      void fetchAll()
    }
  }

  const hasAnyResult = premiums || workforce || cauzioni || risk

  return (
    <div className="bg-card text-foreground rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* HEADER (sempre visibile, cliccabile per toggle) */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-3 p-5 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-xl">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className={`font-bold text-foreground ${compact ? 'text-base' : 'text-lg'}`}>
              Profilo assicurativo consulenziale
            </h3>
            <p className="text-xs text-muted-foreground">
              {hasFetched
                ? 'Benchmark premi, asset, workforce, fideiussioni e rischio territoriale'
                : 'Clicca per costruire benchmark, verifiche di portafoglio e leve consulenziali'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />}
          {hasFetched && !loading && hasAnyResult && (
            <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
              <CheckCircle2 className="w-3 h-3" />
              Analizzato
            </span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </div>
      </button>

      {/* BODY (collapsable) */}
      {expanded && (
        <div className="border-t border-border p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-2" />
              <p className="text-sm text-foreground font-medium">Costruzione profilo consulenziale...</p>
              <p className="text-xs text-muted-foreground mt-1">
                Interrogo fonti pubbliche e benchmark: Camera di Commercio, ANAC, Tavily, DPC. 30-90 secondi.
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg border border-red-200">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}

          {!loading && hasAnyResult && (
            <>
              <DataQualityBanner premiums={premiums} workforce={workforce} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {premiums && <PremiumsCard data={premiums} compact={compact} />}
                {workforce && <WorkforceCard data={workforce} compact={compact} />}
                {cauzioni && <CauzioniCard data={cauzioni} compact={compact} />}
                {risk && <RiskCard data={risk} compact={compact} />}
              </div>
              {premiums && premiums.opportunities && premiums.opportunities.length > 0 && (
                <OpportunitiesCard data={premiums} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function DataQualityBanner({
  premiums,
  workforce,
}: {
  premiums: PremiumsData | null
  workforce: WorkforceData | null
}) {
  // Aggrega TUTTI i warning rilevanti: meta.warnings dei premiums + workforce.warnings
  const allWarnings: string[] = [
    ...(premiums?.meta?.warnings || []),
    ...(workforce?.warnings || []),
  ]
  if (allWarnings.length === 0) return null

  // Categorizza per severità per mostrare in 4 sezioni
  const pivaMismatch = allWarnings.filter((w) => /P\.IVA INPUT.*P\.IVA RISOLTA/i.test(w))
  const atecoMismatch = allWarnings.filter((w) => /ATECO sospetto/i.test(w))
  const sectorWarnings = allWarnings.filter((w) => /SETTORE NON IDENTIFICATO/i.test(w))
  const balanceWarnings = allWarnings.filter((w) => /^Bilancio:/i.test(w))
  const workforceWarnings = allWarnings.filter((w) => /Costo medio\/dipendente/i.test(w))
  const matched = new Set<string>([
    ...pivaMismatch, ...atecoMismatch, ...sectorWarnings, ...balanceWarnings, ...workforceWarnings,
  ])
  const otherWarnings = allWarnings.filter((w) => !matched.has(w))

  // Severità: ROSSO se P.IVA mismatch, ATECO mismatch o settore non identificato
  const hasCritical =
    pivaMismatch.length > 0 || atecoMismatch.length > 0 || sectorWarnings.length > 0
  const bgClass = hasCritical
    ? 'bg-red-50 border-red-300 text-red-900'
    : 'bg-amber-50 border-amber-300 text-amber-900'

  return (
    <div className={`p-3 rounded-xl border-2 ${bgClass}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${hasCritical ? 'text-red-600' : 'text-amber-600'}`} />
        <div className="flex-1 text-xs space-y-2">
          <div className="font-bold">
            {hasCritical ? 'Qualità dati LIMITATA — leggi prima di usare le stime' : 'Note di qualità dati'}
          </div>

          {pivaMismatch.length > 0 && (
            <div>
              <div className="font-semibold mb-0.5">P.IVA non corrispondente</div>
              <ul className="space-y-0.5 list-disc list-inside">
                {pivaMismatch.map((w, i) => <li key={`p${i}`}>{w.replace(/^⚠️\s*/, '')}</li>)}
              </ul>
            </div>
          )}

          {atecoMismatch.length > 0 && (
            <div>
              <div className="font-semibold mb-0.5">ATECO sospetto</div>
              <ul className="space-y-0.5 list-disc list-inside">
                {atecoMismatch.map((w, i) => <li key={`a${i}`}>{w.replace(/^⚠️\s*/, '')}</li>)}
              </ul>
            </div>
          )}

          {sectorWarnings.length > 0 && (
            <div>
              <div className="font-semibold mb-0.5">Settore non identificato</div>
              <ul className="space-y-0.5 list-disc list-inside">
                {sectorWarnings.map((w, i) => <li key={`s${i}`}>{w.replace(/^⚠️\s*/, '')}</li>)}
              </ul>
            </div>
          )}

          {workforceWarnings.length > 0 && (
            <div>
              <div className="font-semibold mb-0.5">Workforce sospetto</div>
              <ul className="space-y-0.5 list-disc list-inside">
                {workforceWarnings.map((w, i) => <li key={`w${i}`}>{w.replace(/^⚠️\s*/, '')}</li>)}
              </ul>
            </div>
          )}

          {balanceWarnings.length > 0 && (
            <div>
              <div className="font-semibold mb-0.5">Valori di bilancio scartati (parsing dubbio)</div>
              <ul className="space-y-0.5 list-disc list-inside">
                {balanceWarnings.map((w, i) => <li key={`b${i}`}>{w.replace(/^Bilancio:\s*/i, '')}</li>)}
              </ul>
            </div>
          )}

          {otherWarnings.length > 0 && (
            <ul className="space-y-0.5 list-disc list-inside">
              {otherWarnings.map((w, i) => <li key={`o${i}`}>{w}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function PremiumsCard({ data, compact }: { data: PremiumsData; compact?: boolean }) {
  const { premiums } = data
  const hasAnyData = premiums.declared || premiums.estimated
  const padding = compact ? 'p-4' : 'p-5'
  return (
    <div className={`${padding} bg-card border border-border rounded-xl`}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-indigo-600" />
        <h4 className="font-bold text-foreground text-sm">Benchmark premi & asset</h4>
      </div>
      {!hasAnyData && (
        <p className="text-xs text-muted-foreground italic">Dati di bilancio non disponibili in fonti gratuite.</p>
      )}
      {premiums.declared && (
        <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-emerald-700">DICHIARATO IN BILANCIO</span>
            <ConfidenceBadge c="declared" />
          </div>
          <div className="text-lg font-bold text-emerald-900">{formatEUR(premiums.declared.value)}</div>
          {premiums.declared.year && (
            <div className="text-[10px] text-foreground/80">Anno {premiums.declared.year}</div>
          )}
        </div>
      )}
      {premiums.estimated && (
        <div className="mb-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-amber-700">BENCHMARK SETTORIALE</span>
            <ConfidenceBadge c="estimated" />
          </div>
          <div className="text-base font-bold text-amber-900">{formatRange(premiums.estimated)}</div>
          <div className="text-[10px] text-foreground/80 mt-0.5">{premiums.estimated.rationale}</div>
        </div>
      )}
      {premiums.fairMarket && (
        <div className="mb-2 p-2.5 bg-blue-50 border border-border rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-blue-700">RANGE MERCATO ATTESO</span>
            <ConfidenceBadge c="computed" />
          </div>
          <div className="text-base font-bold text-blue-900">{formatRange(premiums.fairMarket)}</div>
        </div>
      )}
      {premiums.savingOpportunity && (
        <div className="p-2.5 bg-rose-50 border-2 border-rose-300 rounded-lg">
          <div className="flex items-center gap-1 mb-1">
            <Target className="w-3 h-3 text-rose-600" />
            <span className="text-[10px] font-bold text-rose-700">RISPARMIO DA VALIDARE</span>
          </div>
          <div className="text-lg font-bold text-rose-900">{formatRange(premiums.savingOpportunity)}</div>
        </div>
      )}

      {/* ASSET */}
      {(data.assets.tangibleAssetsValue || data.assets.employees || data.assets.payroll || data.assets.estimatedVehicles) && (
        <div className="mt-3 pt-3 border-t border-border">
          <h5 className="text-[10px] font-semibold text-foreground mb-2 flex items-center gap-1">
            <Shield className="w-3 h-3" /> Asset assicurabili rilevati/stimati
          </h5>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {data.assets.tangibleAssetsValue && (
              <div>
                <div className="text-[10px] text-muted-foreground">Immob. materiali</div>
                <div className="font-semibold">{formatEUR(data.assets.tangibleAssetsValue.value)}</div>
              </div>
            )}
            {data.assets.employees && (
              <div>
                <div className="text-[10px] text-muted-foreground">Dipendenti</div>
                <div className="font-semibold">{data.assets.employees.value}</div>
              </div>
            )}
            {data.assets.payroll && (
              <div>
                <div className="text-[10px] text-muted-foreground">Costo personale</div>
                <div className="font-semibold">{formatEUR(data.assets.payroll.value)}</div>
              </div>
            )}
            {data.assets.estimatedVehicles && (
              <div>
                <div className="text-[10px] text-muted-foreground">Veicoli stimati</div>
                <div className="font-semibold">{data.assets.estimatedVehicles.min}–{data.assets.estimatedVehicles.max}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {data.meta?.warnings && data.meta.warnings.length > 0 && (
        <div className="mt-3 text-[10px] text-muted-foreground italic flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="line-clamp-2">{data.meta.warnings[0]}</span>
        </div>
      )}
      <div className="mt-3 p-2 rounded-lg border border-amber-200 bg-amber-50 text-[10px] text-amber-800">
        Benchmark e stime non indicano polizze attive: servono per chiedere portafoglio, premi pagati, massimali, esclusioni, franchigie e scadenze.
      </div>
    </div>
  )
}

function WorkforceCard({ data, compact }: { data: WorkforceData; compact?: boolean }) {
  const padding = compact ? 'p-4' : 'p-5'
  return (
    <div className={`${padding} bg-card border border-border rounded-xl`}>
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-purple-600" />
        <h4 className="font-bold text-foreground text-sm">Workforce, CCNL & welfare</h4>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        {data.employees && (
          <div className="bg-muted/40 p-2 rounded-lg">
            <div className="text-[10px] text-muted-foreground">Dipendenti</div>
            <div className="text-base font-bold">{data.employees.value}</div>
            <ConfidenceBadge c={data.employees.confidence} />
          </div>
        )}
        {data.payroll && (
          <div className="bg-muted/40 p-2 rounded-lg">
            <div className="text-[10px] text-muted-foreground">Costo personale</div>
            <div className="text-base font-bold">{formatEUR(data.payroll.value)}</div>
            <ConfidenceBadge c={data.payroll.confidence} />
          </div>
        )}
        {data.avgCostPerEmployee && (
          <div className="bg-muted/40 p-2 rounded-lg">
            <div className="text-[10px] text-muted-foreground">Costo medio/dip</div>
            <div className="text-sm font-bold">{formatEUR(data.avgCostPerEmployee.value)}</div>
            <ConfidenceBadge c={data.avgCostPerEmployee.confidence} />
          </div>
        )}
        {data.tfrAccrual && (
          <div className="bg-muted/40 p-2 rounded-lg">
            <div className="text-[10px] text-muted-foreground">TFR maturato/anno</div>
            <div className="text-sm font-bold">{formatEUR(data.tfrAccrual.value)}</div>
            <ConfidenceBadge c={data.tfrAccrual.confidence} />
          </div>
        )}
      </div>

      {data.probableCCNL && data.probableCCNL.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold text-foreground mb-1">CCNL probabili</div>
          {data.probableCCNL.slice(0, 2).map((c, i) => (
            <div key={i} className="text-xs border border-border p-1.5 rounded-lg mb-1">
              <div className="font-semibold text-foreground">{c.code}</div>
            </div>
          ))}
        </div>
      )}

      {data.welfareOpportunities && data.welfareOpportunities.length > 0 && (
        <div className="pt-3 border-t border-border">
          <div className="text-[10px] font-semibold text-foreground mb-2">Opportunità welfare da validare</div>
          {data.welfareOpportunities.slice(0, 3).map((w, i) => (
            <div key={i} className="text-xs mb-1.5 flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-medium text-foreground">{w.ramo}</div>
                <div className="text-[10px] text-muted-foreground">{formatRange(w.totalAnnualPremium)}/anno</div>
              </div>
              <PriorityStars p={w.priority} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CauzioniCard({ data, compact }: { data: CauzioniData; compact?: boolean }) {
  const padding = compact ? 'p-4' : 'p-5'
  return (
    <div className={`${padding} bg-card border border-border rounded-xl`}>
      <div className="flex items-center gap-2 mb-3">
        <Hammer className="w-4 h-4 text-orange-600" />
        <h4 className="font-bold text-foreground text-sm">ANAC: cauzioni & fideiussioni</h4>
      </div>

      {!data.vinceAppaltiPubblici && (
        <div className="text-xs text-muted-foreground italic p-2 bg-muted/40 rounded-lg">
          {data.message || 'Nessuna gara pubblica vinta riscontrata.'}
        </div>
      )}

      {data.vinceAppaltiPubblici && data.summary && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="bg-amber-50 p-2 rounded-lg border border-amber-200">
              <div className="text-[10px] text-amber-700">Importo aggiudicato</div>
              <div className="text-base font-bold">{formatEUR(data.summary.importoTotaleAggiudicato)}</div>
              <div className="text-[10px] text-muted-foreground">{data.summary.cigCount} gare</div>
            </div>
            <div className="bg-orange-50 p-2 rounded-lg border border-orange-200">
              <div className="text-[10px] text-orange-700">Premi cauzioni/anno</div>
              <div className="text-sm font-bold">{formatRange(data.summary.premiCauzioniAnnualiStimati)}</div>
              <ConfidenceBadge c="estimated" />
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Cauz. provvisoria (2%)</div>
              <div className="text-sm font-semibold">{formatEUR(data.summary.cauzioniProvvisorieTotali)}</div>
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Garanzia definitiva benchmark</div>
              <div className="text-sm font-semibold">{formatEUR(data.summary.cauzioniDefinitiveTotali)}</div>
            </div>
            {data.summary.decennaliEdiliziaTotali > 0 && (
              <div className="col-span-2 bg-rose-50 p-2 rounded-lg border border-rose-200">
                <div className="text-[10px] text-rose-700">Postuma/CAR da verificare su bando</div>
                <div className="text-sm font-semibold">{formatEUR(data.summary.decennaliEdiliziaTotali)}</div>
              </div>
            )}
          </div>

          {data.summary.gareInCorso.length > 0 && (
            <>
              <div className="text-[10px] text-foreground font-semibold mb-1">Top gare recenti</div>
              {data.summary.gareInCorso.slice(0, 3).map((g, i) => (
                <div key={i} className="text-[10px] border-l-2 border-orange-300 pl-2 mb-1">
                  <div className="font-semibold text-foreground line-clamp-1">{g.oggetto}</div>
                  <div className="text-muted-foreground">{g.stazioneAppaltante} — {formatEUR(g.importoAggiudicato)}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function RiskCard({ data, compact }: { data: RiskData; compact?: boolean }) {
  const r = data.risk
  const padding = compact ? 'p-4' : 'p-5'
  return (
    <div className={`${padding} bg-card border border-border rounded-xl`}>
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-4 h-4 text-rose-600" />
        <h4 className="font-bold text-foreground text-sm">Rischio territoriale property</h4>
      </div>

      <div className="text-[10px] text-muted-foreground mb-2 line-clamp-2">{data.addressUsed}</div>

      {!r.seismic && (
        <div className="text-xs text-muted-foreground italic p-2 bg-muted/40 rounded-lg">
          Indirizzo non risolvibile per analisi sismica.
        </div>
      )}

      {r.seismic && (
        <>
          <div className="flex items-center justify-between mb-2">
            <ZoneBadge zone={r.seismic.zone} />
            {r.seismic.pga !== undefined && (
              <span className="text-[10px] text-muted-foreground">PGA {r.seismic.pga.toFixed(3)}g</span>
            )}
          </div>
          <div className="text-xs text-foreground mb-2">{r.seismic.label}</div>

          <div className="bg-muted/40 p-2 rounded-lg mb-2">
            <div className="text-[10px] text-muted-foreground mb-1">Score globale</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full ${r.globalScore >= 70 ? 'bg-red-500' : r.globalScore >= 40 ? 'bg-orange-500' : 'bg-emerald-500'}`}
                  style={{ width: `${r.globalScore}%` }}
                />
              </div>
              <span className="text-xs font-bold">{r.globalScore}/100</span>
            </div>
          </div>

          {r.premiumImpact && (
            <div className={`p-2 rounded-lg border text-xs ${
              r.premiumImpact.direction === 'premium' ? 'bg-rose-50 border-rose-200' :
              r.premiumImpact.direction === 'discount' ? 'bg-emerald-50 border-emerald-200' :
              'bg-muted/40 border-border'
            }`}>
              <div className="text-[10px] font-semibold mb-1">Impatto benchmark premio property</div>
              <div className="text-sm font-bold">
                {r.premiumImpact.percentMin > 0 ? '+' : ''}{r.premiumImpact.percentMin}% a {r.premiumImpact.percentMax > 0 ? '+' : ''}{r.premiumImpact.percentMax}%
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OpportunitiesCard({ data }: { data: PremiumsData }) {
  const top = data.opportunities.slice(0, 6)
  return (
    <div className="p-4 bg-card border border-border rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="w-4 h-4 text-emerald-600" />
        <h4 className="font-bold text-foreground text-sm">Opportunità consulenziali da validare</h4>
      </div>
      <div className="space-y-1.5">
        {top.map((op, i) => (
          <div key={i} className="flex items-start justify-between gap-2 p-2 border border-border rounded-lg hover:bg-muted/40">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold text-muted-foreground">#{i + 1}</span>
                <span className="font-semibold text-foreground text-xs truncate">{op.ramo}</span>
                <PriorityStars p={op.priority} />
              </div>
              <div className="text-[10px] text-foreground/80 line-clamp-1">{op.rationale}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs font-bold text-foreground">{formatRange(op.estimatedAnnualPremium)}</div>
              <div className="text-[10px] text-muted-foreground">benchmark annuo</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
