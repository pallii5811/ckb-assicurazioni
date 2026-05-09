import type { AtecoInsurance } from '@/lib/ateco-insurance'
import type { InsuranceGap } from '@/lib/insurance-analysis'

export interface InsuranceEvidenceFact {
  id: string
  label: string
  value: string
  source: string
  confidence: 'alta' | 'media' | 'bassa'
}

export interface InsuranceNeedRecommendation {
  id: string
  product: string
  target: string
  priority: 'immediata' | 'alta' | 'media'
  confidence: 'alta' | 'media' | 'bassa'
  sales_reason: string
  why_now: string
  evidence_ids: string[]
  conversion_lever?: string
}

export interface DataVerificationGap {
  field: string
  reason: string
  impact: string
}

export interface CommercialPriorityProfile {
  level: 'altissima' | 'alta' | 'media' | 'bassa'
  score: number
  reasons: string[]
}

export interface SalesPlaybook {
  prodotto_principale: string | null
  cross_sell: string | null
  target_principale: string | null
}

// ── REAL broker intelligence, computed from verified data ─────────────
export interface FinancialIntelligence {
  revenue_trend: 'crescita' | 'stabile' | 'declino' | null
  revenue_trend_pct: number | null
  latest_revenue: number | null
  oldest_revenue: number | null
  profit_status: 'positivo' | 'negativo' | null
  latest_profit: number | null
  solvency_ratio: number | null
  solvency_level: 'solida' | 'media' | 'bassa' | null
  payroll_dependency_ratio: number | null
  headcount_trend: 'crescita' | 'stabile' | 'riduzione' | null
  latest_headcount: number | null
  years_analyzed: number
  latest_year: number | null
  oldest_year: number | null
}

export interface TitolareIntelligence {
  nome: string | null
  codice_fiscale: string | null
  eta: number | null
  sesso: 'M' | 'F' | null
  data_nascita: string | null
  succession_risk: 'critico' | 'alto' | 'medio' | 'basso' | null
}

export interface RiskConcentration {
  socio_unico: boolean
  max_quota: number
  numero_soci: number
  titolare_unico: boolean
  capitale_minimo: boolean
  patrimonio_esposto: boolean
  anni_attivita: number | null
  level: 'critico' | 'alto' | 'medio' | 'basso'
  reasons: string[]
}

export interface TriggerAlert {
  id: string
  type: 'opportunita' | 'red_flag' | 'info'
  severity: 'critico' | 'alto' | 'medio'
  title: string
  description: string
  action: string
  evidence_ids: string[]
}

export interface InsuranceNeedsProfile {
  fatti_verificati: InsuranceEvidenceFact[]
  bisogni_raccomandati: InsuranceNeedRecommendation[]
  dati_da_verificare: DataVerificationGap[]
  priorita_commerciale: CommercialPriorityProfile
  playbook_commerciale: SalesPlaybook
  financial_intelligence: FinancialIntelligence | null
  titolare_intelligence: TitolareIntelligence | null
  risk_concentration: RiskConcentration
  trigger_alerts: TriggerAlert[]
}

type KeyPersonFact = {
  nome?: unknown
  ruolo?: unknown
}

type InsuranceNeedsSourceProfile = Record<string, unknown> & {
  rischio_territoriale?: {
    zona_sismica?: unknown
    rischio_idrogeologico?: unknown
  } | null
  classificazione_eu?: { label?: unknown } | string | null
  persone?: KeyPersonFact[] | null
  storico_bilanci?: unknown[] | null
}

type BuildNeedsInput = {
  profile: InsuranceNeedsSourceProfile
  category: string | null
  website: string | null
  atecoInsurance: AtecoInsurance | null
  gapAnalysis: InsuranceGap | null
}

function parseNumber(value: unknown, allowZero = false, allowNegative = false): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (allowNegative) return value
    return allowZero ? (value >= 0 ? value : null) : (value > 0 ? value : null)
  }
  if (typeof value !== 'string') return null
  let s = value.trim()
  s = s.replace(/\b(?:nel|anno|year|esercizio)\s*\d{4}\b/gi, '')
  s = s.replace(/\(\d{4}\)/g, '')
  s = s.replace(/[€$]/g, '').replace(/\b(?:euro|eur)\b/gi, '').trim()
  if (!s) return null
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
    : s.replace(/,/g, '').replace(/[^\d.-]/g, '')
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  if (allowNegative) return n
  return allowZero ? (n >= 0 ? n : null) : (n > 0 ? n : null)
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return null
  const match = value.match(/\d+/)
  if (!match) return null
  const n = parseInt(match[0], 10)
  return Number.isFinite(n) ? n : null
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function fmtEuro(value: unknown): string {
  const n = parseNumber(value, true, true)
  return n !== null ? `€${new Intl.NumberFormat('it-IT').format(n)}` : String(value)
}

function sourceLabel(source: unknown, fallback = 'OpenAPI.it / Registro Imprese'): string {
  const raw = String(source || '').toLowerCase()
  if (raw.includes('openapi')) return 'OpenAPI.it / Registro Imprese'
  if (raw.includes('inipec')) return 'INI-PEC / Registro Imprese'
  if (raw.includes('registro')) return 'Registro Imprese / profilo camerale'
  if (raw.includes('companyreports')) return 'CompanyReports / bilanci pubblici'
  if (raw.includes('tavily')) return 'Tavily / fonti web pubbliche'
  if (raw.includes('sito')) return 'Sito web aziendale'
  return fallback
}

function pushFact(facts: InsuranceEvidenceFact[], fact: InsuranceEvidenceFact | null) {
  if (!fact) return
  if (facts.some((item) => item.id === fact.id)) return
  facts.push(fact)
}

function pushNeed(needs: InsuranceNeedRecommendation[], need: InsuranceNeedRecommendation | null) {
  if (!need) return
  if (needs.some((item) => item.id === need.id)) return
  needs.push(need)
}

type BrokerContext = {
  companyName: string
  titolare: string | null
  revenue: number | null
  employees: number | null
  legalForm: string
  city: string
  website: string | null
  sectorText: string
  totalAssets: number | null
  netWorth: number | null
  payroll: number | null
}

function fmtMoney(n: number | null): string {
  return n !== null ? `€${new Intl.NumberFormat('it-IT').format(n)}` : 'fatturato non disponibile'
}

function fmtMoneyValue(n: number): string {
  return `€${new Intl.NumberFormat('it-IT').format(Math.round(n))}`
}

function enrichNeedForBroker(need: InsuranceNeedRecommendation, ctx: BrokerContext): InsuranceNeedRecommendation {
  // Solo conversion_lever ancorato al DATO specifico (no script, no scenari formulaici, no domande generiche).
  // Il broker si fida del sistema solo se ogni frase è tracciabile a un dato verificato.
  const decisionMaker = ctx.titolare || need.target
  const byNeed: Record<string, string | null> = {
    key_man_microimpresa: ctx.titolare
      ? `Azienda con persona chiave identificata (${decisionMaker}). Leva reale: dipendenza economica dal titolare in assenza di seconde figure operative.`
      : null,
    rc_commercio_prodotti_tutela: ctx.sectorText
      ? `Attività commerciale rilevata (ATECO ${need.evidence_ids.includes('ateco') ? 'verificato' : 'stimato'}): leva reale su RC prodotti, incaricati e tutela legale.`
      : null,
    cyber_risk: ctx.website
      ? `Presenza web verificata (${ctx.website}): leva reale su email aziendali, dati clienti, pagamenti e backup.`
      : null,
    property_all_risks: ctx.totalAssets !== null
      ? `Totale attivo verificato: €${new Intl.NumberFormat('it-IT').format(ctx.totalAssets)}. Leva su valori assicurati, business interruption e sottolimiti.`
      : null,
    do_amministratori: ctx.legalForm
      ? `Forma giuridica ${ctx.legalForm}: l'amministratore risponde personalmente per mala gestio. Leva su D&O e protezione patrimonio.`
      : null,
    employee_benefits: ctx.employees !== null && ctx.employees >= 10
      ? `${ctx.employees} dipendenti verificati da Registro Imprese: leva su welfare, sanitaria collettiva e infortuni extraprofessionali.`
      : null,
  }
  const lever = byNeed[need.id]
  return lever ? { ...need, conversion_lever: lever } : need
}

function buildSalesPlaybook(needs: InsuranceNeedRecommendation[]): SalesPlaybook {
  const topNeed = needs[0] || null
  const crossSellNeed = needs.find((need) => need.id !== topNeed?.id && (need.priority === 'immediata' || need.priority === 'alta')) || needs[1] || null
  return {
    prodotto_principale: topNeed?.product || null,
    cross_sell: crossSellNeed?.product || null,
    target_principale: topNeed?.target || null,
  }
}

// ── Estrae data di nascita, età e sesso dal Codice Fiscale italiano ────
function extractCfInfo(cf: string | null | undefined): { birthDate: Date | null; age: number | null; sex: 'M' | 'F' | null; birthDateISO: string | null } {
  if (!cf || typeof cf !== 'string') return { birthDate: null, age: null, sex: null, birthDateISO: null }
  const cleaned = cf.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (cleaned.length !== 16) return { birthDate: null, age: null, sex: null, birthDateISO: null }
  const yy = cleaned.substring(6, 8)
  const monthChar = cleaned.substring(8, 9)
  const ddRaw = cleaned.substring(9, 11)
  const monthMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, H: 5, L: 6, M: 7, P: 8, R: 9, S: 10, T: 11 }
  const month = monthMap[monthChar]
  const ddNum = parseInt(ddRaw, 10)
  if (month === undefined || !Number.isFinite(ddNum)) return { birthDate: null, age: null, sex: null, birthDateISO: null }
  const sex: 'M' | 'F' = ddNum > 40 ? 'F' : 'M'
  const realDay = ddNum > 40 ? ddNum - 40 : ddNum
  if (realDay < 1 || realDay > 31) return { birthDate: null, age: null, sex: null, birthDateISO: null }
  const now = new Date()
  const century = parseInt(yy, 10) > (now.getFullYear() % 100 + 1) ? 1900 : 2000
  const birthYear = century + parseInt(yy, 10)
  const birthDate = new Date(birthYear, month, realDay)
  if (Number.isNaN(birthDate.getTime())) return { birthDate: null, age: null, sex: null, birthDateISO: null }
  let age = now.getFullYear() - birthYear
  if (now.getMonth() < month || (now.getMonth() === month && now.getDate() < realDay)) age -= 1
  if (age < 16 || age > 100) return { birthDate: null, age: null, sex: null, birthDateISO: null }
  const iso = `${birthYear}-${String(month + 1).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`
  return { birthDate, age, sex, birthDateISO: iso }
}

// ── Intelligenza finanziaria calcolata dai bilanci reali ───────────────
function computeFinancialIntelligence(profile: InsuranceNeedsSourceProfile): FinancialIntelligence | null {
  const rawStorico = Array.isArray(profile.storico_bilanci) ? profile.storico_bilanci : []
  if (rawStorico.length === 0) return null
  type BilancioYear = { anno: number; fatturato?: number; utile?: number; dipendenti?: number; patrimonio_netto?: number; totale_attivo?: number }
  const storico = rawStorico
    .filter((b): b is BilancioYear => Boolean(b && typeof (b as BilancioYear).anno === 'number'))
    .sort((a, b) => b.anno - a.anno)
  if (storico.length === 0) return null

  const revenues = storico.map(b => b.fatturato).filter((v): v is number => typeof v === 'number' && v > 0)
  const latestRev = revenues[0] ?? null
  const oldestRev = revenues[revenues.length - 1] ?? null
  let revTrend: FinancialIntelligence['revenue_trend'] = null
  let revTrendPct: number | null = null
  if (latestRev !== null && oldestRev !== null && oldestRev > 0 && revenues.length >= 2) {
    const pct = ((latestRev - oldestRev) / oldestRev) * 100
    revTrendPct = Math.round(pct)
    revTrend = pct > 10 ? 'crescita' : pct < -10 ? 'declino' : 'stabile'
  }

  const profits = storico.map(b => b.utile).filter((v): v is number => typeof v === 'number')
  const latestProfit = profits[0] ?? null
  const profitStatus: FinancialIntelligence['profit_status'] = latestProfit !== null ? (latestProfit >= 0 ? 'positivo' : 'negativo') : null

  const pn = parseNumber(profile.patrimonio_netto, true, true)
  const ta = parseNumber(profile.totale_attivo)
  let solvencyRatio: number | null = null
  let solvencyLevel: FinancialIntelligence['solvency_level'] = null
  if (pn !== null && ta !== null && ta > 0) {
    solvencyRatio = pn / ta
    solvencyLevel = solvencyRatio < 0.2 ? 'bassa' : solvencyRatio < 0.4 ? 'media' : 'solida'
  }

  const payroll = parseNumber(profile.costo_personale)
  const rev = parseNumber(profile.fatturato)
  const payrollDep = (payroll !== null && rev !== null && rev > 0) ? payroll / rev : null

  const headcounts = storico.map(b => b.dipendenti).filter((v): v is number => typeof v === 'number')
  const latestHc = headcounts[0] ?? null
  const oldestHc = headcounts[headcounts.length - 1] ?? null
  let headcountTrend: FinancialIntelligence['headcount_trend'] = null
  if (latestHc !== null && oldestHc !== null && headcounts.length >= 2) {
    headcountTrend = latestHc > oldestHc ? 'crescita' : latestHc < oldestHc ? 'riduzione' : 'stabile'
  }

  return {
    revenue_trend: revTrend,
    revenue_trend_pct: revTrendPct,
    latest_revenue: latestRev,
    oldest_revenue: oldestRev,
    profit_status: profitStatus,
    latest_profit: latestProfit,
    solvency_ratio: solvencyRatio,
    solvency_level: solvencyLevel,
    payroll_dependency_ratio: payrollDep,
    headcount_trend: headcountTrend,
    latest_headcount: latestHc,
    years_analyzed: storico.length,
    latest_year: storico[0]?.anno ?? null,
    oldest_year: storico[storico.length - 1]?.anno ?? null,
  }
}

// ── Intelligenza titolare da CF ─────────────────────────────────────────
function computeTitolareIntelligence(profile: InsuranceNeedsSourceProfile, concentration: RiskConcentration): TitolareIntelligence | null {
  const titolare = hasValue(profile.titolare) ? String(profile.titolare) : null
  const cf = hasValue(profile.codice_fiscale_titolare) ? String(profile.codice_fiscale_titolare) : null
  if (!titolare && !cf) return null
  const info = extractCfInfo(cf)
  let succession: TitolareIntelligence['succession_risk'] = null
  if (info.age !== null) {
    if (info.age >= 65) succession = 'critico'
    else if (info.age >= 55 && concentration.socio_unico) succession = 'critico'
    else if (info.age >= 55) succession = 'alto'
    else if (info.age >= 45) succession = 'medio'
    else succession = 'basso'
  }
  return {
    nome: titolare,
    codice_fiscale: cf,
    eta: info.age,
    sesso: info.sex,
    data_nascita: info.birthDateISO,
    succession_risk: succession,
  }
}

// ── Concentrazione rischio (socio unico, capitale minimo, patrimonio) ──
function computeRiskConcentration(profile: InsuranceNeedsSourceProfile): RiskConcentration {
  const persone = Array.isArray(profile.persone) ? profile.persone as Array<Record<string, unknown>> : []
  const soci = persone.filter(p => /socio/i.test(String(p.ruolo_normalizzato || p.ruolo || '')))
  let maxQuota = 0
  for (const p of persone) {
    const q = typeof p.quota_percentuale === 'number' ? p.quota_percentuale : 0
    if (q > maxQuota) maxQuota = q
  }
  const socioUnico = maxQuota >= 99 || (soci.length === 1 && persone.length <= 2)
  const titolari = persone.filter(p => /titolare|amministratore/i.test(String(p.ruolo_normalizzato || p.ruolo || '')))
  const titolareUnico = titolari.length <= 1

  const legalForm = String(profile.forma_giuridica || '').toUpperCase()
  const capitaleSociale = parseNumber(profile.capitale_sociale)
  const capitaleMinimo = /SRLS/.test(legalForm) || (capitaleSociale !== null && capitaleSociale <= 10000)
  const patrimonio = parseNumber(profile.patrimonio_netto, true, true)
  const patrimonioEsposto = patrimonio !== null && patrimonio < 10000

  let anniAttivita: number | null = null
  if (hasValue(profile.data_costituzione)) {
    const d = new Date(String(profile.data_costituzione))
    if (!Number.isNaN(d.getTime())) {
      anniAttivita = Math.max(0, Math.round(((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10)
    }
  }

  const reasons: string[] = []
  if (socioUnico) reasons.push('Socio unico o quota concentrata ≥99%')
  if (titolareUnico) reasons.push('Un solo amministratore/titolare identificato')
  if (capitaleMinimo) reasons.push(`Capitale ridotto (${legalForm === 'SRLS' ? 'SRLS' : `€${capitaleSociale ?? '<10k'}`})`)
  if (patrimonioEsposto) reasons.push(`Patrimonio netto limitato (<€10k)`)
  if (anniAttivita !== null && anniAttivita < 2) reasons.push(`Attività costituita da ${anniAttivita} anni`)

  let level: RiskConcentration['level'] = 'basso'
  const score = (socioUnico ? 2 : 0) + (capitaleMinimo ? 1 : 0) + (patrimonioEsposto ? 2 : 0) + (titolareUnico ? 1 : 0)
  if (score >= 5) level = 'critico'
  else if (score >= 3) level = 'alto'
  else if (score >= 1) level = 'medio'

  return {
    socio_unico: socioUnico,
    max_quota: Math.round(maxQuota * 10) / 10,
    numero_soci: soci.length,
    titolare_unico: titolareUnico,
    capitale_minimo: capitaleMinimo,
    patrimonio_esposto: patrimonioEsposto,
    anni_attivita: anniAttivita,
    level,
    reasons,
  }
}

// ── Trigger commerciali da dati verificati (no template, solo evidenza) ─
function computeTriggerAlerts(
  profile: InsuranceNeedsSourceProfile,
  fin: FinancialIntelligence | null,
  tit: TitolareIntelligence | null,
  conc: RiskConcentration,
): TriggerAlert[] {
  const alerts: TriggerAlert[] = []
  const companyName = String(profile.ragione_sociale || profile.nome || 'azienda')

  // Azienda giovane (<2 anni) — da Registro Imprese verificato
  if (conc.anni_attivita !== null && conc.anni_attivita < 2) {
    alerts.push({
      id: 'azienda_giovane',
      type: 'opportunita',
      severity: 'medio',
      title: `Azienda costituita da ${conc.anni_attivita} anni`,
      description: `Imprese con meno di 2 anni di attività hanno tipicamente coperture base, assenti o improvvisate. Finestra massima per impostare il portafoglio assicurativo prima che abitudini e scadenze si cristallizzino.`,
      action: 'Proporre audit di impostazione iniziale completa (RC, infortuni, property, cyber). Offrire ruolo di consulente di fiducia dall\'inizio.',
      evidence_ids: ['data_costituzione'],
    })
  }

  // Fatturato in declino — da storico bilanci verificato
  if (fin?.revenue_trend === 'declino' && fin.revenue_trend_pct !== null) {
    const absPct = Math.abs(fin.revenue_trend_pct)
    alerts.push({
      id: 'fatturato_declino',
      type: 'red_flag',
      severity: absPct > 25 ? 'critico' : 'alto',
      title: `Fatturato in declino ${fin.revenue_trend_pct}% (${fin.oldest_year}→${fin.latest_year})`,
      description: `Il fatturato è passato da €${new Intl.NumberFormat('it-IT').format(fin.oldest_revenue || 0)} a €${new Intl.NumberFormat('it-IT').format(fin.latest_revenue || 0)}. L'azienda è probabilmente in fase di razionalizzazione spese: evitare upsell, concentrarsi su audit delle coperture esistenti per ottimizzazione premi.`,
      action: 'Proporre revisione portafoglio in ottica risparmio + tutela legale rafforzata (contenziosi più probabili in fase critica).',
      evidence_ids: ['storico_bilanci', 'fatturato'],
    })
  }

  // Fatturato in crescita — opportunità
  if (fin?.revenue_trend === 'crescita' && fin.revenue_trend_pct !== null && fin.revenue_trend_pct > 20) {
    alerts.push({
      id: 'fatturato_crescita',
      type: 'opportunita',
      severity: 'alto',
      title: `Fatturato in crescita +${fin.revenue_trend_pct}% (${fin.oldest_year}→${fin.latest_year})`,
      description: `Crescita significativa del fatturato: le coperture assicurative impostate in passato sono probabilmente sotto-dimensionate rispetto all'esposizione attuale (massimali RC, valori property, cyber).`,
      action: 'Audit massimali e valori assicurati con focus su adeguamento. Probabile upgrade RC, property e introduzione D&O se non presente.',
      evidence_ids: ['storico_bilanci', 'fatturato'],
    })
  }

  // Utile negativo — red flag verificato da bilancio
  if (fin?.profit_status === 'negativo' && fin.latest_profit !== null) {
    alerts.push({
      id: 'utile_negativo',
      type: 'red_flag',
      severity: 'alto',
      title: `Ultimo bilancio in perdita (€${new Intl.NumberFormat('it-IT').format(fin.latest_profit)})`,
      description: `L'esercizio ${fin.latest_year} chiude in perdita. Esposizione aumentata su D&O (azioni di responsabilità da soci/creditori), tutela legale (contenziosi fornitori), credito (sofferenze bancarie → garanzie personali del titolare).`,
      action: 'Prioritizzare D&O con retroattività e postuma, tutela legale contrattuale, verifica polizza vita titolare se garanzie personali attive.',
      evidence_ids: ['utile_netto', 'storico_bilanci'],
    })
  }

  // Solvibilità bassa — calcolata da PN/Totale Attivo
  if (fin?.solvency_level === 'bassa' && fin.solvency_ratio !== null) {
    alerts.push({
      id: 'solvibilita_bassa',
      type: 'red_flag',
      severity: 'alto',
      title: `Solvibilità bassa: PN copre solo il ${Math.round(fin.solvency_ratio * 100)}% del totale attivo`,
      description: `Il patrimonio netto è una frazione minima del totale attivo: azienda fortemente indebitata o sottocapitalizzata. Il titolare è quasi certamente esposto con garanzie personali/fideiussioni bancarie.`,
      action: 'Key Man e polizza vita diventano critici per proteggere la famiglia da garanzie personali. Chiedere esplicitamente in call di fideiussioni attive.',
      evidence_ids: ['patrimonio_netto', 'totale_attivo'],
    })
  }

  // Socio unico + capitale minimo = esposizione patrimonio personale
  if (conc.socio_unico && conc.capitale_minimo) {
    alerts.push({
      id: 'concentrazione_critica',
      type: 'opportunita',
      severity: 'critico',
      title: `Socio unico con capitale ridotto — patrimonio personale esposto`,
      description: `${companyName} ha un unico centro decisionale con capitale sociale minimo. In caso di debiti aziendali, contenziosi o garanzie personali, il patrimonio familiare del titolare è direttamente esposto.`,
      action: 'Leva commerciale forte su: protezione patrimonio personale, polizza vita, TCM, Key Man. Discutere separazione famiglia/azienda e protezione quote.',
      evidence_ids: ['forma_giuridica', 'capitale_sociale', 'persone_chiave'],
    })
  }

  // Titolare 55-64 anni — tema successione reale
  if (tit?.succession_risk === 'alto' || tit?.succession_risk === 'critico') {
    const age = tit.eta
    const isCritico = tit.succession_risk === 'critico'
    alerts.push({
      id: 'succession_risk',
      type: 'opportunita',
      severity: isCritico ? 'critico' : 'alto',
      title: `Titolare ${age} anni: finestra successione ${isCritico ? 'critica' : 'aperta'}`,
      description: `${tit.nome || 'Il titolare'} ha ${age} anni (da CF verificato). ${isCritico ? 'Finestra successione estremamente rilevante: eventi di salute, pensionamento o exit possono bloccare l\'azienda se non pianificati.' : 'Pianificazione successione è una leva consulenziale molto forte a questa età, specie se il titolare è socio unico o persona chiave.'}`,
      action: isCritico
        ? 'Apri call su Key Man, polizza vita a protezione famiglia/soci, piano successione, liquidazione quote. Priorità massima.'
        : 'Introduci tema passaggio generazionale come check-up: chi continua l\'attività, come si liquida chi esce, quali coperture di accompagnamento.',
      evidence_ids: ['cf_titolare'],
    })
  }

  // Dipendenti in crescita — welfare trigger verificato
  if (fin?.headcount_trend === 'crescita' && fin.latest_headcount !== null && fin.latest_headcount >= 5) {
    alerts.push({
      id: 'welfare_trigger',
      type: 'opportunita',
      severity: 'medio',
      title: `Organico in crescita: ${fin.latest_headcount} dipendenti (trend positivo)`,
      description: `L'azienda sta assumendo. Momento ottimale per introdurre welfare aziendale, sanitaria collettiva e infortuni extraprofessionali: retention dipendenti e benefit fiscale immediato.`,
      action: 'Proporre pacchetto welfare + sanitaria collettiva. Leva su costo deducibile al 100% e defiscalizzato per il dipendente.',
      evidence_ids: ['dipendenti', 'storico_bilanci'],
    })
  }

  // Dipendenti in riduzione — red flag HR/sinistri
  if (fin?.headcount_trend === 'riduzione') {
    alerts.push({
      id: 'riduzione_organico',
      type: 'red_flag',
      severity: 'medio',
      title: `Organico in riduzione`,
      description: `Numero dipendenti in calo: possibile fase di ristrutturazione, contenziosi lavoro o ricorso a collaboratori esterni. Aumenta il rischio contenzioso giuslavoristico e RC verso ex dipendenti.`,
      action: 'Priorità a tutela legale giuslavoristica e verifica RC/D&O contro azioni di responsabilità post-uscita.',
      evidence_ids: ['dipendenti', 'storico_bilanci'],
    })
  }

  return alerts
}

export function buildInsuranceNeedsProfile({
  profile,
  category,
  website,
  atecoInsurance,
  gapAnalysis,
}: BuildNeedsInput): InsuranceNeedsProfile {
  const facts: InsuranceEvidenceFact[] = []
  const needs: InsuranceNeedRecommendation[] = []
  const verificationGaps: DataVerificationGap[] = []
  const commercialReasons: string[] = []
  const nextQuestions: string[] = []

  const categoryText = String(category || '').toLowerCase()
  const legalForm = String(profile.forma_giuridica || '').toUpperCase()
  const atecoCode = String(profile.codice_ateco || '')
  const atecoDigits = atecoCode.replace(/\D/g, '')
  const atecoEstimated = Boolean(profile.ateco_stimato)
  const revenue = parseNumber(profile.fatturato)
  const employees = parseInteger(profile.dipendenti)
  const totalAssets = parseNumber(profile.totale_attivo)
  const netWorth = parseNumber(profile.patrimonio_netto, true)
  const payroll = parseNumber(profile.costo_personale)
  const hasWebsite = Boolean(website)
  const hasPec = Boolean(profile.pec)
  const zonaSismica = profile.rischio_territoriale?.zona_sismica ?? null
  const rischioIdro = String(profile.rischio_territoriale?.rischio_idrogeologico || '')
  const city = String(profile.sede_legale || profile.comune || '')
  const keyPeople = Array.isArray(profile.persone) ? profile.persone : []
  const balanceHistory = Array.isArray(profile.storico_bilanci) ? profile.storico_bilanci : []
  const classification = profile.classificazione_eu
  const classificationText = typeof classification === 'object' && classification !== null
    ? String(classification.label || '')
    : String(classification || '')
  const sectorText = `${categoryText} ${(atecoInsurance?.settore || '').toLowerCase()}`.trim()
  const mandatoryPolicies = [
    ...(atecoInsurance?.polizze_obbligatorie || []),
    ...(atecoInsurance?.polizze_raccomandate || []),
  ].join(' | ').toLowerCase()

  pushFact(facts, hasValue(profile.ragione_sociale) ? {
    id: 'ragione_sociale',
    label: 'Ragione sociale',
    value: String(profile.ragione_sociale),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.partita_iva) ? {
    id: 'partita_iva',
    label: 'Partita IVA',
    value: String(profile.partita_iva),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.codice_fiscale) ? {
    id: 'codice_fiscale',
    label: 'Codice fiscale azienda',
    value: String(profile.codice_fiscale),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.rea) ? {
    id: 'rea',
    label: 'Codice REA',
    value: String(profile.rea),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.stato_attivita) ? {
    id: 'stato_attivita',
    label: 'Stato attività',
    value: String(profile.stato_attivita),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.data_costituzione) ? {
    id: 'data_costituzione',
    label: 'Data costituzione',
    value: String(profile.data_costituzione),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.titolare) ? {
    id: 'titolare',
    label: 'Titolare / referente',
    value: String(profile.titolare),
    source: sourceLabel(profile.titolare_fonte, 'OpenAPI.it / Registro Imprese'),
    confidence: String(profile.titolare_fonte || '').includes('openapi') ? 'alta' : 'media',
  } : null)

  pushFact(facts, hasValue(profile.codice_fiscale_titolare) ? {
    id: 'cf_titolare',
    label: 'C.F. titolare',
    value: String(profile.codice_fiscale_titolare),
    source: sourceLabel(profile.cf_fonte || profile.titolare_fonte, 'OpenAPI.it / Registro Imprese'),
    confidence: String(profile.cf_fonte || profile.titolare_fonte || '').includes('openapi') ? 'alta' : 'media',
  } : null)

  pushFact(facts, legalForm ? {
    id: 'forma_giuridica',
    label: 'Forma giuridica',
    value: legalForm,
    source: 'Registro Imprese / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, atecoCode ? {
    id: 'ateco',
    label: 'Codice ATECO',
    value: atecoCode,
    source: atecoEstimated ? 'Stima assistita AI da dati pubblici' : 'Registro Imprese / profilo camerale',
    confidence: atecoEstimated ? 'media' : 'alta',
  } : null)

  pushFact(facts, revenue !== null ? {
    id: 'fatturato',
    label: 'Fatturato',
    value: `€${new Intl.NumberFormat('it-IT').format(revenue)}`,
    source: sourceLabel(profile.fatturato_fonte, 'Bilancio / profilo camerale'),
    confidence: String(profile.fatturato_fonte || '').includes('tavily') ? 'media' : 'alta',
  } : null)

  pushFact(facts, hasValue(profile.utile_netto) ? {
    id: 'utile_netto',
    label: 'Utile netto',
    value: fmtEuro(profile.utile_netto),
    source: sourceLabel(profile.fatturato_fonte, 'Bilancio / profilo camerale'),
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.patrimonio_netto) ? {
    id: 'patrimonio_netto',
    label: 'Patrimonio netto',
    value: fmtEuro(profile.patrimonio_netto),
    source: 'Bilancio / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.totale_attivo) ? {
    id: 'totale_attivo',
    label: 'Totale attivo',
    value: fmtEuro(profile.totale_attivo),
    source: 'Bilancio / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.capitale_sociale) ? {
    id: 'capitale_sociale',
    label: 'Capitale sociale',
    value: fmtEuro(profile.capitale_sociale),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasValue(profile.costo_personale) ? {
    id: 'costo_personale',
    label: 'Costo del personale',
    value: fmtEuro(profile.costo_personale),
    source: 'Bilancio / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, employees !== null ? {
    id: 'dipendenti',
    label: 'Dipendenti',
    value: String(employees),
    source: sourceLabel(profile.dipendenti_fonte, 'Registro Imprese / profilo camerale'),
    confidence: String(profile.dipendenti_fonte || '').includes('tavily') ? 'media' : 'alta',
  } : null)

  pushFact(facts, hasWebsite ? {
    id: 'website',
    label: 'Sito aziendale',
    value: String(website),
    source: 'Lead + verifica web',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasPec ? {
    id: 'pec',
    label: 'PEC rilevata',
    value: String(profile.pec),
    source: sourceLabel(profile.pec_fonte, 'INI-PEC / profilo camerale'),
    confidence: 'alta',
  } : null)

  pushFact(facts, city ? {
    id: 'sede',
    label: 'Sede legale / città',
    value: city,
    source: 'Registro Imprese / lead',
    confidence: 'media',
  } : null)

  pushFact(facts, hasValue(profile.codice_sdi) ? {
    id: 'codice_sdi',
    label: 'Codice SDI',
    value: String(profile.codice_sdi),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, keyPeople.length > 0 ? {
    id: 'persone_chiave',
    label: 'Persone chiave Registro',
    value: keyPeople.slice(0, 4).map((p) => `${p.nome}${p.ruolo ? ` (${p.ruolo})` : ''}`).join(' · '),
    source: 'OpenAPI.it / Registro Imprese',
    confidence: 'alta',
  } : null)

  pushFact(facts, balanceHistory.length > 0 ? {
    id: 'storico_bilanci',
    label: 'Storico bilanci',
    value: `${balanceHistory.length} annualità disponibili`,
    source: 'OpenAPI.it / bilanci pubblici',
    confidence: 'alta',
  } : null)

  pushFact(facts, zonaSismica ? {
    id: 'zona_sismica',
    label: 'Zona sismica',
    value: String(zonaSismica),
    source: 'Protezione Civile / mapping territoriale',
    confidence: 'media',
  } : null)

  pushFact(facts, rischioIdro ? {
    id: 'rischio_idro',
    label: 'Rischio idrogeologico',
    value: rischioIdro,
    source: 'Mapping territoriale',
    confidence: 'media',
  } : null)

  if (!atecoCode) {
    verificationGaps.push({
      field: 'codice_ateco',
      reason: 'ATECO non disponibile o non verificato',
      impact: 'Riduce la precisione della proposta polizze settoriali',
    })
    nextQuestions.push('Qual è il codice ATECO preciso o l’attività prevalente effettiva?')
  }

  if (revenue === null) {
    verificationGaps.push({
      field: 'fatturato',
      reason: 'Fatturato non disponibile',
      impact: 'Riduce la precisione di massimali, pricing e ranking commerciale',
    })
    nextQuestions.push('Qual è il fatturato indicativo o la fascia di ricavi dell’azienda?')
  }

  if (employees === null) {
    verificationGaps.push({
      field: 'dipendenti',
      reason: 'Numero dipendenti non disponibile',
      impact: 'Riduce la precisione su welfare, infortuni collettivi e benefits',
    })
    nextQuestions.push('Quanti dipendenti o collaboratori operativi ha l’azienda?')
  }

  if (!hasWebsite) {
    verificationGaps.push({
      field: 'website',
      reason: 'Sito non rilevato',
      impact: 'Riduce la precisione su cyber, contatti e segnali commerciali digitali',
    })
  }

  verificationGaps.push({
    field: 'Portafoglio polizze attive',
    reason: 'Il sistema non ha accesso alle polizze realmente in essere: nessuna banca dati pubblica dice se RC, D&O, Cyber o Property siano già attive.',
    impact: 'Domanda decisiva in call: chiedere elenco polizze, compagnia, massimali, franchigie, scoperti e scadenze.',
  })

  verificationGaps.push({
    field: 'Sinistri e contenziosi ultimi 5 anni',
    reason: 'I sinistri non sono pubblici e cambiano completamente priorità, pricing e leva commerciale.',
    impact: 'Permette di passare da proposta generica a consulenza reale su scoperti, esclusioni e massimali insufficienti.',
  })

  const isCapitalCompany = /SRL|SPA|SRLS/.test(legalForm)
  const isPeopleCompany = /SNC|SAS/.test(legalForm)
  const isMicroCompany = employees !== null ? employees <= 3 : /micro/i.test(classificationText)
  const isProfessional = mandatoryPolicies.includes('rc professionale') || hasAny(sectorText, [/avvocat/, /commerciali/, /notai/, /architett/, /ingegner/, /consulen/, /profession/])
  const isHealthcare = mandatoryPolicies.includes('sanitaria') || hasAny(sectorText, [/medic/, /dentist/, /clinic/, /veterinar/, /farmaci/])
  const isConstruction = mandatoryPolicies.includes('car/ear') || hasAny(sectorText, [/costruzion/, /edili/, /cantier/, /ristruttur/])
  const isTransport = mandatoryPolicies.includes('vettoriale') || hasAny(sectorText, [/trasport/, /logistic/, /autotrasport/, /magazzin/])
  const descText = String(profile.descrizione_ateco || '').toLowerCase()
  const isTechnicalMaintenance = /^33/.test(atecoDigits) || hasAny(`${sectorText} ${descText}`, [/riparaz/, /manutenz/, /estintor/, /antincendio/, /macchinar/])
  const isFireSafetyMaintenance = /^331255/.test(atecoDigits) || hasAny(`${sectorText} ${descText}`, [/estintor/, /antincendio/, /impianti antincendio/])
  const isManufacturing = !isTechnicalMaintenance && hasAny(sectorText, [/manifatt/, /produzion/, /industr/, /aliment/, /chimic/])
  const isRetailTrade = /^4[5-7]/.test(atecoDigits) || hasAny(`${sectorText} ${profile.descrizione_ateco || ''}`, [/commerc/, /vendit/, /retail/, /negoz/, /porta a porta/, /e-commerce/, /dettaglio/, /ingrosso/])
  const hasPhysicalRisk = isConstruction || isTransport || isManufacturing || isRetailTrade || isTechnicalMaintenance || hasAny(sectorText, [/ristoraz/, /bar/, /hotel/, /officina/])

  if (isCapitalCompany) {
    pushNeed(needs, {
      id: 'do_amministratori',
      product: 'D&O Amministratori',
      target: 'Amministratore / CdA',
      priority: revenue !== null && revenue >= 2_000_000 ? 'immediata' : 'alta',
      confidence: 'alta',
      sales_reason: 'La forma giuridica espone amministratori e organi sociali a responsabilità personali per scelte gestionali.',
      why_now: revenue !== null && revenue >= 2_000_000 ? 'Dimensione aziendale già sufficiente per proporre revisione D&O strutturata.' : 'Lead con bisogno tipico e molto comprensibile in fase di consulenza.',
      evidence_ids: ['forma_giuridica', ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Società di capitali: D&O è una porta d’ingresso forte e credibile')
    nextQuestions.push('L’amministratore ha già una D&O? Con quale massimale e con quali esclusioni?')
  }

  if (isMicroCompany && profile.titolare) {
    pushNeed(needs, {
      id: 'key_man_microimpresa',
      product: 'Key Man / Infortuni titolare / diaria da fermo attività',
      target: String(profile.titolare),
      priority: 'alta',
      confidence: employees !== null ? 'alta' : 'media',
      sales_reason: `${profile.titolare} è il referente operativo identificato e l’azienda è micro: il rischio più concreto è la dipendenza economica da una persona chiave.`,
      why_now: 'Prima ancora di parlare di prezzo, il consulente può quantificare quanti giorni l’impresa regge se il titolare non lavora.',
      evidence_ids: ['titolare', ...(employees !== null ? ['dipendenti'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Micro impresa con persona chiave identificata: leva Key Man molto forte')
    nextQuestions.push(`${profile.titolare} lavora operativamente ogni giorno o ha una struttura che può sostituirlo?`)
  }

  if (isPeopleCompany) {
    pushNeed(needs, {
      id: 'rc_soci',
      product: 'RC Soci / Protezione patrimonio personale',
      target: 'Soci accomandatari / soci operativi',
      priority: 'alta',
      confidence: 'alta',
      sales_reason: 'Nelle società di persone il tema della responsabilità personale è immediato e molto percepito.',
      why_now: 'È un bisogno direttamente collegato alla forma giuridica rilevata.',
      evidence_ids: ['forma_giuridica'],
    })
    commercialReasons.push('Società di persone: forte leva su patrimonio personale dei soci')
  }

  if (isProfessional) {
    pushNeed(needs, {
      id: 'rc_professionale',
      product: 'RC Professionale',
      target: 'Professionista / studio / titolare',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'L’attività rilevata rientra tra quelle per cui la RC professionale è il primo tavolo di vendita da aprire.',
      why_now: 'È il bisogno più aderente al servizio erogato dall’azienda.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'forma_giuridica') ? ['forma_giuridica'] : [])],
    })
    commercialReasons.push('Settore professionale: prodotto principale chiaro e facilmente spiegabile')
  }

  if (isHealthcare) {
    pushNeed(needs, {
      id: 'rc_sanitaria',
      product: 'RC Sanitaria / Malpractice',
      target: 'Struttura sanitaria / professionista sanitario',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Nel sanitario il rischio di contenzioso e malpractice è centrale e il prodotto è specifico.',
      why_now: 'È un bisogno nativo del settore rilevato.',
      evidence_ids: ['ateco'],
    })
    commercialReasons.push('Settore sanitario: bisogno assicurativo ad altissima rilevanza')
  }

  if (isConstruction) {
    pushNeed(needs, {
      id: 'car_cantieri',
      product: 'CAR / EAR / Decennale Postuma',
      target: 'Titolare / ufficio tecnico / amministratore',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Nel settore edile le coperture di cantiere sono concrete, contrattuali e spesso urgenti.',
      why_now: 'Prodotto collegato direttamente al tipo di commesse e di lavori eseguiti.',
      evidence_ids: ['ateco'],
    })
    commercialReasons.push('Edilizia: copertura concreta, tangibile e spesso richiesta dal mercato')
    nextQuestions.push('L’azienda lavora su cantieri propri, subappalti o ristrutturazioni?')
  }

  if (isTransport) {
    pushNeed(needs, {
      id: 'flotta_merci',
      product: 'RC Vettoriale / Flotta / Merci Trasportate',
      target: 'Titolare / fleet manager / logistica',
      priority: 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Trasporti e logistica generano esigenze assicurative molto specifiche e continuative.',
      why_now: 'Il bisogno è collegato al core business operativo.',
      evidence_ids: ['ateco'],
    })
    commercialReasons.push('Trasporti/logistica: più linee di polizza nello stesso lead')
  }

  if (isTechnicalMaintenance) {
    pushNeed(needs, {
      id: 'rc_postuma_manutentore',
      product: isFireSafetyMaintenance
        ? 'RC Postuma / RC Professionale Manutentore Antincendio'
        : 'RC Postuma / RC Professionale Manutentore Tecnico',
      target: 'Titolare / responsabile tecnico / amministratore',
      priority: isFireSafetyMaintenance ? 'immediata' : 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: isFireSafetyMaintenance
        ? 'Manutenzione estintori/antincendio: il rischio commerciale non è produrre un bene, ma che un presidio manutentato non funzioni quando serve. La leva corretta è RC postuma del manutentore + tutela legale su contestazioni tecniche.'
        : 'Riparazione/manutenzione tecnica: il rischio chiave è il danno dopo l’intervento, quando il macchinario/impianto del cliente si ferma o causa danni a terzi.',
      why_now: isFireSafetyMaintenance
        ? 'ATECO coerente con manutenzione estintori: aprire subito il tema UNI 9994, registri manutenzione, contratti ricorrenti e massimali post-intervento.'
        : 'Il bisogno nasce direttamente dal servizio tecnico svolto presso o per conto del cliente.',
      evidence_ids: ['ateco', ...(revenue !== null ? ['fatturato'] : []), ...(employees !== null ? ['dipendenti'] : [])],
    })
    commercialReasons.push(isFireSafetyMaintenance
      ? 'Manutenzione antincendio: leva ad alto valore su RC postuma e responsabilità tecnica'
      : 'Manutenzione tecnica: leva concreta su danno post-intervento e beni in consegna')
    nextQuestions.push(isFireSafetyMaintenance
      ? 'Manutenete estintori o impianti antincendio? Avete registri UNI 9994 aggiornati, contratti ricorrenti e copertura postuma per malfunzionamento dopo intervento?'
      : 'Gli interventi avvengono presso il cliente o in officina? La RC attuale copre danni dopo la riconsegna/intervento?')
  }

  if (isRetailTrade) {
    pushNeed(needs, {
      id: 'rc_commercio_prodotti_tutela',
      product: 'RC Commercio / RC Prodotti venduti / Tutela legale',
      target: 'Titolare / amministratore / referente commerciale',
      priority: revenue !== null && revenue >= 300_000 ? 'alta' : 'media',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'L’attività commerciale rilevata espone a contestazioni clienti, danni da prodotto venduto, responsabilità degli incaricati e controversie contrattuali.',
      why_now: 'È una proposta concreta perché parte dal modo in cui l’azienda vende, non da una polizza generica.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'sede') ? ['sede'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Commercio/vendita: leva immediata su RC esercizio, prodotti e tutela legale')
    nextQuestions.push('Vendete solo prodotti vostri o anche prodotti di terzi? Avete incaricati/agenti esterni o vendita porta a porta?')
  }

  if (isManufacturing) {
    pushNeed(needs, {
      id: 'rc_prodotti',
      product: 'RC Prodotti / Recall / Contaminazione',
      target: 'Titolare / responsabile qualità / amministratore',
      priority: revenue !== null && revenue >= 1_000_000 ? 'immediata' : 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Chi produce o trasforma beni ha un angolo commerciale fortissimo su danno a terzi, difetto e richiamo.',
      why_now: revenue !== null && revenue >= 1_000_000 ? 'Volume d’affari sufficiente per aprire un tavolo RC prodotti serio.' : 'Prodotto coerente con il rischio operativo rilevato.',
      evidence_ids: ['ateco', ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Produzione/manifattura: valore alto su RC prodotti e property')
  }

  if (employees !== null && employees >= 10) {
    pushNeed(needs, {
      id: 'employee_benefits',
      product: 'Sanitaria collettiva / Infortuni collettiva / Welfare',
      target: 'Titolare / HR / amministrazione',
      priority: employees >= 50 ? 'immediata' : 'alta',
      confidence: 'alta',
      sales_reason: 'La dimensione dell’organico rende vendibile un’offerta di welfare e coperture collettive.',
      why_now: employees >= 50 ? 'Organico importante: alta probabilità di bisogno attuale o imminente.' : 'Il numero di dipendenti giustifica una proposta benefits credibile.',
      evidence_ids: ['dipendenti'],
    })
    commercialReasons.push('Numero dipendenti sufficiente per pacchetti collettivi')
    nextQuestions.push('Applicate un CCNL con sanità integrativa o avete già un piano welfare?')
  }

  if (hasWebsite && ((employees !== null && employees >= 1) || (revenue !== null && revenue >= 50_000) || isProfessional || isHealthcare || isRetailTrade)) {
    pushNeed(needs, {
      id: 'cyber_risk',
      product: 'Cyber Risk',
      target: 'Titolare / amministratore / IT / privacy',
      priority: isHealthcare || isProfessional ? 'alta' : 'media',
      confidence: 'media',
      sales_reason: 'Presenza digitale e trattamento di dati aumentano il valore di una proposta cyber ben impostata.',
      why_now: isHealthcare || isProfessional ? 'Settore con dati sensibili o dati cliente critici.' : 'Presenza web/contatti digitali: verificare gestione dati clienti, email, pagamenti e backup.',
      evidence_ids: ['website', ...(employees !== null ? ['dipendenti'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
  }

  if (hasPhysicalRisk) {
    pushNeed(needs, {
      id: 'property_all_risks',
      product: 'Property / Incendio / All Risks / Business Interruption',
      target: 'Titolare / amministratore',
      priority: zonaSismica && Number(zonaSismica) <= 2 ? 'alta' : 'media',
      confidence: 'media',
      sales_reason: 'Il business sembra dipendere da beni, locali, attrezzature o continuità operativa.',
      why_now: zonaSismica && Number(zonaSismica) <= 2 ? 'Rischio territoriale e continuità operativa aumentano la rilevanza della proposta.' : 'Ottima per revisione consulenziale: valori assicurati, merci, attrezzature, esclusioni e business interruption.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'zona_sismica') ? ['zona_sismica'] : []), ...(facts.some((f) => f.id === 'rischio_idro') ? ['rischio_idro'] : [])],
    })
    nextQuestions.push('Qual è il valore reale di merci, attrezzature e beni strumentali assicurati oggi? La polizza copre danni indiretti/fermo attività?')
  }

  if (gapAnalysis?.gaps?.length) {
    const topGap = gapAnalysis.gaps.find((gap) => gap.gravita === 'critico') || gapAnalysis.gaps[0]
    if (topGap) {
      commercialReasons.push(`Gap prioritario rilevato: ${topGap.area}`)
      nextQuestions.push(`Avete già una copertura attiva per ${topGap.area}?`) 
    }
  }

  const immediateNeeds = needs.filter((need) => need.priority === 'immediata').length
  const highNeeds = needs.filter((need) => need.priority === 'alta').length
  let commercialScore = 20 + immediateNeeds * 18 + highNeeds * 10 + Math.min(facts.length, 8) * 3 - verificationGaps.length * 4

  if (revenue !== null && revenue >= 2_000_000) commercialScore += 10
  if (employees !== null && employees >= 10) commercialScore += 8
  if (gapAnalysis?.livello_rischio === 'critico') commercialScore += 10
  if (gapAnalysis?.livello_rischio === 'alto') commercialScore += 6

  commercialScore = Math.max(0, Math.min(100, commercialScore))

  const commercialLevel: CommercialPriorityProfile['level'] =
    commercialScore >= 75 ? 'altissima'
    : commercialScore >= 55 ? 'alta'
    : commercialScore >= 35 ? 'media'
    : 'bassa'

  needs.sort((a, b) => {
    const priorityOrder = { immediata: 0, alta: 1, media: 2 }
    const confidenceOrder = { alta: 0, media: 1, bassa: 2 }
    return priorityOrder[a.priority] - priorityOrder[b.priority] || confidenceOrder[a.confidence] - confidenceOrder[b.confidence]
  })

  const brokerContext: BrokerContext = {
    companyName: String(profile.ragione_sociale || profile.nome || 'questa azienda'),
    titolare: hasValue(profile.titolare) ? String(profile.titolare) : null,
    revenue,
    employees,
    legalForm,
    city,
    website,
    sectorText,
    totalAssets,
    netWorth,
    payroll,
  }

  for (let i = 0; i < needs.length; i += 1) {
    needs[i] = enrichNeedForBroker(needs[i], brokerContext)
  }

  const playbook = buildSalesPlaybook(needs)

  // Real, verifiable broker intelligence ────────────────────────────
  const riskConcentration = computeRiskConcentration(profile)
  const financialIntelligence = computeFinancialIntelligence(profile)
  const titolareIntelligence = computeTitolareIntelligence(profile, riskConcentration)
  const triggerAlerts = computeTriggerAlerts(profile, financialIntelligence, titolareIntelligence, riskConcentration)

  return {
    fatti_verificati: facts,
    bisogni_raccomandati: needs,
    dati_da_verificare: verificationGaps,
    priorita_commerciale: {
      level: commercialLevel,
      score: commercialScore,
      reasons: commercialReasons.slice(0, 5),
    },
    playbook_commerciale: playbook,
    financial_intelligence: financialIntelligence,
    titolare_intelligence: titolareIntelligence,
    risk_concentration: riskConcentration,
    trigger_alerts: triggerAlerts,
  }
}
