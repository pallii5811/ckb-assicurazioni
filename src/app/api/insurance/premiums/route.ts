/**
 * GET/POST /api/insurance/premiums
 *
 * Restituisce l'Insurance Footprint completo di un'azienda dato:
 *   - P.IVA (preferito), oppure
 *   - Ragione sociale + città
 *
 * Pipeline:
 *   1. Recupera dati base via /api/lead-registry (gratuito)
 *   2. Tavily search per voci dettagliate di bilancio (gratuito)
 *   3. Calcola premi stimati + opportunità da benchmark IVASS
 *   4. Restituisce InsuranceFootprint
 *
 * AUTH: richiede utente Supabase autenticato (anti-abuso quote API).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  fetchBalanceSheetFree,
  originFromHeaders,
  resolveCompanyIdentity,
} from '@/lib/insurance/balance-sheet'
import { buildInsuranceFootprint } from '@/lib/insurance/premium-extractor'

export const maxDuration = 90

interface RequestBody {
  piva?: string
  ragioneSociale?: string
  citta?: string
  /** Skip Tavily search (più veloce, dati base solo da lead-registry) */
  skipTavily?: boolean
}

function validatePiva(piva?: string): string | null {
  if (!piva) return null
  const cleaned = String(piva).replace(/\D/g, '')
  return cleaned.length === 11 ? cleaned : null
}

async function handleRequest(req: NextRequest, body: RequestBody): Promise<NextResponse> {
  const startTs = Date.now()

  // ─── AUTH ─────────────────────────────────────────────────────────────
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Non autenticato. Effettua il login per accedere a questo endpoint.' },
        { status: 401 },
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Errore autenticazione' },
      { status: 500 },
    )
  }

  // ─── INPUT VALIDATION ─────────────────────────────────────────────────
  const piva = validatePiva(body.piva)
  const ragioneSociale = (body.ragioneSociale || '').trim()
  const citta = (body.citta || '').trim()

  if (!piva && !ragioneSociale) {
    return NextResponse.json(
      { error: 'Devi fornire una P.IVA (11 cifre) oppure una ragione sociale.' },
      { status: 400 },
    )
  }

  // ─── RISOLUZIONE ANAGRAFICA UNIFICATA (lead-registry + ATECO Tavily fallback) ─
  const origin = originFromHeaders(req.headers)
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

  // Se ancora nessuna P.IVA, falliamo gracefully
  if (!resolvedPiva && !resolvedRagioneSociale) {
    return NextResponse.json(
      {
        error: 'Azienda non trovata in fonti pubbliche.',
        meta: { sourcesUsed, durationMs: Date.now() - startTs },
      },
      { status: 404 },
    )
  }

  // ─── FETCH BILANCIO (gratuito) ────────────────────────────────────────
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

  // ─── COSTRUISCI FOOTPRINT ─────────────────────────────────────────────
  const footprint = buildInsuranceFootprint({
    piva: resolvedPiva || '',
    ragioneSociale: resolvedRagioneSociale,
    ateco,
    atecoDescription,
    citta,
    balance,
    sourcesUsed,
    fetchStartTs: startTs,
  })

  // Propaga eventuali warnings di Identity (Fix #6 ATECO mismatch, Fix #8 P.IVA mismatch)
  if (identity.warnings.length > 0) {
    footprint.meta.warnings = [...identity.warnings, ...footprint.meta.warnings]
  }

  return NextResponse.json(footprint)
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
