import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    }

    const body = await req.json()
    const amount = typeof body.amount === 'number' && body.amount > 0 ? body.amount : 1

    const { data: profile, error: fetchErr } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    if (fetchErr || !profile) {
      return NextResponse.json({ error: 'Profilo non trovato' }, { status: 404 })
    }

    const currentCredits = typeof profile.credits === 'number' ? profile.credits : 0

    if (currentCredits < amount) {
      return NextResponse.json({
        error: 'Crediti insufficienti',
        credits: currentCredits,
        required: amount,
      }, { status: 403 })
    }

    const newCredits = currentCredits - amount

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', user.id)

    if (updateErr) {
      return NextResponse.json({ error: 'Errore aggiornamento crediti' }, { status: 500 })
    }

    return NextResponse.json({ credits: newCredits, used: amount })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
