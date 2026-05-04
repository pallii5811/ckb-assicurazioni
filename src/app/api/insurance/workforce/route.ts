/**
 * GET/POST /api/insurance/workforce
 *
 * Restituisce l'analisi workforce dell'azienda:
 *   - Dipendenti, costo personale, costo medio per dipendente
 *   - TFR maturato, oneri sociali stimati
 *   - CCNL probabilmente applicato
 *   - Opportunità welfare dettagliate (Vita / Sanitaria / Infortuni / Fondo Pensione / Flexible Benefits)
 *
 * AUTH: richiede Supabase user. Solo fonti gratuite.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  fetchBalanceSheetFree,
  originFromHeaders,
  resolveCompanyIdentity,
} from '@/lib/insurance/balance-sheet'
import { analyzeWorkforce } from '@/lib/insurance/workforce'

export const maxDuration = 90

interface RequestBody {
  piva?: string
  ragioneSociale?: string
  citta?: string
  skipTavily?: boolean
}

function validatePiva(piva?: string): string | null {
  if (!piva) return null
  const cleaned = String(piva).replace(/\D/g, '')
  return cleaned.length === 11 ? cleaned : null
}

async function handleRequest(req: NextRequest, body: RequestBody): Promise<NextResponse> {
  const startTs = Date.now()

  // Auth
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Errore autenticazione' }, { status: 500 })
  }

  // Validation
  const piva = validatePiva(body.piva)
  const ragioneSociale = (body.ragioneSociale || '').trim()
  const citta = (body.citta || '').trim()

  if (!piva && !ragioneSociale) {
    return NextResponse.json(
      { error: 'Devi fornire una P.IVA o una ragione sociale.' },
      { status: 400 },
    )
  }

  const origin = originFromHeaders(req.headers)

  // Risolvi anagrafica con fallback ATECO Tavily (Fix #3)
  const identity = await resolveCompanyIdentity(origin, {
    piva: piva || undefined,
    ragioneSociale,
    citta,
  })
  const sourcesUsed: string[] = [...identity.sourcesUsed]
  const resolvedRagioneSociale = identity.ragioneSociale
  const resolvedPiva = identity.piva || undefined
  const ateco = identity.ateco
  const atecoDescription = identity.atecoDescription

  if (!resolvedPiva && !resolvedRagioneSociale) {
    return NextResponse.json(
      { error: 'Azienda non trovata in fonti pubbliche.' },
      { status: 404 },
    )
  }

  // Bilancio (gratuito)
  const balance = await fetchBalanceSheetFree({
    origin,
    ragioneSociale: resolvedRagioneSociale || resolvedPiva || '',
    piva: resolvedPiva,
    citta,
    skipTavily: body.skipTavily === true,
  })

  if (balance.source && balance.source !== 'no-data') {
    for (const s of balance.source.split(' + ')) {
      if (!sourcesUsed.includes(s)) sourcesUsed.push(s)
    }
  }

  // Analisi workforce
  const analysis = analyzeWorkforce({
    bs: balance.latest,
    ateco,
    source: balance.source,
  })

  return NextResponse.json({
    piva: resolvedPiva || '',
    ragioneSociale: resolvedRagioneSociale,
    ateco,
    atecoDescription,
    ...analysis,
    meta: {
      sourcesUsed,
      fetchedAt: balance.fetchedAt,
      durationMs: Date.now() - startTs,
    },
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RequestBody = {}
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 })
  }
  return handleRequest(req, body)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const body: RequestBody = {
    piva: url.searchParams.get('piva') || undefined,
    ragioneSociale: url.searchParams.get('ragioneSociale') || url.searchParams.get('q') || undefined,
    citta: url.searchParams.get('citta') || undefined,
    skipTavily: url.searchParams.get('skipTavily') === '1' || url.searchParams.get('skipTavily') === 'true',
  }
  return handleRequest(req, body)
}
