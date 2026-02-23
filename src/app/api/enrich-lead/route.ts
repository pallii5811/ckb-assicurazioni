import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null
  const urlRaw = typeof body?.url === 'string' ? body.url.trim() : ''

  if (!urlRaw) {
    return NextResponse.json({ error: 'URL mancante' }, { status: 400 })
  }

  const url = urlRaw.startsWith('http://') || urlRaw.startsWith('https://') ? urlRaw : `https://${urlRaw}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MiraX/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    clearTimeout(timeout)

    const html = await response.text()

    const linkedinMatch = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-_]+/i)
    const instagramMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9\-_.]+/i)
    const facebookMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9\-_.]+/i)

    const pivaMatch = html.match(/(?:P\.?\s*IVA|Partita\s*IVA|VAT)[:\s]*([0-9]{11})/i)
    const annoMatch = html.match(/(?:dal|since|founded|©)\s*(19[0-9]{2}|20[0-2][0-9])/i)

    return NextResponse.json({
      linkedin_url: linkedinMatch?.[0] || null,
      instagram_url: instagramMatch?.[0] || null,
      facebook_url: facebookMatch?.[0] || null,
      partita_iva: pivaMatch?.[1] || null,
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
