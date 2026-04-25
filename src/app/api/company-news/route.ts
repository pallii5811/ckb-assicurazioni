/**
 * POST /api/company-news
 *
 * Cerca notizie recenti sull'azienda e classifica TRIGGER commerciali
 * per broker assicurativi:
 *  - fundraising / aumenti capitale    → D&O, Cyber
 *  - acquisizioni / fusioni            → RC, Cyber, M&A warranty
 *  - espansione estero                 → Trade Credit, Marine, FOB
 *  - nuove assunzioni massive          → Welfare, Collettiva, D&O
 *  - crisi / cassa integrazione        → Tutela legale, filtro negativo
 *  - scandali / contenziosi            → RC professionale, Tutela
 *  - certificazioni / premi            → segnale qualità (upsell)
 *  - nuova sede                        → CAR, All Risks immobili
 *
 * Endpoint completamente isolato. Zero modifiche al flusso esistente.
 *
 * Body: { ragione_sociale: string, anni_lookback?: number (default 2) }
 * Returns: { news[], trigger_commerciali[], sentiment, priorita_suggerita }
 */
import { NextRequest, NextResponse } from 'next/server'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''

async function tavilyNews(query: string, days: number): Promise<any[]> {
  if (!TAVILY_API_KEY) return []
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        topic: 'news',
        days,
        search_depth: 'advanced',
        max_results: 10,
      }),
    })
    if (!r.ok) return []
    const data = await r.json()
    return data.results || []
  } catch (e) {
    console.error('[COMPANY-NEWS] Tavily error:', (e as Error).message)
    return []
  }
}

async function gptClassify(newsContext: string, ragioneSociale: string): Promise<any | null> {
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
              "Sei un analista per broker assicurativi. Analizza le notizie dell'azienda e identifica trigger commerciali per polizze. Rispondi in JSON valido. NON inventare notizie non presenti nel contesto.",
          },
          {
            role: 'user',
            content: `AZIENDA: ${ragioneSociale}

NOTIZIE:
${newsContext.slice(0, 10000)}

Estrai SOLO eventi CERTI dalle notizie (non inventare). Schema JSON:
{
  "trigger_commerciali": [
    {
      "tipo": "string (fundraising|acquisizione|espansione|assunzioni|crisi|certificazione|nuova_sede|contenzioso|altro)",
      "descrizione": "string (breve, 1 frase)",
      "data": "string (YYYY-MM-DD o mese/anno)",
      "polizze_target": ["string (polizze consigliate per questo trigger)"],
      "priorita": "alta|media|bassa",
      "fonte_url": "string"
    }
  ],
  "sentiment": "positivo|neutro|negativo",
  "priorita_suggerita": "caldo|tiepido|freddo",
  "note_broker": "string (max 200 char, suggerimento commerciale)"
}`,
          },
        ],
      }),
    })
    if (!r.ok) return null
    const data = await r.json()
    return JSON.parse(data.choices?.[0]?.message?.content || '{}')
  } catch (e) {
    console.error('[COMPANY-NEWS] GPT error:', (e as Error).message)
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { ragione_sociale, anni_lookback = 2 } = body as {
      ragione_sociale?: string
      anni_lookback?: number
    }
    if (!ragione_sociale) {
      return NextResponse.json({ error: 'ragione_sociale richiesta' }, { status: 400 })
    }

    const days = Math.max(30, Math.min(1460, anni_lookback * 365))
    console.log(`[COMPANY-NEWS] Query: "${ragione_sociale}" ultimi ${days}gg`)

    // Due ricerche complementari
    const [generalNews, businessNews] = await Promise.all([
      tavilyNews(`"${ragione_sociale}" Italia`, days),
      tavilyNews(
        `"${ragione_sociale}" (acquisizione OR fusione OR investimento OR aumento OR contratto OR espansione OR assunzioni OR crisi)`,
        days
      ),
    ])

    // Dedup by URL
    const seen = new Set<string>()
    const allNews = [...generalNews, ...businessNews].filter((n) => {
      if (!n.url || seen.has(n.url)) return false
      seen.add(n.url)
      return true
    })

    if (!allNews.length) {
      return NextResponse.json({
        found: false,
        ragione_sociale,
        news: [],
        trigger_commerciali: [],
        sentiment: 'neutro',
        priorita_suggerita: 'freddo',
        message: 'Nessuna notizia trovata',
      })
    }

    const newsContext = allNews
      .slice(0, 12)
      .map((n) => `[${n.published_date || 'data?'}] ${n.title}\nURL: ${n.url}\n${n.content || ''}`)
      .join('\n\n---\n\n')

    const classification = await gptClassify(newsContext, ragione_sociale)

    const newsOut = allNews.slice(0, 10).map((n) => ({
      titolo: n.title,
      data: n.published_date || null,
      url: n.url,
      snippet: (n.content || '').slice(0, 200),
    }))

    console.log(
      `[COMPANY-NEWS] OK — ${allNews.length} news, ${classification?.trigger_commerciali?.length || 0} trigger`
    )

    return NextResponse.json({
      found: true,
      ragione_sociale,
      news: newsOut,
      trigger_commerciali: classification?.trigger_commerciali || [],
      sentiment: classification?.sentiment || 'neutro',
      priorita_suggerita: classification?.priorita_suggerita || 'tiepido',
      note_broker: classification?.note_broker || '',
      _meta: {
        timestamp: new Date().toISOString(),
        news_count: allNews.length,
        lookback_days: days,
      },
    })
  } catch (e: any) {
    console.error('[COMPANY-NEWS] fatal:', e)
    return NextResponse.json({ error: e.message || 'Errore interno' }, { status: 500 })
  }
}
