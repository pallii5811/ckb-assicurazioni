/**
 * IDENTITY GATE — anti-omonimo centralizzato
 *
 * Una sola regola: nessun campo viene scritto sull'oggetto risultato se non
 * è "ancorato" all'identità giusta (azienda o persona).
 *
 * Tre livelli di ancoraggio per AZIENDE, dal più forte al più debole:
 *   1. P.IVA confermata (11 cifre, validata)
 *   2. Dominio del sito ufficiale confermato
 *   3. (token significativi del nome) AND città — solo se entrambi presenti
 *
 * Per le PERSONE: nome+cognome devono ricorrere insieme nello snippet/url
 *                 della fonte E almeno un altro segnale (azienda confermata,
 *                 città, professione richiesta).
 *
 * Il modulo è puro (no I/O) e testabile in isolamento.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  TIPI
// ─────────────────────────────────────────────────────────────────────────────

export type TrustLevel = 'high' | 'medium' | 'low'

export interface CompanyIdentity {
  /** P.IVA confermata (11 cifre, già validata) */
  piva?: string | null
  /** Ragione sociale ufficiale (da fonte camerale) */
  ragione_sociale?: string | null
  /** Forme alternative del nome (es. "Appen.lab" e "AppenLab" e "Appenlab S.r.l.") */
  nome_aliases?: string[]
  /** Città/comune di sede legale, normalizzato lowercase */
  citta?: string | null
  /** Provincia (es. "TO") */
  provincia?: string | null
  /** Dominio del sito ufficiale, normalizzato (es. "appenlab.it") */
  dominio?: string | null
}

export interface PersonIdentity {
  /** Nome di battesimo (può mancare) */
  nome?: string | null
  /** Cognome */
  cognome?: string | null
  /** Nome completo (sostituisce nome+cognome se presente) */
  nome_completo?: string | null
  /** Azienda di riferimento (anchor secondario) */
  azienda?: string | null
  /** Professione richiesta dalla query, se nota (es. "wedding planner") */
  professione?: string | null
  /** Città di riferimento */
  citta?: string | null
}

/**
 * Evidence: il testo grezzo che la fonte ha trovato.
 * Più campi sono compilati, meglio è (ognuno fornisce un check di coerenza).
 */
export interface Evidence {
  /** Nome della fonte, per logging (es. "Maps", "FatturatoItalia", "Tavily") */
  source: string
  /** Livello di fiducia base della fonte (camerale=high, web=medium, gpt=low) */
  trust: TrustLevel
  /** Testo principale della fonte (titolo + contenuto + url, concatenati) */
  text?: string
  /** URL dove il dato è stato trovato */
  url?: string
  /** P.IVA estratta dalla fonte stessa, se presente */
  piva?: string | null
  /** Dominio coinvolto (es. domain dell'email, dell'url, del sito scrapato) */
  domain?: string | null
}

export interface MergeResult {
  /** L'azione effettivamente compiuta */
  action: 'merged' | 'skipped' | 'overwritten'
  /** Spiegazione human-readable */
  reason: string
  /** Punteggio di match calcolato (0-100) */
  score: number
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER PURI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizza un dominio: rimuove protocollo, www., percorso, lowercase.
 * Restituisce stringa vuota se input non è un dominio valido.
 */
export function normalizeDomain(input?: string | null): string {
  if (!input || typeof input !== 'string') return ''
  let s = input.trim().toLowerCase()
  // Estrai dominio da email (info@foo.it -> foo.it)
  if (s.includes('@')) s = s.split('@')[1] || ''
  // Rimuovi protocollo
  s = s.replace(/^https?:\/\//, '').replace(/^\/+/, '')
  // Rimuovi www.
  s = s.replace(/^www\./, '')
  // Tieni solo l'host (prima di / ? #)
  s = s.split('/')[0].split('?')[0].split('#')[0]
  // Filtri: dev'essere un dominio plausibile
  if (!/^[a-z0-9.\-]+\.[a-z]{2,}$/.test(s)) return ''
  // Escludi domini "spazzatura" (portali aggregatori, social, motori)
  const JUNK = new Set([
    'google.com', 'google.it', 'bing.com', 'duckduckgo.com',
    'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
    'youtube.com', 'tiktok.com', 'pinterest.com',
    'companyreports.it', 'fatturatoitalia.it', 'ufficiocamerale.it',
    'reportaziende.it', 'risultati.it', 'cercaziende.it', 'opencorporates.com',
    'paginegialle.it', 'paginebianche.it', 'tuugo.it', 'europages.it',
  ])
  if (JUNK.has(s)) return ''
  return s
}

/**
 * Estrae token "significativi" dal nome di un'azienda:
 * minuscolo, rimuove forme societarie, parole troppo corte, parole comuni.
 */
export function companyTokens(name?: string | null): string[] {
  if (!name || typeof name !== 'string') return []
  const cleaned = name
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc\.?\s*coop|s\.?c\.?a\.?r\.?l\.?|gmbh|ltd|llc|inc|corp)\b\.?/gi, ' ')
    .replace(/[^a-zà-ú0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const STOP = new Set([
    'di', 'da', 'del', 'della', 'dello', 'degli', 'delle', 'in', 'con', 'per',
    'the', 'and', 'group', 'gruppo', 'company', 'azienda', 'societa', 'società',
    'italia', 'italy', 'italian', 'italiana', 'srl', 'srls', 'spa', 'sas', 'snc',
    'com', 'net', 'org', 'web', 'online', 'shop', 'store',
  ])
  return cleaned
    .split(' ')
    .filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t))
}

/** Normalizza una città (lowercase, rimuove accenti basici, trim) */
export function normalizeCity(input?: string | null): string {
  if (!input || typeof input !== 'string') return ''
  return input
    .toLowerCase()
    .replace(/[àáâ]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u')
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Confronta due P.IVA: 11 cifre, identiche */
export function pivaEquals(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  const da = String(a).replace(/\D/g, '')
  const db = String(b).replace(/\D/g, '')
  return da.length === 11 && da === db
}

/** Estrae una P.IVA italiana (11 cifre) da un testo qualunque */
export function extractPiva(text?: string | null): string | null {
  if (!text) return null
  // Cerca sequenze di esattamente 11 cifre, non parte di numeri più lunghi
  const m = text.match(/(?<![\d])(\d{11})(?![\d])/)
  return m ? m[1] : null
}

// ─────────────────────────────────────────────────────────────────────────────
//  IDENTITY MATCHER per AZIENDE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcola un punteggio di match (0-100) tra una candidate Evidence e l'identità
 * azienda nota. Restituisce anche la motivazione.
 *
 *   100  = match certo (P.IVA identica)
 *   85   = match forte (dominio confermato O ragione sociale completa nel testo)
 *   60-80 = match probabile (almeno 2 token + città)
 *   40   = match debole (1 token + città)
 *   <30  = no match
 */
export function scoreCompanyMatch(
  identity: CompanyIdentity,
  ev: Evidence,
): { score: number; reason: string } {
  // 1. P.IVA — il check più forte
  if (identity.piva && ev.piva && pivaEquals(identity.piva, ev.piva)) {
    return { score: 100, reason: 'P.IVA identica' }
  }
  // P.IVA estratta dal testo della fonte
  if (identity.piva && ev.text) {
    const found = extractPiva(ev.text)
    if (found && pivaEquals(identity.piva, found)) {
      return { score: 100, reason: 'P.IVA trovata nel testo della fonte' }
    }
  }
  // Se l'identità ha P.IVA ma la fonte ne dichiara un'altra: REJECT immediato
  if (identity.piva && ev.piva && !pivaEquals(identity.piva, ev.piva)) {
    return { score: 0, reason: `P.IVA fonte (${ev.piva}) diversa dall'identità (${identity.piva})` }
  }

  const text = (ev.text || '').toLowerCase()
  const url = (ev.url || '').toLowerCase()
  const haystack = `${text} ${url}`

  // 2. Dominio — match forte se sito ufficiale combacia
  if (identity.dominio && ev.domain) {
    const idDom = normalizeDomain(identity.dominio)
    const evDom = normalizeDomain(ev.domain)
    if (idDom && evDom && (idDom === evDom || evDom.endsWith('.' + idDom) || idDom.endsWith('.' + evDom))) {
      return { score: 85, reason: `dominio ${evDom} combacia con sito ufficiale ${idDom}` }
    }
  }
  if (identity.dominio && haystack) {
    const idDom = normalizeDomain(identity.dominio)
    if (idDom && haystack.includes(idDom)) {
      return { score: 85, reason: `dominio ufficiale ${idDom} citato nella fonte` }
    }
  }

  // 3. Ragione sociale + città
  const tokens: string[] = []
  if (identity.ragione_sociale) tokens.push(...companyTokens(identity.ragione_sociale))
  for (const alias of identity.nome_aliases || []) tokens.push(...companyTokens(alias))
  const uniqTokens = Array.from(new Set(tokens))

  if (uniqTokens.length === 0) {
    // Senza ancore non possiamo validare niente: trust della fonte come fallback.
    return ev.trust === 'high'
      ? { score: 50, reason: 'fonte high-trust senza ancore disponibili' }
      : { score: 20, reason: 'nessuna ancora di identità disponibile' }
  }

  // Word-boundary match: "almax" NON deve matchare "almaxitalia"
  const wordBoundary = (token: string) => new RegExp(`(?:^|[^a-zà-ú0-9])${token}(?:[^a-zà-ú0-9]|$)`, 'i')
  const matched = uniqTokens.filter(t => wordBoundary(t).test(haystack))
  const matchedRatio = matched.length / uniqTokens.length

  // Città — anche qui word-boundary per evitare "milano" dentro "milanofiori"
  const idCity = normalizeCity(identity.citta)
  const cityHit = idCity ? wordBoundary(idCity).test(haystack) : false

  if (matchedRatio === 1) {
    return cityHit
      ? { score: 90, reason: `tutti i token (${matched.join(',')}) + città "${idCity}" trovati` }
      : { score: 70, reason: `tutti i token (${matched.join(',')}) trovati ma città non confermata` }
  }
  if (matched.length >= 2 && cityHit) {
    return { score: 75, reason: `${matched.length}/${uniqTokens.length} token + città confermata` }
  }
  if (matched.length >= 2) {
    return { score: 55, reason: `${matched.length}/${uniqTokens.length} token, città mancante` }
  }
  if (matched.length === 1 && cityHit) {
    return { score: 45, reason: `1 token + città — match debole` }
  }
  return { score: 15, reason: `solo ${matched.length}/${uniqTokens.length} token, no città` }
}

/**
 * Soglia di accettazione per ciascun livello di trust.
 * Una fonte "low" deve dimostrare di più per essere accettata.
 */
const COMPANY_THRESHOLD: Record<TrustLevel, number> = {
  high: 50,
  medium: 65,
  low: 80,
}

export function isCompanyMatch(
  identity: CompanyIdentity,
  ev: Evidence,
  /** Soglia custom (override). Default = COMPANY_THRESHOLD per il trust della fonte. */
  threshold?: number,
): MergeResult {
  const { score, reason } = scoreCompanyMatch(identity, ev)
  const t = threshold ?? COMPANY_THRESHOLD[ev.trust]
  if (score >= t) return { action: 'merged', reason: `[${ev.source}] OK (${score}≥${t}): ${reason}`, score }
  return { action: 'skipped', reason: `[${ev.source}] BLOCK (${score}<${t}): ${reason}`, score }
}

// ─────────────────────────────────────────────────────────────────────────────
//  IDENTITY MATCHER per PERSONE
// ─────────────────────────────────────────────────────────────────────────────

/** Token significativi di un nome di persona (rimuove particelle "de","di","la"... e titoli professionali) */
export function personTokens(name?: string | null): string[] {
  if (!name || typeof name !== 'string') return []
  // Stop words: particelle nobiliari/di legame + titoli professionali italiani e inglesi.
  // I punti vengono rimossi dal regex sottostante: "Dott." → "dott", "Sig.ra" → "sigra",
  // "Dott.ssa" → "dottssa", "Prof.ssa" → "profssa".
  const STOP = new Set([
    // particelle italiane
    'de', 'di', 'da', 'del', 'della', 'dei', 'delle', 'dello', 'degli',
    'la', 'le', 'lo', 'il', 'i', 'gli',
    // titoli professionali italiani (forme abbreviate normalizzate)
    // NOTA: il regex sostituisce i punti con spazi, quindi "Dott.ssa" diventa
    // "dott ssa" (due token), "Sig.ra" → "sig ra", "Prof.ssa" → "prof ssa".
    // Per questo aggiungiamo anche i suffissi residui ('ssa', 'ra', 'na').
    'avv', 'avvto',
    'dott', 'dr', 'dssa', 'dottssa', 'ssa',
    'ing',
    'arch',
    'geom',
    'prof', 'profssa',
    'sig', 'sigra', 'signa', 'sigr', 'ra', 'na',
    'rag',
    'comm', 'cav', 'mons', 'don', 'rev',
    // titoli inglesi
    'mr', 'mrs', 'ms',
  ])
  return name
    .toLowerCase()
    .replace(/[^a-zà-ú\s'-]/gi, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP.has(t))
}

/**
 * Calcola match persona. Una persona è "confermata" se:
 *   - tutti i token del nome compaiono nello snippet (>=2 token, es. "marco rossi")
 *   - E almeno uno tra: azienda, città, professione richiesta
 */
export function scorePersonMatch(
  identity: PersonIdentity,
  ev: Evidence,
): { score: number; reason: string } {
  const fullName = identity.nome_completo || [identity.nome, identity.cognome].filter(Boolean).join(' ')
  const nameTokens = personTokens(fullName)

  if (nameTokens.length < 2) {
    return { score: 0, reason: 'identità persona senza nome+cognome — impossibile validare' }
  }

  const text = `${ev.text || ''} ${ev.url || ''}`.toLowerCase()
  if (!text) return { score: 0, reason: 'evidenza senza testo' }

  // Word-boundary: "rossi" non deve matchare "rossini"
  const wb = (token: string) => new RegExp(`(?:^|[^a-zà-ú0-9])${token}(?:[^a-zà-ú0-9]|$)`, 'i')
  const matchedNameTokens = nameTokens.filter(t => wb(t).test(text))
  const allNamePresent = matchedNameTokens.length === nameTokens.length

  if (!allNamePresent) {
    return { score: 10, reason: `nome non completo nella fonte (${matchedNameTokens.length}/${nameTokens.length})` }
  }

  // Anchor secondari (anche qui word-boundary)
  const aziendaTokens = identity.azienda ? companyTokens(identity.azienda) : []
  const aziendaHit = aziendaTokens.length > 0 && aziendaTokens.some(t => wb(t).test(text))
  const cityHit = identity.citta ? wb(normalizeCity(identity.citta)).test(text) : false
  const profStem = identity.professione ? identity.professione.toLowerCase().slice(0, 5) : ''
  const profHit = profStem ? text.includes(profStem) : false

  const anchors = [aziendaHit, cityHit, profHit].filter(Boolean).length

  if (anchors >= 2) return { score: 95, reason: `nome completo + ${anchors} anchor (azienda/città/professione)` }
  if (anchors === 1) return { score: 75, reason: `nome completo + 1 anchor` }
  // Solo nome senza ancore: rischio omonimo elevato
  return { score: 35, reason: 'nome completo ma nessun anchor (azienda/città/professione)' }
}

const PERSON_THRESHOLD: Record<TrustLevel, number> = {
  high: 60,
  medium: 70,
  low: 80,
}

export function isPersonMatch(
  identity: PersonIdentity,
  ev: Evidence,
  threshold?: number,
): MergeResult {
  const { score, reason } = scorePersonMatch(identity, ev)
  const t = threshold ?? PERSON_THRESHOLD[ev.trust]
  if (score >= t) return { action: 'merged', reason: `[${ev.source}] OK (${score}≥${t}): ${reason}`, score }
  return { action: 'skipped', reason: `[${ev.source}] BLOCK (${score}<${t}): ${reason}`, score }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SAFE MERGE — entry point unificato
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tenta di scrivere `patch` su `target`. Per ogni chiave:
 *  - se il valore è "junk" (vuoto, null, placeholder), salta
 *  - se la chiave è in `authoritativeKeys`, sovrascrive sempre (camerale > tutto)
 *  - se target ha già un valore "non vuoto", salta (no overwrite)
 *  - altrimenti scrive
 *
 * Ritorna la lista di chiavi effettivamente scritte.
 */
export function applyPatch<T extends Record<string, any>>(
  target: T,
  patch: Record<string, any>,
  options?: {
    authoritativeKeys?: Set<string>
    /** chiavi da non scrivere mai */
    blockKeys?: Set<string>
  },
): string[] {
  const written: string[] = []
  const auth = options?.authoritativeKeys ?? new Set<string>()
  const block = options?.blockKeys ?? new Set<string>()
  for (const [k, v] of Object.entries(patch)) {
    if (block.has(k)) continue
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase()
      if (!s) continue
      if (['null', 'undefined', 'n/a', 'nd', 'n.d.', 'n/d', 'none', 'non disponibile', 'non specificato', 'nessuno'].includes(s)) continue
    }
    if (auth.has(k)) {
      ;(target as any)[k] = v
      written.push(k)
      continue
    }
    const cur = (target as any)[k]
    if (cur === undefined || cur === null || cur === '') {
      ;(target as any)[k] = v
      written.push(k)
    }
  }
  return written
}

/**
 * Tenta di mergiare un patch identificato da una Evidence solo se passa il gate.
 * È il modo standard con cui i flussi devono scrivere dati derivati da fonti esterne.
 */
export function safeMergeCompany<T extends Record<string, any>>(
  target: T,
  identity: CompanyIdentity,
  ev: Evidence,
  patch: Record<string, any>,
  options?: { authoritativeKeys?: Set<string>; blockKeys?: Set<string>; threshold?: number; logger?: (msg: string) => void },
): { result: MergeResult; written: string[] } {
  const result = isCompanyMatch(identity, ev, options?.threshold)
  if (options?.logger) options.logger(result.reason)
  if (result.action === 'skipped') return { result, written: [] }
  const written = applyPatch(target, patch, { authoritativeKeys: options?.authoritativeKeys, blockKeys: options?.blockKeys })
  return { result, written }
}

export function safeMergePerson<T extends Record<string, any>>(
  target: T,
  identity: PersonIdentity,
  ev: Evidence,
  patch: Record<string, any>,
  options?: { authoritativeKeys?: Set<string>; blockKeys?: Set<string>; threshold?: number; logger?: (msg: string) => void },
): { result: MergeResult; written: string[] } {
  const result = isPersonMatch(identity, ev, options?.threshold)
  if (options?.logger) options.logger(result.reason)
  if (result.action === 'skipped') return { result, written: [] }
  const written = applyPatch(target, patch, { authoritativeKeys: options?.authoritativeKeys, blockKeys: options?.blockKeys })
  return { result, written }
}
