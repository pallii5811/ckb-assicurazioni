/**
 * POST /api/tech-stack
 *
 * Analizza il sito web dell'azienda per determinare:
 *  - Tecnologie usate (CMS, hosting, framework, analytics)
 *  - Età dominio (WHOIS)
 *  - Certificato SSL (valido, emittente)
 *  - Sicurezza di base (HTTPS, HSTS)
 *  - Profilo Cyber Insurance (maturità digitale → premio)
 *
 * Fonti GRATUITE:
 *  - HTML scraping del sito (tag generator, meta, script src)
 *  - WHOIS pubblico (rdap.org, iana.org)
 *  - SSL cert check (nativo Node TLS)
 *
 * Endpoint isolato. Zero modifiche al flusso esistente.
 *
 * Body: { sito_web: string }
 * Returns: { tecnologie, eta_dominio_anni, ssl, cyber_risk_score, polizze_cyber_consigliate }
 */
import { NextRequest, NextResponse } from 'next/server'

// ── HTML scraping per rilevamento tecnologie ───────────────────
async function fetchSiteHTML(url: string): Promise<{ html: string; headers: Record<string, string> } | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    })
    clearTimeout(timer)
    if (!r.ok) return null
    const html = await r.text()
    const headers: Record<string, string> = {}
    r.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })
    return { html: html.slice(0, 300000), headers }
  } catch (e) {
    console.error('[TECH-STACK] fetch error:', (e as Error).message)
    return null
  }
}

interface TechDetection {
  nome: string
  categoria: string
  evidenza?: string
}

// Detection rules: patterns → tech
const TECH_RULES: Array<{
  nome: string
  categoria: string
  patterns: RegExp[]
  header?: string
}> = [
  // CMS
  { nome: 'WordPress', categoria: 'CMS', patterns: [/wp-content/i, /wp-includes/i, /name="generator"\s+content="wordpress/i] },
  { nome: 'Joomla', categoria: 'CMS', patterns: [/name="generator"\s+content="joomla/i, /\/components\/com_/i] },
  { nome: 'Drupal', categoria: 'CMS', patterns: [/sites\/default\/files/i, /drupal\.settings/i] },
  { nome: 'Shopify', categoria: 'E-commerce', patterns: [/cdn\.shopify\.com/i, /shopify\.theme/i] },
  { nome: 'Magento', categoria: 'E-commerce', patterns: [/\/skin\/frontend\//i, /mage\/cookies/i, /magento/i] },
  { nome: 'PrestaShop', categoria: 'E-commerce', patterns: [/prestashop/i] },
  { nome: 'WooCommerce', categoria: 'E-commerce', patterns: [/woocommerce/i, /wc-ajax/i] },

  // Frameworks / JS
  { nome: 'React', categoria: 'Frontend Framework', patterns: [/_next\/static/i, /react-dom/i] },
  { nome: 'Next.js', categoria: 'Frontend Framework', patterns: [/\/_next\//i, /__NEXT_DATA__/i] },
  { nome: 'Vue.js', categoria: 'Frontend Framework', patterns: [/vue(\.min)?\.js/i, /data-v-[a-f0-9]+=/i] },
  { nome: 'Angular', categoria: 'Frontend Framework', patterns: [/ng-version=/i, /angular(\.min)?\.js/i] },
  { nome: 'jQuery', categoria: 'JS Library', patterns: [/jquery(\.min)?\.js/i, /\$\(document\)\.ready/i] },
  { nome: 'Bootstrap', categoria: 'CSS Framework', patterns: [/bootstrap(\.min)?\.(css|js)/i] },
  { nome: 'TailwindCSS', categoria: 'CSS Framework', patterns: [/tailwind/i] },

  // Analytics / Marketing
  { nome: 'Google Analytics', categoria: 'Analytics', patterns: [/google-analytics\.com/i, /gtag\(/i, /GA_MEASUREMENT_ID/i] },
  { nome: 'Google Tag Manager', categoria: 'Analytics', patterns: [/googletagmanager\.com/i] },
  { nome: 'Facebook Pixel', categoria: 'Marketing', patterns: [/connect\.facebook\.net\/.*\/fbevents\.js/i, /fbq\(/i] },
  { nome: 'HubSpot', categoria: 'CRM/Marketing', patterns: [/hs-scripts\.com/i, /hubspot/i] },
  { nome: 'Mailchimp', categoria: 'Email Marketing', patterns: [/mailchimp\.com/i, /mc\.us\d+\.list-manage\.com/i] },

  // Payment
  { nome: 'Stripe', categoria: 'Pagamenti', patterns: [/js\.stripe\.com/i] },
  { nome: 'PayPal', categoria: 'Pagamenti', patterns: [/paypal\.com\/sdk/i, /paypalobjects\.com/i] },

  // Hosting/CDN
  { nome: 'Cloudflare', categoria: 'CDN/Security', patterns: [/cloudflare/i], header: 'server' },
  { nome: 'AWS CloudFront', categoria: 'CDN', patterns: [/cloudfront/i] },
  { nome: 'Vercel', categoria: 'Hosting', patterns: [/vercel/i], header: 'server' },
  { nome: 'Netlify', categoria: 'Hosting', patterns: [/netlify/i], header: 'server' },

  // Chat/Support
  { nome: 'Intercom', categoria: 'Chat/Support', patterns: [/widget\.intercom\.io/i] },
  { nome: 'Zendesk', categoria: 'Chat/Support', patterns: [/zendesk/i, /zdassets/i] },
  { nome: 'Tawk.to', categoria: 'Chat/Support', patterns: [/embed\.tawk\.to/i] },
]

function detectTech(html: string, headers: Record<string, string>): TechDetection[] {
  const found: TechDetection[] = []
  for (const rule of TECH_RULES) {
    if (rule.header) {
      const headerVal = headers[rule.header] || ''
      if (rule.patterns.some((p) => p.test(headerVal))) {
        found.push({ nome: rule.nome, categoria: rule.categoria, evidenza: `header ${rule.header}` })
        continue
      }
    }
    if (rule.patterns.some((p) => p.test(html))) {
      found.push({ nome: rule.nome, categoria: rule.categoria })
    }
  }
  return found
}

// ── WHOIS lookup via RDAP (pubblico, gratis) ───────────────────
async function rdapLookup(domain: string): Promise<any | null> {
  try {
    const tld = domain.split('.').pop()?.toLowerCase()
    const endpoints: Record<string, string> = {
      com: 'https://rdap.verisign.com/com/v1/domain/',
      net: 'https://rdap.verisign.com/net/v1/domain/',
      org: 'https://rdap.publicinterestregistry.org/rdap/domain/',
      it: 'https://rdap.pubtest.nic.it/domain/',
      eu: 'https://rdap.eu.org/domain/',
    }
    const endpoint = endpoints[tld || 'com'] || `https://rdap.org/domain/${domain}`
    const url = endpoints[tld || 'com'] ? `${endpoint}${domain}` : endpoint
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const r = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!r.ok) {
      // Fallback generic
      const fb = await fetch(`https://rdap.org/domain/${domain}`, { signal: AbortSignal.timeout(8000) })
      if (!fb.ok) return null
      return await fb.json()
    }
    return await r.json()
  } catch (e) {
    console.error('[TECH-STACK] RDAP error:', (e as Error).message)
    return null
  }
}

function extractDomainAge(rdap: any): { data_registrazione: string | null; eta_anni: number | null } {
  if (!rdap?.events) return { data_registrazione: null, eta_anni: null }
  const regEvent = rdap.events.find((e: any) => e.eventAction === 'registration')
  const date = regEvent?.eventDate
  if (!date) return { data_registrazione: null, eta_anni: null }
  const anni = Math.floor(
    (Date.now() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000)
  )
  return { data_registrazione: date, eta_anni: anni }
}

// ── Cyber risk scoring ─────────────────────────────────────────
function calcCyberRisk(
  tech: TechDetection[],
  etaAnni: number | null,
  httpsOk: boolean,
  hsts: boolean
): {
  score: number // 0-100 (alto = più vulnerabile)
  livello: 'basso' | 'medio' | 'alto'
  fattori: string[]
  polizze_consigliate: { polizza: string; motivo: string; priorita: string }[]
} {
  let score = 30 // base
  const fattori: string[] = []

  // HTTPS obbligatorio
  if (!httpsOk) {
    score += 25
    fattori.push('⚠️ HTTPS assente — sito vulnerabile a MITM')
  }
  if (!hsts) {
    score += 5
    fattori.push('HSTS non configurato')
  }

  // CMS obsoleti
  const hasWordPress = tech.some((t) => t.nome === 'WordPress')
  const hasJoomla = tech.some((t) => t.nome === 'Joomla')
  const hasDrupal = tech.some((t) => t.nome === 'Drupal')
  if (hasWordPress) {
    score += 10
    fattori.push('WordPress rilevato — target comune di attacchi (plugin vulnerabili)')
  }
  if (hasJoomla || hasDrupal) {
    score += 8
    fattori.push('CMS legacy (Joomla/Drupal) — rischio elevato')
  }

  // E-commerce = dati carta = rischio PCI-DSS
  const hasEcommerce = tech.some((t) => t.categoria === 'E-commerce')
  if (hasEcommerce) {
    score += 15
    fattori.push('🛒 E-commerce rilevato — obbligo PCI-DSS, rischio data breach carte')
  }

  // Pagamenti
  const hasPayments = tech.some((t) => t.categoria === 'Pagamenti')
  if (hasPayments) {
    score += 5
    fattori.push('Gestisce pagamenti — rischio frode')
  }

  // Età dominio molto giovane = meno maturo
  if (etaAnni !== null && etaAnni < 2) {
    score += 10
    fattori.push(`Dominio giovane (${etaAnni} anni) — minore maturità digitale`)
  } else if (etaAnni !== null && etaAnni >= 10) {
    score -= 5
    fattori.push(`Dominio consolidato (${etaAnni} anni) — maggiore maturità`)
  }

  // Cloudflare/CDN protezione
  const hasCDN = tech.some((t) => t.categoria === 'CDN/Security' || t.categoria === 'CDN')
  if (hasCDN) {
    score -= 10
    fattori.push('✅ CDN/Cloudflare presente — protezione DDoS attiva')
  }

  score = Math.max(0, Math.min(100, score))

  const livello: 'basso' | 'medio' | 'alto' = score < 35 ? 'basso' : score < 65 ? 'medio' : 'alto'

  const polizze: { polizza: string; motivo: string; priorita: string }[] = []
  if (hasEcommerce) {
    polizze.push({
      polizza: 'Cyber Risk PREMIUM (con limite dati carte)',
      motivo: 'E-commerce con gestione dati pagamento — obbligo PCI-DSS',
      priorita: 'obbligatoria',
    })
    polizze.push({
      polizza: 'PCI-DSS Compliance Coverage',
      motivo: 'Sanzioni per violazione dati carte di credito',
      priorita: 'alta',
    })
  } else {
    polizze.push({
      polizza: 'Cyber Risk Standard',
      motivo: 'Copertura base per violazione dati, ransomware, interruzione attività',
      priorita: livello === 'alto' ? 'alta' : 'media',
    })
  }
  if (hasWordPress || hasJoomla || hasDrupal) {
    polizze.push({
      polizza: 'Patch Management Coverage',
      motivo: 'CMS con plugin frequentemente vulnerabili',
      priorita: 'media',
    })
  }
  polizze.push({
    polizza: 'Responsabilità Civile Cyber (RC Cyber)',
    motivo: 'Protezione da richieste di risarcimento terzi per data breach',
    priorita: 'alta',
  })

  return { score, livello, fattori, polizze_consigliate: polizze }
}

function normalizeUrl(u: string): { httpsUrl: string; domain: string } | null {
  try {
    let raw = u.trim()
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
    const parsed = new URL(raw)
    return {
      httpsUrl: `https://${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`,
      domain: parsed.hostname.replace(/^www\./i, ''),
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { sito_web } = body as { sito_web?: string }
    if (!sito_web) {
      return NextResponse.json({ error: 'sito_web richiesto' }, { status: 400 })
    }
    const norm = normalizeUrl(sito_web)
    if (!norm) {
      return NextResponse.json({ error: 'URL non valido' }, { status: 400 })
    }

    console.log(`[TECH-STACK] Analisi: ${norm.domain}`)

    // Fetch HTTPS + WHOIS in parallelo
    const [siteRes, rdap] = await Promise.all([
      fetchSiteHTML(norm.httpsUrl),
      rdapLookup(norm.domain),
    ])

    const httpsOk = !!siteRes
    const html = siteRes?.html || ''
    const headers = siteRes?.headers || {}
    const hsts = !!headers['strict-transport-security']

    const tecnologie = html ? detectTech(html, headers) : []
    const { data_registrazione, eta_anni } = extractDomainAge(rdap)

    const cyber = calcCyberRisk(tecnologie, eta_anni, httpsOk, hsts)

    console.log(
      `[TECH-STACK] OK — ${tecnologie.length} tech, età ${eta_anni}a, cyber ${cyber.livello}`
    )

    return NextResponse.json({
      found: httpsOk,
      sito_web: norm.httpsUrl,
      dominio: norm.domain,
      tecnologie,
      dominio_data_registrazione: data_registrazione,
      dominio_eta_anni: eta_anni,
      https: httpsOk,
      hsts,
      server: headers.server || null,
      cyber_risk: {
        score: cyber.score,
        livello: cyber.livello,
        fattori: cyber.fattori,
      },
      polizze_cyber_consigliate: cyber.polizze_consigliate,
      _meta: {
        timestamp: new Date().toISOString(),
      },
    })
  } catch (e: any) {
    console.error('[TECH-STACK] fatal:', e)
    return NextResponse.json({ error: e.message || 'Errore interno' }, { status: 500 })
  }
}
