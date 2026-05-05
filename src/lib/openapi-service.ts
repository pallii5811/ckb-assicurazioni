/**
 * OpenAPI.it Service — Tier Smart Pro
 * ===================================
 * Centralized client for OpenAPI.it (Italian Business Registry) with:
 *   - Supabase cache (TTL per endpoint) to avoid duplicate paid calls
 *   - Wallet guard: blocks paid calls when wallet balance is below threshold
 *   - Env flags to enable/disable each endpoint independently
 *   - Uniform response shape (success, data, fromCache, cost)
 *
 * Endpoints currently supported:
 *   - /IT-search       (free tier 100/day, €0.001 beyond)   → discovery by name
 *   - /IT-advanced     (€0.10)                              → master record: titolare, soci, bilancio, PEC, ATECO…
 *   - /IT-stakeholders (€0.095–0.20)                        → managers/CdA with CF + data nascita (only for large companies)
 *   - /IT-pec          (€0.03, free tier 30/month)          → certified PEC fallback after INIPEC
 *
 * NEVER adds /IT-catasto or PRA in this version — per user decision (too expensive by default).
 */

import { createServiceRoleClient } from '@/utils/supabase/server'

// ── ENV FLAGS ──────────────────────────────────────────────────
const OPENAPI_IT_TOKEN = process.env.OPENAPI_IT_TOKEN || ''
const OPENAPI_MODE = (process.env.OPENAPI_MODE || 'primary').toLowerCase() as 'primary' | 'fallback' | 'off'
const ENABLE_STAKEHOLDERS = (process.env.OPENAPI_ENABLE_STAKEHOLDERS || 'true').toLowerCase() !== 'false'
const ENABLE_PEC_PAID = (process.env.OPENAPI_ENABLE_PEC_PAID || 'true').toLowerCase() !== 'false'
const MIN_WALLET_EUR = Number(process.env.OPENAPI_MIN_WALLET_EUR || '2')
const CACHE_DAYS_ADVANCED = Number(process.env.OPENAPI_CACHE_DAYS_ADVANCED || '180')
const CACHE_DAYS_STAKEHOLDERS = Number(process.env.OPENAPI_CACHE_DAYS_STAKEHOLDERS || '180')
const CACHE_DAYS_PEC = Number(process.env.OPENAPI_CACHE_DAYS_PEC || '90')
const CACHE_DAYS_SEARCH = Number(process.env.OPENAPI_CACHE_DAYS_SEARCH || '30')

// Thresholds for /IT-stakeholders: only call it for SPA or SRL with revenue > €500k or >10 employees.
// Below these, /IT-advanced shareHolders already has titolare/soci.
const STAKEHOLDERS_MIN_REVENUE = Number(process.env.OPENAPI_STAKEHOLDERS_MIN_REVENUE || '500000')
const STAKEHOLDERS_MIN_EMPLOYEES = Number(process.env.OPENAPI_STAKEHOLDERS_MIN_EMPLOYEES || '10')
const SPA_REGEX = /\b(s\.?p\.?a\.?|spa|società per azioni|societa per azioni)\b/i

// ── TYPES ──────────────────────────────────────────────────────
export type OpenApiSource =
  | 'openapi_it_search'
  | 'openapi_it_advanced'
  | 'openapi_it_stakeholders'
  | 'openapi_it_pec'

export interface OpenApiResult<T = Record<string, unknown>> {
  success: boolean
  data: T | null
  source: OpenApiSource
  fromCache: boolean
  skipped?: 'no_token' | 'mode_off' | 'wallet_low' | 'disabled' | 'threshold_not_met'
  errorMessage?: string
  costEur?: number               // best-case subscription price; informational only
}

// ── CACHE LAYER ────────────────────────────────────────────────
async function readCache<T>(piva: string, source: OpenApiSource): Promise<T | null> {
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('company_lookup_cache')
      .select('payload,expires_at')
      .eq('piva', piva)
      .eq('source', source)
      .maybeSingle()
    if (error || !data) return null
    if (new Date(data.expires_at).getTime() < Date.now()) return null
    return data.payload as T
  } catch { return null }
}

async function writeCache(piva: string, source: OpenApiSource, payload: unknown, ttlDays: number, ragioneSociale?: string): Promise<void> {
  try {
    const sb = createServiceRoleClient()
    const fetched = new Date()
    const expires = new Date(fetched.getTime() + ttlDays * 24 * 60 * 60 * 1000)
    await sb.from('company_lookup_cache').upsert({
      piva,
      source,
      payload,
      ragione_sociale: ragioneSociale || null,
      fetched_at: fetched.toISOString(),
      expires_at: expires.toISOString(),
    }, { onConflict: 'piva,source' })
  } catch { /* cache write failure is non-fatal */ }
}

// ── WALLET GUARD ───────────────────────────────────────────────
// We cache the wallet balance for 60 seconds to avoid hammering the API.
let walletCache: { balanceEur: number; checkedAt: number } | null = null
const WALLET_TTL_MS = 60_000

async function getWalletBalance(): Promise<number | null> {
  if (!OPENAPI_IT_TOKEN) return null
  const now = Date.now()
  if (walletCache && now - walletCache.checkedAt < WALLET_TTL_MS) {
    return walletCache.balanceEur
  }
  try {
    const res = await fetch('https://account.openapi.com/wallet/balance', {
      headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const json: any = await res.json()
    // OpenAPI returns { data: { balance: number } } or similar; be defensive
    const bal = Number(json?.data?.balance ?? json?.balance ?? json?.data?.wallet ?? NaN)
    if (!Number.isFinite(bal)) return null
    walletCache = { balanceEur: bal, checkedAt: now }
    return bal
  } catch { return null }
}

/** True when the wallet has enough balance. Fail-CLOSED: if we can't check, BLOCK the call. */
async function walletAllows(minEur: number): Promise<boolean> {
  if (minEur <= 0) return true // minEur=0 means "always allow" (free tier mode)
  const bal = await getWalletBalance()
  if (bal === null) {
    console.log(`[OPENAPI] walletAllows: BLOCKED — cannot check wallet balance (API error), minEur=${minEur}`)
    return false // ★ fail-CLOSED: don't burn calls when we can't verify balance
  }
  const allowed = bal >= minEur
  if (!allowed) console.log(`[OPENAPI] walletAllows: BLOCKED — balance €${bal.toFixed(2)} < min €${minEur}`)
  return allowed
}

// ── HELPERS ────────────────────────────────────────────────────
function cleanPiva(p: string): string {
  return String(p || '').replace(/^IT/i, '').replace(/\s/g, '').trim()
}

function isEnabled(): boolean {
  return OPENAPI_MODE !== 'off' && Boolean(OPENAPI_IT_TOKEN)
}

// ── /IT-advanced ───────────────────────────────────────────────
export interface OpenApiAdvancedData {
  ragione_sociale?: string
  partita_iva?: string
  codice_fiscale?: string
  sede_legale?: string
  citta?: string
  provincia?: string
  cap?: string
  codice_ateco?: string
  descrizione_ateco?: string
  forma_giuridica?: string
  stato_attivita?: string
  codice_rea?: string
  pec?: string
  data_costituzione?: string
  capitale_sociale?: number
  fatturato?: number
  fatturato_anno?: number
  dipendenti?: number
  costo_personale?: number
  patrimonio_netto?: number
  totale_attivo?: number
  ral_medio?: number
  codice_sdi?: string
  telefono?: string
  sito_web?: string
  shareholders?: Array<{
    nome: string
    cognome: string
    taxCode?: string
    percentShare?: number
    isCompany?: boolean
  }>
}

function mapAdvancedResponse(json: any): OpenApiAdvancedData | null {
  // ★ Handle both array and object formats: { data: [company] } or { data: company }
  const rawData = json?.data
  const c = Array.isArray(rawData) ? rawData[0] : rawData
  if (!c || typeof c !== 'object') {
    console.log(`[OPENAPI] mapAdvancedResponse: NO company data. success=${json?.success}, error=${json?.error}, message=${json?.message}, dataType=${typeof rawData}, keys=${JSON.stringify(Object.keys(json || {}))}`)
    return null
  }
  console.log(`[OPENAPI] mapAdvancedResponse: company="${c.companyName}", vatCode=${c.vatCode}, status=${c.activityStatus}, hasBilancio=${!!c.balanceSheets?.last}, shareholders=${(c.shareHolders || c.shareholders || []).length}`)
  const office = c.address?.registeredOffice || c.registeredOffice || {}
  const ateco = c.atecoClassification?.ateco2007 || {}
  const bs = c.balanceSheets?.last || {}
  const rawShareholders = (c.shareHolders || c.shareholders || []) as any[]
  const shareholders = rawShareholders
    .map(sh => ({
      nome: String(sh?.name || '').trim(),
      cognome: String(sh?.surname || '').trim(),
      taxCode: sh?.taxCode || sh?.cf || undefined,
      percentShare: typeof sh?.percentShare === 'number' ? sh.percentShare : undefined,
      isCompany: !sh?.name || !sh?.surname,
    }))
    .filter(s => s.nome || s.cognome || s.taxCode)
  return {
    ragione_sociale: c.companyName || c.name || undefined,
    partita_iva: c.vatCode || c.taxCode || undefined,
    codice_fiscale: c.taxCode || undefined,
    sede_legale: [office.streetName, office.zipCode, office.town, office.province]
      .filter(Boolean).join(', ') || undefined,
    citta: office.town || undefined,
    provincia: office.province || undefined,
    cap: office.zipCode || undefined,
    codice_ateco: ateco.code || c.atecoCode || undefined,
    descrizione_ateco: ateco.description || c.atecoDescription || undefined,
    forma_giuridica: c.detailedLegalForm?.description || c.legalForm || undefined,
    stato_attivita: c.activityStatus || c.status || undefined,
    codice_rea: c.reaCode && c.cciaa ? `${c.cciaa} ${c.reaCode}` : (c.reaCode || undefined),
    pec: c.pec || c.certifiedEmail || undefined,
    telefono: c.contacts?.phone || c.phone || undefined,
    sito_web: c.contacts?.website || c.website || undefined,
    data_costituzione: c.startDate ? String(c.startDate).split('T')[0] : (c.incorporationDate ? String(c.incorporationDate).split('T')[0] : undefined),
    capitale_sociale: typeof (bs.shareCapital ?? c.shareCapital) === 'number' ? Number(bs.shareCapital ?? c.shareCapital) : undefined,
    fatturato: typeof bs.turnover === 'number' ? bs.turnover : (typeof bs.operatingRevenue === 'number' ? bs.operatingRevenue : (typeof c.revenue === 'number' ? c.revenue : undefined)),
    fatturato_anno: bs.year,
    dipendenti: typeof bs.employees === 'number' ? bs.employees : (typeof c.employeesNumber === 'number' ? c.employeesNumber : undefined),
    costo_personale: typeof bs.totalStaffCost === 'number' ? bs.totalStaffCost : undefined,
    patrimonio_netto: typeof bs.netWorth === 'number' ? bs.netWorth : undefined,
    totale_attivo: typeof bs.totalAssets === 'number' ? bs.totalAssets : undefined,
    ral_medio: typeof bs.avgGrossSalary === 'number' ? Math.round(bs.avgGrossSalary) : undefined,
    codice_sdi: c.sdiCode || undefined,
    shareholders: shareholders.length ? shareholders : undefined,
  }
}

export async function getItAdvanced(piva: string): Promise<OpenApiResult<OpenApiAdvancedData>> {
  const src: OpenApiSource = 'openapi_it_advanced'
  if (!isEnabled()) return { success: false, data: null, source: src, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'invalid piva' }

  // 1) Cache first
  const cached = await readCache<OpenApiAdvancedData>(clean, src)
  if (cached) return { success: true, data: cached, source: src, fromCache: true, costEur: 0 }

  // 2) Wallet guard
  if (!(await walletAllows(MIN_WALLET_EUR))) {
    return { success: false, data: null, source: src, fromCache: false, skipped: 'wallet_low' }
  }

  // 3) Call API
  try {
    const res = await fetch(`https://company.openapi.com/IT-advanced/${clean}`, {
      headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.log(`[OPENAPI] IT-advanced HTTP ${res.status} for ${clean}: ${errBody.slice(0, 200)}`)
      return { success: false, data: null, source: src, fromCache: false, errorMessage: `HTTP ${res.status}` }
    }
    const json = await res.json()
    console.log(`[OPENAPI] IT-advanced RAW response keys for ${clean}: ${JSON.stringify(Object.keys(json || {}))}`)
    const mapped = mapAdvancedResponse(json)
    if (!mapped) {
      console.log(`[OPENAPI] IT-advanced EMPTY mapping for ${clean} — raw snippet: ${JSON.stringify(json).slice(0, 300)}`)
      return { success: false, data: null, source: src, fromCache: false, errorMessage: 'empty response' }
    }
    // 4) Cache
    await writeCache(clean, src, mapped, CACHE_DAYS_ADVANCED, mapped.ragione_sociale)
    return { success: true, data: mapped, source: src, fromCache: false, costEur: 0.10 }
  } catch (e: any) {
    return { success: false, data: null, source: src, fromCache: false, errorMessage: e?.message || 'network error' }
  }
}

// ── /IT-stakeholders ───────────────────────────────────────────
export interface OpenApiManager {
  nome: string
  cognome: string
  nomeCompleto: string
  taxCode?: string
  dataNascita?: string
  sesso?: 'M' | 'F'
  eta?: number
  ruolo?: string
  ruoloOriginale?: string
  isLegalRep: boolean
}

const ROLE_MAP_EN_IT: Record<string, string> = {
  'Managing director': 'Amministratore Unico',
  'Sole owner': 'Socio Unico',
  'Chairman of the board of directors': 'Presidente CdA',
  'Director': 'Consigliere',
  'Special representative/agent': 'Procuratore Speciale',
  'General manager': 'Direttore Generale',
  'Auditor': 'Sindaco',
  'Chairman of the board of auditors': 'Presidente Collegio Sindacale',
  'Liquidator': 'Liquidatore',
  'Holder': 'Titolare',
}

function mapStakeholdersResponse(json: any): OpenApiManager[] {
  const rawData = json?.data
  const d = Array.isArray(rawData) ? rawData[0] : rawData
  const managers = (d?.managers || []) as any[]
  console.log(`[OPENAPI] mapStakeholdersResponse: ${managers.length} managers found, dataType=${typeof rawData}, isArray=${Array.isArray(rawData)}`)
  const out: OpenApiManager[] = []
  for (const m of managers) {
    if (!m?.name || !m?.surname) continue
    const nome = String(m.name).charAt(0).toUpperCase() + String(m.name).slice(1).toLowerCase()
    const cognome = String(m.surname).charAt(0).toUpperCase() + String(m.surname).slice(1).toLowerCase()
    const ruoloOriginale = m.roles?.[0]?.role?.description || 'Dirigente'
    const ruolo = ROLE_MAP_EN_IT[ruoloOriginale] || ruoloOriginale
    out.push({
      nome, cognome,
      nomeCompleto: `${nome} ${cognome}`,
      taxCode: m.taxCode || undefined,
      dataNascita: m.birthDate ? String(m.birthDate).split('T')[0] : undefined,
      sesso: m.gender?.code === 'M' ? 'M' : m.gender?.code === 'F' ? 'F' : undefined,
      eta: typeof m.age === 'number' ? m.age : undefined,
      ruolo, ruoloOriginale,
      isLegalRep: Boolean(m.isLegalRepresentative),
    })
  }
  return out
}

/** Decide whether calling /IT-stakeholders is worth it.
 *  With 44k+ free tier, we call it ALWAYS (regardless of company size or IT-advanced result). */
export function shouldCallStakeholders(adv: OpenApiAdvancedData | null): boolean {
  if (!ENABLE_STAKEHOLDERS) return false
  // ★ With huge free tier (44k), always call — titolare is critical data
  if (STAKEHOLDERS_MIN_REVENUE <= 0 && STAKEHOLDERS_MIN_EMPLOYEES <= 0) return true
  if (!adv) return false
  if (adv.forma_giuridica && SPA_REGEX.test(adv.forma_giuridica)) return true
  if (typeof adv.fatturato === 'number' && adv.fatturato >= STAKEHOLDERS_MIN_REVENUE) return true
  if (typeof adv.dipendenti === 'number' && adv.dipendenti >= STAKEHOLDERS_MIN_EMPLOYEES) return true
  return false
}

export async function getItStakeholders(piva: string): Promise<OpenApiResult<OpenApiManager[]>> {
  const src: OpenApiSource = 'openapi_it_stakeholders'
  if (!isEnabled()) return { success: false, data: null, source: src, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  if (!ENABLE_STAKEHOLDERS) return { success: false, data: null, source: src, fromCache: false, skipped: 'disabled' }
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'invalid piva' }

  const cached = await readCache<OpenApiManager[]>(clean, src)
  if (cached) return { success: true, data: cached, source: src, fromCache: true, costEur: 0 }

  // Wallet guard — IT-stakeholders is NOT free (402 without funds)
  if (!(await walletAllows(MIN_WALLET_EUR))) {
    return { success: false, data: null, source: src, fromCache: false, skipped: 'wallet_low' }
  }

  try {
    const res = await fetch(`https://company.openapi.com/IT-stakeholders/${clean}`, {
      headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { success: false, data: null, source: src, fromCache: false, errorMessage: `HTTP ${res.status}` }
    const json = await res.json()
    const managers = mapStakeholdersResponse(json)
    await writeCache(clean, src, managers, CACHE_DAYS_STAKEHOLDERS)
    return { success: true, data: managers, source: src, fromCache: false, costEur: 0.10 }
  } catch (e: any) {
    return { success: false, data: null, source: src, fromCache: false, errorMessage: e?.message || 'network error' }
  }
}

// ── /IT-pec ────────────────────────────────────────────────────
export async function getItPec(piva: string): Promise<OpenApiResult<{ pec: string }>> {
  const src: OpenApiSource = 'openapi_it_pec'
  if (!isEnabled()) return { success: false, data: null, source: src, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  if (!ENABLE_PEC_PAID) return { success: false, data: null, source: src, fromCache: false, skipped: 'disabled' }
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'invalid piva' }

  const cached = await readCache<{ pec: string }>(clean, src)
  if (cached) return { success: true, data: cached, source: src, fromCache: true, costEur: 0 }

  if (!(await walletAllows(MIN_WALLET_EUR))) {
    return { success: false, data: null, source: src, fromCache: false, skipped: 'wallet_low' }
  }

  try {
    const res = await fetch(`https://company.openapi.com/IT-pec/${clean}`, {
      headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { success: false, data: null, source: src, fromCache: false, errorMessage: `HTTP ${res.status}` }
    const json: any = await res.json()
    const rec = json?.data?.[0] || {}
    const pec = (rec.pec || rec.certifiedEmail || '').toString().trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pec)) {
      return { success: false, data: null, source: src, fromCache: false, errorMessage: 'no pec in response' }
    }
    const payload = { pec }
    await writeCache(clean, src, payload, CACHE_DAYS_PEC)
    return { success: true, data: payload, source: src, fromCache: false, costEur: 0.03 }
  } catch (e: any) {
    return { success: false, data: null, source: src, fromCache: false, errorMessage: e?.message || 'network error' }
  }
}

// ── /IT-search ─────────────────────────────────────────────────
export interface OpenApiSearchHit {
  ragione_sociale: string
  partita_iva: string
  citta?: string
  provincia?: string
  indirizzo?: string
  forma_giuridica?: string
  pec?: string
  stato_attivita?: string
}

export async function searchByCompanyName(name: string): Promise<OpenApiResult<OpenApiSearchHit[]>> {
  const src: OpenApiSource = 'openapi_it_search'
  if (!isEnabled()) return { success: false, data: null, source: src, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  const q = String(name || '').trim()
  if (q.length < 3) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'query too short' }

  // Search uses 100/day free tier — we still cache the query because duplicate lookups are common
  const cacheKey = `q:${q.toLowerCase()}`
  const cached = await readCache<OpenApiSearchHit[]>(cacheKey, src)
  if (cached) return { success: true, data: cached, source: src, fromCache: true, costEur: 0 }

  try {
    const res = await fetch(`https://company.openapi.com/IT-search?companyName=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { success: false, data: null, source: src, fromCache: false, errorMessage: `HTTP ${res.status}` }
    const json = await res.json()
    const items = (json?.data || []) as any[]
    const hits: OpenApiSearchHit[] = items.map(it => ({
      ragione_sociale: String(it.companyName || it.name || ''),
      partita_iva: String(it.taxCode || it.vatCode || '').replace(/\D/g, ''),
      citta: (it.registeredOffice?.city || it.address?.registeredOffice?.town || undefined),
      provincia: (it.registeredOffice?.province || it.address?.registeredOffice?.province || undefined),
      indirizzo: (it.registeredOffice?.street || it.address?.registeredOffice?.streetName || undefined),
      forma_giuridica: it.legalForm || undefined,
      pec: it.certifiedEmail || undefined,
      stato_attivita: it.status || undefined,
    })).filter(h => h.partita_iva.length === 11)
    await writeCache(cacheKey, src, hits, CACHE_DAYS_SEARCH)
    return { success: true, data: hits, source: src, fromCache: false, costEur: 0.001 }
  } catch (e: any) {
    return { success: false, data: null, source: src, fromCache: false, errorMessage: e?.message || 'network error' }
  }
}

// ── Orchestrator: one-call enrichment ──────────────────────────
// Fetches /IT-advanced, then /IT-stakeholders only if the company profile justifies
// the extra €0.10 (SPA or revenue ≥ 500k or ≥10 employees). PEC is filled directly
// from /IT-advanced when present; /IT-pec is NOT called here — the caller must
// invoke getItPec() only after INIPEC scraping has failed.
export interface OpenApiEnrichedCompany extends OpenApiAdvancedData {
  managers?: OpenApiManager[]
  legal_representative?: OpenApiManager
  titolare_best?: {
    nome: string
    cognome: string
    nomeCompleto: string
    ruolo: string
    taxCode?: string
    dataNascita?: string
    sesso?: 'M' | 'F'
    eta?: number
    source: 'stakeholders' | 'shareholders'
  }
  cost_incurred_eur: number
  cached_hits: number
  live_calls: number
}

/**
 * Returns full enriched company record from OpenAPI.it.
 *
 * Cost budget per call (worst case, no cache):
 *   - /IT-advanced:     €0.10
 *   - /IT-stakeholders: €0.10 (conditional)
 *   - Total:            €0.10 typical, €0.20 for large companies
 *
 * Cache hits cost €0. The helper deduplicates a P.IVA lookup within 180 days.
 */
export async function enrichCompanyByPiva(piva: string): Promise<OpenApiEnrichedCompany | null> {
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return null
  let cost = 0
  let cached = 0
  let live = 0

  const adv = await getItAdvanced(clean)
  if (!adv.success || !adv.data) return null
  cost += adv.costEur || 0
  if (adv.fromCache) cached++; else live++

  const enriched: OpenApiEnrichedCompany = {
    ...adv.data,
    cost_incurred_eur: cost,
    cached_hits: cached,
    live_calls: live,
  }

  // Pick the best titolare candidate from shareHolders (1-shareholder company → "Socio Unico")
  const sh = adv.data.shareholders || []
  const firstPerson = sh.find(s => !s.isCompany && s.nome && s.cognome)
  if (firstPerson) {
    enriched.titolare_best = {
      nome: firstPerson.nome.charAt(0).toUpperCase() + firstPerson.nome.slice(1).toLowerCase(),
      cognome: firstPerson.cognome.charAt(0).toUpperCase() + firstPerson.cognome.slice(1).toLowerCase(),
      nomeCompleto: `${firstPerson.nome.charAt(0).toUpperCase()}${firstPerson.nome.slice(1).toLowerCase()} ${firstPerson.cognome.charAt(0).toUpperCase()}${firstPerson.cognome.slice(1).toLowerCase()}`,
      ruolo: sh.length === 1 ? 'Socio Unico' : 'Socio',
      taxCode: firstPerson.taxCode,
      source: 'shareholders',
    }
  }

  // Optionally call /IT-stakeholders for managers
  if (shouldCallStakeholders(adv.data)) {
    const stk = await getItStakeholders(clean)
    if (stk.success && stk.data) {
      cost += stk.costEur || 0
      if (stk.fromCache) cached++; else live++
      enriched.managers = stk.data
      enriched.legal_representative = stk.data.find(m => m.isLegalRep)
      // Override titolare_best with legal representative when available — it's more authoritative than a plain shareholder
      if (enriched.legal_representative) {
        enriched.titolare_best = {
          nome: enriched.legal_representative.nome,
          cognome: enriched.legal_representative.cognome,
          nomeCompleto: enriched.legal_representative.nomeCompleto,
          ruolo: enriched.legal_representative.ruolo || 'Legale Rappresentante',
          taxCode: enriched.legal_representative.taxCode,
          dataNascita: enriched.legal_representative.dataNascita,
          sesso: enriched.legal_representative.sesso,
          eta: enriched.legal_representative.eta,
          source: 'stakeholders',
        }
      }
    }
  }

  enriched.cost_incurred_eur = cost
  enriched.cached_hits = cached
  enriched.live_calls = live
  return enriched
}

// ── Runtime getters ────────────────────────────────────────────
export function isOpenApiPrimary(): boolean {
  return OPENAPI_MODE === 'primary' && Boolean(OPENAPI_IT_TOKEN)
}

export function isOpenApiEnabled(): boolean {
  return isEnabled()
}
