/**
 * Workforce Analyzer — analisi dipendenti, costo personale, CCNL, welfare
 *
 * Parte da:
 *   - Numero dipendenti (B.9 dipendenti medi anno)
 *   - Costo del personale (B.9 totale)
 *   - Settore ATECO (per inferenza CCNL applicato)
 *
 * Calcola:
 *   - Costo medio lordo per dipendente
 *   - TFR maturato (~7% del costo personale annuo)
 *   - Stima oneri sociali (~30% del costo personale)
 *   - Stima massa salariale netta erogata
 *   - CCNL probabilmente applicato (mappa settore → CCNL)
 *   - Opportunità welfare dettagliate (Vita, Sanitaria, Infortuni, TFM)
 *
 * REGOLE D'ORO:
 *   - Tutti i dati di base sono "declared" (estratti da bilancio)
 *   - Tutti i derivati matematici sono "computed"
 *   - Stime di mercato sono "estimated" con range
 */

import type { ValuedFact, RangeFact, BalanceSheetYear } from './types'
import { atecoToLetter, getBenchmarkByAteco } from './sector-benchmarks'

// ─────────────────────────────────────────────────────────────────────────────
//  CCNL — mapping ATECO → CCNL probabili
//
//  Fonte: CNEL — Contratti collettivi nazionali di lavoro
//         https://www.cnel.it/Archivio-Contratti
// ─────────────────────────────────────────────────────────────────────────────

interface CCNLEntry {
  /** Sigla CCNL */
  code: string
  /** Nome esteso */
  name: string
  /** Confederazioni firmatarie */
  signatories: string[]
  /** Categoria di rischio INAIL prevalente */
  riskCategory: 'low' | 'medium' | 'high'
  /** Note specifiche */
  notes?: string
}

/**
 * Mappatura macro-settore ATECO → CCNL principali applicati
 *
 * Una azienda può applicare più CCNL ma solitamente ne ha uno prevalente.
 * Questo mapping considera il CCNL più diffuso per il settore.
 */
const CCNL_BY_SECTOR: Record<string, CCNLEntry[]> = {
  'A': [{
    code: 'CCNL Agricoltura',
    name: 'CCNL Operai Agricoli e Florovivaisti',
    signatories: ['Coldiretti', 'Confagricoltura', 'CIA'],
    riskCategory: 'medium',
  }],
  'B': [{
    code: 'CCNL Lapidei',
    name: 'CCNL Settore Lapidei',
    signatories: ['Confindustria Marmomacchine'],
    riskCategory: 'high',
  }],
  'C': [{
    code: 'CCNL Metalmeccanici Industria',
    name: 'CCNL Metalmeccanici Industria (Federmeccanica)',
    signatories: ['Federmeccanica', 'FIM-CISL', 'FIOM-CGIL', 'UILM-UIL'],
    riskCategory: 'high',
    notes: 'CCNL più diffuso del settore manifatturiero',
  }, {
    code: 'CCNL Metalmeccanici PMI',
    name: 'CCNL Metalmeccanici PMI (Confapi)',
    signatories: ['Confapi'],
    riskCategory: 'high',
  }],
  'D': [{
    code: 'CCNL Energia e Petrolio',
    name: 'CCNL Settore Energia, Petrolio e Gas',
    signatories: ['Confindustria Energia'],
    riskCategory: 'high',
  }],
  'E': [{
    code: 'CCNL Igiene Ambientale',
    name: 'CCNL Igiene Urbana e Ambientale',
    signatories: ['Utilitalia'],
    riskCategory: 'high',
  }],
  'F': [{
    code: 'CCNL Edilizia Industria',
    name: 'CCNL Edilizia Industria (ANCE)',
    signatories: ['ANCE', 'FENEAL-UIL', 'FILCA-CISL', 'FILLEA-CGIL'],
    riskCategory: 'high',
    notes: 'CCNL settore costruzioni privato',
  }, {
    code: 'CCNL Edilizia Artigianato',
    name: 'CCNL Edilizia Artigianato (Confartigianato)',
    signatories: ['Confartigianato', 'CNA'],
    riskCategory: 'high',
  }],
  'G': [{
    code: 'CCNL Commercio Confcommercio',
    name: 'CCNL Terziario, Distribuzione e Servizi',
    signatories: ['Confcommercio', 'FILCAMS-CGIL', 'FISASCAT-CISL', 'UILTuCS-UIL'],
    riskCategory: 'low',
    notes: 'CCNL più diffuso del settore terziario',
  }],
  'H': [{
    code: 'CCNL Trasporto Merci',
    name: 'CCNL Logistica, Trasporto Merci e Spedizione',
    signatories: ['Confetra', 'Confcommercio'],
    riskCategory: 'high',
  }],
  'I': [{
    code: 'CCNL Pubblici Esercizi',
    name: 'CCNL Pubblici Esercizi, Ristorazione e Turismo',
    signatories: ['FIPE-Confcommercio', 'Federalberghi'],
    riskCategory: 'medium',
  }],
  'J': [{
    code: 'CCNL Telecomunicazioni',
    name: 'CCNL Telecomunicazioni',
    signatories: ['Asstel'],
    riskCategory: 'low',
  }, {
    code: 'CCNL Commercio Confcommercio',
    name: 'CCNL Terziario (per IT/Servizi digitali)',
    signatories: ['Confcommercio'],
    riskCategory: 'low',
  }],
  'K': [{
    code: 'CCNL Credito (ABI)',
    name: 'CCNL Credito (ABI)',
    signatories: ['ABI'],
    riskCategory: 'low',
  }, {
    code: 'CCNL Assicurazioni ANIA',
    name: 'CCNL Imprese di Assicurazione (ANIA)',
    signatories: ['ANIA'],
    riskCategory: 'low',
  }],
  'L': [{
    code: 'CCNL Studi Professionali',
    name: 'CCNL Studi Professionali',
    signatories: ['Confprofessioni'],
    riskCategory: 'low',
  }],
  'M': [{
    code: 'CCNL Studi Professionali',
    name: 'CCNL Studi Professionali (Confprofessioni)',
    signatories: ['Confprofessioni'],
    riskCategory: 'low',
    notes: 'Studi avvocati/commercialisti/architetti/ingegneri',
  }],
  'N': [{
    code: 'CCNL Commercio Confcommercio',
    name: 'CCNL Servizi alle imprese (terziario)',
    signatories: ['Confcommercio'],
    riskCategory: 'low',
  }],
  'P': [{
    code: 'CCNL Scuola',
    name: 'CCNL Scuola Statale e Privata',
    signatories: ['ANINSEI', 'AGIDAE'],
    riskCategory: 'low',
  }],
  'Q': [{
    code: 'CCNL Sanità Privata',
    name: 'CCNL Sanità Privata (AIOP/ARIS)',
    signatories: ['AIOP', 'ARIS', 'Confcommercio Sanità'],
    riskCategory: 'medium',
  }],
  'R': [{
    code: 'CCNL Spettacolo',
    name: 'CCNL Spettacolo e Intrattenimento',
    signatories: ['ANSPC'],
    riskCategory: 'medium',
  }],
  'S': [{
    code: 'CCNL Servizi vari',
    name: 'CCNL Servizi vari',
    signatories: ['Confcommercio', 'Confartigianato'],
    riskCategory: 'low',
  }],
}

/** Restituisce i CCNL probabili per un dato ATECO. */
export function getCCNLBySector(atecoCode?: string | null): CCNLEntry[] {
  const letter = atecoToLetter(atecoCode)
  return CCNL_BY_SECTOR[letter] || [{
    code: 'CCNL Generico',
    name: 'CCNL non identificato dal settore',
    signatories: [],
    riskCategory: 'medium',
  }]
}

// ─────────────────────────────────────────────────────────────────────────────
//  WELFARE — Stime opportunità da costo personale + dipendenti
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkforceAnalysis {
  /** Numero dipendenti dichiarato in bilancio */
  employees: ValuedFact<number> | null
  /** Costo personale annuo (€, B.9 totale) */
  payroll: ValuedFact<number> | null
  /** Costo medio per dipendente (€/anno, computed = payroll/employees) */
  avgCostPerEmployee: ValuedFact<number> | null
  /** TFR maturato stimato (~7% costo personale annuo) */
  tfrAccrual: ValuedFact<number> | null
  /** Oneri sociali stimati (~30% costo personale) */
  socialContributionsEstimate: ValuedFact<number> | null
  /** Anno del dato di bilancio */
  referenceYear?: number
  /** CCNL probabilmente applicati al settore */
  probableCCNL: CCNLEntry[]
  /** Opportunità welfare dettagliate */
  welfareOpportunities: WelfareOpportunity[]
  /** Trigger events comuni che attivano necessità welfare */
  triggers: string[]
  /** Warning espliciti per l'utente */
  warnings: string[]
}

export interface WelfareOpportunity {
  ramo: string
  totalAnnualPremium: RangeFact
  premiumPerEmployee: RangeFact
  taxBenefit: string
  priority: 1 | 2 | 3 | 4 | 5
  rationale: string
}

/**
 * Costanti welfare (€/dipendente/anno, da ANIA Bollettino 2023)
 */
const WELFARE_PRICING = {
  vitaCollettiva: { min: 350, mid: 500, max: 700 },
  sanitaria: { min: 450, mid: 650, max: 950 },
  infortuni: { min: 180, mid: 280, max: 400 },
  fondoPensione: { min: 600, mid: 900, max: 1500 }, // contributo datoriale tipico
  flexibleBenefits: { min: 300, mid: 500, max: 1200 },  // welfare aziendale art.51 TUIR
}

function rangeFromPerEmployee(
  perEmployee: { min: number; mid: number; max: number },
  count: number,
  source: string,
  rationale: string,
): { total: RangeFact; perEmp: RangeFact } {
  return {
    total: {
      min: perEmployee.min * count,
      mid: perEmployee.mid * count,
      max: perEmployee.max * count,
      confidence: 'estimated',
      source,
      rationale,
    },
    perEmp: {
      min: perEmployee.min,
      mid: perEmployee.mid,
      max: perEmployee.max,
      confidence: 'estimated',
      source,
      rationale: 'Premio medio settore per dipendente',
    },
  }
}

/**
 * Genera la lista di opportunità welfare dato il numero dipendenti e il settore.
 */
function generateWelfareOpportunities(
  employees: number,
  atecoLetter: string,
): WelfareOpportunity[] {
  const out: WelfareOpportunity[] = []
  if (employees <= 0) return out

  const isHighRisk = ['F', 'B', 'C', 'H', 'E', 'D'].includes(atecoLetter)
  const isLargeFirm = employees >= 50
  const isMidFirm = employees >= 15

  // ───── 1. Polizza Vita Collettiva ─────
  const vita = rangeFromPerEmployee(
    WELFARE_PRICING.vitaCollettiva, employees,
    'ANIA Bollettino Statistico 2023',
    `${employees} dipendenti × ${WELFARE_PRICING.vitaCollettiva.mid}€ medio`,
  )
  out.push({
    ramo: 'Polizza Vita Collettiva (TCM)',
    totalAnnualPremium: vita.total,
    premiumPerEmployee: vita.perEmp,
    taxBenefit: 'Deducibile per la società (art. 100 TUIR). Non concorre al reddito del dipendente fino a €258,23/anno.',
    priority: isLargeFirm ? 5 : isMidFirm ? 4 : 3,
    rationale: 'Strumento welfare base. Forte leva di retention. Premi modesti rispetto al beneficio.',
  })

  // ───── 2. Polizza Sanitaria Collettiva ─────
  const san = rangeFromPerEmployee(
    WELFARE_PRICING.sanitaria, employees,
    'ANIA Bollettino Statistico 2023',
    `${employees} dipendenti × ${WELFARE_PRICING.sanitaria.mid}€ medio`,
  )
  out.push({
    ramo: 'Polizza Sanitaria Collettiva',
    totalAnnualPremium: san.total,
    premiumPerEmployee: san.perEmp,
    taxBenefit: 'Deducibile per la società. Esente per il dipendente fino a €3.615,20/anno (art.51 TUIR).',
    priority: isLargeFirm ? 5 : isMidFirm ? 4 : 3,
    rationale: 'Trend +15% YoY. Massima leva di attraction & retention. Spesso prevista in trattative sindacali.',
  })

  // ───── 3. Polizza Infortuni Cumulativa ─────
  const inf = rangeFromPerEmployee(
    WELFARE_PRICING.infortuni, employees,
    'ANIA Bollettino Statistico 2023',
    `${employees} dipendenti × ${WELFARE_PRICING.infortuni.mid}€ medio`,
  )
  out.push({
    ramo: 'Polizza Infortuni Cumulativa',
    totalAnnualPremium: inf.total,
    premiumPerEmployee: inf.perEmp,
    taxBenefit: 'Deducibile per la società. Premi modesti, copertura H24 dipendenti.',
    priority: isHighRisk ? 5 : 3,
    rationale: isHighRisk
      ? `Settore ${atecoLetter} ad alto rischio infortuni (INAIL): copertura aggiuntiva fortemente raccomandata.`
      : 'Copertura base spesso integrata in pacchetti welfare.',
  })

  // ───── 4. Fondo Pensione Aziendale ─────
  if (isMidFirm) {
    const fp = rangeFromPerEmployee(
      WELFARE_PRICING.fondoPensione, employees,
      'COVIP + ANIA',
      `${employees} dipendenti × contributo datoriale medio ${WELFARE_PRICING.fondoPensione.mid}€`,
    )
    out.push({
      ramo: 'Contributo a Fondo Pensione Aziendale',
      totalAnnualPremium: fp.total,
      premiumPerEmployee: fp.perEmp,
      taxBenefit: 'Deducibile fino al 4% del costo del lavoro. Non concorre al reddito del dipendente.',
      priority: isLargeFirm ? 5 : 3,
      rationale: 'Strumento di lungo periodo per retention. Spesso negoziato in welfare aziendale.',
    })
  }

  // ───── 5. Welfare Aziendale (Flexible Benefits art.51 TUIR) ─────
  if (isMidFirm) {
    const fb = rangeFromPerEmployee(
      WELFARE_PRICING.flexibleBenefits, employees,
      'Confindustria Welfare Aziendale 2024',
      `${employees} dipendenti × budget welfare medio ${WELFARE_PRICING.flexibleBenefits.mid}€`,
    )
    out.push({
      ramo: 'Welfare Aziendale (Flexible Benefits)',
      totalAnnualPremium: fb.total,
      premiumPerEmployee: fb.perEmp,
      taxBenefit: 'TOTALMENTE deducibile. Esente per dipendente (art.51, comma 2 TUIR). Forte leva fiscale.',
      priority: isLargeFirm ? 5 : 4,
      rationale: 'Strumento più potente del welfare: 100% deducibile e 100% esente. ROI fiscale enorme.',
    })
  }

  // ───── 6. TFM Amministratori (per società strutturate) ─────
  if (employees >= 10 || atecoLetter === 'K' || atecoLetter === 'M') {
    out.push({
      ramo: 'TFM Amministratori',
      totalAnnualPremium: {
        min: 4000, mid: 8000, max: 15000,
        confidence: 'estimated',
        source: 'ANIA + Confindustria',
        rationale: 'Polizza TFM per società di capitali strutturate',
      },
      premiumPerEmployee: {
        min: 4000, mid: 8000, max: 15000,
        confidence: 'estimated',
        source: 'ANIA',
        rationale: 'Premio per amministratore (non per dipendente)',
      },
      taxBenefit: 'Deducibilità integrale per la società. Strumento di accantonamento liquidazione.',
      priority: 3,
      rationale: 'Standard per società di capitali con amministratori esecutivi.',
    })
  }

  // Ordina per priorità decrescente
  return out.sort((a, b) => b.priority - a.priority)
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyzeWorkforceInput {
  bs: BalanceSheetYear | null
  ateco?: string
  source: string
}

/**
 * Analisi completa workforce a partire dai dati di bilancio.
 *
 * Restituisce:
 *   - Dati grezzi (declared)
 *   - Derivati matematici (computed)
 *   - CCNL probabile (estimated da settore)
 *   - Opportunità welfare (estimated)
 */
export function analyzeWorkforce(input: AnalyzeWorkforceInput): WorkforceAnalysis {
  const { bs, ateco, source } = input
  const warnings: string[] = []
  const out: WorkforceAnalysis = {
    employees: null,
    payroll: null,
    avgCostPerEmployee: null,
    tfrAccrual: null,
    socialContributionsEstimate: null,
    probableCCNL: getCCNLBySector(ateco),
    welfareOpportunities: [],
    triggers: [
      'Nuove assunzioni (>5 nell\'anno) → estensione polizze collettive',
      'Apertura nuova sede → polizze sede + dipendenti aggiuntive',
      'Cambio CCNL (rinnovo contrattuale) → ridefinizione welfare',
      'Acquisizione di altra società → integrazione coperture',
    ],
    warnings,
  }

  if (!bs) {
    warnings.push('Bilancio non disponibile: analisi workforce non calcolabile.')
    return out
  }

  out.referenceYear = bs.year

  // Dipendenti (declared)
  if (bs.employees && bs.employees > 0) {
    out.employees = {
      value: bs.employees,
      confidence: 'declared',
      source,
      year: bs.year,
    }
  }

  // Costo personale (declared)
  if (bs.totalStaffCost && bs.totalStaffCost > 0) {
    out.payroll = {
      value: bs.totalStaffCost,
      confidence: 'declared',
      source,
      year: bs.year,
      note: 'B.9 Costi per il personale (totale)',
    }
  }

  // Costo medio per dipendente (computed) + sanity check (Fix #5)
  if (out.employees && out.payroll) {
    const avg = Math.round(out.payroll.value / out.employees.value)
    out.avgCostPerEmployee = {
      value: avg,
      confidence: 'computed',
      source: `${out.payroll.source} / ${out.employees.source}`,
      year: bs.year,
      note: 'Costo lordo annuo medio per dipendente (incl. oneri sociali e TFR)',
    }
    // Range italiano realistico: 25k–80k normale, 80k–150k manageriale, oltre = anomalo
    if (avg > 150_000) {
      out.warnings.push(
        `⚠️ Costo medio/dipendente sospetto: ${avg.toLocaleString('it-IT')}\u20ac/anno. ` +
        `Tipico range italiano: 25k\u201380k\u20ac (operai/impiegati), 80k\u2013150k\u20ac (manageriale). ` +
        `Probabili cause: numero dipendenti dichiarato troppo basso (es. solo soci/dirigenti) o costo personale aggregato con altre voci. ` +
        `Verificare i dati di bilancio prima di stimare polizze workforce.`
      )
    } else if (avg < 15_000) {
      out.warnings.push(
        `⚠️ Costo medio/dipendente molto basso: ${avg.toLocaleString('it-IT')}\u20ac/anno. ` +
        `Sotto la soglia minima legale italiana (CCNL minimi ~18k\u20ac annui per part-time). ` +
        `Probabili cause: dipendenti part-time o stagionali, oppure costo personale incompleto in bilancio.`
      )
    }
  }

  // TFR maturato (computed: ~7% del costo personale)
  if (out.payroll) {
    out.tfrAccrual = {
      value: Math.round(out.payroll.value * 0.0707),  // 1/13.5 ≈ 7.07%
      confidence: 'computed',
      source: 'art.2120 c.c. (1/13.5 della retribuzione utile)',
      year: bs.year,
      note: 'Stima TFR maturato nell\'esercizio',
    }
  }

  // Oneri sociali (computed: ~30% del costo personale)
  if (out.payroll) {
    out.socialContributionsEstimate = {
      value: Math.round(out.payroll.value * 0.30),
      confidence: 'computed',
      source: 'INPS aliquote medie 2024',
      year: bs.year,
      note: 'Stima contributi previdenziali e assicurativi (~30% costo lordo)',
    }
  }

  // Welfare opportunities
  if (out.employees) {
    const atecoLetter = atecoToLetter(ateco)
    out.welfareOpportunities = generateWelfareOpportunities(out.employees.value, atecoLetter)
  } else {
    warnings.push('Numero dipendenti non disponibile: opportunità welfare non calcolabili.')
  }

  return out
}
