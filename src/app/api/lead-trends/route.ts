import { NextRequest, NextResponse } from 'next/server'
import { analyzeTrends } from '@/lib/trends-analysis'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || ''
  const city = searchParams.get('city') || ''

  const analysis = await analyzeTrends(category, city)
  return NextResponse.json(analysis)
}
