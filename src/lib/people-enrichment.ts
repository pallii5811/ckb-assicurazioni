/**
 * Arricchimento persone chiave dell'azienda — GRATIS
 * Fonti: CompanyReports.it, OpenCorporates, Google Search, Google News,
 *        Sito web aziendale, LinkedIn (via Google), analisi nome azienda
 * Genera raccomandazioni assicurative specifiche per ruolo
 */

// ── Types ──────────────────────────────────────────────────────

export interface PersonInsuranceProfile {
  nome: string
  ruolo: string
  ruolo_normalizzato: 'titolare' | 'amministratore' | 'socio' | 'professionista' | 'dirigente' | 'dipendente_chiave' | 'altro'
  fonte: string
  fonti_multiple?: string[]
  codice_fiscale?: string
  data_nascita?: string
  sesso?: string
  eta?: number
  email?: string
  telefono?: string
  linkedin?: string
  foto_url?: string
  confidenza: number // 0-100 based on source confirmation count
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

// ── Universal search engine (DuckDuckGo primary, Bing fallback) ────────

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
}

// Rate-limited search queue — max 2 concurrent, 600ms between requests
let _searchQueue: Promise<void> = Promise.resolve()
let _searchActive = 0

async function fetchSearchResults(query: string, timeoutMs = 10000): Promise<string> {
  // Queue to prevent parallel flood that triggers CAPTCHA
  while (_searchActive >= 2) {
    await new Promise(r => setTimeout(r, 300))
  }
  _searchActive++
  try {
    return await _doFetchSearch(query, timeoutMs)
  } finally {
    _searchActive--
  }
}

async function _doFetchSearch(query: string, timeoutMs: number): Promise<string> {
  const cleanHtml = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

  // Try DuckDuckGo HTML
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(ddgUrl, { headers: SEARCH_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
    const html = await res.text()
    // Check for bot/CAPTCHA page
    if (res.status === 200 && html.length > 2000 && !html.includes('bots use DuckDuckGo') && !html.includes('confirm this search')) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400)) // delay between requests
      return cleanHtml(html)
    }
  } catch { /* DDG failed */ }

  // Small delay before trying Bing
  await new Promise(r => setTimeout(r, 300))

  // Fallback: Bing
  try {
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=it`
    const res = await fetch(bingUrl, { headers: SEARCH_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
    const html = await res.text()
    if (html.length > 2000 && !html.includes('captcha') && !html.includes('unusual traffic')) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400))
      return cleanHtml(html)
    }
  } catch { /* Bing failed too */ }

  return ''
}

// ── Name validation (shared) ───────────────────────────────────────────

const NAME_BLOCKLIST = /visura|camerale|registro|imprese|bilancio|fatturato|companyreport|company|report|societa|azienda|impresa|italia|partita iva|codice fiscale|sede legale|capitale sociale|amministrazione|informazioni|contatti|cookie|privacy|home|assistenza|servizi|supporto|ufficio|numero|telefono|email|indirizzo|orario|apertura|chiusura|lavora con noi|mappa|dove siamo|chi siamo|pagina|sito|website|google|facebook|linkedin|twitter|instagram|youtube|tiktok|whatsapp|costruzioni|ristorante|studio|impresa|ditta|bottega|gruppo|holding|fondazione|associazione|seguito|specificato|previsto|indicato|presente|documento|informativa|trattamento|personali|consenso|normativa|regolamento|articolo|paragrafo|sezione|titolare|responsabile|incaricato|interessato|destinatario|garante|autorita|disposizione|finalita|modalita|comunicazione|diffusione|profilazione|automatizzato|legittimo|interesse|necessario|obbligatorio|facoltativo|conferimento|periodo|conservazione|opposizione|reclamo|diritto|revoca|portabilita|cancellazione|rettifica|limitazione|accesso|pulizia|pulizie|cleaning|consulenza|cooperativa|customer|service|support|sales|marketing|commercial|booking|reservation|prenotazion|reception|dispatch|spedizion|logistic|warehouse|magazzino|operation|billing|account|finance|procurement|purchase|hr |human.resource|recruitment|webmaster|postmaster|noreply|no.reply|newsletter|subscribe|unsubscribe|header|footer|sidebar|navbar|tbody|thead|tfoot|wrapper|container|content|section|button|submit|input|label|checkbox|radio|select|option|textarea|dropdown|modal|tooltip|popover|carousel|slider|widget|plugin|script|style|class|table|column|field|value|null|undefined|default|error|warning|success|loading|pending|active|disabled|hidden|visible|display|block|inline|flex|grid|margin|padding|border|width|height|color|background|font|text|image|icon|logo|menu|navigation|breadcrumb|pagination|search|filter|sort|toggle|collapse|expand|close|open|prev|next|click|hover|focus|scroll|resize|none|auto|inherit|important|pixel|viewport|media|query|responsive|breakpoint|desktop|mobile|tablet|portrait|landscape|animation|transition|transform|opacity|shadow|radius|gradient/i

// Blocklist for functional/generic email prefixes that are NOT person names
const EMAIL_PREFIX_BLOCKLIST = /^(info|admin|contact|contatti|help|support|supporto|service|servizio|sales|vendite|marketing|commercial|commerciale|booking|prenotazioni|reservation|reception|accoglienza|dispatch|spedizioni|logistica|warehouse|magazzino|operations|billing|fatturazione|accounts|contabilita|finance|finanza|procurement|acquisti|purchase|hr|humanresources|recruitment|selezione|webmaster|postmaster|noreply|newsletter|subscribe|press|stampa|media|ufficio|direzione|segreteria|sede|filiale|agenzia|succursale|customer|custom|client|utente|shop|store|negozio|order|ordini|delivery|consegna|tracking|resi|reclami|qualita|tecnico|assistenza|laboratorio|produzione|arco|centro|nord|sud|est|ovest|roma|milano|torino|napoli|firenze|bologna|genova|palermo|catania|bari|verona|padova|brescia|modena|parma|aosta|cagliari|trieste|trento|perugia|ancona|potenza|campobasso)$/i

// Additional blocklist for single words that are never Italian first/last names
const WORD_BLOCKLIST = /^(the|and|for|with|from|that|this|have|been|were|are|was|not|but|all|can|had|her|his|how|its|may|new|now|old|our|out|own|say|she|too|use|way|who|why|also|back|been|come|each|find|from|give|good|have|help|here|high|just|know|last|left|like|long|look|made|make|many|more|most|much|must|name|need|next|only|over|part|same|some|such|take|tell|than|them|then|time|turn|upon|very|want|well|went|what|when|will|work|year|your|about|after|again|being|below|could|every|first|found|great|house|large|later|never|offer|order|other|place|point|right|shall|since|small|start|state|still|their|there|these|thing|think|those|three|under|until|using|which|while|world|would|write|call|col|div|span|href|link|meta|body|head|html|form|data|type|void|main|aside|thead|tfoot|tbody|param|xmlns|cdata|doctype|colspan|rowspan|cellpadding|cellspacing|align|valign|nowrap|bgcolor)$/i

const LEGAL_FORM_BLOCKLIST = /\b(spa|srl|srls|snc|sas|sapa|scarl|scrl|soc|coop|onlus|ltd|gmbh|inc|corp|llc|plc)\b/i

// News sources / websites often captured as false-positive names
const NEWS_SOURCE_BLOCKLIST = /^(parmatoday|dissapore|teleborsa|ansa|adnkronos|ilsole|corriere|gazzetta|repubblica|messaggero|stampa|avvenire|giornale|liberoquotidiano|fattoquotidiano|huffpost|fanpage|tgcom|skytg|rainews|wired|forbes|bloomberg|reuters|google news|alimentando|foodweb|foodaffairs|mark up|italiaoggi|milanofinanza|panorama|espresso|internazionale|startmag|startupitalia|formiche|agrifood|agronotizie|freshplaza|greenplanet|horecanews|mixerplanet|ristorazioneitalia|gamberorosso|quifinanza|investireoggi|money|wallstreetitalia|soldionline|borsaitaliana|finanza|economia|notizie|today|online|press|news|daily|times|post|journal|tribune|herald|gazette|observer|monitor|report|review|magazine|weekly|monthly)$/i

function toTitleCase(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

// Top 300 Italian first names for positive validation
const ITALIAN_FIRST_NAMES = new Set([
  'marco','giuseppe','giovanni','antonio','mario','francesco','paolo','andrea','carlo','luca',
  'roberto','alessandro','luciano','stefano','massimo','franco','salvatore','fabio','giorgio','alberto',
  'enrico','davide','claudio','daniele','vincenzo','riccardo','simone','nicola','filippo','michele',
  'pietro','lorenzo','matteo','tommaso','emanuele','dario','leonardo','sergio','gianluca','giancarlo',
  'renato','gianfranco','domenico','pasquale','raffaele','maurizio','mauro','bruno','vittorio','alfredo',
  'cesare','eugenio','umberto','guido','felice','armando','angelo','silvio','aldo','arturo',
  'corrado','ernesto','gino','ivo','nino','osvaldo','primo','remo','romeo','ugo',
  'maria','anna','paola','francesca','chiara','giulia','elena','sara','silvia','laura',
  'valentina','federica','alessandra','monica','daniela','barbara','roberta','cristina','patrizia','luisa',
  'carla','giovanna','rosa','teresa','lucia','angela','margherita','caterina','emanuela','claudia',
  'elisabetta','ilaria','martina','elisa','michela','serena','manuela','antonella','stefania','valeria',
  'gabriella','concetta','giuseppina','carmela','rita','irene','sonia','nadia','grazia','ornella',
  'flavia','marina','adelaide','agnese','beatrice','bianca','carlotta','diana','edoardo','emilio',
  'fabrizio','gianluigi','gianni','giacomo','giuliano','ivano','luigi','marcello','mirko','norberto',
  'orazio','oscar','ottavio','pier','piero','renzo','rinaldo','rocco','romano','ruggero',
  'silvano','tiziano','tullio','valerio','walter','giampaolo','pierluigi','giampiero','gianpiero','gianmarco',
])

// Corporate roles that should never be treated as person names
const ROLE_AS_NAME_BLOCKLIST = /^(amministratore delegato|amministratore unico|amministratore|presidente cda|presidente del consiglio|presidente collegio sindacale|collegio sindacale|consiglio di amministrazione|consigliere delegato|consigliere|sindaco effettivo|sindaco supplente|sindaco|revisore legale|revisore contabile|revisore|direttore generale|direttore tecnico|direttore commerciale|direttore|procuratore speciale|procuratore|liquidatore|socio unico|socio accomandatario|socio accomandante|rappresentante legale|legale rappresentante|organo di controllo|organo amministrativo|titolare effettivo|responsabile tecnico|institore|preposto)$/i

function isValidPersonName(name: string): boolean {
  if (!name || name.length < 5 || name.length > 50) return false
  // Convert ALL CAPS to Title Case before validation
  let check = name
  if (check === check.toUpperCase() && check.length > 3) check = toTitleCase(check)
  // Block corporate role titles used as names
  if (ROLE_AS_NAME_BLOCKLIST.test(check.trim())) return false
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
  // Block HTML/CSS/technical terms that leak through scraping
  if (words.some(w => WORD_BLOCKLIST.test(w))) return false
  // Block news source names (from RSS feeds)
  if (NEWS_SOURCE_BLOCKLIST.test(check.replace(/\s+/g, '').toLowerCase())) return false
  if (words.some(w => NEWS_SOURCE_BLOCKLIST.test(w.toLowerCase()))) return false
  // STRONG CHECK: At least one word must be a known Italian first name
  // OR the name must have vowel-heavy Italian structure (≥35% vowels)
  const isKnownName = words.some(w => ITALIAN_FIRST_NAMES.has(w.toLowerCase()))
  if (!isKnownName) {
    // Fallback: check vowel ratio — Italian names are typically >35% vowels
    const totalVowels = (check.match(/[aeiouàèéìòù]/gi) || []).length
    const totalLetters = check.replace(/[^a-zA-ZÀ-ú]/g, '').length
    if (totalLetters === 0 || totalVowels / totalLetters < 0.35) return false
    // Also require each word has at least 1 vowel
    if (!words.every(w => /[aeiouàèéìòù]/i.test(w))) return false
  }
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

async function scrapePeopleFromCompanyReports(piva: string, companyName?: string): Promise<{ nome: string; ruolo: string }[]> {
  if (!piva && !companyName) return []

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html',
    'Accept-Language': 'it-IT,it;q=0.9',
  }

  try {
    let html = ''

    // Try direct P.IVA URL first
    if (piva) {
      const res = await fetch(`https://www.companyreports.it/${piva}`, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        html = await res.text()
        // If redirected to homepage, try search instead
        if (html.includes('<title>CompanyReports - Il fatturato') || html.length < 5000) {
          html = ''
        }
      }
    }

    // Fallback: search by company name or P.IVA
    if (!html && (companyName || piva)) {
      const q = encodeURIComponent((companyName || piva || '').replace(/['"]/g, '').trim())
      const searchRes = await fetch(`https://www.companyreports.it/search?q=${q}`, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(8000),
      })
      if (searchRes.ok) {
        const searchHtml = await searchRes.text()
        // Extract first company link from search results
        const linkMatch = searchHtml.match(/href="\/(\d{11})"/i) || searchHtml.match(/href="\/([^"]+?)"/gi)
        if (linkMatch) {
          const slug = linkMatch[0].replace(/href="\//, '').replace(/"$/, '')
          if (slug && slug !== '' && !slug.includes('search')) {
            const pageRes = await fetch(`https://www.companyreports.it/${slug}`, {
              headers: fetchHeaders,
              signal: AbortSignal.timeout(8000),
            })
            if (pageRes.ok) {
              html = await pageRes.text()
              if (html.includes('<title>CompanyReports - Il fatturato') || html.length < 5000) html = ''
            }
          }
        }
      }
    }

    if (!html) return []

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

  // Use primary company name only (avoid duplicate queries for ragioneSociale)
  const name = companyName
  const searches = [
    fetchSearchResults(`"${name}" ${city} titolare fondatore CEO amministratore delegato presidente`),
    fetchSearchResults(`"${name}" ${city} linkedin.com/in direttore responsabile`),
    fetchSearchResults(`"${name}" "chi siamo" "il nostro team" ${city}`),
  ]

  const results = await Promise.allSettled(searches)
  const allHtml = results.map(r => r.status === 'fulfilled' ? r.value : '').join('\n')
  // Extract names from snippets — wide net (works with DuckDuckGo/Bing plain text)
  const patterns = [
    // "Nome Cognome, titolare/CEO/fondatore..."
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:di|de|del|della|dei|degli|delle)\s+)?[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?),?\s*(?:titolare|fondatore|proprietario|CEO|amministratore|legale rappresentante|socio|owner|founder|direttore|responsabile|presidente)/gi,
    // "amministratore delegato è Nome Cognome" — allows extra words between role and name
    /(?:titolare|fondatore|proprietario|CEO|amministratore(?:\s+(?:delegato|unico))?|owner|founder|direttore(?:\s+generale)?|presidente)\s+(?:(?:di|della|dell|del|dei)\s+)?(?:\w+\s+)?(?:è\s+|e\s+)?([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:di|de|del|della)?\s*[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    // "gestita/fondata da Nome Cognome"
    /(?:gestita|fondata|creata|diretta|amministrata|guidata)\s+da\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    // "DI NOME COGNOME" pattern (ditta individuale)
    /\bDI\s+([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)\b/g,
    // "ha dichiarato/spiega Nome Cognome"
    /(?:ha dichiarato|dichiarato|dichiarata|intervistato|intervistata|spiega|afferma|racconta|commenta|dice)\s+([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+)/gi,
    // "responsabile|direttore Nome Cognome"
    /(?:responsabile|direttore|manager|head)\s+(?:\w+\s+)?([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][a-zà-ú]+)/gi,
    // "Nome (Presidente/CEO)" — DDG format with role in parentheses
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*\(\s*(?:Presidente|CEO|Fondatore|Amministratore|Vicepresidente|Direttore|AD|Titolare|Socio)[^)]*\)/gi,
    // "a capo a Nome (Ruolo)" or "proprietà di Nome"
    /(?:fa capo a|proprietà di|guidata da|guidato da|a capo di|alla guida)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})/gi,
    // "è Nome Cognome" after a role mention within ~60 chars
    /(?:amministratore delegato|AD|CEO|presidente|direttore generale|DG)\s+(?:\w+\s+){0,5}?è\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:di|de|del|della)?\s*[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
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
    // Split by "DI" boundary and try each suffix from LAST to FIRST
    const diParts = raw.split(/\bDI\b/i)
    if (diParts.length >= 2) {
      for (let di = diParts.length - 1; di >= 1; di--) {
        const after = diParts[di].trim()
        if (!after) continue
        let name = after.replace(/\s+/g, ' ').trim()
        if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
        if (isValidPersonName(name)) return name
      }
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

// ── OpenCorporates.com FREE API — Officers/Directors ─────────

async function scrapeOpenCorporates(companyName: string, city: string): Promise<{ nome: string; ruolo: string }[]> {
  const people: { nome: string; ruolo: string }[] = []
  try {
    // Scrape OpenCorporates website directly (API requires paid token now)
    const q = encodeURIComponent(companyName.replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s)\b\.?/gi, '').trim())
    const res = await fetch(
      `https://opencorporates.com/companies?q=${q}&jurisdiction_code=it`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html', 'Accept-Language': 'it-IT,it;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []
    const searchHtml = await res.text()
    
    // Extract first company link
    const companyLink = searchHtml.match(/href="(\/companies\/it\/[^"]+)"/i)
    if (!companyLink) return []
    
    // Fetch company page
    const pageRes = await fetch(`https://opencorporates.com${companyLink[1]}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!pageRes.ok) return []
    const pageHtml = await pageRes.text()
    const text = pageHtml.replace(/<[^>]+>/g, ' ')
    
    // Extract officers from the page
    const officerPatterns = [
      /(?:officer|director|amministratore|presidente|sindaco|consigliere|procuratore)\s*[:\-–]\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/gi,
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*(?:,\s*|\s*[-–—]\s*)(?:amministratore|presidente|sindaco|consigliere|director|officer)/gi,
    ]
    
    // Also try JSON-LD or structured data
    const jsonLdMatch = pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
    for (const block of jsonLdMatch) {
      try {
        const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
        if (d.member) {
          for (const m of (Array.isArray(d.member) ? d.member : [d.member])) {
            let name = m.name || ''
            if (name.includes(',')) name = name.split(',').map((p: string) => p.trim()).reverse().join(' ')
            if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
            if (isValidPersonName(name) && !people.find(p => p.nome.toLowerCase() === name.toLowerCase())) {
              people.push({ nome: name, ruolo: m.roleName || m.jobTitle || 'Dirigente' })
            }
          }
        }
      } catch {}
    }

    for (const pat of officerPatterns) {
      let m
      while ((m = pat.exec(text)) !== null) {
        let name = m[1]?.trim()
        if (!name) continue
        if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
        if (!isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('presidente') ? 'Presidente CdA' : ctx.includes('sindaco') ? 'Sindaco' :
          ctx.includes('consigliere') ? 'Consigliere CdA' : ctx.includes('procuratore') ? 'Procuratore' : 'Amministratore'
        people.push({ nome: name, ruolo })
      }
    }
  } catch { /* OpenCorporates non raggiungibile */ }
  return people.slice(0, 10)
}

// ── Enhanced CompanyReports.it — Extract ALL people (sindaci, consiglieri, soci %)

async function scrapePeopleFromCompanyReportsEnhanced(piva: string): Promise<{ nome: string; ruolo: string; quota?: string }[]> {
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
    if (html.length < 5000 || html.includes('<title>CompanyReports - Il fatturato')) return []

    const people: { nome: string; ruolo: string; quota?: string }[] = []

    // Extract from structured JSON-LD FAQ data (most reliable)
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
    for (const block of jsonLdBlocks) {
      try {
        const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
        const items = d.mainEntity || []
        for (const item of items) {
          const q = (item.name || '').toLowerCase()
          const a: string = item.acceptedAnswer?.text || ''

          // Amministratore
          if (q.includes('amministratore') || q.includes('titolare') || q.includes('legale rappresentante')) {
            const nameMatch = a.match(/(?:è|sono)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/i)
            if (nameMatch?.[1] && isValidPersonName(nameMatch[1]) && !people.find(p => p.nome === nameMatch[1])) {
              people.push({ nome: nameMatch[1].trim(), ruolo: q.includes('titolare') ? 'Titolare' : 'Amministratore' })
            }
          }
          // Soci with percentages
          if (q.includes('soci') || q.includes('azionisti') || q.includes('quote')) {
            const sociEntries = a.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})\s*(?:\(?\s*(\d+[.,]?\d*)\s*%\s*\)?)?/g)
            if (sociEntries) {
              for (const entry of sociEntries) {
                const match = entry.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})\s*(?:\(?\s*(\d+[.,]?\d*)\s*%)?/)
                if (match?.[1]) {
                  const clean = match[1].trim()
                  if (isValidPersonName(clean) && !people.find(p => p.nome === clean)) {
                    people.push({ nome: clean, ruolo: 'Socio', quota: match[2] ? `${match[2]}%` : undefined })
                  }
                }
              }
            }
          }
          // Sindaci / Revisori
          if (q.includes('sindac') || q.includes('revisor') || q.includes('collegio')) {
            const names = a.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/g)
            if (names) {
              for (const n of names) {
                if (isValidPersonName(n) && !people.find(p => p.nome === n)) {
                  people.push({ nome: n, ruolo: q.includes('presidente') ? 'Presidente Collegio Sindacale' : 'Sindaco' })
                }
              }
            }
          }
          // Direttore Generale
          if (q.includes('direttore') || q.includes('manager') || q.includes('responsabile')) {
            const nameMatch = a.match(/(?:è|sono)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/i)
            if (nameMatch?.[1] && isValidPersonName(nameMatch[1]) && !people.find(p => p.nome === nameMatch[1])) {
              people.push({ nome: nameMatch[1].trim(), ruolo: 'Direttore Generale' })
            }
          }
        }
      } catch { /* ignore malformed JSON-LD */ }
    }

    // HTML table patterns for additional roles
    const htmlPatterns = [
      { regex: /Amministratore[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Amministratore' },
      { regex: /Presidente[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Presidente CdA' },
      { regex: /Sindac[oi][^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Sindaco' },
      { regex: /Consiglier[ei][^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Consigliere CdA' },
      { regex: /Direttore[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Direttore Generale' },
      { regex: /Procuratore[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Procuratore' },
      { regex: /Revisore[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Revisore' },
      { regex: /Socio[^<]*<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/gi, ruolo: 'Socio' },
    ]
    for (const { regex, ruolo } of htmlPatterns) {
      let m
      while ((m = regex.exec(html)) !== null) {
        let name = m[1]?.trim()
        if (!name) continue
        if (name === name.toUpperCase() && name.length > 3) name = toTitleCase(name)
        if (isValidPersonName(name) && !people.find(p => p.nome.toLowerCase() === name.toLowerCase())) {
          people.push({ nome: name, ruolo })
        }
      }
    }

    return people
  } catch { return [] }
}

// ── Google News — Executive mentions ─────────────────────────

async function googleNewsPeople(companyName: string, city: string): Promise<{ nome: string; ruolo: string; contesto: string }[]> {
  const people: { nome: string; ruolo: string; contesto: string }[] = []

  // Helper to decode HTML entities in RSS
  const decodeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'")

  // Helper to extract text from RSS XML (titles + descriptions)
  const extractRssText = (xml: string): string => {
    const titles = (xml.match(/<title>([^<]{10,300})<\/title>/gi) || [])
      .map(t => t.replace(/<\/?title>/gi, '').replace(/\s*-\s*[A-ZÀ-Ú][a-zA-ZÀ-ú\s.]{3,30}$/, ''))
    const descs = (xml.match(/<description>([^<]{10,1000})<\/description>/gi) || [])
      .map(d => d.replace(/<\/?description>/gi, '').replace(/<[^>]+>/g, ' '))
    return [...titles, ...descs].map(decodeHtml).join('\n')
  }

  try {
    // Run 3 different RSS queries in parallel for maximum coverage
    const rssQueries = [
      `"${companyName}" CEO OR fondatore OR amministratore OR direttore OR presidente`,
      `"${companyName}" nomina OR "nuovo CEO" OR "amministratore delegato" OR "consiglio di amministrazione"`,
      `"${companyName}" ${city} titolare OR socio OR "direttore generale" OR intervista`,
    ]
    const rssResults = await Promise.allSettled(
      rssQueries.map(q =>
        fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=it&gl=IT&ceid=IT:it`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        }).then(r => r.ok ? r.text() : '')
      )
    )
    const allText = rssResults.map(r => r.status === 'fulfilled' ? extractRssText(r.value) : '').join('\n')

    const patterns = [
      // "Nome Cognome, CEO/fondatore/..." or "nominato CFO"
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})\s*(?:,\s*|\s+)(?:nominato|nuovo|è il nuovo|è il|confermato|eletto)\s+(?:CEO|CFO|CTO|COO|AD|amministratore delegato|direttore|presidente|fondatore|DG)/gi,
      // "CEO/AD Nome Cognome"
      /(?:CEO|AD|CFO|CTO|COO|amministratore delegato|direttore generale|presidente|fondatore)\s+(?:di\s+\w+\s+)?([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
      // "Nome Cognome è il nuovo CEO"
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:di|de|del|della)?\s*[A-ZÀ-Ú][a-zà-ú]+){1,2})\s+è il nuov[oa]\s+(?:CEO|AD|CFO|CTO|amministratore|direttore|presidente)/gi,
      // "Barilla, Nome Cognome (da X) nominato Y"
      /(?:^|,\s+)([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s+(?:\([^)]+\)\s+)?(?:nominat[oa]|nuovo|confermato|eletto)\s+(\w+)/gim,
      // "ha dichiarato/spiega Nome Cognome"
      /(?:ha dichiarato|ha spiegato|afferma|commenta|spiega|dice|racconta)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
      // "intervista a Nome Cognome" / "parla Nome Cognome"
      /(?:intervista\s+a|parla|secondo)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
      // "Nome Cognome, presidente/direttore/socio di Barilla"
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2}),?\s+(?:presidente|direttore|socio|titolare|fondatore|CEO|AD|CFO)\s+(?:di|del|della|dell)/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(allText)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('ceo') || ctx.includes('amministratore delegato') || ctx.includes(' ad ') ? 'CEO/AD' :
          ctx.includes('cfo') ? 'CFO' : ctx.includes('cto') ? 'CTO' : ctx.includes('coo') ? 'COO' :
          ctx.includes('fondatore') ? 'Fondatore' : ctx.includes('presidente') ? 'Presidente' :
          ctx.includes('titolare') ? 'Titolare' : ctx.includes('socio') ? 'Socio' :
          ctx.includes('direttore') ? 'Direttore Generale' : 'Dirigente'
        const titleIdx = allText.indexOf(m[0])
        const line = allText.slice(Math.max(0, titleIdx - 20), Math.min(allText.length, titleIdx + m[0].length + 40)).trim()
        people.push({ nome: name, ruolo, contesto: line.slice(0, 120) })
      }
    }
  } catch { /* Google News RSS non raggiungibile */ }
  return people.slice(0, 12)
}

// ── OpenAPI.it — Official Italian Company Registry (Registro Imprese) ────
// Returns managers, shareholders, employees, legal representative
// API docs: https://console.openapi.com/apis/company/documentation

interface OpenApiManager {
  name?: string
  surname?: string
  companyName?: string
  roles?: { role?: { code?: string; description?: string }; roleStartDate?: string }[]
  gender?: { code?: string; description?: string }
  taxCode?: string
  birthDate?: string
  age?: number
  birthTown?: string
  isLegalRepresentative?: boolean
}

interface OpenApiShareholder {
  shareholdersInformation?: { taxCode?: string; companyName?: string; sinceDate?: string; streetName?: string; name?: string; surname?: string }[]
  percentShare?: number
}

interface OpenApiStakeholdersResponse {
  data?: {
    managers?: OpenApiManager[]
    shareholders?: OpenApiShareholder[]
    companyDetails?: { vatCode?: string; taxCode?: string; companyName?: string }
    employees?: { employee?: number; employeeRange?: { description?: string }; employeeTrend?: number }
    address?: { streetName?: string; town?: string; province?: { description?: string } }
  }
}

async function openApiPeople(piva: string): Promise<{ nome: string; ruolo: string; cf?: string; data_nascita?: string; sesso?: string; eta?: string; quota?: string; isLegalRep?: boolean }[]> {
  // USE the centralized openapi-service which has Supabase cache (180 days).
  // Previously this function called /IT-advanced and /IT-stakeholders DIRECTLY
  // without cache, causing DOUBLE API calls for every P.IVA search.
  try {
    const { enrichCompanyByPiva } = await import('@/lib/openapi-service')
    const cleanPiva = piva.replace(/^IT/i, '').replace(/\s/g, '').trim()
    if (cleanPiva.length < 11) return []

    const enriched = await enrichCompanyByPiva(cleanPiva)
    if (!enriched) return []

    const people: { nome: string; ruolo: string; cf?: string; data_nascita?: string; sesso?: string; eta?: string; quota?: string; isLegalRep?: boolean }[] = []

    // Extract shareholders from cached /IT-advanced data
    const shareholders = enriched.shareholders || []
    for (const sh of shareholders) {
      if (sh.isCompany || !sh.nome || !sh.cognome) continue
      const nome = `${sh.nome.charAt(0).toUpperCase()}${sh.nome.slice(1).toLowerCase()} ${sh.cognome.charAt(0).toUpperCase()}${sh.cognome.slice(1).toLowerCase()}`
      const isFirst = shareholders.indexOf(sh) === 0
      people.push({
        nome,
        ruolo: shareholders.length === 1 ? 'Socio Unico' : 'Socio',
        cf: sh.taxCode || undefined,
        quota: sh.percentShare ? `${sh.percentShare}%` : undefined,
        isLegalRep: shareholders.length === 1 ? true : isFirst,
      })
    }

    // Extract managers from cached /IT-stakeholders data
    if (enriched.managers) {
      const existingNames = new Set(people.map(p => p.nome.toLowerCase()))
      for (const mgr of enriched.managers) {
        if (!mgr.nome || !mgr.cognome) continue
        const nome = `${mgr.nome.charAt(0).toUpperCase()}${mgr.nome.slice(1).toLowerCase()} ${mgr.cognome.charAt(0).toUpperCase()}${mgr.cognome.slice(1).toLowerCase()}`
        if (existingNames.has(nome.toLowerCase())) continue
        const roleMap: Record<string, string> = {
          'Managing director': 'Amministratore Unico',
          'Sole owner': 'Socio Unico',
          'Chairman of the board of directors': 'Presidente CdA',
          'Director': 'Consigliere',
          'Special representative/agent': 'Procuratore Speciale',
          'General manager': 'Direttore Generale',
          'Auditor': 'Sindaco',
          'Chairman of the board of auditors': 'Presidente Collegio Sindacale',
          'Liquidator': 'Liquidatore',
          'Holder': 'Titolare',
        }
        const ruolo = roleMap[mgr.ruoloOriginale || ''] || mgr.ruolo || 'Dirigente'
        people.push({
          nome,
          ruolo: mgr.isLegalRep ? `${ruolo} (Legale Rappresentante)` : ruolo,
          cf: mgr.taxCode || undefined,
          data_nascita: mgr.dataNascita || undefined,
          sesso: mgr.sesso || undefined,
          eta: mgr.eta ? String(mgr.eta) : undefined,
          isLegalRep: mgr.isLegalRep || false,
        })
        existingNames.add(nome.toLowerCase())
      }
    }

    return people
  } catch { /* OpenAPI.it non raggiungibile */ }
  return []
}

// ── Google search for cached Visure Camerali ─────────────────

async function googleVisuraPeople(companyName: string, city: string): Promise<{ nome: string; ruolo: string }[]> {
  const people: { nome: string; ruolo: string }[] = []
  try {
    const allText = await fetchSearchResults(`"${companyName}" ${city} "visura camerale" organigramma "consiglio di amministrazione" "collegio sindacale" revisore`, 8000)

    const patterns = [
      /(?:amministratore|consigliere|sindaco|revisore|presidente|direttore|procuratore)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—]\s*(?:amministratore|consigliere|sindaco|presidente|direttore)/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(allText)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('sindaco') ? 'Sindaco' : ctx.includes('consigliere') ? 'Consigliere CdA' :
          ctx.includes('revisore') ? 'Revisore' : ctx.includes('presidente') ? 'Presidente' :
          ctx.includes('direttore') ? 'Direttore' : ctx.includes('procuratore') ? 'Procuratore' : 'Amministratore'
        people.push({ nome: name, ruolo })
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 8)
}

// ── Per-person contact enrichment via Google ─────────────────

async function enrichPersonContact(
  personName: string, companyName: string, city: string, companyDomain: string
): Promise<{ email?: string; telefono?: string; linkedin?: string }> {
  const result: { email?: string; telefono?: string; linkedin?: string } = {}
  try {
    const allText = await fetchSearchResults(`"${personName}" "${companyName}" email telefono linkedin ${city}`, 6000)

    // LinkedIn URL
    const liMatch = allText.match(/linkedin\.com\/in\/([a-z0-9_-]+)/i)
    if (liMatch) result.linkedin = `https://www.linkedin.com/in/${liMatch[1]}`

    // Email (skip generic/platform emails)
    const text = allText
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi) || []
    for (const e of emailMatch) {
      const el = e.toLowerCase()
      if (el.includes('google') || el.includes('example') || el.includes('noreply') || el.includes('privacy') || el.includes('cookie')) continue
      // Prefer emails on company domain
      if (companyDomain && el.includes(companyDomain.replace(/^www\./, '').split('/')[0])) {
        result.email = el
        break
      }
      if (!result.email) result.email = el
    }

    // Phone (Italian mobile: 3xx, landline: 0xx)
    const phoneMatch = text.match(/(?:\+39\s?)?(?:3[0-9]{2}[\s.-]?\d{3}[\s.-]?\d{4}|0[0-9]{1,3}[\s.-]?\d{4,8})/g)
    if (phoneMatch?.[0]) result.telefono = phoneMatch[0].replace(/[\s.-]/g, '')
  } catch { /* non raggiungibile */ }
  return result
}

// ── Reportaziende.it — FREE company reports with people ──────

async function scrapeReportaziende(companyName: string, piva: string | null): Promise<{ nome: string; ruolo: string }[]> {
  const people: { nome: string; ruolo: string }[] = []
  try {
    const q = piva || companyName
    // Search for reportaziende page via DuckDuckGo/Bing
    const searchText = await fetchSearchResults(`reportaziende.it "${q}"`, 6000)
    // Also try direct URL on reportaziende
    let text = searchText
    const urlMatch = searchText.match(/reportaziende\.it\/[^\s"'<>]+/i)
    if (urlMatch) {
      try {
        const pageRes = await fetch(`https://www.${urlMatch[0].replace(/^www\./, '')}`, {
          headers: SEARCH_HEADERS, signal: AbortSignal.timeout(8000),
        })
        if (pageRes.ok) {
          const pageHtml = await pageRes.text()
          text += ' ' + pageHtml.replace(/<[^>]+>/g, ' ')
        }
      } catch {}
    }

    const patterns = [
      /(?:amministratore|presidente|sindaco|consigliere|direttore|titolare|socio|revisore|procuratore|liquidatore)\s*(?:unico|delegato|generale)?\s*:?\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/gi,
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—]\s*(?:amministratore|presidente|sindaco|consigliere|direttore|titolare|socio)/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(text)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('presidente') ? 'Presidente' : ctx.includes('sindaco') ? 'Sindaco' :
          ctx.includes('consigliere') ? 'Consigliere CdA' : ctx.includes('direttore') ? 'Direttore' :
          ctx.includes('socio') ? 'Socio' : ctx.includes('revisore') ? 'Revisore' :
          ctx.includes('titolare') ? 'Titolare' : ctx.includes('procuratore') ? 'Procuratore' : 'Amministratore'
        people.push({ nome: name, ruolo })
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 8)
}

// ── Indeed.it — Job postings reveal org structure ─────────────

async function scrapeIndeedPeople(companyName: string, city: string): Promise<{ nome: string; ruolo: string }[]> {
  const people: { nome: string; ruolo: string }[] = []
  try {
    const text = await fetchSearchResults(`"${companyName}" ${city} indeed.com glassdoor.it fondatore CEO titolare direttore`, 6000)
    const patterns = [
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2}),?\s*(?:CEO|fondatore|titolare|direttore|owner|founder|managing director)/gi,
      /(?:CEO|fondatore|titolare|owner|founder)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(text)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('ceo') ? 'CEO' : ctx.includes('fondatore') || ctx.includes('founder') ? 'Fondatore' :
          ctx.includes('direttore') || ctx.includes('director') ? 'Direttore' : 'Titolare'
        people.push({ nome: name, ruolo })
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 5)
}

// ── Facebook business page — team/about info ─────────────────

async function scrapeFacebookPeople(companyName: string, city: string): Promise<{ nome: string; ruolo: string }[]> {
  const people: { nome: string; ruolo: string }[] = []
  try {
    const text = await fetchSearchResults(`facebook.com "${companyName}" ${city} fondatore titolare proprietario CEO owner`, 6000)
    const patterns = [
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—·|]\s*(?:fondatore|titolare|proprietario|CEO|owner|direttore|manager)/gi,
      /(?:fondatore|titolare|proprietario|CEO|owner)\s*[-–—:·|]\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(text)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('ceo') ? 'CEO' : ctx.includes('fondatore') || ctx.includes('founder') ? 'Fondatore' :
          ctx.includes('proprietario') || ctx.includes('owner') ? 'Proprietario' : 'Titolare'
        people.push({ nome: name, ruolo })
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 5)
}

// ── Crunchbase/AngelList via Google — startup founders ────────

async function scrapeCrunchbasePeople(companyName: string): Promise<{ nome: string; ruolo: string }[]> {
  const people: { nome: string; ruolo: string }[] = []
  try {
    const text = await fetchSearchResults(`"${companyName}" crunchbase.com wellfound.com founder co-founder CEO fondatore`, 6000)
    const patterns = [
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—·|,]\s*(?:founder|co-founder|CEO|CTO|COO|CFO|fondatore|co-fondatore)/gi,
      /(?:founder|co-founder|CEO|fondatore)\s*[-–—:·|,]\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(text)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('cto') ? 'CTO' : ctx.includes('coo') ? 'COO' : ctx.includes('cfo') ? 'CFO' :
          ctx.includes('co-found') || ctx.includes('co-fond') ? 'Co-Fondatore' : ctx.includes('ceo') ? 'CEO' : 'Fondatore'
        people.push({ nome: name, ruolo })
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 5)
}

// ── Google DEEP — ultra-aggressive multi-query people search ─

async function googleDeepPeopleSearch(companyName: string, ragioneSociale: string | null, city: string, piva: string | null): Promise<{ nome: string; ruolo: string; fonte: string }[]> {
  const people: { nome: string; ruolo: string; fonte: string }[] = []
  const cn = ragioneSociale || companyName
  try {
    const queries = [
      `"${cn}" ${city} "amministratore delegato" CEO presidente fondatore "consiglio di amministrazione"`,
      `"${cn}" ${city} sindaco revisore direttore socio azionista procuratore`,
      ...(piva ? [`"${piva}" amministratore presidente titolare`] : []),
    ]
    // Run via rate-limited queue (max 2 concurrent)
    const batch = await Promise.allSettled(queries.map(q => fetchSearchResults(q, 8000)))
    const allText = batch
      .map(r => r.status === 'fulfilled' ? r.value : '')
      .join('\n')

    const extractionPatterns = [
      // "Name, CEO di Company"
      { pat: /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2}),?\s*(?:CEO|AD|CTO|COO|CFO|amministratore delegato|direttore generale|DG|presidente|fondatore|fondatrice)/gi, roleIdx: 0 },
      // "CEO Company Name Surname"
      { pat: /(?:CEO|AD|CTO|COO|CFO|amministratore delegato|presidente|fondatore|direttore generale)\s+(?:di\s+)?(?:\w+\s+)?([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi, roleIdx: 0 },
      // "ha dichiarato Name Surname"
      { pat: /(?:ha dichiarato|ha spiegato|afferma|commenta|spiega|racconta|dice)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi, roleIdx: 0 },
      // "amministratore: Name" or "sindaco: Name"
      { pat: /(?:amministratore|presidente|sindaco|consigliere|revisore|direttore|procuratore|titolare|socio)\s*(?:unico|delegato|generale)?\s*:?\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})/gi, roleIdx: 0 },
      // "Name — amministratore"
      { pat: /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—]\s*(?:amministratore|presidente|sindaco|consigliere|direttore|fondatore|socio|titolare|CEO|AD)/gi, roleIdx: 0 },
    ]
    for (const { pat } of extractionPatterns) {
      let m
      while ((m = pat.exec(allText)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('ceo') || ctx.includes('amministratore delegato') ? 'CEO' :
          ctx.includes('cto') ? 'CTO' : ctx.includes('coo') ? 'COO' : ctx.includes('cfo') ? 'CFO' :
          ctx.includes('presidente') ? 'Presidente' : ctx.includes('fondatore') || ctx.includes('fondatrice') ? 'Fondatore' :
          ctx.includes('direttore generale') || ctx.includes(' dg') ? 'Direttore Generale' :
          ctx.includes('sindaco') ? 'Sindaco' : ctx.includes('consigliere') ? 'Consigliere CdA' :
          ctx.includes('revisore') ? 'Revisore' : ctx.includes('procuratore') ? 'Procuratore' :
          ctx.includes('socio') || ctx.includes('azionista') ? 'Socio' :
          ctx.includes('titolare') ? 'Titolare' : ctx.includes('responsabile') || ctx.includes('head') ? 'Responsabile' :
          ctx.includes('direttore') ? 'Direttore' : 'Dirigente'
        people.push({ nome: name, ruolo, fonte: 'Google Search' })
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 10)
}

// ── Website FULL scraping — ALL pages for team/staff ─────────

async function scrapeWebsiteAllPages(website: string): Promise<{ nome: string; ruolo: string; email?: string }[]> {
  if (!website) return []
  const people: { nome: string; ruolo: string; email?: string }[] = []
  try {
    const base = website.replace(/\/$/, '')
    const pagesToCheck = [
      '/team', '/il-team', '/chi-siamo', '/about', '/about-us', '/lo-staff',
      '/staff', '/contatti', '/contacts', '/azienda', '/company', '/persone',
      '/management', '/organizzazione', '/la-nostra-storia', '/storia',
    ]
    // Fetch homepage + team pages in parallel (max 4 at a time)
    const fetchPage = async (url: string): Promise<string> => {
      try {
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html',
          },
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
        })
        if (!r.ok) return ''
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('text/html')) return ''
        return await r.text()
      } catch { return '' }
    }

    // First try homepage to find team page links
    const homeHtml = await fetchPage(base)
    const foundLinks: string[] = []
    if (homeHtml) {
      const linkMatches = homeHtml.match(/href=["']([^"']*(?:team|staff|chi-siamo|about|contatti|management|azienda|persone|organizzazione)[^"']*)["']/gi) || []
      for (const lm of linkMatches) {
        const href = lm.replace(/href=["']/i, '').replace(/["']$/, '')
        if (href.startsWith('http')) foundLinks.push(href)
        else if (href.startsWith('/')) foundLinks.push(base + href)
      }
    }

    // Merge with standard paths (deduplicated)
    const allUrls = new Set<string>([...foundLinks, ...pagesToCheck.map(p => base + p)])
    const urlArray = Array.from(allUrls).slice(0, 8) // max 8 pages

    const pages = await Promise.allSettled(urlArray.map(u => fetchPage(u)))
    const allHtml = [homeHtml, ...pages.map(p => p.status === 'fulfilled' ? p.value : '')].join('\n')
    const text = allHtml.replace(/<[^>]+>/g, ' ')

    // Extract people patterns
    const patterns = [
      /(?:CEO|fondatore|titolare|presidente|direttore|manager|responsabile|socio|partner)\s*[-–—:·|]\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
      /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—·|]\s*(?:CEO|fondatore|titolare|presidente|direttore|manager|responsabile|socio|partner|founder|owner)/gi,
      /(?:Dott\.?|Ing\.?|Avv\.?|Arch\.?|Geom\.?|Rag\.?|Prof\.?)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    ]
    for (const pat of patterns) {
      let m
      while ((m = pat.exec(text)) !== null) {
        const name = m[1]?.trim()
        if (!name || !isValidPersonName(name)) continue
        if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
        const ctx = m[0].toLowerCase()
        const ruolo = ctx.includes('ceo') ? 'CEO' : ctx.includes('fondatore') || ctx.includes('founder') ? 'Fondatore' :
          ctx.includes('presidente') ? 'Presidente' : ctx.includes('direttore') ? 'Direttore' :
          ctx.includes('titolare') || ctx.includes('owner') ? 'Titolare' :
          ctx.includes('dott') ? 'Professionista' : ctx.includes('avv') ? 'Avvocato' :
          ctx.includes('ing') ? 'Ingegnere' : ctx.includes('arch') ? 'Architetto' :
          ctx.includes('responsabile') || ctx.includes('manager') ? 'Responsabile' : 'Team Member'
        people.push({ nome: name, ruolo })
      }
    }

    // Extract emails associated with names
    const emailPatterns = allHtml.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi) || []
    const domain = base.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    for (const email of emailPatterns) {
      if (!email.toLowerCase().includes(domain)) continue
      // Try to match email prefix to a person name (e.g. mario.rossi@ → Mario Rossi)
      const rawPrefix = email.split('@')[0].toLowerCase()
      // Skip functional/generic emails (info@, customer.service@, support@, etc.)
      const prefixWords = rawPrefix.replace(/[._-]/g, ' ').trim().split(/\s+/)
      const isFunctionalEmail = prefixWords.some(w => EMAIL_PREFIX_BLOCKLIST.test(w))
      if (isFunctionalEmail) continue
      const prefix = rawPrefix.replace(/[._-]/g, ' ').trim()
      const parts = prefix.split(/\s+/)
      if (parts.length >= 2 && parts.length <= 3) {
        const guessName = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
        if (isValidPersonName(guessName)) {
          const existing = people.find(p => p.nome.toLowerCase() === guessName.toLowerCase())
          if (existing) {
            existing.email = email.toLowerCase()
          } else {
            people.push({ nome: guessName, ruolo: 'Dipendente', email: email.toLowerCase() })
          }
        }
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 10)
}

// ── LinkedIn company employees via Google ─────────────────────

async function scrapeLinkedInEmployees(companyName: string, city: string): Promise<{ nome: string; ruolo: string; linkedin?: string }[]> {
  const people: { nome: string; ruolo: string; linkedin?: string }[] = []
  try {
    const allHtml = await fetchSearchResults(`linkedin.com/in "${companyName}" ${city} CEO fondatore direttore amministratore`, 8000)

    // Parse LinkedIn results from text snippets
    const text = allHtml
    const liSnippets = text.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—·|]\s*([^-–—·|]{3,40})\s*[-–—·|]\s*[^|]*LinkedIn/gi) || []
    for (const snippet of liSnippets) {
      const m = snippet.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—·|]\s*([^-–—·|]{3,40})/i)
      if (!m) continue
      const name = m[1]?.trim()
      const role = m[2]?.trim()
      if (!name || !isValidPersonName(name)) continue
      if (people.find(p => p.nome.toLowerCase() === name.toLowerCase())) continue
      // Extract LinkedIn URL
      const urlIdx = allHtml.toLowerCase().indexOf(name.toLowerCase())
      let linkedinUrl: string | undefined
      if (urlIdx > 0) {
        const nearby = allHtml.slice(Math.max(0, urlIdx - 500), urlIdx + 500)
        const urlMatch = nearby.match(/linkedin\.com\/in\/([a-z0-9_-]+)/i)
        if (urlMatch) linkedinUrl = `https://www.linkedin.com/in/${urlMatch[1]}`
      }
      const ruolo = role && role.length > 2 && role.length < 40 ? role : 'Dipendente'
      people.push({ nome: name, ruolo, linkedin: linkedinUrl })
    }

    // Also extract from URL slugs
    const slugMatches = allHtml.match(/linkedin\.com\/in\/([a-z0-9_-]+)/gi) || []
    for (const slug of slugMatches) {
      const parts = slug.replace(/.*linkedin\.com\/in\//i, '').replace(/\/.*/, '').split('-').filter(p => p.length > 1 && !/^\d+$/.test(p))
      if (parts.length >= 2 && parts.length <= 4) {
        const name = parts.slice(0, Math.min(parts.length, 3)).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
        if (isValidPersonName(name) && !people.find(p => p.nome.toLowerCase() === name.toLowerCase())) {
          people.push({ nome: name, ruolo: 'Dipendente', linkedin: `https://www.${slug}` })
        }
      }
    }
  } catch { /* non raggiungibile */ }
  return people.slice(0, 8)
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
  const allPeople: { nome: string; ruolo: string; fonte: string; cf?: string; data_nascita?: string; sesso?: string; eta?: number; email?: string; telefono?: string; linkedin?: string; foto_url?: string; quota?: string }[] = []

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

  // 2-13. Run ALL external searches in parallel — MAXIMUM FREE coverage
  // NOTE: Sources using search engines (DDG/Bing/Google) are DISABLED because they
  // all trigger CAPTCHA/bot detection when doing fetch(). Only DIRECT sources work:
  // - CompanyReports (direct URL), OpenCorporates (direct), Google News RSS, Website scraping
  const [
    crPeople,         // CompanyReports basic
    crPeopleEnh,      // CompanyReports enhanced (sindaci, consiglieri, soci %)
    openApiResult,    // OpenAPI.it /IT-advanced (FREE!) — shareholders, bilancio, ATECO
    websitePeople,    // Website privacy/chi-siamo
    ocPeople,         // OpenCorporates (officers/directors)
    newsPeople,       // Google News RSS (WORKS — XML feed, no CAPTCHA)
    visuraPeople,     // DISABLED — DDG/Bing blocked
    reportPeople,     // DISABLED — DDG/Bing blocked
    indeedPeople,     // DISABLED — DDG/Bing blocked
    fbPeople,         // DISABLED — DDG/Bing blocked
    crunchPeople,     // DISABLED — DDG/Bing blocked
    deepGooglePeople, // DISABLED — DDG/Bing blocked
    websiteFullPeople, // Full website scraping (team/staff/about pages)
    linkedinPeople,   // DISABLED — DDG/Bing blocked
  ] = await Promise.allSettled([
    scrapePeopleFromCompanyReports(piva || '', companyName),
    piva ? scrapePeopleFromCompanyReportsEnhanced(piva) : Promise.resolve([]),
    piva ? openApiPeople(piva) : Promise.resolve([]),  // OpenAPI.it /IT-advanced (FREE!)
    scrapeWebsiteForPeople(website),
    scrapeOpenCorporates(companyName, city),
    googleNewsPeople(companyName, city),               // RSS feed — WORKS
    Promise.resolve([] as { nome: string; ruolo: string }[]),                  // googleVisuraPeople — DISABLED
    Promise.resolve([] as { nome: string; ruolo: string }[]),                  // scrapeReportaziende — DISABLED
    Promise.resolve([] as { nome: string; ruolo: string }[]),                  // scrapeIndeedPeople — DISABLED
    Promise.resolve([] as { nome: string; ruolo: string }[]),                  // scrapeFacebookPeople — DISABLED
    Promise.resolve([] as { nome: string; ruolo: string }[]),                  // scrapeCrunchbasePeople — DISABLED
    Promise.resolve([] as { nome: string; ruolo: string; fonte: string }[]),   // googleDeepPeopleSearch — DISABLED
    scrapeWebsiteAllPages(website),
    Promise.resolve([] as { nome: string; ruolo: string; linkedin?: string }[]) // scrapeLinkedInEmployees — DISABLED
  ])

  // Track which sources each name comes from for confidence scoring
  const nameSourceMap = new Map<string, Set<string>>()
  const addPerson = (p: { nome: string; ruolo: string; fonte?: string; quota?: string; email?: string; telefono?: string; linkedin?: string; foto_url?: string }, sourceName: string) => {
    if (!p.nome || isCompanyName(p.nome) || !isValidPersonName(p.nome)) return
    const key = p.nome.toLowerCase()
    if (!nameSourceMap.has(key)) nameSourceMap.set(key, new Set())
    nameSourceMap.get(key)!.add(sourceName)
    const existing = allPeople.find(ap => ap.nome.toLowerCase() === key)
    if (existing) {
      // Merge: keep best data from each source
      if (p.email && !existing.email) existing.email = p.email
      if (p.telefono && !existing.telefono) existing.telefono = p.telefono
      if (p.linkedin && !existing.linkedin) existing.linkedin = p.linkedin
      if (p.foto_url && !existing.foto_url) existing.foto_url = p.foto_url
      if (p.quota && !existing.quota) existing.quota = p.quota
      // Upgrade role if new one is more specific
      const specificRoles = ['CEO', 'Amministratore Unico', 'Presidente CdA', 'Fondatore', 'Direttore Generale']
      if (specificRoles.includes(p.ruolo) && !specificRoles.includes(existing.ruolo)) {
        existing.ruolo = p.ruolo
      }
    } else {
      allPeople.push({ ...p, fonte: p.fonte || sourceName })
    }
  }

  // CompanyReports basic
  if (crPeople.status === 'fulfilled' && crPeople.value.length > 0) {
    fonti.push('Registro Imprese (CompanyReports)')
    for (const p of crPeople.value) addPerson({ ...p, fonte: 'Registro Imprese' }, 'CompanyReports')
  }

  // CompanyReports enhanced (sindaci, consiglieri, soci with %)
  if (crPeopleEnh.status === 'fulfilled' && crPeopleEnh.value.length > 0) {
    if (!fonti.includes('Registro Imprese (CompanyReports)')) fonti.push('Registro Imprese (CompanyReports)')
    for (const p of crPeopleEnh.value) addPerson({ ...p, fonte: 'Registro Imprese' }, 'CompanyReports')
  }

  // OpenCorporates (FREE API — officers/directors)
  if (ocPeople.status === 'fulfilled' && ocPeople.value.length > 0) {
    fonti.push('OpenCorporates')
    for (const p of ocPeople.value) addPerson({ ...p, fonte: 'OpenCorporates' }, 'OpenCorporates')
  }

  // Google Search — DISABLED (replaced by OpenAPI.it)
  // (slot now used by openApiResult above)

  // Website scraping
  if (websitePeople.status === 'fulfilled' && websitePeople.value.length > 0) {
    fonti.push('Privacy Policy / Chi Siamo')
    for (const p of websitePeople.value) addPerson({ ...p, fonte: 'Sito web (Privacy/Chi siamo)' }, 'Sito web')
  }

  // Google News
  if (newsPeople.status === 'fulfilled' && newsPeople.value.length > 0) {
    fonti.push('Google News')
    for (const p of newsPeople.value) addPerson({ ...p, fonte: 'Google News' }, 'News')
  }

  // Google Visura Camerale
  if (visuraPeople.status === 'fulfilled' && visuraPeople.value.length > 0) {
    if (!fonti.includes('Visura Camerale')) fonti.push('Visura Camerale')
    for (const p of visuraPeople.value) addPerson({ ...p, fonte: 'Visura Camerale' }, 'Visura')
  }

  // Reportaziende.it
  if (reportPeople.status === 'fulfilled' && reportPeople.value.length > 0) {
    fonti.push('Reportaziende.it')
    for (const p of reportPeople.value) addPerson({ ...p, fonte: 'Reportaziende.it' }, 'Reportaziende')
  }

  // Indeed.it / Glassdoor
  if (indeedPeople.status === 'fulfilled' && indeedPeople.value.length > 0) {
    fonti.push('Indeed/Glassdoor')
    for (const p of indeedPeople.value) addPerson({ ...p, fonte: 'Indeed/Glassdoor' }, 'Indeed')
  }

  // Facebook business pages
  if (fbPeople.status === 'fulfilled' && fbPeople.value.length > 0) {
    fonti.push('Facebook')
    for (const p of fbPeople.value) addPerson({ ...p, fonte: 'Facebook' }, 'Facebook')
  }

  // Crunchbase / AngelList / Startup register
  if (crunchPeople.status === 'fulfilled' && crunchPeople.value.length > 0) {
    fonti.push('Crunchbase/Startup')
    for (const p of crunchPeople.value) addPerson({ ...p, fonte: 'Crunchbase' }, 'Crunchbase')
  }

  // Google DEEP search (ultra-aggressive 10 queries)
  if (deepGooglePeople.status === 'fulfilled' && deepGooglePeople.value.length > 0) {
    if (!fonti.includes('Google Search')) fonti.push('Google Search')
    for (const p of deepGooglePeople.value) addPerson({ ...p, fonte: p.fonte || 'Google Search' }, 'Google Deep')
  }

  // Website FULL scraping (all team/staff/about pages + email-to-name)
  if (websiteFullPeople.status === 'fulfilled' && websiteFullPeople.value.length > 0) {
    if (!fonti.includes('Sito web aziendale')) fonti.push('Sito web aziendale')
    for (const p of websiteFullPeople.value) addPerson({ ...p, fonte: 'Sito web (scraping completo)' }, 'Sito web completo')
  }

  // LinkedIn employees via Google
  if (linkedinPeople.status === 'fulfilled' && linkedinPeople.value.length > 0) {
    if (!fonti.includes('LinkedIn')) fonti.push('LinkedIn')
    for (const p of linkedinPeople.value) addPerson({ ...p, fonte: 'LinkedIn' }, 'LinkedIn')
  }

  // Extract name from LinkedIn URL slug if we have it
  if (linkedinPerson) {
    const slug = linkedinPerson.replace(/.*linkedin\.com\/in\//i, '').replace(/\/.*/, '')
    const parts = slug.split('-').filter(p => p.length > 1 && !/^\d+$/.test(p))
    if (parts.length >= 2) {
      const name = parts.slice(0, Math.min(parts.length, 3)).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
      if (isValidPersonName(name)) {
        const key = name.toLowerCase()
        const existing = allPeople.find(ap => ap.nome.toLowerCase() === key)
        if (existing) {
          if (!existing.linkedin) existing.linkedin = linkedinPerson
          if (!nameSourceMap.has(key)) nameSourceMap.set(key, new Set())
          nameSourceMap.get(key)!.add('LinkedIn')
        } else {
          fonti.push('LinkedIn')
          allPeople.push({ nome: name, ruolo: 'Referente (LinkedIn)', fonte: 'LinkedIn', linkedin: linkedinPerson })
          nameSourceMap.set(key, new Set(['LinkedIn']))
        }
      }
    }
  }

  // ── Per-person contact enrichment — DISABLED (uses DDG/Bing which triggers CAPTCHA)
  // TODO: Re-enable when Playwright-based search is available on CKB backend
  // const companyDomain = website ? website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : ''
  // const realNamedPeople = allPeople.filter(p => isValidPersonName(p.nome)).slice(0, 5)

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

  // OpenAPI.it /IT-advanced (FREE!) — shareholders with names, CF, %
  if (openApiResult.status === 'fulfilled' && openApiResult.value.length > 0) {
    fonti.push('Registro Imprese (OpenAPI.it)')
    for (const p of openApiResult.value) {
      const person: { nome: string; ruolo: string; fonte: string; cf?: string; quota?: string } = {
        nome: p.nome, ruolo: p.ruolo, fonte: 'Registro Imprese (Ufficiale)',
      }
      if (p.cf) (person as Record<string, unknown>).cf = p.cf
      if (p.quota) person.quota = p.quota
      addPerson(person, 'OpenAPI.it')
      // Enrich with CF/birth data if legal representative
      if (p.isLegalRep) {
        const existing = allPeople.find(ap => ap.nome.toLowerCase() === p.nome.toLowerCase())
        if (existing) {
          if (p.cf && !existing.cf) existing.cf = p.cf
          if (p.data_nascita && !existing.data_nascita) existing.data_nascita = p.data_nascita
          if (p.sesso && !existing.sesso) existing.sesso = p.sesso
          if (p.eta && !existing.eta) existing.eta = Number(p.eta)
        }
      }
    }
  }

  // ─── Perplexity AI fallback: find real people when all other sources failed ───
  if (allPeople.length === 0) {
    const pplxKey = process.env.PERPLEXITY_API_KEY
    const pplxCompanyName = ragioneSociale || companyName
    if (pplxKey && pplxCompanyName) {
      try {
        const pivaInfo = piva ? ` (P.IVA: ${piva})` : ''
        const pplxPrompt = `Cerca le persone chiave dell'azienda italiana "${pplxCompanyName}"${pivaInfo} con sede a ${city || 'Italia'}.

Trova:
1. Titolare, Amministratore Delegato, Presidente, Legale Rappresentante (NOME E COGNOME reale)
2. Soci principali con percentuale di quota se disponibile
3. Direttori, dirigenti chiave

ISTRUZIONI:
- Cerca SOLO nomi reali di persone fisiche, NON nomi di aziende
- Fonti: Registro Imprese, visure camerali, LinkedIn, siti aziendali, articoli stampa
- Se non trovi un dato, NON inventarlo
- Rispondi SOLO con JSON valido

Formato:
{"persone": [{"nome": "Nome Cognome", "ruolo": "Amministratore Delegato", "cf": null, "quota": "30%"}]}`

        const pplxRes = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${pplxKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'sonar-pro',
            messages: [
              { role: 'system', content: 'Sei un analista aziendale. Rispondi SOLO con JSON valido. Cerca dati reali verificabili.' },
              { role: 'user', content: pplxPrompt },
            ],
            temperature: 0.1,
            max_tokens: 800,
          }),
          signal: AbortSignal.timeout(20000),
        })
        if (pplxRes.ok) {
          const pplxJson = await pplxRes.json()
          const content = pplxJson.choices?.[0]?.message?.content || ''
          const jsonMatch = content.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const aiData = JSON.parse(jsonMatch[0])
            for (const p of (aiData.persone || [])) {
              if (!p.nome || typeof p.nome !== 'string' || p.nome.length < 4) continue
              if (!isValidPersonName(p.nome)) continue
              allPeople.push({
                nome: p.nome,
                ruolo: p.ruolo || 'Dirigente',
                cf: p.cf || undefined,
                quota: p.quota || undefined,
                fonte: 'Perplexity AI (ricerca web)',
              })
            }
            if (allPeople.length > 0) fonti.push('Perplexity AI')
          }
        }
      } catch { /* Perplexity non disponibile */ }
    }
  }

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

  // Build profiles with insurance recommendations + contact data + confidence
  const persone: PersonInsuranceProfile[] = allPeople.slice(0, 15).map(p => {
    const ruoloNorm = normalizeRole(p.ruolo)
    const isGeneric = !isValidPersonName(p.nome) // nome generico (non trovato specifico)
    const key = p.nome.toLowerCase()
    const sources = nameSourceMap.get(key)
    const sourceCount = sources?.size || 1
    // Confidence: 30 base + 15 per additional source, max 100
    const confidenza = isGeneric ? 10 : Math.min(100, 30 + (sourceCount - 1) * 15 + (p.cf ? 20 : 0) + (p.linkedin ? 10 : 0) + (p.email ? 5 : 0))
    return {
      nome: p.nome,
      ruolo: p.quota ? `${p.ruolo} (${p.quota})` : p.ruolo,
      ruolo_normalizzato: ruoloNorm,
      fonte: p.fonte,
      fonti_multiple: sources ? Array.from(sources) : [p.fonte],
      confidenza,
      ...(p.cf ? { codice_fiscale: p.cf } : {}),
      ...(p.data_nascita ? { data_nascita: p.data_nascita } : {}),
      ...(p.sesso ? { sesso: p.sesso } : {}),
      ...(p.eta ? { eta: p.eta } : {}),
      ...(p.email ? { email: p.email } : {}),
      ...(p.telefono ? { telefono: p.telefono } : {}),
      ...(p.linkedin ? { linkedin: p.linkedin } : {}),
      ...(p.foto_url ? { foto_url: p.foto_url } : {}),
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

  // Sort by confidence (highest first) then by role priority
  const rolePriority: Record<string, number> = { titolare: 0, amministratore: 1, dirigente: 2, professionista: 3, socio: 4, dipendente_chiave: 5, altro: 6 }
  persone.sort((a, b) => {
    const confDiff = b.confidenza - a.confidenza
    if (Math.abs(confDiff) > 10) return confDiff
    return (rolePriority[a.ruolo_normalizzato] || 6) - (rolePriority[b.ruolo_normalizzato] || 6)
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
