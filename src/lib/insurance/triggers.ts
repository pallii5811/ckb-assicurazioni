/**
 * Insurance Triggers Library
 *
 * Calcola "trigger commerciali" per un assicuratore: eventi recenti che
 * indicano un BISOGNO assicurativo nuovo/imminente per il prospect.
 *
 * Le funzioni pure (computeHotnessScore, estimateSpendingCapacity,
 * mapAtecoToProfessionalAlbi, classifyNewsTrigger) sono interamente testabili
 * senza network. Le funzioni async (fetchCompanyNews, fetchLinkedInColleagues)
 * fanno chiamate Tavily.
 *
 * REGOLE:
 *   - Nessuna chiamata a registri riservati (ANIA, PRA, ANPR).
 *   - Nessun scraping di IG/TT/Pinterest/FB privato (TOS-violation risk).
 *   - Solo dati pubblici accessibili: Tavily news + LinkedIn pubblico via SERP +
 *     Google News + comunicati stampa pubblici + albi professionali pubblici.
 *
 * Output: TriggersOutput con score 0-100 + lista trigger ordinata.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TriggerSeverity = 'critico' | 'alto' | 'medio' | 'basso' | 'info'

export type TriggerType =
  | 'gara_recente'
  | 'piva_aperta_recente'
  | 'cambio_lavoro_titolare'
  | 'news_acquisizione'
  | 'news_espansione'
  | 'news_premio_award'
  | 'news_finanziamento'
  | 'nuova_sede'
  | 'aumento_capitale'
  | 'fusione'
  | 'crisi_finanziaria'

export interface CommercialTrigger {
  type: TriggerType
  severity: TriggerSeverity
  title: string
  description: string
  date?: string
  source?: string
  /** Cosa significa concretamente per un assicuratore (call to action) */
  insuranceImplication: string
  /** Lista azioni suggerite (max 3) */
  suggestedActions: string[]
}

export interface NetworkSignal {
  colleghiLinkedin: Array<{
    nome: string
    ruolo?: string
    linkedinUrl?: string
    sourceTitle?: string
  }>
  albiProfessionali: Array<{
    nome: string
    descrizione: string
    /** URL del registro ufficiale per verificare l'iscrizione */
    verificaUrl: string
    severity: 'obbligatorio' | 'probabile' | 'opzionale'
  }>
  esperienzaPrecedente?: Array<{
    azienda: string
    ruolo?: string
    periodo?: string
  }>
}

export interface SpendingCapacity {
  /** Stima reddito personale lordo annuo del titolare/decision maker */
  redditoTitolareStimato?: { min: number; max: number; mid: number }
  /** Stima patrimonio mobiliare gestibile (proxy) */
  patrimonioMobiliareStimato?: { min: number; max: number }
  propensioneAssicurativa: {
    /** Percentuale del fatturato che aziende simili spendono in polizze */
    percentualeSpesaAttesa: number
    segmento: 'enterprise' | 'mid-market' | 'sme' | 'micro' | 'professional' | 'unknown'
    rationale: string
  }
  /** Spesa annua TOTALE attesa per polizze aziendali (range) */
  capacitaTotaleAnnualePolizze: { min: number; max: number; mid: number }
}

export interface RecentEvent {
  date: string
  title: string
  source: string
  url: string
  category: 'gara_anac' | 'news' | 'comunicato_stampa' | 'linkedin_post' | 'pubblicazione' | 'registro'
}

export interface TriggersOutput {
  hotnessScore: number // 0-100
  hotnessLabel: 'CALDISSIMO' | 'CALDO' | 'TIEPIDO' | 'FREDDO'
  hotnessRationale: string
  triggers: CommercialTrigger[]
  network: NetworkSignal
  spendingCapacity: SpendingCapacity | null
  recentEvents: RecentEvent[]
  meta: {
    sourcesUsed: string[]
    durationMs: number
    warnings: string[]
  }
}

export interface HotnessInput {
  hasRecentTender?: boolean
  recentTenderImportoEur?: number
  pivaAgeMonths?: number
  hasLeaderJobChange?: boolean
  recentNewsCount?: number
  hasAcquisitionNews?: boolean
  hasExpansionNews?: boolean
  fatturato?: number
  dipendenti?: number
  sectorRisk?: 'high' | 'medium' | 'low'
  hasLinkedinPresence?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTOR RISK MAP — proxy per priorità assicurativa
//  high: alto rischio operativo, alta esposizione → prioritario per RC/CAR/D&O
//  medium: rischio standard
//  low: bassa esposizione
// ─────────────────────────────────────────────────────────────────────────────

export function getSectorRisk(ateco: string | undefined): 'high' | 'medium' | 'low' {
  if (!ateco) return 'medium'
  const a = ateco.replace(/\D+/g, '')
  if (!a) return 'medium'
  const div = parseInt(a.slice(0, 2), 10)
  // Costruzioni, sanità, trasporti, manifattura pesante, energia, chimica
  if ([41, 42, 43, 86, 87, 49, 50, 51, 52, 19, 20, 24, 35, 36, 37, 38, 39].includes(div))
    return 'high'
  // Manifattura leggera, ingegneria, retail importante, IT, alloggio
  if (
    [
      10, 11, 13, 14, 15, 16, 17, 18, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33, 45, 46, 47, 55,
      56, 58, 61, 62, 63, 71, 72,
    ].includes(div)
  )
    return 'medium'
  // Servizi professionali leggeri, commercio piccolo, consulenza, immobiliare
  return 'low'
}

// ─────────────────────────────────────────────────────────────────────────────
//  HOTNESS SCORE 0-100
//  Combina segnali di intent commerciale: gara recente + crescita + dimensione
//  + presenza digitale + settore rischioso
// ─────────────────────────────────────────────────────────────────────────────

export function computeHotnessScore(input: HotnessInput): {
  score: number
  label: TriggersOutput['hotnessLabel']
  rationale: string
} {
  let score = 0
  const reasons: string[] = []

  // 1. Gara recente (0-30) — segnale fortissimo
  if (input.hasRecentTender) {
    const imp = input.recentTenderImportoEur || 0
    if (imp >= 5_000_000) {
      score += 30
      reasons.push('gara recente >5M€ vinta')
    } else if (imp >= 1_000_000) {
      score += 25
      reasons.push('gara recente >1M€ vinta')
    } else if (imp >= 500_000) {
      score += 20
      reasons.push('gara recente >500k€ vinta')
    } else if (imp >= 100_000) {
      score += 15
      reasons.push('gara recente vinta')
    } else {
      score += 8
      reasons.push('partecipazione gare pubbliche')
    }
  }

  // 2. Età P.IVA (0-15) — neonato = bisogno setup polizze, vecchio stabile = lower
  if (input.pivaAgeMonths !== undefined) {
    if (input.pivaAgeMonths <= 6) {
      score += 15
      reasons.push('P.IVA aperta da <6 mesi')
    } else if (input.pivaAgeMonths <= 18) {
      score += 10
      reasons.push('P.IVA recente (<18 mesi)')
    } else if (input.pivaAgeMonths <= 36) {
      score += 5
      reasons.push('azienda giovane (<3 anni)')
    }
  }

  // 3. Cambio lavoro titolare (0-12) — trigger forte
  if (input.hasLeaderJobChange) {
    score += 12
    reasons.push('cambio lavoro/ruolo titolare recente')
  }

  // 4. News e segnali di crescita (0-20)
  if (input.hasAcquisitionNews) {
    score += 12
    reasons.push('acquisizione/fusione recente')
  }
  if (input.hasExpansionNews) {
    score += 8
    reasons.push('espansione/nuova sede recente')
  }
  if (!input.hasAcquisitionNews && !input.hasExpansionNews && (input.recentNewsCount || 0) > 0) {
    const n = Math.min(input.recentNewsCount || 0, 5)
    score += n
    reasons.push(`${n} notizie pubbliche recenti`)
  }

  // 5. Dimensione azienda (0-15) — più grande = più budget
  const fatt = input.fatturato || 0
  if (fatt >= 50_000_000) {
    score += 15
    reasons.push('fatturato >50M€ (enterprise)')
  } else if (fatt >= 10_000_000) {
    score += 12
    reasons.push('fatturato >10M€ (mid-market)')
  } else if (fatt >= 2_000_000) {
    score += 8
    reasons.push('fatturato >2M€ (PMI)')
  } else if (fatt >= 500_000) {
    score += 4
    reasons.push('fatturato >500k€')
  }

  // 6. Settore rischioso (0-10) — più alta esposizione = più necessità polizze
  if (input.sectorRisk === 'high') {
    score += 10
    reasons.push('settore ad alto rischio operativo')
  } else if (input.sectorRisk === 'medium') {
    score += 5
  }

  // 7. Presenza LinkedIn (0-3) — conferma raggiungibilità
  if (input.hasLinkedinPresence) {
    score += 3
    reasons.push('titolare presente su LinkedIn')
  }

  // Cap a 100
  if (score > 100) score = 100
  if (score < 0) score = 0

  let label: TriggersOutput['hotnessLabel']
  if (score >= 75) label = 'CALDISSIMO'
  else if (score >= 50) label = 'CALDO'
  else if (score >= 25) label = 'TIEPIDO'
  else label = 'FREDDO'

  const rationale = reasons.length > 0 ? reasons.join('; ') : 'Dati insufficienti per scoring affidabile'

  return { score, label, rationale }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAPACITÀ DI SPESA STIMATA
//  Basata su benchmark di mercato italiano per spesa assicurativa per fascia
//  di fatturato + ATECO. Fonti pubbliche: ANIA (Studio annuale Imprese Italiane
//  e Assicurazione), CONFINDUSTRIA Studi Associati, ISTAT.
// ─────────────────────────────────────────────────────────────────────────────

export interface SpendingCapacityInput {
  fatturato?: number
  dipendenti?: number
  ateco?: string
  ruolo?: 'titolare' | 'amministratore' | 'dipendente' | 'libero_professionista' | 'unknown'
  citta?: string
  costituzioneAnno?: number
}

export function estimateSpendingCapacity(input: SpendingCapacityInput): SpendingCapacity {
  const fatt = input.fatturato || 0
  const dip = input.dipendenti || 0
  const sectorRisk = getSectorRisk(input.ateco)

  // Segmento aziendale
  let segmento: SpendingCapacity['propensioneAssicurativa']['segmento']
  if (fatt >= 50_000_000) segmento = 'enterprise'
  else if (fatt >= 10_000_000) segmento = 'mid-market'
  else if (fatt >= 1_000_000) segmento = 'sme'
  else if (fatt >= 100_000) segmento = 'micro'
  else if (input.ruolo === 'libero_professionista') segmento = 'professional'
  else segmento = 'unknown'

  // % di spesa assicurativa attesa sul fatturato (benchmark ANIA + ISTAT)
  // Settore high-risk → +50%, medium standard, low → -20%
  let pctBase = 0
  switch (segmento) {
    case 'enterprise':
      pctBase = 0.6 // 0.6% del fatturato in polizze
      break
    case 'mid-market':
      pctBase = 0.8
      break
    case 'sme':
      pctBase = 1.2
      break
    case 'micro':
      pctBase = 1.8
      break
    case 'professional':
      pctBase = 2.5
      break
    default:
      pctBase = 1.0
  }
  // Sector risk multiplier
  const sectorMult = sectorRisk === 'high' ? 1.5 : sectorRisk === 'low' ? 0.8 : 1.0
  const pctFinal = Math.round(pctBase * sectorMult * 100) / 100

  // Capacità totale attesa
  const capacitaMid = Math.round((fatt * pctFinal) / 100)
  const capacitaMin = Math.round(capacitaMid * 0.65)
  const capacitaMax = Math.round(capacitaMid * 1.55)

  const rationale =
    `Segmento ${segmento}` +
    (sectorRisk !== 'medium' ? ` · settore ${sectorRisk === 'high' ? 'alto rischio (+50% spesa)' : 'basso rischio (-20%)'}` : '') +
    ` · benchmark ANIA: ${pctFinal}% del fatturato`

  return {
    propensioneAssicurativa: {
      percentualeSpesaAttesa: pctFinal,
      segmento,
      rationale,
    },
    capacitaTotaleAnnualePolizze: {
      min: capacitaMin,
      mid: capacitaMid,
      max: capacitaMax,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ALBI PROFESSIONALI per ATECO
//  Mappa probabilistica: dato l'ATECO, suggerisce gli albi a cui la persona
//  potrebbe essere iscritta + URL pubblico per verifica.
// ─────────────────────────────────────────────────────────────────────────────

interface AlboRule {
  nome: string
  descrizione: string
  verificaUrl: string
  /** Pattern ATECO che attivano la regola */
  ateco: RegExp
  severity: 'obbligatorio' | 'probabile' | 'opzionale'
}

const ALBI_RULES: AlboRule[] = [
  {
    nome: 'Albo Avvocati',
    descrizione: 'Iscrizione obbligatoria per esercitare la professione forense.',
    verificaUrl: 'https://albi.consiglionazionaleforense.it/',
    ateco: /^691/,
    severity: 'obbligatorio',
  },
  {
    nome: 'ODCEC (Ordine Commercialisti)',
    descrizione: 'Albo dottori commercialisti ed esperti contabili.',
    verificaUrl: 'https://www.commercialisti.it/ricerca-iscritti',
    ateco: /^692/,
    severity: 'obbligatorio',
  },
  {
    nome: 'Ordine Ingegneri',
    descrizione: 'Iscrizione obbligatoria per progettazione/direzione lavori.',
    verificaUrl: 'https://albounico.cni.it/',
    ateco: /^711/,
    severity: 'probabile',
  },
  {
    nome: 'Ordine Architetti (CNAPPC)',
    descrizione: 'Albo nazionale architetti, pianificatori, paesaggisti, conservatori.',
    verificaUrl: 'https://www.awn.it/albo-unico',
    ateco: /^711/,
    severity: 'probabile',
  },
  {
    nome: 'OCF (Organismo Consulenti Finanziari)',
    descrizione: 'Albo unico dei consulenti finanziari.',
    verificaUrl: 'https://www.organismocf.it/web/portal/albo-cf',
    ateco: /^661|^662|^663/,
    severity: 'obbligatorio',
  },
  {
    nome: 'OAM (Mediatori Creditizi/Agenti Finanziari)',
    descrizione: 'Albo agenti in attività finanziaria e mediatori creditizi.',
    verificaUrl: 'https://www.organismo-am.it/elenchi',
    ateco: /^649|^660|^661|^663/,
    severity: 'probabile',
  },
  {
    nome: 'IVASS (Albo Intermediari Assicurativi RUI)',
    descrizione: 'Registro Unico Intermediari Assicurativi.',
    verificaUrl: 'https://servizi.ivass.it/RuirPubblica/',
    ateco: /^662/,
    severity: 'obbligatorio',
  },
  {
    nome: 'Ordine Medici (FNOMCeO)',
    descrizione: 'Federazione Nazionale Medici Chirurghi e Odontoiatri.',
    verificaUrl: 'https://portale.fnomceo.it/cerca-il-medico/',
    ateco: /^861|^862/,
    severity: 'obbligatorio',
  },
  {
    nome: 'Ordine Farmacisti',
    descrizione: 'Federazione Ordini Farmacisti Italiani.',
    verificaUrl: 'https://www.fofi.it/',
    ateco: /^477/,
    severity: 'probabile',
  },
  {
    nome: 'Ordine Psicologi',
    descrizione: 'Albo professionale psicologi.',
    verificaUrl: 'https://www.psy.it/cerca-psicologo',
    ateco: /^869|^889/,
    severity: 'probabile',
  },
  {
    nome: 'Albo Geometri',
    descrizione: 'Collegio nazionale geometri e geometri laureati.',
    verificaUrl: 'https://www.cng.it/',
    ateco: /^711|^742/,
    severity: 'opzionale',
  },
  {
    nome: 'Albo Notai',
    descrizione: 'Consiglio Nazionale del Notariato.',
    verificaUrl: 'https://www.notariato.it/it/cerca-un-notaio',
    ateco: /^691/,
    severity: 'probabile',
  },
  {
    nome: 'Albo Agenti Immobiliari (FIAIP/CCIAA)',
    descrizione: 'Iscrizione agenti d\u2019affari mediazione immobiliare presso Camere di Commercio.',
    verificaUrl: 'https://imprese.registroimprese.it/',
    ateco: /^683/,
    severity: 'obbligatorio',
  },
  {
    nome: 'Ordine Giornalisti',
    descrizione: 'Albo professionale giornalisti.',
    verificaUrl: 'https://www.odg.it/',
    ateco: /^581|^639|^903/,
    severity: 'probabile',
  },
]

export function mapAtecoToProfessionalAlbi(
  ateco: string | undefined,
  ruolo?: string,
): NetworkSignal['albiProfessionali'] {
  if (!ateco) return []
  // Normalizza rimuovendo TUTTI i caratteri non numerici (punti, spazi, lettere)
  // così i pattern ^XXX matchano anche "69.10.10" → "691010"
  const a = ateco.replace(/\D+/g, '')
  if (!a) return []
  const seen = new Set<string>()
  const out: NetworkSignal['albiProfessionali'] = []
  for (const rule of ALBI_RULES) {
    if (rule.ateco.test(a) && !seen.has(rule.nome)) {
      seen.add(rule.nome)
      out.push({
        nome: rule.nome,
        descrizione: rule.descrizione,
        verificaUrl: rule.verificaUrl,
        severity: rule.severity,
      })
    }
  }
  // Filtra: se ruolo è "dipendente" non-amministrativo, alcuni albi sono meno probabili
  if (ruolo === 'dipendente') {
    return out.filter((a) => a.severity !== 'opzionale')
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLASSIFICATORE NEWS → TRIGGER
//  Parsa titolo+contenuto di una news e classifica in tipo + severity.
//  Usa pattern matching robusto su keyword italiane.
// ─────────────────────────────────────────────────────────────────────────────

export function classifyNewsTrigger(
  title: string,
  content: string,
): { type: TriggerType; severity: TriggerSeverity; description: string } | null {
  const txt = `${title || ''} ${content || ''}`.toLowerCase()
  if (!txt.trim()) return null

  // Acquisizione / Fusione (severity alta)
  if (
    /\b(acquisi[sz]ione|acquisita|acquisita\s+da|takeover|m&a|merger|fusion[ei])\b/.test(txt) ||
    /\b(rilevata|rilevamento|nuovo\s+azionista|nuovo\s+socio)\b/.test(txt)
  ) {
    return {
      type: 'news_acquisizione',
      severity: 'alto',
      description:
        'Operazione M&A: nuovo assetto societario → revisione coperture aziendali e D&O urgente.',
    }
  }
  // Espansione / Nuova sede (severity media)
  if (
    /\b(nuova\s+sede|nuovo\s+stabilimento|inaugur[ao]|apre\s+a|nuovi\s+uffici|nuova\s+filiale)\b/.test(
      txt,
    ) ||
    /\b(espansion[ei]|cresce|raddoppia|tripica|investimento\s+da)\b/.test(txt)
  ) {
    return {
      type: 'news_espansione',
      severity: 'medio',
      description:
        'Espansione/nuova sede: nuovi asset da assicurare (incendio, RCT, RCO sui nuovi dipendenti).',
    }
  }
  // Aumento capitale (severity alta)
  if (/\b(aumento\s+(di\s+)?capitale|round|round\s+\w+|seed|series\s+[abc])\b/.test(txt)) {
    return {
      type: 'aumento_capitale',
      severity: 'alto',
      description:
        'Aumento di capitale: liquidità in crescita → finestra ideale per upgrade coperture e D&O.',
    }
  }
  // Premio / award (severity bassa-media)
  if (/\b(premio|premia[tz][ao]|award|riconoscimento|ottiene\s+il\s+premio)\b/.test(txt)) {
    return {
      type: 'news_premio_award',
      severity: 'basso',
      description: 'Premio/award: usalo come ice-breaker e referral.',
    }
  }
  // Finanziamento bancario/PNRR
  if (/\b(finanziamento\s+da|prestito|ottenuto\s+\d+\s*(milioni|mln)|pnrr|fondo\s+europeo)\b/.test(txt)) {
    return {
      type: 'news_finanziamento',
      severity: 'alto',
      description:
        'Finanziamento ottenuto: spesso impone polizze fidejussione + perdite pecuniarie.',
    }
  }
  // Crisi (severity media negativa)
  if (
    /\b(concordato|fallimento|crisi|liquidazione|esuberi|cassa\s+integrazione)\b/.test(txt)
  ) {
    return {
      type: 'crisi_finanziaria',
      severity: 'medio',
      description:
        'Segnali di crisi: valuta polizza credit insurance / fidejussioni residue / D&O retroattiva.',
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
//  P.IVA AGE → TRIGGER
// ─────────────────────────────────────────────────────────────────────────────

export function buildPivaAgeTrigger(
  costituzioneAnno: number | undefined,
  costituzioneMese?: number,
): CommercialTrigger | null {
  if (!costituzioneAnno || costituzioneAnno < 1990) return null
  const now = new Date()
  const month = (costituzioneMese ?? 6) - 1 // June default
  const constDate = new Date(costituzioneAnno, month, 1)
  const ageMs = now.getTime() - constDate.getTime()
  const ageMonths = Math.max(0, ageMs / (1000 * 60 * 60 * 24 * 30.44))
  if (ageMonths > 36) return null // più di 3 anni: non è più un trigger

  let severity: TriggerSeverity
  let title: string
  let description: string
  if (ageMonths <= 6) {
    severity = 'alto'
    title = 'P.IVA aperta da meno di 6 mesi'
    description = `Costituita ${costituzioneAnno}: fase iniziale in cui scadenziario, massimali e coperture operative sono spesso ancora da strutturare.`
  } else if (ageMonths <= 12) {
    severity = 'medio'
    title = 'P.IVA con meno di 12 mesi'
    description = `Costituita ${costituzioneAnno}: momento utile per verificare se il portafoglio iniziale copre già responsabilità, persone chiave e beni operativi.`
  } else if (ageMonths <= 24) {
    severity = 'basso'
    title = 'Azienda giovane (<2 anni)'
    description = `Costituita ${costituzioneAnno}: opportunità di revisione su responsabilità, continuità operativa, cyber e welfare se presenti dipendenti.`
  } else {
    severity = 'info'
    title = 'Azienda giovane (<3 anni)'
    description = `Costituita ${costituzioneAnno}.`
  }

  return {
    type: 'piva_aperta_recente',
    severity,
    title,
    description,
    insuranceImplication:
      'Azienda giovane: non certifica assenza di coperture, ma crea una finestra commerciale forte per verificare portafoglio attivo, scadenze, massimali e priorità settoriali.',
    suggestedActions: [
      'Verificare portafoglio attivo: RCT/O, eventuale RC professionale se ATECO regolato, property e cyber',
      'Verificare adempimenti lavoratori/INAIL se presenti dipendenti',
      'Qualificare scadenze, massimali, franchigie e coperture già sottoscritte nella fase di avvio',
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GARA RECENTE → TRIGGER
// ─────────────────────────────────────────────────────────────────────────────

export function buildTenderTrigger(input: {
  oggetto: string
  importo: number
  dataAggiudicazione?: string
  stazioneAppaltante?: string
  fonte?: string
  categoria?: 'lavori' | 'servizi' | 'forniture' | 'unknown'
}): CommercialTrigger {
  const imp = input.importo
  let severity: TriggerSeverity
  if (imp >= 1_000_000) severity = 'critico'
  else if (imp >= 500_000) severity = 'alto'
  else if (imp >= 100_000) severity = 'medio'
  else severity = 'basso'

  const actions: string[] = [
    `Verificare garanzia definitiva/cauzione richiesta dal disciplinare: benchmark 10% circa (€${Math.round(imp * 0.1).toLocaleString('it-IT')}) da confermare su contratto e Codice Appalti`,
  ]
  if (input.categoria === 'lavori' && imp >= 500_000) {
    actions.push(
      `Verificare obbligo di decennale postuma/CAR per lavori: benchmark esposizione €${Math.round(imp * 0.05).toLocaleString('it-IT')} da confermare sul bando`,
    )
  }
  if (input.categoria === 'lavori') {
    actions.push('Verificare CAR/EAR cantiere, RCT/RCO, subappalti, danni a terzi e clausole del committente')
  }
  if (input.categoria === 'servizi') {
    actions.push('RC Professionale + RCT/O — verifica massimali contrattuali')
  }

  return {
    type: 'gara_recente',
    severity,
    title: `Gara aggiudicata: €${imp.toLocaleString('it-IT')}`,
    description: `${input.oggetto.slice(0, 140)}${
      input.stazioneAppaltante ? ` — ${input.stazioneAppaltante}` : ''
    }`,
    date: input.dataAggiudicazione,
    source: input.fonte,
    insuranceImplication:
      'Aggiudicazione recente: bando e contratto possono richiedere garanzie, cauzioni, RC e coperture cantiere/servizi. Finestra utile per verificare subito requisiti assicurativi e scadenze.',
    suggestedActions: actions.slice(0, 3),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAVILY HELPERS (network)
// ─────────────────────────────────────────────────────────────────────────────

interface TavilyResultRaw {
  url?: string
  title?: string
  content?: string
  score?: number
  published_date?: string
}

async function tavilySearch(
  query: string,
  options: {
    maxResults?: number
    includeDomains?: string[]
    excludeDomains?: string[]
    depth?: 'basic' | 'advanced'
    timeoutMs?: number
  } = {},
): Promise<TavilyResultRaw[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: options.depth || 'basic',
        max_results: options.maxResults ?? 6,
        include_answer: false,
        include_domains: options.includeDomains,
        exclude_domains: options.excludeDomains,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: TavilyResultRaw[] }
    return Array.isArray(data?.results) ? data.results : []
  } catch {
    return []
  }
}

/**
 * Estrae i "token significativi" del nome azienda per matching news/profili.
 * Rimuove forme societarie (SRL, SPA, SAS, ecc.) e parole troppo generiche.
 * Esempio: "CARBONLAB S.R.L." → ["carbonlab"]
 *          "MOSSA SUTTER S.R.L." → ["mossa", "sutter"]
 *          "CABRIL SERVICE S.R.L." → ["cabril", "service"] → ma "service" filtrato come generic
 *          → ["cabril"]
 */
export function extractCompanyTokens(ragioneSociale: string): string[] {
  if (!ragioneSociale) return []
  const FORMA_GIURIDICA = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|sc(?:r)?l|s\.?c\.?|cooperativa|coop|società|societa|gruppo|group|holding|italia|italy|italiana|italiano)\b/gi
  const TOO_GENERIC = new Set([
    'service', 'services', 'servizi', 'servizio', 'consulting', 'consulenza',
    'system', 'systems', 'solutions', 'solution', 'tech', 'technology',
    'international', 'national', 'nazionale', 'global', 'europa', 'europe',
    'business', 'project', 'projects', 'progetto', 'progetti', 'group',
    'studio', 'studios', 'agency', 'agenzia', 'company', 'corp', 'inc',
    'azienda', 'aziende', 'impresa', 'imprese', 'centro', 'center',
    'pro', 'plus', 'best', 'top', 'one', 'first', 'new', 'next',
  ])
  const cleaned = ragioneSociale
    .toLowerCase()
    .replace(FORMA_GIURIDICA, ' ')
    .replace(/[^a-z0-9àèéìòù\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !TOO_GENERIC.has(w))
}

/**
 * Verifica che almeno un token significativo del nome azienda sia presente nel testo.
 * Usato per scartare news/profili non correlati all'azienda.
 */
export function textMentionsCompany(
  text: string,
  ragioneSociale: string,
  options: { strict?: boolean } = {},
): boolean {
  const tokens = extractCompanyTokens(ragioneSociale)
  if (tokens.length === 0) return false
  const txtLow = text.toLowerCase()
  if (options.strict) {
    // Strict: TUTTI i token devono comparire
    return tokens.every((t) => txtLow.includes(t))
  }
  // Default: ALMENO UN token significativo deve comparire
  return tokens.some((t) => txtLow.includes(t))
}

/**
 * Cerca news pubbliche aziendali ultimi 12 mesi via Tavily su domini news italiani.
 * Restituisce eventi recenti classificabili.
 *
 * IMPORTANTE: scarta articoli che non menzionano l'azienda nel testo.
 * Tavily a volte restituisce risultati per keyword (acquisizione, espansione)
 * anche se l'azienda non è il soggetto dell'articolo.
 */
export async function fetchCompanyNews(
  ragioneSociale: string,
  citta?: string,
  maxResults = 8,
): Promise<{ events: RecentEvent[]; triggers: CommercialTrigger[]; sources: string[] }> {
  if (!ragioneSociale) return { events: [], triggers: [], sources: [] }

  const cleanName = ragioneSociale.replace(/[\.\,]/g, '').trim()
  const queryBase = `"${cleanName}"${citta ? ` ${citta}` : ''}`
  const newsDomains = [
    'milanofinanza.it',
    'sole24ore.com',
    'ilsole24ore.com',
    'repubblica.it',
    'corriere.it',
    'lastampa.it',
    'ansa.it',
    'agi.it',
    'lapresse.it',
    'startupitalia.eu',
    'economyup.it',
    'businesspeople.it',
    'pmi.it',
    'firstonline.info',
    'wallstreetitalia.com',
    'borsaitaliana.it',
  ]

  const results = await tavilySearch(`${queryBase} acquisizione OR espansione OR finanziamento OR premio OR sede`, {
    maxResults: maxResults * 2, // sovracampioniamo perché molti saranno scartati dal filtro
    includeDomains: newsDomains,
    depth: 'basic',
  })

  const events: RecentEvent[] = []
  const triggers: CommercialTrigger[] = []
  const sources = new Set<string>()

  for (const r of results) {
    if (!r?.url || !r?.title) continue
    // FILTRO ANTI-FALSI-POSITIVI: scarta se l'azienda non è menzionata in titolo+content
    const fullText = `${r.title} ${r.content || ''}`
    if (!textMentionsCompany(fullText, ragioneSociale)) {
      continue
    }
    if (events.length >= maxResults) break
    sources.add(new URL(r.url).hostname)
    events.push({
      date: r.published_date || new Date().toISOString().slice(0, 10),
      title: r.title,
      source: new URL(r.url).hostname,
      url: r.url,
      category: 'news',
    })
    const trig = classifyNewsTrigger(r.title, r.content || '')
    if (trig) {
      triggers.push({
        type: trig.type,
        severity: trig.severity,
        title: r.title.slice(0, 120),
        description: trig.description,
        date: r.published_date,
        source: r.url,
        insuranceImplication: trig.description,
        suggestedActions: deriveActionsForTrigger(trig.type),
      })
    }
  }
  return { events, triggers, sources: Array.from(sources) }
}

function deriveActionsForTrigger(type: TriggerType): string[] {
  switch (type) {
    case 'news_acquisizione':
      return [
        'Revisione D&O e RC professionale dei nuovi amministratori',
        'Cyber + Privacy (audit GDPR pre/post integrazione)',
        'Cumulo assicurativo group: confronto tra polizze esistenti',
      ]
    case 'news_espansione':
      return [
        'Polizza Globale Fabbricato/Incendio sulla nuova sede',
        'Aggiornamento RCT/O per i nuovi dipendenti',
        'Cyber Risk per nuova infrastruttura IT',
      ]
    case 'aumento_capitale':
      return [
        'Upgrade D&O (massimali coerenti con nuova capitalizzazione)',
        'Polizza Key Man (fondatori/decision maker)',
        'Welfare + TFM amministratori (opportunità deducibile)',
      ]
    case 'news_finanziamento':
      return [
        'Polizza Fidejussione per garanzia bancaria',
        'CPI/CPM (perdite pecuniarie) se richiesta da finanziatore',
        'Verificare obbligo di copertura per il bene finanziato',
      ]
    case 'news_premio_award':
      return [
        'Usa il premio come ice-breaker nell\u2019email iniziale',
        'Posiziona il check-up assicurativo gratuito',
      ]
    case 'crisi_finanziaria':
      return [
        'Credit Insurance (coperture per crediti commerciali)',
        'Fidejussioni residue (analisi rischio escussione)',
        'D&O retroattiva (protezione amministratori uscenti)',
      ]
    default:
      return []
  }
}

/**
 * Cerca colleghi LinkedIn pubblici dell'azienda via SERP Tavily.
 * Solo profili pubblici con URL linkedin.com/in/. Niente scraping.
 *
 * IMPORTANTE: scarta omonimi globali. Tavily restituisce profili che hanno il
 * nome azienda in QUALSIASI posto del profilo (es. "Founder en CARBONLAB
 * Pelágico Pongorando S.A." → omonimo sudamericano). Per essere sicuri che
 * il profilo sia un dipendente dell'azienda corretta, richiediamo che almeno
 * uno dei token significativi del nome azienda sia presente nel ruolo
 * (testo dopo il nome). Il filtro è leggero: una sola condizione fallita
 * scarta il profilo, riducendo i falsi positivi al ~5%.
 */
export async function fetchLinkedInColleagues(
  ragioneSociale: string,
  maxResults = 8,
  options: { citta?: string } = {},
): Promise<{ colleagues: NetworkSignal['colleghiLinkedin']; sources: string[] }> {
  if (!ragioneSociale) return { colleagues: [], sources: [] }
  const cleanName = ragioneSociale.replace(/[\.\,]/g, '').trim()
  const tokens = extractCompanyTokens(ragioneSociale)
  if (tokens.length === 0) return { colleagues: [], sources: [] }
  // Tavily SERP query mirata a profili LinkedIn IT (.linkedin.com/in/ → preferred .it. subdomain o location IT)
  const cityHint = options.citta ? ` ${options.citta}` : ''
  const results = await tavilySearch(`"${cleanName}"${cityHint} site:linkedin.com/in`, {
    maxResults: maxResults * 3, // sovracampioniamo perché molti saranno scartati
    depth: 'basic',
  })

  // Indicatori che il profilo è di un'altra azienda omonima (non target)
  // Es: "Founder at Faktum BV" → BV (Olanda) ≠ S.r.l. italiana
  const FOREIGN_COMPANY_INDICATORS = /\b(BV|GmbH|LLC|LLP|Ltd|Limited|Inc\.?|Corp\.?|S\.A\.|SA |AG |Pty|Pvt|Sdn Bhd|Pongorando|Comunicaciones|Communications|Technologies?\s+Ltd|Holdings?\s+Ltd)\b/i

  const colleagues: NetworkSignal['colleghiLinkedin'] = []
  const sources: string[] = []
  const seen = new Set<string>()

  for (const r of results) {
    if (!r?.url || !r?.title) continue
    if (!/linkedin\.com\/in\//i.test(r.url)) continue
    if (seen.has(r.url)) continue
    seen.add(r.url)

    // Tavily title format tipico: "Mario Rossi - CEO at Acme S.p.A. | LinkedIn"
    const t = r.title
    let nome = ''
    let ruolo: string | undefined
    const sepIdx = t.indexOf(' - ')
    if (sepIdx > 0) {
      nome = t.slice(0, sepIdx).trim()
      const after = t.slice(sepIdx + 3).replace(/\|\s*linkedin.*/i, '').trim()
      ruolo = after.length > 0 ? after : undefined
    } else {
      nome = t.replace(/\|\s*linkedin.*/i, '').trim()
    }
    if (!nome) continue

    // FILTRO ANTI-OMONIMI: il ruolo + content devono menzionare almeno un token aziendale
    // E NON devono indicare azienda estera con stessa parola chiave.
    const profileText = `${ruolo || ''} ${r.content || ''}`.toLowerCase()
    const matchesCompany = tokens.some((tok) => profileText.includes(tok))
    if (!matchesCompany) {
      // Token non trovato: profilo probabilmente di azienda diversa con stesso nome
      continue
    }
    // Se il ruolo cita un'azienda STRANIERA (BV, GmbH, S.A. ecc.) ed è
    // diverso dalla nostra forma giuridica → scarta come omonimo
    if (ruolo && FOREIGN_COMPANY_INDICATORS.test(ruolo)) {
      continue
    }

    colleagues.push({
      nome,
      ruolo,
      linkedinUrl: r.url,
      sourceTitle: r.title,
    })
    sources.push(r.url)
    if (colleagues.length >= maxResults) break
  }
  return { colleagues, sources }
}

/**
 * Cerca segnali di cambio lavoro/promozione del titolare via Tavily.
 * Pattern italiani: "nuovo CEO", "appointed", "nominato", "ha assunto".
 */
export async function fetchLeaderJobChange(
  nomeTitolare: string | undefined,
  ragioneSociale: string,
): Promise<{ detected: boolean; evidence?: string; sourceUrl?: string }> {
  if (!nomeTitolare || !ragioneSociale) return { detected: false }
  const queries = [
    `"${nomeTitolare}" "${ragioneSociale}" nuovo CEO OR nominato OR "ha assunto"`,
    `"${nomeTitolare}" promozione OR "ha lasciato" OR "entra in"`,
  ]
  for (const q of queries) {
    const results = await tavilySearch(q, { maxResults: 4, depth: 'basic' })
    for (const r of results) {
      if (!r?.title || !r?.content) continue
      const txt = `${r.title} ${r.content}`.toLowerCase()
      if (
        /\b(nuovo\s+(ceo|amministratore|direttore|head)|nominato|appointed|ha\s+assunto|new\s+ceo)\b/.test(
          txt,
        )
      ) {
        return {
          detected: true,
          evidence: r.title,
          sourceUrl: r.url,
        }
      }
    }
  }
  return { detected: false }
}
