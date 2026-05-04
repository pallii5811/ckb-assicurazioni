/**
 * Seismic Risk Analyzer
 *
 * Calcola il rischio sismico di una sede aziendale italiana usando la
 * classificazione ufficiale DPC 2015 (zone 1-4).
 *
 * Pipeline:
 *   1. Estrae il comune dall'indirizzo della sede (parsing testuale)
 *   2. Lookup nel dataset SEISMIC_ZONES_BY_COMUNE
 *   3. Se comune non trovato, fallback alla regione (provincia → regione)
 *   4. Restituisce zona + PGA + impatto stimato sul premio polizza All-Risk
 *
 * REGOLE D'ORO:
 *   - Dato dichiarato (declared) solo per comuni nel dataset DPC ufficiale
 *   - Dato stimato (estimated) per fallback regionale (con range esplicito)
 *   - Mai inventare zone per comuni sconosciuti — restituire 'unknown'
 */

import type { GeoRiskScore, SeismicRiskFact } from './types'
import {
  SEISMIC_ZONES_BY_COMUNE,
  SEISMIC_ZONE_BY_REGION,
  PROVINCE_TO_REGION,
  normalizeComuneName,
} from './seismic-data'

// ─────────────────────────────────────────────────────────────────────────────
//  PARSING INDIRIZZO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estrae comune e provincia da un indirizzo italiano.
 * Tipico formato: "Via Roma 12, 10100 Torino, TO"
 *
 * Strategia heuristica robusta:
 *   - Cerca CAP (5 cifre) → comune dopo CAP
 *   - Cerca sigla provincia (2 lettere maiuscole) alla fine
 *   - Fallback: ultima parola/i prima di virgola
 */
export interface AddressParts {
  comune?: string
  provincia?: string
  cap?: string
  raw: string
}

export function parseAddress(address: string): AddressParts {
  if (!address || typeof address !== 'string') return { raw: '' }
  const out: AddressParts = { raw: address }

  // CAP italiano (5 cifre)
  const capMatch = address.match(/\b(\d{5})\b/)
  if (capMatch) out.cap = capMatch[1]

  // Sigla provincia (2 maiuscole tra parentesi o alla fine)
  const provMatch = address.match(/[\(\s,]([A-Z]{2})[\)\s,]?\s*$/) || address.match(/\b([A-Z]{2})\s*$/)
  if (provMatch) {
    const sigla = provMatch[1].toUpperCase()
    if (PROVINCE_TO_REGION[sigla]) out.provincia = sigla
  }

  // Comune: prova diverse strategie
  // Strategia 1: parola dopo CAP
  if (out.cap) {
    const re = new RegExp(`\\b${out.cap}\\s+([A-Za-zÀ-ÿ\\s']+?)(?:[,\\(]|\\s+[A-Z]{2}\\s*$|$)`, 'i')
    const m = address.match(re)
    if (m && m[1]) {
      out.comune = m[1].trim()
    }
  }

  // Strategia 2: ultima parola/i prima della sigla provincia
  if (!out.comune && out.provincia) {
    const re = new RegExp(`([A-Za-zÀ-ÿ\\s']+?)[,\\s]+\\(?${out.provincia}\\)?\\s*$`, 'i')
    const m = address.match(re)
    if (m && m[1]) {
      // Rimuovi parti che sono CAP o numeri o "via Xxx"
      let comune = m[1].trim()
      // Se contiene "via", "corso", "p.zza", "viale" prendi solo l'ultima parte
      const viaMatch = comune.match(/(?:via|corso|p(?:\.|iazza)|viale|largo|vicolo|str\.|strada)\s+\S+\s+\d*\s*(.+)$/i)
      if (viaMatch && viaMatch[1]) comune = viaMatch[1].trim()
      // Rimuovi eventuali numeri civici alla fine
      comune = comune.replace(/^\d+\s*/, '').replace(/\s+\d+$/, '').trim()
      if (comune.length >= 2) out.comune = comune
    }
  }

  // Strategia 3: split per virgole — logica adattiva su numero di segmenti
  // Esempi gestiti:
  //   "Via Roma 12, 10100 Torino, TO"   → 3 segmenti, penultimo = comune
  //   "via TELESIO 69, Torino"          → 2 segmenti, ULTIMO = comune (non penultimo!)
  //   "Piazza Duomo 1, 20121 Milano (MI)" → 2 segmenti, ultimo contiene "Milano (MI)"
  if (!out.comune) {
    const parts = address.split(',').map(p => p.trim()).filter(Boolean)

    /** Helper: pulisce un segmento candidato a comune (rimuove CAP, numeri civici, sigla prov) */
    const cleanCandidate = (s: string): string => {
      return s
        .replace(/\b\d{5}\b/g, '')       // CAP
        .replace(/\(?\b[A-Z]{2}\b\)?/g, '') // sigla provincia (Torino TO o Torino (TO))
        .replace(/^\d+\s*/, '')          // numero civico iniziale
        .replace(/\s+\d+\s*$/, '')       // numero civico finale
        .replace(/\s+/g, ' ')
        .trim()
    }

    /** Helper: il segmento è un indirizzo (contiene via/corso/...)? */
    const isStreet = (s: string): boolean =>
      /\b(via|viale|corso|piazza|p\.zza|p\.za|largo|vicolo|str(?:ada)?\.?|strada\s+\S+|loc(?:alit\u00e0)?\.?)\b/i.test(s)

    if (parts.length >= 3) {
      // 3+ segmenti: penultimo è il comune (gestione storica)
      const candidate = cleanCandidate(parts[parts.length - 2])
      if (candidate.length >= 2 && /[a-zA-Z]/.test(candidate)) {
        out.comune = candidate
      }
    } else if (parts.length === 2) {
      // 2 segmenti: se il primo è un indirizzo (via/corso/...) → l'ULTIMO è il comune
      const last = cleanCandidate(parts[1])
      if (isStreet(parts[0]) && last.length >= 2 && /[a-zA-Z]/.test(last)) {
        out.comune = last
      } else {
        // Caso speciale: 2 segmenti senza street keyword (es. "Roma, RM")
        const penultimo = cleanCandidate(parts[0])
        if (penultimo.length >= 2 && /[a-zA-Z]/.test(penultimo)) {
          out.comune = penultimo
        }
      }
    }
  }

  // Strategia 4: cerca una città italiana nota nel testo (fallback robusto).
  // Funziona anche su input minimali tipo "Via Foo 1 Torino" senza virgole.
  if (!out.comune) {
    const lower = address.toLowerCase()
    // Cerca tra i comuni del dataset principale (sono i 180 capoluoghi/grandi città)
    for (const candidateComune of Object.keys(SEISMIC_ZONES_BY_COMUNE)) {
      // candidateComune è gi\u00e0 normalizzato (lowercase senza accenti)
      const re = new RegExp(`\\b${candidateComune.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')
      if (re.test(lower)) {
        out.comune = candidateComune
        break
      }
    }
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOOKUP ZONA SISMICA
// ─────────────────────────────────────────────────────────────────────────────

export interface SeismicLookupResult {
  fact: SeismicRiskFact | null
  matchType: 'comune' | 'region-fallback' | 'unknown'
  comuneFound?: string
  regionUsed?: string
  warnings: string[]
}

/**
 * Cerca la zona sismica di un comune. Se non trovato, fallback regionale.
 */
export function lookupSeismicZone(parts: AddressParts): SeismicLookupResult {
  const warnings: string[] = []

  // Tenta lookup per comune
  if (parts.comune) {
    const normalized = normalizeComuneName(parts.comune)
    const direct = SEISMIC_ZONES_BY_COMUNE[normalized]
    if (direct) {
      return {
        fact: {
          zone: direct.zone,
          pga: direct.pga,
          label: zoneLabel(direct.zone),
          source: 'DPC Classificazione Sismica 2015',
        },
        matchType: 'comune',
        comuneFound: parts.comune,
        warnings,
      }
    }
    warnings.push(`Comune "${parts.comune}" non presente nel dataset principale (180 città italiane). Fallback regionale.`)
  }

  // Fallback: regione tramite provincia
  if (parts.provincia) {
    const region = PROVINCE_TO_REGION[parts.provincia]
    if (region) {
      const regionZone = SEISMIC_ZONE_BY_REGION[region]
      if (regionZone) {
        warnings.push(`Stima basata su regione "${region}" (range zone tipico: ${regionZone.range}). Per pricing definitivo verificare il comune specifico nel database DPC.`)
        return {
          fact: {
            zone: regionZone.zone,
            pga: regionZone.pga,
            label: zoneLabel(regionZone.zone) + ' (stima regionale)',
            source: 'DPC Classificazione Sismica 2015 (fallback regionale)',
          },
          matchType: 'region-fallback',
          regionUsed: region,
          warnings,
        }
      }
    }
  }

  // Niente trovato
  warnings.push('Indirizzo non sufficientemente specifico per determinare la zona sismica.')
  return {
    fact: null,
    matchType: 'unknown',
    warnings,
  }
}

function zoneLabel(zone: 1 | 2 | 3 | 4): string {
  switch (zone) {
    case 1: return 'Zona 1 — Sismicità ALTA (PGA > 0.25g)'
    case 2: return 'Zona 2 — Sismicità MEDIO-ALTA (PGA 0.15-0.25g)'
    case 3: return 'Zona 3 — Sismicità MEDIO-BASSA (PGA 0.05-0.15g)'
    case 4: return 'Zona 4 — Sismicità BASSA (PGA < 0.05g)'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  IMPATTO SUL PREMIO POLIZZA ALL-RISK
//
//  Riferimento: ANIA — Maggiorazioni e sconti tipici per zona sismica
//  applicati alle polizze Globale Fabbricati / All-Risk.
// ─────────────────────────────────────────────────────────────────────────────

function premiumImpactForZone(zone: 1 | 2 | 3 | 4): { direction: 'discount' | 'premium' | 'neutral'; percentMin: number; percentMax: number; rationale: string } {
  switch (zone) {
    case 1:
      return {
        direction: 'premium',
        percentMin: 25,
        percentMax: 50,
        rationale: 'Zona 1 (alta sismicità): maggiorazione tipica 25-50% per polizze All-Risk.',
      }
    case 2:
      return {
        direction: 'premium',
        percentMin: 10,
        percentMax: 25,
        rationale: 'Zona 2 (media-alta): maggiorazione tipica 10-25%.',
      }
    case 3:
      return {
        direction: 'neutral',
        percentMin: -5,
        percentMax: 10,
        rationale: 'Zona 3 (media-bassa): premio in linea con la media nazionale.',
      }
    case 4:
      return {
        direction: 'discount',
        percentMin: -15,
        percentMax: -5,
        rationale: 'Zona 4 (bassa): sconto tipico 5-15% per zone non sismiche.',
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL SCORE 0-100
// ─────────────────────────────────────────────────────────────────────────────

function zoneToGlobalScore(zone: 1 | 2 | 3 | 4): number {
  // Zona 1 → 80 (high risk)
  // Zona 2 → 55
  // Zona 3 → 30
  // Zona 4 → 10 (low risk)
  switch (zone) {
    case 1: return 80
    case 2: return 55
    case 3: return 30
    case 4: return 10
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyzeSeismicInput {
  address: string
  /** Comune già fornito (skippa parsing) */
  comune?: string
  /** Provincia già fornita */
  provincia?: string
}

/**
 * Analisi rischio sismico completa per un indirizzo italiano.
 */
export function analyzeSeismicRisk(input: AnalyzeSeismicInput): GeoRiskScore {
  // Parse o usa input diretto
  const parts: AddressParts = input.comune || input.provincia
    ? {
        raw: input.address,
        comune: input.comune,
        provincia: input.provincia?.toUpperCase(),
      }
    : parseAddress(input.address)

  const lookup = lookupSeismicZone(parts)

  const out: GeoRiskScore = {
    address: input.address,
    comune: parts.comune,
    provincia: parts.provincia,
    globalScore: 50, // default neutro
  }

  if (lookup.fact) {
    out.seismic = lookup.fact
    out.globalScore = zoneToGlobalScore(lookup.fact.zone)
    out.premiumImpact = premiumImpactForZone(lookup.fact.zone)
  }

  return out
}
