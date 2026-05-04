/**
 * Insurance Radar — tipi condivisi
 *
 * Tutti i moduli sotto `src/lib/insurance/*` usano questi tipi per
 * garantire un output consistente verso il frontend.
 *
 * Convenzione "confidence":
 *   - 'declared' = dato letto direttamente da fonte ufficiale (bilancio, INGV, ANAC)
 *   - 'computed' = dato derivato da calcolo deterministico su dati declared
 *   - 'estimated' = stima basata su benchmark settoriali (RANGE, mai single value)
 *   - 'unknown'  = dato non reperibile in fonti pubbliche
 *
 * REGOLA D'ORO: nessun dato è 'declared' se non è stato realmente estratto
 * da una fonte ufficiale verificabile. Le stime sono SEMPRE etichettate.
 */

export type Confidence = 'declared' | 'computed' | 'estimated' | 'unknown'

/** Singolo valore con metadata di provenienza */
export interface ValuedFact<T = number> {
  value: T
  confidence: Confidence
  source?: string
  /** Anno di riferimento del dato (per dati storici) */
  year?: number
  /** Note aggiuntive (es. "B.7 Costi per servizi totale") */
  note?: string
}

/** Range con minimo, massimo, e best-guess centrale */
export interface RangeFact {
  min: number
  max: number
  mid: number
  confidence: Confidence
  source?: string
  /** Spiegazione di come è stato calcolato il range */
  rationale?: string
}

// ─────────────────────────────────────────────────────────────────────────────
//  BILANCIO — Voci di Conto Economico e Stato Patrimoniale
//  Italian GAAP (decreto 139/2015, schema bilancio ordinario)
// ─────────────────────────────────────────────────────────────────────────────

export interface BalanceSheetYear {
  year: number
  /** A.1 Ricavi delle vendite e prestazioni */
  turnover?: number
  /** A.5 Altri ricavi e proventi */
  otherRevenues?: number
  /** B.6 Costi per materie prime, sussidiarie, di consumo e merci */
  rawMaterials?: number
  /** B.7 Costi per servizi (qui sono inclusi i premi assicurativi) */
  services?: number
  /** B.8 Costi per godimento di beni di terzi (locazioni, leasing) */
  thirdPartyGoods?: number
  /** B.9 Costi per il personale (stipendi + oneri sociali + TFR) */
  totalStaffCost?: number
  /** B.10 Ammortamenti, svalutazioni */
  amortization?: number
  /** B.10b Ammortamenti immobilizzazioni materiali (= asset fisici) */
  amortizationTangible?: number
  /** B.14 Oneri diversi di gestione (potenziale residuo premi) */
  otherOperatingCosts?: number
  /** C.17 Oneri finanziari (interessi su debiti, indicatore di indebitamento) */
  financialCharges?: number
  /** EBITDA (calcolato o dichiarato) */
  ebitda?: number
  /** Utile netto */
  netIncome?: number
  /** Numero dipendenti medio dell'esercizio */
  employees?: number
  /** Capitale sociale versato */
  shareCapital?: number
  /** Totale Attivo */
  totalAssets?: number
  /** Immobilizzazioni Materiali Nette (B.II Stato Patrimoniale) → ASSET ASSICURABILI */
  tangibleAssets?: number
  /** Patrimonio Netto */
  equity?: number
  /** Debiti finanziari (verso banche) */
  bankDebts?: number
  /** Premi assicurativi specifici (raramente disaggregato — solo NI) */
  insurancePremiumsDeclared?: number
}

export interface BalanceSheetData {
  /** Anni disponibili, ordinati dal più recente al più vecchio */
  years: BalanceSheetYear[]
  /** Anno più recente (alias di years[0]) */
  latest: BalanceSheetYear | null
  /** Fonte raw del dato (es. "openapi.it/IT-advanced", "companyreports.it") */
  source: string
  /** Timestamp del fetch */
  fetchedAt: string
  /**
   * Warnings di data quality: valori scartati dal sanitize (es. "tangibleAssets: 3€
   * sotto soglia minima 1.000€ — scartato"). Vuoto se tutto pulito.
   */
  dataQualityWarnings?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
//  INSURANCE FOOTPRINT — output consolidato
// ─────────────────────────────────────────────────────────────────────────────

export interface InsuranceFootprint {
  /** Identificativi azienda */
  piva: string
  ragioneSociale?: string
  ateco?: string
  atecoDescription?: string
  sectorMacro?: string

  /** PREMI ASSICURATIVI */
  premiums: {
    /** Dato dichiarato in bilancio/NI (raro per PMI) */
    declared?: ValuedFact<number>
    /** Stima basata su benchmark settoriali (sempre presente se abbiamo turnover) */
    estimated?: RangeFact
    /** Premio "fair market" calcolato per ogni ramo */
    fairMarket?: RangeFact
    /** Possibile saving = declared - fairMarket.max (solo se declared presente) */
    savingOpportunity?: RangeFact
  }

  /** ASSET ASSICURABILI */
  assets: {
    /** Immobilizzazioni materiali nette (€) */
    tangibleAssetsValue?: ValuedFact<number>
    /** Numero sedi/unità locali (camerale) */
    locations?: ValuedFact<number>
    /** Numero veicoli stimati (ATECO + dimensione) */
    estimatedVehicles?: RangeFact
    /** Numero dipendenti */
    employees?: ValuedFact<number>
    /** Costo del personale annuo (€) */
    payroll?: ValuedFact<number>
  }

  /** OPPORTUNITÀ COMMERCIALI */
  opportunities: InsuranceOpportunity[]

  /** TREND ULTIMI 3-5 ANNI */
  trends?: {
    turnoverGrowth3y?: number  // %
    employeesGrowth3y?: number  // %
    servicesGrowth3y?: number  // %
  }

  /** Metadata */
  meta: {
    sourcesUsed: string[]
    fetchedAt: string
    durationMs: number
    /** Lista di warning espliciti per l'utente */
    warnings: string[]
  }
}

export interface InsuranceOpportunity {
  /** Ramo assicurativo (es. "RC Auto Flotte", "Welfare Aziendale") */
  ramo: string
  /** Premio annuo stimato in € */
  estimatedAnnualPremium: RangeFact
  /** Priorità commerciale 1-5 (5 = top) */
  priority: 1 | 2 | 3 | 4 | 5
  /** Razionale che giustifica l'opportunità */
  rationale: string
  /** Trigger event (se applicabile) */
  trigger?: string
  /** Categoria: 'employee' | 'asset' | 'liability' | 'auto' | 'cauzione' */
  category: 'employee' | 'asset' | 'liability' | 'auto' | 'cauzione' | 'health' | 'life'
}

// ─────────────────────────────────────────────────────────────────────────────
//  RISK SCORE — Geografico (sismico/idrogeologico/climatico)
// ─────────────────────────────────────────────────────────────────────────────

export interface SeismicRiskFact {
  /** Zona sismica ufficiale: 1 (alta) → 4 (bassa). Italia ha zone 1-4. */
  zone: 1 | 2 | 3 | 4
  /** Accelerazione sismica orizzontale di picco (g) — pubblicato da INGV */
  pga?: number
  /** Etichetta human-readable */
  label: string
  /** Source */
  source: string
}

export interface GeoRiskScore {
  address: string
  lat?: number
  lon?: number
  comune?: string
  provincia?: string
  /** Rischio sismico — INGV ufficiale */
  seismic?: SeismicRiskFact
  /** Score globale 0-100 (0=safe, 100=high-risk) */
  globalScore: number
  /** Pricing impact stimato sulla polizza All-Risk */
  premiumImpact?: {
    direction: 'discount' | 'premium' | 'neutral'
    percentMin: number
    percentMax: number
    rationale: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAUZIONI ANAC — fideiussioni stimate da gare pubbliche
// ─────────────────────────────────────────────────────────────────────────────

export interface AnacCauzioneEstimate {
  cigOrCup: string
  oggetto: string
  stazioneAppaltante: string
  importoAggiudicato: number
  /** Cauzione provvisoria 2% importo base */
  cauzioneProvvisoriaStimata: number
  /** Cauzione definitiva 10% (5% se ribasso > soglia) */
  cauzioneDefinitivaStimata: number
  /** Polizza decennale postuma se appalto edilizio */
  decennaleEdilizia?: number
  /** Data aggiudicazione */
  dataAggiudicazione: string
  /** Data fine prevista contratto */
  dataFinePrevista?: string
  /** RC Lavori applicabile (importi >€500k) */
  rcLavoriApplicabile?: boolean
}

export interface AnacFideiussioniSummary {
  piva: string
  cigCount: number
  importoTotaleAggiudicato: number
  cauzioniProvvisorieTotali: number
  cauzioniDefinitiveTotali: number
  decennaliEdiliziaTotali: number
  rcLavoriCount: number
  gareInCorso: AnacCauzioneEstimate[]
  /** Stima premi annuali ramo cauzioni */
  premiCauzioniAnnualiStimati: RangeFact
}
