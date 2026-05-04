/**
 * GET/POST /api/insurance/risk-score
 *
 * Restituisce il risk score sismico di una sede aziendale italiana.
 *
 * Input:
 *   - piva o ragioneSociale (per recuperare l'indirizzo via lead-registry)
 *   - oppure: address diretto
 *
 * Output:
 *   - Zona sismica DPC 2015 (1-4) + PGA medio
 *   - Score globale 0-100
 *   - Impatto stimato su premio polizza All-Risk
 *
 * AUTH: Supabase user.
 * Fonti: SOLO dataset interno (DPC 2015) — zero chiamate esterne.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { originFromHeaders, resolveCompanyIdentity } from '@/lib/insurance/balance-sheet'
import { analyzeSeismicRisk } from '@/lib/insurance/seismic-risk'

export const maxDuration = 60

interface RequestBody {
  piva?: string
  ragioneSociale?: string
  citta?: string
  /** Indirizzo diretto (skippa lookup lead-registry) */
  address?: string
  /** Comune diretto */
  comune?: string
  /** Provincia (sigla 2 lettere) */
  provincia?: string
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

  const piva = validatePiva(body.piva)
  const ragioneSociale = (body.ragioneSociale || '').trim()
  const citta = (body.citta || '').trim()
  const directAddress = (body.address || '').trim()
  const directComune = (body.comune || '').trim()
  const directProvincia = (body.provincia || '').trim().toUpperCase()

  const sourcesUsed: string[] = []
  let address = directAddress
  let resolvedRagioneSociale = ragioneSociale
  let resolvedPiva = piva || undefined

  // Path A: indirizzo diretto fornito
  if (directAddress || (directComune && directProvincia)) {
    sourcesUsed.push('user-input')
    if (!address && directComune) {
      address = `${directComune}, ${directProvincia || ''}`.trim().replace(/,$/, '')
    }
  }
  // Path B: risolvi indirizzo via lead-registry
  else if (piva || ragioneSociale) {
    const origin = originFromHeaders(req.headers)
    const identity = await resolveCompanyIdentity(origin, {
      piva: piva || undefined,
      ragioneSociale,
      citta,
    })
    sourcesUsed.push(...identity.sourcesUsed)
    if (identity.ragioneSociale) resolvedRagioneSociale = identity.ragioneSociale
    if (identity.piva) resolvedPiva = identity.piva
    if (identity.sede_legale) address = identity.sede_legale
    // Fallback: usa la città dichiarata se non abbiamo sede
    if (!address && citta) address = citta
  }

  if (!address && !directComune) {
    return NextResponse.json(
      { error: 'Devi fornire un indirizzo, un comune+provincia, o una P.IVA/ragione sociale per risolvere la sede.' },
      { status: 400 },
    )
  }

  // Analisi rischio sismico
  sourcesUsed.push('DPC Classificazione Sismica 2015')
  const risk = analyzeSeismicRisk({
    address: address || directComune,
    comune: directComune || undefined,
    provincia: directProvincia || undefined,
  })

  return NextResponse.json({
    piva: resolvedPiva || '',
    ragioneSociale: resolvedRagioneSociale,
    addressUsed: address || directComune,
    risk,
    meta: {
      sourcesUsed,
      durationMs: Date.now() - startTs,
      fetchedAt: new Date().toISOString(),
      disclaimer: 'I dati DPC 2015 sono indicativi della macro-zona. Per un\'analisi puntuale è necessario consultare la classificazione del comune specifico (microzonazione).',
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
    address: url.searchParams.get('address') || undefined,
    comune: url.searchParams.get('comune') || undefined,
    provincia: url.searchParams.get('provincia') || undefined,
  }
  return handleRequest(req, body)
}
