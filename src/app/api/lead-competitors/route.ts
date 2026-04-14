import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead, searchCategory } = body

  const category = searchCategory || lead?.categoria || lead?.category || ''
  const city = lead?.citta || lead?.city || ''
  const businessName = lead?.nome || lead?.azienda || lead?.business_name || ''

  if (lead?.local_competitors && lead.local_competitors.length > 0) {
    return NextResponse.json({
      competitors: lead.local_competitors,
      source: 'db',
    })
  }

  if (!category || !city) {
    return NextResponse.json({ competitors: [], source: 'missing_data' })
  }

  try {
    const res = await fetch('http://46.225.189.40:8001/scrape-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, city, business_name: businessName }),
      signal: AbortSignal.timeout(60000),
    })
    const data = await res.json()
    return NextResponse.json({ ...data, source: 'scraping' })
  } catch (e) {
    return NextResponse.json({ competitors: [], source: 'error' })
  }
}
