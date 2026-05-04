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
  categoria: 'lavori' | 'servizi' | 'forniture' | 'unknown'
  cauzioneProvvisoriaStimata: number
  cauzioneDefinitivaStimata: number
  decennalePostumaStimata?: number
  premioAnnuoCauzioneStimato: { min: number; mid: number; max: number }
  fonteUrl?: string
  /** Score 0-100: più alto = più valore commerciale per assicuratore */
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
              `- Importo max: ${filters.importoMax || 'nessun limite'}\n\n` +
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
function buildQuery(filters: RequestBody): string {
  const parts: string[] = []

  // Categoria
  switch (filters.category) {
    case 'lavori':
      parts.push('aggiudicazione "lavori" OR "opere pubbliche" OR "costruzione"')
      break
    case 'servizi':
      parts.push('aggiudicazione "servizi" OR "appalto servizi"')
      break
    case 'forniture':
      parts.push('aggiudicazione "forniture" OR "appalto fornitura"')
      break
    default:
      parts.push('aggiudicazione gara appalto pubblico')
  }

  // Custom keyword
  if (filters.keyword && filters.keyword.trim()) {
    parts.push(`"${filters.keyword.trim()}"`)
  }

  // Regione/provincia
  if (filters.region) {
    parts.push(filters.region)
  }
  if (filters.province) {
    parts.push(`provincia di ${filters.province}`)
  }

  // Importo (soglie tipiche)
  if (filters.importoMin && filters.importoMin >= 100_000) {
    parts.push(`importo superiore €${filters.importoMin.toLocaleString('it-IT')}`)
  }

  // Recency
  if (filters.monthsBack && filters.monthsBack <= 12) {
    parts.push('2025 OR 2024')
  } else if (filters.monthsBack && filters.monthsBack <= 24) {
    parts.push('2024 OR 2025 OR 2023')
  }

  return parts.join(' ').trim() || 'aggiudicazione gara appalto pubblico Italia'
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
  if (lead.dataAggiudicazione) score += 5
  if (lead.fonteUrl) score += 5
  if (lead.decennalePostumaStimata) score += 5  // bonus decennale

  return Math.min(100, score)
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
  const query = buildQuery(filters)

  // ── TAVILY SEARCH ──
  const results = await tavilySearchAnac(query, Math.min(filters.maxResults || 20, 15))
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
  for (const ag of extracted) {
    if (!ag.ragione_sociale || typeof ag.ragione_sociale !== 'string') continue

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

    // Premio annuo ramo cauzioni stimato: 0.5%–2.5% sull'importo aggiudicato.
    // Aliquote tecniche IVASS Bollettino 2023.
    const premioMin = Math.round(importo * 0.005)
    const premioMid = Math.round(importo * 0.010)
    const premioMax = Math.round(importo * 0.025)

    const partial: Omit<ProspectionLead, 'priorityScore'> = {
      ragioneSociale: ag.ragione_sociale,
      partitaIva: ag.partita_iva && /^\d{11}$/.test(String(ag.partita_iva)) ? String(ag.partita_iva) : undefined,
      garaOggetto: ag.oggetto || '(oggetto non specificato)',
      stazioneAppaltante: ag.stazione_appaltante || '(non specificata)',
      importoAggiudicato: importo,
      dataAggiudicazione: ag.data_aggiudicazione || undefined,
      categoria,
      cauzioneProvvisoriaStimata: cauzioniData.cauzioneProvvisoriaStimata,
      cauzioneDefinitivaStimata: cauzioniData.cauzioneDefinitivaStimata,
      decennalePostumaStimata: cauzioniData.decennaleEdilizia,
      premioAnnuoCauzioneStimato: { min: premioMin, mid: premioMid, max: premioMax },
      fonteUrl: ag.fonte_url,
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
