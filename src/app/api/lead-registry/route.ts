import { NextRequest, NextResponse } from 'next/server'
import { getTerritorialRisk } from '@/lib/territorial-risk'
import { getAtecoInsurance } from '@/lib/ateco-insurance'
import { classifyCompanySize, estimateAnnualPremium, analyzeInsuranceGaps } from '@/lib/insurance-analysis'
import { buildInsuranceNeedsProfile } from '@/lib/insurance-needs-engine'

const BACKEND_URL = process.env.BACKEND_URL || 'http://46.225.189.40:8001'
const OPENAPI_IT_TOKEN = process.env.OPENAPI_IT_TOKEN || ''

// ── Helpers ──────────────────────────────────────────────────────

function extractFormaGiuridica(name: string): string | null {
  const n = name.toLowerCase()
  if (/\bs\.?r\.?l\.?s?\b/.test(n) || n.includes('srls')) return n.includes('srls') ? 'SRLS' : 'SRL'
  if (/\bs\.?p\.?a\.?\b/.test(n)) return 'SPA'
  if (/\bs\.?n\.?c\.?\b/.test(n)) return 'SNC'
  if (/\bs\.?a\.?s\.?\b/.test(n)) return 'SAS'
  if (/\bs\.?s\.?\b/.test(n) && !n.includes('ss.')) return 'SS'
  return null
}

const PIVA_RE = [
  /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /\bIT(\d{11})\b/g,
]

function extractPivaFromHtml(html: string): string | null {
  for (const re of PIVA_RE) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m?.[1]) return m[1]
  }
  const area = html.match(/(?:P\.?\s*I\.?V\.?A|Partita\s*IVA|codice\s*fiscale).{0,100}/gi)
  if (area) {
    for (const a of area) {
      const d = a.match(/\b(\d{11})\b/)
      if (d?.[1]) return d[1]
    }
  }
  return null
}

async function fetchHtmlSafe(url: string, ms = 5000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    })
    return await res.text()
  } catch { return '' }
}

// ── VIES: official EU P.IVA verification ─────────────────────────
async function verifyPivaVies(piva: string): Promise<{
  valid: boolean; name?: string; address?: string
} | null> {
  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/${piva}`,
      { signal: AbortSignal.timeout(6000) }
    )
    const d = (await res.json()) as any
    if (d?.isValid) {
      return {
        valid: true,
        name: typeof d.name === 'string' && d.name !== '---' ? d.name.trim() : undefined,
        address: typeof d.address === 'string' && d.address !== '---' ? d.address.trim() : undefined,
      }
    }
    return { valid: false }
  } catch { return null }
}

// ── CompanyReports.it: FREE real company data (fatturato, dipendenti) ──
async function scrapeCompanyReports(piva: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`https://www.companyreports.it/${piva}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 5000) return null // not a company page
    // Detect homepage (company not found → redirects to homepage)
    if (html.includes('<title>CompanyReports - Il fatturato')) return null

    const result: Record<string, string> = {}

    // Meta description: "Company Fatturato 2.630.757.873, Partita Iva: ..., Cod. Ateco 10.73"
    const meta = html.match(/meta name="description" content="([^"]+)"/i)
    if (meta) {
      const desc = meta[1]
      const fatM = desc.match(/Fatturato\s+([\d.,]+)/i)
      if (fatM) result.fatturato = fatM[1].replace(/,+$/, '').trim()
      const ateM = desc.match(/Ateco\s+([\d.]+)/i)
      if (ateM) result.codice_ateco = ateM[1].replace(/\.+$/, '').trim()
    }

    // JSON-LD FAQ structured data (has dipendenti, sede legale, costo personale)
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
            else {
              const m2 = a.match(/(\d+)\s*dipendenti/i) || a.match(/pari a\s*(\d+)/i)
              if (m2) result.dipendenti = m2[1]
            }
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

    // HTML table: Stato Attività, Forma Giuridica, N. Dipendenti
    const statoM = html.match(/Stato Attivit[àa]<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (statoM) result.stato = statoM[1].trim()
    const formaM = html.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (formaM) result.forma_giuridica = formaM[1].trim()
    // Dipendenti from HTML table if not from JSON-LD
    if (!result.dipendenti) {
      const dipM = html.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
      if (dipM) result.dipendenti = dipM[1].trim()
    }

    // Ragione sociale from title
    const titleM = html.match(/<title>([^(<]+)/i)
    if (titleM) result.ragione_sociale = titleM[1].replace(/\s*Fatturato.*$/i, '').trim()

    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── OpenAPI.it IT-advanced: PAID real data from Camera di Commercio ──
interface OpenApiCompany {
  companyName?: string
  vatCode?: string
  address?: {
    registeredOffice?: {
      streetName?: string
      town?: string
      province?: string
      zipCode?: string
    }
  }
  activityStatus?: string
  reaCode?: string
  cciaa?: string
  atecoClassification?: {
    ateco2007?: { code?: string; description?: string }
  }
  detailedLegalForm?: { description?: string }
  startDate?: string
  pec?: string
  balanceSheets?: {
    last?: {
      year?: number
      employees?: number
      turnover?: number
      shareCapital?: number
      totalStaffCost?: number
    }
  }
}

async function fetchOpenApiIt(piva: string): Promise<Record<string, any> | null> {
  if (!OPENAPI_IT_TOKEN) return null
  try {
    const res = await fetch(`https://company.openapi.com/IT-advanced/${piva}`, {
      headers: {
        Authorization: `Bearer ${OPENAPI_IT_TOKEN}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as any
    if (!json?.success || !json?.data?.[0]) return null
    const c: OpenApiCompany = json.data[0]

    const result: Record<string, any> = {}
    if (c.companyName) result.ragione_sociale = c.companyName
    if (c.vatCode) result.partita_iva = c.vatCode

    // Sede legale
    const off = c.address?.registeredOffice
    if (off?.streetName) {
      result.sede_legale = [off.streetName, off.zipCode, off.town, off.province]
        .filter(Boolean).join(', ')
    }

    // ATECO
    const ateco = c.atecoClassification?.ateco2007
    if (ateco?.code) {
      result.codice_ateco = ateco.code
      if (ateco.description) result.descrizione_ateco = ateco.description
    }

    // Forma giuridica
    if (c.detailedLegalForm?.description) result.forma_giuridica = c.detailedLegalForm.description

    // Stato
    if (c.activityStatus) result.stato = c.activityStatus === 'ATTIVA' ? 'Attiva' : c.activityStatus

    // REA
    if (c.reaCode && c.cciaa) result.codice_rea = `${c.cciaa} ${c.reaCode}`

    // PEC
    if (c.pec) result.pec = c.pec

    // Data costituzione
    if (c.startDate) result.data_costituzione = c.startDate

    // Bilancio (fatturato, dipendenti, capitale)
    const bs = c.balanceSheets?.last
    if (bs) {
      if (bs.turnover) {
        result.fatturato = new Intl.NumberFormat('it-IT').format(bs.turnover)
        result.fatturato_anno = String(bs.year || '')
        result.fatturato_fonte = 'registro_imprese'
      }
      if (bs.employees) {
        result.dipendenti = String(bs.employees)
        result.dipendenti_fonte = 'registro_imprese'
      }
      if (bs.shareCapital) {
        result.capitale_sociale = '€ ' + new Intl.NumberFormat('it-IT').format(bs.shareCapital)
      }
      if (bs.totalStaffCost) {
        result.costo_personale = new Intl.NumberFormat('it-IT').format(bs.totalStaffCost)
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── Main route ───────────────────────────────────────────────────

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

  // ─── Step 1: Try backend for REAL Registro Imprese data ────────
  let backendData: Record<string, any> | null = null
  try {
    const res = await fetch(`${BACKEND_URL}/scrape-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name, city, website }),
      signal: AbortSignal.timeout(25000),
    })
    const data = (await res.json()) as any

    if (data?.found === true) {
      if (!data.sede_legale && address) data.sede_legale = address
      data.fonte = 'registro_imprese'
      // If we already have fatturato AND dipendenti, return immediately
      if (data.fatturato && data.dipendenti) {
        return NextResponse.json(data)
      }
      // Otherwise save and continue to supplement with CompanyReports.it
      backendData = data
    }
  } catch {
    // Backend non disponibile, continua
  }

  // ─── Step 2: Extract P.IVA from company website ───────────────
  // SKIP if website is a third-party platform (miodottore.it, paginegialle.it, etc.)
  // — the P.IVA on those pages belongs to the PLATFORM, not the business
  const PLATFORM_DOMAINS = ['miodottore.it','doctolib.it','paginegialle.it','paginebianche.it','tuttocitta.it','yelp.com','yelp.it','tripadvisor.it','tripadvisor.com','booking.com','airbnb.it','airbnb.com','subito.it','immobiliare.it','idealista.it','linkedin.com','facebook.com','instagram.com','youtube.com','twitter.com','tiktok.com','trustpilot.com','google.com','europages.it','kompass.com','hotfrog.it','cylex.it','virgilio.it','wix.com','wordpress.com','jimdo.com','weebly.com','shopify.com','etsy.com','amazon.it','amazon.com','ebay.it','ebay.com','topdoctors.it','dottori.it','medicitalia.it','pazienti.it','guidadottori.it','thefork.it','justeat.it','deliveroo.it','glovo.com','matrimonio.com']
  const isThirdPartyPlatform = (() => {
    if (!website) return false
    try {
      const hostname = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '')
      return PLATFORM_DOMAINS.some(p => hostname === p || hostname.endsWith(`.${p}`))
    } catch { return false }
  })()

  let websitePiva: string | null = null
  // If backend already found a P.IVA, use it as fallback
  if (backendData?.partita_iva) {
    websitePiva = String(backendData.partita_iva).replace(/^IT\s*/, '').trim()
  }
  if (website && !isThirdPartyPlatform) {
    const baseUrl = website.startsWith('http') ? website : `https://${website}`
    const origin = (() => { try { return new URL(baseUrl).origin } catch { return baseUrl } })()
    const mainHtml = await fetchHtmlSafe(baseUrl, 6000)
    const sitePiva = extractPivaFromHtml(mainHtml)
    if (sitePiva) websitePiva = sitePiva
    if (!websitePiva) {
      const pages = ['/contatti', '/contacts', '/privacy', '/privacy-policy', '/chi-siamo']
      const fetches = await Promise.allSettled(pages.slice(0, 3).map(p => fetchHtmlSafe(`${origin}${p}`, 4000)))
      for (const r of fetches) {
        if (r.status === 'fulfilled' && r.value) {
          const found = extractPivaFromHtml(r.value)
          if (found) { websitePiva = found; break }
        }
      }
    }
  }

  // ─── Step 2b: Google Search fallback for P.IVA by company name ──
  if (!websitePiva && business_name) {
    try {
      const cleanName = business_name.replace(/['"]/g, '').trim()
      const googleQuery = encodeURIComponent(`"${cleanName}" "partita iva" ${city}`)
      const googleHtml = await fetchHtmlSafe(`https://www.google.com/search?q=${googleQuery}&num=5&hl=it`, 6000)
      if (googleHtml.length > 2000) {
        // Look for 11-digit P.IVA patterns in search results
        const pivaMatches = googleHtml.match(/\b(\d{11})\b/g) || []
        // Validate: must start with valid Italian P.IVA prefix and appear near "partita iva" or "P.IVA"
        for (const candidate of pivaMatches) {
          // Skip obviously fake ones (all zeros, all same digit)
          if (/^(\d)\1{10}$/.test(candidate)) continue
          if (candidate.startsWith('0000')) continue
          // Verify via VIES before using
          const check = await verifyPivaVies(candidate)
          if (check?.valid) {
            websitePiva = candidate
            break
          }
        }
      }
    } catch { /* Google non raggiungibile */ }
  }

  // ─── Step 2c: CompanyReports.it search by name fallback ──
  if (!websitePiva && business_name) {
    try {
      const searchName = encodeURIComponent(business_name.replace(/['"]/g, '').trim())
      const searchHtml = await fetchHtmlSafe(`https://www.companyreports.it/search?q=${searchName}`, 8000)
      if (searchHtml.length > 3000) {
        // Extract P.IVA from search results links (format: /12345678901)
        const linkMatches = searchHtml.match(/href="\/(\d{11})"/g) || []
        if (linkMatches.length > 0 && linkMatches[0]) {
          const firstPiva = linkMatches[0].match(/(\d{11})/)?.[1]
          if (firstPiva) {
            websitePiva = firstPiva
          }
        }
      }
    } catch { /* CompanyReports search non raggiungibile */ }
  }

  // ─── Step 3: VIES verification (official EU registry) ─────────
  let viesData: { valid: boolean; name?: string; address?: string } | null = null
  if (websitePiva) {
    viesData = await verifyPivaVies(websitePiva)
  }

  // ─── Step 4: Scrape companyreports.it for REAL data (gratis) ───
  let crData: Record<string, string> | null = null
  if (websitePiva) {
    crData = await scrapeCompanyReports(websitePiva)
  }

  // ─── Step 4b: OpenAPI.it fallback (PAID, finds all SRL/SPA) ────
  let oaData: Record<string, any> | null = null
  if (websitePiva && (!crData?.fatturato || !crData?.codice_ateco)) {
    oaData = await fetchOpenApiIt(websitePiva)
  }

  // ─── Step 5: Build profile from REAL verified sources ─────────
  const formaFromName = extractFormaGiuridica(business_name)

  const profile: Record<string, any> = {
    found: true,
    fonte: 'google_maps',
  }

  // Merge: backendData (base) < OpenAPI.it (paid) < companyreports (free) — later wins
  const src = { ...backendData, ...oaData, ...crData } as Record<string, any>

  // Ragione sociale
  profile.ragione_sociale = src.ragione_sociale || viesData?.name || business_name

  // Sede legale
  if (src.sede_legale) {
    profile.sede_legale = src.sede_legale
  } else if (viesData?.address) {
    profile.sede_legale = viesData.address
    profile.sede_legale_verificata = true
  } else if (address) {
    profile.sede_legale = address
  }

  // P.IVA from website (REAL)
  if (websitePiva) {
    profile.partita_iva = websitePiva
    if (viesData?.valid) {
      profile.piva_verificata = true
      profile.fonte = 'vies_verificato'
    }
  }

  // Forma giuridica: merged sources > name extraction
  if (src.forma_giuridica) {
    profile.forma_giuridica = src.forma_giuridica
  } else if (formaFromName) {
    profile.forma_giuridica = formaFromName
  }

  // REAL fatturato & dipendenti — track exact source
  if (crData?.fatturato) {
    profile.fatturato = crData.fatturato
    if (crData.fatturato_anno) profile.fatturato_anno = crData.fatturato_anno
    profile.fatturato_fonte = 'companyreports.it'
  } else if (oaData?.fatturato) {
    profile.fatturato = oaData.fatturato
    if (oaData.fatturato_anno) profile.fatturato_anno = oaData.fatturato_anno
    profile.fatturato_fonte = 'openapi.it'
  } else if (backendData?.fatturato) {
    profile.fatturato = backendData.fatturato
    if (backendData.fatturato_anno) profile.fatturato_anno = backendData.fatturato_anno
    profile.fatturato_fonte = 'registro_imprese'
  }
  if (crData?.dipendenti) {
    profile.dipendenti = crData.dipendenti
    profile.dipendenti_fonte = 'companyreports.it'
  } else if (oaData?.dipendenti) {
    profile.dipendenti = oaData.dipendenti
    profile.dipendenti_fonte = 'openapi.it'
  } else if (backendData?.dipendenti) {
    profile.dipendenti = backendData.dipendenti
    profile.dipendenti_fonte = 'registro_imprese'
  }
  if (src.costo_personale) profile.costo_personale = src.costo_personale
  if (src.capitale_sociale) profile.capitale_sociale = src.capitale_sociale

  // ATECO (REAL)
  if (src.codice_ateco) {
    profile.codice_ateco = src.codice_ateco
    if (src.descrizione_ateco) profile.descrizione_ateco = src.descrizione_ateco
    profile.fonte = 'registro_imprese'
  }

  // Extra fields from OpenAPI.it
  if (src.codice_rea) profile.codice_rea = src.codice_rea
  if (src.pec) profile.pec = src.pec
  if (src.data_costituzione) profile.data_costituzione = src.data_costituzione

  if (src.stato) profile.stato = src.stato

  // ─── Step 6: GPT ONLY for ATECO if not found from real sources
  if (!profile.codice_ateco) {
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey && category) {
      try {
        const prompt = `Basandoti ESCLUSIVAMENTE sulla categoria Google Maps "${category}", qual è il codice ATECO più appropriato?
${!formaFromName ? `Stima anche la forma giuridica più probabile per "${business_name}".` : ''}
Rispondi SOLO con JSON: {"codice_ateco":"XX.XX.XX","descrizione_ateco":"descrizione"${!formaFromName ? ',"forma_giuridica":"..."' : ''}}`

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(8000),
        })

        const data = (await res.json()) as any
        const content = data?.choices?.[0]?.message?.content || '{}'
        const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

        if (parsed.codice_ateco) {
          profile.codice_ateco = parsed.codice_ateco
          if (parsed.descrizione_ateco) profile.descrizione_ateco = parsed.descrizione_ateco
          profile.ateco_stimato = true
        }
        if (!formaFromName && !profile.forma_giuridica && parsed.forma_giuridica) {
          profile.forma_giuridica = parsed.forma_giuridica
        }
      } catch {
        // GPT non disponibile
      }
    }
  }

  // ─── Step 7: Rischio Territoriale (GRATIS — dati Protezione Civile) ──
  const cityForRisk = city || profile.sede_legale || ''
  if (cityForRisk) {
    const territorial = getTerritorialRisk(cityForRisk)
    if (territorial.zona_sismica) {
      profile.rischio_territoriale = territorial
    }
  }

  // ─── Step 8: Obblighi Assicurativi ATECO (GRATIS — normativa INAIL/IVASS) ──
  const atecoIns = getAtecoInsurance(profile.codice_ateco || null, category || null)
  if (atecoIns) {
    profile.obblighi_assicurativi = atecoIns
  }

  // ─── Step 9: Classificazione dimensionale EU + Gap Analysis + Stima Premi ──
  const parseFatturato = (f: any): number | null => {
    if (!f) return null
    const n = Number(String(f).replace(/[^\d]/g, ''))
    return isNaN(n) || n === 0 ? null : n
  }
  const parseDipendenti = (d: any): number | null => {
    if (!d) return null
    const s = String(d).match(/\d+/)
    return s ? parseInt(s[0], 10) : null
  }

  const fatNum = parseFatturato(profile.fatturato)
  const dipNum = parseDipendenti(profile.dipendenti)

  // Classificazione dimensionale
  profile.classificazione_eu = classifyCompanySize(fatNum, dipNum)

  // Insurance Gap Analysis
  profile.gap_analysis = analyzeInsuranceGaps(
    fatNum,
    dipNum,
    profile.forma_giuridica || null,
    profile.codice_ateco || null,
    category || null,
    profile.rischio_territoriale?.zona_sismica || null,
    profile.rischio_territoriale?.rischio_idrogeologico || null,
    !!(profile.pec),
    !!website,
  )

  // Stima premio annuale
  profile.stima_premio = estimateAnnualPremium(
    fatNum,
    dipNum,
    atecoIns?.classe_inail || null,
    profile.rischio_territoriale?.zona_sismica || null,
    atecoIns?.settore || null,
  )

  profile.bisogni_assicurativi_verificati = buildInsuranceNeedsProfile({
    profile,
    category: category || null,
    website: website || null,
    atecoInsurance: atecoIns || null,
    gapAnalysis: profile.gap_analysis || null,
  })

  // Rimuovi campi null/vuoti
  for (const key of Object.keys(profile)) {
    if (profile[key] === null || profile[key] === '') delete profile[key]
  }

  return NextResponse.json(profile)
}
