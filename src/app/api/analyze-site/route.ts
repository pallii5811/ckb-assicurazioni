import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL mancante' }, { status: 400 })
    }

    // Normalize URL
    let normalizedUrl = url.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    const res = await fetch('http://116.203.137.39:8001/audit-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: normalizedUrl }),
      signal: AbortSignal.timeout(120000), // 2 min timeout
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Backend error: ${res.status} ${text}` },
        { status: 502 }
      )
    }

    const data = await res.json()
    return NextResponse.json({ success: true, lead: data })
  } catch (e: any) {
    console.error('[analyze-site] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Errore durante l\'analisi del sito' },
      { status: 500 }
    )
  }
}
