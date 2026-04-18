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

// ── CompanyReports.it: FREE real company data (fatturato, dipendenti, ATECO) ──
// Identical to lead-registry — scrapes directly with P.IVA for accurate data
async function scrapeCompanyReports(piva: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`https://www.companyreports.it/${piva}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(10000), redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 5000) return null
    if (html.includes('<title>CompanyReports - Il fatturato')) return null
    const result: Record<string, string> = {}
    const meta = html.match(/meta name="description" content="([^"]+)"/i)
    if (meta) {
      const desc = meta[1]
      const fatM = desc.match(/Fatturato\s+([\d.,]+)/i)
      if (fatM) result.fatturato = fatM[1].replace(/,+$/, '').trim()
      const ateM = desc.match(/Ateco\s+([\d.]+)/i)
      if (ateM) result.codice_ateco = ateM[1].replace(/\.+$/, '').trim()
    }
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
    for (const block of jsonLdBlocks) {
      try {
        const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
        const items = d.mainEntity || []
        for (const item of items) {
          const q = (item.name || '').toLowerCase()
          const a: string = item.acceptedAnswer?.text || ''
          if (q.includes('fatturato') && !result.fatturato) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.fatturato = m[1].replace(/,+$/, '').trim()
            const y = a.match(/\((\d{4})\)/)
            if (y) result.fatturato_anno = y[1]
          }
          if (q.includes('dipendenti')) {
            const m = a.match(/da\s*(\d+)\s*a\s*(\d+)/i)
            if (m) result.dipendenti = `${m[1]}-${m[2]}`
            else { const m2 = a.match(/(\d+)\s*dipendenti/i) || a.match(/pari a\s*(\d+)/i); if (m2) result.dipendenti = m2[1] }
          }
          if (q.includes('ateco') && !result.descrizione_ateco) {
            const m = a.match(/codice ATECO\s*[\d.]+\s*[-–—]\s*(.+?)(?:\.|$)/i)
            if (m) result.descrizione_ateco = m[1].trim()
          }
          if (q.includes('sede legale') && !result.sede_legale) {
            const m = a.match(/è\s+(.+?)(?:\.$|$)/i)
            if (m) result.sede_legale = m[1].trim()
          }
          if (q.includes('costo del personale')) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.costo_personale = m[1].replace(/,+$/, '').trim()
          }
        }
      } catch { /* ignore malformed JSON-LD */ }
    }
    const statoM = html.match(/Stato Attivit[àa]<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (statoM) result.stato = statoM[1].trim()
    const formaM = html.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (formaM) result.forma_giuridica = formaM[1].trim()
    if (!result.dipendenti) {
      const dipM = html.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
      if (dipM) result.dipendenti = dipM[1].trim()
    }
    if (!result.pec) {
      const pecM = html.match(/(?:Indirizzo\s*)?PEC<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+@[^<]+)/i)
      if (pecM) result.pec = pecM[1].trim().toLowerCase()
    }
    if (!result.pec) {
      const allEmails = html.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]*(?:pec|legalmail|pecimprese|cert)[a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/gi)
      if (allEmails?.[0]) result.pec = allEmails[0].toLowerCase()
    }
    const titleM = html.match(/<title>([^(<]+)/i)
    if (titleM) result.ragione_sociale = titleM[1].replace(/\s*Fatturato.*$/i, '').trim()
    return Object.keys(result).length > 0 ? result : null
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

  // ─── Step 0: P.IVA diretta → OpenAPI.it SUBITO per nome REALE dal registro imprese ───
  if (isPiva) {
    result.partita_iva = cleanQuery
    console.log(`[COMPANY-LOOKUP] P.IVA query: "${cleanQuery}" — calling OpenAPI.it FIRST for authoritative data`)

    // OpenAPI.it FIRST — only authoritative source for P.IVA → company name mapping
    if (token) {
      const registryData = await searchByPiva(cleanQuery, token)
      if (registryData?.ragione_sociale) {
        result = { ...result, ...registryData }
        fonti.push(...(registryData.fonti as string[] || []))
        console.log(`[COMPANY-LOOKUP] OpenAPI.it found: "${result.ragione_sociale}" for P.IVA ${cleanQuery}`)
      } else {
        console.log(`[COMPANY-LOOKUP] OpenAPI.it: no result for P.IVA ${cleanQuery}`)
      }
    }

    // CompanyReports.it SECOND — for fatturato, dipendenti, ATECO
    if (cleanQuery.length === 11) {
      console.log(`[COMPANY-LOOKUP] Step 0b: CompanyReports.it for P.IVA ${cleanQuery}`)
      const crData = await scrapeCompanyReports(cleanQuery)
      if (crData) {
        // Only merge financial/registry data, NEVER overwrite ragione_sociale from OpenAPI
        if (crData.fatturato && !result.fatturato) result.fatturato = crData.fatturato
        if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno
        if (crData.dipendenti && !result.dipendenti) result.dipendenti = crData.dipendenti
        if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
        if (crData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
        if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
        if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
        if (crData.pec && !result.pec) result.pec = crData.pec
        fonti.push('CompanyReports.it')
        console.log(`[COMPANY-LOOKUP] CompanyReports data merged for P.IVA ${cleanQuery}`)
      }
    }
  }

  // ─── Step 1: Search in existing database ───
  console.log(`[COMPANY-LOOKUP] Query: "${query}"`)
  const dbResult = await searchInDatabase(query)
  if (dbResult) {
    // Merge DB data but DON'T overwrite authoritative OpenAPI data (for P.IVA searches)
    result = isPiva && result.ragione_sociale ? mergeResults(result, dbResult) : dbResult
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

  // ── Quick cleanup: if phone looks like a P.IVA (11 digits, not a valid phone prefix), remove it ──
  if (result.telefono && result.partita_iva) {
    const pd = String(result.telefono).replace(/\D/g, '')
    const pvd = String(result.partita_iva).replace(/\D/g, '')
    if (pd === pvd) {
      console.log(`[COMPANY-LOOKUP] REMOVED phone from Maps — it was the P.IVA: ${result.telefono}`)
      delete result.telefono
    }
  }

  // ─── Step 3: Scrape company website (like category scraper does) ───
  if (result.sito) {
    const siteBase = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
    const siteDomain = siteBase.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    console.log(`[COMPANY-LOOKUP] Step 3: Scraping website ${siteBase}`)

    // Pages to scrape: homepage + common contact pages
    const pagesToTry = [
      siteBase,
      `${siteBase}/contatti`,
      `${siteBase}/contact`,
      `${siteBase}/contacts`,
      `${siteBase}/chi-siamo`,
      `${siteBase}/about`,
    ]

    let allHtml = ''
    for (const pageUrl of pagesToTry) {
      try {
        const pageRes = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
        })
        if (pageRes.ok) {
          const html = await pageRes.text()
          allHtml += ' ' + html
        }
      } catch { /* page not found or timeout — skip */ }
    }

    if (allHtml.length > 100) {
      const pivaKnown = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''

      // Extract P.IVA from website
      if (!result.partita_iva) {
        const pivaMatch = allHtml.match(/(?:P\.?\s*IVA|partita\s*iva|VAT|C\.?F\.?)[:\s/|–-]*(?:IT\s*)?(\d{11})/i)
        if (pivaMatch?.[1]) {
          result.partita_iva = pivaMatch[1]
          console.log(`[COMPANY-LOOKUP] Extracted P.IVA from website: ${pivaMatch[1]}`)
        }
      }

      // Extract phone numbers (landline: 0xx..., mobile: 3xx...)
      const phoneRegex = /(?:tel|phone|telefono|fax|cell|mobile|cellulare)[.\s:]*\+?(\d[\d\s./-]{7,15})/gi
      const rawPhones: string[] = []
      let pm
      while ((pm = phoneRegex.exec(allHtml)) !== null) {
        const digits = pm[1].replace(/\D/g, '')
        if (digits.length >= 9 && digits.length <= 13 && digits !== pivaKnown) {
          rawPhones.push(pm[1].trim())
        }
      }
      // Also look for standalone Italian phone patterns in visible text
      const standalonePhoneRegex = /(?<!\d)(\+39\s?\d{2,4}[\s./-]?\d{3,4}[\s./-]?\d{3,4})(?!\d)/g
      while ((pm = standalonePhoneRegex.exec(allHtml)) !== null) {
        const digits = pm[1].replace(/\D/g, '')
        if (digits.length >= 9 && digits.length <= 13 && digits !== pivaKnown) {
          rawPhones.push(pm[1].trim())
        }
      }

      // Categorize: mobile (3xx) vs landline (0xx)
      for (const ph of rawPhones) {
        const d = ph.replace(/\D/g, '')
        const core = d.startsWith('39') ? d.slice(2) : d
        if (core.startsWith('3') && !result.cellulare) {
          result.cellulare = ph
          console.log(`[COMPANY-LOOKUP] Extracted cellulare from website: ${ph}`)
        } else if (core.startsWith('0') && !result.telefono) {
          result.telefono = ph
          console.log(`[COMPANY-LOOKUP] Extracted telefono from website: ${ph}`)
        }
      }

      // Extract emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
      const emails = [...new Set(allHtml.match(emailRegex) || [])]
        .filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') && !e.includes('example') && !e.includes('sentry'))
      
      // PEC (usually @pec.it or @legalmail.it etc)
      if (!result.pec) {
        const pecEmail = emails.find(e => /pec\.|legalmail\.|pecimprese\.|pecmail\./.test(e.toLowerCase()))
        if (pecEmail) {
          result.pec = pecEmail
          console.log(`[COMPANY-LOOKUP] Extracted PEC from website: ${pecEmail}`)
        }
      }
      // Regular email
      if (!result.email) {
        const regularEmail = emails.find(e => !/pec\.|legalmail\.|pecimprese\.|pecmail\./.test(e.toLowerCase()) && e.includes(siteDomain.replace('www.', '').split('.')[0]))
          || emails.find(e => e.startsWith('info@') || e.startsWith('contatti@') || e.startsWith('amministrazione@'))
          || emails.find(e => !/pec\.|legalmail\./.test(e.toLowerCase()))
        if (regularEmail) {
          result.email = regularEmail
          console.log(`[COMPANY-LOOKUP] Extracted email from website: ${regularEmail}`)
        }
      }

      // Extract social media URLs from href attributes
      const igMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)/i)
      if (igMatch && !result.instagram) {
        result.instagram = igMatch[1]
        console.log(`[COMPANY-LOOKUP] Extracted Instagram from website: ${igMatch[1]}`)
      }
      const liMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?)/i)
      if (liMatch && !result.linkedin) {
        result.linkedin = liMatch[1]
        console.log(`[COMPANY-LOOKUP] Extracted LinkedIn from website: ${liMatch[1]}`)
      }
      const fbMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)/i)
      if (fbMatch && !result.facebook) {
        result.facebook = fbMatch[1]
        console.log(`[COMPANY-LOOKUP] Extracted Facebook from website: ${fbMatch[1]}`)
      }
      const ytMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)[a-zA-Z0-9._-]+\/?)/i)
      if (ytMatch && !result.youtube) {
        result.youtube = ytMatch[1]
        console.log(`[COMPANY-LOOKUP] Extracted YouTube from website: ${ytMatch[1]}`)
      }

      fonti.push('Sito Web Aziendale')
    }
  }

  // ─── Step 3b: CompanyReports.it — dati REALI (fatturato, dipendenti, ATECO, PEC, sede) ───
  // Same source used by lead-registry in "Dettaglio Lead" — guaranteed accurate
  const pivaForCR = (result.partita_iva || '') as string
  if (pivaForCR && pivaForCR.length === 11) {
    console.log(`[COMPANY-LOOKUP] Step 3b: Scraping CompanyReports.it for P.IVA ${pivaForCR}`)
    const crData = await scrapeCompanyReports(pivaForCR)
    if (crData) {
      console.log(`[COMPANY-LOOKUP] CompanyReports.it data:`, JSON.stringify(crData))
      // Merge: CR data has priority for financial fields (it's the most accurate source)
      // CompanyReports has PRIORITY for financial data — always overwrite (it's the real source)
      if (crData.fatturato) { result.fatturato = crData.fatturato; if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno }
      if (crData.dipendenti) result.dipendenti = crData.dipendenti
      if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
      if (crData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
      if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
      if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
      if (crData.pec && !result.pec) result.pec = crData.pec
      if (crData.stato && !result.stato_attivita) result.stato_attivita = crData.stato
      if (crData.costo_personale) result.costo_personale = crData.costo_personale
      fonti.push('CompanyReports.it')
    } else {
      console.log(`[COMPANY-LOOKUP] CompanyReports.it: no data found`)
    }
  }

  // ─── Step 4: Tavily deep enrichment (ricerche mirate) — SOLO per dati ancora mancanti ───
  const tavilyKey = process.env.TAVILY_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  // If we have P.IVA but no name, search for the company name first
  if (!result.ragione_sociale && isPiva && tavilyKey) {
    const pivaQ = `"${cleanQuery}" partita IVA azienda site:ufficiocamerale.it OR site:registroimprese.it`
    try {
      const pivaRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query: pivaQ, search_depth: 'advanced', include_answer: true, max_results: 3 }),
        signal: AbortSignal.timeout(15000),
      })
      if (pivaRes.ok) {
        const pivaData = await pivaRes.json()
        const pivaText = (pivaData.answer || '') + ' ' + (pivaData.results || []).map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
        if (pivaText.length > 30) {
          // Extract just the company name
          const nameRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, messages: [
              { role: 'system', content: 'Estrai la ragione sociale dall\'azienda con P.IVA indicata. Rispondi SOLO con JSON.' },
              { role: 'user', content: `Qual è la ragione sociale dell'azienda con P.IVA ${cleanQuery}? Testo: ${pivaText.slice(0, 4000)}\n\nJSON: {"ragione_sociale":"nome esatto"}` },
            ]}),
            signal: AbortSignal.timeout(10000),
          })
          if (nameRes.ok) {
            const nd = await nameRes.json()
            const raw = nd.choices?.[0]?.message?.content || '{}'
            const parsed = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
            if (parsed.ragione_sociale && parsed.ragione_sociale.length > 2) {
              result.ragione_sociale = parsed.ragione_sociale
              console.log(`[COMPANY-LOOKUP] Found company name from P.IVA via Tavily: "${result.ragione_sociale}"`)
            }
          }
        }
      }
    } catch { /* */ }
  }
  // Use query as fallback company name if not found yet
  if (!result.ragione_sociale && !isPiva && tavilyKey) {
    result.ragione_sociale = query
    console.log(`[COMPANY-LOOKUP] No company found yet, using query as name for Tavily`)
  }
  console.log(`[COMPANY-LOOKUP] Before Tavily — ragione_sociale: "${result.ragione_sociale}", telefono: "${result.telefono || 'N/A'}", email: "${result.email || 'N/A'}"`)
  if (result.ragione_sociale && tavilyKey && openaiKey) {
    const companyName = result.ragione_sociale as string
    const city = (result.citta || '') as string
    const piva = (result.partita_iva || '') as string

    // Helper: single Tavily search — returns ONLY the best matching result to prevent data mixing
    // Track last ufficiocamerale URL found by Tavily so we can scrape it fully
    let lastUfficioCameraleUrl = ''

    async function tavilySearch(query: string, onlyBestMatch = false): Promise<string> {
      try {
        // NOTE: do NOT use include_domains — it breaks results for ufficiocamerale.it
        const body: any = { api_key: tavilyKey, query, search_depth: 'advanced', include_answer: false, max_results: 5 }
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return ''
        const data = await res.json()
        const results = data.results || []
        if (results.length === 0) return ''

        // Track ufficiocamerale URLs from all results
        for (const r of results) {
          if (r.url && r.url.includes('ufficiocamerale.it')) {
            lastUfficioCameraleUrl = r.url
          }
        }

        if (onlyBestMatch && companyName) {
          const nameWords = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length >= 3)
          const pivaClean = piva ? String(piva).replace(/\D/g, '') : ''

          let bestResult: any = null
          let bestScore = -1

          for (const r of results) {
            const text = ((r.title || '') + ' ' + (r.content || '') + ' ' + (r.url || '')).toLowerCase()
            let score = nameWords.filter((w: string) => text.includes(w)).length

            // If we have P.IVA and the result contains it, give HUGE bonus (P.IVA is unique)
            if (pivaClean && text.includes(pivaClean)) {
              score += 100
            }

            if (score > bestScore) {
              bestScore = score
              bestResult = r
            }
          }
          if (bestResult && bestScore > 0) {
            console.log(`[COMPANY-LOOKUP] Tavily best match (score ${bestScore}/${nameWords.length}): "${bestResult.title}" — ${bestResult.url}`)
            // If best result is ufficiocamerale.it, save its URL
            if (bestResult.url?.includes('ufficiocamerale.it')) lastUfficioCameraleUrl = bestResult.url
            return (bestResult.title || '') + ' ' + (bestResult.content || '')
          }
          return ''
        }

        return results.map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
      } catch { return '' }
    }

    // Helper: scrape the FULL ufficiocamerale.it page to get ALL data (not just Tavily snippet)
    async function scrapeUfficioCamerale(url: string): Promise<Record<string, string>> {
      const data: Record<string, string> = {}
      try {
        console.log(`[COMPANY-LOOKUP] Scraping full ufficiocamerale page: ${url}`)
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(8000), redirect: 'follow',
        })
        if (!res.ok) return data
        const html = await res.text()
        if (html.length < 500) return data

        // P.IVA
        const pivaM = html.match(/Partita IVA[:\s]*(\d{11})/i) || html.match(/P\.?\s*IVA[:\s]*(\d{11})/i)
        if (pivaM) data.partita_iva = pivaM[1]
        // Codice Fiscale
        const cfM = html.match(/Codice Fiscale[:\s]*([A-Z0-9]{11,16})/i)
        if (cfM) data.codice_fiscale = cfM[1]
        // PEC
        const pecM = html.match(/PEC[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
        if (pecM) data.pec = pecM[1].toLowerCase()
        // Dipendenti
        const dipM = html.match(/Dipendenti[:\s]*(\d+)/i)
        if (dipM) data.dipendenti = dipM[1]
        // Anno dipendenti
        const dipAnnoM = html.match(/Dipendenti[:\s]*\d+\s*\((\d{4})\)/i)
        if (dipAnnoM) data.dipendenti_anno = dipAnnoM[1]
        // Fatturato
        const fatM = html.match(/Fatturato[:\s]*[€\s]*([\d.,]+)/i)
        if (fatM) data.fatturato = fatM[1].replace(/,+$/, '').trim()
        const fatAnnoM = html.match(/Fatturato[:\s]*[€\s]*[\d.,]+\s*\((\d{4})\)/i)
        if (fatAnnoM) data.fatturato_anno = fatAnnoM[1]
        // Forma Giuridica
        const formaM = html.match(/Forma giuridica[:\s]*([^<\n]+)/i)
        if (formaM) data.forma_giuridica = formaM[1].trim()
        // Data Iscrizione
        const iscrizioneM = html.match(/Data Iscrizione[:\s]*([^<\n]+)/i)
        if (iscrizioneM) data.data_iscrizione = iscrizioneM[1].trim()
        // Codice ATECO
        const atecoM = html.match(/Ateco[:\s]*([\d.]+)/i)
        if (atecoM) data.codice_ateco = atecoM[1].replace(/\.+$/, '').trim()
        // Descrizione ATECO
        const atecoDescM = html.match(/Ateco[:\s]*[\d.]+\s*[-–—]\s*([^<\n]+)/i)
        if (atecoDescM) data.descrizione_ateco = atecoDescM[1].trim()
        // Ragione Sociale
        const ragM = html.match(/Rag\.?\s*Social[e]?[:\s]*([^<\n]+)/i)
        if (ragM) data.ragione_sociale = ragM[1].trim()
        // Indirizzo / Sede
        const indirizzoM = html.match(/Indirizzo[:\s]*([^<\n]+)/i) || html.match(/Sede[:\s]*([^<\n]+)/i)
        if (indirizzoM) data.sede_legale = indirizzoM[1].trim()
        // REA
        const reaM = html.match(/Re[a.]?[:\s]*(\d+)/i)
        if (reaM) data.rea = reaM[1]
        // Capitale Sociale
        const capM = html.match(/Capitale Sociale[:\s]*[€\s]*([\d.,]+)/i)
        if (capM) data.capitale_sociale = capM[1].replace(/,+$/, '').trim()

        console.log(`[COMPANY-LOOKUP] Ufficiocamerale scraped:`, JSON.stringify(data))
      } catch (e) { console.log(`[COMPANY-LOOKUP] Ufficiocamerale scrape error:`, e) }
      return data
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
    const JUNK_VALUES = ['nome e cognome', 'nome cognome', 'codice numerico', 'descrizione attività', 'tipo società', 'importo', 'indirizzo completo', 'indirizzo pec', 'anno o data', 'numero p.iva', 'cf azienda', 'codice fiscale se', 'amministratore/socio', 'amministratore unico', 'legale rappresentante', 'del titolare', 'numero se noto', 'dettagli', 'eventuali sinistri', 'altre info', 'numero dipendenti', 'importo in euro', 'anno di riferimento', 'es. 100k', 'rischio 1', 'rischio 2', 'iso 9001', 'non divulgato', 'non disponibile', 'n/d', 'null', 'url o username', 'url pagina', 'url profilo', 'percentuale quota', 'pec', 'anno', 'p.iva', 'partita iva', 'codice fiscale', 'telefono', 'email', 'non specificato', 'non noto', 'non presente', 'da verificare']
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
            const clean = v.filter((p: any) => {
              if (!p?.nome || isJunkValue(p.nome)) return false
              // Exclude generic "Dipendente" roles from Soci/Titolari
              const ruolo = (p.ruolo || '').toLowerCase()
              if (ruolo === 'dipendente' || ruolo === 'referente' || ruolo === 'organizzatore' || ruolo === 'collaboratore') return false
              return true
            })
            if (clean.length > 0 && !result.persone) result.persone = clean
          }
        } else if (!result[k]) {
          // Normalize ATECO codes from Tavily too
          if (k === 'codice_ateco') {
            result[k] = normalizeAteco(v) || v
          } else if ((k === 'fatturato' || k === 'utile_netto') && typeof v === 'string' && !v.includes('€')) {
            const num = v.replace(/[^\d.,]/g, '').trim()
            result[k] = num ? `€${num}` : v
          } else if (k === 'pec') {
            // PEC must be a valid email
            if (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) result[k] = v
          } else if (k === 'anno_fondazione') {
            // Anno must be a 4-digit year
            const yearMatch = String(v).match(/(\d{4})/)
            if (yearMatch) result[k] = yearMatch[1]
          } else if (k === 'partita_iva') {
            // P.IVA must be exactly 11 digits
            const clean = String(v).replace(/\D/g, '')
            if (clean.length === 11) result[k] = clean
          } else {
            result[k] = v
          }
        }
      }
    }

    let tavilyUsed = false

    // ── Search 1: Visura / dati camerali ──
    const hasBasicCameraleData = result.partita_iva && result.codice_ateco && result.forma_giuridica
    if (!hasBasicCameraleData || (!result.titolare && !result.persone)) {
      // Put ufficiocamerale.it in query (NOT in include_domains which breaks results)
      const q1a = `${companyName} ${piva} partita IVA PEC titolare dipendenti ufficiocamerale.it`
      let text1 = await tavilySearch(q1a, true)
      // Fallback: broader search
      if (text1.length < 50) {
        const q1b = `${companyName} visura camerale dati società ufficiocamerale.it`
        text1 = await tavilySearch(q1b, true)
      }
      if (text1.length > 50) {
        const ext1 = await gptExtract(text1, `Estrai i dati della visura camerale per l'azienda "${companyName}"${piva ? ` (P.IVA: ${piva})` : ''}.

REGOLE IMPORTANTI:
- Estrai dati SOLO dell'azienda "${companyName}"${piva ? ` con P.IVA ${piva}` : ''}, NON di aziende con nomi simili.
- Se trovi dati di più aziende, usa SOLO quelli la cui P.IVA corrisponde a ${piva || '"non nota"'} o la cui ragione sociale corrisponde ESATTAMENTE.
- La P.IVA deve essere di esattamente 11 cifre.
- Se i dati trovati NON corrispondono a questa specifica azienda, restituisci campi vuoti.

JSON:
{"titolare":"nome e cognome REALE del titolare/amministratore","codice_ateco":"codice numerico ATECO","descrizione_ateco":"descrizione attività","forma_giuridica":"tipo società","capitale_sociale":"importo","sede_legale":"indirizzo completo","anno_fondazione":"anno 4 cifre","pec":"indirizzo PEC completo (email)","partita_iva":"P.IVA 11 cifre","codice_fiscale":"CF","persone":[{"nome":"Nome Cognome","ruolo":"Amministratore Delegato / Socio Accomandatario / Titolare / ecc","cf":"CF se disponibile","quota":"% se socio","data_nomina":"data nomina se disponibile","data_nascita":"data nascita se disponibile","luogo_nascita":"luogo nascita se disponibile"}],"dipendenti":"numero dipendenti","fatturato":"importo fatturato in euro con anno","utile_netto":"importo utile netto","classe_fatturato":"es. 100K-500K o 1M-5M o 2M-5M","anno_bilancio":"anno del bilancio"}`)
        // Validate P.IVA from Tavily — cross-check against known P.IVA
        if (ext1.partita_iva) {
          const cleanP = String(ext1.partita_iva).replace(/\D/g, '')
          if (cleanP.length !== 11) {
            console.log(`[COMPANY-LOOKUP] REJECTED invalid P.IVA from Tavily: "${ext1.partita_iva}"`)
            delete ext1.partita_iva
          } else if (piva && cleanP !== piva) {
            // Tavily returned data for a DIFFERENT company — reject ALL extracted data
            console.log(`[COMPANY-LOOKUP] REJECTED ext1 — P.IVA mismatch: extracted ${cleanP} vs known ${piva}`)
            // Keep only non-company-specific fields that might still be correct
            Object.keys(ext1).forEach(k => { if (k !== 'codice_ateco' && k !== 'descrizione_ateco') delete ext1[k] })
          } else {
            ext1.partita_iva = cleanP
          }
        }
        mergeTavily(ext1)
        tavilyUsed = true
      }
    }

    // ── After Search 1: scrape full ufficiocamerale.it page if found ──
    if (lastUfficioCameraleUrl) {
      const ucData = await scrapeUfficioCamerale(lastUfficioCameraleUrl)
      if (Object.keys(ucData).length > 0) {
        // Ufficiocamerale data is AUTHORITATIVE — overwrite for key fields
        if (ucData.partita_iva && !result.partita_iva) result.partita_iva = ucData.partita_iva
        if (ucData.pec && !result.pec) result.pec = ucData.pec
        if (ucData.dipendenti) result.dipendenti = ucData.dipendenti  // always overwrite
        if (ucData.fatturato) { result.fatturato = ucData.fatturato; if (ucData.fatturato_anno) result.fatturato_anno = ucData.fatturato_anno }
        if (ucData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = ucData.forma_giuridica
        if (ucData.codice_ateco && !result.codice_ateco) result.codice_ateco = ucData.codice_ateco
        if (ucData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = ucData.descrizione_ateco
        if (ucData.sede_legale && !result.sede_legale) result.sede_legale = ucData.sede_legale
        if (ucData.capitale_sociale && !result.capitale_sociale) result.capitale_sociale = ucData.capitale_sociale
        if (ucData.codice_fiscale && !result.codice_fiscale) result.codice_fiscale = ucData.codice_fiscale
        fonti.push('Ufficio Camerale (scraping diretto)')
      }
    }

    // ── After ufficiocamerale: if we NOW have P.IVA, try CompanyReports.it ──
    if (result.partita_iva && (!result.fatturato || !result.dipendenti)) {
      const pivaStr = String(result.partita_iva).replace(/\D/g, '')
      if (pivaStr.length === 11) {
        console.log(`[COMPANY-LOOKUP] P.IVA found (${pivaStr}) — trying CompanyReports.it`)
        const crData = await scrapeCompanyReports(pivaStr)
        if (crData) {
          if (crData.fatturato) { result.fatturato = crData.fatturato; if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno }
          if (crData.dipendenti) result.dipendenti = crData.dipendenti
          if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
          if (crData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
          if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
          if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
          if (crData.pec && !result.pec) result.pec = crData.pec
          if (!fonti.includes('CompanyReports.it')) fonti.push('CompanyReports.it')
        }
      }
    }

    // ── Search 2: Bilancio / dati finanziari (fatturato, dipendenti, utile) ──
    if (!result.fatturato || !result.dipendenti) {
      const q2 = `${companyName} ${piva} bilancio fatturato ricavi dipendenti ufficiocamerale.it`
      const text2 = await tavilySearch(q2, true)
      if (text2.length > 50) {
        const ext2 = await gptExtract(text2, `Estrai i dati finanziari SOLO per l'azienda "${companyName}"${piva ? ` (P.IVA: ${piva})` : ''}. NON usare dati di altre aziende anche se hanno nomi simili.${piva ? ` Verifica che i dati si riferiscano alla P.IVA ${piva}.` : ''} Se non sei sicuro che i dati appartengano a questa specifica azienda, restituisci null.
JSON:
{"fatturato":"importo in euro dell'ultimo bilancio","dipendenti":"numero dipendenti","utile_netto":"importo","totale_attivo":"importo","anno_bilancio":"anno di riferimento","classe_fatturato":"es. 100K-500K o 1M-5M"}`)
        mergeTavily(ext2)
        tavilyUsed = true
      }
    }

    // ── Search 2b: Contatti (telefono, cellulare, email, sito) se mancanti ──
    if (!result.telefono || !result.cellulare || !result.email || !result.sito) {
      const q2b = `${companyName} ${city} telefono cellulare email contatti sito web`
      // Do NOT use onlyBestMatch here — phone/email are often on the company's own website, not on ufficiocamerale
      const text2b = await tavilySearch(q2b)
      if (text2b.length > 50) {
        const ext2b = await gptExtract(text2b, `Estrai i contatti UFFICIALI dell'azienda "${companyName}" con sede a ${city || 'Italia'}. Cerca SOLO contatti che appartengono a questa specifica azienda, NON di altre aziende.
IMPORTANTE:
- Il TELEFONO è un numero di telefono (prefisso 0xx per fisso, 3xx per cellulare). NON è la Partita IVA.
- La P.IVA dell'azienda è ${piva || 'sconosciuta'} — NON restituirla come telefono.
- Cerca sia il numero FISSO che il CELLULARE. Spesso il cellulare è nel footer del sito o nella pagina contatti.
JSON:
{"telefono":"numero di telefono FISSO (inizia con 0)","cellulare":"numero CELLULARE (inizia con 3)","email":"email ufficiale","sito_web":"URL sito web","indirizzo":"indirizzo completo sede"}`)
        const pivaStr = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
        const isValidPhone = (ph: string) => {
          if (!ph) return false
          const digits = ph.replace(/\D/g, '')
          if (digits.length < 9 || digits.length > 13) return false
          // Phone must NOT be the P.IVA
          if (pivaStr && digits === pivaStr) return false
          return true
        }
        if (ext2b.telefono && !result.telefono && isValidPhone(ext2b.telefono)) { result.telefono = ext2b.telefono; tavilyUsed = true }
        if (ext2b.cellulare && !result.cellulare && isValidPhone(ext2b.cellulare)) { result.cellulare = ext2b.cellulare; tavilyUsed = true }
        if (ext2b.email && !result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext2b.email)) { result.email = ext2b.email; tavilyUsed = true }
        if (ext2b.sito_web && !result.sito) { result.sito = ext2b.sito_web; tavilyUsed = true }
        if (ext2b.indirizzo && !result.indirizzo) { result.indirizzo = ext2b.indirizzo; tavilyUsed = true }
      }
    }

    // ── Search 2b2: Fallback contatti — cerca direttamente sul sito aziendale ──
    if ((!result.telefono || !result.email) && result.sito) {
      const siteDomain = String(result.sito).replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const q2b2 = `site:${siteDomain} contatti telefono email`
      const text2b2 = await tavilySearch(q2b2)
      if (text2b2.length > 30) {
        const ext2b2 = await gptExtract(text2b2, `Estrai telefono e email dal sito web di "${companyName}" (${siteDomain}). ATTENZIONE: il telefono NON è ${piva || 'la P.IVA'}. JSON:
{"telefono":"numero telefono (prefisso 0xx)","cellulare":"cellulare (prefisso 3xx)","email":"email"}`)
        const pivaStr = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
        if (ext2b2.telefono && !result.telefono) {
          const d = String(ext2b2.telefono).replace(/\D/g, '')
          if (d.length >= 9 && d.length <= 13 && d !== pivaStr) { result.telefono = ext2b2.telefono; tavilyUsed = true }
        }
        if (ext2b2.cellulare && !result.cellulare) {
          const d = String(ext2b2.cellulare).replace(/\D/g, '')
          if (d.length >= 9 && d.length <= 13 && d !== pivaStr) { result.cellulare = ext2b2.cellulare; tavilyUsed = true }
        }
        if (ext2b2.email && !result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext2b2.email)) { result.email = ext2b2.email; tavilyUsed = true }
      }
    }

    // ── Search 2c: Social media (Instagram, LinkedIn, Facebook) ──
    if (!result.instagram || !result.linkedin || !result.facebook) {
      const q2c = `"${companyName}" ${city} instagram linkedin facebook social`
      const text2c = await tavilySearch(q2c)
      if (text2c.length > 50) {
        const ext2c = await gptExtract(text2c, `Cerca i profili social media dell'azienda "${companyName}".

REGOLE CRITICHE:
- Restituisci SOLO URL o username che trovi ESPLICITAMENTE nel testo fornito.
- NON inventare o indovinare URL. Se nel testo non c'è un link Instagram, rispondi null per Instagram.
- NON costruire URL tipo "instagram.com/nomeazienda" se non li trovi scritti nel testo.
- Se trovi solo un'icona o la parola "Instagram" senza URL specifico, rispondi null.

JSON:
{"instagram":"URL Instagram TROVATO nel testo o null","linkedin":"URL LinkedIn TROVATO nel testo o null","facebook":"URL Facebook TROVATO nel testo o null"}`)
        // Validate: reject obviously guessed URLs (just company name appended to domain)
        const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
        const isLikelyGuessed = (url: string, domain: string) => {
          if (!url) return true
          const clean = url.toLowerCase().replace(/[^a-z0-9\/\.]/g, '')
          // If the URL is just "domain/companyname" with no other info, it's likely guessed
          const slug = clean.replace(new RegExp(`.*${domain}\\.com\\/`), '').replace(/\/$/, '')
          return slug === companySlug || slug === companyName.toLowerCase().replace(/\s+/g, '') || slug === companyName.toLowerCase().replace(/\s+/g, '-')
        }
        if (ext2c.instagram && !result.instagram && !isLikelyGuessed(ext2c.instagram, 'instagram')) {
          result.instagram = ext2c.instagram; tavilyUsed = true
        } else if (ext2c.instagram) {
          console.log(`[COMPANY-LOOKUP] REJECTED likely guessed Instagram: "${ext2c.instagram}"`)
        }
        if (ext2c.linkedin && !result.linkedin) { result.linkedin = ext2c.linkedin; tavilyUsed = true }
        if (ext2c.facebook && !result.facebook && !isLikelyGuessed(ext2c.facebook, 'facebook')) {
          result.facebook = ext2c.facebook; tavilyUsed = true
        } else if (ext2c.facebook) {
          console.log(`[COMPANY-LOOKUP] REJECTED likely guessed Facebook: "${ext2c.facebook}"`)
        }
      }
    }

    // ── Search 2d: Titolari / Amministratori / Soci (se ancora mancanti) ──
    if (!result.persone || (Array.isArray(result.persone) && result.persone.length === 0)) {
      const q2d = `${companyName} ${piva} amministratore titolare socio ufficiocamerale.it`
      const text2d = await tavilySearch(q2d, true)
      if (text2d.length > 50) {
        const ext2d = await gptExtract(text2d, `Cerca TUTTI i titolari, amministratori, soci e persone chiave dell'azienda "${companyName}" (P.IVA: ${piva || 'N/D'}).
ATTENZIONE: restituisci SOLO persone che sono SOCI, AMMINISTRATORI o TITOLARI di questa azienda. NON includere dipendenti, collaboratori, organizzatori di eventi, o persone menzionate in altri contesti.
JSON:
{"titolare":"nome e cognome del titolare/amministratore/legale rappresentante","persone":[{"nome":"Nome Cognome","ruolo":"Amministratore Delegato / Socio Accomandatario / Titolare / ecc","cf":"codice fiscale se disponibile","quota":"percentuale quota se socio","data_nomina":"data nomina","data_nascita":"data nascita","luogo_nascita":"luogo nascita"}]}`)
        if (ext2d.titolare && !result.titolare) { result.titolare = ext2d.titolare; tavilyUsed = true }
        if (Array.isArray(ext2d.persone) && ext2d.persone.length > 0) {
          const clean = ext2d.persone.filter((p: any) => p?.nome && !isJunkValue(p.nome))
          if (clean.length > 0) { result.persone = clean; tavilyUsed = true }
        }
      }
      // Fallback: search more broadly
      if (!result.persone || (Array.isArray(result.persone) && result.persone.length === 0)) {
        const q2d2 = `"${companyName}" chi è il titolare amministratore socio fondatore`
        const text2d2 = await tavilySearch(q2d2)
        if (text2d2.length > 50) {
          const ext2d2 = await gptExtract(text2d2, `Chi sono i titolari/amministratori/soci di "${companyName}"? JSON:
{"titolare":"nome e cognome","persone":[{"nome":"Nome Cognome","ruolo":"ruolo nella società"}]}`)
          if (ext2d2.titolare && !result.titolare) { result.titolare = ext2d2.titolare; tavilyUsed = true }
          if (Array.isArray(ext2d2.persone) && ext2d2.persone.length > 0) {
            const clean = ext2d2.persone.filter((p: any) => p?.nome && !isJunkValue(p.nome))
            if (clean.length > 0 && !result.persone) { result.persone = clean; tavilyUsed = true }
          }
        }
      }
      console.log(`[COMPANY-LOOKUP] Search 2d persone: ${result.persone ? JSON.stringify(result.persone) : 'NONE'}`)
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

  // ─── Step 5: ROUND 2 — If we still miss contacts, redo Maps + website scraping ───
  // Critical for: P.IVA searches (Maps was called with "05970051214" instead of "ADIRLAB SRL")
  // Also helps: name searches where Maps didn't find the company or returned incomplete data
  const companyNameNow = (result.ragione_sociale || '') as string
  const needsContacts = !result.telefono || !result.email || !result.sito
  if (companyNameNow && needsContacts) {
    console.log(`[COMPANY-LOOKUP] ── ROUND 2: re-doing Maps + website scraping with name "${companyNameNow}" ──`)

    // Round 2a: Google Maps with the REAL company name
    if (!result.telefono || !result.sito) {
      try {
        const mapsQ = companyNameNow + ((result.citta ? ' ' + result.citta : ''))
        console.log(`[COMPANY-LOOKUP] Round 2a: Maps search for "${mapsQ}"`)
        const mapsRes = await fetch(`${backendUrl}/search-maps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: mapsQ, location: (result.citta || '') as string, max_results: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        if (mapsRes.ok) {
          const mapsData = await mapsRes.json()
          const leads = mapsData.results || mapsData.leads || []
          const lead = leads.find((l: any) => nameMatches(companyNameNow, l.nome || l.title || l.name || '')) || (leads.length === 1 ? leads[0] : null)
          if (lead) {
            console.log(`[COMPANY-LOOKUP] Round 2a: Maps matched "${lead.nome || lead.title || lead.name}"`)
            if (!result.telefono && (lead.telefono || lead.phone)) result.telefono = lead.telefono || lead.phone
            if (!result.email && lead.email) result.email = lead.email
            if (!result.sito && (lead.sito || lead.website)) result.sito = lead.sito || lead.website
            if (!result.indirizzo && (lead.indirizzo || lead.address)) result.indirizzo = lead.indirizzo || lead.address
            if (!result.citta && (lead.citta || lead.city)) result.citta = lead.citta || lead.city
            if (!result.categoria && (lead.categoria || lead.category)) result.categoria = lead.categoria || lead.category
            if (!result.rating && lead.rating) result.rating = lead.rating
            if (!result.reviews && lead.reviews) result.reviews = lead.reviews
            if (!fonti.includes('Google Maps (scraping live)')) fonti.push('Google Maps (scraping live)')
          }
        }
      } catch { /* Maps failed — continue */ }
    }

    // Round 2a cleanup: phone != P.IVA
    if (result.telefono && result.partita_iva) {
      const pd = String(result.telefono).replace(/\D/g, '')
      const pvd = String(result.partita_iva).replace(/\D/g, '')
      if (pd === pvd) { console.log(`[COMPANY-LOOKUP] REMOVED phone (matched P.IVA)`); delete result.telefono }
    }

    // Round 2b: Scrape company website (same as Step 3)
    if (result.sito && (!result.email || !result.telefono || !result.pec)) {
      const siteBase = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
      const siteDomain = siteBase.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      console.log(`[COMPANY-LOOKUP] Round 2b: Scraping website ${siteBase}`)
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
          if (pivaMatch?.[1]) { result.partita_iva = pivaMatch[1]; console.log(`[COMPANY-LOOKUP] R2: P.IVA from website: ${pivaMatch[1]}`) }
        }
        // Phones
        const phoneRegex = /(?:tel|phone|telefono|fax|cell|mobile|cellulare)[.\s:]*\+?(\d[\d\s./-]{7,15})/gi
        const rawPhones: string[] = []
        let pm: RegExpExecArray | null
        while ((pm = phoneRegex.exec(allHtml)) !== null) {
          const digits = pm[1].replace(/\D/g, '')
          if (digits.length >= 9 && digits.length <= 13 && digits !== pivaKnown) rawPhones.push(pm[1].trim())
        }
        const standalonePhoneRegex = /(?<!\d)(\+39\s?\d{2,4}[\s./-]?\d{3,4}[\s./-]?\d{3,4})(?!\d)/g
        while ((pm = standalonePhoneRegex.exec(allHtml)) !== null) {
          const digits = pm[1].replace(/\D/g, '')
          if (digits.length >= 9 && digits.length <= 13 && digits !== pivaKnown) rawPhones.push(pm[1].trim())
        }
        for (const ph of rawPhones) {
          const d = ph.replace(/\D/g, '')
          const core = d.startsWith('39') ? d.slice(2) : d
          if (core.startsWith('3') && !result.cellulare) { result.cellulare = ph; console.log(`[COMPANY-LOOKUP] R2: cellulare from website: ${ph}`) }
          else if (core.startsWith('0') && !result.telefono) { result.telefono = ph; console.log(`[COMPANY-LOOKUP] R2: telefono from website: ${ph}`) }
        }
        // Emails
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        const emails = [...new Set(allHtml.match(emailRegex) || [])]
          .filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') && !e.includes('example') && !e.includes('sentry'))
        if (!result.pec) {
          const pecEmail = emails.find(e => /pec\.|legalmail\.|pecimprese\.|pecmail\./.test(e.toLowerCase()))
          if (pecEmail) { result.pec = pecEmail; console.log(`[COMPANY-LOOKUP] R2: PEC from website: ${pecEmail}`) }
        }
        if (!result.email) {
          const regularEmail = emails.find(e => !/pec\.|legalmail\./.test(e.toLowerCase()) && e.includes(siteDomain.replace('www.', '').split('.')[0]))
            || emails.find(e => e.startsWith('info@') || e.startsWith('contatti@') || e.startsWith('amministrazione@'))
            || emails.find(e => !/pec\.|legalmail\./.test(e.toLowerCase()))
          if (regularEmail) { result.email = regularEmail; console.log(`[COMPANY-LOOKUP] R2: email from website: ${regularEmail}`) }
        }
        // Social
        const igMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)/i)
        if (igMatch && !result.instagram) result.instagram = igMatch[1]
        const liMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?)/i)
        if (liMatch && !result.linkedin) result.linkedin = liMatch[1]
        const fbMatch = allHtml.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)/i)
        if (fbMatch && !result.facebook) result.facebook = fbMatch[1]

        if (!fonti.includes('Sito Web Aziendale')) fonti.push('Sito Web Aziendale')
      }
    }

    // Round 2c: CompanyReports.it (if we now have P.IVA but still miss financial data)
    if (result.partita_iva && (!result.fatturato || !result.dipendenti)) {
      const pivaStr = String(result.partita_iva).replace(/\D/g, '')
      if (pivaStr.length === 11 && !fonti.includes('CompanyReports.it')) {
        console.log(`[COMPANY-LOOKUP] Round 2c: CompanyReports.it with P.IVA ${pivaStr}`)
        const crData = await scrapeCompanyReports(pivaStr)
        if (crData) {
          if (crData.fatturato) { result.fatturato = crData.fatturato; if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno }
          if (crData.dipendenti) result.dipendenti = crData.dipendenti
          if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
          if (crData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
          if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
          if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
          if (crData.pec && !result.pec) result.pec = crData.pec
          fonti.push('CompanyReports.it')
        }
      }
    }
  }

  // ─── Step 5b: Extract P.IVA from website (fallback) ───
  if (result.sito && !result.partita_iva) {
    const pivaFromSite = await extractPivaFromSite(result.sito as string)
    if (pivaFromSite) result.partita_iva = pivaFromSite
  }

  // ─── Step 6: OpenAPI.it — ULTIMO, solo se mancano ancora dati critici (skip se già fatto in Step 0) ───
  const alreadyUsedOpenApi = isPiva && fonti.some(f => f.includes('OpenAPI'))
  const stillMissing = !result.partita_iva || !result.forma_giuridica || !result.pec || !result.sede_legale || !result.codice_ateco
  if (token && stillMissing && !alreadyUsedOpenApi) {
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

    // ── Final phone cleanup: phone must NOT equal P.IVA ──
    if (result.telefono && result.partita_iva) {
      const phoneDigits = String(result.telefono).replace(/\D/g, '')
      const pivaDigits = String(result.partita_iva).replace(/\D/g, '')
      if (phoneDigits === pivaDigits) {
        console.log(`[COMPANY-LOOKUP] REMOVED phone "${result.telefono}" — matches P.IVA`)
        delete result.telefono
      }
    }
    if (result.cellulare && result.partita_iva) {
      const cellDigits = String(result.cellulare).replace(/\D/g, '')
      const pivaDigits = String(result.partita_iva).replace(/\D/g, '')
      if (cellDigits === pivaDigits) {
        console.log(`[COMPANY-LOOKUP] REMOVED cellulare "${result.cellulare}" — matches P.IVA`)
        delete result.cellulare
      }
    }

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

    // ── Final global cleanup: remove "null", "undefined", "N/D" string values ──
    const NULL_STRINGS = ['null', 'undefined', 'n/d', 'n/a', 'non disponibile', 'non specificato', 'non noto', 'non presente', 'da verificare', 'sconosciuto']
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === 'string' && NULL_STRINGS.includes(val.toLowerCase().trim())) {
        delete result[key]
      }
    }

    return NextResponse.json(result)
  }

  return NextResponse.json({ 
    error: `Nessuna azienda trovata per "${query}". Prova con la P.IVA esatta o il nome completo (es. "EDIL SMG S.R.L.S.")` 
  })
}
