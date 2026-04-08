import { NextRequest, NextResponse } from 'next/server'

// ── P.IVA extraction with multiple patterns ──────────────────────
const PIVA_PATTERNS: RegExp[] = [
  /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA|P\.?\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:Codice\s*Fiscale\s*(?:e\s*)?Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:VAT\s*(?:number|n\.?|ID)?)[:\s]*IT[\s]?(\d{11})/gi,
  /\bIT(\d{11})\b/g,
]

function extractPIVA(html: string): string | null {
  for (const pattern of PIVA_PATTERNS) {
    pattern.lastIndex = 0
    const match = pattern.exec(html)
    if (match?.[1]) return match[1]
  }
  // Fallback: look for 11-digit number near P.IVA text (within 100 chars)
  const pivaAreaMatch = html.match(/(?:P\.?\s*I\.?V\.?A|Partita\s*IVA|codice\s*fiscale).{0,100}/gi)
  if (pivaAreaMatch) {
    for (const area of pivaAreaMatch) {
      const digits = area.match(/\b(\d{11})\b/)
      if (digits?.[1]) return digits[1]
    }
  }
  return null
}

// ── Fetch a page safely ──────────────────────────────────────────
async function fetchPage(url: string, timeoutMs = 6000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    })
    clearTimeout(timer)
    return await res.text()
  } catch {
    clearTimeout(timer)
    return ''
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null
  const urlRaw = typeof body?.url === 'string' ? body.url.trim() : ''

  if (!urlRaw) {
    return NextResponse.json({ error: 'URL mancante' }, { status: 400 })
  }

  const baseUrl = urlRaw.startsWith('http://') || urlRaw.startsWith('https://') ? urlRaw : `https://${urlRaw}`
  const origin = (() => { try { return new URL(baseUrl).origin } catch { return baseUrl } })()

  try {
    // Fetch main page
    const mainHtml = await fetchPage(baseUrl, 8000)
    if (!mainHtml) throw new Error('Sito non raggiungibile')

    // Extract social links from main page
    const linkedinMatch = mainHtml.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-_]+/i)
    const instagramMatch = mainHtml.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9\-_.]+/i)
    const facebookMatch = mainHtml.match(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9\-_.]+/i)

    let partitaIva = extractPIVA(mainHtml)
    const annoMatch = mainHtml.match(/(?:dal|since|founded|©)\s*(19[0-9]{2}|20[0-2][0-9])/i)

    // If P.IVA not found on main page, try footer-linked pages
    if (!partitaIva) {
      const subPages = [
        '/contatti', '/contacts', '/chi-siamo', '/about', '/about-us',
        '/privacy', '/privacy-policy', '/note-legali', '/legal',
        '/cookie-policy', '/termini', '/terms',
      ]
      // Fetch up to 3 sub-pages in parallel for speed
      const pagesToTry = subPages.slice(0, 4)
      const subResults = await Promise.allSettled(
        pagesToTry.map((path) => fetchPage(`${origin}${path}`, 5000))
      )
      for (const r of subResults) {
        if (r.status === 'fulfilled' && r.value) {
          const found = extractPIVA(r.value)
          if (found) { partitaIva = found; break }
        }
      }
    }

    return NextResponse.json({
      linkedin_url: linkedinMatch?.[0] || null,
      instagram_url: instagramMatch?.[0] || null,
      facebook_url: facebookMatch?.[0] || null,
      partita_iva: partitaIva || null,
      anno_fondazione: annoMatch?.[1] || null,
      dipendenti_stimati: null,
    })
  } catch {
    return NextResponse.json({
      linkedin_url: null,
      instagram_url: null,
      facebook_url: null,
      partita_iva: null,
      anno_fondazione: null,
      dipendenti_stimati: null,
      error: 'Sito non raggiungibile',
    })
  }
}
