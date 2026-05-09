/**
 * Analisi assicurativa specifica per lead
 * Calcola: gap analysis, classificazione EU, stima premi, segnali rischio
 * Tutto basato su dati REALI già disponibili — zero API esterne
 */

// ── 1. Classificazione dimensionale EU ──────────────────────────
// Reg. UE 651/2014 — definizione PMI

export interface CompanySizeClass {
  classe: 'micro' | 'piccola' | 'media' | 'grande'
  label: string
  descrizione: string
  obblighi_extra: string[]
  opportunita_broker: string[]
}

export function classifyCompanySize(
  fatturato: number | null,
  dipendenti: number | null,
): CompanySizeClass {
  // Reg. UE 651/2014
  if (dipendenti !== null && dipendenti >= 250 || fatturato !== null && fatturato >= 50_000_000) {
    return {
      classe: 'grande',
      label: 'Grande Impresa',
      descrizione: `${dipendenti ? dipendenti + ' dipendenti' : ''}${dipendenti && fatturato ? ' · ' : ''}${fatturato ? '€' + formatNumber(fatturato) + ' fatturato' : ''}`,
      obblighi_extra: [
        'D.Lgs. 231/2001 — Modello 231 fortemente raccomandato, da verificare su governance e rischio-reato',
        'D&O fortemente raccomandata per CdA e top management',
        'Obbligo revisione legale bilancio',
        'NIS2 — obblighi cybersecurity se settore essenziale',
        'CSRD / reporting ESG da verificare in base a soglie, gruppo e qualifica dell’impresa',
      ],
      opportunita_broker: [
        'Programma assicurativo complesso — margine alto',
        'Necessità risk manager dedicato',
        'Polizze multinazionali se opera all\'estero',
        'Programma Employee Benefits strutturato',
        'Possibile gara broker annuale',
      ],
    }
  }

  if (dipendenti !== null && dipendenti >= 50 || fatturato !== null && fatturato >= 10_000_000) {
    return {
      classe: 'media',
      label: 'Media Impresa',
      descrizione: `${dipendenti ? dipendenti + ' dipendenti' : ''}${dipendenti && fatturato ? ' · ' : ''}${fatturato ? '€' + formatNumber(fatturato) + ' fatturato' : ''}`,
      obblighi_extra: [
        'D.Lgs. 231/2001 — Modello 231 fortemente raccomandato',
        'D&O raccomandata per amministratori',
        'DUVRI da verificare in caso di appalti/subappalti',
        'GDPR — DPO consigliato',
      ],
      opportunita_broker: [
        'Pacchetto assicurativo multi-ramo',
        'Polizza Key Man per figure chiave',
        'Employee Benefits (sanità integrativa, previdenza)',
        'Cyber insurance sempre più necessaria',
      ],
    }
  }

  if (dipendenti !== null && dipendenti >= 10 || fatturato !== null && fatturato >= 2_000_000) {
    return {
      classe: 'piccola',
      label: 'Piccola Impresa',
      descrizione: `${dipendenti ? dipendenti + ' dipendenti' : ''}${dipendenti && fatturato ? ' · ' : ''}${fatturato ? '€' + formatNumber(fatturato) + ' fatturato' : ''}`,
      obblighi_extra: [
        'DVR (Documento Valutazione Rischi) obbligatorio',
        'Formazione sicurezza lavoratori obbligatoria',
        'GDPR — registro trattamenti',
      ],
      opportunita_broker: [
        'Pacchetto PMI all-inclusive',
        'RC + Incendio + Furto combinata',
        'Polizza sanitaria collettiva dipendenti',
        'Cyber risk in crescita per PMI',
      ],
    }
  }

  return {
    classe: 'micro',
    label: 'Micro Impresa',
    descrizione: `${dipendenti ? dipendenti + ' dipendenti' : 'Dati dimensionali non disponibili'}${dipendenti && fatturato ? ' · ' : ''}${fatturato ? '€' + formatNumber(fatturato) + ' fatturato' : ''}`,
    obblighi_extra: [
      'DVR semplificato (art. 29 D.Lgs. 81/2008)',
      'GDPR — informativa e consenso base',
    ],
    opportunita_broker: [
      'Polizza multirischio artigiano/commerciante',
      'RC Professionale singola',
      'Polizza infortuni titolare',
      'Protezione locale e attrezzature',
    ],
  }
}

// ── 2. Stima Premio Assicurativo Annuale ──────────────────────────
// Basato su formule standard del mercato assicurativo italiano

export interface PremiumEstimate {
  totale_stimato: string        // es. "€8.500 - €14.000"
  dettaglio: {
    polizza: string
    premio_min: number
    premio_max: number
    note: string
  }[]
  disclaimer: string
  fonte: string
}

export function estimateAnnualPremium(
  fatturato: number | null,
  dipendenti: number | null,
  classeInail: 'basso' | 'medio' | 'alto' | 'molto_alto' | null,
  zonaSismica: number | null,
  settore: string | null,
): PremiumEstimate {
  const dettaglio: PremiumEstimate['dettaglio'] = []

  const fat = fatturato || 500_000 // stima conservativa se non disponibile
  const dip = dipendenti || 5

  // RC Terzi / RC Professionale
  const rcRate = classeInail === 'molto_alto' ? 0.003 : classeInail === 'alto' ? 0.002 : classeInail === 'medio' ? 0.0015 : 0.001
  const rcMin = Math.max(500, Math.round(fat * rcRate * 0.8))
  const rcMax = Math.max(800, Math.round(fat * rcRate * 1.5))
  dettaglio.push({
    polizza: 'RC Terzi / RC Professionale',
    premio_min: rcMin,
    premio_max: rcMax,
    note: `Massimale consigliato: €${formatNumber(Math.max(500_000, fat * 2))}`,
  })

  // Infortuni lavoratori
  if (dip > 0) {
    const inailRate = classeInail === 'molto_alto' ? 800 : classeInail === 'alto' ? 500 : classeInail === 'medio' ? 300 : 150
    const infMin = Math.round(dip * inailRate * 0.7)
    const infMax = Math.round(dip * inailRate * 1.3)
    dettaglio.push({
      polizza: 'Infortuni Lavoratori',
      premio_min: infMin,
      premio_max: infMax,
      note: `${dip} dipendenti × €${inailRate}/anno medio`,
    })
  }

  // Incendio / All Risks
  const incendioMin = Math.max(400, Math.round(fat * 0.0008))
  const incendioMax = Math.max(700, Math.round(fat * 0.002))
  dettaglio.push({
    polizza: 'Incendio / All Risks',
    premio_min: incendioMin,
    premio_max: incendioMax,
    note: zonaSismica && zonaSismica <= 2 ? 'Maggiorazione zona sismica inclusa' : 'Premio base',
  })

  // Terremoto (se zona 1-2)
  if (zonaSismica && zonaSismica <= 2) {
    const terrMin = Math.max(300, Math.round(fat * 0.001))
    const terrMax = Math.max(600, Math.round(fat * 0.003))
    dettaglio.push({
      polizza: 'Estensione Terremoto',
      premio_min: terrMin,
      premio_max: terrMax,
      note: `Zona sismica ${zonaSismica} — copertura fortemente raccomandata`,
    })
  }

  // Furto
  dettaglio.push({
    polizza: 'Furto / Rapina',
    premio_min: 300,
    premio_max: 800,
    note: 'Dipende da sistemi di allarme e ubicazione',
  })

  // Cyber Risk (se settore IT o se > 10 dipendenti)
  const isIT = settore?.toLowerCase().includes('informatica') || settore?.toLowerCase().includes('software')
  if (isIT || dip >= 10) {
    const cyberMin = isIT ? 1500 : 500
    const cyberMax = isIT ? 5000 : 2000
    dettaglio.push({
      polizza: 'Cyber Risk',
      premio_min: cyberMin,
      premio_max: cyberMax,
      note: isIT ? 'Settore IT — copertura essenziale' : 'Raccomandata per aziende strutturate',
    })
  }

  // D&O (se SRL/SPA con fatturato > 2M)
  if (fat >= 2_000_000) {
    dettaglio.push({
      polizza: 'D&O Amministratori',
      premio_min: 1500,
      premio_max: 5000,
      note: `Fatturato €${formatNumber(fat)} — responsabilità amministratori rilevante`,
    })
  }

  const totMin = dettaglio.reduce((s, d) => s + d.premio_min, 0)
  const totMax = dettaglio.reduce((s, d) => s + d.premio_max, 0)

  return {
    totale_stimato: `€${formatNumber(totMin)} - €${formatNumber(totMax)}`,
    dettaglio,
    disclaimer: 'Stima indicativa basata su benchmark interni e parametri medi di mercato. Il premio effettivo dipende da sinistrosità pregressa, franchigie, massimali, attività concreta, ubicazione e criteri assuntivi della compagnia.',
    fonte: 'Benchmark interni su parametri medi del mercato assicurativo italiano',
  }
}

// ── 3. Insurance Gap Analysis ──────────────────────────────────
// Analizza i gap assicurativi specifici per il lead

export interface InsuranceGap {
  livello_rischio: 'critico' | 'alto' | 'medio' | 'basso'
  score: number // 0-100 (100 = massimo gap)
  gaps: {
    area: string
    gravita: 'critico' | 'alto' | 'medio' | 'basso'
    descrizione: string
    azione: string
  }[]
  sommario: string
}

export function analyzeInsuranceGaps(
  fatturato: number | null,
  dipendenti: number | null,
  formaGiuridica: string | null,
  codiceAteco: string | null,
  categoria: string | null,
  zonaSismica: number | null,
  rischioIdrogeo: string | null,
  hasPec: boolean,
  hasWebsite: boolean,
): InsuranceGap {
  const gaps: InsuranceGap['gaps'] = []
  let score = 0

  const fg = (formaGiuridica || '').toUpperCase()
  const cat = (categoria || '').toLowerCase()
  const fat = fatturato || 0
  const dip = dipendenti || 0

  // 1. Società di capitali senza D&O
  if (/SRL|SPA|SRLS/.test(fg)) {
    gaps.push({
      area: 'D&O Amministratori',
      gravita: fat > 2_000_000 ? 'critico' : 'alto',
      descrizione: `${fg} con ${fat > 0 ? '€' + formatNumber(fat) + ' di fatturato' : 'fatturato non noto'}: gli amministratori possono avere esposizione personale da verificare`,
      azione: 'Verificare presenza D&O, massimale, retroattività, esclusioni e continuità di copertura',
    })
    score += fat > 2_000_000 ? 20 : 12
  }

  // 2. Dipendenti senza welfare
  if (dip >= 10) {
    gaps.push({
      area: 'Employee Benefits',
      gravita: dip >= 50 ? 'alto' : 'medio',
      descrizione: `${dip} dipendenti: verificare CCNL applicato per sanità integrativa, previdenza e coperture welfare`,
      azione: 'Verificare coperture welfare già attive, CCNL, sanità integrativa, infortuni extra-professionale e fondi pensione',
    })
    score += dip >= 50 ? 18 : 10
  }

  // 3. Zona sismica senza copertura specifica
  if (zonaSismica && zonaSismica <= 2) {
    gaps.push({
      area: 'Rischio Sismico',
      gravita: zonaSismica === 1 ? 'critico' : 'alto',
      descrizione: `Zona sismica ${zonaSismica}: verificare estensione terremoto sulla property e congruità del valore assicurato`,
      azione: 'Verificare estensione terremoto, valore assicurato, scoperti, franchigie e limite di indennizzo',
    })
    score += zonaSismica === 1 ? 20 : 15
  }

  // 4. Rischio idrogeologico
  if (rischioIdrogeo === 'alto') {
    gaps.push({
      area: 'Rischio Alluvione',
      gravita: 'alto',
      descrizione: 'Zona ad alto rischio idrogeologico: danni da acqua spesso esclusi dalle polizze base',
      azione: 'Verificare che la polizza property includa esplicitamente "eventi atmosferici" e "allagamento"',
    })
    score += 12
  }

  // 5. Fatturato alto senza RC Prodotti
  if (fat >= 1_000_000 && /manifatt|produzion|aliment|industr|chimic/.test(cat)) {
    gaps.push({
      area: 'RC Prodotti',
      gravita: 'critico',
      descrizione: `Fatturato €${formatNumber(fat)} nel settore produttivo: rischio richiamo prodotto e danni a consumatori`,
      azione: 'Verificare RC Prodotti, recall, esportazioni, tracciabilità lotti e massimale rispetto al fatturato',
    })
    score += 18
  }

  // 6. Settore edile senza polizza cantieri
  if (/costruzion|edili|edile|cantier|ristruttur/.test(cat)) {
    gaps.push({
      area: 'Polizza CAR/EAR',
      gravita: 'critico',
      descrizione: 'Settore edile: la Polizza Cantieri è spesso richiesta da committenti, appalti e finanziatori',
      azione: 'Verificare CAR/EAR, Decennale Postuma, clausole appalti/subappalti e massimali richiesti dai committenti',
    })
    score += 15
  }

  // 7. Settore sanitario senza RC medica
  if (/medic|dentist|clinic|farmaci|veterinar/.test(cat)) {
    gaps.push({
      area: 'RC Sanitaria',
      gravita: 'critico',
      descrizione: 'Legge Gelli-Bianco (L. 24/2017): obbligo di RC Sanitaria per strutture e professionisti',
      azione: 'Verificare RC Sanitaria/Malpractice, retroattività, postuma, massimali e tutela legale specializzata',
    })
    score += 20
  }

  // 8. Cyber risk per aziende con sito web
  if (hasWebsite && (dip >= 5 || fat >= 500_000)) {
    gaps.push({
      area: 'Cyber Risk',
      gravita: fat >= 2_000_000 ? 'alto' : 'medio',
      descrizione: `Azienda con presenza web${dip >= 10 ? ' e ' + dip + ' dipendenti' : ''}: rischio digitale da qualificare su dati, backup, pagamenti e continuità operativa`,
      azione: 'Verificare copertura Cyber: data breach, ransomware, business interruption, GDPR defense e gestione incident response',
    })
    score += fat >= 2_000_000 ? 12 : 8
  }

  // 9. Professionisti senza RC Professionale
  if (/avvocat|commerciali|notai|architect|ingegner|consulen|studio/.test(cat)) {
    gaps.push({
      area: 'RC Professionale',
      gravita: 'critico',
      descrizione: 'DPR 137/2012: obbligo di legge per tutti i professionisti iscritti ad albi',
      azione: 'Verificare RC Professionale, massimale, retroattività, postuma, franchigie e attività effettivamente esercitate',
    })
    score += 15
  }

  // 10. Azienda senza PEC → potenziale problema compliance
  if (!hasPec && /SRL|SPA|SAS|SNC/.test(fg)) {
    gaps.push({
      area: 'Compliance Aziendale',
      gravita: 'basso',
      descrizione: 'PEC non rilevata nei dati raccolti: verificare presenza e corretto presidio delle comunicazioni societarie',
      azione: 'Chiedere conferma al cliente: la PEC societaria è normalmente richiesta per le società iscritte al Registro Imprese',
    })
    score += 5
  }

  // Cap score at 100
  score = Math.min(100, score)

  const livello = score >= 70 ? 'critico' : score >= 45 ? 'alto' : score >= 20 ? 'medio' : 'basso'

  const sommario = score >= 70
    ? `PRIORITÀ CRITICA: ${gaps.filter(g => g.gravita === 'critico').length} aree da verificare subito in call. Opportunità consulenziale immediata.`
    : score >= 45
    ? `PRIORITÀ ALTA: ${gaps.length} aree assicurative da qualificare. Lead con forte potenziale consulenziale.`
    : score >= 20
    ? `PRIORITÀ MEDIA: ${gaps.length} opportunità di revisione coperture e cross-sell da validare.`
    : 'PRIORITÀ BASSA: i dati pubblici non evidenziano trigger forti. Verificare comunque portafoglio attivo, rinnovi, massimali ed esclusioni.'

  return { livello_rischio: livello, score, gaps, sommario }
}

// ── 4. Analisi recensioni per segnali di rischio ──────────────
// Cerca keyword nelle recensioni che indicano rischi assicurativi

export interface ReviewRiskSignal {
  found: boolean
  signals: {
    keyword: string
    category: 'safety' | 'damage' | 'legal' | 'health' | 'quality'
    severity: 'high' | 'medium' | 'low'
    description: string
    insurance_relevance: string
    review_excerpt: string
  }[]
}

const RISK_KEYWORDS: {
  pattern: RegExp
  category: 'safety' | 'damage' | 'legal' | 'health' | 'quality'
  severity: 'high' | 'medium' | 'low'
  keyword: string
  description: string
  insurance_relevance: string
}[] = [
  { pattern: /scivolat|cadut|inciampat|pavimento bagnato|scale pericolos/i, category: 'safety', severity: 'high', keyword: 'Caduta/Scivolamento', description: 'Segnalazione di rischio caduta nel locale', insurance_relevance: 'RC Terzi: sinistro frequente — verificare massimale e franchigia' },
  { pattern: /incendio|fumo|brucia|fiamm|estintore/i, category: 'safety', severity: 'high', keyword: 'Rischio Incendio', description: 'Menzione di rischio incendio o impianti non sicuri', insurance_relevance: 'Polizza Incendio: verificare adeguatezza e conformità impianti' },
  { pattern: /allagat|infiltraz|perdita acqua|muff|umidit/i, category: 'damage', severity: 'medium', keyword: 'Danni da Acqua', description: 'Problemi idrici o infiltrazioni segnalati', insurance_relevance: 'Polizza Danni da Acqua: spesso esclusa dalle polizze base' },
  { pattern: /causa|avvocat|denunci|tribunale|querela|risarciment/i, category: 'legal', severity: 'high', keyword: 'Contenzioso', description: 'Menzione di azioni legali o contenziosi', insurance_relevance: 'Polizza Tutela Legale: essenziale per gestire contenzioso' },
  { pattern: /intossica|allergi|malore|ospedale|pronto soccors|ambulanz/i, category: 'health', severity: 'high', keyword: 'Problema Sanitario', description: 'Segnalazione di problema sanitario legato al servizio', insurance_relevance: 'RC Prodotti/Somministrazione: sinistro grave, verificare copertura' },
  { pattern: /rott|dann|graffi|ammaccat|difettos|malfunzion/i, category: 'damage', severity: 'medium', keyword: 'Danno a Beni', description: 'Segnalazione di danni a beni del cliente', insurance_relevance: 'RC Terzi: danneggiamento beni di terzi in custodia' },
  { pattern: /pericolos|insicur|rischio|instabil|fatiscent/i, category: 'safety', severity: 'medium', keyword: 'Struttura Insicura', description: 'Percezione di insicurezza della struttura', insurance_relevance: 'Verifica RC Conduzione e adeguatezza limiti property' },
  { pattern: /truff|fregatur|imbroglio|ladri|rubat/i, category: 'legal', severity: 'medium', keyword: 'Frode/Furto', description: 'Accuse di comportamento fraudolento o furti', insurance_relevance: 'Polizza Infedeltà Dipendenti / Crime: se pattern sistematico' },
  { pattern: /puzza|sporco|sporcizia|insett|scarafagg|topo|topi/i, category: 'health', severity: 'medium', keyword: 'Igiene', description: 'Problemi igienici segnalati dai clienti', insurance_relevance: 'RC Prodotti: rischio contaminazione. Possibile chiusura ASL.' },
]

export function analyzeReviewsForRisk(reviews: string[]): ReviewRiskSignal {
  if (!reviews || reviews.length === 0) return { found: false, signals: [] }

  const signals: ReviewRiskSignal['signals'] = []
  const seen = new Set<string>()

  for (const review of reviews) {
    for (const kw of RISK_KEYWORDS) {
      if (seen.has(kw.keyword)) continue
      if (kw.pattern.test(review)) {
        seen.add(kw.keyword)
        // Extract ~60 chars around the match
        const match = review.match(kw.pattern)
        let excerpt = review
        if (match?.index !== undefined) {
          const start = Math.max(0, match.index - 30)
          const end = Math.min(review.length, match.index + match[0].length + 30)
          excerpt = (start > 0 ? '...' : '') + review.substring(start, end) + (end < review.length ? '...' : '')
        }
        if (excerpt.length > 100) excerpt = excerpt.substring(0, 100) + '...'

        signals.push({
          keyword: kw.keyword,
          category: kw.category,
          severity: kw.severity,
          description: kw.description,
          insurance_relevance: kw.insurance_relevance,
          review_excerpt: excerpt,
        })
      }
    }
  }

  return {
    found: signals.length > 0,
    signals: signals.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.severity] - order[b.severity]
    }),
  }
}

// ── Helper ──────────────────────────────────────────────────────
function formatNumber(n: number): string {
  return new Intl.NumberFormat('it-IT').format(Math.round(n))
}
