import type { AtecoInsurance } from '@/lib/ateco-insurance'
import type { InsuranceGap } from '@/lib/insurance-analysis'
import { detectSectorProfiles, type SectorDetectionInput } from '@/lib/sector-profiles'

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
  latest_revenue_year: number | null
  oldest_revenue_year: number | null
  latest_profit_year: number | null
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

function sameAmount(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false
  return Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.001)
}

function hasReliableNetWorth(profile: InsuranceNeedsSourceProfile, latestProfit: number | null = null): boolean {
  const pn = parseNumber(profile.patrimonio_netto, true, true)
  if (pn === null) return false
  const explicitProfit = parseNumber(profile.utile_netto, true, true)
  const storico = Array.isArray(profile.storico_bilanci) ? profile.storico_bilanci : []
  const hasHistoricNetWorth = storico.some((b) => parseNumber((b as Record<string, unknown>)?.patrimonio_netto, true, true) !== null)
  if (!hasHistoricNetWorth && (sameAmount(pn, explicitProfit) || sameAmount(pn, latestProfit))) return false
  return true
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
      ? `Struttura micro + referente registrato (${decisionMaker}): leva reale solo dopo verifica di chi presidia operatività, clienti e continuità aziendale.`
      : null,
    rc_commercio_prodotti_tutela: ctx.sectorText
      ? `Attività commerciale rilevata (ATECO ${need.evidence_ids.includes('ateco') ? 'verificato' : 'stimato'}): leva reale su RC prodotti, incaricati e tutela legale.`
      : null,
    cyber_risk: ctx.website
      ? `Presenza web verificata (${ctx.website}): leva reale su dati clienti, email aziendali, pagamenti, backup e procedure GDPR.`
      : null,
    property_all_risks: ctx.totalAssets !== null
      ? `Totale attivo verificato: €${new Intl.NumberFormat('it-IT').format(ctx.totalAssets)}. Leva su valori assicurati, business interruption e sottolimiti.`
      : null,
    do_amministratori: ctx.legalForm
      ? `Forma giuridica ${ctx.legalForm}${ctx.revenue !== null ? ` + fatturato ${fmtMoneyValue(ctx.revenue)}` : ''}: leva su responsabilità amministratori, difesa legale e protezione patrimonio personale.`
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

  const revenueEntries = storico
    .filter(b => typeof b.fatturato === 'number' && b.fatturato > 0)
    .map(b => ({ anno: b.anno, fatturato: b.fatturato as number }))
  const revenues = revenueEntries.map(b => b.fatturato)
  const latestRev = revenueEntries[0]?.fatturato ?? null
  const oldestRev = revenueEntries[revenueEntries.length - 1]?.fatturato ?? null
  const latestRevenueYear = revenueEntries[0]?.anno ?? null
  const oldestRevenueYear = revenueEntries[revenueEntries.length - 1]?.anno ?? null
  let revTrend: FinancialIntelligence['revenue_trend'] = null
  let revTrendPct: number | null = null
  if (latestRev !== null && oldestRev !== null && oldestRev > 0 && revenues.length >= 2) {
    const pct = ((latestRev - oldestRev) / oldestRev) * 100
    revTrendPct = Math.round(pct)
    revTrend = pct > 10 ? 'crescita' : pct < -10 ? 'declino' : 'stabile'
  }

  const profitEntries = storico
    .filter(b => typeof b.utile === 'number')
    .map(b => ({ anno: b.anno, utile: b.utile as number }))
  const profits = profitEntries.map(b => b.utile)
  const latestProfit = profitEntries[0]?.utile ?? null
  const latestProfitYear = profitEntries[0]?.anno ?? null
  const profitStatus: FinancialIntelligence['profit_status'] = latestProfit !== null ? (latestProfit >= 0 ? 'positivo' : 'negativo') : null

  const pn = hasReliableNetWorth(profile, latestProfit) ? parseNumber(profile.patrimonio_netto, true, true) : null
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

  const hasActionableSignal = revTrendPct !== null || latestProfit !== null || solvencyRatio !== null || payrollDep !== null || latestHc !== null || headcountTrend !== null
  if (!hasActionableSignal) return null

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
    latest_revenue_year: latestRevenueYear,
    oldest_revenue_year: oldestRevenueYear,
    latest_profit_year: latestProfitYear,
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

// ── Estrae quota percentuale (number) da campo string ("50%", "50,00%", "50.0") o number ──
function parseQuotaPercent(p: Record<string, unknown>): number {
  if (typeof p.quota_percentuale === 'number' && Number.isFinite(p.quota_percentuale)) return p.quota_percentuale
  const raw = p.quota
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return 0
  const cleaned = raw.replace('%', '').replace(',', '.').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

// ── Concentrazione rischio (socio unico, capitale minimo, patrimonio) ──
function computeRiskConcentration(profile: InsuranceNeedsSourceProfile): RiskConcentration {
  const persone = Array.isArray(profile.persone) ? profile.persone as Array<Record<string, unknown>> : []
  const soci = persone.filter(p => /socio/i.test(String(p.ruolo_normalizzato || p.ruolo || '')))
  let maxQuota = 0
  for (const p of persone) {
    const q = parseQuotaPercent(p)
    if (q > maxQuota) maxQuota = q
  }
  const socioUnico = maxQuota >= 99 || (soci.length === 1 && persone.length <= 2)
  const titolari = persone.filter(p => /titolare|amministratore/i.test(String(p.ruolo_normalizzato || p.ruolo || '')))
  const titolareUnico = titolari.length === 1

  const legalForm = String(profile.forma_giuridica || '').toUpperCase()
  const capitaleSociale = parseNumber(profile.capitale_sociale)
  const capitaleMinimo = /SRLS/.test(legalForm) || (capitaleSociale !== null && capitaleSociale <= 10000)
  const patrimonio = hasReliableNetWorth(profile) ? parseNumber(profile.patrimonio_netto, true, true) : null
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
      description: `Impresa molto giovane: portafoglio assicurativo, massimali e scadenze sono ancora da consolidare. È una finestra utile per impostare metodo, scadenziario e priorità prima che il cliente si abitui a coperture scelte solo per prezzo.`,
      action: 'Proporre audit iniziale su rischi base, scadenze, massimali e franchigie. Obiettivo: diventare consulente assicurativo di riferimento prima del primo rinnovo strutturato.',
      evidence_ids: ['data_costituzione'],
    })
  }

  // Fatturato in declino — da storico bilanci verificato
  if (fin?.revenue_trend === 'declino' && fin.revenue_trend_pct !== null) {
    const absPct = Math.abs(fin.revenue_trend_pct)
    const fromYear = fin.oldest_revenue_year ?? fin.oldest_year ?? 'N/D'
    const toYear = fin.latest_revenue_year ?? fin.latest_year ?? 'N/D'
    alerts.push({
      id: 'fatturato_declino',
      type: 'red_flag',
      severity: absPct > 25 ? 'critico' : 'alto',
      title: `Fatturato in calo ${fin.revenue_trend_pct}% (${fromYear}→${toYear})`,
      description: `Il fatturato è passato da €${new Intl.NumberFormat('it-IT').format(fin.oldest_revenue || 0)} a €${new Intl.NumberFormat('it-IT').format(fin.latest_revenue || 0)}. Il segnale suggerisce di qualificare in call se l'azienda sta riducendo costi, marginalità o commesse.`,
      action: 'Aprire con revisione portafoglio in ottica efficienza: premi, duplicazioni, franchigie, scoperti e tutela legale contrattuale.',
      evidence_ids: ['storico_bilanci', 'fatturato'],
    })
  }

  // Fatturato in crescita — opportunità
  if (fin?.revenue_trend === 'crescita' && fin.revenue_trend_pct !== null && fin.revenue_trend_pct > 20) {
    const fromYear = fin.oldest_revenue_year ?? fin.oldest_year ?? 'N/D'
    const toYear = fin.latest_revenue_year ?? fin.latest_year ?? 'N/D'
    alerts.push({
      id: 'fatturato_crescita',
      type: 'opportunita',
      severity: 'alto',
      title: `Fatturato cresciuto +${fin.revenue_trend_pct}% (${fromYear}→${toYear})`,
      description: `Il fatturato disponibile nello storico è passato da €${new Intl.NumberFormat('it-IT').format(fin.oldest_revenue || 0)} a €${new Intl.NumberFormat('it-IT').format(fin.latest_revenue || 0)}. È un segnale utile per verificare se massimali RC, valori assicurati, business interruption e cyber sono ancora coerenti con l'esposizione attuale.`,
      action: 'Audit massimali e valori assicurati con focus su adeguamento a fatturato attuale, commesse, beni e dati gestiti.',
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
      description: `L'esercizio ${fin.latest_profit_year ?? fin.latest_year ?? 'N/D'} chiude in perdita. Il dato rende prioritario qualificare tensione finanziaria, garanzie personali, esposizione verso soci/creditori e contenziosi contrattuali.`,
      action: 'Prioritizzare D&O, tutela legale contrattuale e verifica garanzie personali/fideiussioni prima di proporre cross-sell non essenziali.',
      evidence_ids: ['utile_netto', 'storico_bilanci'],
    })
  }

  // Solvibilità bassa — calcolata da PN/Totale Attivo
  if (fin?.solvency_level === 'bassa' && fin.solvency_ratio !== null) {
    alerts.push({
      id: 'solvibilita_bassa',
      type: 'red_flag',
      severity: 'alto',
      title: `Patrimonializzazione contenuta: PN pari al ${Math.round(fin.solvency_ratio * 100)}% del totale attivo`,
      description: `Il rapporto patrimonio netto/totale attivo è contenuto. È un segnale contabile da qualificare con debiti, liquidità, garanzie personali, affidamenti e andamento corrente prima di trarre conclusioni sulla solidità finanziaria.`,
      action: 'Chiedere se esistono fideiussioni, garanzie personali o affidamenti bancari. Se emergono esposizioni personali, aprire tema Key Man, TCM e protezione soci/famiglia.',
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
      description: `${companyName} concentra decisione e capitale in poche mani. Questo non prova garanzie personali, ma crea una leva consulenziale forte su continuità, successione, quote e tutela del patrimonio familiare.`,
      action: 'Qualificare garanzie personali, quote, continuità operativa e piano di successione. Se emergono esposizioni personali, proporre Key Man/TCM e protezione soci.',
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
      description: `I bilanci mostrano organico in aumento. È un segnale concreto per qualificare retention, costo del personale, CCNL applicato e benefit già presenti.`,
      action: 'Proporre verifica welfare/sanitaria collettiva/infortuni extraprofessionali partendo da CCNL, turnover e budget HR reale.',
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
      description: `Numero dipendenti in calo: segnale da qualificare, non diagnosi. Può dipendere da riorganizzazione, stagionalità, esternalizzazioni o riduzione commesse.`,
      action: 'Chiedere motivo della riduzione e verificare tutela legale lavoro, gestione collaboratori esterni, D&O e responsabilità verso ex dipendenti.',
      evidence_ids: ['dipendenti', 'storico_bilanci'],
    })
  }

  // ★ Soci paritetici / quote bilanciate → trigger Buy-Sell agreement.
  // Se 2+ soci con quote 30-70% (no socio unico) e almeno uno è in fascia >= 55 anni (da CF),
  // o anche solo se ci sono 2+ soci con quote significative, è una leva commerciale concreta:
  // alla morte/invalidità di un socio gli altri devono poter liquidare gli eredi senza danneggiare l'azienda.
  const persone = Array.isArray(profile.persone) ? profile.persone as Array<Record<string, unknown>> : []
  const sociConQuota = persone
    .filter(p => /socio/i.test(String(p.ruolo_normalizzato || p.ruolo || '')))
    .map(p => ({ nome: String(p.nome || ''), cf: String(p.cf || ''), quota: parseQuotaPercent(p) }))
    .filter(s => s.quota > 0)
  const sociPariteticiSignificativi = sociConQuota.filter(s => s.quota >= 25 && s.quota <= 75)
  if (!conc.socio_unico && sociPariteticiSignificativi.length >= 2) {
    const etaSoci = sociPariteticiSignificativi
      .map(s => extractCfInfo(s.cf).age)
      .filter((a): a is number => a !== null)
    const maxEta = etaSoci.length > 0 ? Math.max(...etaSoci) : null
    const haSocioOver55 = maxEta !== null && maxEta >= 55
    const quoteStr = sociPariteticiSignificativi
      .slice(0, 4)
      .map(s => `${s.nome.split(' ')[0] || 'Socio'} ${s.quota}%`)
      .join(', ')
    alerts.push({
      id: 'buy_sell_paritetico',
      type: 'opportunita',
      severity: haSocioOver55 ? 'alto' : 'medio',
      title: haSocioOver55
        ? `Soci paritetici + un socio ≥55 anni: leva Buy-Sell concreta`
        : `Più soci con quote significative: tema continuità tra soci`,
      description: `Quote rilevate: ${quoteStr}.${haSocioOver55 ? ` Almeno un socio risulta avere ${maxEta} anni (CF verificato).` : ''} Alla morte o invalidità di un socio, gli altri devono avere strumenti per liquidare gli eredi senza dover vendere asset aziendali o cedere il controllo.`,
      action: 'Aprire tavolo Buy-Sell agreement + polizza vita incrociata tra soci (cross purchase) o intestata alla società (entity purchase). Verificare statuto, patti parasociali e clausole di prelazione/gradimento.',
      evidence_ids: ['persone_chiave', 'forma_giuridica'],
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
  const netWorth = hasReliableNetWorth(profile) ? parseNumber(profile.patrimonio_netto, true) : null
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
  // sectorText: concatena TUTTI i testi che descrivono l'attività (lowercase, no accenti).
  // Usato sia per i flag legacy (isManufacturing, isProfessional, etc.) sia per il match
  // dei profili settoriali specifici in sector-profiles.ts.
  const sectorText = [
    categoryText,
    String(atecoInsurance?.settore || '').toLowerCase(),
    String(profile.descrizione_ateco || '').toLowerCase(),
    String(profile.ragione_sociale || '').toLowerCase(),
    classificationText.toLowerCase(),
  ].filter(Boolean).join(' ').trim()
  const mandatoryPolicies = [
    ...(atecoInsurance?.polizze_obbligatorie || []),
    ...(atecoInsurance?.polizze_raccomandate || []),
  ].join(' | ').toLowerCase()

  // ─── INIEZIONE BISOGNI SETTORIALI SPECIFICI (sector-profiles.ts) ────
  // I profili settoriali sono additivi: se non matcha nessuno, l'engine continua
  // come prima (backward compatibile). Se matcha, i bisogni specifici vengono
  // pushati per primi (dedup automatico via pushNeed by id) e domande/leve
  // commerciali si aggiungono alle liste broker.
  const sectorDetectionInput: SectorDetectionInput = {
    atecoDigits,
    sectorText,
    legalForm,
    employees: employees ?? null,
    revenue: revenue ?? null,
  }
  const matchedSectorProfiles = detectSectorProfiles(sectorDetectionInput)
  for (const sectorProfile of matchedSectorProfiles) {
    for (const need of sectorProfile.needs) {
      pushNeed(needs, need)
    }
    for (const domanda of sectorProfile.domande_broker) {
      if (!nextQuestions.includes(domanda)) nextQuestions.push(domanda)
    }
    for (const reason of sectorProfile.commercial_reasons) {
      if (!commercialReasons.includes(reason)) commercialReasons.push(reason)
    }
  }

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

  pushFact(facts, netWorth !== null ? {
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
  const isIndividualBusiness = /\bDI\b|DITTA|INDIVID/.test(legalForm)
  const isPeopleCompany = /SNC|SAS/.test(legalForm)
  const isMicroCompany = employees !== null ? employees <= 3 : /micro/i.test(classificationText)
  const descText = String(profile.descrizione_ateco || '').toLowerCase()
  const isInformationTechnology = /^(62|63)/.test(atecoDigits) || hasAny(descText, [/software/, /informat/, /\bict\b/, /digitale/, /cloud/, /hosting/, /saas/])
  const isPlantInstallation = /^432/.test(atecoDigits) || hasAny(descText, [/installazione.*impiant/, /impianti elettrici/, /impianti idraulici/])
  const isConstruction = !isPlantInstallation && (mandatoryPolicies.includes('car/ear') || hasAny(sectorText, [/costruzion/, /edili/, /cantier/, /ristruttur/]))
  const isHealthcare = mandatoryPolicies.includes('sanitaria') || hasAny(sectorText, [/medic/, /dentist/, /clinic/, /veterinar/, /farmaci/])
  const isProfessionalAteco = /^(69|70|71|72|73|74|75)/.test(atecoDigits)
  const isProfessional = !isInformationTechnology && !isConstruction && !isHealthcare && (
    isProfessionalAteco || hasAny(sectorText, [/avvocat/, /commerciali/, /notai/, /architett/, /ingegner/, /consulen/, /profession/])
  )
  const isTransport = mandatoryPolicies.includes('vettoriale') || hasAny(sectorText, [/trasport/, /logistic/, /autotrasport/, /magazzin/])
  const isTechnicalMaintenance = isPlantInstallation || /^33/.test(atecoDigits) || hasAny(`${sectorText} ${descText}`, [/riparaz/, /manutenz/, /estintor/, /antincendio/, /macchinar/])
  const isFireSafetyMaintenance = /^331255/.test(atecoDigits) || hasAny(`${sectorText} ${descText}`, [/estintor/, /antincendio/, /impianti antincendio/])
  // ★ BUG FIX: i laboratori di analisi/collaudi (ATECO 71xx) NON sono manifattura: producono referti, non beni.
  // La parola "chimico" o "alimentare" nella descrizione/categoria portava erroneamente a "RC Prodotti".
  // Manifattura vera = ATECO 05-33 (estrazione, manifatturiero, riparazione macchinari escluso).
  const isManufacturingAteco = /^(0[5-9]|1[0-9]|2[0-9]|3[0-2])/.test(atecoDigits)
  const isProfessionalOrTechnicalServiceAteco = /^(33|62|63|69|70|71|72|73|74|75|85|86)/.test(atecoDigits)
  const isManufacturing = !isTechnicalMaintenance
    && !isProfessionalOrTechnicalServiceAteco
    && (isManufacturingAteco || (atecoDigits.length === 0 && hasAny(sectorText, [/manifatt/, /produzion/, /industri[ae]/, /aliment/])))
  // ★ Laboratorio di analisi / collaudi / taratura (ATECO 71.20.1, 71.20.2, 71.12.x con desc tecnica).
  // Bisogno specifico: RC Professionale per errore di analisi (falso positivo/negativo) + RC Inquinamento
  // per laboratori chimici/biologici. Si differenzia da generico "Servizi professionali".
  const isLaboratorioTecnico = /^(71201|71202|7120)/.test(atecoDigits)
    || hasAny(`${sectorText} ${descText}`, [/laboratori[oi]\s+(chimic|analis|prov|collaud|tarat|biolog|microbiolog)/, /collaud[oi]/, /taratur/, /accreditament[oi].*(iso\s*17025|accredia)/])
  const isLaboratorioChimicoBiologico = isLaboratorioTecnico
    && hasAny(`${sectorText} ${descText}`, [/chimic/, /biolog/, /microbiolog/, /reagent/, /tossicolog/, /microbi/])
  const isRetailTrade = /^4[5-7]/.test(atecoDigits) || hasAny(`${sectorText} ${profile.descrizione_ateco || ''}`, [/commerc/, /vendit/, /retail/, /negoz/, /porta a porta/, /e-commerce/, /dettaglio/, /ingrosso/])
  const hasPhysicalRisk = isConstruction || isTransport || isManufacturing || isRetailTrade || isTechnicalMaintenance || hasAny(sectorText, [/ristoraz/, /bar/, /hotel/, /officina/])
  const hasGovernanceEvidence = revenue !== null || hasValue(profile.capitale_sociale) || keyPeople.length > 0
  const hasOperationalScaleEvidence = revenue !== null || employees !== null || totalAssets !== null

  if (isCapitalCompany && hasGovernanceEvidence) {
    pushNeed(needs, {
      id: 'do_amministratori',
      product: 'D&O Amministratori',
      target: 'Amministratore / CdA',
      priority: revenue !== null && revenue >= 2_000_000 ? 'immediata' : 'alta',
      confidence: 'alta',
      sales_reason: revenue !== null
        ? `Società di capitali con fatturato verificato ${fmtMoneyValue(revenue)}: la D&O diventa un tavolo concreto su responsabilità gestionali, difesa legale e patrimonio personale degli amministratori.`
        : 'Società di capitali con dati governance/registro disponibili: D&O da qualificare su cariche, deleghe, quote, patrimonio e garanzie personali.',
      why_now: revenue !== null && revenue >= 2_000_000 ? 'Dimensione aziendale sufficiente per proporre revisione D&O strutturata con massimale serio.' : 'Da aprire come check-up tecnico, non come polizza generica: cariche, deleghe, retroattività, postuma, creditori e soci.',
      evidence_ids: ['forma_giuridica', ...(revenue !== null ? ['fatturato'] : []), ...(hasValue(profile.capitale_sociale) ? ['capitale_sociale'] : []), ...(keyPeople.length > 0 ? ['persone_chiave'] : [])],
    })
    commercialReasons.push(revenue !== null ? `Società di capitali con fatturato ${fmtMoneyValue(revenue)}: leva D&O concreta` : 'Società di capitali con governance verificabile: leva D&O da qualificare')
    nextQuestions.push('L’amministratore ha già una D&O? Con quale massimale e con quali esclusioni?')
  }

  if (isMicroCompany && profile.titolare && hasOperationalScaleEvidence) {
    const keyTarget = isIndividualBusiness
      ? String(profile.titolare)
      : 'Soci / amministratore / figure operative da identificare'
    pushNeed(needs, {
      id: 'key_man_microimpresa',
      product: 'Key Man / Infortuni titolare / diaria da fermo attività',
      target: keyTarget,
      priority: 'alta',
      confidence: isIndividualBusiness && employees !== null ? 'alta' : 'media',
      sales_reason: isIndividualBusiness
        ? `${profile.titolare} risulta referente/titolare e la struttura è micro: il tema è quantificare continuità operativa e giorni di autonomia se la persona chiave si ferma.`
        : `La struttura risulta micro e ${profile.titolare} è una persona registrata nel profilo pubblico: il ruolo operativo non va presunto, va verificato in call su soci, amministratori e figure tecniche/commerciali.`
      ,
      why_now: revenue !== null ? `Fatturato verificato ${fmtMoneyValue(revenue)}: diaria/Key Man possono essere dimensionate come benchmark dopo aver identificato la persona operativa reale.` : 'Prima del prodotto, il consulente deve mappare sostituibilità, costi fissi e autonomia finanziaria.',
      evidence_ids: ['titolare', ...(employees !== null ? ['dipendenti'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Micro impresa: leva Key Man forte solo dopo verifica della persona operativa reale')
    nextQuestions.push(isIndividualBusiness ? `${profile.titolare} lavora operativamente ogni giorno o ha una struttura che può sostituirlo?` : 'Chi tra soci, amministratori o figure tecniche presidia operatività, clienti e continuità aziendale?')
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

  if (isProfessional && !isLaboratorioTecnico) {
    pushNeed(needs, {
      id: 'rc_professionale',
      product: 'RC Professionale / E&O',
      target: 'Amministratore / professionista responsabile / studio',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'L’attività rilevata eroga prestazioni/servizi professionali: RC professionale o E&O sono il primo tavolo da aprire, distinguendo obbligo di albo da responsabilità contrattuale.',
      why_now: 'È il bisogno più aderente al servizio erogato: errori, omissioni, danni patrimoniali, tutela legale e clausole contrattuali da verificare.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'forma_giuridica') ? ['forma_giuridica'] : [])],
    })
    commercialReasons.push('Servizi professionali: leva RC/E&O concreta da qualificare su attività, albo e contratti')
  }

  // ★ Laboratorio tecnico (analisi/collaudi/taratura): RC Professionale specifica per errore di analisi.
  if (isLaboratorioTecnico) {
    pushNeed(needs, {
      id: 'rc_lab_analisi',
      product: 'RC Professionale Laboratorio (errore di analisi / falso positivo o negativo)',
      target: 'Direttore tecnico / amministratore / responsabile qualità',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Laboratorio di analisi/collaudo/taratura: il rischio è errore di referto, falso positivo/negativo, taratura fuori specifica con conseguente danno al cliente. Il prodotto giusto non è RC generica ma RC professionale tecnica con tutela legale e copertura su contestazioni di referto.',
      why_now: 'Da verificare: ambito accreditamento (ISO/IEC 17025 / ACCREDIA), prove eseguite, dichiarazioni di conformità rilasciate, retroattività e postuma per contestazioni successive al rilascio del referto.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'forma_giuridica') ? ['forma_giuridica'] : [])],
    })
    commercialReasons.push('Laboratorio tecnico: RC professionale dedicata a errore di analisi/falso positivo-negativo')
    nextQuestions.push('Avete accreditamento ISO/IEC 17025 o ACCREDIA? La RC attuale copre esplicitamente contestazioni post-referto e taratura fuori specifica?')
  }

  // ★ Laboratorio chimico/biologico: RC Inquinamento accidentale (D.Lgs. 152/2006 art. 311).
  if (isLaboratorioChimicoBiologico) {
    pushNeed(needs, {
      id: 'rc_inquinamento_lab',
      product: 'RC Inquinamento accidentale (rischio reagenti / smaltimento)',
      target: 'Direttore tecnico / RSPP / amministratore',
      priority: 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Attività con reagenti chimici/biologici: l’inquinamento accidentale (sversamenti, smaltimento, contaminazione siti terzi) rientra nella responsabilità ambientale ex D.Lgs. 152/2006 art. 311. La RC generale spesso esclude questi danni o li sottolimita.',
      why_now: 'Da verificare: presenza di estensione "danni da inquinamento accidentale", limite di indennizzo, scoperto/franchigia e attività esposte (laboratorio, magazzino reagenti, smaltimento).',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'sede') ? ['sede'] : [])],
    })
    commercialReasons.push('Laboratorio chimico/biologico: rischio inquinamento accidentale specifico, da qualificare su 152/2006')
    nextQuestions.push('La vostra RC include esplicitamente inquinamento accidentale da reagenti, smaltimenti o sversamenti? Con quale limite e franchigia?')
  }

  if (isInformationTechnology) {
    pushNeed(needs, {
      id: 'technology_eo',
      product: 'RC Professionale ICT / Technology E&O',
      target: 'Amministratore / responsabile tecnico / referente commerciale',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'ATECO/descrizione coerenti con software o servizi ICT: il primo tavolo ad alto valore è responsabilità per errori software, ritardi progetto, malfunzionamenti, perdita dati e danni patrimoniali ai clienti.',
      why_now: 'Da verificare contratti, SLA, penali, responsabilità privacy, ambienti gestiti, backup e limiti della RC generale eventualmente già presente.',
      evidence_ids: ['ateco', ...(hasWebsite ? ['website'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('ICT/software: leva primaria su Technology E&O, contratti, SLA, dati e cyber')
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
      product: isPlantInstallation
        ? 'RC Installatore / RC post-intervento / Tutela legale tecnica'
        : isFireSafetyMaintenance
        ? 'RC Postuma / RC Professionale Manutentore Antincendio'
        : 'RC Postuma / RC Professionale Manutentore Tecnico',
      target: 'Titolare / responsabile tecnico / amministratore',
      priority: isFireSafetyMaintenance ? 'immediata' : 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: isPlantInstallation
        ? 'Installazione impianti: la leva assicurativa più aderente è responsabilità tecnica dopo intervento, danni a terzi, conformità DM 37/2008 e contestazioni del committente.'
        : isFireSafetyMaintenance
        ? 'Manutenzione estintori/antincendio: il rischio commerciale non è produrre un bene, ma che un presidio manutentato non funzioni quando serve. La leva corretta è RC postuma del manutentore + tutela legale su contestazioni tecniche.'
        : 'Riparazione/manutenzione tecnica: il rischio chiave è il danno dopo l’intervento, quando il macchinario/impianto del cliente si ferma o causa danni a terzi.',
      why_now: isPlantInstallation
        ? 'ATECO coerente con impianti: verificare subito abilitazioni, dichiarazioni di conformità, clausole dei contratti e copertura danni post-intervento.'
        : isFireSafetyMaintenance
        ? 'ATECO coerente con manutenzione estintori: aprire subito il tema UNI 9994, registri manutenzione, contratti ricorrenti e massimali post-intervento.'
        : 'Il bisogno nasce direttamente dal servizio tecnico svolto presso o per conto del cliente.',
      evidence_ids: ['ateco', ...(revenue !== null ? ['fatturato'] : []), ...(employees !== null ? ['dipendenti'] : [])],
    })
    commercialReasons.push(isPlantInstallation
      ? 'Installazione impianti: leva concreta su RC post-intervento, conformità e tutela legale tecnica'
      : isFireSafetyMaintenance
      ? 'Manutenzione antincendio: leva ad alto valore su RC postuma e responsabilità tecnica'
      : 'Manutenzione tecnica: leva concreta su danno post-intervento e beni in consegna')
    nextQuestions.push(isPlantInstallation
      ? 'Installate o manutenzionate impianti presso clienti/cantieri? La RC attuale copre danni dopo l’intervento, errori di installazione e contestazioni sulle dichiarazioni di conformità?'
      : isFireSafetyMaintenance
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
      why_now: employees >= 50 ? 'Organico importante: welfare, sanitaria collettiva e infortuni collettivi meritano una verifica strutturata su CCNL, budget HR e benefit già attivi.' : 'Il numero di dipendenti giustifica una proposta benefits credibile.',
      evidence_ids: ['dipendenti'],
    })
    commercialReasons.push('Numero dipendenti sufficiente per pacchetti collettivi')
    nextQuestions.push('Applicate un CCNL con sanità integrativa o avete già un piano welfare?')
  }

  if (hasWebsite && (isHealthcare || isProfessional || isInformationTechnology || (employees !== null && employees >= 5) || (revenue !== null && revenue >= 300_000))) {
    pushNeed(needs, {
      id: 'cyber_risk',
      product: 'Cyber Risk',
      target: 'Titolare / amministratore / IT / privacy',
      priority: isHealthcare || isProfessional || isInformationTechnology || (revenue !== null && revenue >= 1_000_000) ? 'alta' : 'media',
      confidence: 'media',
      sales_reason: hasWebsite && (isHealthcare || isProfessional || isInformationTechnology)
        ? 'Sito verificato + settore con dati cliente/sensibili: cyber da qualificare su GDPR, backup, ransomware e responsabilità privacy.'
        : 'Presenza web + scala aziendale sufficiente: cyber da qualificare su email, dati clienti, pagamenti, backup e fermo IT.',
      why_now: isHealthcare || isProfessional || isInformationTechnology ? 'Il settore rende la gestione del dato una leva consulenziale primaria.' : 'Non è cyber generico: parte da sito, dipendenti/fatturato e processi digitali da verificare.',
      evidence_ids: ['website', ...(employees !== null ? ['dipendenti'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
  }

  if (hasPhysicalRisk && (totalAssets !== null || revenue !== null || (zonaSismica && Number(zonaSismica) <= 2) || rischioIdro === 'alto')) {
    pushNeed(needs, {
      id: 'property_all_risks',
      product: 'Property / Incendio / All Risks / Business Interruption',
      target: 'Titolare / amministratore',
      priority: zonaSismica && Number(zonaSismica) <= 2 ? 'alta' : 'media',
      confidence: totalAssets !== null || revenue !== null ? 'alta' : 'media',
      sales_reason: totalAssets !== null
        ? `Totale attivo verificato ${fmtMoneyValue(totalAssets)}: il broker può parlare di valori assicurati, beni strumentali, sottolimiti e business interruption su base numerica.`
        : revenue !== null
        ? `Fatturato verificato ${fmtMoneyValue(revenue)} in attività operativa: la continuità aziendale va qualificata su beni, locali, merci e fermo attività.`
        : 'Rischio operativo/territoriale rilevato: property e business interruption da qualificare su beni e ubicazioni reali.',
      why_now: zonaSismica && Number(zonaSismica) <= 2 ? 'Rischio territoriale e continuità operativa aumentano la rilevanza della proposta.' : 'Revisione consulenziale concreta: valori assicurati, merci, attrezzature, esclusioni e business interruption.',
      evidence_ids: ['ateco', ...(totalAssets !== null ? ['totale_attivo'] : []), ...(revenue !== null ? ['fatturato'] : []), ...(facts.some((f) => f.id === 'zona_sismica') ? ['zona_sismica'] : []), ...(facts.some((f) => f.id === 'rischio_idro') ? ['rischio_idro'] : [])],
    })
    nextQuestions.push('Qual è il valore reale di merci, attrezzature e beni strumentali assicurati oggi? La polizza copre danni indiretti/fermo attività?')
  }

  if (gapAnalysis?.gaps?.length) {
    const topGap = gapAnalysis.gaps.find((gap) => gap.gravita === 'critico') || gapAnalysis.gaps[0]
    if (topGap && (topGap.gravita === 'critico' || topGap.gravita === 'alto')) {
      commercialReasons.push(`Ipotesi prioritaria da validare: ${topGap.area}`)
      nextQuestions.push(`Avete già una copertura attiva per ${topGap.area}?`) 
    }
  }

  const immediateNeeds = needs.filter((need) => need.priority === 'immediata').length
  const highNeeds = needs.filter((need) => need.priority === 'alta').length
  let commercialScore = 20 + immediateNeeds * 18 + highNeeds * 10 + Math.min(facts.length, 8) * 3 - verificationGaps.length * 4

  if (revenue !== null && revenue >= 2_000_000) commercialScore += 10
  if (employees !== null && employees >= 10) commercialScore += 8
  if (gapAnalysis?.livello_rischio === 'critico') commercialScore += 6
  if (gapAnalysis?.livello_rischio === 'alto') commercialScore += 3

  commercialScore = Math.max(0, Math.min(95, commercialScore))

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
