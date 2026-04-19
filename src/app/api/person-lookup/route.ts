import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 120

// ── Person Lookup via Tavily + GPT ──────────────────────────────
// Cerca una persona specifica e restituisce info dettagliate

export async function POST(req: NextRequest) {
  try {
    return await handlePersonLookup(req)
  } catch (err: any) {
    console.error(`[PERSON-LOOKUP] Fatal error:`, err)
    return NextResponse.json({ error: 'Errore durante la ricerca. Riprova tra qualche secondo.' })
  }
}

async function handlePersonLookup(req: NextRequest) {
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

  console.log(`[PERSON-LOOKUP] Query: "${query}"`)

  // Try to detect if user included company name in query (e.g. "emanuele gorgone allianz")
  // We'll use GPT to split person name from company hint
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
      console.log(`[PERSON-LOOKUP] Parsed — persona: "${queryPersonName}", azienda hint: "${queryCompanyHint}"`)
    }
  } catch { /* use full query as person name */ }

  // Helper: Tavily search — onlyBestMatch picks the single most relevant result
  async function tavilySearch(q: string, onlyBestMatch = false, matchName?: string): Promise<string> {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: 'advanced', include_answer: false, max_results: 5 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return ''
      const data = await res.json()
      const results = data.results || []
      if (results.length === 0) return ''
      if (onlyBestMatch && matchName) {
        const nameWords = matchName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length >= 3)
        let bestResult: any = null, bestScore = -1
        for (const r of results) {
          const text = ((r.title || '') + ' ' + (r.content || '') + ' ' + (r.url || '')).toLowerCase()
          const score = nameWords.filter((w: string) => text.includes(w)).length
          if (score > bestScore) { bestScore = score; bestResult = r }
        }
        if (bestResult && bestScore > 0) {
          console.log(`[PERSON-LOOKUP] Tavily best match (${bestScore}/${nameWords.length}): "${bestResult.title}"`)
          return (bestResult.title || '') + ' ' + (bestResult.content || '')
        }
        return ''
      }
      return results.map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
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

  // ── Search 1: Info base persona (ruolo, azienda, contatti) ──
  const searchName = queryPersonName
  const companyCtx = queryCompanyHint ? ` ${queryCompanyHint}` : ''
  const text1 = await tavilySearch(`"${searchName}"${companyCtx} chi è ruolo azienda società`)
  if (text1.length > 50) {
    const ext1 = await gptExtract(text1, `Estrai tutte le informazioni sulla persona "${searchName}"${queryCompanyHint ? ` in relazione all'azienda "${queryCompanyHint}"` : ''}. JSON:
{"nome_completo":"nome e cognome completo","ruolo":"ruolo/carica attuale","azienda":"nome azienda/società dove lavora${queryCompanyHint ? ` (PRIORITIZZA ${queryCompanyHint} se la persona ci lavora)` : ''}","settore":"settore di attività","citta":"città","descrizione":"breve descrizione professionale della persona (2-3 frasi)","linkedin":"URL profilo LinkedIn completo","tipo_lavoro":"dipendente / libero professionista / imprenditore / socio","seniority":"junior / mid / senior / executive / C-level","dimensione_azienda":"micro / piccola / media / grande (stima basata su info disponibili)"}`)
    for (const [k, v] of Object.entries(ext1)) {
      if (!isJunk(v)) result[k] = v
    }
    // If user specified a company and GPT found a different one, prefer user's hint
    if (queryCompanyHint && result.azienda && !result.azienda.toLowerCase().includes(queryCompanyHint.toLowerCase())) {
      console.log(`[PERSON-LOOKUP] User specified "${queryCompanyHint}" but found "${result.azienda}" — keeping user hint as primary`)
      result.azienda_alternativa = result.azienda
      result.azienda = queryCompanyHint
    }
    result.fonti.push('Tavily (ricerca web)')
    console.log(`[PERSON-LOOKUP] Search 1 done — nome: "${ext1.nome_completo}", azienda: "${result.azienda}"`)
  } else if (queryCompanyHint) {
    result.azienda = queryCompanyHint
  }

  // ── Search 1b: Contatti + dati camerali via Tavily ──
  const personName = result.nome_completo || searchName
  const company = result.azienda || queryCompanyHint || ''
  const city = result.citta || ''
  {
    const q1b = `"${personName}" ${company} ${city} telefono cellulare email contatti`
    const text1b = await tavilySearch(q1b)
    if (text1b.length > 50) {
      const ext1b = await gptExtract(text1b, `Trova i contatti DIRETTI della persona "${personName}"${company ? ` che lavora presso ${company}` : ''}. IMPORTANTE: restituisci SOLO contatti che appartengono a QUESTA persona, NON numeri generici di azienda o centralini. JSON:
{"telefono":"numero cellulare o telefono diretto della persona","email":"email personale o diretta","instagram":"profilo Instagram personale","facebook":"profilo Facebook personale"}`)
      if (!isJunk(ext1b.telefono) && !result.telefono) result.telefono = ext1b.telefono
      if (!isJunk(ext1b.email) && !result.email) result.email = ext1b.email
      if (!isJunk(ext1b.instagram) && !result.instagram) result.instagram = ext1b.instagram
      if (!isJunk(ext1b.facebook) && !result.facebook) result.facebook = ext1b.facebook
      console.log(`[PERSON-LOOKUP] Search 1b done — tel: "${ext1b.telefono}", email: "${ext1b.email}"`);
    }
  }

  // ── Search 1b2: Dati camerali via Tavily (ufficiocamerale.it, registroimprese.it) ──
  if (!result.partita_iva || !result.pec) {
    const reverseName = personName.split(' ').reverse().join(' ')
    // Cerca specificamente su siti camerali
    const q1b2 = `${reverseName} partita IVA PEC ufficiocamerale.it`
    const text1b2 = await tavilySearch(q1b2, true, personName)
    if (text1b2.length > 50) {
      const ext1b2 = await gptExtract(text1b2, `Dai dati camerali, estrai SOLO le informazioni della ditta individuale intestata a "${personName}" (in formato camerale: "${reverseName}"). 
ATTENZIONE: 
- La ragione sociale DEVE contenere il nome "${personName}" o "${reverseName}"
- NON restituire dati di altre aziende o enti (es. Comune, altre società)
- La P.IVA deve essere di 11 cifre e intestata a questa persona
JSON:
{"partita_iva":"P.IVA 11 cifre intestata a ${personName}","pec":"PEC personale della ditta individuale","codice_fiscale":"codice fiscale","indirizzo":"indirizzo sede legale"}`)
      // Validate P.IVA: must be exactly 11 digits
      const cleanPiva = (ext1b2.partita_iva || '').replace(/\D/g, '')
      if (cleanPiva.length === 11 && !result.partita_iva) {
        result.partita_iva = cleanPiva
      } else if (ext1b2.partita_iva) {
        console.log(`[PERSON-LOOKUP] REJECTED invalid P.IVA: "${ext1b2.partita_iva}" (${cleanPiva.length} digits)`)
      }
      // Validate PEC: must be valid email format
      if (!isJunk(ext1b2.pec) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext1b2.pec) && !result.pec) result.pec = ext1b2.pec
      if (!isJunk(ext1b2.codice_fiscale) && !result.codice_fiscale) result.codice_fiscale = ext1b2.codice_fiscale
      if (!isJunk(ext1b2.indirizzo) && !result.indirizzo) result.indirizzo = ext1b2.indirizzo
      console.log(`[PERSON-LOOKUP] Search 1b2 camerale done — piva: "${cleanPiva}" (valid: ${cleanPiva.length === 11}), pec: "${ext1b2.pec}"`);
    }
  }

  // ── Search 1c: Contatti aziendali (Maps + Tavily) ──
  if ((!result.telefono || !result.email) && company) {
    console.log(`[PERSON-LOOKUP] Missing contacts, searching company "${company}" via Maps...`)
    const backendUrl = process.env.SCRAPING_BACKEND_URL || 'http://46.225.189.40:8001'
    try {
      const mapsRes = await fetch(`${backendUrl}/search-maps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: company + (city ? ' ' + city : ''), location: city || '', max_results: 3 }),
        signal: AbortSignal.timeout(12000),
      })
      if (mapsRes.ok) {
        const mapsData = await mapsRes.json()
        const leads = mapsData.results || mapsData.leads || []
        if (leads.length > 0) {
          const lead = leads[0]
          if (!result.telefono && (lead.telefono || lead.phone)) {
            result.telefono = lead.telefono || lead.phone
            result.telefono_fonte = 'Google Maps (azienda)'
          }
          if (!result.email && lead.email) {
            result.email = lead.email
            result.email_fonte = 'Google Maps (azienda)'
          }
          if (!result.sito_web && (lead.sito || lead.website)) {
            result.sito_web = lead.sito || lead.website
          }
          result.fonti.push('Google Maps')
        }
      }
    } catch { /* Maps failed */ }

    // Tavily company contacts
    if (!result.telefono || !result.email) {
      const qCompany = `"${company}" ${city} telefono email contatti sito web`
      const textCompany = await tavilySearch(qCompany)
      if (textCompany.length > 50) {
        const extCompany = await gptExtract(textCompany, `Estrai telefono e email dell'azienda "${company}". JSON:
{"telefono":"numero di telefono","email":"email","sito_web":"sito web"}`)
        if (!isJunk(extCompany.telefono) && !result.telefono) {
          result.telefono = extCompany.telefono
          result.telefono_fonte = 'Sito web azienda'
        }
        if (!isJunk(extCompany.email) && !result.email) {
          result.email = extCompany.email
          result.email_fonte = 'Sito web azienda'
        }
        if (!isJunk(extCompany.sito_web) && !result.sito_web) {
          result.sito_web = extCompany.sito_web
        }
      }
    }
    console.log(`[PERSON-LOOKUP] After company lookup — tel: "${result.telefono || 'N/A'}", email: "${result.email || 'N/A'}"`)
  }

  // ── Search 1d: OpenAPI.it — ULTIMO FALLBACK, solo se mancano P.IVA e PEC ──
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
            // Matching STRETTO: il nome azienda deve essere ESATTAMENTE il nome persona
            // (ditta individuale = "GORGONE EMANUELE", non "AZIENDA XYZ con Gorgone")
            const match = entries.find((e: any) => {
              const cn = (e.companyName || e.name || '').toUpperCase().replace(/[^A-Z\s]/g, '').trim()
              const words1 = cn.split(/\s+/).sort().join(' ')
              const words2 = normalName.replace(/[^A-Z\s]/g, '').trim().split(/\s+/).sort().join(' ')
              return words1 === words2
            })
            if (match) {
              console.log(`[PERSON-LOOKUP] OpenAPI.it EXACT match: "${match.companyName}" P.IVA: ${match.taxCode}`)
              const oaPiva = (match.taxCode || '').replace(/\D/g, '')
              if (oaPiva.length === 11) result.partita_iva = oaPiva
              if (match.certifiedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(match.certifiedEmail)) result.pec = match.certifiedEmail
              result.fonti.push('OpenAPI.it (Registro Imprese)')
              break
            }
          }
        }
      } catch { /* */ }
    }
    console.log(`[PERSON-LOOKUP] After OpenAPI.it — P.IVA: "${result.partita_iva || 'N/A'}", PEC: "${result.pec || 'N/A'}"`)
  }

  // ── Search 1e: Maps con nome persona (per trovare contatti della SUA attività) ──
  if ((!result.telefono || !result.email) && personName) {
    const backendUrl = process.env.SCRAPING_BACKEND_URL || 'http://46.225.189.40:8001'
    const mapsQuery = personName + (city ? ' ' + city : '')
    try {
      const mapsRes = await fetch(`${backendUrl}/search-maps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: mapsQuery, location: city || '', max_results: 3 }),
        signal: AbortSignal.timeout(12000),
      })
      if (mapsRes.ok) {
        const mapsData = await mapsRes.json()
        const leads = mapsData.results || mapsData.leads || []
        // Find one that matches person name
        const nameParts = personName.toLowerCase().split(/\s+/)
        const match = leads.find((l: any) => {
          const n = ((l.nome || l.title || l.name || '') + ' ' + (l.business_name || '')).toLowerCase()
          return nameParts.every((p: string) => p.length >= 2 && n.includes(p))
        }) || (leads.length === 1 ? leads[0] : null)
        if (match) {
          if (!result.telefono && (match.telefono || match.phone)) {
            result.telefono = match.telefono || match.phone
            console.log(`[PERSON-LOOKUP] Maps found phone for person: ${result.telefono}`)
          }
          if (!result.email && match.email) {
            result.email = match.email
          }
          if (!result.sito_web && (match.sito || match.website)) {
            result.sito_web = match.sito || match.website
          }
          if (!result.indirizzo && match.indirizzo) {
            result.indirizzo = match.indirizzo
          }
        }
      }
    } catch { /* Maps person search failed */ }
  }

  // ── Search 1f: Scrape company website for contacts + data (same as company-lookup) ──
  if (result.sito_web && (!result.email || !result.telefono || !result.pec)) {
    const siteBase = String(result.sito_web).startsWith('http') ? String(result.sito_web) : `https://${result.sito_web}`
    const siteDomain = siteBase.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    console.log(`[PERSON-LOOKUP] Scraping company website: ${siteBase}`)
    const pagesToTry = [siteBase, `${siteBase}/contatti`, `${siteBase}/contact`, `${siteBase}/contacts`, `${siteBase}/chi-siamo`, `${siteBase}/about`]
    let allHtml = ''
    for (const pageUrl of pagesToTry) {
      try {
        const pageRes = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(5000), redirect: 'follow',
        })
        if (pageRes.ok) allHtml += ' ' + await pageRes.text()
      } catch { /* skip */ }
    }
    if (allHtml.length > 100) {
      const pivaKnown = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
      // P.IVA
      if (!result.partita_iva) {
        const pivaMatch = allHtml.match(/(?:P\.?\s*IVA|partita\s*iva|VAT|C\.?F\.?)[:\s/|–-]*(?:IT\s*)?(\d{11})/i)
        if (pivaMatch?.[1]) result.partita_iva = pivaMatch[1]
      }
      // Phones
      const phoneRegex = /(?:tel|phone|telefono|fax|cell|mobile|cellulare)[.\s:]*\+?(\d[\d\s./-]{7,15})/gi
      let pm: RegExpExecArray | null
      while ((pm = phoneRegex.exec(allHtml)) !== null) {
        const digits = pm[1].replace(/\D/g, '')
        if (digits.length >= 9 && digits.length <= 13 && digits !== pivaKnown) {
          const core = digits.startsWith('39') ? digits.slice(2) : digits
          if (core.startsWith('3') && !result.cellulare) result.cellulare = pm[1].trim()
          else if (core.startsWith('0') && !result.telefono) result.telefono = pm[1].trim()
        }
      }
      // Emails
      const emails = [...new Set(allHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])]
        .filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') && !e.includes('example') && !e.includes('sentry'))
      if (!result.pec) {
        const pecEmail = emails.find(e => /pec\.|legalmail\.|pecimprese\.|pecmail\./.test(e.toLowerCase()))
        if (pecEmail) result.pec = pecEmail
      }
      if (!result.email) {
        const regularEmail = emails.find(e => !/pec\.|legalmail\./.test(e.toLowerCase()) && e.includes(siteDomain.replace('www.', '').split('.')[0]))
          || emails.find(e => e.startsWith('info@') || e.startsWith('contatti@'))
          || emails.find(e => !/pec\.|legalmail\./.test(e.toLowerCase()))
        if (regularEmail) result.email = regularEmail
      }
      // Social
      const igMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)/i)
      if (igMatch && !result.instagram) result.instagram = igMatch[1]
      const liMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?)/i)
      if (liMatch && !result.linkedin) result.linkedin = liMatch[1]
      const fbMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)/i)
      if (fbMatch && !result.facebook) result.facebook = fbMatch[1]
      result.fonti.push('Sito Web Aziendale')
    }
  }

  // ── Search 1g: CompanyReports.it for company financial data ──
  if (result.partita_iva) {
    const pivaStr = String(result.partita_iva).replace(/\D/g, '')
    if (pivaStr.length === 11) {
      console.log(`[PERSON-LOOKUP] Scraping CompanyReports.it for P.IVA ${pivaStr}`)
      try {
        const crRes = await fetch(`https://www.companyreports.it/${pivaStr}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' },
          signal: AbortSignal.timeout(10000), redirect: 'follow',
        })
        if (crRes.ok) {
          const html = await crRes.text()
          if (html.length > 5000 && !html.includes('<title>CompanyReports - Il fatturato')) {
            const crData: Record<string, string> = {}
            const meta = html.match(/meta name="description" content="([^"]+)"/i)
            if (meta) {
              const fatM = meta[1].match(/Fatturato\s+([\d.,]+)/i)
              if (fatM) crData.fatturato = fatM[1].replace(/,+$/, '').trim()
              const ateM = meta[1].match(/Ateco\s+([\d.]+)/i)
              if (ateM) crData.codice_ateco = ateM[1].replace(/\.+$/, '').trim()
            }
            const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
            for (const block of jsonLdBlocks) {
              try {
                const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
                for (const item of (d.mainEntity || [])) {
                  const q = (item.name || '').toLowerCase()
                  const a: string = item.acceptedAnswer?.text || ''
                  if (q.includes('fatturato') && !crData.fatturato) {
                    const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
                    if (m) crData.fatturato = m[1].replace(/,+$/, '').trim()
                    const y = a.match(/\((\d{4})\)/)
                    if (y) crData.fatturato_anno = y[1]
                  }
                  if (q.includes('dipendenti')) {
                    const m = a.match(/da\s*(\d+)\s*a\s*(\d+)/i)
                    if (m) crData.dipendenti = `${m[1]}-${m[2]}`
                    else { const m2 = a.match(/(\d+)\s*dipendenti/i) || a.match(/pari a\s*(\d+)/i); if (m2) crData.dipendenti = m2[1] }
                  }
                  if (q.includes('sede legale') && !crData.sede_legale) {
                    const m = a.match(/è\s+(.+?)(?:\.$|$)/i)
                    if (m) crData.sede_legale = m[1].trim()
                  }
                }
              } catch { /* */ }
            }
            const formaM = html.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
            if (formaM) crData.forma_giuridica = formaM[1].trim()
            if (!crData.dipendenti) {
              const dipM = html.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
              if (dipM) crData.dipendenti = dipM[1].trim()
            }
            if (!crData.pec) {
              const pecM = html.match(/(?:Indirizzo\s*)?PEC<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+@[^<]+)/i)
              if (pecM) crData.pec = pecM[1].trim().toLowerCase()
            }
            // Store as dati_azienda
            if (Object.keys(crData).length > 0) {
              console.log(`[PERSON-LOOKUP] CompanyReports data:`, JSON.stringify(crData))
              if (!result.dati_azienda) result.dati_azienda = {}
              if (crData.fatturato) result.dati_azienda.fatturato = crData.fatturato
              if (crData.fatturato_anno) result.dati_azienda.fatturato_anno = crData.fatturato_anno
              if (crData.dipendenti) result.dati_azienda.dipendenti = crData.dipendenti
              if (crData.codice_ateco) result.dati_azienda.codice_ateco = crData.codice_ateco
              if (crData.forma_giuridica) result.dati_azienda.forma_giuridica = crData.forma_giuridica
              if (crData.sede_legale) result.dati_azienda.sede_legale = crData.sede_legale
              if (crData.pec && !result.pec) result.pec = crData.pec
              result.fonti.push('CompanyReports.it')
            }
          }
        }
      } catch { /* CompanyReports failed */ }
    }
  }

  // Build dati_azienda from all gathered company data
  if (company || result.azienda) {
    if (!result.dati_azienda) result.dati_azienda = {}
    const da = result.dati_azienda
    const companyName = result.azienda || company
    if (!da.ragione_sociale && companyName) da.ragione_sociale = companyName
    if (!da.nome && companyName) da.nome = companyName
    if (!da.partita_iva && result.partita_iva) da.partita_iva = result.partita_iva
    if (!da.pec && result.pec) da.pec = result.pec
    if (!da.telefono && result.telefono) da.telefono = result.telefono
    if (!da.cellulare && result.cellulare) da.cellulare = result.cellulare
    if (!da.email && result.email) da.email = result.email
    if (!da.sito && result.sito_web) da.sito = result.sito_web
    if (!da.indirizzo && result.indirizzo) da.indirizzo = result.indirizzo
    if (!da.citta && city) da.citta = city

    // ── Tavily: company data enrichment (same as company-lookup) ──
    // If we have a company name, search for comprehensive company data
    const missingCompanyData = !da.fatturato || !da.codice_ateco || !da.sede_legale || !da.titolare
    if (companyName && missingCompanyData) {
      console.log(`[PERSON-LOOKUP] Enriching company data for "${companyName}" via Tavily...`)
      const piva = da.partita_iva || ''

      // Search for company registry data (P.IVA, ATECO, sede, forma giuridica)
      if (!da.partita_iva || !da.codice_ateco || !da.sede_legale) {
        const qReg = `"${companyName}" ${piva} partita IVA codice ATECO sede legale ufficiocamerale.it`
        const textReg = await tavilySearch(qReg, true, companyName)
        if (textReg.length > 50) {
          const extReg = await gptExtract(textReg, `Estrai i dati camerali SOLO per l'azienda "${companyName}"${piva ? ` (P.IVA: ${piva})` : ''}. NON usare dati di altre aziende. JSON:
{"partita_iva":"P.IVA 11 cifre","codice_ateco":"codice ATECO (es. 25.62.00)","descrizione_ateco":"descrizione attività","sede_legale":"indirizzo completo sede legale","forma_giuridica":"SRL/SPA/SNC/ecc","stato_attivita":"attiva/cessata","pec":"PEC aziendale","capitale_sociale":"capitale sociale","anno_fondazione":"anno"}`)
          if (!isJunk(extReg.partita_iva) && !da.partita_iva) {
            const cleanP = String(extReg.partita_iva).replace(/\D/g, '')
            if (cleanP.length === 11) da.partita_iva = cleanP
          }
          if (!isJunk(extReg.codice_ateco) && !da.codice_ateco) da.codice_ateco = extReg.codice_ateco
          if (!isJunk(extReg.descrizione_ateco) && !da.descrizione_ateco) da.descrizione_ateco = extReg.descrizione_ateco
          if (!isJunk(extReg.sede_legale) && !da.sede_legale) da.sede_legale = extReg.sede_legale
          if (!isJunk(extReg.forma_giuridica) && !da.forma_giuridica) da.forma_giuridica = extReg.forma_giuridica
          if (!isJunk(extReg.stato_attivita) && !da.stato_attivita) da.stato_attivita = extReg.stato_attivita
          if (!isJunk(extReg.pec) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extReg.pec) && !da.pec) da.pec = extReg.pec
          if (!isJunk(extReg.capitale_sociale) && !da.capitale_sociale) da.capitale_sociale = extReg.capitale_sociale
          if (!isJunk(extReg.anno_fondazione) && !da.anno_fondazione) da.anno_fondazione = extReg.anno_fondazione
          console.log(`[PERSON-LOOKUP] Company registry data: ATECO=${da.codice_ateco}, sede=${da.sede_legale}`)
        }
      }

      // Search for financial data (fatturato, dipendenti)
      if (!da.fatturato || !da.dipendenti) {
        const qFin = `"${companyName}" ${piva} fatturato bilancio dipendenti`
        const textFin = await tavilySearch(qFin, true, companyName)
        if (textFin.length > 50) {
          const extFin = await gptExtract(textFin, `Estrai i dati finanziari SOLO per "${companyName}"${piva ? ` (P.IVA: ${piva})` : ''}. JSON:
{"fatturato":"importo in euro","dipendenti":"numero","utile_netto":"importo","anno_bilancio":"anno","classe_fatturato":"es. 100K-500K"}`)
          if (!isJunk(extFin.fatturato) && !da.fatturato) da.fatturato = String(extFin.fatturato).includes('€') ? extFin.fatturato : `€${extFin.fatturato}`
          if (!isJunk(extFin.dipendenti) && !da.dipendenti) da.dipendenti = extFin.dipendenti
          if (!isJunk(extFin.utile_netto) && !da.utile_netto) da.utile_netto = extFin.utile_netto
          if (!isJunk(extFin.anno_bilancio) && !da.anno_bilancio) da.anno_bilancio = extFin.anno_bilancio
          if (!isJunk(extFin.classe_fatturato) && !da.classe_fatturato) da.classe_fatturato = extFin.classe_fatturato
          console.log(`[PERSON-LOOKUP] Company financial data: fatturato=${da.fatturato}, dip=${da.dipendenti}`)
        }
      }

      // Search for titolare / rappresentante legale
      if (!da.titolare) {
        const qTit = `"${companyName}" titolare rappresentante legale amministratore linkedin.com`
        const textTit = await tavilySearch(qTit, true, companyName)
        if (textTit.length > 50) {
          const extTit = await gptExtract(textTit, `Cerca il TITOLARE o RAPPRESENTANTE LEGALE di "${companyName}". JSON:
{"titolare":"nome e cognome","ruolo_titolare":"ruolo esatto"}`)
          if (!isJunk(extTit.titolare)) {
            da.titolare = extTit.titolare
            if (extTit.ruolo_titolare) da.ruolo_titolare = extTit.ruolo_titolare
          }
        }
      }

      // Search for social media
      if (!da.linkedin || !da.instagram) {
        const qSoc = `"${companyName}" linkedin instagram facebook social`
        const textSoc = await tavilySearch(qSoc)
        if (textSoc.length > 50) {
          const extSoc = await gptExtract(textSoc, `Cerca i profili social media dell'azienda "${companyName}". Restituisci SOLO URL trovati ESPLICITAMENTE nel testo. JSON:
{"linkedin":"URL LinkedIn company","instagram":"URL o @username Instagram","facebook":"URL Facebook"}`)
          if (!isJunk(extSoc.linkedin) && !da.linkedin) da.linkedin = extSoc.linkedin
          if (!isJunk(extSoc.instagram) && !da.instagram) da.instagram = extSoc.instagram
          if (!isJunk(extSoc.facebook) && !da.facebook) da.facebook = extSoc.facebook
        }
      }

      // If we now have P.IVA from Tavily, try CompanyReports for authoritative financial data
      if (da.partita_iva && (!da.fatturato || !da.dipendenti)) {
        const pivaStr = String(da.partita_iva).replace(/\D/g, '')
        if (pivaStr.length === 11) {
          console.log(`[PERSON-LOOKUP] Trying CompanyReports with newly found P.IVA ${pivaStr}`)
          try {
            const crRes = await fetch(`https://www.companyreports.it/${pivaStr}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' },
              signal: AbortSignal.timeout(10000), redirect: 'follow',
            })
            if (crRes.ok) {
              const html = await crRes.text()
              if (html.length > 5000 && !html.includes('<title>CompanyReports - Il fatturato')) {
                const meta = html.match(/meta name="description" content="([^"]+)"/i)
                if (meta) {
                  const fatM = meta[1].match(/Fatturato\s+([\d.,]+)/i)
                  if (fatM && !da.fatturato) da.fatturato = `€${fatM[1].replace(/,+$/, '').trim()}`
                  const ateM = meta[1].match(/Ateco\s+([\d.]+)/i)
                  if (ateM && !da.codice_ateco) da.codice_ateco = ateM[1].replace(/\.+$/, '').trim()
                }
                const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
                for (const block of jsonLdBlocks) {
                  try {
                    const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
                    for (const item of (d.mainEntity || [])) {
                      const q = (item.name || '').toLowerCase()
                      const a: string = item.acceptedAnswer?.text || ''
                      if (q.includes('fatturato') && !da.fatturato) {
                        const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
                        if (m) da.fatturato = `€${m[1].replace(/,+$/, '').trim()}`
                        const y = a.match(/\((\d{4})\)/)
                        if (y) da.fatturato_anno = y[1]
                      }
                      if (q.includes('dipendenti') && !da.dipendenti) {
                        const m = a.match(/da\s*(\d+)\s*a\s*(\d+)/i)
                        if (m) da.dipendenti = `${m[1]}-${m[2]}`
                        else { const m2 = a.match(/(\d+)\s*dipendenti/i) || a.match(/pari a\s*(\d+)/i); if (m2) da.dipendenti = m2[1] }
                      }
                      if (q.includes('sede legale') && !da.sede_legale) {
                        const m = a.match(/è\s+(.+?)(?:\.$|$)/i)
                        if (m) da.sede_legale = m[1].trim()
                      }
                    }
                  } catch { /* */ }
                }
                const formaM = html.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
                if (formaM && !da.forma_giuridica) da.forma_giuridica = formaM[1].trim()
                if (!da.dipendenti) {
                  const dipM = html.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
                  if (dipM) da.dipendenti = dipM[1].trim()
                }
                result.fonti.push('CompanyReports.it (2nd)')
              }
            }
          } catch { /* */ }
        }
      }

      console.log(`[PERSON-LOOKUP] dati_azienda enriched:`, JSON.stringify(da))
    }

    // Sync back to result
    if (da.partita_iva && !result.partita_iva) result.partita_iva = da.partita_iva
    if (da.pec && !result.pec) result.pec = da.pec
  }

  // ── Search 2: Info professionale + famiglia + trigger ──
  const text2 = await tavilySearch(`"${personName}" ${company} ${result.ruolo || ''} esperienza professionale famiglia`)
  if (text2.length > 50) {
    const ext2 = await gptExtract(text2, `Estrai il profilo completo di "${personName}" come ${result.ruolo || 'professionista'}${company ? ` presso ${company}` : ''}. ATTENZIONE: includi SOLO informazioni che riguardano questa specifica persona. JSON:
{"esperienze_precedenti":"aziende/ruoli precedenti se noti","formazione":"titoli di studio","competenze":"competenze professionali principali","anni_esperienza":"anni di esperienza stimati","colleghi_noti":"nomi di colleghi/soci/collaboratori noti nella stessa azienda","legami_familiari":"SOLO legami di SANGUE o matrimonio: coniuge/compagno/a, figli, genitori, fratelli, sorelle, zii, cugini — con NOME se disponibile. NON inserire colleghi, collaboratori, ruoli lavorativi o informazioni professionali qui.","stato_civile":"singolo/sposato/convivente se menzionato pubblicamente","figli":"numero o menzione di figli se pubblico","note":"altre info rilevanti"}`)
    for (const [k, v] of Object.entries(ext2)) {
      if (!isJunk(v) && !result[k]) result[k] = v
    }
    console.log(`[PERSON-LOOKUP] Search 2 done`)
  }

  // ── Search 2b: Social media + segnali comportamentali ──
  {
    const text2b = await tavilySearch(`"${personName}" ${city} instagram facebook tiktok linkedin pinterest profilo social`)
    if (text2b.length > 50) {
      const ext2b = await gptExtract(text2b, `Trova TUTTI i profili social media della persona "${personName}"${company ? ` (${company})` : ''}. JSON:
{"instagram":"URL o username Instagram","facebook":"URL profilo Facebook","tiktok":"URL o username TikTok","pinterest":"URL o username Pinterest","linkedin":"URL profilo LinkedIn","twitter_x":"URL profilo Twitter/X","youtube":"URL canale YouTube","interessi_social":"argomenti/interessi principali visibili dai post pubblici (finanza, investimenti, casa, business, famiglia, viaggi, ecc.)"}`)
      for (const [k, v] of Object.entries(ext2b)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 2b social done`)
    }
  }

  // ── Search 2c: Trigger finanziari ──
  {
    const currentYear = new Date().getFullYear()
    const text2c = await tavilySearch(`"${personName}" ${company} ${city} cambio lavoro promozione acquisto casa matrimonio partita iva ${currentYear} ${currentYear - 1}`)
    if (text2c.length > 50) {
      const ext2c = await gptExtract(text2c, `Cerca SEGNALI e TRIGGER finanziari RECENTI (ultimi 2-3 anni, dal ${currentYear - 2} a oggi) per "${personName}"${company ? ` (${company})` : ''}.

REGOLE IMPORTANTI:
- Includi SOLO trigger REALI che trovi ESPLICITAMENTE nel testo. NON inventare trigger.
- Se la persona ha GIÀ un'azienda o P.IVA da tempo, NON segnalare "apertura P.IVA" come trigger — non è un evento recente.
- "apertura P.IVA" è un trigger SOLO se la persona ha aperto una NUOVA P.IVA di recente (${currentYear - 1} o ${currentYear}).
- Se NON trovi nessun trigger reale, restituisci un array VUOTO [].
- La "fonte" deve essere un sito/pagina REALE dove hai trovato l'informazione.

JSON:
{"trigger_finanziari":[{"tipo":"tipo","dettaglio":"descrizione REALE trovata nel testo","data_stimata":"data","fonte":"URL o nome sito REALE"}],"segnali_comportamentali":"interessi REALI visibili pubblicamente (solo se trovati nel testo)"}`)
      // Filter out old triggers and invented ones
      if (Array.isArray(ext2c.trigger_finanziari)) {
        ext2c.trigger_finanziari = ext2c.trigger_finanziari.filter((t: any) => {
          if (!t?.dettaglio || t.dettaglio.length < 10) return false
          // Remove GPT guesses — "prevista", "prevede", "potrebbe", "probabilmente"
          if (/previst[ao]|prevede|potrebbe|probabilmente|ipotizz|supponi|stimat[ao]/i.test(t.dettaglio)) return false
          // Remove generic placeholder sources
          if (t.fonte && /testo fornito|non specif|sconosciut/i.test(t.fonte)) return false
          // Remove old triggers
          if (t?.data_stimata) {
            const yearMatch = String(t.data_stimata).match(/(\d{4})/)
            if (yearMatch && parseInt(yearMatch[1]) < currentYear - 3) return false
          }
          return true
        })
      }
      if (!isJunk(ext2c.trigger_finanziari) && !result.trigger_finanziari) result.trigger_finanziari = ext2c.trigger_finanziari
      if (!isJunk(ext2c.segnali_comportamentali) && !result.segnali_comportamentali) result.segnali_comportamentali = ext2c.segnali_comportamentali
      console.log(`[PERSON-LOOKUP] Search 2c triggers done`)
    }
  }

  // ── Search 3: Info assicurativa + stima capacità ──
  const role = result.ruolo || ''
  const tipoLavoro = result.tipo_lavoro || ''
  const seniority = result.seniority || ''
  const text3 = await tavilySearch(`"${personName}" ${company} ${role} assicurazione rischi professionali polizza`)
  if (text3.length > 50) {
    const ext3 = await gptExtract(text3, `Analizza il profilo di "${personName}" (ruolo: ${role || 'non specificato'}, azienda: ${company || 'non specificata'}, tipo: ${tipoLavoro || 'non specificato'}, seniority: ${seniority || 'non specificata'}) dal punto di vista assicurativo e finanziario.

Stima la capacità finanziaria basandoti su: ruolo, seniority, settore, dimensione azienda, tipo di lavoro.

JSON:
{"rischi_professionali":["rischio 1","rischio 2"],"polizze_consigliate":[{"polizza":"nome polizza","priorita":"obbligatoria/critica/raccomandata","motivo":"motivazione"}],"note_broker":"info utili per un broker assicurativo","stima_capacita_risparmio":"bassa / media / medio-alta / alta / molto alta (basata su ruolo e seniority)","ambiti_protection":["vita","salute","infortuni","RC professionale","casa","auto","previdenza","investimenti"],"priorita_commerciale":"freddo / tiepido / caldo / molto caldo (quanto è probabile che abbia bisogno di assicurazione)"}`)
    for (const [k, v] of Object.entries(ext3)) {
      if (v && v !== 'null' && !result[k]) {
        result[k] = v
      }
    }
    console.log(`[PERSON-LOOKUP] Search 3 done`)
  }

  // ── Search 4: Proprietà immobiliari + patrimonio ──
  {
    const q4 = `"${personName}" ${city} immobile proprietà casa acquisto vendita catasto agenzia entrate`
    const text4 = await tavilySearch(q4)
    if (text4.length > 50) {
      const ext4 = await gptExtract(text4, `Cerca informazioni su PROPRIETÀ IMMOBILIARI e PATRIMONIO di "${personName}"${city ? ` (${city})` : ''}. 
IMPORTANTE: includi SOLO dati che trovi ESPLICITAMENTE nel testo. NON inventare.
JSON:
{"proprieta_immobiliari":"immobili di proprietà noti (indirizzo, tipo, anno acquisto se disponibile)","zona_residenza":"quartiere/zona dove vive","tipo_abitazione":"proprietà / affitto / altro se menzionato","valore_stimato_immobili":"valore stimato degli immobili se disponibile","mutuo":"informazioni su mutui se disponibili","altri_beni":"auto di lusso, barche, altri beni di valore menzionati"}`)
      for (const [k, v] of Object.entries(ext4)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 4 immobili done`)
    }
  }

  // ── Search 5: Altre aziende + cariche societarie ──
  {
    const q5 = `"${personName}" amministratore socio titolare cariche societarie visura camerale aziende`
    const text5 = await tavilySearch(q5)
    if (text5.length > 50) {
      const ext5 = await gptExtract(text5, `Cerca TUTTE le cariche societarie e aziende collegate a "${personName}". 
IMPORTANTE: restituisci SOLO dati REALI trovati nel testo. NON inventare aziende.
JSON:
{"cariche_societarie":[{"azienda":"nome azienda","ruolo":"ruolo/carica","stato":"attiva/cessata","partita_iva":"P.IVA se disponibile"}],"numero_aziende_attive":"quante aziende attive ha","partecipazioni":"partecipazioni societarie note","storico_imprenditoriale":"breve cronologia imprenditoriale se disponibile"}`)
      for (const [k, v] of Object.entries(ext5)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 5 cariche done`)
    }
  }

  // ── Search 6: Albi professionali + certificazioni + onorificenze ──
  {
    const q6 = `"${personName}" albo professionale ordine iscrizione certificazione abilitazione`
    const text6 = await tavilySearch(q6)
    if (text6.length > 50) {
      const ext6 = await gptExtract(text6, `Cerca iscrizioni ad ALBI PROFESSIONALI, certificazioni e onorificenze di "${personName}".
IMPORTANTE: SOLO dati REALI trovati nel testo.
JSON:
{"albo_professionale":"albo a cui è iscritto (es. Ordine Avvocati, Ordine Ingegneri, Albo Agenti IVASS, ecc.)","numero_iscrizione":"numero iscrizione albo se disponibile","certificazioni":"certificazioni professionali (es. EFPA, CFA, ANASF, ecc.)","onorificenze":"onorificenze, premi, riconoscimenti","pubblicazioni":"libri, articoli, pubblicazioni accademiche","docenze":"incarichi accademici o di docenza","associazioni":"associazioni di categoria o professionali di cui è membro"}`)
      for (const [k, v] of Object.entries(ext6)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 6 albi done`)
    }
  }

  // ── Search 7: Notizie recenti + reputazione + contenziosi ──
  {
    const q7 = `"${personName}" ${company} notizie news articolo intervista contenzioso causa tribunale`
    const text7 = await tavilySearch(q7)
    if (text7.length > 50) {
      const ext7 = await gptExtract(text7, `Cerca NOTIZIE, articoli di stampa, interviste e informazioni legali su "${personName}"${company ? ` (${company})` : ''}.
IMPORTANTE: SOLO fatti REALI trovati nel testo con data e fonte. NON inventare.
JSON:
{"notizie_recenti":[{"titolo":"titolo notizia","data":"data","fonte":"nome testata/sito","rilevanza_assicurativa":"perché è rilevante per un assicuratore"}],"interviste":"interviste o apparizioni mediatiche","contenziosi":"cause legali, contenziosi, procedure note pubblicamente","reputazione_online":"sentiment generale della reputazione online","donazioni_beneficenza":"attività filantropiche o donazioni note"}`)
      for (const [k, v] of Object.entries(ext7)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 7 notizie done`)
    }
  }

  // ── Search 8: Network relazionale + influenza ──
  {
    const q8 = `"${personName}" ${company} con insieme evento conferenza consiglio amministrazione board relazione`
    const text8 = await tavilySearch(q8)
    if (text8.length > 50) {
      const ext8 = await gptExtract(text8, `Cerca il NETWORK RELAZIONALE di "${personName}" — con chi si relaziona professionalmente e personalmente.
IMPORTANTE: SOLO persone e relazioni REALI trovate nel testo.
JSON:
{"relazioni_chiave":[{"nome":"nome persona","relazione":"tipo di relazione (collega, socio, membro stesso CdA, ecc.)","contesto":"dove/come sono collegati"}],"eventi_conferenze":"eventi, conferenze, convegni a cui ha partecipato","consigli_amministrazione":"CdA o board di cui fa parte","influenza_stimata":"bassa / media / alta / molto alta (basata su ruoli, connessioni, visibilità)","circoli_club":"circoli, club, associazioni esclusive di cui è membro"}`)
      for (const [k, v] of Object.entries(ext8)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 8 network done`)
    }
  }

  // ── Final cleanup: validate data formats ──
  // P.IVA must be exactly 11 digits
  if (result.partita_iva) {
    const cleanPiva = String(result.partita_iva).replace(/\D/g, '')
    if (cleanPiva.length !== 11) {
      console.log(`[PERSON-LOOKUP] REMOVED invalid P.IVA: "${result.partita_iva}"`)
      delete result.partita_iva
    } else {
      result.partita_iva = cleanPiva
    }
  }
  // PEC must be valid email
  if (result.pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.pec)) {
    console.log(`[PERSON-LOOKUP] REMOVED invalid PEC: "${result.pec}"`)
    delete result.pec
  }
  // Phone: basic Italian phone validation
  if (result.telefono) {
    const digits = String(result.telefono).replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 13) {
      console.log(`[PERSON-LOOKUP] REMOVED invalid phone: "${result.telefono}"`)
      delete result.telefono
    }
  }

  // Se non ha trovato nulla di utile
  if (!result.nome_completo && !result.azienda && !result.ruolo) {
    return NextResponse.json({ error: `Nessuna informazione trovata per "${query}". Prova con nome e cognome completi.` })
  }

  return NextResponse.json(result)
}
