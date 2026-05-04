/**
 * POST /api/insurance/triggers
 *
 * Calcola "trigger commerciali" per un prospect: eventi recenti che indicano
 * un BISOGNO assicurativo nuovo/imminente.
 *
 * Combina:
 *   - News pubbliche aziendali (Tavily mirato a domini news IT)
 *   - Profili LinkedIn pubblici di colleghi (SERP, no scraping)
 *   - Cambio lavoro / promozioni del titolare (SERP)
 *   - Gare ANAC recenti (riusa /api/anac-gare)
 *   - Età P.IVA (da costituzione anno)
 *   - Mappa albi professionali per ATECO
 *   - Stima capacità di spesa (benchmark ANIA + ISTAT)
 *   - Hotness score 0-100 globale
 *
 * AUTH: Supabase user.
 *
 * Body esempio:
 * {
 *   "ragioneSociale": "Acme S.p.A.",
 *   "partitaIva": "01234567890",
 *   "citta": "Milano",
 *   "ateco": "62.01.00",
 *   "fatturato": 5000000,
 *   "dipendenti": 25,
 *   "costituzioneAnno": 2022,
 *   "ruolo": "titolare",
 *   "titolareNome": "Mario Rossi",
 *   "hasLinkedinPresence": true,
 *   "skipNetwork": false
 * }
 *
 * Costo: 2-4 chiamate Tavily basic + 1 ANAC opzionale. ~10-30s totali.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  computeHotnessScore,
  estimateSpendingCapacity,
  mapAtecoToProfessionalAlbi,
  getSectorRisk,
  buildPivaAgeTrigger,
  buildTenderTrigger,
  fetchCompanyNews,
  fetchLinkedInColleagues,
  fetchLeaderJobChange,
  type CommercialTrigger,
  type RecentEvent,
  type TriggersOutput,
  type NetworkSignal,
} from '@/lib/insurance/triggers'
import { fetchAnacGare } from '@/lib/insurance/cauzioni'

export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: derive origin from request headers
// ─────────────────────────────────────────────────────────────────────────────

function originFromReq(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  Body schema
// ─────────────────────────────────────────────────────────────────────────────

interface TriggersRequestBody {
  ragioneSociale: string
  partitaIva?: string
  citta?: string
  ateco?: string
  fatturato?: number
  dipendenti?: number
  /** Anno di costituzione (es. 2022). Se non disponibile, niente trigger PIVA. */
  costituzioneAnno?: number
  costituzioneMese?: number
  ruolo?: 'titolare' | 'amministratore' | 'dipendente' | 'libero_professionista' | 'unknown'
  titolareNome?: string
  hasLinkedinPresence?: boolean
  /** Skippa chiamate network (LinkedIn colleghi, news) per testing rapido */
  skipNetwork?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers per ordering severity
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<CommercialTrigger['severity'], number> = {
  critico: 5,
  alto: 4,
  medio: 3,
  basso: 2,
  info: 1,
}

function sortTriggersBySeverity(arr: CommercialTrigger[]): CommercialTrigger[] {
  return [...arr].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // Auth
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
    return NextResponse.json({ error: 'Auth error' }, { status: 401 })
  }

  // Parse body
  let body: TriggersRequestBody
  try {
    body = (await req.json()) as TriggersRequestBody
  } catch {
    return NextResponse.json({ error: 'Body JSON invalido' }, { status: 400 })
  }
  if (!body?.ragioneSociale?.trim()) {
    return NextResponse.json({ error: 'ragioneSociale richiesta' }, { status: 400 })
  }

  const warnings: string[] = []
  const triggers: CommercialTrigger[] = []
  const events: RecentEvent[] = []
  const allSources = new Set<string>()
  const network: NetworkSignal = {
    colleghiLinkedin: [],
    albiProfessionali: mapAtecoToProfessionalAlbi(body.ateco, body.ruolo),
  }

  // ─── 1. Trigger basato su età P.IVA (calcolo locale, no network) ──────────
  const pivaTrigger = buildPivaAgeTrigger(body.costituzioneAnno, body.costituzioneMese)
  if (pivaTrigger) triggers.push(pivaTrigger)

  // ─── 2. Sector risk (per hotness scoring) ──────────────────────────────────
  const sectorRisk = getSectorRisk(body.ateco)

  // ─── 3. Spending capacity (calcolo locale) ────────────────────────────────
  const spendingCapacity = estimateSpendingCapacity({
    fatturato: body.fatturato,
    dipendenti: body.dipendenti,
    ateco: body.ateco,
    ruolo: body.ruolo,
    citta: body.citta,
    costituzioneAnno: body.costituzioneAnno,
  })

  // ─── 4. Network calls in parallelo (skip se richiesto) ────────────────────
  const networkPromises: Array<Promise<unknown>> = []
  let recentTender: { found: boolean; importo: number; oggetto?: string; data?: string; stazione?: string; fonte?: string; categoria?: 'lavori' | 'servizi' | 'forniture' | 'unknown' } = {
    found: false,
    importo: 0,
  }
  let leaderChange: { detected: boolean; evidence?: string; sourceUrl?: string } = { detected: false }
  let recentNewsCount = 0
  let hasAcquisitionNews = false
  let hasExpansionNews = false

  if (!body.skipNetwork) {
    // 4a. Company news
    networkPromises.push(
      fetchCompanyNews(body.ragioneSociale, body.citta, 6)
        .then((res) => {
          for (const e of res.events) {
            events.push(e)
            allSources.add(e.source)
          }
          for (const t of res.triggers) {
            triggers.push(t)
            if (t.type === 'news_acquisizione' || t.type === 'fusione') hasAcquisitionNews = true
            if (t.type === 'news_espansione' || t.type === 'nuova_sede') hasExpansionNews = true
          }
          recentNewsCount = res.events.length
          for (const s of res.sources) allSources.add(s)
        })
        .catch((e) => warnings.push(`News fetch: ${(e as Error).message}`)),
    )

    // 4b. LinkedIn colleagues
    networkPromises.push(
      fetchLinkedInColleagues(body.ragioneSociale, 8, { citta: body.citta })
        .then((res) => {
          network.colleghiLinkedin = res.colleagues
          for (const s of res.sources) allSources.add(new URL(s).hostname)
        })
        .catch((e) => warnings.push(`LinkedIn fetch: ${(e as Error).message}`)),
    )

    // 4c. Leader job change
    if (body.titolareNome) {
      networkPromises.push(
        fetchLeaderJobChange(body.titolareNome, body.ragioneSociale)
          .then((res) => {
            leaderChange = res
            if (res.detected) {
              triggers.push({
                type: 'cambio_lavoro_titolare',
                severity: 'alto',
                title: 'Cambio ruolo titolare/decision maker recente',
                description: res.evidence || 'Segnale rilevato in fonti pubbliche',
                source: res.sourceUrl,
                insuranceImplication:
                  'Il decision maker è cambiato: finestra di vendita aperta per revisione D&O, RC professionale, key man, polizze welfare.',
                suggestedActions: [
                  'Email di benvenuto + check-up assicurativo gratuito',
                  'Proporre D&O retroattiva per il predecessore',
                  'Offerta di mappatura coperture esistenti',
                ],
              })
            }
          })
          .catch((e) => warnings.push(`Leader change: ${(e as Error).message}`)),
      )
    }

    // 4d. ANAC gare recenti (solo se P.IVA presente o ragione sociale specifica)
    networkPromises.push(
      fetchAnacGare(originFromReq(req), body.ragioneSociale, body.partitaIva)
        .then((res) => {
          if (!res?.gare?.length) return
          // Coerce importo_eur (può essere number | string | null) e data
          const garaWithNum = res.gare.map((g) => ({
            ...g,
            _importoNum: typeof g.importo_eur === 'number'
              ? g.importo_eur
              : typeof g.importo_eur === 'string'
                ? Number(g.importo_eur.replace(/[^\d.,-]/g, '').replace(',', '.')) || 0
                : 0,
            _dataStr: g.data_aggiudicazione || undefined,
          }))
          // Prendi la più recente (più alto importo come fallback se data mancante)
          const sorted = garaWithNum.sort((a, b) => {
            const da = a._dataStr ? new Date(a._dataStr).getTime() : 0
            const db = b._dataStr ? new Date(b._dataStr).getTime() : 0
            if (da !== db) return db - da
            return b._importoNum - a._importoNum
          })
          const top = sorted[0]
          if (top && top._importoNum > 0) {
            recentTender = {
              found: true,
              importo: top._importoNum,
              oggetto: top.oggetto,
              data: top._dataStr,
              stazione: top.stazione_appaltante,
              fonte: top.fonte_url,
              categoria: 'unknown',
            }
            triggers.push(
              buildTenderTrigger({
                oggetto: top.oggetto || 'Aggiudicazione gara pubblica',
                importo: top._importoNum,
                dataAggiudicazione: top._dataStr,
                stazioneAppaltante: top.stazione_appaltante,
                fonte: top.fonte_url,
                categoria: 'unknown',
              }),
            )
            // Aggiungi anche come evento
            events.push({
              date: top._dataStr || new Date().toISOString().slice(0, 10),
              title: top.oggetto || 'Gara aggiudicata',
              source: top.fonte_url ? new URL(top.fonte_url).hostname : 'anac',
              url: top.fonte_url || 'https://www.anticorruzione.it/',
              category: 'gara_anac',
            })
          }
          if (res.fonti) for (const u of res.fonti) allSources.add(new URL(u).hostname)
        })
        .catch((e) => warnings.push(`ANAC gare: ${(e as Error).message}`)),
    )

    // Aspetta tutte (con timeout globale di sicurezza)
    await Promise.allSettled(networkPromises)
  } else {
    warnings.push('skipNetwork=true: nessuna chiamata Tavily/ANAC eseguita')
  }

  // ─── 5. Hotness score globale ─────────────────────────────────────────────
  const pivaAgeMonths = body.costituzioneAnno
    ? Math.max(0, (Date.now() - new Date(body.costituzioneAnno, (body.costituzioneMese ?? 6) - 1, 1).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    : undefined

  const hotness = computeHotnessScore({
    hasRecentTender: recentTender.found,
    recentTenderImportoEur: recentTender.importo,
    pivaAgeMonths,
    hasLeaderJobChange: leaderChange.detected,
    recentNewsCount,
    hasAcquisitionNews,
    hasExpansionNews,
    fatturato: body.fatturato,
    dipendenti: body.dipendenti,
    sectorRisk,
    hasLinkedinPresence: body.hasLinkedinPresence,
  })

  // ─── 6. Sort eventi per data desc ──────────────────────────────────────────
  events.sort((a, b) => {
    const da = new Date(a.date).getTime()
    const db = new Date(b.date).getTime()
    return (Number.isNaN(db) ? 0 : db) - (Number.isNaN(da) ? 0 : da)
  })

  const out: TriggersOutput = {
    hotnessScore: hotness.score,
    hotnessLabel: hotness.label,
    hotnessRationale: hotness.rationale,
    triggers: sortTriggersBySeverity(triggers),
    network,
    spendingCapacity,
    recentEvents: events.slice(0, 12), // limita output
    meta: {
      sourcesUsed: Array.from(allSources).slice(0, 20),
      durationMs: Date.now() - t0,
      warnings,
    },
  }

  return NextResponse.json(out)
}
