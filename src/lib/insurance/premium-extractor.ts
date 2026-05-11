/**
 * Premium Extractor — analisi premi assicurativi + opportunità commerciali
 *
 * Combina i dati di bilancio (gratuiti, da `balance-sheet.ts`) con i benchmark
 * settoriali (`sector-benchmarks.ts`) per produrre un Insurance Footprint
 * completo dell'azienda.
 *
 * REGOLE D'ORO:
 *   - Dati "declared" → estratti DIRETTAMENTE da bilancio depositato (verificabili)
 *   - Dati "computed" → calcolati matematicamente da dati declared
 *   - Dati "estimated" → stime basate su benchmark IVASS, SEMPRE in range
 *   - Mai single-value se è una stima
 *   - Mai inventare un dato se non c'è
 */

import type {
  InsuranceFootprint,
  InsuranceOpportunity,
  ValuedFact,
  RangeFact,
  BalanceSheetData,
  BalanceSheetYear,
} from './types'
import {
  getBenchmarkByAteco,
  estimatePremiumsBySector,
  estimateVehiclesBySector,
  atecoToLetter,
} from './sector-benchmarks'

// ─────────────────────────────────────────────────────────────────────────────
//  COSTANTI di pricing (welfare, RC Auto, ecc.)
//
//  Fonte: ANIA Bollettino Statistico 2023, IVASS osservatorio prezzi medi
//  https://www.ania.it / https://servizi.ivass.it/RpcStatPubb
// ─────────────────────────────────────────────────────────────────────────────

/** Premio annuo medio polizza Vita collettiva per dipendente (€) */
const PREMIUM_VITA_COLLETTIVA_PER_EMPLOYEE = { min: 350, mid: 500, max: 700 }

/** Premio annuo medio polizza Sanitaria collettiva per dipendente (€) */
const PREMIUM_HEALTH_PER_EMPLOYEE = { min: 450, mid: 650, max: 950 }

/** Premio annuo medio polizza Infortuni cumulativa per dipendente (€) */
const PREMIUM_ACCIDENT_PER_EMPLOYEE = { min: 180, mid: 280, max: 400 }

/** Premio annuo TFM amministratori (intervallo medio per società) */
const PREMIUM_TFM_RANGE = { min: 4000, mid: 8000, max: 15000 }

/** Premio medio RC Auto flotta per veicolo (€/anno) — settore-dipendente */
function rcAutoFleetPerVehicle(atecoLetter: string): { min: number; mid: number; max: number } {
  // Trasporti H: pesanti con sinistrosità alta
  if (atecoLetter === 'H') return { min: 2500, mid: 3800, max: 5500 }
  // Costruzioni F: furgoni cantiere
  if (atecoLetter === 'F') return { min: 1800, mid: 2500, max: 3500 }
  // Commercio G: furgoni consegna
  if (atecoLetter === 'G') return { min: 1400, mid: 1900, max: 2600 }
  // Manifatturiero/Agricoltura
  if (atecoLetter === 'C' || atecoLetter === 'A') return { min: 1500, mid: 2100, max: 2900 }
  // Default: auto aziendali leggere
  return { min: 1200, mid: 1600, max: 2200 }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function multiply(r: { min: number; mid: number; max: number }, n: number): { min: number; mid: number; max: number } {
  return {
    min: Math.round(r.min * n),
    mid: Math.round(r.mid * n),
    max: Math.round(r.max * n),
  }
}

function asRange(r: { min: number; mid: number; max: number }, source: string, rationale: string): RangeFact {
  return {
    min: r.min,
    mid: r.mid,
    max: r.max,
    confidence: 'estimated',
    source,
    rationale,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERATORE OPPORTUNITÀ COMMERCIALI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera la lista di opportunità commerciali assicurative basate sul profilo
 * dell'azienda (settore, dipendenti, veicoli stimati, ecc.).
 *
 * Le opportunità sono ranked per priorità commerciale (5 = top, 1 = low).
 */
export function generateOpportunities(
  atecoLetter: string,
  bs: BalanceSheetYear | null | undefined,
): InsuranceOpportunity[] {
  const opps: InsuranceOpportunity[] = []
  const employees = bs?.employees ?? 0
  const turnover = bs?.turnover ?? 0
  const tangibleAssets = bs?.tangibleAssets ?? 0

  // ───────── 1. RC AUTO FLOTTA (se settore con veicoli + dipendenti) ─────────
  const vehiclesEst = estimateVehiclesBySector(undefined, employees, turnover)
  // forziamo l'uso del letter
  const v = (atecoLetter === 'H')
    ? { min: Math.max(1, Math.round(employees * 0.6)), mid: Math.max(2, Math.round(employees * 0.9)), max: Math.max(3, Math.round(employees * 1.3)) }
    : (atecoLetter === 'F')
      ? { min: Math.max(1, Math.round(employees * 0.2)), mid: Math.max(2, Math.round(employees * 0.35)), max: Math.max(3, Math.round(employees * 0.5)) }
      : (atecoLetter === 'G')
        ? { min: Math.max(1, Math.round(employees * 0.15)), mid: Math.max(1, Math.round(employees * 0.25)), max: Math.max(2, Math.round(employees * 0.4)) }
        : (atecoLetter === 'C' || atecoLetter === 'A')
          ? { min: Math.max(0, Math.round(employees * 0.08)), mid: Math.max(1, Math.round(employees * 0.15)), max: Math.max(2, Math.round(employees * 0.25)) }
          : { min: 0, mid: Math.max(0, Math.round(employees * 0.05)), max: Math.max(1, Math.round(employees * 0.15)) }

  if (v.max >= 2 && employees > 0) {
    const perVehicle = rcAutoFleetPerVehicle(atecoLetter)
    const fleetPremium = {
      min: v.min * perVehicle.min,
      mid: v.mid * perVehicle.mid,
      max: v.max * perVehicle.max,
    }
    opps.push({
      ramo: 'RC Auto Flotte + Kasko',
      estimatedAnnualPremium: asRange(
        fleetPremium,
        'ANIA tariffari medi 2023',
        `${v.mid} veicoli stimati × ${perVehicle.mid}€ medio per settore ${atecoLetter}`,
      ),
      priority: atecoLetter === 'H' ? 5 : 4,
      rationale: `Stima ${v.min}-${v.max} veicoli aziendali (settore ${atecoLetter}, ${employees} dipendenti). RC Auto flotte è il ramo più redditizio per il broker (commissioni 12-18%).`,
      category: 'auto',
    })
  }

  // ───────── 2. WELFARE COLLETTIVO (Vita + Sanitaria + Infortuni) ─────────
  if (employees >= 5) {
    // Vita collettiva
    opps.push({
      ramo: 'Polizza Vita Collettiva (TCM dipendenti)',
      estimatedAnnualPremium: asRange(
        multiply(PREMIUM_VITA_COLLETTIVA_PER_EMPLOYEE, employees),
        'ANIA Bollettino 2023',
        `${employees} dipendenti × premio medio ${PREMIUM_VITA_COLLETTIVA_PER_EMPLOYEE.mid}€/anno`,
      ),
      priority: employees >= 50 ? 5 : 4,
      rationale: `${employees} dipendenti — fascia ideale per polizza vita collettiva. Welfare deducibile fiscalmente (art. 51 TUIR).`,
      category: 'life',
    })
    // Sanitaria collettiva
    opps.push({
      ramo: 'Polizza Sanitaria Collettiva',
      estimatedAnnualPremium: asRange(
        multiply(PREMIUM_HEALTH_PER_EMPLOYEE, employees),
        'ANIA Bollettino 2023',
        `${employees} dipendenti × premio medio ${PREMIUM_HEALTH_PER_EMPLOYEE.mid}€/anno`,
      ),
      priority: employees >= 30 ? 5 : 3,
      rationale: `Welfare sanitario: trend +15% YoY in Italia. Forte leva di retention dipendenti.`,
      category: 'health',
    })
    // Infortuni
    opps.push({
      ramo: 'Polizza Infortuni Cumulativa Dipendenti',
      estimatedAnnualPremium: asRange(
        multiply(PREMIUM_ACCIDENT_PER_EMPLOYEE, employees),
        'ANIA Bollettino 2023',
        `${employees} dipendenti × premio medio ${PREMIUM_ACCIDENT_PER_EMPLOYEE.mid}€/anno`,
      ),
      priority: ['F', 'C', 'B', 'H'].includes(atecoLetter) ? 4 : 3,
      rationale: `Settore ${atecoLetter} richiede coperture infortuni rinforzate ${atecoLetter === 'F' || atecoLetter === 'B' ? '(alta sinistrosità)' : ''}.`,
      category: 'employee',
    })
  }

  // ───────── 3. TFM AMMINISTRATORI ─────────
  if (turnover >= 1_000_000 || employees >= 10) {
    opps.push({
      ramo: 'TFM Amministratori (Trattamento Fine Mandato)',
      estimatedAnnualPremium: asRange(
        PREMIUM_TFM_RANGE,
        'ANIA + Confindustria',
        'Polizza TFM standard per società di capitali strutturate',
      ),
      priority: 3,
      rationale: 'Strumento fiscale per accantonamento liquidazione amministratori. Deducibilità integrale per la società.',
      category: 'employee',
    })
  }

  // ───────── 4. ALL-RISK MACCHINARI / IMMOBILIZZAZIONI ─────────
  if (tangibleAssets >= 100_000) {
    // Premio All-Risk: 0.3-0.6% del valore asset
    const allRiskMin = Math.round(tangibleAssets * 0.003)
    const allRiskMid = Math.round(tangibleAssets * 0.0045)
    const allRiskMax = Math.round(tangibleAssets * 0.006)
    opps.push({
      ramo: 'All-Risk Macchinari e Impianti',
      estimatedAnnualPremium: asRange(
        { min: allRiskMin, mid: allRiskMid, max: allRiskMax },
        'IVASS osservatorio prezzi 2023',
        `${(tangibleAssets / 1000).toFixed(0)}k€ immobilizzazioni × 0.45% premio medio`,
      ),
      priority: tangibleAssets >= 1_000_000 ? 5 : 3,
      rationale: `Immobilizzazioni materiali ${(tangibleAssets / 1000).toFixed(0)}k€ — asset assicurabili sostanziosi.`,
      category: 'asset',
    })
  }

  // ───────── 5. INCENDIO / GLOBALE FABBRICATO ─────────
  if (turnover >= 500_000) {
    const incendioMin = Math.round(turnover * 0.0008)
    const incendioMid = Math.round(turnover * 0.0015)
    const incendioMax = Math.round(turnover * 0.0025)
    opps.push({
      ramo: 'Incendio / Globale Fabbricato Sede',
      estimatedAnnualPremium: asRange(
        { min: incendioMin, mid: incendioMid, max: incendioMax },
        'IVASS settore-medio',
        `Stima sulla base del fatturato (proxy dimensione sede)`,
      ),
      priority: 3,
      rationale: 'Polizza base per protezione sede; eventuali vincoli da mutui o finanziamenti vanno verificati.',
      category: 'asset',
    })
  }

  // ───────── 6. RC PROFESSIONALE / D&O ─────────
  if (['M', 'K', 'J', 'Q'].includes(atecoLetter)) {
    opps.push({
      ramo: atecoLetter === 'Q' ? 'RC Sanitaria (L.24/2017)' : 'RC Professionale + D&O',
      estimatedAnnualPremium: asRange(
        atecoLetter === 'Q'
          ? { min: 4000, mid: 8000, max: 18000 }
          : { min: 1500, mid: 3500, max: 8000 },
        'IVASS Bollettino RC 2023',
        atecoLetter === 'Q' ? 'RC sanitaria da verificare nel perimetro L.24/2017' : 'RC professionale/E&O settoriale da verificare',
      ),
      priority: atecoLetter === 'Q' ? 5 : 4,
      rationale: atecoLetter === 'Q'
        ? 'Da verificare per strutture/professionisti sanitari nel perimetro L.24/2017'
        : `Settore ${atecoLetter}: RC professionale/E&O da verificare su albo, contratti e responsabilità verso clienti`,
      category: 'liability',
    })
  }

  // ───────── 7. CYBER RISK (informatica + finanza + sanità) ─────────
  if (['J', 'K', 'Q'].includes(atecoLetter) && (employees >= 10 || turnover >= 500_000)) {
    opps.push({
      ramo: 'Cyber Risk',
      estimatedAnnualPremium: asRange(
        { min: 2500, mid: 5000, max: 12000 },
        'IVASS Cyber Outlook 2024',
        'Settore ad alto rischio informatico',
      ),
      priority: 4,
      rationale: `Cyber attacchi +40% YoY in Italia. Trend di mercato in forte crescita.`,
      category: 'liability',
    })
  }

  // ───────── 8. CAUZIONI ANAC (per settore costruzioni/servizi PA) ─────────
  if (['F', 'E'].includes(atecoLetter)) {
    opps.push({
      ramo: 'Cauzioni ANAC (gare pubbliche)',
      estimatedAnnualPremium: asRange(
        { min: 2000, mid: 6000, max: 25000 },
        'IVASS ramo cauzioni',
        'Stima base settore costruzioni/servizi PA',
      ),
      priority: 4,
      rationale: 'Settore con frequenti gare pubbliche → cauzioni provvisorie + definitive obbligatorie.',
      category: 'cauzione',
    })
  }

  // Ordina per priorità decrescente, poi per premio mid decrescente
  return opps.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.estimatedAnnualPremium.mid - a.estimatedAnnualPremium.mid
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  COSTRUTTORE INSURANCE FOOTPRINT
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildFootprintInput {
  piva: string
  ragioneSociale?: string
  ateco?: string
  atecoDescription?: string
  citta?: string
  /** Numero sedi/unità locali se noto */
  locationsCount?: number
  /** BalanceSheet ottenuto da fetchBalanceSheetFree */
  balance: BalanceSheetData
  /** Sources già accumulate */
  sourcesUsed?: string[]
  fetchStartTs: number
}

/**
 * Costruisce l'Insurance Footprint completo a partire dai dati di bilancio.
 * SEMPRE prudente: dichiara declared solo se il dato è esplicitamente presente,
 * fornisce stime sempre in range, non inventa nulla.
 */
export function buildInsuranceFootprint(input: BuildFootprintInput): InsuranceFootprint {
  const bs = input.balance.latest
  const atecoLetter = atecoToLetter(input.ateco)
  const benchmark = getBenchmarkByAteco(input.ateco)
  const warnings: string[] = []

  // ─── WARNING di QUALITÀ DATI ─────────────────────────────────────────
  if (atecoLetter === '?') {
    warnings.push(
      '⚠️ SETTORE NON IDENTIFICATO: il codice ATECO non è stato trovato in fonti pubbliche. ' +
      'Le stime di premio mostrate sono basate su benchmark NAZIONALI MEDI, non specifici del settore. ' +
      'Per stime accurate è necessario integrare manualmente l\'ATECO della società.'
    )
  }

  // Propaga i warning di data quality del bilancio (già human-friendly grazie a
  // aggregateParsingWarnings — non serve prefisso ridondante)
  if (Array.isArray(input.balance.dataQualityWarnings)) {
    for (const w of input.balance.dataQualityWarnings) {
      warnings.push(w)
    }
  }

  // ─── ASSET ────────────────────────────────────────────────────────────
  const assets: InsuranceFootprint['assets'] = {}

  if (bs?.tangibleAssets && bs.tangibleAssets > 0) {
    assets.tangibleAssetsValue = {
      value: bs.tangibleAssets,
      confidence: 'declared',
      source: input.balance.source,
      year: bs.year,
      note: 'Stato Patrimoniale B.II Immobilizzazioni materiali nette',
    }
  }

  if (bs?.employees && bs.employees > 0) {
    assets.employees = {
      value: bs.employees,
      confidence: 'declared',
      source: input.balance.source,
      year: bs.year,
    }
  }

  if (bs?.totalStaffCost && bs.totalStaffCost > 0) {
    assets.payroll = {
      value: bs.totalStaffCost,
      confidence: 'declared',
      source: input.balance.source,
      year: bs.year,
      note: 'B.9 Costi per il personale',
    }
  }

  if (typeof input.locationsCount === 'number' && input.locationsCount > 0) {
    assets.locations = {
      value: input.locationsCount,
      confidence: 'declared',
      source: 'registro_imprese',
    }
  }

  // Veicoli stimati
  if (bs?.employees && bs.employees > 0) {
    const v = estimateVehiclesBySector(input.ateco, bs.employees, bs.turnover || 0)
    if (v.max >= 1) {
      assets.estimatedVehicles = {
        min: v.min,
        mid: v.mid,
        max: v.max,
        confidence: 'estimated',
        source: 'sector-benchmark',
        rationale: v.rationale,
      }
    }
  }

  // ─── PREMI ASSICURATIVI ───────────────────────────────────────────────
  const premiums: InsuranceFootprint['premiums'] = {}

  // Dichiarato (raro per PMI)
  if (bs?.insurancePremiumsDeclared && bs.insurancePremiumsDeclared > 0) {
    premiums.declared = {
      value: bs.insurancePremiumsDeclared,
      confidence: 'declared',
      source: input.balance.source,
      year: bs.year,
      note: 'Premi assicurativi disaggregati dal bilancio (Nota Integrativa)',
    }
  } else {
    warnings.push('Premi assicurativi non disaggregati nel bilancio depositato (normale per PMI in regime abbreviato).')
  }

  // Stima settoriale (sempre presente se abbiamo turnover)
  if (bs?.turnover && bs.turnover > 0) {
    const est = estimatePremiumsBySector(bs.turnover, input.ateco)
    premiums.estimated = {
      min: est.min,
      mid: est.mid,
      max: est.max,
      confidence: 'estimated',
      source: 'IVASS Bollettino Statistico 2023',
      rationale: `Settore ${atecoLetter} (${benchmark.description}): premi medi ${(benchmark.premiumRatioMin * 100).toFixed(1)}-${(benchmark.premiumRatioMax * 100).toFixed(1)}% del fatturato`,
    }

    // Fair market = premio "competitivo" (10-15% sotto la mediana)
    premiums.fairMarket = {
      min: Math.round(est.min * 0.85),
      mid: Math.round(est.mid * 0.90),
      max: Math.round(est.max * 0.95),
      confidence: 'computed',
      source: 'IVASS + analisi competitiva',
      rationale: 'Premio "fair market" = mediana settoriale × 0.90 (mercato competitivo)',
    }

    // Saving opportunity: solo se abbiamo declared
    if (premiums.declared) {
      const declared = premiums.declared.value
      const fairMid = premiums.fairMarket.mid
      if (declared > fairMid) {
        premiums.savingOpportunity = {
          min: Math.round(declared - premiums.fairMarket.max),
          mid: Math.round(declared - premiums.fairMarket.mid),
          max: Math.round(declared - premiums.fairMarket.min),
          confidence: 'computed',
          source: 'declared - fairMarket',
          rationale: `Pagamento attuale ${declared.toLocaleString('it-IT')}€ vs fair market ${fairMid.toLocaleString('it-IT')}€ → opportunità di risparmio`,
        }
      }
    }
  } else {
    warnings.push('Fatturato non disponibile: stima premi non calcolabile.')
  }

  // ─── OPPORTUNITÀ ──────────────────────────────────────────────────────
  const opportunities = generateOpportunities(atecoLetter, bs)

  // ─── TREND (se abbiamo più anni — qui solo placeholder, gli anni multi vengono dopo) ─
  let trends: InsuranceFootprint['trends'] | undefined
  if (input.balance.years.length >= 2) {
    const latest = input.balance.years[0]
    const oldest = input.balance.years[input.balance.years.length - 1]
    const yearsDiff = latest.year - oldest.year
    if (yearsDiff > 0 && latest.turnover && oldest.turnover && oldest.turnover > 0) {
      trends = {
        turnoverGrowth3y: ((latest.turnover - oldest.turnover) / oldest.turnover) * 100,
      }
    }
  }

  // ─── BUILD ────────────────────────────────────────────────────────────
  return {
    piva: input.piva,
    ragioneSociale: input.ragioneSociale,
    ateco: input.ateco,
    atecoDescription: input.atecoDescription,
    sectorMacro: benchmark.description,
    premiums,
    assets,
    opportunities,
    trends,
    meta: {
      sourcesUsed: input.sourcesUsed || [input.balance.source],
      fetchedAt: input.balance.fetchedAt,
      durationMs: Date.now() - input.fetchStartTs,
      warnings,
    },
  }
}
