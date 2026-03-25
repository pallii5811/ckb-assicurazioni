import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data, error } = await supabase
    .from('lead_pipeline')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { lead_name, lead_website, lead_phone, lead_email, lead_city, lead_category, lead_score, stage, deal_value, notes } = body

  if (!lead_name) return NextResponse.json({ error: 'Nome lead obbligatorio' }, { status: 400 })

  const { data, error } = await supabase
    .from('lead_pipeline')
    .insert({
      user_id: user.id,
      lead_name,
      lead_website: lead_website || null,
      lead_phone: lead_phone || null,
      lead_email: lead_email || null,
      lead_city: lead_city || null,
      lead_category: lead_category || null,
      lead_score: typeof lead_score === 'number' ? lead_score : 0,
      stage: stage || 'nuovo',
      deal_value: typeof deal_value === 'number' ? deal_value : 0,
      notes: notes || null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'ID obbligatorio' }, { status: 400 })

  const allowed = ['lead_name', 'lead_website', 'lead_phone', 'lead_email', 'lead_city', 'lead_category', 'lead_score', 'stage', 'deal_value', 'notes', 'next_action', 'next_action_date']
  const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in updates) safeUpdates[key] = updates[key]
  }

  const { data, error } = await supabase
    .from('lead_pipeline')
    .update(safeUpdates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID obbligatorio' }, { status: 400 })

  const { error } = await supabase
    .from('lead_pipeline')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
