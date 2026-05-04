/**
 * GET/POST /api/insurance/cauzioni
 *
 * Restituisce il riepilogo fideiussioni stimate dell'azienda a partire dalle
 * gare ANAC vinte:
 *   - Importi cauzioni provvisorie (2%) e definitive (10%)
 *   - Decennale postuma per lavori edili pubblici > €500k
 *   - Stima premio annuo ramo cauzioni
 *
 * RIUSO endpoint /api/anac-gare per i dati grezzi (zero modifiche al flusso).
 *
 * AUTH: Supabase user obbligatorio.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { originFromHeaders, resolveCompanyIdentity } from '@/lib/insurance/balance-sheet'
import { buildFideiussioniSummary, fetchAnacGare } from '@/lib/insurance/cauzioni'

export const maxDuration = 90

interface RequestBody {
  piva?: string
  ragioneSociale?: string
  citta?: string
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

  // Risolvi anagrafica (cauzioni non usa ATECO, ma riusa l'helper unificato per coerenza)
  const identity = await resolveCompanyIdentity(origin, {
    piva: piva || undefined,
    ragioneSociale,
    citta,
  })
  const sourcesUsed: string[] = [...identity.sourcesUsed]
  const resolvedRagioneSociale = identity.ragioneSociale
  const resolvedPiva = identity.piva || undefined

  if (!resolvedRagioneSociale && !resolvedPiva) {
    return NextResponse.json(
      { error: 'Azienda non trovata in fonti pubbliche.' },
      { status: 404 },
    )
  }

  // Fetch gare ANAC (riusa endpoint esistente)
  const anac = await fetchAnacGare(origin, resolvedRagioneSociale, resolvedPiva)
  if (!anac) {
    return NextResponse.json({
      piva: resolvedPiva || '',
      ragioneSociale: resolvedRagioneSociale,
      found: false,
      message: 'Endpoint ANAC non raggiungibile o nessun dato disponibile.',
      meta: {
        sourcesUsed,
        durationMs: Date.now() - startTs,
      },
    })
  }

  sourcesUsed.push('anac-gare')
  if (Array.isArray(anac.fonti)) {
    for (const f of anac.fonti) {
      if (typeof f === 'string' && !sourcesUsed.includes(f)) sourcesUsed.push(f)
    }
  }

  const gareRaw = Array.isArray(anac.gare) ? anac.gare : []

  // Se non vince gare pubbliche o lista vuota
  if (!anac.vince_appalti_pubblici || gareRaw.length === 0) {
    return NextResponse.json({
      piva: resolvedPiva || '',
      ragioneSociale: resolvedRagioneSociale,
      vinceAppaltiPubblici: false,
      gareCount: 0,
      message: anac.message || 'Nessuna gara pubblica vinta riscontrata negli ultimi anni.',
      summary: null,
      obblighiAssicurativiText: anac.obblighi_assicurativi || [],
      meta: {
        sourcesUsed,
        durationMs: Date.now() - startTs,
      },
    })
  }

  // Costruisci summary fideiussioni
  const summary = buildFideiussioniSummary({
    piva: resolvedPiva || '',
    gareRaw,
  })

  return NextResponse.json({
    piva: resolvedPiva || '',
    ragioneSociale: resolvedRagioneSociale,
    vinceAppaltiPubblici: true,
    gareCount: gareRaw.length,
    summary,
    obblighiAssicurativiText: anac.obblighi_assicurativi || [],
    meta: {
      sourcesUsed,
      durationMs: Date.now() - startTs,
      fetchedAt: new Date().toISOString(),
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
  }
  return handleRequest(req, body)
}
