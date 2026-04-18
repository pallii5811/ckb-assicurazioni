import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 120

// ── Employee/Dipendente Lookup via Tavily + GPT ──────────────────
// Cerca qualsiasi persona — se non trova contatti DIRETTI, non li inventa
// A differenza di person-lookup, NON usa contatti aziendali come fallback

export async function POST(req: NextRequest) {
  try {
    return await handleEmployeeLookup(req)
  } catch (err: any) {
    console.error(`[EMPLOYEE-LOOKUP] Fatal error:`, err)
    return NextResponse.json({ error: 'Errore durante la ricerca. Riprova tra qualche secondo.' })
  }
}

async function handleEmployeeLookup(req: NextRequest) {
  const body = await req.json()
  const query = (body.query || '').trim()

  if (!query || query.length < 3) {
    return NextResponse.json({ error: 'Inserisci nome e cognome della persona da cercare.' })
  }

  const tavilyKey = process.env.TAVILY_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  if (!tavilyKey || !openaiKey) {
    return NextResponse.json({ error: 'Chiavi API mancanti (Tavily/OpenAI).' })
  }

  console.log(`[EMPLOYEE-LOOKUP] Query: "${query}"`)

  // Parse query: split person name from company hint
  let queryPersonName = query
  let queryCompanyHint = ''
  try {
    const splitRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0,
        messages: [
          { role: 'system', content: 'Separa il nome della persona dal nome dell\'azienda nella query. Rispondi SOLO con JSON.' },
          { role: 'user', content: `Dalla query "${query}", separa il nome della persona dal nome dell'azienda (se presente). JSON:\n{"persona":"nome e cognome","azienda":"nome azienda o vuoto se non specificata"}` },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (splitRes.ok) {
      const splitData = await splitRes.json()
      const raw = splitData.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
      if (parsed.persona) queryPersonName = parsed.persona
      if (parsed.azienda) queryCompanyHint = parsed.azienda
      console.log(`[EMPLOYEE-LOOKUP] Parsed — persona: "${queryPersonName}", azienda hint: "${queryCompanyHint}"`)
    }
  } catch { /* use full query as person name */ }

  // Helper: Tavily search
  async function tavilySearch(q: string): Promise<string> {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: 'advanced', include_answer: true, max_results: 5 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return ''
      const data = await res.json()
      return (data.answer || '') + ' ' + (data.results || []).map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
    } catch { return '' }
  }

  // Helper: GPT extract
  async function gptExtract(text: string, prompt: string): Promise<Record<string, any>> {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          messages: [
            { role: 'system', content: 'Sei un assistente che estrae dati strutturati da testo. Rispondi SOLO con JSON valido, senza markdown. Se un dato non è disponibile, usa null.' },
            { role: 'user', content: `${prompt}\n\nTesto:\n${text.slice(0, 8000)}` },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) return {}
      const data = await res.json()
      const raw = data.choices?.[0]?.message?.content || '{}'
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      return JSON.parse(cleaned)
    } catch { return {} }
  }

  const result: Record<string, any> = { nome_cercato: query, fonti: [] }

  const isJunk = (v: any) => !v || v === 'null' || v === 'non disponibile' || v === 'non specificato' || v === 'N/A' || v === 'n/a' || v === 'non noto' || v === 'sconosciuto'

  // ── Search 1: Info base persona ──
  const searchName = queryPersonName
  const companyCtx = queryCompanyHint ? ` ${queryCompanyHint}` : ''
  const text1 = await tavilySearch(`"${searchName}"${companyCtx} chi è ruolo azienda società`)
  if (text1.length > 50) {
    const ext1 = await gptExtract(text1, `Estrai tutte le informazioni sulla persona "${searchName}"${queryCompanyHint ? ` in relazione all'azienda "${queryCompanyHint}"` : ''}. JSON:
{"nome_completo":"nome e cognome completo","ruolo":"ruolo/carica attuale","azienda":"nome azienda/società dove lavora${queryCompanyHint ? ` (PRIORITIZZA ${queryCompanyHint} se la persona ci lavora)` : ''}","settore":"settore di attività","citta":"città","descrizione":"breve descrizione professionale della persona (2-3 frasi)","linkedin":"URL profilo LinkedIn completo"}`)
    for (const [k, v] of Object.entries(ext1)) {
      if (!isJunk(v)) result[k] = v
    }
    if (queryCompanyHint && result.azienda && !result.azienda.toLowerCase().includes(queryCompanyHint.toLowerCase())) {
      result.azienda_alternativa = result.azienda
      result.azienda = queryCompanyHint
    }
    result.fonti.push('Tavily (ricerca web)')
    console.log(`[EMPLOYEE-LOOKUP] Search 1 done — nome: "${ext1.nome_completo}", azienda: "${result.azienda}"`)
  } else if (queryCompanyHint) {
    result.azienda = queryCompanyHint
  }

  // ── Search 1b: Contatti DIRETTI della persona (SOLO personali, NO aziendali) ──
  const personName = result.nome_completo || searchName
  const company = result.azienda || queryCompanyHint || ''
  const city = result.citta || ''
  {
    const q1b = `"${personName}" ${company} ${city} telefono cellulare email contatti`
    const text1b = await tavilySearch(q1b)
    if (text1b.length > 50) {
      const ext1b = await gptExtract(text1b, `Trova i contatti DIRETTI della persona "${personName}"${company ? ` che lavora presso ${company}` : ''}. 
REGOLE IMPORTANTI:
- Restituisci SOLO contatti che appartengono DIRETTAMENTE a questa persona
- NON restituire numeri di centralino, numeri generici dell'azienda, email info@ o generiche
- Se non sei SICURO che il contatto sia della persona, restituisci null
JSON:
{"telefono":"cellulare o telefono PERSONALE/DIRETTO della persona","email":"email PERSONALE o diretta (non info@, non generica)","pec":"PEC personale se disponibile","instagram":"profilo Instagram personale","facebook":"profilo Facebook personale"}`)
      if (!isJunk(ext1b.telefono) && !result.telefono) result.telefono = ext1b.telefono
      if (!isJunk(ext1b.email) && !result.email) result.email = ext1b.email
      if (!isJunk(ext1b.pec) && !result.pec) result.pec = ext1b.pec
      if (!isJunk(ext1b.instagram) && !result.instagram) result.instagram = ext1b.instagram
      if (!isJunk(ext1b.facebook) && !result.facebook) result.facebook = ext1b.facebook
      console.log(`[EMPLOYEE-LOOKUP] Search 1b done — tel: "${ext1b.telefono}", email: "${ext1b.email}"`);
    }
  }

  // ── Search 1b2: Dati camerali via Tavily ──
  if (!result.partita_iva || !result.pec) {
    const reverseName = personName.split(' ').reverse().join(' ')
    const q1b2 = `"${reverseName}" partita IVA PEC site:ufficiocamerale.it OR site:registroimprese.it OR site:informaimprese.it`
    const text1b2 = await tavilySearch(q1b2)
    if (text1b2.length > 50) {
      const ext1b2 = await gptExtract(text1b2, `Dai dati camerali, estrai SOLO le informazioni della ditta individuale intestata a "${personName}" (in formato camerale: "${reverseName}"). 
ATTENZIONE: 
- La ragione sociale DEVE contenere il nome "${personName}" o "${reverseName}"
- NON restituire dati di altre aziende o enti
- La P.IVA deve essere di 11 cifre e intestata a questa persona
JSON:
{"partita_iva":"P.IVA 11 cifre intestata a ${personName}","pec":"PEC personale della ditta individuale","codice_fiscale":"codice fiscale","indirizzo":"indirizzo sede legale"}`)
      if (!isJunk(ext1b2.partita_iva) && !result.partita_iva) result.partita_iva = ext1b2.partita_iva
      if (!isJunk(ext1b2.pec) && !result.pec) result.pec = ext1b2.pec
      if (!isJunk(ext1b2.codice_fiscale) && !result.codice_fiscale) result.codice_fiscale = ext1b2.codice_fiscale
      if (!isJunk(ext1b2.indirizzo) && !result.indirizzo) result.indirizzo = ext1b2.indirizzo
      console.log(`[EMPLOYEE-LOOKUP] Search 1b2 camerale done — piva: "${ext1b2.partita_iva}", pec: "${ext1b2.pec}"`);
    }
  }

  // ── OpenAPI.it — ULTIMO FALLBACK, solo se mancano P.IVA e PEC ──
  const openapiToken = process.env.OPENAPI_IT_TOKEN
  if (openapiToken && !result.partita_iva && !result.pec) {
    const reverseName = personName.split(' ').reverse().join(' ').toUpperCase()
    const normalName = personName.toUpperCase()
    for (const nameVar of [reverseName, normalName]) {
      try {
        const oaRes = await fetch(`https://company.openapi.com/IT-search/byName/${encodeURIComponent(nameVar)}`, {
          headers: { Authorization: `Bearer ${openapiToken}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        })
        if (oaRes.ok) {
          const entries = (await oaRes.json())?.data as Array<Record<string, any>> | undefined
          if (entries?.length) {
            const match = entries.find((e: any) => {
              const cn = (e.companyName || e.name || '').toUpperCase().replace(/[^A-Z\s]/g, '').trim()
              const words1 = cn.split(/\s+/).sort().join(' ')
              const words2 = normalName.replace(/[^A-Z\s]/g, '').trim().split(/\s+/).sort().join(' ')
              return words1 === words2
            })
            if (match) {
              console.log(`[EMPLOYEE-LOOKUP] OpenAPI.it EXACT match: "${match.companyName}" P.IVA: ${match.taxCode}`)
              if (match.taxCode) result.partita_iva = match.taxCode
              if (match.certifiedEmail) result.pec = match.certifiedEmail
              result.fonti.push('OpenAPI.it (Registro Imprese)')
              break
            }
          }
        }
      } catch { /* */ }
    }
  }

  // ── Search 2: Info professionale ──
  const text2 = await tavilySearch(`"${personName}" ${company} ${result.ruolo || ''} esperienza professionale`)
  if (text2.length > 50) {
    const ext2 = await gptExtract(text2, `Estrai SOLO il profilo professionale di "${personName}" come ${result.ruolo || 'professionista'}${company ? ` presso ${company}` : ''}. ATTENZIONE: includi SOLO informazioni che riguardano questa specifica persona. JSON:
{"esperienze_precedenti":"aziende/ruoli precedenti se noti","formazione":"titoli di studio VERIFICATI","competenze":"competenze professionali principali","anni_esperienza":"anni di esperienza stimati","note":"altre info rilevanti"}`)
    for (const [k, v] of Object.entries(ext2)) {
      if (!isJunk(v) && !result[k]) result[k] = v
    }
    console.log(`[EMPLOYEE-LOOKUP] Search 2 done`)
  }

  // ── Search 3: Info assicurativa ──
  const role = result.ruolo || ''
  const text3 = await tavilySearch(`"${personName}" ${company} ${role} assicurazione rischi professionali polizza`)
  if (text3.length > 50) {
    const ext3 = await gptExtract(text3, `Analizza il profilo di "${personName}" (ruolo: ${role || 'non specificato'}, azienda: ${company || 'non specificata'}) dal punto di vista assicurativo. JSON:
{"rischi_professionali":["rischio 1","rischio 2"],"polizze_consigliate":[{"polizza":"nome polizza","priorita":"obbligatoria/critica/raccomandata","motivo":"motivazione"}],"note_broker":"info utili per un broker assicurativo"}`)
    for (const [k, v] of Object.entries(ext3)) {
      if (v && v !== 'null' && !result[k]) result[k] = v
    }
    console.log(`[EMPLOYEE-LOOKUP] Search 3 done`)
  }

  // ── Pulizia finale: rimuovi dati che sono dell'azienda, non della persona ──
  if (result.telefono) {
    const cleanPhone = result.telefono.replace(/[\s\-()./]/g, '')
    const isFisso = /^(\+39)?0\d/.test(cleanPhone)
    if (isFisso) {
      console.log(`[EMPLOYEE-LOOKUP] Removing landline ${result.telefono} — likely company number`)
      delete result.telefono
    }
  }
  // Rimuovi email generiche aziendali
  if (result.email) {
    const emailLower = result.email.toLowerCase()
    if (/^(info|contatti|segreteria|amministrazione|reception|ufficio|commerciale)@/.test(emailLower)) {
      console.log(`[EMPLOYEE-LOOKUP] Removing generic email ${result.email}`)
      delete result.email
    }
  }

  if (!result.nome_completo && !result.azienda && !result.ruolo) {
    return NextResponse.json({ error: `Nessuna informazione trovata per "${query}". Prova con nome e cognome completi.` })
  }

  return NextResponse.json(result)
}
