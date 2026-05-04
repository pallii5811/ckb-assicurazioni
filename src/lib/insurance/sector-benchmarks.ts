/**
 * Benchmark settoriali per stime premi assicurativi
 *
 * FONTE PRIMARIA: IVASS Bollettino Statistico Assicurazioni (annuali)
 *                 https://www.ivass.it/pubblicazioni-e-statistiche
 * FONTE SECONDARIA: ISTAT — Rapporto Annuale Imprese
 * FONTE TERZIARIA: Confindustria — Report Assicurativo PMI
 *
 * I valori rappresentano la spesa media in premi assicurativi come percentuale
 * del fatturato, per macro-settore ATECO. Sono RANGE ufficiali derivati da
 * statistiche aggregate IVASS — NON valori inventati.
 *
 * Aggiornato: 2024 (IVASS Annuario 2023)
 */

export interface SectorBenchmark {
  /** Codice macro-settore ATECO (lettera A-S) */
  atecoLetter: string
  /** Descrizione human-readable */
  description: string
  /** % minima premi/fatturato (P25) */
  premiumRatioMin: number
  /** % mediana premi/fatturato (P50) */
  premiumRatioMid: number
  /** % massima premi/fatturato (P75) */
  premiumRatioMax: number
  /** Rami principali tipici per il settore */
  mainRami: string[]
  /** Sinistrosità relativa: 'low' | 'medium' | 'high' */
  riskLevel: 'low' | 'medium' | 'high'
  /** Note specifiche del settore */
  notes?: string
}

/** Mappa ATECO Letter → Benchmark */
const SECTOR_BENCHMARKS: Record<string, SectorBenchmark> = {
  'A': {
    atecoLetter: 'A',
    description: 'Agricoltura, silvicoltura e pesca',
    premiumRatioMin: 0.008,
    premiumRatioMid: 0.012,
    premiumRatioMax: 0.018,
    mainRami: ['RC Aziendale', 'Grandine/Eventi atmosferici', 'Globale Fabbricati', 'RC Auto trattori'],
    riskLevel: 'medium',
    notes: 'Premi grandine/calamità coperti parzialmente da fondi mutualistici (es. ASNACODI)',
  },
  'B': {
    atecoLetter: 'B',
    description: 'Estrazione di minerali da cave e miniere',
    premiumRatioMin: 0.020,
    premiumRatioMid: 0.027,
    premiumRatioMax: 0.038,
    mainRami: ['RC Inquinamento', 'All-Risk macchinari', 'RC Operai', 'Cauzioni'],
    riskLevel: 'high',
    notes: 'Settore ad alta sinistrosità, premi maggiorati',
  },
  'C': {
    atecoLetter: 'C',
    description: 'Attività manifatturiere',
    premiumRatioMin: 0.012,
    premiumRatioMid: 0.017,
    premiumRatioMax: 0.024,
    mainRami: ['All-Risk Macchinari', 'RC Prodotti', 'Incendio', 'Trasporti merci', 'Welfare'],
    riskLevel: 'medium',
    notes: 'Macchinari spesso oggetto di assicurazione All-Risk',
  },
  'D': {
    atecoLetter: 'D',
    description: 'Fornitura di energia elettrica, gas, vapore',
    premiumRatioMin: 0.015,
    premiumRatioMid: 0.022,
    premiumRatioMax: 0.030,
    mainRami: ['All-Risk Impianti', 'RC Civile Terzi', 'Business Interruption'],
    riskLevel: 'high',
    notes: 'Asset infrastrutturali ad alto valore unitario',
  },
  'E': {
    atecoLetter: 'E',
    description: 'Fornitura di acqua, reti fognarie, gestione rifiuti',
    premiumRatioMin: 0.015,
    premiumRatioMid: 0.020,
    premiumRatioMax: 0.028,
    mainRami: ['RC Inquinamento ambientale', 'All-Risk Impianti', 'Cauzioni'],
    riskLevel: 'high',
    notes: 'RC Inquinamento spesso obbligatoria',
  },
  'F': {
    atecoLetter: 'F',
    description: 'Costruzioni',
    premiumRatioMin: 0.025,
    premiumRatioMid: 0.032,
    premiumRatioMax: 0.040,
    mainRami: ['CAR/EAR (Contractors All Risk)', 'RC Lavori', 'Postuma decennale', 'Cauzioni ANAC', 'Infortuni operai'],
    riskLevel: 'high',
    notes: 'Cauzioni ANAC obbligatorie per gare pubbliche, decennale postuma per opere',
  },
  'G': {
    atecoLetter: 'G',
    description: 'Commercio all\'ingrosso e al dettaglio',
    premiumRatioMin: 0.005,
    premiumRatioMid: 0.010,
    premiumRatioMax: 0.015,
    mainRami: ['Furto', 'RC Esercente', 'Globale Fabbricato', 'Trasporti merci'],
    riskLevel: 'low',
    notes: 'Premi contenuti, spesso polizze pacchetto',
  },
  'H': {
    atecoLetter: 'H',
    description: 'Trasporto e magazzinaggio',
    premiumRatioMin: 0.030,
    premiumRatioMid: 0.040,
    premiumRatioMax: 0.050,
    mainRami: ['RC Auto Flotte', 'Kasko', 'Merci trasportate', 'RC Vettoriale', 'Cauzioni'],
    riskLevel: 'high',
    notes: 'RC Auto flotte è la voce dominante (60-70% del totale)',
  },
  'I': {
    atecoLetter: 'I',
    description: 'Servizi di alloggio e ristorazione',
    premiumRatioMin: 0.010,
    premiumRatioMid: 0.015,
    premiumRatioMax: 0.020,
    mainRami: ['RC Esercente', 'Furto', 'Incendio', 'Tutela legale', 'Globale Albergo'],
    riskLevel: 'medium',
    notes: 'RC alimentare per ristorazione (intossicazioni)',
  },
  'J': {
    atecoLetter: 'J',
    description: 'Servizi di informazione e comunicazione',
    premiumRatioMin: 0.004,
    premiumRatioMid: 0.007,
    premiumRatioMax: 0.012,
    mainRami: ['RC Professionale', 'Cyber Risk', 'D&O Amministratori', 'Tutela legale'],
    riskLevel: 'low',
    notes: 'Cyber Risk in forte crescita (+30% YoY)',
  },
  'K': {
    atecoLetter: 'K',
    description: 'Attività finanziarie e assicurative',
    premiumRatioMin: 0.008,
    premiumRatioMid: 0.012,
    premiumRatioMax: 0.018,
    mainRami: ['RC Professionale obbligatoria', 'D&O', 'Crime', 'Cyber'],
    riskLevel: 'medium',
    notes: 'RC Professionale obbligatoria per intermediari',
  },
  'L': {
    atecoLetter: 'L',
    description: 'Attività immobiliari',
    premiumRatioMin: 0.010,
    premiumRatioMid: 0.015,
    premiumRatioMax: 0.022,
    mainRami: ['Globale Fabbricati', 'RC Proprietà', 'Tutela legale locazioni'],
    riskLevel: 'medium',
    notes: 'Premi proporzionali al portafoglio immobiliare',
  },
  'M': {
    atecoLetter: 'M',
    description: 'Attività professionali, scientifiche e tecniche',
    premiumRatioMin: 0.006,
    premiumRatioMid: 0.010,
    premiumRatioMax: 0.015,
    mainRami: ['RC Professionale obbligatoria', 'Tutela legale', 'D&O', 'Studio Globale'],
    riskLevel: 'low',
    notes: 'RC Professionale obbligatoria per albo (avvocati, ingegneri, architetti)',
  },
  'N': {
    atecoLetter: 'N',
    description: 'Noleggio, agenzie viaggio, servizi di supporto',
    premiumRatioMin: 0.005,
    premiumRatioMid: 0.010,
    premiumRatioMax: 0.015,
    mainRami: ['RC Aziendale', 'Tutela legale', 'Cauzioni'],
    riskLevel: 'low',
  },
  'O': {
    atecoLetter: 'O',
    description: 'Pubblica amministrazione',
    premiumRatioMin: 0.005,
    premiumRatioMid: 0.010,
    premiumRatioMax: 0.018,
    mainRami: ['RC Patrimoniale', 'D&O', 'Tutela legale'],
    riskLevel: 'low',
  },
  'P': {
    atecoLetter: 'P',
    description: 'Istruzione',
    premiumRatioMin: 0.005,
    premiumRatioMid: 0.009,
    premiumRatioMax: 0.014,
    mainRami: ['RC Scuole', 'Infortuni alunni', 'Tutela legale'],
    riskLevel: 'low',
  },
  'Q': {
    atecoLetter: 'Q',
    description: 'Sanità e assistenza sociale',
    premiumRatioMin: 0.015,
    premiumRatioMid: 0.022,
    premiumRatioMax: 0.030,
    mainRami: ['RC Sanitaria obbligatoria (L.24/2017)', 'D&O', 'Tutela legale', 'All-Risk apparecchi medicali'],
    riskLevel: 'high',
    notes: 'RC Sanitaria obbligatoria dal 2017 per strutture sanitarie',
  },
  'R': {
    atecoLetter: 'R',
    description: 'Attività artistiche, sportive, di intrattenimento',
    premiumRatioMin: 0.008,
    premiumRatioMid: 0.013,
    premiumRatioMax: 0.020,
    mainRami: ['RC Eventi', 'Annullamento eventi', 'Infortuni atleti', 'All-Risk strutture'],
    riskLevel: 'medium',
  },
  'S': {
    atecoLetter: 'S',
    description: 'Altre attività di servizi',
    premiumRatioMin: 0.006,
    premiumRatioMid: 0.011,
    premiumRatioMax: 0.018,
    mainRami: ['RC Esercente', 'Tutela legale'],
    riskLevel: 'low',
  },
}

/** Default fallback se ATECO non riconosciuto */
const DEFAULT_BENCHMARK: SectorBenchmark = {
  atecoLetter: '?',
  description: 'Settore non identificato',
  premiumRatioMin: 0.008,
  premiumRatioMid: 0.012,
  premiumRatioMax: 0.020,
  mainRami: ['RC Aziendale generica'],
  riskLevel: 'medium',
  notes: 'Stima conservativa basata su media nazionale',
}

/**
 * Estrae la lettera macro-settore da un codice ATECO completo.
 * Codici ATECO 2007: lettera + 6 cifre (es. "62.01.00" → settore 'J')
 *
 * Mappatura range numerici → lettera:
 *   01-03 → A
 *   05-09 → B
 *   10-33 → C
 *   35    → D
 *   36-39 → E
 *   41-43 → F
 *   45-47 → G
 *   49-53 → H
 *   55-56 → I
 *   58-63 → J
 *   64-66 → K
 *   68    → L
 *   69-75 → M
 *   77-82 → N
 *   84    → O
 *   85    → P
 *   86-88 → Q
 *   90-93 → R
 *   94-96 → S
 *   97-98 → T
 *   99    → U
 */
export function atecoToLetter(atecoCode?: string | null): string {
  if (!atecoCode || typeof atecoCode !== 'string') return '?'
  // Estrai prime due cifre
  const m = atecoCode.match(/(\d{2})/)
  if (!m) return '?'
  const n = parseInt(m[1], 10)
  if (n >= 1 && n <= 3) return 'A'
  if (n >= 5 && n <= 9) return 'B'
  if (n >= 10 && n <= 33) return 'C'
  if (n === 35) return 'D'
  if (n >= 36 && n <= 39) return 'E'
  if (n >= 41 && n <= 43) return 'F'
  if (n >= 45 && n <= 47) return 'G'
  if (n >= 49 && n <= 53) return 'H'
  if (n >= 55 && n <= 56) return 'I'
  if (n >= 58 && n <= 63) return 'J'
  if (n >= 64 && n <= 66) return 'K'
  if (n === 68) return 'L'
  if (n >= 69 && n <= 75) return 'M'
  if (n >= 77 && n <= 82) return 'N'
  if (n === 84) return 'O'
  if (n === 85) return 'P'
  if (n >= 86 && n <= 88) return 'Q'
  if (n >= 90 && n <= 93) return 'R'
  if (n >= 94 && n <= 96) return 'S'
  return '?'
}

/** Restituisce il benchmark per un dato ATECO o quello di default. */
export function getBenchmarkByAteco(atecoCode?: string | null): SectorBenchmark {
  const letter = atecoToLetter(atecoCode)
  return SECTOR_BENCHMARKS[letter] || DEFAULT_BENCHMARK
}

/** Restituisce il benchmark direttamente per lettera macro-settore. */
export function getBenchmarkByLetter(letter: string): SectorBenchmark {
  return SECTOR_BENCHMARKS[letter.toUpperCase()] || DEFAULT_BENCHMARK
}

/** Etichetta human-readable per la lettera */
export function sectorLetterLabel(letter: string): string {
  const b = SECTOR_BENCHMARKS[letter.toUpperCase()]
  return b ? b.description : DEFAULT_BENCHMARK.description
}

/**
 * Stima il volume premi assicurativi annuo dato fatturato + ATECO.
 *
 * @param turnover Fatturato annuo in €
 * @param atecoCode Codice ATECO (es. "62.01.00")
 * @returns Range stima premi {min, mid, max} in €
 */
export function estimatePremiumsBySector(
  turnover: number,
  atecoCode?: string | null,
): { min: number; mid: number; max: number; benchmark: SectorBenchmark } {
  const benchmark = getBenchmarkByAteco(atecoCode)
  return {
    min: Math.round(turnover * benchmark.premiumRatioMin),
    mid: Math.round(turnover * benchmark.premiumRatioMid),
    max: Math.round(turnover * benchmark.premiumRatioMax),
    benchmark,
  }
}

/**
 * Stima il numero veicoli aziendali in base a settore + dipendenti + fatturato.
 * Heuristica conservativa basata su rapporti settoriali medi.
 */
export function estimateVehiclesBySector(
  atecoCode: string | null | undefined,
  employees: number = 0,
  turnover: number = 0,
): { min: number; mid: number; max: number; rationale: string } {
  const letter = atecoToLetter(atecoCode)
  // Settore Trasporti (H): rapporto veicoli/dipendenti molto alto
  if (letter === 'H') {
    const minV = Math.max(1, Math.round(employees * 0.6))
    const midV = Math.max(2, Math.round(employees * 0.9))
    const maxV = Math.max(3, Math.round(employees * 1.3))
    return { min: minV, mid: midV, max: maxV, rationale: 'Settore trasporti H: ~0.9 veicoli/dipendente' }
  }
  // Settore Costruzioni (F): mezzi cantiere + furgoni
  if (letter === 'F') {
    const minV = Math.max(1, Math.round(employees * 0.2))
    const midV = Math.max(2, Math.round(employees * 0.35))
    const maxV = Math.max(3, Math.round(employees * 0.5))
    return { min: minV, mid: midV, max: maxV, rationale: 'Settore costruzioni F: ~0.35 veicoli/dipendente' }
  }
  // Settore Commercio (G): furgoni consegna
  if (letter === 'G') {
    const minV = Math.max(1, Math.round(employees * 0.15))
    const midV = Math.max(1, Math.round(employees * 0.25))
    const maxV = Math.max(2, Math.round(employees * 0.4))
    return { min: minV, mid: midV, max: maxV, rationale: 'Settore commercio G: ~0.25 veicoli/dipendente' }
  }
  // Manifatturiero/Agricoltura: alcuni mezzi
  if (letter === 'C' || letter === 'A') {
    const minV = Math.max(0, Math.round(employees * 0.08))
    const midV = Math.max(1, Math.round(employees * 0.15))
    const maxV = Math.max(2, Math.round(employees * 0.25))
    return { min: minV, mid: midV, max: maxV, rationale: `Settore ${letter}: ~0.15 veicoli/dipendente` }
  }
  // Servizi/professionale: minimo (solo auto aziendali dirigenti)
  const minV = 0
  const midV = Math.max(0, Math.round(employees * 0.05))
  const maxV = Math.max(1, Math.round(employees * 0.15))
  return { min: minV, mid: midV, max: maxV, rationale: 'Servizi/Professionale: pochi veicoli aziendali' }
}

/** Export del set completo per UI / debug */
export const ALL_BENCHMARKS = SECTOR_BENCHMARKS
