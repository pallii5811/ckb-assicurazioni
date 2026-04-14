import type { AtecoInsurance } from '@/lib/ateco-insurance'
import type { InsuranceGap } from '@/lib/insurance-analysis'

export interface InsuranceEvidenceFact {
  id: string
  label: string
  value: string
  source: string
  confidence: 'alta' | 'media' | 'bassa'
}

export interface InsuranceNeedRecommendation {
  id: string
  product: string
  target: string
  priority: 'immediata' | 'alta' | 'media'
  confidence: 'alta' | 'media' | 'bassa'
  sales_reason: string
  why_now: string
  evidence_ids: string[]
}

export interface DataVerificationGap {
  field: string
  reason: string
  impact: string
}

export interface CommercialPriorityProfile {
  level: 'altissima' | 'alta' | 'media' | 'bassa'
  score: number
  reasons: string[]
}

export interface SalesPlaybook {
  prodotto_principale: string | null
  cross_sell: string | null
  target_principale: string | null
  angolo_attacco: string
  apertura_consigliata: string
  call_to_action: string
}

export interface InsuranceNeedsProfile {
  fatti_verificati: InsuranceEvidenceFact[]
  bisogni_raccomandati: InsuranceNeedRecommendation[]
  dati_da_verificare: DataVerificationGap[]
  priorita_commerciale: CommercialPriorityProfile
  playbook_commerciale: SalesPlaybook
  prossime_domande: string[]
}

type BuildNeedsInput = {
  profile: Record<string, any>
  category: string | null
  website: string | null
  atecoInsurance: AtecoInsurance | null
  gapAnalysis: InsuranceGap | null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const digits = value.replace(/[€.\s]/g, '').replace(',', '.')
  const n = Number(digits)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return null
  const match = value.match(/\d+/)
  if (!match) return null
  const n = parseInt(match[0], 10)
  return Number.isFinite(n) ? n : null
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function pushFact(facts: InsuranceEvidenceFact[], fact: InsuranceEvidenceFact | null) {
  if (!fact) return
  if (facts.some((item) => item.id === fact.id)) return
  facts.push(fact)
}

function pushNeed(needs: InsuranceNeedRecommendation[], need: InsuranceNeedRecommendation | null) {
  if (!need) return
  if (needs.some((item) => item.id === need.id)) return
  needs.push(need)
}

function buildSalesPlaybook(
  needs: InsuranceNeedRecommendation[],
  facts: InsuranceEvidenceFact[],
  verificationGaps: DataVerificationGap[],
): SalesPlaybook {
  const topNeed = needs[0] || null
  const crossSellNeed = needs.find((need) => need.id !== topNeed?.id && (need.priority === 'immediata' || need.priority === 'alta')) || needs[1] || null
  const factMap = new Map(facts.map((fact) => [fact.id, fact]))
  const evidenceLabels = topNeed?.evidence_ids
    ?.map((id) => factMap.get(id)?.label || id.replace(/_/g, ' '))
    .slice(0, 3)
    .join(', ')

  if (!topNeed) {
    return {
      prodotto_principale: null,
      cross_sell: null,
      target_principale: null,
      angolo_attacco: 'Serve prima completare i dati chiave per individuare il prodotto corretto da proporre.',
      apertura_consigliata: 'Prima di proporre una polizza, conviene chiarire attività effettiva, dimensione e struttura dell’azienda.',
      call_to_action: verificationGaps.length > 0
        ? `Recupera prima questi dati: ${verificationGaps.slice(0, 2).map((item) => item.field).join(', ')}.`
        : 'Esegui una call esplorativa di 15 minuti per validare il fabbisogno assicurativo reale.',
    }
  }

  return {
    prodotto_principale: topNeed.product,
    cross_sell: crossSellNeed?.product || null,
    target_principale: topNeed.target,
    angolo_attacco: topNeed.sales_reason,
    apertura_consigliata: evidenceLabels
      ? `Parti da dati pubblici verificati (${evidenceLabels}) e apri la conversazione sul bisogno ${topNeed.product}.`
      : `Apri la call sul bisogno più concreto e immediato: ${topNeed.product}.`,
    call_to_action: crossSellNeed
      ? `Obiettivo call: fissare check-up coperture su ${topNeed.product} e preparare upsell su ${crossSellNeed.product}.`
      : `Obiettivo call: fissare check-up coperture su ${topNeed.product} con verifica massimali, esclusioni e scoperti.`,
  }
}

export function buildInsuranceNeedsProfile({
  profile,
  category,
  website,
  atecoInsurance,
  gapAnalysis,
}: BuildNeedsInput): InsuranceNeedsProfile {
  const facts: InsuranceEvidenceFact[] = []
  const needs: InsuranceNeedRecommendation[] = []
  const verificationGaps: DataVerificationGap[] = []
  const commercialReasons: string[] = []
  const nextQuestions: string[] = []

  const categoryText = String(category || '').toLowerCase()
  const legalForm = String(profile.forma_giuridica || '').toUpperCase()
  const atecoCode = String(profile.codice_ateco || '')
  const atecoEstimated = Boolean(profile.ateco_stimato)
  const revenue = parseNumber(profile.fatturato)
  const employees = parseInteger(profile.dipendenti)
  const hasWebsite = Boolean(website)
  const hasPec = Boolean(profile.pec)
  const zonaSismica = profile.rischio_territoriale?.zona_sismica ?? null
  const rischioIdro = String(profile.rischio_territoriale?.rischio_idrogeologico || '')
  const city = String(profile.sede_legale || profile.comune || '')
  const sectorText = `${categoryText} ${(atecoInsurance?.settore || '').toLowerCase()}`.trim()
  const mandatoryPolicies = [
    ...(atecoInsurance?.polizze_obbligatorie || []),
    ...(atecoInsurance?.polizze_raccomandate || []),
  ].join(' | ').toLowerCase()

  pushFact(facts, legalForm ? {
    id: 'forma_giuridica',
    label: 'Forma giuridica',
    value: legalForm,
    source: 'Registro Imprese / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, atecoCode ? {
    id: 'ateco',
    label: 'Codice ATECO',
    value: atecoCode,
    source: atecoEstimated ? 'Stima assistita AI da dati pubblici' : 'Registro Imprese / profilo camerale',
    confidence: atecoEstimated ? 'media' : 'alta',
  } : null)

  pushFact(facts, revenue !== null ? {
    id: 'fatturato',
    label: 'Fatturato',
    value: `€${new Intl.NumberFormat('it-IT').format(revenue)}`,
    source: 'Bilancio / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, employees !== null ? {
    id: 'dipendenti',
    label: 'Dipendenti',
    value: String(employees),
    source: 'Registro Imprese / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasWebsite ? {
    id: 'website',
    label: 'Sito aziendale',
    value: String(website),
    source: 'Lead + verifica web',
    confidence: 'alta',
  } : null)

  pushFact(facts, hasPec ? {
    id: 'pec',
    label: 'PEC rilevata',
    value: String(profile.pec),
    source: 'INI-PEC / profilo camerale',
    confidence: 'alta',
  } : null)

  pushFact(facts, city ? {
    id: 'sede',
    label: 'Sede legale / città',
    value: city,
    source: 'Registro Imprese / lead',
    confidence: 'media',
  } : null)

  pushFact(facts, zonaSismica ? {
    id: 'zona_sismica',
    label: 'Zona sismica',
    value: String(zonaSismica),
    source: 'Protezione Civile / mapping territoriale',
    confidence: 'media',
  } : null)

  pushFact(facts, rischioIdro ? {
    id: 'rischio_idro',
    label: 'Rischio idrogeologico',
    value: rischioIdro,
    source: 'Mapping territoriale',
    confidence: 'media',
  } : null)

  if (!atecoCode) {
    verificationGaps.push({
      field: 'codice_ateco',
      reason: 'ATECO non disponibile o non verificato',
      impact: 'Riduce la precisione della proposta polizze settoriali',
    })
    nextQuestions.push('Qual è il codice ATECO preciso o l’attività prevalente effettiva?')
  }

  if (revenue === null) {
    verificationGaps.push({
      field: 'fatturato',
      reason: 'Fatturato non disponibile',
      impact: 'Riduce la precisione di massimali, pricing e ranking commerciale',
    })
    nextQuestions.push('Qual è il fatturato indicativo o la fascia di ricavi dell’azienda?')
  }

  if (employees === null) {
    verificationGaps.push({
      field: 'dipendenti',
      reason: 'Numero dipendenti non disponibile',
      impact: 'Riduce la precisione su welfare, infortuni collettivi e benefits',
    })
    nextQuestions.push('Quanti dipendenti o collaboratori operativi ha l’azienda?')
  }

  if (!hasWebsite) {
    verificationGaps.push({
      field: 'website',
      reason: 'Sito non rilevato',
      impact: 'Riduce la precisione su cyber, contatti e segnali commerciali digitali',
    })
  }

  const isCapitalCompany = /SRL|SPA|SRLS/.test(legalForm)
  const isPeopleCompany = /SNC|SAS/.test(legalForm)
  const isProfessional = mandatoryPolicies.includes('rc professionale') || hasAny(sectorText, [/avvocat/, /commerciali/, /notai/, /architett/, /ingegner/, /consulen/, /profession/])
  const isHealthcare = mandatoryPolicies.includes('sanitaria') || hasAny(sectorText, [/medic/, /dentist/, /clinic/, /veterinar/, /farmaci/])
  const isConstruction = mandatoryPolicies.includes('car/ear') || hasAny(sectorText, [/costruzion/, /edili/, /cantier/, /ristruttur/])
  const isTransport = mandatoryPolicies.includes('vettoriale') || hasAny(sectorText, [/trasport/, /logistic/, /autotrasport/, /magazzin/])
  const isManufacturing = hasAny(sectorText, [/manifatt/, /produzion/, /industr/, /aliment/, /chimic/])
  const hasPhysicalRisk = isConstruction || isTransport || isManufacturing || hasAny(sectorText, [/ristoraz/, /bar/, /hotel/, /retail/, /negoz/, /officina/])

  if (isCapitalCompany) {
    pushNeed(needs, {
      id: 'do_amministratori',
      product: 'D&O Amministratori',
      target: 'Amministratore / CdA',
      priority: revenue !== null && revenue >= 2_000_000 ? 'immediata' : 'alta',
      confidence: 'alta',
      sales_reason: 'La forma giuridica espone amministratori e organi sociali a responsabilità personali per scelte gestionali.',
      why_now: revenue !== null && revenue >= 2_000_000 ? 'Dimensione aziendale già sufficiente per proporre revisione D&O strutturata.' : 'Lead con bisogno tipico e molto comprensibile in fase di consulenza.',
      evidence_ids: ['forma_giuridica', ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Società di capitali: D&O è una porta d’ingresso forte e credibile')
    nextQuestions.push('L’amministratore ha già una D&O? Con quale massimale e con quali esclusioni?')
  }

  if (isPeopleCompany) {
    pushNeed(needs, {
      id: 'rc_soci',
      product: 'RC Soci / Protezione patrimonio personale',
      target: 'Soci accomandatari / soci operativi',
      priority: 'alta',
      confidence: 'alta',
      sales_reason: 'Nelle società di persone il tema della responsabilità personale è immediato e molto percepito.',
      why_now: 'È un bisogno direttamente collegato alla forma giuridica rilevata.',
      evidence_ids: ['forma_giuridica'],
    })
    commercialReasons.push('Società di persone: forte leva su patrimonio personale dei soci')
  }

  if (isProfessional) {
    pushNeed(needs, {
      id: 'rc_professionale',
      product: 'RC Professionale',
      target: 'Professionista / studio / titolare',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'L’attività rilevata rientra tra quelle per cui la RC professionale è il primo tavolo di vendita da aprire.',
      why_now: 'È il bisogno più aderente al servizio erogato dall’azienda.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'forma_giuridica') ? ['forma_giuridica'] : [])],
    })
    commercialReasons.push('Settore professionale: prodotto principale chiaro e facilmente spiegabile')
  }

  if (isHealthcare) {
    pushNeed(needs, {
      id: 'rc_sanitaria',
      product: 'RC Sanitaria / Malpractice',
      target: 'Struttura sanitaria / professionista sanitario',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Nel sanitario il rischio di contenzioso e malpractice è centrale e il prodotto è specifico.',
      why_now: 'È un bisogno nativo del settore rilevato.',
      evidence_ids: ['ateco'],
    })
    commercialReasons.push('Settore sanitario: bisogno assicurativo ad altissima rilevanza')
  }

  if (isConstruction) {
    pushNeed(needs, {
      id: 'car_cantieri',
      product: 'CAR / EAR / Decennale Postuma',
      target: 'Titolare / ufficio tecnico / amministratore',
      priority: 'immediata',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Nel settore edile le coperture di cantiere sono concrete, contrattuali e spesso urgenti.',
      why_now: 'Prodotto collegato direttamente al tipo di commesse e di lavori eseguiti.',
      evidence_ids: ['ateco'],
    })
    commercialReasons.push('Edilizia: copertura concreta, tangibile e spesso richiesta dal mercato')
    nextQuestions.push('L’azienda lavora su cantieri propri, subappalti o ristrutturazioni?')
  }

  if (isTransport) {
    pushNeed(needs, {
      id: 'flotta_merci',
      product: 'RC Vettoriale / Flotta / Merci Trasportate',
      target: 'Titolare / fleet manager / logistica',
      priority: 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Trasporti e logistica generano esigenze assicurative molto specifiche e continuative.',
      why_now: 'Il bisogno è collegato al core business operativo.',
      evidence_ids: ['ateco'],
    })
    commercialReasons.push('Trasporti/logistica: più linee di polizza nello stesso lead')
  }

  if (isManufacturing) {
    pushNeed(needs, {
      id: 'rc_prodotti',
      product: 'RC Prodotti / Recall / Contaminazione',
      target: 'Titolare / responsabile qualità / amministratore',
      priority: revenue !== null && revenue >= 1_000_000 ? 'immediata' : 'alta',
      confidence: atecoEstimated ? 'media' : 'alta',
      sales_reason: 'Chi produce o trasforma beni ha un angolo commerciale fortissimo su danno a terzi, difetto e richiamo.',
      why_now: revenue !== null && revenue >= 1_000_000 ? 'Volume d’affari sufficiente per aprire un tavolo RC prodotti serio.' : 'Prodotto coerente con il rischio operativo rilevato.',
      evidence_ids: ['ateco', ...(revenue !== null ? ['fatturato'] : [])],
    })
    commercialReasons.push('Produzione/manifattura: valore alto su RC prodotti e property')
  }

  if (employees !== null && employees >= 10) {
    pushNeed(needs, {
      id: 'employee_benefits',
      product: 'Sanitaria collettiva / Infortuni collettiva / Welfare',
      target: 'Titolare / HR / amministrazione',
      priority: employees >= 50 ? 'immediata' : 'alta',
      confidence: 'alta',
      sales_reason: 'La dimensione dell’organico rende vendibile un’offerta di welfare e coperture collettive.',
      why_now: employees >= 50 ? 'Organico importante: alta probabilità di bisogno attuale o imminente.' : 'Il numero di dipendenti giustifica una proposta benefits credibile.',
      evidence_ids: ['dipendenti'],
    })
    commercialReasons.push('Numero dipendenti sufficiente per pacchetti collettivi')
    nextQuestions.push('Applicate un CCNL con sanità integrativa o avete già un piano welfare?')
  }

  if (hasWebsite && ((employees !== null && employees >= 5) || (revenue !== null && revenue >= 500_000) || isProfessional || isHealthcare)) {
    pushNeed(needs, {
      id: 'cyber_risk',
      product: 'Cyber Risk',
      target: 'Titolare / amministratore / IT / privacy',
      priority: isHealthcare || isProfessional ? 'alta' : 'media',
      confidence: 'media',
      sales_reason: 'Presenza digitale e trattamento di dati aumentano il valore di una proposta cyber ben impostata.',
      why_now: isHealthcare || isProfessional ? 'Settore con dati sensibili o dati cliente critici.' : 'Azienda già abbastanza strutturata da rendere il rischio cyber rilevante.',
      evidence_ids: ['website', ...(employees !== null ? ['dipendenti'] : []), ...(revenue !== null ? ['fatturato'] : [])],
    })
  }

  if (hasPhysicalRisk) {
    pushNeed(needs, {
      id: 'property_all_risks',
      product: 'Property / Incendio / All Risks / Business Interruption',
      target: 'Titolare / amministratore',
      priority: zonaSismica && Number(zonaSismica) <= 2 ? 'alta' : 'media',
      confidence: 'media',
      sales_reason: 'Il business sembra dipendere da beni, locali, attrezzature o continuità operativa.',
      why_now: zonaSismica && Number(zonaSismica) <= 2 ? 'Rischio territoriale e continuità operativa aumentano la rilevanza della proposta.' : 'Copertura quasi sempre presente, quindi ottima per revisione e up-sell.',
      evidence_ids: ['ateco', ...(facts.some((f) => f.id === 'zona_sismica') ? ['zona_sismica'] : []), ...(facts.some((f) => f.id === 'rischio_idro') ? ['rischio_idro'] : [])],
    })
  }

  if (gapAnalysis?.gaps?.length) {
    const topGap = gapAnalysis.gaps.find((gap) => gap.gravita === 'critico') || gapAnalysis.gaps[0]
    if (topGap) {
      commercialReasons.push(`Gap prioritario rilevato: ${topGap.area}`)
      nextQuestions.push(`Avete già una copertura attiva per ${topGap.area}?`) 
    }
  }

  const immediateNeeds = needs.filter((need) => need.priority === 'immediata').length
  const highNeeds = needs.filter((need) => need.priority === 'alta').length
  let commercialScore = 20 + immediateNeeds * 18 + highNeeds * 10 + Math.min(facts.length, 8) * 3 - verificationGaps.length * 4

  if (revenue !== null && revenue >= 2_000_000) commercialScore += 10
  if (employees !== null && employees >= 10) commercialScore += 8
  if (gapAnalysis?.livello_rischio === 'critico') commercialScore += 10
  if (gapAnalysis?.livello_rischio === 'alto') commercialScore += 6

  commercialScore = Math.max(0, Math.min(100, commercialScore))

  const commercialLevel: CommercialPriorityProfile['level'] =
    commercialScore >= 75 ? 'altissima'
    : commercialScore >= 55 ? 'alta'
    : commercialScore >= 35 ? 'media'
    : 'bassa'

  needs.sort((a, b) => {
    const priorityOrder = { immediata: 0, alta: 1, media: 2 }
    const confidenceOrder = { alta: 0, media: 1, bassa: 2 }
    return priorityOrder[a.priority] - priorityOrder[b.priority] || confidenceOrder[a.confidence] - confidenceOrder[b.confidence]
  })

  const playbook = buildSalesPlaybook(needs, facts, verificationGaps)

  return {
    fatti_verificati: facts,
    bisogni_raccomandati: needs,
    dati_da_verificare: verificationGaps,
    priorita_commerciale: {
      level: commercialLevel,
      score: commercialScore,
      reasons: commercialReasons.slice(0, 5),
    },
    playbook_commerciale: playbook,
    prossime_domande: Array.from(new Set(nextQuestions)).slice(0, 6),
  }
}
