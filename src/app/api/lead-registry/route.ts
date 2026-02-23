import { NextRequest, NextResponse } from 'next/server'

function extractFormaGiuridica(name: string): string | null {
  const n = name.toLowerCase()
  if (/\bs\.?r\.?l\.?s?\b/.test(n) || n.includes('srls')) return n.includes('srls') ? 'SRLS' : 'SRL'
  if (/\bs\.?p\.?a\.?\b/.test(n)) return 'SPA'
  if (/\bs\.?n\.?c\.?\b/.test(n)) return 'SNC'
  if (/\bs\.?a\.?s\.?\b/.test(n)) return 'SAS'
  if (/\bs\.?s\.?\b/.test(n) && !n.includes('ss.')) return 'SS'
  return null
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead } = body

  const business_name = lead?.nome || lead?.azienda || lead?.business_name || ''
  const city = lead?.citta || lead?.city || ''
  const address = lead?.indirizzo || lead?.address || lead?.via || ''
  const category = lead?.categoria || lead?.category || ''
  const website = lead?.sito || lead?.website || ''

  if (!business_name) {
    return NextResponse.json({ found: false })
  }

  // 1. Prova il backend Hetzner per dati REALI dal Registro Imprese
  try {
    const res = await fetch('http://116.203.137.39:8001/scrape-registry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name, city }),
      signal: AbortSignal.timeout(25000),
    })
    const data = (await res.json()) as any

    if (data?.found === true) {
      // Usa indirizzo reale da Google Maps se il backend non ha la sede
      if (!data.sede_legale && address) {
        data.sede_legale = address
      }
      data.fonte = 'registro_imprese'
      return NextResponse.json(data)
    }
  } catch {
    // Backend non disponibile, continua
  }

  // 2. Costruisci il profilo usando DATI REALI dal lead (Google Maps + audit)
  const formaFromName = extractFormaGiuridica(business_name)

  const realProfile: Record<string, any> = {
    found: true,
    ragione_sociale: business_name,
    sede_legale: address || null,
    stato: 'Attiva',
    fonte: 'google_maps',
  }

  if (formaFromName) {
    realProfile.forma_giuridica = formaFromName
  }

  // 3. Usa GPT SOLO per codice ATECO (basato sulla categoria reale) e forma giuridica se non nel nome
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey && category) {
    try {
      const prompt = `Dati REALI verificati dell'azienda:
- Nome: ${business_name}
- Città: ${city}
- Categoria Google Maps: ${category}
- Indirizzo Google Maps: ${address || 'non disponibile'}
${formaFromName ? `- Forma giuridica (dal nome): ${formaFromName}` : ''}

Basandoti ESCLUSIVAMENTE sulla categoria "${category}", rispondi con il codice ATECO più appropriato.
${!formaFromName ? 'Stima anche la forma giuridica più probabile per questo tipo di attività.' : ''}

Rispondi SOLO con JSON (nessun altro testo):
{
  "codice_ateco": "XX.XX.XX",
  "descrizione_ateco": "descrizione del codice"${!formaFromName ? ',\n  "forma_giuridica": "SRL|SNC|Ditta individuale|SAS|SPA"' : ''}
}`

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(10000),
      })

      const data = (await res.json()) as any
      const content = data?.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

      if (parsed.codice_ateco) {
        realProfile.codice_ateco = parsed.codice_ateco
        if (parsed.descrizione_ateco) {
          realProfile.descrizione_ateco = parsed.descrizione_ateco
        }
      }
      if (!formaFromName && parsed.forma_giuridica) {
        realProfile.forma_giuridica = parsed.forma_giuridica
        realProfile.fonte = 'google_maps_ai_ateco'
      }
    } catch {
      // GPT non disponibile, restituisci solo dati reali
    }
  }

  // Rimuovi campi null
  for (const key of Object.keys(realProfile)) {
    if (realProfile[key] === null || realProfile[key] === '') {
      delete realProfile[key]
    }
  }

  return NextResponse.json(realProfile)
}
