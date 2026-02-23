import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead } = body

  if (!lead?.instagram && !lead?.facebook) {
    return NextResponse.json({
      instagram: null,
      facebook: null,
      message: 'Nessun profilo social trovato per questo lead',
    })
  }

  try {
    const res = await fetch('http://116.203.137.39:8001/scrape-social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instagram_url: lead?.instagram || '',
        facebook_url: lead?.facebook || '',
      }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({
      instagram: null,
      facebook: null,
      source: 'error',
    })
  }
}
