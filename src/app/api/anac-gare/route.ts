/**
 * POST /api/anac-gare
 *
 * Cerca gare d'appalto pubbliche vinte dall'azienda negli ultimi 3 anni.
 * Fonte: ANAC (Autorità Nazionale Anticorruzione) - dati pubblici open data.
 *
 * Usa Tavily per cercare sui siti ufficiali ANAC + GU + MEPA + aggregatori
 * dato che non c'è una API REST semplice pubblica con search per P.IVA.
 *
 * Endpoint isolato. Zero modifiche al flusso esistente.
 *
 * Body: { ragione_sociale: string, partita_iva?: string }
 * Returns: { gare[], totale_importo, obblighi_assicurativi[], fonti[] }
 */
import { NextRequest, NextResponse } from 'next/server'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''

async function tavilySearch(query: string, maxResults = 8): Promise<any[]> {
  if (!TAVILY_API_KEY) return []
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
    })
    if (!r.ok) return []
    const data = await r.json()
    return data.results || []
  } catch (e) {
    console.error('[ANAC-GARE] Tavily error:', (e as Error).message)
    return []
  }
}

async function gptExtractGare(context: string, ragioneSociale: string): Promise<any | null> {
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
              'Estrai SOLO gare/appalti realmente menzionati nel contesto per l\'azienda indicata. NON inventare. Se la gara non è aggiudicata (solo candidata), indicalo. Rispondi in JSON.',
          },
          {
            role: 'user',
            content: `AZIENDA: ${ragioneSociale}

CONTESTO:
${context.slice(0, 10000)}

Schema JSON:
{
  "gare": [
    {
      "oggetto": "string (descrizione oggetto gara)",
      "stazione_appaltante": "string (ente che ha bandito)",
      "importo_eur": "number | null",
      "data_aggiudicazione": "string (YYYY-MM-DD o anno) | null",
      "cig": "string | null",
      "stato": "aggiudicata|in_corso|partecipata",
      "fonte_url": "string"
    }
  ],
  "vince_appalti_pubblici": true
}
REGOLA: Se NON trovi gare certe, ritorna {"gare": [], "vince_appalti_pubblici": false}.`,
          },
        ],
      }),
    })
    if (!r.ok) return null
    const data = await r.json()
    return JSON.parse(data.choices?.[0]?.message?.content || '{}')
  } catch (e) {
    console.error('[ANAC-GARE] GPT error:', (e as Error).message)
    return null
  }
}

function calcObblighiAssicurativi(gare: any[], totaleImporto: number): string[] {
  const obblighi: string[] = []
  if (!gare.length) return obblighi

  // Obblighi standard per chi partecipa a gare pubbliche
  obblighi.push(
    'Polizza RC Terzi (RCT) — obbligatoria per contratti pubblici secondo Codice Appalti'
  )
  obblighi.push('Cauzione definitiva (10% importo contratto) — Art. 103 D.Lgs. 50/2016')

  if (totaleImporto >= 150000) {
    obblighi.push(
      'Attestazione SOA — obbligatoria per lavori pubblici > €150.000 (OG/OS categorie)'
    )
  }
  if (totaleImporto >= 500000) {
    obblighi.push(
      'Polizza CAR (Contractors All Risks) — fortemente raccomandata per lavori > €500K'
    )
    obblighi.push('Polizza Postuma Decennale — per appalti edilizia pubblica')
  }
  if (totaleImporto >= 1000000) {
    obblighi.push('Polizza Responsabilità Progettista — raccomandata per appalti > €1M')
    obblighi.push('Fideiussione provvisoria (2%) e definitiva (10-20%) — importi significativi')
  }

  obblighi.push(
    'Polizza Infortuni + RCO (dipendenti) — obbligatoria per tutela lavoratori nei cantieri pubblici'
  )

  return obblighi
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { ragione_sociale, partita_iva } = body as {
      ragione_sociale?: string
      partita_iva?: string
    }
    if (!ragione_sociale && !partita_iva) {
      return NextResponse.json(
        { error: 'ragione_sociale o partita_iva richiesta' },
        { status: 400 }
      )
    }

    const q = ragione_sociale || partita_iva
    console.log(`[ANAC-GARE] Query: ${q}`)

    // Due ricerche parallele
    const [aggiudicazioneResults, cigResults] = await Promise.all([
      tavilySearch(
        `"${q}" aggiudicazione gara appalto pubblico site:anticorruzione.it OR site:gazzettaufficiale.it OR site:acquistinretepa.it`,
        8
      ),
      partita_iva
        ? tavilySearch(
            `${partita_iva} CIG aggiudicatario contratto pubblico`,
            6
          )
        : Promise.resolve([]),
    ])

    const all = [...aggiudicazioneResults, ...cigResults]
    const seen = new Set<string>()
    const unique = all.filter((r) => {
      if (!r.url || seen.has(r.url)) return false
      seen.add(r.url)
      return true
    })

    if (!unique.length) {
      return NextResponse.json({
        found: false,
        ragione_sociale: q,
        vince_appalti_pubblici: false,
        gare: [],
        totale_importo_eur: 0,
        obblighi_assicurativi: [],
        fonti: [],
        message: 'Nessuna gara pubblica trovata nei registri ANAC/GU',
      })
    }

    const context = unique
      .map((r) => `URL: ${r.url}\nTITOLO: ${r.title}\nCONTENUTO: ${r.content || ''}`)
      .join('\n\n---\n\n')

    const extracted = await gptExtractGare(context, ragione_sociale || partita_iva!)
    const gare: any[] = Array.isArray(extracted?.gare) ? extracted.gare : []
    const vincePubbliche = Boolean(extracted?.vince_appalti_pubblici) && gare.length > 0

    const totaleImporto = gare.reduce((sum, g) => {
      const imp = typeof g.importo_eur === 'number' ? g.importo_eur : 0
      return sum + imp
    }, 0)

    const obblighi = vincePubbliche ? calcObblighiAssicurativi(gare, totaleImporto) : []

    const fonti = Array.from(new Set(unique.slice(0, 5).map((r) => r.url)))

    console.log(
      `[ANAC-GARE] OK — ${gare.length} gare, importo totale: €${totaleImporto.toLocaleString()}`
    )

    return NextResponse.json({
      found: true,
      ragione_sociale: q,
      vince_appalti_pubblici: vincePubbliche,
      gare,
      totale_importo_eur: totaleImporto,
      obblighi_assicurativi: obblighi,
      fonti,
      _meta: {
        timestamp: new Date().toISOString(),
        risultati_analizzati: unique.length,
      },
    })
  } catch (e: any) {
    console.error('[ANAC-GARE] fatal:', e)
    return NextResponse.json({ error: e.message || 'Errore interno' }, { status: 500 })
  }
}
