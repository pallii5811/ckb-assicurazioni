import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

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
  let queryProfessionHint = ''
  let queryCityHint = ''
  try {
    const splitRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0,
        messages: [
          { role: 'system', content: 'Separa il nome della persona dagli altri dettagli nella query. Rispondi SOLO con JSON.' },
          { role: 'user', content: `Dalla query "${query}", estrai le informazioni. JSON:\n{"persona":"nome e cognome","azienda":"nome azienda o vuoto se non specificata","professione":"professione/ruolo se specificato (es. wedding planner, avvocato, architetto)","citta":"città se specificata"}` },
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
      if (parsed.professione) queryProfessionHint = parsed.professione
      if (parsed.citta) queryCityHint = parsed.citta
      console.log(`[PERSON-LOOKUP] Parsed — persona: "${queryPersonName}", azienda: "${queryCompanyHint}", professione: "${queryProfessionHint}", città: "${queryCityHint}"`)
    }
  } catch { /* use full query as person name */ }

  // Helper: Tavily search — onlyBestMatch picks the single most relevant result
  // Reverted to 'advanced' always — 'basic' was producing lower-quality results
  async function tavilySearch(q: string, onlyBestMatch = false, matchName?: string, _deep = false): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: 'advanced', include_answer: false, max_results: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        if (res.status === 429 && attempt === 0) {
          console.log(`[PERSON-LOOKUP] Tavily 429 rate limit — waiting 3s then retry...`)
          await new Promise(r => setTimeout(r, 3000))
          continue
        }
        if (!res.ok) {
          console.log(`[PERSON-LOOKUP] Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
          return ''
        }
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
            console.log(`[PERSON-LOOKUP] Tavily best match (${bestScore}/${nameWords.length}): "${bestResult.title}" url="${bestResult.url || ''}"`)
            return (bestResult.title || '') + ' ' + (bestResult.content || '') + ' ' + (bestResult.url || '')
          }
          return ''
        }
        return results.map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
      } catch (e: any) { console.log(`[PERSON-LOOKUP] Tavily error: ${e.message || e}`); return '' }
    }
    return ''
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

  const isJunk = (v: any) => {
    if (!v) return true
    if (typeof v !== 'string') return false
    const s = v.trim().toLowerCase()
    if (!s) return true
    if (['null','undefined','non disponibile','non specificato','n/a','n.d.','nd','non noto','sconosciuto','none','nessuno'].includes(s)) return true
    // Reject GPT-echoed prompt placeholders (e.g. "Profilo Instagram", "URL profilo Facebook", "Canale YouTube")
    if (/^(profilo|url|canale|pagina|account|username|handle|link|nome|numero|indirizzo|email|cellulare|telefono|sito|bio|descrizione)\s+(instagram|facebook|linkedin|twitter|youtube|tiktok|pinterest|x|social|personale|aziendale|utente|azienda|web|\w+)?\s*$/i.test(v.trim())) return true
    if (/^(instagram|facebook|linkedin|twitter|youtube|tiktok|pinterest)\s+(profilo|pagina|account|username|url|canale|handle|personale)?\s*$/i.test(v.trim())) return true
    // Reject obvious GPT placeholder/example values
    if (/esempio|example|sample|test|placeholder|lorem|ipsum|12345|00000/i.test(s)) return true
    if (/^(via|corso|piazza)\s+esempio/i.test(s)) return true
    return false
  }

  // ── Search 1: Info base persona (ruolo, azienda, contatti) ──
  const searchName = queryPersonName
  const companyCtx = queryCompanyHint ? ` ${queryCompanyHint}` : ''
  const profCtx = queryProfessionHint ? ` ${queryProfessionHint}` : ''
  const text1 = await tavilySearch(`"${searchName}"${companyCtx}${profCtx} ${queryCityHint ? queryCityHint + ' ' : ''}Italia chi è ruolo azienda società`)
  if (text1.length > 50) {
    const ext1 = await gptExtract(text1, `Estrai tutte le informazioni sulla persona "${searchName}"${queryCompanyHint ? ` in relazione all'azienda "${queryCompanyHint}"` : ''}. JSON:
{"nome_completo":"nome e cognome completo","ruolo":"ruolo/carica attuale","azienda":"nome azienda/società dove lavora${queryCompanyHint ? ` (PRIORITIZZA ${queryCompanyHint} se la persona ci lavora)` : ''}","settore":"settore di attività","citta":"città","descrizione":"breve descrizione professionale della persona (2-3 frasi)","linkedin":"URL profilo LinkedIn completo","tipo_lavoro":"dipendente / libero professionista / imprenditore / socio","seniority":"junior / mid / senior / executive / C-level","dimensione_azienda":"micro / piccola / media / grande (stima basata su info disponibili)"}`)
    for (const [k, v] of Object.entries(ext1)) {
      if (!isJunk(v)) result[k] = v
    }
    // If user specified a company and GPT found a different one, prefer user's hint
    // AND discard identity-specific fields that may belong to the WRONG person (omonimo)
    if (queryCompanyHint && result.azienda && !result.azienda.toLowerCase().includes(queryCompanyHint.toLowerCase())) {
      const hintWords = queryCompanyHint.toLowerCase().replace(/[^a-zà-ú\s]/gi, '').split(/\s+/).filter((w: string) => w.length > 3)
      const aziendaLow = (result.azienda || '').toLowerCase()
      const isMismatch = hintWords.length > 0 && !hintWords.some((w: string) => aziendaLow.includes(w))
      if (isMismatch) {
        console.log(`[PERSON-LOOKUP] COMPANY MISMATCH: user specified "${queryCompanyHint}" but Search 1 found "${result.azienda}" — discarding potentially wrong identity data`)
        result.azienda_alternativa = result.azienda
        result.azienda = queryCompanyHint
        // Discard fields that likely belong to the wrong person
        if (result.linkedin) {
          console.log(`[PERSON-LOOKUP] Discarding LinkedIn "${result.linkedin}" — likely belongs to different person at "${result.azienda_alternativa}"`)
          delete result.linkedin
        }
        if (result.descrizione) delete result.descrizione
      } else {
        result.azienda_alternativa = result.azienda
        result.azienda = queryCompanyHint
      }
    }
    result.fonti.push('Tavily (ricerca web)')
    console.log(`[PERSON-LOOKUP] Search 1 done — nome: "${ext1.nome_completo}", azienda: "${result.azienda}"`)
  } else if (queryCompanyHint) {
    result.azienda = queryCompanyHint
  }

  const personName = result.nome_completo || searchName
  const company = result.azienda || queryCompanyHint || ''
  const city = result.citta || queryCityHint || ''

  // ── Search 1e (PRIORITY for liberi professionisti): lead-registry con nome persona come "business" ──
  // Per architetti, consulenti, avvocati, ecc. il loro nome È la loro attività su Maps.
  // Usa lo stesso /api/lead-registry di "Dettaglio Lead" (che funziona e scrapa Maps + sito web).
  // DEVE stare prima di Search 1b per evitare di inquinare il telefono con numeri aziendali.
  if (personName) {
    // Extract profession hint from ruolo (architetta → architetto, avvocata → avvocato, etc.)
    const ruoloStr = String(result.ruolo || '').toLowerCase()
    const professionHints: string[] = []
    const profMap: Array<[RegExp, string]> = [
      [/architett/, 'architetto'], [/avvocat/, 'avvocato'], [/consulent/, 'consulente'],
      [/ingegner/, 'ingegnere'], [/commercialista/, 'commercialista'], [/notai/, 'notaio'],
      [/medic|dottor/, 'medico'], [/dentist/, 'dentista'], [/geometr/, 'geometra'],
      [/psicolog/, 'psicologo'], [/fisioterap/, 'fisioterapista'], [/veterinar/, 'veterinario'],
    ]
    const queryLow = String(query || '').toLowerCase()
    for (const [re, prof] of profMap) if (re.test(ruoloStr) || re.test(searchName.toLowerCase()) || re.test(queryLow)) { professionHints.push(prof); break }

    // Try queries: with profession first (most specific), then plain name
    const queries: string[] = []
    for (const p of professionHints) queries.push(`${p} ${personName}`)
    queries.push(personName)

    const origin = req.headers.get('host') ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}` : 'http://localhost:3000'
    for (const businessName of queries) {
      if (result.telefono_fonte === 'Google Maps (personale)') break // already found
      console.log(`[PERSON-LOOKUP] Search 1e (PRIORITY): lead-registry for person "${businessName}" @ "${city}"`)
      try {
        const regRes = await fetch(`${origin}/api/lead-registry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead: { nome: businessName, azienda: businessName, citta: city, sito: '', indirizzo: '', categoria: professionHints[0] || '' }, _skipPersonEnrichment: true }),
          signal: AbortSignal.timeout(60000),
        })
        if (regRes.ok) {
          const regData = await regRes.json()
          if (regData && regData.found) {
            // Validate it matches the person (business name must contain person's words)
            const regName = String(regData.ragione_sociale || '').toLowerCase()
            const nameParts = personName.toLowerCase().split(/\s+/).filter((p: string) => p.length >= 3)
            const isPersonMatch = nameParts.every((p: string) => regName.includes(p))
            if (isPersonMatch) {
              // ONLY write person-specific contact fields to avoid polluting dati_azienda lookup
              if (regData.telefono) {
                result.telefono = regData.telefono
                result.telefono_fonte = 'Google Maps (personale)'
                console.log(`[PERSON-LOOKUP] Search 1e: PERSONAL phone from lead-registry: ${result.telefono} (query: "${businessName}")`)
              }
              if (regData.email) {
                result.email = regData.email
                result.email_fonte = 'Google Maps (personale)'
              }
              // For liberi professionisti (architetto/avvocato/consulente/...), the Maps business
              // IS the current Italian activity. Override any stale company found on LinkedIn
              // (e.g. "Luciano Giorgi Studio LGB" on Maps must override "TecnimontHQC Sdn Bhd" from old LinkedIn role).
              if (professionHints.length > 0) {
                if (regData.ragione_sociale) {
                  const oldAzienda = result.azienda
                  result.azienda = regData.ragione_sociale
                  if (oldAzienda && oldAzienda !== regData.ragione_sociale) {
                    result.azienda_alternativa = oldAzienda
                    console.log(`[PERSON-LOOKUP] Search 1e: OVERRIDE azienda (libero professionista) "${oldAzienda}" → "${regData.ragione_sociale}"`)
                  }
                }
                if (regData.sito) result.sito_web = regData.sito
                if (regData.indirizzo && !/https?:\/\//i.test(regData.indirizzo)) result.indirizzo = regData.indirizzo
                if (regData.citta && !result.citta) result.citta = regData.citta
                if (regData.partita_iva && String(regData.partita_iva).replace(/\D/g, '').length === 11) {
                  result.partita_iva = String(regData.partita_iva).replace(/\D/g, '')
                }
                if (regData.pec && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regData.pec)) result.pec = regData.pec
                // Copy socials from lead-registry (scraped from website) to top-level
                if (regData.linkedin && !result.linkedin) result.linkedin = regData.linkedin
                if (regData.instagram && !result.instagram) result.instagram = regData.instagram
                if (regData.facebook && !result.facebook) result.facebook = regData.facebook
                if (regData.youtube && !result.youtube) result.youtube = regData.youtube
                if (regData.twitter && !result.twitter) result.twitter = regData.twitter
                // SANITY CHECK: for libero professionista, strip absurd company-scale fields
                // If lead-registry (OpenAPI/CompanyReports) matched a large company with similar name,
                // the fatturato/dipendenti/utile are of that big company — NOT our liber prof.
                // Heuristic: liberi professionisti rarely have > €3M fatturato or > 20 dipendenti.
                const sanitized: Record<string, any> = { ...regData }
                const fattNum = Number(String(regData.fatturato || '').replace(/[^\d.]/g, '')) || 0
                const dipNum = Number(String(regData.dipendenti || '').replace(/[^\d.]/g, '')) || 0
                // Threshold: €3M fatturato OR 20 dipendenti → almost certainly wrong match
                const looksCorporate = fattNum > 3_000_000 || dipNum > 20
                if (looksCorporate) {
                  console.log(`[PERSON-LOOKUP] Search 1e: SANITIZING dati_azienda — fatturato=${fattNum} dip=${dipNum} are corporate-scale, stripping (libero prof)`)
                  for (const k of ['fatturato','fatturato_anno','dipendenti','utile_netto','totale_attivo','capitale_sociale','costo_personale','classe_fatturato','dimensione_eu','ateco','descrizione_ateco','codice_ateco','codice_rea','data_costituzione','forma_giuridica','fatturato_trend','stima_premio','bilancio_anno','cariche_societarie']) {
                    delete sanitized[k]
                  }
                  // Force forma_giuridica to libero professionista
                  sanitized.forma_giuridica = 'Libero Professionista'
                }
                // Store Search 1e lead-registry response as AUTHORITATIVE dati_azienda
                // (prevents a later lookup from matching a different company with same short name)
                result.dati_azienda = sanitized
                result._skipSecondLeadRegistry = true
                // Also strip the same fields from top-level result if they were polluted
                if (looksCorporate) {
                  for (const k of ['fatturato','dipendenti','utile_netto','capitale_sociale','costo_personale']) {
                    delete result[k]
                  }
                }
              }
              if (!result.fonti.includes('Google Maps (personale)')) result.fonti.push('Google Maps (personale)')
            } else {
              console.log(`[PERSON-LOOKUP] Search 1e: lead-registry returned "${regName}" — does not match person "${personName}", skipping`)
            }
          }
        }
      } catch { /* person search failed, try next query */ }
    }
  }

  // ── Search 1b: Contatti + dati camerali via Tavily (solo se Maps personale non ha trovato) ──
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
    const text1b2 = await tavilySearch(q1b2, true, personName, true)
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
      if (!isJunk(ext1b2.indirizzo) && !result.indirizzo && !/https?:\/\//i.test(String(ext1b2.indirizzo)) && !/ufficiocamerale|registroimprese|reportaziende/i.test(String(ext1b2.indirizzo))) result.indirizzo = ext1b2.indirizzo
      console.log(`[PERSON-LOOKUP] Search 1b2 camerale done — piva: "${cleanPiva}" (valid: ${cleanPiva.length === 11}), pec: "${ext1b2.pec}"`);
    }
  }

  // ── Search 1c: Contatti aziendali (Maps + Tavily) — FALLBACK se Maps personale non ha trovato nulla ──
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
    // Validate: reject websites from wrong company (omonimo confusion)
    if (result.sito_web && company) {
      const siteDomain = (result.sito_web.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || '').toLowerCase()
      const compClean = company.toLowerCase().replace(/[^a-z0-9]/g, '')
      // If domain doesn't contain any company word and isn't .it, it might be wrong
      const domainLooksRight = siteDomain.includes(compClean) || compClean.split('').filter((c: string, i: number) => siteDomain.includes(compClean.slice(i, i + 3))).length > 0 || siteDomain.endsWith('.it')
      if (!domainLooksRight && siteDomain.length > 0) {
        console.log(`[PERSON-LOOKUP] REMOVED suspicious website "${result.sito_web}" — domain "${siteDomain}" doesn't match "${company}"`)
        delete result.sito_web
      }
    }
    // Validate: reject non-Italian phone numbers (omonimo confusion with foreign companies)
    if (result.telefono) {
      const digits = String(result.telefono).replace(/[\s\-().]/g, '')
      const isItalian = /^(\+?39|0[0-9]|3[0-9]{2})/.test(digits)
      if (!isItalian) {
        console.log(`[PERSON-LOOKUP] REMOVED non-Italian phone: "${result.telefono}"`)
        delete result.telefono
        delete result.telefono_fonte
      }
    }
    // Validate: reject emails from clearly wrong domains (omonimo confusion)
    if (result.email && company) {
      const emailDomain = result.email.split('@')[1]?.toLowerCase() || ''
      const compWords = company.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length >= 3)
      const domainMatchesCompany = compWords.some((w: string) => emailDomain.includes(w)) || emailDomain.includes(company.toLowerCase().replace(/[^a-z0-9]/g, ''))
      if (!domainMatchesCompany && !emailDomain.endsWith('.it') && !emailDomain.includes('pec')) {
        console.log(`[PERSON-LOOKUP] REMOVED suspicious email "${result.email}" — domain "${emailDomain}" doesn't match "${company}"`)
        delete result.email
        delete result.email_fonte
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
      // Social — broad URL search (not just href) with sharer filter
      const isSharer1f = (u: string) => /\/(sharer|share|intent|dialog)[/?.]|[?&]u=|[?&]url=/i.test(u)
      if (!result.instagram) {
        const ig = [...allHtml.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi)]
          .map(m => ({ url: m[0], handle: m[1] }))
          .find(x => !isSharer1f(x.url) && !/^(p|reel|tv|stories|explore|accounts)$/i.test(x.handle))
        if (ig) result.instagram = ig.url.replace(/\/$/, '')
      }
      if (!result.linkedin) {
        const li = [...allHtml.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(company|in|school)\/([a-zA-Z0-9._\-%]+)\/?/gi)]
          .map(m => m[0])
          .find(u => !isSharer1f(u))
        if (li) result.linkedin = li.replace(/\/$/, '')
      }
      if (!result.facebook) {
        const fb = [...allHtml.matchAll(/https?:\/\/(?:www\.|m\.|it-it\.)?facebook\.com\/([a-zA-Z0-9._\-]+)\/?/gi)]
          .map(m => ({ url: m[0], handle: m[1] }))
          .find(x => !isSharer1f(x.url) && !/^(sharer|share|dialog|tr|plugins|events|pages)$/i.test(x.handle))
        if (fb) result.facebook = fb.url.replace(/\/$/, '')
      }
      if (!result.youtube) {
        const yt = [...allHtml.matchAll(/https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/[a-zA-Z0-9_\-]+|c\/[a-zA-Z0-9._\-]+|user\/[a-zA-Z0-9._\-]+|@[a-zA-Z0-9._\-]+)\/?/gi)]
          .map(m => m[0])
          .find(u => !isSharer1f(u))
        if (yt) result.youtube = yt.replace(/\/$/, '')
      }
      if (!result.twitter) {
        const tw = [...allHtml.matchAll(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})\/?/gi)]
          .map(m => ({ url: m[0], handle: m[1] }))
          .find(x => !isSharer1f(x.url) && !/^(share|intent|i|home|search)$/i.test(x.handle))
        if (tw) result.twitter = tw.url.replace(/\/$/, '')
      }
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

  // Build dati_azienda using lead-registry (SAME identical pipeline as dettaglio lead)
  const companyName = result.azienda || company
  if (companyName && !result._skipSecondLeadRegistry) {
    console.log(`[PERSON-LOOKUP] Calling lead-registry for "${companyName}" (same pipeline as dettaglio lead)...`)
    try {
      const origin = req.headers.get('host') ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}` : 'http://localhost:3000'
      const leadObj = {
        nome: companyName,
        azienda: companyName,
        citta: city || result.citta || '',
        sito: result.sito_web || '',
        indirizzo: result.indirizzo || '',
      }
      const regRes = await fetch(`${origin}/api/lead-registry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: leadObj, _skipPersonEnrichment: true }),
        signal: AbortSignal.timeout(120000),
      })
      if (regRes.ok) {
        const regData = await regRes.json()
        if (regData && regData.found) {
          // Use lead-registry response AS dati_azienda (authoritative, same as dettaglio lead)
          result.dati_azienda = regData
          // Sync key fields back to top-level result
          if (regData.partita_iva && !result.partita_iva) result.partita_iva = regData.partita_iva
          if (regData.pec && !result.pec) result.pec = regData.pec
          if (regData.sede_legale && !result.indirizzo) result.indirizzo = regData.sede_legale
          // Override sito_web with validated website from lead-registry (fixes wrong sites like 1240.it)
          if (regData.sito) result.sito_web = regData.sito
          // Fill missing contact data from lead-registry
          if (regData.email_privacy && !result.email) result.email = regData.email_privacy
          result.fonti.push('lead-registry (dettaglio lead)')
          console.log(`[PERSON-LOOKUP] lead-registry returned: "${regData.ragione_sociale}" P.IVA=${regData.partita_iva} fatturato=${regData.fatturato} dip=${regData.dipendenti} titolare=${regData.titolare}`)
        }
      }
    } catch (e) {
      console.log(`[PERSON-LOOKUP] lead-registry call failed:`, e)
    }
    // Fallback: minimal dati_azienda if lead-registry failed
    if (!result.dati_azienda) {
      result.dati_azienda = { ragione_sociale: companyName, nome: companyName }
      if (result.partita_iva) result.dati_azienda.partita_iva = result.partita_iva
      if (city) result.dati_azienda.citta = city
    }
  }

  // ── Search 2: Info professionale + famiglia + trigger ──
  const text2 = await tavilySearch(`"${personName}" ${company} ${result.ruolo || ''} esperienza professionale famiglia`)
  if (text2.length > 50) {
    const ext2 = await gptExtract(text2, `Estrai il profilo completo di "${personName}" come ${result.ruolo || 'professionista'}${company ? ` presso ${company}` : ''}.
ATTENZIONE CRITICA: "${personName}" è un nome che potrebbe avere OMONIMI. Includi SOLO informazioni che riguardano la persona che lavora/ha lavorato presso "${company || 'azienda non specificata'}". Se trovi esperienze lavorative presso aziende completamente diverse e non collegate, probabilmente riguardano un OMONIMO — in quel caso scrivi null per quel campo. JSON:
{"esperienze_precedenti":"aziende/ruoli precedenti se noti","formazione":"titoli di studio","competenze":"competenze professionali principali","anni_esperienza":"anni di esperienza stimati","colleghi_noti":"nomi di colleghi/soci/collaboratori noti nella stessa azienda","legami_familiari":"SOLO legami di SANGUE o matrimonio: coniuge/compagno/a, figli, genitori, fratelli, sorelle, zii, cugini — con NOME se disponibile. NON inserire colleghi, collaboratori, ruoli lavorativi o informazioni professionali qui.","stato_civile":"singolo/sposato/convivente se menzionato pubblicamente","figli":"numero o menzione di figli se pubblico","note":"altre info rilevanti"}`)
    for (const [k, v] of Object.entries(ext2)) {
      if (!isJunk(v) && !result[k]) result[k] = v
    }
    // Post-validate esperienze: if they mention unrelated companies but NOT ours, discard (omonimo data)
    if (company && result.esperienze_precedenti && typeof result.esperienze_precedenti === 'string') {
      const compWordsCheck = company.toLowerCase().replace(/[^a-zà-ú\s]/gi, '').split(/\s+/).filter((w: string) => w.length > 3 && !/^(srl|srls|spa|sas|snc|societa|società)$/i.test(w))
      const espLow = result.esperienze_precedenti.toLowerCase()
      const espMentionsCompany = compWordsCheck.some((w: string) => espLow.includes(w))
      if (!espMentionsCompany && espLow.length > 20) {
        console.log(`[PERSON-LOOKUP] Esperienze DON'T reference "${company}" — likely omonimo data, discarding: "${result.esperienze_precedenti.slice(0, 80)}..."`)
        delete result.esperienze_precedenti
      }
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
    // Direct URL scan fallback: if GPT missed LinkedIn/IG/FB URLs that ARE in the text
    const nameParts2b = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
    if (!result.linkedin) {
      const liMatches = [...text2b.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9._\-%]+)\/?/gi)]
      const liHit = liMatches.find(m => { const slug = m[1].toLowerCase(); return nameParts2b.some((p: string) => slug.includes(p)) })
      if (liHit) { result.linkedin = liHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: LinkedIn via URL regex: ${result.linkedin}`) }
    }
    if (!result.instagram) {
      const igMatches = [...text2b.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi)]
      const igHit = igMatches.find(m => !/^(p|reel|tv|stories|explore|accounts)$/i.test(m[1]))
      if (igHit) { result.instagram = igHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: Instagram via URL regex: ${result.instagram}`) }
    }
    if (!result.facebook) {
      const fbMatches = [...text2b.matchAll(/https?:\/\/(?:www\.|m\.)?facebook\.com\/([a-zA-Z0-9._\-]+)\/?/gi)]
      const fbHit = fbMatches.find(m => !/^(sharer|share|dialog|tr|plugins|events|pages)$/i.test(m[1]))
      if (fbHit) { result.facebook = fbHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: Facebook via URL regex: ${result.facebook}`) }
    }
    // Dedicated LinkedIn search if still missing — most effective for nominal LinkedIn lookup
    console.log(`[PERSON-LOOKUP] Search 2b: pre-dedicated — linkedin=${!!result.linkedin} instagram=${!!result.instagram} facebook=${!!result.facebook} sito_web=${result.sito_web || 'none'}`)
    if (!result.linkedin) {
      const text2bLi = await tavilySearch(`"${personName}" ${city} site:linkedin.com/in`)
      if (text2bLi.length > 50) {
        const liMatches = [...text2bLi.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9._\-%]+)\/?/gi)]
        const liHit = liMatches.find(m => { const slug = m[1].toLowerCase(); return nameParts2b.some((p: string) => slug.includes(p)) })
        if (liHit) { result.linkedin = liHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: LinkedIn dedicated search: ${result.linkedin}`) }
      }
    }
    // Dedicated Instagram search if still missing
    console.log(`[PERSON-LOOKUP] Search 2b: LinkedIn dedicated done — found=${!!result.linkedin}`)
    if (!result.instagram) {
      const text2bIg = await tavilySearch(`"${personName}" ${company} site:instagram.com`)
      if (text2bIg.length > 30) {
        const igMatches = [...text2bIg.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi)]
        const igHit = igMatches.find(m => !/^(p|reel|tv|stories|explore|accounts|about|developer|legal)$/i.test(m[1]))
        if (igHit) { result.instagram = igHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: Instagram dedicated search: ${result.instagram}`) }
      }
    }
    // Dedicated Facebook search if still missing
    if (!result.facebook) {
      const text2bFb = await tavilySearch(`"${personName}" ${company} site:facebook.com`)
      if (text2bFb.length > 30) {
        const fbMatches = [...text2bFb.matchAll(/https?:\/\/(?:www\.|m\.)?facebook\.com\/([a-zA-Z0-9._\-]+)\/?/gi)]
        const fbHit = fbMatches.find(m => !/^(sharer|share|dialog|tr|plugins|events|pages|groups|watch|marketplace|gaming|business)$/i.test(m[1]))
        if (fbHit) { result.facebook = fbHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: Facebook dedicated search: ${result.facebook}`) }
      }
    }
    console.log(`[PERSON-LOOKUP] Search 2b: after dedicated — linkedin=${!!result.linkedin} instagram=${!!result.instagram} facebook=${!!result.facebook}`)
    // Fallback: find person's actual website via Tavily if missing
    if (!result.sito_web && !result.sito) {
      // First try direct domain probing (more reliable than Tavily for small sites)
      const compSlug = (company || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (compSlug.length >= 3) {
        for (const tld of ['.it', '.com', '.net']) {
          const probeUrl = `https://www.${compSlug}${tld}`
          try {
            const probeRes = await fetch(probeUrl, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' }).catch(() => null)
            if (probeRes && probeRes.ok) {
              const probeHtml = await probeRes.text()
              const pNameLow = personName.toLowerCase()
              const nameWords = pNameLow.split(/\s+/).filter((w: string) => w.length >= 3)
              const htmlLow = probeHtml.toLowerCase()
              // Accept if page mentions person name or company name
              if (nameWords.some((w: string) => htmlLow.includes(w)) || htmlLow.includes(compSlug)) {
                result.sito_web = probeRes.url || probeUrl
                console.log(`[PERSON-LOOKUP] Search 2b: Found website via domain probe: ${result.sito_web}`)
                break
              }
            }
          } catch { /* probe failed */ }
        }
      }
    }
    if (!result.sito_web && !result.sito) {
      const textSite = await tavilySearch(`"${personName}" ${company} sito web portfolio contatti`)
      if (textSite.length > 30) {
        // Extract URLs that could be the person/company site (not social, not directories)
        const urlMatches = [...textSite.matchAll(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+\.[a-z]{2,})/gi)]
        const skipDomains = /linkedin|facebook|instagram|twitter|youtube|tiktok|wikipedia|ufficiocamerale|registroimprese|reportaziend|paginegialle|infobel|google|bing|tavily/i
        for (const u of urlMatches) {
          if (!skipDomains.test(u[1])) { result.sito_web = u[0]; console.log(`[PERSON-LOOKUP] Search 2b: Found website via Tavily: ${u[0]}`); break }
        }
      }
    }
    // Also try dati_azienda.sito as potential website
    const daSito = result.dati_azienda?.sito || ''
    const personalSite = result.sito_web || result.sito || daSito || ''
    // Scrape website for social links
    if (personalSite && (!result.linkedin || !result.instagram || !result.facebook)) {
      try {
        const siteUrl = personalSite.startsWith('http') ? personalSite : `https://${personalSite}`
        console.log(`[PERSON-LOOKUP] Search 2b: Scraping ${siteUrl} for social links`)
        const siteRes = await fetch(siteUrl, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
        if (siteRes && siteRes.ok) {
          const html = await siteRes.text()
          if (!result.linkedin) {
            const liM = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9._\-%]+/i)
            if (liM) { result.linkedin = liM[0]; console.log(`[PERSON-LOOKUP] Search 2b: LinkedIn from website: ${liM[0]}`) }
          }
          if (!result.instagram) {
            const igM = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/i)
            if (igM && !/^(p|reel|tv|stories|explore|accounts)$/i.test(igM[1])) { result.instagram = igM[0]; console.log(`[PERSON-LOOKUP] Search 2b: Instagram from website: ${igM[0]}`) }
          }
          if (!result.facebook) {
            const fbM = html.match(/https?:\/\/(?:www\.|m\.)?facebook\.com\/([a-zA-Z0-9._\-]+)/i)
            if (fbM && !/^(sharer|share|dialog|tr|plugins)$/i.test(fbM[1])) { result.facebook = fbM[0]; console.log(`[PERSON-LOOKUP] Search 2b: Facebook from website: ${fbM[0]}`) }
          }
          if (!result.twitter_x) {
            const twM = html.match(/https?:\/\/(?:www\.)?(twitter|x)\.com\/([a-zA-Z0-9._]+)/i)
            if (twM) { result.twitter_x = twM[0]; console.log(`[PERSON-LOOKUP] Search 2b: Twitter from website: ${twM[0]}`) }
          }
        }
      } catch { /* website scraping failed — continue */ }
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
REGOLA FONDAMENTALE: rispondi SOLO con dati che trovi LETTERALMENTE nel testo fornito. Se un campo non è esplicitamente menzionato nel testo, usa null. NON STIMARE, NON INVENTARE, NON DEDURRE valori, indirizzi o importi. Se non c'è un indirizzo preciso, scrivi null. Se non c'è un valore esplicito, scrivi null.
JSON:
{"proprieta_immobiliari":"SOLO immobili ESPLICITAMENTE citati nel testo con indirizzo preciso, altrimenti null","zona_residenza":"SOLO se esplicitamente menzionata nel testo, altrimenti null","tipo_abitazione":"SOLO se esplicitamente menzionato, altrimenti null","valore_stimato_immobili":"SOLO se un valore è ESPLICITAMENTE citato nel testo, altrimenti null","mutuo":"SOLO se esplicitamente menzionato, altrimenti null","altri_beni":"SOLO beni esplicitamente citati nel testo, altrimenti null"}`)
      // Post-validate: detect GPT fabrication in real estate data
      // If property address contains the person's surname, it's almost certainly invented
      const nameParts4 = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
      for (const [k, v] of Object.entries(ext4)) {
        if (!isJunk(v) && !result[k]) {
          const vStr = typeof v === 'string' ? v.toLowerCase() : ''
          // Check for fabrication signals: person's surname in address, round values like "325.000"
          if (k === 'proprieta_immobiliari' && vStr) {
            const hasSurname = nameParts4.some((w: string) => vStr.includes(w))
            if (hasSurname) {
              console.log(`[PERSON-LOOKUP] FABRICATION DETECTED in proprieta_immobiliari: "${v}" contains person surname — DISCARDING`)
              continue
            }
          }
          if (k === 'valore_stimato_immobili' && vStr) {
            // If we're discarding the property, also discard the value
            const propVal = ext4.proprieta_immobiliari ? String(ext4.proprieta_immobiliari).toLowerCase() : ''
            const propFabricated = nameParts4.some((w: string) => propVal.includes(w))
            if (propFabricated) {
              console.log(`[PERSON-LOOKUP] Discarding valore_stimato_immobili because property was fabricated`)
              continue
            }
          }
          if (k === 'mutuo' && vStr) {
            const propVal = ext4.proprieta_immobiliari ? String(ext4.proprieta_immobiliari).toLowerCase() : ''
            const propFabricated = nameParts4.some((w: string) => propVal.includes(w))
            if (propFabricated) {
              console.log(`[PERSON-LOOKUP] Discarding mutuo because property was fabricated`)
              continue
            }
          }
          if (k === 'tipo_abitazione' && vStr) {
            const propVal = ext4.proprieta_immobiliari ? String(ext4.proprieta_immobiliari).toLowerCase() : ''
            const propFabricated = nameParts4.some((w: string) => propVal.includes(w))
            if (propFabricated) {
              console.log(`[PERSON-LOOKUP] Discarding tipo_abitazione because property was fabricated`)
              continue
            }
          }
          result[k] = v
        }
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

  // ── Final validation: LinkedIn must belong to the RIGHT person at the RIGHT company ──
  // Do a targeted Tavily search: site:linkedin.com/in + person name + company name
  // If the verification search doesn't find the same URL, it's likely an omonimo
  if (result.linkedin && company) {
    const compWordsLi = company.toLowerCase().replace(/[^a-zà-ú\s]/gi, '').split(/\s+/).filter((w: string) => w.length > 3 && !/^(srl|srls|spa|sas|snc|societa|società)$/i.test(w))
    const compSearchTerm = compWordsLi.join(' ')
    if (compSearchTerm) {
      console.log(`[PERSON-LOOKUP] LinkedIn verification: searching site:linkedin.com/in "${personName}" "${compSearchTerm}"`)
      const qLiVerify = `site:linkedin.com/in "${personName}" ${compSearchTerm}`
      const textLiVerify = await tavilySearch(qLiVerify, true, personName)
      if (textLiVerify.length > 50) {
        // Check if the verified results mention the company
        const verifyLow = textLiVerify.toLowerCase()
        const verifyMentionsCompany = compWordsLi.some((w: string) => verifyLow.includes(w))
        const liUrlMatch = textLiVerify.match(/linkedin\.com\/in\/[\w-]+/i)
        if (verifyMentionsCompany) {
          // Company confirmed in LinkedIn verification results — LinkedIn is for the RIGHT person
          if (liUrlMatch) {
            const verifiedUrl = `https://www.${liUrlMatch[0]}`
            if (verifiedUrl !== result.linkedin) {
              console.log(`[PERSON-LOOKUP] LinkedIn verification found BETTER URL: "${verifiedUrl}" (was "${result.linkedin}")`)
              result.linkedin = verifiedUrl
            } else {
              console.log(`[PERSON-LOOKUP] LinkedIn VERIFIED: "${result.linkedin}" confirmed for "${company}"`)
            }
          } else {
            console.log(`[PERSON-LOOKUP] LinkedIn VERIFIED by company match but URL not extractable — keeping "${result.linkedin}"`)
          }
        } else {
          // Company not verified — but if the LinkedIn slug matches the person's name, keep it (strong signal)
          const liSlug = (result.linkedin || '').toLowerCase().replace(/.*\/in\//, '').replace(/[^a-z]/g, '')
          const nameSlug = personName.toLowerCase().replace(/[^a-z]/g, '')
          if (liSlug.includes(nameSlug) || nameSlug.split('').filter((c: string, i: number) => liSlug.includes(nameSlug.slice(i, Math.min(i + 4, nameSlug.length)))).length >= 3) {
            console.log(`[PERSON-LOOKUP] LinkedIn verification: company NOT found but slug "${liSlug}" matches name "${nameSlug}" — KEEPING (name match)`)
          } else {
            console.log(`[PERSON-LOOKUP] LinkedIn verification: company "${company}" NOT found and slug doesn't match name — DISCARDING "${result.linkedin}" (likely omonimo)`)
            result.linkedin_scartato = result.linkedin
            result.linkedin_scartato_motivo = `Non verificato per ${company} — probabilmente omonimo`
            delete result.linkedin
          }
        }
      } else {
        // No Tavily results — but if the LinkedIn slug matches the person's name, keep it
        const liSlug = (result.linkedin || '').toLowerCase().replace(/.*\/in\//, '').replace(/[^a-z]/g, '')
        const nameSlug = personName.toLowerCase().replace(/[^a-z]/g, '')
        if (liSlug.includes(nameSlug) || nameSlug.split('').filter((c: string, i: number) => liSlug.includes(nameSlug.slice(i, Math.min(i + 4, nameSlug.length)))).length >= 3) {
          console.log(`[PERSON-LOOKUP] LinkedIn verification: no Tavily results but slug "${liSlug}" matches name "${nameSlug}" — KEEPING (name match)`)
        } else {
          console.log(`[PERSON-LOOKUP] LinkedIn verification: no results for "${personName}" + "${company}" on LinkedIn and slug doesn't match — DISCARDING "${result.linkedin}"`)
          result.linkedin_scartato = result.linkedin
          result.linkedin_scartato_motivo = `Nessun profilo LinkedIn trovato per ${personName} a ${company}`
          delete result.linkedin
        }
      }
    }
  }

  // ── Copy social links from dati_azienda when person = titolare ──
  // For freelancers/sole proprietors, company social IS their personal social
  if (result.dati_azienda && typeof result.dati_azienda === 'object') {
    const da = result.dati_azienda as Record<string, any>
    const titName = da.titolare ? String(da.titolare).toLowerCase().trim() : ''
    const pName = (result.nome_completo || personName || '').toLowerCase().trim()
    const isSamePerson = titName && pName && (titName.includes(pName) || pName.includes(titName) ||
      pName.split(/\s+/).every((w: string) => w.length < 3 || titName.includes(w)))
    if (isSamePerson) {
      if (!result.linkedin && da.linkedin) { result.linkedin = da.linkedin; console.log(`[PERSON-LOOKUP] Copied LinkedIn from dati_azienda (person=titolare)`) }
      if (!result.instagram && da.instagram) { result.instagram = da.instagram; console.log(`[PERSON-LOOKUP] Copied Instagram from dati_azienda (person=titolare)`) }
      if (!result.facebook && da.facebook) { result.facebook = da.facebook; console.log(`[PERSON-LOOKUP] Copied Facebook from dati_azienda (person=titolare)`) }
      if (!result.twitter_x && (da.twitter || da.twitter_x)) { result.twitter_x = da.twitter_x || da.twitter; console.log(`[PERSON-LOOKUP] Copied Twitter from dati_azienda (person=titolare)`) }
      if (!result.sito_web && da.sito) { result.sito_web = da.sito }
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

  delete result._skipSecondLeadRegistry

  // ── Final cleanup: remove ANY remaining placeholder/example values ──
  const placeholderRx = /esempio|example|sample|placeholder|lorem|ipsum|12345678/i
  const sequentialRx = /1234567|7654321|0000000|9999999/
  const PORTAL_DOMS = ['risultati.it','nomeesatto.it','esattospa.it','reportaziende.it','italiaonline.it','informazione-aziende.it','getfound.it','cercaziende.it','trovaaziende.it']
  for (const key of Object.keys(result)) {
    const v = result[key]
    if (typeof v === 'string') {
      if (placeholderRx.test(v)) {
        console.log(`[PERSON-LOOKUP] FINAL CLEANUP: removed placeholder "${key}": "${v.slice(0, 80)}"`)
        delete result[key]
      } else if (['telefono', 'cellulare'].includes(key) && sequentialRx.test(v.replace(/\D/g, ''))) {
        console.log(`[PERSON-LOOKUP] FINAL CLEANUP: removed sequential phone "${key}": "${v}"`)
        delete result[key]
      } else if (['sito_web', 'email'].includes(key) && PORTAL_DOMS.some(d => v.includes(d))) {
        console.log(`[PERSON-LOOKUP] FINAL CLEANUP: removed portal domain "${key}": "${v.slice(0, 60)}"`)
        delete result[key]
      } else if (key === 'email' && /^(mario\.rossi|nome\.cognome|info\.test|test@|user@|admin@example|esempio|prova@)/.test(v.toLowerCase())) {
        console.log(`[PERSON-LOOKUP] FINAL CLEANUP: removed fake email "${key}": "${v}"`)
        delete result[key]
      }
    }
  }

  return NextResponse.json(result)
}
