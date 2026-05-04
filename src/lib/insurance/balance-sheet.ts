/**
 * Balance Sheet Fetcher — SOLO FONTI GRATUITE
 *
 * Estrae voci di bilancio depositato in Camera di Commercio usando ESCLUSIVAMENTE
 * fonti gratuite già integrate nel sistema:
 *
 *   1. /api/lead-registry         (CompanyReports + FatturatoItalia + ufficiocamerale + Tavily)
 *   2. Tavily search dedicata     (cerca voci specifiche del Conto Economico)
 *   3. PDF bilancio depositato    (se pubblicato su trasparenza PA o siti aziendali)
 *
 * REGOLA D'ORO: nessun dato è "declared" se non è stato realmente estratto da
 * una fonte verificabile. Tutte le stime settoriali sono fatte SEPARATAMENTE in
 * `premium-extractor.ts` e sempre etichettate come "estimated".
 *
 * Nessuna chiamata a OpenAPI.it (a pagamento) in questo modulo.
 */

import type { BalanceSheetData, BalanceSheetYear } from './types'

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER — parsing numeri italiani
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parsa un numero italiano "1.234.567,89" o "1,234,567.89" o "€ 47.300"
 * in float JavaScript. Restituisce null se non è un numero valido.
 */
export function parseItalianNumber(input?: string | number | null): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  let s = String(input).trim()
  if (!s) return null
  // Rimuovi simboli valuta e spazi
  s = s.replace(/[€$£\s]/g, '').replace(/EUR/gi, '').replace(/euro/gi, '')
  // Formato italiano: punti = migliaia, virgola = decimali
  // Formato US: virgole = migliaia, punto = decimali
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // L'ultima virgola O punto è il separatore decimali
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    if (lastComma > lastDot) {
      // formato IT: "1.234.567,89"
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      // formato US: "1,234,567.89"
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    // Solo virgola: probabile decimale italiano "1234,89" o migliaia "1,234"
    // Se c'è un solo gruppo di 3 cifre dopo la virgola → migliaia
    // Se ci sono 1-2 cifre dopo la virgola → decimali
    const parts = s.split(',')
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      // ambiguo, assumi migliaia
      s = s.replace(',', '')
    } else {
      // decimali italiani
      s = s.replace(',', '.')
    }
  } else if (hasDot) {
    // Solo punto: probabile migliaia italiane "1.234.567" o decimali US "1234.89"
    const parts = s.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      // migliaia italiane
      s = s.replace(/\./g, '')
    }
    // altrimenti lascia il punto come decimale
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Estrae un valore monetario da un testo, cercando un pattern del tipo
 * "Costi per servizi: € 234.000" o "B.7 234000".
 */
function extractMonetary(
  text: string,
  patterns: RegExp[],
): number | null {
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const numStr = m[1] || m[0]
      const n = parseItalianNumber(numStr)
      if (n !== null && n > 0 && n < 1e12) return n
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
//  SANITY CHECK — anti-noise sui valori monetari di bilancio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soglie minime sotto cui un valore monetario è considerato "sporco"
 * (parsing errato di Tavily/AI: es. "3" estratto da "3.500.000").
 *
 * Razionale: nessuna azienda con dipendenti ha 3€ di immobilizzazioni materiali,
 * 50€ di costo del personale o 100€ di fatturato annuo.
 */
const MIN_MONETARY_THRESHOLD: Record<string, number> = {
  turnover: 1_000,                    // < 1k€ fatturato annuo = noise
  otherRevenues: 100,
  rawMaterials: 100,
  services: 100,
  thirdPartyGoods: 100,
  totalStaffCost: 5_000,              // < 5k€ costo personale = noise
  amortization: 100,
  amortizationTangible: 100,
  otherOperatingCosts: 100,
  financialCharges: 1,
  ebitda: 1,                          // EBITDA può essere 0 ma non frazionario
  netIncome: 1,                       // utile può essere 0/negativo, ma valori in centesimi sono noise
  shareCapital: 1_000,                // capitale sociale minimo legale ≥ 1k€
  totalAssets: 1_000,
  tangibleAssets: 1_000,              // ★ il bug visto nello screenshot: "3€" → scartato
  equity: 1,
  bankDebts: 100,
  insurancePremiumsDeclared: 100,     // < 100€/anno = sicuramente errato
}

/** Soglia massima ragionevole (anti-overflow su parsing errati di numeri enormi) */
const MAX_MONETARY_THRESHOLD = 1e11   // 100 miliardi €

/**
 * Mappa key tecnica → etichetta human-friendly italiana per i warning UX.
 * I nomi tecnici (tangibleAssets, bankDebts) NON devono apparire all'utente.
 */
const FIELD_LABELS_IT: Record<string, string> = {
  turnover: 'Fatturato',
  otherRevenues: 'Altri ricavi',
  rawMaterials: 'Costi materie prime',
  services: 'Costi servizi',
  thirdPartyGoods: 'Costi merci',
  totalStaffCost: 'Costo del personale',
  amortization: 'Ammortamenti',
  amortizationTangible: 'Ammortamenti immobilizzazioni',
  otherOperatingCosts: 'Oneri diversi gestione',
  financialCharges: 'Oneri finanziari',
  ebitda: 'EBITDA',
  netIncome: 'Utile netto',
  shareCapital: 'Capitale sociale',
  totalAssets: 'Totale attivo',
  tangibleAssets: 'Immobilizzazioni materiali',
  equity: 'Patrimonio netto',
  bankDebts: 'Debiti verso banche',
  insurancePremiumsDeclared: 'Premi assicurativi dichiarati',
}

/**
 * Pulisce un BalanceSheetYear rimuovendo valori palesemente sporchi.
 *
 * Per ogni campo monetario, se il valore è sotto la soglia minima o sopra
 * quella massima → viene rimosso (set a undefined) con warning.
 *
 * I warning generati qui sono SOLO TECNICI (parsing): vengono restituiti
 * separatamente perché NON devono finire nel banner utente con il key tecnico
 * (tangibleAssets, ecc.). Vedi `aggregateParsingWarnings()` per il riassunto
 * human-friendly.
 *
 * Per `employees` accettiamo 1-1.000.000.
 *
 * Restituisce { sanitized, warnings } dove warnings sono note sui campi droppati.
 */
export function sanitizeBalanceYear(
  year: BalanceSheetYear,
): { sanitized: BalanceSheetYear; warnings: string[] } {
  const warnings: string[] = []
  const out: BalanceSheetYear = { year: year.year }

  for (const [key, value] of Object.entries(year)) {
    if (key === 'year') continue
    if (value === undefined || value === null) continue

    if (key === 'employees') {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 1 && n <= 1_000_000) {
        ;(out as unknown as Record<string, unknown>)[key] = Math.round(n)
      } else {
        warnings.push(`Numero dipendenti sospetto: ${value} (fuori range 1-1.000.000) — scartato`)
      }
      continue
    }

    const n = Number(value)
    if (!Number.isFinite(n)) {
      warnings.push(`${key}: valore non numerico "${value}" — scartato`)
      continue
    }

    const minTh = MIN_MONETARY_THRESHOLD[key] ?? 1
    if (n > 0 && n < minTh) {
      warnings.push(`${key}: valore ${n}€ sotto soglia minima ${minTh}€ — scartato come noise di parsing`)
      continue
    }
    if (Math.abs(n) > MAX_MONETARY_THRESHOLD) {
      warnings.push(`${key}: valore ${n} fuori range ragionevole — scartato`)
      continue
    }
    ;(out as unknown as Record<string, unknown>)[key] = n
  }

  return { sanitized: out, warnings }
}

/**
 * Trasforma i warning tecnici di sanitizeBalanceYear in UN UNICO messaggio
 * human-friendly per l'utente finale. I dettagli tecnici (key tangibleAssets,
 * soglie numeriche) vengono nascosti.
 *
 * Esempio:
 *   in:  ["tangibleAssets: valore 2€ sotto soglia minima 1000€ — scartato",
 *         "bankDebts: valore 10€ sotto soglia minima 100€ — scartato"]
 *   out: ["⚠️ Bilancio incompleto: alcune voci patrimoniali (Immobilizzazioni
 *          materiali, Debiti verso banche) presentano valori non plausibili e
 *          sono state escluse. Le stime potrebbero essere parziali."]
 */
export function aggregateParsingWarnings(rawWarnings: string[]): string[] {
  if (!rawWarnings || rawWarnings.length === 0) return []

  const droppedFields: string[] = []
  const otherWarnings: string[] = []

  for (const w of rawWarnings) {
    // Pattern: "<key>: valore ... scartato"
    const m = w.match(/^([a-zA-Z]+):\s*valore[\s\S]+scartato/i)
    if (m) {
      const key = m[1]
      const label = FIELD_LABELS_IT[key]
      if (label && !droppedFields.includes(label)) {
        droppedFields.push(label)
      }
      continue
    }
    // Warning su dipendenti o altri non riconducibili → mantieni come informativi
    if (/dipendenti/i.test(w) || /numerico/i.test(w)) {
      otherWarnings.push(w)
    }
    // Tutti gli altri warning gergali tecnici vengono droppati silenziosamente
  }

  const aggregated: string[] = []
  if (droppedFields.length > 0) {
    aggregated.push(
      `Bilancio incompleto: alcune voci (${droppedFields.join(', ')}) ` +
      `presentano valori non plausibili nel bilancio depositato e sono state ` +
      `escluse dalla stima. Le stime di asset assicurabili possono essere parziali.`
    )
  }
  aggregated.push(...otherWarnings)
  return aggregated
}

// ─────────────────────────────────────────────────────────────────────────────
//  ESTRAZIONE VOCI DI BILANCIO da TESTO LIBERO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Voci di Conto Economico Italian GAAP: pattern di estrazione da testo libero.
 * Ogni voce ha più alias possibili (etichette diverse usate nei bilanci).
 */
const CE_PATTERNS = {
  /** A.1 Ricavi delle vendite */
  turnover: [
    /ricavi\s+delle\s+vendite[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /valore\s+della\s+produzione[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /A\.\s*1[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /fatturato[\s\S]{0,40}?€?\s*([\d.,]+)/i,
  ],
  /** B.6 Materie prime */
  rawMaterials: [
    /B\.\s*6[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /costi\s+per\s+materie\s+prime[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** B.7 Costi per servizi (★ contiene premi assicurativi) */
  services: [
    /B\.\s*7[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /costi\s+per\s+servizi[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** B.9 Costi per il personale */
  totalStaffCost: [
    /B\.\s*9[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /costi\s+per\s+il\s+personale[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /costo\s+del\s+personale[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** B.10b Ammortamenti immobilizzazioni materiali */
  amortization: [
    /B\.\s*10[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /ammortamenti\s+e\s+svalutazioni[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** B.14 Oneri diversi gestione */
  otherOperatingCosts: [
    /B\.\s*14[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /oneri\s+diversi\s+di\s+gestione[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** C.17 Oneri finanziari */
  financialCharges: [
    /C\.\s*17[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /oneri\s+finanziari[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /interessi\s+passivi[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** ⭐ Premi assicurativi (raro, solo Nota Integrativa) */
  insurancePremiums: [
    /premi\s+(?:di\s+)?assicurazion[ei][\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /(?:oneri|spese|costi)\s+(?:di\s+|per\s+)?assicurazion[ei][\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /assicurazion[ei][\s\S]{0,40}?€?\s*([\d.]{4,})/i, // numero ≥4 cifre
  ],
  /** Immobilizzazioni materiali */
  tangibleAssets: [
    /immobilizzazioni\s+materiali[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /B\.\s*II[\s)\.]{1,3}[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** Patrimonio netto */
  equity: [
    /patrimonio\s+netto[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
  /** Debiti verso banche */
  bankDebts: [
    /debiti\s+verso\s+banche[\s\S]{0,80}?€?\s*([\d.,]+)/i,
    /debiti\s+bancari[\s\S]{0,80}?€?\s*([\d.,]+)/i,
  ],
}

/**
 * Estrae voci di bilancio da un blocco di testo libero (snippet web, PDF testuale, ecc.).
 * Restituisce solo le voci EFFETTIVAMENTE trovate, mai stime.
 */
export function extractBalanceFromText(text: string): Partial<BalanceSheetYear> {
  if (!text || typeof text !== 'string' || text.length < 20) return {}
  const out: Partial<BalanceSheetYear> = {}

  for (const [key, patterns] of Object.entries(CE_PATTERNS)) {
    const value = extractMonetary(text, patterns)
    if (value !== null) {
      ;(out as any)[key === 'insurancePremiums' ? 'insurancePremiumsDeclared' : key] = value
    }
  }

  // Cerca anche anno di riferimento del bilancio
  const yearMatch = text.match(/bilancio[\s\S]{0,40}?(20\d{2})/i)
    || text.match(/esercizio[\s\S]{0,20}?(20\d{2})/i)
    || text.match(/(?:al|del)\s+31[\/\-]?12[\/\-]?(20\d{2})/i)
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10)
    if (y >= 2010 && y <= new Date().getFullYear()) {
      out.year = y
    }
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAVILY SEARCH — voci di bilancio specifiche
// ─────────────────────────────────────────────────────────────────────────────

interface TavilyResult {
  url: string
  title: string
  content: string
  score?: number
}

/**
 * Esegue una search Tavily mirata e restituisce i risultati.
 * Usa la chiave da env TAVILY_API_KEY. Restituisce [] se non configurato.
 */
async function tavilySearchSafe(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: TavilyResult[] }
    return Array.isArray(data?.results) ? data.results : []
  } catch {
    return []
  }
}

/**
 * Cerca voci di bilancio su Tavily concatenando più query mirate
 * e parsando i risultati con i pattern di estrazione.
 */
export async function fetchBalanceFromTavily(
  ragioneSociale: string,
  piva?: string,
): Promise<{ data: Partial<BalanceSheetYear>; sources: string[] }> {
  const out: Partial<BalanceSheetYear> = {}
  const sources: string[] = []

  if (!ragioneSociale && !piva) return { data: out, sources }

  // Query mirate per voci di bilancio
  const anchor = piva ? `"${piva}"` : `"${ragioneSociale}"`
  const queries = [
    `${anchor} bilancio costi servizi B.7`,
    `${anchor} premi assicurativi`,
    `${anchor} bilancio immobilizzazioni materiali`,
    `${anchor} oneri finanziari debiti banche`,
  ]

  for (const q of queries) {
    const results = await tavilySearchSafe(q, 4)
    for (const r of results) {
      if (!r?.content) continue
      const extracted = extractBalanceFromText(`${r.title || ''}\n${r.content}`)
      // Merge solo le chiavi che mancano in out (no overwrite)
      for (const [k, v] of Object.entries(extracted)) {
        if (v !== undefined && v !== null && (out as any)[k] === undefined) {
          ;(out as any)[k] = v
          if (r.url && !sources.includes(r.url)) sources.push(r.url)
        }
      }
    }
  }

  return { data: out, sources }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LEAD-REGISTRY — riuso del flusso esistente (gratuito)
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo grezzo del response /api/lead-registry */
interface LeadRegistryResponse {
  found?: boolean
  ragione_sociale?: string
  partita_iva?: string
  fatturato?: string | number
  fatturato_anno?: string | number
  dipendenti?: string | number
  capitale_sociale?: string
  costo_personale?: string | number
  utile_netto?: string | number
  codice_ateco?: string
  descrizione_ateco?: string
  sede_legale?: string
  pec?: string
  telefono?: string
  forma_giuridica?: string
  data_costituzione?: string
  [key: string]: unknown
}

/**
 * Chiama internamente /api/lead-registry per ottenere i dati base
 * dell'azienda da CompanyReports/FatturatoItalia/ufficiocamerale (tutto gratis).
 *
 * Riuso del flusso esistente: NON tocca lead-registry, lo chiama come client.
 */
export async function fetchFromLeadRegistry(
  origin: string,
  ragioneSociale: string,
  citta?: string,
): Promise<LeadRegistryResponse | null> {
  if (!ragioneSociale) return null
  try {
    const res = await fetch(`${origin}/api/lead-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          nome: ragioneSociale,
          azienda: ragioneSociale,
          citta: citta || '',
          sito: '',
          indirizzo: '',
          categoria: '',
        },
        _skipPersonEnrichment: true,
      }),
      signal: AbortSignal.timeout(45000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as LeadRegistryResponse
    return data?.found ? data : null
  } catch {
    return null
  }
}

/**
 * Trasforma una risposta lead-registry in BalanceSheetYear normalizzato.
 * Mantiene SOLO i dati realmente presenti, mai zero-fill.
 */
export function leadRegistryToBalanceYear(lr: LeadRegistryResponse): BalanceSheetYear | null {
  const year = parseInt(String(lr.fatturato_anno || ''), 10)
  if (!year || isNaN(year) || year < 2010 || year > new Date().getFullYear()) {
    // Senza anno il dato non è utilizzabile come riga di bilancio
    return null
  }

  const turnover = parseItalianNumber(lr.fatturato)
  const employees = parseItalianNumber(lr.dipendenti)
  const staffCost = parseItalianNumber(lr.costo_personale)
  const netIncome = parseItalianNumber(lr.utile_netto)
  const shareCapital = parseItalianNumber(lr.capitale_sociale)

  const out: BalanceSheetYear = { year }
  if (turnover !== null && turnover > 0) out.turnover = turnover
  if (employees !== null && employees > 0) out.employees = Math.round(employees)
  if (staffCost !== null && staffCost > 0) out.totalStaffCost = staffCost
  if (netIncome !== null) out.netIncome = netIncome
  if (shareCapital !== null && shareCapital > 0) out.shareCapital = shareCapital

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINT — fetcher unificato
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchBalanceOptions {
  origin: string
  ragioneSociale: string
  piva?: string
  citta?: string
  /** Skip Tavily search (più veloce, meno completo) */
  skipTavily?: boolean
}

/**
 * Recupera bilancio da TUTTE le fonti gratuite disponibili e le combina.
 *
 * Pipeline:
 *   1. /api/lead-registry → dati base (fatturato, dipendenti, ecc.)
 *   2. Tavily search (se !skipTavily) → voci dettagliate (B.7, premi, ecc.)
 *   3. Merge non-distruttivo (lead-registry vince su Tavily per stessi campi)
 *
 * Restituisce un BalanceSheetData con UN solo anno (l'ultimo disponibile).
 * Nessun dato inventato: campi assenti restano undefined.
 */
export async function fetchBalanceSheetFree(
  opts: FetchBalanceOptions,
): Promise<BalanceSheetData> {
  const sources: string[] = []
  let latest: BalanceSheetYear | null = null

  // Step 1: Lead Registry (gratuito, riuso flusso esistente)
  const lr = await fetchFromLeadRegistry(opts.origin, opts.ragioneSociale, opts.citta)
  if (lr) {
    sources.push('lead-registry')
    const year = leadRegistryToBalanceYear(lr)
    if (year) latest = year
  }

  // Step 2: Tavily search per voci dettagliate (solo se abbiamo P.IVA o nome)
  if (!opts.skipTavily) {
    const tavilyData = await fetchBalanceFromTavily(opts.ragioneSociale, opts.piva)
    if (Object.keys(tavilyData.data).length > 0) {
      sources.push('tavily-balance-search')
      sources.push(...tavilyData.sources)
      // Merge: latest ha priorità, riempi solo i campi mancanti
      if (!latest) {
        // Se Tavily ha trovato un anno, usalo
        latest = { year: tavilyData.data.year || new Date().getFullYear() - 1 }
      }
      for (const [k, v] of Object.entries(tavilyData.data)) {
        if (v !== undefined && v !== null && (latest as any)[k] === undefined) {
          ;(latest as any)[k] = v
        }
      }
    }
  }

  // ─── Sanity check anti-noise (Fix #1) ─────────────────────────────────
  let dataQualityWarnings: string[] = []
  if (latest) {
    const cleaned = sanitizeBalanceYear(latest)
    latest = cleaned.sanitized
    // Trasforma i warning tecnici (es. "tangibleAssets: valore 2€...") in messaggi
    // human-friendly aggregati (es. "Bilancio incompleto: ..."). Vedi Fix UX #5.
    dataQualityWarnings = aggregateParsingWarnings(cleaned.warnings)
  }

  return {
    years: latest ? [latest] : [],
    latest,
    source: sources.join(' + ') || 'no-data',
    fetchedAt: new Date().toISOString(),
    dataQualityWarnings,
  }
}

/**
 * Costruisce origin URL da una NextRequest (utility per le route API).
 */
export function originFromHeaders(headers: Headers): string {
  const host = headers.get('host')
  if (!host) return 'http://localhost:3000'
  const proto = headers.get('x-forwarded-proto') || 'http'
  return `${proto}://${host}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  FIX #3: lookup ATECO via Tavily quando lead-registry non lo restituisce
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estrae un codice ATECO valido da un testo libero.
 * Pattern accettati: "47.11" / "47.11.1" / "47.11.10" / "471110" / "ATECO 47.11"
 * Restituisce sempre la versione a 6 cifre senza punti se possibile.
 */
export function extractAtecoFromText(text: string): { code: string; description?: string } | null {
  if (!text) return null

  // 1) Pattern formato dotted "47.11.10" o "47.11"
  const dotted = text.match(/\b(\d{2})\.(\d{1,2})(?:\.(\d{1,2}))?\b/)
  if (dotted) {
    const a = dotted[1].padStart(2, '0')
    const b = (dotted[2] || '').padStart(2, '0')
    const c = (dotted[3] || '00').padStart(2, '0')
    const code = `${a}${b}${c}`
    if (code.length === 6 && /^\d{6}$/.test(code)) {
      return { code }
    }
  }

  // 2) Pattern "ATECO: 471110" o "codice ateco 471110"
  const direct = text.match(/(?:ateco|codice\s+attivita)[\s:]*(\d{4,6})/i)
  if (direct) {
    const code = direct[1].padEnd(6, '0').slice(0, 6)
    if (/^\d{6}$/.test(code)) return { code }
  }

  return null
}

/**
 * Cerca il codice ATECO di un'azienda via Tavily, quando lead-registry
 * non lo ha restituito. Costo: 1-2 query Tavily.
 *
 * Strategia:
 *   1. Cerca su companyreports.it / fatturatoitalia.it / ufficiocamerale.it
 *      (i siti aggregatori che pubblicano l'ATECO).
 *   2. Estrai il primo ATECO valido trovato.
 *
 * Restituisce null se nessuna fonte ne pubblica uno verificabile.
 */
export async function fetchAtecoFromTavily(
  ragioneSociale: string,
  piva?: string,
): Promise<{ code: string; description?: string; source: string } | null> {
  const anchor = piva ? `"${piva}"` : `"${ragioneSociale}"`
  const query = `${anchor} codice ATECO attivit\u00e0 prevalente site:companyreports.it OR site:ufficiocamerale.it OR site:fatturatoitalia.it OR site:reportaziende.it`

  const results = await tavilySearchSafe(query, 6)
  for (const r of results) {
    const text = `${r.title || ''}\n${r.content || ''}`
    const ateco = extractAtecoFromText(text)
    if (ateco) {
      // Cerca anche la descrizione in un raggio di 200 caratteri
      const descMatch = text.match(/ateco[\s:\d.]{0,15}([\w\s,'\u00e0\u00e8\u00e9\u00ec\u00f2\u00f9\u00c0\u00c8\u00c9\u00cc\u00d2\u00d9-]{6,120})/i)
      const description = descMatch ? descMatch[1].trim().replace(/\s+/g, ' ') : undefined
      return { code: ateco.code, description, source: r.url || 'tavily' }
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
//  IDENTITY RESOLVER UNIFICATO — usato da tutte le route /api/insurance/*
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedCompanyIdentity {
  ragioneSociale: string
  piva: string
  ateco?: string
  atecoDescription?: string
  sede_legale?: string
  citta?: string
  /** Lista delle fonti che hanno effettivamente contribuito */
  sourcesUsed: string[]
  /** True se l'ATECO è stato trovato in qualche fonte */
  atecoResolved: boolean
  /**
   * Warnings di qualità identità: P.IVA mismatch (Fix #8), ATECO sospetto vs
   * ragione sociale (Fix #6), aziende omonime ecc.
   */
  warnings: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fix #6: heuristic cross-check ATECO vs Ragione Sociale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mappa keyword nella ragione sociale → lettera ATECO macro-settore attesa.
 * Usata come SANITY CHECK: se l'ATECO ricevuto da fonti pubbliche contraddice
 * fortemente il senso del nome → warning all'utente.
 *
 * Regole intenzionalmente PRUDENTI: solo casi inequivocabili. Meglio un falso
 * negativo (warning mancato) che un falso positivo (warning ingiustificato).
 */
const RS_KEYWORD_TO_EXPECTED_LETTER: Array<{ pattern: RegExp; letters: string[]; topic: string }> = [
  // Trasporti, autotrasporto, autolinee, taxi, bus
  { pattern: /\b(bus|trasporti|autolinee|autotrasporto|autonoleggio|pullman|taxi|spedizioni|logistica|corriere)\b/i, letters: ['H'], topic: 'trasporti/logistica' },
  // Costruzioni / edilizia
  { pattern: /\b(costruzioni|costruzione|edil|impresa edile|ristrutturazion|opere murarie|cantieristica|infissi|serramenti)\b/i, letters: ['F', 'C'], topic: 'costruzioni/edilizia' },
  // Studi professionali (legale, notarile, commercialisti)
  { pattern: /\b(studio legale|studio associato|avvocat|notar|notarile|commercialist|consulenza|d'oulx)\b/i, letters: ['M'], topic: 'studi professionali' },
  // IT / Software
  { pattern: /\b(software|informatic|technology|digitale|digital|web|app\b|cloud|cyber|consulting it|sistemi informativi)\b/i, letters: ['J', 'M'], topic: 'IT/digitale' },
  // Turismo / ristorazione / alberghi
  { pattern: /\b(viaggi|tour\b|turismo|hotel|albergo|ristorant|trattoria|pizzeria|bar\b|caffetter)\b/i, letters: ['I'], topic: 'turismo/ristorazione' },
  // Energia / consulenza energetica
  { pattern: /\b(energy|energia|energetic|fotovoltaic|elettric|gas\b|illuminazione|impianti elettr)\b/i, letters: ['D', 'M', 'F'], topic: 'energia' },
  // Auto / ricambi / officina
  { pattern: /\b(auto\s|autoriparazion|carrozzeri|gommista|ricambi|officina)\b/i, letters: ['G'], topic: 'auto/ricambi' },
  // Sanità / farmacia
  { pattern: /\b(farmacia|farmaceutic|medic|sanitari|clinic|odontoiatric|dentale)\b/i, letters: ['Q', 'G'], topic: 'sanità/farmacia' },
  // Stampa, grafica, editoria
  { pattern: /\b(grafica|tipografi|stampa\b|stamperi|editori|pubblicit)\b/i, letters: ['C', 'J'], topic: 'stampa/editoria' },
  // Manifattura
  { pattern: /\b(manifattur|fabbricazion|metallurg|meccanic|industriale)\b/i, letters: ['C'], topic: 'manifattura' },
  // Agricoltura
  { pattern: /\b(agricol|agricoltura|allevamento|vivaismo|apicoltura|caseifici)\b/i, letters: ['A'], topic: 'agricoltura' },
]

/**
 * Esegue cross-check tra ragione sociale e codice ATECO.
 * Restituisce un warning se c'è un mismatch evidente, null altrimenti.
 *
 * Esempio: ragione sociale "BUS COMPANY SRL" + ATECO "28.15.00" (cuscinetti)
 * → warning, perché "BUS" suggerisce H (trasporti) e l'ATECO ricevuto è C
 * (manifattura), che è incoerente.
 */
export function crossCheckAtecoVsRagioneSociale(
  ragioneSociale: string | undefined | null,
  atecoCode: string | undefined | null,
): string | null {
  if (!ragioneSociale || !atecoCode) return null
  // Estrai prima cifra ATECO per derivare la lettera macro-settore
  const m = String(atecoCode).match(/(\d{2})/)
  if (!m) return null
  const num = parseInt(m[1], 10)
  if (!Number.isFinite(num) || num < 1 || num > 99) return null
  // Mapping ATECO numerico → lettera macro (subset essenziale)
  let letter: string | null = null
  if (num >= 1 && num <= 3) letter = 'A'
  else if (num >= 5 && num <= 9) letter = 'B'
  else if (num >= 10 && num <= 33) letter = 'C'
  else if (num === 35) letter = 'D'
  else if (num >= 36 && num <= 39) letter = 'E'
  else if (num >= 41 && num <= 43) letter = 'F'
  else if (num >= 45 && num <= 47) letter = 'G'
  else if (num >= 49 && num <= 53) letter = 'H'
  else if (num >= 55 && num <= 56) letter = 'I'
  else if (num >= 58 && num <= 63) letter = 'J'
  else if (num >= 64 && num <= 66) letter = 'K'
  else if (num === 68) letter = 'L'
  else if (num >= 69 && num <= 75) letter = 'M'
  else if (num >= 77 && num <= 82) letter = 'N'
  else if (num === 84) letter = 'O'
  else if (num === 85) letter = 'P'
  else if (num >= 86 && num <= 88) letter = 'Q'
  else if (num >= 90 && num <= 93) letter = 'R'
  else if (num >= 94 && num <= 96) letter = 'S'

  if (!letter) return null

  // Per ogni keyword del nome che ha una lettera attesa, controlla che
  // l'ATECO ricevuto sia coerente
  for (const rule of RS_KEYWORD_TO_EXPECTED_LETTER) {
    if (rule.pattern.test(ragioneSociale)) {
      if (!rule.letters.includes(letter)) {
        return `⚠️ ATECO sospetto: la ragione sociale "${ragioneSociale}" suggerisce attività "${rule.topic}" ` +
          `(ATECO atteso macro-settore: ${rule.letters.join('/')}), ma il codice ricevuto è ${atecoCode} (macro-settore ${letter}). ` +
          `Possibile mismatch da fonte pubblica con un'azienda omonima — verificare manualmente prima di stimare polizze.`
      }
      // Match positivo: nessun warning su questa regola, esci
      return null
    }
  }
  return null
}

/**
 * Risolve l'anagrafica di un'azienda combinando lead-registry + Tavily ATECO fallback.
 *
 * Pipeline:
 *   1. Chiama /api/lead-registry per dati base
 *   2. Se ATECO mancante e abbiamo P.IVA → fallback Tavily mirato
 *   3. Restituisce identity normalizzata
 *
 * Mai inventa: campi assenti restano undefined.
 */
export async function resolveCompanyIdentity(
  origin: string,
  input: { piva?: string; ragioneSociale?: string; citta?: string },
): Promise<ResolvedCompanyIdentity> {
  const inputPivaNormalized = (input.piva || '').replace(/\D/g, '')
  const out: ResolvedCompanyIdentity = {
    ragioneSociale: (input.ragioneSociale || '').trim(),
    piva: inputPivaNormalized,
    citta: input.citta || undefined,
    sourcesUsed: [],
    atecoResolved: false,
    warnings: [],
  }

  // Fix #10: se abbiamo P.IVA valida, usiamo QUELLA come query (univoca).
  // Cercare per ragione sociale può trovare un'azienda omonima diversa.
  const hasValidPiva = inputPivaNormalized.length === 11
  const queryName = hasValidPiva ? inputPivaNormalized : (out.ragioneSociale || out.piva)
  if (!queryName) return out

  // Step 1: lead-registry
  const lr = await fetchFromLeadRegistry(origin, queryName, out.citta)
  if (lr) {
    const resolvedPiva = lr.partita_iva ? String(lr.partita_iva).replace(/\D/g, '') : ''

    // Fix #10: se abbiamo cercato per P.IVA E lead-registry restituisce P.IVA DIVERSA,
    // significa che il match non è affidabile → scartiamo il risultato.
    if (hasValidPiva && resolvedPiva && resolvedPiva !== inputPivaNormalized) {
      out.warnings.push(
        `⚠️ Lead-registry ha restituito un'azienda con P.IVA diversa (${resolvedPiva}) ` +
        `da quella cercata (${inputPivaNormalized}). Risultato scartato per evitare ` +
        `mismatch dati. Verifica manualmente la P.IVA.`
      )
      // Non applichiamo i dati di lr, ma proseguiamo per provare il fallback Tavily
    } else {
      out.sourcesUsed.push('lead-registry')
      if (lr.ragione_sociale) out.ragioneSociale = String(lr.ragione_sociale)

      // Fix #8: P.IVA in input ≠ P.IVA risolta (caso non-piva-query: cerco per nome
      // ma trovo azienda con P.IVA diversa da input) → warning prominente
      if (resolvedPiva) {
        if (inputPivaNormalized && inputPivaNormalized !== resolvedPiva) {
          out.warnings.push(
            `⚠️ P.IVA INPUT ≠ P.IVA RISOLTA: hai inserito ${inputPivaNormalized}, ` +
            `ma il lookup ha trovato ${resolvedPiva} (${lr.ragione_sociale || 'azienda diversa'}). ` +
            `I dati mostrati sono dell'azienda risolta, NON di quella richiesta. ` +
            `Verifica la P.IVA o usa la ragione sociale completa per disambiguare.`
          )
        }
        out.piva = resolvedPiva
      }

      if (lr.codice_ateco) {
        out.ateco = String(lr.codice_ateco)
        out.atecoResolved = true
      }
      if (lr.descrizione_ateco) out.atecoDescription = String(lr.descrizione_ateco)
      if (lr.sede_legale) out.sede_legale = String(lr.sede_legale)
    }
  }

  // Step 2: Fix #3 — fallback ATECO via Tavily
  if (!out.atecoResolved && (out.piva || out.ragioneSociale)) {
    try {
      const tav = await fetchAtecoFromTavily(out.ragioneSociale, out.piva)
      if (tav) {
        out.ateco = tav.code
        out.atecoDescription = out.atecoDescription || tav.description
        out.atecoResolved = true
        out.sourcesUsed.push('tavily-ateco-fallback')
      }
    } catch {
      // ignora errori Tavily (ATECO resta unresolved)
    }
  }

  // Fix #6: cross-check ATECO vs ragione sociale (anti-mismatch da omonime)
  const crossWarning = crossCheckAtecoVsRagioneSociale(out.ragioneSociale, out.ateco)
  if (crossWarning) out.warnings.push(crossWarning)

  return out
}
