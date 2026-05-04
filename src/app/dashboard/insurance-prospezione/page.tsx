'use client'

/**
 * Dashboard Insurance Prospezione
 *
 * PROSPEZIONE MASSIVA per assicuratori: cerca aziende che vincono gare
 * pubbliche ANAC filtrabili per categoria/regione/importo/periodo.
 *
 * UX: preset cliccabili + form filtri + tabella ordinata per priority score.
 *
 * Stili: usa solo classi semantiche shadcn/ui (foreground / muted /
 * card / border / input) per essere compatibile con dark + light theme.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Search,
  Loader2,
  Filter,
  TrendingUp,
  Hammer,
  Briefcase,
  Package,
  AlertTriangle,
  ExternalLink,
  Building2,
  MapPin,
  Calendar,
  Target,
  Info,
  Sparkles,
  HelpCircle,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
//  TIPI (mirror del payload server)
// ─────────────────────────────────────────────────────────────────────────────

type Category = 'lavori' | 'servizi' | 'forniture' | 'all'

interface ProspectionLead {
  ragioneSociale: string
  partitaIva?: string
  garaOggetto: string
  stazioneAppaltante: string
  importoAggiudicato: number
  dataAggiudicazione?: string
  categoria: 'lavori' | 'servizi' | 'forniture' | 'unknown'
  cauzioneProvvisoriaStimata: number
  cauzioneDefinitivaStimata: number
  decennalePostumaStimata?: number
  premioAnnuoCauzioneStimato: { min: number; mid: number; max: number }
  fonteUrl?: string
  priorityScore: number
}

interface ProspectionResponse {
  found: boolean
  totalLeads: number
  leads: ProspectionLead[]
  filters: Record<string, unknown>
  meta: {
    sourcesUsed: string[]
    durationMs: number
    queryUsed: string
    warnings: string[]
  }
}

interface Preset {
  label: string
  description: string
  icon: typeof Hammer
  filters: {
    category: Category
    region?: string
    province?: string
    importoMin?: number
    monthsBack?: number
    keyword?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRESET (one-click) — esempi tipici per un assicuratore
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS: Preset[] = [
  {
    label: 'Costruzioni Piemonte > 500k€',
    description: 'Imprese edili che vincono lavori pubblici grandi → cauzioni 10% + decennale obbligatoria',
    icon: Hammer,
    filters: { category: 'lavori', region: 'Piemonte', importoMin: 500_000, monthsBack: 12 },
  },
  {
    label: 'Servizi Lombardia > 100k€',
    description: 'Pulizie / vigilanza / mensa scolastica → cauzioni provvisorie 2% + RC',
    icon: Briefcase,
    filters: { category: 'servizi', region: 'Lombardia', importoMin: 100_000, monthsBack: 12 },
  },
  {
    label: 'Forniture Lazio > 250k€',
    description: 'Forniture P.A. (arredi, dispositivi, attrezzature) → cauzioni + RC prodotti',
    icon: Package,
    filters: { category: 'forniture', region: 'Lazio', importoMin: 250_000, monthsBack: 12 },
  },
  {
    label: 'Lavori Edili Italia ultimi 6 mesi',
    description: 'Vista nazionale, ultimi 6 mesi, no soglia → trend recente',
    icon: Sparkles,
    filters: { category: 'lavori', importoMin: 100_000, monthsBack: 6 },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS UI
// ─────────────────────────────────────────────────────────────────────────────

function formatEUR(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

function CategoryIcon({ cat }: { cat: ProspectionLead['categoria'] }) {
  if (cat === 'lavori') return <Hammer className="w-4 h-4 text-orange-500" />
  if (cat === 'servizi') return <Briefcase className="w-4 h-4 text-blue-400" />
  if (cat === 'forniture') return <Package className="w-4 h-4 text-emerald-400" />
  return <Building2 className="w-4 h-4 text-muted-foreground" />
}

function PriorityBadge({ score }: { score: number }) {
  let cls = 'bg-muted text-muted-foreground border-border'
  let label = 'Bassa'
  if (score >= 80) { cls = 'bg-rose-500/15 text-rose-400 border-rose-500/30'; label = 'CRITICA' }
  else if (score >= 60) { cls = 'bg-orange-500/15 text-orange-400 border-orange-500/30'; label = 'Alta' }
  else if (score >= 40) { cls = 'bg-amber-500/15 text-amber-400 border-amber-500/30'; label = 'Media' }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      {label} ({score})
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

const ITALIAN_REGIONS = [
  'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna',
  'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche',
  'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana',
  'Trentino-Alto Adige', 'Umbria', 'Valle d\u2019Aosta', 'Veneto',
]

export default function InsuranceProspezionePage() {
  const [category, setCategory] = useState<Category>('all')
  const [region, setRegion] = useState('')
  const [province, setProvince] = useState('')
  const [importoMin, setImportoMin] = useState<string>('100000')
  const [importoMax, setImportoMax] = useState<string>('')
  const [monthsBack, setMonthsBack] = useState<number>(12)
  const [maxResults, setMaxResults] = useState<number>(20)
  const [keyword, setKeyword] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<ProspectionResponse | null>(null)

  function applyPreset(preset: Preset) {
    setCategory(preset.filters.category)
    setRegion(preset.filters.region || '')
    setProvince(preset.filters.province || '')
    setImportoMin(preset.filters.importoMin ? String(preset.filters.importoMin) : '')
    setImportoMax('')
    setMonthsBack(preset.filters.monthsBack || 12)
    setKeyword(preset.filters.keyword || '')
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    setResponse(null)

    const body = {
      category,
      region: region.trim() || undefined,
      province: province.trim().toUpperCase().slice(0, 2) || undefined,
      importoMin: importoMin ? parseInt(importoMin, 10) : undefined,
      importoMax: importoMax ? parseInt(importoMax, 10) : undefined,
      monthsBack,
      maxResults,
      keyword: keyword.trim() || undefined,
    }

    try {
      const res = await fetch('/api/insurance/prospezione', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        setError(`Errore server: ${res.status} ${text.slice(0, 100)}`)
        setLoading(false)
        return
      }
      const data = (await res.json()) as ProspectionResponse
      setResponse(data)
    } catch (err) {
      setError(`Errore di rete: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl text-foreground">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-3 rounded-xl shadow-lg">
            <Target className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Insurance Prospezione</h1>
            <p className="text-sm text-muted-foreground">
              Trova aziende che vincono gare pubbliche e hanno bisogno di cauzioni — fonti gratuite ANAC.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowHelp((v) => !v)}
          className="gap-2"
        >
          <HelpCircle className="w-4 h-4" />
          {showHelp ? 'Nascondi guida' : 'Come funziona?'}
        </Button>
      </div>

      {/* HELP BOX */}
      {showHelp && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-sm space-y-2">
          <div className="font-bold text-foreground flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-400" />
            Come funziona la prospezione
          </div>
          <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground pl-1">
            <li>
              <span className="text-foreground">Scegli un preset</span> (one-click) oppure imposta filtri custom: categoria, regione/provincia, soglia importo, periodo.
            </li>
            <li>
              <span className="text-foreground">Click su &quot;Cerca Lead&quot;</span> → interroghiamo ANAC, MEPA, Gazzetta Ufficiale (gratuito) tramite Tavily + GPT.
            </li>
            <li>
              <span className="text-foreground">Per ogni azienda aggiudicataria</span> calcoliamo cauzioni 2%/10%, decennale postuma (se lavori &gt;500k), e premio annuo ramo cauzioni.
            </li>
            <li>
              <span className="text-foreground">Lead ordinati per priority score</span> 0&ndash;100 (importo + settore + completezza dati). Apri la fonte ANAC con l&apos;icona <ExternalLink className="inline w-3 h-3" />.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            <strong className="text-foreground">Output tipico</strong>: 10-30 aziende/ricerca, 30-60 secondi. Costo: 1 query Tavily + 1 GPT-4o-mini per ricerca (~0.01€).
          </p>
        </div>
      )}

      {/* PRESET (Quick Start) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-bold text-foreground">Quick Start: preset comuni</h2>
          <span className="text-xs text-muted-foreground">— click per applicare</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {PRESETS.map((preset, i) => (
            <button
              key={i}
              type="button"
              onClick={() => applyPreset(preset)}
              disabled={loading}
              className="text-left p-4 rounded-xl border border-border bg-card hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors group disabled:opacity-50"
            >
              <div className="flex items-center gap-2 mb-2">
                <preset.icon className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-bold text-foreground group-hover:text-emerald-300">{preset.label}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{preset.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* FORM FILTRI */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <form onSubmit={handleSearch} className="space-y-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Filter className="w-4 h-4 text-emerald-400" />
            Filtri custom
          </div>

          {/* Categoria */}
          <div>
            <label className="text-xs font-semibold text-foreground mb-2 block uppercase tracking-wide">
              Categoria appalto
            </label>
            <div className="flex flex-wrap gap-2">
              {([
                { v: 'all' as Category, label: 'Tutte', icon: Building2 },
                { v: 'lavori' as Category, label: 'Lavori (edili)', icon: Hammer },
                { v: 'servizi' as Category, label: 'Servizi', icon: Briefcase },
                { v: 'forniture' as Category, label: 'Forniture', icon: Package },
              ]).map(({ v, label, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCategory(v)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    category === v
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-background border-border text-foreground hover:bg-muted/40'
                  }`}
                  disabled={loading}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Geografia */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Regione
              </label>
              <input
                list="regions"
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="es. Piemonte"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
                disabled={loading}
              />
              <datalist id="regions">
                {ITALIAN_REGIONS.map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Provincia (sigla 2 lettere)
              </label>
              <input
                type="text"
                value={province}
                onChange={(e) => setProvince(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="es. TO"
                maxLength={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50 uppercase"
                disabled={loading}
              />
            </div>
          </div>

          {/* Importo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Importo minimo (€)
              </label>
              <input
                type="number"
                value={importoMin}
                onChange={(e) => setImportoMin(e.target.value)}
                placeholder="100000"
                min={0}
                step={10000}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={loading}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Soglia tipica: 100k€ (sotto, cauzioni poco rilevanti)</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Importo massimo (€)
              </label>
              <input
                type="number"
                value={importoMax}
                onChange={(e) => setImportoMax(e.target.value)}
                placeholder="(opzionale)"
                min={0}
                step={10000}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={loading}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Vuoto = nessun limite superiore</p>
            </div>
          </div>

          {/* Periodo + Max risultati + Keyword */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Periodo
              </label>
              <select
                value={monthsBack}
                onChange={(e) => setMonthsBack(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={loading}
              >
                <option value={6}>Ultimi 6 mesi</option>
                <option value={12}>Ultimo anno</option>
                <option value={24}>Ultimi 2 anni</option>
                <option value={36}>Ultimi 3 anni</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Max risultati
              </label>
              <select
                value={maxResults}
                onChange={(e) => setMaxResults(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={loading}
              >
                <option value={10}>10 lead</option>
                <option value={20}>20 lead</option>
                <option value={30}>30 lead</option>
                <option value={50}>50 lead (max)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block uppercase tracking-wide">
                Keyword <span className="font-normal text-muted-foreground normal-case">(opzionale)</span>
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="es. ristrutturazione scuole"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={loading}
              />
            </div>
          </div>

          {/* Bottone */}
          <div className="flex items-center gap-3 flex-wrap pt-2">
            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              {loading ? 'Ricerca in corso...' : 'Cerca Lead ANAC'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Fonti: <strong className="text-foreground">ANAC, MEPA, Gazzetta Ufficiale</strong> (tutte gratuite e pubbliche).
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 px-3 py-2 rounded-lg border border-rose-500/30">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </form>
      </div>

      {/* LOADING */}
      {loading && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Loader2 className="w-12 h-12 mx-auto text-emerald-400 animate-spin mb-3" />
          <p className="text-foreground font-medium">Ricerca aggiudicazioni ANAC...</p>
          <p className="text-xs text-muted-foreground mt-1">
            Sto interrogando i registri pubblici. Possono volerci 30-60 secondi.
          </p>
        </div>
      )}

      {/* RISULTATI */}
      {response && !loading && <ResultsView response={response} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESULTS COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ResultsView({ response }: { response: ProspectionResponse }) {
  if (!response.found || response.leads.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-400 mb-2" />
        <p className="text-foreground font-medium">Nessun lead trovato con questi filtri.</p>
        {response.meta.warnings.length > 0 && (
          <ul className="text-xs text-muted-foreground mt-3 space-y-1">
            {response.meta.warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Suggerimenti: allarga il periodo, abbassa l&apos;importo minimo, prova con &quot;Tutte&quot; le categorie, oppure usa un preset.
        </p>
      </div>
    )
  }

  const totalImporto = response.leads.reduce((s, l) => s + l.importoAggiudicato, 0)
  const totalCauzionDef = response.leads.reduce((s, l) => s + l.cauzioneDefinitivaStimata, 0)
  const totalPremiAnnui = response.leads.reduce((s, l) => s + l.premioAnnuoCauzioneStimato.mid, 0)

  return (
    <div className="space-y-4">
      {/* Statistiche aggregate */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="LEAD TROVATI" value={String(response.totalLeads)} accent="emerald" />
        <StatCard label="IMPORTO TOTALE" value={formatEUR(totalImporto)} accent="amber" />
        <StatCard
          label="CAUZIONI DEFINITIVE"
          value={formatEUR(totalCauzionDef)}
          subtitle="10% importi aggiudicati"
          accent="rose"
        />
        <StatCard
          label="PREMI ANNUI POTENZIALI"
          value={formatEUR(totalPremiAnnui)}
          subtitle="stima media ramo cauzioni"
          accent="indigo"
        />
      </div>

      {/* Tabella lead */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Lead ordinati per priorità commerciale
          </h3>
          <span className="text-xs text-muted-foreground">{response.leads.length} aziende</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Azienda</th>
                <th className="px-3 py-2 text-left font-semibold">Settore</th>
                <th className="px-3 py-2 text-right font-semibold">Importo</th>
                <th className="px-3 py-2 text-right font-semibold">Cauz. Def. (10%)</th>
                <th className="px-3 py-2 text-right font-semibold">Decennale</th>
                <th className="px-3 py-2 text-right font-semibold">Premio/anno</th>
                <th className="px-3 py-2 text-center font-semibold">Priorità</th>
                <th className="px-3 py-2 text-center font-semibold">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {response.leads.map((lead, i) => (
                <LeadRow key={`${lead.ragioneSociale}-${i}`} lead={lead} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer fonti */}
        <div className="px-5 py-3 border-t border-border bg-muted/40 flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Info className="w-3 h-3" />
            Query: <code className="bg-background px-2 py-0.5 rounded border border-border font-mono text-[10px] text-foreground">{response.meta.queryUsed}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            Fonti: {response.meta.sourcesUsed.join(', ')} • {(response.meta.durationMs / 1000).toFixed(1)}s
          </div>
        </div>
      </div>

      {response.meta.warnings.length > 0 && (
        <div className="rounded-xl p-4 bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />
            <div className="text-xs text-amber-300">
              <strong>Note:</strong>
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                {response.meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string
  value: string
  subtitle?: string
  accent: 'emerald' | 'amber' | 'rose' | 'indigo'
}) {
  const cls = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
    rose: 'border-rose-500/30 bg-rose-500/5 text-rose-300',
    indigo: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-300',
  }[accent]
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-90">{label}</div>
      <div className="text-2xl font-bold text-foreground mt-1">{value}</div>
      {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
    </div>
  )
}

function LeadRow({ lead }: { lead: ProspectionLead }) {
  return (
    <tr className="border-t border-border hover:bg-muted/30 transition-colors">
      <td className="px-3 py-3 align-top">
        <div className="font-semibold text-foreground text-sm line-clamp-1">{lead.ragioneSociale}</div>
        {lead.partitaIva && (
          <div className="text-[10px] text-muted-foreground font-mono">P.IVA {lead.partitaIva}</div>
        )}
        <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{lead.garaOggetto}</div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <MapPin className="w-3 h-3" />
          <span className="line-clamp-1">{lead.stazioneAppaltante}</span>
          {lead.dataAggiudicazione && (
            <>
              <span>•</span>
              <Calendar className="w-3 h-3" />
              <span>{lead.dataAggiudicazione}</span>
            </>
          )}
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex items-center gap-1">
          <CategoryIcon cat={lead.categoria} />
          <span className="text-xs font-medium capitalize text-foreground">{lead.categoria === 'unknown' ? '—' : lead.categoria}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-right font-semibold text-foreground align-top">
        {formatEUR(lead.importoAggiudicato)}
      </td>
      <td className="px-3 py-3 text-right text-foreground align-top">
        {formatEUR(lead.cauzioneDefinitivaStimata)}
      </td>
      <td className="px-3 py-3 text-right align-top">
        {lead.decennalePostumaStimata
          ? <span className="text-rose-400 font-semibold">{formatEUR(lead.decennalePostumaStimata)}</span>
          : <span className="text-muted-foreground">—</span>
        }
      </td>
      <td className="px-3 py-3 text-right align-top">
        <div className="text-sm font-semibold text-emerald-300">
          {formatEUR(lead.premioAnnuoCauzioneStimato.mid)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatEUR(lead.premioAnnuoCauzioneStimato.min)}–{formatEUR(lead.premioAnnuoCauzioneStimato.max)}
        </div>
      </td>
      <td className="px-3 py-3 text-center align-top">
        <PriorityBadge score={lead.priorityScore} />
      </td>
      <td className="px-3 py-3 text-center align-top">
        {lead.fonteUrl ? (
          <a
            href={lead.fonteUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-emerald-300 inline-flex"
            title="Apri fonte ANAC"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
    </tr>
  )
}
