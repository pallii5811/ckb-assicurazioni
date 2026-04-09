'use client'



import { useEffect, useMemo, useRef, useState } from 'react'

import SniperArea from '@/components/SniperArea'

import ResultsTable from '@/components/ResultsTable'

import { SaveToEnvironmentModal } from '@/components/SaveToEnvironmentModal'

import { useToast } from '@/components/ToastProvider'

import { analyzeSiteAction, expandAndSearch, processSemanticSearchAction, textToFilterSearchAction } from '@/app/dashboard/actions'

import MiraxLogo from '@/components/MiraxLogo'

import { Button } from '@/components/ui/button'

import { Folder, Sparkles } from 'lucide-react'

import { createClient } from '@/utils/supabase/client'

import { useDashboard } from '@/components/DashboardContext'



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

  // Map basic fields from English to Italian if needed
  const base = hasItalianFields ? {
    ...lead,
    azienda: _s('azienda') || _s('nome') || _s('business_name') || _s('name') || '',
    nome: _s('nome') || _s('azienda') || _s('business_name') || _s('name') || '',
    sito: _s('sito') || _s('website') || '',
    telefono: _s('telefono') || _s('phone') || '',
    email: _cleanEmail(_s('email') || ''),
    citta: _s('citta') || _s('city') || '',
    categoria: _s('categoria') || _s('category') || '',
    instagram: _s('instagram') || '',
  } : {
    ...lead,
    azienda: _s('business_name') || _s('name') || '',
    nome: _s('business_name') || _s('name') || '',
    sito: _s('website') || '',
    telefono: _s('phone') || '',
    email: _cleanEmail(_s('email') || ''),
    citta: _s('city') || '',
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
      if (savedResults) setResults((JSON.parse(savedResults) as any[]).filter(_hasContact))
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

  const [autoScrapeTriggered, setAutoScrapeTriggered] = useState(false)
  const [autoScrapeLoading, setAutoScrapeLoading] = useState(false)
  const prevQueryRef = useRef('')
  const autoscrapePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resultsCountRef = useRef(0)
  const resultsArrRef = useRef<unknown[]>([])

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
      if (autoscrapePollRef.current) {
        clearInterval(autoscrapePollRef.current)
        autoscrapePollRef.current = null
      }
    }
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

    const triggerAutoScrape = async () => {
      try {
        setAutoScrapeTriggered(true)
        setAutoScrapeLoading(true)

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

            if (autoscrapePollRef.current) clearInterval(autoscrapePollRef.current)
            const pollInterval = setInterval(async () => {
              pollCount++
              if (pollCount >= maxPolls) {
                clearInterval(pollInterval)
                autoscrapePollRef.current = null
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
                    const updated = (deduplicateResults([...curArr, ...allowed]) as any[]).filter(_hasContact)
                    resultsArrRef.current = updated
                    resultsCountRef.current = updated.length
                    setResults(updated)
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

                if (jobData.status === 'completed' || jobData.status === 'error' || stalePolls >= 12) {
                  console.log(`[AUTO-SCRAPE] done: status=${jobData.status} results=${scrapeResults.length} total=${resultsCountRef.current}/${maxLeads}`)
                  clearInterval(pollInterval)
                  autoscrapePollRef.current = null
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
              return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
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
          const mergedArr = (deduplicateResults([...existingArr, ...((_tf1 ? arr : arr.map(normalizeLeadFields)) as any[])]) as any[]).filter(_hasContact)
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
    const POLL_TIMEOUT_MS2 = 10 * 60 * 1000 // 10 minutes max

    const interval = window.setInterval(async () => {

      // Timeout: stop polling after 10 min, show whatever we have
      if (Date.now() - _pollStart2 > POLL_TIMEOUT_MS2) {
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
          const merged = (deduplicateResults([...existing, ...normalized]) as any[]).filter(_hasContact)
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
          const merged = (deduplicateResults([...existing, ...normalized]) as any[]).filter(_hasContact)
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

      const displayResults = (deduplicateResults(filtered) as any[]).filter(_hasContact)
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
      let filtered = (deduplicated as any[]).map(normalizeLeadFields).filter(_hasContact)
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

      setResults((deduplicateResults(next) as any[]).filter(_hasContact))

      setSearchState('done')

    } catch (e) {

      console.log('[expanded] error:', e)

    } finally {

      setIsLoading(false)

    }

  }


  return (
    <>
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

      <div className="mt-2 px-4">
        <p className="text-[11px] text-slate-500 mb-1.5">Hai già un sito web da analizzare? Incollalo qui per ottenere un report completo gratuito.</p>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            placeholder="Incolla qui l'indirizzo del sito (es. https://crystalweb.it)"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="flex-1 px-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 placeholder:text-slate-500"
          />
          <button
            onClick={handleAnalyzeSite}
            className="px-4 py-2.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium whitespace-nowrap"
          >
            Analizza sito
          </button>
        </div>
      </div>

      {aiAnalyzing ? (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-600">
          <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />
          <span>L'AI sta ragionando, potrebbe volerci qualche secondo…</span>
        </div>
      ) : null}

      {pendingJobId ? (
        <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          Sto analizzando in tempo reale... attendere 2-3 minuti
        </div>
      ) : null}

      {searchState === 'pending' ? (
        <div className="flex flex-col items-center gap-3 p-8 bg-violet-50 border border-violet-200 rounded-2xl mx-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <p className="text-violet-700 font-semibold text-sm">Analisi in corso — risultati tra 2-3 minuti</p>
          </div>
          <div className="w-full max-w-sm bg-violet-200 rounded-full h-2.5 overflow-hidden">
            <div className="bg-violet-600 h-2.5 rounded-full" style={{ animation: 'progressFill 180s ease-in-out forwards', width: '5%' }} />
          </div>
          <p className="text-[11px] text-violet-500">Stiamo analizzando siti web, social e tecnologie di ogni azienda.</p>
        </div>
      ) : null}

      {/* ── Ricerca Espansa ── */}
      <div className="mb-4 flex items-center gap-3 px-4">
        <button
          type="button"
          disabled={isLoading}
          onClick={handleExpandedSearchClick}
          className="rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          Ricerca Espansa
        </button>
        <span className="text-[11px] text-slate-500 max-w-xs hidden sm:inline">Cerca in tempo reale sul web per trovare lead ancora più aggiornati e completi (usa più crediti).</span>
      </div>

      {!isLoading && results.length === 0 ? (
        isScraping ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <div className="dashboard-logo-wrapper">
                  <div className="dashboard-pulse-outer" />
                  <div className="dashboard-pulse-box" />
                  <img
                    src="/mirax-icon.svg"
                    alt="MiraX Icon"
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
              L&apos;intelligenza artificiale sta analizzando centinaia di aziende per trovare quelle più in linea con la tua ricerca.
            </p>
            <p className="text-slate-800 text-sm font-semibold mb-6">
              Tempo stimato: 5-15 minuti. Non chiudere la pagina.
            </p>

            <div className="w-80 max-w-full">
              <div className="bg-slate-200 rounded-full h-3 overflow-hidden mb-3">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-violet-500 via-purple-500 to-violet-600"
                  style={{
                    animation: 'progressFill 20s ease-in-out forwards',
                    width: '5%',
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] text-slate-500 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Ricerca aziende nel database...
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
              @keyframes progressFill {
                0% { width: 5%; }
                10% { width: 15%; }
                30% { width: 35%; }
                50% { width: 55%; }
                70% { width: 70%; }
                85% { width: 82%; }
                100% { width: 92%; }
              }
            `}</style>
          </div>
        ) : (
          <div className="px-4 space-y-6 pb-8">
            {/* ── STEP 1: Come funziona ── */}
            <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center text-xs font-black">?</span>
                Come funziona la ricerca
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                  <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-black mb-2">1</div>
                  <p className="text-sm font-bold text-slate-800 mb-1">Scrivi cosa cerchi</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Nella barra in alto, scrivi in italiano chi stai cercando. Es: <strong>&quot;Ristoranti a Roma&quot;</strong>. Puoi aggiungere filtri come <strong>&quot;senza Pixel&quot;</strong> o <strong>&quot;con errori SEO&quot;</strong>.
                  </p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                  <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-black mb-2">2</div>
                  <p className="text-sm font-bold text-slate-800 mb-1">Premi &quot;Cerca&quot;</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    L&apos;AI analizza il nostro database e ti mostra le aziende con <strong>telefono, email, sito web, rating</strong> e tutte le opportunità di vendita.
                  </p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                  <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-black mb-2">3</div>
                  <p className="text-sm font-bold text-slate-800 mb-1">Contatta e vendi</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Usa <strong>&quot;Genera Pitch&quot;</strong> per creare un messaggio personalizzato, <strong>&quot;Dettaglio Lead&quot;</strong> per l&apos;analisi completa, o <strong>&quot;Salva in Ambiente&quot;</strong> per salvare i lead.
                  </p>
                </div>
              </div>
            </div>

            {/* ── STEP 2: Come scrivere la query ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-slate-800 mb-1">Come scrivere la tua ricerca</h3>
              <p className="text-[12px] text-slate-500 mb-4">La query è composta da: <strong>tipo di attività</strong> + <strong>città/zona</strong> + <strong>filtro</strong> (opzionale). Ecco come combinarli:</p>

              <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-100">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Formula</p>
                <p className="text-sm font-mono text-slate-800 bg-white px-3 py-2 rounded-lg border border-slate-200">
                  <span className="text-violet-600 font-bold">[tipo attività]</span>
                  {' '}a{' '}
                  <span className="text-blue-600 font-bold">[città]</span>
                  {' '}
                  <span className="text-orange-600 font-bold">[filtro opzionale]</span>
                </p>
              </div>

              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Esempi pronti (clicca per usarli)</p>
              <div className="flex flex-wrap gap-2">
                {[
                  'Ristoranti a Milano senza sito',
                  'Hotel a Roma senza Pixel',
                  'Agenzie a Napoli con errori SEO',
                  'Palestre a Torino senza Instagram',
                  'Dentisti a Firenze senza Google Ads',
                  'Negozi a Bologna senza SSL',
                  'Parrucchieri a Bari con sito lento',
                  'Avvocati a Roma senza Facebook',
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    disabled={isLoading}
                    onClick={async () => {
                      setQuery(text)
                      await processSemanticSearch(text)
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 disabled:opacity-60 shadow-sm cursor-pointer"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>

            {/* ── STEP 3: Legenda Filtri ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-slate-800 mb-1">Filtri disponibili</h3>
              <p className="text-[12px] text-slate-500 mb-4">Aggiungi questi filtri alla tua ricerca per trovare aziende con problemi specifici — sono tuoi potenziali clienti!</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {[
                  { filter: 'senza Pixel', desc: 'Non hanno il Meta Pixel (Facebook) — non fanno retargeting', color: 'bg-red-50 border-red-200 text-red-700', icon: '🎯' },
                  { filter: 'senza Google Ads', desc: 'Non fanno pubblicità su Google — perdono clienti', color: 'bg-blue-50 border-blue-200 text-blue-700', icon: '📢' },
                  { filter: 'senza sito', desc: 'Non hanno un sito web — enorme opportunità', color: 'bg-slate-50 border-slate-200 text-slate-700', icon: '🌐' },
                  { filter: 'con errori SEO', desc: 'Il loro sito ha errori SEO — si posizionano male su Google', color: 'bg-orange-50 border-orange-200 text-orange-700', icon: '🔍' },
                  { filter: 'senza SSL', desc: 'Sito non sicuro (no HTTPS) — penalizzato da Google', color: 'bg-yellow-50 border-yellow-200 text-yellow-700', icon: '🔒' },
                  { filter: 'senza Instagram', desc: 'Non hanno profilo Instagram — mancano visibilità social', color: 'bg-pink-50 border-pink-200 text-pink-700', icon: '📸' },
                  { filter: 'senza Facebook', desc: 'Non hanno pagina Facebook — zero presenza social', color: 'bg-blue-50 border-blue-200 text-blue-700', icon: '👍' },
                  { filter: 'con sito lento', desc: 'Il sito carica lentamente — perdono visitatori', color: 'bg-amber-50 border-amber-200 text-amber-700', icon: '🐌' },
                  { filter: 'senza GTM', desc: 'Non hanno Google Tag Manager — non tracciano nulla', color: 'bg-orange-50 border-orange-200 text-orange-700', icon: '📊' },
                  { filter: 'senza Analytics', desc: 'Non hanno Google Analytics — non misurano il traffico', color: 'bg-red-50 border-red-200 text-red-700', icon: '📈' },
                  { filter: 'senza DMARC', desc: 'Email a rischio spam — le loro email finiscono in spam', color: 'bg-rose-50 border-rose-200 text-rose-700', icon: '✉️' },
                  { filter: 'non mobile', desc: 'Sito non ottimizzato per cellulare — perdono il 60% del traffico', color: 'bg-violet-50 border-violet-200 text-violet-700', icon: '📱' },
                ].map((f) => (
                  <button
                    key={f.filter}
                    type="button"
                    disabled={isLoading}
                    onClick={() => {
                      const current = query.trim()
                      if (current && !current.toLowerCase().includes(f.filter.toLowerCase())) {
                        setQuery(`${current} ${f.filter}`)
                      } else if (!current) {
                        setQuery(f.filter)
                      }
                    }}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition hover:shadow-md hover:scale-[1.01] cursor-pointer ${f.color}`}
                  >
                    <span className="text-lg flex-shrink-0 mt-0.5">{f.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold leading-tight">{f.filter}</p>
                      <p className="text-[10px] opacity-80 leading-snug mt-0.5">{f.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              <p className="text-[10px] text-slate-400 mt-3 text-center">
                Clicca su un filtro per aggiungerlo alla tua ricerca. Puoi combinare più filtri nella stessa query.
              </p>
            </div>

            {/* ── STEP 4: Cos'è la Ricerca Espansa ── */}
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-800 mb-1">Cos&apos;è la Ricerca Espansa?</p>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  La ricerca normale cerca nel nostro database già analizzato (risultati istantanei).
                  La <strong>Ricerca Espansa</strong> cerca anche in tempo reale sul web, trovando aziende nuove non ancora nel database.
                  Impiega più tempo (5-15 min) e usa più crediti, ma restituisce risultati più freschi e completi.
                </p>
              </div>
              <button
                type="button"
                disabled={isLoading}
                onClick={handleExpandedSearchClick}
                className="rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 whitespace-nowrap flex-shrink-0"
              >
                Prova Ricerca Espansa
              </button>
            </div>

            {/* ── STEP 5: Analizza singolo sito ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-sm font-bold text-slate-800 mb-1">Hai già il sito di un potenziale cliente?</p>
              <p className="text-[11px] text-slate-500 mb-3">
                Incolla l&apos;indirizzo del suo sito web nella barra &quot;Analizza sito&quot; qui sopra. Riceverai un report completo gratuito con tutti i problemi del sito, le tecnologie usate, e le opportunità che puoi proporre.
              </p>
            </div>
          </div>
        )
      ) : (
        <>
          {Array.isArray(results) && results.length > 0 ? (
            <>
              {autoScrapeLoading && (
                <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 mb-3 mx-4">
                  <div className="h-4 w-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-violet-700">
                      {results.length} lead trovati — Stiamo cercando altri risultati
                    </p>
                    <p className="text-[11px] text-violet-500 mt-0.5">
                      Analisi in tempo reale in corso. Attendi 5-10 minuti per risultati più completi. Puoi già consultare i lead trovati.
                    </p>
                  </div>
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
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm shadow-md hover:shadow-lg transition-all"
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
            searchId={effectiveSearchId}
            filters={activeFilters}
            aiDebug={aiDebug}
          />
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
