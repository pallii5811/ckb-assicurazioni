'use client'



import { useEffect, useMemo, useRef, useState } from 'react'

import SniperArea from '@/components/SniperArea'

import ResultsTable from '@/components/ResultsTable'

import { SaveToEnvironmentModal } from '@/components/SaveToEnvironmentModal'

import { useToast } from '@/components/ToastProvider'

import { analyzeSiteAction, expandAndSearch, processSemanticSearchAction, textToFilterSearchAction } from '@/app/dashboard/actions'

import MiraxLogo from '@/components/MiraxLogo'

import { Button } from '@/components/ui/button'

import { Folder } from 'lucide-react'

import { createClient } from '@/utils/supabase/client'

import { useDashboard } from '@/components/DashboardContext'



function normalizeLeadFields(lead: any): any {
  const audit = lead.audit || {}
  const hasItalianFields = lead.azienda || lead.nome || lead.sito || lead.telefono

  // Map basic fields from English to Italian if needed
  const base = hasItalianFields ? lead : {
    ...lead,
    azienda: lead.business_name || lead.name || '',
    nome: lead.business_name || lead.name || '',
    sito: lead.website || '',
    telefono: lead.phone || '',
    citta: lead.city || '',
    categoria: lead.category || '',
    instagram: lead.instagram || '',
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
        const existingScore = [existing.email, existing.sito, existing.instagram, existing.rating].filter(Boolean).length
        const newScore = [obj.email, obj.sito, obj.instagram, obj.rating].filter(Boolean).length
        if (newScore > existingScore) seen.set(existingMapKey, item)
      }
      continue
    }

    // Check duplicate by phone
    if (phoneKey && seen.has(phoneKey)) {
      const existing = seen.get(phoneKey) as any
      const existingScore = [existing.email, existing.sito, existing.instagram, existing.rating].filter(Boolean).length
      const newScore = [obj.email, obj.sito, obj.instagram, obj.rating].filter(Boolean).length
      if (newScore > existingScore) seen.set(phoneKey, item)
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
      if (savedResults) setResults(JSON.parse(savedResults))
      const savedFilters = sessionStorage.getItem('ckb_filters')
      if (savedFilters) setActiveFilters(JSON.parse(savedFilters))
      const savedAiDebug = sessionStorage.getItem('ckb_aiDebug')
      if (savedAiDebug) setAiDebug(JSON.parse(savedAiDebug))
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

        // Step 1: Try to fill from the leads table first (fast, no external scraping)
        // Detect if the query requires technical data (needs a website)
        const isNoWebsiteQuery = /senza\s*(sito|website)|no\s*(web|website|sito)|manca\s*(il\s+)?sito|privo\s+di\s+sito/i.test(query)
        const isTechnicalQuery = isNoWebsiteQuery || /errori?\s*(seo|html)|seo\s*error|senza\s*(meta\s*)?pixel|no\s*pixel|senza\s*gtm|no\s*gtm|senza\s*ssl|no\s*ssl|senza\s*google\s*ads|no\s*google\s*ads|senza\s*ads|senza\s*dmarc|no\s*dmarc|rischio\s*spam|sito\s*lento|slow\s*(site|speed)|non\s*mobile|no\s*mobile|senza\s*mobile|senza\s*(google\s*)?analytics|no\s*analytics|senza\s*ga4|no\s*ga4/i.test(query)

        // Build a filter that checks if a NORMALIZED lead matches the query's technical criteria
        const buildTechFilter = (q: string): ((l: any) => boolean) | null => {
          const filters: Array<(l: any) => boolean> = []
          const ql = q.toLowerCase()
          if (/errori?\s*(seo|html)|seo\s*error|con\s*errori/i.test(ql))
            filters.push((l) => {
              const tr = l.technical_report || {}
              const stack = Array.isArray(l.tech_stack) ? l.tech_stack.join(' ').toLowerCase() : ''
              return tr.seo_disaster === true || tr.html_errors === true || stack.includes('disastro seo') || stack.includes('seo error')
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
          return filters.length > 0 ? (lead: any) => filters.some(f => f(lead)) : null
        }
        const techFilter = buildTechFilter(query)

        try {
          // For technical queries: leads table has NO audit data, so ONLY use searches.results
          // For non-technical queries: use leads table (basic info is enough)
          let allRaw: any[] = []

          if (!isTechnicalQuery) {
            // Non-technical: fetch from leads table (basic fields only)
            const leadsResp = await fetch(`/api/leads-live?category=${encodeURIComponent(category)}&city=${encodeURIComponent(city)}`)
            const leadsData = await leadsResp.json().catch(() => ({ leads: [] }))
            const dbLeads = Array.isArray(leadsData.leads) ? leadsData.leads : []
            allRaw.push(...dbLeads)
          }

          // Always fetch from previous completed searches (searches.results) — these HAVE audit data
          try {
            // Extract just the city name for broader matching
            const cityOnly = city.split(/\s+/).filter(w => !['a', 'in', 'di', 'nel', 'nella'].includes(w.toLowerCase())).pop() || city
            const { data: prevSearches } = await supabase
              .from('searches')
              .select('results')
              .ilike('category', `%${category}%`)
              .ilike('location', `%${cityOnly}%`)
              .not('results', 'is', null)
              .order('created_at', { ascending: false })
              .limit(10)
            if (Array.isArray(prevSearches)) {
              for (const s of prevSearches) {
                const r = Array.isArray(s.results) ? s.results : []
                allRaw.push(...r)
              }
            }
          } catch {}

          if (allRaw.length > 0) {
            const normalized = allRaw.map(normalizeLeadFields)
            // Dedup within merged set
            const seenKeys = new Set<string>()
            const deduped = normalized.filter((r: any) => {
              const key = (r.sito || r.website || r.nome || r.azienda || r.name || '').toLowerCase()
              if (!key || seenKeys.has(key)) return false
              seenKeys.add(key)
              return true
            })
            let filtered = isNoWebsiteQuery
              ? deduped.filter((r: any) => {
                  const sito = (r.sito || r.website || '').trim()
                  return !sito || sito === 'N/D' || sito === 'N/A' || sito === 'N.D.' || sito === 'n/d'
                })
              : isTechnicalQuery
                ? deduped.filter((r: any) => {
                    const sito = (r.sito || r.website || '').trim()
                    return sito && sito !== 'N/D' && sito !== 'n/d'
                  })
                : deduped
            if (techFilter) filtered = filtered.filter(techFilter)
            const prev = resultsArrRef.current
            const remaining = maxLeads - prev.length
            if (remaining > 0) {
              const existingKeys = new Set(
                (prev as any[]).map((r: any) =>
                  (r.sito || r.website || r.nome || r.azienda || r.name || '').toLowerCase()
                )
              )
              const newLeads = filtered.filter((r: any) => {
                const key = (r.sito || r.website || r.nome || r.azienda || r.name || '').toLowerCase()
                return key && !existingKeys.has(key)
              })
              const allowed = newLeads.slice(0, Math.min(remaining, creditsRef.current))
              if (allowed.length > 0) {
                const next = [...prev, ...allowed]
                resultsArrRef.current = next
                resultsCountRef.current = next.length
                setResults(next)
                deductCredits(allowed.length)
              }
            }
          }
        } catch {}

        // Step 2: Check if we still need more leads after DB fill
        // Use ref (sync) instead of setState read (broken with React 18 batching)
        if (resultsCountRef.current >= maxLeads) {
          setAutoScrapeLoading(false)
          return
        }

        const persistResults = async () => {
          try {
            const currentResults = resultsArrRef.current
            if (!currentResults || currentResults.length === 0) return

            let sid = searchIdRef.current || currentSearchId

            // If no searchId, find or create one
            if (!sid) {
              const { data: existing } = await supabase
                .from('searches')
                .select('id')
                .ilike('category', category)
                .ilike('location', city)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              if (existing?.id) {
                sid = existing.id
                searchIdRef.current = existing.id
                setCurrentSearchId(existing.id)
              }
            }

            if (sid) {
              const { error } = await supabase
                .from('searches')
                .update({ results: currentResults, status: 'completed' })
                .eq('id', sid)
              if (error) console.warn('[PERSIST] update failed:', error.message)
              else console.log('[PERSIST] saved', currentResults.length, 'leads to', sid)
            } else {
              // No existing row — insert new
              const { data: ins, error } = await supabase
                .from('searches')
                .insert({ category, location: city, status: 'completed', results: currentResults, created_at: new Date().toISOString() })
                .select('id')
                .single()
              if (error) console.warn('[PERSIST] insert failed:', error.message)
              else if (ins?.id) {
                searchIdRef.current = ins.id
                setCurrentSearchId(ins.id)
                console.log('[PERSIST] inserted', currentResults.length, 'leads as', ins.id)
              }
            }
          } catch (e) {
            console.error('[PERSIST] error:', e)
          }
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
                    const updated = deduplicateResults([...curArr, ...allowed]) as any[]
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

        // Step 3: Trigger at most 1 extra scrape job (avoid flooding the worker queue)
        if (resultsCountRef.current < maxLeads && creditsRef.current > 0) {
          await runOneScrapeJob(0)
          await persistResults()
        }

        setAutoScrapeLoading(false)
        await persistResults()
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



    const interval = window.setInterval(async () => {

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

          // Merge with existing results (never reduce count)
          const existingArr = resultsArrRef.current as any[]
          const mergedArr = deduplicateResults([...existingArr, ...arr.map(normalizeLeadFields)]) as any[]
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

    const interval = window.setInterval(async () => {

      try {

        const { data } = await supabase

          .from('searches')

          .select('status, results')

          .eq('id', scrapeJobId)

          .single()

        const parsed = Array.isArray((data as any)?.results) ? (data as any).results : (() => { try { return JSON.parse(((data as any)?.results as any) || '[]') } catch { return [] } })()

        // Helper: apply has_website filter from activeFilters
        const applyWebsiteFilter = (leads: any[]) => {
          if ((activeFilters as any)?.has_website === false) {
            return leads.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
            })
          } else if ((activeFilters as any)?.has_website === true) {
            return leads.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
            })
          }
          return leads
        }

        if (data?.status === 'completed') {

          window.clearInterval(interval)

          setIsScraping(false)

          // Merge completed results with existing (never reduce count, preserve audited emails)
          const normalized = deduplicateResults(applyWebsiteFilter((parsed || []).map(normalizeLeadFields))) as any[]
          const existing = resultsArrRef.current as any[]
          const merged = deduplicateResults([...existing, ...normalized]) as any[]
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
            const normalized = deduplicateResults(applyWebsiteFilter(parsed.map(normalizeLeadFields))) as any[]
            const existing = resultsArrRef.current as any[]
            const merged = deduplicateResults([...existing, ...normalized]) as any[]
            const cappedByMax = merged.slice(0, maxLeads)
            const cappedByCredits = cappedByMax.slice(0, creditsRef.current)
            setResults(cappedByCredits)
          }
          toastError('La ricerca ha riscontrato un errore. Riprova con una query diversa.', 'Errore ricerca')

        } else if (data?.status === 'processing' && Array.isArray(parsed) && parsed.length > 0) {

          // Merge intermediate results with existing (never reduce count, preserve audited emails)
          const normalized = deduplicateResults(applyWebsiteFilter(parsed.map(normalizeLeadFields))) as any[]
          const existing = resultsArrRef.current as any[]
          const merged = deduplicateResults([...existing, ...normalized]) as any[]
          const cappedByMax = merged.slice(0, maxLeads)
          const cappedByCredits = cappedByMax.slice(0, creditsRef.current)
          setResults(cappedByCredits)

        }

      } catch (e) {

        console.log('[poll] error:', e)

      }

    }, 5000)



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

      setResults(deduplicateResults(filtered))

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

      toastSuccess(`Trovati ${filtered.length} risultati.`, 'Ricerca completata')

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

      // First deduplicate, then cap by credits, then charge
      const deduplicated = deduplicateResults(Array.isArray(rawFiltered) ? rawFiltered : [])
      const capped = deduplicated.slice(0, effectiveMax)
      const leadsToCharge = capped.length

      // Deduct credits based on actual unique leads returned
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

      setResults(deduplicateResults(next))

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

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center mt-2 px-4">
        <input
          type="text"
          placeholder="Oppure incolla URL sito (es. https://crystalweb.it)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="flex-1 px-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 placeholder:text-slate-400"
        />
        <button
          onClick={handleAnalyzeSite}
          className="px-4 py-2.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium whitespace-nowrap"
        >
          Analizza sito
        </button>
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
        <div className="flex flex-col items-center gap-4 p-8">
          <p className="text-purple-400 font-semibold animate-pulse">⏳ Sto analizzando in tempo reale... attendere 2-3 minuti</p>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div className="bg-purple-600 h-2 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      ) : null}

      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="shrink-0">🤖 Suggerimenti AI:</span>
          {[
            'Hotel a Roma senza Pixel',
            'Agenzie a Milano con errori SEO',
            'Ristoranti senza sito',
            'Imprese edili a Torino senza Google Ads',
          ].map((text) => (
            <button
              key={text}
              type="button"
              disabled={isLoading}
              onClick={async () => {
                setQuery(text)
                await processSemanticSearch(text)
              }}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <button
          type="button"
          disabled={isLoading}
          onClick={handleExpandedSearchClick}
          className="rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-violet-600 hover:to-purple-700 disabled:opacity-50"
        >
          Ricerca Espansa
        </button>
      </div>

      {!isLoading && results.length === 0 ? (
        isScraping ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
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

            <h3 className="text-xl font-bold text-slate-800 mb-2">Analisi in tempo reale in corso...</h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm leading-relaxed">
              Sto estraendo centinaia di dati.
              <br />
              <strong className="text-slate-700">Attendere fino a 15–20 minuti.</strong>
            </p>

            <div className="w-64 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 animate-pulse"
                style={{ width: '60%' }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center">
                <div className="dashboard-logo-wrapper">
                  <div className="dashboard-pulse-outer" />
                  <div className="dashboard-pulse-box" />
                  <img
                    src="/mirax-icon.svg"
                    alt="MiraX Icon"
                    style={{ width: '90px', height: '90px', position: 'relative', zIndex: 1, borderRadius: '20px' }}
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).src = '/mirax-icon.svg'
                    }}
                  />
                </div>
              </div>
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-2">Pronto. Scrivi il tuo target.</h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm leading-relaxed">
              Descrivi chi stai cercando in linguaggio naturale. L'AI trova i lead più profilati nel database.
            </p>
          </div>
        )
      ) : (
        <>
          {Array.isArray(results) && results.length > 0 ? (
            <>
              {autoScrapeLoading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#EEF2FF',
                    border: '1px solid #C7D2FE',
                    borderRadius: 10,
                    padding: '10px 16px',
                    marginBottom: 12,
                    marginLeft: 16,
                    marginRight: 16,
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid #6366F1',
                      borderTopColor: 'transparent',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#6366F1',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    Trovati {results.length} lead — Stiamo analizzando nuovi lead in tempo reale. Attendi 5-10 minuti per risultati più completi.
                  </span>
                </div>
              )}

              <div className="mb-3 flex items-center justify-end px-4">
                <Button
                  variant="outline"
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
                  className="flex items-center gap-2"
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
