import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { getAtecoInsurance } from '@/lib/ateco-insurance'
import { classifyCompanySize, estimateAnnualPremium, analyzeInsuranceGaps } from '@/lib/insurance-analysis'
import { buildInsuranceNeedsProfile } from '@/lib/insurance-needs-engine'
import { generateInsuranceIntelligence, type CompanyProfile } from '@/lib/insurance-intelligence'
import { getTerritorialRisk } from '@/lib/territorial-risk'
import { geminiExtractCompanyData, isGeminiEnabled } from '@/lib/gemini-search'
import { scrapeWebsiteDeep } from '@/lib/website-deep-scraper'
import {
  type CompanyIdentity, type Evidence, type TrustLevel,
  isCompanyMatch, scoreCompanyMatch, normalizeDomain, normalizeCity,
} from '@/lib/identity-gate'
import { ITALIAN_COMUNI_TOKENS } from '@/lib/italian-comuni'
import { enrichCompanyByPiva, getItPec, isOpenApiPrimary, searchByCompanyName } from '@/lib/openapi-service'

export const maxDuration = 300

function cleanContactEmail(value: unknown): string {
  let s = String(value || '').trim()
  if (!s) return ''
  s = s.replace(/^mailto:/i, '').replace(/^(?:%20|%09|\+)+/i, '')
  try { s = decodeURIComponent(s) } catch {}
  s = s.trim().replace(/^mailto:/i, '').replace(/^(?:%20|%09|\+)+/i, '').trim().toLowerCase()
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)
  return m ? m[0].replace(/^(?:%20|%09|\+)+/i, '').toLowerCase() : ''
}

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



  result.fonti = fonti
  return result
}

async function searchByName(name: string, token: string, cityHint?: string) {
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
        // Filter by city if hint provided and multiple results (avoid omonimi)
        const cityNorm = (cityHint || '').toLowerCase().replace(/[^a-zà-ù]/gi, '').trim()
        let filtered = results
        if (cityNorm.length >= 3 && results.length > 1) {
          const cityMatched = results.filter(r => {
            const rCity = String((r.registeredOffice as any)?.city || (r.registeredOffice as any)?.town || '').toLowerCase().replace(/[^a-zà-ù]/gi, '').trim()
            return rCity.includes(cityNorm) || cityNorm.includes(rCity)
          })
          if (cityMatched.length > 0) {
            console.log(`[COMPANY-LOOKUP] OpenAPI: filtered ${results.length} results → ${cityMatched.length} in "${cityHint}"`)
            filtered = cityMatched
          }
        }
        // Find best matching result by name — skip if no match
        const d = filtered.find(r => nameMatches(name, String(r.companyName || r.name || '')))
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

// ── registroaziende.it scraper — direct fetch, NO Tavily/GPT ──
// Step 1: /ricerca?q={PIVA} → find company page URL
// Step 2: fetch the company page → parse HTML for ATECO, sede, provincia, stato
async function scrapeRegistroAziende(piva: string): Promise<Record<string, string> | null> {
  try {
    // Step 1: search by P.IVA to find the company page URL
    const searchUrl = `https://registroaziende.it/ricerca?q=${piva}`
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    })
    if (!searchRes.ok) return null
    const searchHtml = await searchRes.text()
    // Find the company page link: /azienda/{slug}
    const linkMatch = searchHtml.match(/href="(\/azienda\/[^"]+)"/i)
    if (!linkMatch) { console.log(`[COMPANY-LOOKUP] registroaziende.it: no result for P.IVA ${piva}`); return null }
    const companyUrl = `https://registroaziende.it${linkMatch[1]}`
    console.log(`[COMPANY-LOOKUP] registroaziende.it: found page ${companyUrl}`)

    // Step 2: fetch the company page
    const pageRes = await fetch(companyUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    })
    if (!pageRes.ok) return null
    const html = await pageRes.text()

    const result: Record<string, string> = {}

    // Extract from OG description (very reliable): "GRATIS - G.E.M Di Gorgone Marco: (p.iva 03843580964) - MILANO (Milano) - Codice Ateco: 43.21.01: ..."
    const ogDesc = html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] || ''
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] || ''

    // Ragione sociale from title: "Dati della società G.E.M Di Gorgone Marco (03843580964)..."
    const titleNameM = ogTitle.match(/(?:società|azienda)\s+(.+?)\s*\(/)
    if (titleNameM) result.ragione_sociale = titleNameM[1].trim()
    if (!result.ragione_sociale) {
      const h1M = html.match(/<h1[^>]*>[\s\S]*?P\.IVA\s+\d{11}\s*<\/h1>/i)
      if (h1M) {
        const nameM = h1M[0].match(/:\s*(.+?),\s*P\.IVA/i)
        if (nameM) result.ragione_sociale = nameM[1].trim()
      }
    }

    // ATECO from og:description
    const atecoM = ogDesc.match(/Codice Ateco:\s*(\d{2}\.\d{2}\.\d{2})\s*:\s*([^"]+)/i)
    if (atecoM) {
      result.codice_ateco = atecoM[1]
      result.descrizione_ateco = atecoM[2].trim()
    }
    // Fallback: from page body
    if (!result.codice_ateco) {
      const atecoBody = html.match(/Codice ATECO[^<]*<[^>]*>\s*<[^>]*>[\s\S]*?(\d{2}\.\d{2}\.\d{2})\s*:\s*([^<]+)/i)
      if (atecoBody) {
        result.codice_ateco = atecoBody[1]
        result.descrizione_ateco = atecoBody[2].trim()
      }
    }
    // Also try href="/ateco/XX.XX.XX"
    if (!result.codice_ateco) {
      const atecoHref = html.match(/\/ateco\/(\d{2}\.\d{2}\.\d{2})">([^<]+)/i)
      if (atecoHref) {
        result.codice_ateco = atecoHref[1]
        result.descrizione_ateco = atecoHref[2].trim()
      }
    }

    // Città from og:description or page
    const cityM = ogDesc.match(/\) - ([A-Z\s]+)\s*\(/i)
    if (cityM) result.citta = cityM[1].trim()
    // From href="/comune/..."
    if (!result.citta) {
      const comuneM = html.match(/\/comune\/[^"]+">([^<]+)/i)
      if (comuneM) result.citta = comuneM[1].trim()
    }

    // Provincia
    const provM = html.match(/\/provincia\/[^"]+">([^<]+)/i)
    if (provM) result.provincia = provM[1].trim()

    // Stato (Attiva/Inattiva)
    const statoM = html.match(/Stato[^<]*<[^>]*>\s*<[^>]*>\s*(Attiva|Inattiva|Cessata|In liquidazione)/i)
    if (statoM) result.stato_attivita = statoM[1].trim()

    // Forma giuridica
    const formaM = html.match(/Forma giuridica[^<]*<[^>]*>\s*<[^>]*>\s*([^<]+)/i)
    if (formaM) result.forma_giuridica = formaM[1].trim()

    // Sede legale — from og:description city or page
    if (result.citta) result.sede_legale = result.citta

    if (result.codice_ateco) result.codice_ateco = normalizeAteco(result.codice_ateco) || result.codice_ateco

    console.log(`[COMPANY-LOOKUP] registroaziende.it scraped: ${JSON.stringify(result)}`)
    return Object.keys(result).length > 0 ? result : null
  } catch (e: any) {
    console.log(`[COMPANY-LOOKUP] registroaziende.it scrape error: ${e?.message}`)
    return null
  }
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
        // CompanyReports/FatturatoItalia layout: <div class="col-5"><p><b>LABEL</b></p></div><div class="col-7"><p>VALUE</p></div>
        new RegExp(`<div[^>]*class="[^"]*col-(?:[a-z]+-)?\\d+[^"]*"[^>]*>\\s*<p[^>]*>\\s*<b[^>]*>\\s*${esc}\\s*<\\/b>\\s*<\\/p>\\s*<\\/div>\\s*<div[^>]*class="[^"]*col-(?:[a-z]+-)?\\d+[^"]*"[^>]*>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>\\s*<\\/div>`, 'i'),
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
      const v = extractTableValue('Capitale sociale')
      if (v) {
        const m = v.match(/[\d.,]+/)
        if (m) data.capitale_sociale = m[0].replace(/[.,]+$/, '').trim()
      }
    }
    if (!data.capitale_sociale) {
      // TIGHT fallback: number must appear within 80 chars of label (typical table cell markup gap),
      // not 400. The looser 400-char gap previously matched fatturato values when capitale_sociale
      // was absent from the page (e.g. fatturatoitalia.it pages without that field).
      const capM = html.match(/Capitale\s*sociale[^<]{0,15}<[^>]+>\s*€?\s*([\d.,]+)\s*(?:€|<)/i)
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

  if (seenPiva.size === 1) picked.partita_iva = [...seenPiva][0]
  if (seenCf.size === 1) picked.codice_fiscale = [...seenCf][0]
  return Object.keys(picked).length > 0 ? picked : null
}

async function websiteContainsPivaQuick(siteUrl: string, piva: string): Promise<boolean> {
  const cleanPiva = String(piva || '').replace(/\D/g, '')
  if (cleanPiva.length !== 11) return false
  let base: URL
  try { base = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`) } catch { return false }
  const paths = ['/', '/contatti', '/contatti/', '/contact', '/contact/', '/contacts', '/contacts/', '/chi-siamo', '/chi-siamo/', '/privacy', '/privacy-policy', '/note-legali']
  const checks = paths.map(async (path) => {
    try {
      const res = await fetch(new URL(path, base).toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      if (!res.ok) return false
      let text = await res.text()
      text += ' ' + await fetchSameDomainFrameHtml(text, res.url || new URL(path, base).toString())
      return text.replace(/\D/g, '').includes(cleanPiva)
    } catch {
      return false
    }
  })
  const results = await Promise.allSettled(checks)
  if (results.some((r) => r.status === 'fulfilled' && r.value)) return true
  const structured = await scrapeWebsiteForPIVA(siteUrl).catch(() => null)
  return String(structured?.partita_iva || structured?.codice_fiscale || '').replace(/\D/g, '') === cleanPiva
}

function addressMatchesRegistryAddress(candidateAddress: unknown, registryAddress: unknown): boolean {
  const candidate = String(candidateAddress || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
  const registryRaw = String(registryAddress || '')
  const registry = registryRaw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!candidate || !registry) return false
  const stop = /^(via|viale|corso|piazza|piazzale|largo|vicolo|strada|str|n|num|numero|civico|italia|italy)$/i
  const tokenize = (s: string) => s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => (t.length >= 4 || /^\d{5}$/.test(t)) && !stop.test(t))
  const streetTokens = tokenize(registryRaw.split(/[,\-–]/)[0] || '')
  const allTokens = tokenize(registry)
  if (allTokens.length === 0) return false
  const streetHit = streetTokens.length === 0 || streetTokens.some(t => candidate.includes(t))
  const shared = allTokens.filter(t => candidate.includes(t)).length
  return streetHit && shared >= Math.min(2, allTokens.length)
}

function mapsLeadMatchesCompanyContext(lead: any, companyName: unknown, cityHint?: unknown): boolean {
  const normalize = (s: unknown) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const city = normalize(cityHint).replace(/\s+/g, '')
  const stop = new Set(['srl','srls','spa','sas','snc','societa','soc','responsabilita','limitata','forma','abbreviata','liquidazione','italia','italy','group','holding','milano','monza','roma','torino','napoli','bologna','firenze','genova','palermo','bari'])
  const tokens = normalize(companyName).split(/\s+/).filter(t => t.length >= 4 && !stop.has(t) && t !== city)
  if (tokens.length === 0) return false
  let host = ''
  try { host = new URL(String(lead?.website || '').startsWith('http') ? String(lead?.website) : `https://${lead?.website || ''}`).hostname.replace(/^www\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') } catch { host = '' }
  const name = normalize(lead?.name)
  const address = normalize(lead?.address)
  const nameHits = tokens.filter(t => name.includes(t)).length
  const hostHits = tokens.filter(t => host.includes(t)).length
  const addressHits = tokens.filter(t => address.includes(t)).length
  const minHits = Math.min(2, tokens.length)
  const cityOk = !city || !address || address.replace(/\s+/g, '').includes(city)
  if (tokens.length === 1 && tokens[0].length <= 4) {
    const leadCoreTokens = name.split(/\s+/).filter(t => t.length >= 3 && !stop.has(t))
    const exactName = leadCoreTokens.length === 1 && leadCoreTokens[0] === tokens[0]
    const exactHost = host === tokens[0] || host === `${tokens[0]}srl` || host === `${tokens[0]}srls`
    return cityOk && (exactName || exactHost || addressHits >= 1)
  }
  return cityOk && (nameHits >= minHits || hostHits >= minHits || addressHits >= minHits || (tokens.length === 1 && nameHits === 1 && hostHits === 1))
}

async function findCompanyReportsByName(companyName: string, cityHint?: string): Promise<Record<string, string> | null> {
  const tavilyKey = process.env.TAVILY_API_KEY
  if (!tavilyKey || !companyName || companyName.length < 3) return null
  const normalizeText = (s: string) => s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
  const compactedName = companyName.replace(/\b((?:[a-zà-ù]\.){2,}[a-zà-ù]?)\b/gi, (m) => m.replace(/\./g, ''))
  const nameTokens = compactedName.toLowerCase()
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|società|societa|unipersonale|italia|italy)\b/gi, '')
    .replace(/[^a-zà-ù0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !ITALIAN_COMUNI_TOKENS.has(t))
  if (nameTokens.length === 0) return null
  const q = `"${companyName}" ${cityHint || ''} "P. IVA" site:companyreports.it`
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: 'basic', max_results: 8 }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const results = (data.results || []) as Array<{ url?: string; title?: string; content?: string }>
    for (const r of results) {
      const text = `${r.title || ''} ${r.content || ''}`
      const textNorm = normalizeText(text)
      const missing = nameTokens.filter(t => !textNorm.includes(normalizeText(t)))
      if (missing.length > 0) continue
      const cityLow = cityHint ? normalizeText(cityHint.split(',')[0]) : ''
      if (cityLow && !textNorm.includes(cityLow)) continue

      // ★ PREFER URL-EXTRACTED P.IVA (anti-omonimia):
      // companyreports.it / ufficiocamerale.it use slug URLs ending with the P.IVA.
      // Es: https://www.companyreports.it/biotecnica-di-magagnini-...-02534560426
      // Estrarre dalla URL è inequivocabile, mentre regex sul testo può catturare la
      // P.IVA SBAGLIATA quando Tavily restituisce una pagina con più aziende elencate.
      let piva: string | undefined
      const url = String(r.url || '')
      const urlPivaM = url.match(/[-\/_](\d{11})(?:[\/?#]|$)/)
      if (urlPivaM) piva = urlPivaM[1]
      // Fallback: regex sul testo
      if (!piva) {
        const pivaM = text.match(/(?:P\.?\s*IVA|Partita\s+IVA|P\.?\s*Iva)[:\s]*(?:IT)?\s*(\d{11})/i)
        piva = pivaM?.[1]
      }
      if (!piva) continue
      console.log(`[COMPANY-LOOKUP] findCompanyReportsByName: matched P.IVA ${piva} for "${companyName}" (from ${urlPivaM ? 'URL' : 'text'})`)
      const crData = await scrapeCompanyReports(piva)
      if (crData) {
        crData.partita_iva = crData.partita_iva || piva
        return crData
      }
      const fiData = await scrapeFatturatoItalia(piva)
      if (fiData) {
        fiData.partita_iva = fiData.partita_iva || piva
        return fiData
      }
    }
  } catch (e: any) {
    console.log(`[COMPANY-LOOKUP] findCompanyReportsByName error: ${e?.message}`)
  }
  return null
}

// ── Find fatturatoitalia.it page by company name via Tavily ──
// Discovers P.IVA from the URL pattern /slug-PIVA, then calls scrapeFatturatoItalia.
// Validates slug contains at least one token of the company name (anti-homonym).
async function findFatturatoItaliaByName(companyName: string, cityHint?: string): Promise<Record<string, string> | null> {
  const tavilyKey = process.env.TAVILY_API_KEY
  if (!tavilyKey || !companyName || companyName.length < 3) return null

  // Known Italian city tokens: we separate them from the name tokens because slugs on
  // fatturatoitalia.it do NOT include city names (only legal name + P.IVA).
  // Source: ITALIAN_COMUNI_TOKENS — complete ISTAT list of all 7,904 Italian municipalities,
  // auto-generated from matteocontrini/comuni-json. Re-run scripts/generate-comuni.mjs to refresh.
  const KNOWN_CITIES_FFI = ITALIAN_COMUNI_TOKENS
  // CRITICAL FIX: collapse dotted acronyms like "O.M.I.S.A." → "OMISA" before tokenizing.
  // Without this, "O.M.I.S.A. srl sovico" tokenizes to only ["sovico"] (single letters O/M/I/S/A
  // are dropped by length≥3 filter) and matches ANY company in Sovico (e.g. unrelated "Diprol Sovico").
  const compactedName = companyName.replace(
    /\b((?:[a-zà-ù]\.){2,}[a-zà-ù]?)\b/gi,
    (m) => m.replace(/\./g, '')
  )
  const allTokens = compactedName.toLowerCase()
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
        // Also build a concatenation of consecutive single-letter slug words so that
        // slug "o-m-i-s-a-srl" → also matches name token "omisa" (acronym companies on
        // fatturatoitalia.it sometimes keep individual letters separated by hyphens).
        const concatTokens: string[] = []
        let buf = ''
        for (const w of slugWords) {
          if (w.length === 1) {
            buf += w
          } else {
            if (buf.length >= 3) concatTokens.push(buf)
            buf = ''
          }
        }
        if (buf.length >= 3) concatTokens.push(buf)
        const allSlugTokens = [...slugWords, ...concatTokens]
        const tokenMatches = nameTokens.filter(t => allSlugTokens.includes(t)).length
        if (tokenMatches < minRequired) continue
        const extraWords = slugWords.filter(w => !nameTokens.includes(w) && !legalSuffixes.has(w) && !/^\d+$/.test(w) && w.length > 1).length
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
  tipo: 'responsabilita_da_verificare' | 'settoriale' | 'raccomandata'
  stato: 'da_verificare'
  probabilita_possesso: string
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

  // Build rich context about the company for sector-specific analysis
  const ateco = String(companyData.codice_ateco || '')
  const atecoDesc = String(companyData.descrizione_ateco || '')
  const sedeLegale = String(companyData.sede_legale || companyData.citta || '')
  const forma = String(companyData.forma_giuridica || '')
  const fatturato = String(companyData.fatturato || '')
  const dipendenti = String(companyData.dipendenti || '')
  const capitale = String(companyData.capitale_sociale || '')
  const costoPersonale = String((companyData as any).costo_personale || '')
  const sito = String(companyData.sito || companyData.sito_web || '')
  const certificazioni = companyData.certificazioni ? JSON.stringify(companyData.certificazioni) : ''
  const haFlotta = companyData.ha_flotta_veicoli ? 'Sì' : ''
  const haImmobili = companyData.ha_immobili_proprieta ? 'Sì' : ''
  const appalti = companyData.partecipa_appalti_pubblici ? 'Sì' : ''
  const rischioTerr = companyData.rischio_territoriale ? JSON.stringify(companyData.rischio_territoriale) : ''

  const prompt = `Sei il miglior broker assicurativo italiano con 30 anni di esperienza nel settore specifico di questa azienda. Devi preparare un'analisi IPER-SPECIFICA pre-visita. NON dare statistiche generiche — analizza QUESTA SINGOLA azienda.

═══ PROFILO COMPLETO AZIENDA ═══
Ragione sociale: ${nome}
P.IVA: ${companyData.partita_iva || 'N/D'}
Forma giuridica: ${forma || 'Deduci dal nome'}
ATECO: ${ateco} — ${atecoDesc || cat}
Sede legale: ${sedeLegale}
Fatturato: ${fatturato || 'N/D'}
Dipendenti: ${dipendenti || 'N/D'}
Costo del personale: ${costoPersonale || 'N/D'}
Capitale sociale: ${capitale || 'N/D'}
Sito web: ${sito || 'N/D'}
${certificazioni ? `Certificazioni: ${certificazioni}` : ''}
${haFlotta ? 'Ha flotta veicoli: Sì' : ''}
${haImmobili ? 'Ha immobili di proprietà: Sì' : ''}
${appalti ? 'Partecipa ad appalti pubblici: Sì' : ''}
${rischioTerr ? `Rischio territoriale: ${rischioTerr}` : ''}

═══ ISTRUZIONI ANALISI ═══
1. PRIMA analizza l'attività SPECIFICA dell'azienda dal codice ATECO e dalla descrizione. Esempio: ATECO 46.60 "Commercio all'ingrosso di macchinari" → vende/distribuisce macchinari industriali → rischi specifici: RC Prodotti per difetti macchinari venduti, trasporto merci pesanti, garanzia post-vendita, infortuni installazione.

2. Per OGNI area assicurativa, il "motivo" deve spiegare PERCHÉ questa specifica azienda deve verificarla, citando:
   - L'attività CONCRETA (es. "vende macchinari industriali, se un macchinario difettoso causa un infortunio all'acquirente...")
   - Dati finanziari specifici solo come benchmark (es. "con €610K di fatturato e 2 dipendenti, la continuità operativa va verificata sulle figure realmente sostituibili")
   - Il contesto operativo (es. "commercio all'ingrosso implica magazzino, trasporti, consegne a clienti industriali")

3. La "domanda_broker" deve essere una domanda CHIRURGICA che un broker esperto farebbe solo a QUESTO tipo di azienda:
   - ❌ VIETATO: "Ha una polizza cyber? Solo il 12% delle PMI ce l'ha" (generico)
   - ✅ CORRETTO: "I macchinari che vendete vengono installati presso il cliente? Chi risponde se durante l'installazione si verifica un infortunio?" (specifico per commercio macchinari)

4. Stato:
   - usa SEMPRE "da_verificare".
   - NON scrivere mai che una polizza è già presente, non presente, stimata assente, certa o già verificata.
   - Puoi indicare obblighi/responsabilità solo come elementi da verificare su contratti, albo, attività concreta, portafoglio reale, massimali, esclusioni e scadenze.

5. Includi 10-14 polizze SPECIFICHE per questo settore. NON includere polizze irrilevanti.
   Per ogni polizza pensa: "Se fossi il broker di questa azienda, cosa mi preoccuperebbe di più?"

═══ FORMATO RISPOSTA ═══
JSON array, ogni elemento:
{"polizza":"nome","tipo":"responsabilita_da_verificare"|"settoriale"|"raccomandata","stato":"da_verificare","probabilita_possesso":"non nota","motivo":"ANALISI SPECIFICA per questa azienda con riferimento all'attività concreta e ai dati reali, senza affermare coperture attive o non attive","domanda_broker":"domanda CHIRURGICA specifica per questo tipo di attività"}

Ordina per priorità consulenziale: responsabilità legali/contrattuali da verificare, rischi operativi, opportunità di benchmark.
RISPONDI SOLO CON IL JSON ARRAY.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        max_tokens: 4000,
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

// ── Anti-hallucination: validate a LinkedIn URL belongs to the named person AND
// references the Italian company. Used to block omonyms (e.g. Italian "Belal A Dawali"
// being attached to a Qatar-based "Belal Al Dawall" profile).
function validateLinkedInForName(url: string, personName: string): boolean {
  if (!url || !personName) return false
  const u = String(url).toLowerCase()
  if (!u.includes('linkedin.com/in/')) return false
  const subM = u.match(/[?&]originalsubdomain=([a-z]{2})/i)
  if (subM && subM[1].toLowerCase() !== 'it') return false
  const slugM = u.match(/linkedin\.com\/in\/([a-z0-9._\-%]+)/i)
  if (!slugM) return false
  const slug = slugM[1].replace(/[^a-z0-9]/gi, '').toLowerCase()
  const tokens = String(personName).toLowerCase()
    .replace(/[^a-zà-ù\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !/^(de|del|della|di|da|du|el|al|la|le|lo|van|von|st|jr|sr)$/i.test(t))
  if (tokens.length === 0) return false
  const surname = tokens[tokens.length - 1]
  const surnameOk = slug.includes(surname) || (surname.length >= 7 && slug.includes(surname.slice(0, 6)))
  if (!surnameOk) return false
  const firstOk = tokens.slice(0, -1).some(t => slug.includes(t))
  return firstOk || (tokens.length === 1 && surnameOk)
}

function validateLinkedInWithContext(
  url: string,
  personName: string,
  ctx: { text?: string; companyName?: string; piva?: string; city?: string }
): boolean {
  if (!validateLinkedInForName(url, personName)) return false
  const text = String(ctx.text || '').toLowerCase()
  if (!text) return true
  const piva = String(ctx.piva || '').replace(/\D/g, '')
  if (piva.length === 11 && text.replace(/\D/g, '').includes(piva)) return true
  const compTokens = String(ctx.companyName || '').toLowerCase()
    .replace(/[^a-zà-ù0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !/^(srl|srls|spa|sas|snc|soc|societa|società|company|group|italia|milano|roma|napoli)$/i.test(w))
  const city = String(ctx.city || '').toLowerCase().trim()
  if (city && city.length >= 3 && text.includes(city)) return true
  if (compTokens.length === 0) return true
  const hits = compTokens.filter(t => text.includes(t)).length
  return hits >= Math.min(2, compTokens.length) || (compTokens.length === 1 && compTokens[0].length >= 6 && text.includes(compTokens[0]))
}

// ── Common Italian first names — NEVER use as sole proximity token for phone matching ──
// These are too generic: "Marco" appears in thousands of directory listings.
// Only SURNAMES (distinctive tokens) should drive phone proximity matches.
const COMMON_ITALIAN_NAMES = new Set([
  'marco','luca','paolo','anna','maria','giuseppe','giovanni','andrea','carlo','antonio',
  'stefano','roberto','alberto','francesco','mario','laura','sara','elena','chiara',
  'simone','davide','fabio','matteo','alessio','daniele','luigi','pietro','massimo',
  'claudio','enrico','sergio','maurizio','mauro','giorgio','bruno','franco','luciano',
  'salvatore','vincenzo','domenico','filippo','michele','riccardo','tommaso','nicola',
  'emanuele','vittorio','silvia','giulia','valentina','federica','alessandra','cristina',
  'barbara','monica','paola','daniela','francesca','elisabetta','marta','giovanna',
  'rosa','angela','teresa','patrizia','carla','cinzia','sabrina','manuela','raffaella',
  'marina','alessia','ilaria','martina','roberta','lorena','sonia','tiziana','grazia',
  'nadia','ornella','renato','renata','fabiana','flavia','gianluca','gianfranco',
])

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

async function fetchSameDomainFrameHtml(html: string, pageUrl: string, timeoutMs = 5000): Promise<string> {
  const tags = html.match(/<(?:iframe|frame)\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi) || []
  if (tags.length === 0) return ''
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return ''
  }
  let merged = ''
  const seen = new Set<string>()
  for (const tag of tags.slice(0, 10)) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]?.trim()
    if (!src || /^(javascript:|mailto:|tel:|#)/i.test(src)) continue
    try {
      const frameUrl = new URL(src, base)
      if (frameUrl.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue
      const href = frameUrl.toString()
      if (seen.has(href)) continue
      seen.add(href)
      const frameRes = await fetch(href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      if (frameRes.ok) merged += ' ' + await frameRes.text()
    } catch { /* skip */ }
  }
  return merged
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
  const skipFreeCameraleForDirectPiva = isPiva && isOpenApiPrimary()

  let result: Record<string, unknown> = {}
  const fonti: string[] = []

  // ─── Step 0: Extract city from query (anti-omonimia) ──
  // If user types "BIOSKIN ITALIA Bologna" we must use "Bologna" to filter Maps + fatturatoitalia
  let queryCompanyName = query
  let queryCityHint = ''
  if (!isPiva) {
    // Quick regex for common Italian city patterns at end of query
    const rawTokens = query.trim().split(/\s+/).filter(Boolean)
    const normalizeGeoToken = (s: string) => s.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['`\u2019\u02bc]/g, '')
      .replace(/[^a-z0-9]/g, '')
    // Common Italian first names that are also municipality names — NEVER treat as city
    const FIRST_NAME_EXCLUSIONS = new Set([
      'marco','andrea','lorenzo','matteo','luca','paolo','giuseppe','giovanni','antonio',
      'francesco','mario','roberto','alessandro','stefano','bruno','sergio','giorgio',
      'carlo','alberto','davide','simone','daniele','fabio','claudio','luciano',
      'vittorio','felice','maurizio','michele','raffaele','salvatore','angelo',
      'franco','leo','aldo','dario','nicola','rosa','elena','valentina','silvia',
      'marina','giulia','laura','anna','barbara','alice','diana','emma','sara',
      'giuliano','adriano','silvio','romano','remo','renato','cesare','alfredo',
      'santo','felice','guido','marcello','enzo','germano','massimo','fernando',
    ])
    let cityStart = rawTokens.length
    while (cityStart > 0) {
      const tok = normalizeGeoToken(rawTokens[cityStart - 1])
      if (!tok || !ITALIAN_COMUNI_TOKENS.has(tok) || FIRST_NAME_EXCLUSIONS.has(tok)) break
      cityStart--
    }
    if (cityStart < rawTokens.length && cityStart > 0) {
      queryCityHint = rawTokens.slice(cityStart).join(' ').trim()
      queryCompanyName = rawTokens.slice(0, cityStart).join(' ').trim()
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
          const qWords = queryCompanyName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length >= 3 && !/^(srl|srls|spa|sas|snc|di|del|della|dei|degli|delle|il|la|lo|le|gli|un|una|per|con|tra|fra)$/i.test(w))
          const nLow = best.name.toLowerCase().replace(/[^a-z0-9\s]/g, '')
          // For short personal names (2 tokens like "Marina Manzo"), require BOTH to match
          // to avoid "Clinica Manzo" matching just because it contains the surname.
          const minMatch0a = qWords.length <= 2 ? qWords.length : Math.min(2, qWords.length)
          const matchCount0a = qWords.filter((w: string) => nLow.includes(w)).length
          const hasMatch = qWords.length === 0 || matchCount0a >= minMatch0a
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
            if (best.phone) { result.telefono = best.phone; result.telefono_fonte = 'Google Maps' }
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
          delete result.ragione_sociale; delete result.sito; delete (result as any).sito_web; delete result.telefono
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
    console.log(`[COMPANY-LOOKUP] P.IVA query: "${cleanQuery}" — ${skipFreeCameraleForDirectPiva ? 'OpenAPI primary, skip free camerale pre-scrapes' : 'CompanyReports FIRST (free), OpenAPI LAST'}`)

    if (!skipFreeCameraleForDirectPiva) {

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

    // registroaziende.it DIRECT scraper — always runs for P.IVA searches
    // This gives us ATECO, città, provincia from direct HTML parsing (no GPT)
    if (cleanQuery.length === 11) {
      console.log(`[COMPANY-LOOKUP] Step 0c: registroaziende.it direct scraper for P.IVA ${cleanQuery}`)
      const raData = await scrapeRegistroAziende(cleanQuery)
      if (raData) {
        if (raData.ragione_sociale && !result.ragione_sociale) result.ragione_sociale = raData.ragione_sociale
        if (raData.codice_ateco && !result.codice_ateco) result.codice_ateco = raData.codice_ateco
        if (raData.descrizione_ateco && !result.descrizione_ateco) result.descrizione_ateco = raData.descrizione_ateco
        if (raData.citta && !result.citta) result.citta = raData.citta
        if (raData.provincia && !result.provincia) result.provincia = raData.provincia
        if (raData.sede_legale && !result.sede_legale) result.sede_legale = raData.sede_legale
        if (raData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = raData.forma_giuridica
        if (raData.stato_attivita && !result.stato_attivita) result.stato_attivita = raData.stato_attivita
        if (!fonti.includes('RegistroAziende.it')) fonti.push('RegistroAziende.it')
        console.log(`[COMPANY-LOOKUP] Step 0c: RegistroAziende found ATECO=${raData.codice_ateco || 'n/a'} città=${raData.citta || 'n/a'}`)
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
            body: JSON.stringify({ api_key: tavilyKey, query: `"${cleanQuery}" site:registroaziende.it`, search_depth: 'basic', max_results: 5 }),
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
      // For P.IVA queries: DB result must match the queried P.IVA, otherwise it's a wrong record
      // (e.g. an omonim company stored in DB with a different P.IVA).
      if (isPiva) {
        const dbPivaClean = dbResult.partita_iva ? String(dbResult.partita_iva).replace(/\D/g, '') : ''
        if (dbPivaClean && dbPivaClean !== cleanQuery) {
          console.log(`[COMPANY-LOOKUP] DB result rejected: P.IVA mismatch for query=${cleanQuery} vs db=${dbPivaClean}`)
        } else {
          // Merge DB data, preserving the user's queried P.IVA as authoritative
          result = result.ragione_sociale ? mergeResults(result, dbResult) : { ...dbResult, partita_iva: cleanQuery }
          fonti.push('Database CKB (lead esistente)')
          console.log(`[COMPANY-LOOKUP] DB found: "${result.ragione_sociale}"`)
        }
      } else {
        result = dbResult
        fonti.push('Database CKB (lead esistente)')
        console.log(`[COMPANY-LOOKUP] DB found: "${result.ragione_sociale}"`)
      }
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
    if (!fiData) {
      console.log(`[COMPANY-LOOKUP] Step 1a: no FatturatoItalia match — trying CompanyReports/UfficioCamerale by name`)
      fiData = await findCompanyReportsByName(fiQuery, cityHint)
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
          // CompanyReports ragione_sociale is AUTHORITATIVE (camerale) — BUT validate against query first!
          // If the P.IVA from the website footer belongs to a different company (e.g. hosting provider,
          // Italiaonline/PagineGialle), CompanyReports returns the WRONG company. Reject in that case.
          const crNameOk = crData.ragione_sociale ? nameMatches(queryCompanyName, crData.ragione_sociale) : false
          if (crData.ragione_sociale && !crNameOk) {
            console.log(`[COMPANY-LOOKUP] Step 1a2: REJECTED CompanyReports — name "${crData.ragione_sociale}" does NOT match query "${queryCompanyName}". Wrong P.IVA from website footer?`)
            // Also clear the wrong P.IVA we just found
            if (result.partita_iva === siteData.partita_iva) {
              console.log(`[COMPANY-LOOKUP] Step 1a2: Clearing wrong P.IVA ${result.partita_iva}`)
              delete result.partita_iva
            }
          } else {
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
        }
      } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 1a2: CompanyReports error: ${e?.message}`) }
      try {
        const fiData = await scrapeFatturatoItalia(result.partita_iva as string)
        if (fiData) {
          // Validate name before accepting fatturatoitalia data (same P.IVA mismatch risk)
          const fiNameOk = !fiData.ragione_sociale || nameMatches(queryCompanyName, fiData.ragione_sociale)
          if (!fiNameOk) {
            console.log(`[COMPANY-LOOKUP] Step 1a2: REJECTED fatturatoitalia — name "${fiData.ragione_sociale}" does NOT match query "${queryCompanyName}"`)
          } else {
            const authoritativeKeys = new Set([
              'sede_legale', 'citta', 'provincia', 'cap', 'codice_fiscale', 'codice_ateco',
              'descrizione_ateco', 'forma_giuridica', 'data_costituzione', 'rea', 'stato_attivita',
              'dipendenti', 'fatturato', 'fatturato_anno', 'utile_netto', 'utile_netto_anno',
              'costo_personale', 'capitale_sociale',
            ])
            for (const [k, v] of Object.entries(fiData)) {
              if (!v) continue
              if (authoritativeKeys.has(k) || !(result as any)[k]) {
                const previousValue = (result as any)[k]
                ;(result as any)[k] = v
                if (previousValue && previousValue !== v) {
                  console.log(`[COMPANY-LOOKUP] Step 1a2: fatturatoitalia OVERRIDE ${k}: "${previousValue}" → "${v}"`)
                }
              }
            }
            if (fiData.dipendenti) (result as any).dipendenti_fonte = 'fatturatoitalia.it'
            if (fiData.fatturato) (result as any).fatturato_fonte = 'fatturatoitalia.it'
            if (!fonti.includes('fatturatoitalia.it')) fonti.push('fatturatoitalia.it')
            console.log(`[COMPANY-LOOKUP] Step 1a2: fatturatoitalia.it enriched (dip=${fiData.dipendenti || 'N/A'} fat=${fiData.fatturato || 'N/A'})`)
          }
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

  // ── Step 1a2b: OpenAPI /IT-search — find P.IVA from name if still missing ───
  // Free tier: 100/day. Only runs when P.IVA is missing after FatturatoItalia + scraping.
  // Uses nameMatches() to avoid wrong company. If found, sets partita_iva for Step 1a3.
  if (isOpenApiPrimary() && (!result.partita_iva || String(result.partita_iva).replace(/\D/g, '').length !== 11)) {
    const searchName = String(result.ragione_sociale || queryCompanyName || query || '').trim()
    if (searchName.length >= 3) {
      console.log(`[COMPANY-LOOKUP] Step 1a2b: OpenAPI /IT-search for "${searchName}" (P.IVA still missing)`)
      try {
        let searchRes = await searchByCompanyName(searchName)
        // Retry without dots for acronym names like "G.E.M" → "GEM"
        const noDots = searchName.replace(/\./g, '').replace(/\s{2,}/g, ' ').trim()
        if ((!searchRes.success || !searchRes.data?.length) && noDots !== searchName && noDots.length >= 3) {
          console.log(`[COMPANY-LOOKUP] Step 1a2b: retrying /IT-search without dots: "${noDots}"`)
          searchRes = await searchByCompanyName(noDots)
        }
        if (searchRes.success && searchRes.data?.length) {
          console.log(`[COMPANY-LOOKUP] Step 1a2b: OpenAPI /IT-search returned ${searchRes.data.length} result(s)`)
          // Find best match by name (+ city if available)
          const queryCity = String(result.citta || queryCityHint || '').toLowerCase().trim()
          const hit = searchRes.data.find(h => {
            if (!nameMatches(searchName, h.ragione_sociale)) return false
            // If we know the city, prefer matching city
            if (queryCity && h.citta && !h.citta.toLowerCase().includes(queryCity) && !queryCity.includes(h.citta.toLowerCase())) return false
            return true
          }) || searchRes.data.find(h => nameMatches(searchName, h.ragione_sociale))
            || searchRes.data.find(h => nameMatches(noDots, h.ragione_sociale)) // fallback without dots match
          if (hit?.partita_iva) {
            console.log(`[COMPANY-LOOKUP] Step 1a2b: FOUND P.IVA ${hit.partita_iva} for "${hit.ragione_sociale}" (city: ${hit.citta || 'n/a'})`)
            result.partita_iva = hit.partita_iva
            if (hit.ragione_sociale && !result.ragione_sociale) result.ragione_sociale = hit.ragione_sociale
            if (hit.citta && !result.citta) result.citta = hit.citta
            if (hit.pec && !result.pec) {
              result.pec = hit.pec
              ;(result as any).pec_fonte = 'openapi_search'
            }
            if (hit.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = hit.forma_giuridica
            if (!fonti.includes('OpenAPI.it (Ricerca)')) fonti.push('OpenAPI.it (Ricerca)')
          } else {
            console.log(`[COMPANY-LOOKUP] Step 1a2b: OpenAPI /IT-search — no matching result for "${searchName}" (${searchRes.data.length} candidates checked)`)
          }
        } else {
          console.log(`[COMPANY-LOOKUP] Step 1a2b: OpenAPI /IT-search returned NO results for "${searchName}" (success=${searchRes.success}, error=${searchRes.errorMessage || 'none'})`)
        }
      } catch (e: any) {
        console.log(`[COMPANY-LOOKUP] Step 1a2b: OpenAPI /IT-search error: ${e?.message}`)
      }
    }
  }

  // ── Step 1a3: OpenAPI.it PRIMARY enrichment (Tier Smart Pro) ─────────────────
  // Fetches /IT-advanced (+ conditionally /IT-stakeholders) for certified Registro Imprese data.
  // Fills: titolare (authoritative!), soci with CF and quote, forma giuridica, ATECO, bilancio,
  // PEC, sede, REA, capitale. Later Tavily/GPT steps will skip fields already filled here.
  // Cached 180 days per P.IVA — subsequent lookups cost €0.
  if (isOpenApiPrimary() && typeof result.partita_iva === 'string' && String(result.partita_iva).replace(/\D/g, '').length === 11) {
    const pivaForOa = String(result.partita_iva).replace(/\D/g, '')
    console.log(`[COMPANY-LOOKUP] Step 1a3: OpenAPI primary enrichment for P.IVA ${pivaForOa}`)
    try {
      const oa = await enrichCompanyByPiva(pivaForOa)
      if (oa) {
        // Guard: protect against stale cache / wrong P.IVA (site footer picked the wrong one)
        // ★ When user searched by P.IVA directly, SKIP name guard — the P.IVA IS the authoritative identifier
        const oaNameOk = isPiva || !oa.ragione_sociale || !queryCompanyName || nameMatches(queryCompanyName, oa.ragione_sociale)
        if (!oaNameOk) {
          console.log(`[COMPANY-LOOKUP] Step 1a3: REJECTED OpenAPI — ragione sociale "${oa.ragione_sociale}" does NOT match query "${queryCompanyName}"`)
        } else {
          // Ragione sociale (authoritativa — Camera di Commercio)
          if (oa.ragione_sociale && !result.ragione_sociale) result.ragione_sociale = oa.ragione_sociale
          // Dati strutturali (authoritativi da Registro Imprese)
          const authoritativeCopy = [
            'forma_giuridica', 'forma_giuridica_codice', 'stato_attivita',
            'codice_ateco', 'descrizione_ateco',
            'data_costituzione', 'data_registrazione', 'data_cessazione',
            'codice_rea', 'cciaa', 'sede_legale', 'citta', 'provincia', 'cap',
            'indirizzo_via', 'indirizzo_numero_civico', 'frazione', 'codice_catastale', 'regione',
            'capitale_sociale', 'codice_fiscale', 'pec', 'sito_web',
          ] as const
          // Map OpenAPI field names to our result field names where different
          if (oa.sito_web && !result.sito) result.sito = oa.sito_web
          for (const k of authoritativeCopy) {
            if ((oa as any)[k] && !(result as any)[k]) (result as any)[k] = (oa as any)[k]
          }
          if (oa.pec) {
            result.pec = String(oa.pec).trim().toLowerCase()
            ;(result as any).pec_fonte = 'openapi_registro_imprese'
          } else if (!result.pec) {
            try {
              const oaPec = await getItPec(pivaForOa)
              if (oaPec.success && oaPec.data?.pec) {
                result.pec = oaPec.data.pec
                ;(result as any).pec_fonte = oaPec.fromCache ? 'openapi_pec_cache' : 'openapi_pec'
                if (!fonti.includes('OpenAPI.it (PEC)')) fonti.push('OpenAPI.it (PEC)')
                console.log(`[COMPANY-LOOKUP] Step 1a3: OpenAPI PEC filled from ${oaPec.fromCache ? 'cache' : '/IT-pec'}: ${result.pec}`)
              }
            } catch (e: any) {
              console.log(`[COMPANY-LOOKUP] Step 1a3: OpenAPI PEC fallback skipped — ${e?.message || e}`)
            }
          }
          // GPS coordinates
          if (typeof oa.gps_lat === 'number' && typeof oa.gps_lng === 'number') {
            ;(result as any).gps_lat = oa.gps_lat
            ;(result as any).gps_lng = oa.gps_lng
          }
          // ATECO storico
          if (oa.ateco_2022) (result as any).ateco_2022 = oa.ateco_2022
          if (oa.ateco_2007) (result as any).ateco_2007 = oa.ateco_2007
          // Stato Agenzia Entrate
          if (oa.stato_agenzia_entrate) (result as any).stato_agenzia_entrate = oa.stato_agenzia_entrate
          // SDI
          if (oa.codice_sdi) {
            ;(result as any).codice_sdi = oa.codice_sdi
            if (oa.codice_sdi_timestamp) (result as any).codice_sdi_timestamp = oa.codice_sdi_timestamp
          }
          // Gruppo IVA
          if (oa.gruppo_iva) (result as any).gruppo_iva = oa.gruppo_iva
          // Metadata OpenAPI
          if (oa.openapi_id) (result as any).openapi_id = oa.openapi_id
          if (oa.timestamp_creazione) (result as any).timestamp_creazione = oa.timestamp_creazione
          if (oa.timestamp_aggiornamento) (result as any).timestamp_aggiornamento = oa.timestamp_aggiornamento
          // Bilancio — OpenAPI è bilancio depositato Camera di Commercio → SEMPRE sovrascrive
          // (fatturatoitalia/scraping possono aver messo valori errati come l'anno al posto dell'importo)
          if (typeof oa.fatturato === 'number') {
            result.fatturato = String(oa.fatturato)
            ;(result as any).fatturato_fonte = 'openapi_registro_imprese'
            if (oa.fatturato_anno) (result as any).fatturato_anno = String(oa.fatturato_anno)
          }
          if (typeof oa.dipendenti === 'number') {
            result.dipendenti = String(oa.dipendenti)
            ;(result as any).dipendenti_fonte = 'openapi_registro_imprese'
          }
          if (typeof oa.costo_personale === 'number') {
            ;(result as any).costo_personale = String(oa.costo_personale)
          }
          if (typeof oa.patrimonio_netto === 'number') {
            ;(result as any).patrimonio_netto = String(oa.patrimonio_netto)
          }
          if (typeof oa.totale_attivo === 'number') {
            ;(result as any).totale_attivo = String(oa.totale_attivo)
          }
          if (typeof oa.ral_medio === 'number') {
            ;(result as any).ral_medio = String(oa.ral_medio)
          }
          // Storico bilanci (fino a 7 anni)
          if (oa.storico_bilanci && oa.storico_bilanci.length > 0) {
            ;(result as any).storico_bilanci = oa.storico_bilanci
          }
          // Titolare / Legale Rappresentante — CRITICO: questa è la fonte di verità, batte Tavily
          if (oa.titolare_best) {
            result.titolare = oa.titolare_best.nomeCompleto
            result.ruolo_titolare = oa.titolare_best.ruolo
            ;(result as any).titolare_fonte = oa.titolare_best.source === 'stakeholders'
              ? 'openapi_stakeholders'
              : 'openapi_shareholders'
            if (oa.titolare_best.taxCode) (result as any).codice_fiscale_titolare = oa.titolare_best.taxCode
            if (oa.titolare_best.dataNascita) (result as any).data_nascita_titolare = oa.titolare_best.dataNascita
            if (typeof oa.titolare_best.eta === 'number') (result as any).eta_titolare = String(oa.titolare_best.eta)
            if (oa.titolare_best.sesso) (result as any).sesso_titolare = oa.titolare_best.sesso
            console.log(`[COMPANY-LOOKUP] Step 1a3: Titolare CERTIFICATO = "${oa.titolare_best.nomeCompleto}" (${oa.titolare_best.ruolo}, fonte=${(result as any).titolare_fonte})`)
          }
          // Persone (soci + manager uniti — Step 1b Method 2 userà quest'array se il titolare non è già set)
          const personeOa: Array<Record<string, unknown>> = []
          for (const sh of (oa.shareholders || [])) {
            if (!sh.nome || !sh.cognome) continue
            const nome = `${sh.nome.charAt(0).toUpperCase()}${sh.nome.slice(1).toLowerCase()} ${sh.cognome.charAt(0).toUpperCase()}${sh.cognome.slice(1).toLowerCase()}`
            personeOa.push({
              nome,
              ruolo: (oa.shareholders?.length === 1) ? 'Socio Unico' : 'Socio',
              cf: sh.taxCode,
              quota: typeof sh.percentShare === 'number' ? `${sh.percentShare}%` : undefined,
            })
          }
          for (const m of (oa.managers || [])) {
            if (!personeOa.find(p => {
              const pName = String(p.nome).toLowerCase()
              const mName = String(m.nomeCompleto).toLowerCase()
              const mNameReversed = mName.split(' ').reverse().join(' ')
              return pName === mName || pName === mNameReversed
            })) {
              personeOa.push({
                nome: m.nomeCompleto,
                ruolo: m.isLegalRep ? `${m.ruolo} (Legale Rappresentante)` : (m.ruolo || 'Dirigente'),
                cf: m.taxCode,
                data_nascita: m.dataNascita,
                eta: typeof m.eta === 'number' ? String(m.eta) : undefined,
                sesso: m.sesso,
              })
            }
          }
          if (personeOa.length > 0) {
            result.persone = personeOa
          }
          const sourceLabel = oa.live_calls > 0 ? 'OpenAPI.it (Registro Imprese)' : 'OpenAPI.it (cache)'
          if (!fonti.includes(sourceLabel)) fonti.push(sourceLabel)
          console.log(`[COMPANY-LOOKUP] Step 1a3: OpenAPI enriched — cost=€${oa.cost_incurred_eur.toFixed(3)} (live=${oa.live_calls}, cache=${oa.cached_hits}), persone=${personeOa.length}, fatt=${oa.fatturato ?? 'n/a'}, dip=${oa.dipendenti ?? 'n/a'}`)
        }
      } else {
        console.log(`[COMPANY-LOOKUP] Step 1a3: OpenAPI returned no data for ${pivaForOa}`)
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] Step 1a3: OpenAPI error: ${e?.message}`)
    }
  }

  if (isPiva && !result.ragione_sociale && cleanQuery.length === 11) {
    console.log(`[COMPANY-LOOKUP] Step 1a3b: OpenAPI did not provide company name for P.IVA ${cleanQuery} — trying free P.IVA fallbacks`)
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
      if (crData.titolare && !result.titolare) {
        result.titolare = crData.titolare
        result.ruolo_titolare = 'Amministratore'
      }
      if (!fonti.includes('CompanyReports.it')) fonti.push('CompanyReports.it')
      console.log(`[COMPANY-LOOKUP] Step 1a3b: CompanyReports fallback ${crData.ragione_sociale ? `found "${crData.ragione_sociale}"` : 'returned partial data'}`)
    }
    if (!result.ragione_sociale) {
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
        if (!fonti.includes('fatturatoitalia.it')) fonti.push('fatturatoitalia.it')
        console.log(`[COMPANY-LOOKUP] Step 1a3b: FatturatoItalia fallback ${fiData.ragione_sociale ? `found "${fiData.ragione_sociale}"` : 'returned partial data'}`)
      }
    }
  }

  // Track whether OpenAPI /IT-advanced enrichment was already performed.
  // If P.IVA was NOT available at Step 1a3, openApiDone=false so we can catch up later.
  let openApiDone = isOpenApiPrimary() && typeof result.partita_iva === 'string' && String(result.partita_iva).replace(/\D/g, '').length === 11

  // ── OpenAPI "rich" flag: when OpenAPI provided the core camerale fields we can skip
  // Tavily/Gemini/GPT for those same fields, saving credits. Contacts/social/insurance still run.
  // ★ OpenAPI è fonte PRIMARIA: se ha dato ragione_sociale + ATECO + fatturato → skip fonti gratuite
  // per dati aziendali. Titolare può venire da shareholders (IT-advanced) o managers (IT-stakeholders).
  const hasOpenApiRegistrySource = fonti.some(f => /OpenAPI\.it/i.test(f)) || Boolean((result as any).openapi_id)
  const oaFonte = String((result as any).fatturato_fonte || '')
  const openApiRich = Boolean(
    hasOpenApiRegistrySource &&
    result.ragione_sociale &&
    result.partita_iva &&
    (result.codice_ateco || result.forma_giuridica || result.stato_attivita || result.citta || result.sede_legale || /openapi/i.test(oaFonte))
  )
  let openApiCameraleAvailable = openApiRich
  // Titolare da OpenAPI — verificato separatamente perché potrebbe mancare per micro-imprese
  const openApiTitolare = Boolean(
    result.titolare && (result as any).titolare_fonte && /openapi/i.test(String((result as any).titolare_fonte))
  )
  if (openApiRich) {
    console.log(`[COMPANY-LOOKUP] openApiRich=true — OpenAPI è fonte primaria. Skip Tavily/Gemini per dati camerali. Titolare OpenAPI=${openApiTitolare ? result.titolare : 'non trovato, cercherà con fonti gratuite'}`)
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

  // ─── Step 1a4: Maps single-business call for P.IVA queries ───
  // Maps was skipped at Step 0a (isPiva=true). Now we have ragione_sociale from OpenAPI/CR,
  // so we can search Maps by name to get sito/telefono/indirizzo BEFORE Tavily name search
  // (which often finds wrong sites for generic names like "Rocco Stefano").
  if (isPiva && result.ragione_sociale && (!result.sito || !result.telefono)) {
    const mapsCity = (result.citta || queryCityHint || '') as string
    const mapsName = String(result.ragione_sociale)
    const mapsPiva = String(result.partita_iva || cleanQuery).replace(/\D/g, '')
    console.log(`[COMPANY-LOOKUP] Step 1a4: Maps for P.IVA query — searching "${mapsName}" city="${mapsCity}"`)
    try {
      const mapsRes = await fetch(`${backendUrl}/search-maps-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_name: mapsName, city: mapsCity, max_results: 1 }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => null)
      if (mapsRes && mapsRes.ok) {
        const mapsData = await mapsRes.json().catch(() => null) as any
        const leads = (mapsData && Array.isArray(mapsData.results)) ? mapsData.results : []
        const lead = leads[0]
        if (lead && typeof lead === 'object') {
          console.log(`[COMPANY-LOOKUP] Step 1a4: Maps found "${lead.name}" — sito=${lead.website || 'N/A'}, tel=${lead.phone || 'N/A'}`)
          const mapsWebsite = typeof lead.website === 'string' ? lead.website : ''
          const mapsWebsiteVerified = mapsWebsite
            ? await websiteContainsPivaQuick(mapsWebsite, mapsPiva)
            : false
          const mapsAddressVerified = addressMatchesRegistryAddress(lead.address, result.sede_legale || result.indirizzo)
          const mapsContextVerified = mapsLeadMatchesCompanyContext(lead, result.ragione_sociale || queryCompanyName, result.citta || queryCityHint)
          const mapsIdentityVerified = mapsWebsiteVerified || mapsAddressVerified || mapsContextVerified
          if (!mapsIdentityVerified && (lead.website || lead.phone || lead.address)) {
            console.log(`[COMPANY-LOOKUP] Step 1a4: REJECTED Maps contacts/site — website/address do not confirm queried P.IVA ${mapsPiva}`)
          }
          if (mapsIdentityVerified) {
            if (lead.website && !result.sito) result.sito = lead.website
            if (lead.phone && !result.telefono) { result.telefono = lead.phone; result.telefono_fonte = mapsWebsiteVerified ? 'Google Maps (P.IVA verificata su sito)' : mapsAddressVerified ? 'Google Maps (indirizzo verificato)' : 'Google Maps (nome/sede verificati)' }
            if (lead.address && !result.indirizzo) result.indirizzo = lead.address
            if (lead.category && !result.categoria) result.categoria = lead.category
            if (lead.rating) result.rating = lead.rating
            if (lead.reviews) result.reviews_count = lead.reviews
            if ((result.sito || result.telefono) && !fonti.includes('Google Maps')) fonti.push('Google Maps')
          }
        }
      }
    } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 1a4: Maps error: ${e?.message}`) }
  }

  // ─── Step 2b: Call lead-registry for camerale data + titolare (NO person-lookup = no deadlock) ───
  const companyNameForLR = (result.ragione_sociale || query) as string
  let leadRegistryDone = false
  // ★ ANTI-FABRICATION: when searching by P.IVA and no authoritative source returned
  // a ragione_sociale, lead-registry would search the web with just a number string,
  // find random pages, and GPT would FABRICATE everything (wrong titolare, fatturato, email).
  // Seen: P.IVA 03843580964 (G.E.M DI GORGONE MARCO) → GPT invented "Rinaldo Pitocco", "peteglia.com", €6M.
  // FIX: skip lead-registry when we only have a bare P.IVA with no real company name.
  let pivaOnlyNoName = isPiva && !result.ragione_sociale
  if (pivaOnlyNoName) {
    console.log(`[COMPANY-LOOKUP] Step 2b: SKIPPED — P.IVA query with no ragione_sociale found from authoritative sources. lead-registry would fabricate data.`)
  } else if (openApiRich) {
    // OpenAPI already gave us complete camerale data — mark as done and skip expensive lead-registry call
    leadRegistryDone = true
    console.log(`[COMPANY-LOOKUP] Step 2b: SKIPPED (openApiRich) — OpenAPI already provided camerale data`)
  } else if (companyNameForLR) {
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

  // ─── Step 2b1.5: Extract P.IVA from website immediately if we have site but no P.IVA ───
  if (!result.partita_iva && result.sito) {
    const siteForPiva = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
    console.log(`[COMPANY-LOOKUP] Step 2b1.5: extracting P.IVA from website ${siteForPiva}`)
    try {
      const siteRes = await fetch(siteForPiva, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(8000), redirect: 'follow',
      })
      if (siteRes.ok) {
        let siteHtml = await siteRes.text()
        siteHtml += ' ' + await fetchSameDomainFrameHtml(siteHtml, siteRes.url || siteForPiva)
        // Same regex patterns as lead-registry
        const pivaPatterns = [
          /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
          /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
          /\bIT(\d{11})\b/g,
          /\bP\.?\s?I\.?[\s:.\-]+(?:IT)?[\s]?(\d{11})/gi,
        ]
        for (const re of pivaPatterns) {
          re.lastIndex = 0
          const m = re.exec(siteHtml)
          if (m?.[1]) {
            result.partita_iva = m[1]
            console.log(`[COMPANY-LOOKUP] Step 2b1.5: FOUND P.IVA ${m[1]} from website`)
            break
          }
        }
      }
    } catch (e: any) { console.log(`[COMPANY-LOOKUP] Step 2b1.5: website fetch failed: ${e?.message}`) }
  }

  // ─── Step 2b2: Find P.IVA from name via CompanyReports + FatturatoItalia (name searches) ───
  // For name searches, Steps 0/0a/0c only run for P.IVA input. If lead-registry didn't find P.IVA,
  // we try CompanyReports by name to get it, then Steps 2d/2e will scrape financial data.
  if (!isPiva && !result.partita_iva && result.ragione_sociale) {
    const nameForCR = String(result.ragione_sociale).trim()
    console.log(`[COMPANY-LOOKUP] Step 2b2: finding P.IVA for "${nameForCR}" via findCompanyReportsByName`)
    const crByName = await findCompanyReportsByName(nameForCR, (result.citta || queryCityHint || '') as string)
    if (crByName?.partita_iva) {
      const crPiva = String(crByName.partita_iva).replace(/\D/g, '')
      if (crPiva.length === 11) {
        console.log(`[COMPANY-LOOKUP] Step 2b2: FOUND P.IVA ${crPiva} from CompanyReports by name`)
        result.partita_iva = crPiva
      }
    }
    // Also try direct CompanyReports scrape if name looks exact enough
    if (!result.partita_iva) {
      const crData = await scrapeCompanyReports(nameForCR)
      if (crData?.ragione_sociale) {
        // Validate name matches
        const crName = crData.ragione_sociale.toLowerCase().replace(/[^a-zà-ù0-9\s]/gi, '')
        const ourName2 = nameForCR.toLowerCase().replace(/[^a-zà-ù0-9\s]/gi, '')
        const crTokens = crName.split(/\s+/).filter((t: string) => t.length >= 3)
        const ourTokens2 = ourName2.split(/\s+/).filter((t: string) => t.length >= 3)
        const shared = ourTokens2.filter((t: string) => crTokens.some((ct: string) => ct.includes(t) || t.includes(ct)))
        if (shared.length >= Math.min(2, ourTokens2.length)) {
          console.log(`[COMPANY-LOOKUP] Step 2b2: CompanyReports by name → P.IVA not in URL, but got financial data`)
          if (crData.fatturato && !result.fatturato) result.fatturato = crData.fatturato
          if (crData.fatturato_anno && !result.fatturato_anno) result.fatturato_anno = crData.fatturato_anno
          if (crData.dipendenti && !result.dipendenti) result.dipendenti = crData.dipendenti
          if (crData.codice_ateco && !result.codice_ateco) result.codice_ateco = crData.codice_ateco
          if (crData.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = crData.forma_giuridica
          if (!fonti.includes('CompanyReports.it')) fonti.push('CompanyReports.it')
        }
      }
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
      // Blacklist completa di domini PROVIDER PEC italiani (NON sono siti aziendali)
      const PROVIDER_PEC_DOMAINS = new Set([
        'pec.it', 'arubapec.it', 'legalmail.it', 'pecimprese.it', 'pecmail.it',
        'postacert.it', 'postecert.it', 'sicurezzapostale.it', 'registerpec.it',
        'mypec.eu', 'actaliscertymail.it', 'casellapec.com', 'casellapec.it',
        'pec.aruba.it', 'cert.legalmail.it', 'open.legalmail.it', 'pec.cciaa.it',
        'pec.giuffre.it', 'namirial.it', 'infocert.it', 'register.it',
      ])
      const domLow = emailDomain.toLowerCase()
      const isPec = PROVIDER_PEC_DOMAINS.has(domLow)
        || /^(pec|legalmail|pecimprese|pecmail|postacert|certmail)\./i.test(emailDomain)
        || /\.(pec|legalmail|pecimprese|arubapec|postecert|sicurezzapostale|registerpec|mypec|actaliscertymail|casellapec|namirial|infocert)\./i.test(emailDomain)
        || /\.(pec\.it|legalmail\.it|arubapec\.it|pecimprese\.it)$/i.test(emailDomain)
      if (!isGeneric && !isPec) {
        // ANTI-MISMATCH: only derive website if the email domain is plausibly related to the company name.
        // E.g. "Hintown Brera's Gem" with email "info@offersitaly.com" — "offersitaly" has nothing to do
        // with the company, so we reject the derivation (likely a wrong email from a different company).
        const compNameForDomain = String(result.ragione_sociale || queryCompanyName || '').toLowerCase()
        const compTokensDom = compNameForDomain
          .replace(/[^a-zà-ù0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 4 && !['srl','srls','spa','sas','snc','italia','italy','group','holding','company','azienda','impresa','ditta'].includes(t))
        const domBase = domLow.split('.')[0].replace(/[^a-z0-9]/g, '')
        const hasOverlap = compTokensDom.length === 0 // if no tokens, can't reject — accept
          || compTokensDom.some(t => domBase.includes(t.slice(0, 4)) || t.includes(domBase.slice(0, 4)))
        if (hasOverlap) {
          result.sito = `https://${emailDomain}`
          console.log(`[COMPANY-LOOKUP] Step 2c: Derived website from email: ${result.sito}`)
        } else {
          console.log(`[COMPANY-LOOKUP] Step 2c: REJECTED website derivation from email — domain "${emailDomain}" doesn't match company "${compNameForDomain}"`)
        }
      }
    }
  }
  // Strategy 2: Tavily search for company website (if still no site)
  // ★ Skip when we have a bare P.IVA with no name — Tavily would find random/wrong websites
  // ★ Use LIVE check: ragione_sociale may have been found by Search 1 (Tavily) AFTER pivaOnlyNoName was computed.
  // Previously, pivaOnlyNoName blocked this step even after ragione_sociale was discovered.
  if (!result.sito && process.env.TAVILY_API_KEY && (result.ragione_sociale || !isPiva)) {
    const compNameForSite = (result.ragione_sociale || query) as string
    const cityForSite = (typeof result.citta === 'string' && result.citta) || queryCityHint || ''
    const pivaForSite = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''

    // Hostnames that we never want to pick as the company website
    const EXCLUDE_RE = /google|facebook|instagram|linkedin|twitter|paginegialle|paginebianche|reteimprese|yelp|tripadvisor|wikipedia|youtube|atoka|reportaziende|companyreports|ufficiocamerale|registroimprese|registroaziende|dnb|kompass|infocamere|cerved|fattureitalia|fatturatoitalia|visura\.pro|informazione-aziende|tuttitalia|infoimprese|breezy|greenhouse|lever\.co|workable|jobvite|bamboohr|workday|myworkdayjobs|recruitee|smartrecruiters|teamtailor|personio|zohorecruit|hireology|jazzhr|applytojob|indeed|glassdoor|infojobs|subito|immobiliare|idealista|medium\.com|substack|github\.io|netlify\.app|vercel\.app|uniba|unibo|unimi|unipd|unicatt|univ-|university|edu\./

    // Words from the company name that the hostname must contain (≥4 chars, excluding legal-form suffixes)
    const compWords = String(compNameForSite).toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length >= 4 && !/^(srl|srls|spa|sas|snc|società|societa|societa|group|italia|italy|associati|associates|studio|consulting|consulenza|responsabilita|responsabilità|limitata|limitato|azioni|accomandita|semplice|agenzia|impresa|ditta|commerciale|industriale|artigiana)$/i.test(w))
    // ★ Detect dotted acronyms in company name (e.g. "G.E.M" → "gem", "A.B.C." → "abc")
    // These are often the domain name (gem.it, abc.it) but get lost when dots are stripped.
    const acronymMatches = String(compNameForSite).match(/\b(?:[A-Za-zÀ-ú]\.){2,}[A-Za-zÀ-ú]?\b/g) || []
    const acronymTokens = acronymMatches.map(a => a.replace(/\./g, '').toLowerCase()).filter(a => a.length >= 2)
    // ★ ANTI-OMONIMIA: common Italian first names match too many unrelated domains
    // (e.g. "marco" matches "marcodimilanoshoes.com"). When multiple tokens exist,
    // require the MOST DISTINCTIVE one (longest, not a common name) to appear.
    const COMMON_NAMES = new Set(['marco','luca','paolo','anna','maria','giuseppe','giovanni','andrea','carlo','antonio','stefano','roberto','alberto','francesco','mario','laura','sara','elena','chiara','simone','davide','fabio','matteo','alessio','daniele','luigi','pietro','massimo','claudio','enrico','sergio','maurizio','mauro','giorgio','bruno','franco','luciano','salvatore','vincenzo','domenico','filippo','michele','riccardo','tommaso','nicola','emanuele','vittorio','silvia','giulia','valentina','federica','alessandra','cristina','barbara','monica','paola','daniela','francesca','elisabetta','marta','giovanna','rosa','angela','teresa','patrizia','carla','cinzia','sabrina','manuela','raffaella'])
    const distinctiveWords = [...compWords.filter((w: string) => !COMMON_NAMES.has(w)), ...acronymTokens]
    // If we have distinctive words, use ONLY those for matching; otherwise fall back to all words
    const matchWords = distinctiveWords.length > 0 ? distinctiveWords : compWords

    // Helper: try a Tavily query, return first hostname that passes filters
    const tryTavily = async (tQuery: string, mode: 'name' | 'piva'): Promise<string | null> => {
      try {
        const tRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: tQuery, search_depth: 'basic', max_results: 5 }),
          signal: AbortSignal.timeout(12000),
        })
        if (!tRes.ok) return null
        const tData = await tRes.json()
        for (const r of (tData.results || [])) {
          if (!r.url) continue
          try {
            const h = new URL(r.url).hostname.replace(/^www\./, '').toLowerCase()
            if (EXCLUDE_RE.test(h)) continue
            if (mode === 'piva') {
              const resultText = `${r.title || ''} ${r.content || ''} ${r.url || ''}`
              if (pivaForSite && !resultText.replace(/\D/g, '').includes(pivaForSite)) {
                const verified = await websiteContainsPivaQuick(r.url, pivaForSite)
                if (!verified) {
                  console.log(`[COMPANY-LOOKUP] Step 2c: REJECT "${h}" — Tavily/P.IVA result does not expose queried P.IVA ${pivaForSite}`)
                  continue
                }
              }
              return r.url.split('/').slice(0, 3).join('/')
            }
            // Enforce hostname-name match for BOTH name and P.IVA queries.
            // A page mentioning a P.IVA may link to unrelated websites (e.g. peteglia.com for G.E.M Di Gorgone Marco).
            // Only skip name matching if we have NO company name tokens at all.
            // For short personal names (2 tokens like "Manzo Marina"), require BOTH tokens in domain
            // to avoid "clinicamanzo.it" matching just because it contains the surname.
            // For longer company names (3+ matchWords), 1 match is enough (Step 6e-PIVA will validate).
            const minDomainTokens = matchWords.length >= 2 && matchWords.length <= 3 ? 2 : 1
            const domainHits = matchWords.filter((w: string) => h.includes(w)).length
            if (matchWords.length > 0 && domainHits < minDomainTokens) {
              console.log(`[COMPANY-LOOKUP] Step 2c: REJECT "${h}" — only ${domainHits}/${minDomainTokens} required tokens matched [${matchWords.join(',')}]`)
              continue
            }
            return r.url.split('/').slice(0, 3).join('/')
          } catch { /* skip */ }
        }
      } catch { /* Tavily failed */ }
      return null
    }

    // 2.0 — P.IVA-based search FIRST (the website's footer almost always lists the P.IVA → most reliable)
    // For P.IVA queries this runs first; generic name searches for "Rocco Stefano" can find wrong sites.
    if (!result.sito && pivaForSite.length === 11) {
      const pivaQuery = `"${pivaForSite}" sito ufficiale azienda contatti`
      console.log(`[COMPANY-LOOKUP] Step 2c: Tavily search by P.IVA "${pivaForSite}"`)
      const fromPiva = await tryTavily(pivaQuery, 'piva')
      if (fromPiva) {
        result.sito = fromPiva
        console.log(`[COMPANY-LOOKUP] Step 2c: Tavily(P.IVA) found website: ${result.sito}`)
      }
    }

    // 2.1 — Name-based search (city hint added to disambiguate omonimie) — only if P.IVA search didn't find a site
    if (!result.sito) {
      const nameQuery = cityForSite ? `"${compNameForSite}" ${cityForSite} sito ufficiale` : `"${compNameForSite}" sito ufficiale`
      console.log(`[COMPANY-LOOKUP] Step 2c: Tavily search by name "${nameQuery}"`)
      const fromName = await tryTavily(nameQuery, 'name')
      if (fromName) {
        result.sito = fromName
        console.log(`[COMPANY-LOOKUP] Step 2c: Tavily(name) found website: ${result.sito}`)
      }
    }
  }
  // ★ Step 2c: ALWAYS run scrapeWebsiteDeep when we have a sito.
  // Reason: even if all base fields are filled (e.g. lead-registry hallucinated them), the website
  // can still expose ADDITIONAL phones/emails for `tutti_telefoni`/`tutte_email` arrays, AND the
  // P.IVA in the footer is the most authoritative source (overrides lead-registry omonimia).
  if (result.sito) {
    const missingFields = [!result.partita_iva && 'P.IVA', !result.telefono && 'telefono fisso', !result.cellulare && 'cellulare', !result.email && 'email'].filter(Boolean).join(', ') || 'none'
    console.log(`[COMPANY-LOOKUP] Step 2c: Missing ${missingFields} — running scrapeWebsiteDeep on ${result.sito} (always-on)`)
    try {
      const siteUrl = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
      // ★ FIX bug Carpenteria Corona: usa lo stesso scraper deep usato in /api/analyze-site,
      // che scrappa OGNI pagina standard del sito (homepage + contatti + about + privacy +
      // chi-siamo + team + impressum) e separa correttamente fissi (0XX) da cellulari (3XX),
      // email aziendali da PEC, ecc.
      const deep = await scrapeWebsiteDeep(siteUrl)
      console.log(`[COMPANY-LOOKUP] Step 2c: scrapeWebsiteDeep done (${deep.pagesScraped} pages, ${deep.emails.length} emails, ${deep.phones.length} phones)`)
      // ★ ANTI-OMONIMIA P.IVA: la P.IVA dichiarata nel footer del sito ufficiale è la fonte più
      // autoritativa (l'azienda dichiara la propria). Se differisce dalla P.IVA che avevamo
      // (proveniente da lead-registry o altre fonti ricerca-per-nome), questa è quasi sempre
      // un'omonimia e va sovrascritta. Bug visto su BIOTECNICA Castelfidardo: lead-registry
      // ritornava la P.IVA di un'altra Biotecnica omonima; il footer del sito aveva quella corretta.
      const sitePiva = (deep.partitaIva || '').replace(/\D/g, '')
      const currentPiva = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
      let websitePivaVerified = false
      let websiteIdentityRejected = false
      if (sitePiva.length === 11) {
        // ★ ANTI-OVERRIDE: validate the site P.IVA actually belongs to the queried company.
        // 1. For P.IVA queries: NEVER override the user's queried P.IVA (it's authoritative by definition)
        // 2. For name queries: verify the site P.IVA's name matches the query (PagineGialle/Italiaonline
        //    footers often have the PROVIDER's P.IVA, not the company's).
        let sitePivaIsValid = true
        if (isPiva && cleanQuery && currentPiva && currentPiva !== sitePiva) {
          // User queried by exact P.IVA — trust it absolutely. Never override.
          console.log(`[COMPANY-LOOKUP] Step 2c: ⚠️ REJECTED site P.IVA ${sitePiva} — user queried P.IVA ${currentPiva}, never override.`)
          sitePivaIsValid = false
          websiteIdentityRejected = true
        } else if (!isPiva && queryCompanyName) {
          try {
            const verifyData = await scrapeCompanyReports(sitePiva)
            if (verifyData?.ragione_sociale && !nameMatches(queryCompanyName, verifyData.ragione_sociale)) {
              console.log(`[COMPANY-LOOKUP] Step 2c: ⚠️ REJECTED site P.IVA ${sitePiva} — belongs to "${verifyData.ragione_sociale}", not query "${queryCompanyName}". Likely hosting provider P.IVA.`)
              sitePivaIsValid = false
              websiteIdentityRejected = true
            }
          } catch { /* if verify fails, fall back to old behavior (trust the site) */ }
        }
        if (sitePivaIsValid) {
          websitePivaVerified = !currentPiva || currentPiva === sitePiva
          if (!currentPiva) {
            result.partita_iva = deep.partitaIva
            console.log(`[COMPANY-LOOKUP] Step 2c: P.IVA from website: ${deep.partitaIva}`)
          } else if (currentPiva !== sitePiva) {
            console.log(`[COMPANY-LOOKUP] Step 2c: ⚠️ P.IVA OVERRIDE — current=${currentPiva} site_footer=${sitePiva} (trusting website footer as authoritative)`)
            result.partita_iva = deep.partitaIva
            ;(result as any).partita_iva_fonte = 'Sito ufficiale azienda (footer)'
            // Clear stale financial data so Step 2d/CompanyReports re-fetches with correct P.IVA
            delete result.fatturato
            delete result.fatturato_anno
            delete result.dipendenti
            delete result.utile_netto
            delete result.utile_netto_anno
            delete result.capitale_sociale
            // Drop fonti tied to wrong P.IVA so they don't get listed
            for (let i = fonti.length - 1; i >= 0; i--) {
              if (/CompanyReports|FatturatoItalia|OpenAPI|lead-registry/i.test(fonti[i])) fonti.splice(i, 1)
            }
          }
        }
      }
      if (websiteIdentityRejected) {
        console.log(`[COMPANY-LOOKUP] Step 2c: clearing rejected website "${result.sito}" before importing contacts`)
        delete result.sito
        delete (result as any).sito_web
        throw new Error('website identity rejected by P.IVA mismatch')
      }
      // Telefono fisso: cerca tipo='landline'
      // ★ ANTI-BUG: exclude P.IVA (02004120032 looks like Milano landline 02-XXXXXXXX but is a P.IVA!)
      const pivaDigitsForPhone = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
      const landline = deep.phones.find(p => {
        if (p.type !== 'landline') return false
        const d = p.number.replace(/\D/g, '')
        const core = d.startsWith('39') ? d.slice(2) : (d.startsWith('0039') ? d.slice(4) : d)
        if (pivaDigitsForPhone && (core === pivaDigitsForPhone || d === pivaDigitsForPhone)) return false
        return true
      })
      if (landline) {
        const telFonte = String((result as any).telefono_fonte || '').toLowerCase()
        const previousDigits = result.telefono ? String(result.telefono).replace(/\D/g, '').slice(-9) : ''
        const websiteDigits = landline.number.replace(/\D/g, '').slice(-9)
        const weakExistingPhone = !telFonte || /openapi|registro|lead.?registry|companyreports|fatturato|tavily|gemini|unknown/i.test(telFonte)
        const existingPhoneFromSite = /sito ufficiale/i.test(telFonte)
        if (!result.telefono || websitePivaVerified || weakExistingPhone || !existingPhoneFromSite) {
          if (result.telefono && previousDigits && previousDigits !== websiteDigits) {
            console.log(`[COMPANY-LOOKUP] Step 2c: Telefono sito ufficiale prevale su "${result.telefono}" (fonte: ${telFonte || 'unknown'})`)
          }
          result.telefono = landline.number
          result.telefono_fonte = 'Sito ufficiale azienda'
          console.log(`[COMPANY-LOOKUP] Step 2c: Telefono fisso from website (${landline.page}): ${landline.number}`)
        }
      }
      // Cellulare: cerca tipo='mobile'
      const mobile = deep.phones.find(p => p.type === 'mobile')
      if (mobile) {
        const celFonte = String((result as any).cellulare_fonte || '').toLowerCase()
        if (!result.cellulare || websitePivaVerified || !/sito ufficiale/i.test(celFonte)) {
          if (result.cellulare && String(result.cellulare).replace(/\D/g, '').slice(-9) !== mobile.number.replace(/\D/g, '').slice(-9)) {
            console.log(`[COMPANY-LOOKUP] Step 2c: Cellulare sito ufficiale prevale su "${result.cellulare}" (fonte: ${celFonte || 'unknown'})`)
          }
          result.cellulare = mobile.number
          ;(result as any).cellulare_fonte = 'Sito ufficiale azienda'
          console.log(`[COMPANY-LOOKUP] Step 2c: Cellulare from website (${mobile.page}): ${mobile.number}`)
        }
      }
      // Email: priorità a personal del dominio aziendale, poi generic, ESCLUDENDO PEC
      if (!result.email) {
        const personalEmail = deep.emails.find(e => e.type === 'personal')
          || deep.emails.find(e => e.type === 'generic')
        if (personalEmail) {
          result.email = personalEmail.email.toLowerCase()
          console.log(`[COMPANY-LOOKUP] Step 2c: Email from website (${personalEmail.page}, ${personalEmail.type}): ${result.email}`)
        }
      }
      // ★ TUTTI i contatti raccolti dal sito (multi-fissi, multi-cellulari, multi-email).
      // L'azienda spesso ha più numeri (Amministrazione, Ufficio Tecnico, Commerciale).
      // Bug visto su Carpenteria Corona: il sito mostrava 3 numeri + 3 email, ma nel software
      // ne vedevamo solo 1 di ognuno. Ora restituiamo TUTTI in array dedicati.
      // ★ FILTRO ANTI-PIVA: scrapeWebsiteDeep a volte raccoglie P.IVA (11 cifre) come "telefono".
      // Italian mobile = 3XX XXXXXX (10 digits, starts with 3); landline = 0X+ (starts with 0).
      // P.IVA typically starts with 0 too (numero di partita IVA) → si scarta se: matches result.partita_iva,
      // OR è esattamente 11 cifre senza spazi/punti/trattini (P.IVA pura).
      const resultPivaDigits = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
      const isLikelyPiva = (numero: string): boolean => {
        const digits = numero.replace(/\D/g, '')
        if (digits.length === 11 && resultPivaDigits && digits === resultPivaDigits) return true
        // 11 digits raw without ANY separator → almost certainly a P.IVA (real phones have spaces/dots/dashes)
        if (/^\d{11}$/.test(numero.trim())) return true
        return false
      }
      ;(result as any).tutti_telefoni = deep.phones
        .filter(p => p.type === 'landline' && !isLikelyPiva(p.number))
        .map(p => ({ numero: p.number, fonte: 'Sito ufficiale azienda', pagina: p.page }))
      ;(result as any).tutti_cellulari = deep.phones
        .filter(p => p.type === 'mobile' && !isLikelyPiva(p.number))
        .map(p => ({ numero: p.number, fonte: 'Sito ufficiale azienda', pagina: p.page }))
      ;(result as any).tutte_email = deep.emails
        .filter(e => e.type === 'personal' || e.type === 'generic')
        .map(e => ({ email: e.email.toLowerCase(), tipo: e.type, pagina: e.page }))
      console.log(`[COMPANY-LOOKUP] Step 2c: collected ${(result as any).tutti_telefoni.length} fissi, ${(result as any).tutti_cellulari.length} cellulari, ${(result as any).tutte_email.length} email`)
      // Sede legale: address dal scraper se non l'avevamo
      if (!result.sede_legale && deep.address) {
        result.sede_legale = deep.address
        console.log(`[COMPANY-LOOKUP] Step 2c: Sede from website: ${deep.address}`)
      }
      // Social: prima trovati, se non li avevamo
      // ★ ANTI-PROVIDER: skip social handles of known directory/hosting providers (PagineGialle/Italiaonline,
      // Wix, Squarespace, ecc.) which often appear in footer of sites hosted on those platforms.
      // BUT: don't reject if the user is actually searching for that provider (e.g. query "Aruba S.p.A.").
      const PROVIDER_NAMES = ['italiaonline', 'paginegialle', 'paginebianche', 'getfound', 'misterimprese', 'wix', 'squarespace', 'webflow', 'wordpress', 'godaddy', 'aruba', 'register', 'netsons', 'hostinger', 'seoinitalia', 'altervista', 'altervistaorg', 'jimdo']
      const queryNameLower = (queryCompanyName || '').toLowerCase()
      const isProviderSocial = (url: string | null | undefined): boolean => {
        if (!url || typeof url !== 'string') return false
        const urlLower = url.toLowerCase()
        for (const provider of PROVIDER_NAMES) {
          // URL contains the provider handle as a path segment
          const rx = new RegExp(`\\/(${provider})(?:\\/|$|\\?)`, 'i')
          if (rx.test(urlLower)) {
            // Skip rejection if user is actually searching for THAT provider (avoid false positives)
            if (queryNameLower.includes(provider)) return false
            return true
          }
        }
        return false
      }
      if (!result.linkedin && deep.socialLinks.linkedin && !isProviderSocial(deep.socialLinks.linkedin)) result.linkedin = deep.socialLinks.linkedin
      else if (deep.socialLinks.linkedin && isProviderSocial(deep.socialLinks.linkedin)) console.log(`[COMPANY-LOOKUP] Step 2c: REJECTED provider LinkedIn "${deep.socialLinks.linkedin}"`)
      if (!result.facebook && deep.socialLinks.facebook && !isProviderSocial(deep.socialLinks.facebook)) result.facebook = deep.socialLinks.facebook
      else if (deep.socialLinks.facebook && isProviderSocial(deep.socialLinks.facebook)) console.log(`[COMPANY-LOOKUP] Step 2c: REJECTED provider Facebook "${deep.socialLinks.facebook}"`)
      if (!result.instagram && deep.socialLinks.instagram && !isProviderSocial(deep.socialLinks.instagram)) result.instagram = deep.socialLinks.instagram
      else if (deep.socialLinks.instagram && isProviderSocial(deep.socialLinks.instagram)) console.log(`[COMPANY-LOOKUP] Step 2c: REJECTED provider Instagram "${deep.socialLinks.instagram}"`)

      // ★ FALLBACK PER SITI JS-RENDERED (Flazio, Wix, Squarespace, Webflow, ecc.):
      // scrapeWebsiteDeep usa fetch HTTP che vede solo HTML statico. Per i siti che
      // renderizzano contenuti via JavaScript (es. biotecnicaassociati.com su Flazio),
      // l'HTML statico è praticamente vuoto → 0 email/telefoni.
      // Soluzione: chiama il backend Hetzner /audit-url che usa Playwright headless
      // con rendering JS completo (lo stesso scraper usato dal worker batch in
      // Categoria + Città — per questo lì funziona sempre).
      if (deep.emails.length === 0 && deep.phones.length === 0) {
        console.log(`[COMPANY-LOOKUP] Step 2c: 0 contatti dal fetch statico — fallback Playwright via Hetzner /audit-url (JS render)`)
        try {
          const auditRes = await fetch(`${backendUrl}/audit-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: siteUrl }),
            signal: AbortSignal.timeout(35000), // /audit-url può prendere ~20s
          })
          if (auditRes.ok) {
            const audit = await auditRes.json() as any
            console.log(`[COMPANY-LOOKUP] Step 2c: /audit-url returned email=${audit?.email || 'none'} tel=${audit?.telefono || 'none'}`)
            // Email
            const auditEmail = cleanContactEmail(audit?.email)
            if (auditEmail && /^[a-z0-9._%+-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(auditEmail)) {
              if (!result.email) {
                result.email = auditEmail
                ;(result as any).email_fonte = 'Sito ufficiale (Playwright JS render)'
                console.log(`[COMPANY-LOOKUP] Step 2c: Email from /audit-url: ${auditEmail}`)
              }
              // Aggiungi anche all'array tutte_email se non già presente
              const tutteEmail = ((result as any).tutte_email || []) as Array<{ email: string; tipo: string; pagina: string }>
              if (!tutteEmail.find(e => e.email === auditEmail)) {
                const isGeneric = /^(info|contatti|contact|admin|office|segreteria|reception|booking|sales|vendite|support|assistenza|help|marketing|hr|noreply|webmaster|newsletter|press|media)/i.test(auditEmail)
                tutteEmail.push({ email: auditEmail, tipo: isGeneric ? 'generic' : 'personal', pagina: '/' })
                ;(result as any).tutte_email = tutteEmail
              }
            }
            // Telefono (può essere fisso o cellulare — distinguiamo dal prefisso)
            const auditTel = typeof audit?.telefono === 'string' ? audit.telefono.trim() : ''
            if (auditTel) {
              const digits = auditTel.replace(/\D/g, '').replace(/^(39|0039)/, '')
              const isMobile = digits.startsWith('3') && digits.length >= 9
              if (isMobile) {
                const celFonte = String((result as any).cellulare_fonte || '').toLowerCase()
                if (!result.cellulare || !/sito ufficiale/i.test(celFonte)) {
                  result.cellulare = auditTel
                  ;(result as any).cellulare_fonte = 'Sito ufficiale (Playwright JS render)'
                  console.log(`[COMPANY-LOOKUP] Step 2c: Cellulare from /audit-url: ${auditTel}`)
                }
                const tuttiCel = ((result as any).tutti_cellulari || []) as Array<{ numero: string; fonte: string; pagina: string }>
                if (!tuttiCel.find(t => t.numero.replace(/\D/g, '').slice(-9) === digits.slice(-9))) {
                  tuttiCel.push({ numero: auditTel, fonte: 'Sito ufficiale (Playwright JS render)', pagina: '/' })
                  ;(result as any).tutti_cellulari = tuttiCel
                }
              } else {
                const telFonte = String((result as any).telefono_fonte || '').toLowerCase()
                if (!result.telefono || !/sito ufficiale/i.test(telFonte)) {
                  result.telefono = auditTel
                  result.telefono_fonte = 'Sito ufficiale (Playwright JS render)'
                  console.log(`[COMPANY-LOOKUP] Step 2c: Telefono fisso from /audit-url: ${auditTel}`)
                }
                const tuttiTel = ((result as any).tutti_telefoni || []) as Array<{ numero: string; fonte: string; pagina: string }>
                if (!tuttiTel.find(t => t.numero.replace(/\D/g, '').slice(-9) === digits.slice(-9))) {
                  tuttiTel.push({ numero: auditTel, fonte: 'Sito ufficiale (Playwright JS render)', pagina: '/' })
                  ;(result as any).tutti_telefoni = tuttiTel
                }
              }
            }
          } else {
            console.log(`[COMPANY-LOOKUP] Step 2c: /audit-url HTTP ${auditRes.status}`)
          }
        } catch (e: any) {
          console.log(`[COMPANY-LOOKUP] Step 2c: /audit-url failed — ${e?.message || e}`)
        }
      }
    } catch (e: any) {
      if (e?.message === 'website identity rejected by P.IVA mismatch') {
        console.log('[COMPANY-LOOKUP] Step 2c: scrapeWebsiteDeep skipped contacts — website identity rejected')
      } else {
        console.log(`[COMPANY-LOOKUP] Step 2c: scrapeWebsiteDeep failed — ${e?.message || e}`)
      }
    }

    // If P.IVA was discovered, call CompanyReports.it for financial data
    const discoveredPiva = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
    if (!openApiCameraleAvailable && discoveredPiva.length === 11) {
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
  if (!openApiCameraleAvailable && leadRegistryDone && knownPiva.length === 11 && !fonti.some(f => f.includes('CompanyReports'))) {
    console.log(`[COMPANY-LOOKUP] Step 2d: Verifying financial data via CompanyReports.it for P.IVA ${knownPiva}`)  
    const crVerify = await scrapeCompanyReports(knownPiva)
    if (crVerify) {
      if (crVerify.fatturato) { result.fatturato = crVerify.fatturato; console.log(`[COMPANY-LOOKUP] Step 2d: CompanyReports fatturato OVERRIDE: ${crVerify.fatturato}`) }
      if (crVerify.fatturato_anno) result.fatturato_anno = crVerify.fatturato_anno
      if (crVerify.dipendenti) {
        result.dipendenti = crVerify.dipendenti
        ;(result as any).dipendenti_fonte = 'companyreports.it'
      }
      if (crVerify.utile_netto) result.utile_netto = crVerify.utile_netto
      if (crVerify.capitale_sociale && !result.capitale_sociale) result.capitale_sociale = crVerify.capitale_sociale
      if (crVerify.codice_ateco) result.codice_ateco = crVerify.codice_ateco
      if (crVerify.descrizione_ateco) result.descrizione_ateco = crVerify.descrizione_ateco
      fonti.push('CompanyReports.it (bilancio ufficiale)')
    }
  }

  // ★ Step 2e: ALWAYS verify financial data via FatturatoItalia.it when P.IVA is known.
  // Sites pubblica i bilanci ufficiali della Camera di Commercio: per dati come
  // dipendenti, fatturato, costo_personale è la fonte AUTORITATIVA. Sostituisce qualsiasi
  // valore precedente (es. Tavily/Gemini hallucinations su omonime).
  // Bug visto: CAREL S.r.l. → AI estraeva 26 dipendenti (era CAREL S.p.A. multinazionale)
  // mentre FatturatoItalia per P.IVA 01334000997 dice "1 dipendente" (giusto).
  if (!openApiCameraleAvailable && knownPiva.length === 11 && !fonti.some(f => f.includes('fatturatoitalia'))) {
    console.log(`[COMPANY-LOOKUP] Step 2e: Verifying financial data via FatturatoItalia.it for P.IVA ${knownPiva}`)
    try {
      const fiVerify = await scrapeFatturatoItalia(knownPiva)
      if (fiVerify) {
        if (fiVerify.dipendenti) {
          if (result.dipendenti && result.dipendenti !== fiVerify.dipendenti) {
            console.log(`[COMPANY-LOOKUP] Step 2e: FatturatoItalia OVERRIDE dipendenti: "${result.dipendenti}" → "${fiVerify.dipendenti}"`)
          }
          result.dipendenti = fiVerify.dipendenti
          ;(result as any).dipendenti_fonte = 'fatturatoitalia.it'
        }
        if (fiVerify.fatturato) {
          if (result.fatturato && result.fatturato !== fiVerify.fatturato) {
            console.log(`[COMPANY-LOOKUP] Step 2e: FatturatoItalia OVERRIDE fatturato: "${result.fatturato}" → "${fiVerify.fatturato}"`)
          }
          result.fatturato = fiVerify.fatturato
          ;(result as any).fatturato_fonte = 'fatturatoitalia.it'
        }
        if (fiVerify.fatturato_anno) result.fatturato_anno = fiVerify.fatturato_anno
        if (fiVerify.utile_netto) result.utile_netto = fiVerify.utile_netto
        if (fiVerify.utile_netto_anno) (result as any).utile_netto_anno = fiVerify.utile_netto_anno
        if (fiVerify.costo_personale) (result as any).costo_personale = fiVerify.costo_personale
        if (fiVerify.capitale_sociale && !result.capitale_sociale) result.capitale_sociale = fiVerify.capitale_sociale
        if (fiVerify.codice_ateco) result.codice_ateco = fiVerify.codice_ateco
        if (fiVerify.descrizione_ateco) result.descrizione_ateco = fiVerify.descrizione_ateco
        if (fiVerify.forma_giuridica && !result.forma_giuridica) result.forma_giuridica = fiVerify.forma_giuridica
        if (fiVerify.data_costituzione && !result.data_costituzione) result.data_costituzione = fiVerify.data_costituzione
        if (fiVerify.rea && !result.rea) (result as any).rea = fiVerify.rea
        if (fiVerify.stato_attivita && !result.stato_attivita) (result as any).stato_attivita = fiVerify.stato_attivita
        fonti.push('fatturatoitalia.it (bilancio ufficiale)')
      } else {
        console.log(`[COMPANY-LOOKUP] Step 2e: FatturatoItalia non ha dati per P.IVA ${knownPiva}`)
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] Step 2e: FatturatoItalia error: ${e?.message}`)
    }
  }

  // ─── Step 3: Scrape company website (like category scraper does) ───
  // ALWAYS run when we have a website — it's free (no Tavily/OpenAI calls) and is
  // the primary source for email, social URLs (Instagram, Facebook, LinkedIn), cellulare, PEC.
  // lead-registry doesn't scrape the company website, so skipping this step previously caused
  // missing social media and email even when website had them clearly visible.
  if (leadRegistryDone) {
    console.log(`[COMPANY-LOOKUP] lead-registry done — but Step 3 (website scrape) still runs to capture email/social/cellulare`)
  }
  // ─── Step 3 (original): Scrape company website ───
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
          allHtml += ' ' + await fetchSameDomainFrameHtml(html, pageRes.url || pageUrl)
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
          result.cellulare_fonte = 'Sito ufficiale azienda'
          console.log(`[COMPANY-LOOKUP] Extracted cellulare from website: ${ph}`)
        } else if ((core.startsWith('0') || /^(800|803|840|892|899)/.test(core)) && !result.telefono) {
          result.telefono = ph
          result.telefono_fonte = 'Sito ufficiale azienda'
          console.log(`[COMPANY-LOOKUP] Extracted telefono from website: ${ph}`)
        }
      }

      // Extract emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
      const emails = [...new Set(allHtml.match(emailRegex) || [])]
        .filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') && !e.includes('example') && !e.includes('sentry'))
      
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
  // Same source used by lead-registry in "Dettaglio Lead" — guaranteed accurate.
  // ALWAYS run: it's a free HTTP scrape (no Tavily/OpenAI) and is THE most accurate source
  // for financial data. If lead-registry returned hallucinated values, this corrects them.
  const pivaForCR = (result.partita_iva || '') as string
  if (!openApiCameraleAvailable && pivaForCR && pivaForCR.length === 11) {
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
    const pivaQ = `"${cleanQuery}" site:registroaziende.it`
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
              // ★ pivaOnlyNoName stays TRUE — Tavily Search 1/2 mixes up data from
              // different companies (wrong ATECO, wrong sede, wrong email). Round 2 (Maps)
              // is NOT guarded by pivaOnlyNoName and will still run with the name.
            }
          }
        }
      }
    } catch { /* */ }
    // Fallback: try visura.pro if registroaziende.it didn't find the name
    if (!result.ragione_sociale && tavilyKey) {
      try {
        const pivaQ2 = `"${cleanQuery}" site:visura.pro`
        const pivaRes2 = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: pivaQ2, search_depth: 'basic', max_results: 3 }),
          signal: AbortSignal.timeout(10000),
        })
        if (pivaRes2.ok) {
          const pivaData2 = await pivaRes2.json()
          const pivaText2 = (pivaData2.results || []).map((r: any) => (r.title || '') + ' ' + (r.content || '')).join(' ')
          if (pivaText2.length > 30 && openaiKey) {
            const nameRes2 = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
              body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, messages: [
                { role: 'system', content: 'Estrai la ragione sociale dall\'azienda con P.IVA indicata. Rispondi SOLO con JSON.' },
                { role: 'user', content: `Qual è la ragione sociale dell'azienda con P.IVA ${cleanQuery}? Testo: ${pivaText2.slice(0, 4000)}\n\nJSON: {"ragione_sociale":"nome esatto"}` },
              ]}),
              signal: AbortSignal.timeout(10000),
            })
            if (nameRes2.ok) {
              const nd2 = await nameRes2.json()
              const raw2 = nd2.choices?.[0]?.message?.content || '{}'
              const parsed2 = JSON.parse(raw2.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
              if (parsed2.ragione_sociale && parsed2.ragione_sociale.length > 2) {
                result.ragione_sociale = parsed2.ragione_sociale
                console.log(`[COMPANY-LOOKUP] Found company name from P.IVA via visura.pro: "${result.ragione_sociale}"`)
              }
            }
          }
        }
      } catch { /* */ }
    }
  }
  // Use query as fallback company name if not found yet
  const searchCompanyName = (result.ragione_sociale || (!isPiva ? queryCompanyName : '')) as string
  if (!leadRegistryDone && !result.ragione_sociale && !isPiva && tavilyKey) {
    console.log(`[COMPANY-LOOKUP] No company found yet, using query as name for Tavily`)
  }
  console.log(`[COMPANY-LOOKUP] Before Tavily — ragione_sociale: "${result.ragione_sociale || 'N/A'}", searchCompanyName: "${searchCompanyName}", telefono: "${result.telefono || 'N/A'}", email: "${result.email || 'N/A'}"`)
  // Allow Tavily enrichment when lead-registry didn't succeed, OR when telefono is missing/unreliable
  // (Maps phones are often outdated; Tavily AI phones can be hallucinated). We want to verify
  // against authoritative Italian directories like Reteimprese.
  const telFonteOuter = String((result as any).telefono_fonte || '').toLowerCase()
  const telefonoFromMapsOuter = telFonteOuter.includes('google maps') || telFonteOuter.includes('maps')
  const telefonoUnverified = !result.telefono || telefonoFromMapsOuter || telFonteOuter.includes('tavily')
  if (!openApiCameraleAvailable && (!leadRegistryDone || telefonoUnverified) && searchCompanyName && tavilyKey && openaiKey && !pivaOnlyNoName) {
    const companyName = searchCompanyName
    const city = (result.citta || '') as string
    const piva = (result.partita_iva || '') as string

    // ── TAVILY BUDGET CONTROL ──
    // Limit to prevent a single company lookup from consuming 100+ credits
    let tavilyCallsCount = 0
    const MAX_TAVILY_CALLS = 14

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
            // PEC must be a valid email AND not a placeholder/hallucinated value
            if (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
              const pecLow = v.toLowerCase().trim()
              const pecLocal = pecLow.split('@')[0]
              const JUNK_PEC_LOCALS = ['yourname','tuonome','tuoindirizzo','example','test','nome','nomecognome','nomeazienda','email','info','admin','placeholder','xxx','abc','azienda','companyname','company']
              if (JUNK_PEC_LOCALS.includes(pecLocal)) {
                console.log(`[COMPANY-LOOKUP] REJECTED placeholder PEC from GPT: "${v}"`)
              } else {
                result[k] = v
              }
            }
          } else if (k === 'anno_fondazione') {
            // Anno must be a 4-digit year
            const yearMatch = String(v).match(/(\d{4})/)
            if (yearMatch) result[k] = yearMatch[1]
          } else if (k === 'partita_iva') {
            // P.IVA must be exactly 11 digits
            const clean = String(v).replace(/\D/g, '')
            if (clean.length === 11) result[k] = clean
          } else if (k === 'titolare' || k === 'ruolo_titolare') {
            // Anti-hallucination: AI often extracts celebrity names or unrelated people from news articles
            if (k === 'titolare') {
              const titVal = String(v).trim()
              const titWords = titVal.split(/\s+/)
              const titLow = titVal.toLowerCase()
              // Must be 2-5 words (a real person name)
              if (titWords.length < 2 || titWords.length > 5) {
                console.log(`[COMPANY-LOOKUP] REJECTED AI titolare "${titVal}" — invalid word count (${titWords.length})`)
                continue
              }
              // Must be < 60 chars
              if (titVal.length > 60) {
                console.log(`[COMPANY-LOOKUP] REJECTED AI titolare "${titVal}" — too long`)
                continue
              }
              // Must NOT contain legal forms (it's a company name, not a person)
              if (/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|ltd|llc|gmbh|inc|corp)\b/i.test(titVal)) {
                console.log(`[COMPANY-LOOKUP] REJECTED AI titolare "${titVal}" — contains legal form`)
                continue
              }
              // Must NOT be the company name itself (AI sometimes echoes query)
              const compLow = (result.ragione_sociale || companyName || '').toString().toLowerCase()
              if (titLow === compLow || compLow.includes(titLow) || titLow.includes(compLow.replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|srl|spa)\b/gi, '').trim())) {
                console.log(`[COMPANY-LOOKUP] REJECTED AI titolare "${titVal}" — matches company name`)
                continue
              }
              // Must look like a capitalized name (at least first word starts with uppercase)
              if (!/^[A-ZÀ-Ú]/.test(titVal) && titVal !== titVal.toUpperCase()) {
                console.log(`[COMPANY-LOOKUP] REJECTED AI titolare "${titVal}" — not capitalized`)
                continue
              }
              result[k] = titVal
              if (!result.titolare_fonte) result.titolare_fonte = 'AI'
            } else {
              result[k] = v
            }
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
    // ★ ANTI-FABRICATION: for P.IVA queries where no authoritative source confirmed the company name,
    // Gemini would search for a possibly-wrong name and fabricate everything. Skip it.
    if (openApiRich) {
      console.log(`[COMPANY-LOOKUP] Step Gemini: SKIPPED (openApiRich)`)
    } else if (pivaOnlyNoName) {
      console.log(`[COMPANY-LOOKUP] Step Gemini: SKIPPED (pivaOnlyNoName — no authoritative ragione_sociale)`)
    } else if (isGeminiEnabled()) {
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
              // Tag phone/email source for downstream validation (Step 6e-PIVA, FINAL VALIDATION)
              if (k === 'telefono') (result as any).telefono_fonte = 'Gemini AI'
              if (k === 'email') (result as any).email_fonte = 'Gemini AI'
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
    if (openApiRich) {
      console.log(`[COMPANY-LOOKUP] Search 1 (visura): SKIPPED (openApiRich)`)
    } else if (!hasBasicCameraleData || (!result.titolare && !result.persone)) {
      // ★ Try MULTIPLE targeted queries (one site per query — Tavily ignores OR boolean operator)
      let text1 = ''
      // 1st: registroaziende.it (has ATECO, città, provincia, codice fiscale — publicly accessible)
      if (text1.length < 50 && piva) {
        text1 = await tavilySearch(`"${piva}" site:registroaziende.it`, true, true)
        if (text1.length >= 50) console.log(`[COMPANY-LOOKUP] Search 1: found data on registroaziende.it`)
      }
      // 2nd: visura.pro (has ATECO, dipendenti, REA, forma giuridica, indirizzo — very complete)
      if (text1.length < 50 && piva) {
        text1 = await tavilySearch(`"${piva}" site:visura.pro`, true, true)
        if (text1.length >= 50) console.log(`[COMPANY-LOOKUP] Search 1: found data on visura.pro`)
      }
      // 3rd: by company name (broader)
      if (text1.length < 50) {
        text1 = await tavilySearch(`"${companyName}" codice ATECO dipendenti forma giuridica sede legale`, true, true)
        if (text1.length >= 50) console.log(`[COMPANY-LOOKUP] Search 1: found data by company name`)
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

    // ── After Search 1: if pivaOnlyNoName was true but now we HAVE the name, run lead-registry + website search ──
    // This happens when CompanyReports/FatturatoItalia didn't return ragione_sociale but Tavily/visura.pro did.
    if (pivaOnlyNoName && result.ragione_sociale && !leadRegistryDone) {
      pivaOnlyNoName = false // update the flag for downstream checks
      console.log(`[COMPANY-LOOKUP] Post-Search1: ragione_sociale now available ("${result.ragione_sociale}") — running delayed lead-registry`)
      try {
        const origin = req.headers.get('host') ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('host')}` : 'http://localhost:3000'
        const leadObj = {
          nome: result.ragione_sociale,
          azienda: result.ragione_sociale,
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
            console.log(`[COMPANY-LOOKUP] Post-Search1 lead-registry OK: sito=${lrData.sito_web} email=${lrData.email} titolare=${lrData.titolare}`)
            if (lrData.sito_web && !result.sito) result.sito = lrData.sito_web
            if (lrData.email && !result.email) result.email = lrData.email
            if (lrData.telefono && !result.telefono) result.telefono = lrData.telefono
            if (lrData.cellulare && !result.cellulare) result.cellulare = lrData.cellulare
            if (lrData.pec && !result.pec) result.pec = lrData.pec
            const lrTit = lrData.titolare && typeof lrData.titolare === 'string' && lrData.titolare.length > 3 && !/^(n\/a|nd|non|sconosciuto|titolare|amministratore)/i.test(lrData.titolare)
            if (lrTit && !result.titolare) { result.titolare = lrData.titolare; result.ruolo_titolare = lrData.ruolo_titolare || 'Amministratore' }
            if (Array.isArray(lrData.persone) && lrData.persone.length && !(Array.isArray(result.persone) && result.persone.length)) result.persone = lrData.persone
            if (!fonti.includes('lead-registry')) fonti.push('lead-registry')
            leadRegistryDone = true
          }
        }
      } catch (e: any) {
        console.log(`[COMPANY-LOOKUP] Post-Search1 lead-registry failed: ${e?.message}`)
      }
    }

    // ── After ufficiocamerale: if we NOW have P.IVA, try CompanyReports.it ──
    if (!isOpenApiPrimary() && result.partita_iva && (!result.fatturato || !result.dipendenti)) {
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

    // ── EARLY OpenAPI enrichment: P.IVA was just discovered → call /IT-advanced NOW ──
    // This avoids wasting 10+ slow Tavily calls for data OpenAPI already has.
    if (isOpenApiPrimary() && !openApiDone && result.partita_iva && String(result.partita_iva).replace(/\D/g, '').length === 11) {
      const pivaEarly = String(result.partita_iva).replace(/\D/g, '')
      console.log(`[COMPANY-LOOKUP] EARLY OpenAPI enrichment — P.IVA ${pivaEarly} just found, calling /IT-advanced before Tavily searches`)
      try {
        const oaEarly = await enrichCompanyByPiva(pivaEarly)
        if (oaEarly) {
          const oaNameOk = isPiva || !oaEarly.ragione_sociale || !queryCompanyName || nameMatches(queryCompanyName, oaEarly.ragione_sociale)
          if (oaNameOk) {
            if (oaEarly.ragione_sociale) result.ragione_sociale = oaEarly.ragione_sociale
            const authKeys = [
              'forma_giuridica','forma_giuridica_codice','stato_attivita','codice_ateco','descrizione_ateco',
              'data_costituzione','data_registrazione','data_cessazione','codice_rea','cciaa',
              'sede_legale','citta','provincia','cap','indirizzo_via','indirizzo_numero_civico',
              'frazione','codice_catastale','regione','capitale_sociale','codice_fiscale','pec','sito_web',
            ] as const
            if (oaEarly.sito_web && !result.sito) result.sito = oaEarly.sito_web
            for (const k of authKeys) { if ((oaEarly as any)[k] && !(result as any)[k]) (result as any)[k] = (oaEarly as any)[k] }
            if (typeof oaEarly.gps_lat === 'number' && typeof oaEarly.gps_lng === 'number') {
              ;(result as any).gps_lat = oaEarly.gps_lat; (result as any).gps_lng = oaEarly.gps_lng
            }
            if (oaEarly.ateco_2022) (result as any).ateco_2022 = oaEarly.ateco_2022
            if (oaEarly.ateco_2007) (result as any).ateco_2007 = oaEarly.ateco_2007
            if (oaEarly.stato_agenzia_entrate) (result as any).stato_agenzia_entrate = oaEarly.stato_agenzia_entrate
            if (oaEarly.codice_sdi) { ;(result as any).codice_sdi = oaEarly.codice_sdi; if (oaEarly.codice_sdi_timestamp) (result as any).codice_sdi_timestamp = oaEarly.codice_sdi_timestamp }
            if (oaEarly.gruppo_iva) (result as any).gruppo_iva = oaEarly.gruppo_iva
            if (oaEarly.openapi_id) (result as any).openapi_id = oaEarly.openapi_id
            if (oaEarly.timestamp_creazione) (result as any).timestamp_creazione = oaEarly.timestamp_creazione
            if (oaEarly.timestamp_aggiornamento) (result as any).timestamp_aggiornamento = oaEarly.timestamp_aggiornamento
            if (typeof oaEarly.fatturato === 'number') {
              result.fatturato = String(oaEarly.fatturato); (result as any).fatturato_fonte = 'openapi_registro_imprese'
              if (oaEarly.fatturato_anno) (result as any).fatturato_anno = String(oaEarly.fatturato_anno)
            }
            if (typeof oaEarly.dipendenti === 'number') { result.dipendenti = String(oaEarly.dipendenti); (result as any).dipendenti_fonte = 'openapi_registro_imprese' }
            if (typeof oaEarly.costo_personale === 'number') (result as any).costo_personale = String(oaEarly.costo_personale)
            if (typeof oaEarly.patrimonio_netto === 'number') (result as any).patrimonio_netto = String(oaEarly.patrimonio_netto)
            if (typeof oaEarly.totale_attivo === 'number') (result as any).totale_attivo = String(oaEarly.totale_attivo)
            if (typeof oaEarly.ral_medio === 'number') (result as any).ral_medio = String(oaEarly.ral_medio)
            if (oaEarly.storico_bilanci && oaEarly.storico_bilanci.length > 0) (result as any).storico_bilanci = oaEarly.storico_bilanci
            if (oaEarly.titolare_best) {
              result.titolare = oaEarly.titolare_best.nomeCompleto
              result.ruolo_titolare = oaEarly.titolare_best.ruolo
              ;(result as any).titolare_fonte = oaEarly.titolare_best.source === 'stakeholders' ? 'openapi_stakeholders' : 'openapi_shareholders'
              if (oaEarly.titolare_best.taxCode) (result as any).codice_fiscale_titolare = oaEarly.titolare_best.taxCode
              if (oaEarly.titolare_best.dataNascita) (result as any).data_nascita_titolare = oaEarly.titolare_best.dataNascita
              if (typeof oaEarly.titolare_best.eta === 'number') (result as any).eta_titolare = String(oaEarly.titolare_best.eta)
              if (oaEarly.titolare_best.sesso) (result as any).sesso_titolare = oaEarly.titolare_best.sesso
            }
            const personeEarly: Array<Record<string, unknown>> = []
            for (const sh of (oaEarly.shareholders || [])) {
              if (!sh.nome || !sh.cognome) continue
              const nome = `${sh.nome.charAt(0).toUpperCase()}${sh.nome.slice(1).toLowerCase()} ${sh.cognome.charAt(0).toUpperCase()}${sh.cognome.slice(1).toLowerCase()}`
              personeEarly.push({ nome, ruolo: (oaEarly.shareholders?.length === 1) ? 'Socio Unico' : 'Socio', cf: sh.taxCode, quota: typeof sh.percentShare === 'number' ? `${sh.percentShare}%` : undefined })
            }
            for (const m of (oaEarly.managers || [])) {
              if (!personeEarly.find(p => String(p.nome).toLowerCase() === m.nomeCompleto.toLowerCase())) {
                personeEarly.push({ nome: m.nomeCompleto, ruolo: m.isLegalRep ? `${m.ruolo} (Legale Rappresentante)` : (m.ruolo || 'Dirigente'), cf: m.taxCode })
              }
            }
            if (personeEarly.length > 0) result.persone = personeEarly
            const srcLabel = oaEarly.live_calls > 0 ? 'OpenAPI.it (Registro Imprese)' : 'OpenAPI.it (cache)'
            if (!fonti.includes(srcLabel)) fonti.push(srcLabel)
            openApiDone = true
            openApiCameraleAvailable = true
            console.log(`[COMPANY-LOOKUP] EARLY OpenAPI complete — cost=€${oaEarly.cost_incurred_eur.toFixed(3)}, fatt=${oaEarly.fatturato ?? 'n/a'}, dip=${oaEarly.dipendenti ?? 'n/a'}, titolare=${oaEarly.titolare_best?.nomeCompleto ?? 'n/a'}`)
          } else {
            console.log(`[COMPANY-LOOKUP] EARLY OpenAPI: REJECTED — name "${oaEarly.ragione_sociale}" doesn't match "${queryCompanyName}"`)
          }
        }
      } catch (e: any) {
        console.log(`[COMPANY-LOOKUP] EARLY OpenAPI error: ${e?.message}`)
      }
    }

    // Update openApiRich flag after early enrichment
    const oaFonteUpdated = String((result as any).fatturato_fonte || '')
    const openApiRichNow = Boolean(
      openApiCameraleAvailable ||
      (result.ragione_sociale && result.partita_iva &&
        (result.codice_ateco || result.forma_giuridica || result.stato_attivita || result.citta || result.sede_legale || /openapi/i.test(oaFonteUpdated)))
    )

    // ── Search 2: Bilancio / dati finanziari (fatturato, dipendenti, utile, costo personale) ──
    if (openApiRich || openApiRichNow) {
      console.log(`[COMPANY-LOOKUP] Search 2 (bilancio): SKIPPED (openApiRich)`)
    } else if (!result.fatturato || !result.dipendenti) {
      // ★ Targeted per-site queries (Tavily ignores OR operator)
      let text2 = ''
      if (piva) text2 = await tavilySearch(`"${piva}" bilancio fatturato dipendenti site:visura.pro`, true, true)
      if (text2.length < 50 && piva) text2 = await tavilySearch(`"${piva}" fatturato ricavi site:registroaziende.it`, true, true)
      if (text2.length < 50) text2 = await tavilySearch(`"${companyName}" bilancio fatturato ricavi dipendenti`, true, true)
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
        const text2bDigits = text2b.replace(/\D/g, '')
        const text2bLow = text2b.toLowerCase()
        const compNameLow = companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
        const isValidPhone = (ph: string) => {
          if (!ph) return false
          const digits = ph.replace(/\D/g, '')
          if (digits.length < 9 || digits.length > 13) return false
          // Phone must NOT be the P.IVA
          if (pivaStr && digits === pivaStr) return false
          // ANTI-HALLUCINATION: phone digits must actually appear in the search text
          if (!text2bDigits.includes(digits)) return false
          // ANTI-MIX-UP: phone must appear within 800 chars of the company name OR P.IVA
          // This prevents picking up a phone from a completely different company in the same Tavily result
          const phoneIdx = text2bDigits.indexOf(digits)
          if (phoneIdx === -1) return false
          // Map digit-position back to original text (rough: digits are dense, so window in original text is ~3-5x bigger)
          const charWindow = 3000
          const phStart = Math.max(0, phoneIdx * 4 - charWindow)
          const phEnd = Math.min(text2bLow.length, phoneIdx * 4 + charWindow)
          const surrounding = text2bLow.slice(phStart, phEnd).replace(/[^a-z0-9]/g, '')
          const hasPiva = pivaStr && surrounding.includes(pivaStr)
          // Need at least 4 consecutive chars of the company name to confirm proximity
          const compTokens = compNameLow.match(/.{4,}/g) || []
          const hasCompName = compTokens.some(t => surrounding.includes(t))
          if (!hasPiva && !hasCompName) {
            console.log(`[COMPANY-LOOKUP] REJECTED phone "${ph}" — no company/P.IVA proximity in Tavily text`)
            return false
          }
          return true
        }
        if (ext2b.telefono && !result.telefono && isValidPhone(ext2b.telefono)) { result.telefono = ext2b.telefono; result.telefono_fonte = 'Tavily AI (ricerca web)'; tavilyUsed = true }
        if (ext2b.cellulare && !result.cellulare && isValidPhone(ext2b.cellulare)) { result.cellulare = ext2b.cellulare; result.cellulare_fonte = 'Tavily AI (ricerca web)'; tavilyUsed = true }
        if (ext2b.email && !result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext2b.email)) {
          // ANTI-MISMATCH: email domain must relate to company name OR be generic (info@, gmail, etc.)
          const emailDomBase2b = String(ext2b.email).split('@')[1]?.split('.')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
          const GENERIC_MAIL_2b = /^(gmail|yahoo|outlook|hotmail|libero|virgilio|tiscali|alice|fastwebnet|tin|live|msn|icloud|protonmail|mail)$/
          const compTokens2bEmail = companyName.toLowerCase().replace(/[^a-zà-ù0-9\s]/gi, ' ').split(/\s+/)
            .filter(t => t.length >= 4 && !COMMON_ITALIAN_NAMES.has(t))
          const emailDomOk2b = emailDomBase2b.length < 4
            || GENERIC_MAIL_2b.test(emailDomBase2b)
            || compTokens2bEmail.some(t => emailDomBase2b.includes(t) || t.includes(emailDomBase2b))
          if (emailDomOk2b) {
            result.email = ext2b.email; tavilyUsed = true
          } else {
            console.log(`[COMPANY-LOOKUP] REJECTED Tavily email "${ext2b.email}" — domain "${emailDomBase2b}" not related to "${companyName}"`)
          }
        }
        if (ext2b.sito_web && !result.sito) {
          // ANTI-HALLUCINATION: the website URL must actually appear in the Tavily search text.
          // GPT sometimes invents typo'd URLs (e.g. "gomgorgone.it" instead of "gemgorgone.it").
          const candidateSite = String(ext2b.sito_web).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
          if (candidateSite && text2bLow.includes(candidateSite)) {
            result.sito = ext2b.sito_web; tavilyUsed = true
          } else {
            console.log(`[COMPANY-LOOKUP] REJECTED hallucinated sito_web "${ext2b.sito_web}" — not present in Tavily text`)
          }
        }
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
          if (d.length >= 9 && d.length <= 13 && d !== pivaStr) { result.telefono = ext2b2.telefono; result.telefono_fonte = 'Tavily AI (ricerca web)'; tavilyUsed = true }
        }
        if (ext2b2.cellulare && !result.cellulare) {
          const d = String(ext2b2.cellulare).replace(/\D/g, '')
          if (d.length >= 9 && d.length <= 13 && d !== pivaStr) { result.cellulare = ext2b2.cellulare; result.cellulare_fonte = 'Tavily AI (ricerca web)'; tavilyUsed = true }
        }
        if (ext2b2.email && !result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext2b2.email)) { result.email = ext2b2.email; tavilyUsed = true }
      }
    }

    // ── Search 2b3: Reteimprese.it — directory italiana con telefoni affidabili ──
    // Search reteimprese/paginegialle when we're missing telefono OR have only a Maps phone (often outdated).
    // These directories format phones as "Nome Azienda - ... |+39 NNNNNNN" or similar patterns.
    const telFonteForCheck = String((result as any).telefono_fonte || '').toLowerCase()
    // Only Tavily AI phones are "weak" (unreliable, AI-generated).
    // Maps and website phones are TRUSTED (Maps matches by company name, site is validated by Step 6e).
    // Directories only override Tavily phones or fill gaps. If site is wrong, Step 6e clears it + phone,
    // then Step 6e+ recovers from directories.
    const telefonoFromWeakSource = telFonteForCheck.includes('tavily')
    const hasMapsSource2b3 = fonti.some(f => /google maps/i.test(f)) || String((result as any).telefono_fonte || '').toLowerCase().includes('google maps')
    if (!result.sito && !hasMapsSource2b3 && (!result.telefono || telefonoFromWeakSource) && companyName.length >= 3) {
      const q2b3 = `"${companyName}" ${city} telefono contatti site:reteimprese.it OR site:paginegialle.it`
      const text2b3 = await tavilySearch(q2b3, false, true)
      if (text2b3.length > 50) {
        // Extract Italian phones from the text (formato: +39 0XXXXXXXX o +39 3XXXXXXXX)
        const phonePattern = /(?:\+?\s*39\s*)?[03]\d[\s\.\-]?\d{2,4}[\s\.\-]?\d{2,4}[\s\.\-]?\d{0,4}/g
        const phones: string[] = []
        let phM
        while ((phM = phonePattern.exec(text2b3)) !== null) {
          phones.push(phM[0].trim())
        }
        // Tokenize company name into individual words (≥4 chars) — handles cases like
        // "G.E.M di Marco Gorgone" → ["marco","gorgone"] which matches both "di Marco Gorgone"
        // and the reverse "di Gorgone Marco" used by Italian directories.
        const STOP_TOKENS = new Set([
          'srl','srls','spa','sas','snc','italia','italy','group','holding',
          'milano','roma','napoli','torino','bologna','firenze',
          // Generic business descriptors that appear in many company names
          'officina','officine','meccanica','meccaniche','industriale','industriali','industria',
          'studio','studi','agenzia','agenzie','consorzio','cooperativa','fondazione','associazione',
          'edile','edili','costruzioni','costruzione','impianti','servizi','commerciale','tecnica',
          'azienda','impresa','ditta',
        ])
        const compTokens2b3 = companyName.toLowerCase()
          .replace(/[^a-zà-ù0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 4 && !STOP_TOKENS.has(t) && !COMMON_ITALIAN_NAMES.has(t))
        if (compTokens2b3.length === 0) {
          // Fallback: use the full collapsed name
          compTokens2b3.push(companyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8))
        }
        const text2b3Low = text2b3.toLowerCase()
        // Pick the FIRST phone that appears within 300 chars of at least ONE company name token.
        // The Tavily query already includes the city, so results should be city-relevant.
        for (const ph of phones) {
          const phIdx = text2b3.indexOf(ph)
          if (phIdx === -1) continue
          const window = text2b3Low.slice(Math.max(0, phIdx - 300), phIdx + 50)
          if (compTokens2b3.some(t => window.includes(t))) {
            const digits = ph.replace(/\D/g, '')
            const core = digits.startsWith('39') ? digits.slice(2) : digits
            // Italian fixed line starts with 0; mobile with 3
            if (/^0\d{8,10}$/.test(core)) {
              // Don't accept phone that is actually the P.IVA
              const pivaDigits2b3 = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
              if (pivaDigits2b3 && core === pivaDigits2b3) {
                console.log(`[COMPANY-LOOKUP] Search 2b3: REJECTED phone "${ph}" — matches P.IVA`)
                continue
              }
              const prevPhone = result.telefono ? String(result.telefono) : ''
              const prevDigits = prevPhone.replace(/\D/g, '')
              const prevCore = prevDigits.startsWith('39') ? prevDigits.slice(2) : prevDigits
              if (prevCore && prevCore !== core) {
                console.log(`[COMPANY-LOOKUP] Search 2b3: OVERRIDE Maps phone "${prevPhone}" → Reteimprese "${ph}"`)
              }
              result.telefono = ph
              result.telefono_fonte = 'Reteimprese.it'
              if (!fonti.includes('Reteimprese.it')) fonti.push('Reteimprese.it')
              tavilyUsed = true
              console.log(`[COMPANY-LOOKUP] Search 2b3: telefono from Italian directory: ${ph}`)
              break
            }
          }
        }
      }
    }

    // ── Search 2b4: PagineBianche.it — fetch diretto dell'HTML (i numeri sono nascosti via CSS, ma presenti nel DOM) ──
    // PagineBianche shows business listings with phones inside <span class="search-itm__phone-item">PHONE</span>.
    // The phone div has class "hidden" so it only appears when clicking "Telefono" — but the data is in HTML.
    // Tavily snippets miss them because Tavily may strip hidden elements; direct fetch picks them up.
    if (!result.sito && !telefonoFromMapsOuter && !result.telefono && companyName.length >= 3) {
      try {
        const pbCity = city || 'Milano'
        // Strip city/legal-suffix from the search query — PagineBianche treats them as strict keywords.
        // The city is already passed via dv=, so duplicating it makes 0-result searches.
        const pbQuery = companyName
          .replace(new RegExp(`\\b${pbCity}\\b`, 'gi'), '')
          .replace(/\b(srl|srls|spa|sas|snc|s\.r\.l\.?|s\.p\.a\.?|s\.a\.s\.?|s\.n\.c\.?)\b\.?/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
        const pbUrl = `https://www.paginebianche.it/aziende?qs=${encodeURIComponent(pbQuery || companyName)}&dv=${encodeURIComponent(pbCity)}`
        console.log(`[COMPANY-LOOKUP] Search 2b4 PagineBianche: fetching ${pbUrl}`)
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 12000)
        const pbRes = await fetch(pbUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5',
          },
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        if (pbRes.ok) {
          const pbHtml = await pbRes.text()
          // Split the HTML into listing chunks. Each listing starts with `data-tr="listing-search-itm"` or a similar pattern.
          // We use a simpler split: chunks separated by "search-itm__name" (each listing has exactly one of these).
          // PagineBianche uses class "search-itm__rag" for the business name (rag = ragione sociale).
          // We split there so each chunk = one full listing (name + category + address + phone).
          const chunks = pbHtml.split(/search-itm__rag/i).slice(1)
          // Tokenize company name (≥3 chars), strip stop words.
          // Extended stop list: common business descriptors that appear in MANY company names
          // and would cause false-positive matches (e.g. "Officina Meccanica X" + "Officina Meccanica Y").
          const STOP_PB = new Set([
            'srl','srls','spa','sas','snc','italia','italy','group','holding','company','azienda','impresa','ditta',
            'officina','officine','meccanica','meccaniche','industriale','industriali','industria',
            'studio','studi','agenzia','agenzie','consorzio','cooperativa','fondazione','associazione',
            'edile','edili','costruzioni','costruzione','impianti','impianto','servizi','servizio',
            'commerciale','commerciali','tecnica','tecnico','generale','generali','nuova','nuovo','dei','del','della',
          ])
          const compTokensPB = companyName.toLowerCase()
            .replace(/[^a-zà-ù0-9\s]/gi, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3 && !STOP_PB.has(t) && !COMMON_ITALIAN_NAMES.has(t))
          if (compTokensPB.length === 0) compTokensPB.push(companyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6))
          // For each listing chunk, extract name, phone, address
          let bestPhone: string | null = null
          let bestScore = 0
          for (const chunk of chunks) {
            // Each listing chunk is 10-19k chars. The first phone-item (landline) appears ~5000 chars in.
            // We use the full chunk because chunks are already split by listing (one chunk = one listing).
            const c = chunk.slice(0, 25000)
            const phoneM = c.match(/search-itm__phone-item">([^<]+)</i)
            if (!phoneM) continue
            const phone = phoneM[1].trim()
            const phoneDigits = phone.replace(/\D/g, '')
            // Italian fixed line (0x...) or mobile (3xx) — between 9 and 12 digits total
            if (phoneDigits.length < 9 || phoneDigits.length > 12) continue
            if (!/^[03]/.test(phoneDigits)) continue
            // Strip HTML tags and decode entities to compare with company tokens
            const plain = c.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').toLowerCase()
            // Only check the first ~600 chars of the listing (where the name appears)
            const head = plain.slice(0, 600)
            const score = compTokensPB.filter(t => head.includes(t)).length
            if (score > bestScore) {
              bestScore = score
              bestPhone = phone
            }
          }
          if (bestPhone && bestScore >= Math.min(2, compTokensPB.length)) {
            const prevPhonePb = result.telefono ? String(result.telefono) : ''
            const prevDigitsPb = prevPhonePb.replace(/\D/g, '')
            const newDigitsPb = bestPhone.replace(/\D/g, '')
            if (prevDigitsPb && prevDigitsPb !== newDigitsPb) {
              console.log(`[COMPANY-LOOKUP] Search 2b4 PagineBianche: OVERRIDE Maps phone "${prevPhonePb}" → "${bestPhone}" (score ${bestScore}/${compTokensPB.length})`)
            } else {
              console.log(`[COMPANY-LOOKUP] Search 2b4 PagineBianche: telefono = "${bestPhone}" (score ${bestScore}/${compTokensPB.length})`)
            }
            result.telefono = bestPhone
            result.telefono_fonte = 'PagineBianche.it'
            if (!fonti.includes('PagineBianche.it')) fonti.push('PagineBianche.it')
          } else {
            console.log(`[COMPANY-LOOKUP] Search 2b4 PagineBianche: no listing matched "${companyName}" (best score ${bestScore})`)
          }
        } else {
          console.log(`[COMPANY-LOOKUP] Search 2b4 PagineBianche: HTTP ${pbRes.status}`)
        }
      } catch (err: any) {
        console.log(`[COMPANY-LOOKUP] Search 2b4 PagineBianche: error ${err?.message || err}`)
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
    const openApiTitolareNow = Boolean(result.titolare && (result as any).titolare_fonte && /openapi/i.test(String((result as any).titolare_fonte)))
    if ((openApiTitolare || openApiTitolareNow) && result.titolare) {
      console.log(`[COMPANY-LOOKUP] Search 2d (titolare): SKIPPED (openApiTitolare="${result.titolare}")`)
    } else if (!result.titolare) {
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
                // Extract LinkedIn URL if present (must match the candidate name)
                const liUrlM = text2d1_li.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s"',)]+/i)
                if (liUrlM && validateLinkedInForName(liUrlM[0], candidateName)) ext2d1_li.linkedin_titolare = liUrlM[0]
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
            if (ext2d1_li.linkedin_titolare && !isJunkValue(ext2d1_li.linkedin_titolare) && validateLinkedInForName(ext2d1_li.linkedin_titolare, ext2d1_li.titolare)) {
              result.linkedin_titolare = ext2d1_li.linkedin_titolare
            } else if (ext2d1_li.linkedin_titolare) {
              console.log(`[COMPANY-LOOKUP] Search 2d1 LinkedIn: REJECTED unrelated URL "${ext2d1_li.linkedin_titolare}" for "${ext2d1_li.titolare}"`)
            }
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
              if (ext2d1b.linkedin_titolare && !isJunkValue(ext2d1b.linkedin_titolare) && validateLinkedInForName(ext2d1b.linkedin_titolare, ext2d1b.titolare)) {
                result.linkedin_titolare = ext2d1b.linkedin_titolare
              } else if (ext2d1b.linkedin_titolare) {
                console.log(`[COMPANY-LOOKUP] Search 2d1b: REJECTED unrelated URL "${ext2d1b.linkedin_titolare}" for "${ext2d1b.titolare}"`)
              }
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
          if (nj(ext2e1.linkedin) && validateLinkedInForName(ext2e1.linkedin, titName)) {
            result.linkedin_titolare = ext2e1.linkedin
          } else if (nj(ext2e1.linkedin)) {
            console.log(`[COMPANY-LOOKUP] Search 2e1: REJECTED unrelated LinkedIn URL "${ext2e1.linkedin}" for "${titName}"`)
          }
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
          // Even in the unverified branch, never accept a LinkedIn that fails country/name slug rules.
          // The previous loose substring check accepted Qatar/UK profiles as long as ANY 3-char
          // name part appeared in the URL — exactly how "Belal A Dawali" was linked to Belal Al Dawall (Qatar).
          if (nj(ext2e1.linkedin) && validateLinkedInForName(ext2e1.linkedin, titName)) {
            result.linkedin_titolare = ext2e1.linkedin
          } else if (nj(ext2e1.linkedin)) {
            console.log(`[COMPANY-LOOKUP] Search 2e1 (unverified): REJECTED loose LinkedIn URL "${ext2e1.linkedin}" for "${titName}"`)
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
- "${titName}" è una persona ITALIANA che opera in Italia${cityCtx ? ` nella zona di ${cityCtx}` : ''}. Se il testo parla di una persona con lo stesso nome ma residente in USA/UK/Spagna/altri paesi, IGNORA quei dati e restituisci campi vuoti.
- OMONIMIA: se trovi più persone con lo stesso nome, scegli SOLO quella collegata a "${compForTit}"${cityCtx ? ` a ${cityCtx}` : ''}. Se il profilo social descrive una professione DIVERSA dal settore dell'azienda o una città DIVERSA${cityCtx ? ` da ${cityCtx}` : ''}, è probabilmente un OMONIMO — restituisci campi vuoti.
- Telefono: accetta SOLO numeri italiani (formato +39 XXX, 0XX XXXXXXX, 3XX XXXXXXX). RIFIUTA numeri con prefissi esteri come +1 (USA), +44 (UK), (XXX) XXX-XXXX (formato USA).
- Città: SOLO città italiane. Se trovi "Dublin, CA" o "New York" o simili, NON è la persona giusta — restituisci campi vuoti.
- Instagram/Facebook: accetta solo se il profilo è chiaramente collegato a "${compForTit}" o al settore dell'azienda. Se il profilo mostra una professione diversa (es. graphic designer, musicista, attore) NON collegata all'azienda, è un OMONIMO — restituisci null.
- NON inventare URL. Se non hai conferma che il profilo appartenga AL TITOLARE DI QUESTA SPECIFICA AZIENDA, restituisci campi vuoti.
JSON:
{"instagram":"URL Instagram trovato","facebook":"URL Facebook trovato","twitter":"URL Twitter/X trovato","email_personale":"email personale (non aziendale)","telefono_personale":"telefono italiano della persona (non estero)","citta":"città italiana di residenza","interessi":"interessi e hobby dal social"}`)
          if (!result.linkedin_titolare && nj(ext2e2.linkedin) && validateLinkedInForName(ext2e2.linkedin, titName)) {
            result.linkedin_titolare = ext2e2.linkedin
          } else if (!result.linkedin_titolare && nj(ext2e2.linkedin)) {
            console.log(`[COMPANY-LOOKUP] Search 2e2: REJECTED unrelated LinkedIn URL "${ext2e2.linkedin}" for "${titName}"`)
          }
          // ★ ANTI-OMONIMIA: if the social profile says a DIFFERENT city than the company,
          // it's likely a DIFFERENT person with the same name (e.g. Marco Gorgone graphic designer
          // in Treviso vs Marco Gorgone titolare of GEM in Milan). Reject social profiles in that case.
          const socialCityOk = (() => {
            if (!nj(ext2e2.citta) || !cityCtx) return true // can't validate, accept
            const socialCity = String(ext2e2.citta).toLowerCase().trim()
            const compCity = String(cityCtx).toLowerCase().trim()
            // Same city or province → accept
            if (socialCity === compCity || socialCity.includes(compCity) || compCity.includes(socialCity)) return true
            // Different city → likely a homonym, reject social
            console.log(`[COMPANY-LOOKUP] Search 2e2: ⚠️ CITY MISMATCH — social profile city "${socialCity}" ≠ company city "${compCity}" — likely HOMONYM, rejecting social profiles`)
            return false
          })()
          if (socialCityOk) {
            if (nj(ext2e2.instagram)) result.instagram_titolare = ext2e2.instagram
            if (nj(ext2e2.facebook)) result.facebook_titolare = ext2e2.facebook
            if (nj(ext2e2.twitter)) result.twitter_titolare = ext2e2.twitter
          } else {
            console.log(`[COMPANY-LOOKUP] Search 2e2: REJECTED instagram="${ext2e2.instagram}" facebook="${ext2e2.facebook}" (homonym in different city)`)
          }
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
          // Find ALL LinkedIn /in/ URLs and pick the first one whose slug matches the titolare's name
          const liMatches = [...text2e4.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9._-]+/gi)].map(m => m[0])
          const validLi = liMatches.find(url => validateLinkedInForName(url, titName))
          if (validLi) {
            result.linkedin_titolare = validLi
            console.log(`[COMPANY-LOOKUP] Search 2e4: LinkedIn from site search (name-validated): ${validLi}`)
          } else if (liMatches.length > 0) {
            console.log(`[COMPANY-LOOKUP] Search 2e4: REJECTED ${liMatches.length} unrelated LinkedIn URL(s) for "${titName}" — none matched`)
          }
        }
      }

      console.log(`[COMPANY-LOOKUP] Search 2e done — linkedin_tit=${result.linkedin_titolare || 'none'} bio=${!!result.bio_titolare} seniority=${result.seniority_titolare || 'none'} esperienze=${!!result.esperienze_titolare} formazione=${!!result.formazione_titolare} social=${!!(result.instagram_titolare || result.facebook_titolare)}`)
    }

    // ── Search 3 DISABILITATA: generava ISO 9001/SOA allucinati per qualunque azienda
    //    (anche SRLS senza certificazioni reali). I campi ha_flotta_veicoli,
    //    ha_immobili_proprieta, partecipa_appalti_pubblici, rischi_specifici,
    //    note_broker, sinistri_noti, attivita_estero erano TUTTI GPT-extract da
    //    Tavily senza verifica strutturata. Stessa fattispecie di lead-registry
    //    Search 3 (già disabilitata). Risparmio: 1 Tavily + 1 GPT call per single search.
    //    Se servono certificazioni reali, integrare con Accredia (registro ufficiale ISO).

    if (tavilyUsed) fonti.push('Tavily (ricerca web)')
  }

  // ─── Step 4b: STANDALONE Titolare fallback — runs ALWAYS if titolare missing ───
  // The main Tavily block (Search 2d1) is gated by !leadRegistryDone.
  // If lead-registry provided financial data, the entire Tavily block is skipped — including titolare.
  // This standalone search ensures we ALWAYS try to find the titolare via LinkedIn.
  // ALWAYS run — even if titolare is set — because GPT/Gemini often hallucinate names.
  // LinkedIn is the most reliable source: "Marco Danuvola - CEO - Consorzio Standby 2p0"
  // If LinkedIn finds a verified match, OVERRIDE whatever was set before.
  // BUT: skip if OpenAPI gave us certified titolare (no override needed — OpenAPI is from Camera di Commercio)
  const openApiTitolare4b = Boolean(result.titolare && (result as any).titolare_fonte && /openapi/i.test(String((result as any).titolare_fonte)))
  if ((openApiTitolare || openApiTitolare4b) && result.titolare) {
    console.log(`[COMPANY-LOOKUP] Step 4b: SKIPPED (openApiTitolare — titolare certificato da OpenAPI)`)
  } else if (!openApiCameraleAvailable && (result.ragione_sociale || queryCompanyName) && tavilyKey && openaiKey) {
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
        // Normalize legal forms for matching: "s.r.l." → "srl", "s.p.a." → "spa" etc.
        const normLegal = (s: string) => s.replace(/\bs\.?\s*r\.?\s*l\.?\s*s?\.?\b/gi, 'srl').replace(/\bs\.?\s*p\.?\s*a\.?\b/gi, 'spa').replace(/\bs\.?\s*n\.?\s*c\.?\b/gi, 'snc').replace(/\bs\.?\s*a\.?\s*s\.?\b/gi, 'sas').replace(/[.,']/g, '').replace(/\s+/g, ' ').trim()
        const fullCompanyNorm4b = normLegal(fullCompanyKey4b)
        const hasStrongRegistryContext4b = (hay: string) => {
          if (piva4b.length === 11 && hay.includes(piva4b)) return true
          if (fullCompanyKey4b.length >= 8 && hay.includes(fullCompanyKey4b)) return true
          // Also match with normalized legal forms (e.g. "Svemu srl" matches "Svemu S.r.l.")
          if (fullCompanyNorm4b.length >= 6 && normLegal(hay).includes(fullCompanyNorm4b)) return true
          return false
        }
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
                    if (validateLinkedInWithContext(String(ext4b.linkedin_titolare), titName4b, { text: text4b, companyName: compName4b, piva: piva4b, city: city4b })) {
                      result.linkedin_titolare = ext4b.linkedin_titolare
                    } else {
                      console.log(`[COMPANY-LOOKUP] Step 4b: REJECTED unrelated LinkedIn URL "${ext4b.linkedin_titolare}" for "${titName4b}" — name/country/company mismatch`)
                    }
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
  const needsContacts = !result.telefono || !result.email || !result.sito || !result.cellulare || !result.instagram || !result.linkedin || !result.facebook
  if (companyNameNow && needsContacts) {
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
          signal: AbortSignal.timeout(openApiCameraleAvailable ? 15000 : 200000),
        }).catch(() => null)
        if (mapsRes && mapsRes.ok) {
          const mapsData = await mapsRes.json().catch(() => null) as any
          const leads = (mapsData && Array.isArray(mapsData.results)) ? mapsData.results : []
          const lead = leads[0]
          if (lead && typeof lead === 'object') {
            console.log(`[COMPANY-LOOKUP] Round 2a: Maps found "${lead.name}"`)
            // Validate: Maps result name must share tokens with our company name
            const mapsName = String(lead.name || '').toLowerCase().replace(/[^a-zà-ù0-9\s]/gi, ' ')
            const ourName = companyNameNow.toLowerCase().replace(/[^a-zà-ù0-9\s]/gi, ' ')
            const ourTokens = ourName.split(/\s+/).filter(t => t.length >= 3 && !/^(srl|srls|spa|sas|snc|di|del|della|dei|degli|delle|il|la|lo|le|gli|un|una|per|con|tra|fra|societa|società|responsabilita|responsabilità|limitata|limitato|azioni|accomandita|semplice|agenzia|impresa|ditta|commerciale|industriale|artigiana)$/i.test(t))
            const mapsTokens = mapsName.split(/\s+/).filter(t => t.length >= 3)
            const sharedTokens = ourTokens.filter(t => mapsTokens.some(mt => mt.includes(t) || t.includes(mt)))
            // For short personal names (2 tokens like "Manzo Marina"), require BOTH tokens to match
            // to avoid "Clinica Manzo" matching just because it contains the surname.
            // For longer company names (3+ tokens), 2 matches is sufficient.
            const minShared = ourTokens.length <= 2 ? ourTokens.length : Math.min(2, ourTokens.length)
            const mapsNameValid = ourTokens.length === 0 || sharedTokens.length >= minShared
            if (!mapsNameValid) {
              console.log(`[COMPANY-LOOKUP] Round 2a: Maps REJECTED "${lead.name}" — no shared tokens with "${companyNameNow}" (our: [${ourTokens.join(',')}], maps: [${mapsTokens.join(',')}])`)
            } else {
              const mapsPivaRound2 = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
              const needsPivaVerifiedMaps = isPiva && mapsPivaRound2.length === 11
              const mapsWebsiteRound2 = typeof lead.website === 'string' ? lead.website : ''
              const mapsWebsiteVerifiedRound2 = mapsWebsiteRound2 ? await websiteContainsPivaQuick(mapsWebsiteRound2, mapsPivaRound2) : false
              const mapsAddressVerifiedRound2 = addressMatchesRegistryAddress(lead.address, result.sede_legale || result.indirizzo)
              const mapsContextVerifiedRound2 = mapsLeadMatchesCompanyContext(lead, companyNameNow, result.citta || queryCityHint)
              const mapsVerifiedRound2 = !needsPivaVerifiedMaps || mapsWebsiteVerifiedRound2 || mapsAddressVerifiedRound2 || mapsContextVerifiedRound2
              if (!mapsVerifiedRound2) {
                console.log(`[COMPANY-LOOKUP] Round 2a: Maps contacts/site REJECTED — website/address do not confirm queried P.IVA ${mapsPivaRound2}`)
              } else {
                if (!result.telefono && lead.phone) { result.telefono = lead.phone; result.telefono_fonte = mapsWebsiteVerifiedRound2 ? 'Google Maps (P.IVA verificata su sito)' : mapsAddressVerifiedRound2 ? 'Google Maps (indirizzo verificato)' : 'Google Maps (nome/sede verificati)' }
                if (!result.sito && lead.website) result.sito = lead.website
                if (!result.indirizzo && lead.address) result.indirizzo = lead.address
                if (!result.categoria && lead.category) result.categoria = lead.category
                if (!result.rating && typeof lead.rating === 'number') result.rating = lead.rating
                if (!result.reviews_count && typeof lead.reviews_count === 'number') result.reviews_count = lead.reviews_count
                if (!fonti.includes('Google Maps')) fonti.push('Google Maps')
              }
            }
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
    // Round 2a cleanup: cellulare != P.IVA (with or without leading 0)
    if (result.cellulare && result.partita_iva) {
      const cd = String(result.cellulare).replace(/\D/g, '')
      const pvd = String(result.partita_iva).replace(/\D/g, '')
      if (cd === pvd || ('0' + cd) === pvd || cd === pvd.replace(/^0/, '')) {
        console.log(`[COMPANY-LOOKUP] REMOVED cellulare "${result.cellulare}" (matched P.IVA)`); delete result.cellulare
      }
    }

    // Round 2b: Scrape company website with the same deep scraper used by category/city
    if (result.sito && (!result.email || !result.telefono || !result.cellulare || !result.instagram || !result.linkedin || !result.facebook)) {
      const siteBase = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
      console.log(`[COMPANY-LOOKUP] Round 2b: scrapeWebsiteDeep ${siteBase}`)
      try {
        const deep = await scrapeWebsiteDeep(siteBase)
        console.log(`[COMPANY-LOOKUP] Round 2b: scrapeWebsiteDeep done (${deep.pagesScraped} pages, ${deep.emails.length} emails, ${deep.phones.length} phones)`)
        if (!result.partita_iva && deep.partitaIva) result.partita_iva = deep.partitaIva
        const pivaDigitsForPhone = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
        const isLikelyPiva = (numero: string): boolean => {
          const digits = numero.replace(/\D/g, '')
          if (digits.length === 11 && pivaDigitsForPhone && digits === pivaDigitsForPhone) return true
          if (/^\d{11}$/.test(numero.trim())) return true
          // Also catch P.IVA with leading 0 stripped (e.g. "3653120240" from P.IVA "03653120240")
          if (pivaDigitsForPhone && pivaDigitsForPhone.startsWith('0')) {
            const pivaNoLeadingZero = pivaDigitsForPhone.slice(1)
            if (digits === pivaNoLeadingZero) return true
            if (digits.endsWith(pivaNoLeadingZero)) return true
          }
          // Or if adding a 0 matches the P.IVA
          if (pivaDigitsForPhone && ('0' + digits) === pivaDigitsForPhone) return true
          return false
        }
        const landline = deep.phones.find(p => p.type === 'landline' && !isLikelyPiva(p.number))
        if (landline) {
          const telFonte = String((result as any).telefono_fonte || '').toLowerCase()
          if (!result.telefono || !/sito ufficiale/i.test(telFonte)) {
            result.telefono = landline.number
            result.telefono_fonte = 'Sito ufficiale azienda'
          }
        }
        const mobile = deep.phones.find(p => p.type === 'mobile' && !isLikelyPiva(p.number))
        if (mobile) {
          const celFonte = String((result as any).cellulare_fonte || '').toLowerCase()
          if (!result.cellulare || !/sito ufficiale/i.test(celFonte)) {
            result.cellulare = mobile.number
            ;(result as any).cellulare_fonte = 'Sito ufficiale azienda'
          }
        }
        if (!result.email) {
          const personalEmail = deep.emails.find(e => e.type === 'personal') || deep.emails.find(e => e.type === 'generic')
          if (personalEmail) result.email = personalEmail.email.toLowerCase()
        }
        ;(result as any).tutti_telefoni = deep.phones
          .filter(p => p.type === 'landline' && !isLikelyPiva(p.number))
          .map(p => ({ numero: p.number, fonte: 'Sito ufficiale azienda', pagina: p.page }))
        ;(result as any).tutti_cellulari = deep.phones
          .filter(p => p.type === 'mobile' && !isLikelyPiva(p.number))
          .map(p => ({ numero: p.number, fonte: 'Sito ufficiale azienda', pagina: p.page }))
        ;(result as any).tutte_email = deep.emails
          .filter(e => e.type === 'personal' || e.type === 'generic')
          .map(e => ({ email: e.email.toLowerCase(), tipo: e.type, pagina: e.page }))
        if (!result.sede_legale && deep.address) result.sede_legale = deep.address
        const PROVIDER_NAMES = ['italiaonline', 'paginegialle', 'paginebianche', 'getfound', 'misterimprese', 'wix', 'squarespace', 'webflow', 'wordpress', 'godaddy', 'aruba', 'register', 'netsons', 'hostinger', 'seoinitalia', 'altervista', 'altervistaorg', 'jimdo']
        const queryNameLower = (queryCompanyName || companyNameNow || '').toLowerCase()
        const isProviderSocial = (url: string | null | undefined): boolean => {
          if (!url || typeof url !== 'string') return false
          const urlLower = url.toLowerCase()
          for (const provider of PROVIDER_NAMES) {
            const rx = new RegExp(`\\/(${provider})(?:\\/|$|\\?)`, 'i')
            if (rx.test(urlLower)) return !queryNameLower.includes(provider)
          }
          return false
        }
        if (!result.linkedin && deep.socialLinks.linkedin && !isProviderSocial(deep.socialLinks.linkedin)) result.linkedin = deep.socialLinks.linkedin
        if (!result.facebook && deep.socialLinks.facebook && !isProviderSocial(deep.socialLinks.facebook)) result.facebook = deep.socialLinks.facebook
        if (!result.instagram && deep.socialLinks.instagram && !isProviderSocial(deep.socialLinks.instagram)) result.instagram = deep.socialLinks.instagram
        if (!result.youtube && deep.socialLinks.youtube && !isProviderSocial(deep.socialLinks.youtube)) result.youtube = deep.socialLinks.youtube
        if (!result.twitter && deep.socialLinks.twitter && !isProviderSocial(deep.socialLinks.twitter)) result.twitter = deep.socialLinks.twitter
        if (!fonti.includes('Sito Web Aziendale') && (deep.pagesScraped > 0 || deep.emails.length > 0 || deep.phones.length > 0 || deep.socialLinks.linkedin || deep.socialLinks.facebook || deep.socialLinks.instagram)) fonti.push('Sito Web Aziendale')
      } catch (e: any) {
        console.log(`[COMPANY-LOOKUP] Round 2b: scrapeWebsiteDeep error: ${e?.message || e}`)
      }
    }

    // Round 2c: CompanyReports.it (if we now have P.IVA but still miss financial data)
    if (!openApiCameraleAvailable && result.partita_iva && (!result.fatturato || !result.dipendenti)) {
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

  // ─── Shared Phone Prefix Dictionary ───
  const PROV_PREFIX: Record<string, string[]> = {
    'MI':['02'],'RM':['06'],'NA':['081'],'TO':['011'],'GE':['010'],
    'BO':['051'],'FI':['055'],'PA':['091'],'CT':['095'],'BA':['080'],
    'VE':['041'],'VR':['045'],'PD':['049'],'BS':['030'],'BG':['035'],
    'VI':['0444','0445'],'ME':['090','0941'],'RC':['0965'],'CS':['0984'],'CZ':['0961'],
  }
  const CITY_PREFIX: Record<string, string[]> = {
    'milano':['02'],'roma':['06'],'napoli':['081'],'torino':['011'],'genova':['010'],
    'bologna':['051'],'firenze':['055'],'palermo':['091'],'catania':['095'],'bari':['080'],
    'venezia':['041'],'verona':['045'],'padova':['049'],'brescia':['030'],'bergamo':['035'],
    'vicenza':['0444','0445'],'messina':['090','0941'],'reggio calabria':['0965'],'cosenza':['0984'],'catanzaro':['0961'],
  }
  const provUp5a = String(result.provincia || '').toUpperCase().trim()
  const cityLow5a = String(result.citta || queryCityHint || '').toLowerCase().trim()
  const expectedPrefixes5a = PROV_PREFIX[provUp5a] || CITY_PREFIX[cityLow5a]

  // ─── Pre-Step 5a: Phone Prefix Sanity Check ───
  // Clear phones that have blatantly wrong area codes for the known city/province
  if (result.telefono && expectedPrefixes5a) {
    const phoneClean = String(result.telefono).replace(/\D/g, '').replace(/^(0039|39)/, '')
    // Only check landlines (starting with 0)
    if (phoneClean.startsWith('0')) {
      const prefixOk = expectedPrefixes5a.some(p => phoneClean.startsWith(p))
      if (!prefixOk) {
        console.log(`[COMPANY-LOOKUP] Pre-Step 5a: phone "${result.telefono}" area code does NOT match province/city "${provUp5a || cityLow5a}" — clearing wrong phone`)
        delete result.telefono
        delete (result as any).telefono_fonte
      }
    }
  }

  // ─── Step 5a: PagineGialle/Reteimprese phone search ───
  // BLOCKED for P.IVA searches (pivaOnlyNoName) — micro-businesses return wrong results from directories
  // For name searches: runs after Round 2 as fallback
  const compNameForPhone = (result.ragione_sociale || queryCompanyName || '') as string
  const cityForPhone = (result.citta || queryCityHint || '') as string
  // ★ Also run when telefono came from a weak source (Tavily AI) — Reteimprese is more reliable
  const telFonte5a = String((result as any).telefono_fonte || '').toLowerCase()
  // Only Tavily is weak — Maps is reliable (name-matched), site is validated by Step 6e
  const telWeak5a = telFonte5a.includes('tavily')
  const hasMapsSource5a = fonti.some(f => /google maps/i.test(f)) || telFonte5a.includes('google maps')
  let directoryPhoneSearchAttempted = false
  if (!pivaOnlyNoName && !result.sito && !hasMapsSource5a && (!result.telefono || telWeak5a) && compNameForPhone.length >= 3 && process.env.TAVILY_API_KEY) {
    directoryPhoneSearchAttempted = true
    // Try reteimprese first (most reliable), then paginegialle, then paginebianche
    // Build BOTH exact-match ("full name") AND relaxed (just distinctive tokens) queries.
    // The quoted query works for common names; the relaxed query catches acronyms like G.E.M
    // where dots/periods break exact-match search.
    const STOP_5a = new Set([
      'srl','srls','spa','sas','snc','italia','italy','group','holding',
      'milano','roma','napoli','torino','bologna','firenze','genova','palermo','bari','catania','venezia','verona','padova','brescia','bergamo','monza',
      'officina','officine','meccanica','meccaniche','industriale','industriali','industria',
      'studio','studi','agenzia','agenzie','consorzio','cooperativa','fondazione','associazione',
      'edile','edili','costruzioni','costruzione','impianti','servizi','commerciale','tecnica',
      'azienda','impresa','ditta','societa','società','responsabilita','responsabilità','limitata','forma','abbreviata','liquidazione',
    ])
    const cityTokenForPhone = cityForPhone.toLowerCase().replace(/[^a-zà-ù0-9]/gi, '')
    const relaxedTokens5a = compNameForPhone.toLowerCase()
      .replace(/[^a-zà-ù0-9\s]/gi, ' ').split(/\s+/)
      .filter(t => t.length >= 4 && !STOP_5a.has(t) && t !== cityTokenForPhone)
    const relaxedQuery5a = relaxedTokens5a.length >= 1
      ? `${relaxedTokens5a.join(' ')} ${cityForPhone} telefono`
      : ''
    // ★ Build address-based queries: very precise, finds the exact listing on Reteimprese
    // e.g. "Cermenate" "Gorgone" site:reteimprese.it → hits the category page listing
    const rawAddr5a = String(result.indirizzo || result.sede_legale || '').trim()
    const addrStreet5a = rawAddr5a.replace(/[,\-–].*/,'').replace(/\d+/g,'').replace(/\b(via|viale|corso|piazza|piazzale|largo|vicolo|str|strada|loc|fraz|n)\b\.?/gi,'').replace(/[^a-zà-ù\s]/gi,' ').trim().split(/\s+/).filter(t => t.length >= 5).slice(0,2).join(' ')
    const addrQueries5a: string[] = []
    if (addrStreet5a.length >= 5 && relaxedTokens5a.length >= 1) {
      // Address + company surname → very specific
      addrQueries5a.push(`"${addrStreet5a}" ${relaxedTokens5a[0]} ${cityForPhone} site:reteimprese.it`)
    }
    const pivaDigits5a = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
    const phoneQueries = [
      ...(pivaDigits5a.length === 11 ? [`"${pivaDigits5a}" telefono site:reteimprese.it`] : []),
      `"${compNameForPhone}" ${cityForPhone} telefono site:reteimprese.it`,
      ...(relaxedQuery5a ? [`${relaxedQuery5a} site:reteimprese.it`] : []),
      ...addrQueries5a,
      ...(pivaDigits5a.length === 11 ? [`"${pivaDigits5a}" telefono site:paginegialle.it`] : []),
      `"${compNameForPhone}" ${cityForPhone} telefono contatti site:paginegialle.it`,
      ...(relaxedQuery5a ? [`${relaxedQuery5a} site:paginegialle.it`] : []),
      ...(pivaDigits5a.length === 11 ? [`"${pivaDigits5a}" telefono site:paginebianche.it`] : []),
      `"${compNameForPhone}" ${cityForPhone} telefono site:paginebianche.it`,
    ]
    // PER-RESULT extraction: only from Tavily results whose title/URL match company name
    const pgTokens5a = compNameForPhone.toLowerCase().replace(/[^a-zà-ù0-9\s]/gi, ' ').split(/\s+/).filter(t => t.length >= 4 && !COMMON_ITALIAN_NAMES.has(t))
      .filter(t => !STOP_5a.has(t) && t !== cityTokenForPhone)
    if (pgTokens5a.length === 0) {
      pgTokens5a.push(compNameForPhone.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8))
    }
    const addr5a = String(result.indirizzo || result.sede_legale || '').toLowerCase().replace(/[^a-zà-ù0-9\s]/g, ' ').split(/[,\-–]/)[0]?.trim()
    for (const pq of phoneQueries) {
      if (result.telefono && !telWeak5a) break
      try {
        console.log(`[COMPANY-LOOKUP] Step 5a: phone search — ${pq}`)
        const pgRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: pq,
            search_depth: 'advanced', max_results: 3,
          }),
          signal: AbortSignal.timeout(12000),
        })
        if (!pgRes.ok) continue
        const pgData = await pgRes.json()
        for (const tavRes5a of (pgData.results || [])) {
          if (result.telefono && !telWeak5a) break
          const title5a = String(tavRes5a.title || '').toLowerCase()
          const url5a = String(tavRes5a.url || '').toLowerCase()
          const content5a = String(tavRes5a.content || '')
          const contentLow5a = content5a.toLowerCase()
          const contentHasPiva5a = pivaDigits5a.length === 11 && content5a.replace(/\D/g, '').includes(pivaDigits5a)
          // ★ ANTI-OMONIMIA: reject results whose title belongs to a DIFFERENT company in a DIFFERENT city.
          // Category pages (e.g. "Impianti condizionamento aria Milano") are OK — they list multiple companies
          // and include the target city. But "Officine Meccaniche a Appiano Gentile" is clearly a different
          // company in a different city and should NOT contribute a phone for a Milano company.
          const city5aLow = cityForPhone.toLowerCase().replace(/[^a-zà-ù]/g, '')
          const titleHasCompanyToken = pgTokens5a.some(t => title5a.includes(t))
          const titleHasCity = city5aLow.length >= 3 && title5a.includes(city5aLow)
          const addrOk5a = addr5a && addr5a.length >= 8 && contentLow5a.includes(addr5a)
          const contentHasCompanyToken5a = pgTokens5a.some(t => contentLow5a.includes(t))
          const strongDirectoryIdentity5a = Boolean(
            addrOk5a ||
            (contentHasPiva5a && (titleHasCompanyToken || contentHasCompanyToken5a)) ||
            (titleHasCompanyToken && (!city5aLow || titleHasCity || contentLow5a.includes(city5aLow)))
          )
          if (!strongDirectoryIdentity5a) {
            console.log(`[COMPANY-LOOKUP] Step 5a: SKIP result — weak directory identity for "${tavRes5a.title}" (companyToken=${titleHasCompanyToken || contentHasCompanyToken5a}, city=${titleHasCity}, piva=${contentHasPiva5a}, addr=${Boolean(addrOk5a)})`)
            continue
          }
          const phonePattern = /(?:\+?\s*39\s*)?[03]\d[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{0,4}/g
          let phM
          while ((phM = phonePattern.exec(content5a)) !== null) {
            const ph = phM[0].trim()
            const phIdx = phM.index
            const win5a = contentLow5a.slice(Math.max(0, phIdx - 300), phIdx + 50)
            const nameNear = pgTokens5a.some(t => win5a.includes(t)) || addrOk5a || (contentHasPiva5a && titleHasCompanyToken)
            if (!nameNear) continue
            const digits = ph.replace(/\D/g, '')
            const core = digits.startsWith('39') ? digits.slice(2) : digits
            if (/^0\d{8,10}$/.test(core)) {
              if (expectedPrefixes5a) {
                const prefixOk = expectedPrefixes5a.some(p => core.startsWith(p))
                if (!prefixOk) {
                  console.log(`[COMPANY-LOOKUP] Step 5a: skipped discovered phone ${ph} because area code does NOT match province/city "${provUp5a || cityLow5a}"`)
                  continue
                }
              }
              const srcDomain = pq.includes('reteimprese') ? 'Reteimprese.it' : pq.includes('paginegialle') ? 'PagineGialle.it' : 'PagineBianche.it'
              result.telefono = ph
              result.telefono_fonte = srcDomain
              if (!fonti.includes(srcDomain)) fonti.push(srcDomain)
              console.log(`[COMPANY-LOOKUP] Step 5a: phone from ${srcDomain}: ${ph} (title="${tavRes5a.title}", addr=${addrOk5a})`)
              break
            }
          }
        }
      } catch { /* try next */ }
    }
  }

  // ─── Step 5b: Extract P.IVA from website (fallback) ───
  if (!leadRegistryDone && result.sito && !result.partita_iva) {
    const pivaFromSite = await extractPivaFromSite(result.sito as string)
    if (pivaFromSite) result.partita_iva = pivaFromSite
  }

  // ─── Step 5c: OpenAPI CATCH-UP — P.IVA trovata DOPO Step 1a3 (via Tavily/scraping) ───
  // Se la P.IVA è stata scoperta in uno step successivo (2b2, 2c, 5b, ecc.),
  // OpenAPI /IT-advanced non è mai stato chiamato. Lo facciamo adesso.
  if (isOpenApiPrimary() && !openApiDone && result.partita_iva && String(result.partita_iva).replace(/\D/g, '').length === 11) {
    const pivaLate = String(result.partita_iva).replace(/\D/g, '')
    console.log(`[COMPANY-LOOKUP] Step 5c: OpenAPI CATCH-UP — P.IVA ${pivaLate} found LATE, calling /IT-advanced now`)
    try {
      const oa = await enrichCompanyByPiva(pivaLate)
      if (oa) {
        const oaNameOk = isPiva || !oa.ragione_sociale || !queryCompanyName || nameMatches(queryCompanyName, oa.ragione_sociale)
        if (!oaNameOk) {
          console.log(`[COMPANY-LOOKUP] Step 5c: REJECTED OpenAPI — ragione sociale "${oa.ragione_sociale}" does NOT match query "${queryCompanyName}"`)
        } else {
          // Ragione sociale (authoritativa — Camera di Commercio)
          if (oa.ragione_sociale) result.ragione_sociale = oa.ragione_sociale
          // Dati strutturali (authoritativi da Registro Imprese)
          const authoritativeCopy = [
            'forma_giuridica', 'forma_giuridica_codice', 'stato_attivita',
            'codice_ateco', 'descrizione_ateco',
            'data_costituzione', 'data_registrazione', 'data_cessazione',
            'codice_rea', 'cciaa', 'sede_legale', 'citta', 'provincia', 'cap',
            'indirizzo_via', 'indirizzo_numero_civico', 'frazione', 'codice_catastale', 'regione',
            'capitale_sociale', 'codice_fiscale', 'pec', 'sito_web',
          ] as const
          if (oa.sito_web && !result.sito) result.sito = oa.sito_web
          for (const k of authoritativeCopy) {
            if ((oa as any)[k] && !(result as any)[k]) (result as any)[k] = (oa as any)[k]
          }
          if (result.telefono && result.provincia) {
            const PROV_PREFIX: Record<string, string[]> = {
              'MI':['02'],'RM':['06'],'NA':['081'],'TO':['011'],'GE':['010'],
              'BO':['051'],'FI':['055'],'PA':['091'],'CT':['095'],'BA':['080'],
              'VE':['041'],'VR':['045'],'PD':['049'],'BS':['030'],'BG':['035'],
              'VI':['0444','0445'],'ME':['090','0941'],'RC':['0965'],'CS':['0984'],'CZ':['0961'],
            }
            const provUp = String(result.provincia).toUpperCase().trim()
            const expectedPrefixes = PROV_PREFIX[provUp]
            if (expectedPrefixes) {
              const phoneClean = String(result.telefono).replace(/\D/g, '').replace(/^(0039|39)/, '')
              const prefixOk = expectedPrefixes.some(p => phoneClean.startsWith(p))
              if (!prefixOk) {
                console.log(`[COMPANY-LOOKUP] Step 5c: phone "${result.telefono}" area code does NOT match province "${provUp}" — clearing wrong phone`)
                delete result.telefono
                delete (result as any).telefono_fonte
              }
            }
          }
          // GPS coordinates
          if (typeof oa.gps_lat === 'number' && typeof oa.gps_lng === 'number') {
            ;(result as any).gps_lat = oa.gps_lat
            ;(result as any).gps_lng = oa.gps_lng
          }
          // ATECO storico
          if (oa.ateco_2022) (result as any).ateco_2022 = oa.ateco_2022
          if (oa.ateco_2007) (result as any).ateco_2007 = oa.ateco_2007
          if (oa.stato_agenzia_entrate) (result as any).stato_agenzia_entrate = oa.stato_agenzia_entrate
          if (oa.codice_sdi) {
            ;(result as any).codice_sdi = oa.codice_sdi
            if (oa.codice_sdi_timestamp) (result as any).codice_sdi_timestamp = oa.codice_sdi_timestamp
          }
          if (oa.gruppo_iva) (result as any).gruppo_iva = oa.gruppo_iva
          if (oa.openapi_id) (result as any).openapi_id = oa.openapi_id
          if (oa.timestamp_creazione) (result as any).timestamp_creazione = oa.timestamp_creazione
          if (oa.timestamp_aggiornamento) (result as any).timestamp_aggiornamento = oa.timestamp_aggiornamento
          // Bilancio
          if (typeof oa.fatturato === 'number') {
            result.fatturato = String(oa.fatturato)
            ;(result as any).fatturato_fonte = 'openapi_registro_imprese'
            if (oa.fatturato_anno) (result as any).fatturato_anno = String(oa.fatturato_anno)
          }
          if (typeof oa.dipendenti === 'number') {
            result.dipendenti = String(oa.dipendenti)
            ;(result as any).dipendenti_fonte = 'openapi_registro_imprese'
          }
          if (typeof oa.costo_personale === 'number') (result as any).costo_personale = String(oa.costo_personale)
          if (typeof oa.patrimonio_netto === 'number') (result as any).patrimonio_netto = String(oa.patrimonio_netto)
          if (typeof oa.totale_attivo === 'number') (result as any).totale_attivo = String(oa.totale_attivo)
          if (typeof oa.ral_medio === 'number') (result as any).ral_medio = String(oa.ral_medio)
          if (oa.storico_bilanci && oa.storico_bilanci.length > 0) (result as any).storico_bilanci = oa.storico_bilanci
          // Titolare
          if (oa.titolare_best) {
            // ★ If titolare changes, clear LinkedIn/social from previous (potentially wrong) Tavily match
            const prevTitolare = String(result.titolare || '').toLowerCase().trim()
            const newTitolare = oa.titolare_best.nomeCompleto.toLowerCase().trim()
            if (prevTitolare && prevTitolare !== newTitolare && result.linkedin_titolare) {
              console.log(`[COMPANY-LOOKUP] Step 5c: titolare changed "${result.titolare}" → "${oa.titolare_best.nomeCompleto}" — clearing old LinkedIn "${result.linkedin_titolare}"`)
              delete result.linkedin_titolare
              delete (result as any).instagram_titolare
              delete (result as any).facebook_titolare
              delete (result as any).bio_titolare
              delete (result as any).esperienze_titolare
              delete (result as any).formazione_titolare
              delete (result as any).competenze_titolare
            }
            // ★ Even if titolare name is the same, validate LinkedIn URL contains the name
            if (result.linkedin_titolare) {
              const liUrl = String(result.linkedin_titolare).toLowerCase()
              const nameParts = newTitolare.split(/\s+/).filter(w => w.length >= 3)
              const liHasName = nameParts.some(p => liUrl.includes(p))
              if (!liHasName) {
                console.log(`[COMPANY-LOOKUP] Step 5c: LinkedIn "${result.linkedin_titolare}" does NOT match titolare "${oa.titolare_best.nomeCompleto}" — clearing`)
                delete result.linkedin_titolare
              }
            }
            result.titolare = oa.titolare_best.nomeCompleto
            result.ruolo_titolare = oa.titolare_best.ruolo
            ;(result as any).titolare_fonte = oa.titolare_best.source === 'stakeholders' ? 'openapi_stakeholders' : 'openapi_shareholders'
            if (oa.titolare_best.taxCode) (result as any).codice_fiscale_titolare = oa.titolare_best.taxCode
            if (oa.titolare_best.dataNascita) (result as any).data_nascita_titolare = oa.titolare_best.dataNascita
            if (typeof oa.titolare_best.eta === 'number') (result as any).eta_titolare = String(oa.titolare_best.eta)
            if (oa.titolare_best.sesso) (result as any).sesso_titolare = oa.titolare_best.sesso
            console.log(`[COMPANY-LOOKUP] Step 5c: Titolare CERTIFICATO = "${oa.titolare_best.nomeCompleto}" (${oa.titolare_best.ruolo})`)
          }
          // Persone (soci + manager)
          const personeOaCatchup: Array<Record<string, unknown>> = []
          for (const sh of (oa.shareholders || [])) {
            if (!sh.nome || !sh.cognome) continue
            const nome = `${sh.nome.charAt(0).toUpperCase()}${sh.nome.slice(1).toLowerCase()} ${sh.cognome.charAt(0).toUpperCase()}${sh.cognome.slice(1).toLowerCase()}`
            personeOaCatchup.push({ nome, ruolo: (oa.shareholders?.length === 1) ? 'Socio Unico' : 'Socio', cf: sh.taxCode, quota: typeof sh.percentShare === 'number' ? `${sh.percentShare}%` : undefined })
          }
          for (const m of (oa.managers || [])) {
            if (!personeOaCatchup.find(p => {
              const pName = String(p.nome).toLowerCase()
              const mName = String(m.nomeCompleto).toLowerCase()
              const mNameReversed = mName.split(' ').reverse().join(' ')
              return pName === mName || pName === mNameReversed
            })) {
              personeOaCatchup.push({ nome: m.nomeCompleto, ruolo: m.isLegalRep ? `${m.ruolo} (Legale Rappresentante)` : (m.ruolo || 'Dirigente'), cf: m.taxCode, data_nascita: m.dataNascita, eta: typeof m.eta === 'number' ? String(m.eta) : undefined, sesso: m.sesso })
            }
          }
          if (personeOaCatchup.length > 0) result.persone = personeOaCatchup
          const sourceLabel = oa.live_calls > 0 ? 'OpenAPI.it (Registro Imprese)' : 'OpenAPI.it (cache)'
          if (!fonti.includes(sourceLabel)) fonti.push(sourceLabel)
          openApiDone = true
          openApiCameraleAvailable = true
          console.log(`[COMPANY-LOOKUP] Step 5c: OpenAPI CATCH-UP complete — cost=€${oa.cost_incurred_eur.toFixed(3)}, fatt=${oa.fatturato ?? 'n/a'}, dip=${oa.dipendenti ?? 'n/a'}`)
        }
      } else {
        console.log(`[COMPANY-LOOKUP] Step 5c: OpenAPI returned no data for ${pivaLate}`)
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] Step 5c: OpenAPI catch-up error: ${e?.message}`)
    }
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
      const nameResult = await searchByName(result.ragione_sociale as string || query, token, (result.citta || queryCityHint || '') as string)
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
  const PEC_DOMAIN_RX = /@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust|casellapec|comunicapec|cert\.cna|cgn\.it|puntopec|pecsicura|pecspecial|brodfrancese|open\.legalmail|gigapec)[a-z0-9.\-]*\.[a-z]{2,}$/i
  if (result.pec && typeof result.pec === 'string' && !PEC_DOMAIN_RX.test(result.pec)) {
    console.log(`[COMPANY-LOOKUP] Step 6a: PEC "${result.pec}" is NOT a valid PEC domain — moving to email, clearing PEC`)
    if (!result.email) result.email = result.pec
    delete result.pec
  }
  // Also: if result.email has a PEC domain, move it to pec (or delete if pec already set)
  if (result.email && typeof result.email === 'string' && PEC_DOMAIN_RX.test(result.email)) {
    if (!result.pec) {
      console.log(`[COMPANY-LOOKUP] Step 6a: email "${result.email}" is a PEC domain — moving to PEC`)
      result.pec = result.email
    } else {
      console.log(`[COMPANY-LOOKUP] Step 6a: email "${result.email}" is a PEC domain and PEC already set — removing duplicate`)
    }
    delete result.email
  }

  if (!result.pec) {
    console.log('[COMPANY-LOOKUP] Step 6b: PEC missing — no Tavily/website PEC search; IT-advanced/OpenAPI/camerale are authoritative')
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
  const PEC_DOMAIN_FINAL_RX = /@(?:[a-z0-9.\-]*\.)?(?:pec|legalmail|pecimprese|arubapec|postecert|cert\.legalmail|pec\.cciaa|pec\.it|sicurezzapostale|registerpec|mypec|actaliscertymail|telecompost|bpm|namirial|infocert|trust|casellapec|comunicapec|cert\.cna|cgn\.it|puntopec|pecsicura|pecspecial|brodfrancese|open\.legalmail|gigapec)[a-z0-9.\-]*\.[a-z]{2,}$/i
  if (result.pec && typeof result.pec === 'string' && !PEC_DOMAIN_FINAL_RX.test(result.pec)) {
    console.log(`[COMPANY-LOOKUP] Step 6d: FINAL VALIDATION — PEC "${result.pec}" is not a valid PEC domain, clearing (better empty than wrong)`)
    if (!result.email) result.email = result.pec
    delete result.pec
  }
  // Final email→PEC swap: if email has PEC domain, move/remove it
  if (result.email && typeof result.email === 'string' && PEC_DOMAIN_FINAL_RX.test(result.email)) {
    if (!result.pec) {
      console.log(`[COMPANY-LOOKUP] Step 6d: FINAL SWAP — email "${result.email}" is PEC domain, moving to PEC`)
      result.pec = result.email
    } else {
      console.log(`[COMPANY-LOOKUP] Step 6d: FINAL SWAP — email "${result.email}" is PEC domain and PEC already set, removing`)
    }
    delete result.email
  }

  // ─── Step 6d+: PEC local-part vs company name validation ───
  // Bug: "telefoniaesicurezza@pec.it" was accepted for "G.E.M Di Gorgone Marco" — completely unrelated.
  // Fix: the PEC local-part (before @) must contain at least one company name token (≥3 chars).
  if (result.pec && typeof result.pec === 'string' && !/openapi|registro/i.test(String((result as any).pec_fonte || ''))) {
    const pecLocalRaw = result.pec.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
    if (pecLocalRaw.length >= 6) {
      const compForPecVal = String(result.ragione_sociale || query || '').toLowerCase()
      const STOP_PEC_VAL = /^(srl|srls|spa|sas|snc|societa|società|group|holding|italia|italy|info|posta|mail|pec|certificata|studio|servizi|service)$/
      const pecValTokens = compForPecVal.replace(/[^a-zà-ù0-9\s]/gi, ' ').split(/\s+/).filter((t: string) => t.length >= 3 && !STOP_PEC_VAL.test(t))
      const pecAcrMatches = String(result.ragione_sociale || query || '').match(/\b(?:[A-Za-zÀ-ú]\.){2,}[A-Za-zÀ-ú]?\b/g) || []
      const pecAcrTokens = pecAcrMatches.map((a: string) => a.replace(/\./g, '').toLowerCase()).filter((a: string) => a.length >= 2)
      const allPecValTokens = [...pecValTokens, ...pecAcrTokens]
      if (allPecValTokens.length > 0) {
        const pecLocalOk = allPecValTokens.some((t: string) => pecLocalRaw.includes(t) || t.includes(pecLocalRaw))
        if (!pecLocalOk) {
          console.log(`[COMPANY-LOOKUP] Step 6d+: REMOVED PEC "${result.pec}" — local part "${pecLocalRaw}" has no overlap with company tokens [${allPecValTokens.join(',')}]`)
          delete result.pec
        }
      }
    }
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
      const PROVIDER_PEC_DOMAINS_6E = new Set([
        'pec.it', 'arubapec.it', 'legalmail.it', 'pecimprese.it', 'pecmail.it',
        'postacert.it', 'postecert.it', 'sicurezzapostale.it', 'registerpec.it',
        'mypec.eu', 'actaliscertymail.it', 'casellapec.com', 'casellapec.it',
        'pec.aruba.it', 'cert.legalmail.it', 'open.legalmail.it', 'pec.cciaa.it',
      ])
      const isPecEmailDomain = PROVIDER_PEC_DOMAINS_6E.has((emailDomain || '').toLowerCase())
        || /(?:^pec\.|^legalmail\.|^pecimprese\.|^arubapec\.|^postecert\.|^casellapec\.|^certmail\.)/i.test(emailDomain || '')
        || /\.(pec|legalmail|pecimprese|arubapec|postecert|sicurezzapostale|registerpec|mypec|actaliscertymail|casellapec|namirial|infocert)\./i.test(emailDomain || '')
        || /\.(pec\.it|legalmail\.it|arubapec\.it|pecimprese\.it)$/i.test(emailDomain || '')
      if (emailDomain && currentDomain !== emailDomain && !isGenericEmailDomain && !isPecEmailDomain && compactName.length >= 5 && (emailDomainKey.includes(compactName) || compactName.includes(emailDomainKey))) {
        console.log(`[COMPANY-LOOKUP] Step 6e: replacing website "${result.sito}" with email-domain website "https://${emailDomain}"`)
        result.sito = `https://${emailDomain}`
      }
    } catch { /* keep existing sito */ }
  }
  if (result.sito && typeof result.sito === 'string') {
    const sitoStr = String(result.sito).trim()
    // PEC domain gate — NEVER accept a PEC provider subdomain as a website
    const PEC_SITE_RX = /\.(pec|legalmail|pecimprese|arubapec|postecert|sicurezzapostale|registerpec|mypec|actaliscertymail|casellapec|namirial|infocert)\./i
    if (PEC_SITE_RX.test(sitoStr) || /^https?:\/\/[^/]*\.(pec\.it|legalmail\.it|arubapec\.it|pecimprese\.it)\/?$/i.test(sitoStr)) {
      console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED PEC-domain website "${sitoStr}"`)
      delete result.sito
      delete (result as any).sito_web
    }
    // Known parked/domain-for-sale patterns
    const PARKED_DOMAINS = /(?:sedoparking|godaddy|namecheap|afternic|dan\.com|flippa|hugedomains|buydomains|domainhasprice|parkingcrew|parking\.)/i
    if (PARKED_DOMAINS.test(sitoStr)) {
      console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED parked domain "${sitoStr}"`)
      delete result.sito
      delete (result as any).sito_web
    } else {
      // Domain relevance check: extract domain and compare with company name
      try {
        const siteUrl = new URL(sitoStr.startsWith('http') ? sitoStr : `https://${sitoStr}`)
        const domain = siteUrl.hostname.replace(/^www\./, '').toLowerCase()
        const compName = String(result.ragione_sociale || query || '').toLowerCase().replace(/[^a-z0-9àèéìòù]/gi, ' ')
        const compWords6e = compName.split(/\s+/).filter((w: string) => w.length >= 3 && !/^(srl|spa|sas|snc|srls|sapa|scarl|coop|soc|societa|group|italia|italy|the|and|di|il|la|consorzio|com|net|org|www)$/.test(w))
        // ★ Detect dotted acronyms (G.E.M → gem, A.B.C. → abc) for domain matching
        const acronymMatches6e = String(result.ragione_sociale || query || '').match(/\b(?:[A-Za-zÀ-ú]\.){2,}[A-Za-zÀ-ú]?\b/g) || []
        const acronymTokens6e = acronymMatches6e.map(a => a.replace(/\./g, '').toLowerCase()).filter(a => a.length >= 2)
        // ★ ANTI-OMONIMIA: filter common Italian first names from domain matching
        const COMMON_NAMES_6E = new Set(['marco','luca','paolo','anna','maria','giuseppe','giovanni','andrea','carlo','antonio','stefano','roberto','alberto','francesco','mario','laura','sara','elena','chiara','simone','davide','fabio','matteo','alessio','daniele','luigi','pietro','massimo','claudio','enrico','sergio','maurizio','mauro','giorgio','bruno','franco','luciano','salvatore','vincenzo','domenico','filippo','michele','riccardo','tommaso','nicola','emanuele','vittorio','silvia','giulia','valentina','federica','alessandra','cristina','barbara','monica','paola','daniela','francesca','elisabetta','marta','giovanna','rosa','angela','teresa','patrizia','carla','cinzia','sabrina','manuela','raffaella'])
        const distinctive6e = [...compWords6e.filter((w: string) => !COMMON_NAMES_6E.has(w)), ...acronymTokens6e]
        const matchWords6e = distinctive6e.length > 0 ? distinctive6e : compWords6e
        const domainRelevance = matchWords6e.some((w: string) => domain.includes(w))
        // Quick HTTP check — 5s timeout, don't block the flow.
        // Try HEAD first (faster); fallback to GET because many web servers (especially older
        // CMS-based ones) reject HEAD with 405 or simply don't respond. A failed HEAD does NOT
        // mean the site is dead — only that HEAD isn't supported. GET with a short timeout
        // is the authoritative liveness check.
        let siteAlive = false
        const fullUrl = sitoStr.startsWith('http') ? sitoStr : `https://${sitoStr}`
        try {
          const headRes = await fetch(fullUrl, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(5000),
            redirect: 'follow',
          })
          siteAlive = headRes.ok || (headRes.status >= 200 && headRes.status < 500)
        } catch {
          siteAlive = false
        }
        if (!siteAlive) {
          // HEAD failed → try GET (many sites only support GET)
          try {
            const getRes = await fetch(fullUrl, {
              method: 'GET',
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
              signal: AbortSignal.timeout(7000),
              redirect: 'follow',
            })
            siteAlive = getRes.ok || (getRes.status >= 200 && getRes.status < 500)
          } catch {
            siteAlive = false
          }
        }
        const emailDomainForSite = typeof result.email === 'string' ? String(result.email).split('@')[1]?.replace(/^www\./, '').toLowerCase() : ''
        // ANTI-CIRCULAR: email domain can only vouch for a site if the email domain ITSELF matches company name.
        // Bug: "telefoniaesicurezza.it" (wrong site) + "commerciale@telefoniaesicurezza.it" (wrong email)
        // validated each other, so neither was removed. Fix: require email domain to match company tokens.
        const emailDomBase6e = (emailDomainForSite || '').split('.')[0].replace(/[^a-z0-9]/g, '')
        const emailDomMatchesCompany6e = emailDomBase6e.length < 4 || matchWords6e.some((w: string) => emailDomBase6e.includes(w) || w.includes(emailDomBase6e))
        const isRiskyForeignDomain = siteAlive && !domainRelevance && (!emailDomainForSite || domain !== emailDomainForSite || !emailDomMatchesCompany6e)
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
              // ANTI-CIRCULAR: email domain can only verify content if it matches company name
              const hasEmailDomain = !!emailDomainForSite && emailDomMatchesCompany6e && pageText.includes(emailDomainForSite)
              const hasAddress = !!addressVal && addressVal.length >= 8 && pageText.includes(addressVal)
              // City alone is too weak — Milan has 100k+ businesses; many homonym sites mention "milano".
              // Require strong evidence: P.IVA, email-domain match, OR full street address.
              contentVerified = hasPiva || hasEmailDomain || hasAddress
            }
          } catch { contentVerified = false }
        }
        // Helper: when removing a site, also remove email/phone/PEC derived from the same wrong source
        const clearSiteAndRelatedEmail = (reason: string) => {
          console.log(`[COMPANY-LOOKUP] Step 6e: REMOVED ${reason} site "${sitoStr}" (domain="${domain}") — better empty than wrong`)
          delete result.sito
          delete (result as any).sito_web
          if (result.email && typeof result.email === 'string') {
            const emailDom = String(result.email).split('@')[1]?.toLowerCase().replace(/^www\./, '')
            if (emailDom && (emailDom === domain || emailDom.endsWith('.' + domain))) {
              console.log(`[COMPANY-LOOKUP] Step 6e: ALSO removed email "${result.email}" — same domain as cleared site`)
              delete result.email
              delete (result as any).email_fonte
            }
          }
          // Also clear phone unless from a trusted directory (Reteimprese/PagineGialle/PagineBianche)
          // Bug fix: previously only cleared "sito web" phones, but Gemini/Tavily/unknown phones
          // also need clearing when the site is removed — they may have been derived from the same wrong source.
          const telFonteClear = String((result as any).telefono_fonte || '').toLowerCase()
          const phoneFromDirClear = telFonteClear.includes('reteimprese') || telFonteClear.includes('paginegialle') || telFonteClear.includes('paginebianche')
          if (result.telefono && !phoneFromDirClear) {
            console.log(`[COMPANY-LOOKUP] Step 6e: ALSO removed phone "${result.telefono}" (fonte: ${telFonteClear || 'unknown'}) — site cleared, cannot trust phone`)
            delete result.telefono
            delete (result as any).telefono_fonte
          }
        }
        if (!siteAlive) {
          clearSiteAndRelatedEmail('dead')
        } else if (!contentVerified) {
          clearSiteAndRelatedEmail('unverifiable foreign')
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
        delete (result as any).sito_web
      }
    }
  }

  // ─── Step 6e-PIVA: P.IVA mismatch check — if site has a DIFFERENT P.IVA, it's the wrong company ───
  // This catches homonyms and similar-name companies that pass domain matching.
  // Safe: if no P.IVA found on page → no action. Only rejects when a DIFFERENT P.IVA is explicitly found.
  const pivaForSiteCheck = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
  if (result.sito && typeof result.sito === 'string' && pivaForSiteCheck.length === 11) {
    try {
      const siteCheckUrl = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
      const baseForSiteCheck = new URL(siteCheckUrl)
      const urlsToCheck = Array.from(new Set([
        siteCheckUrl,
        new URL('/', baseForSiteCheck).toString(),
        new URL('/contatti', baseForSiteCheck).toString(),
        new URL('/contact', baseForSiteCheck).toString(),
        new URL('/contacts', baseForSiteCheck).toString(),
        new URL('/privacy', baseForSiteCheck).toString(),
        new URL('/privacy-policy', baseForSiteCheck).toString(),
        new URL('/note-legali', baseForSiteCheck).toString(),
        new URL('/legal', baseForSiteCheck).toString(),
      ]))
      const pivaPattern = /(?:P\.?\s*IVA|partita\s*iva|VAT|C\.?F\.?(?:\s*[/e]\s*P\.?\s*IVA)?)[:\s/|–\-]*(?:IT\s*)?(\d{11})/gi
      const foundPivas = new Set<string>()
      let checkedAnyPage = false
      for (const u of urlsToCheck) {
        try {
          const siteCheckRes = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
            signal: AbortSignal.timeout(6000),
            redirect: 'follow',
          })
          if (!siteCheckRes.ok) continue
          checkedAnyPage = true
          let siteHtml = await siteCheckRes.text()
          siteHtml += ' ' + await fetchSameDomainFrameHtml(siteHtml, siteCheckRes.url || u)
          const siteText = siteHtml.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
          let pivaMatch
          pivaPattern.lastIndex = 0
          while ((pivaMatch = pivaPattern.exec(siteText)) !== null) {
            foundPivas.add(pivaMatch[1])
          }
        } catch { /* try next validation page */ }
      }
      if (!checkedAnyPage) throw new Error('no reachable site pages')

      if (foundPivas.size > 0 && !foundPivas.has(pivaForSiteCheck)) {
        console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: MISMATCH — site "${result.sito}" has P.IVA [${[...foundPivas].join(',')}] but ours is ${pivaForSiteCheck} → clearing site + derived data`)
        const siteDomainForClear = new URL(siteCheckUrl).hostname.replace(/^www\./, '').toLowerCase()
        delete result.sito
        delete (result as any).sito_web
        if (result.email && typeof result.email === 'string') {
          const emailDomClear = String(result.email).split('@')[1]?.toLowerCase().replace(/^www\./, '')
          if (emailDomClear && (emailDomClear === siteDomainForClear || emailDomClear.endsWith('.' + siteDomainForClear))) {
            console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: ALSO cleared email "${result.email}" — same domain`)
            delete result.email
            delete (result as any).email_fonte
          }
        }
        const telFontePiva = String((result as any).telefono_fonte || '').toLowerCase()
        const phoneFromTrustedDirPiva = telFontePiva.includes('reteimprese') || telFontePiva.includes('paginegialle') || telFontePiva.includes('paginebianche')
        if (result.telefono && !phoneFromTrustedDirPiva) {
          console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: ALSO cleared phone "${result.telefono}" (fonte: ${telFontePiva || 'unknown'}) — site P.IVA mismatch, cannot trust phone`)
          delete result.telefono
          delete (result as any).telefono_fonte
        }
      } else if (foundPivas.has(pivaForSiteCheck)) {
        console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: CONFIRMED — site "${result.sito}" has our P.IVA ${pivaForSiteCheck}`)
      } else if (foundPivas.size === 0) {
        const siteDomainNoPiva = new URL(siteCheckUrl).hostname.replace(/^www\./, '').toLowerCase()
        const emailDomainNoPiva = typeof result.email === 'string' ? String(result.email).split('@')[1]?.toLowerCase().replace(/^www\./, '') : ''
        const emailFromOfficialSiteNoPiva = Boolean(
          result.email &&
          emailDomainNoPiva &&
          (emailDomainNoPiva === siteDomainNoPiva || emailDomainNoPiva.endsWith('.' + siteDomainNoPiva)) &&
          /sito ufficiale|playwright|js render/i.test(String((result as any).email_fonte || ''))
        )
        const mapsContextNoPiva = mapsLeadMatchesCompanyContext({ name: result.ragione_sociale || queryCompanyName, website: result.sito, address: result.indirizzo || result.sede_legale }, result.ragione_sociale || queryCompanyName, result.citta || queryCityHint)
        if (emailFromOfficialSiteNoPiva && mapsContextNoPiva) {
          console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: NO P.IVA found on JS site "${result.sito}" but email domain + Maps context confirm ownership — keeping site/email`)
        } else {
          console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: NO P.IVA found on site "${result.sito}" — cannot verify ownership, clearing site + unverified contacts`)
          delete result.sito
          delete (result as any).sito_web
          if (result.email && typeof result.email === 'string') {
            const emailDomNoPiva = String(result.email).split('@')[1]?.toLowerCase().replace(/^www\./, '')
            if (emailDomNoPiva && (emailDomNoPiva === siteDomainNoPiva || emailDomNoPiva.endsWith('.' + siteDomainNoPiva))) {
              console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: ALSO cleared email "${result.email}" — from unverified site`)
              delete result.email
              delete (result as any).email_fonte
            }
          }
          const telFonteNoPiva = String((result as any).telefono_fonte || '').toLowerCase()
          const phoneFromTrustedDir = telFonteNoPiva.includes('reteimprese') || telFonteNoPiva.includes('paginegialle') || telFonteNoPiva.includes('paginebianche')
          if (result.telefono && !phoneFromTrustedDir) {
            console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: ALSO cleared phone "${result.telefono}" (fonte: ${telFonteNoPiva}) — cannot verify via P.IVA on site`)
            delete result.telefono
            delete (result as any).telefono_fonte
          }
        }
      }
    } catch (e: any) {
      console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: fetch FAILED for "${result.sito}" — ${e?.message} — clearing unverifiable site`)
      delete result.sito
      delete (result as any).sito_web
      const telFonteFail = String((result as any).telefono_fonte || '').toLowerCase()
      const phoneFromDirFail = telFonteFail.includes('reteimprese') || telFonteFail.includes('paginegialle') || telFonteFail.includes('paginebianche')
      if (result.telefono && !phoneFromDirFail) {
        console.log(`[COMPANY-LOOKUP] Step 6e-PIVA: ALSO cleared phone "${result.telefono}" — site fetch failed, cannot verify`)
        delete result.telefono
        delete (result as any).telefono_fonte
      }
    }
  }

  // ─── Step 6e++ site RECOVERY via Maps after wrong-site was cleared ───
  // If Step 6e cleared the site, retry Maps with company name + city to find the real website.
  // Maps is authoritative: if a business is listed, its website link is almost always correct.
  if (!result.sito && result.ragione_sociale) {
    const recCompName = String(result.ragione_sociale)
    const recCity = String(result.citta || queryCityHint || '')
    console.log(`[COMPANY-LOOKUP] Step 6e++: site cleared — retrying Maps for "${recCompName}" city="${recCity}"`)
    try {
      const mapsRecRes = await fetch(`${backendUrl}/search-maps-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_name: recCompName, city: recCity, max_results: 1 }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => null)
      if (mapsRecRes && mapsRecRes.ok) {
        const mapsRecData = await mapsRecRes.json().catch(() => null) as any
        const mapsRecLeads = (mapsRecData && Array.isArray(mapsRecData.results)) ? mapsRecData.results : []
        const mapsRecLead = mapsRecLeads[0]
        if (mapsRecLead && mapsRecLead.website) {
          console.log(`[COMPANY-LOOKUP] Step 6e++: Maps found "${mapsRecLead.name}" → site=${mapsRecLead.website}`)
          const mapsPivaRec = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
          const mapsRecWebsiteVerified = await websiteContainsPivaQuick(String(mapsRecLead.website), mapsPivaRec)
          const mapsRecAddressVerified = addressMatchesRegistryAddress(mapsRecLead.address, result.sede_legale || result.indirizzo)
          const mapsRecContextVerified = mapsLeadMatchesCompanyContext(mapsRecLead, recCompName, recCity)
          if (isPiva && mapsPivaRec.length === 11 && !mapsRecWebsiteVerified && !mapsRecAddressVerified && !mapsRecContextVerified) {
            console.log(`[COMPANY-LOOKUP] Step 6e++: Maps recovery REJECTED — website/address do not confirm queried P.IVA ${mapsPivaRec}`)
            throw new Error('maps recovery rejected by P.IVA verification')
          }
          result.sito = mapsRecLead.website
          if (mapsRecLead.phone && !result.telefono) { result.telefono = mapsRecLead.phone; (result as any).telefono_fonte = mapsRecWebsiteVerified ? 'Google Maps (P.IVA verificata su sito)' : mapsRecAddressVerified ? 'Google Maps (indirizzo verificato)' : 'Google Maps (nome/sede verificati)' }
          if (mapsRecLead.address && !result.indirizzo) result.indirizzo = mapsRecLead.address
          if (!fonti.includes('Google Maps')) fonti.push('Google Maps')
          // Scrape the recovered site for contacts, email, social
          try {
            const recSiteUrl = String(result.sito).startsWith('http') ? String(result.sito) : `https://${result.sito}`
            console.log(`[COMPANY-LOOKUP] Step 6e++: scrapeWebsiteDeep on recovered site ${recSiteUrl}`)
            const recDeep = await scrapeWebsiteDeep(recSiteUrl)
            console.log(`[COMPANY-LOOKUP] Step 6e++: scrape done (${recDeep.pagesScraped} pages, ${recDeep.emails.length} emails, ${recDeep.phones.length} phones)`)
            // Emails
            if (recDeep.emails?.length) {
              for (const em of recDeep.emails) {
                const emLow = cleanContactEmail(em.email)
                if (!emLow) continue
                if (emLow.includes('noreply') || emLow.includes('example') || emLow.includes('sentry') || emLow.includes('wix') || emLow.includes('wordpress')) continue
                if (!result.email) { result.email = emLow; (result as any).email_fonte = 'sito_ufficiale' }
                break
              }
            }
            // Phones
            for (const ph of (recDeep.phones || [])) {
              const digits = String(ph.number).replace(/\D/g, '')
              const core = digits.startsWith('39') ? digits.slice(2) : digits
              const telFonte = String((result as any).telefono_fonte || '').toLowerCase()
              const celFonte = String((result as any).cellulare_fonte || '').toLowerCase()
              if (/^0\d{8,10}$/.test(core) && (!result.telefono || !/sito/i.test(telFonte))) {
                result.telefono = ph.number; (result as any).telefono_fonte = 'sito_ufficiale'
              }
              if (/^3\d{8,9}$/.test(core) && (!result.cellulare || !/sito/i.test(celFonte))) {
                result.cellulare = ph.number; (result as any).cellulare_fonte = 'sito_ufficiale'
              }
            }
            // Social
            if (recDeep.socialLinks?.facebook && !result.facebook) result.facebook = recDeep.socialLinks.facebook
            if (recDeep.socialLinks?.instagram && !result.instagram) result.instagram = recDeep.socialLinks.instagram
            if (recDeep.socialLinks?.linkedin && !result.linkedin) result.linkedin = recDeep.socialLinks.linkedin
            if (recDeep.socialLinks?.twitter && !result.twitter) result.twitter = recDeep.socialLinks.twitter
          } catch (scrErr: any) {
            console.log(`[COMPANY-LOOKUP] Step 6e++: scrape error: ${scrErr?.message}`)
          }
        }
      }
    } catch { /* Maps recovery failed — continue */ }
  }

  // ─── Step 6e+: Reteimprese phone RECOVERY after wrong-site phone was cleared ───
  // If Step 6e just cleared the phone (because the site was wrong), we need to find the
  // correct phone from a reliable directory. This ONLY runs when phone was lost due to site removal.
  if (!result.telefono && process.env.TAVILY_API_KEY && !directoryPhoneSearchAttempted) {
    const compNameForPhoneRecovery = String(result.ragione_sociale || queryCompanyName || '').trim()
    const cityForPhoneRecovery = String(result.citta || queryCityHint || '').trim()
    if (compNameForPhoneRecovery.length >= 3) {
      console.log(`[COMPANY-LOOKUP] Step 6e+: phone was cleared — searching Reteimprese/PagineGialle for recovery`)
      // Extract phones PER-RESULT: only from Tavily results whose title/URL match company name
      const STOP_REC = new Set([
        'srl','srls','spa','sas','snc','italia','italy','group','holding',
        'milano','roma','napoli','torino','bologna','firenze',
        'officina','meccanica','studio','agenzia','consorzio','cooperativa',
        'edile','costruzioni','impianti','servizi','commerciale','azienda','impresa','ditta',
      ])
      // Build relaxed fallback queries (no quotes) for acronym/dot names like G.E.M
      const relaxedTokensRec = compNameForPhoneRecovery.toLowerCase()
        .replace(/[^a-zà-ù0-9\s]/gi, ' ').split(/\s+/)
        .filter((t: string) => t.length >= 4 && !STOP_REC.has(t))
      const relaxedQueryRec = relaxedTokensRec.length >= 1
        ? `${relaxedTokensRec.join(' ')} ${cityForPhoneRecovery} telefono`
        : ''
      const recoveryQueries = [
        `"${compNameForPhoneRecovery}" ${cityForPhoneRecovery} telefono site:reteimprese.it`,
        ...(relaxedQueryRec ? [`${relaxedQueryRec} site:reteimprese.it`] : []),
        `"${compNameForPhoneRecovery}" ${cityForPhoneRecovery} telefono contatti site:paginegialle.it`,
        ...(relaxedQueryRec ? [`${relaxedQueryRec} site:paginegialle.it`] : []),
        `"${compNameForPhoneRecovery}" ${cityForPhoneRecovery} telefono site:paginebianche.it`,
      ]
      const recTokens = compNameForPhoneRecovery.toLowerCase()
        .replace(/[^a-zà-ù0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter((t: string) => t.length >= 4 && !STOP_REC.has(t) && !COMMON_ITALIAN_NAMES.has(t))
      if (recTokens.length === 0) {
        recTokens.push(compNameForPhoneRecovery.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8))
      }
      // Also use address for validation
      const recAddress = String(result.indirizzo || result.sede_legale || '').toLowerCase().replace(/[^a-zà-ù0-9\s]/g, ' ').split(/[,\-–]/)[0]?.trim()
      for (const rq of recoveryQueries) {
        if (result.telefono) break
        try {
          console.log(`[COMPANY-LOOKUP] Step 6e+: phone recovery search — ${rq}`)
          const rr = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: process.env.TAVILY_API_KEY,
              query: rq,
              search_depth: 'advanced', max_results: 3,
            }),
            signal: AbortSignal.timeout(12000),
          })
          if (!rr.ok) continue
          const rrData = await rr.json()
          for (const tavResult of (rrData.results || [])) {
            if (result.telefono) break
            const titleLow = String(tavResult.title || '').toLowerCase()
            const urlLow = String(tavResult.url || '').toLowerCase()
            const contentStr = String(tavResult.content || '')
            const contentLow = contentStr.toLowerCase()
            // ★ ANTI-OMONIMIA: reject results from a different company in a different city
            const recCityLow = cityForPhoneRecovery.toLowerCase().replace(/[^a-zà-ù]/g, '')
            const recTitleHasToken = recTokens.some((t: string) => titleLow.includes(t))
            const recTitleHasCity = recCityLow.length >= 3 && titleLow.includes(recCityLow)
            const addressMatch = recAddress && recAddress.length >= 8 && contentLow.includes(recAddress)
            if (!recTitleHasToken && !recTitleHasCity && !addressMatch) {
              console.log(`[COMPANY-LOOKUP] Step 6e+: SKIP result — title "${tavResult.title}" has no company token and no target city "${cityForPhoneRecovery}"`)
              continue
            }
            // Extract phones from this specific result only
            const recPhonePattern = /(?:\+?\s*39\s*)?[03]\d[\s\.\-]?\d{2,4}[\s\.\-]?\d{2,4}[\s\.\-]?\d{0,4}/g
            let rpm
            while ((rpm = recPhonePattern.exec(contentStr)) !== null) {
              const ph = rpm[0].trim()
              const phIdx = rpm.index
              // Proximity check within THIS result (300 chars window, same as original)
              const windowStr = contentLow.slice(Math.max(0, phIdx - 300), phIdx + 50)
              const nameNearPhone = recTokens.some((t: string) => windowStr.includes(t)) || addressMatch
              if (!nameNearPhone) continue
              const digits = ph.replace(/\D/g, '')
              const core = digits.startsWith('39') ? digits.slice(2) : digits
              if (/^0\d{8,10}$/.test(core)) {
                if (expectedPrefixes5a) {
                  const prefixOk = expectedPrefixes5a.some(p => core.startsWith(p))
                  if (!prefixOk) {
                    console.log(`[COMPANY-LOOKUP] Step 6e+: skipped discovered phone ${ph} because area code does NOT match province/city`)
                    continue
                  }
                }
                result.telefono = ph
                const srcDomain = rq.includes('reteimprese') ? 'Reteimprese.it' : rq.includes('paginegialle') ? 'PagineGialle.it' : 'PagineBianche.it'
                ;(result as any).telefono_fonte = srcDomain
                if (!fonti.includes(srcDomain)) fonti.push(srcDomain)
                console.log(`[COMPANY-LOOKUP] Step 6e+: phone RECOVERED from ${srcDomain}: ${ph} (title="${tavResult.title}", addr=${addressMatch})`)
                break
              }
              if (/^3\d{8,9}$/.test(core) && !result.cellulare) {
                result.cellulare = ph
                const srcDomain = rq.includes('reteimprese') ? 'Reteimprese.it' : rq.includes('paginegialle') ? 'PagineGialle.it' : 'PagineBianche.it'
                ;(result as any).cellulare_fonte = srcDomain
                console.log(`[COMPANY-LOOKUP] Step 6e+: mobile RECOVERED from ${srcDomain}: ${ph}`)
              }
            }
          }
        } catch { /* try next */ }
      }
      if (!result.telefono) console.log(`[COMPANY-LOOKUP] Step 6e+: phone recovery failed — no directory match`)
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

  // ★ Step 6g (Fix bug CAREL): valida slug LinkedIn aziendale per evitare omonimi globali.
  // Se la slug è MOLTO corta (≤6 chars) E la ragione sociale ha 1 solo token significativo,
  // c'è alto rischio di linkedin.com/company/<slug> sia di un'altra azienda omonima famosa
  // (es. "CAREL S.r.l. Torino" → linkedin.com/company/carel = CAREL S.p.A. multinazionale Brugine).
  // In assenza di conferma dal sito ufficiale, la rimuoviamo per evitare dato sbagliato.
  if (result.linkedin && typeof result.linkedin === 'string') {
    const slugMatch = String(result.linkedin).match(/linkedin\.com\/company\/([\w.-]+)/i)
    if (slugMatch) {
      const slug = slugMatch[1].toLowerCase().replace(/[-_.]/g, '')
      const rs = String(result.ragione_sociale || query || '')
      // Token significativi del nome azienda (riusa la stessa logica di triggers.ts)
      const FORMA_GIURIDICA_RX = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|sc(?:r)?l|s\.?c\.?|cooperativa|coop|società|societa|gruppo|group|holding|italia|italy|italiana|italiano)\b/gi
      const TOO_GENERIC_TOKENS = new Set(['service','services','servizi','servizio','consulting','consulenza','system','systems','solutions','solution','tech','technology','international','national','nazionale','global','europa','europe','business','project','projects','progetto','progetti','group','studio','studios','agency','agenzia','company','corp','inc','azienda','aziende','impresa','imprese','centro','center','pro','plus','best','top','one','first','new','next'])
      const tokens = rs.toLowerCase().replace(FORMA_GIURIDICA_RX, ' ').replace(/[^a-z0-9àèéìòù\s]/g, ' ').replace(/\s+/g, ' ').trim()
        .split(/\s+/).filter(w => w.length >= 4 && !TOO_GENERIC_TOKENS.has(w))
      const isShortSlug = slug.length <= 6
      const isAmbiguousName = tokens.length === 1 && tokens[0].length <= 6
      // Verifica facoltativa: sito ufficiale linka davvero questo LinkedIn?
      // Se sì, accettiamo il rischio omonimo. Altrimenti scartiamo per evitare dato sbagliato.
      let confirmedBySite = false
      if (isShortSlug && isAmbiguousName && result.sito && typeof result.sito === 'string') {
        try {
          const homepageRes = await fetch(String(result.sito), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(5000), redirect: 'follow',
          })
          if (homepageRes.ok) {
            const html = await homepageRes.text()
            // Cerca il LinkedIn URL nella homepage del sito ufficiale
            const linkedinHref = String(result.linkedin).replace(/^https?:\/\//, '').replace(/\/$/, '')
            if (html.toLowerCase().includes(linkedinHref.toLowerCase())) {
              confirmedBySite = true
              console.log(`[COMPANY-LOOKUP] Step 6g: LinkedIn "${result.linkedin}" CONFERMATO dal sito ${result.sito}`)
            }
          }
        } catch { /* fetch fallito, continuiamo con scarto */ }
      }
      if (isShortSlug && isAmbiguousName && !confirmedBySite) {
        console.log(`[COMPANY-LOOKUP] Step 6g: REMOVED ambiguous LinkedIn "${result.linkedin}" (slug "${slug}" troppo generico per nome "${rs}")`)
        delete result.linkedin
      }
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

  // ─── Step 7: Analisi assicurativa — aree da verificare ───
  if (hasAnyCompanySignalBeforeFinal) {
    result.fonti = [...new Set(fonti)]

    // ── Final phone cleanup ──
    // Helper: check if phone is a valid Italian number.
    // Accept: fissi (0xx), mobili (3xx), numeri verdi/special (800/803/840/848/892/899/199).
    const isItalianTollFreePrefix = (core: string) => /^(?:800|803|840|848|892|899|199)/.test(core)
    const isItalianPhone = (ph: string): boolean => {
      const digits = ph.replace(/\D/g, '')
      // With +39 prefix: 39 + 9-10 digits
      if (digits.startsWith('39') && digits.length >= 11 && digits.length <= 13) {
        const core = digits.slice(2)
        return core.startsWith('0') || core.startsWith('3') || isItalianTollFreePrefix(core)
      }
      // Without prefix: starts with 0 (landline) or 3 (mobile), 9-11 digits
      if ((digits.startsWith('0') || digits.startsWith('3')) && digits.length >= 6 && digits.length <= 11) return true
      // Numero verde / a pagamento: 800/803/840/848/892/899/199 — 6..11 digits
      if (isItalianTollFreePrefix(digits) && digits.length >= 6 && digits.length <= 11) return true
      return false
    }
    // PRE-SPLIT: Maps sometimes returns "051765727 / +39340123456" in one field → split before validation
    if (result.telefono && typeof result.telefono === 'string' && /[/,]/.test(String(result.telefono))) {
      const rawPh = String(result.telefono)
      const phoneParts = rawPh.split(/[/,]/).map(p => p.trim()).filter(p => p.replace(/\D/g, '').length >= 6)
      if (phoneParts.length >= 2) {
        console.log(`[COMPANY-LOOKUP] PRE-SPLIT: telefono "${rawPh}" → [${phoneParts.join(' | ')}]`)
        result.telefono = phoneParts[0]
        // (telefono_fonte resta quella ereditata dalla fonte originale: Maps/sito/etc.)
        // Second number → cellulare if it starts with 3
        if (!result.cellulare) {
          const d2 = phoneParts[1].replace(/\D/g, '')
          const core2 = d2.startsWith('39') ? d2.slice(2) : (d2.startsWith('0039') ? d2.slice(4) : d2)
          if (core2.startsWith('3')) {
            result.cellulare = phoneParts[1]
            // Eredita la fonte del telefono originale (di solito Google Maps che concatena due numeri)
            if (result.telefono_fonte) result.cellulare_fonte = result.telefono_fonte
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

    // ── Codice Fiscale validation ──
    // NOTE: for Italian SRL/SPA, codice_fiscale and partita_iva are TWO separate 11-digit codes
    // that CAN match but DO NOT HAVE TO match. Many legitimate companies have different CF and P.IVA
    // (e.g. Omniapiega has PIVA=02192260962 and CF=03761490154 — both valid).
    // We only invalidate the C.F. if it has the wrong format (not 11 digits for companies, not 16 chars for ditte individuali).
    if (result.codice_fiscale) {
      const cfRaw = String(result.codice_fiscale).trim()
      const cfDigits = cfRaw.replace(/\D/g, '')
      const isAllDigits = /^\d+$/.test(cfRaw)
      const isAlphaNumIndividual = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(cfRaw.replace(/\s+/g, ''))
      // For companies CF must be 11 digits; for ditte individuali it must be 16-char alphanumeric.
      // If neither, scarta.
      if (!(isAllDigits && cfDigits.length === 11) && !isAlphaNumIndividual) {
        console.log(`[COMPANY-LOOKUP] ⚠️ CF format invalid: "${cfRaw}" — removing`)
        delete result.codice_fiscale
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
      // Accept: pure digits, ranges "20-49", "da 6 a 9"
      const dipStr = String(d).trim()
      const rangeM = dipStr.match(/(\d+)\s*(?:[-–—]|a)\s*(\d+)/i) || dipStr.match(/da\s*(\d+)\s*a\s*(\d+)/i)
      if (rangeM) return parseInt(rangeM[1], 10) || null
      // RIFIUTA pattern "X.Y" o "X,Y" (separatore migliaia/decimali) — è importo finanziario, non dipendenti
      // Es: "103.416" o "1,250" sono SEMPRE importi, mai numeri di dipendenti reali per PMI
      if (/\d[.,]\d/.test(dipStr)) return null
      const m = dipStr.match(/\d+/)
      if (!m) return null
      const n = parseInt(m[0], 10)
      // Reject implausibly high values for SME context (>10000)
      if (!Number.isFinite(n) || n > 10000) return null
      return n > 0 ? n : null
    }

    // ★ ANTICIPATED Step 6h sanity check: BEFORE computing dipNum and insurance_intelligence
    // Era a riga 6965 (DOPO insurance_intelligence) → bug: gli obblighi venivano generati
    // con il valore corrotto, poi Step 6h lo cancellava ma era troppo tardi.
    // Fix: validate dipendenti CONTRO costo_personale + fallback a storico_bilanci.
    {
      // Step A: cross-check dipendenti × costo_personale
      const dipRaw = result.dipendenti
      if (dipRaw && (result as any).costo_personale) {
        const dipParsed = parseDip(dipRaw)
        const costo = parseInt(String((result as any).costo_personale).replace(/[^\d]/g, ''), 10)
        if (Number.isFinite(dipParsed) && (dipParsed as number) > 0 && Number.isFinite(costo) && costo > 0) {
          const costoPerDip = costo / (dipParsed as number)
          if (costoPerDip < 8000) {
            console.log(
              `[COMPANY-LOOKUP] PRE-INTELLIGENCE: dipendenti SOSPETTO (${dipParsed}) — ratio costo/dip=${costoPerDip.toFixed(0)}€/anno ` +
              `troppo bassa. Scartato (probabilmente costo_personale parsato come dipendenti).`
            )
            delete (result as any).dipendenti
            delete (result as any).dipendenti_fonte
          }
        } else if (dipParsed === null) {
          console.log(`[COMPANY-LOOKUP] PRE-INTELLIGENCE: dipendenti "${dipRaw}" non parsabile (formato finanziario rilevato) — scartato`)
          delete (result as any).dipendenti
          delete (result as any).dipendenti_fonte
        }
      }
      // Step B: fallback to storico_bilanci latest year if dipendenti or fatturato missing
      if ((!result.dipendenti || !result.fatturato) && (result as any).storico_bilanci) {
        try {
          const sb = typeof (result as any).storico_bilanci === 'string'
            ? JSON.parse((result as any).storico_bilanci)
            : (result as any).storico_bilanci
          // storico_bilanci can be {anni:[],fatturato:[],dipendenti:[],...} or [{anno,dipendenti,fatturato,...}]
          let latestDip: number | null = null
          let latestFat: string | null = null
          if (Array.isArray(sb)) {
            const sorted = [...sb].sort((a, b) => (parseInt(String(b.anno))||0) - (parseInt(String(a.anno))||0))
            if (!result.dipendenti) {
              const bDip = sorted.find(b => b.dipendenti != null && String(b.dipendenti).trim() !== '')
              if (bDip) latestDip = parseInt(String(bDip.dipendenti).replace(/[^\d]/g, ''), 10) || null
            }
            if (!result.fatturato) {
              const bFat = sorted.find(b => b.fatturato != null && String(b.fatturato).trim() !== '' && String(b.fatturato) !== '—' && String(b.fatturato) !== '-')
              if (bFat) latestFat = String(bFat.fatturato)
            }
          } else if (sb && Array.isArray(sb.anni)) {
            if (!result.dipendenti && Array.isArray(sb.dipendenti)) {
              for (let i = sb.anni.length - 1; i >= 0; i--) {
                const v = sb.dipendenti[i]
                if (v != null && String(v).trim() !== '' && String(v) !== '-' && String(v) !== '—') {
                  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10)
                  if (Number.isFinite(n) && n > 0) { latestDip = n; break }
                }
              }
            }
            if (!result.fatturato && Array.isArray(sb.fatturato)) {
              for (let i = sb.anni.length - 1; i >= 0; i--) {
                const v = sb.fatturato[i]
                if (v != null && String(v).trim() !== '' && String(v) !== '-' && String(v) !== '—') {
                  latestFat = String(v)
                  break
                }
              }
            }
          }
          if (!result.dipendenti && latestDip !== null && latestDip > 0 && latestDip <= 10000) {
            (result as any).dipendenti = String(latestDip)
            ;(result as any).dipendenti_fonte = 'storico_bilanci_latest_year'
            console.log(`[COMPANY-LOOKUP] PRE-INTELLIGENCE: dipendenti recuperato da storico_bilanci: ${latestDip}`)
          }
          if (!result.fatturato && latestFat !== null) {
            (result as any).fatturato = latestFat
            ;(result as any).fatturato_fonte = 'storico_bilanci_latest_year'
            console.log(`[COMPANY-LOOKUP] PRE-INTELLIGENCE: fatturato recuperato da storico_bilanci: ${latestFat}`)
          }
        } catch (e: any) {
          console.log(`[COMPANY-LOOKUP] PRE-INTELLIGENCE: storico_bilanci parse error: ${e?.message || e}`)
        }
      }
    }

    {
      const r = result as Record<string, any>
      if (r.sito && !r.sito_web) r.sito_web = r.sito
      if (r.sito_web && !r.sito) r.sito = r.sito_web
      if (r.codice_fiscale_titolare && !r.cf_titolare) r.cf_titolare = r.codice_fiscale_titolare
      if (r.cf_titolare && !r.codice_fiscale_titolare) r.codice_fiscale_titolare = r.cf_titolare
      if (r.data_nascita_titolare && !r.titolare_data_nascita) r.titolare_data_nascita = r.data_nascita_titolare
      if (r.titolare_data_nascita && !r.data_nascita_titolare) r.data_nascita_titolare = r.titolare_data_nascita
      if (r.eta_titolare && !r.titolare_eta) r.titolare_eta = r.eta_titolare
      if (r.titolare_eta && !r.eta_titolare) r.eta_titolare = r.titolare_eta
      if (r.sesso_titolare && !r.titolare_sesso) r.titolare_sesso = r.sesso_titolare
      if (r.titolare_sesso && !r.sesso_titolare) r.sesso_titolare = r.titolare_sesso
      const cf = String(r.codice_fiscale_titolare || r.cf_titolare || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
      if (cf.length === 16) {
        const months: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, H: 6, L: 7, M: 8, P: 9, R: 10, S: 11, T: 12 }
        const yy = parseInt(cf.slice(6, 8), 10)
        const mm = months[cf.charAt(8)]
        const ddRaw = parseInt(cf.slice(9, 11), 10)
        if (Number.isFinite(yy) && mm && Number.isFinite(ddRaw)) {
          const dd = ddRaw > 40 ? ddRaw - 40 : ddRaw
          if (dd >= 1 && dd <= 31) {
            const now = new Date()
            const fullYear = yy > ((now.getFullYear() % 100) + 1) ? 1900 + yy : 2000 + yy
            let age = now.getFullYear() - fullYear
            if ((now.getMonth() + 1) < mm || ((now.getMonth() + 1) === mm && now.getDate() < dd)) age -= 1
            if (age >= 16 && age <= 100) {
              const birthIso = `${fullYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
              if (!r.data_nascita_titolare) r.data_nascita_titolare = birthIso
              if (!r.titolare_data_nascita) r.titolare_data_nascita = birthIso
              if (!r.eta_titolare) r.eta_titolare = String(age)
              if (!r.titolare_eta) r.titolare_eta = String(age)
              if (!r.sesso_titolare) r.sesso_titolare = ddRaw > 40 ? 'F' : 'M'
              if (!r.titolare_sesso) r.titolare_sesso = ddRaw > 40 ? 'F' : 'M'
              if (!r.codice_catastale_nascita_titolare) r.codice_catastale_nascita_titolare = cf.slice(11, 15)
            }
          }
        }
      }
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

    // ─── Rischio Territoriale (Protezione Civile DPC) ──
    // Calcolato dal comune della sede legale o dalla città. Allinea il company-lookup
    // a lead-registry dove il rischio sismico è SEMPRE calcolato.
    // Senza questo, le stime premio mancano la maggiorazione sismica e gap_analysis
    // non rileva i rischi territoriali.
    let cityForRisk = ''
    if (typeof result.citta === 'string' && result.citta) {
      cityForRisk = result.citta
    } else if (typeof result.sede_legale === 'string' && result.sede_legale) {
      // Estrai città da sede_legale (es. "Via Roma 1, 20100 Milano (MI)" → "Milano")
      const parts = String(result.sede_legale).split(',').map(p => p.trim()).filter(Boolean)
      if (parts.length >= 2) {
        cityForRisk = parts[parts.length - 1].replace(/\d{5}/g, '').replace(/\([A-Z]{2}\)/g, '').trim()
      }
    }
    if (cityForRisk) {
      try {
        const territorial = getTerritorialRisk(cityForRisk)
        if (territorial.zona_sismica) {
          result.rischio_territoriale = territorial
        }
      } catch (e) {
        console.log(`[COMPANY-LOOKUP] Territorial risk failed for "${cityForRisk}":`, e)
      }
    }

    // ─── INSURANCE INTELLIGENCE — 100% deterministico, zero GPT ───
    // Genera obblighi legali, vulnerabilità specifiche, opportunità di cross-sell
    // e briefing broker basati SOLO su dati reali e normativa italiana
    if (hasInsuranceBasis) {
      // Parser per importi italiani salvati come stringa "1.234.567" o "1234567" o numero
      const parseImporto = (v: unknown): number | undefined => {
        if (typeof v === 'number' && Number.isFinite(v)) return v
        if (typeof v !== 'string') return undefined
        const n = parseFloat(v.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'))
        return Number.isFinite(n) && n > 0 ? n : undefined
      }
      const insuranceProfile: CompanyProfile = {
        ragione_sociale: String(result.ragione_sociale || query),
        partita_iva: result.partita_iva as string,
        codice_ateco: result.codice_ateco as string,
        descrizione_ateco: result.descrizione_ateco as string,
        forma_giuridica: result.forma_giuridica as string,
        forma_giuridica_codice: (result as any).forma_giuridica_codice as string,
        fatturato: fatNum || undefined,
        dipendenti: dipNum || undefined,
        costo_personale: parseImporto((result as any).costo_personale),
        capitale_sociale: parseImporto((result as any).capitale_sociale),
        patrimonio_netto: parseImporto((result as any).patrimonio_netto),
        totale_attivo: parseImporto((result as any).totale_attivo),
        sede_legale: (result as any).sede_legale as string,
        citta: result.citta as string,
        provincia: result.provincia as string,
        regione: (result as any).regione as string,
        data_costituzione: result.data_costituzione as string,
        stato_attivita: (result as any).stato_attivita as string,
        titolare: result.titolare as string,
        sito: result.sito as string,
        pec: result.pec as string,
        certificazioni: (result as any).certificazioni ? JSON.stringify((result as any).certificazioni) : undefined,
        ha_flotta_veicoli: !!(result as any).ha_flotta_veicoli,
        ha_immobili_proprieta: !!(result as any).ha_immobili_proprieta,
        partecipa_appalti_pubblici: !!(result as any).partecipa_appalti_pubblici,
        zona_sismica: (result.rischio_territoriale as any)?.zona_sismica ?? undefined,
        rischio_idrogeologico: (result.rischio_territoriale as any)?.rischio_idrogeologico ?? undefined,
        storico_bilanci: (result as any).storico_bilanci,
        persone: Array.isArray((result as any).persone) ? ((result as any).persone as Array<{ nome?: string; ruolo?: string; cf?: string; quota?: string }>) : undefined,
        eta_titolare: (result as any).eta_titolare ? parseInt(String((result as any).eta_titolare), 10) || undefined : undefined,
      }
      const intelligence = generateInsuranceIntelligence(insuranceProfile)
      result.insurance_intelligence = intelligence
      console.log(`[COMPANY-LOOKUP] Insurance Intelligence: ${intelligence.obblighi.length} obblighi, ${intelligence.vulnerabilita.length} vulnerabilità, ${intelligence.opportunita.length} opportunità`)
    }

    // LEGACY: keep old fields for backward compatibility
    if (hasInsuranceBasis) {
      // stima_premio RIMOSSA: benchmark grezzo ATECO×INAIL senza valore reale
      // per il broker. Priorità commerciale ora in bisogni_assicurativi_verificati.
      // Gap analysis + bisogni (legacy)
      const gapAnalysis = analyzeInsuranceGaps(
        fatNum, dipNum,
        (result.forma_giuridica as string) || null,
        (result.codice_ateco as string) || null,
        category || null,
        (result.rischio_territoriale as any)?.zona_sismica ?? null,
        (result.rischio_territoriale as any)?.rischio_idrogeologico ?? null,
        !!(result.pec), !!website,
      )
      if (gapAnalysis) result.gap_analysis = gapAnalysis
      result.bisogni_assicurativi = buildInsuranceNeedsProfile({
        profile: result as Record<string, any>,
        category: category || null,
        website: website || null,
        atecoInsurance: atecoIns || null,
        gapAnalysis: gapAnalysis || null,
      })
      result.bisogni_assicurativi_verificati = result.bisogni_assicurativi
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
    const PORTAL_DOMAINS = ['risultati.it','nomeesatto.it','esattospa.it','reportaziende.it','italiaonline.it','informazione-aziende.it','getfound.it','cercaziende.it','trovaaziende.it','misterimprese.it','guida-monaci.it','fatturatoitalia.it','companyreports.it','ufficiocamerale.it','registroimprese.it','paginegialle.it','paginebianche.it','reteimprese.it','dnb.com','kompass.com','europages.it','cylex.it','hotfrog.it','infobel.com','tuttocitta.it','comuni-italiani.it','inipec.gov.it']
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

    const genericInsuranceRx = /è importante considerare|personalizzare le polizze|dimensione dell['’]?azienda|settore per personalizzare|altre info utili|rischio\s*\d|danno economico al cliente|errore professionale/i
    if (typeof result.note_broker === 'string' && genericInsuranceRx.test(result.note_broker)) {
      console.log(`[COMPANY-LOOKUP] CLEANUP: removed generic note_broker: "${String(result.note_broker).slice(0, 100)}"`)
      delete result.note_broker
    }
    if (Array.isArray(result.rischi_specifici)) {
      result.rischi_specifici = (result.rischi_specifici as any[])
        .map((r: any) => String(r || '').trim())
        .filter((r: string) => r.length >= 6 && !genericInsuranceRx.test(r))
      if ((result.rischi_specifici as any[]).length === 0) delete result.rischi_specifici
    }
    if (Array.isArray(result.persone)) {
      const companyPersonRx = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|società|societa|cooperativa|consorzio|fondazione|associazione|impresa|azienda|ditta)\b/i
      const personNameRx = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*){1,4}$/
      result.persone = (result.persone as any[]).filter((p: any) => {
        const nome = String(p?.nome || '').trim()
        if (!nome || !personNameRx.test(nome) || companyPersonRx.test(nome)) return false
        if (/^[a-zà-ÿ]/.test(nome)) return false
        return true
      })
      if ((result.persone as any[]).length === 0) delete result.persone
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
      // If titolare was provided by OpenAPI (certified Camera di Commercio) — never remove
      const titFonte = String((result as any).titolare_fonte || '').toLowerCase()
      const isOpenApiTitolare = titFonte.includes('openapi')
      // Block company-like words: srl, servizi, tipografia, sanificazione, etc.
      const COMPANY_WORDS_RX = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|società|societa|cooperativa|consorzio|fondazione|associazione|impresa|ditta|studio|agenzia|servizi|servizio|sanificazione|disinfestazione|tipografia|officina|laboratorio|costruzioni|edilizia|edil|impianti|pulizie|trasporti|logistica|tecnolog|ambient|commerc|industriale|artigian|alimentar|meccan|elettr|group|holding|italia|international|soluzioni|systems|consulting|management|digital|global|energy|pharma|engineering|automotive|design|project|service|solution|network)\b/i
      // Must have at least 2 words (nome + cognome)
      const titWords = titStr.split(/\s+/).filter(w => w.length >= 2)
      // Check if titolare is essentially the company name (ragione_sociale without legal suffix)
      // Use 80% length threshold to avoid false positives on ditte individuali
      // e.g. "Gorgone Marco" in "G.E.M DI GORGONE MARCO" is the owner, not a company name
      const rsCleanForTit = result.ragione_sociale
        ? String(result.ragione_sociale).toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc)\b/gi, '').replace(/[^a-zà-ú\s]/gi, '').trim()
        : ''
      const titCleanForComp = titLow.replace(/[^a-zà-ú\s]/gi, '').trim()
      const matchesCompanyName = rsCleanForTit.length >= 3 && titCleanForComp.length >= 3 && (
        rsCleanForTit === titCleanForComp ||
        (rsCleanForTit.includes(titCleanForComp) && titCleanForComp.length >= rsCleanForTit.length * 0.8) ||
        (titCleanForComp.includes(rsCleanForTit) && rsCleanForTit.length >= titCleanForComp.length * 0.8)
      )
      const looksLikePerson = titWords.length >= 2 && !COMPANY_WORDS_RX.test(titLow)
        && /^[A-ZÀ-Ú]/.test(titWords[0]) && /^[A-ZÀ-Ú]/.test(titWords[titWords.length - 1])
        && titStr.length <= 60
        && !matchesCompanyName
      if (isOpenApiTitolare) {
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: titolare "${titStr}" from OpenAPI — keeping (certified)`)
      } else if (!looksLikePerson) {
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

    // ── FINAL VALIDATION: email domain must match company name (distinctive tokens) ──
    // Bug: "customerservice@marcodimilanoshoes.com" was accepted for "G.E.M DI GORGONE MARCO"
    // because the old check used 4-char prefix match ("marc" in "marcodimilanoshoes" = true).
    // Fix: require at least ONE distinctive token (>=5 chars) from the company name to appear
    // fully in the email domain base (or the domain to appear in the company name).
    if (result.email && typeof result.email === 'string') {
      const GENERIC_EMAIL = /gmail\.com|yahoo\.|outlook\.|hotmail\.|libero\.it|virgilio\.it|tiscali\.it|alice\.it|fastwebnet\.it|tin\.it/i
      const emailDomainFull = String(result.email).split('@')[1] || ''
      const emailDomainBase = emailDomainFull.toLowerCase().split('.')[0].replace(/[^a-z0-9]/g, '')
      if (!GENERIC_EMAIL.test(emailDomainFull) && emailDomainBase.length >= 4) {
        const compForEmail = String(result.ragione_sociale || queryCompanyName || '').toLowerCase()
        // Extract DISTINCTIVE tokens: >=5 chars, not legal form words, not common Italian words
        const STOP_EMAIL = /^(srl|srls|spa|sas|snc|italia|italy|group|holding|studio|service|services|info|mail|contatti|amministrazione|segreteria|hello|support|vendite|sales|customerservice|customer|contact|general|posta|ufficio)$/i
        const distinctiveTokens = compForEmail
          .replace(/[^a-zà-ù0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 5 && !STOP_EMAIL.test(t))
        const siteDomainClean = result.sito ? String(result.sito).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.')[0] : ''
        const siteMatches = siteDomainClean.length >= 4 && (emailDomainBase.includes(siteDomainClean) || siteDomainClean.includes(emailDomainBase))
        const nameMatches5 = distinctiveTokens.length === 0 // if no distinctive tokens, can't reject
          || distinctiveTokens.some(t => emailDomainBase.includes(t) || t.includes(emailDomainBase))
        if (!siteMatches && !nameMatches5) {
          console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: CLEARED email "${result.email}" — domain "${emailDomainBase}" has no overlap with company "${compForEmail}" (distinctive tokens: [${distinctiveTokens.join(',')}])`)
          delete result.email
          delete (result as any).email_fonte
        } else {
          console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: email "${result.email}" accepted (siteMatch=${siteMatches}, nameMatch=${nameMatches5})`)
        }
      }
    }

    const blockedContactEmailDomains = new Set([
      'visura.pro', 'ufficiocamerale.it', 'registroaziende.it', 'companyreports.it', 'fatturatoitalia.it',
      'reteimprese.it', 'paginegialle.it', 'paginebianche.it', 'misterimprese.it', 'italiaonline.it',
      'actaliscertymail.it', 'arubapec.it', 'legalmail.it', 'pec.it', 'pecimprese.it', 'postecert.it',
      'sicurezzapostale.it', 'registerpec.it', 'mypec.eu', 'cert.legalmail.it', 'infocert.it', 'namirial.it',
      'casellapec.com', 'casellapec.it', 'pec.aruba.it', 'open.legalmail.it', 'pec.cciaa.it',
    ])
    const companyForContactEmail = String(result.ragione_sociale || queryCompanyName || query || '').toLowerCase().replace(/[^a-z0-9à-ù\s]/gi, ' ')
    const isBlockedContactEmail = (value: unknown): boolean => {
      const emailValue = String(value || '').trim().toLowerCase()
      const emailDomain = emailValue.split('@')[1]?.replace(/^www\./, '')
      if (!emailDomain) return true
      const domainBase = emailDomain.split('.')[0].replace(/[^a-z0-9]/g, '')
      if (domainBase.length >= 5 && companyForContactEmail.includes(domainBase)) return false
      if (blockedContactEmailDomains.has(emailDomain)) return true
      return Array.from(blockedContactEmailDomains).some(d => emailDomain.endsWith(`.${d}`))
    }
    if (result.email && isBlockedContactEmail(result.email)) {
      console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: CLEARED provider/source email "${result.email}"`)
      delete result.email
      delete (result as any).email_fonte
    }
    if (Array.isArray((result as any).tutte_email)) {
      const filteredEmails = ((result as any).tutte_email as any[])
        .filter(e => e?.email && !isBlockedContactEmail(e.email))
        .filter((e, idx, arr) => arr.findIndex(x => String(x?.email || '').toLowerCase() === String(e?.email || '').toLowerCase()) === idx)
      if (filteredEmails.length !== ((result as any).tutte_email as any[]).length) {
        console.log(`[COMPANY-LOOKUP] FINAL VALIDATION: filtered provider/source emails ${((result as any).tutte_email as any[]).length} → ${filteredEmails.length}`)
      }
      if (filteredEmails.length > 0) {
        ;(result as any).tutte_email = filteredEmails
        if (!result.email) result.email = String(filteredEmails[0].email).toLowerCase()
      } else {
        delete (result as any).tutte_email
      }
    }

    // ── FINAL GATE: anti-homonym P.IVA validation ──
    // Split query tokens into NAME tokens (must appear in ragione_sociale) and GEO tokens
    // (city/municipality — must appear in citta/sede_legale/provincia, NOT in ragione_sociale).
    // Old logic (all tokens in RS) produced false positives on "FERRARI S.P.A. Maranello" where
    // "maranello" obviously is not in the legal name "Ferrari S.p.A.".
    if (!isPiva && result.partita_iva && result.ragione_sociale) {
      // Legal/forma + common Italian business CATEGORY descriptors that users prepend to searches
      // (e.g. "Impresa di pulizie GR Clean Solutions" — "impresa" and "pulizie" aren't in the legal name).
      const STOP_FORM = /\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|società|societa|unipersonale|gruppo|group|holding|holdings|italia|italy|impresa|imprese|ditta|studio|studi|agenzia|agenzie|azienda|aziende|pulizie|pulizia|edile|edili|costruzioni|costruzione|consulenza|consulenti|consulente|formazione|immobiliare|immobiliari|ingegneria|architetti|geometri|traslochi|trasporti|elettrico|elettrica|elettrici|idraulica|idraulici|ristorante|pizzeria|pasticceria|gelateria|panificio|autofficina|autosalone|autoricambi|automobile|automobili|farmacia|ottica|fotografia|fotografo|sartoria|abbigliamento|alimentari|supermercato|hotel|albergo|alberghi|ristorazione|catering|estetica|estetico|parrucchiere|parrucchieri|barbiere|tatuatore|tatuaggi|carrozzeria|gommista|gommisti|tappezzeria|tappezzerie|falegnameria|falegname|fabbri|saldatore|saldatori|impiantistica|servizi|cooperativa|cooperative|consorzio|consorzi|fondazione|associazione|onlus)\b/gi
      // Detect geo tokens (Italian cities/municipalities) in the query to classify them separately.
      // Source: ITALIAN_COMUNI_TOKENS — complete ISTAT list of all 7,904 Italian municipalities,
      // auto-generated from matteocontrini/comuni-json. Re-run scripts/generate-comuni.mjs to refresh.
      // This guarantees that ANY Italian town name in the user query is correctly classified as
      // geographic (not a name-token) — preventing the FINAL GATE from wrongly clearing fiscal data.
      const KNOWN_CITIES = ITALIAN_COMUNI_TOKENS
      const tokensAll = String(query).toLowerCase()
        .replace(STOP_FORM, '')
        .replace(/[^a-zà-ù0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
      const FIRST_NAME_EXCLUSIONS_FG = new Set([
        'marco','andrea','lorenzo','matteo','luca','paolo','giuseppe','giovanni','antonio',
        'francesco','mario','roberto','alessandro','stefano','bruno','sergio','giorgio',
        'carlo','alberto','davide','simone','daniele','fabio','claudio','luciano',
        'vittorio','felice','maurizio','michele','raffaele','salvatore','angelo',
        'franco','leo','aldo','dario','nicola','rosa','elena','valentina','silvia',
        'marina','giulia','laura','anna','barbara','alice','diana','emma','sara',
        'giuliano','adriano','silvio','romano','remo','renato','cesare','alfredo',
        'santo','guido','marcello','enzo','germano','massimo','fernando',
      ])
      const nameTokens: string[] = []
      const geoTokens: string[] = []
      for (const t of tokensAll) {
        if (KNOWN_CITIES.has(t) && !FIRST_NAME_EXCLUSIONS_FG.has(t)) geoTokens.push(t); else nameTokens.push(t)
      }
      if (nameTokens.length >= 1) {
        const rsLow = String(result.ragione_sociale).toLowerCase()
        let geoContext = [result.citta, result.sede_legale, result.provincia].filter(Boolean).join(' ').toLowerCase()
        // Expand province codes (MB) → "monza brianza" so that city-level queries match province-level addresses
        const PROVINCE_MAP: Record<string, string> = {
          'ag':'agrigento','al':'alessandria','an':'ancona','ao':'aosta','ap':'ascoli piceno','aq':'aquila',
          'ar':'arezzo','at':'asti','av':'avellino','ba':'bari','bg':'bergamo','bi':'biella','bl':'belluno',
          'bn':'benevento','bo':'bologna','br':'brindisi','bs':'brescia','bt':'barletta trani','bz':'bolzano',
          'ca':'cagliari','cb':'campobasso','ce':'caserta','ch':'chieti','cl':'caltanissetta','cn':'cuneo',
          'co':'como','cr':'cremona','cs':'cosenza','ct':'catania','cz':'catanzaro','en':'enna','fc':'forli cesena',
          'fe':'ferrara','fg':'foggia','fi':'firenze','fm':'fermo','fr':'frosinone','ge':'genova','go':'gorizia',
          'gr':'grosseto','im':'imperia','is':'isernia','kr':'crotone','lc':'lecco','le':'lecce','li':'livorno',
          'lo':'lodi','lt':'latina','lu':'lucca','mb':'monza brianza','mc':'macerata','me':'messina','mi':'milano',
          'mn':'mantova','mo':'modena','ms':'massa carrara','mt':'matera','na':'napoli','no':'novara','nu':'nuoro',
          'or':'oristano','pa':'palermo','pc':'piacenza','pd':'padova','pe':'pescara','pg':'perugia','pi':'pisa',
          'pn':'pordenone','po':'prato','pr':'parma','pt':'pistoia','pu':'pesaro urbino','pv':'pavia','pz':'potenza',
          'ra':'ravenna','rc':'reggio calabria','re':'reggio emilia','rg':'ragusa','ri':'rieti','rm':'roma',
          'rn':'rimini','ro':'rovigo','sa':'salerno','si':'siena','so':'sondrio','sp':'spezia','sr':'siracusa',
          'ss':'sassari','su':'sud sardegna','sv':'savona','ta':'taranto','te':'teramo','tn':'trento','to':'torino',
          'tp':'trapani','tr':'terni','ts':'trieste','tv':'treviso','ud':'udine','va':'varese','vb':'verbania',
          'vc':'vercelli','ve':'venezia','vi':'vicenza','vr':'verona','vt':'viterbo','vv':'vibo valentia',
        }
        // Find province codes like (MB) or (MI) in the geo context and expand them
        const provMatches = geoContext.match(/\(([a-z]{2})\)/g)
        if (provMatches) {
          for (const m of provMatches) {
            const code = m.replace(/[()]/g, '')
            if (PROVINCE_MAP[code]) geoContext += ' ' + PROVINCE_MAP[code]
          }
        }
        // 1) NAME tokens: must all appear in ragione_sociale (tolerance 1 if >=3 tokens)
        const missingName = nameTokens.filter(t => !rsLow.includes(t))
        const toleratedName = nameTokens.length >= 3 ? 1 : 0
        // 2) GEO tokens: must all appear in geo context; if geo_context empty, geo mismatch is ignored (best-effort)
        const missingGeo = geoContext.length > 0 ? geoTokens.filter(t => !geoContext.includes(t)) : []
        const nameFailed = missingName.length > toleratedName
        const geoFailed = missingGeo.length > 0
        // ONLY clear when NAME is mismatched. Geo alone is too noisy: companies often have
        // legal HQ in one city and operational/branch in another (e.g. Optoprim has legal HQ
        // in Milano but operational HQ in Vimercate; user searching with either city is correct).
        // Geo mismatch alone is a soft warning, not a fatal mismatch.
        if (nameFailed) {
          const reason = `nome mismatch: ragione_sociale "${result.ragione_sociale}" non contiene ${missingName.join(',')}`
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
        } else if (geoFailed) {
          // Soft warning only: keep data but flag that the queried city differs from registered seat.
          const reason = `geo context "${geoContext}" non contiene ${missingGeo.join(',')}`
          console.log(`[COMPANY-LOOKUP] FINAL GATE: geo mismatch (NAME OK) — ${reason} — keeping data, adding warning`)
          if (!Array.isArray(result.warnings)) result.warnings = []
          ;(result.warnings as string[]).push(`Città cercata "${missingGeo.join(',')}" non corrisponde alla sede registrata (${geoContext}). Possibile sede operativa o filiale.`)
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
      if (!openApiCameraleAvailable && tk && needsUcData && (result.partita_iva || ragForUC)) {
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

    }

    // FINAL P.IVA INVARIANT: if user queried by P.IVA, the result.partita_iva must match.
    // Any source that managed to overwrite the queried P.IVA was wrong — restore it.
    if (isPiva && cleanQuery) {
      const currentP = result.partita_iva ? String(result.partita_iva).replace(/\D/g, '') : ''
      if (currentP !== cleanQuery) {
        console.log(`[COMPANY-LOOKUP] FINAL P.IVA INVARIANT: result P.IVA "${currentP}" differs from query "${cleanQuery}". Restoring queried P.IVA.`)
        result.partita_iva = cleanQuery
      }
    }

    // FINAL ANTI-MISMATCH: if user queried by name (not P.IVA) and the returned ragione_sociale
    // doesn't match ANY significant word from the query, the result is completely wrong (omonimia).
    // E.g. query "MAGGIONI PARTY SERVICE SRL Novate milanese" → result "M Project S.r.l." → REJECT.
    if (!isPiva && result.ragione_sociale && typeof result.ragione_sociale === 'string') {
      const rsLow = (result.ragione_sociale as string).toLowerCase()
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|srl|srls|spa|sas|snc|societa|società|unipersonale|di|e|the|a|socio|unico)\b\.?/gi, '')
        .replace(/[^a-zà-ù0-9\s]/g, ' ').trim()
      const qNameLow = queryCompanyName.toLowerCase()
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|srl|srls|spa|sas|snc|societa|società|unipersonale|di|e|the|a|socio|unico)\b\.?/gi, '')
        .replace(/[^a-zà-ù0-9\s]/g, ' ').trim()
      const qNameTokens = qNameLow.split(/\s+/).filter((w: string) => w.length >= 3)
      const rsTokens = rsLow.split(/\s+/).filter((w: string) => w.length >= 2)
      if (qNameTokens.length >= 2) {
        const matchedTokens = qNameTokens.filter((w: string) => rsTokens.some((rt: string) => rt.includes(w) || w.includes(rt)))
        if (matchedTokens.length === 0) {
          console.log(`[COMPANY-LOOKUP] FINAL ANTI-MISMATCH: query="${queryCompanyName}" vs ragione_sociale="${result.ragione_sociale}" — ZERO matching tokens! Clearing ALL result data.`)
          const keepKeys = new Set(['fonti', '_query'])
          for (const k of Object.keys(result)) {
            if (!keepKeys.has(k)) delete result[k]
          }
        }
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

    if (result.email && typeof result.email === 'string') {
      const cleanedEmail = cleanContactEmail(result.email)
      if (cleanedEmail) {
        if (cleanedEmail !== result.email) console.log(`[COMPANY-LOOKUP] FINAL: email cleaned "${result.email}" → "${cleanedEmail}"`)
        result.email = cleanedEmail
      } else {
        console.log(`[COMPANY-LOOKUP] FINAL: scarto email non valida "${result.email}"`)
        delete result.email
        delete (result as any).email_fonte
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
        .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|gmbh|ltd|inc|corp|gruppo|group|holding|italia|italy|societa|società|nome|collettivo|tra|professionisti|associati|associates|studio)\b\.?/gi, '')
        .replace(/[^a-z0-9]/g, '')
      // ★ ANTI-FALSE-NEGATIVE: estraiamo anche i TOKEN significativi della ragione sociale (≥5 char),
      // perché i nomi lunghi tipo "Biotecnica Di Magagnini Mattia E Malatini Silvia Societa' In
      // Nome Collettivo Tra Professionisti" non possono mai essere un substring del dominio
      // (che è sempre più corto). Basta che il dominio contenga UNO dei token significativi
      // (es. "biotecnica" → biotecnicaassociati.com → ACCEPT).
      const significantTokens = ragSrcW.toLowerCase()
        .replace(/['`\u2019\u02bc]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 5 && !/^(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|gmbh|societa|società|nome|collettivo|tra|professionisti|associati|associates|studio|italia|italy|gruppo|group|holding|company|corp|incorporated|limited|mattia|silvia|magagnini|malatini|marco|mario|luigi|paolo|giuseppe|antonio|francesco)$/i.test(t))

      // Se la ragione è troppo corta (<4) o non disponibile, salto il gate (rischio falsi positivi).
      if (cleanedRagW.length >= 4 || significantTokens.length > 0) {
        const tokenize = (s: string) => s.toLowerCase()
          .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|consorzio|cooperativa|italia|italy|group|gruppo|holding)\b\.?/gi, '')
          .replace(/[^a-z0-9]/g, '')
        // Also strip legal suffixes attached to the END without word boundary,
        // e.g. "schiattiangelosrl" → "schiattiangelo" (the "srl" is appended in the domain).
        const stripTrailingLegal = (s: string) => s.replace(/(srl|srls|spa|sas|snc|sapa|scarl|scrl)$/i, '')
        const matchesRagione = (cand: string): boolean => {
          if (!cand) return false
          const c = tokenize(cand)
          if (!c || c.length < 3) return false
          // ★ TOKEN MATCH (primary check): se il candidato contiene un token significativo
          // del nome aziendale (≥5 char), è accettato. Funziona quando ragione è lunga es.
          // "biotecnica" è in "biotecnicaassociati.com" → ACCEPT.
          for (const tok of significantTokens) {
            if (c.includes(tok)) return true
          }
          // Try both the raw tokenized candidate AND a version with trailing legal suffix removed.
          const cStripped = stripTrailingLegal(c)
          const candidates = cStripped !== c && cStripped.length >= 3 ? [c, cStripped] : [c]
          // Also try the cleaned ragione with trailing legal suffix removed (rare, but safe).
          const ragStripped = stripTrailingLegal(cleanedRagW)
          const rags = ragStripped !== cleanedRagW && ragStripped.length >= 3 ? [cleanedRagW, ragStripped] : [cleanedRagW]
          for (const cc of candidates) {
            for (const rr of rags) {
              const slugInRag = rr.includes(cc)
              const ragInSlug = cc.includes(rr)
              if (slugInRag || ragInSlug) {
                const minL = Math.min(cc.length, rr.length)
                const maxL = Math.max(cc.length, rr.length)
                // slug fully inside ragione (e.g. "schiattiangelo" in "officinameccanicaschiattiangelo")
                // → accept if slug is meaningful (≥6 chars), regardless of ratio.
                // ragione fully inside slug → require ratio ≥0.5 (extra parts in slug should be small).
                if (slugInRag && cc.length >= 6) return true
                if (minL / maxL >= 0.5) return true
              }
            }
          }
          return false
        }
        // SITO
        if (result.sito && typeof result.sito === 'string') {
          const dom = normalizeDomain(result.sito)
          if (dom && !matchesRagione(dom.split('.')[0])) {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto sito "${result.sito}" — dominio "${dom}" non coerente con ragione "${cleanedRagW}"`)
            const telFonte = String((result as any).telefono_fonte || '').toLowerCase()
            const celFonte = String((result as any).cellulare_fonte || '').toLowerCase()
            const emailFonte = String((result as any).email_fonte || '').toLowerCase()
            if (result.telefono && (telFonte.includes('sito_ufficiale') || telFonte.includes('sito ufficiale') || telFonte.includes('nome/sede verificati'))) {
              console.log(`[COMPANY-LOOKUP] FINAL: scarto telefono "${result.telefono}" — fonte legata al sito/Maps debole scartato`)
              delete result.telefono
              delete (result as any).telefono_fonte
            }
            if (result.cellulare && (celFonte.includes('sito_ufficiale') || celFonte.includes('sito ufficiale') || celFonte.includes('nome/sede verificati'))) {
              console.log(`[COMPANY-LOOKUP] FINAL: scarto cellulare "${result.cellulare}" — fonte legata al sito/Maps debole scartato`)
              delete result.cellulare
              delete (result as any).cellulare_fonte
            }
            if (result.email && typeof result.email === 'string') {
              const emailDom = normalizeDomain(result.email)
              if (emailDom === dom || emailFonte.includes('sito_ufficiale') || emailFonte.includes('sito ufficiale')) {
                console.log(`[COMPANY-LOOKUP] FINAL: scarto email "${result.email}" — fonte legata al sito scartato`)
                delete result.email
                delete (result as any).email_fonte
              }
            }
            delete result.sito
            delete (result as any).sito_web
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
          const slugRaw = m[1].toLowerCase().replace(/[^a-z0-9]/g, '')
          if (slugRaw.length < 3) continue
          // Generic slug names → reject (es. "share", "home", "profile")
          if (/^(share|home|profile|page|pages|company|in|school)$/.test(slugRaw)) {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto ${key} con slug generico "${slugRaw}"`)
            delete (result as any)[key]
            continue
          }
          // Try with trailing legal suffix removed (handles "schiattiangelosrl" → "schiattiangelo").
          const slugStripped = slugRaw.replace(/(srl|srls|spa|sas|snc|sapa|scarl|scrl)$/i, '')
          const slugVariants = slugStripped !== slugRaw && slugStripped.length >= 3 ? [slugRaw, slugStripped] : [slugRaw]
          let bestOverlap = 0
          let bestMatched = false
          for (const slug of slugVariants) {
            const slugInRag = cleanedRag.includes(slug)
            const ragInSlug = slug.includes(cleanedRag)
            if (slugInRag || ragInSlug) {
              const minLen = Math.min(slug.length, cleanedRag.length)
              const maxLen = Math.max(slug.length, cleanedRag.length)
              const overlap = minLen / maxLen
              if (overlap > bestOverlap) bestOverlap = overlap
              // slug fully inside ragione → accept if slug is meaningful (≥6 chars).
              if (slugInRag && slug.length >= 6) { bestMatched = true; break }
              if (overlap >= 0.5) { bestMatched = true; break }
            }
          }
          if (bestMatched) continue // OK, accepted
          if (bestOverlap > 0) {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto ${key} URL "${v}" — slug "${slugRaw}" troppo corto vs ragione "${cleanedRag}" (overlap ${Math.round(bestOverlap*100)}%)`)
          } else {
            console.log(`[COMPANY-LOOKUP] FINAL: scarto ${key} URL "${v}" — slug "${slugRaw}" non matcha ragione "${cleanedRag}"`)
          }
          delete (result as any)[key]
        }
      }
    }

    // ── FINAL FALLBACK: deriva il sito dall'email business se ancora manca.
    // Step 2c già lo fa, ma in alcuni flow (es. P.IVA pura) potrebbe essere saltato.
    // Es. "info@archibuzz.com" → sito "https://archibuzz.com"
    // ★ MUST verify the domain is alive — otherwise we'd re-create hallucinated sites
    // that Step 6e never saw (because the site was never set before this point).
    if (!result.sito && !result.sito_web && result.email && typeof result.email === 'string') {
      const emDom = String(result.email).split('@')[1]?.toLowerCase().trim() || ''
      if (emDom && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emDom)) {
        const isGen = /^(gmail|yahoo|hotmail|outlook|libero|virgilio|tiscali|alice|aruba|live|icloud|protonmail|tin|me)\./i.test(emDom)
          || /^(pec|legalmail|pecimprese|pecmail|postacert|casellapec)\./i.test(emDom)
          || /\.(pec|legalmail|pecimprese|arubapec|postecert|sicurezzapostale|registerpec|mypec|actaliscertymail|casellapec|namirial|infocert)\./i.test(emDom)
          || /\.(pec\.it|legalmail\.it|arubapec\.it|pecimprese\.it)$/i.test(emDom)
          || ['pec.it', 'libero.it', 'alice.it', 'gmail.com', 'yahoo.it', 'hotmail.it', 'outlook.it', 'tin.it', 'aruba.it'].includes(emDom)
        if (!isGen) {
          const clean = emDom.replace(/^(?:mail|www|pec|smtp|webmail|posta)\./, '')
          // Quick alive check: if domain doesn't resolve, email is also invalid (can't deliver)
          let domainAlive = false
          try {
            const headRes = await fetch(`https://${clean}`, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'follow' })
            domainAlive = headRes.ok || (headRes.status >= 200 && headRes.status < 500)
          } catch { /* DNS fail or timeout */ }
          if (!domainAlive) {
            try {
              const getRes = await fetch(`https://${clean}`, { method: 'GET', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(5000), redirect: 'follow' })
              domainAlive = getRes.ok || (getRes.status >= 200 && getRes.status < 500)
            } catch { /* still dead */ }
          }
          if (domainAlive) {
            result.sito = `https://${clean}`
            console.log(`[COMPANY-LOOKUP] FINAL: derived sito "${result.sito}" from email "${result.email}" (domain alive)`)
          } else {
            // Domain doesn't exist → email can't possibly work either
            console.log(`[COMPANY-LOOKUP] FINAL: domain "${clean}" is DEAD — clearing hallucinated email "${result.email}"`)
            delete result.email
            delete (result as any).email_fonte
          }
        }
      }
    }
    // Stessa cosa con la PEC se è di un dominio aziendale (es. legal@pec.carelweb.it → carelweb.it)
    if (!result.sito && !result.sito_web && result.pec && typeof result.pec === 'string') {
      let pecDom = String(result.pec).split('@')[1]?.toLowerCase().trim() || ''
      // ★ FIX bug visto su CAREL: strip del prefisso "pec.", "legalmail." ecc.
      // SOLO se è un sub-dominio (>=3 parti). Non strippare per "pec.it" (provider).
      // Es: "pec.carelweb.it" (3 parti) → "carelweb.it"
      //     "pec.it"            (2 parti) → resta "pec.it" (sarà filtrato dalla blacklist)
      const pecSubPrefixRe = /^(?:ipec|pec|legalmail|pecmail|postacert|certmail)\./i
      if (pecSubPrefixRe.test(pecDom) && pecDom.split('.').length >= 3) {
        pecDom = pecDom.replace(pecSubPrefixRe, '')
      }
      const PROVIDER_PEC_DOMAINS_FINAL = new Set([
        'pec.it', 'arubapec.it', 'legalmail.it', 'pecimprese.it', 'pecmail.it',
        'postacert.it', 'postecert.it', 'sicurezzapostale.it', 'registerpec.it',
        'mypec.eu', 'actaliscertymail.it', 'casellapec.com', 'casellapec.it',
        'pec.aruba.it', 'cert.legalmail.it', 'open.legalmail.it', 'pec.cciaa.it',
        'namirial.it', 'infocert.it',
      ])
      // Anche generic email providers (raro ma possibile per cooperative/freelance)
      const isGenericProvider = /^(gmail|yahoo|hotmail|outlook|libero|virgilio|tiscali|alice|aruba|live|icloud|protonmail|tin)\./i.test(pecDom)
      // Detect subdomains of PEC providers: artusiocostruzioni.legalmail.it, studio.pec.it, etc.
      const isPecSubdomain = /\.(pec|legalmail|pecimprese|arubapec|postecert|sicurezzapostale|registerpec|mypec|actaliscertymail|casellapec|namirial|infocert)\./i.test(pecDom)
        || /\.(pec\.it|legalmail\.it|arubapec\.it|pecimprese\.it)$/i.test(pecDom)
      const isPecGen = PROVIDER_PEC_DOMAINS_FINAL.has(pecDom) || isGenericProvider || isPecSubdomain
      if (pecDom && !isPecGen && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(pecDom)) {
        result.sito = `https://${pecDom}`
        console.log(`[COMPANY-LOOKUP] FINAL: derived sito "${result.sito}" from PEC dominio "${pecDom}"`)
        if (!result.email || !result.telefono || !result.cellulare) {
          try {
            const derivedPecSite = String(result.sito)
            const pecSiteDeep = await scrapeWebsiteDeep(derivedPecSite)
            console.log(`[COMPANY-LOOKUP] FINAL: scrape derived PEC site done (${pecSiteDeep.pagesScraped} pages, ${pecSiteDeep.emails.length} emails, ${pecSiteDeep.phones.length} phones)`)
            for (const em of pecSiteDeep.emails || []) {
              const emLow = cleanContactEmail(em.email)
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emLow)) continue
              if (!result.email) { result.email = emLow; (result as any).email_fonte = 'sito_derivato_da_pec_openapi' }
              const tutteEmail = ((result as any).tutte_email || []) as Array<{ email: string; tipo: string; pagina: string }>
              if (!tutteEmail.find(e => e.email === emLow)) {
                const isGeneric = /^(info|contatti|contact|admin|office|segreteria|reception|booking|sales|vendite|support|assistenza|help|marketing|hr|noreply|webmaster|newsletter|press|media)/i.test(emLow)
                tutteEmail.push({ email: emLow, tipo: isGeneric ? 'generic' : 'personal', pagina: em.page || '/' })
                ;(result as any).tutte_email = tutteEmail
              }
            }
            for (const ph of pecSiteDeep.phones || []) {
              const raw = String(ph.number || '').trim()
              const digits = raw.replace(/\D/g, '')
              const core = digits.startsWith('39') ? digits.slice(2) : digits
              if (/^0\d{8,10}$/.test(core)) {
                if (!result.telefono) { result.telefono = raw; (result as any).telefono_fonte = 'sito_derivato_da_pec_openapi' }
                const tuttiTel = ((result as any).tutti_telefoni || []) as Array<{ numero: string; fonte: string; pagina: string }>
                if (!tuttiTel.find(t => t.numero.replace(/\D/g, '').slice(-9) === core.slice(-9))) {
                  tuttiTel.push({ numero: raw, fonte: 'sito_derivato_da_pec_openapi', pagina: ph.page || '/' })
                  ;(result as any).tutti_telefoni = tuttiTel
                }
              } else if (/^3\d{8,9}$/.test(core)) {
                if (!result.cellulare) { result.cellulare = raw; (result as any).cellulare_fonte = 'sito_derivato_da_pec_openapi' }
                const tuttiCel = ((result as any).tutti_cellulari || []) as Array<{ numero: string; fonte: string; pagina: string }>
                if (!tuttiCel.find(t => t.numero.replace(/\D/g, '').slice(-9) === core.slice(-9))) {
                  tuttiCel.push({ numero: raw, fonte: 'sito_derivato_da_pec_openapi', pagina: ph.page || '/' })
                  ;(result as any).tutti_cellulari = tuttiCel
                }
              }
            }
            if ((pecSiteDeep.emails || []).length === 0 && (pecSiteDeep.phones || []).length === 0) {
              const auditRes = await fetch(`${backendUrl}/audit-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: derivedPecSite }),
                signal: AbortSignal.timeout(35000),
              }).catch(() => null)
              if (auditRes?.ok) {
                const audit = await auditRes.json().catch(() => null) as any
                const auditEmail = cleanContactEmail(audit?.email)
                const auditTel = typeof audit?.telefono === 'string' ? audit.telefono.trim() : ''
                console.log(`[COMPANY-LOOKUP] FINAL: /audit-url derived PEC site returned email=${auditEmail || 'none'} tel=${auditTel || 'none'}`)
                if (auditEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auditEmail) && !result.email) {
                  result.email = auditEmail
                  ;(result as any).email_fonte = 'sito_derivato_da_pec_openapi_playwright'
                }
                if (auditEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auditEmail)) {
                  const tutteEmail = ((result as any).tutte_email || []) as Array<{ email: string; tipo: string; pagina: string }>
                  if (!tutteEmail.find(e => e.email === auditEmail)) {
                    const isGeneric = /^(info|contatti|contact|admin|office|segreteria|reception|booking|sales|vendite|support|assistenza|help|marketing|hr|noreply|webmaster|newsletter|press|media)/i.test(auditEmail)
                    tutteEmail.push({ email: auditEmail, tipo: isGeneric ? 'generic' : 'personal', pagina: '/' })
                    ;(result as any).tutte_email = tutteEmail
                  }
                }
                if (auditTel) {
                  const auditDigits = auditTel.replace(/\D/g, '').replace(/^(39|0039)/, '')
                  if (/^0\d{8,10}$/.test(auditDigits) && !result.telefono) {
                    result.telefono = auditTel
                    ;(result as any).telefono_fonte = 'sito_derivato_da_pec_openapi_playwright'
                  } else if (/^3\d{8,9}$/.test(auditDigits) && !result.cellulare) {
                    result.cellulare = auditTel
                    ;(result as any).cellulare_fonte = 'sito_derivato_da_pec_openapi_playwright'
                  }
                  if (/^0\d{8,10}$/.test(auditDigits)) {
                    const tuttiTel = ((result as any).tutti_telefoni || []) as Array<{ numero: string; fonte: string; pagina: string }>
                    if (!tuttiTel.find(t => t.numero.replace(/\D/g, '').slice(-9) === auditDigits.slice(-9))) {
                      tuttiTel.push({ numero: auditTel, fonte: 'sito_derivato_da_pec_openapi_playwright', pagina: '/' })
                      ;(result as any).tutti_telefoni = tuttiTel
                    }
                  } else if (/^3\d{8,9}$/.test(auditDigits)) {
                    const tuttiCel = ((result as any).tutti_cellulari || []) as Array<{ numero: string; fonte: string; pagina: string }>
                    if (!tuttiCel.find(t => t.numero.replace(/\D/g, '').slice(-9) === auditDigits.slice(-9))) {
                      tuttiCel.push({ numero: auditTel, fonte: 'sito_derivato_da_pec_openapi_playwright', pagina: '/' })
                      ;(result as any).tutti_cellulari = tuttiCel
                    }
                  }
                }
              }
            }
          } catch (e: any) {
            console.log(`[COMPANY-LOOKUP] FINAL: scrape derived PEC site failed — ${e?.message || e}`)
          }
        }
      }
    }

    // ★ Step 6h (Fix bug visto su CAREL S.r.l. - 1 dipendente reale ma sistema mostrava 26):
    // Sanity check incrociato dipendenti × costo_personale.
    // Se ratio costo_personale/dipendenti è < 8000€/anno → impossibile (sotto stipendio
    // minimo legale annuo). Significa che dipendenti è gonfiato (es. AI ha estratto male).
    // Scartiamo e basta: il dato corretto deve venire da FatturatoItalia/CompanyReports
    // (chiamate per P.IVA in Step 1a2 con override). Se nessuna fonte autoritativa lo ha,
    // meglio campo vuoto che stima inventata.
    if (result.dipendenti && result.costo_personale) {
      // Parse dipendenti handling ranges:  "20-49"  → use 20 (lower bound, conservative)
      //                                    "da 6 a 9" → use 6
      //                                    "10"      → use 10
      // Previously we stripped all non-digits which turned "20-49" into 2049, breaking the ratio.
      const dipStr = String(result.dipendenti).trim()
      let dip: number = NaN
      const rangeM = dipStr.match(/(\d+)\s*(?:[-–—]|a)\s*(\d+)/i) || dipStr.match(/da\s*(\d+)\s*a\s*(\d+)/i)
      if (rangeM) {
        dip = parseInt(rangeM[1], 10)
      } else {
        const singleM = dipStr.match(/\d+/)
        if (singleM) dip = parseInt(singleM[0], 10)
      }
      const costo = parseInt(String(result.costo_personale).replace(/[^\d]/g, ''), 10)
      if (Number.isFinite(dip) && dip > 0 && Number.isFinite(costo) && costo > 0) {
        const costoPerDip = costo / dip
        if (costoPerDip < 8000) {
          console.log(
            `[COMPANY-LOOKUP] Step 6h: dipendenti SOSPETTO (${dip}) — ratio costo/dip=${costoPerDip.toFixed(0)}€/anno ` +
            `troppo bassa. Dato non plausibile, scartato. Verificare sulla visura camerale.`
          )
          delete (result as any).dipendenti
          delete (result as any).dipendenti_fonte
        }
      }
    }

    // FINAL SAFETY NET: strip hallucinated titolare
    if (result.titolare && typeof result.titolare === 'string') {
      const titStr = String(result.titolare).trim()
      const titLow = titStr.toLowerCase()
      const titWords = titStr.split(/\s+/)
      // Basic format: must be 2-5 words
      if (titWords.length < 2 || titWords.length > 5 || titStr.length > 60) {
        console.log(`[COMPANY-LOOKUP] FINAL SAFETY NET: removed malformed titolare "${titStr}"`)
        delete result.titolare; delete result.ruolo_titolare; delete result.titolare_fonte
      }
      // Must not contain legal forms (it's a person, not a company)
      else if (/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|srl|srls|spa|sas|snc|ltd|llc|gmbh)\b/i.test(titStr)) {
        console.log(`[COMPANY-LOOKUP] FINAL SAFETY NET: removed company-like titolare "${titStr}"`)
        delete result.titolare; delete result.ruolo_titolare; delete result.titolare_fonte
      }
      // Must not be a generic placeholder
      else if (/^(titolare|amministratore|rappresentante|legale|socio|presidente|direttore|responsabile|manager|ceo|cfo|cto|founder|co-?founder|owner|director)/i.test(titLow)) {
        console.log(`[COMPANY-LOOKUP] FINAL SAFETY NET: removed role-as-name titolare "${titStr}"`)
        delete result.titolare; delete result.ruolo_titolare; delete result.titolare_fonte
      }
      // Each word should have at least 2 chars (real names, not initials like "A B")
      else if (titWords.every(w => w.length < 2)) {
        console.log(`[COMPANY-LOOKUP] FINAL SAFETY NET: removed initial-only titolare "${titStr}"`)
        delete result.titolare; delete result.ruolo_titolare; delete result.titolare_fonte
      }
    }

    // FINAL SAFETY NET: strip placeholder/hallucinated PEC values
    if (result.pec && typeof result.pec === 'string') {
      const pecLocal = String(result.pec).toLowerCase().split('@')[0]
      const JUNK_PEC_LOCALS = ['yourname','tuonome','tuoindirizzo','example','test','nome','nomecognome','nomeazienda','email','admin','placeholder','xxx','abc','azienda','companyname','company','noreply','postmaster','webmaster','hostmaster','info']
      if (JUNK_PEC_LOCALS.includes(pecLocal) && !/openapi|registro/i.test(String((result as any).pec_fonte || ''))) {
        console.log(`[COMPANY-LOOKUP] FINAL SAFETY NET: removed placeholder PEC "${result.pec}"`)
        delete result.pec
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

    // ── CONFIDENCE SCORING per campo ──
    // Assegna un livello di affidabilità basato sulla fonte del dato.
    // alta  = fonte camerale/registro (ufficiocamerale, fatturatoitalia, companyreports, openapi, registro_imprese)
    // media = scraping diretto sito, Google Maps, lead-registry, Gemini con grounding
    // bassa = Tavily+GPT, AI senza conferma, fonte sconosciuta
    const ALTA_SOURCES = /fatturatoitalia|companyreports|ufficio.?camerale|openapi|registro.?imprese|ragione_sociale|camera.?commercio/i
    const MEDIA_SOURCES = /lead.?registry|google.?maps|maps|paginebianche|reteimprese|gemini|sito|website|scraping/i
    const fieldConf: Record<string, 'alta' | 'media' | 'bassa'> = {}
    const SCORED_FIELDS = [
      'ragione_sociale','partita_iva','codice_fiscale','sede_legale','citta','provincia','cap',
      'pec','email','telefono','cellulare','sito',
      'fatturato','dipendenti','utile_netto','costo_personale','capitale_sociale',
      'codice_ateco','descrizione_ateco','forma_giuridica','data_costituzione','stato_attivita',
      'titolare','ruolo_titolare',
      'linkedin','instagram','facebook','twitter','youtube',
    ]
    for (const field of SCORED_FIELDS) {
      const val = (result as any)[field]
      if (val === undefined || val === null || String(val).trim() === '') continue
      // Check if we have a _fonte indicator for this field
      const fonte = String((result as any)[`${field}_fonte`] || '').toLowerCase()
      const fontiArr = Array.isArray(result.fonti) ? (result.fonti as string[]).join(' ').toLowerCase() : ''
      if (fonte && ALTA_SOURCES.test(fonte)) {
        fieldConf[field] = 'alta'
      } else if (fonte && MEDIA_SOURCES.test(fonte)) {
        fieldConf[field] = 'media'
      } else if (fonte) {
        fieldConf[field] = 'bassa'
      } else {
        // No explicit fonte — infer from available fonti array and field type
        if (field === 'partita_iva' && result.partita_iva) {
          // P.IVA that survived FINAL GATE = at minimum media, alta if from registry
          fieldConf[field] = ALTA_SOURCES.test(fontiArr) ? 'alta' : 'media'
        } else if (field === 'ragione_sociale' && result.ragione_sociale) {
          fieldConf[field] = ALTA_SOURCES.test(fontiArr) ? 'alta' : 'media'
        } else if (['fatturato','dipendenti','utile_netto','costo_personale','capitale_sociale','codice_ateco','forma_giuridica','data_costituzione'].includes(field)) {
          // Financial/camerale fields — alta if camerale source in fonti
          fieldConf[field] = ALTA_SOURCES.test(fontiArr) ? 'alta' : (MEDIA_SOURCES.test(fontiArr) ? 'media' : 'bassa')
        } else if (['sede_legale','citta','provincia','cap'].includes(field)) {
          fieldConf[field] = ALTA_SOURCES.test(fontiArr) ? 'alta' : 'media'
        } else if (['linkedin','instagram','facebook','twitter','youtube'].includes(field)) {
          // Social URLs from website scraping = media
          fieldConf[field] = 'media'
        } else {
          fieldConf[field] = 'media'
        }
      }
    }
    result.field_confidence = fieldConf

    return NextResponse.json(result)
  }

  return NextResponse.json({ 
    error: `Nessuna azienda trovata per "${query}". Prova con la P.IVA esatta o il nome completo (es. "EDIL SMG S.R.L.S.")` 
  })
}
