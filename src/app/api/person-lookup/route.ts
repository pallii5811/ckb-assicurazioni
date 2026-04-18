import { NextRequest, NextResponse } from 'next/server'

// ── Person Lookup via Tavily + GPT ──────────────────────────────
// Cerca una persona specifica e restituisce info dettagliate

export async function POST(req: NextRequest) {
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

  // ── Search 1: Info base persona (ruolo, azienda, contatti) ──
  const text1 = await tavilySearch(`"${query}" chi è ruolo azienda società CEO titolare amministratore fondatore`)
  if (text1.length > 50) {
    const ext1 = await gptExtract(text1, `Estrai tutte le informazioni sulla persona "${query}". JSON:
{"nome_completo":"nome e cognome completo","ruolo":"ruolo/carica attuale","azienda":"nome azienda/società dove lavora","settore":"settore di attività","citta":"città","descrizione":"breve descrizione professionale della persona (2-3 frasi)","linkedin":"URL profilo LinkedIn completo"}`)
    for (const [k, v] of Object.entries(ext1)) {
      if (!isJunk(v)) result[k] = v
    }
    result.fonti.push('Tavily (ricerca web)')
    console.log(`[PERSON-LOOKUP] Search 1 done — nome: "${ext1.nome_completo}", azienda: "${ext1.azienda}"`)
  }

  // ── Search 1b: Contatti diretti (telefono, email, cellulare) ──
  const personName = result.nome_completo || query
  const company = result.azienda || ''
  const city = result.citta || ''
  {
    const q1b = `"${personName}" ${company} ${city} telefono cellulare email contatti`
    const text1b = await tavilySearch(q1b)
    if (text1b.length > 50) {
      const ext1b = await gptExtract(text1b, `Trova i contatti DIRETTI della persona "${personName}"${company ? ` che lavora presso ${company}` : ''}. Cerca numero di cellulare, telefono fisso, email personale. NON restituire numeri generici di centralino o email info@. JSON:
{"telefono":"numero cellulare o telefono diretto della persona (formato +39...)","email":"email personale o diretta (nome.cognome@... NON info@ o contatti@)","instagram":"profilo Instagram personale","facebook":"profilo Facebook personale"}`)
      if (!isJunk(ext1b.telefono) && !result.telefono) result.telefono = ext1b.telefono
      if (!isJunk(ext1b.email) && !result.email) result.email = ext1b.email
      if (!isJunk(ext1b.instagram) && !result.instagram) result.instagram = ext1b.instagram
      if (!isJunk(ext1b.facebook) && !result.facebook) result.facebook = ext1b.facebook
      console.log(`[PERSON-LOOKUP] Search 1b contacts done — tel: "${ext1b.telefono}", email: "${ext1b.email}"`)
    }
  }

  // ── Search 1c: Contatti aziendali (Maps + sito) se mancano telefono/email ──
  if ((!result.telefono || !result.email) && company) {
    console.log(`[PERSON-LOOKUP] Missing contacts, searching company "${company}" via Maps + Tavily...`)
    const backendUrl = process.env.SCRAPING_BACKEND_URL || 'http://46.225.189.40:8001'

    // Try Google Maps scraping for company phone/email
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
        console.log(`[PERSON-LOOKUP] Maps returned ${leads.length} results for company "${company}"`)
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
          result.fonti.push('Google Maps (azienda)')
        }
      }
    } catch { /* Maps failed */ }

    // If still missing, try Tavily for company contacts
    if (!result.telefono || !result.email) {
      const qCompany = `"${company}" ${city} telefono email contatti sede sito web`
      const textCompany = await tavilySearch(qCompany)
      if (textCompany.length > 50) {
        const extCompany = await gptExtract(textCompany, `Estrai telefono e email dell'azienda "${company}". JSON:
{"telefono":"numero di telefono dell'azienda","email":"email dell'azienda","sito_web":"sito web"}`)
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

  // ── Search 2: Info professionale dettagliata ──
  const text2 = await tavilySearch(`"${personName}" ${company} curriculum esperienza professionale formazione`)
  if (text2.length > 50) {
    const ext2 = await gptExtract(text2, `Estrai il profilo professionale di "${personName}". JSON:
{"esperienze_precedenti":"aziende/ruoli precedenti se noti","formazione":"titoli di studio","certificazioni":["certificazioni professionali"],"competenze":"competenze principali","anni_esperienza":"anni di esperienza stimati","partita_iva":"P.IVA se è un libero professionista","codice_fiscale":"CF se disponibile","data_nascita":"data di nascita se disponibile","note":"altre info rilevanti"}`)
    for (const [k, v] of Object.entries(ext2)) {
      if (!isJunk(v) && !result[k]) result[k] = v
    }
    console.log(`[PERSON-LOOKUP] Search 2 done`)
  }

  // ── Search 3: Info assicurativa / rischi ──
  const role = result.ruolo || ''
  const text3 = await tavilySearch(`"${personName}" ${company} ${role} assicurazione rischi professionali polizza`)
  if (text3.length > 50) {
    const ext3 = await gptExtract(text3, `Analizza il profilo di "${personName}" (ruolo: ${role || 'non specificato'}, azienda: ${company || 'non specificata'}) dal punto di vista assicurativo. JSON:
{"rischi_professionali":["rischio 1","rischio 2"],"polizze_consigliate":[{"polizza":"nome polizza","priorita":"obbligatoria/critica/raccomandata","motivo":"motivazione"}],"note_broker":"info utili per un broker assicurativo"}`)
    for (const [k, v] of Object.entries(ext3)) {
      if (v && v !== 'null' && !result[k]) {
        result[k] = v
      }
    }
    console.log(`[PERSON-LOOKUP] Search 3 done`)
  }

  // Se non ha trovato nulla di utile
  if (!result.nome_completo && !result.azienda && !result.ruolo) {
    return NextResponse.json({ error: `Nessuna informazione trovata per "${query}". Prova con nome e cognome completi.` })
  }

  return NextResponse.json(result)
}
