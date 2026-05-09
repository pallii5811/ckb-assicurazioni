import { NextRequest, NextResponse } from 'next/server'
import { getTerritorialRisk } from '@/lib/territorial-risk'
import { getAtecoInsurance } from '@/lib/ateco-insurance'
import { classifyCompanySize, estimateAnnualPremium, analyzeInsuranceGaps } from '@/lib/insurance-analysis'
import { buildInsuranceNeedsProfile } from '@/lib/insurance-needs-engine'
import { geminiExtractCompanyData, isGeminiEnabled } from '@/lib/gemini-search'
import { enrichCompanyByPiva, isOpenApiPrimary, searchByCompanyName } from '@/lib/openapi-service'

const BACKEND_URL = process.env.BACKEND_URL || 'http://46.225.189.40:8001'
const OPENAPI_IT_TOKEN = process.env.OPENAPI_IT_TOKEN || ''

// ── Helpers ──────────────────────────────────────────────────────

function extractFormaGiuridica(name: string): string | null {
  const n = name.toLowerCase()
  if (/\bs\.?r\.?l\.?s?\b/.test(n) || n.includes('srls')) return n.includes('srls') ? 'SRLS' : 'SRL'
  if (/\bs\.?p\.?a\.?\b/.test(n)) return 'SPA'
  if (/\bs\.?n\.?c\.?\b/.test(n)) return 'SNC'
  if (/\bs\.?a\.?s\.?\b/.test(n)) return 'SAS'
  if (/\bs\.?s\.?\b/.test(n) && !n.includes('ss.')) return 'SS'
  return null
}

// ── Helper: check if returned name matches query (same as company-lookup) ──
function nameMatches(query: string, returned: string): boolean {
  if (!query || !returned) return false
  const clean = (s: string) => s.toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|di|e|the|srl|srls|spa|snc|sas)\.?\b/gi, '').replace(/[^a-z0-9àèéìòù\s]/g, '').trim()
  const qWords = clean(query).split(/\s+/).filter(w => w.length >= 2)
  const rClean = clean(returned)
  if (qWords.length === 0) return false
  const matched = qWords.filter(w => rClean.includes(w)).length
  if (qWords.length <= 2) return matched === qWords.length
  return matched >= Math.ceil(qWords.length * 0.6)
}

function isInvalidPersonName(value: unknown): boolean {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return true
  if (/^(non trovato|non disponibile|n\/?a|null|undefined|nessuno|sconosciuto|da verificare)$/i.test(s)) return true
  if (s.includes('non trovato')) return true
  return false
}

const PIVA_RE = [
  /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /\bIT(\d{11})\b/g,
  /\bP\.?\s?I\.?[\s:.\-]+(?:IT)?[\s]?(\d{11})/gi,
]

function extractPivaFromHtml(html: string): string | null {
  for (const re of PIVA_RE) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m?.[1]) return m[1]
  }
  const area = html.match(/(?:P\.?\s*I\.?V\.?A|P\.?\s?I\.?\s|Partita\s*IVA|codice\s*fiscale).{0,100}/gi)
  if (area) {
    for (const a of area) {
      const d = a.match(/\b(\d{11})\b/)
      if (d?.[1]) return d[1]
    }
  }
  // Fallback: bare 11-digit number near footer/legal keywords
  const footerArea = html.match(/(?:informazioni\s*legali|privacy\s*policy|cookie\s*policy|copyright|©|footer|sede\s*legale).{0,200}/gi)
  if (footerArea) {
    for (const block of footerArea) {
      const candidates = block.match(/\b(\d{11})\b/g) || []
      for (const c of candidates) {
        // Skip phone-like patterns: Italian mobiles start with 3, landlines with 0
        if (c.startsWith('3') && /^3[0-9]{9}[0-9]$/.test(c)) continue
        // Skip numbers starting with +39 prefix leftover
        if (c.startsWith('39') && /^39[03]/.test(c)) continue
        return c
      }
    }
  }
  return null
}

// Anti-hallucination: validate that a LinkedIn URL belongs to the named person AND
// references the Italian company. Used to block omonyms (e.g. Italian "Belal A Dawali"
// being attached to a Qatar-based "Belal Al Dawall" profile).
function validateLinkedInForName(url: string, personName: string): boolean {
  if (!url || !personName) return false
  const u = String(url).toLowerCase()
  if (!u.includes('linkedin.com/in/')) return false
  const subM = u.match(/[?&]originalsubdomain=([a-z]{2})/i)
  if (subM && subM[1].toLowerCase() !== 'it') return false
  const slugM = u.match(/linkedin\.com\/in\/([a-z0-9._\-%]+)/i)
  if (!slugM) return false
  const slug = slugM[1].replace(/[^a-z0-9]/gi, '').toLowerCase()
  const tokens = String(personName).toLowerCase()
    .replace(/[^a-zà-ù\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !/^(de|del|della|di|da|du|el|al|la|le|lo|van|von|st|jr|sr)$/i.test(t))
  if (tokens.length === 0) return false
  const surname = tokens[tokens.length - 1]
  const surnameOk = slug.includes(surname) || (surname.length >= 7 && slug.includes(surname.slice(0, 6)))
  if (!surnameOk) return false
  const firstOk = tokens.slice(0, -1).some(t => slug.includes(t))
  return firstOk || (tokens.length === 1 && surnameOk)
}

function validateLinkedInWithContext(
  url: string,
  personName: string,
  ctx: { text?: string; companyName?: string; piva?: string; city?: string }
): boolean {
  if (!validateLinkedInForName(url, personName)) return false
  const text = String(ctx.text || '').toLowerCase()
  if (!text) return true
  const piva = String(ctx.piva || '').replace(/\D/g, '')
  if (piva.length === 11 && text.replace(/\D/g, '').includes(piva)) return true
  const compTokens = String(ctx.companyName || '').toLowerCase()
    .replace(/[^a-zà-ù0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !/^(srl|srls|spa|sas|snc|soc|societa|società|company|group|italia|milano|roma|napoli)$/i.test(w))
  const city = String(ctx.city || '').toLowerCase().trim()
  if (city && city.length >= 3 && text.includes(city)) return true
  if (compTokens.length === 0) return true
  const hits = compTokens.filter(t => text.includes(t)).length
  return hits >= Math.min(2, compTokens.length) || (compTokens.length === 1 && compTokens[0].length >= 6 && text.includes(compTokens[0]))
}

async function fetchHtmlSafe(url: string, ms = 5000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    })
    return await res.text()
  } catch { return '' }
}

// ── VIES: official EU P.IVA verification ─────────────────────────
async function verifyPivaVies(piva: string): Promise<{
  valid: boolean; name?: string; address?: string
} | null> {
  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/${piva}`,
      { signal: AbortSignal.timeout(6000) }
    )
    const d = (await res.json()) as any
    if (d?.isValid) {
      return {
        valid: true,
        name: typeof d.name === 'string' && d.name !== '---' ? d.name.trim() : undefined,
        address: typeof d.address === 'string' && d.address !== '---' ? d.address.trim() : undefined,
      }
    }
    return { valid: false }
  } catch { return null }
}

// ── INIPEC.gov.it: FREE PEC lookup by company name or P.IVA ──
async function lookupInipecPec(companyName: string): Promise<string | null> {
  try {
    // INIPEC search by denominazione (company name)
    const searchUrl = `https://www.inipec.gov.it/cerca/imprese?denominazione=${encodeURIComponent(companyName)}`
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    // Look for PEC pattern in results: "xxx@pec.yyy.it" or similar
    const pecMatch = html.match(/([a-zA-Z0-9._%+\-]+@(?:pec\.[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.\-]+\.(?:pec|legalmail|pecimprese|pecavvocati|cert)\.[a-zA-Z]{2,}))/i)
    if (pecMatch?.[1]) return pecMatch[1].toLowerCase()
    // Broader PEC pattern: any email containing "pec" in domain
    const broadPec = html.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi) || []
    for (const e of broadPec) {
      if (e.toLowerCase().includes('pec') || e.toLowerCase().includes('legalmail') || e.toLowerCase().includes('cert.')) {
        return e.toLowerCase()
      }
    }
    return null
  } catch { return null }
}

// ── Google scraping for PEC and dipendenti (free fallback) ──
async function googleScrapePecDipendenti(companyName: string): Promise<{ pec?: string; dipendenti?: string } | null> {
  try {
    const result: { pec?: string; dipendenti?: string } = {}
    // Search for PEC
    const q = encodeURIComponent(`"${companyName}" PEC email dipendenti`)
    const res = await fetch(`https://www.google.com/search?q=${q}&hl=it&num=5`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const text = html.replace(/<[^>]+>/g, ' ')
    // PEC: email with pec/legalmail/cert domain
    const pecM = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]*(?:pec|legalmail|pecimprese|cert)[a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/i)
    if (pecM) result.pec = pecM[1].toLowerCase()
    // Dipendenti
    const dipM = text.match(/(\d{1,5})\s*dipendenti/i)
    if (dipM && parseInt(dipM[1]) < 50000) result.dipendenti = dipM[1]
    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── registroimprese.it / Ufficio Camerale scraping for dipendenti, REA ──
async function scrapeRegistroImprese(piva: string): Promise<Record<string, string> | null> {
  try {
    const searchUrl = `https://www.registroimprese.it/ricerca-libera?searchterm=${piva}`
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 1000) return null
    const result: Record<string, string> = {}
    // REA
    const reaM = html.match(/REA[:\s]+([A-Z]{2}\s*[-–]?\s*\d{5,7})/i)
    if (reaM) result.codice_rea = reaM[1].trim()
    // PEC
    const pecM = html.match(/PEC[:\s]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    if (pecM) result.pec = pecM[1].toLowerCase()
    // Dipendenti
    const dipM = html.match(/(?:dipendenti|addetti)[:\s]+(\d+)/i)
    if (dipM) result.dipendenti = dipM[1]
    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── CompanyReports.it: FREE real company data (fatturato, dipendenti) ──
async function scrapeCompanyReports(piva: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`https://www.companyreports.it/${piva}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 5000) return null // not a company page
    // Detect homepage (company not found → redirects to homepage)
    if (html.includes('<title>CompanyReports - Il fatturato')) return null

    const result: Record<string, string> = {}

    // Meta description: "Company Fatturato 2.630.757.873, Partita Iva: ..., Cod. Ateco 10.73"
    const meta = html.match(/meta name="description" content="([^"]+)"/i)
    if (meta) {
      const desc = meta[1]
      const fatM = desc.match(/Fatturato\s+([\d.,]+)/i)
      if (fatM) result.fatturato = fatM[1].replace(/,+$/, '').trim()
      const ateM = desc.match(/Ateco\s+([\d.]+)/i)
      if (ateM) result.codice_ateco = ateM[1].replace(/\.+$/, '').trim()
    }

    // JSON-LD FAQ structured data (has dipendenti, sede legale, costo personale)
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
    for (const block of jsonLdBlocks) {
      try {
        const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
        const items = d.mainEntity || []
        for (const item of items) {
          const q = (item.name || '').toLowerCase()
          const a: string = item.acceptedAnswer?.text || ''
          if (q.includes('fatturato') && !result.fatturato) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.fatturato = m[1].replace(/,+$/, '').trim()
            const y = a.match(/\((\d{4})\)/)
            if (y) result.fatturato_anno = y[1]
          }
          if (q.includes('dipendenti')) {
            const m = a.match(/da\s*(\d+)\s*a\s*(\d+)/i)
            if (m) result.dipendenti = `${m[1]}-${m[2]}`
            else {
              const m2 = a.match(/(\d+)\s*dipendenti/i) || a.match(/pari a\s*(\d+)/i)
              if (m2) result.dipendenti = m2[1]
            }
          }
          if (q.includes('ateco') && !result.descrizione_ateco) {
            const m = a.match(/codice ATECO\s*[\d.]+\s*[-–—]\s*(.+?)(?:\.|$)/i)
            if (m) result.descrizione_ateco = m[1].trim()
          }
          if (q.includes('sede legale') && !result.sede_legale) {
            const m = a.match(/è\s+(.+?)(?:\.$|$)/i)
            if (m) result.sede_legale = m[1].trim()
          }
          if (q.includes('costo del personale')) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.costo_personale = m[1].replace(/,+$/, '').trim()
          }
        }
      } catch { /* ignore malformed JSON-LD */ }
    }

    // HTML table: Stato Attività, Forma Giuridica, N. Dipendenti
    const statoM = html.match(/Stato Attivit[àa]<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (statoM) result.stato = statoM[1].trim()
    const formaM = html.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (formaM) result.forma_giuridica = formaM[1].trim()
    // Dipendenti from HTML table if not from JSON-LD
    if (!result.dipendenti) {
      const dipM = html.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
      if (dipM) result.dipendenti = dipM[1].trim()
    }

    // REA
    if (!result.codice_rea) {
      const reaM = html.match(/REA<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
      if (reaM) result.codice_rea = reaM[1].trim()
    }
    // PEC from HTML table
    if (!result.pec) {
      const pecM = html.match(/(?:Indirizzo\s*)?PEC<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+@[^<]+)/i)
      if (pecM) result.pec = pecM[1].trim().toLowerCase()
    }
    // PEC from any visible email that looks like PEC
    if (!result.pec) {
      const allEmails = html.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]*(?:pec|legalmail|pecimprese|cert)[a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/gi)
      if (allEmails?.[0]) result.pec = allEmails[0].toLowerCase()
    }

    // Ragione sociale from title
    const titleM = html.match(/<title>([^(<]+)/i)
    if (titleM) result.ragione_sociale = titleM[1].replace(/\s*Fatturato.*$/i, '').trim()

    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── OpenAPI.it IT-advanced: PAID real data from Camera di Commercio ──
interface OpenApiCompany {
  companyName?: string
  vatCode?: string
  address?: {
    registeredOffice?: {
      streetName?: string
      town?: string
      province?: string
      zipCode?: string
    }
  }
  activityStatus?: string
  reaCode?: string
  cciaa?: string
  atecoClassification?: {
    ateco2007?: { code?: string; description?: string }
  }
  detailedLegalForm?: { description?: string }
  startDate?: string
  pec?: string
  balanceSheets?: {
    last?: {
      year?: number
      employees?: number
      turnover?: number
      shareCapital?: number
      totalStaffCost?: number
    }
  }
}

/**
 * Fetches certified Camera di Commercio data via the centralized OpenAPI service
 * (cache 180 days + wallet guard + conditional stakeholders).
 * Output shape is preserved for backward compatibility with the merge logic in Step 5,
 * while ALSO exposing new fields: titolare_best, persone, managers, CF titolare, data nascita.
 */
async function fetchOpenApiIt(piva: string): Promise<Record<string, any> | null> {
  const enriched = await enrichCompanyByPiva(piva)
  if (!enriched) return null

  const result: Record<string, any> = {}

  if (enriched.ragione_sociale) result.ragione_sociale = enriched.ragione_sociale
  if (enriched.partita_iva) result.partita_iva = enriched.partita_iva
  if (enriched.sede_legale) result.sede_legale = enriched.sede_legale
  if (enriched.codice_ateco) result.codice_ateco = enriched.codice_ateco
  if (enriched.descrizione_ateco) result.descrizione_ateco = enriched.descrizione_ateco
  if (enriched.forma_giuridica) result.forma_giuridica = enriched.forma_giuridica
  if (enriched.stato_attivita) result.stato = enriched.stato_attivita === 'ATTIVA' ? 'Attiva' : enriched.stato_attivita
  if (enriched.codice_rea) result.codice_rea = enriched.codice_rea
  if (enriched.pec) result.pec = enriched.pec
  if (enriched.data_costituzione) result.data_costituzione = enriched.data_costituzione

  // Bilancio — preserve legacy string formatting so downstream code doesn't break
  if (typeof enriched.fatturato === 'number') {
    result.fatturato = new Intl.NumberFormat('it-IT').format(enriched.fatturato)
    result.fatturato_anno = enriched.fatturato_anno ? String(enriched.fatturato_anno) : ''
    result.fatturato_fonte = 'registro_imprese'
  }
  if (typeof enriched.dipendenti === 'number') {
    result.dipendenti = String(enriched.dipendenti)
    result.dipendenti_fonte = 'registro_imprese'
  }
  if (typeof enriched.capitale_sociale === 'number') {
    result.capitale_sociale = '€ ' + new Intl.NumberFormat('it-IT').format(enriched.capitale_sociale)
  }
  if (typeof enriched.costo_personale === 'number') {
    result.costo_personale = new Intl.NumberFormat('it-IT').format(enriched.costo_personale)
  }
  if (typeof (enriched as any).utile_netto === 'number') {
    result.utile_netto = new Intl.NumberFormat('it-IT').format((enriched as any).utile_netto)
  } else if (enriched.storico_bilanci?.[0]?.utile) {
    result.utile_netto = new Intl.NumberFormat('it-IT').format(enriched.storico_bilanci[0].utile)
  }
  if (typeof enriched.patrimonio_netto === 'number') {
    result.patrimonio_netto = new Intl.NumberFormat('it-IT').format(enriched.patrimonio_netto)
  }
  if (typeof enriched.totale_attivo === 'number') {
    result.totale_attivo = new Intl.NumberFormat('it-IT').format(enriched.totale_attivo)
  }
  if (typeof enriched.ral_medio === 'number') {
    result.ral_medio = new Intl.NumberFormat('it-IT').format(enriched.ral_medio)
  }
  // Storico bilanci (fino a 7 anni)
  if (enriched.storico_bilanci && enriched.storico_bilanci.length > 0) {
    result.storico_bilanci = enriched.storico_bilanci
  }
  // GPS
  if (typeof enriched.gps_lat === 'number' && typeof enriched.gps_lng === 'number') {
    result.gps_lat = enriched.gps_lat
    result.gps_lng = enriched.gps_lng
  }
  // ATECO storico
  if (enriched.ateco_2022) result.ateco_2022 = enriched.ateco_2022
  if (enriched.ateco_2007) result.ateco_2007 = enriched.ateco_2007
  // SDI
  if (enriched.codice_sdi) {
    result.codice_sdi = enriched.codice_sdi
    if (enriched.codice_sdi_timestamp) result.codice_sdi_timestamp = enriched.codice_sdi_timestamp
  }
  // Gruppo IVA
  if (enriched.gruppo_iva) result.gruppo_iva = enriched.gruppo_iva
  // Extra fields
  if (enriched.forma_giuridica_codice) result.forma_giuridica_codice = enriched.forma_giuridica_codice
  if (enriched.regione) result.regione = enriched.regione
  if (enriched.codice_fiscale) result.codice_fiscale = enriched.codice_fiscale
  if (enriched.citta) result.citta = enriched.citta
  if (enriched.provincia) result.provincia = enriched.provincia
  if (enriched.cap) result.cap = enriched.cap
  if (enriched.sito_web) result.sito_web = enriched.sito_web
  if (enriched.data_registrazione) result.data_registrazione = enriched.data_registrazione
  if (enriched.data_cessazione) result.data_cessazione = enriched.data_cessazione
  if (enriched.stato_agenzia_entrate) result.stato_agenzia_entrate = enriched.stato_agenzia_entrate
  // Metadata
  if (enriched.openapi_id) result.openapi_id = enriched.openapi_id

  // NEW: certified titolare + persone (soci + manager)
  if (enriched.titolare_best) {
    result.titolare = enriched.titolare_best.nomeCompleto
    result.ruolo_titolare = enriched.titolare_best.ruolo
    result.titolare_fonte = enriched.titolare_best.source === 'stakeholders' ? 'openapi_stakeholders' : 'openapi_shareholders'
    if (enriched.titolare_best.taxCode) result.codice_fiscale_titolare = enriched.titolare_best.taxCode
    if (enriched.titolare_best.dataNascita) result.data_nascita_titolare = enriched.titolare_best.dataNascita
    if (typeof enriched.titolare_best.eta === 'number') result.eta_titolare = String(enriched.titolare_best.eta)
    if (enriched.titolare_best.sesso) result.sesso_titolare = enriched.titolare_best.sesso
  }

  const persone: Array<Record<string, any>> = []
  for (const sh of (enriched.shareholders || [])) {
    if (!sh.nome || !sh.cognome) continue
    const nome = `${sh.nome.charAt(0).toUpperCase()}${sh.nome.slice(1).toLowerCase()} ${sh.cognome.charAt(0).toUpperCase()}${sh.cognome.slice(1).toLowerCase()}`
    persone.push({
      nome,
      ruolo: (enriched.shareholders?.length === 1) ? 'Socio Unico' : 'Socio',
      cf: sh.taxCode,
      quota: typeof sh.percentShare === 'number' ? `${sh.percentShare}%` : undefined,
    })
  }
  for (const m of (enriched.managers || [])) {
    if (!persone.find(p => String(p.nome).toLowerCase() === m.nomeCompleto.toLowerCase())) {
      persone.push({
        nome: m.nomeCompleto,
        ruolo: m.isLegalRep ? `${m.ruolo} (Legale Rappresentante)` : (m.ruolo || 'Dirigente'),
        cf: m.taxCode,
        data_nascita: m.dataNascita,
        eta: typeof m.eta === 'number' ? String(m.eta) : undefined,
        sesso: m.sesso,
      })
    }
  }
  if (persone.length > 0) {
    result.persone = persone
    if (!result.titolare) {
      const ROLE_PRIORITY: [RegExp, number][] = [
        [/socio\s*unico/i, 100],
        [/rappresentante\s*legale/i, 95],
        [/amministratore\s*delegato/i, 90],
        [/amministratore\s*unico/i, 85],
        [/presidente/i, 80],
        [/titolare/i, 75],
        [/amministratore/i, 60],
        [/socio/i, 20],
      ]
      let bestPerson: any = null
      let bestScore = 0
      for (const p of persone) {
        if (!p?.nome) continue
        let score = 10
        for (const [rx, s] of ROLE_PRIORITY) {
          if (rx.test(String(p.ruolo || ''))) {
            score = Math.max(score, s)
            break
          }
        }
        if (score > bestScore) {
          bestScore = score
          bestPerson = p
        }
      }
      if (bestPerson) {
        result.titolare = bestPerson.nome
        result.ruolo_titolare = bestPerson.ruolo || 'Socio'
        result.titolare_fonte = 'openapi_shareholders'
        if (bestPerson.cf) result.codice_fiscale_titolare = bestPerson.cf
        console.log(`[LEAD-REGISTRY] OpenAPI: promoted titolare from IT-advanced persone: "${bestPerson.nome}" (${bestPerson.ruolo})`)
      }
    }
  }

  console.log(`[LEAD-REGISTRY] OpenAPI: cost=€${enriched.cost_incurred_eur.toFixed(3)} (live=${enriched.live_calls}, cache=${enriched.cached_hits}), titolare="${result.titolare || 'n/a'}", persone=${persone.length}`)

  return Object.keys(result).length > 0 ? result : null
}

// ── Main route ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead } = body
  // Anti-loop flag: callers that will separately run person-lookup (company-lookup, person-lookup itself)
  // pass _skipPersonEnrichment=true so we don't double-call and don't recurse.
  const skipPersonEnrichment: boolean = body?._enablePersonEnrichment !== true

  const business_name = lead?.nome || lead?.azienda || lead?.business_name || ''
  const city = lead?.citta || lead?.city || ''
  const address = lead?.indirizzo || lead?.address || lead?.via || ''
  const category = lead?.categoria || lead?.category || ''
  const website = lead?.sito || lead?.website || ''

  if (!business_name) {
    return NextResponse.json({ found: false })
  }

  // ─── Step 1: Try backend for REAL Registro Imprese data ────────
  let backendData: Record<string, any> | null = null
  try {
    const res = await fetch(`${BACKEND_URL}/scrape-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name, city, website }),
      signal: AbortSignal.timeout(25000),
    })
    const data = (await res.json()) as any

    if (data?.found === true) {
      if (!data.sede_legale && address) data.sede_legale = address
      data.fonte = 'registro_imprese'
      // If we already have fatturato AND dipendenti, return immediately
      if (data.fatturato && data.dipendenti) {
        return NextResponse.json(data)
      }
      // Otherwise save and continue to supplement with CompanyReports.it
      backendData = data
    }
  } catch {
    // Backend non disponibile, continua
  }

  // ─── Step 2: Extract P.IVA from company website ───────────────
  // SKIP if website is a third-party platform (miodottore.it, paginegialle.it, etc.)
  // — the P.IVA on those pages belongs to the PLATFORM, not the business
  const PLATFORM_DOMAINS = ['miodottore.it','doctolib.it','paginegialle.it','paginebianche.it','tuttocitta.it','yelp.com','yelp.it','tripadvisor.it','tripadvisor.com','booking.com','airbnb.it','airbnb.com','subito.it','immobiliare.it','idealista.it','linkedin.com','facebook.com','instagram.com','youtube.com','twitter.com','tiktok.com','trustpilot.com','google.com','europages.it','kompass.com','hotfrog.it','cylex.it','virgilio.it','wix.com','wordpress.com','jimdo.com','weebly.com','shopify.com','etsy.com','amazon.it','amazon.com','ebay.it','ebay.com','topdoctors.it','dottori.it','medicitalia.it','pazienti.it','guidadottori.it','thefork.it','justeat.it','deliveroo.it','glovo.com','matrimonio.com','1240.it','12auto.it','1254.it','pronto.it','infoimprese.it','dnb.com','infocamere.it','registroimprese.it','companyreports.it','ufficiocamerale.it','cercaziende.it','guida-monaci.it','misterimprese.it','trovaaziende.it','risultati.it','nomeesatto.it','esattospa.it','reportaziende.it','italiaonline.it','informazione-aziende.it','getfound.it']
  const isThirdPartyPlatform = (() => {
    if (!website) return false
    try {
      const hostname = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '')
      return PLATFORM_DOMAINS.some(p => hostname === p || hostname.endsWith(`.${p}`))
    } catch { return false }
  })()

  // If website is a platform or missing, try to find the REAL company website via Google
  let realWebsite = website
  if ((!website || isThirdPartyPlatform) && business_name) {
    console.log(`[LEAD-REGISTRY] Website "${website || 'missing'}" is ${isThirdPartyPlatform ? 'a platform' : 'empty'} — searching for real website...`)
    try {
      const cleanName = business_name.replace(/['"]/g, '').trim()
      const googleQuery = encodeURIComponent(`"${cleanName}" ${city} sito ufficiale`)
      const googleHtml = await fetchHtmlSafe(`https://www.google.com/search?q=${googleQuery}&num=5&hl=it`, 6000)
      if (googleHtml.length > 200) {
        const urlMatches = googleHtml.match(/href="(https?:\/\/[^"]+)"/g) || []
        // STRONG filter: hostname must contain at least one company-name word (≥4 chars)
        const compWords = cleanName.toLowerCase()
          .replace(/[^a-z0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter((w: string) => w.length >= 4 && !/^(srl|srls|spa|sas|snc|società|societa|group|italia|italy|marco|andrea|luca|paolo|giuseppe|giovanni|antonio|mario|carlo|franco|roberto|stefano|massimo|alessandro|davide|francesco|fabio|matteo|simone|lorenzo|riccardo|cristian|daniele|michele|alberto|giorgio|sergio|claudio|gianluca|federica|chiara|anna|maria|laura|sara|valentina|giulia|elena|silvia|martina|alessandra|francesca|paola|daniela)$/i.test(w))
        for (const u of urlMatches) {
          const url = u.replace(/^href="/, '').replace(/"$/, '')
          try {
            const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
            if (PLATFORM_DOMAINS.some(p => h === p || h.endsWith(`.${p}`))) continue
            if (h.includes('google') || h.includes('gstatic') || h.includes('googleapis')) continue
            // Require hostname to contain at least one company-name word
            if (compWords.length > 0 && !compWords.some((w: string) => h.includes(w))) {
              console.log(`[LEAD-REGISTRY] REJECT "${h}" — does not contain any of [${compWords.join(',')}]`)
              continue
            }
            realWebsite = url
            console.log(`[LEAD-REGISTRY] Found real website: ${realWebsite}`)
            break
          } catch { /* skip invalid URL */ }
        }
      }
    } catch { /* Google search failed */ }
  }

  let websitePiva: string | null = null
  let websiteOwnerName: string | null = null
  let websiteFullRagioneSociale: string | null = null
  let websiteCF: string | null = null
  let websiteSedeLegale: string | null = null
  let websiteEmail: string | null = null
  let websitePhone: string | null = null
  let websiteFax: string | null = null
  let websiteLinkedin: string | null = null
  let websiteLinkedinTitolare: string | null = null
  let websiteInstagram: string | null = null
  let websiteFacebook: string | null = null
  let websiteTwitter: string | null = null
  let websiteYoutube: string | null = null
  // If backend already found a P.IVA, use it as fallback
  if (backendData?.partita_iva) {
    websitePiva = String(backendData.partita_iva).replace(/^IT\s*/, '').trim()
  }
  // Recalculate isThirdPartyPlatform with realWebsite
  const useWebsite = realWebsite && !(() => {
    try {
      const h = new URL(realWebsite!.startsWith('http') ? realWebsite! : `https://${realWebsite}`).hostname.replace(/^www\./, '')
      return PLATFORM_DOMAINS.some(p => h === p || h.endsWith(`.${p}`))
    } catch { return true }
  })()
  if (useWebsite && realWebsite) {
    const baseUrl = realWebsite.startsWith('http') ? realWebsite : `https://${realWebsite}`
    const origin = (() => { try { return new URL(baseUrl).origin } catch { return baseUrl } })()
    const mainHtml = await fetchHtmlSafe(baseUrl, 6000)
    const sitePiva = extractPivaFromHtml(mainHtml)
    if (sitePiva) websitePiva = sitePiva

    // Extract phone/email from homepage too
    if (mainHtml.length > 200) {
      const mainText = mainHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      // Phone from homepage
      const hrefTelM = mainHtml.match(/href="tel:([+\d\s.\-]+)"/i)
      if (hrefTelM?.[1]) {
        const cleaned = hrefTelM[1].replace(/[\s.\-]/g, '').replace(/^\+?39/, '+39 ')
        if (cleaned.replace(/\D/g, '').length >= 8) websitePhone = cleaned.trim()
      }
      if (!websitePhone) {
        const telM = mainText.match(/(?:TELEFONO|TEL|Tel\.?)[\/FAX\s:.\-]*(\+?39?\s*0\d[\d\s.\-]{6,12})/i)
        if (telM?.[1]) {
          const cleaned = telM[1].replace(/[\s.\-]/g, '').replace(/^\+?39/, '+39 ')
          if (cleaned.replace(/\D/g, '').length >= 8) websitePhone = cleaned.trim()
        }
      }
      // Email from homepage
      const mailtoM = mainHtml.match(/href="mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/i)
      if (mailtoM?.[1] && !mailtoM[1].toLowerCase().includes('noreply')) {
        websiteEmail = mailtoM[1].toLowerCase()
      }
      // Social media from homepage HTML (links in header/footer)
      const liCoMatch = mainHtml.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9._-]+\/?)/i)
      if (liCoMatch?.[1]) websiteLinkedin = liCoMatch[1]
      const liInMatch = mainHtml.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9._-]+\/?)/i)
      if (liInMatch?.[1] && !websiteLinkedinTitolare) websiteLinkedinTitolare = liInMatch[1]
      if (!websiteLinkedin && liInMatch?.[1]) websiteLinkedin = liInMatch[1]
      const igMatch = mainHtml.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)/i)
      if (igMatch?.[1]) websiteInstagram = igMatch[1]
      const fbMatch = mainHtml.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)/i)
      if (fbMatch?.[1]) websiteFacebook = fbMatch[1]
      const twMatch = mainHtml.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9._-]+\/?)/i)
      if (twMatch?.[1]) websiteTwitter = twMatch[1]
      const ytMatch = mainHtml.match(/href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|@|user)\/[a-zA-Z0-9._-]+\/?)/i)
      if (ytMatch?.[1]) websiteYoutube = ytMatch[1]
    }

    // Always scrape privacy + contatti + chi-siamo pages for PIVA + owner name
    const pages = ['/privacy-policy', '/privacy', '/contatti', '/contacts', '/chi-siamo', '/about', '/about-us', '/team']
    const fetches = await Promise.allSettled(pages.map(p => fetchHtmlSafe(`${origin}${p}`, 4000)))
    for (const r of fetches) {
      if (r.status === 'fulfilled' && r.value && r.value.length > 500) {
        const pageHtml = r.value
        // Strip HTML tags for text-based extraction (tags like <strong> break name regex)
        const pageText = pageHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        // Extract PIVA if not found yet
        if (!websitePiva) {
          const found = extractPivaFromHtml(pageHtml)
          if (found) websitePiva = found
        }
        // Helpers for name validation (shared by privacy-policy and chi-siamo extraction)
        const toTitleCase = (s: string) => s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        const NAME_JUNK = /seguito|specificato|previsto|indicato|presente|documento|informativa|trattamento|personali|consenso|normativa|regolamento|titolare|responsabile|interessato|garante|disposizione|finalita|modalita|comunicazione|profilazione|legittimo|necessario|obbligatorio|conservazione|opposizione|reclamo|diritto|revoca|cancellazione|rettifica|limitazione|accesso|pulizia|pulizie|cooperativa|impresa|societa|azienda|servizi|costruzioni/i
        const COMPANY_SUFFIXES = /\b(?:s\.?r\.?l\.?s?\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?s\.?|srl|srls|spa|sas|snc|ltd|llc|gmbh|inc|corp|group|holding|consorzio|coop|cooperativa|onlus|ets|associazione)\b/i
        const isValidName = (n: string) => {
          if (!n || n.length < 5 || n.length > 50) return false
          if (NAME_JUNK.test(n)) return false
          if (COMPANY_SUFFIXES.test(n)) return false
          const words = n.trim().split(/\s+/).filter(w => w.length > 1)
          if (words.length < 2 || words.length > 5) return false
          if (!words.every(w => /^[A-ZÀ-Ú]/.test(w))) return false
          if (!/^[A-Za-zÀ-ú\s'.-]+$/.test(n)) return false
          return true
        }
        // Extract owner name from "Titolare del Trattamento" section
        if (!websiteOwnerName) {
          const ownerPatterns = [
            /titolare\s+del\s+trattamento[\s\S]{0,400}?(?:da|è)[:\s]+([A-ZÀ-ÿ][A-Za-zÀ-ÿ\s'.,]+?(?:DI\s+)?[A-ZÀ-ÿ][A-Za-zÀ-ÿ\s'.]+?)(?:\s+con\s+sede|\s*,\s*\d|\s*-\s*(?:P\.?\s*I|C\.?\s*F)|\s*\.\s*P\.?\s*I)/i,
            /(?:resa\s+da|gestita\s+da|titolare[:\s]+)\s*([A-ZÀ-ÿ][A-Za-zÀ-ÿ\s'.,]+?(?:\s+DI\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ\s'.]+)?)(?:\s+con\s+sede|\s*,\s*\d|\s*-\s*(?:P\.?\s*I|C\.?\s*F))/i,
            /nella\s+persona\s+del\s+(?:Rappresentante\s+legale|Titolare|Amministratore)\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,4})/gi,
          ]
          for (const pat of ownerPatterns) {
            pat.lastIndex = 0
            const m = pat.exec(pageText)
            if (m?.[1]) {
              const raw = m[1].replace(/\s+/g, ' ').trim()
              // Extract person name from "IMPRESA X DI NOME COGNOME" pattern
              // Split by "DI" boundary and try each suffix from LAST to FIRST
              const diParts = raw.split(/\bDI\b/i)
              if (diParts.length >= 2) {
                for (let di = diParts.length - 1; di >= 1; di--) {
                  const after = diParts[di].trim()
                  if (!after) continue
                  let name = after.replace(/\s+/g, ' ').trim()
                  if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
                  if (isValidName(name)) { websiteOwnerName = name; break }
                }
              }
              // Save full ragione sociale
              if (raw.length > 5 && raw.length < 120) {
                websiteFullRagioneSociale = raw
              }
              break
            }
          }
          // Also try "nella persona del Rappresentante legale NAME" standalone
          if (!websiteOwnerName) {
            const rappM = pageText.match(/nella\s+persona\s+del\s+(?:Rappresentante\s+legale|Titolare|Amministratore)\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,3})/i)
            if (rappM?.[1]) {
              let name = rappM[1].trim()
              if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
              if (isValidName(name)) websiteOwnerName = name
            }
          }
        }
        // Extract Codice Fiscale (16 chars alphanumeric, Italian tax code)
        if (!websiteCF) {
          const cfPatterns = [
            /C\.?\s*F\.?\s*[:\s.\-]+([A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z])/gi,
            /codice\s*fiscale[:\s.\-]+([A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z])/gi,
          ]
          for (const pat of cfPatterns) {
            pat.lastIndex = 0
            const m = pat.exec(pageHtml)
            if (m?.[1]) { websiteCF = m[1].toUpperCase(); break }
          }
        }
        // Extract sede legale from privacy pages
        if (!websiteSedeLegale) {
          const sedeM = pageHtml.match(/sede\s+legale\s+(?:in|a|:)\s*([^,\n<]{10,80}(?:,\s*\d{5}\s+[A-Za-zÀ-ÿ\s]+(?:\([A-Z]{2}\))?)?)/i)
          if (sedeM?.[1]) websiteSedeLegale = sedeM[1].replace(/\s+/g, ' ').trim()
        }
        // Extract email from privacy pages
        if (!websiteEmail) {
          const emailM = pageHtml.match(/EMAIL\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
            || pageHtml.match(/e-?mail[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
          if (emailM?.[1] && !emailM[1].toLowerCase().includes('noreply') && !emailM[1].toLowerCase().includes('example')) {
            websiteEmail = emailM[1].toLowerCase()
          }
        }
        // Extract "Rappresentante legale" name
        if (!websiteOwnerName) {
          const rappM = pageHtml.match(/(?:rappresentante\s+legale|legale\s+rappresentante)\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+){1,3})/i)
          if (rappM?.[1]) websiteOwnerName = rappM[1].trim()
        }
        // Extract owner from "Chi siamo" / "About" pages — patterns like:
        // "Marco Alessi - Socio e legale rappresentante"
        // "fondato da Marco Alessi"
        // "il proprietario Marco Alessi"
        if (!websiteOwnerName) {
          const chiSiamoPatterns = [
            /([A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+){1,3})\s*[-–—]\s*(?:socio|legale\s+rappresentante|rappresentante\s+legale|proprietario|fondatore|titolare|amministratore|CEO|direttore)/i,
            /(?:socio\s+e\s+legale\s+rappresentante|rappresentante\s+legale|proprietario|fondatore|titolare|CEO|direttore\s+generale)\s+(?:di\s+.+?\s+)?(?:è|:)?\s*([A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+){1,3})/i,
            /(?:fondat[oa]\s+da|creat[oa]\s+da|guidat[oa]\s+da|dirett[oa]\s+da)\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+){1,3})/i,
            /(?:il\s+(?:proprietario|fondatore|titolare)|la\s+(?:proprietaria|fondatrice|titolare))\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+){1,3})/i,
            /(?:proprietario|fondatore|titolare)\s+(?:dell['a]\s+.+?\s+)?(?:è|:)\s*([A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+){1,3})/i,
            /(?:dirett[oa]\s+dall['a]?\s*(?:Ing\.?|Dott\.?(?:ssa)?|Avv\.?|Arch\.?|Geom\.?|Rag\.?|Prof\.?)?\s*)([A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zA-ZÀ-ÿ]+){1,3})/i,
          ]
          for (const pat of chiSiamoPatterns) {
            const m = pageText.match(pat)
            if (m?.[1]) {
              const name = m[1].trim()
              if (isValidName(name)) {
                websiteOwnerName = name
                console.log(`[LEAD-REGISTRY] Found owner "${name}" from website chi-siamo/about page`)
                break
              }
            }
          }
        }
        // Extract phone numbers from website (contatti pages especially)
        if (!websitePhone) {
          const phonePatterns = [
            /(?:TELEFONO|TEL|PHONE|Tel\.?|Telefono)[\/FAX\s:.\-]*(\+?39?\s*\d[\d\s.\-\/]{7,15})/i,
            /(?:tel|phone|telefono)[:\s]+(\+?39?\s*0\d[\d\s.\-]{6,12})/i,
            /href="tel:([+\d\s.\-]+)"/i,
          ]
          for (const pat of phonePatterns) {
            const m = pageText.match(pat)
            if (m?.[1]) {
              const cleaned = m[1].replace(/[\s.\-\/]/g, '').replace(/^\+?39/, '+39 ')
              if (cleaned.replace(/\D/g, '').length >= 8) { websitePhone = cleaned.trim(); break }
            }
          }
        }
        // Extract fax
        if (!websiteFax) {
          const faxM = pageText.match(/(?:FAX|Fax)[:\s.\-]+(\+?39?\s*\d[\d\s.\-]{7,15})/i)
          if (faxM?.[1]) {
            const cleaned = faxM[1].replace(/[\s.\-]/g, '').replace(/^\+?39/, '+39 ')
            if (cleaned.replace(/\D/g, '').length >= 8) websiteFax = cleaned.trim()
          }
        }
        // Extract general email from contact pages (not just privacy)
        if (!websiteEmail) {
          const emailPatterns = [
            /href="mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/i,
            /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
          ]
          for (const pat of emailPatterns) {
            const m = pageHtml.match(pat)
            if (m?.[1] && !m[1].toLowerCase().includes('noreply') && !m[1].toLowerCase().includes('example') && !m[1].toLowerCase().includes('sentry') && !m[1].toLowerCase().includes('wix') && !m[1].toLowerCase().includes('wordpress')) {
              websiteEmail = m[1].toLowerCase()
              break
            }
          }
        }
      }
    }
  }

  // ─── Step 2b: Google Search fallback for P.IVA by company name ──
  if (!websitePiva && business_name) {
    try {
      const cleanName = business_name.replace(/['"]/g, '').trim()
      const googleQuery = encodeURIComponent(`"${cleanName}" "partita iva" ${city}`)
      const googleHtml = await fetchHtmlSafe(`https://www.google.com/search?q=${googleQuery}&num=5&hl=it`, 6000)
      if (googleHtml.length > 2000) {
        // Look for 11-digit P.IVA patterns in search results
        const pivaMatches = googleHtml.match(/\b(\d{11})\b/g) || []
        // Validate: must start with valid Italian P.IVA prefix and appear near "partita iva" or "P.IVA"
        for (const candidate of pivaMatches) {
          // Skip obviously fake ones (all zeros, all same digit)
          if (/^(\d)\1{10}$/.test(candidate)) continue
          if (candidate.startsWith('0000')) continue
          // Verify via VIES before using
          const check = await verifyPivaVies(candidate)
          if (check?.valid) {
            websitePiva = candidate
            break
          }
        }
      }
    } catch { /* Google non raggiungibile */ }
  }

  // ─── Step 2c: CompanyReports.it search by name fallback ──
  if (!websitePiva && business_name) {
    try {
      const searchName = encodeURIComponent(business_name.replace(/['"]/g, '').trim())
      const searchHtml = await fetchHtmlSafe(`https://www.companyreports.it/search?q=${searchName}`, 8000)
      if (searchHtml.length > 3000) {
        // Extract P.IVA from search results links (format: /12345678901)
        // Also extract company names to validate against business_name
        const linkMatches = searchHtml.match(/href="\/(\d{11})"/g) || []
        // Extract ragione sociale near each link for name validation
        const nameNearLink = searchHtml.match(/<a[^>]*href="\/\d{11}"[^>]*>([^<]+)<\/a>/gi) || []
        const cleanBizName = business_name.replace(/['"]/g, '').trim()
        for (let li = 0; li < linkMatches.length; li++) {
          const candidatePiva = linkMatches[li].match(/(\d{11})/)?.[1]
          if (!candidatePiva) continue
          // If we can extract the name near this link, validate it
          if (nameNearLink[li]) {
            const linkText = nameNearLink[li].replace(/<[^>]+>/g, '').trim()
            if (linkText && !nameMatches(cleanBizName, linkText)) {
              console.log(`[LEAD-REGISTRY] Step 2c: SKIP CompanyReports P.IVA ${candidatePiva} — name "${linkText}" does not match "${cleanBizName}"`)
              continue
            }
          }
          websitePiva = candidatePiva
          console.log(`[LEAD-REGISTRY] Step 2c: Found P.IVA ${candidatePiva} from CompanyReports search`)
          break
        }
      }
    } catch { /* CompanyReports search non raggiungibile */ }
  }

  // ─── Step 2d: OpenAPI /IT-search fallback for P.IVA by name ──
  // Google Maps names often contain city + category (e.g. "Fotovoltaico SEASOLAR Padova").
  // Strip those tokens before searching so the brand name is used (e.g. "SEASOLAR").
  let pivaFromOpenApiSearch = false
  if (!websitePiva && business_name && isOpenApiPrimary()) {
    const queryCity = String(city || '').toLowerCase().trim()
    const queryCategory = String(category || lead?.categoria || lead?.category || '').toLowerCase().trim()
    const stripTokens = (name: string): string => {
      let s = name.replace(/['"]/g, '').trim()
      // Remove city token (whole word, case-insensitive)
      if (queryCity) s = s.replace(new RegExp(`\\b${queryCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
      // Remove each word of the category
      if (queryCategory) {
        for (const w of queryCategory.split(/\s+/).filter(w => w.length >= 4)) {
          s = s.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
        }
      }
      return s.replace(/\s+/g, ' ').trim()
    }
    const searchNameRaw = business_name.replace(/['"]/g, '').trim()
    const searchNameStripped = stripTokens(business_name)
    // Try the stripped (brand-only) variant first, then fall back to the full name
    const searchVariants = Array.from(new Set([searchNameStripped, searchNameRaw].filter(s => s && s.length >= 3)))
    for (const searchName of searchVariants) {
      console.log(`[LEAD-REGISTRY] Step 2d: OpenAPI /IT-search for "${searchName}" (P.IVA still missing)`)
      try {
        const searchRes = await searchByCompanyName(searchName)
        if (searchRes.success && searchRes.data?.length) {
          const hit = searchRes.data.find(h => {
            if (!nameMatches(searchName, h.ragione_sociale)) return false
            if (queryCity && h.citta && !h.citta.toLowerCase().includes(queryCity) && !queryCity.includes(h.citta.toLowerCase())) return false
            return true
          }) || searchRes.data.find(h => nameMatches(searchName, h.ragione_sociale))
          if (hit?.partita_iva) {
            console.log(`[LEAD-REGISTRY] Step 2d: FOUND P.IVA ${hit.partita_iva} for "${hit.ragione_sociale}" (city: ${hit.citta || 'n/a'})`)
            websitePiva = hit.partita_iva
            pivaFromOpenApiSearch = true
            break
          } else {
            console.log(`[LEAD-REGISTRY] Step 2d: OpenAPI /IT-search — no matching result for "${searchName}" (${searchRes.data.length} candidates)`)
          }
        } else {
          console.log(`[LEAD-REGISTRY] Step 2d: OpenAPI /IT-search returned 0 results for "${searchName}"`)
        }
      } catch (e: any) {
        console.log(`[LEAD-REGISTRY] Step 2d: OpenAPI /IT-search error: ${e?.message}`)
      }
    }
  }

  // ─── Step 3: VIES verification (official EU registry) ─────────
  let viesData: { valid: boolean; name?: string; address?: string } | null = null
  if (websitePiva) {
    viesData = await verifyPivaVies(websitePiva)
  }

  // ─── Step 4: Scrape ALL free data sources in PARALLEL ──────────
  const ragSociale = backendData?.ragione_sociale || business_name
  const [crData, riData, inipecPec, googleData] = await Promise.all([
    websitePiva ? scrapeCompanyReports(websitePiva) : null,
    websitePiva ? scrapeRegistroImprese(websitePiva) : null,
    business_name ? lookupInipecPec(business_name) : null,
    ragSociale ? googleScrapePecDipendenti(ragSociale) : null,
  ])

  // ─── Step 4b: OpenAPI.it Tier Smart Pro — certified Registro Imprese data ─
  // Trigger logic:
  //   - primary mode: always call (cached 180gg, gives certified titolare/soci/CF/data nascita)
  //   - fallback mode: call only if scrapers missed technical fields (legacy behavior)
  let oaData: Record<string, any> | null = null
  if (websitePiva) {
    const shouldCallPrimary = isOpenApiPrimary()
    const scraperGapsFallback = !crData?.fatturato || !crData?.codice_ateco || !crData?.dipendenti || !riData?.pec
    if (shouldCallPrimary || scraperGapsFallback) {
      const rawOa = await fetchOpenApiIt(websitePiva)
      // P.IVA is the authoritative identifier of the Italian Camera di Commercio registry.
      // If we queried OpenAPI by P.IVA, the result IS that company — no name guard needed.
      // Keep only a diagnostic log when ragione sociale diverges significantly (visibility, not rejection).
      oaData = rawOa
      if (rawOa && rawOa.ragione_sociale && business_name && !nameMatches(business_name, rawOa.ragione_sociale)) {
        console.log(`[LEAD-REGISTRY] Step 4b: OpenAPI accepted by P.IVA — names diverge: lead="${business_name}" vs OA="${rawOa.ragione_sociale}"`)
      } else if (rawOa) {
        console.log(`[LEAD-REGISTRY] Step 4b: OpenAPI accepted — "${rawOa.ragione_sociale}"`)
      }
    }
  }

  // ─── Step 5: Build profile from REAL verified sources ─────────
  const formaFromName = extractFormaGiuridica(business_name)

  const profile: Record<string, any> = {
    found: true,
    fonte: 'google_maps',
  }

  // Merge: backendData (base) < registroimprese < companyreports < OpenAPI.it — later wins
  const src = { ...backendData, ...riData, ...crData, ...oaData } as Record<string, any>

  // INIPEC PEC (free, always available for Italian companies)
  if (inipecPec && !src.pec) {
    src.pec = inipecPec
    src.pec_fonte = 'inipec'
  }
  // Google scraped PEC (fallback)
  if (googleData?.pec && !src.pec) {
    src.pec = googleData.pec
    src.pec_fonte = 'google'
  }
  // Google scraped dipendenti (fallback)
  if (googleData?.dipendenti && !src.dipendenti) {
    src.dipendenti = googleData.dipendenti
    src.dipendenti_fonte = 'google'
  }

  // Ragione sociale — registry sources or Google Maps name (privacy policy too fragile for this)
  profile.ragione_sociale = src.ragione_sociale || viesData?.name || business_name

  // Titolare / Referente
  // Priority order (highest → lowest trust):
  //   1. OpenAPI.it certified (Registro Imprese — legal representative or socio unico)
  //   2. Privacy policy scraped from the website
  // OpenAPI wins because it's certified Camera di Commercio data; privacy policies
  // are often outdated or list the company name itself as "titolare del trattamento".
  if (src.persone) profile.persone = src.persone
  if (!src.titolare && Array.isArray(src.persone) && src.persone.length > 0) {
    const ROLE_PRIORITY: [RegExp, number][] = [
      [/socio\s*unico/i, 100],
      [/rappresentante\s*legale/i, 95],
      [/amministratore\s*delegato/i, 90],
      [/amministratore\s*unico/i, 85],
      [/presidente/i, 80],
      [/titolare/i, 75],
      [/amministratore/i, 60],
      [/socio/i, 20],
    ]
    let bestPerson: any = null
    let bestScore = 0
    for (const p of src.persone) {
      if (!p?.nome) continue
      let score = 10
      for (const [rx, s] of ROLE_PRIORITY) {
        if (rx.test(String(p.ruolo || ''))) {
          score = Math.max(score, s)
          break
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestPerson = p
      }
    }
    if (bestPerson) {
      src.titolare = bestPerson.nome
      src.ruolo_titolare = bestPerson.ruolo || 'Socio'
      src.titolare_fonte = 'openapi_shareholders'
      if (bestPerson.cf) src.codice_fiscale_titolare = bestPerson.cf
      console.log(`[LEAD-REGISTRY] Titolare promoted from OpenAPI persone: "${bestPerson.nome}" (${bestPerson.ruolo})`)
    }
  }
  if (src.titolare) {
    profile.titolare = src.titolare
    profile.ruolo_titolare = src.ruolo_titolare
    profile.titolare_fonte = src.titolare_fonte || 'openapi_shareholders'
    if (src.codice_fiscale_titolare) {
      profile.codice_fiscale_titolare = src.codice_fiscale_titolare
      profile.cf_fonte = profile.titolare_fonte
    }
    if (src.data_nascita_titolare) profile.titolare_data_nascita = src.data_nascita_titolare
    if (src.eta_titolare) profile.titolare_eta = Number(src.eta_titolare)
    if (src.sesso_titolare) profile.titolare_sesso = src.sesso_titolare
    console.log(`[LEAD-REGISTRY] Titolare from OpenAPI (certified): "${src.titolare}" (${src.ruolo_titolare})`)
  }

  // Fallback to privacy policy scraping IF OpenAPI didn't provide titolare
  if (!profile.titolare && websiteOwnerName) {
    const ownerLower = websiteOwnerName.toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
    const companyLower = (profile.ragione_sociale || business_name || '').toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
    const companyWords = companyLower.split(/\s+/).filter((w: string) => w.length > 2)
    const ownerWords = ownerLower.split(/\s+/).filter((w: string) => w.length > 2)
    const isCompanyName = companyLower.includes(ownerLower) || ownerLower.includes(companyLower) ||
      (ownerWords.length > 0 && ownerWords.every((w: string) => companyLower.includes(w))) ||
      (companyWords.length > 0 && companyWords.filter((w: string) => ownerLower.includes(w)).length >= Math.min(2, companyWords.length))
    if (isCompanyName) {
      console.log(`[LEAD-REGISTRY] Skipping websiteOwnerName "${websiteOwnerName}" — matches company name "${profile.ragione_sociale || business_name}"`)
    } else {
      profile.titolare = websiteOwnerName
      profile.titolare_fonte = 'privacy_policy_sito'
    }
  }

  // Codice Fiscale titolare from privacy policy — only if OpenAPI didn't already provide one
  if (websiteCF && !profile.codice_fiscale_titolare) {
    profile.codice_fiscale_titolare = websiteCF
    profile.cf_fonte = 'privacy_policy_sito'
    // Parse birth date from CF: XXXYYY##M##ZZZZ => year=##, month=M, day=##
    const cfMonths: Record<string, number> = { A:1,B:2,C:3,D:4,E:5,H:6,L:7,M:8,P:9,R:10,S:11,T:12 }
    const yearDigits = parseInt(websiteCF.substring(6, 8), 10)
    const monthLetter = websiteCF.charAt(8).toUpperCase()
    const dayDigits = parseInt(websiteCF.substring(9, 11), 10)
    const month = cfMonths[monthLetter]
    if (month) {
      const day = dayDigits > 40 ? dayDigits - 40 : dayDigits // >40 = female
      const isFemale = dayDigits > 40
      const currentCentury = new Date().getFullYear() % 100
      const year = yearDigits > currentCentury ? 1900 + yearDigits : 2000 + yearDigits
      const age = new Date().getFullYear() - year
      profile.titolare_data_nascita = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
      profile.titolare_eta = age
      profile.titolare_sesso = isFemale ? 'F' : 'M'
    }
  }

  // Email from privacy policy (if not already known)
  if (websiteEmail && !src.pec) {
    profile.email_privacy = websiteEmail
  }

  // Sede legale
  if (src.sede_legale) {
    profile.sede_legale = src.sede_legale
  } else if (websiteSedeLegale) {
    profile.sede_legale = websiteSedeLegale
    profile.sede_legale_fonte = 'privacy_policy_sito'
  } else if (viesData?.address) {
    profile.sede_legale = viesData.address
    profile.sede_legale_verificata = true
  } else if (address) {
    profile.sede_legale = address
  }

  // P.IVA from website (REAL)
  if (websitePiva) {
    profile.partita_iva = websitePiva
    if (viesData?.valid) {
      profile.piva_verificata = true
      profile.fonte = 'vies_verificato'
    }
  }

  // Forma giuridica: merged sources > name extraction
  if (src.forma_giuridica) {
    profile.forma_giuridica = src.forma_giuridica
  } else if (formaFromName) {
    profile.forma_giuridica = formaFromName
  }

  // REAL fatturato & dipendenti — track exact source
  if (oaData?.fatturato) {
    profile.fatturato = oaData.fatturato
    if (oaData.fatturato_anno) profile.fatturato_anno = oaData.fatturato_anno
    profile.fatturato_fonte = 'openapi.it'
  } else if (crData?.fatturato) {
    profile.fatturato = crData.fatturato
    if (crData.fatturato_anno) profile.fatturato_anno = crData.fatturato_anno
    profile.fatturato_fonte = 'companyreports.it'
  } else if (backendData?.fatturato) {
    profile.fatturato = backendData.fatturato
    if (backendData.fatturato_anno) profile.fatturato_anno = backendData.fatturato_anno
    profile.fatturato_fonte = 'registro_imprese'
  }
  if (oaData?.dipendenti) {
    profile.dipendenti = oaData.dipendenti
    profile.dipendenti_fonte = 'openapi.it'
  } else if (crData?.dipendenti) {
    profile.dipendenti = crData.dipendenti
    profile.dipendenti_fonte = 'companyreports.it'
  } else if (riData?.dipendenti) {
    profile.dipendenti = riData.dipendenti
    profile.dipendenti_fonte = 'registro_imprese'
  } else if (googleData?.dipendenti) {
    profile.dipendenti = googleData.dipendenti
    profile.dipendenti_fonte = 'fonti_pubbliche'
  } else if (backendData?.dipendenti) {
    profile.dipendenti = backendData.dipendenti
    profile.dipendenti_fonte = 'registro_imprese'
  }
  if (src.costo_personale) profile.costo_personale = src.costo_personale
  if (src.capitale_sociale) profile.capitale_sociale = src.capitale_sociale
  if (src.utile_netto) profile.utile_netto = src.utile_netto
  if (src.patrimonio_netto) profile.patrimonio_netto = src.patrimonio_netto
  if (src.totale_attivo) profile.totale_attivo = src.totale_attivo
  if (src.ral_medio) profile.ral_medio = src.ral_medio
  if (src.classe_fatturato) profile.classe_fatturato = src.classe_fatturato

  // ATECO (REAL)
  if (src.codice_ateco) {
    profile.codice_ateco = src.codice_ateco
    if (src.descrizione_ateco) profile.descrizione_ateco = src.descrizione_ateco
    profile.fonte = 'registro_imprese'
  }

  // Extra fields from multiple sources
  if (src.codice_rea) profile.codice_rea = src.codice_rea
  if (src.pec) {
    profile.pec = src.pec
    profile.pec_fonte = src.pec_fonte || (oaData?.pec ? 'openapi.it' : riData?.pec ? 'registro_imprese' : inipecPec ? 'inipec' : 'registro_imprese')
  }
  if (src.data_costituzione) profile.data_costituzione = src.data_costituzione

  if (src.stato) profile.stato = src.stato

  // ── OpenAPI advanced fields passthrough ──
  if (src.storico_bilanci) profile.storico_bilanci = src.storico_bilanci
  if (typeof src.gps_lat === 'number' && typeof src.gps_lng === 'number') {
    profile.gps_lat = src.gps_lat
    profile.gps_lng = src.gps_lng
  }
  if (src.ateco_2022) profile.ateco_2022 = src.ateco_2022
  if (src.ateco_2007) profile.ateco_2007 = src.ateco_2007
  if (src.codice_sdi) {
    profile.codice_sdi = src.codice_sdi
    if (src.codice_sdi_timestamp) profile.codice_sdi_timestamp = src.codice_sdi_timestamp
  }
  if (src.gruppo_iva) profile.gruppo_iva = src.gruppo_iva
  if (src.forma_giuridica_codice) profile.forma_giuridica_codice = src.forma_giuridica_codice
  if (src.regione) profile.regione = src.regione
  if (src.codice_fiscale && !profile.codice_fiscale) profile.codice_fiscale = src.codice_fiscale
  if (src.citta && !profile.citta) profile.citta = src.citta
  if (src.provincia && !profile.provincia) profile.provincia = src.provincia
  if (src.cap && !profile.cap) profile.cap = src.cap
  if (src.sito_web && !profile.sito_web) profile.sito_web = src.sito_web
  if (src.data_registrazione) profile.data_registrazione = src.data_registrazione
  if (src.data_cessazione) profile.data_cessazione = src.data_cessazione
  if (src.stato_agenzia_entrate) profile.stato_agenzia_entrate = src.stato_agenzia_entrate
  if (src.openapi_id) profile.openapi_id = src.openapi_id

  // ─── Step 5c: registroaziende.it fallback for ATECO (direct HTML scrape, no GPT) ───
  const pivaForRA = (profile.partita_iva || websitePiva || '').replace(/\D/g, '')
  if (!profile.codice_ateco && pivaForRA.length === 11) {
    try {
      console.log(`[LEAD-REGISTRY] Step 5c: registroaziende.it scraper for ATECO — P.IVA ${pivaForRA}`)
      const raSearchUrl = `https://registroaziende.it/ricerca?q=${pivaForRA}`
      const raSearchRes = await fetch(raSearchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000), redirect: 'follow',
      })
      if (raSearchRes.ok) {
        const raSearchHtml = await raSearchRes.text()
        const raLinkM = raSearchHtml.match(/href="(\/azienda\/[^"]+)"/i)
        if (raLinkM) {
          const raPageUrl = `https://registroaziende.it${raLinkM[1]}`
          const raPageRes = await fetch(raPageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(8000), redirect: 'follow',
          })
          if (raPageRes.ok) {
            const raHtml = await raPageRes.text()
            // ATECO from og:description or href="/ateco/XX.XX.XX"
            const raOgDesc = raHtml.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] || ''
            const raAtecoM = raOgDesc.match(/Codice Ateco:\s*(\d{2}\.\d{2}\.\d{2})\s*:\s*([^"]+)/i)
            if (raAtecoM) {
              profile.codice_ateco = raAtecoM[1]
              profile.descrizione_ateco = raAtecoM[2].trim()
              profile.fonte = 'registroaziende.it'
              console.log(`[LEAD-REGISTRY] Step 5c: ATECO from registroaziende.it: ${raAtecoM[1]} — ${raAtecoM[2].trim()}`)
            } else {
              const raAtecoHref = raHtml.match(/\/ateco\/(\d{2}\.\d{2}\.\d{2})">([^<]+)/i)
              if (raAtecoHref) {
                profile.codice_ateco = raAtecoHref[1]
                profile.descrizione_ateco = raAtecoHref[2].trim()
                profile.fonte = 'registroaziende.it'
                console.log(`[LEAD-REGISTRY] Step 5c: ATECO from registroaziende.it href: ${raAtecoHref[1]}`)
              }
            }
            // City
            if (!profile.citta) {
              const raCityM = raOgDesc.match(/\)\s*-\s*([A-Z][A-Z\s]+?)(?:\s*\(|$)/i)
              if (raCityM) profile.citta = raCityM[1].trim()
            }
          }
        }
      }
    } catch (e: any) { console.log(`[LEAD-REGISTRY] Step 5c registroaziende error: ${e?.message}`) }
  }

  // ─── Step 6: GPT ONLY for ATECO if not found from real sources
  if (!profile.codice_ateco) {
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey && category) {
      try {
        const prompt = `Basandoti ESCLUSIVAMENTE sulla categoria Google Maps "${category}", qual è il codice ATECO più appropriato?
${!formaFromName ? `Stima anche la forma giuridica più probabile per "${business_name}".` : ''}
Rispondi SOLO con JSON: {"codice_ateco":"XX.XX.XX","descrizione_ateco":"descrizione"${!formaFromName ? ',"forma_giuridica":"..."' : ''}}`

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(8000),
        })

        const data = (await res.json()) as any
        const content = data?.choices?.[0]?.message?.content || '{}'
        const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

        if (parsed.codice_ateco) {
          profile.codice_ateco = parsed.codice_ateco
          if (parsed.descrizione_ateco) profile.descrizione_ateco = parsed.descrizione_ateco
          profile.ateco_stimato = true
        }
        if (!formaFromName && !profile.forma_giuridica && parsed.forma_giuridica) {
          profile.forma_giuridica = parsed.forma_giuridica
        }
      } catch {
        // GPT non disponibile
      }
    }
  }

  // ── OpenAPI "rich" flag: skip expensive Tavily/Gemini when OpenAPI gave core camerale data ──
  // Rich = OpenAPI returned at least ONE of the core camerale fields. Titolare may legitimately be
  // missing for SRLS without filed shareholders, so we don't require it here.
  const openApiRich = Boolean(oaData && (
    oaData.codice_ateco || oaData.forma_giuridica || oaData.fatturato || oaData.dipendenti
  ))
  if (openApiRich) {
    const richFields = [
      oaData?.codice_ateco && 'ATECO',
      oaData?.forma_giuridica && 'forma',
      oaData?.fatturato && 'fatturato',
      oaData?.dipendenti && 'dipendenti',
      oaData?.titolare_best && 'titolare',
    ].filter(Boolean).join(',')
    console.log(`[LEAD-REGISTRY] openApiRich=true (${richFields}) — skipping Tavily/Gemini camerale searches`)
  }

  // ─── Step 6b: Tavily Deep Enrichment (FREE — 1000 ricerche/mese) ──
  const tavilyKey = process.env.TAVILY_API_KEY
  const hasMissing = !profile.titolare || !profile.fatturato || !profile.dipendenti || !profile.capitale_sociale
  if ((hasMissing || openApiRich) && tavilyKey) {
    // When openApiRich, camerale searches (1/1a2/1b/1c/2) will be skipped inside — only social/insurance run
    const companyId = profile.ragione_sociale || business_name || ''
    const pivaStr = websitePiva || ''
    const openaiKey = process.env.OPENAI_API_KEY

    // ── TAVILY BUDGET CONTROL ──
    // Max calls allowed for lead-registry fallback
    let tavilyCallsCount = 0
    const MAX_TAVILY_CALLS = 5

    // Helper: single Tavily search (with retry on 429)
    async function tavilySearch(query: string, _onlyBestMatch = false, deep = false): Promise<string> {
      if (tavilyCallsCount >= MAX_TAVILY_CALLS) {
        console.log(`[LEAD-REGISTRY] Tavily budget reached (${MAX_TAVILY_CALLS} calls). Skipping query: "${query}"`)
        return ''
      }
      
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          tavilyCallsCount++
          const depth = deep ? 'advanced' : 'basic'
          console.log(`[LEAD-REGISTRY] Tavily API Call ${tavilyCallsCount}/${MAX_TAVILY_CALLS} (depth: ${depth}): "${query}"`)
          
          const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query, search_depth: depth, include_answer: false, max_results: 5 }),
            signal: AbortSignal.timeout(15000),
          })
          if (res.status === 429 && attempt === 0) {
            console.log(`[LEAD-REGISTRY] Tavily 429 rate limit — waiting 3s then retry...`)
            await new Promise(r => setTimeout(r, 3000))
            continue
          }
          if (!res.ok) {
            console.log(`[LEAD-REGISTRY] Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
            return ''
          }
          const data = await res.json()
          return (data.answer || '') + ' ' + (data.results || []).map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
        } catch (e: any) { console.log(`[LEAD-REGISTRY] Tavily error: ${e.message || e}`); return '' }
      }
      return ''
    }

    // Helper: GPT extract JSON from text
    async function gptExtract(text: string, extractPrompt: string): Promise<Record<string, any>> {
      if (!openaiKey) return {}
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: extractPrompt + '\n\nTESTO:\n' + text.slice(0, 5000) + '\n\nSOLO JSON.' }], temperature: 0, max_tokens: 1200 }),
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return {}
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content?.trim() || '{}'
        const m = content.match(/\{[\s\S]*\}/)
        return m ? JSON.parse(m[0]) : {}
      } catch { return {} }
    }

    // Helper: merge only missing fields — with aggressive junk filtering
    const JUNK_VALUES = ['nome e cognome', 'nome cognome', 'codice numerico', 'descrizione attività', "descrizione dell'attività", 'tipo di società', 'tipo società', 'importo', 'indirizzo completo', 'indirizzo pec', 'anno o data', 'numero p.iva', 'cf azienda', 'codice fiscale se', 'amministratore/socio', 'numero se noto', 'dettagli', 'eventuali sinistri', 'altre info', 'numero dipendenti', 'importo in euro', 'anno di riferimento', 'es. 100k', 'rischio 1', 'rischio 2', 'iso 9001', 'non trovato', 'non divulgato', 'non disponibile', 'n/d', 'null', 'numero p.iva', 'non specificato', 'non noto', 'sconosciuto', 'nessuno', 'none']
    function isJunkValue(v: any): boolean {
      if (v === null || v === undefined || v === '' || v === 0 || v === '0') return true
      if (typeof v === 'string') {
        const low = v.toLowerCase().trim()
        if (low.length < 2) return true
        if (JUNK_VALUES.some(j => low.includes(j))) return true
        // Filter out template-like values (contain "/" suggesting alternatives)
        if (low.includes('/') && low.length > 20) return true
        // Reject obvious GPT placeholder/example values
        if (/esempio|example|sample|placeholder|lorem|ipsum|12345678/i.test(low)) return true
        // Reject single generic words as ragione_sociale
        if (/^(risultati|ricerca|pagina|home|error|undefined|object|array)$/i.test(low)) return true
      }
      return false
    }
    const COMPANY_NAME_IN_PERSON_RX = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|società|societa|cooperativa|consorzio|fondazione|associazione|impresa|azienda|ditta)\b/i
    const PERSON_NAME_RX = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*){1,4}$/
    const isValidPersonEntry = (p: any): boolean => {
      const nome = String(p?.nome || '').trim()
      if (!nome || isJunkValue(nome)) return false
      if (!PERSON_NAME_RX.test(nome) || COMPANY_NAME_IN_PERSON_RX.test(nome)) return false
      if (/^[a-zà-ÿ]/.test(nome)) return false
      const ruolo = String(p?.ruolo || '').toLowerCase().trim()
      if (/^(n\/?a|non disponibile|non specificato|nessuno|null|undefined)$/.test(ruolo)) p.ruolo = null
      return true
    }
    // Sanity bounds for Tavily/GPT hallucinations — realistic for ~99% of Italian companies
    // Only ~20 IT companies exceed 10B € fatturato; top employers ~150k (Poste Italiane)
    // Edge cases (Stellantis, ENI) won't use Tavily fallback anyway — they're in Registro Imprese
    const MAX_REALISTIC_FATTURATO = 10_000_000_000 // 10B €
    const MAX_REALISTIC_UTILE = 2_000_000_000 // 2B €
    const MAX_REALISTIC_DIPENDENTI = 200_000
    const isHallucinatedNumber = (key: string, val: any): boolean => {
      if (val == null) return false
      const n = Number(String(val).replace(/[^\d]/g, ''))
      if (isNaN(n) || n === 0) return false
      if ((key === 'fatturato' || key === 'totale_attivo' || key === 'capitale_sociale' || key === 'costo_personale') && n > MAX_REALISTIC_FATTURATO) return true
      if (key === 'utile_netto' && n > MAX_REALISTIC_UTILE) return true
      if (key === 'dipendenti' && n > MAX_REALISTIC_DIPENDENTI) return true
      return false
    }

    function mergeTavily(extracted: Record<string, any>) {
      const PEC_DOMAIN_RX = /@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust|casellapec|comunicapec|cert\.cna|cgn\.it|puntopec|pecsicura|pecspecial|brodfrancese|open\.legalmail|gigapec)[a-z0-9.\-]*\.[a-z]{2,}$/i
      for (const [k, v] of Object.entries(extracted)) {
        if (isJunkValue(v)) continue
        // ATECO must be XX.XX.XX format — reject pure digits like "12345"
        if (k === 'codice_ateco' && typeof v === 'string' && !/^\d{2}\.\d{2}(\.\d{2})?$/.test(v.trim())) {
          console.log(`[LEAD-REGISTRY] REJECTED invalid ATECO format: "${v}"`)
          continue
        }
        if (isHallucinatedNumber(k, v)) {
          console.log(`[LEAD-REGISTRY] REJECTED hallucinated ${k}="${v}" (unrealistic for IT company)`)
          continue
        }
        // PEC must have a valid PEC domain — reject normal emails like info@azienda.it
        if (k === 'pec' && typeof v === 'string' && !PEC_DOMAIN_RX.test(v)) {
          console.log(`[LEAD-REGISTRY] REJECTED non-PEC email in PEC field: "${v}"`)
          // If it's a valid email, save it as regular email instead
          if (!profile.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) profile.email = v
          continue
        }
        // If email has PEC domain, move it to pec instead
        if (k === 'email' && typeof v === 'string' && PEC_DOMAIN_RX.test(v) && !profile.pec) {
          console.log(`[LEAD-REGISTRY] SWAP email→PEC: "${v}" has PEC domain`)
          profile.pec = v
          continue
        }
        if (k === 'persone' || k === 'soci' || k === 'amministratori') {
          if (Array.isArray(v) && v.length > 0) {
            // Filter out junk person entries
            const clean = v.filter(isValidPersonEntry)
            if (clean.length > 0 && !profile.persone) profile.persone = clean
          }
        } else if (!profile[k]) {
          profile[k] = v
        }
      }
    }

    let tavilyUsed = false

    // ── Step PRE-Tavily: Gemini 2.5 Flash Lite con Google Search grounding ──
    // Fonte primaria per dati camerali accurati. Se fallisce, Tavily fa da fallback COMPLETO (comportamento precedente intatto).
    if (openApiRich) {
      console.log(`[LEAD-REGISTRY] Step Gemini: SKIPPED (openApiRich)`)
    } else if (isGeminiEnabled()) {
      console.log(`[LEAD-REGISTRY] Step Gemini: grounded extraction for "${companyId}"`)
      try {
        const geminiData = await geminiExtractCompanyData({
          companyName: companyId,
          partitaIva: pivaStr || undefined,
          city: city || undefined,
        })
        if (geminiData && typeof geminiData === 'object') {
          const geminiFields = ['fatturato', 'utile_netto', 'totale_attivo', 'dipendenti',
            'codice_ateco', 'descrizione_ateco', 'sede_legale', 'pec', 'capitale_sociale',
            'data_costituzione', 'forma_giuridica', 'titolare', 'ruolo_titolare',
            'partita_iva', 'codice_fiscale', 'ragione_sociale', 'fatturato_anno',
            'telefono', 'email'] as const
          let filled = 0
          for (const k of geminiFields) {
            const v = (geminiData as any)[k]
            if (v == null || v === '') continue
            if (isHallucinatedNumber(k, v)) continue
            if (!profile[k]) { profile[k] = v; filled++ }
          }
          // sito_web separato (diverso mapping)
          if ((geminiData as any).sito_web && !profile.sito_web) {
            profile.sito_web = (geminiData as any).sito_web
            filled++
          }
          if (filled > 0) {
            console.log(`[LEAD-REGISTRY] Step Gemini: filled ${filled} fields`)
          }
        }
      } catch (e: any) {
        console.log(`[LEAD-REGISTRY] Step Gemini failed: ${e?.message || e}`)
      }
    }

    // ── Search 1: Visura / camerale (titolare, soci, ATECO, capitale) ──
    if (openApiRich) {
      console.log(`[LEAD-REGISTRY] Search 1 (visura): SKIPPED (openApiRich)`)
    } else if (!profile.titolare || !profile.codice_ateco) {
      const q1 = `"${companyId}" ${pivaStr} visura camerale rappresentante legale amministratore delegato titolare soci ATECO`
      const text1 = await tavilySearch(q1, false, true)
      if (text1.length > 50) {
        const ext1 = await gptExtract(text1, `Estrai i dati della visura camerale per "${companyId}". IMPORTANTE: il "titolare" deve essere il RAPPRESENTANTE LEGALE o AMMINISTRATORE DELEGATO (chi gestisce e firma per l'azienda), NON un semplice socio. JSON:
{"titolare":"nome e cognome del RAPPRESENTANTE LEGALE o AMMINISTRATORE DELEGATO (NON un semplice socio)","titolare_ruolo":"ruolo esatto (es: Rappresentante Legale, Amministratore Delegato, Titolare)","codice_ateco":"codice numerico ATECO","descrizione_ateco":"descrizione attività","forma_giuridica":"tipo società","capitale_sociale":"importo","sede_legale":"indirizzo completo con CAP e città","data_costituzione":"anno o data","pec":"indirizzo PEC","partita_iva":"numero P.IVA","codice_fiscale":"CF azienda","persone":[{"nome":"Nome Cognome","ruolo":"Rappresentante Legale / Amministratore Delegato / Amministratore Unico / Socio / Titolare (specifica il ruolo ESATTO)","cf":"codice fiscale se disponibile","quota":"% se socio"}]}`)
        // Validate titolare is a person name, not company
        if (ext1.titolare) {
          const compSuffix = /\b(?:s\.?r\.?l\.?s?\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srl|srls|spa|sas|snc|ltd|llc|gmbh)\b/i
          if (compSuffix.test(ext1.titolare) || ext1.titolare === 'Non divulgato') delete ext1.titolare
          // Also check if titolare matches company name (e.g., "Alessi Lino" for "ALESSI LINO S.R.L.")
          if (ext1.titolare) {
            const tLow = ext1.titolare.toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
            const cLow = (profile.ragione_sociale || business_name || '').toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
            const tWords = tLow.split(/\s+/).filter((w: string) => w.length > 2)
            if (tWords.length > 0 && tWords.every((w: string) => cLow.includes(w))) {
              console.log(`[LEAD-REGISTRY] Search 1: Skipping titolare "${ext1.titolare}" — matches company name`)
              delete ext1.titolare
            }
          }
        }
        mergeTavily(ext1)
        if (ext1.titolare && profile.titolare === ext1.titolare) profile.titolare_fonte = 'tavily'
        tavilyUsed = true

        // ── Smart titolare selection: prefer person with most authoritative role ──
        if (Array.isArray(profile.persone) && profile.persone.length >= 1) {
          const ROLE_PRIORITY: [RegExp, number][] = [
            [/rappresentante\s*legale/i, 100],
            [/amministratore\s*delegato/i, 90],
            [/presidente/i, 85],
            [/direttore\s*(?:generale|tecnico)/i, 80],
            [/amministratore\s*unico/i, 75],
            [/titolare/i, 70],
            [/amministratore/i, 65],
            [/fondatore/i, 40],
            [/proprietario/i, 55],
            [/socio/i, 20],
          ]
          const roleScore = (r: string) => {
            if (!r) return 0
            let best = 0
            for (const [rx, s] of ROLE_PRIORITY) { if (rx.test(r)) best = Math.max(best, s) }
            return best
          }
          let bestPerson: any = null
          let bestScore = 0
          const compLow = (profile.ragione_sociale || business_name || '').toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
          for (const p of profile.persone) {
            if (!p?.nome || isJunkValue(p.nome)) continue
            const pLow = String(p.nome).toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
            const pWords = pLow.split(/\s+/).filter((w: string) => w.length > 2)
            if (pWords.length > 0 && pWords.every((w: string) => compLow.includes(w))) continue // skip company-name matches
            const sc = roleScore(p.ruolo || '')
            if (sc > bestScore) { bestScore = sc; bestPerson = p }
          }
          if (bestPerson && bestScore >= 50) {
            const currentTit = String(profile.titolare || '').toLowerCase()
            const bestName = String(bestPerson.nome).toLowerCase()
            if (currentTit !== bestName) {
              console.log(`[LEAD-REGISTRY] Smart titolare: "${bestPerson.nome}" (score=${bestScore}, role="${bestPerson.ruolo}") OVERRIDES "${profile.titolare}"`)
              profile.titolare = bestPerson.nome
              profile.ruolo_titolare = bestPerson.ruolo || profile.ruolo_titolare
              profile.titolare_fonte = 'tavily_persone_role_priority'
            }
          }
        }
      }
    }

    // ── Search 1a2: Cross-verify titolare — cerca specificamente il Rappresentante Legale ──
    // Anche se abbiamo trovato un titolare, verifichiamo se è il rappresentante legale (più autorevole)
    if (openApiRich) {
      // Skip: OpenAPI titolare is already from Camera di Commercio — no Tavily cross-check needed
    } else if (profile.titolare && tavilyKey) {
      const currentRole = String(profile.ruolo_titolare || '').toLowerCase()
      const isAlreadyRL = /rappresentante\s*legale/i.test(currentRole)
      if (!isAlreadyRL) {
        const q1a2 = `"${companyId}" ${pivaStr} "rappresentante legale" OR "legale rappresentante" nome cognome`
        const text1a2 = await tavilySearch(q1a2)
        if (text1a2.length > 50) {
          const ext1a2 = await gptExtract(text1a2, `Chi è il RAPPRESENTANTE LEGALE di "${companyId}"? Il rappresentante legale è chi firma e rappresenta legalmente l'azienda. Se ci sono più persone, scegli quella con la carica più importante (Rappresentante Legale > Amministratore Delegato > Presidente). IMPORTANTE: elenca TUTTE le persone trovate. JSON:
{"rappresentante_legale":"nome e cognome del rappresentante legale","ruolo":"ruolo esatto","persone":[{"nome":"Nome Cognome","ruolo":"ruolo esatto (Rappresentante Legale / Amministratore Delegato / Socio / etc.)"}]}`)
          const rlName = ext1a2.rappresentante_legale
          if (rlName && !isJunkValue(rlName)) {
            const compSuffix = /\b(?:s\.?r\.?l\.?s?\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srl|srls|spa|sas|snc)\b/i
            const cLow = (profile.ragione_sociale || business_name || '').toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
            const rLow = rlName.toLowerCase().replace(/[^a-zàèéìòù\s]/gi, '').trim()
            const rWords = rLow.split(/\s+/).filter((w: string) => w.length > 2)
            const isCompName = rWords.length > 0 && rWords.every((w: string) => cLow.includes(w))
            if (!compSuffix.test(rlName) && !isCompName && rLow !== String(profile.titolare).toLowerCase()) {
              console.log(`[LEAD-REGISTRY] Search 1a2: Found Rappresentante Legale "${rlName}" — OVERRIDES current titolare "${profile.titolare}"`)
              profile.titolare = rlName
              profile.ruolo_titolare = ext1a2.ruolo || 'Rappresentante Legale'
              profile.titolare_fonte = 'tavily_rl_verification'
            }
          }
          // Merge any new persone into the list
          if (Array.isArray(ext1a2.persone) && ext1a2.persone.length > 0) {
            if (!profile.persone) profile.persone = []
            for (const p of ext1a2.persone) {
              if (!p?.nome || isJunkValue(p.nome)) continue
              const existing = (profile.persone as any[]).find((e: any) => e?.nome && String(e.nome).toLowerCase() === String(p.nome).toLowerCase())
              if (!existing) (profile.persone as any[]).push(p)
            }
          }
        }
        tavilyUsed = true
      }
    }

    // ── Search 1b: Titolare fallback — ricerca mirata se Search 1 non ha trovato ──
    if (!profile.titolare) {
      const q1b = `"${companyId}" ${pivaStr} titolare rappresentante legale amministratore linkedin.com ufficiocamerale.it`
      const text1b = await tavilySearch(q1b)
      if (text1b.length > 50) {
        const ext1b = await gptExtract(text1b, `Cerca il TITOLARE / RAPPRESENTANTE LEGALE / AMMINISTRATORE UNICO dell'azienda "${companyId}"${pivaStr ? ` (P.IVA: ${pivaStr})` : ''}.
Il titolare è chi GESTISCE e RAPPRESENTA legalmente l'azienda. Cerca su LinkedIn, ufficiocamerale.it, registroimprese.it.
JSON:
{"titolare":"nome e cognome","titolare_ruolo":"Titolare / Rappresentante Legale / Amministratore Unico","linkedin_titolare":"URL LinkedIn se trovato","persone":[{"nome":"Nome Cognome","ruolo":"ruolo"}]}`)
        const compSuffix = /\b(?:s\.?r\.?l\.?s?\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srl|srls|spa|sas|snc|ltd|llc|gmbh)\b/i
        if (ext1b.titolare && !isJunkValue(ext1b.titolare) && !compSuffix.test(ext1b.titolare)) {
          profile.titolare = ext1b.titolare
          profile.titolare_fonte = 'tavily'
          if (ext1b.titolare_ruolo) profile.ruolo_titolare = ext1b.titolare_ruolo
          if (ext1b.linkedin_titolare && !isJunkValue(ext1b.linkedin_titolare)) {
            if (validateLinkedInWithContext(String(ext1b.linkedin_titolare), String(ext1b.titolare), { text: text1b, companyName: companyId, piva: pivaStr, city })) {
              profile.linkedin_titolare = ext1b.linkedin_titolare
            } else {
              console.log(`[LEAD-REGISTRY] Search 1b: REJECTED unrelated LinkedIn URL "${ext1b.linkedin_titolare}" for "${ext1b.titolare}" — name/country/company mismatch`)
            }
          }
        }
        if (Array.isArray(ext1b.persone) && ext1b.persone.length > 0 && !profile.persone) {
          const clean = ext1b.persone.filter((p: any) => p?.nome && !isJunkValue(p.nome))
          if (clean.length > 0) profile.persone = clean
        }
        tavilyUsed = true
      }
    }

    // ── Search 1c: Titolare last resort — cerca chi è il fondatore/proprietario ──
    if (!profile.titolare) {
      const q1c = `"${companyId}" chi è il titolare fondatore proprietario`
      const text1c = await tavilySearch(q1c)
      if (text1c.length > 50) {
        const ext1c = await gptExtract(text1c, `Chi è il titolare/fondatore/proprietario di "${companyId}"? IMPORTANTE: restituisci il nome SOLO se è ESPLICITAMENTE menzionato come titolare/fondatore/proprietario di "${companyId}" nel testo. Se non è chiaro o se il testo parla di altre aziende, restituisci null. JSON: {"titolare":"nome e cognome","titolare_ruolo":"ruolo"}`)
        const compSuffix = /\b(?:s\.?r\.?l\.?s?\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srl|srls|spa|sas|snc|ltd|llc|gmbh)\b/i
        if (ext1c.titolare && !isJunkValue(ext1c.titolare) && !compSuffix.test(ext1c.titolare)) {
          // STRICT VALIDATION: the name must actually appear in the Tavily text
          // This prevents GPT hallucinations of famous entrepreneurs (e.g. "Nicolas G. Hayek")
          const titLow = String(ext1c.titolare).toLowerCase()
          const textLow = text1c.toLowerCase()
          const titParts = titLow.split(/\s+/).filter(w => w.length >= 3)
          const nameInText = titParts.length > 0 && titParts.every(w => textLow.includes(w))
          // Also check proximity: the company name must appear near the titolare name
          const companyLow = companyId.toLowerCase()
          let properlyLinked = false
          if (nameInText) {
            // Find position of company name and titolare name — must be within 500 chars of each other
            const compIdx = textLow.indexOf(companyLow.split(/\s+/)[0])
            const titIdx = textLow.indexOf(titParts[0])
            if (compIdx >= 0 && titIdx >= 0 && Math.abs(compIdx - titIdx) < 500) {
              properlyLinked = true
            }
          }
          if (properlyLinked) {
            profile.titolare = ext1c.titolare
            profile.titolare_fonte = 'tavily'
            if (ext1c.titolare_ruolo) profile.ruolo_titolare = ext1c.titolare_ruolo
          } else {
            console.log(`[LEAD-REGISTRY] Search 1c: REJECTED hallucinated titolare "${ext1c.titolare}" — name not linked to "${companyId}" in Tavily text`)
          }
        }
        tavilyUsed = true
      }
    }

    // ── Search 2: Bilancio / dati finanziari ──
    if (openApiRich && profile.fatturato && profile.dipendenti) {
      console.log(`[LEAD-REGISTRY] Search 2 (bilancio): SKIPPED (openApiRich)`)
    } else if (!profile.fatturato || !profile.dipendenti) {
      const q2 = `"${companyId}" ${pivaStr} bilancio fatturato ricavi dipendenti utile netto`
      const text2 = await tavilySearch(q2, false, true)
      if (text2.length > 50) {
        const ext2 = await gptExtract(text2, `Estrai i dati finanziari per "${companyId}". JSON:
{"fatturato":"importo in euro dell'ultimo bilancio","dipendenti":"numero dipendenti","utile_netto":"importo","totale_attivo":"importo","fatturato_anno":"anno di riferimento","classe_fatturato":"es. 100K-500K o 1M-5M","costo_personale":"importo","capitale_sociale":"importo"}`)
        // Add fonte tracking
        if (ext2.fatturato && !profile.fatturato) { mergeTavily(ext2); profile.fatturato_fonte = 'tavily' }
        else if (ext2.dipendenti && !profile.dipendenti) { mergeTavily(ext2); profile.dipendenti_fonte = 'tavily' }
        else mergeTavily(ext2)
        tavilyUsed = true
      }
    }

    // ── Search 3 DISABILITATA ──
    // Era la fonte di allucinazioni GPT (ISO 9001/SOA su SRLS, rischi_specifici
    // generici, note_broker auto-generate). I campi non sono più mostrati in UI
    // — tenerla attiva sarebbe solo uno spreco di credito Tavily + token GPT.
    // L'intelligence reale arriva ora da Registro Imprese (forma giuridica,
    // bilanci, persone, CF) via computeTrigger/Financial/Titolare/RiskConcentration.
    // Per riattivarla in futuro servirà verificare le certificazioni contro
    // Accredia (registro pubblico) prima di mostrarle.

    if (isInvalidPersonName(profile.titolare)) {
      delete profile.titolare
      delete profile.ruolo_titolare
      delete profile.titolare_fonte
    }

    // If titolare was found but not in persone array, add them (same logic as company-lookup)
    if (profile.titolare && Array.isArray(profile.persone)) {
      const titName = String(profile.titolare).toLowerCase()
      const alreadyInList = profile.persone.some((p: any) => p?.nome && String(p.nome).toLowerCase() === titName)
      if (!alreadyInList) {
        (profile.persone as any[]).unshift({ nome: profile.titolare, ruolo: profile.ruolo_titolare || 'Titolare / Rappresentante Legale' })
      }
    } else if (profile.titolare && !profile.persone) {
      profile.persone = [{ nome: profile.titolare, ruolo: profile.ruolo_titolare || 'Titolare / Rappresentante Legale' }]
    }

    // ── Search 4: Titolare profile enrichment (LinkedIn, background professionale) ──
    console.log(`[LEAD-REGISTRY] Search 4 check: titolare="${profile.titolare}" tavilyKey=${!!tavilyKey} openaiKey=${!!openaiKey}`)
    if (profile.titolare && !isInvalidPersonName(profile.titolare) && tavilyKey && openaiKey) {
      const titName = String(profile.titolare)
      const compId = profile.ragione_sociale || business_name || ''
      const q4 = `"${titName}" "${compId}" linkedin profilo professionale curriculum`
      console.log(`[LEAD-REGISTRY] Search 4: query="${q4}"`)
      const text4 = await tavilySearch(q4)
      console.log(`[LEAD-REGISTRY] Search 4: text4 length=${text4.length}`)
      if (text4.length > 50) {
        const ext4 = await gptExtract(text4, `Cerca il profilo LinkedIn di "${titName}" che lavora presso "${compId}".
ATTENZIONE: Restituisci SOLO dati trovati ESPLICITAMENTE nel testo. NON inventare URL LinkedIn. Se non trovi il profilo LinkedIn, lascia null.
JSON:
{"linkedin":"URL LinkedIn TROVATO nel testo o null","ruolo":"ruolo/carica attuale (es. Amministratore Unico, Socio Accomandatario, CEO) se esplicito o null"}`)
        if (ext4.linkedin && typeof ext4.linkedin === 'string' && ext4.linkedin.includes('linkedin.com/') && !isJunkValue(ext4.linkedin)) {
          if (validateLinkedInWithContext(String(ext4.linkedin), titName, { text: text4, companyName: compId, piva: pivaStr, city })) {
            profile.linkedin_titolare = ext4.linkedin
          } else {
            console.log(`[LEAD-REGISTRY] Search 4: REJECTED unrelated LinkedIn URL "${ext4.linkedin}" for "${titName}" — name/country/company mismatch`)
          }
        }
        if (ext4.ruolo && !isJunkValue(ext4.ruolo)) profile.ruolo_titolare = ext4.ruolo
        // bio/seniority/formazione/esperienze/competenze/instagram/facebook del
        // titolare RIMOSSI: dati curriculum marketing, non consulenziali per un
        // broker assicurativo. Età/CF/succession ora derivati da Titolare CF.
        console.log(`[LEAD-REGISTRY] Search 4 results: linkedin=${profile.linkedin_titolare || 'none'} ruolo=${profile.ruolo_titolare || 'none'}`)
        tavilyUsed = true
      }

      // ── Search 4b: LinkedIn-specific fallback solo se LinkedIn non ancora trovato ──
      if (!profile.linkedin_titolare) {
        const q4b = `site:linkedin.com/in "${titName}" "${compId}"`
        console.log(`[LEAD-REGISTRY] Search 4b: LinkedIn-specific query="${q4b}"`)
        const text4b = await tavilySearch(q4b)
        console.log(`[LEAD-REGISTRY] Search 4b: text4b length=${text4b.length}`)
        if (text4b.length > 50) {
          const ext4b = await gptExtract(text4b, `Trova SOLO il profilo LinkedIn di "${titName}" che lavora presso "${compId}".
ATTENZIONE: Restituisci SOLO l'URL LinkedIn ESATTO trovato nel testo. NON inventare URL.
JSON:
{"linkedin":"URL LinkedIn completo (https://www.linkedin.com/in/...)","ruolo":"titolo lavorativo attuale se esplicito o null"}`)
          if (ext4b.linkedin && typeof ext4b.linkedin === 'string' && ext4b.linkedin.includes('linkedin.com/in/') && !isJunkValue(ext4b.linkedin)) {
            if (validateLinkedInWithContext(String(ext4b.linkedin), titName, { text: text4b, companyName: compId, piva: pivaStr, city })) {
              profile.linkedin_titolare = ext4b.linkedin
            } else {
              console.log(`[LEAD-REGISTRY] Search 4b: REJECTED unrelated LinkedIn URL "${ext4b.linkedin}" for "${titName}" — name/country/company mismatch`)
            }
          }
          if (ext4b.ruolo && !isJunkValue(ext4b.ruolo) && !profile.ruolo_titolare) profile.ruolo_titolare = ext4b.ruolo
          // bio/esperienze/formazione/competenze RIMOSSE (non più mostrate in UI).
          console.log(`[LEAD-REGISTRY] Search 4b results: linkedin=${profile.linkedin_titolare || 'none'}`)
        }
        tavilyUsed = true
      }
    }

    if (tavilyUsed) {
      profile.ai_enriched = true
      profile.ai_fonti = ['Tavily (ricerca web)']
    }
  }

  // ─── Step 7: Rischio Territoriale (GRATIS — dati Protezione Civile) ──
  const cityForRisk = city || profile.sede_legale || ''
  if (cityForRisk) {
    const territorial = getTerritorialRisk(cityForRisk)
    if (territorial.zona_sismica) {
      profile.rischio_territoriale = territorial
    }
  }

  // ─── Step 8: Obblighi Assicurativi ATECO (GRATIS — normativa INAIL/IVASS) ──
  const atecoIns = getAtecoInsurance(profile.codice_ateco || null, category || null)
  if (atecoIns) {
    profile.obblighi_assicurativi = atecoIns
  }

  // ─── Step 9: Classificazione dimensionale EU + Gap Analysis + Stima Premi ──
  const parseFatturato = (f: any): number | null => {
    if (!f) return null
    let s = String(f)
    // Strip year suffixes like "nel 2024", "anno 2023", "(2024)" before digit extraction
    s = s.replace(/\b(?:nel|anno|year|esercizio)\s*\d{4}\b/gi, '')
    s = s.replace(/\(\d{4}\)/g, '')
    // Strip currency symbols and text
    s = s.replace(/[€$]/g, '').replace(/\b(?:euro|eur)\b/gi, '')
    const n = Number(s.replace(/[^\d]/g, ''))
    return isNaN(n) || n === 0 ? null : n
  }
  const parseDipendenti = (d: any): number | null => {
    if (!d) return null
    const s = String(d).match(/\d+/)
    return s ? parseInt(s[0], 10) : null
  }

  const fatNum = parseFatturato(profile.fatturato)
  const dipNum = parseDipendenti(profile.dipendenti)

  // Classificazione dimensionale
  profile.classificazione_eu = classifyCompanySize(fatNum, dipNum)

  // Insurance Gap Analysis
  profile.gap_analysis = analyzeInsuranceGaps(
    fatNum,
    dipNum,
    profile.forma_giuridica || null,
    profile.codice_ateco || null,
    category || null,
    profile.rischio_territoriale?.zona_sismica || null,
    profile.rischio_territoriale?.rischio_idrogeologico || null,
    !!(profile.pec),
    !!website,
  )

  // stima_premio RIMOSSA: era benchmark ATECO×INAIL grezzo senza valore
  // consulenziale reale (un broker medio ha tariffari interni più precisi).
  // La priorità commerciale sostituiva il benchmark è ora in
  // bisogni_assicurativi_verificati.priorita_commerciale con score + reasons.

  profile.bisogni_assicurativi_verificati = buildInsuranceNeedsProfile({
    profile,
    category: category || null,
    website: website || null,
    atecoInsurance: atecoIns || null,
    gapAnalysis: profile.gap_analysis || null,
  })

  // Save real website to profile (validated, not a platform)
  if (useWebsite && realWebsite) {
    profile.sito = realWebsite
  } else if (website && !isThirdPartyPlatform) {
    profile.sito = website
  }

  // Save phone/fax from website scraping
  if (websitePhone) {
    profile.telefono = websitePhone
    profile.telefono_fonte = 'sito_web'
  }
  if (websiteFax) {
    profile.fax = websiteFax
  }
  // Email from website (general contact email, not just privacy)
  if (websiteEmail) {
    if (!profile.email_privacy) profile.email_privacy = websiteEmail
    if (!profile.email) profile.email = websiteEmail
  }
  // Social media from website scraping
  if (websiteLinkedin && !profile.linkedin) profile.linkedin = websiteLinkedin
  if (websiteLinkedinTitolare && !profile.linkedin_titolare) profile.linkedin_titolare = websiteLinkedinTitolare
  if (websiteInstagram && !profile.instagram) profile.instagram = websiteInstagram
  if (websiteFacebook && !profile.facebook) profile.facebook = websiteFacebook
  if (websiteTwitter && !profile.twitter) profile.twitter = websiteTwitter
  if (websiteYoutube && !profile.youtube) profile.youtube = websiteYoutube

  // ─── Person-lookup enrichment for titolare (SAME pipeline as Cerca Referente) ───
  // Brings: trigger_finanziari, segnali_comportamentali, stima_capacita, social titolare,
  // legami_familiari, proprieta_immobiliari, ambiti_protection, priorita_commerciale, ecc.
  // Skipped when called from company-lookup / person-lookup (they handle enrichment separately).
  if (!skipPersonEnrichment && profile.titolare && typeof profile.titolare === 'string' && !isInvalidPersonName(profile.titolare)) {
    const titName = profile.titolare.trim()
    const compName = profile.ragione_sociale || business_name || ''
    if (titName.length >= 3) {
      console.log(`[LEAD-REGISTRY] Calling person-lookup for titolare "${titName}" @ "${compName}" to enrich profile`)
      try {
        const origin = req.headers.get('host') ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}` : 'http://localhost:3000'
        const plRes = await fetch(`${origin}/api/person-lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `${titName} ${compName}` }),
          signal: AbortSignal.timeout(240000),
        })
        if (plRes.ok) {
          const plData = await plRes.json()
          if (plData && (plData.nome_completo || plData.nome || plData.azienda)) {
            const nj = (v: any) => {
              if (!v) return false
              const s = String(v).trim().toLowerCase()
              if (!s || s === 'null' || s === 'undefined' || s === 'non disponibile' || s === 'non specificato' || s === 'none') return false
              if (/^n\/?a/i.test(s) || /\bn\/?a\b/i.test(s)) return false
              return true
            }
            // Anti-omonimo: verify person-lookup data references our company
            const compClean = String(compName).toLowerCase().replace(/[^a-zà-ú\s]/gi, '').trim()
            const compWords = compClean.split(/\s+/).filter((w: string) => w.length > 3 && !/^(srl|srls|spa|sas|snc|societa|società)$/i.test(w))
            const plCheckText = [plData.esperienze_precedenti, plData.descrizione, plData.note, plData.azienda, plData.colleghi_noti]
              .filter(Boolean).map((v: any) => typeof v === 'string' ? v : JSON.stringify(v)).join(' ').toLowerCase()
            const matchesCompany = compWords.length === 0 || compWords.some((w: string) => plCheckText.includes(w))

            if (matchesCompany) {
              // Profile fields (titolare) — solo dati essenziali e actionable
              if (nj(plData.linkedin) && !profile.linkedin_titolare) profile.linkedin_titolare = plData.linkedin
              if (nj(plData.ruolo) && !profile.ruolo_titolare) profile.ruolo_titolare = plData.ruolo
              // bio/seniority/formazione/esperienze/competenze/anni_esperienza/
              // tipo_lavoro/instagram/facebook/twitter RIMOSSI dal merge:
              // erano dati curriculum/marketing senza valore assicurativo diretto.
              if (nj(plData.legami_familiari) && !profile.legami_familiari_titolare) profile.legami_familiari_titolare = plData.legami_familiari
              if (nj(plData.stato_civile) && !profile.stato_civile_titolare) profile.stato_civile_titolare = plData.stato_civile
              if (nj(plData.figli) && !profile.figli_titolare) profile.figli_titolare = plData.figli
              if (nj(plData.colleghi_noti) && !profile.colleghi_titolare) profile.colleghi_titolare = plData.colleghi_noti
              if (nj(plData.interessi_social) && !profile.interessi_titolare) profile.interessi_titolare = plData.interessi_social
              // Personal contacts (NEVER overwrite company contacts)
              if (nj(plData.email) && !profile.email_titolare) profile.email_titolare = plData.email
              if (nj(plData.telefono) && !profile.telefono_titolare) profile.telefono_titolare = plData.telefono
              if (nj(plData.cellulare) && !profile.cellulare_titolare) profile.cellulare_titolare = plData.cellulare
              if (nj(plData.pec) && plData.pec !== profile.pec && !profile.pec_titolare) profile.pec_titolare = plData.pec
              // Insurance / behavioral
              if (nj(plData.trigger_finanziari) && !profile.trigger_finanziari) profile.trigger_finanziari = plData.trigger_finanziari
              if (nj(plData.segnali_comportamentali) && !profile.segnali_comportamentali) profile.segnali_comportamentali = plData.segnali_comportamentali
              if (nj(plData.stima_capacita_risparmio) && !profile.stima_capacita_risparmio) profile.stima_capacita_risparmio = plData.stima_capacita_risparmio
              if (nj(plData.ambiti_protection) && !profile.ambiti_protection) profile.ambiti_protection = plData.ambiti_protection
              if (nj(plData.priorita_commerciale) && !profile.priorita_commerciale) profile.priorita_commerciale = plData.priorita_commerciale
              if (nj(plData.polizze_consigliate) && !profile.polizze_consigliate) profile.polizze_consigliate = plData.polizze_consigliate
              if (nj(plData.rischi_professionali) && !profile.rischi_professionali) profile.rischi_professionali = plData.rischi_professionali
              if (nj(plData.proprieta_immobiliari) && !profile.proprieta_immobiliari_titolare) profile.proprieta_immobiliari_titolare = plData.proprieta_immobiliari
              if (nj(plData.zona_residenza) && !profile.zona_residenza_titolare) profile.zona_residenza_titolare = plData.zona_residenza
              console.log(`[LEAD-REGISTRY] Person-lookup enrichment VERIFIED — merged titolare fields`)
            } else {
              console.log(`[LEAD-REGISTRY] Person-lookup enrichment NOT VERIFIED — skipping (possible omonimo)`)
            }
          }
        }
      } catch (e: any) {
        console.log(`[LEAD-REGISTRY] Person-lookup enrichment failed: ${e?.message || e}`)
      }
    }
  }

  // Rimuovi campi null/vuoti/zero inutili
  const ZERO_FILTER_KEYS = ['fatturato', 'dipendenti', 'costo_personale', 'capitale_sociale', 'utile_netto', 'totale_attivo']
  for (const key of Object.keys(profile)) {
    if (profile[key] === null || profile[key] === '') { delete profile[key]; continue }
    // Filter zero values for financial/numeric fields
    if (ZERO_FILTER_KEYS.includes(key)) {
      const v = String(profile[key]).replace(/[^\d.-]/g, '')
      if (v === '0' || v === '0.00' || v === '') delete profile[key]
    }
  }

  // ── Final cleanup: remove placeholder/example values hallucinated by GPT ──
  const placeholderRx = /esempio|example|sample|placeholder|lorem|ipsum/i
  const fakeNumberRx = /^0?1234567890?\d*$|^0?3456789012$|^0?123456789$/
  const sequentialRx = /1234567|7654321|0000000|9999999/
  const PORTAL_DOMS = ['risultati.it','nomeesatto.it','esattospa.it','reportaziende.it','italiaonline.it','informazione-aziende.it','getfound.it','cercaziende.it','trovaaziende.it','misterimprese.it','guida-monaci.it']
  const genericInsuranceRx = /è importante considerare|personalizzare le polizze|dimensione dell['’]?azienda|settore per personalizzare|altre info utili|rischio\s*\d|danno economico al cliente|errore professionale/i
  for (const key of Object.keys(profile)) {
    const v = profile[key]
    if (typeof v === 'string') {
      if (placeholderRx.test(v)) {
        console.log(`[LEAD-REGISTRY] CLEANUP: removed placeholder "${key}": "${v.slice(0, 60)}"`)
        delete profile[key]
      } else if (['partita_iva', 'codice_fiscale', 'telefono', 'cellulare'].includes(key) && fakeNumberRx.test(v.replace(/\D/g, ''))) {
        console.log(`[LEAD-REGISTRY] CLEANUP: removed fake number "${key}": "${v}"`)
        delete profile[key]
      } else if (['telefono', 'cellulare', 'telefono_fonte'].includes(key) && sequentialRx.test(v.replace(/\D/g, ''))) {
        console.log(`[LEAD-REGISTRY] CLEANUP: removed sequential phone "${key}": "${v}"`)
        delete profile[key]
      } else if (['sito_web', 'sito', 'email'].includes(key) && PORTAL_DOMS.some(d => v.includes(d))) {
        console.log(`[LEAD-REGISTRY] CLEANUP: removed portal domain "${key}": "${v.slice(0, 60)}"`)
        delete profile[key]
      } else if (key === 'email' && /^(mario\.rossi|nome\.cognome|info\.test|test@|user@|admin@example|esempio|prova@)/.test(v.toLowerCase())) {
        console.log(`[LEAD-REGISTRY] CLEANUP: removed fake email "${key}": "${v}"`)
        delete profile[key]
      } else if (key === 'ragione_sociale' && /^(risultati|ricerca|nome esatto|pagina|home|error)$/i.test(v.trim())) {
        console.log(`[LEAD-REGISTRY] CLEANUP: removed junk ragione_sociale: "${v}"`)
        delete profile[key]
      }
    }
  }
  if (typeof profile.note_broker === 'string' && genericInsuranceRx.test(profile.note_broker)) {
    console.log(`[LEAD-REGISTRY] CLEANUP: removed generic note_broker: "${String(profile.note_broker).slice(0, 100)}"`)
    delete profile.note_broker
  }
  if (Array.isArray(profile.rischi_specifici)) {
    profile.rischi_specifici = (profile.rischi_specifici as any[])
      .map((r: any) => String(r || '').trim())
      .filter((r: string) => r.length >= 6 && !genericInsuranceRx.test(r))
    if ((profile.rischi_specifici as any[]).length === 0) delete profile.rischi_specifici
  }
  if (Array.isArray(profile.persone)) {
    const companyPersonRx = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|società|societa|cooperativa|consorzio|fondazione|associazione|impresa|azienda|ditta)\b/i
    const personNameRx = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*){1,4}$/
    profile.persone = (profile.persone as any[]).filter((p: any) => {
      const nome = String(p?.nome || '').trim()
      if (!nome || !personNameRx.test(nome) || companyPersonRx.test(nome)) return false
      if (/^[a-zà-ÿ]/.test(nome)) return false
      return true
    })
    if ((profile.persone as any[]).length === 0) delete profile.persone
  }

  // ★ FIX bug visto su CAREL S.r.l. (1 dipendente reale ma sistema mostrava 26):
  // Sanity check incrociato dipendenti × costo_personale.
  // Stipendio medio annuo lordo Italia ~25-35k€. Sotto 8k€/anno per dipendente
  // = impossibile (sotto soglia legale). Sopra 250k€/anno per micro-PMI = improbabile
  // a meno di executive. Se la ratio è fuori, uno dei due dati è sbagliato:
  // dato il fatturato basso (PMI), è MOLTO PIÙ probabile che dipendenti sia gonfiato
  // (es. AI/Tavily ha confuso costo_personale con dipendenti) → scartiamo dipendenti.
  if (profile.dipendenti && profile.costo_personale) {
    const dip = parseInt(String(profile.dipendenti).replace(/[^\d]/g, ''), 10)
    const costo = parseInt(String(profile.costo_personale).replace(/[^\d]/g, ''), 10)
    if (Number.isFinite(dip) && dip > 0 && Number.isFinite(costo) && costo > 0) {
      const costoPerDip = costo / dip
      if (costoPerDip < 8000) {
        console.log(
          `[LEAD-REGISTRY] CLEANUP: dipendenti SOSPETTO (${dip}) — ratio costo/dip=${costoPerDip.toFixed(0)}€/anno ` +
          `troppo bassa (sotto stipendio minimo legale). Dato non plausibile, scartato. ` +
          `Lasciato vuoto: l'utente deve verificare manualmente sulla visura camerale.`
        )
        delete profile.dipendenti
        delete profile.dipendenti_fonte
        // NO stima fallback: dipendenti deve venire da fonte camerale autoritativa
        // (FatturatoItalia, CompanyReports, OpenAPI). Meglio campo vuoto che stima.
      } else if (costoPerDip > 250000 && dip < 5) {
        console.log(
          `[LEAD-REGISTRY] CLEANUP: dipendenti SOSPETTO (${dip}) — ratio costo/dip=${costoPerDip.toFixed(0)}€/anno ` +
          `troppo alta per micro-PMI. Possibile dato dipendenti errato. Mantenuto ma flaggato.`
        )
        // Non scartiamo perché un caso valido è la holding con 1 amministratore pagato 300k.
      }
    }
  }

  return NextResponse.json(profile)
}
