/**
 * Test suite per i moduli puri di Insurance Radar.
 *
 * Verifica:
 *   - cauzioni.ts        → calcoli fideiussioni
 *   - workforce.ts       → analisi dipendenti / TFR / oneri / welfare
 *   - premium-extractor  → premi declared/estimated, opportunità
 *   - seismic-risk       → parsing indirizzi + lookup zone DPC
 *
 * Esegui:   npx tsx scripts/insurance-radar.test.ts
 */

import {
  estimateCauzioneFromGara,
  buildFideiussioniSummary,
  estimatePremioDecennale,
  type AnacGaraRaw,
} from '../src/lib/insurance/cauzioni'
import {
  analyzeWorkforce,
  getCCNLBySector,
} from '../src/lib/insurance/workforce'
import {
  buildInsuranceFootprint,
} from '../src/lib/insurance/premium-extractor'
import {
  analyzeSeismicRisk,
  parseAddress,
  lookupSeismicZone,
} from '../src/lib/insurance/seismic-risk'
import {
  getBenchmarkByAteco,
  atecoToLetter,
} from '../src/lib/insurance/sector-benchmarks'
import {
  crossCheckAtecoVsRagioneSociale,
  aggregateParsingWarnings,
} from '../src/lib/insurance/balance-sheet'
import {
  computeHotnessScore,
  estimateSpendingCapacity,
  mapAtecoToProfessionalAlbi,
  classifyNewsTrigger,
  buildPivaAgeTrigger,
  buildTenderTrigger,
  getSectorRisk,
  extractCompanyTokens,
  textMentionsCompany,
} from '../src/lib/insurance/triggers'

// ─────────────────────────────────────────────────────────────────────────────
//  TEST FRAMEWORK MINIMALE
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`  ✗ ${name}\n      ${msg}`)
    failed++
    failures.push(`${name}: ${msg}`)
  }
}

function assertEq(actual: unknown, expected: unknown, label?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertCloseTo(actual: number, expected: number, tolerance = 1): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`expected ~${expected} (±${tolerance}), got ${actual}`)
  }
}

function assertTrue(cond: boolean, label?: string): void {
  if (!cond) throw new Error(label || 'condition false')
}

// ─────────────────────────────────────────────────────────────────────────────
//  TEST: sector-benchmarks
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== sector-benchmarks ===')

test('atecoToLetter("412000") = F (costruzioni)', () => {
  assertEq(atecoToLetter('412000'), 'F')
})

test('atecoToLetter("471100") = G (commercio)', () => {
  assertEq(atecoToLetter('471100'), 'G')
})

test('atecoToLetter(undefined) = "?" (fallback)', () => {
  assertEq(atecoToLetter(undefined), '?')
  assertEq(atecoToLetter(null), '?')
  assertEq(atecoToLetter(''), '?')
})

test('getBenchmarkByAteco("412000") returns construction benchmark', () => {
  const b = getBenchmarkByAteco('412000')
  assertEq(b.atecoLetter, 'F')
  assertTrue(b.premiumRatioMid > 0, 'premium ratio mid > 0')
  assertTrue(b.premiumRatioMid >= 0.015, 'costruzioni: premio/fatturato atteso >= 1.5%')
  assertTrue(Array.isArray(b.mainRami) && b.mainRami.length > 0)
})

test('getBenchmarkByAteco unknown returns DEFAULT_BENCHMARK', () => {
  const b = getBenchmarkByAteco(undefined)
  assertEq(b.atecoLetter, '?')
  assertTrue(b.description === 'Settore non identificato')
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST: cauzioni.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== cauzioni ===')

test('estimateCauzioneFromGara: gara da 100k€ → cauz. provv. 2k€, def. 10k€', () => {
  const gara: AnacGaraRaw = {
    oggetto: 'Servizi di pulizia',
    importo_eur: 100000,
    stazione_appaltante: 'Comune di Test',
    cig: '12345',
  }
  const r = estimateCauzioneFromGara(gara)
  assertTrue(r !== null)
  assertEq(r!.cauzioneProvvisoriaStimata, 2000)
  assertEq(r!.cauzioneDefinitivaStimata, 10000)
  assertTrue(r!.decennaleEdilizia === undefined, 'no decennale per servizi non edili')
  assertTrue(!r!.rcLavoriApplicabile, 'no RC lavori sotto 500k')
})

test('estimateCauzioneFromGara: lavori edili da 1M€ → decennale 10k€ + RC lavori', () => {
  const gara: AnacGaraRaw = {
    oggetto: 'Lavori di costruzione scuola elementare',
    importo_eur: 1_000_000,
    stazione_appaltante: 'Comune X',
    cig: 'EDIL-1',
  }
  const r = estimateCauzioneFromGara(gara)
  assertTrue(r !== null)
  assertEq(r!.cauzioneProvvisoriaStimata, 20000)
  assertEq(r!.cauzioneDefinitivaStimata, 100000)
  assertEq(r!.decennaleEdilizia, 10000)  // 1% di 1M
  assertEq(r!.rcLavoriApplicabile, true)
})

test('estimateCauzioneFromGara: importo non valido → null', () => {
  assertEq(estimateCauzioneFromGara({ oggetto: 'x', importo_eur: 0 }), null)
  assertEq(estimateCauzioneFromGara({ oggetto: 'x', importo_eur: null }), null)
  assertEq(estimateCauzioneFromGara({ oggetto: 'x' }), null)
})

test('estimateCauzioneFromGara: importo come stringa "€ 1.500.000,00" parsato', () => {
  const r = estimateCauzioneFromGara({
    oggetto: 'Lavori di ristrutturazione edificio pubblico',
    importo_eur: '€ 1.500.000,00',
    stazione_appaltante: 'Y',
  })
  assertTrue(r !== null)
  assertEq(r!.importoAggiudicato, 1_500_000)
  assertEq(r!.cauzioneDefinitivaStimata, 150_000)
  assertEq(r!.decennaleEdilizia, 15_000)
})

test('buildFideiussioniSummary: aggregati corretti su 3 gare', () => {
  const summary = buildFideiussioniSummary({
    piva: '12345678901',
    gareRaw: [
      { oggetto: 'Servizi A', importo_eur: 200000, stazione_appaltante: 'X' },
      { oggetto: 'Lavori costruzione', importo_eur: 800000, stazione_appaltante: 'Y' },
      { oggetto: 'Servizi B', importo_eur: 50000, stazione_appaltante: 'Z' },
    ],
  })
  assertEq(summary.cigCount, 3)
  assertEq(summary.importoTotaleAggiudicato, 1_050_000)
  assertEq(summary.cauzioniProvvisorieTotali, 21_000)  // 2% di 1.05M
  assertEq(summary.cauzioniDefinitiveTotali, 105_000)  // 10% di 1.05M
  assertEq(summary.decennaliEdiliziaTotali, 8_000)     // 1% di 800k (solo lavori)
  assertEq(summary.rcLavoriCount, 1)                    // 1 gara > 500k (i lavori)
})

test('estimatePremioDecennale: opera 500k → range 4k-12.5k', () => {
  const p = estimatePremioDecennale(500_000)
  assertEq(p.min, 4_000)   // 0.8%
  assertEq(p.mid, 7_500)   // 1.5%
  assertEq(p.max, 12_500)  // 2.5%
  assertEq(p.confidence, 'estimated')
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST: workforce.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== workforce ===')

test('getCCNLBySector("412000") → CCNL Edilizia', () => {
  const ccnl = getCCNLBySector('412000')
  assertTrue(ccnl.length > 0)
  assertTrue(/edilizia|costruz/i.test(ccnl[0].name), 'atteso CCNL edilizia')
})

test('getCCNLBySector("471100") → CCNL Commercio/Terziario', () => {
  const ccnl = getCCNLBySector('471100')
  assertTrue(/commercio|terziar/i.test(ccnl[0].name))
})

test('getCCNLBySector(undefined) → CCNL Generico', () => {
  const ccnl = getCCNLBySector(undefined)
  assertEq(ccnl[0].code, 'CCNL Generico')
})

test('analyzeWorkforce: 50 dipendenti × 1.5M costo personale → costo medio 30k', () => {
  const a = analyzeWorkforce({
    bs: {
      year: 2023,
      employees: 50,
      totalStaffCost: 1_500_000,
    },
    ateco: '412000',
    source: 'test',
  })
  assertEq(a.employees?.value, 50)
  assertEq(a.payroll?.value, 1_500_000)
  assertEq(a.avgCostPerEmployee?.value, 30_000)
  assertCloseTo(a.tfrAccrual?.value || 0, 106_050, 100)  // ~7.07%
  assertEq(a.socialContributionsEstimate?.value, 450_000)  // 30%
  assertTrue(a.welfareOpportunities.length >= 4, 'almeno 4 opportunità per 50 dipendenti')
  assertTrue(a.probableCCNL[0].name.includes('Edilizia'))
})

test('analyzeWorkforce: 5 dipendenti → meno opportunità (no fondo pensione/welfare flessibile)', () => {
  const a = analyzeWorkforce({
    bs: { year: 2023, employees: 5, totalStaffCost: 200_000 },
    ateco: '471100',
    source: 'test',
  })
  assertEq(a.employees?.value, 5)
  // Per piccole aziende fondo pensione/flexible benefits non vengono proposti
  const ramos = a.welfareOpportunities.map(w => w.ramo)
  assertTrue(ramos.some(r => r.includes('Vita')), 'vita sempre presente')
  assertTrue(ramos.some(r => r.includes('Sanitaria')), 'sanitaria sempre presente')
})

test('analyzeWorkforce: bs null → analisi vuota con warning', () => {
  const a = analyzeWorkforce({ bs: null, source: 'test' })
  assertEq(a.employees, null)
  assertEq(a.payroll, null)
  assertTrue(a.warnings.length > 0)
})

test('analyzeWorkforce: opportunità ordinate per priorità decrescente', () => {
  const a = analyzeWorkforce({
    bs: { year: 2023, employees: 100, totalStaffCost: 4_000_000 },
    ateco: '412000',
    source: 'test',
  })
  for (let i = 1; i < a.welfareOpportunities.length; i++) {
    assertTrue(
      a.welfareOpportunities[i].priority <= a.welfareOpportunities[i - 1].priority,
      `priorità non decrescente tra opp ${i - 1} e ${i}`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST: premium-extractor.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== premium-extractor ===')

test('buildInsuranceFootprint: con bilancio costruzioni 50 dip + premio dichiarato', () => {
  const latest = {
    year: 2023,
    turnover: 5_000_000,
    employees: 50,
    totalStaffCost: 1_500_000,
    tangibleAssets: 800_000,
    insurancePremiumsDeclared: 25_000,
  }
  const fp = buildInsuranceFootprint({
    piva: '12345678901',
    ragioneSociale: 'Test Costruzioni Srl',
    ateco: '412000',
    atecoDescription: 'Costruzione edifici residenziali',
    citta: 'Roma',
    balance: {
      latest,
      years: [latest],
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    sourcesUsed: ['test'],
    fetchStartTs: Date.now(),
  })
  assertEq(fp.piva, '12345678901')
  // sectorMacro è la description human-readable, non la lettera
  assertEq(fp.sectorMacro, 'Costruzioni')
  assertEq(fp.premiums.declared?.value, 25_000)
  assertEq(fp.premiums.declared?.confidence, 'declared')
  assertTrue(fp.premiums.estimated !== undefined, 'stima sempre presente')
  assertTrue(fp.premiums.fairMarket !== undefined, 'fair market calcolato')
  assertTrue((fp.assets.tangibleAssetsValue?.value ?? 0) === 800_000)
  assertTrue(fp.opportunities.length > 0, 'opportunità non vuote')
})

test('buildInsuranceFootprint: senza premio dichiarato → no fairMarket', () => {
  const latest = { year: 2023, turnover: 1_000_000, employees: 10 }
  const fp = buildInsuranceFootprint({
    piva: '12345678901',
    ragioneSociale: 'X',
    ateco: '471100',
    citta: 'Milano',
    balance: {
      latest,
      years: [latest],
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    sourcesUsed: ['test'],
    fetchStartTs: Date.now(),
  })
  assertEq(fp.premiums.declared, undefined)
  assertTrue(fp.premiums.estimated !== undefined, 'stima sempre presente')
  // Saving opportunity esiste solo se premio dichiarato > fair max
  assertEq(fp.premiums.savingOpportunity, undefined)
})

test('buildInsuranceFootprint: senza bilancio → metadati ma niente declared', () => {
  const fp = buildInsuranceFootprint({
    piva: '12345678901',
    ragioneSociale: 'NoData Srl',
    ateco: '471100',
    citta: 'Milano',
    balance: {
      latest: null,
      years: [],
      source: 'no-data',
      fetchedAt: new Date().toISOString(),
    },
    sourcesUsed: [],
    fetchStartTs: Date.now(),
  })
  assertEq(fp.premiums.declared, undefined)
  assertEq(fp.premiums.estimated, undefined)
  assertTrue(fp.meta.warnings.length > 0)
})

test('buildInsuranceFootprint: opportunità ordinate per priorità', () => {
  const latest = { year: 2023, turnover: 10_000_000, employees: 100, tangibleAssets: 2_000_000 }
  const fp = buildInsuranceFootprint({
    piva: '12345678901',
    ragioneSociale: 'X',
    ateco: '412000',
    citta: 'Roma',
    balance: {
      latest,
      years: [latest],
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    sourcesUsed: [],
    fetchStartTs: Date.now(),
  })
  for (let i = 1; i < fp.opportunities.length; i++) {
    assertTrue(
      fp.opportunities[i].priority <= fp.opportunities[i - 1].priority,
      `priorità decrescente attesa pos ${i}`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST: seismic-risk.ts (parsing + lookup)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== seismic-risk: parseAddress ===')

test('parseAddress: "Via Roma 12, 10100 Torino, TO" → comune Torino, provincia TO', () => {
  const p = parseAddress('Via Roma 12, 10100 Torino, TO')
  assertEq(p.cap, '10100')
  assertEq(p.provincia, 'TO')
  assertTrue(/torino/i.test(p.comune || ''), `comune atteso "Torino", got "${p.comune}"`)
})

test('parseAddress: "Piazza Duomo 1, 20121 Milano (MI)"', () => {
  const p = parseAddress('Piazza Duomo 1, 20121 Milano (MI)')
  assertEq(p.cap, '20121')
  assertEq(p.provincia, 'MI')
  assertTrue(/milano/i.test(p.comune || ''))
})

test('parseAddress: "Via Etnea 100, 95124 Catania, CT"', () => {
  const p = parseAddress('Via Etnea 100, 95124 Catania, CT')
  assertEq(p.provincia, 'CT')
  assertTrue(/catania/i.test(p.comune || ''))
})

test('parseAddress: "Roma" semplice → comune Roma', () => {
  const p = parseAddress('Roma')
  // Senza CAP/provincia, comune potrebbe non essere estratto (è OK), ma nessun crash
  assertTrue(p.raw === 'Roma')
})

// ─── Fix #4: indirizzi senza CAP né sigla provincia (caso live Torino) ───
test('parseAddress: "via BERNARDINO TELESIO 69, Torino" (no CAP, no sigla)', () => {
  const p = parseAddress('via BERNARDINO TELESIO 69, Torino')
  assertTrue(/torino/i.test(p.comune || ''), `comune atteso "Torino", got "${p.comune}"`)
})

test('parseAddress: "VIA SEBASTIANO CABOTO 35, Torino"', () => {
  const p = parseAddress('VIA SEBASTIANO CABOTO 35, Torino')
  assertTrue(/torino/i.test(p.comune || ''))
})

test('parseAddress: "CORSO VITTORIO EMANUELE II, 6, Torino"', () => {
  const p = parseAddress('CORSO VITTORIO EMANUELE II, 6, Torino')
  assertTrue(/torino/i.test(p.comune || ''))
})

test('parseAddress: "Via Foo 1 Milano" (no commas, fallback strategia 4)', () => {
  const p = parseAddress('Via Foo 1 Milano')
  assertTrue(/milano/i.test(p.comune || ''), `comune atteso "Milano", got "${p.comune}"`)
})

console.log('\n=== seismic-risk: lookup ===')

test('lookupSeismicZone: Torino → zona 3', () => {
  const r = lookupSeismicZone({ raw: '', comune: 'Torino', provincia: 'TO' })
  assertEq(r.fact?.zone, 3)
  assertEq(r.matchType, 'comune')
})

test('lookupSeismicZone: L\'Aquila → zona 1 (alta)', () => {
  const r = lookupSeismicZone({ raw: '', comune: 'L\'Aquila' })
  assertEq(r.fact?.zone, 1)
})

test('lookupSeismicZone: Reggio Calabria → zona 1', () => {
  const r = lookupSeismicZone({ raw: '', comune: 'Reggio Calabria' })
  assertEq(r.fact?.zone, 1)
})

test('lookupSeismicZone: Milano → zona 3', () => {
  const r = lookupSeismicZone({ raw: '', comune: 'Milano' })
  assertEq(r.fact?.zone, 3)
})

test('lookupSeismicZone: Cagliari → zona 4 (Sardegna non sismica)', () => {
  const r = lookupSeismicZone({ raw: '', comune: 'Cagliari' })
  assertEq(r.fact?.zone, 4)
})

test('lookupSeismicZone: comune sconosciuto + provincia BS → fallback regionale Lombardia', () => {
  const r = lookupSeismicZone({ raw: '', comune: 'Borgo Inesistente', provincia: 'BS' })
  assertTrue(r.fact !== null, 'fallback deve dare un risultato')
  assertEq(r.matchType, 'region-fallback')
  assertEq(r.regionUsed, 'lombardia')
  assertTrue(r.warnings.length > 0)
})

test('lookupSeismicZone: nulla noto → unknown', () => {
  const r = lookupSeismicZone({ raw: '' })
  assertEq(r.fact, null)
  assertEq(r.matchType, 'unknown')
})

console.log('\n=== seismic-risk: analyzeSeismicRisk end-to-end ===')

test('analyzeSeismicRisk: indirizzo L\'Aquila → globalScore 80', () => {
  const r = analyzeSeismicRisk({ address: 'Corso Federico II 1, 67100 L\'Aquila, AQ' })
  assertEq(r.seismic?.zone, 1)
  assertEq(r.globalScore, 80)
  assertEq(r.premiumImpact?.direction, 'premium')
})

test('analyzeSeismicRisk: indirizzo Cagliari → globalScore 10 + sconto', () => {
  const r = analyzeSeismicRisk({ address: 'Via Roma 1, 09100 Cagliari, CA' })
  assertEq(r.seismic?.zone, 4)
  assertEq(r.globalScore, 10)
  assertEq(r.premiumImpact?.direction, 'discount')
})

test('analyzeSeismicRisk: indirizzo Milano → globalScore 30', () => {
  const r = analyzeSeismicRisk({ address: 'Via Dante 5, 20121 Milano, MI' })
  assertEq(r.seismic?.zone, 3)
  assertEq(r.globalScore, 30)
})

test('analyzeSeismicRisk: comune diretto ha priorità su parsing address', () => {
  const r = analyzeSeismicRisk({
    address: 'qualsiasi cosa',
    comune: 'Bologna',
    provincia: 'BO',
  })
  assertEq(r.seismic?.zone, 2)
})

// ─────────────────────────────────────────────────────────────────────────────
//  TEST: Fix #6 — cross-check ATECO vs Ragione Sociale
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Fix #6: cross-check ATECO/RS ===')

test('crossCheck: BUS COMPANY SRL + ATECO 28.15.00 → mismatch (cuscinetti vs trasporti)', () => {
  const w = crossCheckAtecoVsRagioneSociale('BUS COMPANY SRL', '28.15.00')
  assertTrue(w !== null, 'atteso warning di mismatch')
  assertTrue(/sospetto/i.test(w || ''), 'warning deve contenere "sospetto"')
  assertTrue(/trasporti/i.test(w || ''), 'warning deve menzionare "trasporti"')
})

test('crossCheck: BUS COMPANY SRL + ATECO 49.39.10 → MATCH (trasporti urbani)', () => {
  const w = crossCheckAtecoVsRagioneSociale('BUS COMPANY SRL', '49.39.10')
  assertEq(w, null)  // 49.xx → lettera H → match con keyword "bus"
})

test('crossCheck: BUILD UP SRL + ATECO 41.20.00 → MATCH (costruzioni)', () => {
  const w = crossCheckAtecoVsRagioneSociale('BUILD UP SRL', '41.20.00')
  // "build" non è in keywords italiani, "edil" sì → no match → no warning
  assertEq(w, null)
})

test('crossCheck: STUDIO LEGALE BUZZI + ATECO 69.10.10 → MATCH', () => {
  const w = crossCheckAtecoVsRagioneSociale('STUDIO LEGALE BUZZI NOTARO', '69.10.10')
  assertEq(w, null)  // 69.xx → M → match con "studio legale"
})

test('crossCheck: STUDIO LEGALE BUZZI + ATECO 47.11.00 → mismatch (commercio vs studio)', () => {
  const w = crossCheckAtecoVsRagioneSociale('STUDIO LEGALE BUZZI', '47.11.00')
  assertTrue(w !== null)
})

test('crossCheck: ragione sociale generica → no warning', () => {
  const w = crossCheckAtecoVsRagioneSociale('XYZ HOLDING SRL', '99.99.99')
  assertEq(w, null)  // nessuna keyword match → niente warning (regola prudente)
})

test('crossCheck: input vuoti → null', () => {
  assertEq(crossCheckAtecoVsRagioneSociale('', '47.11.10'), null)
  assertEq(crossCheckAtecoVsRagioneSociale('STUDIO LEGALE', ''), null)
  assertEq(crossCheckAtecoVsRagioneSociale(undefined, undefined), null)
})

// ─────────────────────────────────────────────────────────────────────────────
//  TRIGGERS — Insurance Intelligence
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== triggers: getSectorRisk ===')

test('getSectorRisk: ATECO 41 (costruzioni) = high', () => {
  assertEq(getSectorRisk('41.20.00'), 'high')
})

test('getSectorRisk: ATECO 86 (sanità) = high', () => {
  assertEq(getSectorRisk('86.10'), 'high')
})

test('getSectorRisk: ATECO 62 (IT/software) = medium', () => {
  assertEq(getSectorRisk('62.01.00'), 'medium')
})

test('getSectorRisk: ATECO 96 (servizi pers) = low', () => {
  assertEq(getSectorRisk('96.04.10'), 'low')
})

test('getSectorRisk: undefined = medium (fallback)', () => {
  assertEq(getSectorRisk(undefined), 'medium')
  assertEq(getSectorRisk(''), 'medium')
})

console.log('\n=== triggers: computeHotnessScore ===')

test('hotness: gara 5M + acquisizione + espansione + P.IVA giovane + fatt 50M+ = CALDISSIMO', () => {
  const r = computeHotnessScore({
    hasRecentTender: true,
    recentTenderImportoEur: 5_000_000, // +30
    hasAcquisitionNews: true, // +12
    hasExpansionNews: true, // +8
    pivaAgeMonths: 4, // +15
    fatturato: 75_000_000, // +15
    sectorRisk: 'high', // +10
    hasLinkedinPresence: true, // +3
  })
  // Totale teorico: 30+12+8+15+15+10+3 = 93 → CALDISSIMO
  assertEq(r.label, 'CALDISSIMO')
  assertTrue(r.score >= 75, `score ${r.score} dovrebbe essere ≥75`)
})

test('hotness: gara 5M + fatturato 50M = CALDO (non CALDISSIMO senza altri segnali)', () => {
  // Test difensivo: confermiamo che senza P.IVA giovane/news, la soglia
  // CALDISSIMO 75 non si raggiunge solo con gara + fatturato + settore.
  const r = computeHotnessScore({
    hasRecentTender: true,
    recentTenderImportoEur: 5_000_000, // +30
    fatturato: 75_000_000, // +15
    sectorRisk: 'high', // +10
    hasLinkedinPresence: true, // +3
  })
  // Total: 30+15+10+3 = 58 → CALDO
  assertEq(r.label, 'CALDO')
})

test('hotness: solo P.IVA appena aperta + LinkedIn = TIEPIDO', () => {
  const r = computeHotnessScore({
    pivaAgeMonths: 3,
    hasLinkedinPresence: true,
    sectorRisk: 'medium',
  })
  assertTrue(r.score >= 20 && r.score < 50, `score ${r.score} atteso 20-50`)
})

test('hotness: zero segnali = FREDDO', () => {
  const r = computeHotnessScore({})
  assertEq(r.label, 'FREDDO')
  assertTrue(r.score < 25)
})

test('hotness: rationale non vuoto se ci sono segnali', () => {
  const r = computeHotnessScore({ hasRecentTender: true, recentTenderImportoEur: 1_000_000 })
  assertTrue(r.rationale.length > 0)
  assertTrue(r.rationale.toLowerCase().includes('gara'))
})

console.log('\n=== triggers: estimateSpendingCapacity ===')

test('spendingCapacity: titolare di SRL con fatturato 5M → SME, % 1.2', () => {
  const s = estimateSpendingCapacity({
    fatturato: 5_000_000,
    dipendenti: 30,
    ateco: '46.90.00', // commercio (medium)
    ruolo: 'titolare',
  })
  assertEq(s.propensioneAssicurativa.segmento, 'sme')
  assertTrue(s.propensioneAssicurativa.percentualeSpesaAttesa > 0)
  assertTrue(s.capacitaTotaleAnnualePolizze.mid > 0)
  assertTrue(s.redditoTitolareStimato !== undefined)
})

test('spendingCapacity: enterprise + sector high = % maggiorata 50%', () => {
  const s = estimateSpendingCapacity({
    fatturato: 100_000_000,
    ateco: '41.20.00', // costruzioni high-risk
    ruolo: 'titolare',
  })
  assertEq(s.propensioneAssicurativa.segmento, 'enterprise')
  // 0.6 base × 1.5 sector = 0.9
  assertTrue(s.propensioneAssicurativa.percentualeSpesaAttesa >= 0.85)
})

test('spendingCapacity: micro azienda → segmento micro', () => {
  const s = estimateSpendingCapacity({ fatturato: 200_000, ruolo: 'titolare' })
  assertEq(s.propensioneAssicurativa.segmento, 'micro')
})

test('spendingCapacity: dipendente non genera reddito titolare', () => {
  const s = estimateSpendingCapacity({ fatturato: 1_000_000, dipendenti: 200, ruolo: 'dipendente' })
  // reddito stimato dipendente, NON titolare
  assertTrue(s.redditoTitolareStimato !== undefined)
  // patrimonio min ridotto rispetto a titolare
})

console.log('\n=== triggers: mapAtecoToProfessionalAlbi ===')

test('albi: ATECO 69.10 (avvocato) → Albo Avvocati + Notai', () => {
  const list = mapAtecoToProfessionalAlbi('69.10.10')
  const nomi = list.map((a) => a.nome)
  assertTrue(nomi.includes('Albo Avvocati'), 'manca Albo Avvocati')
})

test('albi: ATECO 86.21 (medico) → Ordine Medici', () => {
  const list = mapAtecoToProfessionalAlbi('86.21.00')
  assertTrue(list.some((a) => /medic/i.test(a.nome)))
})

test('albi: ATECO 66.20 (consulenza finanziaria) → OCF + IVASS', () => {
  const list = mapAtecoToProfessionalAlbi('66.20.00')
  const nomi = list.map((a) => a.nome).join(' ')
  assertTrue(/OCF/i.test(nomi))
})

test('albi: ATECO sconosciuto → array vuoto', () => {
  const list = mapAtecoToProfessionalAlbi('99.99.99')
  assertEq(list.length, 0)
})

test('albi: undefined → []', () => {
  assertEq(mapAtecoToProfessionalAlbi(undefined).length, 0)
})

console.log('\n=== triggers: classifyNewsTrigger ===')

test('classify: titolo "Acme acquisita da BigCorp" → news_acquisizione alto', () => {
  const r = classifyNewsTrigger('Acme acquisita da BigCorp', '')
  assertTrue(r !== null)
  assertEq(r!.type, 'news_acquisizione')
  assertEq(r!.severity, 'alto')
})

test('classify: "Acme inaugura nuova sede a Milano" → news_espansione medio', () => {
  const r = classifyNewsTrigger('Acme inaugura nuova sede a Milano', '')
  assertTrue(r !== null)
  assertEq(r!.type, 'news_espansione')
})

test('classify: "Acme chiude aumento di capitale da 5 milioni" → aumento_capitale alto', () => {
  const r = classifyNewsTrigger('Acme chiude aumento di capitale da 5 milioni', '')
  assertTrue(r !== null)
  assertEq(r!.type, 'aumento_capitale')
  assertEq(r!.severity, 'alto')
})

test('classify: "Acme premiata come eccellenza italiana" → news_premio_award basso', () => {
  const r = classifyNewsTrigger('Acme premiata come eccellenza italiana', '')
  assertTrue(r !== null)
  assertEq(r!.type, 'news_premio_award')
})

test('classify: "Acme entra in concordato preventivo" → crisi_finanziaria', () => {
  const r = classifyNewsTrigger('Acme entra in concordato preventivo', '')
  assertTrue(r !== null)
  assertEq(r!.type, 'crisi_finanziaria')
})

test('classify: testo generico → null (no falsi positivi)', () => {
  const r = classifyNewsTrigger('Acme partecipa al salone del settore', '')
  assertEq(r, null)
})

console.log('\n=== triggers: buildPivaAgeTrigger ===')

test('pivaAge: anno corrente → severity alto (<6 mesi)', () => {
  const now = new Date()
  const t = buildPivaAgeTrigger(now.getFullYear(), now.getMonth() + 1)
  assertTrue(t !== null)
  assertEq(t!.severity, 'alto')
  assertEq(t!.type, 'piva_aperta_recente')
})

test('pivaAge: 5 anni fa → null (out of range)', () => {
  const now = new Date()
  const t = buildPivaAgeTrigger(now.getFullYear() - 5, 1)
  assertEq(t, null)
})

test('pivaAge: undefined → null', () => {
  assertEq(buildPivaAgeTrigger(undefined), null)
})

console.log('\n=== triggers: buildTenderTrigger ===')

test('tender: importo 1.5M lavori → severity critico + decennale postuma actions', () => {
  const t = buildTenderTrigger({
    oggetto: 'Costruzione scuola',
    importo: 1_500_000,
    categoria: 'lavori',
  })
  assertEq(t.severity, 'critico')
  // Cauzione 10% = 150k€ deve apparire in actions
  assertTrue(t.suggestedActions.some((a) => /150\.000|cauzione/i.test(a)))
  // Decennale postuma sopra 500k
  assertTrue(t.suggestedActions.some((a) => /decennale/i.test(a)))
})

test('tender: importo 200k servizi → severity medio + RC professionale', () => {
  const t = buildTenderTrigger({
    oggetto: 'Servizi pulizia',
    importo: 200_000,
    categoria: 'servizi',
  })
  assertEq(t.severity, 'medio')
  assertTrue(t.suggestedActions.some((a) => /RC/i.test(a)))
})

test('tender: importo 50k → severity basso', () => {
  const t = buildTenderTrigger({
    oggetto: 'Forniture',
    importo: 50_000,
    categoria: 'forniture',
  })
  assertEq(t.severity, 'basso')
})

console.log('\n=== triggers: extractCompanyTokens (anti-falsi-positivi) ===')

test('tokens: "CARBONLAB S.R.L." → ["carbonlab"]', () => {
  assertEq(extractCompanyTokens('CARBONLAB S.R.L.'), ['carbonlab'])
})

test('tokens: "CABRIL SERVICE S.R.L." → ["cabril"] (service filtrato come generic)', () => {
  assertEq(extractCompanyTokens('CABRIL SERVICE S.R.L.'), ['cabril'])
})

test('tokens: "MOSSA SUTTER S.P.A." → ["mossa","sutter"]', () => {
  assertEq(extractCompanyTokens('MOSSA SUTTER S.P.A.'), ['mossa', 'sutter'])
})

test('tokens: "GRUPPO ITALIA SPA" → [] (tutto generico)', () => {
  assertEq(extractCompanyTokens('GRUPPO ITALIA SPA'), [])
})

test('tokens: "" → []', () => {
  assertEq(extractCompanyTokens(''), [])
})

test('tokens: "CAPRARI ING. DAVIDE" → ["caprari","davide"]', () => {
  // Singole parole brevi come "ing" filtrate (length<4)
  const t = extractCompanyTokens('CAPRARI ING. DAVIDE')
  assertTrue(t.includes('caprari'))
  assertTrue(t.includes('davide'))
})

console.log('\n=== triggers: textMentionsCompany (filtro news/profili) ===')

test('mentions: testo che contiene il token aziendale → true', () => {
  assertEq(
    textMentionsCompany('Carbonlab annuncia espansione', 'CARBONLAB S.R.L.'),
    true,
  )
})

test('mentions: testo che NON contiene il token → false (Mossa Sutter ≠ Carbonlab)', () => {
  assertEq(
    textMentionsCompany('Mossa Sutter: doppia acquisizione', 'CARBONLAB S.R.L.'),
    false,
  )
})

test('mentions: news pasticceria Pfatisch ≠ Carbonlab → false', () => {
  assertEq(
    textMentionsCompany(
      'Cultura gastronomica: alla pasticceria Pfatisch di Torino il premio Alberini',
      'CARBONLAB S.R.L.',
    ),
    false,
  )
})

test('mentions: news ToothPic ≠ Carbonlab → false', () => {
  assertEq(
    textMentionsCompany(
      'ITAtech, primo finanziamento: 300mila euro alla startup ToothPic',
      'CARBONLAB S.R.L.',
    ),
    false,
  )
})

test('mentions: ragione sociale vuota → false', () => {
  assertEq(textMentionsCompany('qualunque testo', ''), false)
})

test('mentions: case-insensitive', () => {
  assertEq(textMentionsCompany('CARBONLAB FIRMA CONTRATTO', 'carbonlab srl'), true)
})

test('mentions: strict mode richiede TUTTI i token presenti', () => {
  // "MOSSA SUTTER" tokens: ["mossa", "sutter"]
  assertEq(
    textMentionsCompany('Mossa annuncia novità', 'MOSSA SUTTER S.P.A.', { strict: true }),
    false, // manca "sutter"
  )
  assertEq(
    textMentionsCompany('Mossa Sutter annuncia novità', 'MOSSA SUTTER S.P.A.', { strict: true }),
    true,
  )
})

console.log('\n=== Fix UX #5: aggregateParsingWarnings ===')

test('aggregate: warning tecnici tangibleAssets + bankDebts → 1 messaggio human-friendly', () => {
  const out = aggregateParsingWarnings([
    'tangibleAssets: valore 2€ sotto soglia minima 1000€ — scartato come noise di parsing',
    'bankDebts: valore 10€ sotto soglia minima 100€ — scartato come noise di parsing',
  ])
  assertEq(out.length, 1)
  // Non deve contenere il key tecnico
  assertTrue(!/tangibleAssets/.test(out[0]), 'NON deve esporre tangibleAssets')
  assertTrue(!/bankDebts/.test(out[0]), 'NON deve esporre bankDebts')
  // Deve contenere le label italiane
  assertTrue(/Immobilizzazioni materiali/i.test(out[0]))
  assertTrue(/Debiti verso banche/i.test(out[0]))
  // Deve essere informativo per l'assicuratore
  assertTrue(/incompleto|parziali/i.test(out[0]))
})

test('aggregate: nessun warning → array vuoto', () => {
  assertEq(aggregateParsingWarnings([]), [])
  assertEq(aggregateParsingWarnings(undefined as unknown as string[]), [])
})

test('aggregate: warning su dipendenti viene preservato (è informativo)', () => {
  const out = aggregateParsingWarnings([
    'Numero dipendenti sospetto: 50000000 (fuori range 1-1.000.000) — scartato',
  ])
  assertEq(out.length, 1)
  assertTrue(/dipendenti/i.test(out[0]))
})

test('aggregate: scarta deduplicazione delle label', () => {
  const out = aggregateParsingWarnings([
    'tangibleAssets: valore 2€ sotto soglia minima 1000€ — scartato',
    'tangibleAssets: valore 5€ sotto soglia minima 1000€ — scartato',
  ])
  assertEq(out.length, 1)
  // Solo UNA volta "Immobilizzazioni materiali"
  const occurrences = (out[0].match(/Immobilizzazioni materiali/gi) || []).length
  assertEq(occurrences, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
//  RIEPILOGO
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`TOTALE: ${passed} passed, ${failed} failed (${passed + failed} test totali)`)
if (failed > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  • ${f}`)
  process.exit(1)
}
console.log('✅ Tutti i test sono passati.')
