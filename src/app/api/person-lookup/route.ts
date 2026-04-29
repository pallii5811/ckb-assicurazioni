import { NextRequest, NextResponse } from 'next/server'
import {
  type PersonIdentity, type Evidence as IGEvidence,
  isPersonMatch,
} from '@/lib/identity-gate'

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
  } catch (splitErr: any) {
    console.log(`[PERSON-LOOKUP] GPT split failed: ${splitErr?.message || splitErr} — using regex fallback`)
  }

  // ── REGEX FALLBACK: if GPT didn't split (queryCompanyHint still empty), try regex ──
  if (!queryCompanyHint && !queryCityHint && query.length > 5) {
    // Detect company legal form in query: "Nome Cognome Asterix S.r.l. Bologna"
    // Strategy: find the legal form, take 1-3 words before it as company name
    const legalFormRx = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|srl|srls|spa|sas|snc)\b\.?/i
    const formMatch = query.match(legalFormRx)
    if (formMatch && formMatch.index !== undefined) {
      const formIdx = formMatch.index
      const formEnd = formIdx + formMatch[0].length
      // Text before legal form — last 1-3 words are company name, rest is person
      const beforeForm = query.slice(0, formIdx).trim()
      const beforeWords = beforeForm.split(/\s+/)
      // Heuristic: company name is typically 1-3 words before the legal form
      // Person names are typically 2 words (nome cognome), so take from word 3 onwards as company
      let companyNameWords = 1 // at least 1 word before S.r.l.
      if (beforeWords.length >= 4) companyNameWords = Math.min(3, beforeWords.length - 2)
      else if (beforeWords.length === 3) companyNameWords = 1
      const personWords = beforeWords.slice(0, beforeWords.length - companyNameWords)
      const compWords = beforeWords.slice(beforeWords.length - companyNameWords)
      queryPersonName = personWords.join(' ').trim()
      queryCompanyHint = `${compWords.join(' ')} ${formMatch[0]}`.trim()
      const afterCompany = query.slice(formEnd).replace(/^\s*\.?\s*/, '').trim()
      if (afterCompany.length >= 3) queryCityHint = afterCompany
      console.log(`[PERSON-LOOKUP] REGEX FALLBACK: persona="${queryPersonName}", azienda="${queryCompanyHint}", città="${queryCityHint}"`)
    } else {
      // No company form detected — check if last word is an Italian city
      const CITIES_RX = /\b(milano|roma|napoli|torino|bologna|firenze|genova|venezia|verona|padova|trieste|bari|palermo|catania|cagliari|brescia|bergamo|modena|parma|reggio\s*emilia|prato|livorno|ravenna|ferrara|rimini|sassari|monza|trento|bolzano|perugia|ancona|pescara|udine|arezzo|vicenza|lecce|terni|piacenza|novara|varese|como|lodi|cremona|mantova|siena|lucca|pisa|massa|pistoia|grosseto|biella|vercelli|asti|cuneo|aosta|sondrio|savona|imperia|la\s*spezia|forlì|cesena|imola|rovigo|belluno|treviso|pordenone|gorizia|potenza|matera|cosenza|catanzaro|reggio\s*calabria|trapani|agrigento|siracusa|ragusa|nuoro|oristano|olbia|taranto|brindisi|foggia|avellino|benevento|caserta|salerno|frosinone|latina|rieti|viterbo|chieti|l'?aquila|teramo|ascoli|macerata|fermo|pesaro|urbino)\s*$/i
      const cityM = query.match(CITIES_RX)
      if (cityM) {
        queryCityHint = cityM[1].trim()
        queryPersonName = query.replace(CITIES_RX, '').trim()
        console.log(`[PERSON-LOOKUP] REGEX FALLBACK (city only): persona="${queryPersonName}", città="${queryCityHint}"`)
      }
    }
  }

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
            // Store the URL for direct scraping fallback
            if (bestResult.url) result._tavily_last_url = bestResult.url
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
      const parsed = JSON.parse(cleaned)
      // Garantisce che il return sia sempre un oggetto, mai null/array/primitivo
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      return {}
    } catch { return {} }
  }

  const result: Record<string, any> = { nome_cercato: query, fonti: [] }

  const isJunk = (v: any) => {
    if (!v) return true
    if (typeof v !== 'string') return false
    const s = v.trim().toLowerCase()
    if (!s) return true
    if (['null','undefined','non disponibile','non specificato','n/a','n.d.','nd','non noto','sconosciuto','none','nessuno'].includes(s)) return true
    // Reject GPT-echoed prompt placeholders (e.g. "Profilo Instagram", "URL profilo Facebook", "URL profilo LinkedIn")
    if (/^(profilo|url|canale|pagina|account|username|handle|link|nome|numero|indirizzo|email|cellulare|telefono|sito|bio|descrizione)(\s+\w+){0,3}\s*$/i.test(v.trim()) && !/https?:\/\//i.test(v) && !/\.(com|it|net|org)/i.test(v)) return true
    if (/^(instagram|facebook|linkedin|twitter|youtube|tiktok|pinterest)(\s+\w+){0,3}\s*$/i.test(v.trim()) && !/https?:\/\//i.test(v) && !/\.(com|it|net|org)/i.test(v)) return true
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
    const profHintPrompt = queryProfessionHint ? `\nATTENZIONE: l'utente cerca specificamente "${searchName}" che è ${queryProfessionHint.toUpperCase()}. Se nel testo ci sono più persone con lo stesso nome, estrai SOLO quella che lavora come ${queryProfessionHint}. Ignora omonimi con professioni diverse.` : ''
    const ext1 = await gptExtract(text1, `Estrai tutte le informazioni sulla persona "${searchName}"${queryCompanyHint ? ` in relazione all'azienda "${queryCompanyHint}"` : ''}.${profHintPrompt} JSON:
{"nome_completo":"nome e cognome completo","nome":"SOLO il nome di battesimo (es. da 'Marco Rossi' → 'Marco')","cognome":"SOLO il cognome (es. da 'Marco Rossi' → 'Rossi')","ruolo":"ruolo/carica attuale","azienda":"nome azienda/società dove lavora${queryCompanyHint ? ` (PRIORITIZZA ${queryCompanyHint} se la persona ci lavora)` : ''}","settore":"settore di attività","citta":"città","descrizione":"breve descrizione professionale della persona (2-3 frasi)","linkedin":"URL profilo LinkedIn completo","tipo_lavoro":"dipendente / libero professionista / imprenditore / socio","seniority":"junior / mid / senior / executive / C-level","dimensione_azienda":"micro / piccola / media / grande (stima basata su info disponibili)"}`)
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
        console.log(`[PERSON-LOOKUP] ⚠️ OMONIMO DETECTED: user specified "${queryCompanyHint}" but Search 1 found "${result.azienda}" — discarding ALL potentially wrong identity data`)
        result.azienda_alternativa = result.azienda
        result.azienda = queryCompanyHint
        result._omonimo_detected = true
        // Discard ALL fields that likely belong to the wrong person (omonimo)
        const omonimoPoisoned = ['linkedin', 'descrizione', 'ruolo', 'settore', 'citta',
          'facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'sito_web',
          'tipo_lavoro', 'seniority', 'dimensione_azienda', 'formazione',
          'esperienze_precedenti', 'competenze', 'interessi_social']
        for (const field of omonimoPoisoned) {
          if (result[field]) {
            console.log(`[PERSON-LOOKUP] Discarding ${field}: "${String(result[field]).slice(0, 60)}" — likely belongs to omonimo`)
            delete result[field]
          }
        }
      } else {
        result.azienda_alternativa = result.azienda
        result.azienda = queryCompanyHint
      }
    }
    // Profession cross-validation on Search 1 result: if user specified profession and extracted sector is clearly unrelated, treat as omonimo
    if (queryProfessionHint && queryProfessionHint.length >= 4 && result.settore && result.azienda) {
      const profStem1 = queryProfessionHint.toLowerCase().replace(/[^a-z\u00e0-\u00fa]/gi, '').slice(0, 6)
      const allText1 = `${String(result.azienda || '')} ${String(result.settore || '')} ${String(result.ruolo || '')} ${String(result.descrizione || '')}`.toLowerCase()
      if (!allText1.includes(profStem1) && allText1.length > 15) {
        console.log(`[PERSON-LOOKUP] \u26a0\ufe0f PROFESSION MISMATCH in Search 1: user asked "${queryProfessionHint}" but found sector "${result.settore}" azienda "${result.azienda}" — discarding as omonimo`)
        result._omonimo_detected = true
        const omonimoPoisoned1 = ['azienda', 'linkedin', 'descrizione', 'ruolo', 'settore', 'citta',
          'facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'sito_web',
          'tipo_lavoro', 'seniority', 'dimensione_azienda', 'formazione',
          'esperienze_precedenti', 'competenze', 'interessi_social']
        for (const field of omonimoPoisoned1) {
          if (result[field]) {
            console.log(`[PERSON-LOOKUP] Discarding ${field}: "${String(result[field]).slice(0, 60)}" — profession mismatch omonimo`)
            delete result[field]
          }
        }
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

  // ── Fix: populate nome/cognome if GPT didn't split them ──
  if (!result.nome || !result.cognome) {
    const fullName = personName.trim()
    const parts = fullName.split(/\s+/)
    if (parts.length >= 2) {
      // Italian convention: first word(s) = nome, last word = cognome
      // Handle compound surnames: if last two words are both capitalized short words, treat last as cognome
      result.cognome = result.cognome || parts[parts.length - 1]
      result.nome = result.nome || parts.slice(0, -1).join(' ')
    } else if (parts.length === 1) {
      result.nome = result.nome || parts[0]
    }
    console.log(`[PERSON-LOOKUP] nome/cognome split: nome="${result.nome || ''}", cognome="${result.cognome || ''}" (from "${fullName}")`)
  }

  // ── Fix: Geographic omonimo filter ──
  // If user specified a city and GPT found a different one, the Search 1 result likely belongs to an omonimo
  if (queryCityHint && result.citta && !result._omonimo_detected) {
    const queryCityLow = queryCityHint.toLowerCase().replace(/[^a-zà-ú]/gi, '').trim()
    const resultCityLow = (result.citta || '').toLowerCase().replace(/[^a-zà-ú]/gi, '').trim()
    // Check if cities match (allow partial match for variants like "Milano"/"MI", "Roma"/"RM")
    const cityMatch = resultCityLow.includes(queryCityLow) || queryCityLow.includes(resultCityLow)
      || (queryCityLow.length <= 2 && resultCityLow.startsWith(queryCityLow)) // province code
    if (!cityMatch && queryCityLow.length >= 3 && resultCityLow.length >= 3) {
      console.log(`[PERSON-LOOKUP] ⚠️ GEOGRAPHIC MISMATCH: user specified "${queryCityHint}" but Search 1 found city "${result.citta}" — discarding omonimo data`)
      result._omonimo_detected = true
      result._citta_query = queryCityHint
      result._citta_scartata = result.citta
      // Discard identity fields that likely belong to the wrong person
      const geoPoisoned = ['linkedin', 'descrizione', 'ruolo', 'settore',
        'facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'sito_web',
        'tipo_lavoro', 'seniority', 'dimensione_azienda', 'formazione',
        'esperienze_precedenti', 'competenze', 'interessi_social']
      for (const field of geoPoisoned) {
        if (result[field]) {
          console.log(`[PERSON-LOOKUP] GEO FILTER: discarding ${field}: "${String(result[field]).slice(0, 60)}"`)
          delete result[field]
        }
      }
      // Reset city to what the user asked for
      result.citta = queryCityHint
    }
  }

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
      [/restaurat/, 'restauratore'], [/farmacist/, 'farmacista'], [/agronomo|agronom/, 'agronomo'],
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
            const isLocalPersonMatch = nameParts.every((p: string) => regName.includes(p))
            if (isLocalPersonMatch) {
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
                  // Strip profession prefix if lead-registry echoed our query (e.g. "restauratore Marina Manzo" → "Marina Manzo")
                  let cleanedRS = regData.ragione_sociale
                  for (const p of professionHints) {
                    if (cleanedRS.toLowerCase().startsWith(p.toLowerCase())) {
                      cleanedRS = cleanedRS.slice(p.length).trim()
                    }
                  }
                  if (!cleanedRS) cleanedRS = personName
                  const oldAzienda = result.azienda
                  result.azienda = cleanedRS
                  if (oldAzienda && oldAzienda !== cleanedRS) {
                    result.azienda_alternativa = oldAzienda
                    console.log(`[PERSON-LOOKUP] Search 1e: OVERRIDE azienda (libero professionista) "${oldAzienda}" → "${cleanedRS}"`)
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
    const profCtx1b = queryProfessionHint ? ` ${queryProfessionHint}` : ''
    const q1b = `"${personName}" ${company}${profCtx1b} ${city} telefono cellulare email contatti reteimprese.it OR paginegialle.it`
    const text1b = await tavilySearch(q1b)
    if (text1b.length > 50) {
      const ext1b = await gptExtract(text1b, `Trova i contatti DIRETTI della persona "${personName}"${company ? ` che lavora presso ${company}` : ''}. IMPORTANTE: restituisci SOLO contatti che appartengono a QUESTA persona, NON numeri generici di azienda o centralini. JSON:
{"telefono":"numero cellulare o telefono diretto della persona","email":"email personale o diretta","instagram":"profilo Instagram personale","facebook":"profilo Facebook personale"}`)
      if (!isJunk(ext1b.telefono)) {
        if (!result.telefono) {
          result.telefono = ext1b.telefono
        } else if (result.telefono !== ext1b.telefono && !result.cellulare) {
          result.cellulare = ext1b.telefono
          console.log(`[PERSON-LOOKUP] Search 1b: saved as cellulare: ${ext1b.telefono} (telefono already = ${result.telefono})`)
        }
      }
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
    const profCtx1b2 = queryProfessionHint ? ` ${queryProfessionHint}` : ''
    const cityCtx1b2 = city ? ` ${city}` : ''
    const q1b2 = `${reverseName}${profCtx1b2}${cityCtx1b2} partita IVA PEC ufficiocamerale.it`
    const text1b2 = await tavilySearch(q1b2, true, personName, true)
    if (text1b2.length > 50) {
      const ext1b2 = await gptExtract(text1b2, `Dai dati camerali, estrai SOLO le informazioni della ditta individuale intestata a "${personName}" (in formato camerale: "${reverseName}"). 
ATTENZIONE: 
- La ragione sociale DEVE contenere il nome "${personName}" o "${reverseName}"
- NON restituire dati di altre aziende o enti (es. Comune, altre società)
- La P.IVA deve essere di 11 cifre e intestata a questa persona
JSON:
{"ragione_sociale":"ragione sociale ESATTA come risulta dalla camera di commercio","partita_iva":"P.IVA 11 cifre intestata a ${personName}","pec":"PEC personale della ditta individuale","codice_fiscale":"codice fiscale","indirizzo":"indirizzo sede legale","fatturato":"fatturato annuo in euro se disponibile","dipendenti":"numero dipendenti se disponibile","codice_ateco":"codice ATECO se disponibile","descrizione_ateco":"descrizione attività ATECO se disponibile","data_costituzione":"data di costituzione/iscrizione se disponibile","stato_attivita":"attiva/inattiva/cessata"}`)
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
      // Save authoritative ragione_sociale from camerale source
      if (!isJunk(ext1b2.ragione_sociale)) {
        const rsCamerale = String(ext1b2.ragione_sociale).trim()
        const rsLow = rsCamerale.toLowerCase()
        const nameWords = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
        if (nameWords.some((w: string) => rsLow.includes(w))) {
          result._camerale_ragione_sociale = rsCamerale
          console.log(`[PERSON-LOOKUP] Search 1b2: saved camerale ragione_sociale: "${rsCamerale}"`)
        }
      }
      // Save camerale financial data for STEP 0
      const cameraleData: Record<string, any> = {}
      if (!isJunk(ext1b2.fatturato)) cameraleData.fatturato = ext1b2.fatturato
      if (!isJunk(ext1b2.dipendenti)) cameraleData.dipendenti = ext1b2.dipendenti
      if (!isJunk(ext1b2.codice_ateco)) cameraleData.codice_ateco = ext1b2.codice_ateco
      if (!isJunk(ext1b2.descrizione_ateco)) cameraleData.descrizione_ateco = ext1b2.descrizione_ateco
      if (!isJunk(ext1b2.data_costituzione)) cameraleData.data_costituzione = ext1b2.data_costituzione
      if (!isJunk(ext1b2.stato_attivita)) cameraleData.stato_attivita = ext1b2.stato_attivita
      if (Object.keys(cameraleData).length > 0) {
        result._camerale_data = cameraleData
        console.log(`[PERSON-LOOKUP] Search 1b2: saved camerale data: fatturato=${cameraleData.fatturato || 'N/A'}, dip=${cameraleData.dipendenti || 'N/A'}, ateco=${cameraleData.codice_ateco || 'N/A'}`)
      }
      console.log(`[PERSON-LOOKUP] Search 1b2 camerale done — piva: "${cleanPiva}" (valid: ${cleanPiva.length === 11}), pec: "${ext1b2.pec}"`);
      // If P.IVA not in Tavily text but we found an ufficiocamerale URL, scrape it directly
      if (!result.partita_iva && result._tavily_last_url && /ufficiocamerale\.it/i.test(result._tavily_last_url)) {
        console.log(`[PERSON-LOOKUP] Search 1b2: P.IVA missing from Tavily text, scraping ${result._tavily_last_url} directly...`)
        try {
          const ucRes = await fetch(result._tavily_last_url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
            signal: AbortSignal.timeout(8000), redirect: 'follow',
          })
          if (ucRes.ok) {
            const ucHtml = await ucRes.text()
            // Extract P.IVA from page
            const ucPivaM = ucHtml.match(/(?:P\.?\s*IVA|partita\s*iva|Codice Fiscale)[:\s]*(\d{11})/i)
              || ucHtml.match(/(\d{11})/g)?.filter(n => /^0[0-9]/.test(n)).map(n => ({ 1: n }))?.[0] as any
            const ucPiva = ucPivaM?.[1]
            if (ucPiva && ucPiva.length === 11) {
              result.partita_iva = ucPiva
              console.log(`[PERSON-LOOKUP] Search 1b2: ✅ P.IVA from ufficiocamerale scrape: ${ucPiva}`)
            }
            // Extract structured data from ufficiocamerale page (HTML has label/value pairs)
            // Dipendenti: handle "Dipendenti 1 (2021)" or "Dipendenti: 1" or "Dipendenti</td><td>1"
            const ucDipM = ucHtml.match(/[Dd]ipendenti[^<]*?[:\s>]+\s*(\d+(?:\s*[-–a-z ]*\d+)?)/i)
              || ucHtml.match(/[Dd]ipendenti<\/[^>]+>\s*<[^>]+>\s*(\d+)/i)
            if (ucDipM && ucDipM[1]?.trim()) {
              if (!result._camerale_data) result._camerale_data = {}
              result._camerale_data.dipendenti = ucDipM[1].trim()
              console.log(`[PERSON-LOOKUP] Search 1b2: dipendenti from ufficiocamerale: ${result._camerale_data.dipendenti}`)
            }
            // Fatturato
            const ucFatM = ucHtml.match(/[Ff]atturato[^<]*?[:\s>]+\s*€?\s*([\d.,]+)/i)
              || ucHtml.match(/[Ff]atturato<\/[^>]+>\s*<[^>]+>\s*€?\s*([\d.,]+)/i)
            if (ucFatM && ucFatM[1]?.trim() && ucFatM[1].trim() !== '0') {
              if (!result._camerale_data) result._camerale_data = {}
              result._camerale_data.fatturato = ucFatM[1].replace(/,+$/, '').trim()
              console.log(`[PERSON-LOOKUP] Search 1b2: fatturato from ufficiocamerale: ${result._camerale_data.fatturato}`)
            }
            // ATECO
            const ucAtecoM = ucHtml.match(/[Aa]teco[^<]*?[:\s>]+\s*([\d.]+)/i)
              || ucHtml.match(/[Aa]teco<\/[^>]+>\s*<[^>]+>\s*([\d.]+)/i)
            if (ucAtecoM && ucAtecoM[1]?.trim()) {
              if (!result._camerale_data) result._camerale_data = {}
              result._camerale_data.codice_ateco = ucAtecoM[1].trim()
            }
            // Indirizzo/Sede
            const ucIndM = ucHtml.match(/[Ii]ndirizzo[^<]*?[:\s>]+\s*([^<]{5,80})/i)
            if (ucIndM && ucIndM[1]?.trim() && !result.indirizzo) {
              result.indirizzo = ucIndM[1].trim()
              if (!result.citta) {
                const cittaM = result.indirizzo.match(/[-–]\s*([A-Z][a-zà-ú]+(?:\s+[A-Z][a-zà-ú]+)*)\s*\(/i)
                if (cittaM) result.citta = cittaM[1].trim()
              }
              console.log(`[PERSON-LOOKUP] Search 1b2: indirizzo from ufficiocamerale: ${result.indirizzo}`)
            }
          }
        } catch (e: any) { console.log(`[PERSON-LOOKUP] Search 1b2 ufficiocamerale scrape failed: ${e?.message}`) }
      }
    }
  }

  // ── Search 1b3: P.IVA fallback — se 1b2 non ha trovato P.IVA, prova con nome azienda ──
  // STRICT validation: the found ragione_sociale must contain the person's name
  if (!result.partita_iva && company) {
    console.log(`[PERSON-LOOKUP] Search 1b3: P.IVA still missing, trying company name "${company}" on camerale...`)
    const q1b3 = `"${company}" partita IVA "${personName}" ufficiocamerale.it`
    const text1b3 = await tavilySearch(q1b3, true, personName, true)
    if (text1b3.length > 50) {
      const ext1b3 = await gptExtract(text1b3, `Trova la partita IVA dell'azienda "${company}" il cui titolare è "${personName}". ATTENZIONE: la ragione sociale DEVE contenere "${personName}" o "${personName.split(' ').reverse().join(' ')}". NON restituire P.IVA di aziende diverse. JSON:\n{"partita_iva":"P.IVA 11 cifre","ragione_sociale":"ragione sociale esatta"}`)
      const piva1b3 = (ext1b3.partita_iva || '').replace(/\D/g, '')
      const rs1b3 = String(ext1b3.ragione_sociale || '').toLowerCase()
      // VALIDATE: ragione_sociale must contain person name words
      const pWords1b3 = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
      const rsMatchesPerson = pWords1b3.some((w: string) => rs1b3.includes(w))
      if (piva1b3.length === 11 && rsMatchesPerson) {
        result.partita_iva = piva1b3
        console.log(`[PERSON-LOOKUP] Search 1b3: ✅ found P.IVA via company name: ${piva1b3} (rs: "${ext1b3.ragione_sociale}")`)
        if (!isJunk(ext1b3.ragione_sociale) && !result._camerale_ragione_sociale) {
          result._camerale_ragione_sociale = ext1b3.ragione_sociale
        }
      } else if (piva1b3.length === 11) {
        console.log(`[PERSON-LOOKUP] Search 1b3: REJECTED P.IVA ${piva1b3} — ragione_sociale "${ext1b3.ragione_sociale}" does NOT match person "${personName}"`)
      }
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

  // ── Search 1d2: Dedicated P.IVA search for individual professionals ──
  // For architects, lawyers, consultants etc. P.IVA is often under "COGNOME NOME" in registroimprese
  // Also detect profession from ruolo if queryProfessionHint is empty
  const detectedProfession = queryProfessionHint || (() => {
    const r = String(result.ruolo || '').toLowerCase()
    const profDetect: Array<[RegExp, string]> = [
      [/architett/, 'architetto'], [/avvocat/, 'avvocato'], [/consulent/, 'consulente'],
      [/ingegner/, 'ingegnere'], [/commercialista/, 'commercialista'], [/notai/, 'notaio'],
      [/medic|dottor/, 'medico'], [/dentist/, 'dentista'], [/geometr/, 'geometra'],
      [/psicolog/, 'psicologo'], [/fisioterap/, 'fisioterapista'], [/veterinar/, 'veterinario'],
      [/restaurat/, 'restauratore'], [/farmacist/, 'farmacista'], [/agronomo/, 'agronomo'],
    ]
    for (const [re, prof] of profDetect) if (re.test(r)) return prof
    return ''
  })()
  if (!result.partita_iva && detectedProfession) {
    const reverseName1d2 = personName.split(' ').reverse().join(' ')
    const cityCtx1d2 = city ? ` ${city}` : ''
    const profCtx1d2 = detectedProfession
    console.log(`[PERSON-LOOKUP] Search 1d2: P.IVA search for professional "${reverseName1d2}" (${profCtx1d2})${cityCtx1d2}`)

    // Try 1: registroimprese.it / informazioniaziende.it with COGNOME NOME
    const q1d2a = `"${reverseName1d2}" ${profCtx1d2}${cityCtx1d2} partita IVA ditta individuale site:registroimprese.it OR site:informazioniaziende.it OR site:ufficiocamerale.it`
    const text1d2a = await tavilySearch(q1d2a, true, reverseName1d2, true)
    if (text1d2a.length > 50) {
      const ext1d2a = await gptExtract(text1d2a, `Trova la P.IVA della ditta individuale di "${personName}" (formato camerale: "${reverseName1d2}"), ${profCtx1d2}${cityCtx1d2 ? ` a${cityCtx1d2}` : ''}. La ragione sociale DEVE contenere "${reverseName1d2}" o "${personName}". JSON:\n{"partita_iva":"P.IVA 11 cifre","ragione_sociale":"ragione sociale esatta","pec":"PEC se disponibile"}`)
      const piva1d2 = (ext1d2a.partita_iva || '').replace(/\D/g, '')
      const rs1d2 = String(ext1d2a.ragione_sociale || '').toLowerCase()
      const pWords1d2 = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
      if (piva1d2.length === 11 && pWords1d2.some((w: string) => rs1d2.includes(w))) {
        result.partita_iva = piva1d2
        if (!isJunk(ext1d2a.pec) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext1d2a.pec) && !result.pec) result.pec = ext1d2a.pec
        if (!result._camerale_ragione_sociale) result._camerale_ragione_sociale = ext1d2a.ragione_sociale
        console.log(`[PERSON-LOOKUP] Search 1d2: ✅ P.IVA found for professional: ${piva1d2} (rs: "${ext1d2a.ragione_sociale}")`)
      }
    }

    // Try 2: professional registry (ordine) + Tavily if still missing
    if (!result.partita_iva) {
      const q1d2b = `"${personName}" ${profCtx1d2}${cityCtx1d2} "partita iva" OR "P.IVA" OR "codice fiscale" ordine albo`
      const text1d2b = await tavilySearch(q1d2b, true, personName, true)
      if (text1d2b.length > 50) {
        const ext1d2b = await gptExtract(text1d2b, `Trova la P.IVA di "${personName}", ${profCtx1d2}${cityCtx1d2 ? ` a${cityCtx1d2}` : ''}. SOLO P.IVA intestata a QUESTA persona. JSON:\n{"partita_iva":"P.IVA 11 cifre","pec":"PEC se disponibile"}`)
        const piva1d2b = (ext1d2b.partita_iva || '').replace(/\D/g, '')
        if (piva1d2b.length === 11) {
          result.partita_iva = piva1d2b
          if (!isJunk(ext1d2b.pec) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext1d2b.pec) && !result.pec) result.pec = ext1d2b.pec
          console.log(`[PERSON-LOOKUP] Search 1d2b: ✅ P.IVA found via albo/ordine: ${piva1d2b}`)
        }
      }
    }
    console.log(`[PERSON-LOOKUP] After Search 1d2 — P.IVA: "${result.partita_iva || 'N/A'}"`)
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
            // Extract ragione_sociale from title (e.g. "G.E.M DI GORGONE MARCO - fatturato... | CompanyReports.it")
            const titleM = html.match(/<title>([^<]+?)<\/title>/i)
            if (titleM) {
              let rsFromTitle = titleM[1].trim().replace(/\s*[-–|]\s*(fatturato|bilancio|indirizzo|CompanyReports|company).*$/i, '').trim()
              if (rsFromTitle.length >= 3 && !/companyreports/i.test(rsFromTitle)) {
                crData.ragione_sociale = rsFromTitle
                console.log(`[PERSON-LOOKUP] CompanyReports title → ragione_sociale: "${rsFromTitle}"`)
              }
            }
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
            const crLooksLikeCompany = /s\.?r\.?l|societa|società|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s/i.test(`${crData.ragione_sociale || ''} ${crData.forma_giuridica || ''}`)
            const crProfessionText = `${crData.ragione_sociale || ''} ${crData.codice_ateco || ''}`.toLowerCase()
            let crRejectedForProfessional = false
            // ── COMPANY NAME FILTER: if user specified a company, CR ragione_sociale MUST match ──
            if (queryCompanyHint && crData.ragione_sociale) {
              const hintClean = queryCompanyHint.toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|di|e)\b/gi, '').replace(/[^a-zà-ú0-9\s]/gi, '').trim()
              const crClean = crData.ragione_sociale.toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|di|e)\b/gi, '').replace(/[^a-zà-ú0-9\s]/gi, '').trim()
              const hintWords = hintClean.split(/\s+/).filter((w: string) => w.length >= 3)
              const crMatches = hintWords.length > 0 && hintWords.some((w: string) => crClean.includes(w))
              if (!crMatches) {
                console.log(`[PERSON-LOOKUP] CompanyReports REJECTED — ragione_sociale "${crData.ragione_sociale}" does NOT match query company "${queryCompanyHint}" — omonimia`)
                delete result.partita_iva; delete result.pec; delete result.dati_azienda
                delete result._cr_ragione_sociale; delete result._cr_sede_legale
                result.piva_scartata = pivaStr
                result.piva_scartata_motivo = `P.IVA intestata a "${crData.ragione_sociale}" (non corrisponde a "${queryCompanyHint}")`
                crRejectedForProfessional = true
              }
            }
            // ── CITY FILTER: if user specified a city, CR sede_legale MUST match ──
            if (!crRejectedForProfessional && queryCityHint && crData.sede_legale) {
              const cityLow = queryCityHint.toLowerCase()
              const sedeLow = crData.sede_legale.toLowerCase()
              if (!sedeLow.includes(cityLow) && cityLow.length >= 3) {
                console.log(`[PERSON-LOOKUP] CompanyReports REJECTED — sede "${crData.sede_legale}" does NOT match city "${queryCityHint}" — omonimia`)
                delete result.partita_iva; delete result.pec; delete result.dati_azienda
                delete result._cr_ragione_sociale; delete result._cr_sede_legale
                result.piva_scartata = pivaStr
                result.piva_scartata_motivo = `P.IVA in "${crData.sede_legale}" (non corrisponde a "${queryCityHint}")`
                crRejectedForProfessional = true
              }
            }
            if (!crRejectedForProfessional && detectedProfession && crLooksLikeCompany && !crProfessionText.includes(detectedProfession.toLowerCase().slice(0, 6))) {
              console.log(`[PERSON-LOOKUP] CompanyReports P.IVA ${pivaStr} rejected — "${crData.ragione_sociale}" is a company, not individual professional "${personName}" (${detectedProfession})`)
              delete result.partita_iva
              delete result.pec
              delete result.dati_azienda
              delete result._cr_ragione_sociale
              delete result._cr_sede_legale
              result.piva_scartata = pivaStr
              result.piva_scartata_motivo = `P.IVA intestata a società/omonimo (${crData.ragione_sociale || crData.forma_giuridica})`
              crRejectedForProfessional = true
            }
            // Store as dati_azienda
            if (!crRejectedForProfessional && Object.keys(crData).length > 0) {
              console.log(`[PERSON-LOOKUP] CompanyReports data:`, JSON.stringify(crData))
              if (!result.dati_azienda) result.dati_azienda = {}
              if (crData.ragione_sociale) {
                result.dati_azienda.ragione_sociale = crData.ragione_sociale
                // Save authoritative ragione_sociale (survives lead-registry overwrite)
                result._cr_ragione_sociale = crData.ragione_sociale
              }
              if (crData.fatturato) result.dati_azienda.fatturato = crData.fatturato
              if (crData.fatturato_anno) result.dati_azienda.fatturato_anno = crData.fatturato_anno
              if (crData.dipendenti) result.dati_azienda.dipendenti = crData.dipendenti
              if (crData.codice_ateco) result.dati_azienda.codice_ateco = crData.codice_ateco
              if (crData.forma_giuridica) result.dati_azienda.forma_giuridica = crData.forma_giuridica
              if (crData.sede_legale) {
                result.dati_azienda.sede_legale = crData.sede_legale
                result._cr_sede_legale = crData.sede_legale
              }
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
          console.log(`[PERSON-LOOKUP] lead-registry returned: "${regData.ragione_sociale}" P.IVA=${regData.partita_iva} fatturato=${regData.fatturato} dip=${regData.dipendenti} titolare=${regData.titolare}`)

          // ── CRITICAL VALIDATION: verify person is actually linked to this company ──
          const pLow = personName.toLowerCase().replace(/[^a-zà-ú\s]/gi, '').trim()
          const pWords = pLow.split(/\s+/).filter((w: string) => w.length >= 3)
          let personLinked = false
          if (pWords.length > 0) {
            // Check titolare
            const titLow = String(regData.titolare || '').toLowerCase()
            if (pWords.every((w: string) => titLow.includes(w))) personLinked = true
            // Check ragione_sociale (imprese individuali: "X DI COGNOME NOME")
            const rsLow = String(regData.ragione_sociale || '').toLowerCase()
            if (!personLinked && pWords.every((w: string) => rsLow.includes(w))) personLinked = true
            // Check persone/soci
            if (!personLinked && Array.isArray(regData.persone)) {
              for (const s of regData.persone as any[]) {
                const sLow = String(s?.nome || '').toLowerCase()
                if (pWords.every((w: string) => sLow.includes(w))) { personLinked = true; break }
              }
            }
            // USER TRUST: if the user explicitly specified a company AND lead-registry returned THAT company,
            // trust the user even if titolare is not yet verified (may be Gemini 429 / data unavailable)
            if (!personLinked && queryCompanyHint) {
              const hintClean = queryCompanyHint.toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|di|e)\b/gi, '').replace(/[^a-zà-ú0-9\s]/gi, '').trim()
              const regRsClean = rsLow.replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|di|e)\b/gi, '').replace(/[^a-zà-ú0-9\s]/gi, '').trim()
              const hintW = hintClean.split(/\s+/).filter((w: string) => w.length >= 3)
              if (hintW.length > 0 && hintW.some((w: string) => regRsClean.includes(w))) {
                console.log(`[PERSON-LOOKUP] USER TRUST: user specified "${queryCompanyHint}" and lead-registry found "${regData.ragione_sociale}" — accepting link`)
                personLinked = true
              }
            }
          } else {
            personLinked = true // can't validate short names, accept
          }

          // ── Profession cross-validation: reject company if sector clearly contradicts user's profession hint ──
          if (personLinked && queryProfessionHint && queryProfessionHint.length >= 4) {
            const profStem = queryProfessionHint.toLowerCase().replace(/[^a-zà-ú]/gi, '').slice(0, 8)
            const companyText = `${String(regData.ragione_sociale || '')} ${String(regData.settore || '')} ${String(regData.codice_ateco_descrizione || '')} ${String(regData.descrizione_ateco || '')} ${String(regData.codice_ateco || '')}`.toLowerCase()
            const profInCompany = companyText.includes(profStem.slice(0, 5))
            if (!profInCompany && companyText.replace(/[^a-z ]/g, '').trim().length > 10) {
              console.log(`[PERSON-LOOKUP] ⚠️ PROFESSION MISMATCH: user asked "${queryProfessionHint}" but company is "${regData.ragione_sociale}" (sector: "${regData.settore || 'N/A'}") — REJECTING`)
              personLinked = false
            }
          }

          // ── CITY VALIDATION: if user specified city, lead-registry result must match ──
          if (personLinked && queryCityHint && queryCityHint.length >= 3) {
            const regCity = String(regData.citta || regData.sede_legale || '').toLowerCase()
            const queryCityLow = queryCityHint.toLowerCase()
            if (regCity.length > 0 && !regCity.includes(queryCityLow)) {
              console.log(`[PERSON-LOOKUP] ⚠️ CITY MISMATCH: user asked "${queryCityHint}" but lead-registry returned "${regData.citta || regData.sede_legale}" — REJECTING`)
              personLinked = false
            }
          }

          if (personLinked) {
            result.dati_azienda = regData
            if (regData.partita_iva && !result.partita_iva) result.partita_iva = regData.partita_iva
            if (regData.pec && !result.pec) result.pec = regData.pec
            if (regData.sede_legale && !result.indirizzo) result.indirizzo = regData.sede_legale
            if (regData.sito) result.sito_web = regData.sito
            if (regData.email_privacy && !result.email) result.email = regData.email_privacy
            result.fonti.push('lead-registry (dettaglio lead)')
            console.log(`[PERSON-LOOKUP] lead-registry VERIFIED: "${personName}" is linked to "${regData.ragione_sociale}"`)
          } else {
            console.log(`[PERSON-LOOKUP] ⚠️ PERSON NOT LINKED: "${personName}" NOT found as titolare/socio of "${regData.ragione_sociale}" (titolare: "${regData.titolare}") — REJECTING company data`)
            let fallbackDone = false

            // ── STEP 0: Check if we already have a CORRECT P.IVA from earlier searches ──
            const ourPivaAlready = String(result.partita_iva || '').replace(/\D/g, '')
            const rejectedPiva = String(regData.partita_iva || '').replace(/\D/g, '')
            if (ourPivaAlready.length === 11 && ourPivaAlready !== rejectedPiva) {
              console.log(`[PERSON-LOOKUP] ✅ We already have correct P.IVA ${ourPivaAlready} (≠ rejected ${rejectedPiva}) — using existing data`)
              // Defensive cleanup: STEP 0 triggering means we're in an omonimo scenario.
              // Any personal identity fields from Search 1/1e may belong to the wrong person.
              // EXCEPTION: if user's profession hint validates the Search 1 data, KEEP personal fields.
              result._omonimo_detected = true
              const profValidatedSearch1 = queryProfessionHint && queryProfessionHint.length >= 4
                && result.settore
                && String(result.settore).toLowerCase().includes(queryProfessionHint.toLowerCase().replace(/[^a-zà-ú]/gi, '').slice(0, 6))
              let poisoned: string[]
              if (profValidatedSearch1) {
                console.log(`[PERSON-LOOKUP] STEP 0 cleanup: KEEPING profession-validated data (settore="${result.settore}" matches "${queryProfessionHint}")`)
                // Only discard company-specific data and contacts that might be from wrong company
                poisoned = ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
                  'sito_web', 'telefono', 'email']
              } else {
                poisoned = ['ruolo', 'settore', 'descrizione', 'citta',
                  'linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
                  'sito_web', 'tipo_lavoro', 'seniority', 'dimensione_azienda',
                  'formazione', 'esperienze_precedenti', 'competenze', 'interessi_social',
                  'anni_esperienza', 'colleghi_noti',
                  'telefono', 'email']
              }
              for (const f of poisoned) {
                if (result[f]) {
                  console.log(`[PERSON-LOOKUP] STEP 0 cleanup: discarding ${f}="${String(result[f]).slice(0, 60)}" (omonimo scenario)`)
                  delete result[f]
                }
              }
              // Scrape CompanyReports for the CORRECT P.IVA to get authoritative ragione_sociale
              try {
                const crRes0 = await fetch(`https://www.companyreports.it/${ourPivaAlready}`, {
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' },
                  signal: AbortSignal.timeout(10000), redirect: 'follow',
                })
                if (crRes0.ok) {
                  const crHtml0 = await crRes0.text()
                  const titleM0 = crHtml0.match(/<title>([^<]+?)<\/title>/i)
                  if (titleM0) {
                    const rsTitle0 = titleM0[1].trim().replace(/\s*[-–|]\s*(fatturato|bilancio|indirizzo|CompanyReports|company).*$/i, '').trim()
                    if (rsTitle0.length >= 3 && !/companyreports/i.test(rsTitle0)) {
                      console.log(`[PERSON-LOOKUP] ✅ CompanyReports authoritative name: "${rsTitle0}"`)
                      result.azienda = rsTitle0
                      result._cr_ragione_sociale = rsTitle0
                      if (!result.dati_azienda) result.dati_azienda = { found: true }
                      result.dati_azienda.ragione_sociale = rsTitle0
                      result.dati_azienda.partita_iva = ourPivaAlready
                    }
                  }
                  // Also extract financial data
                  const meta0 = crHtml0.match(/meta name="description" content="([^"]+)"/i)
                  if (meta0) {
                    const fatM0 = meta0[1].match(/Fatturato\s+([\d.,]+)/i)
                    if (fatM0 && result.dati_azienda) result.dati_azienda.fatturato = fatM0[1].replace(/,+$/, '').trim()
                    const ateM0 = meta0[1].match(/Ateco\s+([\d.]+)/i)
                    if (ateM0 && result.dati_azienda) result.dati_azienda.codice_ateco = ateM0[1]
                    const dipM0 = meta0[1].match(/Dipendenti\s+(\d+)/i)
                    if (dipM0 && result.dati_azienda) result.dati_azienda.dipendenti = dipM0[1]
                  }
                  // If title didn't give ragione_sociale, use camerale from Search 1b2
                  if (!result._cr_ragione_sociale && result._camerale_ragione_sociale) {
                    console.log(`[PERSON-LOOKUP] Using camerale ragione_sociale: "${result._camerale_ragione_sociale}"`)
                    result.azienda = result._camerale_ragione_sociale
                    result._cr_ragione_sociale = result._camerale_ragione_sociale
                  }
                  // Always initialize dati_azienda
                  if (!result.dati_azienda) result.dati_azienda = { found: true }
                  if (result._cr_ragione_sociale) result.dati_azienda.ragione_sociale = result._cr_ragione_sociale
                  result.dati_azienda.partita_iva = ourPivaAlready
                  result.dati_azienda.titolare = personName
                  // Extract sede from FAQ
                  const faqM0 = crHtml0.match(/"acceptedAnswer"\s*:\s*\{\s*"@type"\s*:\s*"Answer"\s*,\s*"text"\s*:\s*"([^"]+)"/i)
                  if (faqM0) {
                    const sedeM0 = faqM0[1].match(/(?:sede|indirizzo)[:\s]+([^.,"]+)/i)
                    if (sedeM0) {
                      result.dati_azienda.sede_legale = sedeM0[1].trim()
                      result._cr_sede_legale = sedeM0[1].trim()
                    }
                  }
                  // Apply camerale data from Search 1b2 (fatturato, dipendenti, ateco)
                  if (result._camerale_data && result.dati_azienda) {
                    for (const [ck, cv] of Object.entries(result._camerale_data as Record<string, any>)) {
                      if (cv && !result.dati_azienda[ck]) result.dati_azienda[ck] = cv
                    }
                  }
                  result.fonti.push('CompanyReports.it (autoritativo)')
                  fallbackDone = true
                  console.log(`[PERSON-LOOKUP] ✅ STEP 0 SUCCESS: "${result.azienda}" P.IVA=${ourPivaAlready} fatturato=${result.dati_azienda?.fatturato || 'N/A'} dip=${result.dati_azienda?.dipendenti || 'N/A'} sede=${result.dati_azienda?.sede_legale || 'N/A'}`)

                  // ── Profession vs ATECO cross-validation: reject P.IVA if ATECO clearly mismatches ──
                  if (queryProfessionHint && queryProfessionHint.length >= 4 && result.dati_azienda) {
                    const profStem0 = queryProfessionHint.toLowerCase().replace(/[^a-zà-ú]/gi, '').slice(0, 6)
                    const atecoText0 = `${String(result.dati_azienda.descrizione_ateco || '')} ${String(result.dati_azienda.codice_ateco || '')} ${String(result.dati_azienda.settore || '')} ${String(result.azienda || '')}`.toLowerCase()
                    if (atecoText0.replace(/[^a-z ]/g, '').trim().length > 10 && !atecoText0.includes(profStem0)) {
                      console.log(`[PERSON-LOOKUP] ⚠️ STEP 0 ATECO MISMATCH: profession "${queryProfessionHint}" vs ATECO "${result.dati_azienda.descrizione_ateco || result.dati_azienda.codice_ateco || 'N/A'}" — P.IVA ${ourPivaAlready} belongs to WRONG homonym! Clearing company data.`)
                      delete result.partita_iva
                      delete result.pec
                      delete result.dati_azienda
                      delete result._cr_ragione_sociale
                      delete result._cr_sede_legale
                      delete result._camerale_data
                      delete result._camerale_ragione_sociale
                      fallbackDone = false
                    }
                  }
                }
              } catch (e: any) { console.log(`[PERSON-LOOKUP] STEP 0 CompanyReports failed: ${e?.message || e}`) }

              // ── STEP 0b: Scrape fatturatoitalia.it for financial data ──
              // URL: /x-{PIVA} — the slug is ignored, only P.IVA matters
              // Data is in JSON-LD Schema.org Dataset + meta description
              if (result.partita_iva && (!result.dati_azienda?.fatturato || !result.dati_azienda?.dipendenti)) {
                try {
                  const fiUrl = `https://www.fatturatoitalia.it/x-${ourPivaAlready}`
                  console.log(`[PERSON-LOOKUP] STEP 0b: Scraping fatturatoitalia.it for P.IVA ${ourPivaAlready}...`)
                  const fiRes = await fetch(fiUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
                    signal: AbortSignal.timeout(8000), redirect: 'follow',
                  })
                  if (fiRes.ok) {
                    const fiHtml = await fiRes.text()
                    if (!result.dati_azienda) result.dati_azienda = { found: true }
                    // 1. Parse JSON-LD Dataset for fatturato/utile per year (most reliable)
                    const jsonLdM = fiHtml.match(/"@type"\s*:\s*"Dataset"[^}]*"variableMeasured"\s*:\s*\[([\s\S]*?)\]\s*,/i)
                    if (jsonLdM) {
                      const measures = [...jsonLdM[1].matchAll(/"name"\s*:\s*"([^"]+)"[\s\S]*?"value"\s*:\s*"([^"]+)"/g)]
                      // Get most recent fatturato
                      let latestYear = 0, latestFat = '', latestUtile = ''
                      for (const m of measures) {
                        const yearM = m[1].match(/(\d{4})/)
                        if (!yearM) continue
                        const year = parseInt(yearM[1])
                        if (/fatturato/i.test(m[1]) && year > latestYear) {
                          latestYear = year; latestFat = m[2]
                        }
                        if (/utile/i.test(m[1]) && year >= latestYear) {
                          latestUtile = m[2]
                        }
                      }
                      if (latestFat && !result.dati_azienda.fatturato) {
                        // Format: "1691366" → "1.691.366"
                        const fatNum = parseInt(latestFat)
                        result.dati_azienda.fatturato = isNaN(fatNum) ? latestFat : fatNum.toLocaleString('it-IT')
                        result.dati_azienda.anno_fatturato = latestYear
                        console.log(`[PERSON-LOOKUP] STEP 0b: ✅ fatturato ${latestYear} from fatturatoitalia: €${result.dati_azienda.fatturato}`)
                      }
                      if (latestUtile && !result.dati_azienda.utile_netto) {
                        const utNum = parseInt(latestUtile)
                        result.dati_azienda.utile_netto = isNaN(utNum) ? latestUtile : utNum.toLocaleString('it-IT')
                      }
                    }
                    // 2. Parse meta description for summary (backup)
                    const metaDescM = fiHtml.match(/name="description"\s+content="([^"]+)"/i)
                    if (metaDescM && !result.dati_azienda.fatturato) {
                      const descFat = metaDescM[1].match(/fatturato\s*([\d.,]+)\s*€/i)
                      if (descFat) result.dati_azienda.fatturato = descFat[1].trim()
                      const descUt = metaDescM[1].match(/utile\s*(-?[\d.,]+)\s*€/i)
                      if (descUt && !result.dati_azienda.utile_netto) result.dati_azienda.utile_netto = descUt[1].trim()
                    }
                    // 3. Extract dipendenti from HTML (N. Dipendenti row in table)
                    const fiDipM = fiHtml.match(/[Nn]\.?\s*[Dd]ipendenti[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
                      || fiHtml.match(/[Dd]ipendenti[:\s]+(\d+(?:\s*[-–a]\s*\d+)?)/i)
                      || fiHtml.match(/"dipendenti"[:\s]*"?(\d+[^"<]*)"?/i)
                    if (fiDipM && fiDipM[1]?.trim() && !result.dati_azienda.dipendenti) {
                      const dipVal = fiDipM[1].trim()
                      if (dipVal && dipVal !== '0' && !/^\s*$/.test(dipVal)) {
                        result.dati_azienda.dipendenti = dipVal
                        console.log(`[PERSON-LOOKUP] STEP 0b: ✅ dipendenti from fatturatoitalia: ${dipVal}`)
                      }
                    }
                    // 4. Extract ATECO
                    const fiAtM = fiHtml.match(/ATECO[^<]*<\/[^>]+>\s*<[^>]+>\s*(?:<a[^>]*>)?\s*([\d.]+)/i)
                    if (fiAtM && fiAtM[1]?.trim() && !result.dati_azienda.codice_ateco) {
                      result.dati_azienda.codice_ateco = fiAtM[1].trim()
                    }
                    // 5. Extract Sede from meta or HTML
                    const fiCittaM = fiHtml.match(/[Cc]itt[àa][^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]{2,40})/i)
                    if (fiCittaM && fiCittaM[1]?.trim() && !result.citta) {
                      result.citta = fiCittaM[1].trim()
                    }
                    const fiIndM = fiHtml.match(/[Ii]ndirizzo[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]{5,80})/i)
                    if (fiIndM && fiIndM[1]?.trim() && !result.dati_azienda.sede_legale) {
                      result.dati_azienda.sede_legale = fiIndM[1].trim()
                    }
                    if (result.dati_azienda.fatturato || result.dati_azienda.dipendenti) {
                      if (!result.fonti.includes('fatturatoitalia.it')) result.fonti.push('fatturatoitalia.it')
                      console.log(`[PERSON-LOOKUP] STEP 0b fatturatoitalia done: fatturato=${result.dati_azienda.fatturato || 'N/A'} dip=${result.dati_azienda.dipendenti || 'N/A'} utile=${result.dati_azienda.utile_netto || 'N/A'}`)
                    } else {
                      console.log(`[PERSON-LOOKUP] STEP 0b: fatturatoitalia page found but no financial data extracted`)
                    }
                  }
                } catch (e: any) { console.log(`[PERSON-LOOKUP] STEP 0b fatturatoitalia failed: ${e?.message}`) }
              }
            }

            // ── Post-0b ATECO validation: fatturatoitalia may have set descrizione_ateco ──
            if (queryProfessionHint && queryProfessionHint.length >= 4 && result.partita_iva && result.dati_azienda) {
              const profStem0b = queryProfessionHint.toLowerCase().replace(/[^a-zà-ú]/gi, '').slice(0, 6)
              const atecoText0b = `${String(result.dati_azienda.descrizione_ateco || '')} ${String(result.dati_azienda.codice_ateco || '')} ${String(result.dati_azienda.settore || '')}`.toLowerCase()
              if (atecoText0b.replace(/[^a-z ]/g, '').trim().length > 10 && !atecoText0b.includes(profStem0b)) {
                console.log(`[PERSON-LOOKUP] ⚠️ POST-0b ATECO MISMATCH: profession "${queryProfessionHint}" vs ATECO "${result.dati_azienda.descrizione_ateco || atecoText0b}" — WRONG homonym P.IVA! Clearing.`)
                delete result.partita_iva
                delete result.pec
                delete result.dati_azienda
                delete result._cr_ragione_sociale
                delete result._cr_sede_legale
                delete result._camerale_data
                delete result._camerale_ragione_sociale
              }
            }

            // ── STEP 0c: Tavily for missing dipendenti/fatturato from ufficiocamerale (JS-rendered) ──
            if ((!result.dati_azienda?.dipendenti || !result.dati_azienda?.fatturato) && result.partita_iva) {
              const rsName = result.azienda || result._camerale_ragione_sociale || ''
              if (rsName) {
                console.log(`[PERSON-LOOKUP] STEP 0c: Tavily search for dipendenti/fatturato of "${rsName}"...`)
                const q0c = `"${rsName}" dipendenti fatturato site:ufficiocamerale.it OR site:fatturatoitalia.it`
                const text0c = await tavilySearch(q0c, false, rsName)
                if (text0c.length > 30) {
                  const ext0c = await gptExtract(text0c, `Estrai i dati aziendali di "${rsName}" (P.IVA ${ourPivaAlready}). JSON:\n{"dipendenti":"numero dipendenti","fatturato":"fatturato annuo in euro","codice_ateco":"codice ATECO","sede":"indirizzo sede legale","citta":"città"}`)
                  if (!result.dati_azienda) result.dati_azienda = { found: true }
                  if (!isJunk(ext0c.dipendenti) && !result.dati_azienda.dipendenti) {
                    result.dati_azienda.dipendenti = ext0c.dipendenti
                    console.log(`[PERSON-LOOKUP] STEP 0c: ✅ dipendenti via Tavily: ${ext0c.dipendenti}`)
                  }
                  if (!isJunk(ext0c.fatturato) && !result.dati_azienda.fatturato) {
                    result.dati_azienda.fatturato = ext0c.fatturato
                    console.log(`[PERSON-LOOKUP] STEP 0c: ✅ fatturato via Tavily: ${ext0c.fatturato}`)
                  }
                  if (!isJunk(ext0c.codice_ateco) && !result.dati_azienda.codice_ateco) {
                    result.dati_azienda.codice_ateco = ext0c.codice_ateco
                  }
                  if (!isJunk(ext0c.sede) && !result.dati_azienda.sede_legale) {
                    result.dati_azienda.sede_legale = ext0c.sede
                  }
                  if (!isJunk(ext0c.citta) && !result.citta) {
                    result.citta = ext0c.citta
                  }
                  if (result.dati_azienda.dipendenti || result.dati_azienda.fatturato) {
                    if (!result.fonti.includes('ufficiocamerale.it')) result.fonti.push('ufficiocamerale.it')
                  }
                }
              }
            }

            // ── STEP 1: OpenAPI.it search (€0.01) — Camera di Commercio, 100% accurato ──
            const openApiToken = process.env.OPENAPI_IT_TOKEN || ''
            if (openApiToken) {
              const reverseName = personName.split(' ').reverse().join(' ')
              for (const searchQ of [reverseName, personName]) {
                if (fallbackDone) break
                console.log(`[PERSON-LOOKUP] OpenAPI.it search for "${searchQ}" (€0.01)...`)
                try {
                  const oaRes = await fetch(`https://company.openapi.com/IT-search?companyName=${encodeURIComponent(searchQ)}`, {
                    headers: { Authorization: `Bearer ${openApiToken}`, Accept: 'application/json' },
                    signal: AbortSignal.timeout(10000),
                  })
                  console.log(`[PERSON-LOOKUP] OpenAPI.it response: HTTP ${oaRes.status}`)
                  if (oaRes.ok && oaRes.status !== 204) {
                    const oaJson = await oaRes.json()
                    const items = oaJson?.data || []
                    if (items.length > 0) console.log(`[PERSON-LOOKUP] OpenAPI.it returned ${items.length} results — first: "${items[0]?.companyName || items[0]?.denominazione}" keys=[${Object.keys(items[0] || {}).join(',')}]`)
                    else console.log(`[PERSON-LOOKUP] OpenAPI.it returned 0 results for "${searchQ}"`)
                    for (const item of items) {
                      const rs = String(item.companyName || item.denominazione || '').toLowerCase()
                      const rsClean = rs.replace(/[^a-zà-ú0-9\s]/gi, '').replace(/\s+/g, ' ').trim() // "g.e.m di gorgone marco" → "gem di gorgone marco"
                      if (pWords.every((w: string) => rsClean.includes(w))) {
                        // Check company hint for extra confirmation (also normalized)
                        if (queryCompanyHint) {
                          const hintWords = queryCompanyHint.toLowerCase().replace(/[^a-zà-ú\s]/gi, '').split(/\s+/).filter((w: string) => w.length >= 2 && !/^(srl|srls|spa|sas|snc)$/i.test(w))
                          const hintMatch = hintWords.length === 0 || hintWords.some((w: string) => rsClean.includes(w))
                          if (!hintMatch) { console.log(`[PERSON-LOOKUP] OpenAPI.it: "${item.denominazione}" no match hint "${queryCompanyHint}", skip`); continue }
                        }
                        const denom = String(item.companyName || item.denominazione || '')
                        const piva = String(item.taxCode || item.cf_piva || '').replace(/\D/g, '')
                        console.log(`[PERSON-LOOKUP] ✅ OpenAPI.it found: "${denom}" P.IVA=${piva}`)
                        result.azienda = denom
                        if (piva.length === 11) result.partita_iva = piva
                        result.dati_azienda = {
                          ragione_sociale: denom,
                          partita_iva: piva,
                          sede_legale: (item.registeredOffice as any)?.street ? `${(item.registeredOffice as any).street}, ${(item.registeredOffice as any).city || ''}`.trim() : (item.indirizzo || item.sede || ''),
                          found: true,
                        }
                        const sedeStr = (item.registeredOffice as any)?.street ? `${(item.registeredOffice as any).street}, ${(item.registeredOffice as any).city || ''}`.trim() : (item.indirizzo || item.sede || '')
                        if (sedeStr) result.indirizzo = sedeStr
                        const pecVal = item.certifiedEmail || item.pec || ''
                        if (pecVal) { result.dati_azienda.pec = pecVal; result.pec = pecVal as string }
                        result.fonti.push('OpenAPI.it (camera di commercio)')
                        // Scrape CompanyReports (FREE) with correct P.IVA for financial data
                        if (piva.length === 11) {
                          try {
                            const crRes2 = await fetch(`https://www.companyreports.it/${piva}`, {
                              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' },
                              signal: AbortSignal.timeout(10000), redirect: 'follow',
                            })
                            if (crRes2.ok) {
                              const crHtml = await crRes2.text()
                              if (crHtml.length > 5000 && !crHtml.includes('<title>CompanyReports - Il fatturato')) {
                                const titleM2 = crHtml.match(/<title>([^<]+?)<\/title>/i)
                                if (titleM2) {
                                  const rsTitle = titleM2[1].trim().replace(/\s*[-–|]\s*(fatturato|bilancio|indirizzo|CompanyReports|company).*$/i, '').trim()
                                  if (rsTitle.length >= 3 && !/companyreports/i.test(rsTitle)) {
                                    result.azienda = rsTitle
                                    result.dati_azienda.ragione_sociale = rsTitle
                                  }
                                }
                                const metaCr = crHtml.match(/meta name="description" content="([^"]+)"/i)
                                if (metaCr) {
                                  const fatM = metaCr[1].match(/Fatturato\s+([\d.,]+)/i)
                                  if (fatM) result.dati_azienda.fatturato = fatM[1].replace(/,+$/, '').trim()
                                }
                                const jsonLd = crHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
                                for (const block of jsonLd) {
                                  try {
                                    const d2 = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
                                    for (const faq of (d2.mainEntity || [])) {
                                      const q2 = (faq.name || '').toLowerCase()
                                      const a2: string = faq.acceptedAnswer?.text || ''
                                      if (q2.includes('fatturato') && !result.dati_azienda.fatturato) {
                                        const m = a2.match(/pari a\s+€?\s*([\d.,]+)/i) || a2.match(/€\s*([\d.,]+)/)
                                        if (m) result.dati_azienda.fatturato = m[1].replace(/,+$/, '').trim()
                                        const y = a2.match(/\((\d{4})\)/); if (y) result.dati_azienda.fatturato_anno = y[1]
                                      }
                                      if (q2.includes('dipendenti')) {
                                        const m = a2.match(/da\s*(\d+)\s*a\s*(\d+)/i)
                                        if (m) result.dati_azienda.dipendenti = `${m[1]}-${m[2]}`
                                        else { const m2 = a2.match(/(\d+)\s*dipendenti/i) || a2.match(/pari a\s*(\d+)/i); if (m2) result.dati_azienda.dipendenti = m2[1] }
                                      }
                                      if (q2.includes('sede legale') && !result.dati_azienda.sede_legale) {
                                        const m = a2.match(/è\s+(.+?)(?:\.\s*$|$)/i)
                                        if (m) { result.dati_azienda.sede_legale = m[1].trim(); result.indirizzo = m[1].trim() }
                                      }
                                    }
                                  } catch { /* */ }
                                }
                                const formaM = crHtml.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
                                if (formaM) result.dati_azienda.forma_giuridica = formaM[1].trim()
                                const dipM = crHtml.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
                                if (dipM && !result.dati_azienda.dipendenti) result.dati_azienda.dipendenti = dipM[1].trim()
                                const pecM = crHtml.match(/(?:Indirizzo\s*)?PEC<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+@[^<]+)/i)
                                if (pecM && !result.pec) { result.pec = pecM[1].trim().toLowerCase(); result.dati_azienda.pec = result.pec }
                                console.log(`[PERSON-LOOKUP] CompanyReports enrichment for ${piva}: fatturato=${result.dati_azienda.fatturato} dip=${result.dati_azienda.dipendenti}`)
                              }
                            }
                          } catch { /* CompanyReports failed */ }
                        }
                        result.dati_azienda.titolare = personName
                        fallbackDone = true
                        break
                      }
                    }
                  } else {
                    const errBody = await oaRes.text().catch(() => '')
                    console.log(`[PERSON-LOOKUP] OpenAPI.it search FAILED HTTP ${oaRes.status}: ${errBody.slice(0, 300)}`)
                  }
                } catch (oaErr: any) { console.log(`[PERSON-LOOKUP] OpenAPI.it search exception: ${oaErr?.message || oaErr}`) }
              }
            }

            // ── STEP 2: lead-registry fallback (FREE) — only if OpenAPI.it unavailable/failed ──
            // Limited to max 2 queries to avoid slow 4x60s timeouts
            if (!fallbackDone) {
              const reverseName = personName.split(' ').reverse().join(' ')
              const altQueries: string[] = []
              if (queryCompanyHint) {
                const hintShort = queryCompanyHint.replace(/\b(srl|srls|spa|sas|snc|s\.r\.l|s\.p\.a|s\.a\.s)\b/gi, '').trim()
                altQueries.push(`${hintShort} ${reverseName}`)
              }
              altQueries.push(reverseName)
              // Max 2 queries to keep runtime reasonable
              for (const altName of altQueries) {
                if (fallbackDone) break
                console.log(`[PERSON-LOOKUP] Fallback lead-registry: "${altName}"...`)
                try {
                  const altRes = await fetch(`${origin}/api/lead-registry`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lead: { nome: altName, azienda: altName, citta: city || result.citta || '', sito: '', indirizzo: '', categoria: '' }, _skipPersonEnrichment: true }),
                    signal: AbortSignal.timeout(60000),
                  })
                  if (altRes.ok) {
                    const altData = await altRes.json()
                    if (altData?.found) {
                      const altRs = String(altData.ragione_sociale || '').toLowerCase()
                      const altTit = String(altData.titolare || '').toLowerCase()
                      if (pWords.every((w: string) => altRs.includes(w)) || pWords.every((w: string) => altTit.includes(w))) {
                        console.log(`[PERSON-LOOKUP] Fallback SUCCESS: "${altData.ragione_sociale}" P.IVA=${altData.partita_iva}`)
                        result.dati_azienda = altData
                        result.azienda = altData.ragione_sociale || altName
                        if (altData.partita_iva && !result.partita_iva) result.partita_iva = altData.partita_iva
                        if (altData.pec && !result.pec) result.pec = altData.pec
                        if (altData.sede_legale && !result.indirizzo) result.indirizzo = altData.sede_legale
                        if (altData.sito) result.sito_web = altData.sito
                        if (altData.email_privacy && !result.email) result.email = altData.email_privacy
                        result.fonti.push('lead-registry (fallback)')
                        fallbackDone = true
                      }
                    }
                  }
                } catch { /* */ }
              }
            }

            // If nothing worked, store minimal placeholder (no wrong data)
            if (!result.dati_azienda) {
              result.dati_azienda = { ragione_sociale: companyName, nome: companyName, _nota: 'Dati aziendali non verificati — persona non trovata come titolare/socio' }
              if (result.partita_iva) result.dati_azienda.partita_iva = result.partita_iva
            }
          }
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

  // ── POST-PROCESSING: Apply authoritative CompanyReports data (survives lead-registry overwrite) ──
  if (result._cr_ragione_sociale) {
    const authRS = String(result._cr_ragione_sociale)
    console.log(`[PERSON-LOOKUP] Applying AUTHORITATIVE ragione_sociale: "${authRS}"`)
    result.azienda = authRS
    if (result.dati_azienda) result.dati_azienda.ragione_sociale = authRS
    delete result._cr_ragione_sociale
  }
  if (result._cr_sede_legale) {
    const authSede = String(result._cr_sede_legale)
    // Validate sede against queryCityHint before accepting it
    const sedeMatchesCity = !queryCityHint || authSede.toLowerCase().includes(queryCityHint.toLowerCase())
    if (sedeMatchesCity) {
      if (result.dati_azienda) result.dati_azienda.sede_legale = authSede
      // Extract city from sede (e.g. "VIALE GIOVANNI DA CERMENATE 76 - MILANO (MI)" → "Milano")
      const cityFromSede = authSede.match(/[-–]\s*([A-ZÀ-Ú][A-Za-zÀ-ú\s]+?)\s*(?:\([A-Z]{2}\))?\s*$/)
      if (cityFromSede) result.citta = cityFromSede[1].trim()
    } else {
      console.log(`[PERSON-LOOKUP] REJECTING _cr_sede_legale "${authSede}" — does not match city "${queryCityHint}"`)
    }
    delete result._cr_sede_legale
  }

  // ── POST-PIPELINE GEOGRAPHIC VALIDATION ──
  // If user specified a city in the query, validate that the final result city is compatible
  // This catches late-stage omonimo contamination from CompanyReports/lead-registry/fatturatoitalia
  if (queryCityHint && result.citta) {
    const qCityFinal = queryCityHint.toLowerCase().replace(/[^a-zà-ú]/gi, '').trim()
    const rCityFinal = String(result.citta).toLowerCase().replace(/[^a-zà-ú]/gi, '').trim()
    const finalCityOk = rCityFinal.includes(qCityFinal) || qCityFinal.includes(rCityFinal)
      || (qCityFinal.length <= 2 && rCityFinal.startsWith(qCityFinal))
    if (!finalCityOk && qCityFinal.length >= 3 && rCityFinal.length >= 3) {
      console.log(`[PERSON-LOOKUP] POST-PIPELINE GEO CHECK: city "${result.citta}" ≠ query "${queryCityHint}" — resetting city to query value`)
      result._citta_alternativa = result.citta
      result.citta = queryCityHint
      // Also check dati_azienda sede — if it's from a different city, flag it
      if (result.dati_azienda?.sede_legale) {
        const sedeLow = String(result.dati_azienda.sede_legale).toLowerCase()
        if (!sedeLow.includes(qCityFinal) && sedeLow.length > 10) {
          console.log(`[PERSON-LOOKUP] POST-PIPELINE GEO CHECK: REMOVING sede "${result.dati_azienda.sede_legale}" — does not match city "${queryCityHint}"`)
          result._sede_scartata = result.dati_azienda.sede_legale
          delete result.dati_azienda.sede_legale
          if (result.indirizzo && !String(result.indirizzo).toLowerCase().includes(qCityFinal)) {
            delete result.indirizzo
          }
        }
      }
    }
  }

  // ── RETEIMPRESE PHONE SEARCH: get phone from Italian directories immediately ──
  // This avoids the 2-minute delay caused by waiting for the async company-lookup callback.
  {
    const reteCompanyName = result.azienda || company
    const reteCity = result.citta || city || queryCityHint || ''
    if (!result.telefono && reteCompanyName && reteCompanyName.length >= 3) {
      console.log(`[PERSON-LOOKUP] Reteimprese search: "${reteCompanyName}" ${reteCity}`)
      try {
        const qRete = `"${reteCompanyName}" ${reteCity} site:reteimprese.it OR site:paginegialle.it OR site:paginebianche.it`
        const textRete = await tavilySearch(qRete)
        if (textRete.length > 50) {
          const phonePattern = /\+?\s*39\s*[03]\d[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{0,4}/g
          const phones: string[] = []
          let phM
          while ((phM = phonePattern.exec(textRete)) !== null) phones.push(phM[0].trim())
          const compTokens = reteCompanyName.toLowerCase()
            .replace(/[^a-zà-ù0-9\s]/gi, ' ').split(/\s+/)
            .filter((t: string) => t.length >= 4 && !/^(srl|srls|spa|sas|snc|italia|italy|milano|roma|napoli|torino|bologna|firenze)$/.test(t))
          if (compTokens.length === 0) compTokens.push(reteCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8))
          const textReteLow = textRete.toLowerCase()
          for (const ph of phones) {
            const phIdx = textRete.indexOf(ph)
            if (phIdx === -1) continue
            const window = textReteLow.slice(Math.max(0, phIdx - 300), phIdx + 50)
            if (compTokens.some((t: string) => window.includes(t))) {
              const digits = ph.replace(/\D/g, '')
              const core = digits.startsWith('39') ? digits.slice(2) : digits
              if (/^0\d{8,10}$/.test(core)) {
                result.telefono = ph
                result.telefono_fonte = 'Reteimprese.it'
                if (!result.fonti.includes('Reteimprese.it')) result.fonti.push('Reteimprese.it')
                console.log(`[PERSON-LOOKUP] Reteimprese: telefono fisso found: ${ph}`)
                break
              } else if (/^3\d{8,9}$/.test(core) && !result.cellulare) {
                result.cellulare = ph
                ;(result as any).cellulare_fonte = 'Reteimprese.it'
                console.log(`[PERSON-LOOKUP] Reteimprese: cellulare found: ${ph}`)
              }
            }
          }
        }
      } catch (e: any) {
        console.log(`[PERSON-LOOKUP] Reteimprese search failed: ${e?.message || e}`)
      }
    }
  }

  // ── WEBSITE P.IVA VALIDATION: discard website if P.IVA on page doesn't match ours ──
  if (result.sito_web && result.partita_iva) {
    const ourPiva = String(result.partita_iva).replace(/\D/g, '')
    console.log(`[PERSON-LOOKUP] Website validation: checking "${result.sito_web}" against P.IVA ${ourPiva}`)
    // Quick domain-name check: if domain contains rejected company words but NOT ours, discard
    const domainLow = String(result.sito_web).toLowerCase().replace(/https?:\/\//, '').replace(/www\./, '').split('/')[0]
    const ourCompanyClean = String(result.azienda || '').toLowerCase().replace(/[^a-zà-ú0-9]/gi, '')
    const domainClean = domainLow.replace(/\.(it|com|eu|net|org)$/i, '').replace(/[^a-zà-ú0-9]/gi, '')
    if (ourCompanyClean && domainClean && !domainClean.includes(ourCompanyClean.slice(0, 5)) && ourCompanyClean.length > 5) {
      console.log(`[PERSON-LOOKUP] ⚠️ Website domain "${domainLow}" does NOT match company "${result.azienda}" — checking P.IVA on page...`)
    }
    try {
      const siteUrl = String(result.sito_web).startsWith('http') ? String(result.sito_web) : `https://${result.sito_web}`
      const valRes = await fetch(siteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(5000), redirect: 'follow',
      })
      if (valRes.ok) {
        const valHtml = await valRes.text()
        // Try multiple P.IVA patterns (targeted, not generic 11-digit)
        const sitePivaM = valHtml.match(/(?:P\.?\s*IVA|partita\s*iva|VAT|C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I(?:VA)?)[:\s/|–\-]*(?:IT\s*)?(\d{11})/i)
          || valHtml.match(/(?:IT)(\d{11})/i)
        const foundPiva = sitePivaM?.[1]
        if (foundPiva && foundPiva !== ourPiva) {
          console.log(`[PERSON-LOOKUP] ⚠️ WEBSITE P.IVA MISMATCH: site has ${foundPiva} but ours is ${ourPiva} — DISCARDING "${result.sito_web}"`)
          result.sito_web_scartato = result.sito_web
          result.sito_web_scartato_motivo = `P.IVA sul sito (${foundPiva}) diversa dalla nostra (${ourPiva})`
          delete result.sito_web
        } else {
          console.log(`[PERSON-LOOKUP] Website validation: ${foundPiva ? 'P.IVA matches ✅' : 'no P.IVA found on page'} — keeping "${result.sito_web}"`)
        }
      } else {
        console.log(`[PERSON-LOOKUP] Website validation: fetch returned HTTP ${valRes.status}`)
      }
    } catch (e: any) { console.log(`[PERSON-LOOKUP] Website validation fetch failed: ${e?.message || e}`) }
  }

  // ── Search 2: Info professionale + famiglia + trigger ──
  const text2 = await tavilySearch(`"${personName}" ${company} ${result.ruolo || ''} esperienza professionale famiglia`)
  if (text2.length > 50) {
    const ext2 = await gptExtract(text2, `Estrai il profilo completo di "${personName}" come ${result.ruolo || 'professionista'}${company ? ` presso ${company}` : ''}.
ATTENZIONE CRITICA: "${personName}" è un nome che potrebbe avere OMONIMI. Includi SOLO informazioni che riguardano la persona che lavora/ha lavorato presso "${company || 'azienda non specificata'}". Se trovi esperienze lavorative presso aziende completamente diverse e non collegate, probabilmente riguardano un OMONIMO — in quel caso scrivi null per quel campo.
RISPONDI SEMPRE IN ITALIANO. Se trovi testi in spagnolo, inglese o altre lingue, traducili in italiano. JSON:
{"esperienze_precedenti":"aziende/ruoli precedenti se noti","formazione":"titoli di studio","competenze":"competenze professionali principali","anni_esperienza":"anni di esperienza stimati","colleghi_noti":"nomi di colleghi/soci/collaboratori noti nella stessa azienda","legami_familiari":"SOLO legami di SANGUE o matrimonio: coniuge/compagno/a, figli, genitori, fratelli, sorelle, zii, cugini — con NOME se disponibile. NON inserire colleghi, collaboratori, ruoli lavorativi o informazioni professionali qui.","stato_civile":"singolo/sposato/convivente se menzionato pubblicamente","figli":"numero o menzione di figli se pubblico","note":"altre info rilevanti"}`)
    for (const [k, v] of Object.entries(ext2)) {
      if (!isJunk(v) && !result[k]) result[k] = v
    }
    // Post-validate formazione: reject if in foreign language (Spanish/English/Portuguese)
    if (result.formazione && typeof result.formazione === 'string') {
      const formLow = result.formazione.toLowerCase()
      const foreignIndicators = /\b(ingenier[íi]a|universidad|communication|university|bachelor|master of|degree|science|engineering|tecnolog[íi]as|informaci[óo]n|comunicaciones|administraci[óo]n|licenciatura|educaci[óo]n|escola|faculdade)\b/i
      if (foreignIndicators.test(formLow)) {
        console.log(`[PERSON-LOOKUP] Discarding foreign-language formazione: "${result.formazione}"`)
        delete result.formazione
      }
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
    const currentCompany = result.azienda || company // use STEP 0 corrected name if available
    const currentCity = result.citta || city
    const socialCompanyCtx = result._omonimo_detected ? ` "${currentCompany}"` : (company ? ` ${company}` : '')
    const text2b = await tavilySearch(`"${personName}"${socialCompanyCtx} ${currentCity} instagram facebook tiktok linkedin pinterest profilo social`)
    if (text2b.length > 50) {
      const ext2b = await gptExtract(text2b, `Trova TUTTI i profili social media della persona "${personName}"${currentCompany ? ` (${currentCompany})` : ''}. ATTENZIONE: esistono OMONIMI con lo stesso nome. Restituisci SOLO i profili che appartengono alla persona che lavora presso "${currentCompany || 'azienda non specificata'}"${currentCity ? ` a ${currentCity}` : ''}. Se non sei sicuro che un profilo appartenga a QUESTA persona, restituisci null. JSON:
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
      const text2bIg = await tavilySearch(`"${personName}" ${currentCompany} site:instagram.com`)
      if (text2bIg.length > 30) {
        const igMatches = [...text2bIg.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi)]
        const igHit = igMatches.find(m => !/^(p|reel|tv|stories|explore|accounts|about|developer|legal)$/i.test(m[1]))
        if (igHit) { result.instagram = igHit[0].replace(/\/$/, ''); console.log(`[PERSON-LOOKUP] Search 2b: Instagram dedicated search: ${result.instagram}`) }
      }
    }
    // Dedicated Facebook search if still missing
    if (!result.facebook) {
      const text2bFb = await tavilySearch(`"${personName}" ${currentCompany} site:facebook.com`)
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
      const compSlug = (currentCompany || company || '').toLowerCase().replace(/[^a-z0-9]/g, '')
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
      const textSite = await tavilySearch(`"${personName}" ${currentCompany} sito web portfolio contatti`)
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
  // Build a RICH context from all collected company data for specific insurance analysis
  const role = result.ruolo || ''
  const tipoLavoro = result.tipo_lavoro || ''
  const seniority = result.seniority || ''
  const da = result.dati_azienda || {}
  const atecoCode = da.codice_ateco || da.ateco || ''
  const atecoDesc = da.descrizione_ateco || ''
  const fatturato = da.fatturato || ''
  const dipendenti = da.dipendenti || ''
  const hasVerifiedFatturato = !!fatturato && !/^(0|n\/?d|n\/?a|null|undefined|non disponibile|non specificato)$/i.test(String(fatturato).trim())
  const hasVerifiedDipendenti = !!dipendenti && !/^(0|n\/?d|n\/?a|null|undefined|non disponibile|non specificato)$/i.test(String(dipendenti).trim())
  const verifiedDipNum = hasVerifiedDipendenti ? parseInt(String(dipendenti).replace(/[^\d]/g, ''), 10) : null
  const formaGiuridica = da.forma_giuridica || ''
  const sedeLegale = da.sede_legale || result.indirizzo || ''
  const settoreAz = da.settore || result.settore || ''
  const companyContext = [
    company ? `Azienda: "${company}"` : '',
    atecoCode ? `ATECO: ${atecoCode}` : '',
    atecoDesc ? `Attività: ${atecoDesc}` : '',
    fatturato ? `Fatturato: €${fatturato}` : '',
    dipendenti ? `Dipendenti: ${dipendenti}` : '',
    formaGiuridica ? `Forma giuridica: ${formaGiuridica}` : '',
    sedeLegale ? `Sede: ${sedeLegale}` : '',
    settoreAz ? `Settore: ${settoreAz}` : '',
  ].filter(Boolean).join(', ')

  const text3 = await tavilySearch(`"${personName}" ${company} ${role} assicurazione rischi professionali polizza ${atecoDesc || settoreAz || ''}`)
  if (text3.length > 50) {
    const ext3 = await gptExtract(text3, `Sei un consulente assicurativo esperto italiano. Analizza il profilo di "${personName}" e genera raccomandazioni SPECIFICHE e CONCRETE basate sui DATI REALI dell'azienda.

DATI REALI DELL'AZIENDA:
${companyContext || 'Dati aziendali non disponibili'}
Ruolo persona: ${role || 'titolare/amministratore'}
Tipo lavoro: ${tipoLavoro || 'non specificato'}
Seniority: ${seniority || 'non specificata'}

REGOLE FONDAMENTALI:
- Le polizze consigliate devono essere SPECIFICHE per il codice ATECO e il settore REALE dell'azienda
- I rischi professionali devono derivare dall'attività REALE (es. per ATECO 63.22 = trasporti → rischi logistici, responsabilità vettoriale; per ATECO 62.01 = software → rischi cyber, PI, danni a terzi)
- Le note per il broker devono contenere FATTI CONCRETI e ACTIONABLE basati SOLO sui dati reali disponibili.
- VIETATO inventare o stimare fatturato/dipendenti. Se fatturato non è nei DATI REALI, scrivi "fatturato non verificato" e NON inserire importi. Se dipendenti non è nei DATI REALI, scrivi "dipendenti non verificati" e NON inserire numeri.
- Se nei DATI REALI c'è "Dipendenti: 1", NON scrivere "3-5 dipendenti", "organico di 3", "piccolo team", ecc.
- NON scrivere frasi generiche tipo "è importante considerare la dimensione dell'azienda". Scrivi cose SPECIFICHE.
- La stima_capacita_risparmio deve basarsi su fatturato reale e ruolo, NON essere generica
- Usa priorita "obbligatoria" SOLO per coperture obbligatorie per legge verificabili (es. INAIL se ci sono dipendenti, RC professionale solo per professioni regolamentate). Per RCT/O, infortuni privati, cyber, tutela legale usa "critica" o "raccomandata".

JSON:
{"rischi_professionali":["rischio specifico 1 basato su ATECO/settore reale","rischio specifico 2"],"polizze_consigliate":[{"polizza":"nome polizza SPECIFICA","priorita":"obbligatoria/critica/raccomandata","motivo":"motivazione CONCRETA con riferimento ai dati reali dell'azienda"}],"note_broker":"analisi DETTAGLIATA e CONCRETA per il broker: include riferimenti a fatturato, dipendenti, settore, rischi specifici, opportunità di cross-selling, punti di attenzione. Minimo 3-4 frasi specifiche.","stima_capacita_risparmio":"bassa / media / medio-alta / alta / molto alta (GIUSTIFICA con dati reali: es. 'media — fatturato €500k, settore IT, 5 dipendenti')","ambiti_protection":["vita","salute","infortuni","RC professionale","casa","auto","previdenza","investimenti"],"priorita_commerciale":"freddo / tiepido / caldo / molto caldo (GIUSTIFICA: es. 'caldo — SRL con 10 dipendenti senza copertura infortuni')"}`)
    for (const [k, v] of Object.entries(ext3)) {
      if (v && v !== 'null' && !result[k]) {
        result[k] = v
      }
    }
    const unverifiedFinancialRx = /fatturato|ricav|volume\s+d['’]?affari|€|\b\d+\s*(k|mila|mln|milion)/i
    const employeeNumberRx = /\b([2-9]|[1-9]\d+)\s*(dipendent|addett|collaborator|persone|unità|risorse)|\b3\s*-\s*5\b/i
    if (typeof result.note_broker === 'string') {
      const note = result.note_broker
      const inventedFatturato = !hasVerifiedFatturato && unverifiedFinancialRx.test(note)
      const inventedDipendenti = (!hasVerifiedDipendenti && /dipendent|addett|organico|personale|collaborator/i.test(note))
        || (verifiedDipNum === 1 && employeeNumberRx.test(note))
      if (inventedFatturato || inventedDipendenti || /è importante considerare|personalizzare le polizze/i.test(note)) {
        const facts = [
          `azienda ${result.azienda || company || 'non specificata'}`,
          atecoDesc ? `attività: ${atecoDesc}` : settoreAz ? `settore: ${settoreAz}` : '',
          hasVerifiedFatturato ? `fatturato verificato: ${fatturato}` : 'fatturato non verificato',
          hasVerifiedDipendenti ? `dipendenti verificati: ${dipendenti}` : 'dipendenti non verificati',
          sedeLegale ? `sede: ${sedeLegale}` : '',
        ].filter(Boolean).join('; ')
        result.note_broker = `Analisi prudente basata solo su dati verificati: ${facts}. Per il broker: verificare in call le coperture RCT/O, infortuni/INAIL se presenti dipendenti, tutela legale e coperture tecniche coerenti con l'attività. Non usare stime di fatturato o organico finché non sono confermate da visura/bilancio.`
        console.log(`[PERSON-LOOKUP] Rewrote broker note to remove invented financial/employee data`)
      }
    }
    if (Array.isArray(result.polizze_consigliate)) {
      result.polizze_consigliate = result.polizze_consigliate.map((p: any) => {
        if (!p || typeof p !== 'object') return p
        const pol = String(p.polizza || '').toLowerCase()
        const motivo = String(p.motivo || '')
        if (p.priorita === 'obbligatoria' && !/inail|rc auto|rca|responsabilità civile professionale obbligatoria|rc professionale obbligatoria/i.test(pol)) {
          p.priorita = 'critica'
        }
        if (/responsabilità civile professionale|rc professionale/i.test(pol) && !/avvocat|commercialist|medic|ingegner|architett|geometr|intermediar|consulent/i.test(`${role} ${settoreAz} ${atecoDesc}`.toLowerCase())) {
          p.polizza = 'Responsabilità Civile Terzi/Prestatori (RCT/O)'
          p.priorita = p.priorita === 'obbligatoria' ? 'critica' : p.priorita
        }
        if (!hasVerifiedFatturato && unverifiedFinancialRx.test(motivo)) {
          p.motivo = 'Raccomandazione basata su attività/settore verificato; fatturato non verificato, da confermare prima di dimensionare massimali e premio.'
        }
        if ((verifiedDipNum === 1 && employeeNumberRx.test(motivo)) || (!hasVerifiedDipendenti && /dipendent|addett|organico/i.test(motivo))) {
          p.motivo = hasVerifiedDipendenti
            ? `Raccomandazione coerente con attività e presenza dipendenti verificata (${dipendenti}); verificare mansioni e coperture INAIL/infortuni.`
            : 'Raccomandazione da verificare: numero dipendenti non disponibile, necessario confermare organico prima della proposta.'
        }
        return p
      }).filter((p: any) => p && typeof p === 'object' && p.polizza && p.motivo)
    }
    if (Array.isArray(result.rischi_professionali)) {
      result.rischi_professionali = result.rischi_professionali
        .map((r: any) => String(r || '').trim())
        .filter((r: string) => r.length >= 8 && !/errore professionale|danno economico al cliente|rischio\s*\d/i.test(r))
    }
    console.log(`[PERSON-LOOKUP] Search 3 done — rischi: ${Array.isArray(ext3.rischi_professionali) ? ext3.rischi_professionali.length : 0}, polizze: ${Array.isArray(ext3.polizze_consigliate) ? ext3.polizze_consigliate.length : 0}`)
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
    const q5 = `"${personName}" ${city} amministratore socio titolare cariche societarie visura camerale aziende registroimprese.it OR ufficiocamerale.it`
    const text5 = await tavilySearch(q5)
    if (text5.length > 50) {
      const ext5 = await gptExtract(text5, `Cerca TUTTE le cariche societarie e aziende collegate a "${personName}"${city ? ` di ${city}` : ''}.
IMPORTANTE: 
- Restituisci SOLO aziende che trovi LETTERALMENTE nel testo con nome ESATTO.
- NON inventare aziende o cariche. Se non trovi nulla, restituisci un array vuoto.
- La persona deve risultare come titolare, amministratore, socio o avere una carica ESPLICITA.
- Se trovi solo il nome della persona senza aziende specifiche, restituisci array vuoto.
JSON:
{"cariche_societarie":[{"azienda":"ragione sociale ESATTA trovata nel testo","ruolo":"ruolo/carica ESATTA (es. Amministratore Unico, Socio, Titolare)","stato":"attiva/cessata","partita_iva":"P.IVA se disponibile nel testo"}],"numero_aziende_attive":"quante aziende attive ha (SOLO se esplicitamente indicato)","partecipazioni":"partecipazioni societarie ESPLICITAMENTE citate","storico_imprenditoriale":"cronologia SOLO se esplicitamente presente nel testo"}`)
      // Post-validate cariche societarie: filter out hallucinated companies
      if (Array.isArray(ext5.cariche_societarie)) {
        const nameWords5 = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
        ext5.cariche_societarie = ext5.cariche_societarie.filter((c: any) => {
          if (!c?.azienda || typeof c.azienda !== 'string') return false
          const azLow = c.azienda.toLowerCase()
          // Reject if azienda name is too short or generic
          if (azLow.length < 3) return false
          // Reject obvious GPT hallucinations: generic words, placeholder patterns
          if (/^(azienda|società|impresa|ditta|studio|attività)\s*(n\.\s*\d+|generica|non\s*specif)/i.test(c.azienda)) return false
          // Reject if the "azienda" is actually the person's own name (not useful info)
          if (nameWords5.every((w: string) => azLow.includes(w)) && azLow.split(/\s+/).length <= 3) return false
          // Reject if ruolo is junk
          if (c.ruolo && isJunk(c.ruolo)) c.ruolo = null
          // Must actually exist in the Tavily search text
          const azTokens = azLow.replace(/[^a-zà-ù0-9\s]/gi, '').split(/\s+/).filter((t: string) => t.length >= 4)
          const text5Low = text5.toLowerCase()
          const foundInText = azTokens.length > 0 && azTokens.some((t: string) => text5Low.includes(t))
          if (!foundInText) {
            console.log(`[PERSON-LOOKUP] REJECTED hallucinated carica: "${c.azienda}" — not found in search results`)
            return false
          }
          return true
        })
        // If we have the known company, ensure it's in the list
        if (company && ext5.cariche_societarie.length >= 0) {
          const knownCompLow = company.toLowerCase()
          const alreadyHasKnown = ext5.cariche_societarie.some((c: any) => {
            const cLow = String(c.azienda || '').toLowerCase()
            return cLow.includes(knownCompLow) || knownCompLow.includes(cLow)
          })
          if (!alreadyHasKnown) {
            ext5.cariche_societarie.unshift({
              azienda: company,
              ruolo: role || 'Titolare/Amministratore',
              stato: 'attiva',
              partita_iva: result.partita_iva || null,
            })
          }
        }
      }
      for (const [k, v] of Object.entries(ext5)) {
        if (!isJunk(v) && !result[k]) result[k] = v
      }
      console.log(`[PERSON-LOOKUP] Search 5 cariche done — ${Array.isArray(ext5.cariche_societarie) ? ext5.cariche_societarie.length : 0} cariche validate`)
    } else if (company) {
      // No Tavily results — at least show the known company
      result.cariche_societarie = [{
        azienda: company,
        ruolo: role || 'Titolare/Amministratore',
        stato: 'attiva',
        partita_iva: result.partita_iva || null,
      }]
      result.numero_aziende_attive = '1'
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
          // Company confirmed in LinkedIn verification results — but verify it's the SAME person
          if (liUrlMatch) {
            const verifiedUrl = `https://www.${liUrlMatch[0]}`
            const verifiedSlug = liUrlMatch[0].replace(/.*\/in\//, '').toLowerCase().replace(/[^a-z]/g, '')
            const personSlugParts = personName.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
            const slugMatchesPerson = personSlugParts.every((w: string) => verifiedSlug.includes(w))
            if (verifiedUrl !== result.linkedin && slugMatchesPerson) {
              console.log(`[PERSON-LOOKUP] LinkedIn verification found BETTER URL: "${verifiedUrl}" (was "${result.linkedin}")`)
              result.linkedin = verifiedUrl
            } else if (verifiedUrl !== result.linkedin) {
              console.log(`[PERSON-LOOKUP] LinkedIn verification: URL "${verifiedUrl}" does NOT match person name "${personName}" — NOT replacing (likely different person)`)
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
  // Phone: cleanup garbage characters + format normalization + validation
  for (const phoneKey of ['telefono', 'cellulare']) {
    if (result[phoneKey] && typeof result[phoneKey] === 'string') {
      // Remove fontawesome icons (î°, ï‚, etc), emoji, non-printable chars
      let cleaned = String(result[phoneKey])
        .replace(/[^\x20-\x7E+]/g, '')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\s{2,}/g, ' ')
      // Normalize: "39 340..." → "+39 340...", "0039 340..." → "+39 340..."
      cleaned = cleaned.replace(/^0039\s*/, '+39 ').replace(/^39\s+(\d)/, '+39 $1')
      const digits = cleaned.replace(/\D/g, '')
      if (digits.length < 9 || digits.length > 13 || cleaned.length === 0) {
        console.log(`[PERSON-LOOKUP] REMOVED invalid phone "${phoneKey}": "${result[phoneKey]}"`)
        delete result[phoneKey]
      } else if (cleaned !== result[phoneKey]) {
        console.log(`[PERSON-LOOKUP] Phone "${phoneKey}" cleaned: "${result[phoneKey]}" → "${cleaned}"`)
        result[phoneKey] = cleaned
      }
    }
  }

  // Se non ha trovato nulla di utile
  if (!result.nome_completo && !result.azienda && !result.ruolo) {
    return NextResponse.json({ error: `Nessuna informazione trovata per "${query}". Prova con nome e cognome completi.` })
  }

  delete result._skipSecondLeadRegistry
  delete result._tavily_last_url
  delete result._citta_query
  delete result._citta_scartata
  delete result._citta_alternativa
  delete result._omonimo_detected
  delete result._camerale_data
  delete result._camerale_ragione_sociale

  // ── Social URL validation: must contain actual domain, not placeholder text ──
  const socialValidation: Record<string, string> = {
    linkedin: 'linkedin.com',
    facebook: 'facebook.com',
    instagram: 'instagram.com',
    twitter: 'twitter.com',
    twitter_x: 'twitter.com',
    tiktok: 'tiktok.com',
    youtube: 'youtube.com',
    pinterest: 'pinterest.com',
  }
  for (const [field, domain] of Object.entries(socialValidation)) {
    if (result[field] && typeof result[field] === 'string' && !result[field].toLowerCase().includes(domain) && !(field === 'twitter_x' && result[field].toLowerCase().includes('x.com'))) {
      console.log(`[PERSON-LOOKUP] FINAL: removed invalid social "${field}": "${String(result[field]).slice(0, 80)}" (no ${domain})`)
      delete result[field]
    }
  }
  // ── Copy social from dati_azienda to person profile if missing ──
  if (result.dati_azienda) {
    const da = result.dati_azienda
    if (!result.linkedin && da.linkedin && String(da.linkedin).includes('linkedin.com')) {
      result.linkedin = da.linkedin
      console.log(`[PERSON-LOOKUP] FINAL: copied linkedin from dati_azienda: ${result.linkedin}`)
    }
    if (!result.instagram && da.instagram && String(da.instagram).includes('instagram.com')) {
      result.instagram = da.instagram
      console.log(`[PERSON-LOOKUP] FINAL: copied instagram from dati_azienda: ${result.instagram}`)
    }
    if (!result.facebook && da.facebook && String(da.facebook).includes('facebook.com')) {
      result.facebook = da.facebook
      console.log(`[PERSON-LOOKUP] FINAL: copied facebook from dati_azienda: ${result.facebook}`)
    }
  }

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

  // ── Final PEC domain validation — better empty than wrong ──
  const PEC_DOMAIN_RX_PL = /@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust)[a-z0-9.\-]*\.[a-z]{2,}$/i
  if (result.pec && typeof result.pec === 'string' && !PEC_DOMAIN_RX_PL.test(result.pec)) {
    console.log(`[PERSON-LOOKUP] FINAL: PEC "${result.pec}" is not a valid PEC domain — clearing`)
    if (!result.email) result.email = result.pec
    delete result.pec
  }
  if (result.email && typeof result.email === 'string' && PEC_DOMAIN_RX_PL.test(result.email) && !result.pec) {
    console.log(`[PERSON-LOOKUP] FINAL: email "${result.email}" is a PEC domain — moving to PEC`)
    result.pec = result.email
    delete result.email
  }
  // ── Final social junk validation ──
  if (result.facebook && typeof result.facebook === 'string') {
    const fb = String(result.facebook).replace(/\/+$/, '')
    if (/^https?:\/\/(?:www\.|m\.)?facebook\.com\/?$/i.test(fb) ||
        /^https?:\/\/(?:www\.|m\.)?facebook\.com\/(groups|pages|sharer|share|dialog|tr|plugins|events)\/?$/i.test(fb)) {
      console.log(`[PERSON-LOOKUP] FINAL: REMOVED junk Facebook "${result.facebook}"`)
      delete result.facebook
    }
  }
  if (result.instagram && typeof result.instagram === 'string') {
    const ig = String(result.instagram).replace(/\/+$/, '')
    if (/^https?:\/\/(?:www\.)?instagram\.com\/?$/i.test(ig) ||
        /^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv|stories|explore|accounts)\/?$/i.test(ig)) {
      console.log(`[PERSON-LOOKUP] FINAL: REMOVED junk Instagram "${result.instagram}"`)
      delete result.instagram
    }
  }
  if (result.linkedin && typeof result.linkedin === 'string') {
    const li = String(result.linkedin).replace(/\/+$/, '')
    // Junk: solo dominio
    if (/^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/?$/i.test(li)) {
      console.log(`[PERSON-LOOKUP] FINAL: REMOVED junk LinkedIn "${result.linkedin}"`)
      delete result.linkedin
    }
  }
  // Placeholder LinkedIn (es. "linkedin.com/in/valentina-barbareschi-xxxxxx" con
  // sequenze di "xxxx", "yyyy", "0000", "1234567" che sono evidentemente segnaposto).
  for (const k of ['linkedin', 'facebook', 'instagram', 'twitter', 'twitter_x', 'tiktok', 'youtube'] as const) {
    const v = (result as any)[k]
    if (v && typeof v === 'string') {
      // Pattern di placeholder: 4+ x/y/z/0 consecutive, sequenze ascending tipo 12345
      if (/[xyz]{4,}/i.test(v) || /(?:0{4,}|1234567|abcdef|placeholder|esempio|example|sample)/i.test(v)) {
        console.log(`[PERSON-LOOKUP] FINAL: REMOVED placeholder ${k} "${v}"`)
        delete (result as any)[k]
      }
    }
  }

  // ── FINAL: Deriva il sito dall'email business se manca ──
  // Es. "barosio@studiobarosio.it" → sito "https://studiobarosio.it"
  // NON applicare se email è generica (gmail, hotmail, alice.it, libero, ecc.) o PEC.
  if (!result.sito && !result.sito_web && result.email && typeof result.email === 'string') {
    const emailDom = String(result.email).split('@')[1]?.toLowerCase().trim() || ''
    if (emailDom && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDom)) {
      const isGeneric = /^(gmail|yahoo|hotmail|outlook|libero|virgilio|tiscali|alice|aruba|live|icloud|protonmail|tin|me|pec|legalmail|pecimprese|pecmail|postacert|casellapec)\./i.test(emailDom)
        || /^(gmail|yahoo|hotmail|outlook)\.[a-z]+$/i.test(emailDom)
        || emailDom === 'pec.it' || emailDom === 'libero.it' || emailDom === 'alice.it'
      if (!isGeneric) {
        // Strip eventuali sottodomini "mail." / "www." / "pec." per derivare il sito
        const cleanDom = emailDom.replace(/^(?:mail|www|pec|smtp|webmail|posta)\./, '')
        result.sito = `https://${cleanDom}`
        console.log(`[PERSON-LOOKUP] FINAL: derived sito "${result.sito}" from email "${result.email}"`)
      }
    }
  }

  return NextResponse.json(result)
}
