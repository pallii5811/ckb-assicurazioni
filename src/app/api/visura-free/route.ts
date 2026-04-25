/**
 * POST /api/visura-free
 *
 * Endpoint ISOLATO per arricchire un'azienda con dati camerali UFFICIALI
 * usando SOLO fonti pubbliche gratuite:
 *  - ufficiocamerale.it (scraping aggregatore visura)
 *  - dati-aziende.it
 *  - cerca-pec.it (PEC)
 *  - atoka.io (partecipazioni)
 *  - inipec.gov.it (PEC ufficiale)
 *
 * Flusso: Tavily cerca → GPT estrae JSON strutturato.
 *
 * Zero modifiche ai flussi esistenti. Completamente opzionale.
 *
 * Body: { ragione_sociale?: string, partita_iva?: string, codice_fiscale?: string }
 * Returns: { pec, amministratori[], soci[], capitale_sociale, sede_legale, stato, forma_giuridica, data_costituzione, oggetto_sociale, fonti[] }
 */
import { NextRequest, NextResponse } from 'next/server'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''

// ── Tavily search with retry on 429 ─────────────────────────────
async function tavilySearch(query: string, maxResults = 6): Promise<any[]> {
  if (!TAVILY_API_KEY) return []
  const attempt = async (): Promise<any[]> => {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'advanced',
          max_results: maxResults,
          include_domains: [
            'ufficiocamerale.it',
            'dati-aziende.it',
            'cerca-pec.it',
            'atoka.io',
            'inipec.gov.it',
            'registroimprese.org',
            'reportaziende.it',
            'companyreports.it',
          ],
        }),
      })
      if (r.status === 429) return []
      if (!r.ok) return []
      const data = await r.json()
      return data.results || []
    } catch (e) {
      console.error('[VISURA-FREE] Tavily error:', (e as Error).message)
      return []
    }
  }
  let results = await attempt()
  if (!results.length) {
    // one retry with backoff on empty/429
    await new Promise((r) => setTimeout(r, 1200))
    results = await attempt()
  }
  return results
}

// ── GPT structured extraction ───────────────────────────────────
async function gptExtract(context: string, schema: string): Promise<any | null> {
  if (!OPENAI_API_KEY) return null
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'Estrai SOLO dati presenti nel contesto. Se un campo non è presente, metti null. NON inventare. NON usare placeholder come "Mario Rossi", "esempio", "N/D". Rispondi in JSON valido secondo lo schema richiesto.',
          },
          {
            role: 'user',
            content: `CONTESTO:\n${context.slice(0, 12000)}\n\nSCHEMA JSON:\n${schema}`,
          },
        ],
      }),
    })
    if (!r.ok) {
      console.error('[VISURA-FREE] GPT error:', r.status, await r.text().catch(() => ''))
      return null
    }
    const data = await r.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    return JSON.parse(content)
  } catch (e) {
    console.error('[VISURA-FREE] GPT exception:', (e as Error).message)
    return null
  }
}

// ── Junk value filter (stesso standard degli altri endpoint) ────
const JUNK_RX = /esempio|example|sample|placeholder|lorem|ipsum|mario\.rossi|nome\.cognome|n\/d|non disponibile|non specificato/i
function isJunk(v: any): boolean {
  if (v === null || v === undefined || v === '') return true
  if (typeof v === 'string') {
    const low = v.toLowerCase().trim()
    if (low.length < 2) return true
    if (JUNK_RX.test(low)) return true
  }
  return false
}
function cleanObject(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      const arr = v.filter((item) => {
        if (typeof item === 'string') return !isJunk(item)
        if (typeof item === 'object' && item) {
          const hasRealValue = Object.values(item).some((x) => !isJunk(x))
          return hasRealValue
        }
        return true
      })
      if (arr.length) out[k] = arr
    } else if (v && typeof v === 'object') {
      const nested = cleanObject(v)
      if (Object.keys(nested).length) out[k] = nested
    } else if (!isJunk(v)) {
      out[k] = v
    }
  }
  return out
}

// ── Route handler ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { ragione_sociale, partita_iva, codice_fiscale } = body as {
      ragione_sociale?: string
      partita_iva?: string
      codice_fiscale?: string
    }

    if (!ragione_sociale && !partita_iva && !codice_fiscale) {
      return NextResponse.json(
        { error: 'Fornire almeno ragione_sociale, partita_iva o codice_fiscale' },
        { status: 400 }
      )
    }

    const queryParts = [ragione_sociale, partita_iva, codice_fiscale].filter(Boolean).join(' ')
    console.log(`[VISURA-FREE] Query: ${queryParts}`)

    // 4 ricerche parallele targettate su fonti diverse
    const [visuraResults, ammResults, sociResults, pecResults] = await Promise.all([
      // 1: visura generale (sede, capitale, stato, ATECO)
      tavilySearch(
        `"${ragione_sociale || partita_iva}" capitale sociale sede legale stato attività ATECO site:ufficiocamerale.it OR site:dati-aziende.it OR site:reportaziende.it OR site:companyreports.it`,
        6
      ),
      // 2: amministratori (cariche sociali)
      tavilySearch(
        `"${ragione_sociale || partita_iva}" amministratore unico presidente consiglio amministrazione cariche site:ufficiocamerale.it OR site:dati-aziende.it OR site:reportaziende.it`,
        5
      ),
      // 3: soci (compagine sociale)
      tavilySearch(
        `"${ragione_sociale || partita_iva}" soci compagine sociale quote partecipazione site:ufficiocamerale.it OR site:dati-aziende.it OR site:atoka.io`,
        5
      ),
      // 4: PEC
      tavilySearch(
        `"${ragione_sociale || partita_iva}" PEC posta elettronica certificata @pec.it OR @legalmail.it OR @pec.cciaa.it site:inipec.gov.it OR site:cerca-pec.it OR site:ufficiocamerale.it`,
        4
      ),
    ])

    const mkContext = (rs: any[]) =>
      rs
        .map((r) => `URL: ${r.url}\nTITOLO: ${r.title}\nCONTENUTO: ${r.content || ''}`)
        .join('\n\n---\n\n')

    const visuraContext = mkContext(visuraResults)
    const ammContext = mkContext(ammResults)
    const sociContext = mkContext(sociResults)
    const pecContext = mkContext(pecResults)

    const fonti = Array.from(
      new Set(
        [
          ...visuraResults.slice(0, 2),
          ...ammResults.slice(0, 2),
          ...sociResults.slice(0, 2),
          ...pecResults.slice(0, 2),
        ].map((r) => r.url)
      )
    )

    // Estrazione parallela (4 GPT calls in parallel per velocità)
    const [visura, amministratoriExtract, sociExtract, pecData] = await Promise.all([
      visuraContext
        ? gptExtract(
            visuraContext,
            `{
  "ragione_sociale": "string | null",
  "partita_iva": "string (11 cifre) | null",
  "codice_fiscale": "string | null",
  "forma_giuridica": "string (es. SRL, SPA, SAS, SNC) | null",
  "capitale_sociale": "string (es. 10.000,00 EUR) | null",
  "sede_legale": "string (indirizzo completo con CAP e città) | null",
  "data_costituzione": "string (formato DD/MM/YYYY) | null",
  "stato_attivita": "string (attiva, cessata, in liquidazione, fallita) | null",
  "oggetto_sociale": "string (descrizione attività max 300 char) | null",
  "codice_ateco": "string (es. 28.41) | null"
}`
          )
        : Promise.resolve(null),
      ammContext
        ? gptExtract(
            ammContext,
            `{
  "amministratori": [
    {
      "nome": "string (nome e cognome completo - SOLO se presente, altrimenti non includere l'elemento)",
      "ruolo": "string (es. Amministratore Unico, Presidente CdA, Consigliere)",
      "data_nomina": "string (DD/MM/YYYY) | null"
    }
  ]
}
REGOLA: NON includere elementi con nome null o vuoto. Se non trovi amministratori nel contesto, ritorna {"amministratori": []}.`
          )
        : Promise.resolve(null),
      sociContext
        ? gptExtract(
            sociContext,
            `{
  "soci": [
    {
      "nome": "string (nome o ragione sociale del socio - SOLO se presente)",
      "quota_percentuale": "string (es. 50%) | null",
      "quota_valore": "string (es. 5.000,00 EUR) | null"
    }
  ]
}
REGOLA: NON includere elementi con nome null o vuoto. Se non trovi soci nel contesto, ritorna {"soci": []}.`
          )
        : Promise.resolve(null),
      pecContext
        ? gptExtract(
            pecContext,
            `{
  "pec": "string (indirizzo PEC completo formato email, es. nome@pec.it) | null"
}
REGOLA: La PEC DEVE contenere @ e terminare con .it (solitamente @pec.it, @legalmail.it, @pec.cciaa.it, @impresa.italia.it). Se non trovi una PEC valida, ritorna {"pec": null}.`
          )
        : Promise.resolve(null),
    ])

    // Filtra amministratori/soci senza nome valido
    const amministratori = (amministratoriExtract?.amministratori || []).filter(
      (a: any) => a && a.nome && typeof a.nome === 'string' && a.nome.trim().length > 2
    )
    const soci = (sociExtract?.soci || []).filter(
      (s: any) => s && s.nome && typeof s.nome === 'string' && s.nome.trim().length > 2
    )

    // Valida PEC (deve essere email valida)
    const pecRx = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    const pec =
      pecData?.pec && typeof pecData.pec === 'string' && pecRx.test(pecData.pec.trim())
        ? pecData.pec.trim().toLowerCase()
        : null

    const merged: Record<string, any> = {
      ...(visura || {}),
      amministratori,
      soci,
      pec,
      fonti,
      _meta: {
        timestamp: new Date().toISOString(),
        searches: {
          visura: visuraResults.length,
          amministratori: ammResults.length,
          soci: sociResults.length,
          pec: pecResults.length,
        },
      },
    }

    const cleaned = cleanObject(merged)
    // Ripristina _meta dopo cleaning (che lo potrebbe rimuovere se vuoto)
    cleaned._meta = merged._meta

    // Fallback: se completamente vuoto
    const hasData =
      cleaned.ragione_sociale ||
      cleaned.amministratori?.length ||
      cleaned.soci?.length ||
      cleaned.pec ||
      cleaned.sede_legale
    if (!hasData) {
      return NextResponse.json({
        found: false,
        query: queryParts,
        message: 'Nessun dato camerale trovato sulle fonti gratuite',
        _meta: cleaned._meta,
      })
    }

    console.log(
      `[VISURA-FREE] OK — ${cleaned.amministratori?.length || 0} amm, ${cleaned.soci?.length || 0} soci, PEC: ${cleaned.pec ? 'si' : 'no'}`
    )

    return NextResponse.json({ found: true, ...cleaned })
  } catch (e: any) {
    console.error('[VISURA-FREE] fatal:', e)
    return NextResponse.json({ error: e.message || 'Errore interno' }, { status: 500 })
  }
}
