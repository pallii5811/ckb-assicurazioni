/**
 * Sales Intelligence Engine
 * Trasforma i dati lead in AZIONI CONCRETE per il broker assicurativo.
 *
 * 1. Score Commerciale (0-100) — quanto vale questo lead per il broker
 * 2. Script di Vendita — talking points personalizzati per la prima chiamata
 * 3. Stima Provvigioni — quanto guadagna il broker su questo lead
 * 4. Email Template — email pronta da inviare personalizzata
 */

// ── Types ────────────────────────────────────────────────────────

export interface SalesScore {
  score: number // 0-100
  label: 'CHIAMA SUBITO' | 'DA CONTATTARE' | 'OPPORTUNITÀ' | 'BASSO POTENZIALE'
  color: string // tailwind bg class
  motivazioni: string[]
}

export interface SalesScript {
  apertura: string
  domande_chiave: string[]
  pain_points: string[]
  proposta: string[]
  chiusura: string
}

export interface CommissionEstimate {
  premio_annuo_stimato_min: number
  premio_annuo_stimato_max: number
  provvigione_primo_anno_min: number
  provvigione_primo_anno_max: number
  provvigione_rinnovi_min: number
  provvigione_rinnovi_max: number
  valore_cliente_5_anni_min: number
  valore_cliente_5_anni_max: number
  dettaglio: {
    polizza: string
    premio_min: number
    premio_max: number
    aliquota_provv: number
    provv_min: number
    provv_max: number
  }[]
  note: string
}

export interface EmailTemplate {
  oggetto: string
  corpo: string
  followup_oggetto: string
  followup_corpo: string
}

export interface SalesIntelligence {
  score: SalesScore
  script: SalesScript
  commissioni: CommissionEstimate
  email: EmailTemplate
}

// ── Helpers ────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat('it-IT').format(Math.round(n))
}

function parseRevenue(val: unknown): number | null {
  if (!val) return null
  const s = String(val).replace(/[€.\s]/g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseEmployees(val: unknown): number | null {
  if (!val) return null
  const n = parseInt(String(val).replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? null : n
}

// ── 1. SCORE COMMERCIALE ─────────────────────────────────────────

export function calculateSalesScore(
  fatturato: unknown,
  dipendenti: unknown,
  formaGiuridica: string | null,
  codiceAteco: string | null,
  categoria: string | null,
  hasWebsite: boolean,
  hasEmail: boolean,
  hasPhone: boolean,
  hasPiva: boolean,
  personName: string | null,
  gapCount: number,
  triggerCount: number,
): SalesScore {
  let score = 0
  const motivazioni: string[] = []

  const fat = parseRevenue(fatturato)
  const dip = parseEmployees(dipendenti)
  const fg = (formaGiuridica || '').toUpperCase()
  const cat = (categoria || '').toLowerCase()

  // ── Dimensione aziendale (max 30 punti) ──
  if (fat !== null) {
    if (fat >= 10_000_000) { score += 30; motivazioni.push(`Fatturato €${fmt(fat)}: cliente alto valore`) }
    else if (fat >= 2_000_000) { score += 22; motivazioni.push(`Fatturato €${fmt(fat)}: cliente medio-alto`) }
    else if (fat >= 500_000) { score += 15; motivazioni.push(`Fatturato €${fmt(fat)}: PMI con budget assicurativo`) }
    else { score += 8; motivazioni.push(`Fatturato €${fmt(fat)}: micro impresa`) }
  }

  if (dip !== null) {
    if (dip >= 50) { score += 15; motivazioni.push(`${dip} dipendenti: pacchetto employee benefits`) }
    else if (dip >= 15) { score += 10; motivazioni.push(`${dip} dipendenti: polizze collettive`) }
    else if (dip >= 5) { score += 5; motivazioni.push(`${dip} dipendenti`) }
  }

  // ── Forma giuridica (max 10 punti) ──
  if (/SPA|S\.P\.A/.test(fg)) { score += 10; motivazioni.push('S.p.A.: programma assicurativo complesso') }
  else if (/SRL|S\.R\.L/.test(fg)) { score += 7; motivazioni.push('SRL: D&O + RC + property') }
  else if (/SNC|SAS/.test(fg)) { score += 5; motivazioni.push(`${fg}: soci con responsabilità personale`) }

  // ── Settore ad alto rischio (max 10 punti) ──
  if (/costruzion|edili|cantier/.test(cat)) { score += 10; motivazioni.push('Settore edile: alto fabbisogno assicurativo') }
  else if (/medic|dentist|clinic|farmaci|veterinar/.test(cat)) { score += 10; motivazioni.push('Settore sanitario: RC obbligatoria') }
  else if (/trasport|logistic|autotrasport/.test(cat)) { score += 8; motivazioni.push('Trasporti: RC vettoriale + flotta') }
  else if (/manifatt|produzion|industr/.test(cat)) { score += 8; motivazioni.push('Manifattura: RC prodotti + property') }
  else if (/avvocat|commerciali|notai|architett|ingegner/.test(cat)) { score += 7; motivazioni.push('Professionista: RC professionale obbligatoria') }
  else if (/ristorant|hotel|albergo|bar |food/.test(cat)) { score += 5; motivazioni.push('Ristorazione/Hospitality: RC + property') }
  else if (/aliment|panif|macellar/.test(cat)) { score += 6; motivazioni.push('Alimentare: RC prodotti + igiene') }

  // ── Gap assicurativi rilevati (max 15 punti) ──
  if (gapCount >= 5) { score += 15; motivazioni.push(`${gapCount} gap assicurativi: forte opportunità di vendita`) }
  else if (gapCount >= 3) { score += 10; motivazioni.push(`${gapCount} gap assicurativi`) }
  else if (gapCount >= 1) { score += 5 }

  // ── Trigger commerciali (max 10 punti) ──
  if (triggerCount >= 4) { score += 10; motivazioni.push(`${triggerCount} trigger attivi: momento ideale per contatto`) }
  else if (triggerCount >= 2) { score += 6; motivazioni.push(`${triggerCount} trigger commerciali rilevati`) }
  else if (triggerCount >= 1) { score += 3 }

  // ── Raggiungibilità (max 10 punti) ──
  if (hasPhone) { score += 4; motivazioni.push('Telefono disponibile') }
  if (hasEmail) { score += 3 }
  if (personName) { score += 3; motivazioni.push(`Referente identificato: ${personName}`) }

  // Cap
  score = Math.min(100, score)

  const label: SalesScore['label'] =
    score >= 70 ? 'CHIAMA SUBITO'
    : score >= 45 ? 'DA CONTATTARE'
    : score >= 25 ? 'OPPORTUNITÀ'
    : 'BASSO POTENZIALE'

  const color =
    score >= 70 ? 'bg-red-500'
    : score >= 45 ? 'bg-amber-500'
    : score >= 25 ? 'bg-blue-500'
    : 'bg-slate-400'

  return { score, label, color, motivazioni }
}

// ── 2. SCRIPT DI VENDITA ─────────────────────────────────────────

export function generateSalesScript(
  companyName: string,
  personName: string | null,
  categoria: string | null,
  formaGiuridica: string | null,
  fatturato: unknown,
  dipendenti: unknown,
  gaps: { area: string; gravita: string; descrizione: string }[],
  triggers: { title: string; severity: string }[],
): SalesScript {
  const fg = (formaGiuridica || '').toUpperCase()
  const cat = (categoria || '').toLowerCase()
  const fat = parseRevenue(fatturato)
  const dip = parseEmployees(dipendenti)
  const nome = personName || 'il titolare'

  // ── Apertura ──
  let apertura = `Buongiorno${personName ? ` ${personName}` : ''}, mi chiamo [NOME] e sono un consulente assicurativo specializzato nel settore ${categoria || 'delle PMI'}.`

  if (triggers.length > 0) {
    const topTrigger = triggers[0]
    apertura += ` La contatto perché ho notato che ${companyName} ${topTrigger.title.toLowerCase()} — e questo spesso comporta esigenze assicurative specifiche che vale la pena verificare.`
  } else {
    apertura += ` Sto facendo un'analisi gratuita delle coperture per le aziende della zona e ho notato alcune opportunità specifiche per ${companyName}.`
  }

  // ── Domande chiave ──
  const domande: string[] = [
    'Attualmente avete un programma assicurativo strutturato o vi affidate a polizze singole?',
    'Chi gestisce le vostre polizze oggi? Un broker, un agente o direttamente una compagnia?',
    'Quando scadono le polizze principali? (RC, property, infortuni)',
  ]

  if (/SRL|SPA|SAS|SNC/.test(fg)) {
    domande.push(`Come ${fg}, gli amministratori hanno una polizza D&O personale?`)
  }
  if (dip && dip >= 10) {
    domande.push(`Con ${dip} dipendenti, avete già un piano welfare aziendale (sanitaria, previdenza)?`)
  }
  if (/costruzion|edili/.test(cat)) {
    domande.push('Per i cantieri usate polizze CAR singole o avete una copertura annuale?')
  }
  if (/medic|dentist|clinic/.test(cat)) {
    domande.push('La vostra RC sanitaria è aggiornata alla Legge Gelli-Bianco?')
  }

  // ── Pain points ──
  const painPoints: string[] = []

  const criticalGaps = gaps.filter(g => g.gravita === 'critico' || g.gravita === 'alto')
  for (const gap of criticalGaps.slice(0, 3)) {
    painPoints.push(`${gap.area}: ${gap.descrizione}`)
  }

  if (painPoints.length === 0) {
    painPoints.push('Molte aziende del vostro settore pagano troppo perché non hanno mai fatto un\'analisi comparativa seria')
    painPoints.push('Le polizze spesso hanno esclusioni nascoste che emergono solo al momento del sinistro')
  }

  if (/SRL|SPA/.test(fg)) {
    painPoints.push('In una società di capitali, l\'amministratore risponde con il patrimonio personale per errori gestionali — molti non lo sanno')
  }

  // ── Proposta ──
  const proposta: string[] = []

  proposta.push(`Le propongo un check-up assicurativo gratuito e senza impegno per ${companyName}`)
  proposta.push('Analizzo le polizze attuali e verifico: portafoglio attivo, massimali, franchigie, scoperti, esclusioni e scadenze')
  proposta.push('Le presento un report con le opportunità di risparmio e di miglioramento delle coperture')

  if (fat && fat >= 2_000_000) {
    proposta.push(`Con un fatturato di €${fmt(fat)}, ha senso verificare se massimali, valori assicurati e franchigie sono ancora coerenti con la dimensione attuale`)
  }

  // ── Chiusura ──
  const chiusura = `${personName ? personName : 'Quando'}, le andrebbe bene un incontro di 20 minuti questa settimana? Posso venire io da voi oppure facciamo una videochiamata veloce. Le porto già un'analisi preliminare delle coperture specifiche per il vostro settore.`

  return { apertura, domande_chiave: domande, pain_points: painPoints, proposta, chiusura }
}

// ── 3. STIMA PROVVIGIONI ─────────────────────────────────────────

export function estimateCommissions(
  fatturato: unknown,
  dipendenti: unknown,
  formaGiuridica: string | null,
  categoria: string | null,
  classeInail: 'basso' | 'medio' | 'alto' | 'molto_alto' | null,
): CommissionEstimate {
  const fat = parseRevenue(fatturato) || 500_000
  const dip = parseEmployees(dipendenti) || 5
  const fg = (formaGiuridica || '').toUpperCase()
  const cat = (categoria || '').toLowerCase()

  const dettaglio: CommissionEstimate['dettaglio'] = []

  // Aliquote provvigionali medie mercato italiano (fonte: prassi ANIA/broker)
  // Primo anno: 15-25% su danni, 30-50% su vita/infortuni
  // Rinnovi: 10-15% su danni, 5-10% su vita

  // RC Terzi / RC Professionale — aliquota ~20% primo anno
  const rcRate = classeInail === 'molto_alto' ? 0.003 : classeInail === 'alto' ? 0.002 : 0.001
  const rcMin = Math.max(500, Math.round(fat * rcRate * 0.8))
  const rcMax = Math.max(800, Math.round(fat * rcRate * 1.5))
  dettaglio.push({
    polizza: 'RC Terzi / Professionale',
    premio_min: rcMin, premio_max: rcMax,
    aliquota_provv: 0.20,
    provv_min: Math.round(rcMin * 0.20),
    provv_max: Math.round(rcMax * 0.20),
  })

  // Infortuni — aliquota ~25%
  if (dip > 0) {
    const inailRate = classeInail === 'molto_alto' ? 800 : classeInail === 'alto' ? 500 : 150
    const infMin = Math.round(dip * inailRate * 0.7)
    const infMax = Math.round(dip * inailRate * 1.3)
    dettaglio.push({
      polizza: 'Infortuni Lavoratori',
      premio_min: infMin, premio_max: infMax,
      aliquota_provv: 0.25,
      provv_min: Math.round(infMin * 0.25),
      provv_max: Math.round(infMax * 0.25),
    })
  }

  // Incendio / Property — aliquota ~18%
  const incMin = Math.max(400, Math.round(fat * 0.0008))
  const incMax = Math.max(700, Math.round(fat * 0.002))
  dettaglio.push({
    polizza: 'Incendio / All Risks',
    premio_min: incMin, premio_max: incMax,
    aliquota_provv: 0.18,
    provv_min: Math.round(incMin * 0.18),
    provv_max: Math.round(incMax * 0.18),
  })

  // Furto — aliquota ~18%
  dettaglio.push({
    polizza: 'Furto / Rapina',
    premio_min: 300, premio_max: 800,
    aliquota_provv: 0.18,
    provv_min: Math.round(300 * 0.18),
    provv_max: Math.round(800 * 0.18),
  })

  // D&O — aliquota ~15%
  if (/SRL|SPA|SRLS/.test(fg) || fat >= 2_000_000) {
    const deoMin = fat >= 10_000_000 ? 3000 : fat >= 2_000_000 ? 1500 : 800
    const deoMax = fat >= 10_000_000 ? 8000 : fat >= 2_000_000 ? 5000 : 2000
    dettaglio.push({
      polizza: 'D&O Amministratori',
      premio_min: deoMin, premio_max: deoMax,
      aliquota_provv: 0.15,
      provv_min: Math.round(deoMin * 0.15),
      provv_max: Math.round(deoMax * 0.15),
    })
  }

  // Cyber — aliquota ~20%
  if (dip >= 10 || fat >= 1_000_000) {
    const cyMin = 500
    const cyMax = fat >= 5_000_000 ? 3000 : 1500
    dettaglio.push({
      polizza: 'Cyber Risk',
      premio_min: cyMin, premio_max: cyMax,
      aliquota_provv: 0.20,
      provv_min: Math.round(cyMin * 0.20),
      provv_max: Math.round(cyMax * 0.20),
    })
  }

  // Settoriali
  if (/costruzion|edili/.test(cat)) {
    dettaglio.push({
      polizza: 'CAR / Cantieri',
      premio_min: 2000, premio_max: 8000,
      aliquota_provv: 0.15,
      provv_min: Math.round(2000 * 0.15),
      provv_max: Math.round(8000 * 0.15),
    })
  }
  if (/trasport|logistic|autotrasport/.test(cat)) {
    dettaglio.push({
      polizza: 'RC Vettoriale / Flotta',
      premio_min: 3000, premio_max: 15000,
      aliquota_provv: 0.12,
      provv_min: Math.round(3000 * 0.12),
      provv_max: Math.round(15000 * 0.12),
    })
  }

  const premioMin = dettaglio.reduce((s, d) => s + d.premio_min, 0)
  const premioMax = dettaglio.reduce((s, d) => s + d.premio_max, 0)
  const provvMin = dettaglio.reduce((s, d) => s + d.provv_min, 0)
  const provvMax = dettaglio.reduce((s, d) => s + d.provv_max, 0)

  // Rinnovi: ~60% della provvigione primo anno
  const rinnMin = Math.round(provvMin * 0.60)
  const rinnMax = Math.round(provvMax * 0.60)

  // Valore 5 anni: primo anno + 4 rinnovi
  const val5Min = provvMin + rinnMin * 4
  const val5Max = provvMax + rinnMax * 4

  return {
    premio_annuo_stimato_min: premioMin,
    premio_annuo_stimato_max: premioMax,
    provvigione_primo_anno_min: provvMin,
    provvigione_primo_anno_max: provvMax,
    provvigione_rinnovi_min: rinnMin,
    provvigione_rinnovi_max: rinnMax,
    valore_cliente_5_anni_min: val5Min,
    valore_cliente_5_anni_max: val5Max,
    dettaglio,
    note: 'Aliquote provvigionali stimate su prassi media mercato italiano (ramo danni). Le provvigioni effettive variano per compagnia, mandato e accordi specifici.',
  }
}

// ── 4. EMAIL TEMPLATE ────────────────────────────────────────────

export function generateEmailTemplate(
  companyName: string,
  personName: string | null,
  categoria: string | null,
  formaGiuridica: string | null,
  gaps: { area: string }[],
  triggers: { title: string }[],
): EmailTemplate {
  const nome = personName || 'Gentile Titolare'
  const cat = categoria || 'PMI'
  const topGaps = gaps.slice(0, 2).map(g => g.area)

  const oggetto = triggers.length > 0
    ? `Analisi assicurativa per ${companyName} — opportunità specifiche per il vostro settore`
    : `Check-up assicurativo gratuito per ${companyName}`

  const corpo = `Gentile ${nome},

mi permetto di contattarLa perché, analizzando le aziende del settore ${cat} nella vostra zona, ho identificato alcune opportunità assicurative specifiche per ${companyName} che potrebbero interessarLe.

${topGaps.length > 0 ? `In particolare, ho riscontrato potenziali aree da verificare su: ${topGaps.join(', ')}.` : 'Una revisione periodica aiuta a verificare massimali, esclusioni e scadenze prima del rinnovo.'}

${triggers.length > 0 ? `Ho notato inoltre che ${triggers[0].title.toLowerCase()} — questo è spesso il momento migliore per una revisione delle polizze.\n` : ''}Le propongo un check-up assicurativo completamente gratuito e senza impegno:
• Analisi delle polizze attuali
• Verifica portafoglio attivo, massimali, franchigie, scoperti e scadenze
• Confronto con i parametri del vostro settore
• Report personalizzato con opportunità di ottimizzazione

Bastano 20 minuti, di persona o in videochiamata. Quando Le farebbe comodo?

Cordiali saluti,
[IL TUO NOME]
[TELEFONO]
[EMAIL]`

  const followup_oggetto = `Re: Check-up assicurativo per ${companyName}`

  const followup_corpo = `Gentile ${nome},

Le scrivo un breve follow-up alla mia email precedente riguardo il check-up assicurativo per ${companyName}.

Capisco che il tempo è prezioso — per questo Le propongo un'analisi express di 15 minuti dove Le mostro subito 2-3 punti critici specifici per il vostro settore che la maggior parte delle aziende trascura.

Se preferisce, posso inviarLe direttamente il report preliminare via email così lo valuta quando ha tempo.

Come preferisce procedere?

Cordiali saluti,
[IL TUO NOME]`

  return { oggetto, corpo, followup_oggetto, followup_corpo }
}

// ── MAIN: Generate complete sales intelligence ──────────────────

export function generateSalesIntelligence(
  lead: {
    nome?: string
    azienda?: string
    business_name?: string
    categoria?: string
    category?: string
    fatturato?: unknown
    dipendenti?: unknown
    forma_giuridica?: string
    formaGiuridica?: string
    codice_ateco?: string
    codiceAteco?: string
    sito?: string
    website?: string
    email?: string
    telefono?: string
    phone?: string
    partita_iva?: string
    personName?: string
    personRole?: string
  },
  gaps: { area: string; gravita: string; descrizione: string }[],
  triggers: { title: string; severity: string }[],
): SalesIntelligence {
  const companyName = lead.nome || lead.azienda || lead.business_name || ''
  const cat = lead.categoria || lead.category || null
  const fg = lead.forma_giuridica || lead.formaGiuridica || null
  const ateco = lead.codice_ateco || lead.codiceAteco || null
  const hasWebsite = !!(lead.sito || lead.website)
  const hasEmail = !!lead.email
  const hasPhone = !!(lead.telefono || lead.phone)
  const hasPiva = !!lead.partita_iva

  const score = calculateSalesScore(
    lead.fatturato, lead.dipendenti, fg, ateco, cat,
    hasWebsite, hasEmail, hasPhone, hasPiva,
    lead.personName || null, gaps.length, triggers.length,
  )

  const script = generateSalesScript(
    companyName, lead.personName || null, cat, fg,
    lead.fatturato, lead.dipendenti, gaps, triggers,
  )

  const commissioni = estimateCommissions(
    lead.fatturato, lead.dipendenti, fg, cat, null,
  )

  const email = generateEmailTemplate(
    companyName, lead.personName || null, cat, fg, gaps, triggers,
  )

  return { score, script, commissioni, email }
}
