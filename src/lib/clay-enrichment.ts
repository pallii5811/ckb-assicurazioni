/**
 * Clay-style Lead Enrichment Orchestrator
 * Combines ALL available free + paid sources for maximum data coverage:
 *
 * FREE SOURCES:
 * 1. Website deep scraping (all pages: emails, phones, team, social links, P.IVA)
 * 2. Google search (LinkedIn profiles, social accounts, public info)
 * 3. INIPEC (PEC email)
 * 4. VIES (P.IVA verification)
 * 5. CompanyReports.it (fatturato, dipendenti, ATECO, forma giuridica)
 *
 * PAID SOURCES (optional):
 * 6. Apollo.io (person data, seniority, employment history)
 * 7. Snov.io (emails, phones)
 * 8. Hunter.io (email verification)
 * 9. OpenAPI.it (Camera di Commercio data)
 */

import { scrapeWebsiteDeep, type WebsiteScrapedData } from './website-deep-scraper'
import { enrichFromPublicSources, type PublicEnrichmentData } from './public-enrichment'
import { apolloEnrichPerson, apolloEnrichCompany, type ApolloPerson } from './apollo-enrichment'
import { snovDomainSearch, snovVerifyEmail, type SnovPerson } from './snov-enrichment'

// ── Types ────────────────────────────────────────────────────────
export interface ClayEnrichedLead {
  // Original Maps data
  companyName: string
  category: string
  city: string
  website: string
  mapsPhone: string
  mapsEmail: string
  mapsAddress: string

  // ── ENRICHED DATA ──

  // Person (owner/contact)
  personName: string | null
  personRole: string | null
  personSeniority: string | null
  personLinkedin: string | null
  personPhoto: string | null

  // Contact (all channels)
  allEmails: { email: string; type: string; source: string; verified?: boolean }[]
  allPhones: { number: string; type: string; source: string }[]
  pecEmail: string | null
  bestEmail: string | null          // top priority email for outreach
  bestPhone: string | null          // top priority phone for outreach
  mobilePhone: string | null

  // Social
  linkedinCompany: string | null
  linkedinPerson: string | null
  facebook: string | null
  instagram: string | null
  instagramHandle: string | null
  tiktok: string | null
  youtube: string | null
  twitter: string | null

  // Company
  partitaIva: string | null
  pivaVerified: boolean
  ragineSociale: string | null
  formaGiuridica: string | null
  codiceAteco: string | null
  descrizioneAteco: string | null
  fatturato: string | null
  fatturatoAnno: string | null
  dipendenti: string | null
  capitaleSociale: string | null
  dataCostutuzione: string | null
  sedeLegale: string | null

  // Team
  teamMembers: { name: string; role: string | null }[]

  // Employment type (inferred)
  employmentType: string | null     // Imprenditore / P.IVA / Dipendente
  companySize: string | null

  // Triggers
  triggers: string[]

  // Potential
  estimatedPotential: string | null

  // Employment history
  employmentHistory: { title: string; company: string; current: boolean; startDate: string | null }[]

  // Meta
  enrichmentSources: string[]
  enrichmentQuality: number         // 0-100
  enrichedAt: string
  pagesScraped: number
}

// ── Phone validation (shared across all sources) ────────────────
function isValidPhone(num: string): boolean {
  if (!num) return false
  const raw = num.replace(/[\s.\-()]/g, '')
  // Must look Italian: +39, 0039, 0xx, 3xx
  if (!/^(\+39|0039|0[1-9]|3[0-9])/.test(raw)) {
    const digits = raw.replace(/\D/g, '')
    if (!/^(39|0039|0[1-9]|3[0-9])/.test(digits)) return false
  }
  // Min 9 digits
  const digits = num.replace(/\D/g, '').replace(/^(39|0039)/, '')
  if (digits.length < 9 || digits.length > 12) return false
  // No repeating digits (>70% same digit = fake)
  for (let d = 0; d <= 9; d++) {
    const count = (digits.match(new RegExp(String(d), 'g')) || []).length
    if (count / digits.length > 0.7) return false
  }
  return true
}

// ── Extract person name from company name (ditte individuali) ───
// Patterns: "Idraulico Emanuele Orto", "Elettricista Mario Rossi", "Studio Legale Avv. Bianchi Luca"
// Also: "di Rossi Marco", "di Marco Rossi", "Rossi Marco"
function extractPersonFromCompanyName(companyName: string): { name: string; role: string | null } | null {
  if (!companyName) return null
  const cn = companyName.trim()

  // Common profession/activity prefixes to strip
  const PROFESSION_RE = /^(?:idraulico|elettricista|fabbro|falegname|meccanico|muratore|pittore|giardiniere|artigian[oa]|impresa|ditta|studio|laboratorio|officina|bottega|carrozzeria|autofficina|panificio|pasticceria|pizzeria|trattoria|ristorante|bar|tabacchi|edicola|ferramenta|cartoleria|merceria|sartoria|lavanderia|parrucchier[ea]|barbiere|estetista|dentista|odontoiatra|fisioterapista|osteopata|veterinari[oa]|farmacia|ottica|fotografo|tipografia|vetraio|marmista|tappezziere|tinteggiatore|imbianchino|piastrellista|serramentista|termoidraulic[oa]|edil[ei]?|calzolai[oa]|orologiai[oa]|gioielleri[ea]|fiorista|vivaista|agriturismo|b&b|albergo|hotel|pensione|gelateria|rosticceria|gastronomia|macelleria|pescheria|fruttivendol[oa]|alimentari|minimarket|supermercato|tabaccheria|ricevitoria|agenzia|consulen(?:te|za)|avvocat[oa]|notai[oa]|commercialista|geometra|architett[oa]|ingegner[ei]|perit[oa]|ragionier[ei])[\s.]*/i
  
  // Pattern 1: "Professione Nome Cognome" — e.g. "Idraulico Emanuele Orto"
  const withProfession = cn.match(new RegExp(PROFESSION_RE.source + '([A-ZÀ-Ú][a-zà-ú]+(?:\\s+[A-ZÀ-Ú][a-zà-ú]+)+)\\s*$', 'i'))
  if (withProfession) {
    const namePart = withProfession[1].trim()
    const words = namePart.split(/\s+/)
    if (words.length >= 2 && words.length <= 4) {
      const profession = cn.slice(0, cn.indexOf(namePart)).trim().replace(/[\s.]+$/, '')
      return { name: namePart, role: profession ? `Titolare (${profession})` : 'Titolare' }
    }
  }

  // Pattern 2: "... di Nome Cognome" or "... di Cognome Nome"
  const diPattern = cn.match(/\bdi\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)+)\s*$/i)
  if (diPattern) {
    const namePart = diPattern[1].trim()
    const words = namePart.split(/\s+/)
    if (words.length >= 2 && words.length <= 4) {
      return { name: namePart, role: 'Titolare' }
    }
  }

  // Pattern 3: Company name IS just "Nome Cognome" (2-3 capitalized words, no business terms)
  const BUSINESS_TERMS = /\b(srl|srls|spa|sas|snc|soc|coop|group|holding|italia|service|system|tech|lab|center|point|world|shop|store|market|express|plus|pro|top|best|new|old|casa|auto|moto|cicl[oi])\b/i
  if (!BUSINESS_TERMS.test(cn)) {
    const words = cn.split(/\s+/)
    if (words.length >= 2 && words.length <= 3 && words.every(w => /^[A-ZÀ-Ú][a-zà-ú]+$/.test(w))) {
      return { name: cn, role: 'Titolare' }
    }
  }

  return null
}

// ── Infer employment type ───────────────────────────────────────
function inferEmploymentType(
  title: string | null,
  seniority: string | null,
  formaGiuridica: string | null
): string | null {
  // From forma giuridica
  if (formaGiuridica) {
    const fg = formaGiuridica.toUpperCase()
    if (['SRL', 'SRLS', 'SPA', 'SAS', 'SNC'].some(f => fg.includes(f))) return 'Imprenditore'
    if (fg.includes('DITTA INDIVIDUALE')) return 'Libero Professionista / P.IVA'
    if (fg.includes('STUDIO') || fg.includes('ASSOCIAZIONE')) return 'Libero Professionista / P.IVA'
  }

  // From title
  if (title) {
    const t = title.toLowerCase()
    if (/owner|founder|titolare|proprietario|ceo|imprenditore|co-founder|socio/.test(t)) return 'Imprenditore'
    if (/libero professionista|freelance|consulente|avvocato|commercialista|architetto|ingegnere|medico|notaio|dentista/.test(t)) return 'Libero Professionista / P.IVA'
    if (/director|direttore|manager|responsabile/.test(t)) return 'Dirigente / Manager'
  }

  // From seniority
  if (seniority) {
    const s = seniority.toLowerCase()
    if (s === 'owner' || s === 'founder') return 'Imprenditore'
    if (s === 'c_suite' || s === 'vp') return 'Dirigente / Manager'
  }

  return null
}

// ── Detect triggers ─────────────────────────────────────────────
function detectTriggers(lead: ClayEnrichedLead): string[] {
  const triggers: string[] = []

  // Owner/founder = business insurance need
  if (lead.employmentType === 'Imprenditore') {
    triggers.push('Titolare/Fondatore - protezione patrimonio')
  }
  if (lead.employmentType === 'Libero Professionista / P.IVA') {
    triggers.push('Professionista - RC Professionale')
  }

  // Company size
  const dip = parseInt(lead.dipendenti || '0')
  if (dip > 5) triggers.push(`${dip} dipendenti - D&O / Welfare aziendale`)
  if (dip > 20) triggers.push('Azienda strutturata - Polizza collettiva')

  // Recent company
  if (lead.dataCostutuzione) {
    const year = parseInt(lead.dataCostutuzione.slice(0, 4))
    if (year && new Date().getFullYear() - year <= 2) {
      triggers.push('Azienda recente - necessità coperture base')
    }
  }

  // Job change
  if (lead.employmentHistory?.length >= 2) {
    const current = lead.employmentHistory.find(e => e.current)
    if (current?.startDate) {
      const startYear = parseInt(current.startDate.split('-')[0])
      if (startYear && new Date().getFullYear() - startYear <= 1) {
        triggers.push('Cambio lavoro recente')
      }
    }
  }

  // Revenue-based
  if (lead.fatturato) {
    const numStr = lead.fatturato.replace(/[^\d]/g, '')
    const num = parseInt(numStr)
    if (num > 1000000) triggers.push('Fatturato > 1M€ - Key Man Insurance')
    if (num > 5000000) triggers.push('Fatturato > 5M€ - D&O / Cyber Insurance')
  }

  // Sector-based triggers
  const cat = (lead.category || '').toLowerCase()
  if (/ristorante|bar|hotel|albergo|b&b/.test(cat)) triggers.push('HoReCa - RC Verso Terzi')
  if (/medico|dentista|farmacia|clinica|ospedale/.test(cat)) triggers.push('Sanitario - RC Professionale')
  if (/avvocato|legale|studio|commercialista|notaio/.test(cat)) triggers.push('Studio professionale - RC Professionale')
  if (/edil|costruzi|impresa|cantiere/.test(cat)) triggers.push('Edilizia - CAR / Decennale Postuma')
  if (/trasport|logistic|spedizi/.test(cat)) triggers.push('Trasporti - CMR / RCA Flotta')
  if (/tech|software|digital|web|informatica/.test(cat)) triggers.push('Tech - Cyber Insurance')

  return [...new Set(triggers)] // deduplicate
}

// ── Estimate potential ──────────────────────────────────────────
function estimatePotential(lead: ClayEnrichedLead): string | null {
  const dip = parseInt(lead.dipendenti || '0')
  const isOwner = lead.employmentType === 'Imprenditore'
  const isPro = lead.employmentType === 'Libero Professionista / P.IVA'

  if (lead.fatturato) {
    const numStr = lead.fatturato.replace(/[^\d]/g, '')
    const num = parseInt(numStr)
    if (num > 10000000) return '20.000 - 50.000 €/anno'
    if (num > 5000000) return '10.000 - 25.000 €/anno'
    if (num > 1000000) return '5.000 - 15.000 €/anno'
    if (num > 500000) return '2.500 - 8.000 €/anno'
  }

  if (isOwner && dip > 20) return '5.000 - 15.000 €/anno'
  if (isOwner && dip > 5) return '2.500 - 8.000 €/anno'
  if (isOwner) return '1.500 - 4.000 €/anno'
  if (isPro) return '1.000 - 3.000 €/anno'
  if (dip > 50) return '10.000+ €/anno'

  return '500 - 2.000 €/anno'
}

// ── Calculate enrichment quality ────────────────────────────────
function calcEnrichmentQuality(lead: ClayEnrichedLead): number {
  let score = 0
  if (lead.personName) score += 10
  if (lead.personRole) score += 5
  if (lead.bestEmail) score += 15
  if (lead.pecEmail) score += 10
  if (lead.mobilePhone) score += 15
  if (lead.bestPhone) score += 5
  if (lead.linkedinPerson) score += 10
  if (lead.linkedinCompany) score += 5
  if (lead.partitaIva) score += 5
  if (lead.pivaVerified) score += 5
  if (lead.fatturato) score += 5
  if (lead.dipendenti) score += 3
  if (lead.formaGiuridica) score += 2
  if (lead.employmentType) score += 3
  if (lead.triggers.length > 0) score += 2
  return Math.min(score, 100)
}

// ── MAIN: Enrich a lead from all sources ────────────────────────
export async function clayEnrichLead(mapsLead: {
  nome: string
  categoria?: string
  citta?: string
  sito?: string
  telefono?: string
  email?: string
  indirizzo?: string
}): Promise<ClayEnrichedLead> {
  const companyName = mapsLead.nome || ''
  const website = mapsLead.sito || ''
  const city = mapsLead.citta || ''

  // Initialize with Maps data
  const lead: ClayEnrichedLead = {
    companyName,
    category: mapsLead.categoria || '',
    city,
    website,
    mapsPhone: mapsLead.telefono || '',
    mapsEmail: mapsLead.email || '',
    mapsAddress: mapsLead.indirizzo || '',
    personName: null,
    personRole: null,
    personSeniority: null,
    personLinkedin: null,
    personPhoto: null,
    allEmails: [],
    allPhones: [],
    pecEmail: null,
    bestEmail: null,
    bestPhone: null,
    mobilePhone: null,
    linkedinCompany: null,
    linkedinPerson: null,
    facebook: null,
    instagram: null,
    instagramHandle: null,
    tiktok: null,
    youtube: null,
    twitter: null,
    partitaIva: null,
    pivaVerified: false,
    ragineSociale: null,
    formaGiuridica: null,
    codiceAteco: null,
    descrizioneAteco: null,
    fatturato: null,
    fatturatoAnno: null,
    dipendenti: null,
    capitaleSociale: null,
    dataCostutuzione: null,
    sedeLegale: null,
    teamMembers: [],
    employmentType: null,
    companySize: null,
    triggers: [],
    estimatedPotential: null,
    employmentHistory: [],
    enrichmentSources: ['google_maps'],
    enrichmentQuality: 0,
    enrichedAt: new Date().toISOString(),
    pagesScraped: 0,
  }

  // Add Maps data to allEmails/allPhones
  if (mapsLead.email && mapsLead.email.includes('@')) {
    lead.allEmails.push({ email: mapsLead.email, type: 'generic', source: 'google_maps' })
  }
  if (mapsLead.telefono) {
    lead.allPhones.push({ number: mapsLead.telefono, type: 'landline', source: 'google_maps' })
  }

  // ── Try to extract person name from company name (ditte individuali) ──
  const extractedPerson = extractPersonFromCompanyName(companyName)
  if (extractedPerson) {
    lead.personName = extractedPerson.name
    lead.personRole = extractedPerson.role
  }

  // ── Run all free sources in parallel ──────────────────────────
  const hasApollo = !!process.env.APOLLO_API_KEY
  const hasSnov = !!(process.env.SNOV_CLIENT_ID && process.env.SNOV_CLIENT_SECRET)

  const domain = website
    ? website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()
    : ''

  const [websiteData, publicData, registryData, apolloCompanyData, snovData] = await Promise.allSettled([
    // 1. Deep website scraping
    website ? scrapeWebsiteDeep(website) : Promise.resolve(null),

    // 2. Public sources (Google search for LinkedIn, social, INIPEC)
    // Pass extracted person name so LinkedIn person search works
    enrichFromPublicSources({ companyName, city, website, ownerName: extractedPerson?.name }),

    // 3. Registry data (existing lead-registry route - call internally)
    fetchRegistryInternal(mapsLead),

    // 4. Apollo company enrichment (optional, paid)
    hasApollo && domain ? apolloEnrichCompany(domain) : Promise.resolve(null),

    // 5. Snov.io domain search (optional, paid)
    hasSnov && domain ? snovDomainSearch(domain) : Promise.resolve([]),
  ])

  // ── Merge website scraping data ───────────────────────────────
  if (websiteData.status === 'fulfilled' && websiteData.value) {
    const wd = websiteData.value as WebsiteScrapedData
    lead.pagesScraped = wd.pagesScraped
    lead.enrichmentSources.push('website_scraping')

    // Emails
    for (const e of wd.emails) {
      if (!lead.allEmails.find(x => x.email === e.email)) {
        lead.allEmails.push({ email: e.email, type: e.type, source: `website:${e.page}` })
      }
    }

    // Phones
    for (const p of wd.phones) {
      const digits = p.number.replace(/\D/g, '').slice(-9)
      if (!lead.allPhones.find(x => x.number.replace(/\D/g, '').slice(-9) === digits)) {
        lead.allPhones.push({ number: p.number, type: p.type, source: `website:${p.page}` })
      }
    }

    // Social links from website
    if (wd.socialLinks.linkedin) lead.linkedinCompany = wd.socialLinks.linkedin
    if (wd.socialLinks.linkedinPersonal.length > 0) lead.linkedinPerson = wd.socialLinks.linkedinPersonal[0]
    if (wd.socialLinks.facebook) lead.facebook = wd.socialLinks.facebook
    if (wd.socialLinks.instagram) lead.instagram = wd.socialLinks.instagram
    if (wd.socialLinks.tiktok) lead.tiktok = wd.socialLinks.tiktok
    if (wd.socialLinks.youtube) lead.youtube = wd.socialLinks.youtube
    if (wd.socialLinks.twitter) lead.twitter = wd.socialLinks.twitter

    // Team members
    if (wd.teamMembers.length > 0) {
      lead.teamMembers = wd.teamMembers
      // First team member is likely the owner/main person — but validate the name first
      if (!lead.personName) {
        const candidate = wd.teamMembers[0].name
        // Must look like a real person name: 2+ words, letters only, no common section titles
        const words = candidate?.trim().split(/\s+/).filter((w: string) => w.length > 1) || []
        const looksLikeName = candidate
          && words.length >= 2
          && words.length <= 5
          && words.every((w: string) => /^[A-ZÀ-Ú]/.test(w))
          && /^[A-Za-zÀ-ú\s'.-]+$/.test(candidate)
          && !/\b(dicono|siamo|nostri|scopri|contatt|serviz|cookie|privacy|scrivi|leggi|prenota|lavora|funziona|offriamo|facciamo)\b/i.test(candidate)
        if (looksLikeName) {
          lead.personName = candidate
          lead.personRole = wd.teamMembers[0].role
        }
      }
    }

    // P.IVA from website
    if (wd.partitaIva) lead.partitaIva = wd.partitaIva
    if (wd.address && !lead.sedeLegale) lead.sedeLegale = wd.address
  }

  // ── Merge public sources (Google, LinkedIn, INIPEC) ───────────
  if (publicData.status === 'fulfilled') {
    const pd = publicData.value as PublicEnrichmentData
    lead.enrichmentSources.push(...pd.sources.filter(s => !lead.enrichmentSources.includes(s)))

    if (!lead.linkedinCompany && pd.linkedinCompanyUrl) lead.linkedinCompany = pd.linkedinCompanyUrl
    if (!lead.linkedinPerson && pd.linkedinPersonUrl) {
      lead.linkedinPerson = pd.linkedinPersonUrl
      if (pd.linkedinPersonName && !lead.personName) lead.personName = pd.linkedinPersonName
      if (pd.linkedinPersonTitle && !lead.personRole) lead.personRole = pd.linkedinPersonTitle
    }
    if (!lead.facebook && pd.facebookUrl) lead.facebook = pd.facebookUrl
    if (!lead.instagram && pd.instagramUrl) {
      lead.instagram = pd.instagramUrl
      lead.instagramHandle = pd.instagramHandle
    }
    if (!lead.tiktok && pd.tiktokUrl) lead.tiktok = pd.tiktokUrl
    if (!lead.pecEmail && pd.pecEmail) {
      lead.pecEmail = pd.pecEmail
      lead.allEmails.push({ email: pd.pecEmail, type: 'pec', source: 'inipec' })
    }
  }

  // ── Merge registry data ───────────────────────────────────────
  if (registryData.status === 'fulfilled' && registryData.value) {
    const rd = registryData.value
    lead.enrichmentSources.push('registro_imprese')

    if (rd.partita_iva && !lead.partitaIva) lead.partitaIva = rd.partita_iva
    if (rd.piva_verificata) lead.pivaVerified = true
    if (rd.ragione_sociale) lead.ragineSociale = rd.ragione_sociale
    if (rd.forma_giuridica) lead.formaGiuridica = rd.forma_giuridica
    if (rd.codice_ateco) lead.codiceAteco = rd.codice_ateco
    if (rd.descrizione_ateco) lead.descrizioneAteco = rd.descrizione_ateco
    if (rd.fatturato) { lead.fatturato = rd.fatturato; lead.fatturatoAnno = rd.fatturato_anno || null }
    if (rd.dipendenti) lead.dipendenti = rd.dipendenti
    if (rd.capitale_sociale) lead.capitaleSociale = rd.capitale_sociale
    if (rd.data_costituzione) lead.dataCostutuzione = rd.data_costituzione
    if (rd.sede_legale) lead.sedeLegale = rd.sede_legale
    if (rd.pec && !lead.pecEmail) {
      lead.pecEmail = rd.pec
      if (!lead.allEmails.find(e => e.email === rd.pec)) {
        lead.allEmails.push({ email: rd.pec, type: 'pec', source: 'registro_imprese' })
      }
    }
  }

  // ── Merge Apollo data (paid, optional) ────────────────────────
  if (apolloCompanyData.status === 'fulfilled' && apolloCompanyData.value) {
    const ac = apolloCompanyData.value
    lead.enrichmentSources.push('apollo')
    if (ac.industry && !lead.descrizioneAteco) lead.descrizioneAteco = ac.industry
    if (ac.employees) lead.companySize = String(ac.employees)
    if (!lead.dipendenti && ac.employees) lead.dipendenti = String(ac.employees)
    if (ac.linkedin && !lead.linkedinCompany) lead.linkedinCompany = ac.linkedin
    if (ac.founded && !lead.dataCostutuzione) lead.dataCostutuzione = String(ac.founded)
  }

  // If we have Apollo API key and a person name, try to enrich the person
  if (hasApollo && lead.personName && domain) {
    try {
      const nameParts = lead.personName.split(' ')
      const firstName = nameParts[0]
      const lastName = nameParts.slice(1).join(' ')
      const apolloPerson = await apolloEnrichPerson({
        firstName,
        lastName,
        companyDomain: domain,
      })
      if (apolloPerson) {
        if (apolloPerson.title && !lead.personRole) lead.personRole = apolloPerson.title
        if (apolloPerson.seniority) lead.personSeniority = apolloPerson.seniority
        if (apolloPerson.linkedin && !lead.linkedinPerson) lead.linkedinPerson = apolloPerson.linkedin
        if (apolloPerson.photoUrl) lead.personPhoto = apolloPerson.photoUrl
        if (apolloPerson.email) {
          if (!lead.allEmails.find(e => e.email === apolloPerson.email)) {
            lead.allEmails.push({
              email: apolloPerson.email!,
              type: 'personal',
              source: 'apollo',
              verified: apolloPerson.emailVerified,
            })
          }
        }
        if (apolloPerson.mobilePhone && isValidPhone(apolloPerson.mobilePhone)) {
          lead.mobilePhone = apolloPerson.mobilePhone
          lead.allPhones.push({ number: apolloPerson.mobilePhone, type: 'mobile', source: 'apollo' })
        }
        if (apolloPerson.phone && isValidPhone(apolloPerson.phone)) {
          if (!lead.allPhones.find(p => p.number.replace(/\D/g, '').slice(-9) === apolloPerson.phone!.replace(/\D/g, '').slice(-9))) {
            lead.allPhones.push({ number: apolloPerson.phone, type: 'landline', source: 'apollo' })
          }
        }
        if (apolloPerson.employmentHistory?.length) {
          lead.employmentHistory = apolloPerson.employmentHistory
        }
        if (!lead.enrichmentSources.includes('apollo')) lead.enrichmentSources.push('apollo')
      }
    } catch { /* Apollo person enrichment failed, continue */ }
  }

  // ── Merge Snov data (paid, optional) ──────────────────────────
  if (snovData.status === 'fulfilled' && Array.isArray(snovData.value) && snovData.value.length > 0) {
    const persons = snovData.value as SnovPerson[]
    lead.enrichmentSources.push('snov')
    for (const sp of persons) {
      if (sp.email && !lead.allEmails.find(e => e.email === sp.email)) {
        lead.allEmails.push({ email: sp.email, type: 'personal', source: 'snov' })
      }
      if (sp.phone && isValidPhone(sp.phone) && !lead.allPhones.find(p => p.number === sp.phone)) {
        lead.allPhones.push({ number: sp.phone!, type: 'unknown', source: 'snov' })
      }
      // First Snov person with name = potential contact
      if (sp.name && !lead.personName) {
        lead.personName = sp.name
        lead.personRole = sp.position
      }
    }
  }

  // ── Post-processing: infer fields ─────────────────────────────
  lead.employmentType = inferEmploymentType(lead.personRole, lead.personSeniority, lead.formaGiuridica)
  lead.triggers = detectTriggers(lead)
  lead.estimatedPotential = estimatePotential(lead)

  // Mobile phone: find first mobile in allPhones
  if (!lead.mobilePhone) {
    const mob = lead.allPhones.find(p => p.type === 'mobile')
    if (mob) lead.mobilePhone = mob.number
  }

  // Best email priority: personal verified > personal > pec > generic
  const personalVerified = lead.allEmails.find(e => e.type === 'personal' && e.verified)
  const personal = lead.allEmails.find(e => e.type === 'personal')
  const pec = lead.allEmails.find(e => e.type === 'pec')
  const generic = lead.allEmails.find(e => e.type === 'generic')
  lead.bestEmail = personalVerified?.email || personal?.email || pec?.email || generic?.email || null

  // Best phone priority: mobile > landline
  const mobile = lead.allPhones.find(p => p.type === 'mobile')
  const landline = lead.allPhones.find(p => p.type === 'landline')
  lead.bestPhone = mobile?.number || landline?.number || null

  // Enrichment quality
  lead.enrichmentQuality = calcEnrichmentQuality(lead)

  // Deduplicate sources
  lead.enrichmentSources = [...new Set(lead.enrichmentSources)]

  return lead
}

// ── Internal registry fetch ─────────────────────────────────────
async function fetchRegistryInternal(lead: any): Promise<any | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/lead-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.found ? data : null
  } catch {
    return null
  }
}
