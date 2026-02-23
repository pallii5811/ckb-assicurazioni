import { NextRequest, NextResponse } from 'next/server'
import { analyzeAdsPresence } from '@/lib/ads-analysis'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') || ''
  const website = searchParams.get('website') || ''
  const city = searchParams.get('city') || ''
  const category = searchParams.get('category') || ''

  const analysis = await analyzeAdsPresence(name, website, city, category)
  return NextResponse.json(analysis)
}
