/**
 * Deep Website Scraper
 * Scrapes ALL pages of a company website to extract:
 * - All email addresses (personal + generic)
 * - All phone numbers (landline + mobile)
 * - Team members (names + roles from /chi-siamo, /team, /about)
 * - Social media links (LinkedIn, Facebook, Instagram, TikTok, YouTube)
 * - P.IVA / Codice Fiscale
 * - Physical address
 */

// ── Types ────────────────────────────────────────────────────────
export interface WebsiteScrapedData {
  emails: { email: string; type: 'personal' | 'generic' | 'pec'; page: string }[]
  phones: { number: string; type: 'mobile' | 'landline' | 'unknown'; page: string }[]
  socialLinks: {
    linkedin: string | null
    linkedinPersonal: string[]
    facebook: string | null
    instagram: string | null
    tiktok: string | null
    youtube: string | null
    twitter: string | null
  }
  teamMembers: { name: string; role: string | null }[]
  partitaIva: string | null
  codiceFiscale: string | null
  address: string | null
  pagesScraped: number
  scrapedAt: string
}

// ── Platform / directory blocklist ───────────────────────────────
// These are third-party platforms where profiles are hosted.
// P.IVA found on these sites belongs to the PLATFORM, not the business.
// We should NOT scrape sub-pages or extract P.IVA from these domains.
const PLATFORM_DOMAINS = new Set([
  'miodottore.it', 'doctolib.it', 'doctolib.fr',
  'paginegialle.it', 'paginebianche.it', 'tuttocitta.it',
  'yelp.com', 'yelp.it', 'tripadvisor.it', 'tripadvisor.com',
  'booking.com', 'airbnb.it', 'airbnb.com',
  'subito.it', 'immobiliare.it', 'idealista.it', 'casa.it',
  'infojobs.it', 'indeed.com', 'glassdoor.it', 'glassdoor.com',
  'linkedin.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'twitter.com', 'tiktok.com',
  'trustpilot.com', 'google.com', 'maps.google.com',
  'europages.it', 'kompass.com', 'hotfrog.it',
  'cylex.it', 'misterimprese.it', 'dnb.com',
  'virgilio.it', 'libero.it',
  'wix.com', 'wordpress.com', 'jimdo.com', 'weebly.com',
  'shopify.com', 'etsy.com', 'amazon.it', 'amazon.com',
  'ebay.it', 'ebay.com',
  'topdoctors.it', 'dottori.it', 'medicitalia.it',
  'pazienti.it', 'guidadottori.it',
  'thefork.it', 'justeat.it', 'deliveroo.it', 'glovo.com',
  'matrimonio.com', 'matrimonio.it',
  // ATS / hiring platforms — NEVER the real company site (usually sub-domain like piksel.breezy.hr)
  'breezy.hr', 'breezy.com', 'greenhouse.io', 'lever.co',
  'workable.com', 'jobvite.com', 'bamboohr.com',
  'workday.com', 'myworkdayjobs.com', 'recruitee.com',
  'smartrecruiters.com', 'teamtailor.com', 'personio.com',
  'personio.de', 'zohorecruit.com', 'jobs.lever.co',
  'hireology.com', 'jazzhr.com', 'applytojob.com',
  // Portals / marketplaces / blog platforms
  'medium.com', 'substack.com', 'notion.site', 'github.io',
  'gitlab.io', 'netlify.app', 'vercel.app',
])

function isPlatformDomain(website: string): boolean {
  try {
    const hostname = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '')
    // Check exact match or if it's a subdomain of a platform
    for (const platform of PLATFORM_DOMAINS) {
      if (hostname === platform || hostname.endsWith(`.${platform}`)) return true
    }
  } catch { /* invalid URL */ }
  return false
}

// ── Helpers ──────────────────────────────────────────────────────
async function fetchPage(url: string, timeoutMs = 6000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (!res.ok) return ''
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('application/xhtml')) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function getOrigin(website: string): string {
  const url = website.startsWith('http') ? website : `https://${website}`
  try { return new URL(url).origin } catch { return url }
}

function extractFramePaths(html: string, origin: string, currentPath: string): string[] {
  const tags = html.match(/<(?:iframe|frame)\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi) || []
  const paths: string[] = []
  const currentUrl = currentPath === '/' ? `${origin}/` : `${origin}${currentPath.startsWith('/') ? currentPath : `/${currentPath}`}`
  for (const tag of tags) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]?.trim()
    if (!src || /^(javascript:|mailto:|tel:|#)/i.test(src)) continue
    try {
      const url = new URL(src, currentUrl)
      if (url.origin !== origin) continue
      const path = `${url.pathname}${url.search}`
      if (path && path !== '/' && !paths.includes(path)) paths.push(path)
    } catch { /* ignore */ }
  }
  return paths
}

// ── Discover navigation links whose anchor text matches "contatti / preventivo / richiedi…" ──
// Some company sites do not have a standard /contatti page (e.g. balzarottiascensori.it routes
// "Contatti" to /preventivo-costo-ascensori-montacarichi). This helper scans the homepage HTML
// for same-origin <a href> whose visible text contains contact-like keywords and returns the paths.
const CONTACT_LINK_KEYWORDS = /\b(contatt|contact|preventiv|richied|chiama|getintouch|get-in-touch|telefon|prenotaz|reach\s*out)/i
function extractContactLikePaths(html: string, origin: string, currentPath: string, max = 5): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const currentUrl = currentPath === '/' ? `${origin}/` : `${origin}${currentPath.startsWith('/') ? currentPath : `/${currentPath}`}`
  const anchorRx = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRx.exec(html)) !== null) {
    if (out.length >= max) break
    const attrs = m[1] || ''
    const inner = m[2] || ''
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim()
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    const title = attrs.match(/\btitle=["']([^"']+)["']/i)?.[1] || ''
    const aria = attrs.match(/\baria-label=["']([^"']+)["']/i)?.[1] || ''
    const haystack = `${text} ${title} ${aria}`.toLowerCase()
    if (!CONTACT_LINK_KEYWORDS.test(haystack)) continue
    try {
      const url = new URL(href, currentUrl)
      if (url.origin !== origin) continue
      const path = url.pathname + (url.search || '')
      if (!path || path === '/' || /\.(?:png|jpe?g|gif|svg|webp|pdf|zip)$/i.test(path)) continue
      if (seen.has(path)) continue
      seen.add(path)
      out.push(path)
    } catch { /* ignore */ }
  }
  return out
}

// ── Email extraction ────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const FAKE_DOMAINS = new Set(['example.com','email.com','sito.com','domain.com','test.com','yoursite.com','yourdomain.com','tuosito.com','sitoweb.com','sample.com','placeholder.com','wixpress.com','sentry.io','googleapis.com','w3.org','schema.org','wordpress.org','jquery.com','bootstrapcdn.com'])
const FAKE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico|tiff|css|js|woff|woff2|ttf|eot|mp4|mp3|pdf|zip|xml|json)$/i

function isPersonalEmail(email: string): boolean {
  const parts = email.split('@')
  const local = parts[0].toLowerCase()
  const genericPrefixes = ['info','contatti','contact','admin','office','segreteria','reception','booking','prenotazioni','sales','vendite','support','assistenza','help','marketing','hr','risorse','noreply','no-reply','postmaster','webmaster','newsletter','press','media']
  return !genericPrefixes.some(p => local === p || local.startsWith(p + '.'))
}

function isPecEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  return domain.includes('pec.') || domain.includes('.pec') || domain.endsWith('legalmail.it') || domain.endsWith('pecimprese.it') || domain.endsWith('arubapec.it') || domain.endsWith('pec-email.it') || domain.endsWith('postecert.it')
}

/**
 * Decode Cloudflare's email obfuscation. Cloudflare wraps emails like
 * `<a class="__cf_email__" data-cfemail="abcdef0123">[email&nbsp;protected]</a>`
 * to block scrapers. The hex string is XOR-encoded with the first byte as key.
 * Many Italian SME sites have Cloudflare email-protection enabled by default.
 */
function decodeCloudflareEmails(html: string): string[] {
  const decoded: string[] = []
  // Match data-cfemail="..." attributes (also support data-cfemail='...' and "&quot;)
  const re = /data-cfemail=["']([0-9a-fA-F]+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const enc = m[1]
    if (enc.length < 4 || enc.length % 2 !== 0) continue
    try {
      const r = parseInt(enc.substr(0, 2), 16)
      let email = ''
      for (let i = 2; i < enc.length; i += 2) {
        const c = parseInt(enc.substr(i, 2), 16) ^ r
        email += String.fromCharCode(c)
      }
      // Validate it looks like an email
      if (/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
        decoded.push(email)
      }
    } catch { /* ignore */ }
  }
  return decoded
}

function extractEmails(html: string, page: string): WebsiteScrapedData['emails'] {
  // ★ Decode Cloudflare-protected emails first (data-cfemail="..."), then merge with regex matches.
  // Without this, sites behind Cloudflare email-protection (very common in Italy) return 0 emails.
  const cfEmails = decodeCloudflareEmails(html)
  const matches: string[] = [...(html.match(EMAIL_RE) || []), ...cfEmails]
  const seen = new Set<string>()
  const results: WebsiteScrapedData['emails'] = []

  for (const raw of matches) {
    const email = raw.toLowerCase().trim()
    if (seen.has(email)) continue
    seen.add(email)

    const domain = email.split('@')[1] || ''
    if (FAKE_DOMAINS.has(domain)) continue
    if (domain.includes('.png') || domain.includes('.jpg') || domain.includes('.svg')) continue
    // Skip image/file names falsely matched as emails (e.g. "banner@img-v2.gif")
    if (FAKE_EXTENSIONS.test(email)) continue
    if (FAKE_EXTENSIONS.test(domain)) continue
    // Skip if local part looks like a filename (contains path separators or image keywords)
    const local = email.split('@')[0].toLowerCase()
    if (local.length > 50) continue
    if (/banner|image|img|logo|icon|thumb|background|header|footer|sprite|placeholder|pixel/i.test(local) && !/info|contact|mail|support/i.test(local)) continue

    results.push({
      email,
      type: isPecEmail(email) ? 'pec' : isPersonalEmail(email) ? 'personal' : 'generic',
      page,
    })
  }
  return results
}

// ── Phone extraction ────────────────────────────────────────────
const PHONE_PATTERNS = [
  // Italian mobile: +39 3xx, 3xx
  /(?:\+39\s?|0039\s?)?3[0-9]{1,2}[\s.\-]?\d{3}[\s.\-]?\d{4}/g,
  // Italian landline: 0xx xxxxx+ (min 6 subscriber digits for safety)
  /(?:\+39\s?|0039\s?)?0[1-9]\d{0,3}[\s.\-]?\d{5,8}/g,
  // Italian toll-free / special: 800/803/840/848/892/899/199 — total 9 digits (subscriber part 6)
  /(?:\+39\s?|0039\s?)?(?:800|803|840|848|892|899|199)[\s.\-]?\d{2,3}[\s.\-]?\d{2,4}[\s.\-]?\d{0,2}/g,
  // Generic tel: patterns from href="tel:"
  /href=["']tel:([^"']+)["']/gi,
]

function isMobileNumber(num: string): boolean {
  const digits = num.replace(/\D/g, '').replace(/^(39|0039)/, '')
  return digits.startsWith('3') && digits.length >= 9
}

/** Reject fake phone numbers with too many repeating digits (e.g. 33.3333333) */
function isFakeRepeatingNumber(num: string): boolean {
  const digits = num.replace(/\D/g, '').replace(/^(39|0039)/, '')
  if (digits.length < 6) return true
  // Check if one digit makes up >70% of the number
  for (let d = 0; d <= 9; d++) {
    const count = (digits.match(new RegExp(String(d), 'g')) || []).length
    if (count / digits.length > 0.7) return true
  }
  // Check sequential patterns like 1234567 or 7654321
  let ascending = 0, descending = 0
  for (let i = 1; i < digits.length; i++) {
    if (parseInt(digits[i]) === parseInt(digits[i-1]) + 1) ascending++
    if (parseInt(digits[i]) === parseInt(digits[i-1]) - 1) descending++
  }
  if (ascending / (digits.length - 1) > 0.7) return true
  if (descending / (digits.length - 1) > 0.7) return true
  return false
}

/** Reject non-Italian numbers (must start with +39, 0039, 0, 3, or toll-free 8XX/199) */
function isItalianPhone(num: string): boolean {
  const raw = num.replace(/[\s.\-()]/g, '')
  // Must start with +39, 0039, 0 (landline), 3 (mobile) or toll-free / special prefixes
  if (/^(\+39|0039|0[1-9]|3[0-9]|800|803|840|848|892|899|199)/.test(raw)) return true
  // Pure digits starting with 39, 0xx, 3xx or toll-free prefix
  const digits = raw.replace(/\D/g, '')
  if (/^(39|0039)/.test(digits)) return true
  if (/^(0[1-9]|3[0-9]|800|803|840|848|892|899|199)/.test(digits)) return true
  return false
}

function extractPhones(html: string, page: string): WebsiteScrapedData['phones'] {
  const seen = new Set<string>()
  const results: WebsiteScrapedData['phones'] = []

  // Extract from tel: links first
  const telLinks = html.match(/href=["']tel:([^"']+)["']/gi) || []
  for (const tl of telLinks) {
    const num = tl.replace(/href=["']tel:/i, '').replace(/["']/g, '').trim()
    if (!isItalianPhone(num)) continue
    if (isFakeRepeatingNumber(num)) continue
    const digits = num.replace(/\D/g, '')
    if (digits.length < 9) continue
    const key = digits.slice(-9)
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      number: num,
      type: isMobileNumber(num) ? 'mobile' : 'landline',
      page,
    })
  }

  // Extract from VISIBLE text content only (strip script/style/noscript/svg blocks first)
  const visibleHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
  const textContent = visibleHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  // Iterate mobile, landline and toll-free/special patterns (skip the href:tel one, handled above).
  for (const pattern of PHONE_PATTERNS.slice(0, 3)) {
    pattern.lastIndex = 0
    const matches = textContent.match(pattern) || []
    for (const raw of matches) {
      if (!isItalianPhone(raw)) continue
      if (isFakeRepeatingNumber(raw)) continue
      const digits = raw.replace(/\D/g, '').replace(/^(39|0039)/, '')
      if (digits.length < 9 || digits.length > 12) continue
      const key = digits.slice(-9)
      if (seen.has(key)) continue
      seen.add(key)
      const isTollFreeOrSpecial = /^(800|803|840|848|892|899|199)/.test(digits)
      results.push({
        number: raw.trim(),
        type: isTollFreeOrSpecial ? 'landline' : (isMobileNumber(raw) ? 'mobile' : 'landline'),
        page,
      })
    }
  }

  return results
}

// ── Social links extraction ─────────────────────────────────────
function extractSocialLinks(html: string): WebsiteScrapedData['socialLinks'] {
  const links: WebsiteScrapedData['socialLinks'] = {
    linkedin: null,
    linkedinPersonal: [],
    facebook: null,
    instagram: null,
    tiktok: null,
    youtube: null,
    twitter: null,
  }

  // Extract all href values
  const hrefs = html.match(/href=["']([^"']+)["']/gi) || []
  const urls = hrefs.map(h => h.replace(/href=["']/i, '').replace(/["']$/, ''))

  for (const url of urls) {
    const lower = url.toLowerCase()

    // LinkedIn company page
    if (lower.includes('linkedin.com/company/') && !links.linkedin) {
      links.linkedin = url
    }
    // LinkedIn personal profiles
    if (lower.includes('linkedin.com/in/') && !links.linkedinPersonal.includes(url)) {
      links.linkedinPersonal.push(url)
    }
    // Facebook
    if ((lower.includes('facebook.com/') || lower.includes('fb.com/')) && !links.facebook && !lower.includes('facebook.com/sharer')) {
      links.facebook = url
    }
    // Instagram
    if (lower.includes('instagram.com/') && !links.instagram && !lower.includes('instagram.com/p/')) {
      links.instagram = url
    }
    // TikTok
    if (lower.includes('tiktok.com/@') && !links.tiktok) {
      links.tiktok = url
    }
    // YouTube
    if ((lower.includes('youtube.com/') || lower.includes('youtu.be/')) && !links.youtube) {
      links.youtube = url
    }
    // Twitter/X
    if ((lower.includes('twitter.com/') || lower.includes('x.com/')) && !links.twitter && !lower.includes('twitter.com/intent')) {
      links.twitter = url
    }
  }

  return links
}

// ── Team members extraction ─────────────────────────────────────
function extractTeamMembers(html: string): WebsiteScrapedData['teamMembers'] {
  const members: WebsiteScrapedData['teamMembers'] = []
  const seen = new Set<string>()

  // Pattern 1: JSON-LD Person structured data
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim())
      const items = Array.isArray(json) ? json : [json]
      for (const item of items) {
        if (item['@type'] === 'Person' && item.name) {
          const name = item.name.trim()
          if (!seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase())
            members.push({ name, role: item.jobTitle || null })
          }
        }
        // Check for employees array
        if (item.employee) {
          const emps = Array.isArray(item.employee) ? item.employee : [item.employee]
          for (const emp of emps) {
            if (emp.name) {
              const n = emp.name.trim()
              if (!seen.has(n.toLowerCase())) {
                seen.add(n.toLowerCase())
                members.push({ name: n, role: emp.jobTitle || null })
              }
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Blocklist: common website section titles that look like 2-word capitalized names
  const SECTION_TITLE_BLOCKLIST = /^(Dicono Di|Chi Siamo|Come Funziona|Dove Siamo|I Nostri|Le Nostre|Il Nostro|La Nostra|Scopri Di|Richiedi Un|Contatta Ora|Leggi Di|Vedi Tutti|Scarica Il|Ultimi Articoli|Ultime Notizie|Prossimi Eventi|Seguici Su|Iscriviti Alla|Scrivi Un|Richiedi Preventivo|Scopri Come|Orari Di|Punti Di|Servizi Di|Area Riservata|Mappa Del|Menu Del|Tutti Diritti|Lavora Con|Servizio Clienti|Politica Sulla|Termini Di|Condizioni Di|Informativa Sulla|Cookie Policy|Privacy Policy|Modulo Di|Centro Assistenza|Pagina Non|Errore Di|Torna Alla|Vai Al|Scopri Le|Perch[eéè] Scegliere|Cosa Facciamo|Cosa Offriamo|Come Lavoriamo|Prenota Un|Prenota Ora|Richiedi Info|Chiedi Un|Nostra Storia|Nostro Team|Blog Aziendale|Rassegna Stampa|Dicono Noi)$/i

  // Pattern 2: Common HTML patterns for team pages
  // <h3>Name</h3><p>Role</p> or similar patterns
  const teamPatterns = [
    // <h2/h3/h4> followed by <p> with role keywords
    /<h[2-4][^>]*>([A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)?)<\/h[2-4]>\s*<[^>]*>([^<]{3,60})<\//gi,
    // data-name or itemprop="name"
    /(?:data-name|itemprop=["']name["'])[^>]*>([A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)?)</gi,
  ]

  const roleKeywords = ['fondatore','ceo','cto','cfo','coo','direttore','manager','responsabile','titolare','socio','partner','avvocato','dottore','dott','ing','arch','geom','rag','amministratore','presidente','vice','legale','commerciale','marketing','vendite','hr','risorse','tecnico']

  for (const pattern of teamPatterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(html)) !== null) {
      const name = match[1]?.trim()
      const role = match[2]?.trim()
      if (!name || name.length < 4 || name.length > 50) continue
      if (seen.has(name.toLowerCase())) continue
      // Validate it looks like a real name (at least 2 words, capitalized)
      if (!/^[A-ZÀ-Ú]/.test(name)) continue
      if (name.split(' ').length < 2) continue
      // Block common section titles that look like 2-word names
      if (SECTION_TITLE_BLOCKLIST.test(name)) continue
      // Block names containing common non-name words
      if (/\b(dicono|siamo|nostri|nostre|scopri|contatt|serviz|orari|scrivi|leggi|scarica|iscriviti|seguici|richiedi|prenota|lavora|cookie|privacy|modulo|mappa|termini|condizioni|errore|pagina|torna|blog|rassegna)\b/i.test(name)) continue

      const isRole = role && roleKeywords.some(k => role.toLowerCase().includes(k))
      // Only accept h-tag extracted names if they come with a valid role
      if (!isRole) continue
      seen.add(name.toLowerCase())
      members.push({ name, role: role })
    }
  }

  return members.slice(0, 20) // Cap at 20
}

// ── P.IVA / CF extraction ───────────────────────────────────────
const PIVA_PATTERNS = [
  /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /\bIT(\d{11})\b/g,
]

function extractPiva(html: string): string | null {
  for (const re of PIVA_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m?.[1]) return m[1]
  }
  // Context search
  const area = html.match(/(?:P\.?\s*I\.?V\.?A|Partita\s*IVA|codice\s*fiscale).{0,100}/gi)
  if (area) {
    for (const a of area) {
      const d = a.match(/\b(\d{11})\b/)
      if (d?.[1]) return d[1]
    }
  }
  return null
}

// ── Address extraction ──────────────────────────────────────────
function extractAddress(html: string): string | null {
  // Look for structured data first
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim())
      const addr = json.address || json.location?.address
      if (addr) {
        if (typeof addr === 'string') return addr
        if (addr.streetAddress) {
          return [addr.streetAddress, addr.postalCode, addr.addressLocality, addr.addressRegion]
            .filter(Boolean).join(', ')
        }
      }
    } catch { /* ignore */ }
  }

  // Look for Italian address patterns near "sede" or "indirizzo"
  const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const addressPatterns = [
    /(?:sede|indirizzo|via|piazza|corso|viale|largo)\s*[:\-]?\s*((?:Via|Piazza|Corso|Viale|Largo|P\.zza|V\.le)\s+[^,]+,\s*\d{5}\s*[A-ZÀ-Ú][a-zà-ú]+(?:\s*\([A-Z]{2}\))?)/i,
  ]
  for (const p of addressPatterns) {
    const m = textContent.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

// ── Main scraper ────────────────────────────────────────────────
export async function scrapeWebsiteDeep(website: string): Promise<WebsiteScrapedData> {
  const result: WebsiteScrapedData = {
    emails: [],
    phones: [],
    socialLinks: { linkedin: null, linkedinPersonal: [], facebook: null, instagram: null, tiktok: null, youtube: null, twitter: null },
    teamMembers: [],
    partitaIva: null,
    codiceFiscale: null,
    address: null,
    pagesScraped: 0,
    scrapedAt: new Date().toISOString(),
  }

  if (!website) return result

  const isThirdPartyPlatform = isPlatformDomain(website)
  const origin = getOrigin(website)
  const baseUrl = website.startsWith('http') ? website : `https://${website}`

  // For platform profiles (miodottore.it, etc.), only scrape the given URL
  // Do NOT scrape sub-pages — they belong to the platform, not the business
  let pagePaths = isThirdPartyPlatform
    ? [''] // only the profile page itself
    : [
        '', // homepage
        '/contatti', '/contacts', '/contact', '/contact-us', '/contattaci',
        '/chi-siamo', '/about', '/about-us', '/azienda', '/company',
        '/team', '/il-team', '/staff', '/persone', '/people',
        '/privacy', '/privacy-policy',
        '/impressum',
      ]

  const allEmails: WebsiteScrapedData['emails'] = []
  const allPhones: WebsiteScrapedData['phones'] = []
  const allMembers: WebsiteScrapedData['teamMembers'] = []
  let mergedSocials: WebsiteScrapedData['socialLinks'] = { ...result.socialLinks }

  // Fetch all pages in parallel (batch of 5)
  const batchSize = 5
  for (let i = 0; i < pagePaths.length; i += batchSize) {
    const batch = pagePaths.slice(i, i + batchSize)
    const fetches = await Promise.allSettled(
      batch.map(path => {
        const url = path ? `${origin}${path}` : baseUrl
        return fetchPage(url, 5000).then(html => ({ html, path: path || '/' }))
      })
    )

    for (const f of fetches) {
      if (f.status !== 'fulfilled' || !f.value.html) continue
      const { html, path } = f.value
      if (html.length < 500) continue // too small, probably error page

      if (!isThirdPartyPlatform) {
        const framePaths = extractFramePaths(html, origin, path)
        for (const framePath of framePaths) {
          if (pagePaths.length >= 30) break
          if (!pagePaths.includes(framePath)) pagePaths.push(framePath)
        }
        // Discover non-standard contact pages from homepage navigation (e.g. "Contatti" → /preventivo-...)
        if (path === '/') {
          const contactPaths = extractContactLikePaths(html, origin, path)
          for (const cp of contactPaths) {
            if (pagePaths.length >= 30) break
            if (!pagePaths.includes(cp)) pagePaths.push(cp)
          }
        }
      }

      result.pagesScraped++

      // Strip img/source/video/picture tags to avoid matching image filenames as emails
      const cleanHtml = html.replace(/<(?:img|source|video|picture)[^>]*>/gi, '')

      // Extract emails and phones from all pages including privacy
      // (privacy pages often contain the owner's personal email as "Titolare del Trattamento")
      allEmails.push(...extractEmails(cleanHtml, path))
      allPhones.push(...extractPhones(html, path))

      // Social links (merge, first found wins)
      const pageSocials = extractSocialLinks(html)
      if (!mergedSocials.linkedin && pageSocials.linkedin) mergedSocials.linkedin = pageSocials.linkedin
      if (!mergedSocials.facebook && pageSocials.facebook) mergedSocials.facebook = pageSocials.facebook
      if (!mergedSocials.instagram && pageSocials.instagram) mergedSocials.instagram = pageSocials.instagram
      if (!mergedSocials.tiktok && pageSocials.tiktok) mergedSocials.tiktok = pageSocials.tiktok
      if (!mergedSocials.youtube && pageSocials.youtube) mergedSocials.youtube = pageSocials.youtube
      if (!mergedSocials.twitter && pageSocials.twitter) mergedSocials.twitter = pageSocials.twitter
      for (const lp of pageSocials.linkedinPersonal) {
        if (!mergedSocials.linkedinPersonal.includes(lp)) mergedSocials.linkedinPersonal.push(lp)
      }

      // Team members (from about/team pages)
      if (/chi-siamo|about|team|staff|persone|people|azienda/i.test(path)) {
        allMembers.push(...extractTeamMembers(html))
      }

      // P.IVA (first found) — SKIP for platform domains (P.IVA would be the platform's, not the business's)
      if (!result.partitaIva && !isThirdPartyPlatform) {
        result.partitaIva = extractPiva(html)
      }

      // Address (first found) — SKIP for platforms (address is the platform HQ, not the business)
      if (!result.address && !isThirdPartyPlatform) {
        result.address = extractAddress(html)
      }
    }
  }

  // Deduplicate
  const seenEmails = new Set<string>()
  result.emails = allEmails.filter(e => {
    if (seenEmails.has(e.email)) return false
    seenEmails.add(e.email)
    return true
  })

  const seenPhones = new Set<string>()
  result.phones = allPhones.filter(p => {
    const key = p.number.replace(/\D/g, '').slice(-9)
    if (seenPhones.has(key)) return false
    seenPhones.add(key)
    return true
  })

  const seenMembers = new Set<string>()
  result.teamMembers = allMembers.filter(m => {
    const key = m.name.toLowerCase()
    if (seenMembers.has(key)) return false
    seenMembers.add(key)
    return true
  }).slice(0, 20)

  result.socialLinks = mergedSocials

  return result
}
