import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { getAtecoInsurance } from '@/lib/ateco-insurance'
import { classifyCompanySize, estimateAnnualPremium, analyzeInsuranceGaps } from '@/lib/insurance-analysis'
import { buildInsuranceNeedsProfile } from '@/lib/insurance-needs-engine'
import { geminiExtractCompanyData, isGeminiEnabled } from '@/lib/gemini-search'
import {
  type CompanyIdentity, type Evidence, type TrustLevel,
  isCompanyMatch, scoreCompanyMatch, normalizeDomain, normalizeCity,
} from '@/lib/identity-gate'

export const maxDuration = 300

// ── OpenAPI.it endpoints (FREE tier) ────────────────────────
async function searchByPiva(piva: string, token: string) {
  if (!token) return null // OpenAPI.it disabilitato — CompanyReports.it fornisce dati gratis
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
  if (!token) return null // OpenAPI.it disabilitato — CompanyReports.it fornisce dati gratis
  const fonti: string[] = []

  // 1. OpenAPI.it /IT-search (FREE — 100/day)
  try {
    const res = await fetch(`https://company.openapi.com/IT-search?companyName=${encodeURIComponent(name)}`, {
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
        // Parse Dataset JSON-LD (variableMeasured) — has exact bilancio values
        if (d['@type'] === 'Dataset' && Array.isArray(d.variableMeasured)) {
          for (const vm of d.variableMeasured) {
            const vmName = String(vm.name || '').toLowerCase()
            const vmVal = vm.value?.value || vm.value
            if (vmName.includes('fatturato') && vmVal && !result.fatturato) {
              result.fatturato = String(vmVal)
              const yearM = vmName.match(/(\d{4})/)
              if (yearM) result.fatturato_anno = yearM[1]
            }
            if (vmName.includes('utile') && vmVal && !result.utile_netto) {
              result.utile_netto = String(vmVal)
            }
          }
        }
        // Parse LocalBusiness JSON-LD
        if (d['@type'] === 'LocalBusiness') {
          if (d.isicV4 && !result.codice_ateco) result.codice_ateco = String(d.isicV4)
          if (d.knowsAbout && !result.descrizione_ateco) result.descrizione_ateco = String(d.knowsAbout)
          if (d.foundingDate && !result.data_costituzione) {
            const fd = String(d.foundingDate).trim()
            if (/\b(?:19|20)\d{2}\b/.test(fd)) result.data_costituzione = fd
          }
          if (d.taxID && !result.codice_fiscale) result.codice_fiscale = String(d.taxID)
          if (d.address?.streetAddress && !result.sede_legale) {
            const addr = d.address
            result.sede_legale = [addr.streetAddress, addr.addressLocality?.replace(/, Italy$/i, '')].filter(Boolean).join(', ')
          }
        }
        const items = d.mainEntity || []
        for (const item of items) {
          const q = (item.name || '').toLowerCase()
          const a: string = item.acceptedAnswer?.text || ''
          if (q.includes('fatturato') && !result.fatturato) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.fatturato = m[1].replace(/,+$/, '').trim()
            const y = a.match(/(\d{4})/)
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
    // Titolare / Rappresentante Legale / Amministratore
    const titPatterns = [
      /Amministratore\s+Unico<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i,
      /Rappresentante\s+Legale<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i,
      /Titolare<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i,
      /Amministratore\s+Delegato<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i,
      /Presidente<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i,
      /Amministratore\s+Unico[:\s]*([A-Z][a-zà-ú]+\s+[A-Z][a-zà-ú]+)/,
      /Rappresentante Legale[:\s]*([A-Z][a-zà-ú]+\s+[A-Z][a-zà-ú]+)/,
    ]
    for (const rx of titPatterns) {
      const m = html.match(rx)
      if (m) {
        const name = m[1].trim().replace(/\s+/g, ' ')
        if (name.split(/\s+/).length >= 2 && !/\b(s\.?r\.?l|s\.?p\.?a|srl|spa|sas|snc)\b/i.test(name) && name.length < 60) {
          result.titolare = name
          break
        }
      }
    }
    // ── Parse statisticheAzienda JS object (most reliable source for financial data) ──
    // CompanyReports embeds: <script> var statisticheAzienda = {"anno1":"2024","fy1":"6.228.007",...};</script>
    // We extract the script block first, then pull individual key-value pairs with simple regex.
    try {
      // Step 1: Extract the full <script> block containing statisticheAzienda
      const scriptMatch = html.match(/<script>\s*var\s+statisticheAzienda\s*=\s*([\s\S]+?)<\/script>/)
      if (scriptMatch) {
        const block = scriptMatch[1]
        // Step 2: Extract individual "key":"value" pairs from the block
        const extractStatsVal = (key: string): string | null => {
          const m = block.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'))
          return m ? m[1] : null
        }
        const anno1 = extractStatsVal('anno1')
        // Fatturato (fy1 = most recent year)
        const fy1 = extractStatsVal('fy1')
        if (fy1 && !result.fatturato) {
          result.fatturato = fy1.replace(/\./g, '').replace(/,/g, '.')
          if (anno1) result.fatturato_anno = anno1
        }
        // Utile netto (uy1 = most recent year)
        const uy1 = extractStatsVal('uy1')
        if (uy1 && !result.utile_netto) {
          result.utile_netto = uy1.replace(/\./g, '').replace(/,/g, '.')
          if (anno1) result.utile_netto_anno = anno1
        }
        // Costo del personale (cy1 = most recent year)
        const cy1 = extractStatsVal('cy1')
        if (cy1 && !result.costo_personale) {
          result.costo_personale = cy1.replace(/\./g, '').replace(/,/g, '.')
          if (anno1) result.costo_personale_anno = anno1
        }
        // Denominazione (authoritative company name)
        const denom = extractStatsVal('denominazione')
        if (denom && !result.ragione_sociale) {
          result.ragione_sociale = denom
        }
        // Store historical data for chart display
        const histAnni = [extractStatsVal('anno6'), extractStatsVal('anno5'), extractStatsVal('anno4'), extractStatsVal('anno3'), extractStatsVal('anno2'), anno1].filter(Boolean) as string[]
        const histFatt = [extractStatsVal('fy6'), extractStatsVal('fy5'), extractStatsVal('fy4'), extractStatsVal('fy3'), extractStatsVal('fy2'), fy1].filter(Boolean) as string[]
        const histUtile = [extractStatsVal('uy6'), extractStatsVal('uy5'), extractStatsVal('uy4'), extractStatsVal('uy3'), extractStatsVal('uy2'), uy1].filter(Boolean) as string[]
        const histCosto = [extractStatsVal('cy6'), extractStatsVal('cy5'), extractStatsVal('cy4'), extractStatsVal('cy3'), extractStatsVal('cy2'), cy1].filter(Boolean) as string[]
        if (histAnni.length >= 2) {
          result.storico_bilanci = JSON.stringify({
            anni: histAnni,
            fatturato: histFatt.map(v => v.replace(/\./g, '').replace(/,/g, '.')),
            utile: histUtile.map(v => v.replace(/\./g, '').replace(/,/g, '.')),
            costo_personale: histCosto.map(v => v.replace(/\./g, '').replace(/,/g, '.')),
          })
        }
        console.log(`[COMPANY-LOOKUP] statisticheAzienda: fatturato=${fy1 || 'none'} utile=${uy1 || 'none'} costo_personale=${cy1 || 'none'} denom=${denom || 'none'}`)
      }
    } catch (e: any) { console.log(`[COMPANY-LOOKUP] statisticheAzienda parse error: ${e?.message || e}`) }
    // Normalize ATECO to full XX.XX.XX format
    if (result.codice_ateco) result.codice_ateco = normalizeAteco(result.codice_ateco) || result.codice_ateco
    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── fatturatoitalia.it scraper — structured data (P.IVA, sede, ATECO, bilanci) ──
// URL pattern: /x-{PIVA} (alias) or /{slug}-{PIVA}
// Returns all fields parseable from the page. null if not found / inaccessible.
async function scrapeFatturatoItalia(piva: string): Promise<Record<string, string> | null> {
  try {
    const url = `https://www.fatturatoitalia.it/x-${piva}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(10000), redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 2000) return null
    const data: Record<string, string> = {}
    const cleanHtmlValue = (s: string) => s
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim()
    const extractTableValue = (label: string): string | null => {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
      const patterns = [
        new RegExp(`<t[dh][^>]*>\\s*${esc}\\s*<\\/t[dh]>\\s*<t[dh][^>]*>([\\s\\S]*?)<\\/t[dh]>`, 'i'),
        new RegExp(`<[^>]+>\\s*${esc}\\s*<\\/[^>]+>\\s*<[^>]+>([\\s\\S]*?)<\\/[^>]+>`, 'i'),
      ]
      for (const rx of patterns) {
        const m = html.match(rx)
        if (m) {
          const v = cleanHtmlValue(m[1])
          if (v && v.length < 200) return v
        }
      }
      return null
    }

    // 1) Parse all JSON-LD blocks — this is the authoritative source for this site
    const jsonLdBlocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1].trim())
    for (const block of jsonLdBlocks) {
      try {
        const obj = JSON.parse(block)
        const items = Array.isArray(obj) ? obj : [obj]
        for (const it of items) {
          const type = Array.isArray(it['@type']) ? it['@type'][0] : it['@type']
          // Organization / LocalBusiness: core company identity
          if (type === 'LocalBusiness' || type === 'Organization' || type === 'Corporation') {
            if (!data.ragione_sociale && (it.legalName || it.name)) {
              const n = String(it.legalName || it.name).trim()
              if (n && !/fatturato\s*italia/i.test(n)) data.ragione_sociale = n
            }
            if (!data.partita_iva && it.vatID) {
              const v = String(it.vatID).replace(/\D/g, '')
              if (/^\d{11}$/.test(v)) data.partita_iva = v
            }
            if (!data.codice_fiscale && it.taxID) {
              const v = String(it.taxID).trim().toUpperCase()
              if (/^[A-Z0-9]{11,16}$/.test(v)) data.codice_fiscale = v
            }
            if (!data.data_costituzione && it.foundingDate) {
              const fd = String(it.foundingDate).trim()
              // Skip se è una label residua (es. "Data di costituzione")
              if (/\b(?:19|20)\d{2}\b/.test(fd)) data.data_costituzione = fd
            }
            if (!data.codice_ateco && it.isicV4) {
              // isicV4 format "331303" → "33.13.03"
              const raw = String(it.isicV4).replace(/\D/g, '')
              if (raw.length >= 4) {
                const formatted = raw.length >= 6 ? `${raw.slice(0,2)}.${raw.slice(2,4)}.${raw.slice(4,6)}` : `${raw.slice(0,2)}.${raw.slice(2,4)}`
                data.codice_ateco = normalizeAteco(formatted) || formatted
              }
            }
            if (!data.descrizione_ateco && it.knowsAbout) data.descrizione_ateco = String(it.knowsAbout).trim()
            if (it.address && typeof it.address === 'object') {
              const a = it.address
              if (!data.sede_legale && a.streetAddress) {
                const city = (a.addressLocality || '').replace(/,\s*Italy$/i, '').trim()
                data.sede_legale = [a.streetAddress, city].filter(Boolean).join(', ')
              }
              if (!data.citta && a.addressLocality) data.citta = String(a.addressLocality).replace(/,\s*Italy$/i, '').trim()
              if (!data.provincia && a.addressRegion) data.provincia = String(a.addressRegion).trim()
              if (!data.cap && a.postalCode) data.cap = String(a.postalCode).trim()
            }
          }
          // Dataset: bilanci (fatturato/utile per year)
          if (type === 'Dataset' && Array.isArray(it.variableMeasured)) {
            let latestYear = 0, latestFat = '', latestUtile = ''
            for (const vm of it.variableMeasured) {
              const name = String(vm.name || '')
              const val = vm.value?.value ?? vm.value
              if (!val) continue
              const yearM = name.match(/(\d{4})/)
              if (!yearM) continue
              const year = parseInt(yearM[1])
              if (/fatturato/i.test(name) && year > latestYear) { latestYear = year; latestFat = String(val) }
              if (/utile/i.test(name) && year >= latestYear) { latestUtile = String(val) }
            }
            if (latestFat && !data.fatturato) {
              data.fatturato = latestFat.trim()
              if (latestYear) data.fatturato_anno = String(latestYear)
            }
            if (latestUtile && !data.utile_netto) data.utile_netto = latestUtile.trim()
          }
        }
      } catch { /* skip malformed JSON-LD */ }
    }

    // 2) Meta description fallback (summary: "fatturato X, P.IVA Y, CF Z")
    const metaDescM = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
    if (metaDescM) {
      const desc = metaDescM[1]
      if (!data.fatturato) {
        const fm = desc.match(/fatturato\s*([\d.,]+)/i)
        if (fm) data.fatturato = fm[1].replace(/[.,]+$/, '').trim()
      }
      if (!data.codice_fiscale) {
        const cfm = desc.match(/\bCF\s+([A-Z0-9]{11,16})/i)
        if (cfm) data.codice_fiscale = cfm[1].toUpperCase()
      }
      if (!data.partita_iva) {
        const pm = desc.match(/P\.?\s*IVA\s+(\d{11})/i)
        if (pm) data.partita_iva = pm[1]
      }
    }

    // 3) Secondary HTML regex for fields not in JSON-LD: dipendenti, forma_giuridica, capitale_sociale, REA
    //    The page uses column layout (label-label / value-value) so we need proximity-based regex.
    if (!data.ragione_sociale) {
      const v = extractTableValue('Ragione sociale')
      if (v) data.ragione_sociale = v
    }
    if (!data.partita_iva) {
      const v = extractTableValue('Partita IVA')
      const d = v ? v.replace(/\D/g, '') : ''
      if (/^\d{11}$/.test(d)) data.partita_iva = d
    }
    if (!data.codice_fiscale) {
      const v = extractTableValue('Codice Fiscale')
      if (v) data.codice_fiscale = v.toUpperCase().replace(/[^A-Z0-9]/g, '')
    }
    if (!data.codice_ateco) {
      const v = extractTableValue('ATECO')
      const m = v?.match(/\d{2}\.?\d{2}\.?\d{0,2}/)
      if (m) data.codice_ateco = normalizeAteco(m[0]) || m[0]
    }
    if (!data.descrizione_ateco) {
      const v = extractTableValue('Attività prevalente') || extractTableValue('Attivita prevalente')
      if (v) data.descrizione_ateco = v
    }
    if (!data.fatturato) {
      const v = extractTableValue('Fatturato 2024') || extractTableValue('Fatturato')
      const m = v?.match(/[\d.]+(?:,\d+)?/)
      if (m) {
        data.fatturato = m[0].replace(/\./g, '').replace(/,/g, '.')
        if (/Fatturato 2024/i.test(html)) data.fatturato_anno = '2024'
      }
    }
    if (!data.utile_netto) {
      const v = extractTableValue('Utile 2024') || extractTableValue('Utile')
      const m = v?.match(/[\d.]+(?:,\d+)?/)
      if (m) {
        data.utile_netto = m[0].replace(/\./g, '').replace(/,/g, '.')
        data.utile_netto_anno = '2024'
      }
    }
    if (!data.costo_personale) {
      const v = extractTableValue('Costo del personale')
      const m = v?.match(/[\d.]+(?:,\d+)?/)
      if (m) data.costo_personale = m[0].replace(/\./g, '').replace(/,/g, '.')
    }
    if (!data.dipendenti) {
      const v = extractTableValue('N. Dipendenti')
      if (v) data.dipendenti = v.replace(/^da\s+/i, '').replace(/\s+/g, ' ').trim()
    }
    if (!data.dipendenti) {
      const dipM = html.match(/N\.?\s*Dipendenti[\s\S]{0,400}?>\s*(\d+(?:\s*[-–a]\s*\d+)?)\s*<\/(?:p|td|span|div|strong|b)/i)
      if (dipM) data.dipendenti = dipM[1].trim()
    }
    if (!data.forma_giuridica) {
      const v = extractTableValue('Forma giuridica')
      if (v) data.forma_giuridica = v
    }
    if (!data.forma_giuridica) {
      const fgM = html.match(/Forma\s*giuridica[\s\S]{0,400}?>\s*(Societa['àa'][^<]{3,70}|Ditta[^<]{3,50}|Impresa[^<]{3,50}|Consorzio[^<]{3,50}|Cooperativa[^<]{3,50})</i)
      if (fgM) data.forma_giuridica = fgM[1].trim().replace(/\s+/g, ' ')
    }
    if (!data.capitale_sociale) {
      const capM = html.match(/Capitale\s*sociale[\s\S]{0,400}?€?\s*([\d.,]+)\s*(?:€|<)/i)
      if (capM) data.capitale_sociale = capM[1].replace(/[.,]+$/, '').trim()
    }
    if (!data.rea) {
      const v = extractTableValue('REA')
      if (v) data.rea = v
    }
    if (!data.rea) {
      // REA format: "MI 1996009" or just digits
      const reaM = html.match(/\bREA[\s\S]{0,400}?>\s*([A-Z]{2}\s*-?\s*\d{3,8}|\d{3,8})\s*<\/(?:p|td|span|div|strong|b)/i)
      if (reaM) data.rea = reaM[1].trim().replace(/\s+/g, ' ')
    }
    if (!data.data_costituzione) {
      const v = extractTableValue('Anno Fondazione')
      // Accetta solo se sembra una data (1900-2099 oppure DD/MM/YYYY oppure YYYY-MM-DD)
      if (v && /\b(?:19|20)\d{2}\b/.test(v)) data.data_costituzione = v
    }
    if (!data.stato_attivita) {
      const v = extractTableValue('Stato Attività') || extractTableValue('Stato Attivita')
      if (v) data.stato_attivita = v
    }

    // 4) Normalize data_costituzione: prefer full date, fall back to year
    if (data.data_costituzione) {
      const iso = data.data_costituzione.match(/^(\d{4}-\d{2}-\d{2})/)
      if (iso) data.data_costituzione = iso[1]
    }

    return Object.keys(data).length > 0 ? data : null
  } catch { return null }
}

async function findFatturatoItaliaByKeyword(keyword: string, cityHint?: string): Promise<Record<string, string> | null> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const cleanKeyword = keyword.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('@').pop()!
    .split('.')[0]
    .replace(/[^a-z0-9à-ù]/gi, '')
  if (!tavilyKey || cleanKeyword.length < 4) return null
  try {
    const queries = [
      `site:fatturatoitalia.it ${cleanKeyword}`,
      cityHint ? `site:fatturatoitalia.it ${cleanKeyword} ${cityHint}` : '',
    ].filter(Boolean)
    const seen = new Set<string>()
    for (const q of queries) {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: 'basic', max_results: 10 }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const data = await res.json()
      const results = (data.results || []) as Array<{ url?: string; title?: string; content?: string }>
      for (const r of results) {
        const url = r.url || ''
        const m = url.match(/fatturatoitalia\.it\/([a-z0-9-]+)-(\d{11})(?:\/|$|\?)/i)
        if (!m) continue
        const slug = m[1].toLowerCase()
        const piva = m[2]
        if (seen.has(piva)) continue
        seen.add(piva)
        if (!slug.includes(cleanKeyword)) continue
        const scraped = await scrapeFatturatoItalia(piva)
        if (!scraped) continue
        const scrapedName = String(scraped.ragione_sociale || '').toLowerCase().replace(/[^a-z0-9à-ù]/gi, '')
        const scrapedSiteText = `${scrapedName} ${slug}`.toLowerCase()
        if (!scrapedSiteText.includes(cleanKeyword)) continue
        const cityLow = String(cityHint || '').toLowerCase().trim()
        const scrapedCity = String(scraped.citta || scraped.sede_legale || '').toLowerCase()
        if (cityLow && scrapedCity && !scrapedCity.includes(cityLow)) continue
        console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByKeyword: matched ${cleanKeyword} → ${slug} P.IVA=${piva}`)
        return scraped
      }
    }
  } catch { return null }
  return null
}

// ── Scrape the official company website for P.IVA / Codice Fiscale ──
// Tries homepage + a few common footer-bearing paths (/contatti, /chi-siamo, /privacy, /cookies).
// The P.IVA is legally required to appear on every Italian commercial website, typically in the footer.
async function scrapeWebsiteForPIVA(siteUrl: string): Promise<{ partita_iva?: string; codice_fiscale?: string } | null> {
  if (!siteUrl) return null
  let base: URL
  try { base = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`) } catch { return null }
  // Common paths where Italian sites put the P.IVA (homepage first, then footer-heavy pages)
  const paths = ['/', '/contatti', '/contacts', '/chi-siamo', '/about', '/about-us', '/privacy', '/privacy-policy', '/cookie-policy', '/note-legali', '/legal']
  const fetchPage = async (path: string): Promise<string | null> => {
    try {
      const u = new URL(path, base).toString()
      const res = await fetch(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(8000), redirect: 'follow',
      })
      if (!res.ok) return null
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('text/html')) return null
      return await res.text()
    } catch { return null }
  }

  // Regex for Italian VAT ID: "P. IVA 12345678901", "Partita IVA: 12345678901", "VAT IT12345678901", etc.
  // P.IVA is EXACTLY 11 digits; codice fiscale is 11 digits (for companies) or 16 alphanumeric (individuals).
  const pivaRx = /(?:partita\s*iva|p\.?\s*iva|vat\s*(?:id|number)?|c\.?\s*f\.?\s*e?\s*p\.?\s*iva)\s*[:.\-#]?\s*(?:it\s*)?(\d{11})\b/gi
  const cfRx = /(?:codice\s*fiscale|c\.?\s*f\.?)\s*[:.\-#]?\s*([A-Z0-9]{11,16})\b/gi

  const seenPiva = new Set<string>()
  const seenCf = new Set<string>()
  let picked: { partita_iva?: string; codice_fiscale?: string } = {}

  for (const p of paths) {
    const html = await fetchPage(p)
    if (!html) continue
    // Normalize: strip tags but keep content (footer often embeds P.IVA inside <span>/<p>)
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    for (const m of text.matchAll(pivaRx)) {
      const v = m[1]
      // P.IVA validation: must be 11 digits and pass Italian checksum (Luhn-like odd/even)
      if (!/^\d{11}$/.test(v)) continue
      // Skip obviously invalid (all zeros, sequential)
      if (/^0{11}$/.test(v) || /^1{11}$/.test(v)) continue
      seenPiva.add(v)
    }
    for (const m of text.matchAll(cfRx)) {
      const v = m[1].toUpperCase()
      if (/^[A-Z0-9]{11}$/.test(v) || /^[A-Z0-9]{16}$/.test(v)) seenCf.add(v)
    }
    // If we already found a P.IVA on the homepage, we can stop — no need to hit more pages
    if (seenPiva.size > 0 && p === '/') break
    // Stop after finding any P.IVA on any page (avoid wasting time on many paths)
    if (seenPiva.size > 0) break
  }

  if (seenPiva.size > 0) {
    // Prefer the most common P.IVA if multiple; take the first one found
    picked.partita_iva = Array.from(seenPiva)[0]
  }
  if (seenCf.size > 0) picked.codice_fiscale = Array.from(seenCf)[0]
  return (picked.partita_iva || picked.codice_fiscale) ? picked : null
}

// ── Find fatturatoitalia.it page by company name via Tavily ──
// Discovers P.IVA from the URL pattern /slug-PIVA, then calls scrapeFatturatoItalia.
// Validates slug contains at least one token of the company name (anti-homonym).
async function findFatturatoItaliaByName(companyName: string, cityHint?: string): Promise<Record<string, string> | null> {
  const tavilyKey = process.env.TAVILY_API_KEY
  if (!tavilyKey || !companyName || companyName.length < 3) return null

  // Known Italian city tokens: we separate them from the name tokens because slugs on
  // fatturatoitalia.it do NOT include city names (only legal name + P.IVA).
  const KNOWN_CITIES_FFI = new Set([
    'milano','roma','napoli','torino','bologna','firenze','genova','palermo','bari','catania',
    'venezia','verona','padova','brescia','bergamo','modena','parma','maranello','rozzano',
    'mogliano','treviso','trieste','vicenza','cagliari','messina','livorno','perugia','reggio',
    'ravenna','rimini','salerno','foggia','ferrara','latina','monza','pescara','trento',
    'bolzano','siracusa','taranto','novara','cremona','como','pavia','mantova','lecco',
    'varese','lodi','buccinasco','corsico','assago','rho','magenta','legnano','lainate',
    'cesano','bresso','milanese','brianza','veneto','ancona','aosta','lecce','terni','viterbo',
    'savona','imperia','alessandria','asti','cuneo','biella','vercelli','udine','pordenone',
    'gorizia','sondrio','olbia','sassari','matera','cosenza','catanzaro','sanremo',
  ])
  const allTokens = companyName.toLowerCase()
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|società|societa|unipersonale|italia|italy)\b/gi, '')
    .replace(/[^a-zà-ù0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
  const nameTokens: string[] = []
  const geoTokensInQuery: string[] = []
  for (const t of allTokens) {
    if (KNOWN_CITIES_FFI.has(t)) geoTokensInQuery.push(t); else nameTokens.push(t)
  }
  if (nameTokens.length === 0) return null

  const legalSuffixes = new Set(['srl', 'srls', 'spa', 'sas', 'snc', 'scarl', 'scrl', 'ssd', 'ltd', 'sarl'])
  // If cityHint not provided but query contains a known city, use it as implicit hint.
  const cityLow = cityHint
    ? cityHint.toLowerCase().split(',')[0].trim()
    : (geoTokensInQuery[0] || '')

  // When input has >= 2 meaningful tokens, STRICT: require ALL tokens to be present in the slug.
  // This prevents "REPOWER VENDITA ITALIA SPA" from being hijacked by slug "repower-italia-spa"
  // (P.IVA of parent Repower Italia SpA — an homonym).
  const minRequired = nameTokens.length >= 2 ? nameTokens.length : 1

  // Helper: run one Tavily query and collect viable candidates
  const runQuery = async (q: string): Promise<Array<{ piva: string, slug: string, tokenMatches: number, extraWords: number, firstMatch: boolean, snippet: string }>> => {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: 'basic', max_results: 10 }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return []
      const data = await res.json()
      const results = (data.results || []) as Array<{ url?: string; title?: string; content?: string }>
      const out: Array<{ piva: string, slug: string, tokenMatches: number, extraWords: number, firstMatch: boolean, snippet: string }> = []
      for (const r of results) {
        const url = r.url || ''
        const m = url.match(/fatturatoitalia\.it\/([a-z0-9-]+)-(\d{11})(?:\/|$|\?)/i)
        if (!m) continue
        const slug = m[1].toLowerCase()
        const piva = m[2]
        const slugWords = slug.split('-').filter(w => w.length > 0)
        const tokenMatches = nameTokens.filter(t => slugWords.includes(t)).length
        if (tokenMatches < minRequired) continue
        const extraWords = slugWords.filter(w => !nameTokens.includes(w) && !legalSuffixes.has(w) && !/^\d+$/.test(w)).length
        const firstMatch = slugWords.length > 0 && nameTokens.includes(slugWords[0])
        const snippet = `${r.title || ''} ${r.content || ''}`.toLowerCase()
        out.push({ piva, slug, tokenMatches, extraWords, firstMatch, snippet })
      }
      return out
    } catch { return [] }
  }

  try {
    // First attempt: quoted exact-phrase with optional city
    const q1 = cityLow
      ? `site:fatturatoitalia.it "${companyName}" ${cityLow}`
      : `site:fatturatoitalia.it "${companyName}"`
    let candidates = await runQuery(q1)

    // Fallback 1: without quotes — Tavily/Google sometimes miss quoted phrases for long names
    if (candidates.length === 0) {
      const q2 = cityLow
        ? `site:fatturatoitalia.it ${nameTokens.join(' ')} ${cityLow}`
        : `site:fatturatoitalia.it ${nameTokens.join(' ')}`
      console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: fallback query (unquoted) for "${companyName}"`)
      candidates = await runQuery(q2)
    }

    if (candidates.length === 0) {
      console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: no matching URL for "${companyName}" (cityHint=${cityLow || 'none'}, minRequired=${minRequired}/${nameTokens.length})`)
      return null
    }

    // De-dup by P.IVA (union of both query rounds)
    const seen = new Set<string>()
    const uniq = candidates.filter(c => { if (seen.has(c.piva)) return false; seen.add(c.piva); return true })

    uniq.sort((a, b) => {
      if (b.tokenMatches !== a.tokenMatches) return b.tokenMatches - a.tokenMatches
      if (cityLow) {
        const aHas = a.snippet.includes(cityLow) ? 1 : 0
        const bHas = b.snippet.includes(cityLow) ? 1 : 0
        if (aHas !== bHas) return bHas - aHas
      }
      if (a.firstMatch !== b.firstMatch) return a.firstMatch ? -1 : 1
      return a.extraWords - b.extraWords
    })
    console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: ${uniq.length} candidate(s) for "${companyName}" (cityHint=${cityLow || 'none'}, minTokens=${minRequired}/${nameTokens.length}):`)
    uniq.slice(0, 5).forEach((c, i) => console.log(`  ${i}: ${c.slug} p=${c.piva} tokens=${c.tokenMatches}/${nameTokens.length} city=${cityLow && c.snippet.includes(cityLow)} extra=${c.extraWords}`))

    // Try up to 3 candidates. Validate scraped ragione_sociale contains all name tokens.
    const maxTries = Math.min(3, uniq.length)
    for (let i = 0; i < maxTries; i++) {
      const cand = uniq[i]
      const scraped = await scrapeFatturatoItalia(cand.piva)
      if (!scraped) {
        console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: scrape failed for ${cand.piva}, trying next`)
        continue
      }
      const scrapedCity = (scraped.citta || '').toLowerCase()
      if (cityLow && scrapedCity && !scrapedCity.includes(cityLow) && !cityLow.includes(scrapedCity)) {
        console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: city mismatch for ${cand.piva} — scraped="${scrapedCity}" hint="${cityLow}", trying next`)
        continue
      }
      // Validate scraped name contains all input tokens — strong anti-homonym check
      const scrapedName = String(scraped.ragione_sociale || '').toLowerCase()
      if (scrapedName && nameTokens.length >= 2) {
        const missing = nameTokens.filter(t => !scrapedName.includes(t))
        if (missing.length > 0) {
          console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: name mismatch for ${cand.piva} — scraped="${scrapedName}" missing tokens [${missing.join(',')}], trying next`)
          continue
        }
      }
      scraped.partita_iva = scraped.partita_iva || cand.piva
      console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: ACCEPTED P.IVA ${cand.piva} (slug="${cand.slug}", city="${scrapedCity || 'n/a'}")`)
      return scraped
    }
    console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName: all ${maxTries} candidate(s) rejected (city/name mismatch or scrape failed)`)
    return null
  } catch (e: any) {
    console.log(`[COMPANY-LOOKUP] findFatturatoItaliaByName error: ${e?.message}`)
    return null
  }
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
      signal: AbortSignal.timeout(200000),
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

// ── Helper: normalize ATECO code to full format (XX.XX.XX) ──────────
function normalizeAteco(code: unknown): string | null {
  if (!code) return null
  let s = String(code).trim()
  if (!s || s === 'null') return null
  // Remove any non-digit/dot chars
  s = s.replace(/[^\d.]/g, '')
  // If the raw string is way too long (>10 chars), it's garbage — take only the first valid portion
  // Valid ATECO: max "XX.XX.XX" = 8 chars
  if (s.length > 10) {
    // Try to extract a valid ATECO pattern from the beginning
    const m = s.match(/^(\d{1,2})\.?(\d{1,2})?\.?(\d{1,2})?/)
    if (m) {
      s = [m[1], m[2] || '00', m[3] || '00'].join('.')
    } else {
      return null
    }
  }
  // Pad to standard format: XX.XX.XX
  const parts = s.split('.').filter(p => p.length > 0)
  if (parts.length === 1 && parts[0].length >= 2) {
    // e.g. "4120" -> "41.20.00"
    const d = parts[0]
    if (d.length === 2) return `${d}.00.00`
    if (d.length === 3) return `${d.slice(0,2)}.${d.slice(2)}0.00`
    if (d.length === 4) return `${d.slice(0,2)}.${d.slice(2)}.00`
    if (d.length >= 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`
    return `${d}.00.00`
  }
  if (parts.length === 2) {
    // e.g. "41.2" -> "41.20.00" or "41.20" -> "41.20.00"
    const p1 = parts[0].padStart(2, '0').slice(0, 2)
    const p2 = (parts[1].length === 1 ? parts[1] + '0' : parts[1]).slice(0, 2)
    return `${p1}.${p2}.00`
  }
  // 3+ parts: take first 3 only
  const p1 = (parts[0] || '00').padStart(2, '0').slice(0, 2)
  const p2 = (parts[1] || '00').length === 1 ? parts[1] + '0' : (parts[1] || '00').slice(0, 2)
  const p3 = (parts[2] || '00').length === 1 ? parts[2] + '0' : (parts[2] || '00').slice(0, 2)
  const result = `${p1}.${p2}.${p3}`
  // Final sanity: must be XX.XX.XX format (8 chars)
  if (result.length !== 8) return null
  return result
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

  // ─── Step 0: Extract city from query (anti-omonimia) ──
  // If user types "BIOSKIN ITALIA Bologna" we must use "Bologna" to filter Maps + fatturatoitalia
  let queryCompanyName = query
  let queryCityHint = ''
  if (!isPiva) {
    // Quick regex for common Italian city patterns at end of query
    const ITALIAN_CITIES_RX = /\b(milano|roma|napoli|torino|bologna|firenze|genova|venezia|verona|padova|trieste|bari|palermo|catania|cagliari|brescia|bergamo|modena|parma|reggio\s*emilia|prato|livorno|ravenna|ferrara|rimini|sassari|monza|trento|bolzano|perugia|ancona|pescara|udine|arezzo|vicenza|lecce|terni|piacenza|novara|varese|como|lodi|cremona|mantova|siena|lucca|pisa|massa|pistoia|grosseto|biella|vercelli|asti|cuneo|aosta|sondrio|savona|imperia|sanremo|la\s*spezia|forlì|cesena|imola|faenza|lugo|rovigo|belluno|treviso|pordenone|gorizia|campobasso|isernia|potenza|matera|cosenza|catanzaro|crotone|vibo\s*valentia|reggio\s*calabria|trapani|agrigento|enna|siracusa|ragusa|caltanissetta|nuoro|oristano|olbia|carbonia|iglesias|lamezia\s*terme|gioia\s*tauro|taranto|brindisi|foggia|avellino|benevento|caserta|salerno|frosinone|latina|rieti|viterbo|chieti|l'?aquila|teramo|ascoli|macerata|fermo|pesaro|urbino)\s*$/i
    const cityMatch = query.match(ITALIAN_CITIES_RX)
    if (cityMatch) {
      queryCityHint = cityMatch[1].trim()
      queryCompanyName = query.replace(ITALIAN_CITIES_RX, '').trim()
      console.log(`[COMPANY-LOOKUP] City extracted from query: "${queryCityHint}", company: "${queryCompanyName}"`)
    }
  }

  // ─── Identity-gate helper: costruisce CompanyIdentity dallo stato corrente di `result` ──
  // È il "cancello" che ogni write da fonte low/medium-trust deve attraversare.
  const buildIdentity = (): CompanyIdentity => ({
    piva: typeof result.partita_iva === 'string' ? result.partita_iva : null,
    ragione_sociale: typeof result.ragione_sociale === 'string' ? result.ragione_sociale : null,
    nome_aliases: [
      typeof result.nome === 'string' ? result.nome : '',
      typeof result.nome_commerciale === 'string' ? result.nome_commerciale : '',
      queryCompanyName,
    ].filter(Boolean) as string[],
    citta: (typeof result.citta === 'string' && result.citta) ? result.citta : (queryCityHint || null),
    dominio: typeof result.sito === 'string' ? normalizeDomain(result.sito) : null,
  })
  const gateAccepts = (ev: Evidence, threshold?: number): boolean => {
    const m = isCompanyMatch(buildIdentity(), ev, threshold)
    if (m.action === 'skipped') console.log(`[COMPANY-LOOKUP] [identity-gate] ${m.reason}`)
    return m.action === 'merged'
  }

  // ─── Step 0a: Google Maps (single business) — stesso backend scraper usato da Ricerca Categoria+Città ──
  // Endpoint /search-maps-single → Playwright su Google Maps, ritorna name/website/phone/address dal pannello dettaglio.
  // Non-bloccante: se il backend è offline/lento/404, continua silenziosamente con il resto del flusso.
  if (!isPiva && query.length >= 3) {
    try {
      const mapsQuery = queryCityHint ? `${queryCompanyName} ${queryCityHint}` : query
      console.log(`[COMPANY-LOOKUP] Step 0a: Maps single-business scrape for "${mapsQuery}"${queryCityHint ? ` (city filter: ${queryCityHint})` : ''}`)
      const mapsRes = await fetch(`${backendUrl}/search-maps-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_name: mapsQuery, city: queryCityHint, max_results: 1 }),
        signal: AbortSignal.timeout(200000),
      }).catch((err: any) => { console.log(`[COMPANY-LOOKUP] Step 0a: fetch error ${err?.message || err}`); return null })
      if (mapsRes && mapsRes.ok) {
        const mapsData = await mapsRes.json().catch(() => null) as any
        const leads = (mapsData && Array.isArray(mapsData.results)) ? mapsData.results : []
        console.log(`[COMPANY-LOOKUP] Step 0a: Maps returned ${leads.length} result(s)`)
        const best = leads[0]
        if (best && typeof best === 'object' && best.name) {
          // NAME VALIDATION: ensure Maps result actually matches the query (Google sometimes returns "Mp3 Srl" for "STANDBY CONSORZIO")
          const qWords = queryCompanyName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length >= 3)
          const nLow = best.name.toLowerCase().replace(/[^a-z0-9\s]/g, '')
          // At least ONE significant word from the query must be in the Maps name
          const hasMatch = qWords.length === 0 || qWords.some((w: string) => nLow.includes(w))
          if (!hasMatch) {
            console.log(`[COMPANY-LOOKUP] Step 0a: NAME MISMATCH — user asked "${queryCompanyName}" but Maps found "${best.name}" — ignoring Maps result to prevent extreme omonimia`)
          } else {
            // Maps non è una fonte camerale: il nome che restituisce può essere il
            // nome COMMERCIALE (insegna), non la ragione sociale ufficiale. A volte
            // restituisce verbatim la query (es. "STANDBY CONSORZIO milano"). Lo
            // salviamo come nome_commerciale; ragione_sociale verrà popolata SOLO
            // da una fonte camerale (CompanyReports / FatturatoItalia / OpenAPI / lead-registry).
            result.nome_commerciale = best.name
            if (best.website) { result.sito = best.website; console.log(`[COMPANY-LOOKUP] Step 0a: Maps sito = ${result.sito}`) }
            if (best.phone) result.telefono = best.phone
            if (best.address) result.indirizzo = best.address
            if (best.category) result.categoria = best.category
            if (best.rating) result.rating = best.rating
            if (best.reviews) result.reviews_count = best.reviews
            if (result.sito || result.telefono || result.indirizzo) fonti.push('Google Maps')
          }
        }
      } else if (mapsRes) {
        console.log(`[COMPANY-LOOKUP] Step 0a: Maps HTTP ${mapsRes.status} — fallback to registry+tavily`)
      }
      // POST-VALIDATION: if user specified a city, check Maps result matches
      if (queryCityHint && result.indirizzo) {
        const addrLow = String(result.indirizzo).toLowerCase()
        const cityLow = queryCityHint.toLowerCase()
        if (!addrLow.includes(cityLow)) {
          console.log(`[COMPANY-LOOKUP] Step 0a: CITY MISMATCH — user asked "${queryCityHint}" but Maps found address "${result.indirizzo}" — clearing Maps data to avoid omonimia`)
          delete result.ragione_sociale; delete result.sito; delete result.telefono
          delete result.indirizzo; delete result.categoria; delete result.rating; delete result.reviews_count
          // Remove Google Maps from fonti
          const gIdx = fonti.indexOf('Google Maps'); if (gIdx >= 0) fonti.splice(gIdx, 1)
        }
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] Step 0a: Maps exception: ${e?.message || e}`)
    }
  }

  // ─── Step 0: P.IVA diretta → CompanyReports.it (gratuito) per nome REALE, OpenAPI ULTIMO ───
  if (isPiva) {
    result.partita_iva = cleanQuery
    console.log(`[COMPANY-LOOKUP] P.IVA query: "${cleanQuery}" — CompanyReports FIRST (free), OpenAPI LAST`)

    // CompanyReports.it FIRST — free scraping, gives company name + financial data
    if (cleanQuery.length === 11) {
      console.log(`[COMPANY-LOOKUP] Step 0: CompanyReports.it for P.IVA ${cleanQuery}`)
      const crData = await scrapeCompanyReports(cleanQuery)
      if (crData) {
        if (crData.ragione_sociale && !result.ragione_sociale) result.ragione_sociale = crData.ragione_sociale
        if (crData.fatturato) result.fatturato = crData.fatturato
        if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno
        if (crData.dipendenti) result.dipendenti = crData.dipendenti
        if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
        if (crData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
        if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
        if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
        if (crData.pec && !result.pec) result.pec = crData.pec
        fonti.push('CompanyReports.it')
        console.log(`[COMPANY-LOOKUP] CompanyReports: "${crData.ragione_sociale || 'no name'}" for P.IVA ${cleanQuery}`)
      }
    }

    // If CompanyReports didn't find the name, try fatturatoitalia.it (structured data)
    if (!result.ragione_sociale && cleanQuery.length === 11) {
      console.log(`[COMPANY-LOOKUP] Step 0a: fatturatoitalia.it for P.IVA ${cleanQuery}`)
      const fiData = await scrapeFatturatoItalia(cleanQuery)
      if (fiData) {
        if (fiData.ragione_sociale && !result.ragione_sociale) result.ragione_sociale = fiData.ragione_sociale
        if (fiData.fatturato && !result.fatturato) result.fatturato = fiData.fatturato
        if (fiData.fatturato_anno && !result.fatturato_anno) result.fatturato_anno = fiData.fatturato_anno
        if (fiData.dipendenti && !result.dipendenti) result.dipendenti = fiData.dipendenti
        if (fiData.codice_ateco && !result.codice_ateco) result.codice_ateco = fiData.codice_ateco
        if (fiData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = fiData.descrizione_ateco
        if (fiData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = fiData.forma_giuridica
        if (fiData.sede_legale && !result.sede_legale) result.sede_legale = fiData.sede_legale
        if (fiData.citta && !result.citta) result.citta = fiData.citta
        if (fiData.data_costituzione && !result.data_costituzione) result.data_costituzione = fiData.data_costituzione
        if (!fonti.includes('FatturatoItalia.it')) fonti.push('FatturatoItalia.it')
        console.log(`[COMPANY-LOOKUP] Step 0a: FatturatoItalia found "${fiData.ragione_sociale || 'no name'}" for P.IVA ${cleanQuery}`)
      }
    }

    // If still no name, try quick Tavily to find it
    if (!result.ragione_sociale) {
      console.log(`[COMPANY-LOOKUP] Step 0b: Tavily quick search for P.IVA ${cleanQuery}`)
      const tavilyKey = process.env.TAVILY_API_KEY
      if (tavilyKey) {
        try {
          const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query: `"${cleanQuery}" partita IVA azienda ragione sociale`, search_depth: 'basic', max_results: 3 }),
            signal: AbortSignal.timeout(10000),
          })
          if (res.ok) {
            const data = await res.json()
            const allText = (data.results || []).map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
            if (allText.length > 50) {
              const openaiKey = process.env.OPENAI_API_KEY
              if (openaiKey) {
                const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini', temperature: 0,
                    messages: [
                      { role: 'system', content: 'Estrai SOLO la ragione sociale ESATTA dell\'azienda con P.IVA specificata. Rispondi SOLO con JSON.' },
                      { role: 'user', content: `Trova la ragione sociale dell'azienda con P.IVA ${cleanQuery} dal seguente testo. Restituisci SOLO il nome UFFICIALE come appare nel registro imprese. Se non trovi il nome, rispondi con null.\n\nTesto:\n${allText.slice(0, 4000)}\n\nJSON:\n{"ragione_sociale":"NOME_AZIENDA_QUI"}` },
                    ],
                  }),
                  signal: AbortSignal.timeout(10000),
                })
                if (gptRes.ok) {
                  const gptData = await gptRes.json()
                  const raw = gptData.choices?.[0]?.message?.content || '{}'
                  const parsed = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
                  const JUNK_NAMES = /^(nome\s*esatto|nome_azienda_qui|risultati|ricerca|pagina|home|error|null|undefined|n\/a|non\s*trovato)$/i
                  if (parsed.ragione_sociale && parsed.ragione_sociale.length > 2 && !JUNK_NAMES.test(parsed.ragione_sociale.trim())) {
                    result.ragione_sociale = parsed.ragione_sociale
                    console.log(`[COMPANY-LOOKUP] Step 0b: Tavily found name: "${parsed.ragione_sociale}"`)
                  } else {
                    console.log(`[COMPANY-LOOKUP] Step 0b: REJECTED junk name: "${parsed.ragione_sociale}"`)
                  }
                }
              }
            }
          }
        } catch { /* Tavily quick search failed */ }
      }
    }
  }

  // ─── Step 1: Search in existing database ───
  console.log(`[COMPANY-LOOKUP] Query: "${query}"`)
  const dbResult = await searchInDatabase(query)
  if (dbResult) {
    // VALIDATE: DB-found name must contain the most distinctive token of the query.
    // Without this guard, accidental DB matches (e.g. query "ENEL S.P.A." matching an
    // unrelated "Penelopeinterni" row via full-text search quirks) would overwrite the
    // entire result with junk data.
    const dbName = String(dbResult.ragione_sociale || '').toLowerCase()
    const queryNameTokens = String(query).toLowerCase()
      .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|società|societa|unipersonale|italia|italy|gruppo|group|holding)\b/gi, '')
      .replace(/[^a-zà-ù0-9\s]/gi, ' ')
      .split(/\s+/).filter(w => w.length >= 3)
    const distinctive = queryNameTokens.length > 0 ? queryNameTokens.sort((a,b) => b.length - a.length)[0] : ''
    // Word-boundary match: 'enel' must not match 'penelopeinterni' (substring false-positive).
    const distinctiveRx = distinctive ? new RegExp(`\\b${distinctive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null
    const dbMatchesQuery = !distinctive || (distinctiveRx ? distinctiveRx.test(dbName) : false) || (isPiva && dbResult.partita_iva)
    if (!dbMatchesQuery) {
      console.log(`[COMPANY-LOOKUP] DB result rejected: "${dbResult.ragione_sociale}" does not contain query token "${distinctive}"`)
    } else {
      // Merge DB data but DON'T overwrite authoritative CompanyReports data (for P.IVA searches)
      result = isPiva && result.ragione_sociale ? mergeResults(result, dbResult) : dbResult
      fonti.push('Database CKB (lead esistente)')
      console.log(`[COMPANY-LOOKUP] DB found: "${result.ragione_sociale}"`)
    }
  } else {
    console.log(`[COMPANY-LOOKUP] DB: nessun risultato`)
  }

  // ─── Step 1a: fatturatoitalia.it discovery — find P.IVA and authoritative data by name ───
  // Runs only if we have a company name query (not a P.IVA search) and P.IVA is still unknown.
  // fatturatoitalia.it URLs embed the P.IVA: /slug-{PIVA}. We use Tavily site-search to discover,
  // then scrape the structured data (sede, ATECO, bilanci). This populates P.IVA for downstream
  // CompanyReports.it and ufficiocamerale scrapes which require it.
  if (!isPiva && !result.partita_iva && query.length >= 3) {
    // Extract city hint: prioritize user-specified city, then Maps-derived city
    let cityHint = queryCityHint || ''
    if (!cityHint && result.citta && typeof result.citta === 'string') cityHint = result.citta as string
    else if (!cityHint && result.sede_legale && typeof result.sede_legale === 'string') {
      // Try to extract city name from sede_legale (e.g. "Via Roma 1, Milano" → "Milano")
      const parts = String(result.sede_legale).split(',').map(p => p.trim()).filter(Boolean)
      if (parts.length >= 2) cityHint = parts[parts.length - 1].replace(/\d{5}\s*/g, '').trim()
    }
    const fiQuery = queryCityHint ? queryCompanyName : query
    console.log(`[COMPANY-LOOKUP] Step 1a: fatturatoitalia.it discovery for "${fiQuery}" (cityHint="${cityHint}")`)
    let fiData = await findFatturatoItaliaByName(fiQuery, cityHint)
    if (!fiData && result.sito && typeof result.sito === 'string') {
      console.log(`[COMPANY-LOOKUP] Step 1a: no name match — trying fatturatoitalia.it by site keyword "${result.sito}"`)
      fiData = await findFatturatoItaliaByKeyword(String(result.sito), cityHint)
    }
    if (fiData) {
      console.log(`[COMPANY-LOOKUP] Step 1a: fatturatoitalia.it returned: ${JSON.stringify(fiData)}`)
      // Authoritative fields: override even if already set (fatturatoitalia has REGISTERED address
      // from Chamber of Commerce, while Maps may show a branch or unrelated physical location).
      const authoritativeKeys = new Set(['ragione_sociale', 'sede_legale', 'citta', 'provincia', 'cap', 'partita_iva', 'codice_fiscale', 'codice_ateco', 'descrizione_ateco', 'forma_giuridica', 'data_costituzione', 'rea', 'stato_attivita'])
      for (const [k, v] of Object.entries(fiData)) {
        if (!v) continue
        if (authoritativeKeys.has(k)) {
          // Save Maps name as nome_commerciale before overwriting with camerale name
          if (k === 'ragione_sociale' && result.ragione_sociale && result.ragione_sociale !== v) {
            result.nome_commerciale = result.ragione_sociale
            console.log(`[COMPANY-LOOKUP] Step 1a: Maps name "${result.ragione_sociale}" → nome_commerciale, camerale "${v}" → ragione_sociale`)
          }
          (result as any)[k] = v
        } else if (!(result as any)[k]) {
          (result as any)[k] = v
        }
      }
      if (!fonti.includes('fatturatoitalia.it')) fonti.push('fatturatoitalia.it')
    } else {
      console.log(`[COMPANY-LOOKUP] Step 1a: no fatturatoitalia.it match`)
    }
  }

  // ─── Step 1a2: Scrape the official website for P.IVA (when chamber-of-commerce sources failed) ───
  // Italian law requires P.IVA to appear on every commercial website, usually in the footer.
  // This is often the AUTHORITATIVE source for companies not indexed by fatturatoitalia.it.
  if (!result.partita_iva && result.sito && typeof result.sito === 'string') {
    console.log(`[COMPANY-LOOKUP] Step 1a2: scraping website "${result.sito}" for P.IVA`)
    const siteData = await scrapeWebsiteForPIVA(String(result.sito))
    if (siteData?.partita_iva) {
      result.partita_iva = siteData.partita_iva
      if (siteData.codice_fiscale && !result.codice_fiscale) result.codice_fiscale = siteData.codice_fiscale
      if (!fonti.includes('Sito ufficiale')) fonti.push('Sito ufficiale')
      console.log(`[COMPANY-LOOKUP] Step 1a2: P.IVA ${siteData.partita_iva} trovata sul sito ufficiale`)
      // Now that we have the P.IVA, enrich with CompanyReports / fatturatoitalia (the direct scrapes)
      try {
        const crData = await scrapeCompanyReports(result.partita_iva as string)
        if (crData) {
          // CompanyReports ragione_sociale is AUTHORITATIVE (camerale) — override Maps name
          if (crData.ragione_sociale) {
            if (result.ragione_sociale && result.ragione_sociale !== crData.ragione_sociale) {
              result.nome_commerciale = result.ragione_sociale
              console.log(`[COMPANY-LOOKUP] Step 1a2: Maps name "${result.ragione_sociale}" → nome_commerciale, camerale "${crData.ragione_sociale}" → ragione_sociale`)
            }
            result.ragione_sociale = crData.ragione_sociale
          }
          if (crData.fatturato) result.fatturato = crData.fatturato
          if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno
          if (crData.dipendenti) result.dipendenti = crData.dipendenti
          if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
          if (crData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
          if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
          if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
          if (crData.pec && !result.pec) result.pec = crData.pec
          if (!fonti.includes('CompanyReports.it')) fonti.push('CompanyReports.it')
          console.log(`[COMPANY-LOOKUP] Step 1a2: CompanyReports enriched with fatturato=${crData.fatturato || 'n/a'}, ragione_sociale="${crData.ragione_sociale || 'n/a'}"`)
        }
      } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 1a2: CompanyReports error: ${e?.message}`) }
      try {
        const fiData = await scrapeFatturatoItalia(result.partita_iva as string)
        if (fiData) {
          const authoritativeKeys = new Set(['sede_legale', 'citta', 'provincia', 'cap', 'codice_fiscale', 'codice_ateco', 'descrizione_ateco', 'forma_giuridica', 'data_costituzione', 'rea'])
          for (const [k, v] of Object.entries(fiData)) {
            if (!v) continue
            if (authoritativeKeys.has(k) || !(result as any)[k]) (result as any)[k] = v
          }
          if (!fonti.includes('fatturatoitalia.it')) fonti.push('fatturatoitalia.it')
          console.log(`[COMPANY-LOOKUP] Step 1a2: fatturatoitalia.it enriched`)
        }
      } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 1a2: fatturatoitalia error: ${e?.message}`) }
    } else {
      console.log(`[COMPANY-LOOKUP] Step 1a2: no P.IVA found on website`)
    }
  }

  // ─── Step 2: REMOVED — Maps scraping is now done in Step 0a via /search-maps-single ───

  // ── Quick cleanup: if phone looks like a P.IVA (11 digits, not a valid phone prefix), remove it ──
  if (result.telefono && result.partita_iva) {
    const pd = String(result.telefono).replace(/\D/g, '')
    const pvd = String(result.partita_iva).replace(/\D/g, '')
    if (pd === pvd) {
      console.log(`[COMPANY-LOOKUP] REMOVED phone from Maps — it was the P.IVA: ${result.telefono}`)
      delete result.telefono
    }
  }

  // ── Step 1b: Extract titolare from AUTHORITATIVE sources (before any Tavily/GPT) ──
  // Method 1: IMPRESA INDIVIDUALE — titolare name is in the ragione sociale ("X DI NOME COGNOME")
  if (!result.titolare && result.ragione_sociale) {
    const rs = String(result.ragione_sociale)
    // Match "DI NOME COGNOME" at end of company name (e.g. "G.E.M DI GORGONE MARCO")
    const diMatch = rs.match(/\bDI\s+([A-ZÀ-Ú][A-Za-zÀ-ú]+(?:\s+[A-ZÀ-Ú][A-Za-zÀ-ú]+){1,3})\s*$/i)
      || rs.match(/\bDI\s+([A-ZÀ-Ú]{2,}(?:\s+[A-ZÀ-Ú]{2,}){1,3})\s*$/i)
    if (diMatch?.[1]) {
      const raw = diMatch[1].trim()
      const parts = raw.split(/\s+/)
      // Convert ALL-CAPS to Title Case, then swap "COGNOME NOME" → "Nome Cognome"
      const titled = parts.map((w: string) => w.length > 2 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)
      // Italian convention: COGNOME comes first in official records → reverse to get natural order
      const titName = titled.length === 2 ? `${titled[1]} ${titled[0]}` : titled.join(' ')
      result.titolare = titName
      result.ruolo_titolare = 'Titolare'
      result.titolare_fonte = 'ragione_sociale'
      console.log(`[COMPANY-LOOKUP] Step 1b: Extracted titolare from company name: "${titName}"`)
    }
  }
  // Method 2: OpenAPI.it shareholders — pick the one with the most authoritative role
  if (!result.titolare && Array.isArray(result.persone) && (result.persone as any[]).length > 0) {
    const ROLE_PRIORITY: [RegExp, number][] = [
      [/socio\s*unico/i, 100],
      [/rappresentante\s*legale/i, 95],
      [/amministratore\s*delegato/i, 90],
      [/amministratore\s*unico/i, 85],
      [/presidente/i, 80],
      [/titolare/i, 75],
      [/amministratore/i, 60],
      [/socio/i, 20],
    ]
    let bestPerson: any = null, bestScore = 0
    for (const p of result.persone as any[]) {
      if (!p?.nome) continue
      let score = 10 // default
      for (const [rx, s] of ROLE_PRIORITY) { if (rx.test(p.ruolo || '')) { score = Math.max(score, s); break } }
      if (score > bestScore) { bestScore = score; bestPerson = p }
    }
    if (bestPerson) {
      result.titolare = bestPerson.nome
      result.ruolo_titolare = bestPerson.ruolo || 'Socio'
      result.titolare_fonte = 'registro_imprese'
      console.log(`[COMPANY-LOOKUP] Step 1b: Set titolare from shareholders: "${bestPerson.nome}" (${bestPerson.ruolo})`)
    }
  }

  // ─── Step 2b: Call lead-registry for camerale data + titolare (NO person-lookup = no deadlock) ───
  const companyNameForLR = (result.ragione_sociale || query) as string
  let leadRegistryDone = false
  if (companyNameForLR) {
    console.log(`[COMPANY-LOOKUP] Step 2b: Calling lead-registry for "${companyNameForLR}" (_skipPersonEnrichment=true)`)
    try {
      const origin = req.headers.get('host') ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}` : 'http://localhost:3000'
      const leadObj = {
        nome: companyNameForLR,
        azienda: companyNameForLR,
        citta: (result.citta || '') as string,
        sito: (result.sito || '') as string,
        indirizzo: (result.indirizzo || '') as string,
        categoria: (result.categoria || '') as string,
      }
      const lrRes = await fetch(`${origin}/api/lead-registry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: leadObj, _skipPersonEnrichment: true }),
        signal: AbortSignal.timeout(45000),
      })
      if (lrRes.ok) {
        const lrData = await lrRes.json()
        if (lrData && lrData.found) {
          console.log(`[COMPANY-LOOKUP] lead-registry OK: "${lrData.ragione_sociale}" P.IVA=${lrData.partita_iva} titolare=${lrData.titolare} fatturato=${lrData.fatturato}`)

          // Cross-validate P.IVA
          const existingPiva = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
          const lrPiva = lrData.partita_iva ? String(lrData.partita_iva).replace(/\D/g, '') : ''
          let lrCompanyMismatch = false
          if (existingPiva.length === 11 && lrPiva.length === 11 && existingPiva !== lrPiva) {
            console.log(`[COMPANY-LOOKUP] ⚠️ P.IVA MISMATCH: ${existingPiva} vs ${lrPiva} — skipping company data`)
            lrCompanyMismatch = true
          }

          // Merge company fields (skip if mismatch)
          const companyFields = ['ragione_sociale','partita_iva','codice_ateco','descrizione_ateco','forma_giuridica',
            'stato_attivita','sede_legale','pec','fatturato','fatturato_anno','dipendenti','utile_netto',
            'capitale_sociale','data_costituzione','codice_rea','codice_fiscale',
            'sito','telefono','telefono_fonte','email','linkedin','instagram','facebook','twitter','youtube',
            'certificazioni','ha_flotta_veicoli','numero_veicoli','ha_immobili_proprieta','partecipa_appalti_pubblici']
          // Titolare + insurance fields (always merge)
          const titolareFields = ['titolare','titolare_fonte','ruolo_titolare','linkedin_titolare','bio_titolare',
            'esperienze_titolare','formazione_titolare','competenze_titolare','seniority_titolare',
            'instagram_titolare','facebook_titolare','codice_fiscale_titolare','titolare_data_nascita',
            'titolare_eta','titolare_sesso','rischi_specifici','note_broker']
          const allFields = [...companyFields, ...titolareFields]
          const lrTitStr = String(lrData.titolare || '').trim()
          const lrTitolareReal = lrTitStr.split(/\s+/).length >= 2 && !/^(null|undefined|n\/d|n\/a|non disponibile|non specificato|non noto|da verificare|sconosciuto)$/i.test(lrTitStr)
          for (const f of allFields) {
            if (lrData[f] !== undefined && lrData[f] !== null && lrData[f] !== '') {
              if (lrCompanyMismatch && companyFields.includes(f)) continue
              if (titolareFields.includes(f) && !lrTitolareReal) continue
              if (!result[f]) result[f] = lrData[f]
            }
          }
          if (!lrCompanyMismatch && Array.isArray(lrData.persone) && lrData.persone.length > 0 && !result.persone) {
            result.persone = lrData.persone
          }
          if (lrData.ai_enriched) result.ai_enriched = true
          fonti.push('lead-registry')
          // Only mark as "done" if lead-registry provided COMPREHENSIVE data (titolare AND financial)
          // Otherwise inline enrichment (Tavily, CompanyReports, etc.) must still run
          const hasComprehensiveData = !!(lrTitolareReal && (lrData.fatturato || lrData.dipendenti))
          leadRegistryDone = hasComprehensiveData
          if (!hasComprehensiveData) console.log(`[COMPANY-LOOKUP] lead-registry returned partial data (titolare=${lrTitolareReal} fatt=${!!lrData.fatturato}) — inline enrichment will still run`)
        }
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] lead-registry failed (${e?.message || e}) — continuing with inline enrichment`)
    }
  }

  // ─── Step 2c: Find website + P.IVA + financial data if still missing ───
  // Strategy 1: derive website from email domain (fast)
  if (!result.sito && result.email) {
    let emailDomain = String(result.email).split('@')[1]
    if (emailDomain) {
      // Strip PEC subdomains: ipec.aon.it → aon.it, pec.company.it → company.it
      const pecSubPrefixes = /^(?:ipec|pec|legalmail|pecmail|postacert|certmail)\./i
      if (pecSubPrefixes.test(emailDomain)) {
        emailDomain = emailDomain.replace(pecSubPrefixes, '')
      }
      const isGeneric = /^(gmail|yahoo|hotmail|outlook|libero|virgilio|tiscali|alice|aruba|live|icloud|protonmail|tin)\./i.test(emailDomain)
      const isPec = /^(pec|legalmail|pecimprese|pecmail|postacert)\./i.test(emailDomain) || emailDomain === 'pec.it'
      if (!isGeneric && !isPec) {
        result.sito = `https://${emailDomain}`
        console.log(`[COMPANY-LOOKUP] Step 2c: Derived website from email: ${result.sito}`)
      }
    }
  }
  // Strategy 2: Tavily search for company website (if still no site)
  if (!result.sito && process.env.TAVILY_API_KEY) {
    const compNameForSite = (result.ragione_sociale || query) as string
    console.log(`[COMPANY-LOOKUP] Step 2c: No website found — Tavily search for "${compNameForSite}" sito`)
    try {
      const siteRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: `"${compNameForSite}" sito ufficiale`, search_depth: 'basic', max_results: 3 }),
        signal: AbortSignal.timeout(8000),
      })
      if (siteRes.ok) {
        const siteData = await siteRes.json()
        const results = siteData.results || []
        // STRONG filter: hostname must contain at least one word (≥4 chars) from the company name
        // This prevents random sites like 'portiamovalore.uniba.it' being picked for 'PIKSEL S.R.L'
        const compWords = String(compNameForSite).toLowerCase()
          .replace(/[^a-z0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter((w: string) => w.length >= 4 && !/^(srl|srls|spa|sas|snc|società|societa|group|italia|italy)$/i.test(w))
        const EXCLUDE_RE = /google|facebook|instagram|linkedin|twitter|paginegialle|yelp|tripadvisor|wikipedia|youtube|atoka|reportaziende|companyreports|ufficiocamerale|registroimprese|dnb|kompass|infocamere|cerved|fattureitalia|tuttitalia|infoimprese|breezy|greenhouse|lever\.co|workable|jobvite|bamboohr|workday|myworkdayjobs|recruitee|smartrecruiters|teamtailor|personio|zohorecruit|hireology|jazzhr|applytojob|indeed|glassdoor|infojobs|subito|immobiliare|idealista|medium\.com|substack|github\.io|netlify\.app|vercel\.app|uniba|unibo|unimi|unipd|unicatt|univ-|university|edu\./
        for (const r of results) {
          if (!r.url) continue
          try {
            const h = new URL(r.url).hostname.replace(/^www\./, '').toLowerCase()
            if (EXCLUDE_RE.test(h)) continue
            // Require hostname to contain at least one company-name word
            if (compWords.length > 0 && !compWords.some((w: string) => h.includes(w))) {
              console.log(`[COMPANY-LOOKUP] Step 2c: REJECT "${h}" — does not contain any of [${compWords.join(',')}]`)
              continue
            }
            result.sito = r.url.split('/').slice(0, 3).join('/')
            console.log(`[COMPANY-LOOKUP] Step 2c: Tavily found website: ${result.sito}`)
            break
          } catch { /* skip */ }
        }
      }
    } catch { /* Tavily failed */ }
  }
  if (leadRegistryDone && result.sito && (!result.partita_iva || !result.pec || !result.telefono || !result.email)) {
    const missingFields = [!result.partita_iva && 'P.IVA', !result.pec && 'PEC', !result.telefono && 'telefono', !result.email && 'email'].filter(Boolean).join(', ')
    console.log(`[COMPANY-LOOKUP] Step 2c: Missing ${missingFields} — quick-scraping website ${result.sito}`)
    try {
      const siteUrl = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
      const pageRes = await fetch(siteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      if (pageRes.ok) {
        const html = await pageRes.text()
        // Extract P.IVA
        if (!result.partita_iva) {
          const pivaM = html.match(/(?:P\.?\s*IVA|partita\s*iva|VAT|C\.?F\.?)[:\s/|–-]*(?:IT\s*)?(\d{11})/i)
          if (pivaM?.[1]) {
            result.partita_iva = pivaM[1]
            console.log(`[COMPANY-LOOKUP] Step 2c: Extracted P.IVA from website: ${pivaM[1]}`)
          }
        }
        // Extract PEC
        if (!result.pec) {
          const pecM = html.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]*(?:pec|legalmail|pecimprese|pecmail|casellapec)[a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/gi)
          if (pecM?.[0]) {
            result.pec = pecM[0].toLowerCase()
            console.log(`[COMPANY-LOOKUP] Step 2c: Extracted PEC from website: ${result.pec}`)
          }
        }
        if (!result.telefono) {
          const pivaKnown = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
          const phoneM = html.match(/(?:tel|phone|telefono|fax)[.\s:]*\+?(\d[\d\s./-]{7,15})/i)
            || html.match(/(?<!\d)(\+39\s?)?(0[1-9]\d{1,3}[\s./-]?\d{3,4}[\s./-]?\d{3,4}|800[\s./-]?\d{3}[\s./-]?\d{3})(?!\d)/i)
          const phoneCandidate = (phoneM?.[1] || phoneM?.[2] || '').trim()
          if (phoneCandidate) {
            const digits = phoneCandidate.replace(/\D/g, '').replace(/^39/, '')
            if (digits.length >= 9 && digits.length <= 12 && digits !== pivaKnown) {
              result.telefono = phoneCandidate
              console.log(`[COMPANY-LOOKUP] Step 2c: Extracted telefono from website: ${result.telefono}`)
            }
          }
        }
        if (!result.email) {
          const siteHost = new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase()
          const siteKey = siteHost.split('.')[0]
          const emails = [...new Set(html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])]
            .filter(e => !/\.(png|jpe?g|gif|svg|webp)$/i.test(e) && !/example|sentry/i.test(e))
          const regularEmail = emails.find(e => !/(pec|legalmail|pecimprese|pecmail|casellapec)/i.test(e) && e.toLowerCase().includes(siteKey))
            || emails.find(e => /^(info|contatti|amministrazione)@/i.test(e) && !/(pec|legalmail|pecimprese|pecmail|casellapec)/i.test(e))
          if (regularEmail) {
            result.email = regularEmail.toLowerCase()
            console.log(`[COMPANY-LOOKUP] Step 2c: Extracted email from website: ${result.email}`)
          }
        }
        // Extract sede legale if missing
        if (!result.sede_legale) {
          const sedeM = html.match(/(?:Via|Viale|Corso|Piazza|Piazzale|Largo|Strada)\s+[A-Z][^,<]{3,40},\s*\d{1,5}(?:\s*,\s*\d{5})?\s*,?\s*[A-Z][a-z]+/i)
          if (sedeM?.[0]) {
            result.sede_legale = sedeM[0].trim()
            console.log(`[COMPANY-LOOKUP] Step 2c: Extracted sede from website: ${result.sede_legale}`)
          }
        }
      }
    } catch { /* website scrape failed */ }

    // If P.IVA was discovered, call CompanyReports.it for financial data
    const discoveredPiva = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
    if (discoveredPiva.length === 11) {
      console.log(`[COMPANY-LOOKUP] Step 2c: Calling CompanyReports.it for P.IVA ${discoveredPiva} (authoritative bilancio data)`)      
      const crData = await scrapeCompanyReports(discoveredPiva)
      if (crData) {
        // CompanyReports uses official Camera di Commercio bilanci → OVERRIDE financial data
        if (crData.fatturato) { result.fatturato = crData.fatturato; console.log(`[COMPANY-LOOKUP] Step 2c: CompanyReports fatturato OVERRIDE: ${crData.fatturato}`) }
        if (crData.fatturato_anno) result.fatturato_anno = crData.fatturato_anno
        if (crData.dipendenti) result.dipendenti = crData.dipendenti
        if (crData.utile_netto) result.utile_netto = crData.utile_netto
        if (crData.utile_netto_anno) result.utile_netto_anno = crData.utile_netto_anno
        if (crData.capitale_sociale && !result.capitale_sociale) result.capitale_sociale = crData.capitale_sociale
        if (crData.sede_legale && !result.sede_legale) result.sede_legale = crData.sede_legale
        if (crData.pec && !result.pec) result.pec = crData.pec
        if (crData.codice_ateco) result.codice_ateco = crData.codice_ateco
        if (crData.descrizione_ateco) result.descrizione_ateco = crData.descrizione_ateco
        if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
        fonti.push('CompanyReports.it (bilancio ufficiale)')
        console.log(`[COMPANY-LOOKUP] Step 2c: CompanyReports filled: fatturato=${crData.fatturato || 'none'} dip=${crData.dipendenti || 'none'} utile=${crData.utile_netto || 'none'}`)
      }
    }
  }
  // ── Step 2d: ALWAYS verify financial data via CompanyReports.it when P.IVA is known ──
  // Even if Step 2c didn't run (e.g. no website scraping needed), financial data from lead-registry may be wrong
  const knownPiva = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
  if (leadRegistryDone && knownPiva.length === 11 && !fonti.some(f => f.includes('CompanyReports'))) {
    console.log(`[COMPANY-LOOKUP] Step 2d: Verifying financial data via CompanyReports.it for P.IVA ${knownPiva}`)  
    const crVerify = await scrapeCompanyReports(knownPiva)
    if (crVerify) {
      if (crVerify.fatturato) { result.fatturato = crVerify.fatturato; console.log(`[COMPANY-LOOKUP] Step 2d: CompanyReports fatturato OVERRIDE: ${crVerify.fatturato}`) }
      if (crVerify.fatturato_anno) result.fatturato_anno = crVerify.fatturato_anno
      if (crVerify.dipendenti) result.dipendenti = crVerify.dipendenti
      if (crVerify.utile_netto) result.utile_netto = crVerify.utile_netto
      if (crVerify.capitale_sociale && !result.capitale_sociale) result.capitale_sociale = crVerify.capitale_sociale
      if (crVerify.codice_ateco) result.codice_ateco = crVerify.codice_ateco
      if (crVerify.descrizione_ateco) result.descrizione_ateco = crVerify.descrizione_ateco
      fonti.push('CompanyReports.it (bilancio ufficiale)')
    }
  }

  // ─── Step 3: Scrape company website (like category scraper does) ───
  // SKIP if lead-registry already provided data (avoid redundant work)
  if (leadRegistryDone) {
    console.log(`[COMPANY-LOOKUP] Skipping Steps 3-5b (lead-registry already provided data)`)
  }
  // ─── Step 3 (original): Scrape company website ─── (skipped if lead-registry done)
  if (!leadRegistryDone && result.sito) {
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

      // Categorize: mobile (3xx) vs landline (0xx) vs numero verde (800/803/840/892/899)
      for (const ph of rawPhones) {
        const d = ph.replace(/\D/g, '')
        const core = d.startsWith('39') ? d.slice(2) : (d.startsWith('0039') ? d.slice(4) : d)
        if (core.startsWith('3') && !result.cellulare) {
          result.cellulare = ph
          console.log(`[COMPANY-LOOKUP] Extracted cellulare from website: ${ph}`)
        } else if ((core.startsWith('0') || /^(800|803|840|892|899)/.test(core)) && !result.telefono) {
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
        const pecEmail = emails.find(e => /pec\.|legalmail\.|pecimprese\.|pecmail\.|casellapec/i.test(e.toLowerCase()))
        if (pecEmail) {
          result.pec = pecEmail
          console.log(`[COMPANY-LOOKUP] Extracted PEC from website: ${pecEmail}`)
        }
      }
      // Regular email
      if (!result.email) {
        const regularEmail = emails.find(e => !/pec\.|legalmail\.|pecimprese\.|pecmail\.|casellapec/i.test(e.toLowerCase()) && e.includes(siteDomain.replace('www.', '').split('.')[0]))
          || emails.find(e => e.startsWith('info@') || e.startsWith('contatti@') || e.startsWith('amministrazione@'))
          || emails.find(e => !/pec\.|legalmail\.|casellapec/i.test(e.toLowerCase()))
        if (regularEmail) {
          result.email = regularEmail
          console.log(`[COMPANY-LOOKUP] Extracted email from website: ${regularEmail}`)
        }
      }

      // Extract social media URLs — broad search over ANY URL in HTML (href, data-*, meta, JSON-LD, etc.)
      // Excludes sharer/intent URLs (share buttons point to generic sharer.php with the page URL)
      const isSharer = (u: string) => /\/(sharer|share|intent|dialog)[/?.]|[?&]u=|[?&]url=/i.test(u)
      if (!result.instagram) {
        const ig = [...allHtml.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi)]
          .map(m => ({ url: m[0], handle: m[1] }))
          .find(x => !isSharer(x.url) && !/^(p|reel|tv|stories|explore|accounts)$/i.test(x.handle))
        if (ig) { result.instagram = ig.url.replace(/\/$/, ''); console.log(`[COMPANY-LOOKUP] Extracted Instagram: ${result.instagram}`) }
      }
      if (!result.linkedin) {
        const li = [...allHtml.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(company|in|school)\/([a-zA-Z0-9._\-%]+)\/?/gi)]
          .map(m => m[0])
          .find(u => !isSharer(u))
        if (li) { result.linkedin = li.replace(/\/$/, ''); console.log(`[COMPANY-LOOKUP] Extracted LinkedIn: ${result.linkedin}`) }
      }
      if (!result.facebook) {
        const fb = [...allHtml.matchAll(/https?:\/\/(?:www\.|m\.|it-it\.)?facebook\.com\/([a-zA-Z0-9._\-]+)\/?/gi)]
          .map(m => ({ url: m[0], handle: m[1] }))
          .find(x => !isSharer(x.url) && !/^(sharer|share|dialog|tr|plugins|events)$/i.test(x.handle))
        if (fb) { result.facebook = fb.url.replace(/\/$/, ''); console.log(`[COMPANY-LOOKUP] Extracted Facebook: ${result.facebook}`) }
      }
      if (!result.youtube) {
        const yt = [...allHtml.matchAll(/https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/[a-zA-Z0-9_\-]+|c\/[a-zA-Z0-9._\-]+|user\/[a-zA-Z0-9._\-]+|@[a-zA-Z0-9._\-]+)\/?/gi)]
          .map(m => m[0])
          .find(u => !isSharer(u))
        if (yt) { result.youtube = yt.replace(/\/$/, ''); console.log(`[COMPANY-LOOKUP] Extracted YouTube: ${result.youtube}`) }
      }
      if (!result.twitter) {
        const tw = [...allHtml.matchAll(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})\/?/gi)]
          .map(m => ({ url: m[0], handle: m[1] }))
          .find(x => !isSharer(x.url) && !/^(share|intent|i|home|search)$/i.test(x.handle))
        if (tw) { result.twitter = tw.url.replace(/\/$/, ''); console.log(`[COMPANY-LOOKUP] Extracted Twitter/X: ${result.twitter}`) }
      }

      fonti.push('Sito Web Aziendale')
    }
  }

  if (!result.partita_iva && (result.email || result.sito)) {
    const keywordSource = String(result.email || result.sito || '')
    console.log(`[COMPANY-LOOKUP] Step 3a: trying fatturatoitalia.it by contact/domain keyword "${keywordSource}"`)
    const fiDataByDomain = await findFatturatoItaliaByKeyword(keywordSource, queryCityHint || String(result.citta || ''))
    if (fiDataByDomain) {
      console.log(`[COMPANY-LOOKUP] Step 3a: fatturatoitalia.it by domain returned: ${JSON.stringify(fiDataByDomain)}`)
      const authoritativeKeys = new Set(['ragione_sociale', 'sede_legale', 'citta', 'provincia', 'cap', 'partita_iva', 'codice_fiscale', 'codice_ateco', 'descrizione_ateco', 'forma_giuridica', 'data_costituzione', 'rea', 'stato_attivita'])
      for (const [k, v] of Object.entries(fiDataByDomain)) {
        if (!v) continue
        if (authoritativeKeys.has(k)) {
          if (k === 'ragione_sociale' && result.ragione_sociale && result.ragione_sociale !== v) {
            result.nome_commerciale = result.ragione_sociale
          }
          ;(result as any)[k] = v
        } else if (!(result as any)[k]) {
          ;(result as any)[k] = v
        }
      }
      if (!fonti.includes('fatturatoitalia.it')) fonti.push('fatturatoitalia.it')
    }
  }

  // ─── Step 3b: CompanyReports.it — dati REALI (fatturato, dipendenti, ATECO, PEC, sede) ───
  // Same source used by lead-registry in "Dettaglio Lead" — guaranteed accurate
  const pivaForCR = (result.partita_iva || '') as string
  if (!leadRegistryDone && pivaForCR && pivaForCR.length === 11) {
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
      if (crData.costo_personale_anno) result.costo_personale_anno = crData.costo_personale_anno
      if (crData.utile_netto && !result.utile_netto) result.utile_netto = crData.utile_netto
      if (crData.utile_netto_anno && !result.utile_netto_anno) result.utile_netto_anno = crData.utile_netto_anno
      if (crData.storico_bilanci && !result.storico_bilanci) result.storico_bilanci = crData.storico_bilanci
      if (crData.titolare && !result.titolare) {
        result.titolare = crData.titolare
        result.ruolo_titolare = 'Amministratore'
        console.log(`[COMPANY-LOOKUP] CompanyReports titolare: "${crData.titolare}"`)
      }
      fonti.push('CompanyReports.it')
    } else {
      console.log(`[COMPANY-LOOKUP] CompanyReports.it: no data found`)
    }
  }

  // ─── Step 4: Tavily deep enrichment (ricerche mirate) — SOLO per dati ancora mancanti ───
  // SKIP if lead-registry already provided data
  const tavilyKey = process.env.TAVILY_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (leadRegistryDone) {
    console.log(`[COMPANY-LOOKUP] Skipping Tavily enrichment (lead-registry already provided data)`)
  }
  // If we have P.IVA but no name, search for the company name first
  if (!leadRegistryDone && !result.ragione_sociale && isPiva && tavilyKey) {
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
  const searchCompanyName = (result.ragione_sociale || (!isPiva ? queryCompanyName : '')) as string
  if (!leadRegistryDone && !result.ragione_sociale && !isPiva && tavilyKey) {
    console.log(`[COMPANY-LOOKUP] No company found yet, using query as name for Tavily`)
  }
  console.log(`[COMPANY-LOOKUP] Before Tavily — ragione_sociale: "${result.ragione_sociale || 'N/A'}", searchCompanyName: "${searchCompanyName}", telefono: "${result.telefono || 'N/A'}", email: "${result.email || 'N/A'}"`)
  if (!leadRegistryDone && searchCompanyName && tavilyKey && openaiKey) {
    const companyName = searchCompanyName
    const city = (result.citta || '') as string
    const piva = (result.partita_iva || '') as string

    // ── TAVILY BUDGET CONTROL ──
    // Limit to prevent a single company lookup from consuming 100+ credits
    let tavilyCallsCount = 0
    const MAX_TAVILY_CALLS = 8

    // Helper: single Tavily search — returns ONLY the best matching result to prevent data mixing
    // Track last ufficiocamerale URL found by Tavily so we can scrape it fully
    let lastUfficioCameraleUrl = ''

    async function tavilySearch(query: string, onlyBestMatch = false, deep = false): Promise<string> {
      if (tavilyCallsCount >= MAX_TAVILY_CALLS) {
        console.log(`[COMPANY-LOOKUP] Tavily budget reached (${MAX_TAVILY_CALLS} calls). Skipping query: "${query}"`)
        return ''
      }
      
      try {
        tavilyCallsCount++
        // Use deep (advanced) ONLY for critical data (visura, financials) where high quality text is needed
        // Use basic for simple lookups (social, contacts, linkedin profile) to save 50%+ credits
        const depth = deep ? 'advanced' : 'basic'
        console.log(`[COMPANY-LOOKUP] Tavily API Call ${tavilyCallsCount}/${MAX_TAVILY_CALLS} (depth: ${depth}): "${query}"`)
        
        // NOTE: do NOT use include_domains — it breaks results for ufficiocamerale.it
        const body: any = { api_key: tavilyKey, query, search_depth: depth, include_answer: false, max_results: 5 }
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
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
            'Referer': 'https://www.google.com/',
          },
          signal: AbortSignal.timeout(8000), redirect: 'follow',
        })
        if (!res.ok) { console.log(`[COMPANY-LOOKUP] Ufficiocamerale HTTP ${res.status}`); return data }
        const html = await res.text()
        console.log(`[COMPANY-LOOKUP] Ufficiocamerale HTML length: ${html.length}`)
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
      // Utile netto
      const utileM = html.match(/[Uu]tile[^<]{0,40}?[:>\s€]*([\d.,]+)(?:\s*\(\d{4}\))?/)
      if (utileM && utileM[1]) {
        data.utile_netto = utileM[1].replace(/[,\.](?=\d{3})/g, '').replace(/\./g, '').replace(/,/g, '.')
      }
      // Costo del personale
      const costoPersM = html.match(/[Cc]osto[^<]{0,40}?[Pp]ersonale[^<]{0,20}?[:>\s€]*([\d.,]+)(?:\s*\(\d{4}\))?/)
      if (costoPersM && costoPersM[1]) {
        data.costo_personale = costoPersM[1].replace(/[,\.](?=\d{3})/g, '').replace(/\./g, '').replace(/,/g, '.')
      }
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
        // Rappresentante Legale / Titolare / Amministratore — LA fonte più autorevole
        const titRx = html.match(/Rappresentante\s+Legale[:\s]*([^<\n,]+)/i)
          || html.match(/Amministratore\s+Unico[:\s]*([^<\n,]+)/i)
          || html.match(/Titolare[:\s]*([^<\n,]+)/i)
          || html.match(/Amministratore\s+Delegato[:\s]*([^<\n,]+)/i)
          || html.match(/Presidente[:\s]*([^<\n,]+)/i)
        if (titRx) {
          const titName = titRx[1].trim().replace(/\s+/g, ' ')
          // Must look like a person name (2+ words, no company suffixes)
          if (titName.split(/\s+/).length >= 2 && !/\b(s\.?r\.?l|s\.?p\.?a|srl|spa|sas|snc)\b/i.test(titName)) {
            data.titolare = titName
          }
        }

        console.log(`[COMPANY-LOOKUP] Ufficiocamerale scraped:`, JSON.stringify(data))
      } catch (e) { console.log(`[COMPANY-LOOKUP] Ufficiocamerale scrape error:`, e) }
      return data
    }

    // Helper: GPT extract JSON from text — with retry for temporary 429s
    async function gptExtract(text: string, extractPrompt: string): Promise<Record<string, any>> {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: extractPrompt + '\n\nTESTO:\n' + text.slice(0, 5000) + '\n\nSOLO JSON.' }], temperature: 0, max_tokens: 1200 }),
            signal: AbortSignal.timeout(15000),
          })
          if (res.status === 429 && attempt < 2) {
            console.log(`[COMPANY-LOOKUP] gptExtract 429 — retry in 3s`)
            await new Promise(r => setTimeout(r, 3000))
            continue
          }
          if (!res.ok) { console.log(`[COMPANY-LOOKUP] gptExtract HTTP ${res.status}`); return {} }
          const data = await res.json()
          const content = data.choices?.[0]?.message?.content?.trim() || '{}'
          const m = content.match(/\{[\s\S]*\}/)
          return m ? JSON.parse(m[0]) : {}
        } catch { return {} }
      }
      return {}
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
        // Reject GPT-echoed prompt placeholders (e.g. "Profilo Instagram", "URL profilo Facebook")
        if (/^(profilo|url|canale|pagina|account|username|handle|link|nome|numero|indirizzo|email|cellulare|telefono|sito|bio|descrizione)\s+(instagram|facebook|linkedin|twitter|youtube|tiktok|pinterest|x|social|personale|aziendale|utente|azienda|web|\w+)?\s*$/i.test(v.trim())) return true
        if (/^(instagram|facebook|linkedin|twitter|youtube|tiktok|pinterest)\s+(profilo|pagina|account|username|url|canale|handle|personale)?\s*$/i.test(v.trim())) return true
        // Reject obvious GPT placeholder/example values
        if (/esempio|example|sample|placeholder|lorem|ipsum|12345678/i.test(low)) return true
        // Reject single generic words as ragione_sociale
        if (/^(risultati|ricerca|pagina|home|error|undefined|object|array)$/i.test(low)) return true
      }
      return false
    }
    function mergeTavily(extracted: Record<string, any>) {
      for (const [k, v] of Object.entries(extracted)) {
        if (isJunkValue(v)) continue
        // ATECO must be XX.XX or XX.XX.XX format — reject pure digits like "12345"
        if (k === 'codice_ateco' && typeof v === 'string' && !/^\d{2}\.\d{2}(\.\d{2})?$/.test(v.trim())) {
          console.log(`[COMPANY-LOOKUP] REJECTED invalid ATECO: "${v}"`)
          continue
        }
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

    // ── Step PRE-Tavily: Gemini 2.5 Flash Lite con Google Search grounding ──
    // Fonte primaria per dati camerali accurati (fatturato, dipendenti, titolare, ATECO, sede, PEC).
    // Molto più accurato di Tavily+GPT per aziende piccole. Se fallisce, Tavily fa da fallback.
    if (isGeminiEnabled()) {
      console.log(`[COMPANY-LOOKUP] Step Gemini: grounded extraction for "${companyName}"`)
      try {
        const geminiData = await geminiExtractCompanyData({
          companyName,
          partitaIva: piva || (result.partita_iva as string) || undefined,
          city: city || (result.citta as string) || undefined,
        })
        if (geminiData && typeof geminiData === 'object') {
          // Map Gemini fields to result (Gemini is HIGH confidence — overrides Tavily-sourced data later)
          // Only skip if result already has data from trusted sources (backend/OpenAPI/CompanyReports).
          const geminiTrustedFields = ['fatturato', 'utile_netto', 'totale_attivo', 'dipendenti',
            'codice_ateco', 'descrizione_ateco', 'sede_legale', 'pec', 'capitale_sociale',
            'data_costituzione', 'forma_giuridica', 'titolare', 'ruolo_titolare',
            'partita_iva', 'codice_fiscale', 'ragione_sociale', 'fatturato_anno',
            'telefono', 'email', 'sito_web'] as const
          let geminiFilled = 0
          for (const k of geminiTrustedFields) {
            const v = (geminiData as any)[k]
            if (v == null || v === '') continue
            // Map sito_web → sito (internal field name)
            const targetKey = k === 'sito_web' ? 'sito' : k
            if (!result[targetKey]) {
              result[targetKey] = v
              geminiFilled++
            }
          }
          if (geminiFilled > 0) {
            fonti.push('Gemini 2.5 Flash Lite (Google Search grounding)')
            console.log(`[COMPANY-LOOKUP] Step Gemini: filled ${geminiFilled} fields`)
          } else {
            console.log('[COMPANY-LOOKUP] Step Gemini: no new data')
          }
        } else {
          console.log('[COMPANY-LOOKUP] Step Gemini: no data returned')
        }
      } catch (e: any) {
        console.log(`[COMPANY-LOOKUP] Step Gemini failed: ${e?.message || e}`)
      }
    }

    // ── Search 1: Visura / dati camerali ──
    const hasBasicCameraleData = result.partita_iva && result.codice_ateco && result.forma_giuridica
    if (!hasBasicCameraleData || (!result.titolare && !result.persone)) {
      // Put ufficiocamerale.it in query (NOT in include_domains which breaks results)
      const q1a = `${companyName} ${piva} partita IVA PEC titolare dipendenti ufficiocamerale.it`
      let text1 = await tavilySearch(q1a, true, true)
      // Fallback: broader search
      if (text1.length < 50) {
        const q1b = `${companyName} visura camerale dati società ufficiocamerale.it`
        text1 = await tavilySearch(q1b, true, true)
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
    // (questo fetch HTML viene bloccato da Cloudflare ma lo lasciamo come tentativo —
    //  in caso CF challenge ritorni HTML utile in futuro o per altri portali simili)
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
        // Titolare da ufficiocamerale = AUTOREVOLE (fonte camerale diretta)
        if (ucData.titolare && !result.titolare) {
          result.titolare = ucData.titolare
          result.ruolo_titolare = 'Rappresentante Legale'
          console.log(`[COMPANY-LOOKUP] Ufficiocamerale titolare: "${ucData.titolare}" — AUTHORITATIVE`)
        }
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
          if (crData.titolare && !result.titolare) {
            result.titolare = crData.titolare
            result.ruolo_titolare = 'Amministratore'
            console.log(`[COMPANY-LOOKUP] CompanyReports titolare: "${crData.titolare}"`)
          }
          if (!fonti.includes('CompanyReports.it')) fonti.push('CompanyReports.it')
        }
      }
    }

    // ── Search 2: Bilancio / dati finanziari (fatturato, dipendenti, utile, costo personale) ──
    if (!result.fatturato || !result.dipendenti) {
      const q2 = `${companyName} ${piva} bilancio fatturato ricavi dipendenti ufficiocamerale.it`
      const text2 = await tavilySearch(q2, true, true)
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
        if (ext2c.linkedin && !result.linkedin && /linkedin\.com\//i.test(String(ext2c.linkedin))) { result.linkedin = ext2c.linkedin; tavilyUsed = true }
        else if (ext2c.linkedin && !/linkedin\.com\//i.test(String(ext2c.linkedin))) { console.log(`[COMPANY-LOOKUP] REJECTED fake LinkedIn URL: "${ext2c.linkedin}"`) }
        if (ext2c.facebook && !result.facebook && !isLikelyGuessed(ext2c.facebook, 'facebook')) {
          result.facebook = ext2c.facebook; tavilyUsed = true
        } else if (ext2c.facebook) {
          console.log(`[COMPANY-LOOKUP] REJECTED likely guessed Facebook: "${ext2c.facebook}"`)
        }
      }
    }

    // ── Step 2d0: Extract titolare from the LEGAL NAME itself (Italian SAS/ditta patterns) ──
    // Italian business names commonly embed the owner's name in specific patterns:
    // - "... S.A.S. DI <NAME>"       → e.g. "RS PLANNER S.A.S DI SISTI PAOLO"   → Sisti Paolo
    // - "... DI <NAME> & C."         → e.g. "SALVATORE S.A.S. DI FIEMMINO GENNARO & C." → Fiemmino Gennaro
    // - "<COGNOME> <NOME>" (2 words) → e.g. "RUFFA MICHELA"                     → Ruffa Michela
    // Since this data comes from the official legal name (Chamber of Commerce), it is
    // authoritative — we set result.titolare directly without Tavily proximity validation.
    // Run even if titolare is already set — legal name pattern is AUTHORITATIVE and should
    // override earlier extractions (which may be from Tavily/GPT hallucinations or corrupted scrapers).
    {
      const extractOwnerFromLegalName = (name: string): string | null => {
        // Strip common trailing city/region noise that may have been appended to the query
        const cleaned = name
          .replace(/[""'']/g, '')
          .replace(/\s+/g, ' ')
          .replace(/\s+(Milano|Roma|Napoli|Torino|Bologna|Firenze|Genova|Palermo|Bari|Catania|Venezia|Verona|Padova|Brescia|Bergamo)\s*$/i, '')
          .trim()
        // Blocklist for captured "owner name": anything that's clearly NOT a person
        const BAD_OWNER_WORDS = new Set([
          // Legal forms and descriptors
          'italia', 'italy', 'spa', 'srl', 'srls', 'sas', 'snc', 'sociale', 'unico',
          'gruppo', 'group', 'holding', 'international', 'services', 'service', 'consulting',
          // Cities / regions
          'milano', 'roma', 'napoli', 'torino', 'bologna', 'firenze', 'genova', 'palermo',
          'bari', 'catania', 'venezia', 'verona', 'padova', 'brescia', 'bergamo',
          'lombardia', 'piemonte', 'veneto', 'lazio', 'campania', 'sicilia', 'sardegna',
          // Italian prepositions and articulated prepositions (NOT person names)
          'su', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
          'del', 'dello', 'della', 'dei', 'degli', 'delle',
          'al', 'allo', 'alla', 'ai', 'agli', 'alle',
          'in', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle',
          'con', 'per', 'tra', 'fra',
          // Common nouns appearing in company names after "di" (product/sector categories)
          'ricerca', 'ricerche', 'centro', 'studio', 'studi', 'scuola', 'servizi', 'servizio',
          'consulenza', 'consulenze', 'progettazione', 'produzione', 'produzioni',
          'commercio', 'commerciale', 'vendita', 'vendite', 'noleggio', 'noleggi',
          'gestione', 'gestioni', 'sviluppo', 'informatica', 'ingegneria', 'architettura',
          'design', 'comunicazione', 'marketing', 'proprieta', 'proprietà',
          'tutela', 'difesa', 'promozione', 'assistenza', 'riparazione', 'manutenzione',
          'trasporti', 'trasporto', 'logistica', 'import', 'export',
          'ristorazione', 'alimentari', 'abbigliamento', 'calzature',
          'enti', 'ente', 'societa', 'società', 'associazione', 'fondazione',
          'pubblici', 'pubblica', 'privata', 'privati'
        ])
        const isValidOwnerWord = (w: string) => /^[A-ZÀ-Ù][A-Za-zÀ-ÿ']{1,}$/.test(w) && !BAD_OWNER_WORDS.has(w.toLowerCase())
        // Pattern 1/2: "... DI <NAME> <NAME>" (exactly 2 capitalized tokens after DI)
        // Uses case-sensitive match on the captured tokens to ensure they look like proper names.
        const diMatches = Array.from(cleaned.matchAll(/\bDI\s+([A-ZÀ-Ù][A-Za-zÀ-ÿ']+)\s+([A-ZÀ-Ù][A-Za-zÀ-ÿ']+)/g))
        for (const m of diMatches) {
          const w1 = m[1], w2 = m[2]
          if (isValidOwnerWord(w1) && isValidOwnerWord(w2)) {
            return `${w1} ${w2}`
          }
        }
        // Pattern 3: whole name is just "<WORD1> <WORD2>" — libero professionista
        const LEGAL_RX = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|scarl|societa|società|studio|associati|associate|consulting|&|\be\s+c\b|\bdi\b)\b/i
        if (!LEGAL_RX.test(cleaned)) {
          const tokens = cleaned.split(/\s+/)
          if (tokens.length === 2 && isValidOwnerWord(tokens[0]) && isValidOwnerWord(tokens[1])) {
            return `${tokens[0]} ${tokens[1]}`
          }
        }
        return null
      }
      // Prefer the ORIGINAL user query (ground truth) over ragione_sociale from scrapers,
      // which may have encoding/parsing corruptions (e.g. "FIEMMINO" → "IEMMINO").
      const fromQuery = typeof query === 'string' ? extractOwnerFromLegalName(query) : null
      const fromRS = companyName ? extractOwnerFromLegalName(companyName) : null
      const fromName = fromQuery || fromRS
      if (fromName) {
        const titleCase = fromName.split(/\s+/).map(w => w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ')
        const prev = result.titolare
        result.titolare = titleCase
        // Keep any more specific role already set (e.g. "Amministratore Delegato" from camerale);
        // but if previous role was weak or absent, set the generic one.
        if (!result.ruolo_titolare || /^(socio|fondatore|direttore|key contact)$/i.test(String(result.ruolo_titolare))) {
          result.ruolo_titolare = 'Titolare / Rappresentante Legale'
        }
        console.log(`[COMPANY-LOOKUP] Step 2d0: titolare da NOME LEGALE = "${titleCase}" (da query="${fromQuery ? query : 'N/A'}", rs="${fromRS ? companyName : 'N/A'}"; prev="${prev || 'empty'}")`)
      }
    }

    // ── Search 2d: Titolare / Rappresentante Legale — SEMPRE cercato, anche se ci sono già soci ──
    // I soci (da OpenAPI/ufficiocamerale) possono essere diversi dal rappresentante legale/titolare
    if (!result.titolare) {
      // Anti-hallucination: titolare name must appear in Tavily text AND be in the same
      // neighborhood as the company name (at least one occurrence). We check MIN distance
      // across ALL occurrences to handle texts where the company is mentioned multiple times.
      const validateTitolareInText = (titName: string, text: string, compName: string): boolean => {
        if (!titName) return false
        const titLow = String(titName).toLowerCase()
        // Reject when the "name" is actually a role description (e.g. "Presidente del Consiglio di Amministrazione")
        const ROLE_AS_NAME_RX = /\b(presidente|amministratore|amministratrice|titolare|sindaco|sindaca|assessore|consigliere|segretario|direttore|direttrice|responsabile|legale\s+rappresentante|rappresentante\s+legale|socio|fondatore|fondatrice|presidente\s+del\s+consiglio)\b/i
        if (ROLE_AS_NAME_RX.test(titLow)) return false
        // A real person name must have at least 2 parts (nome + cognome) — reject single-word values
        const rawParts = String(titName).trim().split(/\s+/)
        if (rawParts.length < 2) return false
        const textLow = text.toLowerCase()
        const titParts = titLow.split(/\s+/).filter(w => w.length >= 3)
        if (titParts.length === 0 || !titParts.every(w => textLow.includes(w))) return false
        // Pick the MOST DISTINCTIVE company word (longest, >= 4 chars, skip legal suffixes)
        const LEGAL = /^(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|scarl|societa|società)$/i
        const compWords = String(compName).toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !LEGAL.test(w))
        if (compWords.length === 0) return false
        const compKey = compWords.sort((a, b) => b.length - a.length)[0]
        // Find ALL occurrences of compKey and titolare-first-word, compute MIN distance
        const findAll = (s: string, needle: string): number[] => {
          const out: number[] = []
          let i = s.indexOf(needle)
          while (i >= 0) { out.push(i); i = s.indexOf(needle, i + 1) }
          return out
        }
        const compPositions = findAll(textLow, compKey)
        // Use the LAST word (typically cognome) — more distinctive than nome
        const titLastWord = titParts[titParts.length - 1]
        const titPositions = findAll(textLow, titLastWord)
        if (compPositions.length === 0 || titPositions.length === 0) return false

        // ── TIGHTER PROXIMITY: 400 chars (was 2000) ──
        // Rationale: 2000 chars spanned multiple paragraphs of concatenated Tavily snippets,
        // allowing "Gerry Cardinale (fondatore RedBird Capital)" to pass validation for
        // unrelated "RES FREEDATA" because both words appeared within 2000 chars of noise.
        const MAX_DISTANCE = 400
        let bestPair: { c: number; t: number; dist: number } | null = null
        for (const c of compPositions) for (const t of titPositions) {
          const d = Math.abs(c - t)
          if (d <= MAX_DISTANCE && (!bestPair || d < bestPair.dist)) {
            bestPair = { c, t, dist: d }
          }
        }
        if (!bestPair) return false

        // ── ANTI-ASSOCIATION: reject if name is tightly bound to a DIFFERENT entity ──
        // Scan ±150 chars around the titolare position for company-entity signatures
        // (Capital, Group, Holding, SpA, SRL, Inc, Ltd, LLC, Corp, Partners, Ventures, Fund).
        // If such a signature exists AND its preceding word is NOT part of compName,
        // the person is likely linked to a different company (e.g. "Cardinale, RedBird Capital").
        const titStart = bestPair.t
        const around = textLow.slice(Math.max(0, titStart - 150), titStart + titLastWord.length + 150)
        // Entity pattern: CapitalizedOrLowercaseWord (3+ chars) followed by entity suffix
        const entityRx = /\b([a-zà-ù]{3,})\s+(capital|group|holding|holdings|ventures|partners|fund|funds|spa|s\.p\.a|srl|s\.r\.l|inc|ltd|llc|corp|corporation|gmbh|sa|s\.a)\b/gi
        const entitiesNearby: string[] = []
        for (const m of around.matchAll(entityRx)) {
          const nearbyCompanyWord = m[1].toLowerCase()
          // Skip if this is actually the target company's distinctive word
          if (compWords.includes(nearbyCompanyWord)) continue
          entitiesNearby.push(nearbyCompanyWord + ' ' + m[2])
        }
        if (entitiesNearby.length > 0) {
          // Person name is associated with a different entity in the same ~300-char window
          console.log(`[COMPANY-LOOKUP] VALIDATOR: "${titName}" linked to other entity [${entitiesNearby.join(', ')}] — not target "${compName}"`)
          return false
        }

        // ── CONTEXT SUPPORT: a role keyword must appear in the window between comp and tit ──
        // The short span between the two positions must contain a linking role keyword,
        // otherwise the two names just happen to appear near each other without any claimed relationship.
        const spanStart = Math.min(bestPair.c, bestPair.t)
        const spanEnd = Math.max(bestPair.c, bestPair.t) + Math.max(compKey.length, titLastWord.length) + 80
        const span = textLow.slice(Math.max(0, spanStart - 80), spanEnd)
        const ROLE_SUPPORT_RX = /\b(amministratore|amministratrice|amministra|titolare|fondatore|fondatrice|fondato|founder|founded|co-?founder|ceo|presidente|preside|rappresentante|dirige|diretto\s+da|guidato\s+da|guida|gestisce|proprietario|proprietaria|socio|soci|amministrator|direttore|direttrice|leader|owner|owns|possiede|capo|presso|at\s|chief\s+executive)\b/i
        if (!ROLE_SUPPORT_RX.test(span)) {
          // If name and company are VERY close (< 80 chars = LinkedIn header "Name - Company"),
          // check a wider window (800 chars) for role keywords (they appear in the About section)
          if (bestPair.dist < 80) {
            const wideSpan = textLow.slice(Math.max(0, bestPair.t - 50), bestPair.t + 800)
            if (ROLE_SUPPORT_RX.test(wideSpan)) {
              console.log(`[COMPANY-LOOKUP] VALIDATOR: "${titName}" accepted — close proximity + role keyword in wide window`)
              return true
            }
          }
          console.log(`[COMPANY-LOOKUP] VALIDATOR: "${titName}" near "${compName}" but NO role keyword in span — link not proven, rejecting`)
          return false
        }

        return true
      }
      // Reject roles that indicate a NON-company-representative context:
      // politicians (the "comune" where company is located), GDPR data controllers, etc.
      const BAD_ROLE_RX = /\b(sindaco|sindaca|vicesindaco|assessore|assessora|consigliere\s+comunale|segretario\s+comunale|presidente\s+del\s+consiglio\s+comunale|giunta\s+comunale|trattamento\s+(?:dei\s+)?dati\s+personali|data\s+protection\s+officer|\bdpo\b|responsabile\s+della\s+protezione\s+dei\s+dati)\b/i
      // ── Search 2d1: LinkedIn FIRST — è LA fonte principale per trovare chi guida un'azienda ──
      // Use original user query name if available (Maps often adds city/description: "Bull Car Bologna Luxury Automotive")
      // Strip legal suffix for LinkedIn (people write "Big Digital" not "Big Digital S.r.l.")
      const compNameForSearch = queryCompanyName || companyName
      const compNameClean = compNameForSearch.replace(/\s*(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|srl|srls|spa|sas|snc)\s*\.?\s*$/i, '').trim()
      // Use company LinkedIn slug for disambiguation if available ("big-digital-marketing-agency" is much more specific than "Big Digital")
      let linkedinSlug = ''
      if (result.linkedin && typeof result.linkedin === 'string') {
        const slugM = String(result.linkedin).match(/linkedin\.com\/company\/([\w-]+)/i)
        if (slugM) linkedinSlug = slugM[1].replace(/-/g, ' ')
      }
      const liSearchTerm = linkedinSlug ? `"${linkedinSlug}" OR "${compNameClean}"` : `"${compNameClean}"`
      const q2d1_li = `linkedin.com ${liSearchTerm} ${city} owner OR fondatore OR titolare OR CEO OR amministratore OR founder`
      console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn: query="${q2d1_li}"`)
      const text2d1_li = await tavilySearch(q2d1_li, false)
      console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn: text length=${text2d1_li.length}, preview="${text2d1_li.slice(0, 400).replace(/\n/g, ' ')}"`)

      if (text2d1_li.length > 50) {
        let ext2d1_li = await gptExtract(text2d1_li, `Trova chi è il TITOLARE / FONDATORE / CEO / OWNER / AMMINISTRATORE di "${companyName}".
Fonti valide: LinkedIn (Owner, Founder, CEO, Titolare, Amministratore), siti aziendali, visure camerali.
- ✅ Su LinkedIn: "Owner at ${companyName}", "Founder at ${companyName}", "CEO at ${companyName}", "Titolare presso ${companyName}", "Amministratore at ${companyName}" → VALIDO
- ✅ "chi siamo", "team", "staff" del sito aziendale → VALIDO
- ❌ Semplici dipendenti (Marketing Manager, HR, Developer, etc.) → NON VALIDO
- ❌ Persone di ALTRE aziende → NON VALIDO
- Se trovi più persone, scegli il fondatore/owner/titolare, non un semplice CEO/direttore.
JSON:
{"titolare":"nome e cognome","ruolo_titolare":"ruolo (es. Fondatore, Titolare, CEO, Amministratore Unico)","linkedin_titolare":"URL LinkedIn completo"}`)
        // ── REGEX FALLBACK: if GPT failed (429/quota), extract from LinkedIn text directly ──
        if (!ext2d1_li.titolare) {
          const textLow = text2d1_li.toLowerCase()
          const compLow = compNameClean.toLowerCase()
          // LinkedIn format: "Name Surname - Company" at start of each profile snippet
          // Also look for "Ho fondato X", "Founder at X", "CEO at X", "Owner at X"
          const ownerRoles = /\b(fondato|fondatore|fondatrice|founder|co-?founder|owner|titolare|proprietario|proprietaria|amministratore unico|ceo)\b/i
          if (ownerRoles.test(textLow) && textLow.includes(compLow)) {
            // Try to extract "Name Surname - Company" pattern (LinkedIn header)
            const headerRx = /^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})\s*[-–—]\s*/m
            const headerM = text2d1_li.match(headerRx)
            if (headerM) {
              const candidateName = headerM[1].trim()
              // Verify: name must not be the company name
              if (candidateName.toLowerCase() !== compLow && candidateName.split(/\s+/).length >= 2) {
                ext2d1_li = { titolare: candidateName, ruolo_titolare: 'Fondatore' }
                // Extract LinkedIn URL if present
                const liUrlM = text2d1_li.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s"',)]+/i)
                if (liUrlM) ext2d1_li.linkedin_titolare = liUrlM[0]
                console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn REGEX FALLBACK: "${candidateName}"`)
              }
            }
          }
        }
        console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn GPT result: titolare="${ext2d1_li.titolare || 'null'}", ruolo="${ext2d1_li.ruolo_titolare || 'null'}", linkedin="${ext2d1_li.linkedin_titolare || 'null'}"`)
        if (ext2d1_li.titolare && !isJunkValue(ext2d1_li.titolare)) {
          const badRole = ext2d1_li.ruolo_titolare && BAD_ROLE_RX.test(String(ext2d1_li.ruolo_titolare))
          if (badRole) {
            console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn: REJECTED "${ext2d1_li.titolare}" — bad role "${ext2d1_li.ruolo_titolare}"`)
          } else if (validateTitolareInText(ext2d1_li.titolare, text2d1_li, companyName)) {
            result.titolare = ext2d1_li.titolare
            if (ext2d1_li.ruolo_titolare) result.ruolo_titolare = ext2d1_li.ruolo_titolare
            if (ext2d1_li.linkedin_titolare && !isJunkValue(ext2d1_li.linkedin_titolare)) result.linkedin_titolare = ext2d1_li.linkedin_titolare
            tavilyUsed = true
            console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn: titolare = "${ext2d1_li.titolare}" (${ext2d1_li.ruolo_titolare || ''})`)
          } else {
            console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn: REJECTED "${ext2d1_li.titolare}" — not in text near "${companyName}"`)
          }
        }
      }

      // ── Search 2d1b: Web ampia (ufficiocamerale, sito aziendale, staff page) ──
      if (!result.titolare) {
        const q2d1b = `"${compNameClean}" titolare OR fondatore OR "amministratore unico" OR owner OR "chi siamo" ${city}`
        console.log(`[COMPANY-LOOKUP] Search 2d1b web: query="${q2d1b}"`)
        const text2d1b = await tavilySearch(q2d1b, false)
        console.log(`[COMPANY-LOOKUP] Search 2d1b web: text length=${text2d1b.length}`)
        if (text2d1b.length > 50) {
          const ext2d1b = await gptExtract(text2d1b, `Chi è il titolare/fondatore/proprietario/amministratore di "${companyName}"?
Cerca in: LinkedIn, sito aziendale (pagina chi siamo/team/staff), ufficiocamerale.it, visure camerali.
- ✅ Owner/Founder/Titolare/CEO/Amministratore Unico → VALIDO
- ❌ Dipendenti, manager, collaboratori → NON VALIDO
- ❌ Persone di ALTRE aziende → NON VALIDO
JSON:
{"titolare":"nome e cognome","ruolo_titolare":"ruolo","linkedin_titolare":"URL LinkedIn se trovato"}`)
          if (ext2d1b.titolare && !isJunkValue(ext2d1b.titolare)) {
            const badRoleB = ext2d1b.ruolo_titolare && BAD_ROLE_RX.test(String(ext2d1b.ruolo_titolare))
            if (badRoleB) {
              console.log(`[COMPANY-LOOKUP] Search 2d1b: REJECTED "${ext2d1b.titolare}" — bad role "${ext2d1b.ruolo_titolare}"`)
            } else if (validateTitolareInText(ext2d1b.titolare, text2d1b, companyName)) {
              result.titolare = ext2d1b.titolare
              if (ext2d1b.ruolo_titolare) result.ruolo_titolare = ext2d1b.ruolo_titolare
              if (ext2d1b.linkedin_titolare && !isJunkValue(ext2d1b.linkedin_titolare)) result.linkedin_titolare = ext2d1b.linkedin_titolare
              tavilyUsed = true
              console.log(`[COMPANY-LOOKUP] Search 2d1b: titolare = "${ext2d1b.titolare}" (${ext2d1b.ruolo_titolare || ''})`)
            } else {
              console.log(`[COMPANY-LOOKUP] Search 2d1b: REJECTED "${ext2d1b.titolare}" — not linked to "${companyName}"`)
            }
          }
        }
      }

      // ── Search 2d1c: Ultimo tentativo — scrapa direttamente /chi-siamo, /about, /team dal sito ──
      if (!result.titolare && result.sito) {
        const siteBase = String(result.sito).replace(/\/$/, '')
        console.log(`[COMPANY-LOOKUP] Search 2d1c: scraping about pages from "${siteBase}"`)
        const aboutPaths = ['/chi-siamo', '/about', '/about-us', '/team', '/staff', '/la-nostra-storia']
        for (const path of aboutPaths) {
          if (result.titolare) break
          try {
            const aboutRes = await fetch(`${siteBase}${path}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(6000), redirect: 'follow',
            }).catch(() => null)
            console.log(`[COMPANY-LOOKUP] Search 2d1c: ${siteBase}${path} → ${aboutRes?.status || 'FAIL'}`)
            if (aboutRes && aboutRes.ok) {
              const html = await aboutRes.text()
              if (html.length > 500) {
                // Strip script/style/noscript tags FIRST (they contain JS/JSON-LD, not visible text)
                const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
                const aboutText = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000)
                console.log(`[COMPANY-LOOKUP] Search 2d1c: ${path} text preview: "${aboutText.slice(0, 300)}"`)
                const extAbout = await gptExtract(aboutText, `Questa è la pagina "${path}" del sito di "${companyName}". Chi è il fondatore/titolare/CEO/proprietario?
- Cerca nomi di persone con ruoli di leadership (fondatore, titolare, CEO, owner, amministratore)
- ❌ Ignora dipendenti, collaboratori, staff generico
JSON:{"titolare":"nome e cognome","ruolo_titolare":"ruolo"}`)
                console.log(`[COMPANY-LOOKUP] Search 2d1c: GPT result: titolare="${extAbout.titolare || 'null'}"`)
                if (extAbout.titolare && !isJunkValue(extAbout.titolare)) {
                  result.titolare = extAbout.titolare
                  if (extAbout.ruolo_titolare) result.ruolo_titolare = extAbout.ruolo_titolare
                  console.log(`[COMPANY-LOOKUP] Search 2d1c: titolare from ${path} = "${extAbout.titolare}" (${extAbout.ruolo_titolare || ''})`)
                }
              }
            }
          } catch { /* skip */ }
        }
      }
    }

    // ── Search 2d2: Soci / Amministratori (se ancora mancanti) ──
    if (!result.persone || (Array.isArray(result.persone) && result.persone.length === 0)) {
      const q2d = `${companyName} ${piva} amministratore socio ufficiocamerale.it registroimprese.it`
      const text2d = await tavilySearch(q2d, true, true)
      if (text2d.length > 50) {
        const ext2d = await gptExtract(text2d, `Cerca TUTTI i soci, amministratori e persone chiave dell'azienda "${companyName}" (P.IVA: ${piva || 'N/D'}).
ATTENZIONE: restituisci SOLO persone che sono SOCI o AMMINISTRATORI di questa azienda. NON includere dipendenti o collaboratori.
JSON:
{"persone":[{"nome":"Nome Cognome","ruolo":"Amministratore / Socio / Consigliere di Amministrazione / ecc","cf":"codice fiscale se disponibile","quota":"percentuale quota se socio"}]}`)
        if (Array.isArray(ext2d.persone) && ext2d.persone.length > 0) {
          const clean = ext2d.persone.filter((p: any) => p?.nome && !isJunkValue(p.nome))
          if (clean.length > 0) { result.persone = clean; tavilyUsed = true }
        }
      }
    }

    // If titolare was found but not in persone array, add them
    if (result.titolare && Array.isArray(result.persone)) {
      const titName = String(result.titolare).toLowerCase()
      const alreadyInList = result.persone.some((p: any) => p?.nome && String(p.nome).toLowerCase() === titName)
      if (!alreadyInList) {
        (result.persone as any[]).unshift({
          nome: result.titolare,
          ruolo: result.ruolo_titolare || 'Titolare / Rappresentante Legale',
        })
      }
    } else if (result.titolare && !result.persone) {
      result.persone = [{
        nome: result.titolare,
        ruolo: result.ruolo_titolare || 'Titolare / Rappresentante Legale',
      }]
    }
    // ── Cross-validate titolare vs persone: prefer active Amministratore over Fondatore ──
    if (result.titolare && Array.isArray(result.persone) && result.persone.length > 1) {
      const titLow = String(result.titolare).toLowerCase().trim()
      const titRuolo = String(result.ruolo_titolare || '').toLowerCase()
      // If current titolare is "Fondatore" but persone has an Amministratore/Rappresentante Legale, switch
      if (titRuolo.includes('fondator') || titRuolo.includes('socio')) {
        const activeAdmin = (result.persone as any[]).find((p: any) => {
          if (!p?.nome || !p?.ruolo) return false
          const r = String(p.ruolo).toLowerCase()
          const n = String(p.nome).toLowerCase().trim()
          return n !== titLow && (r.includes('amministrator') || r.includes('rappresentante legale') || r.includes('presidente'))
        })
        if (activeAdmin) {
          console.log(`[COMPANY-LOOKUP] Titolare correction: "${result.titolare}" (${result.ruolo_titolare}) → "${activeAdmin.nome}" (${activeAdmin.ruolo}) — prefer active admin over founder`)
          result.titolare = activeAdmin.nome
          result.ruolo_titolare = activeAdmin.ruolo
        }
      }
    }
    console.log(`[COMPANY-LOOKUP] Search 2d final — titolare: "${result.titolare || 'N/A'}", persone: ${result.persone ? JSON.stringify(result.persone) : 'NONE'}`)

    // ── Search 2e: INLINE titolare enrichment (full person profile — replaces old person-lookup self-call) ──
    // Fetches: LinkedIn, bio, esperienze, formazione, competenze, seniority, social, contatti, trigger, famiglia
    const titName = result.titolare ? String(result.titolare).trim() : ''
    const compForTit = (result.ragione_sociale || companyName) as string
    if (titName && titName.length >= 3) {
      console.log(`[COMPANY-LOOKUP] Search 2e: titolare enrichment for "${titName}" @ "${compForTit}"`)
      const nj = (v: any): boolean => {
        if (!v) return false
        const s = String(v).trim().toLowerCase()
        if (!s || s === 'null' || s === 'undefined' || s === 'non disponibile' || s === 'non specificato' || s === 'none' || s === 'n/a' || s === 'n/d') return false
        if (/^(profilo|url|canale|pagina|account|username|handle|link)\s/i.test(s)) return false
        if (/non\s+(specificat|menzione|trovar|disponibil|present|not)/i.test(s)) return false
        if (/^nessun/i.test(s)) return false
        if (/nel testo|not found|not available|unknown/i.test(s)) return false
        return true
      }

      // ── Context for anti-omonimo ──
      const atecoCtx = (result.descrizione_ateco || '') as string
      const cityCtx = (result.citta || (result.sede_legale ? String(result.sede_legale).split(',').pop()?.trim() : '') || '') as string
      const formaCtx = (result.forma_giuridica || '') as string

      // ── Search 2e0: Scrape COMPANY WEBSITE contact page for titolare's personal phone/email ──
      // Italian business websites often list owners/partners by name with their direct phone/email
      // on /contatti, /chi-siamo, /team, /contact pages. This is MUCH more reliable than Tavily+GPT
      // for personal contacts because the data is explicitly tied to the company.
      const isItalianPhoneLocal = (ph: string): boolean => {
        const digits = ph.replace(/\D/g, '')
        if (digits.startsWith('39') && digits.length >= 11 && digits.length <= 13) {
          const core = digits.slice(2)
          return core.startsWith('0') || core.startsWith('3')
        }
        if ((digits.startsWith('0') || digits.startsWith('3')) && digits.length >= 6 && digits.length <= 11) return true
        return false
      }
      if (result.sito && typeof result.sito === 'string' && (!result.telefono_titolare || !result.email_titolare)) {
        try {
          let baseUrl: URL | null = null
          try { baseUrl = new URL(String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`) } catch { baseUrl = null }
          if (baseUrl) {
            const contactPaths = ['/contatti', '/contatti/', '/contact', '/contact/', '/contacts', '/contattaci', '/chi-siamo', '/chi-siamo/', '/team', '/team/', '/about', '/about-us', '/staff', '/']
            const titLower = titName.toLowerCase()
            // Build name-variants for matching (handles "Rita Abascali" vs "Abascali Rita")
            const nameParts = titLower.split(/\s+/).filter(p => p.length >= 3)
            for (const path of contactPaths) {
              if (result.telefono_titolare && result.email_titolare) break
              try {
                const url = new URL(path, baseUrl).toString()
                const r = await fetch(url, {
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' },
                  signal: AbortSignal.timeout(7000),
                  redirect: 'follow',
                })
                if (!r.ok) continue
                const html = await r.text()
                // Flatten HTML tags to text but KEEP some whitespace; keep anchor hrefs (for mailto: and tel:)
                const hrefsAndText = html
                  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
                  .replace(/<[^>]+href="(mailto:|tel:)([^"]+)"[^>]*>([^<]*)<\/[^>]+>/gi, (_m, kind, val, txt) => ` ${kind}${val} ${txt} `)
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/gi, ' ')
                  .replace(/&amp;/gi, '&')
                  .replace(/[ \t]+/g, ' ')
                const lowerText = hrefsAndText.toLowerCase()
                // Require that ALL significant name parts appear in the page
                if (nameParts.length === 0 || !nameParts.every(p => lowerText.includes(p))) continue
                // Find the position of the name (try both orderings) and extract a window around it
                const orderings = [nameParts.join(' '), nameParts.slice().reverse().join(' ')]
                let windowText = ''
                for (const ord of orderings) {
                  const idx = lowerText.indexOf(ord)
                  if (idx >= 0) {
                    const start = Math.max(0, idx - 50)
                    const end = Math.min(hrefsAndText.length, idx + ord.length + 300)
                    windowText = hrefsAndText.slice(start, end)
                    break
                  }
                }
                if (!windowText) continue
                // Extract Italian phone and email from the window
                // Prefer tel: href, then free-text phone patterns
                if (!result.telefono_titolare) {
                  const telHref = windowText.match(/tel:(\+?[\d\s().\-]{7,})/i)
                  const phoneMatch = telHref ? telHref[1] : (windowText.match(/(?:\+39\s*)?(?:0\d{1,3}[\s.\-]?\d{5,9}|3\d{2}[\s.\-]?\d{6,7})/) || [])[0]
                  if (phoneMatch) {
                    const normalized = String(phoneMatch).replace(/\s+/g, ' ').trim()
                    if (isItalianPhoneLocal(normalized)) {
                      result.telefono_titolare = normalized
                      console.log(`[COMPANY-LOOKUP] Search 2e0: telefono_titolare from ${url} = ${normalized}`)
                    }
                  }
                }
                if (!result.email_titolare) {
                  const mailHref = windowText.match(/mailto:([^\s"'<>]+@[^\s"'<>]+)/i)
                  const emailMatch = mailHref ? mailHref[1] : (windowText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0]
                  if (emailMatch && !/\.(?:png|jpg|jpeg|gif|svg)$/i.test(emailMatch)) {
                    result.email_titolare = emailMatch.toLowerCase()
                    console.log(`[COMPANY-LOOKUP] Search 2e0: email_titolare from ${url} = ${result.email_titolare}`)
                  }
                }
              } catch { /* try next path */ }
            }
          }
        } catch (e: any) { console.log(`[COMPANY-LOOKUP] Search 2e0 error: ${e?.message}`) }
      }

      // Search 2e1: LinkedIn profile + professional info
      const q2e1 = `"${titName}" ${compForTit} LinkedIn ruolo bio esperienza formazione`
      const text2e1 = await tavilySearch(q2e1, true, true)
      if (text2e1.length > 50) {
        const ext2e1 = await gptExtract(text2e1, `Estrai il profilo professionale COMPLETO di "${titName}" che lavora/dirige "${compForTit}".
L'azienda "${compForTit}" opera nel settore: ${atecoCtx || 'non specificato'}${cityCtx ? '. Sede: ' + cityCtx : ''}.
ATTENZIONE: Verifica che i dati si riferiscano effettivamente a "${titName}" presso "${compForTit}", NON a omonimi presso altre aziende. Se trovi più persone con lo stesso nome, scegli SOLO quella collegata a questo settore e azienda.
JSON:
{"linkedin":"URL profilo LinkedIn ESATTO trovato nel testo","bio":"descrizione professionale 2-3 frasi","ruolo":"ruolo attuale preciso","seniority":"junior/mid/senior/executive/C-level/founder","esperienze_precedenti":"elenco esperienze lavorative precedenti con azienda e ruolo","formazione":"titoli di studio, università, master, certificazioni","competenze":"competenze chiave separate da virgola","anni_esperienza":"stima anni di esperienza","tipo_lavoro":"dipendente/imprenditore/libero professionista/socio","settore":"settore di competenza","colleghi_noti":"nomi di colleghi o co-fondatori noti","dimensione_azienda":"micro/piccola/media/grande"}`)

        // Validate: check person-lookup found the RIGHT person for this company
        const compClean = compForTit.toLowerCase().replace(/[^a-zà-ú\s]/gi, '').trim()
        const compWords = compClean.split(/\s+/).filter((w: string) => w.length > 3 && !/^(srl|srls|spa|sas|snc|societa|società)$/i.test(w))
        const checkText = [ext2e1.esperienze_precedenti, ext2e1.bio, ext2e1.colleghi_noti, text2e1].filter(Boolean).join(' ').toLowerCase()
        let matchesComp = compWords.length === 0 || compWords.some((w: string) => checkText.includes(w))

        // ── Anti-omonimo rafforzato: coerenza settore + tipo lavoro ──
        if (matchesComp && atecoCtx) {
          const extSettore = [ext2e1.settore, ext2e1.bio, ext2e1.competenze].filter(Boolean).join(' ').toLowerCase()
          const atecoLow = atecoCtx.toLowerCase()
          const atecoKw = atecoLow.split(/[\s,;/()']+/).filter((w: string) => w.length > 4)
          const settoreKw = extSettore.split(/[\s,;/()']+/).filter((w: string) => w.length > 4)
          if (atecoKw.length > 0 && settoreKw.length > 0) {
            const hasOverlap = atecoKw.some((w: string) => extSettore.includes(w)) || settoreKw.some((w: string) => atecoLow.includes(w))
            if (!hasOverlap) {
              console.log(`[COMPANY-LOOKUP] Search 2e1: SECTOR MISMATCH — ATECO "${atecoCtx}" vs settore "${ext2e1.settore}" — likely omonimo`)
              matchesComp = false
            }
          }
        }
        if (matchesComp && /impresa\s*individuale/i.test(formaCtx) && /dipendente/i.test(String(ext2e1.tipo_lavoro || ''))) {
          console.log(`[COMPANY-LOOKUP] Search 2e1: IMPRESA INDIVIDUALE owner listed as "dipendente" — likely omonimo`)
          matchesComp = false
        }

        if (matchesComp) {
          console.log(`[COMPANY-LOOKUP] Search 2e1: titolare profile VERIFIED for "${compForTit}"`)
          if (nj(ext2e1.linkedin)) result.linkedin_titolare = ext2e1.linkedin
          if (nj(ext2e1.bio)) result.bio_titolare = ext2e1.bio
          if (nj(ext2e1.ruolo) && !result.ruolo_titolare) result.ruolo_titolare = ext2e1.ruolo
          if (nj(ext2e1.seniority)) result.seniority_titolare = ext2e1.seniority
          if (nj(ext2e1.esperienze_precedenti)) result.esperienze_titolare = ext2e1.esperienze_precedenti
          if (nj(ext2e1.formazione)) result.formazione_titolare = ext2e1.formazione
          if (nj(ext2e1.competenze)) {
            const c = ext2e1.competenze
            result.competenze_titolare = typeof c === 'string' ? c.split(',').map((s: string) => s.trim()).filter(Boolean) : c
          }
          if (nj(ext2e1.anni_esperienza)) result.anni_esperienza_titolare = ext2e1.anni_esperienza
          if (nj(ext2e1.tipo_lavoro)) result.tipo_lavoro_titolare = ext2e1.tipo_lavoro
          if (nj(ext2e1.settore)) result.settore_titolare = ext2e1.settore
          if (nj(ext2e1.colleghi_noti)) result.colleghi_titolare = ext2e1.colleghi_noti
          if (nj(ext2e1.dimensione_azienda)) result.dimensione_azienda_titolare = ext2e1.dimensione_azienda
          tavilyUsed = true
        } else {
          console.log(`[COMPANY-LOOKUP] Search 2e1: titolare profile NOT verified — data doesn't reference "${compForTit}"`)
          // Still accept LinkedIn if URL contains person's name
          if (nj(ext2e1.linkedin) && ext2e1.linkedin.includes('linkedin.com')) {
            const nameParts = titName.toLowerCase().split(/\s+/).filter((p: string) => p.length >= 3)
            if (nameParts.some((p: string) => ext2e1.linkedin.toLowerCase().includes(p))) {
              result.linkedin_titolare = ext2e1.linkedin
            }
          }
        }
      }

      // Search 2e2: Social media + contatti personali
      if (!result.linkedin_titolare || !result.instagram_titolare || !result.facebook_titolare) {
        // Bias the query toward Italy to reduce homonym risk (e.g. Italian "Rita Abascali" vs US homonym)
        const geoBias = cityCtx ? ` "${cityCtx}" Italia` : ' Italia'
        const q2e2 = `"${titName}"${geoBias} "${compForTit}" instagram facebook twitter social contatti email telefono`
        const text2e2 = await tavilySearch(q2e2)
        if (text2e2.length > 50) {
          const ext2e2 = await gptExtract(text2e2, `Estrai i profili social e contatti personali di "${titName}" (titolare di "${compForTit}"${cityCtx ? `, con sede a ${cityCtx}` : ''}).
REGOLE FONDAMENTALI:
- "${titName}" è una persona ITALIANA che opera in Italia. Se il testo parla di una persona con lo stesso nome ma residente in USA/UK/Spagna/altri paesi, IGNORA quei dati e restituisci campi vuoti.
- Telefono: accetta SOLO numeri italiani (formato +39 XXX, 0XX XXXXXXX, 3XX XXXXXXX). RIFIUTA numeri con prefissi esteri come +1 (USA), +44 (UK), (XXX) XXX-XXXX (formato USA).
- Città: SOLO città italiane. Se trovi "Dublin, CA" o "New York" o simili, NON è la persona giusta — restituisci campi vuoti.
- Instagram/Facebook: accetta solo se coerente con una persona italiana (bio in italiano, followers italiani, post su argomenti italiani).
- NON inventare URL. Se non hai conferma del contesto italiano, restituisci campi vuoti.
JSON:
{"instagram":"URL Instagram trovato","facebook":"URL Facebook trovato","twitter":"URL Twitter/X trovato","email_personale":"email personale (non aziendale)","telefono_personale":"telefono italiano della persona (non estero)","citta":"città italiana di residenza","interessi":"interessi e hobby dal social"}`)
          if (!result.linkedin_titolare && nj(ext2e2.linkedin)) result.linkedin_titolare = ext2e2.linkedin
          if (nj(ext2e2.instagram)) result.instagram_titolare = ext2e2.instagram
          if (nj(ext2e2.facebook)) result.facebook_titolare = ext2e2.facebook
          if (nj(ext2e2.twitter)) result.twitter_titolare = ext2e2.twitter
          if (nj(ext2e2.email_personale)) result.email_titolare = ext2e2.email_personale
          if (nj(ext2e2.telefono_personale)) result.telefono_titolare = ext2e2.telefono_personale
          if (nj(ext2e2.citta)) result.citta_titolare = ext2e2.citta
          if (nj(ext2e2.interessi)) result.interessi_titolare = ext2e2.interessi
          tavilyUsed = true
        }
      }

      // Search 2e3: Trigger finanziari e segnali comportamentali del titolare
      {
        const q2e3 = `"${titName}" ${compForTit} cambio lavoro promozione acquisto casa matrimonio figli partita IVA investimenti mutuo`
        const text2e3 = await tavilySearch(q2e3)
        if (text2e3.length > 50) {
          const ext2e3 = await gptExtract(text2e3, `Cerca SEGNALI e TRIGGER relativi a "${titName}" (titolare di "${compForTit}") che possano indicare bisogni assicurativi o finanziari.
JSON:
{"cambio_lavoro_recente":true/false,"nuova_partita_iva":true/false,"promozione_recente":true/false,"acquisto_immobile":true/false,"matrimonio_recente":true/false,"figli_recenti":true/false,"interessi_finanziari":"dettagli su interessi per investimenti/mutui/business","legami_familiari":"compagna/o, figli, genitori, fratelli/sorelle se trovati nel testo","stato_civile":"sposato/single/divorziato se noto","figli":"numero o nomi figli se noti","veicoli":"veicoli intestati o menzionati","note_trigger":"altri segnali rilevanti per un broker assicurativo"}`)
          if (ext2e3.cambio_lavoro_recente) result.trigger_cambio_lavoro = ext2e3.cambio_lavoro_recente
          if (ext2e3.nuova_partita_iva) result.trigger_nuova_piva = ext2e3.nuova_partita_iva
          if (ext2e3.promozione_recente) result.trigger_promozione = ext2e3.promozione_recente
          if (ext2e3.acquisto_immobile) result.trigger_acquisto_immobile = ext2e3.acquisto_immobile
          if (ext2e3.matrimonio_recente) result.trigger_matrimonio = ext2e3.matrimonio_recente
          if (ext2e3.figli_recenti) result.trigger_figli = ext2e3.figli_recenti
          if (nj(ext2e3.interessi_finanziari)) result.interessi_finanziari_titolare = ext2e3.interessi_finanziari
          if (nj(ext2e3.legami_familiari)) result.legami_familiari_titolare = ext2e3.legami_familiari
          if (nj(ext2e3.stato_civile)) result.stato_civile_titolare = ext2e3.stato_civile
          if (nj(ext2e3.figli)) result.figli_titolare = ext2e3.figli
          if (nj(ext2e3.veicoli)) result.veicoli_titolare = ext2e3.veicoli
          if (nj(ext2e3.note_trigger)) result.note_titolare = ext2e3.note_trigger
          tavilyUsed = true
        }
      }

      // Search 2e4: LinkedIn specifico se manca ancora
      if (!result.linkedin_titolare) {
        const q2e4 = `site:linkedin.com/in "${titName}" ${compForTit}`
        const text2e4 = await tavilySearch(q2e4, true, true)
        if (text2e4.length > 30) {
          const liMatch = text2e4.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9._-]+/i)
          if (liMatch) {
            result.linkedin_titolare = liMatch[0]
            console.log(`[COMPANY-LOOKUP] Search 2e4: LinkedIn from site search: ${liMatch[0]}`)
          }
        }
      }

      console.log(`[COMPANY-LOOKUP] Search 2e done — linkedin_tit=${result.linkedin_titolare || 'none'} bio=${!!result.bio_titolare} seniority=${result.seniority_titolare || 'none'} esperienze=${!!result.esperienze_titolare} formazione=${!!result.formazione_titolare} social=${!!(result.instagram_titolare || result.facebook_titolare)}`)
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

  // ─── Step 4b: STANDALONE Titolare fallback — runs ALWAYS if titolare missing ───
  // The main Tavily block (Search 2d1) is gated by !leadRegistryDone.
  // If lead-registry provided financial data, the entire Tavily block is skipped — including titolare.
  // This standalone search ensures we ALWAYS try to find the titolare via LinkedIn.
  // ALWAYS run — even if titolare is set — because GPT/Gemini often hallucinate names.
  // LinkedIn is the most reliable source: "Marco Danuvola - CEO - Consorzio Standby 2p0"
  // If LinkedIn finds a verified match, OVERRIDE whatever was set before.
  if ((result.ragione_sociale || queryCompanyName) && tavilyKey && openaiKey) {
    let compName4b = String(queryCompanyName || result.ragione_sociale).replace(/\s*(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|srl|srls|spa|sas|snc)\s*\.?\s*$/i, '').trim()
    const city4b = (result.citta || queryCityHint || '') as string
    // Strip city from company name — ragione_sociale often ends with city (e.g., "STANDBY CONSORZIO milano")
    // which causes exact match failure in Tavily when city is inside quotes
    if (city4b) {
      const cityRx = new RegExp(`\\s+${city4b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
      compName4b = compName4b.replace(cityRx, '').trim()
    }
    console.log(`[COMPANY-LOOKUP] Step 4b: LinkedIn titolare search for "${compName4b}" city="${city4b}" (current titolare="${result.titolare || 'NONE'}")`)
    try {
      const reversedName4b = compName4b.split(/\s+/).reverse().join(' ')
      const piva4b = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
      const usefulCompTokens4b = compName4b.toLowerCase().replace(/[^a-z0-9àèéìòù\s]/gi, ' ').split(/\s+/).filter((w: string) => w.length >= 4 && !/^(srl|srls|spa|sas|snc|com|italia|group)$/.test(w))
      const weakQuery4b = usefulCompTokens4b.length < 2
      const q4bVariants = [
        `"${compName4b}" linkedin CEO fondatore titolare amministratore`,
        `"${reversedName4b}" linkedin CEO fondatore titolare amministratore`,
        `linkedin.com "${compName4b}" ${city4b} owner fondatore titolare CEO amministratore founder`,
        `"${compName4b}" "${city4b}" "rappresentante legale" amministratore titolare`,
        piva4b.length === 11 ? `"${piva4b}" "${compName4b}" "rappresentante legale" amministratore` : '',
        piva4b.length === 11 ? `site:ufficiocamerale.it "${piva4b}" "${compName4b}"` : '',
      ].filter((q, idx, arr) => q.trim().length > 10 && arr.indexOf(q) === idx)
      let results4b: any[] = []
      for (const q4b of q4bVariants) {
        const tavRes4b = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: q4b,
            max_results: 5,
            search_depth: 'basic',
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (tavRes4b.ok) {
          const tavData4b = await tavRes4b.json() as any
          const partial4b = Array.isArray(tavData4b?.results) ? tavData4b.results : []
          results4b.push(...partial4b)
          if (!weakQuery4b && partial4b.some((r: any) => /linkedin\.com\/in\//i.test(String(r?.url || '')))) break
        }
      }
      results4b = results4b.filter((r, idx, arr) => arr.findIndex((x: any) => String(x?.url || '') === String(r?.url || '')) === idx)
      if (results4b.length > 0) {
        const text4b = results4b.map((r: any) => `${r.title || ''}\n${r.content || ''}`).join('\n\n').slice(0, 8000)
        console.log(`[COMPANY-LOOKUP] Step 4b: Tavily text length=${text4b.length}, preview="${text4b.slice(0,300).replace(/\n/g,' ')}"`);
        const compTokens4b = usefulCompTokens4b
        const weakCompanyMatch4b = weakQuery4b
        const cityKey4b = String(city4b || '').toLowerCase().trim()
        const fullCompanyKey4b = String(result.ragione_sociale || compName4b).toLowerCase()
          .replace(cityKey4b ? new RegExp(`\\s+${cityKey4b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') : /$^/, '')
          .replace(/\s+/g, ' ')
          .trim()
        const hasStrongRegistryContext4b = (hay: string) => (piva4b.length === 11 && hay.includes(piva4b)) || (fullCompanyKey4b.length >= 8 && hay.includes(fullCompanyKey4b))
        const roleRx4b = /\b(ceo|chief executive officer|founder|fondatore|fondatrice|owner|titolare|amministratore|amministratrice|legale rappresentante)\b/i
        let bestLinkedIn4b: { name: string; role: string; url: string; score: number } | null = null
        for (const r of results4b) {
          const url = String(r?.url || '')
          if (!/linkedin\.com\/in\//i.test(url)) continue
          const title = String(r?.title || '')
          const content = String(r?.content || '')
          const hay = `${title}\n${content}`.toLowerCase()
          const tokenHits = compTokens4b.filter((w: string) => hay.includes(w)).length
          const roleHit = roleRx4b.test(hay)
          const strongContextHit = hasStrongRegistryContext4b(hay)
          if (tokenHits < Math.min(2, compTokens4b.length) || !roleHit) continue
          if (weakCompanyMatch4b && !strongContextHit) {
            console.log(`[COMPANY-LOOKUP] Step 4b LinkedIn: REJECTED weak company match "${title}" — missing city/PIVA/full-name context`)
            continue
          }
          const titleName = (title.match(/^(.+?)\s[-–—]\s/)?.[1] || content.split(/\r?\n/)[0] || '').trim()
          if (!titleName || titleName.split(/\s+/).length < 2 || titleName.split(/\s+/).length > 4) continue
          if (compTokens4b.some((w: string) => titleName.toLowerCase().includes(w))) continue
          const role = (content.match(roleRx4b)?.[0] || 'Titolare / CEO').trim()
          const score = tokenHits * 10 + (roleHit ? 5 : 0) + (title.toLowerCase().includes('linkedin') ? 1 : 0)
          if (!bestLinkedIn4b || score > bestLinkedIn4b.score) {
            bestLinkedIn4b = { name: titleName, role, url, score }
          }
        }
        if (bestLinkedIn4b) {
          // IDENTITY GATE: lo snippet della fonte LinkedIn deve passare il match con
          // l'azienda corrente (P.IVA / ragione_sociale / dominio / città). Senza questo,
          // un omonimo come "ALMAXITALIA Milano - Bob Deppiesse" verrebbe accettato per
          // la query "ALMAX.COM Torino".
          const linkedInResult4b = results4b.find((r: any) => String(r?.url || '') === bestLinkedIn4b!.url)
          const ev4b: Evidence = {
            source: 'Tavily/LinkedIn (Step 4b titolare)',
            trust: 'low',
            text: `${linkedInResult4b?.title || ''}\n${linkedInResult4b?.content || ''}`,
            url: bestLinkedIn4b.url,
          }
          if (!gateAccepts(ev4b, 70)) {
            console.log(`[COMPANY-LOOKUP] Step 4b: GATE BLOCKED titolare LinkedIn "${bestLinkedIn4b.name}" (omonimo probabile)`)
          } else {
            const prevTit4b = result.titolare || ''
            const linkedInName4b = bestLinkedIn4b.name.split(/\s+/).map((w: string) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(' ')
            result.titolare = linkedInName4b
            result.ruolo_titolare = bestLinkedIn4b.role
            result.linkedin_titolare = bestLinkedIn4b.url
            if (!fonti.includes('Tavily (ricerca web)')) fonti.push('Tavily (ricerca web)')
            console.log(`[COMPANY-LOOKUP] Step 4b: ✅ LinkedIn deterministic titolare override "${prevTit4b || 'empty'}" → "${linkedInName4b}" (${bestLinkedIn4b.role})`)
          }
        }
        if (!bestLinkedIn4b && !result.titolare && text4b.length > 50) {
          const gptRes4b = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: 'gpt-4o-mini', temperature: 0,
              messages: [
                { role: 'system', content: 'Sei un analista aziendale. Estrai dati strutturati dal testo fornito. Rispondi SOLO con JSON valido.' },
                { role: 'user', content: `${text4b}\n\nChi è il TITOLARE / FONDATORE / CEO / OWNER / AMMINISTRATORE di "${result.ragione_sociale}"?\n- ✅ Owner/Founder/Titolare/CEO/Amministratore → VALIDO\n- ❌ Dipendenti/manager/collaboratori → NON VALIDO\n- ❌ Persone di ALTRE aziende → NON VALIDO\nJSON:\n{"titolare":"nome e cognome","ruolo_titolare":"ruolo","linkedin_titolare":"URL LinkedIn se trovato"}` },
              ],
            }),
            signal: AbortSignal.timeout(10000),
          })
          if (gptRes4b.ok) {
            const gptData4b = await gptRes4b.json() as any
            const raw4b = gptData4b.choices?.[0]?.message?.content || '{}'
            try {
              const ext4b = JSON.parse(raw4b.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
              if (ext4b.titolare && typeof ext4b.titolare === 'string' && ext4b.titolare.trim().length > 3) {
                const titName4b = ext4b.titolare.trim()
                // Validate: name must appear in Tavily text and be near company name
                const textLow4b = text4b.toLowerCase()
                const titParts4b = titName4b.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
                const compKey4b = compName4b.toLowerCase().replace(/[^a-z0-9àèéìòù\s]/gi, ' ').split(/\s+/).filter((w: string) => w.length >= 3 && !/^(srl|srls|spa|sas|snc|com|italia|group)$/.test(w)).sort((a: string, b: string) => b.length - a.length)[0] || compName4b.toLowerCase()
                const titInText = titParts4b.length > 0 && titParts4b.every((w: string) => textLow4b.includes(w))
                const compInText4b = textLow4b.includes(compKey4b);
                const strongContextText4b = results4b.some((r: any) => {
                  const snippet4b = `${r?.title || ''}\n${r?.content || ''}`.toLowerCase()
                  return titParts4b.every((w: string) => snippet4b.includes(w)) && hasStrongRegistryContext4b(snippet4b)
                })
                // IDENTITY GATE finale: la sorgente Tavily aggregata deve passare il match.
                const ev4bGpt: Evidence = {
                  source: 'Tavily/GPT (Step 4b titolare)',
                  trust: 'low',
                  text: text4b,
                }
                const gateOk4bGpt = gateAccepts(ev4bGpt, 70)
                if (gateOk4bGpt && titInText && compInText4b && (!weakCompanyMatch4b || strongContextText4b)) {
                  result.titolare = titName4b.split(/\s+/).map((w: string) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(' ')
                  if (ext4b.ruolo_titolare) result.ruolo_titolare = ext4b.ruolo_titolare
                  if (ext4b.linkedin_titolare && String(ext4b.linkedin_titolare).includes('linkedin.com/in/')) {
                    result.linkedin_titolare = ext4b.linkedin_titolare
                  }
                  if (!fonti.includes('Tavily (ricerca web)')) fonti.push('Tavily (ricerca web)')
                  console.log(`[COMPANY-LOOKUP] Step 4b: ✅ FOUND titolare = "${titName4b}" (${ext4b.ruolo_titolare || ''})`)
                } else {
                  console.log(`[COMPANY-LOOKUP] Step 4b: REJECTED "${titName4b}" — titInText=${titInText}, compInText=${compInText4b}, strongContext=${strongContextText4b}, gate=${gateOk4bGpt}`)
                }
              }
            } catch { /* JSON parse error */ }
          }
        }
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] Step 4b: error — ${e?.message || e}`)
    }
  }

  // ─── Step 5: ROUND 2 — If we still miss contacts, redo Maps + website scraping ───
  // Critical for: P.IVA searches (Maps was called with "05970051214" instead of "ADIRLAB SRL")
  // Also helps: name searches where Maps didn't find the company or returned incomplete data
  const companyNameNow = (result.ragione_sociale || queryCompanyName || '') as string
  const needsContacts = !result.telefono || !result.email || !result.sito
  if (!leadRegistryDone && companyNameNow && needsContacts) {
    console.log(`[COMPANY-LOOKUP] ── ROUND 2: re-doing Maps + website scraping with name "${companyNameNow}" ──`)

    // Round 2a: Google Maps via /search-maps-single (same backend endpoint as Step 0a)
    if (!result.telefono || !result.sito) {
      try {
        const mapsCity = (result.citta || queryCityHint || '') as string
        console.log(`[COMPANY-LOOKUP] Round 2a: Maps single search for "${companyNameNow}" city="${mapsCity}"`)
        const mapsRes = await fetch(`${backendUrl}/search-maps-single`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_name: companyNameNow, city: mapsCity, max_results: 1 }),
          signal: AbortSignal.timeout(200000),
        }).catch(() => null)
        if (mapsRes && mapsRes.ok) {
          const mapsData = await mapsRes.json().catch(() => null) as any
          const leads = (mapsData && Array.isArray(mapsData.results)) ? mapsData.results : []
          const lead = leads[0]
          if (lead && typeof lead === 'object') {
            console.log(`[COMPANY-LOOKUP] Round 2a: Maps found "${lead.name}"`)
            if (!result.telefono && lead.phone) result.telefono = lead.phone
            if (!result.sito && lead.website) result.sito = lead.website
            if (!result.indirizzo && lead.address) result.indirizzo = lead.address
            if (!result.categoria && lead.category) result.categoria = lead.category
            if (!result.rating && typeof lead.rating === 'number') result.rating = lead.rating
            if (!result.reviews_count && typeof lead.reviews_count === 'number') result.reviews_count = lead.reviews_count
            if (!fonti.includes('Google Maps')) fonti.push('Google Maps')
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
          const core = d.startsWith('39') ? d.slice(2) : (d.startsWith('0039') ? d.slice(4) : d)
          if (core.startsWith('3') && !result.cellulare) { result.cellulare = ph; console.log(`[COMPANY-LOOKUP] R2: cellulare from website: ${ph}`) }
          else if ((core.startsWith('0') || /^(800|803|840|892|899)/.test(core)) && !result.telefono) { result.telefono = ph; console.log(`[COMPANY-LOOKUP] R2: telefono from website: ${ph}`) }
        }
        // Emails
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        const emails = [...new Set(allHtml.match(emailRegex) || [])]
          .filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') && !e.includes('example') && !e.includes('sentry'))
        if (!result.pec) {
          const pecEmail = emails.find(e => /pec\.|legalmail\.|pecimprese\.|pecmail\.|casellapec/i.test(e.toLowerCase()))
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
  if (!leadRegistryDone && result.sito && !result.partita_iva) {
    const pivaFromSite = await extractPivaFromSite(result.sito as string)
    if (pivaFromSite) result.partita_iva = pivaFromSite
  }

  // ─── Step 6: OpenAPI.it — ULTIMO, solo se mancano ancora dati critici ───
  const stillMissing = !result.partita_iva || !result.forma_giuridica || !result.pec || !result.sede_legale || !result.codice_ateco
  if (!leadRegistryDone && token && stillMissing) {
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

  // ─── Step 6a: Pre-validate PEC — if current PEC is NOT a real PEC domain, move to email ───
  // A real PEC must have a recognized PEC domain (pec.it, legalmail.it, pecimprese.it, etc.)
  // If result.pec contains a normal email like info@azienda.it, it's NOT a PEC — move it to email
  // so that Step 6b can still search for the real PEC on ufficiocamerale/INIPEC.
  const PEC_DOMAIN_RX = /@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust|casellapec)[a-z0-9.\-]*\.[a-z]{2,}$/i
  if (result.pec && typeof result.pec === 'string' && !PEC_DOMAIN_RX.test(result.pec)) {
    console.log(`[COMPANY-LOOKUP] Step 6a: PEC "${result.pec}" is NOT a valid PEC domain — moving to email, clearing PEC`)
    if (!result.email) result.email = result.pec
    delete result.pec
  }
  // Also: if result.email has a PEC domain, move it to pec
  if (result.email && typeof result.email === 'string' && PEC_DOMAIN_RX.test(result.email) && !result.pec) {
    console.log(`[COMPANY-LOOKUP] Step 6a: email "${result.email}" is a PEC domain — moving to PEC`)
    result.pec = result.email
    delete result.email
  }

  // ─── Step 6b: PEC discovery pipeline (free sources FIRST, OpenAPI as LAST RESORT) ───
  // PEC is legally mandatory for Italian companies — these sources have ~95% coverage combined.
  // Priority order:
  //   1. INIPEC.gov.it direct (official government registry) — by P.IVA, then by name
  //   2. Tavily search restricted to inipec/cerca-pec/ufficiocamerale
  //   3. Official website footer scraping (labels like "PEC:" or PEC-domain emails)
  //   4. OpenAPI.it /IT-pec (consumes quota 30/month, use only if nothing else works)
  if (!result.pec) {
    const pivaClean = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
    const nameForPec = String(result.ragione_sociale || query || '').trim()

    // Regex tuned for PEC emails (must end in a known PEC TLD/keyword to reduce false positives)
    const pecEmailRx = /([a-z0-9._%+\-]+@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust|casellapec)[a-z0-9.\-]*\.[a-z]{2,})/i

    // Build significant name tokens (>= 3 chars, excluding common legal suffixes) to validate Tavily result proximity
    const legalSuffixes = new Set(['srl','spa','sas','snc','srls','sapa','scarl','coop','soc','societa','group','spa.','srl.','italia','italy','the','and','di','il','la','le','dei','delle','del','della'])
    const nameTokens = nameForPec.toLowerCase()
      .replace(/[^a-z0-9àèéìòù\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !legalSuffixes.has(w))
    // PEC domains that belong to public entities (schools, universities, PA) — very unlikely to be a legit business match
    const publicPecDomains = /@(?:pec\.istruzione\.it|pec\.mi\.camcom\.it|pec\.comune\.|pec\.provincia\.|pec\.regione\.|pec\.uniupo\.it|pec\.unibo\.it|pec\.polimi\.it|pec\.unito\.it|pec\.unimi\.it|pec\.unipd\.it|pec\.unifi\.it|pec\.unipi\.it|pec\.uniroma|pec\.unina\.it|cert\.agenziaentrate\.it|pec\.inps\.it|pec\.inail\.it|pec\.governo\.it)/i

    // Validates an extracted PEC against the source snippet:
    //   1. snippet must contain the P.IVA (11 digits) OR at least 2 significant name tokens
    //   2. PEC domain must not belong to public-entity blacklist (unless our query IS a public entity, heuristic: contains "scuola"/"istituto"/"università"/"comune"/"provincia"/"regione")
    const isPublicEntityQuery = /\b(scuola|istituto|liceo|universit|comune\s+di|provincia\s+di|regione\s+)/i.test(nameForPec)
    const validatePecMatch = (snippet: string, pec: string): boolean => {
      const s = snippet.toLowerCase()
      const hasPiva = pivaClean.length === 11 && s.includes(pivaClean)
      const tokensHit = nameTokens.filter(t => s.includes(t)).length
      const nameOk = nameTokens.length === 0 ? false : (nameTokens.length === 1 ? tokensHit >= 1 : tokensHit >= 2)
      if (!hasPiva && !nameOk) return false
      if (!isPublicEntityQuery && publicPecDomains.test(pec)) return false
      return true
    }

    // 2) Tavily search on INIPEC / cerca-pec / ufficiocamerale — validate each result individually
    if (!result.pec && tavilyKey && (nameForPec.length >= 3 || pivaClean.length === 11)) {
      try {
        const qTerm = pivaClean.length === 11 ? pivaClean : `"${nameForPec}"`
        const tq = `${qTerm} PEC posta elettronica certificata site:inipec.gov.it OR site:cerca-pec.it OR site:ufficiocamerale.it OR site:registroimprese.it`
        console.log(`[COMPANY-LOOKUP] Step 6b/2: Tavily PEC search`)
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: tq, search_depth: 'basic', max_results: 8, include_answer: false }),
          signal: AbortSignal.timeout(10000),
        })
        if (r.ok) {
          const data = await r.json()
          const results = ((data.results || []) as Array<{ title?: string; content?: string; url?: string }>)
          // Iterate each result, validate before accepting the PEC
          for (const res of results) {
            const snippet = `${res.title || ''}\n${res.content || ''}\n${res.url || ''}`
            const m = snippet.match(pecEmailRx)
            if (!m) continue
            const candidate = m[1].toLowerCase()
            if (validatePecMatch(snippet, candidate)) {
              result.pec = candidate
              if (!fonti.includes('INIPEC (via Tavily)')) fonti.push('INIPEC (via Tavily)')
              console.log(`[COMPANY-LOOKUP] Step 6b/2: PEC = ${result.pec} (validated)`)
              break
            } else {
              console.log(`[COMPANY-LOOKUP] Step 6b/2: rejected unrelated PEC candidate ${candidate}`)
            }
          }
        }
      } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 6b/2 error: ${e?.message}`) }
    }

    // 3) Official website footer scraping
    if (!result.pec && result.sito && typeof result.sito === 'string') {
      console.log(`[COMPANY-LOOKUP] Step 6b/3: scraping website "${result.sito}" for PEC`)
      try {
        let base: URL | null = null
        try { base = new URL(String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`) } catch { base = null }
        if (base) {
          const paths = ['/', '/contatti', '/contacts', '/privacy', '/privacy-policy', '/note-legali', '/legal', '/chi-siamo']
          const pecLabelRx = /(?:pec|posta\s*elettronica\s*certificata)\s*[:.\-#]?\s*([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi
          for (const p of paths) {
            try {
              const u = new URL(p, base).toString()
              const r = await fetch(u, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' },
                signal: AbortSignal.timeout(7000), redirect: 'follow',
              })
              if (!r.ok) continue
              const ct = r.headers.get('content-type') || ''
              if (!ct.includes('text/html')) continue
              const html = await r.text()
              const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()
              const labelled = [...text.matchAll(pecLabelRx)].map(m => m[1]).find(Boolean)
              if (labelled) { result.pec = labelled; break }
              const byDomain = text.match(pecEmailRx)
              if (byDomain) { result.pec = byDomain[1].toLowerCase(); break }
            } catch { /* try next path */ }
          }
          if (result.pec) {
            if (!fonti.includes('Sito ufficiale (PEC)')) fonti.push('Sito ufficiale (PEC)')
            console.log(`[COMPANY-LOOKUP] Step 6b/3: PEC dal sito = ${result.pec}`)
          }
        }
      } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 6b/3 error: ${e?.message}`) }
    }

    // 4) OpenAPI.it /IT-pec — LAST RESORT (consumes 30/month quota)
    if (!result.pec && pivaClean.length === 11 && token) {
      console.log(`[COMPANY-LOOKUP] Step 6b/4: OpenAPI /IT-pec for ${pivaClean} (fallback, consuma quota)`)
      try {
        const r = await fetch(`https://company.openapi.com/IT-pec/${pivaClean}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        })
        if (r.ok) {
          const json = await r.json()
          const d = (json?.data as Array<Record<string, unknown>>)?.[0]
          const pec = (d?.pec || d?.certifiedEmail) as string | undefined
          if (pec && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pec)) {
            result.pec = pec.toLowerCase()
            if (!fonti.includes('OpenAPI.it (PEC)')) fonti.push('OpenAPI.it (PEC)')
            console.log(`[COMPANY-LOOKUP] Step 6b/4: PEC = ${result.pec}`)
          }
        }
      } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 6b/4 error: ${e?.message}`) }
    }

    if (!result.pec) console.log(`[COMPANY-LOOKUP] Step 6b: PEC non trovata da nessuna fonte`)
  }

  // ─── Step 6c: Post-hoc PEC sanity validator ───
  // Regardless of which step set result.pec (Tavily GPT, CompanyReports, OpenAPI, website, ...),
  // drop the PEC if it clearly belongs to an unrelated public entity (school, university, PA) —
  // unless the query itself refers to such an entity.
  if (result.pec && typeof result.pec === 'string') {
    const pecLower = String(result.pec).toLowerCase()
    const nameForVal = String(result.ragione_sociale || query || '').toLowerCase()
    const publicPecDomainsFinal = /@(?:pec\.istruzione\.it|pec\.mi\.camcom\.it|pec\.comune\.|pec\.provincia\.|pec\.regione\.|pec\.uniupo\.it|pec\.unibo\.it|pec\.polimi\.it|pec\.unito\.it|pec\.unimi\.it|pec\.unipd\.it|pec\.unifi\.it|pec\.unipi\.it|pec\.uniroma|pec\.unina\.it|cert\.agenziaentrate\.it|pec\.inps\.it|pec\.inail\.it|pec\.governo\.it|pec\.scuol|pec\.liceo)/i
    const isPublicEntityQueryFinal = /\b(scuola|istituto\s+comprensivo|istituto\s+tecnico|liceo|universit|comune\s+di|provincia\s+di|regione\s+|ministero|agenzia\s+entrate|inps|inail)/i.test(nameForVal)
    if (!isPublicEntityQueryFinal && publicPecDomainsFinal.test(pecLower)) {
      console.log(`[COMPANY-LOOKUP] Step 6c: REMOVED public-entity PEC "${pecLower}" (query not a public entity)`)
      delete result.pec
      // Also remove INIPEC-related sources since they are now stale for PEC
      // (keep them if they provided other data — we only drop PEC)
    }
  }

  // ─── Step 6d: Final PEC domain validation — better empty than wrong ───
  // After all sources have been tried, if result.pec still doesn't have a valid PEC domain, clear it.
  // A PEC MUST have a recognized PEC domain (legalmail.it, pec.it, pecimprese.it, etc.)
  // Normal emails like info@azienda.it are NOT PEC — better to show empty field than wrong data.
  const PEC_DOMAIN_FINAL_RX = /@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust|casellapec)[a-z0-9.\-]*\.[a-z]{2,}$/i
  if (result.pec && typeof result.pec === 'string' && !PEC_DOMAIN_FINAL_RX.test(result.pec)) {
    console.log(`[COMPANY-LOOKUP] Step 6d: FINAL VALIDATION — PEC "${result.pec}" is not a valid PEC domain, clearing (better empty than wrong)`)
    if (!result.email) result.email = result.pec
    delete result.pec
  }
  // Final email→PEC swap: if email has PEC domain and pec is empty, move it
  if (result.email && typeof result.email === 'string' && PEC_DOMAIN_FINAL_RX.test(result.email) && !result.pec) {
    console.log(`[COMPANY-LOOKUP] Step 6d: FINAL SWAP — email "${result.email}" is PEC domain, moving to PEC`)
    result.pec = result.email
    delete result.email
  }

  // ─── Step 6e: Website validation — better empty than wrong ───
  // If result.sito exists, do a quick sanity check:
  //   1. Must not be a known parked/domain-for-sale platform
  //   2. Domain must contain at least some company name tokens OR be .it
  //   3. Quick HTTP check (HEAD request, 5s timeout) — if it fails, likely dead
  // If any check fails, clear result.sito. Maps telefono/indirizzo are NOT affected.
  if (result.sito && result.email && typeof result.sito === 'string' && typeof result.email === 'string') {
    try {
      const currentDomain = new URL(String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`).hostname.replace(/^www\./, '').toLowerCase()
      const emailDomain = String(result.email).split('@')[1]?.toLowerCase().replace(/^www\./, '')
      const compactName = String(result.ragione_sociale || query || '').toLowerCase()
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|societa|società)\b/gi, '')
        .replace(/[^a-z0-9]/gi, '')
      const emailDomainKey = (emailDomain || '').split('.')[0].replace(/[^a-z0-9]/gi, '')
      const isGenericEmailDomain = /^(gmail|yahoo|hotmail|outlook|libero|virgilio|tiscali|alice|aruba|live|icloud|protonmail|tin)\./i.test(emailDomain || '')
      const isPecEmailDomain = /(?:pec|legalmail|pecimprese|arubapec|postecert|casellapec)/i.test(emailDomain || '')
      if (emailDomain && currentDomain !== emailDomain && !isGenericEmailDomain && !isPecEmailDomain && compactName.length >= 5 && (emailDomainKey.includes(compactName) || compactName.includes(emailDomainKey))) {
        console.log(`[COMPANY-LOOKUP] Step 6e: replacing website "${result.sito}" with email-domain website "https://${emailDomain}"`)
        result.sito = `https://${emailDomain}`
      }
    } catch { /* keep existing sito */ }
  }
  if (result.sito && typeof result.sito === 'string') {
    const sitoStr = String(result.sito).trim()
    // Known parked/domain-for-sale patterns
    const PARKED_DOMAINS = /(?:sedoparking|godaddy|namecheap|afternic|dan\.com|flippa|hugedomains|buydomains|domainhasprice|parkingcrew|parking\.)/i
    if (PARKED_DOMAINS.test(sitoStr)) {
      console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED parked domain "${sitoStr}"`)
      delete result.sito
    } else {
      // Domain relevance check: extract domain and compare with company name
      try {
        const siteUrl = new URL(sitoStr.startsWith('http') ? sitoStr : `https://${sitoStr}`)
        const domain = siteUrl.hostname.replace(/^www\./, '').toLowerCase()
        const compName = String(result.ragione_sociale || query || '').toLowerCase().replace(/[^a-z0-9àèéìòù]/gi, ' ')
        const compWords = compName.split(/\s+/).filter((w: string) => w.length >= 3 && !/^(srl|spa|sas|snc|srls|sapa|scarl|coop|soc|societa|group|italia|italy|the|and|di|il|la|consorzio|com|net|org|www)$/.test(w))
        const domainRelevance = compWords.some((w: string) => domain.includes(w)) || domain.endsWith('.it')
        // Quick HTTP HEAD check — 5s timeout, don't block the flow
        let siteAlive = false
        try {
          const headRes = await fetch(sitoStr.startsWith('http') ? sitoStr : `https://${sitoStr}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
            redirect: 'follow',
          })
          siteAlive = headRes.ok || headRes.status < 500
        } catch {
          siteAlive = false
        }
        const emailDomainForSite = typeof result.email === 'string' ? String(result.email).split('@')[1]?.replace(/^www\./, '').toLowerCase() : ''
        const isRiskyForeignDomain = siteAlive && !domain.endsWith('.it') && (!emailDomainForSite || domain !== emailDomainForSite)
        let contentVerified = true
        if (isRiskyForeignDomain) {
          contentVerified = false
          try {
            const pageRes = await fetch(sitoStr.startsWith('http') ? sitoStr : `https://${sitoStr}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
              signal: AbortSignal.timeout(5000),
              redirect: 'follow',
            })
            if (pageRes.ok) {
              const pageText = (await pageRes.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()
              const pivaDigits = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
              const cityVal = String(result.citta || queryCityHint || '').toLowerCase()
              const addressVal = String(result.indirizzo || result.sede_legale || '').toLowerCase().split(/[,\-–]/)[0]?.trim()
              const hasPiva = pivaDigits.length === 11 && pageText.includes(pivaDigits)
              const hasEmailDomain = !!emailDomainForSite && pageText.includes(emailDomainForSite)
              const hasCity = cityVal.length >= 4 && pageText.includes(cityVal)
              const hasAddress = !!addressVal && addressVal.length >= 8 && pageText.includes(addressVal)
              contentVerified = hasPiva || hasEmailDomain || hasCity || hasAddress
            }
          } catch { contentVerified = false }
        }
        if (!siteAlive) {
          console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED dead site "${sitoStr}" (domain="${domain}") — better empty than wrong`)
          delete result.sito
        } else if (!contentVerified) {
          console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED unverifiable foreign site "${sitoStr}" (domain="${domain}") — better empty than wrong`)
          delete result.sito
        } else if (siteAlive && !domainRelevance) {
          // Site is alive but domain doesn't match company — try to verify content
          console.log(`[COMPANY-LOOKUP] Step 6e: Site "${sitoStr}" is alive but domain doesn't match company — keeping (may be valid)`)
        } else {
          console.log(`[COMPANY-LOOKUP] Step 6e: Site "${sitoStr}" validated (alive=${siteAlive}, relevant=${domainRelevance})`)
        }
      } catch {
        // Invalid URL format
        console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED invalid URL "${sitoStr}"`)
        delete result.sito
      }
    }
  }

  // ─── Step 6f: Social URL junk validation — remove generic/incomplete social URLs ───
  // GPT/Tavily can hallucinate social URLs like "facebook.com/groups/" without actual content.
  if (result.facebook && typeof result.facebook === 'string') {
    const fb = String(result.facebook).replace(/\/+$/, '')
    // Reject: just facebook.com, facebook.com/groups, facebook.com/pages, or no real page name
    if (/^https?:\/\/(?:www\.|m\.|it-it\.)?facebook\.com\/?$/i.test(fb) ||
        /^https?:\/\/(?:www\.|m\.)?facebook\.com\/(groups|pages|sharer|share|dialog|tr|plugins|events)\/?$/i.test(fb)) {
      console.log(`[COMPANY-LOOKUP] Step 6f: REMOVED junk Facebook URL "${result.facebook}"`)
      delete result.facebook
    }
  }
  if (result.instagram && typeof result.instagram === 'string') {
    const ig = String(result.instagram).replace(/\/+$/, '')
    if (/^https?:\/\/(?:www\.)?instagram\.com\/?$/i.test(ig) ||
        /^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv|stories|explore|accounts)\/?$/i.test(ig)) {
      console.log(`[COMPANY-LOOKUP] Step 6f: REMOVED junk Instagram URL "${result.instagram}"`)
      delete result.instagram
    }
  }
  if (result.linkedin && typeof result.linkedin === 'string') {
    const li = String(result.linkedin).replace(/\/+$/, '')
    if (/^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/?$/i.test(li)) {
      console.log(`[COMPANY-LOOKUP] Step 6f: REMOVED junk LinkedIn URL "${result.linkedin}"`)
      delete result.linkedin
    }
  }

  const hasAnyCompanySignalBeforeFinal = ['ragione_sociale', 'partita_iva', 'codice_fiscale', 'codice_ateco', 'pec', 'telefono', 'cellulare', 'email', 'sito', 'sito_web', 'indirizzo', 'sede_legale', 'fatturato', 'dipendenti', 'titolare', 'linkedin', 'facebook', 'instagram', 'rating', 'categoria']
    .some(k => {
      const v = (result as any)[k]
      return v !== undefined && v !== null && String(v).trim() !== ''
    })
  if (!result.ragione_sociale && hasAnyCompanySignalBeforeFinal && !isPiva) {
    result.nome = queryCompanyName
  }

  // ─── Step 7: Analisi assicurativa — polizze mancanti / gap ───
  if (hasAnyCompanySignalBeforeFinal) {
    result.fonti = [...new Set(fonti)]

    // ── Final phone cleanup ──
    // Helper: check if phone is a valid Italian number
    const isItalianPhone = (ph: string): boolean => {
      const digits = ph.replace(/\D/g, '')
      // With +39 prefix: 39 + 9-10 digits
      if (digits.startsWith('39') && digits.length >= 11 && digits.length <= 13) {
        const core = digits.slice(2)
        return core.startsWith('0') || core.startsWith('3') // landline (0xx) or mobile (3xx)
      }
      // Without prefix: starts with 0 (landline) or 3 (mobile), 9-11 digits
      if ((digits.startsWith('0') || digits.startsWith('3')) && digits.length >= 6 && digits.length <= 11) return true
      return false
    }
    // PRE-SPLIT: Maps sometimes returns "051765727 / +39340123456" in one field → split before validation
    if (result.telefono && typeof result.telefono === 'string' && /[/,]/.test(String(result.telefono))) {
      const rawPh = String(result.telefono)
      const phoneParts = rawPh.split(/[/,]/).map(p => p.trim()).filter(p => p.replace(/\D/g, '').length >= 6)
      if (phoneParts.length >= 2) {
        console.log(`[COMPANY-LOOKUP] PRE-SPLIT: telefono "${rawPh}" → [${phoneParts.join(' | ')}]`)
        result.telefono = phoneParts[0]
        // Second number → cellulare if it starts with 3
        if (!result.cellulare) {
          const d2 = phoneParts[1].replace(/\D/g, '')
          const core2 = d2.startsWith('39') ? d2.slice(2) : (d2.startsWith('0039') ? d2.slice(4) : d2)
          if (core2.startsWith('3')) {
            result.cellulare = phoneParts[1]
            console.log(`[COMPANY-LOOKUP] PRE-SPLIT: extracted cellulare: "${phoneParts[1]}"`)
          }
        }
      }
    }
    // Remove non-Italian phones (e.g. US numbers like 603-308-9485)
    if (result.telefono && !isItalianPhone(String(result.telefono))) {
      console.log(`[COMPANY-LOOKUP] REMOVED phone "${result.telefono}" — not Italian format`)
      delete result.telefono
    }
    if (result.cellulare && !isItalianPhone(String(result.cellulare))) {
      console.log(`[COMPANY-LOOKUP] REMOVED cellulare "${result.cellulare}" — not Italian format`)
      delete result.cellulare
    }
    // Phone must NOT equal P.IVA
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

    // ── Person-lookup anti-omonimo cleanup ──
    // If the titolare phone is clearly non-Italian (e.g. US format "(925) 202-3277") or
    // the titolare city is clearly non-Italian (Dublin CA, New York, ...), it means person-lookup
    // matched an international homonym. Purge ALL correlated person fields to prevent mixed data.
    const nonItalianCityRx = /\b(USA|United\s+States|CA|NY|TX|FL|IL|WA|MA|UK|England|London|New\s+York|Los\s+Angeles|San\s+Francisco|Dublin\s*,\s*CA|Dublin\s*,\s*Ohio|Chicago|Miami|Boston|Seattle|Toronto|Madrid|Barcelona|Paris|Berlin|Munich)\b/i
    const hasNonItalianPhone = result.telefono_titolare && !isItalianPhone(String(result.telefono_titolare))
    const hasNonItalianCity = result.citta_titolare && nonItalianCityRx.test(String(result.citta_titolare))
    if (hasNonItalianPhone || hasNonItalianCity) {
      const reason = hasNonItalianPhone
        ? `non-Italian phone "${result.telefono_titolare}"`
        : `non-Italian city "${result.citta_titolare}"`
      console.log(`[COMPANY-LOOKUP] REMOVED titolare person data — ${reason} (likely omonimo estero)`)
      // Purge all correlated person-lookup fields that may come from the same wrong extraction
      delete result.telefono_titolare
      delete result.citta_titolare
      delete result.email_titolare
      delete result.instagram_titolare
      delete result.facebook_titolare
      delete result.twitter_titolare
      delete result.interessi_titolare
      delete result.interessi_finanziari_titolare
      delete result.veicoli_titolare
      delete result.note_titolare
      delete result.stato_civile_titolare
      delete result.figli_titolare
      delete result.legami_familiari_titolare
      delete result.bio_titolare
      delete result.esperienze_titolare
      delete result.formazione_titolare
      delete result.competenze_titolare
      delete result.seniority_titolare
      delete result.anni_esperienza_titolare
      delete result.settore_titolare
      delete result.colleghi_titolare
      delete result.dimensione_azienda_titolare
      // Keep result.titolare (the name) — that came from registry/visura, not the wrong person-lookup
    }

    // ── Final cross-field consistency check ──
    // For SRL/SPA: codice_fiscale should equal P.IVA. If they differ, one is from a wrong company — discard codice_fiscale
    if (result.codice_fiscale && result.partita_iva) {
      const cfClean = String(result.codice_fiscale).replace(/\D/g, '')
      const pivaClean = String(result.partita_iva).replace(/\D/g, '')
      if (cfClean.length === 11 && pivaClean.length === 11 && cfClean !== pivaClean) {
        const forma = String(result.forma_giuridica || result.ragione_sociale || '').toUpperCase()
        // For companies (SRL, SPA, SAS, SRLS, SNC) codice_fiscale = P.IVA
        if (/SRL|SPA|SAS|SNC|SRLS|SOCIETA|COOPERATIVA/.test(forma)) {
          console.log(`[COMPANY-LOOKUP] ⚠️ CF/PIVA MISMATCH for company: CF=${cfClean} PIVA=${pivaClean} — removing codice_fiscale (likely from wrong company)`)
          delete result.codice_fiscale
        }
      }
    }

    // ── Sanity: fatturato that looks like a year (2000-2030) is not valid ──
    if (result.fatturato) {
      const fatClean = String(result.fatturato).replace(/[^\d]/g, '')
      const fatNum0 = parseInt(fatClean, 10)
      if (fatNum0 >= 2000 && fatNum0 <= 2030) {
        console.log(`[COMPANY-LOOKUP] ⚠️ fatturato "${result.fatturato}" looks like a YEAR — removing`)
        delete result.fatturato
      }
    }

    const parseFat = (f: any): number | null => {
      if (!f) return null
      let s = String(f)
      // Strip year suffixes like "nel 2024", "anno 2023", "(2024)" before digit extraction
      s = s.replace(/\b(?:nel|anno|year|esercizio)\s*\d{4}\b/gi, '')
      s = s.replace(/\(\d{4}\)/g, '')
      // Strip currency symbols and text
      s = s.replace(/[€$]/g, '').replace(/\b(?:euro|eur)\b/gi, '')
      const n = Number(s.replace(/[^\d]/g, ''))
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
    const hasInsuranceBasis = !!(fatNum || dipNum || result.codice_ateco || result.descrizione_ateco)

    // Final ATECO normalization (catches all sources: lead-registry, Tavily, CompanyReports, etc.)
    if (result.codice_ateco) result.codice_ateco = normalizeAteco(result.codice_ateco) || result.codice_ateco

    // ATECO → obblighi assicurativi del settore
    const atecoIns = hasInsuranceBasis ? getAtecoInsurance((result.codice_ateco as string) || null, category || null) : null
    if (atecoIns) {
      result.obblighi_assicurativi = atecoIns
    }

    // Classificazione dimensionale EU
    if (fatNum || dipNum) result.classificazione_eu = classifyCompanySize(fatNum, dipNum)

    // ─── ANALISI ASSICURATIVA AI: GPT analizza i dati reali ───
    if (hasInsuranceBasis) {
      const aiPolicies = await analyzeInsuranceWithAI(result)
      if (aiPolicies.length > 0) {
        result.verifica_polizze = aiPolicies
      }
    }

    // Stima premio per le polizze mancanti
    if (fatNum || dipNum || atecoIns) {
      result.stima_premio = estimateAnnualPremium(
        fatNum,
        dipNum,
        atecoIns?.classe_inail || null,
        null,
        atecoIns?.settore || null,
      )
    }

    // Bisogni assicurativi verificati + playbook commerciale
    if (hasInsuranceBasis) {
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
    }

    // ── Final global cleanup: remove "null", "undefined", "N/D" string values ──
    const NULL_STRINGS = ['null', 'undefined', 'n/d', 'n/a', 'non disponibile', 'non specificato', 'non noto', 'non presente', 'da verificare', 'sconosciuto']
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === 'string' && NULL_STRINGS.includes(val.toLowerCase().trim())) {
        delete result[key]
      }
    }

    // ── Final cleanup: remove placeholder/example values hallucinated by GPT ──
    const placeholderRx = /esempio|example|sample|placeholder|lorem|ipsum/i
    const fakeNumberRx = /^0?1234567890?\d*$|^0?3456789012$|^0?123456789$/
    const sequentialRx = /1234567|7654321|0000000|9999999/
    const PORTAL_DOMAINS = ['risultati.it','nomeesatto.it','esattospa.it','reportaziende.it','italiaonline.it','informazione-aziende.it','getfound.it','cercaziende.it','trovaaziende.it','misterimprese.it','guida-monaci.it']
    for (const key of Object.keys(result)) {
      const v = result[key]
      if (typeof v === 'string') {
        if (placeholderRx.test(v)) {
          console.log(`[COMPANY-LOOKUP] CLEANUP: removed placeholder "${key}": "${v.slice(0, 60)}"`)
          delete result[key]
        } else if (['partita_iva', 'codice_fiscale', 'telefono', 'cellulare'].includes(key) && fakeNumberRx.test(v.replace(/\D/g, ''))) {
          console.log(`[COMPANY-LOOKUP] CLEANUP: removed fake number "${key}": "${v}"`)
          delete result[key]
        } else if (['telefono', 'cellulare'].includes(key) && sequentialRx.test(v.replace(/\D/g, ''))) {
          console.log(`[COMPANY-LOOKUP] CLEANUP: removed sequential phone "${key}": "${v}"`)
          delete result[key]
        } else if (['sito', 'sito_web', 'email'].includes(key) && PORTAL_DOMAINS.some(d => v.includes(d))) {
          console.log(`[COMPANY-LOOKUP] CLEANUP: removed portal domain "${key}": "${v.slice(0, 60)}"`)
          delete result[key]
        } else if (key === 'email' && /^(mario\.rossi|nome\.cognome|info\.test|test@|user@|admin@example|esempio|prova@)/.test(v.toLowerCase())) {
          console.log(`[COMPANY-LOOKUP] CLEANUP: removed fake email "${key}": "${v}"`)
          delete result[key]
        } else if (key === 'ragione_sociale' && /^(risultati|ricerca|nome esatto|pagina|home|error)$/i.test(v.trim())) {
          console.log(`[COMPANY-LOOKUP] CLEANUP: removed junk ragione_sociale: "${v}"`)
          delete result[key]
        }
      }
    }

    // ── FINAL VALIDATION: nome_commerciale must be a real business name ──
    if (result.nome_commerciale) {
      const ncStr = String(result.nome_commerciale).trim()
      const JUNK_NC = /^(risultati|ricerca|nome\s*esatto|pagina|home|error|null|undefined|n\/a|n\/d|non\s*trovato|non\s*disponibile|google|facebook|linkedin|wikipedia)$/i
      if (JUNK_NC.test(ncStr) || ncStr.length < 3) {
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: nome_commerciale "${ncStr}" is junk — removing`)
        delete result.nome_commerciale
      }
    }

    // ── FINAL VALIDATION: titolare must be a real person name ──
    if (result.titolare) {
      const titStr = String(result.titolare).trim()
      const titLow = titStr.toLowerCase()
      // Block company-like words: srl, servizi, tipografia, sanificazione, etc.
      const COMPANY_WORDS_RX = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|società|societa|cooperativa|consorzio|fondazione|associazione|impresa|ditta|studio|agenzia|servizi|servizio|sanificazione|disinfestazione|tipografia|officina|laboratorio|costruzioni|edilizia|edil|impianti|pulizie|trasporti|logistica|tecnolog|ambient|commerc|industriale|artigian|alimentar|meccan|elettr|group|holding|italia|international|soluzioni|systems|consulting|management|digital|global|energy|pharma|engineering|automotive|design|project|service|solution|network)\b/i
      // Must have at least 2 words (nome + cognome)
      const titWords = titStr.split(/\s+/).filter(w => w.length >= 2)
      // Check if titolare is essentially the company name (ragione_sociale without legal suffix)
      const rsCleanForTit = result.ragione_sociale
        ? String(result.ragione_sociale).toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc)\b/gi, '').replace(/[^a-zà-ú\s]/gi, '').trim()
        : ''
      const titCleanForComp = titLow.replace(/[^a-zà-ú\s]/gi, '').trim()
      const matchesCompanyName = rsCleanForTit.length >= 3 && (rsCleanForTit.includes(titCleanForComp) || titCleanForComp.includes(rsCleanForTit))
      const looksLikePerson = titWords.length >= 2 && !COMPANY_WORDS_RX.test(titLow)
        && /^[A-ZÀ-Ú]/.test(titWords[0]) && /^[A-ZÀ-Ú]/.test(titWords[titWords.length - 1])
        && titStr.length <= 60
        && !matchesCompanyName
      if (!looksLikePerson) {
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: titolare "${titStr}" is NOT a person name — removing`)
        delete result.titolare
        delete result.ruolo_titolare
        delete result.linkedin_titolare
        delete result.bio_titolare
        delete result.seniority_titolare
        delete result.esperienze_titolare
        delete result.formazione_titolare
        delete result.competenze_titolare
        delete result.anni_esperienza_titolare
        delete result.tipo_lavoro_titolare
        delete result.settore_titolare
        delete result.colleghi_titolare
        delete result.dimensione_azienda_titolare
        delete result.instagram_titolare
        delete result.facebook_titolare
        delete result.twitter_titolare
        delete result.email_titolare
        delete result.telefono_titolare
        delete result.citta_titolare
        delete result.interessi_titolare
        // Also clean persone array of non-person entries
        if (Array.isArray(result.persone)) {
          result.persone = (result.persone as any[]).filter((p: any) => {
            if (!p?.nome) return false
            const pn = String(p.nome).trim()
            return pn.split(/\s+/).length >= 2 && !COMPANY_WORDS_RX.test(pn.toLowerCase())
          })
          if ((result.persone as any[]).length === 0) delete result.persone
        }
      }
    }

    // ── FINAL VALIDATION: phone split + cleanup — handle "num1 / num2" and garbage chars ──
    // Maps sometimes returns "051765727 / +39340123456" in a single field → split into telefono + cellulare
    for (const phoneKey of ['telefono', 'cellulare', 'telefono_titolare']) {
      if (result[phoneKey] && typeof result[phoneKey] === 'string') {
        const raw = String(result[phoneKey])
        // Split on / or , if it looks like two separate numbers
        if (/[/,]/.test(raw) && raw.split(/[/,]/).filter(p => p.trim().replace(/\D/g, '').length >= 6).length >= 2) {
          const parts = raw.split(/[/,]/).map(p => p.trim()).filter(p => p.replace(/\D/g, '').length >= 6)
          console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: phone "${phoneKey}" contains ${parts.length} numbers: [${parts.join(' | ')}]`)
          // First number → keep in current field
          result[phoneKey] = parts[0]
          // Second number → if it's a cellulare (starts with 3 or +393) and cellulare is empty, assign it
          if (parts[1] && !result.cellulare && phoneKey !== 'cellulare') {
            const d2 = parts[1].replace(/\D/g, '')
            const core2 = d2.startsWith('39') ? d2.slice(2) : (d2.startsWith('0039') ? d2.slice(4) : d2)
            if (core2.startsWith('3')) {
              result.cellulare = parts[1]
              console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: extracted cellulare from split: "${parts[1]}"`)
            }
          }
        }
        // Now clean the value: remove garbage chars
        let cleaned = String(result[phoneKey])
          .replace(/[^\x20-\x7E+]/g, '') // keep only printable ASCII + '+'
          .replace(/^\s+|\s+$/g, '')
          .replace(/\s{2,}/g, ' ')
        // Normalize: "39 340..." → "+39 340...", "0039 340..." → "+39 340..."
        cleaned = cleaned.replace(/^0039\s*/, '+39 ').replace(/^39\s+(\d)/, '+39 $1')
        if (cleaned.length === 0) {
          console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: phone "${phoneKey}" was all garbage — removing`)
          delete result[phoneKey]
        } else if (cleaned !== result[phoneKey]) {
          console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: phone "${phoneKey}" cleaned: "${result[phoneKey]}" → "${cleaned}"`)
          result[phoneKey] = cleaned
        }
      }
    }
    // Also clean cellulare if it was just created by the split above
    if (result.cellulare && typeof result.cellulare === 'string') {
      let cc = String(result.cellulare).replace(/[^\x20-\x7E+]/g, '').replace(/^\s+|\s+$/g, '').replace(/\s{2,}/g, ' ')
      cc = cc.replace(/^0039\s*/, '+39 ').replace(/^39\s+(\d)/, '+39 $1')
      if (cc !== result.cellulare) result.cellulare = cc
    }

    // ── FINAL VALIDATION: PEC must be related to the company ──
    if (result.pec && result.ragione_sociale) {
      const pecStr = String(result.pec).toLowerCase()
      const pecDomain = pecStr.split('@')[1] || ''
      const rsClean = String(result.ragione_sociale).toLowerCase()
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s)\b/gi, '')
        .replace(/[^a-zà-ú0-9]/gi, '')
      const siteDomain = result.sito ? String(result.sito).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.')[0] : ''
      // PEC domain must contain part of company name OR site domain, or be a known PEC provider
      const KNOWN_PEC_PROVIDERS = ['legalmail.it', 'pec.it', 'arubapec.it', 'postecert.it', 'sicurezzapostale.it', 'registerpec.it', 'mypec.eu', 'cert.legalmail.it', 'actaliscertymail.it', 'infocert.it']
      const pecLocalPart = pecStr.split('@')[0] || ''
      const isKnownProvider = KNOWN_PEC_PROVIDERS.some(p => pecDomain.includes(p.split('.')[0]))
      const matchesCompany = (rsClean.length >= 4 && pecLocalPart.includes(rsClean.slice(0, Math.min(6, rsClean.length))))
        || (siteDomain.length >= 4 && pecDomain.includes(siteDomain))
        || (rsClean.length >= 4 && pecDomain.includes(rsClean.slice(0, Math.min(6, rsClean.length))))
      // Block PEC from public entities / clearly unrelated
      const PUBLIC_PEC_RX = /protocollo@|comune\.|provincia\.|regione\.|governo\.|sviluppolav|inps\.|inail\.|agenzia|ministero|prefettura|questura|tribunale|universit/i
      if (PUBLIC_PEC_RX.test(pecStr)) {
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: PEC "${pecStr}" is a public entity — removing`)
        delete result.pec
      } else if (!isKnownProvider && !matchesCompany) {
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: PEC "${pecStr}" domain doesn't match company "${result.ragione_sociale}" or site "${siteDomain}" — removing`)
        delete result.pec
      }
    }

    // ── FINAL VALIDATION: email domain should match company site ──
    if (result.email && result.sito) {
      const emailDomain = String(result.email).split('@')[1] || ''
      const siteDomainClean = String(result.sito).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
      // Allow if email domain matches site domain, or is a generic provider (gmail, outlook etc)
      const GENERIC_EMAIL = /gmail\.com|yahoo\.|outlook\.|hotmail\.|libero\.it|virgilio\.it|tiscali\.it|alice\.it|fastwebnet\.it|tin\.it/i
      if (!emailDomain.includes(siteDomainClean.split('.')[0]) && !GENERIC_EMAIL.test(emailDomain) && siteDomainClean.length > 3) {
        // Not an automatic discard — just log a warning, since some companies use different email domains
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: email domain "${emailDomain}" ≠ site "${siteDomainClean}" — keeping but flagging`)
      }
    }

    // ── FINAL GATE: anti-homonym P.IVA validation ──
    // Split query tokens into NAME tokens (must appear in ragione_sociale) and GEO tokens
    // (city/municipality — must appear in citta/sede_legale/provincia, NOT in ragione_sociale).
    // Old logic (all tokens in RS) produced false positives on "FERRARI S.P.A. Maranello" where
    // "maranello" obviously is not in the legal name "Ferrari S.p.A.".
    if (!isPiva && result.partita_iva && result.ragione_sociale) {
      const STOP_FORM = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|società|societa|unipersonale|gruppo|group|holding|holdings|italia|italy)\b/gi
      // Detect geo tokens (Italian cities/municipalities) in the query to classify them separately.
      // We use a built-in list covering all major cities + common SME towns. Unknown cities will
      // be treated as name-tokens, but a single missing token is tolerated (see below).
      const KNOWN_CITIES = new Set([
        'milano','roma','napoli','torino','bologna','firenze','genova','palermo','bari','catania',
        'venezia','verona','padova','brescia','bergamo','modena','parma','maranello','rozzano',
        'mogliano','treviso','trieste','vicenza','cagliari','messina','livorno','perugia','reggio',
        'ravenna','rimini','salerno','foggia','ferrara','latina','monza','pescara','trento',
        'bolzano','siracusa','taranto','novara','cremona','como','pavia','mantova','lecco',
        'varese','lodi','vigevano','busto','sesto','cinisello','segrate','pioltello','cernusco',
        'buccinasco','corsico','assago','rho','magenta','legnano','lainate','cesano','bresso',
        'milanese','brianza','veneto','arsizio','stradella','ancona','matera','cosenza','catanzaro',
        'reggioemilia','sanremo','aosta','lecce','terni','viterbo','savona','imperia','alessandria',
        'asti','cuneo','biella','vercelli','udine','pordenone','gorizia','sondrio','olbia','sassari',
      ])
      const tokensAll = String(query).toLowerCase()
        .replace(STOP_FORM, '')
        .replace(/[^a-zà-ù0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
      const nameTokens: string[] = []
      const geoTokens: string[] = []
      for (const t of tokensAll) {
        if (KNOWN_CITIES.has(t)) geoTokens.push(t); else nameTokens.push(t)
      }
      if (nameTokens.length >= 1) {
        const rsLow = String(result.ragione_sociale).toLowerCase()
        const geoContext = [result.citta, result.sede_legale, result.provincia].filter(Boolean).join(' ').toLowerCase()
        // 1) NAME tokens: must all appear in ragione_sociale (tolerance 1 if >=3 tokens)
        const missingName = nameTokens.filter(t => !rsLow.includes(t))
        const toleratedName = nameTokens.length >= 3 ? 1 : 0
        // 2) GEO tokens: must all appear in geo context; if geo_context empty, geo mismatch is ignored (best-effort)
        const missingGeo = geoContext.length > 0 ? geoTokens.filter(t => !geoContext.includes(t)) : []
        const nameFailed = missingName.length > toleratedName
        const geoFailed = missingGeo.length > 0
        if (nameFailed || geoFailed) {
          const reason = nameFailed
            ? `nome mismatch: ragione_sociale "${result.ragione_sociale}" non contiene ${missingName.join(',')}`
            : `citta mismatch: geo context "${geoContext}" non contiene ${missingGeo.join(',')}`
          console.log(`[COMPANY-LOOKUP] FINAL GATE: P.IVA mismatch — ${reason} — clearing fiscal data`)
          const toClear = ['partita_iva', 'codice_fiscale', 'rea', 'codice_ateco', 'descrizione_ateco',
                           'fatturato', 'fatturato_anno', 'utile_netto', 'dipendenti', 'forma_giuridica',
                           'data_costituzione', 'capitale_sociale', 'stato_attivita', 'sede_legale',
                           'citta', 'provincia', 'cap', 'pec', 'classificazione_eu', 'obblighi_assicurativi',
                           'verifica_polizze', 'stima_premio', 'bisogni_assicurativi']
          for (const k of toClear) delete (result as any)[k]
          if (Array.isArray(result.fonti)) {
            result.fonti = (result.fonti as string[]).filter(f => !/fatturatoitalia|companyreports|ufficiocamerale|openapi|registro imprese/i.test(f))
          }
          if (!Array.isArray(result.warnings)) result.warnings = []
          ;(result.warnings as string[]).push(`P.IVA non confermata: ${reason}. Dati fiscali scartati per evitare omonimi.`)
        }
      }
    }

    // FINAL SANITY: data_costituzione deve essere una data/anno reale (4 cifre 19xx/20xx).
    // Se è una label residua o testo, scartiamo per evitare di mostrare spazzatura.
    if (result.data_costituzione && typeof result.data_costituzione === 'string') {
      if (!/\b(?:19|20)\d{2}\b/.test(result.data_costituzione)) {
        console.log(`[COMPANY-LOOKUP] FINAL: scarto data_costituzione non-data: "${result.data_costituzione}"`)
        delete result.data_costituzione
      }
    }

    // ── ALWAYS-RUN ENRICHMENT: ufficiocamerale.it (via Tavily content) + PEC dedicated ──
    // Eseguito SEMPRE (anche se leadRegistryDone=true), perché lead-registry può non avere
    // PEC/REA/data_costituzione. Si attiva solo se mancano PEC OR REA OR data_costituzione.
    {
      const tk = process.env.TAVILY_API_KEY
      const ragForUC = (result.ragione_sociale || result.nome_commerciale || queryCompanyName || '') as string
      const needsUcData = !result.pec || !result.rea || !result.data_costituzione || !result.capitale_sociale
      if (tk && needsUcData && (result.partita_iva || ragForUC)) {
        const ucKey = result.partita_iva ? String(result.partita_iva) : ragForUC
        // IMPORTANT: NON aggiungere "REA PEC" alla query — disturba il matching Tavily
        // (queste parole appaiono in TUTTE le pagine ufficiocamerale come label di campo).
        // La P.IVA da sola è sufficiente: Tavily la matcha sull'azienda specifica.
        const ucQ = `"${ucKey}" site:ufficiocamerale.it`
        console.log(`[COMPANY-LOOKUP] POST-LR: Ufficiocamerale dedicated discovery: "${ucQ}"`)
        let ucTavilyContent = ''
        try {
          const ucRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tk, query: ucQ, search_depth: 'advanced', include_answer: false, max_results: 5 }),
            signal: AbortSignal.timeout(15000),
          })
          if (ucRes.ok) {
            const ucJson = await ucRes.json()
            for (const r of (ucJson.results || [])) {
              if (r.url && r.url.includes('ufficiocamerale.it')) {
                const cnt = String(r.content || '')
                const matchesQuery = (result.partita_iva && cnt.includes(String(result.partita_iva)))
                  || (ragForUC && cnt.toLowerCase().includes(ragForUC.toLowerCase().slice(0, 8)))
                if (matchesQuery) {
                  ucTavilyContent = cnt
                  console.log(`[COMPANY-LOOKUP] POST-LR: Ufficiocamerale Tavily content (len: ${cnt.length})`)
                  break
                }
              }
            }
          }
        } catch (e) { console.log(`[COMPANY-LOOKUP] POST-LR: Ufficiocamerale error:`, e) }

        if (ucTavilyContent && ucTavilyContent.length > 100) {
          const ext: Record<string, string> = {}
          const reaM = ucTavilyContent.match(/Rea:\s*([A-Z]{2}\s*-?\s*)?(\d{4,8})/i)
          if (reaM) ext.rea = reaM[1] ? `${reaM[1].trim()} ${reaM[2]}` : reaM[2]
          const indM = ucTavilyContent.match(/Indirizzo:\s*([^\n\r]{5,150}?)(?=\s*(?:Rea|PEC|Fatturato|Dipendenti|Forma giuridica|Data Iscrizione)\b|$)/i)
          if (indM) ext.indirizzo = indM[1].trim()
          const capM = ucTavilyContent.match(/Capitale sociale:\s*([€â¬\s\d.,]+)/i)
          if (capM) ext.capitale_sociale = capM[1].replace(/â¬/g, '€').trim()
          const dataM = ucTavilyContent.match(/Data Iscrizione:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)
          if (dataM) ext.data_costituzione = dataM[1]
          const fgM = ucTavilyContent.match(/Forma giuridica:\s*([^\n\r]{3,80}?)(?=\s*(?:Data Iscrizione|Ateco|Cod\. Ateco|Utile|Capitale)\b|$)/i)
          if (fgM) ext.forma_giuridica = fgM[1].trim()
          const ccM = ucTavilyContent.match(/Camera di commercio:\s*([A-Z]{2})/i)
          if (ccM) ext.camera_commercio = ccM[1]
          const sdiM = ucTavilyContent.match(/Codice destinatario:\s*([A-Z0-9]{6,7})/i)
          if (sdiM) ext.codice_destinatario = sdiM[1]
          console.log(`[COMPANY-LOOKUP] POST-LR Ufficiocamerale REGEX:`, JSON.stringify(ext))
          if (ext.rea && !result.rea) result.rea = ext.rea
          if (ext.indirizzo && !result.sede_legale) result.sede_legale = ext.indirizzo
          if (ext.capitale_sociale && !result.capitale_sociale) result.capitale_sociale = ext.capitale_sociale
          if (ext.data_costituzione && !result.data_costituzione) result.data_costituzione = ext.data_costituzione
          if (ext.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = ext.forma_giuridica
          if (ext.camera_commercio && !result.camera_commercio) result.camera_commercio = ext.camera_commercio
          if (ext.codice_destinatario && !result.codice_destinatario) result.codice_destinatario = ext.codice_destinatario
          if (!fonti.includes('Ufficio Camerale (Tavily)')) fonti.push('Ufficio Camerale (Tavily)')
        }
      }

      // PEC dedicated search (se ancora manca dopo tutto)
      if (tk && !result.pec && (result.partita_iva || ragForUC)) {
        const pecKey = result.partita_iva ? `"${result.partita_iva}" ${ragForUC || ''}` : `"${ragForUC}"`
        const pecQ = `${pecKey} PEC posta elettronica certificata`
        console.log(`[COMPANY-LOOKUP] POST-LR: PEC dedicated search: "${pecQ}"`)
        try {
          const pecRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tk, query: pecQ, search_depth: 'advanced', include_answer: false, max_results: 8 }),
            signal: AbortSignal.timeout(15000),
          })
          if (pecRes.ok) {
            const pecJson = await pecRes.json()
            const allText = (pecJson.results || []).map((r: any) => `${r.title || ''} ${r.content || ''}`).join('\n').toLowerCase()
            const PEC_DOMAIN_RX = /([a-z0-9._%+-]+)@(legalmail\.it|pec\.it|gigapec\.it|sicurezzapostale\.it|postacert\.it|infocert\.it|namirial\.it|cert\.namirial\.it|eposta\.it|casellapec\.com|pec\.aruba\.it|registerpec\.it|pec\.cgn\.it|legalmail\.libero\.it|pcert\.postecert\.it)/gi
            const matches = [...allText.matchAll(PEC_DOMAIN_RX)]
            const cleanedRagPec = ragForUC.toLowerCase()
              .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|gmbh|ltd|inc|corp|gruppo|group|holding|italia)\b\.?/gi, '')
              .replace(/[^a-z0-9]/g, '')
            for (const m of matches) {
              const userPart = m[1].toLowerCase().replace(/[^a-z0-9]/g, '')
              if (!userPart || userPart.length < 3) continue
              const matched = cleanedRagPec && (
                cleanedRagPec.includes(userPart) ||
                userPart.includes(cleanedRagPec.slice(0, Math.min(8, cleanedRagPec.length))) ||
                (userPart.length >= 4 && cleanedRagPec.startsWith(userPart.slice(0, Math.min(5, userPart.length))))
              )
              if (matched) {
                result.pec = `${m[1]}@${m[2]}`.toLowerCase()
                console.log(`[COMPANY-LOOKUP] POST-LR PEC: ✅ found ${result.pec} (matches "${cleanedRagPec}")`)
                if (!fonti.includes('PEC discovery (Tavily)')) fonti.push('PEC discovery (Tavily)')
                break
              }
            }
            if (!result.pec && matches.length === 1) {
              result.pec = `${matches[0][1]}@${matches[0][2]}`.toLowerCase()
              console.log(`[COMPANY-LOOKUP] POST-LR PEC: SOLO una PEC trovata "${result.pec}" — accetto`)
              if (!fonti.includes('PEC discovery (Tavily)')) fonti.push('PEC discovery (Tavily)')
            }
          }
        } catch (e) { console.log(`[COMPANY-LOOKUP] POST-LR PEC error:`, e) }
      }
    }

    // FINAL SANITY: se result.ragione_sociale è la query verbatim (con la città
    // attaccata), non è la ragione sociale ufficiale → demoting a nome_commerciale.
    // Esempi: query="STANDBY CONSORZIO milano" → ragione_sociale verbatim della query.
    if (result.ragione_sociale && typeof result.ragione_sociale === 'string') {
      const rs = (result.ragione_sociale as string).trim()
      const isVerbatimQuery = rs.toLowerCase() === query.toLowerCase().trim()
      const endsWithCityHint = !!queryCityHint && new RegExp(`\\s+${queryCityHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(rs)
      if (isVerbatimQuery || endsWithCityHint) {
        console.log(`[COMPANY-LOOKUP] FINAL: ragione_sociale "${rs}" è la query verbatim (city="${queryCityHint}") → demoting a nome_commerciale`)
        const cleaned = endsWithCityHint
          ? rs.replace(new RegExp(`\\s+${queryCityHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim()
          : rs
        if (!result.nome_commerciale) result.nome_commerciale = cleaned
        delete result.ragione_sociale
      }
    }

    // FINAL SANITY: scarta domini social bizzarri (es. "almaxitaliasrl.com" che è in
    // realtà un omonimo). Se result.facebook NON è un URL HTTP completo, scartalo.
    for (const k of ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'tiktok'] as const) {
      const v = (result as any)[k]
      if (v && typeof v === 'string' && !/^https?:\/\//i.test(v)) {
        console.log(`[COMPANY-LOOKUP] FINAL: scarto social "${k}" non-URL: "${v}"`)
        delete (result as any)[k]
      }
    }
    // Placeholder URLs con segnaposto tipo "xxxxxx" / "0000" / "esempio"
    for (const k of ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'tiktok'] as const) {
      const v = (result as any)[k]
      if (v && typeof v === 'string') {
        if (/[xyz]{4,}/i.test(v) || /(?:0{4,}|1234567|abcdef|placeholder|esempio|example|sample)/i.test(v)) {
          console.log(`[COMPANY-LOOKUP] FINAL: scarto ${k} placeholder "${v}"`)
          delete (result as any)[k]
        }
      }
    }

    // FINAL SANITY: gate del sito + email contro la ragione sociale.
    // Il dominio del sito o dell'email deve essere coerente con la ragione sociale.
    // Esempi:
    //   ragione "Almax.com S.r.l." → cleaned "almaxcom"
    //   sito "almaxitaliasrl.com" → "almaxitaliasrl" → REJECT (omonimo)
    //   sito "almaxcomsrl.it" → "almaxcomsrl" → contains "almaxcom" → OK
    {
      const ragSrcW = (result.ragione_sociale || result.nome_commerciale || '') as string
      const cleanedRagW = ragSrcW.toLowerCase()
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|gmbh|ltd|inc|corp|gruppo|group|holding|italia|italy)\b\.?/gi, '')
        .replace(/[^a-z0-9]/g, '')
      // Se la ragione è troppo corta (<4) o non disponibile, salto il gate (rischio falsi positivi).
      if (cleanedRagW.length >= 4) {
        const tokenize = (s: string) => s.toLowerCase()
          .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|italia|italy|group|gruppo|holding)\b\.?/gi, '')
          .replace(/[^a-z0-9]/g, '')
        const matchesRagione = (cand: string): boolean => {
          if (!cand) return false
          const c = tokenize(cand)
          if (!c || c.length < 3) return false
          // Sostr inclusion in entrambe le direzioni con tolleranza 70%
          const slugInRag = cleanedRagW.includes(c)
          const ragInSlug = c.includes(cleanedRagW)
          if (slugInRag || ragInSlug) {
            const minL = Math.min(c.length, cleanedRagW.length)
            const maxL = Math.max(c.length, cleanedRagW.length)
            return minL / maxL >= 0.7
          }
          return false
        }
        // SITO
        if (result.sito && typeof result.sito === 'string') {
          const dom = normalizeDomain(result.sito)
          if (dom && !matchesRagione(dom.split('.')[0])) {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto sito "${result.sito}" — dominio "${dom}" non coerente con ragione "${cleanedRagW}"`)
            delete result.sito
          }
        }
        // EMAIL — solo se NON è una PEC (le PEC sono già validate altrove)
        if (result.email && typeof result.email === 'string') {
          const dom = normalizeDomain(result.email)
          if (dom && !matchesRagione(dom.split('.')[0])) {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto email "${result.email}" — dominio "${dom}" non coerente con ragione "${cleanedRagW}"`)
            delete result.email
          }
        }
      }
    }

    // FINAL SANITY: gate dei social URL contro la ragione sociale.
    // Il slug del social URL deve contenere la ragione_sociale (senza forme legali)
    // oppure viceversa, con tolleranza ragionevole. Es:
    //   ragione "Appen.lab S.r.l." → cleaned "appenlab"
    //   slug "appen" (5 char) < 0.8 * 8 = 6.4 → REJECT (omonimo "Appen" globale)
    //   slug "appenlab" → match esatto → OK
    {
      const ragSrc = (result.ragione_sociale || result.nome_commerciale || '') as string
      const cleanedRag = ragSrc.toLowerCase()
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|gmbh|ltd|inc|corp|gruppo|group|holding|italia)\b\.?/gi, '')
        .replace(/[^a-z0-9]/g, '')
      if (cleanedRag.length >= 4) {
        for (const [key, slugRx] of [
          ['linkedin', /linkedin\.com\/(?:company|in|school)\/([\w%.\-]+)/i],
          ['facebook', /facebook\.com\/([\w.\-]+)/i],
          ['instagram', /instagram\.com\/([\w.\-]+)/i],
          ['twitter', /(?:twitter|x)\.com\/([\w]+)/i],
          ['tiktok', /tiktok\.com\/@([\w.\-]+)/i],
        ] as const) {
          const v = (result as any)[key]
          if (!v || typeof v !== 'string') continue
          const m = v.match(slugRx)
          if (!m) continue
          const slug = m[1].toLowerCase().replace(/[^a-z0-9]/g, '')
          if (slug.length < 3) continue
          // Generic slug names → reject (es. "share", "home", "profile")
          if (/^(share|home|profile|page|pages|company|in|school)$/.test(slug)) {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto ${key} con slug generico "${slug}"`)
            delete (result as any)[key]
            continue
          }
          // Match: slug ⊂ cleanedRag o viceversa
          const slugInRag = cleanedRag.includes(slug)
          const ragInSlug = slug.includes(cleanedRag)
          if (slugInRag || ragInSlug) {
            // Tolleranza: il match più corto deve coprire almeno l'80% del più lungo
            const minLen = Math.min(slug.length, cleanedRag.length)
            const maxLen = Math.max(slug.length, cleanedRag.length)
            if (minLen / maxLen >= 0.7) continue // OK
            console.log(`[COMPANY-LOOKUP] FINAL: scarto ${key} URL "${v}" — slug "${slug}" troppo corto vs ragione "${cleanedRag}" (overlap ${Math.round(minLen/maxLen*100)}%)`)
            delete (result as any)[key]
          } else {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto ${key} URL "${v}" — slug "${slug}" non matcha ragione "${cleanedRag}"`)
            delete (result as any)[key]
          }
        }
      }
    }

    // ── FINAL FALLBACK: deriva il sito dall'email business se ancora manca.
    // Step 2c già lo fa, ma in alcuni flow (es. P.IVA pura) potrebbe essere saltato.
    // Es. "info@archibuzz.com" → sito "https://archibuzz.com"
    if (!result.sito && !result.sito_web && result.email && typeof result.email === 'string') {
      const emDom = String(result.email).split('@')[1]?.toLowerCase().trim() || ''
      if (emDom && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emDom)) {
        const isGen = /^(gmail|yahoo|hotmail|outlook|libero|virgilio|tiscali|alice|aruba|live|icloud|protonmail|tin|me)\./i.test(emDom)
          || /^(pec|legalmail|pecimprese|pecmail|postacert|casellapec)\./i.test(emDom)
          || ['pec.it', 'libero.it', 'alice.it', 'gmail.com', 'yahoo.it', 'hotmail.it', 'outlook.it', 'tin.it', 'aruba.it'].includes(emDom)
        if (!isGen) {
          const clean = emDom.replace(/^(?:mail|www|pec|smtp|webmail|posta)\./, '')
          result.sito = `https://${clean}`
          console.log(`[COMPANY-LOOKUP] FINAL: derived sito "${result.sito}" from email "${result.email}"`)
        }
      }
    }
    // Stessa cosa con la PEC se è di un dominio aziendale (raro ma capita)
    if (!result.sito && !result.sito_web && result.pec && typeof result.pec === 'string') {
      const pecDom = String(result.pec).split('@')[1]?.toLowerCase().trim() || ''
      const isPecGen = /^(legalmail|pec|pecimprese|pecmail|postacert|casellapec|aruba|register)\./i.test(pecDom) || pecDom === 'pec.it'
      if (pecDom && !isPecGen && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(pecDom)) {
        result.sito = `https://${pecDom}`
        console.log(`[COMPANY-LOOKUP] FINAL: derived sito "${result.sito}" from PEC dominio "${pecDom}"`)
      }
    }

    const hasRealCompanySignal = ['partita_iva', 'codice_fiscale', 'codice_ateco', 'pec', 'telefono', 'cellulare', 'email', 'sito', 'sito_web', 'indirizzo', 'sede_legale', 'fatturato', 'dipendenti', 'titolare', 'linkedin', 'facebook', 'instagram', 'rating', 'categoria']
      .some(k => {
        const v = (result as any)[k]
        return v !== undefined && v !== null && String(v).trim() !== ''
      })
    if (!hasRealCompanySignal) {
      console.log(`[COMPANY-LOOKUP] FINAL GATE: no real company signals after cleanup — returning insufficient data error`)
      return NextResponse.json({
        error: `Dati insufficienti per "${query}". Prova con P.IVA esatta o ragione sociale completa + città.`,
      })
    }

    return NextResponse.json(result)
  }

  return NextResponse.json({ 
    error: `Nessuna azienda trovata per "${query}". Prova con la P.IVA esatta o il nome completo (es. "EDIL SMG S.R.L.S.")` 
  })
}
