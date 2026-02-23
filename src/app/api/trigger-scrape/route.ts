import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = 'http://116.203.137.39:8001'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const response = await fetch(`${BACKEND_URL}/trigger-scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    })
    
    if (!response.ok) throw new Error(`Backend error: ${response.status}`)
    
    const data = await response.json()
    return NextResponse.json(data)
    
  } catch (error) {
    console.error('trigger-scrape error:', error)
    return NextResponse.json(
      { error: 'Service unavailable' }, 
      { status: 500 }
    )
  }
}
