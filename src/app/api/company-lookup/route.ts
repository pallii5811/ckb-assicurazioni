import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { getAtecoInsurance } from '@/lib/ateco-insurance'
import { classifyCompanySize, estimateAnnualPremium, analyzeInsuranceGaps } from '@/lib/insurance-analysis'
import { buildInsuranceNeedsProfile } from '@/lib/insurance-needs-engine'

// ── OpenAPI.it endpoints (FREE tier) ────────────────────────
async function searchByPiva(piva: string, token: string) {
  const clean = piva.replace(/^IT/i, '').replace(/\s/g, '').trim()
  if (clean.length < 11) return null

  const fonti: string[] = []
  let result: Record<string, unknown> = {}

  // 1. OpenAPI.it /IT-advanced (FREE — 30/month)
  try {
    const res = await fetch(`https://company.openapi.com/IT-advanced/${clean}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const json = await res.json()
      const entries = json?.data as Array<Record<string, unknown>> | undefined
      if (entries?.length) {
        const d = entries[0]
        fonti.push('OpenAPI.it (Registro Imprese)')
        result = {
          ...result,
          ragione_sociale: d.companyName || d.name || null,
          partita_iva: d.taxCode || clean,
          codice_ateco: normalizeAteco(d.atecoCode) || null,
          descrizione_ateco: d.atecoDescription || null,
          forma_giuridica: d.legalForm || null,
          stato_attivita: d.status || null,
          sede_legale: d.registeredOffice ? `${(d.registeredOffice as any)?.street || ''}, ${(d.registeredOffice as any)?.city || ''}`.trim().replace(/^,\s*/, '') : null,
          citta: (d.registeredOffice as any)?.city || null,
          capitale_sociale: d.shareCapital ? `€${Number(d.shareCapital).toLocaleString('it-IT')}` : null,
          data_costituzione: d.incorporationDate ? String(d.incorporationDate).split('T')[0] : null,
          pec: d.certifiedEmail || null,
          fatturato: d.revenue ? `€${Number(d.revenue).toLocaleString('it-IT')}` : null,
          dipendenti: d.employeesNumber || null,
        }

        // Extract shareholders
        const shareholders = (d.shareHolders || []) as Array<{ name?: string; surname?: string; taxCode?: string; percentShare?: number }>
        const persone: { nome: string; ruolo: string; cf?: string; quota?: string }[] = []
        for (const sh of shareholders) {
          if (!sh.name && !sh.surname) continue
          const nome = [sh.name, sh.surname].filter(Boolean).map(s => 
            (s || '').charAt(0).toUpperCase() + (s || '').slice(1).toLowerCase()
          ).join(' ')
          persone.push({
            nome,
            ruolo: shareholders.length === 1 ? 'Socio Unico' : 'Socio',
            cf: sh.taxCode || undefined,
            quota: sh.percentShare ? `${sh.percentShare}%` : undefined,
          })
        }
        if (persone.length > 0) result.persone = persone
      }
    }
  } catch { /* OpenAPI.it non raggiungibile */ }

  // 2. OpenAPI.it /IT-start (FREE — 30/month) for basic data if /IT-advanced missed
  if (!result.ragione_sociale) {
    try {
      const res = await fetch(`https://company.openapi.com/IT-start/${clean}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const json = await res.json()
        const d = (json?.data as Array<Record<string, unknown>>)?.[0]
        if (d) {
          fonti.push('OpenAPI.it (Base)')
          result = {
            ...result,
            ragione_sociale: result.ragione_sociale || d.companyName || d.name || null,
            partita_iva: result.partita_iva || d.taxCode || clean,
            forma_giuridica: result.forma_giuridica || d.legalForm || null,
            stato_attivita: result.stato_attivita || d.status || null,
            pec: result.pec || d.certifiedEmail || null,
            codice_ateco: result.codice_ateco || normalizeAteco(d.atecoCode) || null,
          }
        }
      }
    } catch { /* */ }
  }

  // 3. OpenAPI.it /IT-pec (FREE — 30/month) for PEC
  if (!result.pec) {
    try {
      const res = await fetch(`https://company.openapi.com/IT-pec/${clean}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const json = await res.json()
        const d = (json?.data as Array<Record<string, unknown>>)?.[0]
        if (d?.pec) {
          result.pec = d.pec
          if (!fonti.includes('OpenAPI.it (PEC)')) fonti.push('OpenAPI.it (PEC)')
        }
      }
    } catch { /* */ }
  }

  result.fonti = fonti
  return result
}

async function searchByName(name: string, token: string) {
  const fonti: string[] = []

  // 1. OpenAPI.it /IT-search (FREE — 100/day)
  try {
    const res = await fetch(`https://company.openapi.com/IT-search?name=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const json = await res.json()
      const results = json?.data as Array<Record<string, unknown>> | undefined
      if (results?.length) {
        fonti.push('OpenAPI.it (Ricerca)')
        // Find best matching result by name — skip if no match
        const d = results.find(r => nameMatches(name, String(r.companyName || r.name || '')))
        if (d) {
          const piva = (d.taxCode || '') as string

          // If we got a P.IVA, do the full lookup
          if (piva && piva.length >= 11) {
            const full = await searchByPiva(piva, token)
            if (full && full.ragione_sociale) {
              const mergedFonti = [...fonti, ...((full.fonti || []) as string[])]
              return { ...full, fonti: [...new Set(mergedFonti)] }
            }
          }

          // Otherwise return basic search results
          return {
            ragione_sociale: d.companyName || d.name || name,
            partita_iva: piva || null,
            forma_giuridica: d.legalForm || null,
            stato_attivita: d.status || null,
            citta: (d.registeredOffice as any)?.city || null,
            sede_legale: d.registeredOffice ? `${(d.registeredOffice as any)?.street || ''}, ${(d.registeredOffice as any)?.city || ''}`.trim().replace(/^,\s*/, '') : null,
            pec: d.certifiedEmail || null,
            fonti,
          }
        }
      }
    }
  } catch { /* */ }

  // 2. Fallback: DuckDuckGo + Google search for P.IVA
  for (const searchEngine of [
    { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${name} partita iva site:registroimprese.it OR site:trovaaziende.it OR site:reportaziende.it`)}` },
    { name: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(`"${name}" "partita iva"`)}&num=5&hl=it` },
  ]) {
    try {
      const res = await fetch(searchEngine.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const html = await res.text()
        const pivaMatches = html.match(/\b\d{11}\b/g) || []
        const freq: Record<string, number> = {}
        for (const p of pivaMatches) {
          if (/^0{11}$/.test(p)) continue
          freq[p] = (freq[p] || 0) + 1
        }
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
        if (sorted.length > 0) {
          const piva = sorted[0][0]
          fonti.push(searchEngine.name)
          const full = await searchByPiva(piva, token)
          if (full && full.ragione_sociale && nameMatches(name, String(full.ragione_sociale))) {
            const mergedFonti = [...fonti, ...((full.fonti || []) as string[])]
            return { ...full, fonti: [...new Set(mergedFonti)] }
          }
        }
      }
    } catch { /* */ }
  }

  // 3. Fallback: CompanyReports scraping
  try {
    const searchUrl = `https://www.companyreports.it/ricerca?q=${encodeURIComponent(name)}`
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const html = await res.text()
      const pivaMatch = html.match(/(?:P\.?\s*IVA|partita\s*iva)[:\s]*(\d{11})/i)
      if (pivaMatch?.[1]) {
        fonti.push('CompanyReports.it')
        const piva = pivaMatch[1]
        const full = await searchByPiva(piva, token)
        if (full && full.ragione_sociale && nameMatches(name, String(full.ragione_sociale))) {
          const mergedFonti = [...fonti, ...((full.fonti || []) as string[])]
          return { ...full, fonti: [...new Set(mergedFonti)] }
        }
      }
    }
  } catch { /* */ }

  return null
}

// ── Search existing leads in Supabase database ──────────────
async function searchInDatabase(query: string, debug: string[] = []): Promise<Record<string, unknown> | null> {
  try {
    const supabase = createServiceRoleClient()
    const normalizedQuery = query.toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s)\b\.?/gi, '').trim()
    const queryWords = normalizedQuery.split(/\s+/).filter((w: string) => w.length >= 2)
    if (queryWords.length === 0) return null

    // Use raw PostgREST API with text cast on JSONB (supabase JS doesn't support ::text)
    // Use the longest word for better DB filtering
    const mainWord = queryWords.reduce((a, b) => a.length >= b.length ? a : b)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) { debug.push('Missing Supabase env'); return null }

    // Try RPC function first, fallback to batch scan
    const rawRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/search_leads_by_text`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ search_text: mainWord }),
        signal: AbortSignal.timeout(8000),
      }
    )

    let rows: any[] | null = null
    if (rawRes.ok) {
      rows = await rawRes.json()
      debug.push(`RPC search for "${mainWord}": ${rows?.length || 0} rows`)
    } else {
      // RPC not available — fallback to batch scan
      debug.push(`RPC not available (${rawRes.status}), using batch scan`)
      const batchRes = await supabase
        .from('searches')
        .select('results')
        .eq('status', 'completed')
        .not('results', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500)
      rows = batchRes.data
      if (batchRes.error) debug.push(`Batch error: ${batchRes.error.message}`)
      else debug.push(`Batch fallback: ${rows?.length || 0} rows`)
      // Filter in JS
      if (rows) {
        rows = rows.filter((r: any) => {
          const s = typeof r.results === 'string' ? r.results : JSON.stringify(r.results)
          return s.toLowerCase().includes(mainWord)
        })
        debug.push(`After JS filter: ${rows.length} rows contain "${mainWord}"`)
      }
    }
    
    if (!rows || rows.length === 0) { debug.push('No rows found'); return null }
    if (!rows || rows.length === 0) return null

    for (const row of rows) {
      const results = typeof row.results === 'string' ? (() => { try { return JSON.parse(row.results) } catch { return [] } })() : Array.isArray(row.results) ? row.results : []
      for (const lead of results) {
        if (!lead || typeof lead !== 'object') continue
        const leadName = (lead.nome || lead.azienda || lead.business_name || '').toLowerCase()
        const leadNameClean = leadName.replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s)\b\.?/gi, '').trim()
        if (!leadNameClean) continue
        if (queryWords.every((w: string) => leadNameClean.includes(w)) && nameMatches(query, leadName)) {
          return {
            ragione_sociale: lead.nome || lead.azienda || lead.business_name || null,
            partita_iva: null,
            sito: lead.sito || lead.website || lead.url || null,
            telefono: lead.telefono || lead.phone || null,
            email: lead.email || null,
            citta: lead.citta || lead.city || null,
            indirizzo: lead.indirizzo || lead.address || null,
            categoria: lead.categoria || lead.category || null,
            rating: lead.rating || null,
            reviews: lead.reviews || null,
            fonte_db: true,
            fonti: ['Database CKB (lead esistente)'],
          }
        }
      }
    }
    debug.push('No matching lead name found in filtered rows')
  } catch (e: any) { debug.push(`Exception: ${e?.message || e}`) }
  return null
}

// ── Helper: extract P.IVA from website HTML ─────────────────
async function extractPivaFromSite(siteUrl: string): Promise<string | null> {
  try {
    const url = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/(?:P\.?\s*IVA|partita\s*iva|VAT|C\.?F\.?)[:\s/|–-]*(?:IT\s*)?(\d{11})/i)
    return m?.[1] || null
  } catch { return null }
}

// ── AI Insurance Analysis — GPT-4o-mini analizza dati reali dell'azienda ─────
interface PolicyCheck {
  polizza: string
  tipo: 'obbligatoria' | 'settoriale' | 'raccomandata'
  stato: 'ce_lha' | 'probabilmente_no' | 'da_verificare'
  probabilita_possesso: string  // es. "85%"
  motivo: string
  domanda_broker: string  // domanda da fare al cliente
}

async function analyzeInsuranceWithAI(
  companyData: Record<string, unknown>,
): Promise<PolicyCheck[]> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return []

  // Deduce activity from name if no category/ATECO
  const nome = String(companyData.ragione_sociale || '')
  const cat = String(companyData.categoria || companyData.descrizione_ateco || '')
  const activityHint = cat || nome // GPT can infer from company name

  const prompt = `Sei il miglior broker assicurativo italiano con 30 anni di esperienza. Devi preparare un report PRE-VISITA per un'azienda. Il tuo obiettivo: dire al broker ESATTAMENTE cosa questa azienda HA SICURAMENTE, cosa PROBABILMENTE NON HA, e cosa DA VERIFICARE.

DATI AZIENDA:
- Ragione sociale: ${nome}
- P.IVA: ${companyData.partita_iva || 'N/D'}
- Forma giuridica: ${companyData.forma_giuridica || 'Deduci dal nome'}
- Codice ATECO: ${companyData.codice_ateco || 'N/D'}
- Categoria/Attività: ${activityHint || 'Deduci dal nome'}
- Sede: ${companyData.citta || companyData.sede_legale || 'N/D'}
- Fatturato: ${companyData.fatturato || 'N/D'}
- Dipendenti: ${companyData.dipendenti || 'N/D'}
- Capitale sociale: ${companyData.capitale_sociale || 'N/D'}
- Sito web: ${companyData.sito || companyData.sito_web || 'N/D'}

USA QUESTE STATISTICHE REALI sulla penetrazione assicurativa in Italia (fonte ANIA/IVASS):
- RC Terzi: 70-80% delle aziende ce l'ha
- INAIL: obbligatoria, 95%+ se ha dipendenti
- Incendio: 60-70% delle aziende con sede propria
- Furto: 50-60% delle aziende
- RC Prodotti: 40-50% nel settore alimentare/manifattura
- Cyber Risk: solo 10-15% delle PMI italiane
- D&O: solo 20-25% delle SRL, 60% delle SPA
- Key Man: meno del 10% delle PMI
- Business Interruption: 15-20% delle PMI
- Tutela Legale: 20-25%
- Polizza Cauzioni: 80%+ nelle costruzioni (richiesta per appalti)
- RC Professionale: obbligatoria per professionisti iscritti ad albi
- TCM/Vita: meno del 15% delle PMI
- Employee Benefits (sanitaria collettiva): 30% delle aziende con >15 dip

Per ogni polizza, assegna uno stato basato sui dati E sulle statistiche:
- "ce_lha" = quasi certamente l'ha (>75% nel suo settore, o obbligatoria per legge)
- "probabilmente_no" = probabilmente NON ce l'ha (<30% nel suo settore)
- "da_verificare" = potrebbe averla o no (30-75%)

Rispondi con un JSON array. Ogni elemento:
{"polizza":"nome polizza","tipo":"obbligatoria"|"settoriale"|"raccomandata","stato":"ce_lha"|"probabilmente_no"|"da_verificare","probabilita_possesso":"85%","motivo":"perché pensi che ce l'abbia o no — con dato statistico","domanda_broker":"domanda specifica da fare al cliente per verificare"}

REGOLE:
- DEDUCI il settore dal nome se non hai l'ATECO
- Per le obbligatorie per legge: se opera legalmente, CE L'HA
- Per le altre: usa le statistiche ANIA reali per il settore
- Includi 10-15 polizze, ordinate: prima quelle che NON ha, poi da verificare, poi quelle che ha
- La "domanda_broker" deve essere una domanda CONCRETA da fare in call (es. "Ha una polizza cyber? Solo il 12% delle PMI del suo settore ce l'ha")

RISPONDI SOLO CON IL JSON ARRAY, nessun altro testo.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() || '[]'
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    const policies: PolicyCheck[] = JSON.parse(jsonMatch[0])
    return Array.isArray(policies) ? policies : []
  } catch { return [] }
}

// ── Helper: merge two result objects (second overwrites only null/missing fields) ──
function mergeResults(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'fonti') continue // handled separately
    if (v !== null && v !== undefined && v !== '') {
      // Only overwrite if base doesn't have a value
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') {
        merged[k] = v
      }
    }
  }
  // Merge fonti arrays
  const baseFonti = Array.isArray(base.fonti) ? base.fonti : []
  const extraFonti = Array.isArray(extra.fonti) ? extra.fonti : []
  merged.fonti = [...new Set([...baseFonti, ...extraFonti])]
  return merged
}

// ── Helper: normalize ATECO code to full format ──────────
function normalizeAteco(code: unknown): string | null {
  if (!code) return null
  let s = String(code).trim()
  if (!s || s === 'null') return null
  // Remove any non-digit/dot chars
  s = s.replace(/[^\d.]/g, '')
  // Pad to standard format: XX.XX.XX
  const parts = s.split('.')
  if (parts.length === 1 && parts[0].length >= 2) {
    // e.g. "4120" -> "41.20.00"
    const d = parts[0]
    if (d.length === 2) return `${d}.00.00`
    if (d.length === 3) return `${d.slice(0,2)}.${d.slice(2)}0.00`
    if (d.length === 4) return `${d.slice(0,2)}.${d.slice(2)}.00`
    if (d.length >= 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`
    return s
  }
  if (parts.length === 2) {
    // e.g. "41.2" -> "41.20.00" or "41.20" -> "41.20.00"
    const p1 = parts[0].padStart(2, '0')
    const p2 = parts[1].length === 1 ? parts[1] + '0' : parts[1]
    return `${p1}.${p2}.00`
  }
  if (parts.length === 3) {
    const p1 = parts[0].padStart(2, '0')
    const p2 = parts[1].length === 1 ? parts[1] + '0' : parts[1]
    const p3 = parts[2].length === 1 ? parts[2] + '0' : parts[2]
    return `${p1}.${p2}.${p3}`
  }
  return s
}

// ── Helper: check if returned name matches query ──────────
function nameMatches(query: string, returned: string): boolean {
  if (!query || !returned) return false
  const clean = (s: string) => s.toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|di|e|the|srl|srls|spa|snc|sas)\.?\b/gi, '').replace(/[^a-z0-9àèéìòù\s]/g, '').trim()
  const qWords = clean(query).split(/\s+/).filter(w => w.length >= 2)
  const rClean = clean(returned)
  if (qWords.length === 0) return false
  const matched = qWords.filter(w => rClean.includes(w)).length
  // For short queries (1-2 words), ALL words must match
  // For longer queries (3+), at least 60% must match
  if (qWords.length <= 2) return matched === qWords.length
  return matched >= Math.ceil(qWords.length * 0.6)
}

// ── Main route ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const query = (body.query || '').trim()

  if (!query) {
    return NextResponse.json({ error: 'Inserisci un nome azienda o P.IVA.' })
  }

  const token = process.env.OPENAPI_IT_TOKEN || ''
  const backendUrl = process.env.BACKEND_URL || 'http://46.225.189.40:8001'

  // Detect if query is a P.IVA (11 digits)
  const cleanQuery = query.replace(/^IT/i, '').replace(/\s/g, '')
  const isPiva = /^\d{11}$/.test(cleanQuery)

  let result: Record<string, unknown> = {}
  const fonti: string[] = []

  // ─── Step 0: P.IVA diretta → OpenAPI.it full lookup ───
  if (isPiva) {
    if (token) {
      const pivaResult = await searchByPiva(cleanQuery, token)
      if (pivaResult?.ragione_sociale) {
        result = pivaResult
        return NextResponse.json(result)
      }
    }
    return NextResponse.json({ error: `Nessuna azienda trovata per P.IVA "${cleanQuery}".` })
  }

  // ─── Step 1: Search in existing database ───
  console.log(`[COMPANY-LOOKUP] Query: "${query}"`)
  const dbResult = await searchInDatabase(query)
  if (dbResult) {
    result = dbResult
    fonti.push('Database CKB (lead esistente)')
    console.log(`[COMPANY-LOOKUP] DB found: "${result.ragione_sociale}"`)
  } else {
    console.log(`[COMPANY-LOOKUP] DB: nessun risultato`)
  }

  // ─── Step 2: Google Maps scraping (live) — if not found in DB or missing data ───
  if (!result.ragione_sociale || !result.telefono) {
    try {
      const mapsRes = await fetch(`${backendUrl}/search-maps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, location: '', max_results: 5 }),
        signal: AbortSignal.timeout(15000),
      })
      if (mapsRes.ok) {
        const mapsData = await mapsRes.json()
        const leads = mapsData.results || mapsData.leads || []
        console.log(`[COMPANY-LOOKUP] Maps returned ${leads.length} results:`, leads.map((l: any) => l.nome || l.title || l.name || '?'))
        // Find the lead that best matches the query name
        const lead = leads.find((l: any) => nameMatches(query, l.nome || l.title || l.name || '')) || (leads.length === 1 ? leads[0] : null)
        console.log(`[COMPANY-LOOKUP] Maps matched lead: ${lead ? (lead.nome || lead.title || lead.name) : 'NONE'}`)
        if (lead) {
          const mapsResult: Record<string, unknown> = {
            ragione_sociale: lead.nome || lead.title || lead.name || null,
            sito: lead.sito || lead.website || null,
            telefono: lead.telefono || lead.phone || null,
            email: lead.email || null,
            citta: lead.citta || lead.city || null,
            indirizzo: lead.indirizzo || lead.address || null,
            categoria: lead.categoria || lead.category || null,
            rating: lead.rating || null,
            reviews: lead.reviews || null,
            fonti: ['Google Maps (scraping live)'],
          }
          result = result.ragione_sociale ? mergeResults(result, mapsResult) : { ...mapsResult, fonti: ['Google Maps (scraping live)'] }
          fonti.push('Google Maps (scraping live)')
        }
      }
    } catch { /* Maps scraping failed */ }
  }

  // ─── Step 3: companyreports.it — skip for now, Tavily is more reliable ───

  // ─── Step 4: Tavily deep enrichment (ricerche mirate) ───
  const tavilyKey = process.env.TAVILY_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  // Use query as fallback company name if not found yet
  if (!result.ragione_sociale && tavilyKey) {
    result.ragione_sociale = query
    console.log(`[COMPANY-LOOKUP] No company found yet, using query as name for Tavily`)
  }
  console.log(`[COMPANY-LOOKUP] Before Tavily — ragione_sociale: "${result.ragione_sociale}", telefono: "${result.telefono || 'N/A'}", email: "${result.email || 'N/A'}"`)
  if (result.ragione_sociale && tavilyKey && openaiKey) {
    const companyName = result.ragione_sociale as string
    const city = (result.citta || '') as string
    const piva = (result.partita_iva || '') as string

    // Helper: single Tavily search
    async function tavilySearch(query: string): Promise<string> {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'advanced', include_answer: true, max_results: 5 }),
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return ''
        const data = await res.json()
        return (data.answer || '') + ' ' + (data.results || []).map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
      } catch { return '' }
    }

    // Helper: GPT extract JSON from text
    async function gptExtract(text: string, extractPrompt: string): Promise<Record<string, any>> {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: extractPrompt + '\n\nTESTO:\n' + text.slice(0, 5000) + '\n\nSOLO JSON.' }], temperature: 0, max_tokens: 1200 }),
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return {}
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content?.trim() || '{}'
        const m = content.match(/\{[\s\S]*\}/)
        return m ? JSON.parse(m[0]) : {}
      } catch { return {} }
    }

    // Merge helper: only fill missing fields — with aggressive junk filtering
    const JUNK_VALUES = ['nome e cognome', 'nome cognome', 'codice numerico', 'descrizione attività', 'tipo società', 'importo', 'indirizzo completo', 'indirizzo pec', 'anno o data', 'numero p.iva', 'cf azienda', 'codice fiscale se', 'amministratore/socio', 'numero se noto', 'dettagli', 'eventuali sinistri', 'altre info', 'numero dipendenti', 'importo in euro', 'anno di riferimento', 'es. 100k', 'rischio 1', 'rischio 2', 'iso 9001', 'non divulgato', 'non disponibile', 'n/d', 'null']
    function isJunkValue(v: any): boolean {
      if (v === null || v === undefined || v === '' || v === 0 || v === '0') return true
      if (typeof v === 'string') {
        const low = v.toLowerCase().trim()
        if (low.length < 2) return true
        if (JUNK_VALUES.some(j => low.includes(j))) return true
        if (low.includes('/') && low.length > 20) return true
      }
      return false
    }
    function mergeTavily(extracted: Record<string, any>) {
      for (const [k, v] of Object.entries(extracted)) {
        if (isJunkValue(v)) continue
        if (k === 'persone' || k === 'soci' || k === 'amministratori') {
          if (Array.isArray(v) && v.length > 0) {
            const clean = v.filter((p: any) => p?.nome && !isJunkValue(p.nome))
            if (clean.length > 0 && !result.persone) result.persone = clean
          }
        } else if (!result[k]) {
          // Normalize ATECO codes from Tavily too
          if (k === 'codice_ateco') {
            result[k] = normalizeAteco(v) || v
          } else {
            result[k] = v
          }
        }
      }
    }

    let tavilyUsed = false

    // ── Search 1: Visura / dati camerali (titolare, soci, ATECO, capitale) ──
    if (!result.titolare || !result.codice_ateco || !result.persone) {
      const q1 = `"${companyName}" ${piva} visura camerale amministratore titolare soci codice ATECO capitale sociale`
      const text1 = await tavilySearch(q1)
      if (text1.length > 50) {
        const ext1 = await gptExtract(text1, `Estrai i dati della visura camerale per "${companyName}". JSON:
{"titolare":"nome e cognome del titolare/amministratore unico/legale rappresentante","codice_ateco":"codice numerico ATECO","descrizione_ateco":"descrizione attività","forma_giuridica":"tipo società","capitale_sociale":"importo","sede_legale":"indirizzo completo con CAP e città","anno_fondazione":"anno","pec":"indirizzo PEC","partita_iva":"numero P.IVA","codice_fiscale":"CF azienda","persone":[{"nome":"Nome Cognome","ruolo":"Amministratore/Socio/ecc","cf":"codice fiscale se disponibile","quota":"% se socio"}]}`)
        mergeTavily(ext1)
        tavilyUsed = true
      }
    }

    // ── Search 2: Bilancio / dati finanziari (fatturato, dipendenti, utile) ──
    if (!result.fatturato || !result.dipendenti) {
      const q2 = `"${companyName}" ${piva} bilancio fatturato ricavi dipendenti utile netto`
      const text2 = await tavilySearch(q2)
      if (text2.length > 50) {
        const ext2 = await gptExtract(text2, `Estrai i dati finanziari per "${companyName}". JSON:
{"fatturato":"importo in euro dell'ultimo bilancio","dipendenti":"numero dipendenti","utile_netto":"importo","totale_attivo":"importo","anno_bilancio":"anno di riferimento","classe_fatturato":"es. 100K-500K o 1M-5M"}`)
        mergeTavily(ext2)
        tavilyUsed = true
      }
    }

    // ── Search 2b: Contatti (telefono, email, sito) se mancanti ──
    if (!result.telefono || !result.email || !result.sito) {
      const q2b = `"${companyName}" ${city} telefono email contatti sito web sede`
      const text2b = await tavilySearch(q2b)
      if (text2b.length > 50) {
        const ext2b = await gptExtract(text2b, `Estrai i contatti UFFICIALI dell'azienda "${companyName}" con sede a ${city || 'Italia'}. Cerca SOLO contatti che appartengono a questa specifica azienda, NON di altre aziende. JSON:
{"telefono":"numero di telefono fisso o cellulare dell'azienda (prefisso coerente con la sede)","email":"indirizzo email ufficiale dell'azienda","sito_web":"URL sito web ufficiale","indirizzo":"indirizzo completo sede operativa"}`)
        // Validate phone: must be Italian format
        const isValidPhone = (ph: string) => {
          if (!ph) return false
          const digits = ph.replace(/\D/g, '')
          return digits.length >= 9 && digits.length <= 13
        }
        if (ext2b.telefono && !result.telefono && isValidPhone(ext2b.telefono)) { result.telefono = ext2b.telefono; tavilyUsed = true }
        if (ext2b.email && !result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext2b.email)) { result.email = ext2b.email; tavilyUsed = true }
        if (ext2b.sito_web && !result.sito) { result.sito = ext2b.sito_web; tavilyUsed = true }
        if (ext2b.indirizzo && !result.indirizzo) { result.indirizzo = ext2b.indirizzo; tavilyUsed = true }
      }
    }

    // ── Search 2c: Social media (Instagram, LinkedIn, Facebook) ──
    if (!result.instagram || !result.linkedin || !result.facebook) {
      const q2c = `"${companyName}" ${city} instagram linkedin facebook social`
      const text2c = await tavilySearch(q2c)
      if (text2c.length > 50) {
        const ext2c = await gptExtract(text2c, `Cerca i profili social media UFFICIALI dell'azienda "${companyName}". Restituisci SOLO profili che appartengono a questa azienda, NON profili personali o di altre aziende. JSON:
{"instagram":"URL o username Instagram dell'azienda","linkedin":"URL pagina LinkedIn aziendale","facebook":"URL pagina Facebook aziendale"}`)
        if (ext2c.instagram && !result.instagram) { result.instagram = ext2c.instagram; tavilyUsed = true }
        if (ext2c.linkedin && !result.linkedin) { result.linkedin = ext2c.linkedin; tavilyUsed = true }
        if (ext2c.facebook && !result.facebook) { result.facebook = ext2c.facebook; tavilyUsed = true }
      }
    }

    // ── Search 3: Info per assicuratori (rischi, certificazioni, sinistri, flotta) ──
    {
      const q3 = `"${companyName}" ${city} certificazioni ISO SOA flotta veicoli immobili proprietà assicurazione sinistri bandi appalti`
      const text3 = await tavilySearch(q3)
      if (text3.length > 50) {
        const ext3 = await gptExtract(text3, `Estrai TUTTE le informazioni utili per un broker assicurativo su "${companyName}". JSON:
{"certificazioni":["ISO 9001","SOA","ecc"],"ha_flotta_veicoli":true/false,"numero_veicoli":"numero se noto","ha_immobili_proprieta":true/false,"immobili_descrizione":"descrizione immobili","partecipa_appalti_pubblici":true/false,"appalti_info":"dettagli","sinistri_noti":"eventuali sinistri noti da news","attivita_estero":true/false,"rischi_specifici":["rischio 1","rischio 2"],"note_broker":"altre info utili per assicuratore, es. lavora con materiali pericolosi, ha laboratorio, fa consegne a domicilio, ecc"}`)
        mergeTavily(ext3)
        tavilyUsed = true
      }
    }

    if (tavilyUsed) fonti.push('Tavily (ricerca web)')
  }

  // ─── Step 5: Extract P.IVA from website ───
  if (result.sito && !result.partita_iva) {
    const piva = await extractPivaFromSite(result.sito as string)
    if (piva) result.partita_iva = piva
  }

  // ─── Step 6: OpenAPI.it — ULTIMO, solo se mancano ancora dati critici ───
  const stillMissing = !result.partita_iva || !result.forma_giuridica || !result.pec
  if (token && stillMissing) {
    if (result.partita_iva) {
      const registryData = await searchByPiva(result.partita_iva as string, token)
      if (registryData?.ragione_sociale) {
        result = mergeResults(result, registryData)
        fonti.push(...(registryData.fonti as string[] || []))
      }
    } else {
      const nameResult = await searchByName(result.ragione_sociale as string || query, token)
      if (nameResult?.ragione_sociale) {
        result = result.ragione_sociale ? mergeResults(result, nameResult) : nameResult
        fonti.push(...(nameResult.fonti as string[] || []))
      }
    }
  }

  // ─── Step 7: Analisi assicurativa — polizze mancanti / gap ───
  if (result.ragione_sociale) {
    result.fonti = [...new Set(fonti)]

    const parseFat = (f: any): number | null => {
      if (!f) return null
      const n = Number(String(f).replace(/[^\d]/g, ''))
      return isNaN(n) || n === 0 ? null : n
    }
    const parseDip = (d: any): number | null => {
      if (!d) return null
      const s = String(d).match(/\d+/)
      return s ? parseInt(s[0], 10) : null
    }

    const fatNum = parseFat(result.fatturato)
    const dipNum = parseDip(result.dipendenti)
    const category = (result.categoria || result.descrizione_ateco || '') as string
    const website = (result.sito || result.sito_web || '') as string

    // ATECO → obblighi assicurativi del settore
    const atecoIns = getAtecoInsurance((result.codice_ateco as string) || null, category || null)
    if (atecoIns) {
      result.obblighi_assicurativi = atecoIns
    }

    // Classificazione dimensionale EU
    result.classificazione_eu = classifyCompanySize(fatNum, dipNum)

    // ─── ANALISI ASSICURATIVA AI: GPT analizza i dati reali ───
    const aiPolicies = await analyzeInsuranceWithAI(result)
    if (aiPolicies.length > 0) {
      result.verifica_polizze = aiPolicies
    }

    // Stima premio per le polizze mancanti
    result.stima_premio = estimateAnnualPremium(
      fatNum,
      dipNum,
      atecoIns?.classe_inail || null,
      null,
      atecoIns?.settore || null,
    )

    // Bisogni assicurativi verificati + playbook commerciale
    const gapAnalysis = analyzeInsuranceGaps(
      fatNum, dipNum,
      (result.forma_giuridica as string) || null,
      (result.codice_ateco as string) || null,
      category || null, null, null,
      !!(result.pec), !!website,
    )
    result.bisogni_assicurativi = buildInsuranceNeedsProfile({
      profile: result as Record<string, any>,
      category: category || null,
      website: website || null,
      atecoInsurance: atecoIns || null,
      gapAnalysis: gapAnalysis || null,
    })

    return NextResponse.json(result)
  }

  return NextResponse.json({ 
    error: `Nessuna azienda trovata per "${query}". Prova con la P.IVA esatta o il nome completo (es. "EDIL SMG S.R.L.S.")` 
  })
}
