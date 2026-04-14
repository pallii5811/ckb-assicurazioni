import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead } = body

  const business_name = lead?.nome || lead?.azienda || lead?.business_name || ''
  const city = lead?.citta || lead?.city || ''

  console.log('REVIEWS - business_name:', business_name, 'city:', city)

  if (lead?.google_reviews && lead.google_reviews.length > 0) {
    console.log('REVIEWS FROM DB:', lead.google_reviews.length)
    return NextResponse.json({
      reviews: lead.google_reviews,
      rating: lead.rating || 0,
      total: lead.reviews_count || 0,
      source: 'db',
    })
  }

  if (!business_name || !city) {
    console.log('REVIEWS - MISSING DATA')
    return NextResponse.json({ reviews: [], rating: 0, total: 0, source: 'missing_data' })
  }

  try {
    const res = await fetch('http://46.225.189.40:8001/scrape-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name, city }),
      signal: AbortSignal.timeout(55000),
    })
    const data = await res.json()
    console.log('REVIEWS BACKEND RESPONSE:', JSON.stringify(data))
    return NextResponse.json({ ...data, source: 'scraping' })
  } catch (e) {
    console.log('REVIEWS BACKEND ERROR:', String(e))
    return NextResponse.json({ reviews: [], rating: 0, total: 0, source: 'error' })
  }
}
