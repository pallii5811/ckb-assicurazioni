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
 *   - /IT-search       (free 100/day)     → discovery by name
 *   - /IT-start        (free 30/month)    → basic record: ragione sociale, sede, P.IVA, CF, forma giuridica
 *   - /IT-advanced     (free 30/month, then €0.10) → full record: bilancio, ATECO, soci, PEC, telefono…
 *   - /IT-pec          (€0.03, free 30/month)      → certified PEC fallback after INIPEC
 *
 * Disabled endpoints (paid, no free tier):
 *   - /IT-stakeholders — managers/CdA (€0.10–0.20)
 *   - /IT-marketing    — marketing contacts (€0.20)
 *
 * Strategy: IT-advanced as primary, IT-start as FREE fallback when wallet is low.
 * Max cost per lead: €0.10 (one IT-advanced call).
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
const CACHE_DAYS_START = Number(process.env.OPENAPI_CACHE_DAYS_START || '90')

const memoryCache = new Map<string, { payload: unknown; expiresAt: number }>()
const openApiInFlight = new Map<string, Promise<unknown>>()

async function withInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = openApiInFlight.get(key)
  if (existing) {
    console.log(`[OPENAPI] Reusing in-flight request: ${key}`)
    return existing as Promise<T>
  }
  const promise = fn().finally(() => openApiInFlight.delete(key))
  openApiInFlight.set(key, promise as Promise<unknown>)
  return promise
}

// Thresholds for /IT-stakeholders. Defaults to 0 (always call) because OpenAPI free tier covers
// 44k+ stakeholders calls/month and titolare is critical data. Override via env vars if needed.
const STAKEHOLDERS_MIN_REVENUE = Number(process.env.OPENAPI_STAKEHOLDERS_MIN_REVENUE || '0')
const STAKEHOLDERS_MIN_EMPLOYEES = Number(process.env.OPENAPI_STAKEHOLDERS_MIN_EMPLOYEES || '0')
const SPA_REGEX = /\b(s\.?p\.?a\.?|spa|società per azioni|societa per azioni)\b/i

// ── TYPES ──────────────────────────────────────────────────────
export type OpenApiSource =
  | 'openapi_it_search'
  | 'openapi_it_start'
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
  const key = `${source}:${piva}`
  const memoryHit = memoryCache.get(key)
  if (memoryHit && memoryHit.expiresAt > Date.now()) return memoryHit.payload as T
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
    memoryCache.set(key, { payload: data.payload, expiresAt: new Date(data.expires_at).getTime() })
    return data.payload as T
  } catch (e: any) {
    console.log(`[OPENAPI] Cache read failed for ${key}: ${e?.message || e}`)
    return null
  }
}

async function writeCache(piva: string, source: OpenApiSource, payload: unknown, ttlDays: number, ragioneSociale?: string): Promise<void> {
  const key = `${source}:${piva}`
  try {
    const sb = createServiceRoleClient()
    const fetched = new Date()
    const expires = new Date(fetched.getTime() + ttlDays * 24 * 60 * 60 * 1000)
    memoryCache.set(key, { payload, expiresAt: expires.getTime() })
    await sb.from('company_lookup_cache').upsert({
      piva,
      source,
      payload,
      ragione_sociale: ragioneSociale || null,
      fetched_at: fetched.toISOString(),
      expires_at: expires.toISOString(),
    }, { onConflict: 'piva,source' })
  } catch (e: any) {
    console.log(`[OPENAPI] Cache write failed for ${key}: ${e?.message || e}`)
  }
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
    if (!res.ok) {
      console.log(`[OPENAPI] getWalletBalance: HTTP ${res.status} ${res.statusText}`)
      return null
    }
    const json: any = await res.json()
    console.log(`[OPENAPI] getWalletBalance: raw response keys=${JSON.stringify(Object.keys(json || {}))}`)
    // OpenAPI returns { data: { balance: number } } or similar; be defensive
    const bal = Number(json?.data?.balance ?? json?.balance ?? json?.data?.wallet ?? json?.data?.credit ?? NaN)
    if (!Number.isFinite(bal)) {
      console.log(`[OPENAPI] getWalletBalance: could not parse balance from response: ${JSON.stringify(json).slice(0, 300)}`)
      return null
    }
    console.log(`[OPENAPI] getWalletBalance: €${bal.toFixed(2)}`)
    walletCache = { balanceEur: bal, checkedAt: now }
    return bal
  } catch { return null }
}

/** True when the wallet has enough balance. Fail-OPEN: if we can't check, ALLOW the call.
 *  Rationale: blocking on API errors means paid features silently stop working.
 *  The OpenAPI endpoints themselves return 402 when balance is truly insufficient. */
async function walletAllows(minEur: number): Promise<boolean> {
  if (minEur <= 0) return true // minEur=0 means "always allow" (free tier mode)
  const bal = await getWalletBalance()
  if (bal === null) {
    console.log(`[OPENAPI] walletAllows: ALLOWED (fail-open) — cannot check wallet balance (API error), minEur=${minEur}`)
    return true // ★ fail-OPEN: OpenAPI returns 402 if truly out of funds
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
  // Indirizzo completo
  sede_legale?: string
  indirizzo_via?: string
  indirizzo_numero_civico?: string
  citta?: string
  provincia?: string
  cap?: string
  frazione?: string
  codice_catastale?: string
  regione?: string
  gps_lat?: number
  gps_lng?: number
  // Stato
  stato_attivita?: string
  stato_agenzia_entrate?: { cessata?: boolean; timestamp?: number }
  // ATECO (corrente + storico)
  codice_ateco?: string
  descrizione_ateco?: string
  ateco_2022?: { code?: string; description?: string }
  ateco_2007?: { code?: string; description?: string }
  // Forma giuridica
  forma_giuridica?: string
  forma_giuridica_codice?: string
  // Registrazione e date
  codice_rea?: string
  cciaa?: string
  pec?: string
  data_registrazione?: string
  data_costituzione?: string
  data_cessazione?: string
  // SDI
  codice_sdi?: string
  codice_sdi_timestamp?: number
  // Capitale e bilancio
  capitale_sociale?: number
  fatturato?: number
  fatturato_anno?: number
  dipendenti?: number
  costo_personale?: number
  patrimonio_netto?: number
  utile_netto?: number
  totale_attivo?: number
  ral_medio?: number
  // Storico bilanci (fino a 7 anni)
  storico_bilanci?: Array<{
    anno: number
    fatturato?: number
    utile?: number
    dipendenti?: number
    capitale_sociale?: number
    costo_personale?: number
    patrimonio_netto?: number
    totale_attivo?: number
  }>
  // Gruppo IVA
  gruppo_iva?: { partecipazione?: boolean; leader?: boolean }
  // Contatti
  telefono?: string
  sito_web?: string
  // Azionisti
  shareholders?: Array<{
    nome: string
    cognome: string
    ragione_sociale_socio?: string
    taxCode?: string
    percentShare?: number
    isCompany?: boolean
  }>
  // Metadata
  openapi_id?: string
  timestamp_creazione?: number
  timestamp_aggiornamento?: number
}

function hasMeaningfulAdvancedData(data: OpenApiAdvancedData | null | undefined): boolean {
  return Boolean(
    data?.ragione_sociale ||
    data?.sede_legale ||
    data?.codice_ateco ||
    data?.descrizione_ateco ||
    data?.forma_giuridica ||
    data?.stato_attivita ||
    data?.codice_rea ||
    data?.pec ||
    typeof data?.fatturato === 'number' ||
    typeof data?.dipendenti === 'number' ||
    data?.shareholders?.length ||
    data?.storico_bilanci?.length
  )
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
  const atecoClass = c.atecoClassification || {}
  const ateco = atecoClass.ateco2007 || atecoClass.ateco || {}
  const bs = c.balanceSheets?.last || {}
  const allBs = (c.balanceSheets?.all || []) as any[]
  const rawShareholders = (c.shareHolders || c.shareholders || []) as any[]
  const hasMeaningfulRawData = Boolean(
    c.companyName ||
    c.name ||
    office.streetName ||
    office.town ||
    office.province ||
    ateco.code ||
    ateco.description ||
    c.atecoCode ||
    c.atecoDescription ||
    c.detailedLegalForm?.description ||
    c.legalForm ||
    c.activityStatus ||
    c.status ||
    c.reaCode ||
    c.cciaa ||
    c.pec ||
    c.certifiedEmail ||
    c.startDate ||
    c.incorporationDate ||
    Object.keys(bs).length > 0 ||
    allBs.length > 0 ||
    rawShareholders.length > 0
  )
  if (!hasMeaningfulRawData) {
    console.log(`[OPENAPI] mapAdvancedResponse: EMPTY company profile for vatCode=${c.vatCode || c.taxCode || 'n/a'} — ignoring IT-advanced result`)
    return null
  }
  // Diagnostic: log balance sheet keys once so we can verify which OpenAPI field names exist
  // (helps spot e.g. profit vs netProfit vs netIncome — without this we can only guess).
  if (bs && Object.keys(bs).length > 0) {
    console.log(`[OPENAPI] balanceSheet.last keys: ${Object.keys(bs).join(',')}`)
  }
  if (allBs[0] && Object.keys(allBs[0]).length > 0) {
    console.log(`[OPENAPI] balanceSheet.all[0] keys: ${Object.keys(allBs[0]).join(',')}`)
    if (allBs[0].annualResult) {
      console.log(`[OPENAPI] balanceSheet.all[0].annualResult: ${JSON.stringify(allBs[0].annualResult).slice(0, 500)}`)
    }
  }
  const shareholders = rawShareholders
    .map(sh => ({
      nome: String(sh?.name || '').trim(),
      cognome: String(sh?.surname || '').trim(),
      ragione_sociale_socio: sh?.companyName || undefined,
      taxCode: sh?.taxCode || sh?.cf || undefined,
      percentShare: typeof sh?.percentShare === 'number' ? sh.percentShare
        : (typeof sh?.percentShare === 'string' ? parseFloat(sh.percentShare) : undefined),
      isCompany: Boolean(sh?.companyName) || (!sh?.name && !sh?.surname),
    }))
    .filter(s => s.nome || s.cognome || s.taxCode || s.ragione_sociale_socio)

  // Storico bilanci (fino a 7 anni). The OpenAPI raw object exposes summary fields at the top level
  // of each balance sheet entry. Field names by data type (in order of likelihood):
  //   - utile / netto (annualResult): profit | netProfit | netIncome | profitOrLoss | netResult
  //   - patrimonio netto (Net Worth):  netWorth (DIFFERENT field — do NOT alias to utile)
  // We try multiple candidates and fall back to undefined if none match.
  const toNumber = (v: any): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v !== 'string') return undefined
    const s = v.trim()
    if (!/^-?[\d.,\s]+$/.test(s)) return undefined
    const normalized = s.includes(',')
      ? s.replace(/\./g, '').replace(',', '.').replace(/\s/g, '')
      : s.replace(/,/g, '').replace(/\s/g, '')
    const n = Number(normalized)
    return Number.isFinite(n) ? n : undefined
  }
  const firstNestedNumber = (v: any): number | undefined => {
    const direct = toNumber(v)
    if (direct !== undefined) return direct
    if (Array.isArray(v)) {
      for (const item of v) {
        const n = firstNestedNumber(item)
        if (n !== undefined) return n
      }
      return undefined
    }
    if (v && typeof v === 'object') {
      const priorityKeys = ['value', 'amount', 'valore', 'current', 'currentYear', 'total', 'result', 'items', 'values', 'rows', 'data', 'children']
      for (const key of priorityKeys) {
        const n = firstNestedNumber(v[key])
        if (n !== undefined) return n
      }
      for (const [key, value] of Object.entries(v)) {
        if (!/(result|utile|profit|income|loss|amount|value|valore|netto)/i.test(key)) continue
        const n = firstNestedNumber(value)
        if (n !== undefined) return n
      }
    }
    return undefined
  }
  const pickProfit = (b: any): number | undefined => {
    const directKeys = ['profit', 'netProfit', 'netIncome', 'profitOrLoss', 'netResult', 'utileNetto', 'risultatoEsercizio', 'profitLossForYear']
    for (const key of directKeys) {
      const n = toNumber(b?.[key])
      if (n !== undefined) return n
    }
    const nested = b?.annualResult || b?.annualResults || b?.profitAndLoss?.annualResult || b?.incomeStatement?.annualResult || b?.contoEconomico?.annualResult
    const nestedValue = firstNestedNumber(nested)
    if (nestedValue !== undefined) return nestedValue
    return undefined
  }
  const storicoBilanci = allBs
    .filter((b: any) => b && typeof b.year === 'number')
    .map((b: any) => ({
      anno: b.year,
      fatturato: typeof b.turnover === 'number' ? b.turnover : undefined,
      utile: pickProfit(b),
      dipendenti: typeof b.employees === 'number' ? b.employees : undefined,
      capitale_sociale: typeof b.shareCapital === 'number' ? b.shareCapital : undefined,
      costo_personale: typeof b.totalStaffCost === 'number' ? b.totalStaffCost : undefined,
      patrimonio_netto: typeof b.netWorth === 'number' ? b.netWorth : undefined,
      totale_attivo: typeof b.totalAssets === 'number' ? b.totalAssets : undefined,
    }))
    .sort((a: any, b: any) => b.anno - a.anno)
  // Helper: pick the most recent year where the given field has a valid number
  const latestFromStorico = <K extends keyof (typeof storicoBilanci)[number]>(field: K): number | undefined => {
    for (const y of storicoBilanci) {
      const v = (y as any)[field]
      if (typeof v === 'number') return v
    }
    return undefined
  }

  return {
    ragione_sociale: c.companyName || c.name || undefined,
    partita_iva: c.vatCode || c.taxCode || undefined,
    codice_fiscale: c.taxCode || undefined,
    // Indirizzo completo
    sede_legale: [office.streetName, office.zipCode, office.town, office.province]
      .filter(Boolean).join(', ') || undefined,
    indirizzo_via: office.streetName || [office.toponym, office.street, office.streetNumber].filter(Boolean).join(' ') || undefined,
    indirizzo_numero_civico: office.streetNumber || undefined,
    citta: office.town || undefined,
    provincia: office.province || undefined,
    cap: office.zipCode || undefined,
    frazione: office.hamlet || undefined,
    codice_catastale: office.townCode || undefined,
    regione: office.region?.description || undefined,
    gps_lat: office.gps?.coordinates?.[1] ?? undefined,
    gps_lng: office.gps?.coordinates?.[0] ?? undefined,
    // Stato
    stato_attivita: c.activityStatus || c.status || undefined,
    stato_agenzia_entrate: c.taxCodeCeased !== undefined ? {
      cessata: Boolean(c.cessata),
      timestamp: c.taxCodeCeasedTimestamp || undefined,
    } : undefined,
    // ATECO
    codice_ateco: ateco.code || c.atecoCode || undefined,
    descrizione_ateco: ateco.description || c.atecoDescription || undefined,
    ateco_2022: atecoClass.ateco2022?.code ? { code: atecoClass.ateco2022.code, description: atecoClass.ateco2022.description } : undefined,
    ateco_2007: atecoClass.ateco2007?.code ? { code: atecoClass.ateco2007.code, description: atecoClass.ateco2007.description } : undefined,
    // Forma giuridica
    forma_giuridica: c.detailedLegalForm?.description || c.legalForm || undefined,
    forma_giuridica_codice: c.detailedLegalForm?.code || undefined,
    // Registrazione
    codice_rea: c.reaCode && c.cciaa ? `${c.cciaa} ${c.reaCode}` : (c.reaCode || undefined),
    cciaa: c.cciaa || undefined,
    pec: c.pec || c.certifiedEmail || undefined,
    data_registrazione: c.registrationDate ? String(c.registrationDate).split('T')[0] : undefined,
    data_costituzione: c.startDate ? String(c.startDate).split('T')[0] : (c.incorporationDate ? String(c.incorporationDate).split('T')[0] : undefined),
    data_cessazione: c.endDate ? String(c.endDate).split('T')[0] : undefined,
    // SDI
    codice_sdi: c.sdiCode || undefined,
    codice_sdi_timestamp: c.sdiCodeTimestamp || undefined,
    // Bilancio ultimo anno (with fallback to most recent storico_bilanci entry when bs.last is empty —
    // common for newly constituted SRLS that haven't yet filed the first full balance).
    capitale_sociale: typeof (bs.shareCapital ?? c.shareCapital) === 'number' ? Number(bs.shareCapital ?? c.shareCapital) : latestFromStorico('capitale_sociale'),
    fatturato: typeof bs.turnover === 'number' ? bs.turnover : (typeof bs.operatingRevenue === 'number' ? bs.operatingRevenue : (typeof c.revenue === 'number' ? c.revenue : latestFromStorico('fatturato'))),
    fatturato_anno: bs.year ?? storicoBilanci.find(y => typeof y.fatturato === 'number')?.anno,
    dipendenti: typeof bs.employees === 'number' ? bs.employees : (typeof c.employeesNumber === 'number' ? c.employeesNumber : latestFromStorico('dipendenti')),
    costo_personale: typeof bs.totalStaffCost === 'number' ? bs.totalStaffCost : latestFromStorico('costo_personale'),
    patrimonio_netto: typeof bs.netWorth === 'number' ? bs.netWorth : latestFromStorico('patrimonio_netto'),
    totale_attivo: typeof bs.totalAssets === 'number' ? bs.totalAssets : latestFromStorico('totale_attivo'),
    utile_netto: pickProfit(bs) ?? latestFromStorico('utile'),
    ral_medio: typeof bs.avgGrossSalary === 'number' ? Math.round(bs.avgGrossSalary) : undefined,
    // Storico bilanci
    storico_bilanci: storicoBilanci.length > 0 ? storicoBilanci : undefined,
    // Gruppo IVA
    gruppo_iva: c.gruppo_iva ? {
      partecipazione: c.gruppo_iva.vatGroupParticipation ?? false,
      leader: c.gruppo_iva.isVatGroupLeader ?? false,
    } : undefined,
    // Contatti
    telefono: c.contacts?.phone || c.phone || undefined,
    sito_web: c.contacts?.website || c.website || undefined,
    // Azionisti
    shareholders: shareholders.length ? shareholders : undefined,
    // Metadata
    openapi_id: c.id || undefined,
    timestamp_creazione: c.creationTimestamp || undefined,
    timestamp_aggiornamento: c.lastUpdateTimestamp || undefined,
  }
}

export async function getItAdvanced(piva: string): Promise<OpenApiResult<OpenApiAdvancedData>> {
  const src: OpenApiSource = 'openapi_it_advanced'
  if (!isEnabled()) return { success: false, data: null, source: src, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'invalid piva' }

  // 1) Cache first
  const cached = await readCache<OpenApiAdvancedData>(clean, src)
  if (cached && hasMeaningfulAdvancedData(cached)) return { success: true, data: cached, source: src, fromCache: true, costEur: 0 }

  return withInFlight(`${src}:${clean}`, async () => {
    const cachedAgain = await readCache<OpenApiAdvancedData>(clean, src)
    if (cachedAgain && hasMeaningfulAdvancedData(cachedAgain)) return { success: true, data: cachedAgain, source: src, fromCache: true, costEur: 0 }

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
  })
}

// ── /IT-start (FREE fallback, 30/month) ─────────────────────────
export interface OpenApiStartData {
  ragione_sociale?: string
  partita_iva?: string
  codice_fiscale?: string
  sede_legale?: string
  citta?: string
  provincia?: string
  cap?: string
  forma_giuridica?: string
  stato_attivita?: string
  pec?: string
}

function mapStartResponse(json: any): OpenApiStartData | null {
  const rawData = json?.data
  const c = Array.isArray(rawData) ? rawData[0] : rawData
  if (!c || typeof c !== 'object') {
    console.log(`[OPENAPI] mapStartResponse: NO data. success=${json?.success}, error=${json?.error}`)
    return null
  }
  const office = c.address?.registeredOffice || c.registeredOffice || {}
  console.log(`[OPENAPI] mapStartResponse: company="${c.companyName}", vatCode=${c.vatCode}, status=${c.activityStatus}`)
  return {
    ragione_sociale: c.companyName || c.name || undefined,
    partita_iva: c.vatCode || c.taxCode || undefined,
    codice_fiscale: c.taxCode || undefined,
    sede_legale: [office.streetName, office.zipCode, office.town, office.province]
      .filter(Boolean).join(', ') || undefined,
    citta: office.town || undefined,
    provincia: office.province || undefined,
    cap: office.zipCode || undefined,
    forma_giuridica: c.detailedLegalForm?.description || c.legalForm || undefined,
    stato_attivita: c.activityStatus || c.status || undefined,
    pec: c.pec || c.certifiedEmail || undefined,
  }
}

export async function getItStart(piva: string): Promise<OpenApiResult<OpenApiStartData>> {
  const src: OpenApiSource = 'openapi_it_start'
  if (!isEnabled()) return { success: false, data: null, source: src, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'invalid piva' }

  const cached = await readCache<OpenApiStartData>(clean, src)
  if (cached) return { success: true, data: cached, source: src, fromCache: true, costEur: 0 }

  return withInFlight(`${src}:${clean}`, async () => {
    const cachedAgain = await readCache<OpenApiStartData>(clean, src)
    if (cachedAgain) return { success: true, data: cachedAgain, source: src, fromCache: true, costEur: 0 }

    // NO wallet guard — IT-start is FREE (30/month)
    try {
      const res = await fetch(`https://company.openapi.com/IT-start/${clean}`, {
        headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.log(`[OPENAPI] IT-start HTTP ${res.status} for ${clean}: ${errBody.slice(0, 200)}`)
        return { success: false, data: null, source: src, fromCache: false, errorMessage: `HTTP ${res.status}` }
      }
      const json = await res.json()
      const mapped = mapStartResponse(json)
      if (!mapped) return { success: false, data: null, source: src, fromCache: false, errorMessage: 'empty response' }
      await writeCache(clean, src, mapped, CACHE_DAYS_START, mapped.ragione_sociale)
      return { success: true, data: mapped, source: src, fromCache: false, costEur: 0 }
    } catch (e: any) {
      return { success: false, data: null, source: src, fromCache: false, errorMessage: e?.message || 'network error' }
    }
  })
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

  return withInFlight(`${src}:${clean}`, async () => {
    const cachedAgain = await readCache<OpenApiManager[]>(clean, src)
    if (cachedAgain) return { success: true, data: cachedAgain, source: src, fromCache: true, costEur: 0 }

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
  })
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

  return withInFlight(`${src}:${clean}`, async () => {
    const cachedAgain = await readCache<{ pec: string }>(clean, src)
    if (cachedAgain) return { success: true, data: cachedAgain, source: src, fromCache: true, costEur: 0 }

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
  })
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

  return withInFlight(`${src}:${cacheKey}`, async () => {
    const cachedAgain = await readCache<OpenApiSearchHit[]>(cacheKey, src)
    if (cachedAgain) return { success: true, data: cachedAgain, source: src, fromCache: true, costEur: 0 }

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
  })
}

// ── Orchestrator: one-call enrichment ──────────────────────────
// Strategy: IT-advanced (€0.10, 30 free/month) as primary.
// When wallet is low → IT-start (free, 30/month) as fallback for basic data.
// IT-stakeholders only if enabled AND wallet allows.
// /IT-pec is NOT called here — the caller must invoke getItPec() separately.
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
  from_start_fallback?: boolean
}

/**
 * Returns enriched company record from OpenAPI.it.
 *
 * Cost budget per call (worst case, no cache):
 *   - /IT-advanced:     €0.10 (30 free/month)
 *   - /IT-stakeholders: €0.10 (conditional, disabled by default)
 *   - /IT-start:        FREE (30/month) — fallback when wallet is low
 *   - Total:            €0.00–€0.10 per lead
 *
 * Cache hits cost €0. Deduplicates within TTL days.
 */
export async function enrichCompanyByPiva(piva: string): Promise<OpenApiEnrichedCompany | null> {
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return null
  let cost = 0
  let cached = 0
  let live = 0

  // 1) Try IT-advanced (full data, €0.10 or free tier)
  const adv = await getItAdvanced(clean)

  if (adv.success && adv.data) {
    // IT-advanced succeeded
    cost += adv.costEur || 0
    if (adv.fromCache) cached++; else live++

    const enriched: OpenApiEnrichedCompany = {
      ...adv.data,
      cost_incurred_eur: cost,
      cached_hits: cached,
      live_calls: live,
    }

    // Pick titolare from shareHolders
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

    // Optionally call /IT-stakeholders for managers (disabled by default)
    if (shouldCallStakeholders(adv.data)) {
      const stk = await getItStakeholders(clean)
      if (stk.success && stk.data) {
        cost += stk.costEur || 0
        if (stk.fromCache) cached++; else live++
        enriched.managers = stk.data
        enriched.legal_representative = stk.data.find(m => m.isLegalRep)
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

  // 2) IT-advanced failed (wallet_low, HTTP error, etc.) → fallback to IT-start (FREE)
  console.log(`[OPENAPI] IT-advanced failed for ${clean} (skipped=${adv.skipped}, err=${adv.errorMessage}), trying IT-start fallback...`)
  const start = await getItStart(clean)
  if (!start.success || !start.data) {
    console.log(`[OPENAPI] IT-start also failed for ${clean} (skipped=${start.skipped}, err=${start.errorMessage})`)
    return null
  }
  if (start.fromCache) cached++; else live++

  // Convert StartData to EnrichedCompany (basic fields only)
  const fallback: OpenApiEnrichedCompany = {
    ragione_sociale: start.data.ragione_sociale,
    partita_iva: start.data.partita_iva,
    codice_fiscale: start.data.codice_fiscale,
    sede_legale: start.data.sede_legale,
    citta: start.data.citta,
    provincia: start.data.provincia,
    cap: start.data.cap,
    forma_giuridica: start.data.forma_giuridica,
    stato_attivita: start.data.stato_attivita,
    pec: start.data.pec,
    cost_incurred_eur: 0,
    cached_hits: cached,
    live_calls: live,
    from_start_fallback: true,
  }
  console.log(`[OPENAPI] IT-start fallback OK for ${clean}: ${fallback.ragione_sociale}`)
  return fallback
}

// ── Runtime getters ────────────────────────────────────────────
export function isOpenApiPrimary(): boolean {
  return OPENAPI_MODE === 'primary' && Boolean(OPENAPI_IT_TOKEN)
}

export function isOpenApiEnabled(): boolean {
  return isEnabled()
}
