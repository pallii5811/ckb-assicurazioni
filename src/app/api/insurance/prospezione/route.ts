/**
 * POST /api/insurance/prospezione
 *
 * PROSPEZIONE MASSIVA per assicuratori: cerca aziende aggiudicatarie di
 * gare pubbliche ANAC filtrabili per categoria / regione / importo / periodo.
 * Per ognuna stima cauzioni + decennale + opportunità.
 *
 * Pipeline:
 *   1. Costruisce query Tavily mirata sui domini pubblici ANAC/MEPA/GU
 *   2. GPT estrae lista strutturata di aggiudicazioni (azienda + dati gara)
 *   3. Calcola opportunità (cauzione 2%/10%, decennale postuma se >500k)
 *   4. Restituisce array ordinato per priority score
 *
 * AUTH: richiede utente Supabase autenticato (anti-abuso quote API).
 *
 * Costo: 1-3 query Tavily (paid) + 1 chiamata GPT-4o-mini (low cost).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  estimateCauzioneFromGara,
  type AnacGaraRaw,
} from '@/lib/insurance/cauzioni'

export const maxDuration = 90

// ─────────────────────────────────────────────────────────────────────────────
//  TIPI
// ─────────────────────────────────────────────────────────────────────────────

type Category = 'lavori' | 'servizi' | 'forniture' | 'all'

interface RequestBody {
  category?: Category
  region?: string                  // nome regione, es. "Piemonte"
  province?: string                // sigla 2 lettere, es. "TO"
  importoMin?: number
  importoMax?: number
  monthsBack?: number              // 6 / 12 / 24 / 36
  maxResults?: number              // 10-50
  /** Custom keyword opzionale per restringere il search */
  keyword?: string
}

interface ProspectionLead {
  ragioneSociale: string
  partitaIva?: string
  garaOggetto: string
  stazioneAppaltante: string
  importoAggiudicato: number
  dataAggiudicazione?: string
  dataFontePubblicazione?: string
  categoria: 'lavori' | 'servizi' | 'forniture' | 'unknown'
  cauzioneProvvisoriaStimata: number
  cauzioneDefinitivaStimata: number
  decennalePostumaStimata?: number
  premioAnnuoCauzioneStimato: { min: number; mid: number; max: number }
  fonteUrl?: string
  /** Score 0-95: più alto = più valore commerciale per assicuratore */
  priorityScore: number
}

interface ProspectionResponse {
  found: boolean
  totalLeads: number
  leads: ProspectionLead[]
  filters: RequestBody
  meta: {
    sourcesUsed: string[]
    durationMs: number
    queryUsed: string
    warnings: string[]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER: Tavily mirato su ANAC
// ─────────────────────────────────────────────────────────────────────────────

async function tavilySearchAnac(query: string, maxResults = 12): Promise<unknown[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'advanced',
        max_results: maxResults,
        include_domains: [
          'anticorruzione.it',
          'dati.anticorruzione.it',
          'serviziocontrattipubblici.it',
          'acquistinretepa.it',
          'gazzettaufficiale.it',
          'contrattipubblici.anac.it',
          'opencup.gov.it',
          'appaltiamo.eu',
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: unknown[] }
    return Array.isArray(data?.results) ? data.results : []
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER: GPT extraction massiva
// ─────────────────────────────────────────────────────────────────────────────

interface GptGara {
  ragione_sociale?: string
  partita_iva?: string
  oggetto?: string
  stazione_appaltante?: string
  importo_eur?: number | string | null
  data_aggiudicazione?: string | null
  categoria?: string | null
  territorio?: string | null
  fonte_url?: string
}

async function gptExtractMultiGare(
  context: string,
  filters: RequestBody,
): Promise<GptGara[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return []
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'Sei un analista che estrae aggiudicazioni di gare pubbliche da risultati di ricerca. Estrai SOLO aggiudicazioni REALI menzionate. Non inventare dati. Rispondi in JSON.',
          },
          {
            role: 'user',
            content:
              `FILTRI APPLICATI:\n` +
              `- Categoria: ${filters.category || 'all'}\n` +
              `- Regione: ${filters.region || 'tutte'}\n` +
              `- Provincia: ${filters.province || 'tutte'}\n` +
              `- Importo min: ${filters.importoMin || 0}\n` +
              `- Importo max: ${filters.importoMax || 'nessun limite'}\n` +
              `REGOLE DI QUALITÀ:\n` +
              `- Se regione/provincia sono indicate, estrai solo gare dove territorio, stazione appaltante o testo fonte citano chiaramente quell'area.\n` +
              `- Se la categoria è diversa da all, estrai solo gare coerenti con quella categoria.\n` +
              `- Scarta accordi quadro nazionali o lotti fuori territorio se il filtro geografico non è verificabile.\n` +
              `- Scarta dati senza aggiudicatario, importo o fonte pubblica.\n\n` +
              `CONTESTO (risultati ANAC/GU):\n${context.slice(0, 16000)}\n\n` +
              `Estrai TUTTE le aggiudicazioni distinct presenti, max 30, nello schema:\n` +
              `{ "aggiudicazioni": [\n` +
              `  {\n` +
              `    "ragione_sociale": "string (azienda aggiudicataria, sempre presente)",\n` +
              `    "partita_iva": "string|null (11 cifre se trovata)",\n` +
              `    "oggetto": "string (oggetto della gara)",\n` +
              `    "stazione_appaltante": "string (ente che ha bandito)",\n` +
              `    "importo_eur": number,\n` +
              `    "data_aggiudicazione": "YYYY-MM-DD" | "YYYY" | null,\n` +
              `    "categoria": "lavori"|"servizi"|"forniture"|null,\n` +
              `    "territorio": "string|null (regione/provincia/comune se presente)",\n` +
              `    "fonte_url": "string"\n` +
              `  }\n` +
              `]}\n` +
              `REGOLA: scarta aggiudicazioni senza ragione sociale aggiudicataria identificabile. ` +
              `Deduplica per (ragione_sociale, oggetto, importo).`,
          },
        ],
      }),
      signal: AbortSignal.timeout(40000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content || '{}'
    let parsed: { aggiudicazioni?: GptGara[] }
    try {
      parsed = JSON.parse(content)
    } catch {
      return []
    }
    return Array.isArray(parsed.aggiudicazioni) ? parsed.aggiudicazioni : []
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CORE LOGIC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Costruisce la query Tavily a partire dai filtri.
 * Strategia: combinare keyword di settore + zona + soglia importo.
 */
function buildQueries(filters: RequestBody): string[] {
  const currentYear = new Date().getFullYear()
  const minDate = new Date()
  minDate.setMonth(minDate.getMonth() - (filters.monthsBack || 12))
  const yearTokens: string[] = []
  for (let year = currentYear; year >= minDate.getFullYear(); year -= 1) {
    yearTokens.push(String(year))
  }
  const years = yearTokens.join(' OR ')
  const geo = [filters.region, filters.province ? `provincia ${filters.province}` : null].filter(Boolean).join(' ')
  const keyword = filters.keyword?.trim() ? `"${filters.keyword.trim()}"` : ''
  const importo = filters.importoMin && filters.importoMin >= 100_000 ? `importo ${filters.importoMin.toLocaleString('it-IT')}` : ''

  let categoryText = 'gara appalto pubblico aggiudicatario'
  switch (filters.category) {
    case 'lavori':
      categoryText = 'aggiudicazione lavori opere pubbliche costruzione aggiudicatario'
      break
    case 'servizi':
      categoryText = 'aggiudicazione servizi appalto servizi aggiudicatario'
      break
    case 'forniture':
      categoryText = 'aggiudicazione forniture appalto fornitura aggiudicatario'
      break
  }

  return Array.from(new Set([
    ['site:gazzettaufficiale.it/eli/id', String(currentYear), categoryText, geo, keyword, 'avviso aggiudicazione appalto importo', years].filter(Boolean).join(' '),
    ['site:gazzettaufficiale.it/atto/contratti', categoryText, geo, keyword, 'avviso di aggiudicazione appalto importo', years].filter(Boolean).join(' '),
    ['site:serviziocontrattipubblici.it', categoryText, geo, keyword, 'aggiudicatario importo', years].filter(Boolean).join(' '),
    [categoryText, geo, keyword, importo, years].filter(Boolean).join(' '),
  ].filter(Boolean)))
}

function buildQuery(filters: RequestBody): string {
  return buildQueries(filters)[0] || 'aggiudicazione gara appalto pubblico Italia'
}

function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function extractYear(value: unknown): number | null {
  const match = String(value || '').match(/\b(20\d{2})\b/)
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

function parsePublicTenderDate(value: unknown): Date | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const it = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/)
  if (it) {
    const d = new Date(Number(it[3]), Number(it[2]) - 1, Number(it[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function parseSourcePublicationDate(url: unknown): Date | null {
  const raw = String(url || '')
  const pathDate = raw.match(/\/(?:id|gu)\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//)
  if (pathDate) {
    const d = new Date(Number(pathDate[1]), Number(pathDate[2]) - 1, Number(pathDate[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const queryDate = raw.match(/dataPubblicazioneGazzetta=(20\d{2})(\d{2})(\d{2})/)
  if (queryDate) {
    const d = new Date(Number(queryDate[1]), Number(queryDate[2]) - 1, Number(queryDate[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

const PROVINCE_ALIASES: Record<string, string[]> = {
  MI: ['milano', 'milanese', 'citta metropolitana di milano'],
  MB: ['monza', 'brianza', 'monza e brianza'],
  BG: ['bergamo', 'bergamasca'],
  BS: ['brescia', 'bresciana'],
  CO: ['como'],
  CR: ['cremona'],
  LC: ['lecco'],
  LO: ['lodi'],
  MN: ['mantova'],
  PV: ['pavia'],
  SO: ['sondrio'],
  VA: ['varese'],
  TO: ['torino', 'torinese', 'citta metropolitana di torino'],
  RM: ['roma', 'romana', 'citta metropolitana di roma'],
  NA: ['napoli', 'napoletana', 'citta metropolitana di napoli'],
}

function matchesProvince(text: string, province: string): boolean {
  const normalizedText = normalizeText(text)
  const normalizedProvince = normalizeText(province)
  if (normalizedProvince.length <= 2) {
    const codeMatch = new RegExp(`\\b${normalizedProvince}\\b`, 'i').test(normalizedText)
    const aliases = PROVINCE_ALIASES[province.toUpperCase()] || []
    return codeMatch || aliases.some((alias) => normalizedText.includes(normalizeText(alias)))
  }
  return normalizedText.includes(normalizedProvince)
}

/** Calcola priority score 0-100 basato su importo, settore e completezza dati */
function calcPriorityScore(lead: Omit<ProspectionLead, 'priorityScore'>): number {
  let score = 0

  // Importo: più alto, più valore (max 50 punti)
  if (lead.importoAggiudicato >= 5_000_000) score += 50
  else if (lead.importoAggiudicato >= 1_000_000) score += 40
  else if (lead.importoAggiudicato >= 500_000) score += 30
  else if (lead.importoAggiudicato >= 150_000) score += 20
  else if (lead.importoAggiudicato >= 40_000) score += 10
  else score += 5

  // Settore: lavori (decennale postuma) > servizi > forniture (max 25 punti)
  if (lead.categoria === 'lavori') score += 25
  else if (lead.categoria === 'servizi') score += 15
  else if (lead.categoria === 'forniture') score += 10

  // Completezza dati (max 25 punti)
  if (lead.partitaIva) score += 10
  if (lead.dataAggiudicazione || lead.dataFontePubblicazione) score += 5
  if (lead.fonteUrl) score += 5
  if (lead.decennalePostumaStimata) score += 5  // bonus decennale

  return Math.min(95, score)
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTs = Date.now()

  // ── AUTH ──
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── PARSE BODY ──
  let body: RequestBody = {}
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 })
  }

  // Normalizzazioni
  const filters: RequestBody = {
    category: body.category || 'all',
    region: body.region?.trim() || undefined,
    province: body.province?.trim().toUpperCase().slice(0, 2) || undefined,
    importoMin: typeof body.importoMin === 'number' ? body.importoMin : undefined,
    importoMax: typeof body.importoMax === 'number' ? body.importoMax : undefined,
    monthsBack: typeof body.monthsBack === 'number' ? Math.max(3, Math.min(36, body.monthsBack)) : 12,
    maxResults: typeof body.maxResults === 'number' ? Math.max(5, Math.min(50, body.maxResults)) : 20,
    keyword: body.keyword?.trim() || undefined,
  }

  const sourcesUsed: string[] = []
  const warnings: string[] = []

  // ── BUILD QUERY ──
  const queries = buildQueries(filters)
  const query = queries.join(' | ') || buildQuery(filters)

  // ── TAVILY SEARCH ──
  const searchBatches = await Promise.all(
    queries.slice(0, 4).map((q) => tavilySearchAnac(q, Math.min(filters.maxResults || 20, 10))),
  )
  const seenUrls = new Set<string>()
  const results = searchBatches.flat().filter((result) => {
    const url = String((result as { url?: unknown }).url || '')
    if (!url) return true
    if (seenUrls.has(url)) return false
    seenUrls.add(url)
    return true
  }).slice(0, 20)
  if (results.length === 0) {
    return NextResponse.json({
      found: false,
      totalLeads: 0,
      leads: [],
      filters,
      meta: {
        sourcesUsed,
        durationMs: Date.now() - startTs,
        queryUsed: query,
        warnings: ['Nessun risultato Tavily. Prova a allargare i filtri o cambiare keyword.'],
      },
    } satisfies ProspectionResponse)
  }
  sourcesUsed.push('tavily-anac')

  // ── PREPARA CONTESTO PER GPT ──
  const context = (results as Array<{ url?: string; title?: string; content?: string }>)
    .map((r) => `URL: ${r.url || ''}\nTITOLO: ${r.title || ''}\nCONTENUTO: ${r.content || ''}`)
    .join('\n\n---\n\n')

  // ── GPT EXTRACTION ──
  const extracted = await gptExtractMultiGare(context, filters)
  if (extracted.length === 0) {
    return NextResponse.json({
      found: false,
      totalLeads: 0,
      leads: [],
      filters,
      meta: {
        sourcesUsed,
        durationMs: Date.now() - startTs,
        queryUsed: query,
        warnings: ['GPT non ha trovato aggiudicazioni strutturabili nei risultati.'],
      },
    } satisfies ProspectionResponse)
  }
  sourcesUsed.push('gpt-extraction')

  // ── BUILD LEADS ──
  const leads: ProspectionLead[] = []
  const currentYear = new Date().getFullYear()
  const monthsBack = filters.monthsBack || 12
  const minDate = new Date()
  minDate.setMonth(minDate.getMonth() - monthsBack)
  const minYear = currentYear - Math.ceil(monthsBack / 12)
  for (const ag of extracted) {
    if (!ag.ragione_sociale || typeof ag.ragione_sociale !== 'string') continue
    const stazioneAppaltante = String(ag.stazione_appaltante || '').trim()
    const fonteUrl = String(ag.fonte_url || '').trim()
    if (!fonteUrl) continue
    if (!stazioneAppaltante || /^(non specificata|n\.?d\.?|null|undefined)$/i.test(stazioneAppaltante)) continue

    // Importo deve essere un numero ragionevole
    let importo = 0
    if (typeof ag.importo_eur === 'number') importo = ag.importo_eur
    else if (typeof ag.importo_eur === 'string') {
      const cleaned = ag.importo_eur.replace(/[€\s.]/g, '').replace(',', '.')
      const n = parseFloat(cleaned)
      if (Number.isFinite(n)) importo = n
    }
    if (!Number.isFinite(importo) || importo <= 0) continue

    // Filtra per importo se specificato
    if (filters.importoMin && importo < filters.importoMin) continue
    if (filters.importoMax && importo > filters.importoMax) continue

    const tenderDate = parsePublicTenderDate(ag.data_aggiudicazione)
    const sourceDate = parseSourcePublicationDate(fonteUrl)
    const referenceDate = tenderDate || sourceDate
    if (referenceDate !== null && referenceDate < minDate) continue
    if (monthsBack <= 6 && referenceDate === null) continue
    const year = referenceDate === null ? extractYear(ag.data_aggiudicazione) : null
    if (referenceDate === null && year !== null && year < minYear) continue

    const territoryText = normalizeText(`${ag.territorio || ''} ${ag.oggetto || ''} ${ag.stazione_appaltante || ''}`)
    if (filters.province) {
      if (!matchesProvince(territoryText, filters.province)) continue
    } else if (filters.region && !territoryText.includes(normalizeText(filters.region))) {
      continue
    }

    // Categoria normalizzata
    const cat = String(ag.categoria || '').toLowerCase()
    let categoria: ProspectionLead['categoria'] = 'unknown'
    if (cat === 'lavori' || /lavor|opera|cantier/i.test(ag.oggetto || '')) categoria = 'lavori'
    else if (cat === 'servizi' || /serviz|manuten|pulizia|gestione/i.test(ag.oggetto || '')) categoria = 'servizi'
    else if (cat === 'forniture' || /forn|materiale|attrezzatur/i.test(ag.oggetto || '')) categoria = 'forniture'

    // Filtra per categoria se specificata
    if (filters.category && filters.category !== 'all' && categoria !== filters.category) continue

    // Stima cauzioni riusando il modulo esistente
    const garaRaw: AnacGaraRaw = {
      oggetto: ag.oggetto || '',
      stazione_appaltante: ag.stazione_appaltante || '',
      importo_eur: importo,
      data_aggiudicazione: ag.data_aggiudicazione || null,
      stato: 'aggiudicata',
    }
    const cauzioniData = estimateCauzioneFromGara(garaRaw)
    if (!cauzioniData) continue

    const cauzioneDefinitiva = cauzioniData.cauzioneDefinitivaStimata
    const premioMin = Math.round(cauzioneDefinitiva * 0.005)
    const premioMid = Math.round(cauzioneDefinitiva * 0.010)
    const premioMax = Math.round(cauzioneDefinitiva * 0.025)

    const partial: Omit<ProspectionLead, 'priorityScore'> = {
      ragioneSociale: ag.ragione_sociale,
      partitaIva: ag.partita_iva && /^\d{11}$/.test(String(ag.partita_iva)) ? String(ag.partita_iva) : undefined,
      garaOggetto: ag.oggetto || '(oggetto non specificato)',
      stazioneAppaltante,
      importoAggiudicato: importo,
      dataAggiudicazione: ag.data_aggiudicazione || undefined,
      dataFontePubblicazione: sourceDate ? formatDateIso(sourceDate) : undefined,
      categoria,
      cauzioneProvvisoriaStimata: cauzioniData.cauzioneProvvisoriaStimata,
      cauzioneDefinitivaStimata: cauzioniData.cauzioneDefinitivaStimata,
      decennalePostumaStimata: cauzioniData.decennaleEdilizia,
      premioAnnuoCauzioneStimato: { min: premioMin, mid: premioMid, max: premioMax },
      fonteUrl,
    }

    const lead: ProspectionLead = {
      ...partial,
      priorityScore: calcPriorityScore(partial),
    }
    leads.push(lead)
  }

  // ── DEDUP per (ragioneSociale, importo) e sort per priority ──
  const seen = new Set<string>()
  const dedup = leads.filter((l) => {
    const key = `${l.ragioneSociale.toLowerCase()}|${Math.round(l.importoAggiudicato)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  dedup.sort((a, b) => b.priorityScore - a.priorityScore)

  // Cap finale
  const finalLeads = dedup.slice(0, filters.maxResults || 20)

  if (finalLeads.length === 0) {
    warnings.push('Le aggiudicazioni trovate non rispettano i filtri applicati. Prova a allargare i criteri.')
  } else {
    warnings.push('Lead e benchmark da verificare sulla fonte pubblica: cauzioni, postuma e premi non indicano obblighi automatici né polizze attive/assenti.')
  }

  return NextResponse.json({
    found: finalLeads.length > 0,
    totalLeads: finalLeads.length,
    leads: finalLeads,
    filters,
    meta: {
      sourcesUsed,
      durationMs: Date.now() - startTs,
      queryUsed: query,
      warnings,
    },
  } satisfies ProspectionResponse)
}
