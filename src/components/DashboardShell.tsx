'use client'



import { useEffect, useMemo, useRef, useState } from 'react'

import SniperArea from '@/components/SniperArea'

import ResultsTable from '@/components/ResultsTable'

import { SaveToEnvironmentModal } from '@/components/SaveToEnvironmentModal'

import { useToast } from '@/components/ToastProvider'

import { analyzeSiteAction, expandAndSearch, processSemanticSearchAction, textToFilterSearchAction } from '@/app/dashboard/actions'

import MiraxLogo from '@/components/MiraxLogo' // We will keep the filename for now but change the UI

import { Button } from '@/components/ui/button'

import { Folder, Sparkles, Search, Database, MapPin, Building2, Loader2, UserSearch } from 'lucide-react'

import DatabaseSearchSection from '@/components/DatabaseSearchSection'

import { createClient } from '@/utils/supabase/client'

import { useDashboard } from '@/components/DashboardContext'

import InsuranceProfileSection from '@/components/insurance/InsuranceProfileSection'
import InsuranceIntelligenceSection from '@/components/insurance/InsuranceIntelligenceSection'



function _sanitize(v: any): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  if (s === 'None' || s === 'none' || s === 'null' || s === 'undefined') return ''
  return s
}

const _FAKE_EMAIL_DOMAINS = new Set(['website.com','example.com','email.com','sito.com','domain.com','test.com','yoursite.com','yourdomain.com','tuosito.com','tuodominio.com','sitoweb.com','miosito.com','nomedominio.com','nomesito.com','sample.com','placeholder.com','mail.com'])

// Quality gate: lead must have at least phone OR email
function _hasContactInfo(lead: any): boolean {
  const _ok = (v: any) => {
    if (!v) return false
    const s = String(v).replace(/\s+/g, '').trim()
    return s.length >= 4 && !['N/D','N/A','N.D.','n/d','None','none'].includes(s)
  }
  const hasPhone = _ok(lead?.telefono) || _ok(lead?.phone)
  const hasEmail = _ok(lead?.email) && String(lead?.email || '').includes('@')
  return hasPhone || hasEmail
}

function normalizeLeadFields(lead: any): any {
  const audit = lead.audit || {}

  // Sanitize common poison strings from Python backend
  const _s = (k: string) => _sanitize(lead[k])
  const hasItalianFields = _s('azienda') || _s('nome') || _s('sito') || _s('telefono')

  // Sanitize fake/template emails
  const _cleanEmail = (raw: string): string => {
    if (!raw || !raw.includes('@')) return ''
    const domain = raw.split('@')[1]?.toLowerCase()
    if (_FAKE_EMAIL_DOMAINS.has(domain)) return ''
    return raw
  }

  // Try to extract city from address or name
  const _extractCity = (): string => {
    const raw = _s('citta') || _s('city') || _s('location') || ''
    if (raw) return raw
    // Try to get city from address field
    const addr = _s('address') || _s('indirizzo') || ''
    if (addr) {
      // Italian cities often appear after the last comma in address
      const parts = addr.split(',').map((p: string) => p.trim())
      if (parts.length >= 2) {
        const last = parts[parts.length - 1].replace(/\d{5}/g, '').trim()
        if (last && last.length > 2) return last
        const secondLast = parts[parts.length - 2].replace(/\d{5}/g, '').trim()
        if (secondLast && secondLast.length > 2) return secondLast
      }
    }
    return ''
  }

  // Map basic fields from English to Italian if needed
  const base = hasItalianFields ? {
    ...lead,
    azienda: _s('azienda') || _s('nome') || _s('business_name') || _s('name') || '',
    nome: _s('nome') || _s('azienda') || _s('business_name') || _s('name') || '',
    sito: _s('sito') || _s('website') || '',
    telefono: _s('telefono') || _s('phone') || '',
    email: _cleanEmail(_s('email') || ''),
    citta: _extractCity(),
    categoria: _s('categoria') || _s('category') || '',
    instagram: _s('instagram') || '',
  } : {
    ...lead,
    azienda: _s('business_name') || _s('name') || '',
    nome: _s('business_name') || _s('name') || '',
    sito: _s('website') || '',
    telefono: _s('phone') || '',
    email: _cleanEmail(_s('email') || ''),
    citta: _extractCity(),
    categoria: _s('category') || '',
    instagram: _s('instagram') || '',
  }

  // Always ensure technical fields are populated
  if (base.tech_stack && base.technical_report && base.meta_pixel !== undefined) return base

  const metaPixel = base.meta_pixel ?? audit.has_facebook_pixel ?? false
  const gtm = base.google_tag_manager ?? audit.has_gtm ?? false
  const ssl = base.ssl ?? audit.has_ssl ?? true
  const googleAds = base.google_ads ?? audit.has_google_ads ?? false
  const mobileResp = audit.is_mobile_responsive ?? true
  const missingIg = audit.missing_instagram ?? false
  const seoDis = audit.seo_disaster ?? false
  const hasDmarc = audit.has_dmarc ?? true
  const htmlErr = audit.html_errors ?? false
  const ga4 = base.google_analytics ?? audit.has_ga4 ?? false

  return {
    ...base,
    meta_pixel: metaPixel,
    google_tag_manager: gtm,
    ssl,
    google_ads: googleAds,
    google_analytics: ga4,
    tech_stack: base.tech_stack ?? (() => {
      const ts: string[] = []
      if (!metaPixel) ts.push('No Pixel')
      if (!gtm) ts.push('No GTM')
      if (ssl === false) ts.push('No SSL')
      if (!googleAds) ts.push('No Google Ads')
      if (!ga4) ts.push('No Analytics')
      if (!mobileResp) ts.push('No Mobile')
      if (missingIg) ts.push('No Instagram')
      return ts
    })(),
    technical_report: base.technical_report ?? {
      seo_disaster: seoDis,
      has_dmarc: hasDmarc,
      has_google_ads: googleAds,
      has_ga4: ga4,
      html_errors: htmlErr,
    },
  }
}

function deduplicateResults(items: unknown[]): unknown[] {

  const seen = new Map<string, unknown>()
  const domainToKey = new Map<string, string>()

  for (const item of items) {

    const obj = item as any

    // Split phone on common separators ( / , ; | ) and use the first valid chunk
    const rawPhone = (obj.telefono || obj.phone || '').toString()
    const phoneParts = rawPhone.split(/[\/,;|]+/)
    let phone = ''
    for (const part of phoneParts) {
      const digits = part.replace(/\D/g, '').replace(/^(39|0039)/, '')
      if (digits.length >= 8) { phone = digits.slice(-9); break }
    }

    const name = (obj.azienda || obj.nome || obj.company || '').toLowerCase().trim().slice(0, 20)

    const rawSite = (obj.sito || obj.website || '').toString().toLowerCase().trim()
    const domain = rawSite.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()

    // Build primary key: phone > domain > name
    const phoneKey = phone && phone.length >= 8 ? `tel:${phone}` : ''
    const webKey = domain ? `web:${domain}` : ''
    const nameKey = name ? `name:${name}` : ''

    // Check duplicate by domain (catches multiple Maps listings sharing one website)
    if (webKey && domainToKey.has(webKey)) {
      const existingMapKey = domainToKey.get(webKey)!
      const existing = seen.get(existingMapKey) as any
      if (existing) {
        const isReal = (v: any) => v && v !== 'N/D' && v !== 'N/A' && v !== 'n/d'
        const existingScore = [existing.email, existing.sito, existing.instagram, existing.rating].filter(isReal).length
        const newScore = [obj.email, obj.sito, obj.instagram, obj.rating].filter(isReal).length
        if (newScore >= existingScore) seen.set(existingMapKey, item)
      }
      continue
    }

    // Check duplicate by phone
    if (phoneKey && seen.has(phoneKey)) {
      const existing = seen.get(phoneKey) as any
      const isReal2 = (v: any) => v && v !== 'N/D' && v !== 'N/A' && v !== 'n/d'
      const existingScore = [existing.email, existing.sito, existing.instagram, existing.rating].filter(isReal2).length
      const newScore = [obj.email, obj.sito, obj.instagram, obj.rating].filter(isReal2).length
      if (newScore >= existingScore) seen.set(phoneKey, item)
      if (webKey) domainToKey.set(webKey, phoneKey)
      continue
    }

    // New unique lead
    const primaryKey = phoneKey || webKey || nameKey || `uid:${Math.random()}`

    if (!primaryKey || primaryKey === 'tel:' || primaryKey === 'web:' || primaryKey === 'name:') {

      seen.set(`uid:${Math.random()}`, item)

      continue

    }

    seen.set(primaryKey, item)
    if (webKey) domainToKey.set(webKey, primaryKey)

  }
  return Array.from(seen.values())

}



function _isRealEmail(v: any): boolean {
  if (!v || typeof v !== 'string') return false
  const e = v.trim().toLowerCase()
  if (!e || ['n/d','n/a','none','null'].includes(e)) return false
  const atIdx = e.indexOf('@')
  if (atIdx < 1) return false
  const domain = e.slice(atIdx + 1)
  return !_FAKE_EMAIL_DOMAINS.has(domain)
}
function _hasContact(lead: any): boolean {
  const _isVal = (v: any) => v && typeof v === 'string' && !['n/d','n/a','none','null',''].includes(v.trim().toLowerCase())
  return _isVal(lead?.telefono ?? lead?.phone) || _isRealEmail(lead?.email)
}

function _isVisibleBusinessLead(lead: any): boolean {
  if (_hasContact(lead)) return true
  const _isVal = (v: any) => v && typeof v === 'string' && !['n/d','n/a','none','null',''].includes(v.trim().toLowerCase())
  const name = lead?.azienda ?? lead?.nome ?? lead?.business_name ?? lead?.name
  const website = lead?.sito ?? lead?.website
  const address = lead?.indirizzo ?? lead?.address
  return _isVal(name) && (_isVal(website) || _isVal(address))
}

function buildTechFilter(q: string): ((l: any) => boolean) | null {
  const filters: Array<(l: any) => boolean> = []
  const ql = q.toLowerCase()
  if (/errori?\s*(seo|html)|seo\s*error|con\s*errori/i.test(ql))
    filters.push((l) => {
      const tr = l.technical_report || {}
      const stack = Array.isArray(l.tech_stack) ? l.tech_stack.join(' ').toLowerCase() : ''
      const htmlErr = tr.html_errors
      const hasHtmlErrors = htmlErr === true || (typeof htmlErr === 'number' && htmlErr > 0)
      return tr.seo_disaster === true || hasHtmlErrors || stack.includes('disastro seo') || stack.includes('seo error')
    })
  if (/senza\s*(meta\s*)?pixel|no\s*pixel/i.test(ql))
    filters.push((l) => l.meta_pixel !== true)
  if (/senza\s*gtm|no\s*gtm|senza\s*tag\s*manager/i.test(ql))
    filters.push((l) => l.google_tag_manager !== true)
  if (/senza\s*ssl|no\s*ssl/i.test(ql))
    filters.push((l) => l.ssl === false)
  if (/senza\s*google\s*ads|no\s*google\s*ads|senza\s*ads/i.test(ql))
    filters.push((l) => l.google_ads !== true && (l.technical_report?.has_google_ads !== true))
  if (/senza\s*instagram|no\s*instagram/i.test(ql))
    filters.push((l) => {
      const ig = (l.instagram || '').trim()
      return !ig || ig === 'N/D'
    })
  if (/senza\s*(google\s*)?analytics|no\s*analytics|senza\s*ga4|no\s*ga4/i.test(ql))
    filters.push((l) => l.google_analytics !== true && (l.technical_report?.has_ga4 !== true))
  if (/sito\s*lento|slow\s*(site|speed)/i.test(ql))
    filters.push((l) => {
      const spd = l.technical_report?.load_speed_s ?? l.technical_report?.load_speed_seconds
      return typeof spd === 'number' && spd > 3
    })
  if (/senza\s*(sito|website)|no\s*(web|website|sito)/i.test(ql))
    filters.push((l) => {
      const s = (l.sito || l.website || '').trim()
      return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
    })
  if (filters.length === 0) return null
  // Prerequisite: if query needs web-tech info (not "senza sito"), exclude leads without websites
  const needsWebsite = !(/senza\s*(sito|website)|no\s*(web|website|sito)/i.test(ql)) &&
    /errori|seo|pixel|gtm|tag.manager|ssl|google.ads|ads|analytics|ga4|lento|slow/i.test(ql)
  return (lead: any) => {
    if (needsWebsite) {
      const s = (lead.sito || lead.website || '').trim()
      if (!s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d') return false
    }
    return filters.some(f => f(lead))
  }
}

// Helper: safely convert any GPT value to a displayable string
function safeStr(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(item => typeof item === 'string' ? item : typeof item === 'object' ? Object.values(item).filter(Boolean).join(' — ') : String(item)).join(', ')
  if (typeof v === 'object') return Object.values(v).filter(Boolean).join(' — ')
  return String(v)
}

/**
 * Verifica se un numero è un CELLULARE italiano valido (per badge WhatsApp).
 *
 * Mobili italiani: prefisso 3 + cifra 2-9 (32X-39X) + 8 cifre = 10 cifre totali.
 * NON sono cellulari: 30X, 31X (riservati a operatori e numerazioni speciali),
 * né numeri che iniziano con 0 (fisso) o numerazioni speciali.
 *
 * Esempi:
 *   "+39 348 1234567"   → true  (mobile valido)
 *   "390112970547"      → false (= +39 011 297 0547, fisso Torino — bug visto su Carpenteria Corona)
 *   "393348012345"      → true  (= +39 334 801 2345, mobile)
 *   "011 772 7037"      → false (fisso Torino)
 *   "800 123 456"       → false (numero verde)
 */
function isItalianMobile(rawPhone: string | null | undefined): boolean {
  if (!rawPhone || typeof rawPhone !== 'string') return false
  // Tieni solo cifre e + iniziale
  const cleaned = rawPhone.replace(/[^\d+]/g, '')
  // Strip + iniziale
  const noPlus = cleaned.replace(/^\+/, '')
  // Strip prefisso internazionale 39 o 0039 SOLO se la lunghezza totale è coerente
  // (39 da solo + 10 cifre mobile = 12; 0039 + 10 mobile = 14)
  let core = noPlus
  if (noPlus.startsWith('0039') && noPlus.length === 14) core = noPlus.slice(4)
  else if (noPlus.startsWith('39') && noPlus.length === 12) core = noPlus.slice(2)
  // Mobile valido: 3 + cifra 2-9 + 8 cifre = 10 totali
  return /^3[2-9]\d{8}$/.test(core)
}

/**
 * Restituisce il numero WhatsApp in formato corretto (solo cifre, con prefisso 39).
 * Ritorna null se il numero non è un cellulare valido.
 */
function whatsAppLink(rawPhone: string | null | undefined): string | null {
  if (!isItalianMobile(rawPhone)) return null
  const cleaned = String(rawPhone).replace(/[^\d+]/g, '').replace(/^\+/, '')
  // Assicura che inizi con 39 (prefisso internazionale richiesto da wa.me)
  if (cleaned.startsWith('0039') && cleaned.length === 14) return cleaned.slice(2) // 0039XXX → 39XXX
  if (cleaned.startsWith('39') && cleaned.length === 12) return cleaned
  // Pure 10 digits mobile → prepend 39
  if (/^3[2-9]\d{8}$/.test(cleaned)) return `39${cleaned}`
  return null
}

// Helper: check if a value is a real displayable value (not null/undefined/"null"/"N/D" etc)
const NULL_DISPLAY = ['null', 'undefined', 'n/d', 'n/a', 'non disponibile', 'non specificato', '@null']
function hasValue(v: any): boolean {
  if (v === null || v === undefined || v === '' || v === 0) return false
  if (typeof v === 'string' && NULL_DISPLAY.includes(v.toLowerCase().trim())) return false
  return true
}

export default function DashboardShell() {

  const { credits, setCredits } = useDashboard()
  const { error: toastError, info: toastInfo, success: toastSuccess } = useToast()

  // Keep a ref for credits so polling closures always see latest value
  const creditsRef = useRef(credits)
  useEffect(() => { creditsRef.current = credits }, [credits])

  // Helper: deduct N credits via API and update state/ref
  const deductCredits = async (amount: number): Promise<number> => {
    if (amount <= 0) return creditsRef.current
    try {
      const res = await fetch('/api/use-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const data = await res.json()
      if (res.ok && typeof data.credits === 'number') {
        creditsRef.current = data.credits
        setCredits(data.credits)
        return data.credits
      }
    } catch {}
    return creditsRef.current
  }

  const supabase = useMemo(() => createClient(), [])

  const pollRef = useRef<number | null>(null)

  const searchIdRef = useRef<string | null>(null)



  const [isRestored, setIsRestored] = useState(false)

  const [query, setQuery] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [maxLeads, setMaxLeads] = useState(10)

  const [isLoading, setIsLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [results, setResults] = useState<unknown[]>([])

  const [activeFilters, setActiveFilters] = useState<Record<string, unknown> | null>(null)

  const [aiDebug, setAiDebug] = useState<unknown>(null)

  // Restore from sessionStorage after mount (batched with setIsRestored)
  useEffect(() => {
    try {
      const savedQuery = sessionStorage.getItem('ckb_query')
      if (savedQuery) setQuery(savedQuery)
      const savedResults = sessionStorage.getItem('ckb_results')
      if (savedResults) setResults((JSON.parse(savedResults) as any[]).filter(_isVisibleBusinessLead))
      const savedFilters = sessionStorage.getItem('ckb_filters')
      if (savedFilters) setActiveFilters(JSON.parse(savedFilters))
      const savedAiDebug = sessionStorage.getItem('ckb_aiDebug')
      if (savedAiDebug) setAiDebug(JSON.parse(savedAiDebug))
      const savedSearchId = sessionStorage.getItem('ckb_searchId')
      if (savedSearchId) { setCurrentSearchId(savedSearchId); searchIdRef.current = savedSearchId }
    } catch {}
    setIsRestored(true)
  }, [])

  const [aiAnalyzing, setAiAnalyzing] = useState(false)

  const [pendingJobId, setPendingJobId] = useState<string | null>(null)

  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'pending' | 'done'>('idle')

  const [currentJobId, setCurrentJobId] = useState<string | null>(null)

  const [isScraping, setIsScraping] = useState(false)

  // Persist search state to sessionStorage (only after restore is complete)
  useEffect(() => {
    if (!isRestored) return
    sessionStorage.setItem('ckb_query', query)
  }, [query, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_results', JSON.stringify(results)) } catch {}
  }, [results, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_filters', JSON.stringify(activeFilters)) } catch {}
  }, [activeFilters, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_aiDebug', JSON.stringify(aiDebug)) } catch {}
  }, [aiDebug, isRestored])

  const [searchMode, setSearchMode] = useState<'maps' | 'database' | 'ambiente' | 'azienda' | 'referente' | 'dipendente'>('maps')
  const [companySearchQuery, setCompanySearchQuery] = useState('')
  const [companySearchLoading, setCompanySearchLoading] = useState(false)
  const [companySearchResult, setCompanySearchResult] = useState<any>(null)
  const [companySearchError, setCompanySearchError] = useState<string | null>(null)
  const [personSearchQuery, setPersonSearchQuery] = useState('')
  const [personSearchLoading, setPersonSearchLoading] = useState(false)
  const [personSearchResult, setPersonSearchResult] = useState<any>(null)
  const [personSearchError, setPersonSearchError] = useState<string | null>(null)
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('')
  const [employeeSearchLoading, setEmployeeSearchLoading] = useState(false)
  const [employeeSearchResult, setEmployeeSearchResult] = useState<any>(null)
  const [employeeSearchError, setEmployeeSearchError] = useState<string | null>(null)
  const [autoScrapeTriggered, setAutoScrapeTriggered] = useState(false)
  const [autoScrapeLoading, setAutoScrapeLoading] = useState(false)
  const [autoScrapeMessage, setAutoScrapeMessage] = useState<string | null>(null)
  const prevQueryRef = useRef('')
  const autoscrapePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resultsCountRef = useRef(0)
  const resultsArrRef = useRef<unknown[]>([])

  // ── Deep-link supporto per Insurance Prospezione ──
  // Se l'URL contiene ?prefill_company=<piva|ragionesociale>, attiva la ricerca
  // azienda e auto-esegue il lookup (utile quando arriva da /dashboard/insurance-prospezione).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const prefill = params.get('prefill_company')
    if (!prefill) return

    setSearchMode('azienda')
    setCompanySearchQuery(prefill)
    // Pulisco l'URL per evitare re-trigger su refresh
    window.history.replaceState({}, '', window.location.pathname)

    // Auto-trigger lookup dopo che lo state è stabile
    ;(async () => {
      setCompanySearchLoading(true)
      setCompanySearchError(null)
      setCompanySearchResult(null)
      try {
        const res = await fetch('/api/company-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: prefill }),
        })
        const data = await res.json()
        if (data.error) setCompanySearchError(data.error)
        else setCompanySearchResult(data)
      } catch {
        setCompanySearchError('Errore di connessione. Riprova.')
      } finally {
        setCompanySearchLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const arr = Array.isArray(results) ? results : []
    resultsCountRef.current = arr.length
    resultsArrRef.current = arr
  }, [results])

  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query
      setAutoScrapeTriggered(false)
      setAutoScrapeLoading(false)
      setAutoScrapeMessage(null)
      if (autoscrapePollRef.current) {
        clearInterval(autoscrapePollRef.current)
        autoscrapePollRef.current = null
      }
    }
    console.log('[AUTO-SCRAPE-CHECK]', {
      resultsLen: Array.isArray(results) ? results.length : 0,
      maxLeads,
      autoScrapeTriggered,
      isLoading,
      isScraping,
      query: query.slice(0, 30),
      prevQuery: prevQueryRef.current?.slice(0, 30),
    })
    if (!Array.isArray(results) || results.length === 0) {
      setAutoScrapeTriggered(false)
      return
    }
    // Don't auto-scrape if we already have enough leads
    if (results.length >= maxLeads) return
    if (autoScrapeTriggered && prevQueryRef.current === query) return
    if (isLoading) return
    // Don't auto-scrape if the main search already has a scrape job running
    if (isScraping) return
    console.log('[AUTO-SCRAPE] ✅ All checks passed, will trigger in 1.5s')

    const triggerAutoScrape = async () => {
      try {
        setAutoScrapeTriggered(true)
        setAutoScrapeLoading(true)
        setAutoScrapeMessage(null)

        const words = query.trim().split(/\s+/)
        // Prefer 'a'/'in' over 'di' — 'di' is often part of category ("negozi di elettronica")
        const primaryCityKw = ['a', 'in', 'nel', 'nella', 'nello', 'negli', 'nelle']
        const fallbackCityKw = ['di']
        let category = ''
        let city = ''
        let cityIndex = -1
        // First pass: look for primary city keywords (a, in, nel...)
        for (let i = 0; i < words.length; i++) {
          if (primaryCityKw.includes(words[i].toLowerCase()) && i < words.length - 1) {
            cityIndex = i
            break
          }
        }
        // Fallback: if no primary keyword found, try 'di' (but only if it's not immediately after index 0)
        if (cityIndex < 0) {
          for (let i = 2; i < words.length; i++) {
            if (fallbackCityKw.includes(words[i].toLowerCase()) && i < words.length - 1) {
              cityIndex = i
              break
            }
          }
        }
        const stopWords = ['senza', 'con', 'no', 'non', 'solo', 'cerca', 'vicino', 'zona', 'che', 'hanno', 'e']
        // Filter words: these are part of search filters, not category/city
        const filterWords = [
          'sito', 'website', 'pixel', 'meta', 'gtm', 'tag', 'manager', 'ssl',
          'google', 'ads', 'instagram', 'ig', 'facebook', 'fb', 'tiktok',
          'dmarc', 'spf', 'spam', 'errori', 'seo', 'html', 'lento', 'veloce',
          'mobile', 'analytics', 'ga4', 'responsive',
        ]
        if (cityIndex >= 0) {
          // Strip filter/stop words from category too
          const catWords = words.slice(0, cityIndex)
          const catStopIdx = catWords.findIndex(w => stopWords.includes(w.toLowerCase()))
          category = catStopIdx >= 0 ? catWords.slice(0, catStopIdx).join(' ') : catWords.join(' ')
          // Strip filter words from city
          const cityWords = words.slice(cityIndex + 1)
          const stopIndex = cityWords.findIndex(w => stopWords.includes(w.toLowerCase()) || filterWords.includes(w.toLowerCase()))
          city = stopIndex >= 0 ? cityWords.slice(0, stopIndex).join(' ') : cityWords.join(' ')
        } else if (words.length >= 2) {
          // Strip filter/stop words from end
          const catStopIdx2 = words.findIndex(w => stopWords.includes(w.toLowerCase()))
          if (catStopIdx2 > 0) {
            category = words.slice(0, catStopIdx2).join(' ')
            city = 'Milano'
          } else {
            city = words[words.length - 1]
            category = words.slice(0, -1).join(' ')
          }
        } else {
          category = words[0] || ''
          city = 'Milano'
        }
        if (!category || !city) {
          setAutoScrapeLoading(false)
          return
        }

        // Detect "senza sito" for filtering in auto-scrape polling
        const isNoWebsiteQuery = /senza\s*(sito|website)|no\s*(web|website|sito)|manca\s*(il\s+)?sito|privo\s+di\s+sito/i.test(query)

        // If we already have enough leads, skip auto-scrape
        if (resultsCountRef.current >= maxLeads) {
          setAutoScrapeLoading(false)
          return
        }

        // Helper: trigger one scrape job via /api/trigger-scrape and poll via /api/check-scrape-job
        const runOneScrapeJob = async (offset: number = 0): Promise<boolean> => {
          const needed = maxLeads - resultsCountRef.current
          if (needed <= 0) return true
          const batchSize = Math.max(needed * 2, 40)
          const startResultsCount = resultsCountRef.current

          let jobId: string | null = null
          try {
            const scrapeResp = await fetch('/api/trigger-scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ category, city, num_results: batchSize, offset })
            })
            if (scrapeResp.ok) {
              const scrapeData = await scrapeResp.json().catch(() => ({}))
              jobId = (scrapeData as any)?.job_id ?? null
            }
            console.log('[AUTO-SCRAPE] trigger:', { jobId, category, city, batchSize, needed })
          } catch (e) {
            console.warn('[AUTO-SCRAPE] trigger error:', e)
          }

          if (!jobId) {
            console.warn('[AUTO-SCRAPE] No jobId returned')
            return false
          }

          return new Promise<boolean>((resolve) => {
            let pollCount = 0
            const maxPolls = 120
            let stalePolls = 0
            let lastResultCount = 0
            let noGrowthPolls = 0
            let lastUiCount = resultsCountRef.current
            const maxNoGrowthPolls = 18

            if (autoscrapePollRef.current) clearInterval(autoscrapePollRef.current)
            const pollInterval = setInterval(async () => {
              pollCount++
              if (pollCount >= maxPolls) {
                clearInterval(pollInterval)
                autoscrapePollRef.current = null
                if (resultsCountRef.current === startResultsCount && resultsCountRef.current < maxLeads) {
                  setAutoScrapeMessage('Nessun nuovo lead utile trovato automaticamente. Prova "Trova Aziende" per ampliare di più.')
                }
                resolve(resultsCountRef.current >= maxLeads)
                return
              }

              try {
                const jobRes = await fetch(`/api/check-scrape-job?job_id=${jobId}`)
                if (!jobRes.ok) return
                const jobData = await jobRes.json()
                const scrapeResults = Array.isArray(jobData.results) ? jobData.results : []

                if (pollCount <= 5 || pollCount % 10 === 0) {
                  console.log(`[AUTO-SCRAPE] poll #${pollCount}: status=${jobData.status} results=${scrapeResults.length} current=${resultsCountRef.current}/${maxLeads}`)
                }

                if (scrapeResults.length > 0) {
                  if (scrapeResults.length === lastResultCount) stalePolls++
                  else { stalePolls = 0; lastResultCount = scrapeResults.length }
                }

                if (scrapeResults.length > 0 && creditsRef.current > 0) {
                  const normalized = scrapeResults.map(normalizeLeadFields)
                  const curArr = resultsArrRef.current
                  const remaining = maxLeads - curArr.length
                  if (remaining <= 0) {
                    clearInterval(pollInterval)
                    autoscrapePollRef.current = null
                    resolve(true)
                    return
                  }
                  const existingKeys = new Set(
                    (curArr as any[]).map((r: any) =>
                      (r.sito || r.website || r.nome || r.azienda || r.name || '').toLowerCase()
                    )
                  )
                  let newLeads = normalized.filter((r: any) => {
                    const key = (r.sito || r.website || r.nome || r.azienda || r.name || '').toLowerCase()
                    return key && !existingKeys.has(key)
                  })
                  // Apply "senza sito" filter — use isNoWebsiteQuery from query closure
                  if (isNoWebsiteQuery) {
                    newLeads = newLeads.filter((r: any) => {
                      const s = (r.sito || r.website || '').trim()
                      return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
                    })
                  }
                  const allowed = newLeads.slice(0, Math.min(remaining, creditsRef.current))
                  if (allowed.length > 0) {
                    const prevLen = curArr.length
                    const updated = (deduplicateResults([...curArr, ...allowed]) as any[]).filter(_isVisibleBusinessLead)
                    resultsArrRef.current = updated
                    resultsCountRef.current = updated.length
                    setResults(updated)
                    if (updated.length > prevLen) setAutoScrapeMessage(null)
                    const actualNewCount = updated.length - prevLen
                    if (actualNewCount > 0) deductCredits(actualNewCount)
                    if (updated.length >= maxLeads) {
                      clearInterval(pollInterval)
                      autoscrapePollRef.current = null
                      resolve(true)
                      return
                    }
                  }
                }

                if (resultsCountRef.current === lastUiCount) noGrowthPolls++
                else {
                  noGrowthPolls = 0
                  lastUiCount = resultsCountRef.current
                }

                if (jobData.status === 'completed' || jobData.status === 'error' || stalePolls >= 12 || noGrowthPolls >= maxNoGrowthPolls) {
                  console.log(`[AUTO-SCRAPE] done: status=${jobData.status} results=${scrapeResults.length} total=${resultsCountRef.current}/${maxLeads}`)
                  clearInterval(pollInterval)
                  autoscrapePollRef.current = null
                  if (resultsCountRef.current === startResultsCount && resultsCountRef.current < maxLeads) {
                    setAutoScrapeMessage('Nessun nuovo lead utile trovato automaticamente. Prova "Trova Aziende" per ampliare di più.')
                  } else if (resultsCountRef.current < maxLeads) {
                    setAutoScrapeMessage('Ricerca automatica completata. Nessun altro lead utile trovato al momento.')
                  }
                  resolve(resultsCountRef.current >= maxLeads)
                  return
                }
              } catch (e) {
                console.error('[AUTO-SCRAPE] poll error:', e)
              }
            }, 5000)
            autoscrapePollRef.current = pollInterval
          })
        }

        // Trigger at most 1 extra scrape job (avoid flooding the worker queue)
        if (resultsCountRef.current < maxLeads && creditsRef.current > 0) {
          await runOneScrapeJob(0)
        }

        setAutoScrapeLoading(false)
      } catch (e) {
        console.error('auto-scrape error:', e)
      }
    }

    const timer = setTimeout(triggerAutoScrape, 1500)
    return () => {
      clearTimeout(timer)
    }
  }, [results, autoScrapeTriggered, isLoading, isScraping, query, maxLeads])

  // Cleanup poll on unmount only
  useEffect(() => {
    return () => {
      if (autoscrapePollRef.current) {
        clearInterval(autoscrapePollRef.current)
        autoscrapePollRef.current = null
      }
    }
  }, [])

  const [scrapeJobId, setScrapeJobId] = useState<string | null>(null)

  const [isSaveToEnvOpen, setIsSaveToEnvOpen] = useState(false)

  const [saveToEnvSearchId, setSaveToEnvSearchId] = useState<string | null>(null)

  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null)

  useEffect(() => {
    if (!isRestored) return
    if (currentSearchId) sessionStorage.setItem('ckb_searchId', currentSearchId)
  }, [currentSearchId, isRestored])

  const deriveSearchIdFromResults = (items: unknown[]): string | null => {

    try {

      const counts = new Map<string, number>()

      for (const it of Array.isArray(items) ? (items as any[]) : []) {

        const id = typeof (it as any)?.__ckb_search_id === 'string' ? String((it as any).__ckb_search_id) : ''

        if (!id) continue

        counts.set(id, (counts.get(id) || 0) + 1)

      }

      let bestId: string | null = null

      let bestCount = 0

      for (const [id, c] of counts.entries()) {

        if (c > bestCount) {

          bestCount = c

          bestId = id

        }

      }

      return bestId

    } catch {

      return null

    }

  }

  const effectiveSearchId =

    searchIdRef.current ??

    currentSearchId ??

    (Array.isArray(results) ? deriveSearchIdFromResults(results) : null) ??

    scrapeJobId ??

    pendingJobId ??

    currentJobId

  const resolveCompletedSearchId = async (filters: any) => {

    try {

      const city = typeof filters?.citta === 'string' ? filters.citta.trim() : typeof filters?.city === 'string' ? filters.city.trim() : ''

      const category =

        typeof filters?.categoria === 'string'

          ? filters.categoria.trim()

          : typeof filters?.category === 'string'

            ? filters.category.trim()

            : ''

      if (!city && !category) return null

      let q = supabase

        .from('searches')

        .select('id, created_at')

        .eq('status', 'completed')

      if (city) q = q.ilike('location', `%${city}%`)

      if (category) q = q.ilike('category', `%${category}%`)

      const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()

      return (data as any)?.id ? String((data as any).id) : null

    } catch {

      return null

    }

  }



  useEffect(() => {

    return () => {

      if (pollRef.current != null) {

        window.clearInterval(pollRef.current)

        pollRef.current = null

      }

    }

  }, [])



  useEffect(() => {

    if (searchState !== 'pending' || !currentJobId) return

    const _pollStart1 = Date.now()
    const POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes max

    const interval = window.setInterval(async () => {

      // Timeout: stop polling after 10 min, show whatever we have
      if (Date.now() - _pollStart1 > POLL_TIMEOUT_MS) {
        window.clearInterval(interval)
        setSearchState('done')
        console.log('[poll] timeout reached for currentJobId, stopping')
        return
      }

      try {

        const { data } = await supabase

          .from('searches')

          .select('status, results')

          .eq('id', currentJobId)

          .single()

        if (data?.status === 'completed') {

          window.clearInterval(interval)

          let nextResults =

            typeof (data as any).results === 'string'

              ? JSON.parse((data as any).results)

              : (data as any).results

          let arr = Array.isArray(nextResults) ? nextResults : nextResults ? [nextResults] : []

          // Apply has_website filter from activeFilters (e.g. "senza sito")
          if ((activeFilters as any)?.has_website === false) {
            arr = arr.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
            })
          } else if ((activeFilters as any)?.has_website === true) {
            arr = arr.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
            })
          }

          // Apply tech filter from query (errori seo, senza pixel, etc.)
          const _tf1 = buildTechFilter(query)
          if (_tf1) arr = arr.map(normalizeLeadFields).filter(_tf1) as any[]

          // Merge with existing results (never reduce count)
          const existingArr = resultsArrRef.current as any[]
          const mergedArr = (deduplicateResults([...existingArr, ...((_tf1 ? arr : arr.map(normalizeLeadFields)) as any[])]) as any[]).filter(_isVisibleBusinessLead)
          setResults(mergedArr.length >= existingArr.length ? mergedArr : existingArr)

          setSearchState('done')

        }

      } catch (e) {

        console.log('[poll] error:', e)

      }

    }, 5000)



    return () => window.clearInterval(interval)

  }, [searchState, currentJobId, supabase])



  useEffect(() => {

    if (!isScraping || !scrapeJobId) return

    const _pollStart2 = Date.now()
    const POLL_TIMEOUT_MS2 = 12 * 60 * 1000 // 12 minutes max
    let _pendingTooLong = false

    const interval = window.setInterval(async () => {

      const elapsed = Date.now() - _pollStart2

      // Timeout: stop polling after 12 min, show whatever we have
      if (elapsed > POLL_TIMEOUT_MS2) {
        window.clearInterval(interval)
        setIsScraping(false)
        setSearchState('done')
        console.log('[poll] timeout reached for scrapeJobId, stopping')
        const currentResults = resultsArrRef.current || []
        if (currentResults.length > 0) {
          toastSuccess(`Ricerca completata con ${currentResults.length} risultati parziali.`, 'Timeout raggiunto')
        } else {
          toastError('La ricerca ha impiegato troppo tempo. Riprova più tardi.', 'Timeout ricerca')
        }
        return
      }

      // If still pending after 5 min, the worker might be down — warn user
      if (elapsed > 5 * 60 * 1000 && !_pendingTooLong) {
        _pendingTooLong = true
        toastInfo('Il worker sta impiegando più del previsto. Attendere ancora un momento...', 'Scraping lento')
      }

      try {

        const { data } = await supabase

          .from('searches')

          .select('status, results')

          .eq('id', scrapeJobId)

          .single()

        const parsed = Array.isArray((data as any)?.results) ? (data as any).results : (() => { try { return JSON.parse(((data as any)?.results as any) || '[]') } catch { return [] } })()

        // Helper: apply has_website filter + tech filters from query
        const _tf2 = buildTechFilter(query)
        const applyAllFilters = (leads: any[]) => {
          let out = leads
          if ((activeFilters as any)?.has_website === false) {
            out = out.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
            })
          } else if ((activeFilters as any)?.has_website === true) {
            out = out.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
            })
          }
          if (_tf2) out = out.filter(_tf2)
          return out
        }

        if (data?.status === 'completed') {

          window.clearInterval(interval)

          setIsScraping(false)

          // Merge completed results with existing (never reduce count, preserve audited emails)
          const normalized = deduplicateResults(applyAllFilters((parsed || []).map(normalizeLeadFields))) as any[]
          const existing = resultsArrRef.current as any[]
          const merged = (deduplicateResults([...existing, ...normalized]) as any[]).filter(_isVisibleBusinessLead)
          const cappedByMax = merged.slice(0, maxLeads)
          const cappedByCredits = cappedByMax.slice(0, creditsRef.current)
          setResults(cappedByCredits)
          const newCount = Math.max(0, cappedByCredits.length - existing.length)
          if (newCount > 0) {
            deductCredits(newCount)
          }

        } else if (data?.status === 'error') {

          window.clearInterval(interval)
          setIsScraping(false)
          setSearchState('done')
          // Show any partial results if available
          if (Array.isArray(parsed) && parsed.length > 0) {
            const normalized = deduplicateResults(applyAllFilters(parsed.map(normalizeLeadFields))) as any[]
            const existing = resultsArrRef.current as any[]
            const merged = (deduplicateResults([...existing, ...normalized]) as any[]).filter(_hasContact)
            const cappedByMax = merged.slice(0, maxLeads)
            const cappedByCredits = cappedByMax.slice(0, creditsRef.current)
            setResults(cappedByCredits)
          }
          toastError('La ricerca ha riscontrato un errore. Riprova con una query diversa.', 'Errore ricerca')

        } else if ((data?.status === 'processing' || data?.status === 'pending_user' || data?.status === 'pending') && Array.isArray(parsed) && parsed.length > 0) {

          // Merge intermediate results with existing (never reduce count, preserve audited emails)
          const normalized = deduplicateResults(applyAllFilters(parsed.map(normalizeLeadFields))) as any[]
          const existing = resultsArrRef.current as any[]
          const merged = (deduplicateResults([...existing, ...normalized]) as any[]).filter(_isVisibleBusinessLead)
          const cappedByMax = merged.slice(0, maxLeads)
          const cappedByCredits = cappedByMax.slice(0, creditsRef.current)
          setResults(cappedByCredits)

        }

      } catch (e) {

        console.log('[poll] error:', e)

      }

    }, 3000)



    return () => window.clearInterval(interval)

  }, [isScraping, scrapeJobId, supabase])



  useEffect(() => {

    if (currentSearchId) return

    if (!Array.isArray(results) || results.length === 0) return

    const derived = deriveSearchIdFromResults(results)

    if (derived) {

      setCurrentSearchId(derived)

      searchIdRef.current = derived

    }

  }, [currentSearchId, results])



  const runSearch = async (overrideQuery?: string) => {

    setError(null)



    const q = (overrideQuery ?? query).trim()

    if (!q) {

      const msg = 'Scrivi una richiesta per avviare la ricerca.'

      setError(msg)

      toastError(msg, 'Query mancante')

      return

    }



    setIsLoading(true)

    setResults([])

    setCurrentSearchId(null)

    searchIdRef.current = null

    setAiDebug(null)

    setSearchState('searching')

    toastInfo('Ricerca in corso... sto interrogando il database.', 'Ricerca')



    try {

      const response = await textToFilterSearchAction(q)



      console.log('[CLIENT] status:', response?.status, 'jobId:', response?.jobId, 'results:', response?.results?.length)



      if (response?.status === 'pending' && response?.jobId) {

        const sid = (response as any)?.searchId ?? response.jobId

        setIsScraping(true)

        setScrapeJobId(response.jobId)

        setCurrentSearchId(sid)

        searchIdRef.current = sid

        return

      }

      const filtered = Array.isArray(response?.results) ? response.results : []

      const filters = (response as any)?.filters

      const ai_debug = (response as any)?.ai_debug

      const status = (response as any)?.status

      const jobId = (response as any)?.jobId

      const responseSearchId = (response as any)?.searchId

      const sid = typeof responseSearchId === 'string' && responseSearchId ? responseSearchId : typeof jobId === 'string' && jobId ? jobId : null



      if (status === 'pending' && typeof jobId === 'string' && jobId) {

        setIsScraping(true)

        setScrapeJobId(jobId)

        setPendingJobId(jobId)

        setCurrentSearchId(sid)

        searchIdRef.current = sid

        setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)

        setAiDebug(ai_debug ?? null)

        toastInfo('Sto analizzando in tempo reale... attendere 2-3 minuti', 'Ricerca')



        return

      }



      setPendingJobId(null)

      const displayResults = (deduplicateResults(filtered) as any[]).filter(_isVisibleBusinessLead)
      setResults(displayResults)

      setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)

      setAiDebug(ai_debug ?? null)

      if (sid) {

        setCurrentSearchId(sid)

        searchIdRef.current = sid

      } else {

        const resolved = await resolveCompletedSearchId(filters)

        setCurrentSearchId(resolved)

        searchIdRef.current = resolved

      }

      setSearchState('done')

      toastSuccess(`Trovati ${displayResults.length} risultati.`, 'Ricerca completata')

    } catch (err) {

      console.log('[DEBUG ERROR]', err)

      const message = err instanceof Error ? err.message : 'Errore durante la ricerca'

      setError(message)

      toastError(message, 'Errore')

    } finally {

      setIsLoading(false)

    }

  }



  const handleAnalyzeSite = async () => {
    let u = urlInput.trim()
    if (!u) {
      toastError('Inserisci un URL da analizzare', 'URL mancante')
      return
    }
    // Auto-prepend https:// if missing
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`
    }
    setIsLoading(true)
    setResults([])
    setSearchState('searching')
    toastInfo('Analisi del sito in corso... potrebbe richiedere fino a 2 minuti.', 'Analisi sito')
    try {
      const res = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const data = await res.json()
      if (data.success && data.lead) {
        const normalized = normalizeLeadFields(data.lead)
        setResults([normalized])
        setSearchState('done')
        toastSuccess('Analisi completata!', 'Analisi sito')
      } else {
        toastError(data.error || 'Impossibile analizzare il sito. Verifica l\'URL e riprova.', 'Errore analisi')
        setSearchState('done')
      }
    } catch (e: any) {
      console.error('[analyze site] error:', e)
      toastError('Errore di rete durante l\'analisi. Riprova.', 'Errore')
      setSearchState('done')
    } finally {
      setIsLoading(false)
    }
  }



  const processSemanticSearch = async (overrideQuery?: string) => {

    const q = (overrideQuery ?? query).trim()

    if (!q) {

      await runSearch(overrideQuery)

      return

    }



    setError(null)

    // Check credits before searching
    if (credits <= 0) {
      toastError('Hai esaurito i crediti. Effettua l\'upgrade per continuare.', 'Crediti esauriti')
      return
    }

    const effectiveMax = Math.min(maxLeads, credits)

    setIsLoading(true)

    setAiAnalyzing(true)

    setResults([])

    setCurrentSearchId(null)

    setAiDebug(null)



    try {

      const response = await processSemanticSearchAction(q)



      console.log('[CLIENT] status:', (response as any)?.status, 'jobId:', (response as any)?.jobId, 'results:', (response as any)?.results?.length)



      if ((response as any)?.status === 'pending' && (response as any)?.jobId) {

        const sid = (response as any)?.searchId ?? (response as any).jobId

        setIsScraping(true)

        setScrapeJobId((response as any).jobId)

        setCurrentSearchId(sid)

        searchIdRef.current = sid

        return

      }

      const semanticSid = typeof (response as any)?.searchId === 'string' && (response as any).searchId ? (response as any).searchId : null



      const { results: rawFiltered, filters, ai_debug } = response as any

      // Apply ALL filters before charging credits: deduplicate → contacts → tech filters → has_website → cap
      const deduplicated = deduplicateResults(Array.isArray(rawFiltered) ? rawFiltered : [])
      let filtered = (deduplicated as any[]).map(normalizeLeadFields).filter(_isVisibleBusinessLead)
      // Apply tech filters (senza pixel, senza gtm, errori seo, etc.)
      const _tfSemantic = buildTechFilter(query)
      if (_tfSemantic) filtered = filtered.filter(_tfSemantic)
      // Apply has_website filter from activeFilters
      if ((activeFilters as any)?.has_website === false) {
        filtered = filtered.filter((lead: any) => {
          const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
          return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
        })
      } else if ((activeFilters as any)?.has_website === true) {
        filtered = filtered.filter((lead: any) => {
          const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
          return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
        })
      }
      const capped = filtered.slice(0, effectiveMax)
      const leadsToCharge = capped.length

      // Deduct credits based on actual displayed leads (after contact filter)
      if (leadsToCharge > 0) {
        const creditRes = await fetch('/api/use-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: leadsToCharge }),
        })
        const creditData = await creditRes.json()
        if (creditRes.ok && typeof creditData.credits === 'number') {
          setCredits(creditData.credits)
        }
      }

      setResults(capped)

      setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)

      setAiDebug(ai_debug ?? null)

      if (semanticSid) {

        setCurrentSearchId(semanticSid)

        searchIdRef.current = semanticSid

      } else {

        const resolved = await resolveCompletedSearchId(filters)

        setCurrentSearchId(resolved)

        searchIdRef.current = resolved

      }

      setSearchState('done')

      toastSuccess(`Trovati ${capped.length} lead (${capped.length} crediti usati).`, 'Ricerca completata')

    } catch {

      await runSearch(q)

    } finally {

      setAiAnalyzing(false)

      setIsLoading(false)

    }

  }



  const handleExpandedSearchClick = async () => {

    const q = query.trim()

    if (!q) return

    setIsLoading(true)

    setError(null)

    try {

      const res = await expandAndSearch(q)

      const next = Array.isArray(res?.results) ? res.results : []

      setResults((deduplicateResults(next) as any[]).filter(_isVisibleBusinessLead))

      setSearchState('done')

    } catch (e) {

      console.log('[expanded] error:', e)

    } finally {

      setIsLoading(false)

    }

  }


  return (
    <>
      {/* ── Tab switcher ── */}
      <div className="flex items-center gap-1 mb-4 bg-slate-100 rounded-xl p-1 max-w-2xl overflow-x-auto">
        <button
          onClick={() => setSearchMode('maps')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
            searchMode === 'maps'
              ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Ricerca per Categoria e Città
        </button>
        <button
          onClick={() => setSearchMode('azienda')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
            searchMode === 'azienda'
              ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Cerca Azienda / P.IVA
        </button>
        <button
          onClick={() => setSearchMode('ambiente')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
            searchMode === 'ambiente'
              ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Ricerca Ambiente
        </button>
      </div>

      {/* ── Ricerca Referenti — RIMOSSA (i referenti si trovano da Cerca Azienda) ── */}
      {false && searchMode === 'referente' && (
        <div className="mb-6 space-y-5 bg-gradient-to-br from-white via-purple-50/30 to-violet-50/40 border border-purple-100 rounded-3xl p-7 shadow-lg shadow-purple-100/30 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-violet-500 to-fuchsia-500" />
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-extrabold flex items-center gap-2.5 text-slate-900 tracking-tight">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <Database className="w-5 h-5 text-white" />
              </span>
              Cerca Referente / Titolare
            </h2>
            <p className="text-sm text-slate-500">
              Cerca <strong>titolari di aziende</strong>, <strong>liberi professionisti</strong> o <strong>imprenditori</strong>. Restituisce contatti completi, dati aziendali, profilo assicurativo e trigger finanziari.
            </p>
            <p className="text-[10px] text-amber-700 font-semibold bg-amber-50/80 border border-amber-200/60 rounded-lg px-3 py-1.5 backdrop-blur-sm">
              Questa ricerca è pensata per titolari e liberi professionisti.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder='Es. "Marco Bianchi Allianz Milano"'
                value={personSearchQuery}
                onChange={(e) => setPersonSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('btn-person-search')?.click() }}
                className="w-full pl-10 pr-4 py-3.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-purple-400 placeholder:text-slate-400 shadow-sm"
              />
            </div>
            <button
              id="btn-person-search"
              disabled={personSearchLoading || !personSearchQuery.trim()}
              onClick={async () => {
                const q = personSearchQuery.trim()
                if (!q) return
                setPersonSearchLoading(true)
                setPersonSearchError(null)
                setPersonSearchResult(null)
                try {
                  const res = await fetch('/api/person-lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q }),
                  })
                  const data = await res.json()
                  if (data.error) {
                    setPersonSearchError(data.error)
                  } else {
                    setPersonSearchResult(data)
                    // Fetch dati aziendali in parallelo
                    const companyName = data.azienda
                    if (companyName) {
                      const cityHint = data.citta || ''
                      fetch('/api/company-lookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: `${companyName} ${cityHint}`.trim() }),
                      })
                        .then(r => r.json())
                        .then(compData => {
                          if (compData && !compData.error) {
                            // Verify the returned company actually matches the searched name
                            const foundName = (compData.ragione_sociale || compData.nome || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
                            const searchedName = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
                            // Strict match: the found name must contain the searched name OR vice versa
                            const directMatch = foundName.includes(searchedName) || searchedName.includes(foundName)
                            // Word-level match: ALL significant words from search must appear in found name
                            const searchWords = searchedName.split(/\s+/).filter((w: string) => w.length >= 3)
                            const allWordsMatch = searchWords.length > 0 && searchWords.every((w: string) => foundName.includes(w))
                            if (!directMatch && !allWordsMatch && foundName.length > 0) {
                              console.log(`[PERSON] Company mismatch: searched "${companyName}" but found "${compData.ragione_sociale}" — skipping company data`)
                              return
                            }
                            setPersonSearchResult((prev: any) => prev ? {
                              ...prev,
                              dati_azienda: {
                                ragione_sociale: compData.ragione_sociale || compData.nome || companyName,
                                partita_iva: compData.partita_iva || null,
                                forma_giuridica: compData.forma_giuridica || null,
                                codice_ateco: compData.codice_ateco || null,
                                descrizione_ateco: compData.descrizione_ateco || null,
                                fatturato: compData.fatturato || null,
                                dipendenti: compData.dipendenti || null,
                                capitale_sociale: compData.capitale_sociale || null,
                                sede_legale: compData.sede_legale || null,
                                pec: compData.pec || null,
                                telefono: compData.telefono || null,
                                cellulare: compData.cellulare || null,
                                email: compData.email || null,
                                sito: compData.sito || compData.sito_web || null,
                                titolare: compData.titolare || null,
                                persone: compData.persone || null,
                                linkedin: compData.linkedin || null,
                                instagram: compData.instagram || null,
                                facebook: compData.facebook || null,
                                utile_netto: compData.utile_netto || null,
                                classe_fatturato: compData.classe_fatturato || null,
                                anno_bilancio: compData.anno_bilancio || null,
                                anno_fondazione: compData.anno_fondazione || null,
                                indirizzo: compData.indirizzo || null,
                              },
                              telefono: prev.telefono || compData.telefono || null,
                              email: prev.email || compData.email || null,
                              sito_web: prev.sito_web || compData.sito || null,
                              partita_iva: prev.partita_iva || compData.partita_iva || null,
                              pec: prev.pec || compData.pec || null,
                            } : prev)
                          }
                        })
                        .catch(() => {})
                    }
                  }
                } catch {
                  setPersonSearchError('Errore di connessione. Riprova.')
                } finally {
                  setPersonSearchLoading(false)
                }
              }}
              className="rounded-xl bg-gradient-to-r from-purple-600 via-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-purple-500/25 disabled:opacity-50 flex items-center justify-center gap-2.5 transition-all hover:scale-[1.03] hover:shadow-2xl whitespace-nowrap"
            >
              {personSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {personSearchLoading ? 'Analisi in corso...' : 'Cerca Referente'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 rounded-full bg-slate-300" />
            nome + cognome + azienda + città &nbsp;|&nbsp; nome + professione + città
          </p>

          {personSearchError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {personSearchError}
            </div>
          )}

          {personSearchResult && (
            <div className="space-y-5">
              {/* Person header */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-0 shadow-lg shadow-slate-200/40 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-7 py-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-black text-lg shadow-lg border border-white/20">
                      {(personSearchResult.nome_completo || personSearchResult.nome_cercato || '??').split(' ').map((w: string) => w[0]).filter((_: string, i: number) => i < 2).join('').toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-xl font-extrabold text-white tracking-tight">{personSearchResult.nome_completo || personSearchResult.nome_cercato || '—'}</h3>
                      <p className="text-sm text-purple-100 font-medium">{personSearchResult.ruolo || ''} {personSearchResult.azienda ? `presso ${personSearchResult.azienda}` : ''}</p>
                    </div>
                  </div>
                </div>
                {personSearchResult.descrizione && (
                  <p className="text-sm text-slate-600 px-7 pt-4 italic">{safeStr(personSearchResult.descrizione)}</p>
                )}
                <div className="p-6 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {personSearchResult.azienda && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Azienda</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.azienda}</p>
                    </div>
                  )}
                  {personSearchResult.ruolo && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Ruolo</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.ruolo}</p>
                    </div>
                  )}
                  {personSearchResult.settore && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Settore</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.settore}</p>
                    </div>
                  )}
                  {personSearchResult.citta && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Città</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.citta}</p>
                    </div>
                  )}
                  {personSearchResult.email && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Email</p>
                      <a href={`mailto:${personSearchResult.email}`} className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.email}</a>
                    </div>
                  )}
                  {personSearchResult.telefono && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Telefono</p>
                      <div className="flex items-center gap-2">
                        <a href={`tel:${personSearchResult.telefono}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{personSearchResult.telefono}</a>
                        {whatsAppLink(personSearchResult.telefono) && (
                          <a href={`https://wa.me/${whatsAppLink(personSearchResult.telefono)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full transition-colors">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {personSearchResult.linkedin && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">LinkedIn</p>
                      <a href={personSearchResult.linkedin.startsWith('http') ? personSearchResult.linkedin : `https://${personSearchResult.linkedin}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.linkedin}</a>
                    </div>
                  )}
                  {personSearchResult.instagram && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Instagram</p>
                      <a href={personSearchResult.instagram.startsWith('http') ? personSearchResult.instagram : `https://instagram.com/${personSearchResult.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-pink-600 hover:underline">@{personSearchResult.instagram.replace(/.*instagram\.com\//, '').replace(/^@/, '').replace(/\/$/, '')}</a>
                    </div>
                  )}
                  {personSearchResult.facebook && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Facebook</p>
                      <a href={personSearchResult.facebook.startsWith('http') ? personSearchResult.facebook : `https://facebook.com/${personSearchResult.facebook}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 hover:underline">{personSearchResult.facebook.replace(/.*facebook\.com\//, 'facebook.com/')}</a>
                    </div>
                  )}
                  {(personSearchResult.twitter_x || personSearchResult.twitter) && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Twitter / X</p>
                      {(() => { const tw = personSearchResult.twitter_x || personSearchResult.twitter; return <a href={tw.startsWith('http') ? tw : `https://twitter.com/${tw.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-800 hover:underline">{tw.replace(/.*twitter\.com\//, '@').replace(/.*x\.com\//, '@')}</a> })()}
                    </div>
                  )}
                  {personSearchResult.sito_web && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Sito Web</p>
                      <a href={personSearchResult.sito_web.startsWith('http') ? personSearchResult.sito_web : `https://${personSearchResult.sito_web}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.sito_web}</a>
                    </div>
                  )}
                  {personSearchResult.partita_iva && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">P.IVA</p>
                      <p className="text-sm font-mono font-bold text-slate-800">{personSearchResult.partita_iva}</p>
                    </div>
                  )}
                  {personSearchResult.pec && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">PEC</p>
                      <a href={`mailto:${personSearchResult.pec}`} className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.pec}</a>
                    </div>
                  )}
                  {personSearchResult.indirizzo && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Indirizzo</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(personSearchResult.indirizzo)}</p>
                    </div>
                  )}
                  {personSearchResult.formazione && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Formazione</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(personSearchResult.formazione)}</p>
                    </div>
                  )}
                  {personSearchResult.esperienze_precedenti && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Esperienze Precedenti</p>
                      {typeof personSearchResult.esperienze_precedenti === 'string' ? (
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.esperienze_precedenti}</p>
                      ) : Array.isArray(personSearchResult.esperienze_precedenti) ? (
                        <div className="space-y-1">
                          {personSearchResult.esperienze_precedenti.map((e: any, i: number) => (
                            <p key={i} className="text-sm text-slate-800">
                              {typeof e === 'string' ? e : `${e.ruolo || ''} ${e.azienda ? `@ ${e.azienda}` : ''} ${e.periodo ? `(${e.periodo})` : ''}`.trim()}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-slate-800">{JSON.stringify(personSearchResult.esperienze_precedenti)}</p>
                      )}
                    </div>
                  )}
                  {personSearchResult.competenze && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Competenze</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(personSearchResult.competenze)}</p>
                    </div>
                  )}
                  {personSearchResult.anni_esperienza && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Anni Esperienza</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.anni_esperienza}</p>
                    </div>
                  )}
                  {personSearchResult.tipo_lavoro && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Tipo Lavoro</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.tipo_lavoro}</p>
                    </div>
                  )}
                  {personSearchResult.seniority && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Seniority</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.seniority}</p>
                    </div>
                  )}
                  {personSearchResult.dimensione_azienda && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Dimensione Azienda</p>
                      <p className="text-sm font-bold text-slate-800">{personSearchResult.dimensione_azienda}</p>
                    </div>
                  )}
                  {personSearchResult.tiktok && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">TikTok</p>
                      <a href={personSearchResult.tiktok.startsWith('http') ? personSearchResult.tiktok : `https://tiktok.com/@${personSearchResult.tiktok.replace('@','')}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-800 hover:underline">{personSearchResult.tiktok}</a>
                    </div>
                  )}
                  {personSearchResult.twitter_x && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">X / Twitter</p>
                      <a href={personSearchResult.twitter_x.startsWith('http') ? personSearchResult.twitter_x : `https://x.com/${personSearchResult.twitter_x.replace('@','')}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-800 hover:underline">{personSearchResult.twitter_x}</a>
                    </div>
                  )}
                  {personSearchResult.colleghi_noti && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Colleghi / Collaboratori noti</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(personSearchResult.colleghi_noti)}</p>
                    </div>
                  )}
                  {personSearchResult.legami_familiari && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Legami Familiari</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(personSearchResult.legami_familiari)}</p>
                    </div>
                  )}
                  {(personSearchResult.stato_civile || personSearchResult.figli) && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Stato Civile / Figli</p>
                      <p className="text-sm font-bold text-slate-800">{[safeStr(personSearchResult.stato_civile), safeStr(personSearchResult.figli)].filter(Boolean).join(' · ')}</p>
                    </div>
                  )}
                  {personSearchResult.note && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Note</p>
                      <p className="text-sm text-slate-700">{safeStr(personSearchResult.note)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Stima Capacità + Priorità Commerciale + Trigger Finanziari +
                  Polizze Consigliate + Rischi Professionali RIMOSSI:
                  GPT-extracted via Tavily senza verifica strutturata.
                  Un broker professionista valuta capacità di spesa dal
                  patrimonio immobiliare e dalle cariche societarie reali. */}
              {false && (personSearchResult.stima_capacita_risparmio || personSearchResult.priorita_commerciale) && (
                <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Stima Potenziale</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {personSearchResult.stima_capacita_risparmio && (
                      <div className={`rounded-lg p-3 ${personSearchResult.stima_capacita_risparmio.includes('alta') || personSearchResult.stima_capacita_risparmio.includes('molto') ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50'}`}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Capacità Risparmio</p>
                        <p className="text-sm font-bold text-emerald-800">{personSearchResult.stima_capacita_risparmio}</p>
                      </div>
                    )}
                    {personSearchResult.priorita_commerciale && (
                      <div className={`rounded-lg p-3 ${personSearchResult.priorita_commerciale.includes('caldo') ? 'bg-red-50 border border-red-200' : personSearchResult.priorita_commerciale.includes('tiepido') ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Priorità Commerciale</p>
                        <p className="text-sm font-bold">{personSearchResult.priorita_commerciale}</p>
                      </div>
                    )}
                    {personSearchResult.ambiti_protection?.length > 0 && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2 md:col-span-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Ambiti Protection</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {personSearchResult.ambiti_protection.map((a: string, i: number) => (
                            <span key={i} className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">{a}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {personSearchResult.interessi_social && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2 md:col-span-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Interessi Social</p>
                        <p className="text-sm text-slate-700">{safeStr(personSearchResult.interessi_social)}</p>
                      </div>
                    )}
                    {personSearchResult.segnali_comportamentali && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2 md:col-span-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Segnali Comportamentali</p>
                        <p className="text-sm text-slate-700">{safeStr(personSearchResult.segnali_comportamentali)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Trigger Finanziari person-lookup RIMOSSI: GPT-extracted */}
              {false && personSearchResult.trigger_finanziari?.length > 0 && (
                <div className="bg-white rounded-2xl border border-orange-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Trigger Finanziari</h4>
                  <div className="space-y-2">
                    {personSearchResult.trigger_finanziari.map((t: any, i: number) => (
                      <div key={i} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full uppercase">{t.tipo}</span>
                          {t.data_stimata && <span className="text-[10px] text-slate-500">{t.data_stimata}</span>}
                        </div>
                        <p className="text-sm text-slate-700">{t.dettaglio}</p>
                        {t.fonte && <p className="text-[10px] text-slate-400 mt-1">Fonte: {t.fonte}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dati Aziendali */}
              {personSearchResult.dati_azienda && (
                <div className="bg-white rounded-2xl border border-blue-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-500" /> Profilo Aziendale
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {personSearchResult.dati_azienda.ragione_sociale && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Ragione Sociale</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.ragione_sociale}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.partita_iva && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">P.IVA Azienda</p>
                        <p className="text-sm font-mono font-bold text-slate-800">{personSearchResult.dati_azienda.partita_iva}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.forma_giuridica && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Forma Giuridica</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.forma_giuridica}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.codice_ateco && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">ATECO</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.codice_ateco}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.fatturato && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Fatturato</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.fatturato}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.dipendenti && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Dipendenti</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.dipendenti}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.sede_legale && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Sede Legale</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.sede_legale}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.pec && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">PEC Azienda</p>
                        <a href={`mailto:${personSearchResult.dati_azienda.pec}`} className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.dati_azienda.pec}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.sito && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Sito Azienda</p>
                        <a href={personSearchResult.dati_azienda.sito.startsWith('http') ? personSearchResult.dati_azienda.sito : `https://${personSearchResult.dati_azienda.sito}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.dati_azienda.sito}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.capitale_sociale && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Capitale Sociale</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.capitale_sociale}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.descrizione_ateco && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Descrizione ATECO</p>
                        <p className="text-sm text-slate-700">{personSearchResult.dati_azienda.descrizione_ateco}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.utile_netto && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Utile Netto</p>
                        <p className="text-sm font-bold text-slate-800">{String(personSearchResult.dati_azienda.utile_netto).includes('€') ? personSearchResult.dati_azienda.utile_netto : `€${personSearchResult.dati_azienda.utile_netto}`}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.classe_fatturato && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Classe Fatturato</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.classe_fatturato}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.anno_fondazione && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Anno Fondazione</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.anno_fondazione}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.anno_bilancio && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Anno Bilancio</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.anno_bilancio}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.telefono && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Telefono Azienda</p>
                        <a href={`tel:${personSearchResult.dati_azienda.telefono}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{personSearchResult.dati_azienda.telefono}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.cellulare && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Cellulare Azienda</p>
                        <a href={`tel:${personSearchResult.dati_azienda.cellulare}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{personSearchResult.dati_azienda.cellulare}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.email && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Email Azienda</p>
                        <a href={`mailto:${personSearchResult.dati_azienda.email}`} className="text-sm font-bold text-blue-700 hover:underline">{personSearchResult.dati_azienda.email}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.linkedin && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">LinkedIn Azienda</p>
                        <a href={personSearchResult.dati_azienda.linkedin.startsWith('http') ? personSearchResult.dati_azienda.linkedin : `https://${personSearchResult.dati_azienda.linkedin}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline truncate block">{personSearchResult.dati_azienda.linkedin}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.instagram && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Instagram Azienda</p>
                        <p className="text-sm font-bold text-pink-600">{personSearchResult.dati_azienda.instagram}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.facebook && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Facebook Azienda</p>
                        <a href={personSearchResult.dati_azienda.facebook.startsWith('http') ? personSearchResult.dati_azienda.facebook : `https://${personSearchResult.dati_azienda.facebook}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline truncate block">{personSearchResult.dati_azienda.facebook}</a>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.indirizzo && !personSearchResult.dati_azienda.sede_legale && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Indirizzo</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.indirizzo}</p>
                      </div>
                    )}
                    {personSearchResult.dati_azienda.titolare && !/nome.*(cognome|titolare)/i.test(personSearchResult.dati_azienda.titolare) && (
                      <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Titolare / Amministratore</p>
                        <p className="text-sm font-bold text-slate-800">{personSearchResult.dati_azienda.titolare}</p>
                      </div>
                    )}
                  </div>
                  {personSearchResult.dati_azienda.persone?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Soci / Titolari</p>
                      <div className="space-y-2">
                        {personSearchResult.dati_azienda.persone.map((p: any, i: number) => (
                          <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center text-blue-700 font-bold text-xs">
                                {(p.nome || '??').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-800">{p.nome}</p>
                                <p className="text-[10px] text-slate-500">{p.ruolo}{p.cf ? ` · CF: ${p.cf}` : ''}</p>
                              </div>
                            </div>
                            {p.quota && <span className="text-xs font-bold bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">{p.quota}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Polizze consigliate person-lookup RIMOSSE: template per ruolo */}
              {false && personSearchResult.polizze_consigliate?.length > 0 && (
                <div className="bg-white rounded-2xl border border-purple-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Polizze Consigliate</h4>
                  <div className="space-y-2">
                    {personSearchResult.polizze_consigliate.map((p: any, i: number) => (
                      <div key={i} className={`rounded-lg p-3 ${p.priorita === 'obbligatoria' ? 'bg-red-50 border border-red-200' : p.priorita === 'critica' ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-200'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${p.priorita === 'obbligatoria' ? 'bg-red-200 text-red-800' : p.priorita === 'critica' ? 'bg-amber-200 text-amber-800' : 'bg-blue-200 text-blue-800'}`}>{p.priorita}</span>
                          <p className="text-sm font-bold text-slate-800">{p.polizza}</p>
                        </div>
                        <p className="text-xs text-slate-600">{p.motivo}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rischi professionali person-lookup RIMOSSI: template per ruolo */}
              {false && personSearchResult.rischi_professionali?.length > 0 && (
                <div className="bg-white rounded-2xl border border-red-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Rischi Professionali</h4>
                  <div className="flex flex-wrap gap-1">
                    {personSearchResult.rischi_professionali.map((r: string, i: number) => (
                      <span key={i} className="text-[10px] bg-red-100 text-red-800 px-2 py-1 rounded font-bold">{r}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Note broker RIMOSSE: GPT-generate, spesso allucinate.
                  Intelligence reale da CF/bilanci nei blocchi principali. */}

              {/* Proprietà immobiliari */}
              {(personSearchResult.proprieta_immobiliari || personSearchResult.zona_residenza || personSearchResult.tipo_abitazione || personSearchResult.valore_stimato_immobili || personSearchResult.mutuo || personSearchResult.altri_beni) && (
                <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">🏠 Patrimonio Immobiliare</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {personSearchResult.proprieta_immobiliari && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Proprietà</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.proprieta_immobiliari)}</p></div>}
                    {personSearchResult.zona_residenza && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Zona Residenza</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.zona_residenza)}</p></div>}
                    {personSearchResult.tipo_abitazione && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Tipo Abitazione</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.tipo_abitazione)}</p></div>}
                    {personSearchResult.valore_stimato_immobili && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Valore Stimato</p><p className="text-sm font-bold text-amber-700">{safeStr(personSearchResult.valore_stimato_immobili)}</p></div>}
                    {personSearchResult.mutuo && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Mutuo</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.mutuo)}</p></div>}
                    {personSearchResult.altri_beni && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Altri Beni</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.altri_beni)}</p></div>}
                  </div>
                </div>
              )}

              {/* Cariche societarie */}
              {(personSearchResult.cariche_societarie || personSearchResult.numero_aziende_attive || personSearchResult.partecipazioni || personSearchResult.storico_imprenditoriale) && (
                <div className="bg-white rounded-2xl border border-indigo-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">🏢 Cariche Societarie</h4>
                  {personSearchResult.numero_aziende_attive && <p className="text-sm text-indigo-700 font-semibold mb-2">Aziende attive: {safeStr(personSearchResult.numero_aziende_attive)}</p>}
                  {Array.isArray(personSearchResult.cariche_societarie) ? (
                    <div className="space-y-2">
                      {personSearchResult.cariche_societarie.map((c: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 bg-indigo-50 rounded-lg px-3 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${String(c.stato || '').toLowerCase() === 'attiva' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{safeStr(c.stato) || 'attiva'}</span>
                          <span className="text-sm font-semibold text-slate-800">{safeStr(c.azienda)}</span>
                          {c.ruolo && <span className="text-xs text-slate-500">— {safeStr(c.ruolo)}</span>}
                          {c.partita_iva && <span className="text-[10px] text-slate-400 ml-auto">{safeStr(c.partita_iva)}</span>}
                        </div>
                      ))}
                    </div>
                  ) : personSearchResult.cariche_societarie && (
                    <p className="text-sm text-slate-700">{safeStr(personSearchResult.cariche_societarie)}</p>
                  )}
                  {personSearchResult.partecipazioni && <div className="mt-2"><p className="text-[10px] font-semibold text-slate-500 uppercase">Partecipazioni</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.partecipazioni)}</p></div>}
                  {personSearchResult.storico_imprenditoriale && <div className="mt-2"><p className="text-[10px] font-semibold text-slate-500 uppercase">Storico Imprenditoriale</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.storico_imprenditoriale)}</p></div>}
                </div>
              )}

              {/* Albi e Certificazioni RIMOSSE: erano estratte via GPT da Tavily
                  senza verifica contro registri ufficiali (Accredia, CNF, ordini).
                  Per riattivarle in sicurezza bisogna integrarsi con i registri
                  pubblici degli albi professionali. */}
              {false && (personSearchResult.albo_professionale || personSearchResult.certificazioni || personSearchResult.onorificenze || personSearchResult.pubblicazioni || personSearchResult.docenze || personSearchResult.associazioni) && (
                <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">📜 Albi e Certificazioni</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {personSearchResult.albo_professionale && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Albo Professionale</p><p className="text-sm font-bold text-emerald-700">{safeStr(personSearchResult.albo_professionale)}</p></div>}
                    {personSearchResult.numero_iscrizione && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">N° Iscrizione</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.numero_iscrizione)}</p></div>}
                    {personSearchResult.certificazioni && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Certificazioni</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.certificazioni)}</p></div>}
                    {personSearchResult.onorificenze && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Onorificenze</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.onorificenze)}</p></div>}
                    {personSearchResult.pubblicazioni && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Pubblicazioni</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.pubblicazioni)}</p></div>}
                    {personSearchResult.docenze && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Docenze</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.docenze)}</p></div>}
                    {personSearchResult.associazioni && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Associazioni</p><p className="text-sm text-slate-800">{safeStr(personSearchResult.associazioni)}</p></div>}
                  </div>
                </div>
              )}

              {/* Notizie + contenziosi */}
              {(personSearchResult.notizie_recenti || personSearchResult.contenziosi || personSearchResult.reputazione_online || personSearchResult.donazioni_beneficenza || personSearchResult.interviste) && (
                <div className="bg-white rounded-2xl border border-rose-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">📰 Notizie e Reputazione</h4>
                  {Array.isArray(personSearchResult.notizie_recenti) && personSearchResult.notizie_recenti.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {personSearchResult.notizie_recenti.map((n: any, i: number) => (
                        <div key={i} className="bg-rose-50 rounded-lg px-3 py-2">
                          <p className="text-sm font-semibold text-slate-800">{safeStr(n.titolo)}</p>
                          <div className="flex gap-3 mt-1">
                            {n.data && <span className="text-[10px] text-slate-500">{safeStr(n.data)}</span>}
                            {n.fonte && <span className="text-[10px] text-rose-600">{safeStr(n.fonte)}</span>}
                          </div>
                          {n.rilevanza_assicurativa && <p className="text-[10px] text-slate-500 mt-1 italic">{safeStr(n.rilevanza_assicurativa)}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {personSearchResult.contenziosi && <div className="mb-2"><p className="text-[10px] font-semibold text-red-500 uppercase">Contenziosi</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.contenziosi)}</p></div>}
                  {personSearchResult.interviste && <div className="mb-2"><p className="text-[10px] font-semibold text-slate-500 uppercase">Interviste</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.interviste)}</p></div>}
                  {personSearchResult.reputazione_online && <div className="mb-2"><p className="text-[10px] font-semibold text-slate-500 uppercase">Reputazione Online</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.reputazione_online)}</p></div>}
                  {personSearchResult.donazioni_beneficenza && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Donazioni / Beneficenza</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.donazioni_beneficenza)}</p></div>}
                </div>
              )}

              {/* Network relazionale */}
              {(personSearchResult.relazioni_chiave || personSearchResult.eventi_conferenze || personSearchResult.consigli_amministrazione || personSearchResult.influenza_stimata || personSearchResult.circoli_club) && (
                <div className="bg-white rounded-2xl border border-violet-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">🤝 Network Relazionale</h4>
                  {personSearchResult.influenza_stimata && <p className="text-sm mb-2">Influenza stimata: <span className="font-bold text-violet-700">{safeStr(personSearchResult.influenza_stimata)}</span></p>}
                  {Array.isArray(personSearchResult.relazioni_chiave) && personSearchResult.relazioni_chiave.length > 0 && (
                    <div className="space-y-2 mb-3">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">Relazioni Chiave</p>
                      {personSearchResult.relazioni_chiave.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 bg-violet-50 rounded-lg px-3 py-2">
                          <span className="text-sm font-semibold text-slate-800">{safeStr(r.nome)}</span>
                          {r.relazione && <span className="text-xs text-violet-600">— {safeStr(r.relazione)}</span>}
                          {r.contesto && <span className="text-[10px] text-slate-400 ml-auto">{safeStr(r.contesto)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {personSearchResult.consigli_amministrazione && <div className="mb-2"><p className="text-[10px] font-semibold text-slate-500 uppercase">CdA / Board</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.consigli_amministrazione)}</p></div>}
                  {personSearchResult.eventi_conferenze && <div className="mb-2"><p className="text-[10px] font-semibold text-slate-500 uppercase">Eventi / Conferenze</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.eventi_conferenze)}</p></div>}
                  {personSearchResult.circoli_club && <div><p className="text-[10px] font-semibold text-slate-500 uppercase">Circoli / Club</p><p className="text-sm text-slate-700">{safeStr(personSearchResult.circoli_club)}</p></div>}
                </div>
              )}

              {/* ── Profilo Assicurativo dell'azienda associata (espandibile, fetch lazy) ── */}
              {(personSearchResult.partita_iva || personSearchResult.azienda) && (
                <InsuranceProfileSection
                  piva={personSearchResult.partita_iva || null}
                  ragioneSociale={personSearchResult.azienda || null}
                  citta={personSearchResult.sede_azienda || null}
                />
              )}

              {/* ── Insurance Intelligence (trigger commerciali, network, capacità spesa, eventi) ── */}
              {(personSearchResult.partita_iva || personSearchResult.azienda) && (
                <InsuranceIntelligenceSection
                  ragioneSociale={personSearchResult.azienda || ''}
                  partitaIva={personSearchResult.partita_iva || undefined}
                  citta={personSearchResult.sede_azienda || personSearchResult.citta || undefined}
                  ateco={personSearchResult.codice_ateco || personSearchResult.ateco || undefined}
                  ruolo={
                    /amministratore|titolare|founder|ceo|owner|presidente/i.test(
                      String(personSearchResult.ruolo || ''),
                    )
                      ? 'titolare'
                      : 'dipendente'
                  }
                  titolareNome={personSearchResult.nome || personSearchResult.full_name || undefined}
                  hasLinkedinPresence={!!(personSearchResult.linkedin_url || personSearchResult.linkedin)}
                />
              )}

              {/* Fonti */}
              {personSearchResult.fonti?.length > 0 && (
                <p className="text-[10px] text-slate-400">Fonti: {personSearchResult.fonti.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Cerca Persona (Dipendente) — RIMOSSA ── */}
      {false && searchMode === 'dipendente' && (
        <div className="mb-6 space-y-4 bg-slate-50 border border-slate-200 rounded-2xl p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
              <UserSearch className="w-5 h-5 text-teal-600" /> Cerca Persona
            </h2>
            <p className="text-sm text-slate-500">
              Cerca <strong>qualsiasi persona</strong> (dipendenti, manager, collaboratori). Mostra solo contatti <strong>verificati e diretti</strong> della persona — se non li trova, non li inventa.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder='Es. "Emanuele Gorgone Allianz" oppure "nome + azienda"'
              value={employeeSearchQuery}
              onChange={(e) => setEmployeeSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('btn-employee-search')?.click() }}
              className="flex-1 px-4 py-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-400 placeholder:text-slate-400"
            />
            <button
              id="btn-employee-search"
              disabled={employeeSearchLoading || !employeeSearchQuery.trim()}
              onClick={async () => {
                const q = employeeSearchQuery.trim()
                if (!q) return
                setEmployeeSearchLoading(true)
                setEmployeeSearchError(null)
                setEmployeeSearchResult(null)
                try {
                  const res = await fetch('/api/employee-lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q }),
                  })
                  const data = await res.json()
                  if (data.error) setEmployeeSearchError(data.error)
                  else setEmployeeSearchResult(data)
                } catch {
                  setEmployeeSearchError('Errore di connessione. Riprova.')
                } finally {
                  setEmployeeSearchLoading(false)
                }
              }}
              className="rounded-xl bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-teal-500/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-transform hover:scale-105 whitespace-nowrap"
            >
              {employeeSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {employeeSearchLoading ? 'Ricerca...' : 'Cerca Persona'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400">
            Questa ricerca mostra solo contatti personali verificati. Se non trova il numero diretto, mostra la PEC o altri dati disponibili.
          </p>

          {employeeSearchLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
              <span className="ml-2 text-sm text-slate-500">Ricerca in corso...</span>
            </div>
          )}

          {employeeSearchError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700">{employeeSearchError}</p>
            </div>
          )}

          {employeeSearchResult && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-teal-200 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">{employeeSearchResult.nome_completo || employeeSearchResult.nome_cercato}</h3>
                {employeeSearchResult.ruolo && <p className="text-sm text-slate-500">{employeeSearchResult.ruolo}{employeeSearchResult.azienda ? ` presso ${employeeSearchResult.azienda}` : ''}</p>}
                {employeeSearchResult.descrizione && <p className="text-sm text-slate-600 mt-2 italic">{safeStr(employeeSearchResult.descrizione)}</p>}

                <div className="grid grid-cols-2 gap-3 mt-4">
                  {employeeSearchResult.azienda && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Azienda</p>
                      <p className="text-sm font-bold text-slate-800">{employeeSearchResult.azienda}</p>
                    </div>
                  )}
                  {employeeSearchResult.ruolo && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Ruolo</p>
                      <p className="text-sm font-bold text-slate-800">{employeeSearchResult.ruolo}</p>
                    </div>
                  )}
                  {employeeSearchResult.settore && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Settore</p>
                      <p className="text-sm font-bold text-slate-800">{employeeSearchResult.settore}</p>
                    </div>
                  )}
                  {employeeSearchResult.citta && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Città</p>
                      <p className="text-sm font-bold text-slate-800">{employeeSearchResult.citta}</p>
                    </div>
                  )}
                  {employeeSearchResult.telefono && (
                    <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                      <p className="text-[10px] font-bold text-green-600 uppercase">Telefono Diretto</p>
                      <div className="flex items-center gap-2">
                        <a href={`tel:${employeeSearchResult.telefono}`} className="text-sm font-bold text-green-800 hover:underline">{employeeSearchResult.telefono}</a>
                        {whatsAppLink(employeeSearchResult.telefono) && (
                          <a href={`https://wa.me/${whatsAppLink(employeeSearchResult.telefono)}`} target="_blank" rel="noreferrer" className="text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded font-bold">WA</a>
                        )}
                      </div>
                    </div>
                  )}
                  {employeeSearchResult.email && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Email</p>
                      <a href={`mailto:${employeeSearchResult.email}`} className="text-sm font-bold text-blue-700 hover:underline">{employeeSearchResult.email}</a>
                    </div>
                  )}
                  {employeeSearchResult.pec && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">PEC</p>
                      <a href={`mailto:${employeeSearchResult.pec}`} className="text-sm font-bold text-blue-700 hover:underline">{employeeSearchResult.pec}</a>
                    </div>
                  )}
                  {employeeSearchResult.partita_iva && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">P.IVA</p>
                      <p className="text-sm font-mono font-bold text-slate-800">{employeeSearchResult.partita_iva}</p>
                    </div>
                  )}
                  {employeeSearchResult.linkedin && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">LinkedIn</p>
                      <a href={employeeSearchResult.linkedin} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">Profilo</a>
                    </div>
                  )}
                  {employeeSearchResult.formazione && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Formazione</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(employeeSearchResult.formazione)}</p>
                    </div>
                  )}
                  {employeeSearchResult.competenze && (
                    <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Competenze</p>
                      <p className="text-sm font-bold text-slate-800">{safeStr(employeeSearchResult.competenze)}</p>
                    </div>
                  )}
                </div>

                {!employeeSearchResult.telefono && !employeeSearchResult.email && (
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs text-amber-700 font-semibold">Contatti personali diretti non trovati. Sono disponibili solo dati professionali e PEC (se presente).</p>
                  </div>
                )}

                {/* Social */}
                <div className="flex gap-2 mt-3">
                  {employeeSearchResult.instagram && (
                    <a href={employeeSearchResult.instagram.startsWith('http') ? employeeSearchResult.instagram : `https://instagram.com/${employeeSearchResult.instagram.replace('@','')}`} target="_blank" rel="noreferrer" className="text-xs bg-pink-100 text-pink-700 px-2 py-1 rounded-full font-bold hover:bg-pink-200">Instagram</a>
                  )}
                  {employeeSearchResult.facebook && (
                    <a href={employeeSearchResult.facebook.startsWith('http') ? employeeSearchResult.facebook : `https://facebook.com/${employeeSearchResult.facebook}`} target="_blank" rel="noreferrer" className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-bold hover:bg-blue-200">Facebook</a>
                  )}
                </div>
              </div>

              {/* Polizze consigliate employee RIMOSSE: template per ruolo, stessa fattispecie */}
              {false && employeeSearchResult.polizze_consigliate?.length > 0 && (
                <div className="bg-white rounded-2xl border border-teal-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Polizze Consigliate</h4>
                  <div className="space-y-2">
                    {employeeSearchResult.polizze_consigliate.map((p: any, i: number) => (
                      <div key={i} className={`rounded-lg p-3 ${p.priorita === 'obbligatoria' ? 'bg-red-50 border border-red-200' : p.priorita === 'critica' ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-200'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${p.priorita === 'obbligatoria' ? 'bg-red-200 text-red-800' : p.priorita === 'critica' ? 'bg-amber-200 text-amber-800' : 'bg-blue-200 text-blue-800'}`}>{p.priorita}</span>
                          <p className="text-sm font-bold text-slate-800">{p.polizza}</p>
                        </div>
                        <p className="text-xs text-slate-600">{p.motivo}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rischi */}
              {employeeSearchResult.rischi_professionali?.length > 0 && (
                <div className="bg-white rounded-2xl border border-red-200 p-6 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Rischi Professionali</h4>
                  <div className="flex flex-wrap gap-1">
                    {employeeSearchResult.rischi_professionali.map((r: string, i: number) => (
                      <span key={i} className="text-[10px] bg-red-100 text-red-800 px-2 py-1 rounded font-bold">{r}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Note per il Broker RIMOSSE (employee search): GPT-generate, spesso allucinate. */}

              {employeeSearchResult.fonti?.length > 0 && (
                <p className="text-[10px] text-slate-400">Fonti: {employeeSearchResult.fonti.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Ricerca Azienda / P.IVA ── */}
      {searchMode === 'azienda' && (
        <div className="mb-6 space-y-5 bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/40 border border-blue-100 rounded-3xl p-7 shadow-lg shadow-blue-100/30 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-extrabold flex items-center gap-2.5 text-slate-900 tracking-tight">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Building2 className="w-5 h-5 text-white" />
              </span>
              Cerca Azienda
            </h2>
            <p className="text-sm text-slate-500">
              Inserisci la <strong>Partita IVA</strong> oppure la <strong>Ragione Sociale completa</strong> per ottenere il dossier completo con dati camerali, titolare, contatti e profilo assicurativo.
            </p>
            <div className="bg-blue-50/80 border border-blue-200/60 rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-[11px] font-bold text-blue-800">Come cercare per risultati precisi al 100%:</p>
              <ul className="text-[11px] text-blue-700 space-y-1 list-none">
                <li className="flex items-start gap-2"><span className="text-green-600 font-bold">✓</span> <strong>P.IVA diretta</strong> — es. <code className="bg-blue-100 px-1 rounded">07812270960</code> → risultato univoco, zero omonimi</li>
                <li className="flex items-start gap-2"><span className="text-green-600 font-bold">✓</span> <strong>Ragione Sociale completa + Città</strong> — es. <code className="bg-blue-100 px-1 rounded">I.P. Distribution S.r.l. Milano</code></li>
                <li className="flex items-start gap-2"><span className="text-green-600 font-bold">✓</span> <strong>Ragione Sociale completa</strong> — es. <code className="bg-blue-100 px-1 rounded">Innoa S.n.c. Dei Fratelli De Stefano</code></li>
                <li className="flex items-start gap-2"><span className="text-amber-600 font-bold">!</span> <strong>Nomi brevi senza città</strong> — es. <code className="bg-amber-50 px-1 rounded">Almax</code> → rischio omonimi, aggiungi sempre la città</li>
              </ul>
              <p className="text-[10px] text-blue-600 mt-1">Il sistema trova automaticamente titolare, soci, contatti, social e dati finanziari.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder='Es. "I.P. Distribution Milano" oppure "07812270960"'
                value={companySearchQuery}
                onChange={(e) => setCompanySearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('btn-company-search')?.click() }}
                className="w-full pl-10 pr-4 py-3.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-slate-400 shadow-sm"
              />
            </div>
            <button
              id="btn-company-search"
              disabled={companySearchLoading || !companySearchQuery.trim()}
              onClick={async () => {
                const q = companySearchQuery.trim()
                if (!q) return
                setCompanySearchLoading(true)
                setCompanySearchError(null)
                setCompanySearchResult(null)
                try {
                  const res = await fetch('/api/company-lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q }),
                  })
                  const data = await res.json()
                  if (data.error) {
                    setCompanySearchError(data.error)
                  } else {
                    setCompanySearchResult(data)
                  }
                } catch {
                  setCompanySearchError('Errore di connessione. Riprova.')
                } finally {
                  setCompanySearchLoading(false)
                }
              }}
              className="rounded-xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-blue-500/25 disabled:opacity-50 flex items-center justify-center gap-2.5 transition-all hover:scale-[1.03] hover:shadow-2xl whitespace-nowrap"
            >
              {companySearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {companySearchLoading ? 'Analisi in corso...' : 'Cerca Azienda'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 rounded-full bg-slate-300" />
            nome azienda + città &nbsp;|&nbsp; ragione sociale &nbsp;|&nbsp; P.IVA diretta
          </p>

          {companySearchError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {companySearchError}
            </div>
          )}

          {companySearchResult && (
            <div className="space-y-5">
              {/* Company header */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-0 shadow-lg shadow-slate-200/40 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-7 py-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-black text-lg shadow-lg border border-white/20">
                        {(companySearchResult.ragione_sociale || companySearchResult.nome || '??').split(' ').map((w: string) => w[0]).filter((_: string, i: number) => i < 2).join('').toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-xl font-extrabold text-white tracking-tight">{companySearchResult.ragione_sociale || companySearchResult.nome || '—'}</h3>
                        <p className="text-sm text-blue-100 font-medium">{companySearchResult.forma_giuridica || ''} {companySearchResult.citta ? `· ${companySearchResult.citta}` : ''}</p>
                      </div>
                    </div>
                    {companySearchResult.stato_attivita && (
                      <span className={`text-xs font-bold px-3.5 py-1.5 rounded-full backdrop-blur-sm shadow-sm ${
                        /attiv/i.test(companySearchResult.stato_attivita) ? 'bg-emerald-400/20 text-emerald-100 border border-emerald-300/30' : 'bg-red-400/20 text-red-100 border border-red-300/30'
                      }`}>
                        {companySearchResult.stato_attivita}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-6 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {companySearchResult.partita_iva && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3.5 border border-blue-100/50">
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">P.IVA</p>
                      <p className="text-sm font-mono font-extrabold text-slate-900">{companySearchResult.partita_iva}</p>
                    </div>
                  )}
                  {companySearchResult.codice_ateco && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ATECO</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.codice_ateco}</p>
                      {companySearchResult.descrizione_ateco && <p className="text-[10px] text-slate-500 mt-0.5">{companySearchResult.descrizione_ateco}</p>}
                    </div>
                  )}
                  {companySearchResult.fatturato && (
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3.5 border border-emerald-100/50">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Fatturato</p>
                      <p className="text-sm font-extrabold text-emerald-700">{String(companySearchResult.fatturato).includes('€') ? companySearchResult.fatturato : `€${String(companySearchResult.fatturato).replace(/[^\d.,]/g, '').trim() || companySearchResult.fatturato}`}</p>
                    </div>
                  )}
                  {companySearchResult.dipendenti && (
                    <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-3.5 border border-violet-100/50">
                      <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Dipendenti</p>
                      <p className="text-sm font-extrabold text-violet-700">{companySearchResult.dipendenti}</p>
                    </div>
                  )}
                  {companySearchResult.capitale_sociale && (
                    <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-3.5 border border-amber-100/50">
                      <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Capitale Sociale</p>
                      <p className="text-sm font-extrabold text-amber-700">{companySearchResult.capitale_sociale}</p>
                    </div>
                  )}
                  {companySearchResult.data_costituzione && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Costituzione</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.data_costituzione}</p>
                    </div>
                  )}
                  {companySearchResult.sede_legale && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3.5 col-span-2 border border-blue-100/50">
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Sede Legale</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.sede_legale}</p>
                    </div>
                  )}
                  {companySearchResult.pec && (
                    <div className="bg-gradient-to-br from-sky-50 to-cyan-50 rounded-xl p-3.5 border border-sky-100/50">
                      <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">PEC</p>
                      <p className="text-sm font-bold text-blue-700">{companySearchResult.pec}</p>
                    </div>
                  )}
                  {companySearchResult.telefono && (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3.5 border border-green-100/50">
                      <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Telefono</p>
                      <div className="flex items-center gap-2">
                        <a href={`tel:${companySearchResult.telefono}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{companySearchResult.telefono}</a>
                        {whatsAppLink(companySearchResult.telefono) && (
                          <a href={`https://wa.me/${whatsAppLink(companySearchResult.telefono)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full transition-colors">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {companySearchResult.cellulare && (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3.5 border border-green-100/50">
                      <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Cellulare</p>
                      <div className="flex items-center gap-2">
                        <a href={`tel:${companySearchResult.cellulare}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{companySearchResult.cellulare}</a>
                        {whatsAppLink(companySearchResult.cellulare) && (
                          <a href={`https://wa.me/${whatsAppLink(companySearchResult.cellulare)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full transition-colors">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {/* ★ EMAIL — mostra TUTTE le email trovate (carpenteriacorona@gmail.com, info@carpenteriacorona.it, coronacarpenteria2@gmail.com).
                       Backend restituisce array `tutte_email` con tipo (personal/generic). Fallback a singolo `email` per retro-compat. */}
                  {(() => {
                    const tutte = (companySearchResult as any).tutte_email as Array<{ email: string; tipo: string; pagina: string }> | undefined
                    const emails = tutte && tutte.length > 0
                      ? tutte
                      : (companySearchResult.email ? [{ email: companySearchResult.email, tipo: 'personal', pagina: '/' }] : [])
                    if (emails.length === 0) return null
                    return (
                      <div className={`bg-gradient-to-br from-blue-50 to-sky-50 rounded-xl p-3.5 border border-blue-100/50 ${emails.length > 1 ? 'col-span-2' : ''}`}>
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">{emails.length > 1 ? `Email (${emails.length})` : 'Email'}</p>
                        <div className="flex flex-col gap-1">
                          {emails.map((e, idx) => (
                            <div key={idx} className="flex items-center gap-2 flex-wrap">
                              <a href={`mailto:${e.email}`} className="text-sm font-bold text-blue-700 hover:underline">{e.email}</a>
                              {e.tipo === 'generic' && <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">generica</span>}
                              {e.tipo === 'personal' && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">aziendale</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  {/* ★ NUMERI AGGIUNTIVI: numeri extra trovati sul sito (es. altre sedi) */}
                  {(() => {
                    const tuttiFissi = ((companySearchResult as any).tutti_telefoni || []) as Array<{ numero: string; fonte: string; pagina: string }>
                    const tuttiCellulari = ((companySearchResult as any).tutti_cellulari || []) as Array<{ numero: string; fonte: string; pagina: string }>
                    const norm = (n: string) => n.replace(/\D/g, '').slice(-9)
                    const mainTel = companySearchResult.telefono ? norm(companySearchResult.telefono) : null
                    const mainCel = companySearchResult.cellulare ? norm(companySearchResult.cellulare) : null
                    const extraFissi = tuttiFissi.filter(p => norm(p.numero) !== mainTel && norm(p.numero) !== mainCel)
                    const extraCel = tuttiCellulari.filter(p => norm(p.numero) !== mainTel && norm(p.numero) !== mainCel)
                    if (extraFissi.length === 0 && extraCel.length === 0) return null
                    return (
                      <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3.5 col-span-2 border border-emerald-200/60">
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Altri Numeri ({extraFissi.length + extraCel.length})</p>
                        <div className="flex flex-col gap-1 mt-1">
                          {extraFissi.map((p, idx) => (
                            <div key={`f${idx}`} className="flex items-center gap-2 flex-wrap">
                              <a href={`tel:${p.numero}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{p.numero}</a>
                              <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">fisso</span>
                            </div>
                          ))}
                          {extraCel.map((p, idx) => (
                            <div key={`c${idx}`} className="flex items-center gap-2 flex-wrap">
                              <a href={`tel:${p.numero}`} className="text-sm font-bold text-slate-800 hover:text-blue-700">{p.numero}</a>
                              <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">cellulare</span>
                              {whatsAppLink(p.numero) && (
                                <a href={`https://wa.me/${whatsAppLink(p.numero)}`} target="_blank" rel="noreferrer" className="text-[9px] bg-green-500 text-white px-1.5 py-0.5 rounded font-bold">WhatsApp</a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  {(companySearchResult.sito_web || companySearchResult.sito) && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sito Web</p>
                      <a href={(companySearchResult.sito_web || companySearchResult.sito).startsWith('http') ? (companySearchResult.sito_web || companySearchResult.sito) : `https://${companySearchResult.sito_web || companySearchResult.sito}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">{companySearchResult.sito_web || companySearchResult.sito}</a>
                    </div>
                  )}
                  {companySearchResult.instagram && (
                    <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-xl p-3.5 border border-pink-100/50">
                      <p className="text-[10px] font-bold text-pink-500 uppercase tracking-wider">Instagram</p>
                      <a href={companySearchResult.instagram.startsWith('http') ? companySearchResult.instagram : `https://instagram.com/${companySearchResult.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-pink-600 hover:underline">@{companySearchResult.instagram.replace(/.*instagram\.com\//, '').replace(/^@/, '').replace(/\/$/, '')}</a>
                    </div>
                  )}
                  {companySearchResult.linkedin && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3.5 border border-blue-100/50">
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">LinkedIn</p>
                      <a href={companySearchResult.linkedin.startsWith('http') ? companySearchResult.linkedin : `https://linkedin.com/company/${companySearchResult.linkedin}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">{companySearchResult.linkedin.replace(/.*linkedin\.com\//, 'linkedin.com/')}</a>
                    </div>
                  )}
                  {companySearchResult.facebook && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3.5 border border-blue-100/50">
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Facebook</p>
                      <a href={companySearchResult.facebook.startsWith('http') ? companySearchResult.facebook : `https://facebook.com/${companySearchResult.facebook}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 hover:underline">{companySearchResult.facebook.replace(/.*facebook\.com\//, 'facebook.com/')}</a>
                    </div>
                  )}
                  {companySearchResult.indirizzo && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 col-span-2 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Indirizzo</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.indirizzo}</p>
                    </div>
                  )}
                  {companySearchResult.rating && (
                    <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-3.5 border border-amber-100/50">
                      <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Rating</p>
                      <p className="text-sm font-bold text-amber-600">⭐ {companySearchResult.rating}{companySearchResult.reviews ? ` (${companySearchResult.reviews} recensioni)` : ''}</p>
                    </div>
                  )}
                  {companySearchResult.categoria && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Categoria</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.categoria}</p>
                    </div>
                  )}
                  {companySearchResult.titolare && !/nome.*(cognome|titolare)/i.test(companySearchResult.titolare) && (
                    <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-3.5 col-span-2 border border-indigo-100/50">
                      <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{companySearchResult.ruolo_titolare || 'Titolare / Amministratore'}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-800">{companySearchResult.titolare}</p>
                        {companySearchResult.linkedin_titolare && (
                          <a href={companySearchResult.linkedin_titolare} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {companySearchResult.anno_fondazione && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Anno Fondazione</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.anno_fondazione}</p>
                    </div>
                  )}
                  {companySearchResult.settore && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Settore</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.settore}</p>
                    </div>
                  )}
                  {companySearchResult.utile_netto && (
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3.5 border border-emerald-100/50">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Utile Netto</p>
                      <p className="text-sm font-bold text-slate-800">{String(companySearchResult.utile_netto).includes('€') ? companySearchResult.utile_netto : `€${String(companySearchResult.utile_netto).replace(/[^\d.,\-]/g, '').trim() || companySearchResult.utile_netto}`}</p>
                    </div>
                  )}
                  {companySearchResult.classe_fatturato && (
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3.5 border border-emerald-100/50">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Classe Fatturato</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.classe_fatturato}</p>
                    </div>
                  )}
                  {companySearchResult.codice_fiscale && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3.5 border border-blue-100/50">
                      <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Codice Fiscale</p>
                      <p className="text-sm font-mono font-bold text-slate-800">{companySearchResult.codice_fiscale}</p>
                    </div>
                  )}
                  {companySearchResult.codice_rea && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Codice REA</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.codice_rea}</p>
                    </div>
                  )}
                  {companySearchResult.costo_personale && (
                    <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-3.5 border border-violet-100/50">
                      <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Costo Personale</p>
                      <p className="text-sm font-bold text-slate-800">€{String(companySearchResult.costo_personale).replace(/[^\d.,]/g, '')}</p>
                    </div>
                  )}
                  {companySearchResult.classificazione_eu && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Dimensione EU</p>
                      <p className="text-sm font-bold text-slate-800">{typeof companySearchResult.classificazione_eu === 'string' ? companySearchResult.classificazione_eu : companySearchResult.classificazione_eu?.label || companySearchResult.classificazione_eu?.classe || ''}</p>
                    </div>
                  )}
                  {/* ── Nuovi campi OpenAPI IT-advanced ── */}
                  {companySearchResult.codice_sdi && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Codice SDI</p>
                      <p className="text-sm font-mono font-bold text-slate-800">{companySearchResult.codice_sdi}</p>
                    </div>
                  )}
                  {companySearchResult.ral_medio && (
                    <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-3.5 border border-violet-100/50">
                      <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">RAL Medio</p>
                      <p className="text-sm font-bold text-slate-800">€{Number(companySearchResult.ral_medio).toLocaleString('it-IT')}</p>
                    </div>
                  )}
                  {companySearchResult.patrimonio_netto && (
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3.5 border border-emerald-100/50">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Patrimonio Netto</p>
                      <p className="text-sm font-bold text-slate-800">€{Number(companySearchResult.patrimonio_netto).toLocaleString('it-IT')}</p>
                    </div>
                  )}
                  {companySearchResult.totale_attivo && (
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-3.5 border border-emerald-100/50">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Totale Attivo</p>
                      <p className="text-sm font-bold text-slate-800">€{Number(companySearchResult.totale_attivo).toLocaleString('it-IT')}</p>
                    </div>
                  )}
                  {companySearchResult.data_registrazione && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Data Registrazione</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.data_registrazione}</p>
                    </div>
                  )}
                  {companySearchResult.regione && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Regione</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.regione}</p>
                    </div>
                  )}
                  {companySearchResult.forma_giuridica_codice && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cod. Forma Giuridica</p>
                      <p className="text-sm font-mono font-bold text-slate-800">{companySearchResult.forma_giuridica_codice}</p>
                    </div>
                  )}
                  {companySearchResult.gruppo_iva && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gruppo IVA</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.gruppo_iva.partecipazione ? (companySearchResult.gruppo_iva.leader ? 'Capogruppo' : 'Partecipante') : 'Non partecipa'}</p>
                    </div>
                  )}
                  {typeof companySearchResult.gps_lat === 'number' && typeof companySearchResult.gps_lng === 'number' && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Coordinate GPS</p>
                      <a href={`https://maps.google.com/?q=${companySearchResult.gps_lat},${companySearchResult.gps_lng}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline">{companySearchResult.gps_lat.toFixed(5)}, {companySearchResult.gps_lng.toFixed(5)}</a>
                    </div>
                  )}
                  {companySearchResult.ateco_2022 && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3.5 col-span-2 border border-slate-200/50">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ATECO 2022</p>
                      <p className="text-sm font-bold text-slate-800">{companySearchResult.ateco_2022.code} — {companySearchResult.ateco_2022.description}</p>
                    </div>
                  )}
                  {companySearchResult.data_cessazione && (
                    <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl p-3.5 border border-red-100/50">
                      <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Data Cessazione</p>
                      <p className="text-sm font-bold text-red-700">{companySearchResult.data_cessazione}</p>
                    </div>
                  )}
                  {companySearchResult.storico_bilanci && (() => {
                    // Handle both formats: OpenAPI array [{anno, fatturato, ...}] or CompanyReports JSON string {"anni":[], "fatturato":[], ...}
                    let rows: Array<{anno: number; fatturato?: number; utile?: number; dipendenti?: number; costo_personale?: number}> = []
                    const raw = companySearchResult.storico_bilanci
                    if (Array.isArray(raw)) {
                      rows = raw
                    } else {
                      try {
                        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
                        if (parsed.anni && Array.isArray(parsed.anni)) {
                          rows = parsed.anni.map((anno: string, i: number) => ({
                            anno: Number(anno),
                            fatturato: parsed.fatturato?.[i] ? Number(parsed.fatturato[i]) : undefined,
                            utile: parsed.utile?.[i] ? Number(parsed.utile[i]) : undefined,
                            costo_personale: parsed.costo_personale?.[i] ? Number(parsed.costo_personale[i]) : undefined,
                          }))
                        }
                      } catch { /* ignore parse errors */ }
                    }
                    if (rows.length === 0) return null
                    return (
                      <div className="bg-gradient-to-br from-slate-50 to-indigo-50/30 rounded-xl p-3.5 col-span-2 md:col-span-3 border border-slate-200/50">
                        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2">Storico Bilanci ({rows.length} anni)</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-left text-slate-500 border-b border-slate-200">
                                <th className="py-1 pr-3 font-bold">Anno</th>
                                <th className="py-1 pr-3 font-bold">Fatturato</th>
                                <th className="py-1 pr-3 font-bold">Utile</th>
                                <th className="py-1 pr-3 font-bold">Dipendenti</th>
                                <th className="py-1 pr-3 font-bold">Costo Pers.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((b: any) => (
                                <tr key={b.anno} className="border-b border-slate-100 last:border-0">
                                  <td className="py-1 pr-3 font-bold text-slate-800">{b.anno}</td>
                                  <td className="py-1 pr-3 text-slate-700">{b.fatturato ? `€${Number(b.fatturato).toLocaleString('it-IT')}` : '—'}</td>
                                  <td className="py-1 pr-3 text-slate-700">{b.utile ? `€${Number(b.utile).toLocaleString('it-IT')}` : '—'}</td>
                                  <td className="py-1 pr-3 text-slate-700">{b.dipendenti ?? '—'}</td>
                                  <td className="py-1 pr-3 text-slate-700">{b.costo_personale ? `€${Number(b.costo_personale).toLocaleString('it-IT')}` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Profilo Titolare dettagliato RIMOSSO: bio/seniority/formazione/
                  esperienze/competenze sono curriculum marketing senza valore
                  assicurativo. Età/CF/successione ora in Titolare Intelligence. */}
              {false && companySearchResult.titolare && (companySearchResult.bio_titolare || companySearchResult.linkedin_titolare || companySearchResult.esperienze_titolare || companySearchResult.formazione_titolare || companySearchResult.competenze_titolare || companySearchResult.seniority_titolare) && (
                <div className="bg-white rounded-3xl border border-indigo-200/60 p-0 shadow-lg shadow-indigo-100/30 overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-500 to-violet-500 px-6 py-4">
                    <h4 className="text-sm font-bold text-white flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-black text-sm border border-white/20">
                        {String(companySearchResult.titolare).split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      <div>
                        <span className="text-base font-extrabold">{companySearchResult.titolare}</span>
                        <p className="text-[10px] font-medium text-indigo-100">{companySearchResult.ruolo_titolare || 'Titolare / Amministratore'}{companySearchResult.seniority_titolare ? ` · ${companySearchResult.seniority_titolare}` : ''}</p>
                      </div>
                    </h4>
                  </div>
                  <div className="p-6">
                  {companySearchResult.bio_titolare && (
                    <p className="text-xs text-slate-600 mb-4 leading-relaxed">{companySearchResult.bio_titolare}</p>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {companySearchResult.linkedin_titolare && (
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">LinkedIn</p>
                        <a href={companySearchResult.linkedin_titolare} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline flex items-center gap-1.5">
                          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          Profilo LinkedIn
                        </a>
                      </div>
                    )}
                    {companySearchResult.instagram_titolare && (
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">Instagram</p>
                        <a href={String(companySearchResult.instagram_titolare).startsWith('http') ? companySearchResult.instagram_titolare : `https://instagram.com/${String(companySearchResult.instagram_titolare).replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-pink-600 hover:underline">Profilo Instagram</a>
                      </div>
                    )}
                    {companySearchResult.facebook_titolare && (
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">Facebook</p>
                        <a href={String(companySearchResult.facebook_titolare).startsWith('http') ? companySearchResult.facebook_titolare : `https://facebook.com/${String(companySearchResult.facebook_titolare)}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 hover:underline">Profilo Facebook</a>
                      </div>
                    )}
                    {companySearchResult.seniority_titolare && (
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">Seniority</p>
                        <p className="text-sm font-bold text-slate-800 capitalize">{companySearchResult.seniority_titolare}</p>
                      </div>
                    )}
                    {companySearchResult.anni_esperienza_titolare && (
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">Anni Esperienza</p>
                        <p className="text-sm font-bold text-slate-800">{companySearchResult.anni_esperienza_titolare}</p>
                      </div>
                    )}
                    {companySearchResult.tipo_lavoro_titolare && (
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">Tipo Lavoro</p>
                        <p className="text-sm font-bold text-slate-800 capitalize">{companySearchResult.tipo_lavoro_titolare}</p>
                      </div>
                    )}
                  </div>
                  {companySearchResult.formazione_titolare && (
                    <div className="mt-3 bg-indigo-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Formazione</p>
                      <p className="text-xs text-slate-700">{safeStr(companySearchResult.formazione_titolare)}</p>
                    </div>
                  )}
                  {companySearchResult.esperienze_titolare && (
                    <div className="mt-3 bg-indigo-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Esperienze Precedenti</p>
                      {typeof companySearchResult.esperienze_titolare === 'string' ? (
                        <p className="text-xs text-slate-700">{companySearchResult.esperienze_titolare}</p>
                      ) : Array.isArray(companySearchResult.esperienze_titolare) ? (
                        <div className="space-y-1">
                          {companySearchResult.esperienze_titolare.map((e: any, i: number) => (
                            <p key={i} className="text-xs text-slate-700">{e.ruolo && e.ruolo !== e.azienda ? `${e.ruolo} @ ` : ''}{e.azienda}{e.periodo ? ` (${e.periodo})` : ''}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                  {companySearchResult.competenze_titolare && (
                    <div className="mt-3 bg-indigo-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Competenze</p>
                      {typeof companySearchResult.competenze_titolare === 'string' ? (
                        <p className="text-xs text-slate-700">{companySearchResult.competenze_titolare}</p>
                      ) : Array.isArray(companySearchResult.competenze_titolare) && companySearchResult.competenze_titolare.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {companySearchResult.competenze_titolare.map((c: string, i: number) => (
                            <span key={i} className="text-[10px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded font-bold">{c}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                  {/* Additional person-lookup fields */}
                  {(companySearchResult.pec_titolare || companySearchResult.indirizzo_titolare || companySearchResult.settore_titolare || companySearchResult.dimensione_azienda_titolare || companySearchResult.cf_titolare) && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                      {companySearchResult.pec_titolare && (
                        <div className="bg-indigo-50 rounded-lg p-3">
                          <p className="text-[10px] font-bold text-indigo-400 uppercase">PEC Titolare</p>
                          <p className="text-xs font-bold text-slate-700 break-all">{safeStr(companySearchResult.pec_titolare)}</p>
                        </div>
                      )}
                      {companySearchResult.settore_titolare && (
                        <div className="bg-indigo-50 rounded-lg p-3">
                          <p className="text-[10px] font-bold text-indigo-400 uppercase">Settore</p>
                          <p className="text-xs font-bold text-slate-700">{safeStr(companySearchResult.settore_titolare)}</p>
                        </div>
                      )}
                      {companySearchResult.dimensione_azienda_titolare && (
                        <div className="bg-indigo-50 rounded-lg p-3">
                          <p className="text-[10px] font-bold text-indigo-400 uppercase">Dimensione Azienda</p>
                          <p className="text-xs font-bold text-slate-700 capitalize">{safeStr(companySearchResult.dimensione_azienda_titolare)}</p>
                        </div>
                      )}
                      {companySearchResult.cf_titolare && (
                        <div className="bg-indigo-50 rounded-lg p-3">
                          <p className="text-[10px] font-bold text-indigo-400 uppercase">Codice Fiscale</p>
                          <p className="text-xs font-bold text-slate-700 font-mono">{safeStr(companySearchResult.cf_titolare)}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {companySearchResult.indirizzo_titolare && (
                    <div className="mt-3 bg-indigo-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Indirizzo Titolare</p>
                      <p className="text-xs text-slate-700">{safeStr(companySearchResult.indirizzo_titolare)}</p>
                    </div>
                  )}
                  {companySearchResult.colleghi_titolare && (
                    <div className="mt-3 bg-indigo-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Colleghi / Collaboratori Noti</p>
                      <p className="text-xs text-slate-700">{safeStr(companySearchResult.colleghi_titolare)}</p>
                    </div>
                  )}
                  {companySearchResult.note_titolare && (
                    <div className="mt-3 bg-indigo-50 rounded-lg p-3">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1">Note</p>
                      <p className="text-xs text-slate-700">{safeStr(companySearchResult.note_titolare)}</p>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* Soci / Titolari / Persone chiave */}
              {companySearchResult.persone?.length > 0 && (
                <div className="bg-white rounded-3xl border border-purple-200/60 p-0 shadow-lg shadow-purple-100/30 overflow-hidden">
                  <div className="bg-gradient-to-r from-purple-500 to-fuchsia-500 px-6 py-3.5 flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-white font-black text-xs">{companySearchResult.persone.length}</span>
                      Soci / Titolari
                    </h4>
                  </div>
                  <div className="p-5 space-y-2.5">
                    {companySearchResult.persone.map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-100/60 rounded-xl p-3.5 transition-all hover:shadow-md">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
                            {(p.nome || '??').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{p.nome}</p>
                            <p className="text-[10px] text-slate-500">{p.ruolo}{p.cf ? ` · CF: ${p.cf}` : ''}</p>
                          </div>
                        </div>
                        {p.quota && (
                          <span className="text-xs font-bold bg-gradient-to-r from-purple-500 to-violet-500 text-white px-3 py-1 rounded-full shadow-sm">{p.quota}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Intelligence Assicurativa Tavily RIMOSSA: certificazioni ISO/SOA,
                  flotta, immobili, appalti, rischi_specifici, note_broker erano
                  tutti GPT-allucinati (Search 3 disabilitata in backend).
                  Intelligence reale ora nei blocchi Trigger/Financial/Titolare/Risk. */}
              {false && (companySearchResult.certificazioni?.length > 0 || companySearchResult.ha_flotta_veicoli || companySearchResult.ha_immobili_proprieta || companySearchResult.partecipa_appalti_pubblici || companySearchResult.rischi_specifici?.length > 0 || companySearchResult.note_broker) && (
                <div className="bg-white rounded-3xl border border-cyan-200/60 p-0 shadow-lg shadow-cyan-100/30 overflow-hidden">
                  <div className="bg-gradient-to-r from-cyan-500 to-teal-500 px-6 py-3.5">
                    <h4 className="text-sm font-bold text-white">Segnali assicurativi pubblici</h4>
                  </div>
                  <div className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {companySearchResult.certificazioni?.length > 0 && (
                      <div className="bg-cyan-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-cyan-700 uppercase mb-1">Certificazioni</p>
                        <div className="flex flex-wrap gap-1">
                          {companySearchResult.certificazioni.map((c: string, i: number) => (
                            <span key={i} className="text-[10px] bg-cyan-200 text-cyan-800 px-2 py-0.5 rounded font-bold">{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {companySearchResult.ha_flotta_veicoli && (
                      <div className="bg-cyan-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-cyan-700 uppercase mb-1">Flotta Veicoli</p>
                        <p className="text-sm text-slate-800">{companySearchResult.numero_veicoli ? `${companySearchResult.numero_veicoli} veicoli` : 'Presente'}</p>
                      </div>
                    )}
                    {companySearchResult.ha_immobili_proprieta && (
                      <div className="bg-cyan-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-cyan-700 uppercase mb-1">Immobili</p>
                        <p className="text-sm text-slate-800">{safeStr(companySearchResult.immobili_descrizione) || 'Proprietà immobiliari rilevate'}</p>
                      </div>
                    )}
                    {companySearchResult.partecipa_appalti_pubblici && (
                      <div className="bg-cyan-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-cyan-700 uppercase mb-1">Appalti Pubblici</p>
                        <p className="text-sm text-slate-800">{safeStr(companySearchResult.appalti_info) || 'Partecipa a bandi/appalti'}</p>
                      </div>
                    )}
                    {companySearchResult.rischi_specifici?.length > 0 && (
                      <div className="bg-red-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-red-700 uppercase mb-1">Rischi specifici da verificare</p>
                        <div className="flex flex-wrap gap-1">
                          {companySearchResult.rischi_specifici.map((r: string, i: number) => (
                            <span key={i} className="text-[10px] bg-red-200 text-red-800 px-2 py-0.5 rounded font-bold">{r}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {companySearchResult.note_broker && (
                      <div className="bg-amber-50 rounded-lg p-3 col-span-2">
                        <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">Note per il Broker</p>
                        <p className="text-[11px] text-slate-700">{companySearchResult.note_broker}</p>
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              )}

              {/* Persone / Soci */}
              {companySearchResult.persone?.length > 0 && (
                <div className="bg-white rounded-3xl border border-violet-200/60 p-0 shadow-lg shadow-violet-100/30 overflow-hidden">
                  <div className="bg-gradient-to-r from-violet-500 to-purple-500 px-6 py-3.5 flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-white font-black text-xs">{companySearchResult.persone.length}</span>
                    <h4 className="text-sm font-bold text-white">Persone Chiave</h4>
                  </div>
                  <div className="p-5 space-y-2.5">
                    {companySearchResult.persone.map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3.5 bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl border border-violet-100/60 transition-all hover:shadow-md">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{p.nome}</p>
                          <p className="text-xs text-slate-500">{p.ruolo}{p.quota ? ` · ${p.quota}` : ''}</p>
                        </div>
                        {p.cf && <span className="text-[10px] font-mono text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm">{p.cf}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ═══ INSURANCE INTELLIGENCE — 100% deterministico ═══ */}
              {companySearchResult.insurance_intelligence && (() => {
                const intel = companySearchResult.insurance_intelligence
                return (
                  <>
                  {/* Esposizione Totale */}
                  {false && (intel.esposizione_totale?.patrimonio_a_rischio && intel.esposizione_totale.patrimonio_a_rischio !== 'Da quantificare') && (
                    <div className="bg-gradient-to-r from-red-600 to-red-800 rounded-3xl p-5 shadow-lg">
                      <h4 className="text-sm font-bold text-white mb-3">Esposizione Patrimoniale</h4>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-[9px] text-red-200 uppercase font-bold">Patrimonio a rischio</p>
                          <p className="text-lg font-black text-white">{intel.esposizione_totale.patrimonio_a_rischio}</p>
                        </div>
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-[9px] text-red-200 uppercase font-bold">Costo fermo/giorno</p>
                          <p className="text-lg font-black text-white">{intel.esposizione_totale.costo_fermo_giornaliero}</p>
                        </div>
                        <div className="bg-white/15 rounded-xl p-3 text-center">
                          <p className="text-[9px] text-red-200 uppercase font-bold">Massimale RC consigliato</p>
                          <p className="text-lg font-black text-white">{intel.esposizione_totale.esposizione_rc}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Vulnerabilità Critiche */}
                  {intel.vulnerabilita?.length > 0 && (
                    <div className="bg-white rounded-3xl border border-red-200/60 p-0 shadow-lg overflow-hidden">
                      <div className="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-3.5">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span className="text-lg">&#9888;</span>
                          Vulnerabilit&agrave; Specifiche ({intel.vulnerabilita.length})
                        </h4>
                        <p className="text-[10px] text-red-100 mt-0.5">Aree di rischio motivate da dati pubblici e normativa — da validare sul portafoglio reale</p>
                      </div>
                      <div className="p-5 space-y-3">
                        {intel.vulnerabilita.map((v: any, i: number) => (
                          <div key={i} className={`p-4 rounded-xl border-l-4 ${v.gravita === 'critica' ? 'border-l-red-500 bg-red-50' : v.gravita === 'alta' ? 'border-l-orange-500 bg-orange-50' : 'border-l-amber-400 bg-amber-50'}`}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${v.gravita === 'critica' ? 'bg-red-200 text-red-800' : v.gravita === 'alta' ? 'bg-orange-200 text-orange-800' : 'bg-amber-200 text-amber-800'}`}>{v.gravita}</span>
                              <span className="text-xs font-black text-slate-900">{v.titolo}</span>
                            </div>
                            <p className="text-[11px] text-slate-700 mb-1.5"><strong>Base verificabile:</strong> {v.fatto}</p>
                            <p className="text-[11px] text-red-800 mb-1.5"><strong>CONSEGUENZA:</strong> {v.conseguenza}</p>
                            <p className="text-[11px] text-emerald-800 mb-2"><strong>Azione consulenziale:</strong> {v.soluzione}</p>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                              <p className="text-[10px] font-bold text-blue-800 uppercase mb-0.5">Domanda per il cliente:</p>
                              <p className="text-[11px] text-blue-900 italic">{v.domanda_killer}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Obblighi di Legge */}
                  {intel.obblighi?.length > 0 && (
                    <div className="bg-white rounded-3xl border border-amber-200/60 p-0 shadow-lg overflow-hidden">
                      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3.5">
                        <h4 className="text-sm font-bold text-white">Obblighi e responsabilit&agrave; da verificare ({intel.obblighi.length})</h4>
                        <p className="text-[10px] text-amber-100 mt-0.5">Aspetti normativi e contrattuali specifici dell&apos;azienda — non indicano polizze gi&agrave; attive o assenti</p>
                      </div>
                      <div className="p-5 space-y-2">
                        {intel.obblighi.map((o: any, i: number) => (
                          <div key={i} className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-slate-900">{o.polizza}</span>
                              <span className="text-[8px] font-mono text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{o.norma}</span>
                            </div>
                            <p className="text-[11px] text-slate-700 mb-1">{o.descrizione}</p>
                            <p className="text-[10px] text-red-700"><strong>Rischio:</strong> {o.sanzione}</p>
                            <p className="text-[10px] text-blue-700 mt-1"><strong>Azione:</strong> {o.azione_broker}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Opportunit&agrave; di Cross-Sell — slimmed */}
                  {intel.opportunita?.length > 0 && (
                    <div className="bg-white rounded-3xl border border-emerald-200/60 p-0 shadow-lg overflow-hidden">
                      <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-6 py-3.5">
                        <h4 className="text-sm font-bold text-white">Opportunit&agrave; consulenziali ({intel.opportunita.length})</h4>
                        <p className="text-[10px] text-emerald-100 mt-0.5">Da validare in call con il cliente</p>
                      </div>
                      <div className="p-5 space-y-3">
                        {intel.opportunita.map((op: any, i: number) => (
                          <div key={i} className="p-4 rounded-xl bg-gradient-to-br from-white to-emerald-50 border border-emerald-200">
                            <p className="text-xs font-bold text-slate-900 mb-1.5">{op.polizza}</p>
                            <p className="text-[11px] text-slate-700 mb-1"><strong>Perch&eacute;:</strong> {op.motivo_specifico}</p>
                            <p className="text-[11px] text-emerald-800"><strong>Valore per il cliente:</strong> {op.valore_per_cliente}</p>
                            {/* trigger_vendita / premio_indicativo / fonte_dato RIMOSSI:
                                erano script di vendita hard-coded e range premi inventati. */}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Briefing Broker RIMOSSO INTERAMENTE: era template script
                      ad-hoc (apertura "Buongiorno..." standardizzata, domande generic,
                      obiezioni hard-coded). Un broker professionista non usa script
                      copia-incolla. Le DOMANDE rilevanti emergono dalla Broker
                      Intelligence (Trigger Alerts, Risk Concentration, ecc.). */}

                  {/* Fonti normative */}
                  {intel.fonti_normative?.length > 0 && (
                    <p className="text-[9px] text-slate-400">Fonti normative: {intel.fonti_normative.join(' &middot; ')}</p>
                  )}
                  </>
                )
              })()}

              {/* Obblighi Assicurativi Settore */}
              {companySearchResult.obblighi_assicurativi && (
                <div className="bg-white rounded-3xl border border-amber-200/60 p-0 shadow-lg shadow-amber-100/30 overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3.5">
                    <h4 className="text-sm font-bold text-white">Profilo assicurativo settoriale — {companySearchResult.obblighi_assicurativi.settore}</h4>
                  </div>
                  <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-bold text-red-600 uppercase mb-1.5">Obblighi / responsabilità da verificare</p>
                      {companySearchResult.obblighi_assicurativi.polizze_obbligatorie?.map((p: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 mb-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                          <span className="text-[11px] text-slate-700">{p}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-amber-600 uppercase mb-1.5">Raccomandate da verificare</p>
                      {companySearchResult.obblighi_assicurativi.polizze_raccomandate?.map((p: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 mb-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                          <span className="text-[11px] text-slate-700">{p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  </div>
                </div>
              )}

              {/* Stima Premio Annuale RIMOSSA: era benchmark grezzo
                  ATECO×INAIL senza valore per il broker (range generico).
                  Il broker usa tariffari interni più precisi. Priorità
                  commerciale ora in bisogni_assicurativi_verificati. */}

              {/* ═══ Broker Intelligence — Priorità + Trigger + Bisogni + Playbook ═══ */}
              {companySearchResult.bisogni_assicurativi && (
                <div className="bg-white rounded-3xl border border-blue-200/60 p-0 shadow-lg shadow-blue-100/30 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-3.5">
                    <h4 className="text-sm font-bold text-white">Broker Intelligence Assicurativa</h4>
                    <p className="text-[10px] font-medium text-blue-100 mt-0.5">priorit&agrave; consulenziale + trigger alert + opportunit&agrave; — basati su dati Registro Imprese verificati</p>
                  </div>
                  <div className="p-6 space-y-4">

                    {/* Priorità commerciale */}
                    {companySearchResult.bisogni_assicurativi.priorita_commerciale && (() => {
                      const pc = companySearchResult.bisogni_assicurativi.priorita_commerciale
                      const colors = pc.level === 'alta'
                        ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', accent: 'text-red-900' }
                        : pc.level === 'media'
                          ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', accent: 'text-amber-900' }
                          : { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', accent: 'text-emerald-900' }
                      return (
                        <div className={`p-4 rounded-2xl border ${colors.border} ${colors.bg}`}>
                          <div className="flex items-center justify-between mb-2">
                            <p className={`text-[11px] font-black uppercase tracking-wider ${colors.text}`}>Priorit&agrave; consulenziale</p>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase ${colors.text} ${colors.bg} border ${colors.border}`}>{pc.level}</span>
                              <span className={`text-base font-black ${colors.accent}`}>{pc.score}/100</span>
                            </div>
                          </div>
                          {pc.reasons?.length > 0 && (
                            <ul className="space-y-1 mt-1">
                              {pc.reasons.slice(0, 4).map((r: string, i: number) => (
                                <li key={i} className={`text-[12px] ${colors.accent} flex items-start gap-1.5 leading-snug`}>
                                  <span className={`mt-1 w-1.5 h-1.5 rounded-full ${colors.text.replace('text-', 'bg-')} shrink-0`} />
                                  {r}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })()}

                    {/* Trigger Alerts compatti */}
                    {companySearchResult.bisogni_assicurativi.trigger_alerts?.length > 0 && (
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Trigger commerciali verificati ({companySearchResult.bisogni_assicurativi.trigger_alerts.length})</p>
                        <div className="space-y-1.5">
                          {companySearchResult.bisogni_assicurativi.trigger_alerts.slice(0, 5).map((a: any, i: number) => {
                            const c = a.type === 'red_flag'
                              ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'RED FLAG' }
                              : a.type === 'opportunita'
                                ? { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: 'OPPORTUNIT&Agrave;' }
                                : { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'AVVISO' }
                            return (
                              <div key={i} className={`p-2.5 rounded-xl border ${c.border} ${c.bg}`}>
                                <div className="flex items-start gap-2">
                                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase shrink-0 mt-0.5 ${c.text}`} dangerouslySetInnerHTML={{__html: c.label}} />
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-[12px] font-bold ${c.text}`}>{a.title}</p>
                                    <p className="text-[11px] text-slate-700 leading-snug mt-0.5">{a.message}</p>
                                    {a.broker_action && <p className="text-[11px] text-slate-900 font-semibold mt-1">→ {a.broker_action}</p>}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Bisogni raccomandati */}
                    {companySearchResult.bisogni_assicurativi.bisogni_raccomandati?.length > 0 && (
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">Opportunit&agrave; assicurative da validare in call</p>
                        <div className="space-y-1.5">
                          {companySearchResult.bisogni_assicurativi.bisogni_raccomandati.slice(0, 6).map((b: any, i: number) => (
                            <div key={i} className={`p-2.5 rounded-xl border ${
                              b.priority === 'immediata' ? 'bg-red-50 border-red-200' :
                              b.priority === 'alta' ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'
                            }`}>
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                  b.priority === 'immediata' ? 'bg-red-200 text-red-800' :
                                  b.priority === 'alta' ? 'bg-orange-200 text-orange-800' : 'bg-blue-200 text-blue-800'
                                }`}>{b.priority}</span>
                                <span className="text-[12px] font-bold text-slate-800">{b.product}</span>
                              </div>
                              <p className="text-[11px] text-slate-700 leading-snug">{b.sales_reason}</p>
                              {b.why_now && <p className="text-[10px] text-blue-700 font-medium mt-0.5">⚡ {b.why_now}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Playbook semplificato — usa nuovi campi */}
                    {companySearchResult.bisogni_assicurativi.playbook_commerciale && (
                      companySearchResult.bisogni_assicurativi.playbook_commerciale.prodotto_principale ||
                      companySearchResult.bisogni_assicurativi.playbook_commerciale.cross_sell
                    ) && (
                      <div className="p-3.5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-wider mb-2">Playbook prima call</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {companySearchResult.bisogni_assicurativi.playbook_commerciale.prodotto_principale && (
                            <div>
                              <p className="text-[9px] font-bold text-blue-500 uppercase mb-0.5">Prodotto principale</p>
                              <p className="text-[12px] font-bold text-slate-800">{companySearchResult.bisogni_assicurativi.playbook_commerciale.prodotto_principale}</p>
                            </div>
                          )}
                          {companySearchResult.bisogni_assicurativi.playbook_commerciale.cross_sell && (
                            <div>
                              <p className="text-[9px] font-bold text-blue-500 uppercase mb-0.5">Cross-sell</p>
                              <p className="text-[12px] font-bold text-slate-800">{companySearchResult.bisogni_assicurativi.playbook_commerciale.cross_sell}</p>
                            </div>
                          )}
                          {companySearchResult.bisogni_assicurativi.playbook_commerciale.target_principale && (
                            <div>
                              <p className="text-[9px] font-bold text-blue-500 uppercase mb-0.5">Target consigliato</p>
                              <p className="text-[12px] font-bold text-slate-800 capitalize">{companySearchResult.bisogni_assicurativi.playbook_commerciale.target_principale}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="p-2.5 rounded-xl border border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                      ⚠️ Priorit&agrave; consulenziali generate da dati pubblici verificati: NON indicano polizze gi&agrave; attive o assenti. La call verifica copertura reale, scadenze, massimali, esclusioni.
                    </div>
                  </div>
                </div>
              )}

              {/* ── Profilo Assicurativo (sezione integrata, espandibile, fetch lazy) ── */}
              <InsuranceProfileSection
                piva={companySearchResult.partita_iva || null}
                ragioneSociale={companySearchResult.ragione_sociale || companySearchResult.nome || null}
                citta={companySearchResult.citta || null}
              />

              {/* ── Insurance Intelligence (trigger commerciali, network, capacità spesa, eventi) ── */}
              <InsuranceIntelligenceSection
                ragioneSociale={companySearchResult.ragione_sociale || companySearchResult.nome || ''}
                partitaIva={companySearchResult.partita_iva || undefined}
                citta={companySearchResult.citta || undefined}
                ateco={companySearchResult.codice_ateco || companySearchResult.ateco || undefined}
                fatturato={companySearchResult.fatturato || undefined}
                dipendenti={companySearchResult.dipendenti || undefined}
                dataCostituzione={companySearchResult.data_costituzione || undefined}
                ruolo="titolare"
                titolareNome={companySearchResult.titolare || undefined}
                hasLinkedinPresence={!!(companySearchResult.linkedin_url || companySearchResult.linkedin)}
              />

              {/* Fonti */}
              {companySearchResult.fonti?.length > 0 && (
                <p className="text-[9px] text-slate-400">Fonti: {companySearchResult.fonti.join(' · ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Ambiente Search Mode ── */}
      {searchMode === 'ambiente' && (
        <div className="mb-6 space-y-6 bg-slate-50 border border-slate-200 rounded-2xl p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
               Ricerca Ambiente (AI Deep Search)
            </h2>
            <p className="text-sm text-slate-500">
              Usa l&apos;intelligenza artificiale per cercare aziende correlate in base a topic specifici.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-700">Topic di Ricerca (Es. &quot;Imprese Edili Roma&quot;)</label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="text"
                placeholder="Es. agenzie assicurative milano"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleExpandedSearchClick()
                  }
                }}
                className="flex-1 px-4 py-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
              />
              <select
                value={maxLeads}
                onChange={(e) => setMaxLeads(Number(e.target.value))}
                className="px-3 py-3 text-sm text-slate-700 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>{n} lead</option>
                ))}
              </select>
              <button
                type="button"
                disabled={isLoading}
                onClick={handleExpandedSearchClick}
                className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-transform hover:scale-105 whitespace-nowrap"
              >
                <Sparkles className="w-5 h-5" />
                Avvia Ricerca AI
              </button>
            </div>
            <p className="text-[11px] text-slate-500 max-w-lg leading-relaxed mt-1">
              Troveremo centinaia di aziende collegate alla tua parola chiave. Questa ricerca richiede 2-3 minuti.
            </p>
          </div>
        </div>
      )}

      {/* ── Maps Search Mode (+ Shared Results Render) ── */}
      {searchMode !== 'database' && searchMode !== 'azienda' && searchMode !== 'dipendente' && (
      <>

      {/* ── Maps-specific: Spiegazione + Filter chips + Search ── */}
      {searchMode === 'maps' && (
      <>
      <div className="mb-3 px-1">
        <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
          <strong className="text-slate-700">Come cercare:</strong> scrivi <strong>categoria + città</strong> (es. &quot;Edilizia a Milano&quot;) per vedere le aziende.
          Puoi affinare per target assicurativo (es. &quot;Edilizia a Milano <strong>srl</strong>&quot;).
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { label: 'SRL', tip: 'Società a Responsabilità Limitata (Target D&O, TFR)' },
            { label: 'SPA', tip: 'Società per Azioni (Target Key Man, Cyber)' },
            { label: 'senza sito', tip: 'Aziende poco strutturate online' },
            { label: 'clinica', tip: 'Strutture Mediche (RC Medica)' },
            { label: 'costruzioni', tip: 'Imprese edili (Polizza CAR)' },
            { label: 'SNC', tip: 'Società in Nome Collettivo' },
            { label: 'trasporti', tip: 'Aziende logistica/trasporti (RC Vettoriale)' },
          ].map((f) => (
            <button
              key={f.label}
              type="button"
              title={f.tip}
              disabled={isLoading}
              onClick={() => {
                const current = query.trim()
                const kw = f.label.toLowerCase()
                if (current.toLowerCase().includes(kw)) return
                setQuery(current ? `${current} ${f.label}` : f.label)
              }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all cursor-pointer disabled:opacity-50 ${
                query.toLowerCase().includes(f.label.toLowerCase())
                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Selezione ricerca espansa (maps only) ── */}
      <SniperArea
        query={query}
        onQueryChange={setQuery}
        onStart={processSemanticSearch}
        isLoading={isLoading}
        error={error}
        aiDebug={aiDebug}
        maxLeads={maxLeads}
        onMaxLeadsChange={setMaxLeads}
        credits={credits}
      />

      {/* ── Ricerca Espansa ── */}
      <div className="mb-3 flex items-center gap-3 px-1">
        <button
          type="button"
          disabled={isLoading}
          onClick={handleExpandedSearchClick}
          className="rounded-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:shadow-xl disabled:opacity-50 flex items-center gap-2 transition-all duration-200 hover:scale-[1.02]"
        >
          <Sparkles className="w-4 h-4" />
          Trova Aziende
        </button>
        <p className="text-[11px] text-slate-500 max-w-sm hidden sm:block leading-snug">
          Trova <strong>tutte le aziende correlate</strong> alla tua parola chiave. Es: &quot;logistica Milano&quot; ti mostrerà imprese di trasporto, spedizioni, magazzini e molto altro — con analisi rischi inclusa.
        </p>
      </div>

      {/* ── Analizza sito singolo ── */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center px-1 mb-2">
        <input
          type="text"
          placeholder="Oppure cerca una singola azienda dal sito (es. https://crystalweb.it)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="flex-1 px-3 py-2 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
        />
        <button
          onClick={handleAnalyzeSite}
          className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium whitespace-nowrap"
        >
          Analizza sito
        </button>
      </div>
      </>
      )}

      {aiAnalyzing ? (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-600">
          <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />
          <span>L'AI sta ragionando, potrebbe volerci qualche secondo…</span>
        </div>
      ) : null}

      {pendingJobId ? (
        <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Sto analizzando in tempo reale... attendere 2-3 minuti
        </div>
      ) : null}

      {searchState === 'pending' ? (
        <div className="flex flex-col items-center gap-3 p-8 bg-blue-50 border border-blue-200 rounded-2xl mx-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <p className="text-blue-700 font-semibold text-sm">Analisi in corso — risultati tra 2-3 minuti</p>
          </div>
          <div className="w-full max-w-sm bg-blue-200 rounded-full h-2.5 overflow-hidden">
            <div className="bg-blue-600 h-2.5 rounded-full" style={{ animation: 'progressFill 180s ease-in-out forwards', width: '5%' }} />
          </div>
          <p className="text-[11px] text-blue-500">Stiamo analizzando siti web, social e tecnologie di ogni azienda.</p>
        </div>
      ) : null}

      {!isLoading && results.length === 0 ? (
        isScraping ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-600 flex items-center justify-center">
                <div className="dashboard-logo-wrapper">
                  <div className="dashboard-pulse-outer" />
                  <div className="dashboard-pulse-box" />
                  <img
                    src="/ckb-icon.svg"
                    alt="CKB Icon"
                    style={{ width: '90px', height: '90px', position: 'relative', zIndex: 1, borderRadius: '20px' }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>
              </div>
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-2">Stiamo trovando i tuoi lead...</h3>
            <p className="text-slate-600 text-sm mb-2 max-w-sm leading-relaxed">
              L'intelligenza artificiale sta analizzando centinaia di aziende per trovare quelle più in linea con la tua ricerca.
            </p>
            <p className="text-slate-800 text-sm font-semibold mb-6">
              Tempo stimato: 5-15 minuti. Non chiudere la pagina.
            </p>

            <div className="w-80 max-w-full">
              <div className="bg-slate-200 rounded-full h-3 overflow-hidden mb-3 relative">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-blue-500 via-blue-500 to-blue-600"
                  style={{
                    animation: 'scrapingPulse 2.5s ease-in-out infinite',
                    width: '60%',
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] text-slate-500 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Ricerca aziende in corso...
                </p>
                <p className="text-[11px] text-slate-400 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                  Analisi siti web e tecnologie
                </p>
                <p className="text-[11px] text-slate-400 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                  Calcolo opportunità e punteggi
                </p>
              </div>
            </div>
            <style>{`
              @keyframes scrapingPulse {
                0% { width: 30%; opacity: 0.7; }
                50% { width: 75%; opacity: 1; }
                100% { width: 30%; opacity: 0.7; }
              }
            `}</style>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            {/* Minimal empty state */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center mb-5">
              <Search className="w-6 h-6 text-blue-500" />
            </div>

            <h3 className="text-lg font-bold text-slate-800 mb-2">Trova i tuoi prossimi clienti</h3>
            <p className="text-slate-500 text-sm mb-1 max-w-md">
              Scrivi nella barra di ricerca: <strong>tipo di attività</strong> + <strong>città</strong> + <strong>filtro</strong>
            </p>
            <p className="text-slate-400 text-xs mb-5 max-w-sm">
              Clicca sui filtri qui sopra per aggiungerli alla ricerca, oppure prova uno di questi esempi:
            </p>

            <div className="flex flex-wrap gap-2 justify-center mb-6 max-w-lg">
              {[
                'Logistica a Milano SRL',
                'Costruzioni a Roma SPA',
                'Studi Medici a Firenze',
                'Sviluppo Software a Napoli Cyber',
              ].map((text) => (
                <button
                  key={text}
                  type="button"
                  disabled={isLoading}
                  onClick={async () => {
                    setQuery(text)
                    await processSemanticSearch(text)
                  }}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-60 shadow-sm cursor-pointer"
                >
                  {text}
                </button>
              ))}
            </div>

            {/* Ricerca Espansa inline */}
            <div className="flex items-center gap-3 bg-blue-50/60 border border-blue-200/60 rounded-xl px-4 py-3 max-w-md">
              <div className="flex-1 text-left">
                <p className="text-[12px] font-semibold text-slate-700">Ricerca Espansa</p>
                <p className="text-[10px] text-slate-500">Cerca in tempo reale sul web — più tempo ma lead più freschi.</p>
              </div>
              <button
                type="button"
                disabled={isLoading}
                onClick={handleExpandedSearchClick}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm disabled:opacity-50 whitespace-nowrap flex-shrink-0"
              >
                Prova
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          {Array.isArray(results) && results.length > 0 ? (
            <>
              {(isScraping || autoScrapeLoading) && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3 mx-4">
                  <div className="h-5 w-5 rounded-full border-[2.5px] border-blue-300 border-t-blue-600 animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-700">
                      {results.length} lead trovati — Scraping in corso...
                    </p>
                    <p className="text-[11px] text-blue-500 mt-0.5">
                      Nuovi risultati appariranno automaticamente. Puoi già consultare i lead trovati.
                    </p>
                    <div className="mt-2 bg-blue-200 rounded-full h-1.5 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-blue-500" style={{ animation: 'scrapingPulse 2.5s ease-in-out infinite', width: '60%' }} />
                    </div>
                  </div>
                </div>
              )}
              {!autoScrapeLoading && autoScrapeMessage && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 mx-4">
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <p className="text-[12px] text-amber-800 font-medium">{autoScrapeMessage}</p>
                </div>
              )}

              <div className="mb-3 flex items-center justify-between px-4">
                <p className="text-[11px] text-slate-400 hidden sm:block">Salva questi lead in una cartella per contattarli dopo o esportarli.</p>
                <Button
                  onClick={async () => {
                    let sid = effectiveSearchId
                    if (!sid) {
                      sid = await resolveCompletedSearchId(activeFilters)
                    }
                    if (!sid) {
                      toastError('Nessuna ricerca selezionata da salvare', 'Ambienti')
                      return
                    }
                    setSaveToEnvSearchId(sid)
                    setIsSaveToEnvOpen(true)
                  }}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm shadow-md hover:shadow-lg transition-all"
                >
                  <Folder className="w-4 h-4" />
                  Salva in Ambiente
                </Button>
              </div>
            </>
          ) : null}

          <ResultsTable
            query={query}
            results={results}
            isLoading={isLoading}
            isScraping={isScraping || autoScrapeLoading}
            searchId={effectiveSearchId}
            filters={activeFilters}
            aiDebug={aiDebug}
          />
        </>
      )}

      </>
      )}

      <SaveToEnvironmentModal
        open={isSaveToEnvOpen}
        onClose={() => {
          setIsSaveToEnvOpen(false)
          setSaveToEnvSearchId(null)
        }}
        searchId={saveToEnvSearchId}
      />
    </>
  )

}
