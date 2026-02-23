import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as any
  const searchId = body?.searchId
  const leadIndex = body?.leadIndex
  const leadName = body?.leadName
  const leadWebsite = body?.leadWebsite
  const leadCity = body?.leadCity
  const leadCategory = body?.leadCategory

  if (!searchId || typeof leadIndex !== 'number' || !leadName) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('lead_monitors')
    .select('id')
    .eq('user_id', user.id)
    .eq('search_id', searchId)
    .eq('lead_index', leadIndex)
    .maybeSingle()

  if (existingError) return NextResponse.json({ error: existingError }, { status: 500 })

  if (existing?.id) {
    return NextResponse.json({ message: 'Già monitorato', id: existing.id })
  }

  const { data, error } = await supabase
    .from('lead_monitors')
    .insert({
      user_id: user.id,
      search_id: searchId,
      lead_index: leadIndex,
      lead_name: leadName,
      lead_website: leadWebsite,
      lead_city: leadCity,
      lead_category: leadCategory,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ success: true, monitor: data })
}
