/**
 * Arricchimento persone chiave dell'azienda — GRATIS
 * Fonti: CompanyReports.it, Google Search, analisi nome azienda
 * Genera raccomandazioni assicurative specifiche per ruolo
 */

// ── Types ──────────────────────────────────────────────────────

export interface PersonInsuranceProfile {
  nome: string
  ruolo: string
  ruolo_normalizzato: 'titolare' | 'amministratore' | 'socio' | 'professionista' | 'dirigente' | 'dipendente_chiave' | 'altro'
  fonte: string
  codice_fiscale?: string
  data_nascita?: string
  sesso?: string
  eta?: number
  polizze_personali: {
    polizza: string
    priorita: 'obbligatoria' | 'critica' | 'raccomandata'
    motivo: string
  }[]
  rischi_personali: string[]
  note: string | null
}

export interface PeopleEnrichmentResult {
  persone: PersonInsuranceProfile[]
  totale_trovate: number
  fonti: string[]
  raccomandazioni_team: string[]
}

// ── Name validation (shared) ───────────────────────────────────────────

const NAME_BLOCKLIST = /visura|camerale|registro|imprese|bilancio|fatturato|companyreport|company|report|societa|azienda|impresa|italia|partita iva|codice fiscale|sede legale|capitale sociale|amministrazione|informazioni|contatti|cookie|privacy|home|assistenza|servizi|supporto|ufficio|numero|telefono|email|indirizzo|orario|apertura|chiusura|lavora con noi|mappa|dove siamo|chi siamo|pagina|sito|website|google|facebook|linkedin|twitter|instagram|youtube|tiktok|whatsapp|costruzioni|ristorante|studio|impresa|ditta|bottega|gruppo|holding|fondazione|associazione|seguito|specificato|previsto|indicato|presente|documento|informativa|trattamento|personali|consenso|normativa|regolamento|articolo|paragrafo|sezione|titolare|responsabile|incaricato|interessato|destinatario|garante|autorita|disposizione|finalita|modalita|comunicazione|diffusione|profilazione|automatizzato|legittimo|interesse|necessario|obbligatorio|facoltativo|conferimento|periodo|conservazione|opposizione|reclamo|diritto|revoca|portabilita|cancellazione|rettifica|limitazione|accesso|pulizia|pulizie|cleaning|consulenza|cooperativa/i

const LEGAL_FORM_BLOCKLIST = /\b(spa|srl|srls|snc|sas|sapa|scarl|scrl|soc|coop|onlus|ltd|gmbh|inc|corp|llc|plc)\b/i

function toTitleCase(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function isValidPersonName(name: string): boolean {
  if (!name || name.length < 5 || name.length > 50) return false
  // Convert ALL CAPS to Title Case before validation
  let check = name
  if (check === check.toUpperCase() && check.length > 3) check = toTitleCase(check)
  if (NAME_BLOCKLIST.test(check)) return false
  if (LEGAL_FORM_BLOCKLIST.test(check)) return false
  // Must have at least 2 words (nome + cognome)
  const words = check.trim().split(/\s+/).filter(w => w.length > 1)
  if (words.length < 2 || words.length > 5) return false
  // Each word must start with uppercase (Italian name pattern)
  const allCapitalized = words.every(w => /^[A-ZÀ-Ú]/.test(w))
  if (!allCapitalized) return false
  // Must contain only letters, spaces, apostrophes
  if (!/^[A-Za-zÀ-ú\s'.-]+$/.test(check)) return false
  // At least one word must be 3+ chars (avoid initials-only)
  if (!words.some(w => w.length >= 3)) return false
  return true
}

// ── Person role detection ──────────────────────────────────────

function normalizeRole(role: string): PersonInsuranceProfile['ruolo_normalizzato'] {
  const r = role.toLowerCase()
  if (/titolare|proprietario|owner|founder|fondatore|co-founder/.test(r)) return 'titolare'
  if (/amministratore|legale rappresentante|presidente|cda/.test(r)) return 'amministratore'
  if (/socio|partner|azionista|shareholder/.test(r)) return 'socio'
  if (/avvocato|commercialista|notaio|architetto|ingegnere|medico|dentista|farmacista|veterinario|psicologo|consulente|geometra|perito/.test(r)) return 'professionista'
  if (/direttore|director|ceo|cfo|cto|coo|manager|responsabile|dirigente|vp/.test(r)) return 'dirigente'
  if (/key|senior|lead|head|chief/.test(r)) return 'dipendente_chiave'
  return 'altro'
}

// ── Insurance recommendations per role ─────────────────────────

function getPersonalInsurance(
  role: PersonInsuranceProfile['ruolo_normalizzato'],
  settore: string | null,
  formaGiuridica: string | null,
): PersonInsuranceProfile['polizze_personali'] {
  const polizze: PersonInsuranceProfile['polizze_personali'] = []
  const fg = (formaGiuridica || '').toUpperCase()
  const cat = (settore || '').toLowerCase()

  switch (role) {
    case 'titolare':
      polizze.push({ polizza: 'Key Man Insurance', priorita: 'critica', motivo: 'Persona chiave per la sopravvivenza dell\'azienda — in caso di decesso/invalidità, l\'azienda rischia di fermarsi' })
      polizze.push({ polizza: 'Polizza Vita / TCM', priorita: 'critica', motivo: 'Protezione patrimonio familiare e continuità aziendale' })
      if (/SRL|SPA|SAS|SNC/.test(fg)) {
        polizze.push({ polizza: 'D&O Amministratori', priorita: 'critica', motivo: 'Risponde con patrimonio personale per decisioni aziendali (art. 2476 c.c.)' })
      }
      polizze.push({ polizza: 'Polizza Infortuni Titolare', priorita: 'obbligatoria', motivo: 'INAIL non copre il titolare — deve assicurarsi privatamente' })
      polizze.push({ polizza: 'Polizza Malattia Grave (Dread Disease)', priorita: 'raccomandata', motivo: 'Protezione da patologie gravi che impedirebbero la gestione' })
      polizze.push({ polizza: 'Patto di Famiglia / Successione', priorita: 'raccomandata', motivo: 'Pianificazione patrimoniale per continuità aziendale' })
      break

    case 'amministratore':
      polizze.push({ polizza: 'D&O Amministratori', priorita: 'obbligatoria', motivo: 'Responsabilità personale illimitata per atti di mala gestio (art. 2392-2395 c.c.)' })
      polizze.push({ polizza: 'Polizza Tutela Legale', priorita: 'critica', motivo: 'Copertura spese legali per azioni di responsabilità da soci/terzi' })
      polizze.push({ polizza: 'RC Amministratori', priorita: 'critica', motivo: 'Risarcimento danni a soci, creditori e terzi per errori gestionali' })
      polizze.push({ polizza: 'Polizza Infortuni', priorita: 'raccomandata', motivo: 'Protezione personale dell\'amministratore' })
      break

    case 'socio':
      polizze.push({ polizza: 'Patto Parasociale + Polizza', priorita: 'raccomandata', motivo: 'Protezione quota societaria in caso di eventi imprevisti' })
      polizze.push({ polizza: 'Polizza Vita vincolata alla quota', priorita: 'raccomandata', motivo: 'Liquidità per eredi per riscatto quote in caso di decesso' })
      if (/SNC|SAS/.test(fg)) {
        polizze.push({ polizza: 'RC Soci Illimitatamente Responsabili', priorita: 'critica', motivo: 'In SNC/SAS i soci rispondono con patrimonio personale' })
      }
      break

    case 'professionista':
      polizze.push({ polizza: 'RC Professionale', priorita: 'obbligatoria', motivo: 'Obbligatoria per legge (DPR 137/2012) per tutti gli iscritti ad albi professionali' })
      if (/medic|dentist|veterinar/.test(cat)) {
        polizze.push({ polizza: 'RC Medica / Malpractice', priorita: 'obbligatoria', motivo: 'Legge Gelli-Bianco (L. 24/2017) — obbligo per tutti i sanitari' })
        polizze.push({ polizza: 'Tutela Legale Sanitaria', priorita: 'critica', motivo: 'Difesa in caso di contenzioso per errore medico' })
      }
      if (/avvocat|commerciali|notai/.test(cat)) {
        polizze.push({ polizza: 'Polizza Infedeltà / Crime', priorita: 'raccomandata', motivo: 'Protezione da infedeltà dipendenti/collaboratori' })
      }
      if (/architett|ingegner|geometr/.test(cat)) {
        polizze.push({ polizza: 'RC Professionale con estensione cantieri', priorita: 'critica', motivo: 'Responsabilità per direzione lavori e progettazione' })
      }
      polizze.push({ polizza: 'Polizza Infortuni Professionista', priorita: 'raccomandata', motivo: 'Copertura per inabilità temporanea/permanente' })
      polizze.push({ polizza: 'Invalidità Permanente da Malattia', priorita: 'raccomandata', motivo: 'Protezione reddito in caso di malattia grave' })
      break

    case 'dirigente':
      polizze.push({ polizza: 'D&O (estensione dirigenti)', priorita: 'critica', motivo: 'Il dirigente risponde per le decisioni prese per delega' })
      polizze.push({ polizza: 'Key Man Insurance', priorita: 'raccomandata', motivo: 'Figura chiave — la sua assenza crea danno economico all\'azienda' })
      polizze.push({ polizza: 'Polizza Sanitaria Integrativa', priorita: 'raccomandata', motivo: 'Benefit tipico per dirigenti — CCNL Dirigenti prevede fondi specifici (FASI, FASDAC)' })
      polizze.push({ polizza: 'Previdenza Complementare', priorita: 'raccomandata', motivo: 'Integrazione pensionistica — i fondi negoziali (Previndai) sono comuni per dirigenti' })
      break

    case 'dipendente_chiave':
      polizze.push({ polizza: 'Key Man Insurance', priorita: 'raccomandata', motivo: 'Persona con competenze uniche — la sua assenza rallenta l\'azienda' })
      polizze.push({ polizza: 'Polizza Sanitaria Integrativa', priorita: 'raccomandata', motivo: 'Fidelizzazione dipendenti chiave tramite welfare' })
      polizze.push({ polizza: 'Infortuni Extra-Professionale', priorita: 'raccomandata', motivo: 'Copertura anche fuori dall\'orario di lavoro' })
      break

    default:
      polizze.push({ polizza: 'Polizza Infortuni', priorita: 'raccomandata', motivo: 'Copertura base infortuni' })
  }

  return polizze
}

function getPersonalRisks(
  role: PersonInsuranceProfile['ruolo_normalizzato'],
  formaGiuridica: string | null,
): string[] {
  const risks: string[] = []
  const fg = (formaGiuridica || '').toUpperCase()

  if (role === 'titolare' || role === 'amministratore') {
    risks.push('Responsabilità patrimoniale personale per debiti aziendali')
    risks.push('Azione di responsabilità da parte dei soci')
    risks.push('Rischio penale per violazione norme sicurezza lavoro (D.Lgs. 81/2008)')
    if (/SRL|SPA/.test(fg)) risks.push('Responsabilità solidale per debiti tributari (art. 36 DPR 602/73)')
  }
  if (role === 'professionista') {
    risks.push('Errore professionale con danni a terzi')
    risks.push('Violazione segreto professionale')
    risks.push('Perdita documenti/dati del cliente')
  }
  if (role === 'socio') {
    if (/SNC/.test(fg)) risks.push('Responsabilità illimitata per debiti societari')
    if (/SAS/.test(fg)) risks.push('Responsabilità illimitata se socio accomandatario')
    risks.push('Rischio perdita investimento societario')
  }
  if (role === 'dirigente' || role === 'dipendente_chiave') {
    risks.push('Responsabilità per delega su sicurezza/ambiente')
    risks.push('Rischio burnout / inabilità temporanea')
  }

  return risks
}

// ── Scrape people from CompanyReports.it ───────────────────────

async function scrapePeopleFromCompanyReports(piva: string): Promise<{ nome: string; ruolo: string }[]> {
  if (!piva) return []

  try {
    const res = await fetch(`https://www.companyreports.it/${piva}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const html = await res.text()
    if (html.length < 5000) return []
    if (html.includes('<title>CompanyReports - Il fatturato')) return []

    const people: { nome: string; ruolo: string }[] = []

    const isValidName = isValidPersonName

    // Pattern 1: "Amministratore Unico: Nome Cognome"
    const adminMatch = html.match(/Amministratore[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (adminMatch?.[1]) {
      const name = adminMatch[1].trim()
      if (isValidName(name)) {
        people.push({ nome: name, ruolo: 'Amministratore' })
      }
    }

    // Pattern 2: JSON-LD FAQ may have "chi è l'amministratore" / "chi è il titolare"
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
    for (const block of jsonLdBlocks) {
      try {
        const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
        const items = d.mainEntity || []
        for (const item of items) {
          const q = (item.name || '').toLowerCase()
          const a: string = item.acceptedAnswer?.text || ''
          if (q.includes('amministratore') || q.includes('titolare') || q.includes('legale rappresentante')) {
            // Extract name from answer like "L'amministratore di X è Mario Rossi"
            const nameMatch = a.match(/(?:è|sono)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/i)
            if (nameMatch?.[1] && isValidName(nameMatch[1]) && !people.find(p => p.nome === nameMatch[1])) {
              people.push({ nome: nameMatch[1].trim(), ruolo: q.includes('titolare') ? 'Titolare' : 'Amministratore' })
            }
          }
          if (q.includes('soci') || q.includes('azionisti')) {
            // Extract multiple names: "I soci sono Mario Rossi (60%) e Luigi Bianchi (40%)"
            const names = a.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})(?:\s*\([\d,%\s]+\))?/g)
            if (names) {
              for (const name of names) {
                const clean = name.replace(/\s*\([\d,%\s]+\)/, '').trim()
                if (isValidName(clean) && !people.find(p => p.nome === clean)) {
                  people.push({ nome: clean, ruolo: 'Socio' })
                }
              }
            }
          }
        }
      } catch { /* ignore malformed JSON-LD */ }
    }

    // Pattern 3: Look for "Presidente CdA", "Consigliere" in HTML text
    const presMatch = html.match(/Presidente[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (presMatch?.[1]) {
      const name = presMatch[1].trim()
      if (isValidName(name) && !people.find(p => p.nome === name)) {
        people.push({ nome: name, ruolo: 'Presidente CdA' })
      }
    }

    return people
  } catch {
    return []
  }
}

// ── Search Google for key people + LinkedIn ────────────────────

async function googleSearchPeople(companyName: string, ragioneSociale: string | null, city: string): Promise<{ nome: string; ruolo: string; fonte: string }[]> {
  const people: { nome: string; ruolo: string; fonte: string }[] = []
  const nameVariants = [companyName, ragioneSociale].filter(Boolean) as string[]

  const fetchGoogle = async (query: string): Promise<string> => {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=it`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html',
          'Accept-Language': 'it-IT,it;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      })
      return await res.text()
    } catch { return '' }
  }

  // Run multiple Google searches in parallel — cast widest net
  const searches = nameVariants.flatMap(name => [
    fetchGoogle(`"${name}" ${city} titolare OR fondatore OR CEO OR "amministratore unico"`),
    fetchGoogle(`site:linkedin.com/in "${name}" ${city}`),
    fetchGoogle(`"${name}" "chi siamo" OR "il nostro team" OR "about us" ${city}`),
    fetchGoogle(`"${name}" ${city} "rappresentante legale" OR "socio" OR "direttore" OR "responsabile"`),
    fetchGoogle(`site:facebook.com "${name}" ${city}`),
    fetchGoogle(`"${name}" ${city} "intervista" OR "dichiarato" OR "fondato da" OR "guidata da"`),
  ])

  const results = await Promise.allSettled(searches)
  const allHtml = results.map(r => r.status === 'fulfilled' ? r.value : '').join('\n')

  // Extract names from snippets — wide net
  const patterns = [
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:di|de|del|della|dei|degli|delle)\s+)?[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?),?\s*(?:titolare|fondatore|proprietario|CEO|amministratore|legale rappresentante|socio|owner|founder|direttore|responsabile|presidente)/gi,
    /(?:titolare|fondatore|proprietario|CEO|amministratore|owner|founder|direttore|presidente)\s+(?:(?:di|della|dell'|del)\s+\w+\s+)?(?:è\s+)?([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:di|de|del|della)?\s*[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    /(?:gestita|fondata|creata|diretta|amministrata|guidata)\s+da\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    // "DI NOME COGNOME" pattern from snippets (ditta individuale)
    /\bDI\s+([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)\b/g,
    // "dichiarato/a NOME COGNOME" from news articles
    /(?:dichiarato|dichiarata|intervistato|intervistata|spiega|afferma|racconta|commenta)\s+([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+)/gi,
    // "responsabile|direttore NOME COGNOME"
    /(?:responsabile|direttore|manager|head)\s+(?:\w+\s+)?([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+)/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(allHtml)) !== null) {
      let name = match[1]?.trim()
      if (!name) continue
      // Convert ALL CAPS to Title Case
      if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
      if (name && isValidPersonName(name) && !people.find(p => p.nome === name)) {
        const context = match[0].toLowerCase()
        let ruolo = 'Titolare'
        if (context.includes('fondatore') || context.includes('founder') || context.includes('fondata')) ruolo = 'Fondatore'
        if (context.includes('ceo')) ruolo = 'CEO'
        if (context.includes('amministratore')) ruolo = 'Amministratore'
        if (context.includes('socio')) ruolo = 'Socio'
        people.push({ nome: name, ruolo, fonte: 'Google' })
      }
    }
  }

  // Extract from LinkedIn URL slugs
  const liMatches = allHtml.match(/linkedin\.com\/in\/([a-z0-9_-]+)/gi) || []
  const seen = new Set<string>()
  for (const li of liMatches) {
    const slug = li.replace(/.*linkedin\.com\/in\//i, '').replace(/\/.*/, '')
    if (seen.has(slug)) continue
    seen.add(slug)
    const parts = slug.split('-').filter(p => p.length > 1 && !/^\d+$/.test(p))
    if (parts.length >= 2 && parts.length <= 4) {
      const name = parts.slice(0, Math.min(parts.length, 3))
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ')
      if (isValidPersonName(name) && !people.find(p => p.nome === name)) {
        people.push({ nome: name, ruolo: 'Dirigente/Fondatore (LinkedIn)', fonte: 'LinkedIn' })
      }
    }
  }

  return people.slice(0, 6)
}

// ── Scrape company website for people ──────────────────────────

async function scrapeWebsiteForPeople(website: string): Promise<{ nome: string; ruolo: string }[]> {
  if (!website) return []
  const people: { nome: string; ruolo: string }[] = []

  const fetchPage = async (url: string): Promise<string> => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
        signal: AbortSignal.timeout(6000),
        redirect: 'follow',
      })
      return res.ok ? await res.text() : ''
    } catch { return '' }
  }

  const base = website.startsWith('http') ? website : `https://${website}`
  const baseClean = base.replace(/\/+$/, '')

  // Try common pages: chi-siamo, about, team, privacy, cookie-policy
  const pages = [
    baseClean,
    `${baseClean}/chi-siamo`, `${baseClean}/about`, `${baseClean}/about-us`,
    `${baseClean}/team`, `${baseClean}/il-team`, `${baseClean}/lo-studio`,
    `${baseClean}/privacy`, `${baseClean}/privacy-policy`, `${baseClean}/cookie-policy`,
  ]

  const results = await Promise.allSettled(pages.map(p => fetchPage(p)))
  const allHtml = results.map(r => r.status === 'fulfilled' ? r.value : '').join('\n')

  // Italian privacy policies MUST contain the data controller's name
  // Use [A-Za-zÀ-ÿ] to match BOTH Title Case AND ALL CAPS names
  const privacyPatterns = [
    /titolare\s+del\s+trattamento[\s\S]{0,400}?(?:da|è)[:\s]+([A-ZÀ-ÿ][A-Za-zÀ-ÿ\s'.,]+?(?:DI\s+)?[A-ZÀ-ÿ][A-Za-zÀ-ÿ\s'.]+?)(?:\s+con\s+sede|\s*,\s*\d|\s*[-–]\s*(?:P\.?\s*I|C\.?\s*F)|\s*\.\s*P\.?\s*I)/gi,
    /rappresentante\s+legale[:\s]+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,3})/gi,
    /amministratore\s+unico[:\s]+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,3})/gi,
    // "nella persona del Rappresentante legale Mario Rossi"
    /nella\s+persona\s+del\s+(?:Rappresentante\s+legale|Titolare|Amministratore)\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,3})/gi,
    // "IMPRESA X DI NOME COGNOME" pattern (ditte individuali)
    /\bDI\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,3})\s+(?:con\s+sede|P\.?\s*I|C\.?\s*F)/gi,
    // "titolare del trattamento è: COMPANY DI NOME COGNOME"
    /titolare[\s\S]{0,300}?\bDI\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,3})\b/gi,
  ]

  // Helper: extract person name from a raw string that may contain "IMPRESA X DI NOME COGNOME"
  const extractPersonFromRaw = (raw: string): string | null => {
    // Try ALL "DI" positions, pick first valid person name
    const diRe = /\bDI\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ]+){1,4})/gi
    let diM
    while ((diM = diRe.exec(raw)) !== null) {
      let name = diM[1].trim()
      if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
      if (isValidPersonName(name)) return name
    }
    // If no DI pattern, try the raw string directly
    let direct = raw.trim()
    if (direct === direct.toUpperCase() && direct.length > 3) direct = toTitleCase(direct)
    if (isValidPersonName(direct)) return direct
    return null
  }

  for (const pattern of privacyPatterns) {
    let match
    while ((match = pattern.exec(allHtml)) !== null) {
      const raw = match[1]?.trim()
      if (!raw) continue
      const name = extractPersonFromRaw(raw)
      if (name && !people.find(p => p.nome === name)) {
        people.push({ nome: name, ruolo: 'Titolare/Legale Rappresentante' })
      }
    }
  }

  // "Chi siamo" / about page patterns
  const aboutPatterns = [
    /(?:fondato|fondata|creato|creata|nata)\s+(?:da|nel\s+\d{4}\s+da)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    /(?:il\s+(?:titolare|fondatore|proprietario|direttore))\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2}),?\s+(?:fondatore|titolare|CEO|direttore|proprietario)/gi,
  ]

  for (const pattern of aboutPatterns) {
    let match
    while ((match = pattern.exec(allHtml)) !== null) {
      const name = match[1]?.trim()
      if (name && isValidPersonName(name) && !people.find(p => p.nome === name)) {
        const ctx = match[0].toLowerCase()
        const ruolo = ctx.includes('fondato') ? 'Fondatore' : ctx.includes('direttore') ? 'Direttore' : 'Titolare'
        people.push({ nome: name, ruolo })
      }
    }
  }

  return people.slice(0, 5)
}

// ── MAIN: Enrich people for a company ─────────────────────────

export async function enrichPeople(
  companyName: string,
  ragioneSociale: string | null,
  city: string,
  piva: string | null,
  categoria: string | null,
  formaGiuridica: string | null,
  website: string,
  teamMembers: { name: string; role?: string }[],
  personName: string | null,
  personRole: string | null,
  linkedinPerson: string | null,
  linkedinCompany: string | null,
  titolareFromRegistry: string | null = null,
  titolareCF: string | null = null,
  titolareDataNascita: string | null = null,
  titolareSesso: string | null = null,
  titolareEta: number | null = null,
): Promise<PeopleEnrichmentResult> {
  const fonti: string[] = []
  const allPeople: { nome: string; ruolo: string; fonte: string; cf?: string; data_nascita?: string; sesso?: string; eta?: number }[] = []

  // Build a set of company name variants to exclude from person results
  const companyNames = new Set<string>()
  for (const n of [companyName, ragioneSociale].filter(Boolean) as string[]) {
    const clean = n.replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|soc|coop|ltd|gmbh|inc|corp)\b\.?/gi, '').trim()
    companyNames.add(clean.toLowerCase())
    // Also add individual significant words (2+ chars) to catch partial matches like "Artedile Due"
    clean.split(/\s+/).filter(w => w.length > 2).forEach(w => companyNames.add(w.toLowerCase()))
  }

  const isCompanyName = (name: string): boolean => {
    const lower = name.toLowerCase().trim()
    // Exact match with company name
    if (companyNames.has(lower)) return true
    // Check if the name is a subset of the company name
    for (const cn of companyNames) {
      if (cn.length > 5 && (lower.includes(cn) || cn.includes(lower))) return true
    }
    return false
  }

  // 0. Use person data already found by clay enrichment
  if (personName && isValidPersonName(personName) && !isCompanyName(personName)) {
    fonti.push('Arricchimento lead')
    allPeople.push({
      nome: personName,
      ruolo: personRole || 'Referente principale',
      fonte: linkedinPerson ? 'LinkedIn' : 'Sito web',
    })
  }

  // 0b. Use titolare from registry (extracted from privacy policy)
  if (titolareFromRegistry && isValidPersonName(titolareFromRegistry) && !isCompanyName(titolareFromRegistry)) {
    const existing = allPeople.find(ap => ap.nome.toLowerCase() === titolareFromRegistry.toLowerCase())
    if (!existing) {
      fonti.push('Privacy Policy aziendale')
      allPeople.push({
        nome: titolareFromRegistry,
        ruolo: 'Titolare / Legale Rappresentante',
        fonte: 'Privacy Policy',
        cf: titolareCF || undefined,
        data_nascita: titolareDataNascita || undefined,
        sesso: titolareSesso || undefined,
        eta: titolareEta || undefined,
      })
    } else {
      // Enrich existing entry with CF data
      if (titolareCF && !existing.cf) existing.cf = titolareCF
      if (titolareDataNascita && !existing.data_nascita) existing.data_nascita = titolareDataNascita
      if (titolareSesso && !existing.sesso) existing.sesso = titolareSesso
      if (titolareEta && !existing.eta) existing.eta = titolareEta
    }
  }

  // 1. Use existing team members from website scraping
  if (teamMembers?.length > 0) {
    if (!fonti.includes('Sito web aziendale')) fonti.push('Sito web aziendale')
    for (const m of teamMembers) {
      if (m.name && isValidPersonName(m.name) && !isCompanyName(m.name) && !allPeople.find(ap => ap.nome.toLowerCase() === m.name.toLowerCase())) {
        allPeople.push({ nome: m.name, ruolo: m.role || 'Team Member', fonte: 'Sito web' })
      }
    }
  }

  // 2-4. Run all external searches in parallel
  const [crPeople, googlePeople, websitePeople] = await Promise.allSettled([
    piva ? scrapePeopleFromCompanyReports(piva) : Promise.resolve([]),
    googleSearchPeople(companyName, ragioneSociale, city),
    scrapeWebsiteForPeople(website),
  ])

  if (crPeople.status === 'fulfilled' && crPeople.value.length > 0) {
    fonti.push('Registro Imprese (CompanyReports)')
    for (const p of crPeople.value) {
      if (!isCompanyName(p.nome) && !allPeople.find(ap => ap.nome.toLowerCase() === p.nome.toLowerCase())) {
        allPeople.push({ ...p, fonte: 'Registro Imprese' })
      }
    }
  }

  if (googlePeople.status === 'fulfilled' && googlePeople.value.length > 0) {
    for (const p of googlePeople.value) {
      if (!isCompanyName(p.nome) && !allPeople.find(ap => ap.nome.toLowerCase() === p.nome.toLowerCase())) {
        if (!fonti.includes(p.fonte)) fonti.push(p.fonte)
        allPeople.push(p)
      }
    }
  }

  if (websitePeople.status === 'fulfilled' && websitePeople.value.length > 0) {
    fonti.push('Privacy Policy / Chi Siamo')
    for (const p of websitePeople.value) {
      if (!isCompanyName(p.nome) && !allPeople.find(ap => ap.nome.toLowerCase() === p.nome.toLowerCase())) {
        allPeople.push({ ...p, fonte: 'Sito web (Privacy/Chi siamo)' })
      }
    }
  }

  // Extract name from LinkedIn URL slug if we have it
  if (linkedinPerson && allPeople.length === 0) {
    const slug = linkedinPerson.replace(/.*linkedin\.com\/in\//i, '').replace(/\/.*/, '')
    const parts = slug.split('-').filter(p => p.length > 1 && !/^\d+$/.test(p))
    if (parts.length >= 2) {
      const name = parts.slice(0, Math.min(parts.length, 3)).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
      if (isValidPersonName(name)) {
        fonti.push('LinkedIn')
        allPeople.push({ nome: name, ruolo: 'Referente (LinkedIn)', fonte: 'LinkedIn' })
      }
    }
  }

  // ── Generate role-based profiles even when no names found ──
  // Normalize legal form: handle both abbreviations AND full Italian text
  const fgRaw = (formaGiuridica || '').toLowerCase()
  const cat = (categoria || '').toLowerCase()

  // Detect legal form type from both abbreviations and full text
  const isSRLS = /srls|s\.?r\.?l\.?s|limitata\s+semplificata/.test(fgRaw)
  const isSRL = !isSRLS && /srl|s\.?r\.?l|responsabilit[aà]\s+limitata/.test(fgRaw)
  const isSPA = /spa|s\.?p\.?a|societ[aà]\s+per\s+azioni/.test(fgRaw)
  const isSNC = /snc|s\.?n\.?c|nome\s+collettivo/.test(fgRaw)
  const isSAS = /sas|s\.?a\.?s|accomandita\s+semplice/.test(fgRaw)
  const isDitta = /ditta\s+individuale|individuale|impresa\s+individuale/.test(fgRaw)
  const isStudio = /studio|associazione\s+professionale/.test(fgRaw)
  const isCooperativa = /cooperativa|coop|scarl|scrl/.test(fgRaw)
  const fg = isSRLS ? 'SRLS' : isSRL ? 'SRL' : isSPA ? 'SPA' : isSNC ? 'SNC' : isSAS ? 'SAS' : isDitta ? 'DITTA' : isStudio ? 'STUDIO' : isCooperativa ? 'COOP' : ''

  if (allPeople.length === 0) {
    fonti.push('Analisi forma giuridica')

    if (isSRLS) {
      allPeople.push({ nome: 'Amministratore Unico (SRLS)', ruolo: 'Amministratore Unico', fonte: 'Forma giuridica — SRLS ha sempre un amministratore unico' })
    } else if (isSRL) {
      allPeople.push({ nome: 'Amministratore/Legale Rappresentante', ruolo: 'Amministratore', fonte: 'Forma giuridica — SRL richiede almeno un amministratore' })
      allPeople.push({ nome: 'Soci SRL', ruolo: 'Socio', fonte: 'Forma giuridica — SRL ha uno o più soci' })
    } else if (isSPA) {
      allPeople.push({ nome: 'Presidente CdA', ruolo: 'Presidente CdA', fonte: 'Forma giuridica — SPA richiede un CdA' })
      allPeople.push({ nome: 'Amministratore Delegato', ruolo: 'Amministratore', fonte: 'Forma giuridica — SPA' })
      allPeople.push({ nome: 'Collegio Sindacale', ruolo: 'Amministratore', fonte: 'Forma giuridica — SPA richiede collegio sindacale' })
    } else if (isSNC) {
      allPeople.push({ nome: 'Soci (responsabilità illimitata)', ruolo: 'Socio', fonte: 'Forma giuridica — SNC: tutti i soci rispondono illimitatamente' })
    } else if (isSAS) {
      allPeople.push({ nome: 'Socio Accomandatario', ruolo: 'Titolare', fonte: 'Forma giuridica — SAS: accomandatario gestisce e risponde illimitatamente' })
      allPeople.push({ nome: 'Socio Accomandante', ruolo: 'Socio', fonte: 'Forma giuridica — SAS: accomandante risponde solo per la quota' })
    } else if (isDitta) {
      allPeople.push({ nome: 'Titolare (ditta individuale)', ruolo: 'Titolare', fonte: 'Forma giuridica — ditta individuale' })
    } else if (isStudio) {
      allPeople.push({ nome: 'Titolare Studio', ruolo: 'Professionista', fonte: 'Forma giuridica — studio professionale' })
    } else if (isCooperativa) {
      allPeople.push({ nome: 'Presidente Cooperativa', ruolo: 'Amministratore', fonte: 'Forma giuridica — cooperativa richiede un presidente' })
    }

    // Sector-based roles
    if (allPeople.length === 0) {
      if (/avvocat|commerciali|notai|architett|ingegner|medic|dentist|veterinar|farmaci|geometr|consulen|psicolog/.test(cat)) {
        allPeople.push({ nome: 'Professionista titolare', ruolo: 'Professionista', fonte: 'Settore — libero professionista' })
      } else {
        allPeople.push({ nome: 'Titolare/Legale Rappresentante', ruolo: 'Titolare', fonte: 'Ruolo presunto dalla struttura aziendale' })
      }
    }
  }

  // Build profiles with insurance recommendations
  const persone: PersonInsuranceProfile[] = allPeople.slice(0, 8).map(p => {
    const ruoloNorm = normalizeRole(p.ruolo)
    const isGeneric = !isValidPersonName(p.nome) // nome generico (non trovato specifico)
    return {
      nome: p.nome,
      ruolo: p.ruolo,
      ruolo_normalizzato: ruoloNorm,
      fonte: p.fonte,
      ...(p.cf ? { codice_fiscale: p.cf } : {}),
      ...(p.data_nascita ? { data_nascita: p.data_nascita } : {}),
      ...(p.sesso ? { sesso: p.sesso } : {}),
      ...(p.eta ? { eta: p.eta } : {}),
      polizze_personali: getPersonalInsurance(ruoloNorm, categoria, formaGiuridica),
      rischi_personali: getPersonalRisks(ruoloNorm, formaGiuridica),
      note: isGeneric
        ? 'Nome non identificato — le polizze sono basate sul ruolo obbligatorio per questa forma giuridica'
        : ruoloNorm === 'titolare'
        ? 'Figura chiave dell\'azienda — massima priorità commerciale'
        : ruoloNorm === 'professionista'
        ? 'RC Professionale obbligatoria per legge'
        : null,
    }
  })

  // Team-level recommendations based on count and form
  const raccomandazioni_team: string[] = []
  const hasTitolare = persone.some(p => p.ruolo_normalizzato === 'titolare')
  const hasAmm = persone.some(p => p.ruolo_normalizzato === 'amministratore')
  const hasSoci = persone.filter(p => p.ruolo_normalizzato === 'socio').length
  const hasDirigenti = persone.filter(p => ['dirigente', 'dipendente_chiave'].includes(p.ruolo_normalizzato)).length

  if (hasTitolare) {
    raccomandazioni_team.push('Key Man Insurance per il titolare — protegge l\'azienda dalla perdita della figura chiave')
  }
  if (hasAmm && /SRL|SRLS|SPA/.test(fg)) {
    raccomandazioni_team.push('D&O obbligatoria — l\'amministratore risponde personalmente per mala gestio (art. 2476 c.c.)')
  }
  if (/SRLS/.test(fg)) {
    raccomandazioni_team.push('SRLS ha capitale sociale minimo (€1) — il titolare è più esposto. Polizza vita e Key Man fondamentali')
  }
  if (hasSoci >= 2) {
    raccomandazioni_team.push(`${hasSoci} soci identificati — proporre patti parasociali con polizze vincolate alle quote`)
  }
  if (/SNC/.test(fg)) {
    raccomandazioni_team.push('SNC: TUTTI i soci rispondono illimitatamente — RC Soci e Polizza Vita CRITICHE')
  }
  if (hasDirigenti >= 2) {
    raccomandazioni_team.push(`${hasDirigenti} figure dirigenziali — proporre pacchetto Employee Benefits (sanitaria + previdenza)`)
  }
  if (persone.length >= 3) {
    raccomandazioni_team.push('Team strutturato — valutare polizza collettiva infortuni e sanitaria integrativa')
  }

  const realNamesCount = persone.filter(p => isValidPersonName(p.nome)).length

  return {
    persone,
    totale_trovate: realNamesCount,
    fonti,
    raccomandazioni_team,
  }
}
