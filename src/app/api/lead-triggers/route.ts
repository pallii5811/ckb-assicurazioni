import { NextRequest, NextResponse } from 'next/server'

// ── Types ──────────────────────────────────────────────────────
interface Trigger {
  type: 'hiring' | 'admin_change' | 'financial' | 'expansion' | 'risk_signal' | 'legal' | 'news'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  source: string
  date: string | null
  insuranceRelevance: string
}

// ── Helpers ──────────────────────────────────────────────────────

async function fetchSafe(url: string, options?: RequestInit, ms = 8000): Promise<Response | null> {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
  } catch {
    return null
  }
}

async function fetchHtmlSafe(url: string, ms = 6000): Promise<string> {
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
  } catch {
    return ''
  }
}

function isPlausibleItalianPersonName(value: string): boolean {
  const name = String(value || '').replace(/\s+/g, ' ').trim()
  if (!name || name.length < 5 || name.length > 60) return false
  if (/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|srl|srls|spa|sas|snc|società|societa|cooperativa|consorzio|fondazione|associazione|impresa|azienda|ditta)\b/i.test(name)) return false
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*){1,4}$/.test(name)) return false
  if (/^[a-zà-ÿ]/.test(name)) return false
  return true
}

// ── 1. Hiring signals detection (multi-source) ──────────

async function detectHiringSignals(companyName: string, city: string): Promise<Trigger[]> {
  const triggers: Trigger[] = []
  let indeedFound = false

  // Strategy 1: Direct Indeed Italia search
  try {
    const safeName = encodeURIComponent(companyName)
    const safeCity = encodeURIComponent(city)
    const indeedUrl = `https://it.indeed.com/jobs?q=${safeName}&l=${safeCity}`
    const html = await fetchHtmlSafe(indeedUrl, 8000)

    if (html.length > 5000) {
      const jobCards = (html.match(/class="job_seen_beacon"/gi) || []).length
        || (html.match(/class="resultContent"/gi) || []).length
        || (html.match(/class="tapItem"/gi) || []).length

      if (jobCards > 0) {
        indeedFound = true
        const titleMatches = html.match(/<span[^>]*title="([^"]+)"[^>]*class="[^"]*jcs-JobTitle[^"]*"/gi) || []
        const titles: string[] = []
        for (const m of titleMatches.slice(0, 5)) {
          const t = m.match(/title="([^"]+)"/i)
          if (t?.[1]) titles.push(t[1])
        }

        const severity = jobCards >= 5 ? 'high' : jobCards >= 2 ? 'medium' : 'low'
        triggers.push({
          type: 'hiring',
          severity,
          title: `${jobCards} annunci di lavoro attivi`,
          description: titles.length > 0
            ? `Posizioni aperte: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` e altri ${titles.length - 3}` : ''}`
            : `L'azienda ha ${jobCards} posizioni aperte su Indeed`,
          source: 'Indeed Italia',
          date: new Date().toISOString().split('T')[0],
          insuranceRelevance: severity === 'high'
            ? 'Forte espansione: probabile necessità di polizze D&O, RC Professionale, Infortuni dipendenti'
            : 'Crescita workforce: opportunità polizze infortuni e welfare aziendale',
        })
      }
    }
  } catch {
    // Indeed non raggiungibile
  }

  // Strategy 2: Broad Google search across job portals (fallback if Indeed empty)
  try {
    const googleQuery = encodeURIComponent(`"${companyName}" ${city} (lavoro OR assunzioni OR "posizioni aperte" OR careers OR hiring)`)
    const googleUrl = `https://www.google.com/search?q=${googleQuery}&num=10&hl=it`
    const html = await fetchHtmlSafe(googleUrl, 6000)

    // Count references to known job portals
    const jobPortalHits =
      (html.match(/indeed\.com|indeed\.it/gi) || []).length +
      (html.match(/linkedin\.com\/jobs/gi) || []).length +
      (html.match(/infojobs\.it/gi) || []).length +
      (html.match(/subito\.it\/offerte-lavoro/gi) || []).length +
      (html.match(/monster\.it/gi) || []).length +
      (html.match(/glassdoor/gi) || []).length +
      (html.match(/randstad|adecco|manpower|gi\s*group/gi) || []).length

    // Also check for career pages on company website
    const careerPageHits = (html.match(/\/careers|\/lavora-con-noi|\/posizioni-aperte|\/jobs/gi) || []).length

    const totalHits = jobPortalHits + careerPageHits

    if (totalHits >= 2 && !indeedFound) {
      const severity = totalHits >= 5 ? 'high' : totalHits >= 3 ? 'medium' : 'low'
      triggers.push({
        type: 'hiring',
        severity,
        title: `Segnali di recruiting attivo`,
        description: `Trovati ${totalHits} riferimenti ad annunci di lavoro su portali (Indeed, LinkedIn, InfoJobs, sito aziendale)`,
        source: 'Google Search (multi-portale)',
        date: new Date().toISOString().split('T')[0],
        insuranceRelevance: severity === 'high'
          ? 'Forte espansione: probabile necessità di polizze D&O, RC Professionale, Infortuni dipendenti'
          : 'Crescita workforce: opportunità polizze infortuni e welfare aziendale',
      })
    }

    // LinkedIn-specific jobs signal
    const linkedinJobCount = (html.match(/linkedin\.com\/jobs/gi) || []).length
    if (linkedinJobCount >= 2) {
      triggers.push({
        type: 'hiring',
        severity: linkedinJobCount >= 4 ? 'medium' : 'low',
        title: `Annunci LinkedIn rilevati`,
        description: `Trovati ${linkedinJobCount} riferimenti a posizioni aperte su LinkedIn`,
        source: 'LinkedIn (via Google)',
        date: new Date().toISOString().split('T')[0],
        insuranceRelevance: 'Recruiting attivo: segnale di crescita aziendale e possibile esigenza di coperture welfare',
      })
    }
  } catch {
    // Google search non raggiungibile
  }

  return triggers
}

// ── 2. Company registry changes (admin/shareholders) ─────────

async function detectRegistryChanges(companyName: string, piva: string): Promise<Trigger[]> {
  const triggers: Trigger[] = []

  if (!piva) return triggers

  // Scrape companyreports.it for admin/shareholder info
  try {
    const html = await fetchHtmlSafe(`https://www.companyreports.it/${piva}`, 10000)

    if (html.length > 5000 && !html.includes('<title>CompanyReports - Il fatturato')) {
      // Check for administrator info
      const adminMatch = html.match(/Amministratore[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
        || html.match(/(?:Amministratore|Legale Rappresentante|C\.?D\.?A\.?)[:\s]*([^<]{5,100})/i)

      if (adminMatch?.[1]) {
        const adminName = adminMatch[1].trim()
        if (isPlausibleItalianPersonName(adminName)) {
          triggers.push({
            type: 'admin_change',
            severity: 'medium',
            title: `Amministratore: ${adminName}`,
            description: `Identificato l'amministratore/legale rappresentante dell'azienda`,
            source: 'Registro Imprese',
            date: null,
            insuranceRelevance: 'Contatto diretto per proposta polizze D&O (Directors & Officers) e RC Amministratori',
          })
        }
      }

      // Check for recent changes via date patterns
      const datePatterns = html.match(/(?:iscrizione|modifica|variazione|aggiornamento|deposito)[^<]{0,80}(\d{2}[\/\-]\d{2}[\/\-]\d{4})/gi) || []
      const recentDates: string[] = []
      const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000

      for (const pattern of datePatterns) {
        const dateMatch = pattern.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/)
        if (dateMatch) {
          const [, day, month, year] = dateMatch
          const d = new Date(`${year}-${month}-${day}`)
          if (d.getTime() > sixMonthsAgo) {
            recentDates.push(`${day}/${month}/${year}`)
          }
        }
      }

      if (recentDates.length > 0) {
        triggers.push({
          type: 'admin_change',
          severity: 'high',
          title: `Variazione camerale recente`,
          description: `Rilevate ${recentDates.length} modifiche recenti al Registro Imprese (ultima: ${recentDates[0]})`,
          source: 'Registro Imprese',
          date: recentDates[0] || null,
          insuranceRelevance: 'Cambio societario/amministrativo: momento ideale per revisione polizze e nuove coperture',
        })
      }

      // Check capital changes
      const capitalChange = html.match(/(?:aumento|riduzione|variazione)\s*(?:del\s*)?capitale[^<]{0,120}/i)
      if (capitalChange) {
        triggers.push({
          type: 'financial',
          severity: 'high',
          title: 'Variazione capitale sociale',
          description: capitalChange[0].trim().substring(0, 120),
          source: 'Registro Imprese',
          date: null,
          insuranceRelevance: 'Variazione patrimoniale: necessità aggiornamento polizze Property, D&O e cauzioni',
        })
      }

      // Check for multiple shareholders (SRL with soci)
      const sociCount = (html.match(/(?:socio|azionista|titolare)[^<]{2,80}/gi) || []).length
      if (sociCount >= 2) {
        triggers.push({
          type: 'admin_change',
          severity: 'low',
          title: `${sociCount} soci/azionisti rilevati`,
          description: 'Struttura societaria con più soci: potenziale necessità polizze Key Man e patti parasociali',
          source: 'Registro Imprese',
          date: null,
          insuranceRelevance: 'Polizze Key Man, patti parasociali, coperture RC per i singoli soci',
        })
      }
    }
  } catch {
    // companyreports non raggiungibile
  }

  return triggers
}

// ── 3. Financial triggers (revenue changes, new filings) ─────

async function detectFinancialTriggers(
  companyName: string,
  piva: string,
  fatturato: string | null,
  dipendenti: string | null,
  formaGiuridica: string | null,
): Promise<Trigger[]> {
  const triggers: Trigger[] = []

  // Parse fatturato for threshold-based triggers
  if (fatturato) {
    const numStr = fatturato.replace(/[€.\s]/g, '').replace(',', '.')
    const value = parseFloat(numStr)
    if (!isNaN(value)) {
      if (value > 10_000_000) {
        triggers.push({
          type: 'financial',
          severity: 'high',
          title: 'Azienda sopra 10M€ di fatturato',
          description: `Fatturato: €${fatturato} - Azienda di dimensione rilevante`,
          source: 'Bilancio depositato',
          date: null,
          insuranceRelevance: 'Valutare programma assicurativo strutturato: D&O, property, cyber e RC specifiche in base all’attività',
        })
      } else if (value > 2_000_000) {
        triggers.push({
          type: 'financial',
          severity: 'medium',
          title: 'Azienda medio-grande (>2M€)',
          description: `Fatturato: €${fatturato}`,
          source: 'Bilancio depositato',
          date: null,
          insuranceRelevance: 'Dimensione adeguata per polizze RC, D&O, Cyber Risk e property strutturate',
        })
      }
    }
  }

  // Employee count triggers
  if (dipendenti) {
    const empNum = parseInt(dipendenti.replace(/[^\d]/g, ''), 10)
    if (!isNaN(empNum)) {
      if (empNum >= 50) {
        triggers.push({
          type: 'expansion',
          severity: 'high',
          title: `${empNum}+ dipendenti`,
          description: 'Azienda con organico significativo',
          source: 'Registro Imprese',
          date: null,
          insuranceRelevance: 'Necessità polizze Infortuni collettive, welfare aziendale, TFR, fondo pensione',
        })
      } else if (empNum >= 15) {
        triggers.push({
          type: 'expansion',
          severity: 'medium',
          title: `${empNum} dipendenti`,
          description: 'PMI con organico in potenziale crescita',
          source: 'Registro Imprese',
          date: null,
          insuranceRelevance: 'Polizze Infortuni, RC verso terzi e dipendenti, welfare base',
        })
      }
    }
  }

  // Legal form triggers
  if (formaGiuridica) {
    const fg = formaGiuridica.toUpperCase()
    if (fg.includes('SPA') || fg.includes('S.P.A')) {
      triggers.push({
        type: 'legal',
        severity: 'medium',
        title: 'Società per Azioni',
        description: 'Forma giuridica S.p.A.: governance più strutturata e maggiore esposizione degli organi sociali',
        source: 'Registro Imprese',
        date: null,
        insuranceRelevance: 'D&O fortemente raccomandata per CdA e dirigenti; valutare anche RC organi sociali e cauzioni se pertinenti',
      })
    }
  }

  return triggers
}

// ── 4. Google News triggers ──────────────────────────────────

async function detectNewsTriggers(companyName: string, city: string): Promise<Trigger[]> {
  const triggers: Trigger[] = []

  try {
    const query = encodeURIComponent(`"${companyName}" ${city}`)
    const url = `https://news.google.com/rss/search?q=${query}&hl=it&gl=IT&ceid=IT:it`
    const res = await fetchSafe(url, {
      headers: { Accept: 'application/xml, text/xml' },
    }, 6000)

    if (res?.ok) {
      const xml = await res.text()
      const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || []

      for (const item of items.slice(0, 3)) {
        const titleM = item.match(/<title><!\[CDATA\[(.*?)\]\]>/i) || item.match(/<title>(.*?)<\/title>/i)
        const pubDateM = item.match(/<pubDate>(.*?)<\/pubDate>/i)
        const title = titleM?.[1] || ''

        if (!title) continue

        // Check for insurance-relevant keywords
        const lc = title.toLowerCase()
        let severity: 'high' | 'medium' | 'low' = 'low'
        let relevance = 'Notizia pubblica: possibile spunto per contatto commerciale'

        if (/incendio|alluvione|sisma|terremoto|esplosione|crollo|danno|incidente|infortunio/i.test(lc)) {
          severity = 'high'
          relevance = 'Evento dannoso: forte bisogno assicurativo immediato, proporre coperture specifiche'
        } else if (/acquisizione|fusione|merger|cessione|vendita|ipo|quotazione/i.test(lc)) {
          severity = 'high'
          relevance = 'Operazione M&A: necessità revisione totale programma assicurativo'
        } else if (/espansione|apertura|inaugurazione|nuovo stabilimento|nuova sede/i.test(lc)) {
          severity = 'medium'
          relevance = 'Espansione aziendale: nuovi beni da assicurare, nuove polizze property'
        } else if (/premio|riconoscimento|crescita|record|fatturato/i.test(lc)) {
          severity = 'medium'
          relevance = 'Crescita aziendale: momento favorevole per proposta assicurativa'
        } else if (/causa|tribunale|multa|sanzione|contenzioso|sequestro/i.test(lc)) {
          severity = 'high'
          relevance = 'Contenzioso legale: necessità polizze Tutela Legale, D&O, RC Professionale'
        }

        let dateStr: string | null = null
        if (pubDateM?.[1]) {
          try {
            dateStr = new Date(pubDateM[1]).toISOString().split('T')[0]
          } catch { /* ignore */ }
        }

        triggers.push({
          type: 'news',
          severity,
          title: title.substring(0, 120),
          description: `Notizia trovata su Google News`,
          source: 'Google News',
          date: dateStr,
          insuranceRelevance: relevance,
        })
      }
    }
  } catch {
    // Google News non raggiungibile
  }

  return triggers
}

// ── 5. GPT-based risk analysis trigger ───────────────────────

async function detectAITriggers(
  companyName: string,
  category: string,
  city: string,
  fatturato: string | null,
  dipendenti: string | null,
): Promise<Trigger[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !category) return []

  try {
    const prompt = `Sei un underwriter assicurativo senior in Italia. Analizza i dati reali di questa azienda e genera SOLO rischi verificabili.

DATI REALI DELL'AZIENDA:
- Ragione sociale: ${companyName}
- Settore (Google Maps): ${category}
- Città sede legale: ${city}
${fatturato ? `- Fatturato ultimo bilancio depositato: €${fatturato}` : '- Fatturato: non disponibile nel bilancio'}
${dipendenti ? `- Dipendenti (Registro Imprese): ${dipendenti}` : '- Dipendenti: dato non disponibile'}

REGOLE TASSATIVE — LEGGI ATTENTAMENTE:
1. NON INVENTARE MAI statistiche, percentuali o dati che non puoi verificare (es. "il 30% delle imprese...")
2. NON INVENTARE norme o leggi. Cita SOLO riferimenti normativi REALI che conosci con certezza (es. D.Lgs. 81/2008, L. 24/2017)
3. Basa OGNI trigger su uno dei dati reali forniti sopra (fatturato, dipendenti, città, settore)
4. Per i massimali, usa le formule standard del mercato italiano:
   - RC Terzi: minimo 2x fatturato annuo o min €500.000
   - Infortuni: €100.000 morte + €150.000 invalidità per dipendente
   - D&O: minimo patrimonio netto aziendale
   - Incendio: valore ricostruzione stimato
5. Per il rischio territoriale, cita SOLO eventi documentati (es. alluvione Genova 2014, terremoto L'Aquila 2009)
6. Se un dato non è disponibile, NON fare ipotesi — scrivi "dato non disponibile, da verificare"
7. Massimo 3 trigger, solo quelli con ALTA probabilità di essere rilevanti per QUESTA azienda

Rispondi SOLO con JSON valido: {"triggers": [...]}
Ogni trigger:
{
  "type": "risk_signal",
  "severity": "high"|"medium"|"low",
  "title": "titolo specifico (max 80 char)",
  "description": "analisi basata SOLO sui dati reali forniti sopra, con calcoli verificabili",
  "insuranceRelevance": "polizza specifica + massimale calcolato dai dati reali"
}`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20000),
    })

    const data = (await res.json()) as any
    const content = data?.choices?.[0]?.message?.content || '[]'
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim())
    const items = Array.isArray(parsed) ? parsed : parsed.triggers || parsed.data || []

    return items.slice(0, 3).map((t: any) => ({
      type: t.type || 'risk_signal',
      severity: ['high', 'medium', 'low'].includes(t.severity) ? t.severity : 'medium',
      title: String(t.title || '').substring(0, 120),
      description: String(t.description || '').substring(0, 250),
      source: 'AI Risk Analysis',
      ai_generated: true,
      date: new Date().toISOString().split('T')[0],
      insuranceRelevance: String(t.insuranceRelevance || '').substring(0, 200),
    }))
  } catch {
    return []
  }
}

// ── Main route ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead, registry } = body

  const companyName = lead?.nome || lead?.azienda || lead?.business_name || ''
  const city = lead?.citta || lead?.city || ''
  const category = lead?.categoria || lead?.category || ''
  const piva = registry?.partita_iva || lead?.partita_iva || ''
  const fatturato = registry?.fatturato || lead?.fatturato || null
  const dipendenti = registry?.dipendenti || lead?.dipendenti || null
  const formaGiuridica = registry?.forma_giuridica || lead?.forma_giuridica || null

  if (!companyName) {
    return NextResponse.json({ triggers: [], error: 'Nome azienda mancante' })
  }

  // Run all detection in parallel
  const [hiring, registryChanges, financial, news, ai] = await Promise.allSettled([
    detectHiringSignals(companyName, city),
    detectRegistryChanges(companyName, piva),
    detectFinancialTriggers(companyName, piva, fatturato, dipendenti, formaGiuridica),
    detectNewsTriggers(companyName, city),
    detectAITriggers(companyName, category, city, fatturato, dipendenti),
  ])

  const allTriggers: Trigger[] = [
    ...(hiring.status === 'fulfilled' ? hiring.value : []),
    ...(registryChanges.status === 'fulfilled' ? registryChanges.value : []),
    ...(financial.status === 'fulfilled' ? financial.value : []),
    ...(news.status === 'fulfilled' ? news.value : []),
    ...(ai.status === 'fulfilled' ? ai.value : []),
  ]

  // Sort: high first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 }
  allTriggers.sort((a, b) => order[a.severity] - order[b.severity])

  // Summary stats
  const highCount = allTriggers.filter(t => t.severity === 'high').length
  const mediumCount = allTriggers.filter(t => t.severity === 'medium').length

  return NextResponse.json({
    triggers: allTriggers,
    summary: {
      total: allTriggers.length,
      high: highCount,
      medium: mediumCount,
      low: allTriggers.length - highCount - mediumCount,
      riskLevel: highCount >= 3 ? 'critical' : highCount >= 1 ? 'high' : mediumCount >= 2 ? 'medium' : 'low',
    },
    timestamp: new Date().toISOString(),
  })
}
