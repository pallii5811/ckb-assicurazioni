/**
 * Cauzioni & Fideiussioni Calculator
 *
 * A partire dalla lista di gare ANAC vinte da un'azienda (output di
 * /api/anac-gare), calcola in modo deterministico:
 *
 *   - Cauzione Provvisoria (2% importo a base di gara, art. 93 D.Lgs. 50/2016)
 *   - Cauzione Definitiva (10% importo aggiudicato, art. 103 D.Lgs. 50/2016)
 *     Riducibile fino al 50% per certificazioni ISO 9001 / SOA / EMAS.
 *   - Polizza Decennale Postuma (1% del valore opera, obbligatoria per opere
 *     edili pubbliche con valore > €500k, art. 103 c.8 D.Lgs. 50/2016)
 *   - Polizza RC Lavori (CAR/EAR) raccomandata per lavori > €500k
 *
 * Stima inoltre il premio annuale ramo cauzioni applicando le aliquote
 * tecniche pubblicate da IVASS (Bollettino Cauzioni 2023).
 *
 * REGOLE D'ORO:
 *   - Tutti i calcoli sono "computed" (matematicamente deterministici)
 *   - Nessuna stima random, sempre formula + razionale
 *   - Riferimenti normativi espliciti (D.Lgs. 50/2016 — Codice Appalti)
 */

import type {
  AnacCauzioneEstimate,
  AnacFideiussioniSummary,
  RangeFact,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
//  COSTANTI NORMATIVE
// ─────────────────────────────────────────────────────────────────────────────

/** Cauzione provvisoria: 2% importo a base di gara (art. 93 D.Lgs. 50/2016) */
const CAUZIONE_PROVVISORIA_RATE = 0.02

/** Cauzione definitiva: 10% importo aggiudicato (art. 103 D.Lgs. 50/2016) */
const CAUZIONE_DEFINITIVA_RATE = 0.10

/** Decennale postuma: 1% del valore dell'opera (art. 103 c.8) */
const DECENNALE_POSTUMA_RATE = 0.01

/** Soglia per obbligatorietà decennale postuma (lavori edili pubblici) */
const SOGLIA_DECENNALE_POSTUMA = 500_000

/** Soglia per polizza RC Lavori raccomandata */
const SOGLIA_RC_LAVORI = 500_000

/** Aliquote tecniche premio annuo ramo cauzioni (IVASS Bollettino 2023) */
const PREMIO_CAUZIONI_RATE = {
  /** Aliquota minima per garantire (cauzione fideiussoria standard) */
  min: 0.005,  // 0.5% del massimale
  mid: 0.010,  // 1.0% del massimale
  max: 0.025,  // 2.5% del massimale (rischio elevato)
}

/** Aliquote tecniche decennale postuma (premio una tantum % importo opera) */
const PREMIO_DECENNALE_RATE = {
  min: 0.008,  // 0.8% del valore opera
  mid: 0.015,  // 1.5%
  max: 0.025,  // 2.5%
}

// ─────────────────────────────────────────────────────────────────────────────
//  TIPI di INPUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipo grezzo di una gara come restituita da /api/anac-gare.
 * Mantieniamo loose per compatibilità con possibili variazioni future.
 */
export interface AnacGaraRaw {
  oggetto?: string
  stazione_appaltante?: string
  importo_eur?: number | string | null
  data_aggiudicazione?: string | null
  cig?: string | null
  cup?: string | null
  stato?: 'aggiudicata' | 'in_corso' | 'partecipata' | string
  fonte_url?: string
  /** Campi opzionali che possiamo provare a leggere */
  data_fine_prevista?: string | null
  categoria?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function toNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (typeof input === 'string') {
    const cleaned = input.replace(/[€\s.]/g, '').replace(',', '.')
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Determina se una gara è del settore "lavori" (edilizia pubblica) basandosi
 * su keyword nell'oggetto. Per lavori si applica la decennale postuma se >500k.
 */
function isLavoriEdili(oggetto: string | undefined | null): boolean {
  if (!oggetto) return false
  const t = oggetto.toLowerCase()
  return /\b(lavori|costruzione|costruzioni|ristrutturazione|restauro|manutenzione\s+(?:straordinaria|edilizia)|opere|cantiere|edilizia|edile|edili|appalto\s+(?:integrato|misto)|opera\s+pubblica|infrastruttur)/i.test(t)
}

// ─────────────────────────────────────────────────────────────────────────────
//  CALCOLO PER SINGOLA GARA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola le fideiussioni stimate per una singola gara.
 * Restituisce null se l'importo non è valido (NaN, 0, negative).
 */
export function estimateCauzioneFromGara(g: AnacGaraRaw): AnacCauzioneEstimate | null {
  const importo = toNumber(g.importo_eur)
  if (importo === null || importo <= 0) return null

  const cigOrCup = String(g.cig || g.cup || '').trim() || `gara-${g.data_aggiudicazione || 'unknown'}`
  const oggetto = String(g.oggetto || '').trim() || 'Oggetto non specificato'
  const stazione = String(g.stazione_appaltante || '').trim() || 'Stazione appaltante non specificata'
  const dataAgg = String(g.data_aggiudicazione || '').trim() || 'data non disponibile'

  const cauzProv = Math.round(importo * CAUZIONE_PROVVISORIA_RATE)
  const cauzDef = Math.round(importo * CAUZIONE_DEFINITIVA_RATE)

  const out: AnacCauzioneEstimate = {
    cigOrCup,
    oggetto,
    stazioneAppaltante: stazione,
    importoAggiudicato: importo,
    cauzioneProvvisoriaStimata: cauzProv,
    cauzioneDefinitivaStimata: cauzDef,
    dataAggiudicazione: dataAgg,
  }

  if (g.data_fine_prevista) {
    out.dataFinePrevista = String(g.data_fine_prevista)
  }

  // Decennale postuma per lavori edili pubblici sopra soglia
  if (isLavoriEdili(oggetto) && importo >= SOGLIA_DECENNALE_POSTUMA) {
    out.decennaleEdilizia = Math.round(importo * DECENNALE_POSTUMA_RATE)
  }

  // RC Lavori applicabile (>500k)
  if (importo >= SOGLIA_RC_LAVORI) {
    out.rcLavoriApplicabile = true
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
//  AGGREGATORE — costruisce l'AnacFideiussioniSummary
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildSummaryInput {
  piva: string
  gareRaw: AnacGaraRaw[]
}

export function buildFideiussioniSummary(input: BuildSummaryInput): AnacFideiussioniSummary {
  const estimates: AnacCauzioneEstimate[] = []
  for (const g of input.gareRaw) {
    const est = estimateCauzioneFromGara(g)
    if (est) estimates.push(est)
  }

  // Aggregati
  const importoTotale = estimates.reduce((s, e) => s + e.importoAggiudicato, 0)
  const cauzProvTot = estimates.reduce((s, e) => s + e.cauzioneProvvisoriaStimata, 0)
  const cauzDefTot = estimates.reduce((s, e) => s + e.cauzioneDefinitivaStimata, 0)
  const decennaleTot = estimates.reduce((s, e) => s + (e.decennaleEdilizia || 0), 0)
  const rcLavoriCount = estimates.filter((e) => e.rcLavoriApplicabile).length

  // Stima premio annuo ramo cauzioni:
  //   massimale teorico in essere ≈ cauzioni definitive (in corso)
  //   premio annuo = massimale × aliquota
  const premiCauzioni: RangeFact = {
    min: Math.round(cauzDefTot * PREMIO_CAUZIONI_RATE.min),
    mid: Math.round(cauzDefTot * PREMIO_CAUZIONI_RATE.mid),
    max: Math.round(cauzDefTot * PREMIO_CAUZIONI_RATE.max),
    confidence: 'estimated',
    source: 'IVASS Bollettino Cauzioni 2023',
    rationale: `Cauzioni definitive in essere ${cauzDefTot.toLocaleString('it-IT')}€ × aliquote tecniche IVASS (0.5%-2.5%/anno)`,
  }

  // Sort: gare in corso più recenti prima
  estimates.sort((a, b) => {
    const da = a.dataAggiudicazione || ''
    const db = b.dataAggiudicazione || ''
    return db.localeCompare(da)
  })

  return {
    piva: input.piva,
    cigCount: estimates.length,
    importoTotaleAggiudicato: importoTotale,
    cauzioniProvvisorieTotali: cauzProvTot,
    cauzioniDefinitiveTotali: cauzDefTot,
    decennaliEdiliziaTotali: decennaleTot,
    rcLavoriCount,
    gareInCorso: estimates,
    premiCauzioniAnnualiStimati: premiCauzioni,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PREMIO DECENNALE — utility specifica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stima il premio una tantum della Polizza Decennale Postuma per un'opera.
 * Premio = % del valore opera (basato su aliquote IVASS 2023).
 */
export function estimatePremioDecennale(valoreOpera: number): RangeFact {
  return {
    min: Math.round(valoreOpera * PREMIO_DECENNALE_RATE.min),
    mid: Math.round(valoreOpera * PREMIO_DECENNALE_RATE.mid),
    max: Math.round(valoreOpera * PREMIO_DECENNALE_RATE.max),
    confidence: 'estimated',
    source: 'IVASS Bollettino 2023 (decennale postuma)',
    rationale: `${(PREMIO_DECENNALE_RATE.min * 100).toFixed(1)}-${(PREMIO_DECENNALE_RATE.max * 100).toFixed(1)}% del valore opera (premio una tantum)`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER per chiamare /api/anac-gare internamente
// ─────────────────────────────────────────────────────────────────────────────

interface AnacGareResponse {
  found?: boolean
  ragione_sociale?: string
  vince_appalti_pubblici?: boolean
  gare?: AnacGaraRaw[]
  totale_importo_eur?: number
  obblighi_assicurativi?: string[]
  fonti?: string[]
  message?: string
}

export async function fetchAnacGare(
  origin: string,
  ragioneSociale: string,
  partitaIva?: string,
): Promise<AnacGareResponse | null> {
  if (!ragioneSociale && !partitaIva) return null
  try {
    const res = await fetch(`${origin}/api/anac-gare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ragione_sociale: ragioneSociale,
        partita_iva: partitaIva,
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return null
    return (await res.json()) as AnacGareResponse
  } catch {
    return null
  }
}
