'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Copy,
  ExternalLink,
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MessageCircle,
  Minus,
  Sparkles,
  Star,
  Smartphone,
  Megaphone,
  Target,
  TrendingUp,
  Building2,
  Video,
  Check,
  Loader2,
  Phone,
  Shield,
  Users,
  Briefcase,
  MapPin,
  Globe,
  AlertTriangle,
  Zap,
  Clock,
  Newspaper,
  UserPlus,
  DollarSign,
  Scale,
} from 'lucide-react'
import { calcOpportunityScore } from '@/components/ResultsTable'
import { generatePitchAction } from '@/app/dashboard/actions'
import { analyzeReviewsForRisk } from '@/lib/insurance-analysis'

type LeadDetailClientProps = {
  lead: any | null
  searchId: string
  leadIndex: number
  category?: string | null
  location?: string | null
}

function getScoreVariant(score: number): { label: 'COLD' | 'WARM' | 'HOT'; className: string } {
  if (score >= 70) return { label: 'HOT', className: 'bg-rose-600 text-white' }
  if (score >= 40) return { label: 'WARM', className: 'bg-amber-500 text-white' }
  return { label: 'COLD', className: 'bg-slate-200 text-slate-800' }
}

const renderLeadString = (obj: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = obj[k]
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      const s = v.filter(x => x).join(', ')
      if (s.trim()) return s
    }
    const s = String(v).trim()
    if (s && s.toLowerCase() !== 'n/d' && s.toLowerCase() !== 'n/a' && s.toLowerCase() !== 'none' && s !== 'null') return s
  }
  return ''
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function safeStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(safeStr).filter(Boolean).join(', ')
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(safeStr).filter(Boolean).join(' — ')
  return String(v)
}

function toHref(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  return s.startsWith('http') ? s : `https://${s}`
}

function daysSince(raw: string | null): number | null {
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24))
}

function formatFollowers(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function formatVisibleSource(source: string): string {
  const s = source.toLowerCase()
  if (s.includes('registro')) return 'Registro Imprese'
  if (s.includes('vies')) return 'VIES'
  if (s.includes('linkedin')) return 'LinkedIn'
  if (s.includes('inipec') || s.includes('ini-pec') || s.includes('pec')) return 'INI-PEC'
  if (s.includes('apollo') || s.includes('snov') || s.includes('hunter')) return 'Fonti professionali'
  if (s.includes('google') || s.includes('maps')) return 'Fonti pubbliche'
  if (s.includes('website') || s.includes('web')) return 'Sito web'
  return source.replace(/[_-]/g, ' ').trim()
}

export default function LeadDetailClient({ lead: leadProp, searchId, leadIndex, category, location }: LeadDetailClientProps) {
  // Primary source: the exact lead saved when user clicked "Dettaglio Lead"
  // This bypasses any index mismatch between filtered display and unfiltered Supabase array
  const [sessionLead, setSessionLead] = useState<any>(null)
  useEffect(() => {
    try {
      // 1. Check for the exact lead saved on click (most reliable)
      const activeLead = sessionStorage.getItem('ckb_active_lead')
      if (activeLead) {
        const parsed = JSON.parse(activeLead)
        if (parsed && typeof parsed === 'object') {
          setSessionLead(parsed)
          return
        }
      }
      // 2. Fallback: look up by index in cached results array
      if (!leadProp) {
        const raw = sessionStorage.getItem('ckb_results')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed[leadIndex]) {
            setSessionLead(parsed[leadIndex])
          }
        }
      }
    } catch {}
  }, [leadProp, leadIndex])

  // sessionLead (from click) takes priority over server prop (may have wrong index)
  const lead = sessionLead || leadProp

  const score = useMemo(() => {
    try {
      return calcOpportunityScore(lead && typeof lead === 'object' ? (lead as any) : {})
    } catch {
      return 0
    }
  }, [lead])

  const scoreMeta = useMemo(() => getScoreVariant(score), [score])

  // Derived values — safe to compute even when lead is null (all default to '')
  const nome = isNonEmptyString(lead?.nome) ? lead.nome : isNonEmptyString(lead?.azienda) ? lead.azienda : ''
  const citta = isNonEmptyString(lead?.citta) ? lead.citta : isNonEmptyString(lead?.city) ? lead.city : ''
  const categoria = isNonEmptyString(lead?.categoria) ? lead.categoria : isNonEmptyString(lead?.category) ? lead.category : ''

  const rawTelefono = isNonEmptyString(lead?.telefono) ? lead.telefono : isNonEmptyString(lead?.phone) ? lead.phone : ''
  // Filter out P.IVA numbers that end up in phone field (11 digits, no +/prefix, not starting with 0 or 3)
  const telefono = (() => {
    if (!rawTelefono) return ''
    const parts = rawTelefono.split(/[\/,;]+/).map((p: string) => p.trim()).filter((p: string) => {
      const d = p.replace(/\D/g, '')
      if (!d) return false
      // P.IVA: exactly 11 digits, doesn't start with 0 or 3 (not a phone)
      if (d.length === 11 && !/^[03]/.test(d)) return false
      // Too short or too long for Italian phone
      if (d.length < 6 || d.length > 13) return false
      return true
    })
    return parts.join(' / ')
  })()
  const email = isNonEmptyString(lead?.email) ? lead.email : ''
  const sitoRaw = isNonEmptyString(lead?.sito) ? lead.sito : isNonEmptyString(lead?.website) ? lead.website : isNonEmptyString(lead?.url) ? lead.url : ''
  const sitoHref = sitoRaw ? toHref(sitoRaw) : ''
  const indirizzo = isNonEmptyString(lead?.indirizzo)
    ? lead.indirizzo
    : isNonEmptyString(lead?.address)
      ? lead.address
      : isNonEmptyString(lead?.via)
        ? lead.via
        : ''

  const techStack: string[] = Array.isArray(lead?.tech_stack)
    ? (lead.tech_stack as unknown[]).filter((v) => typeof v === 'string')
    : Array.isArray(lead?.techStack)
      ? (lead.techStack as unknown[]).filter((v) => typeof v === 'string')
      : []

  const stackStr = techStack.join(' ').toLowerCase()
  const technicalReport = lead?.technical_report && typeof lead.technical_report === 'object' ? (lead.technical_report as any) : null

  const sslOk = lead?.ssl === true || (typeof sitoHref === 'string' && sitoHref.startsWith('https://'))
  const hasPixel = lead?.meta_pixel === true && !stackStr.includes('no pixel') && !stackStr.includes('missing fb pixel')
  const hasGtm = lead?.google_tag_manager === true && !stackStr.includes('no gtm') && !stackStr.includes('missing gtm')
  const hasGoogleAds = technicalReport?.has_google_ads !== false && !stackStr.includes('no google ads') && !stackStr.includes('missing google ads') && !stackStr.includes('no ads')

  const loadSpeedRaw =
    technicalReport?.load_speed_s ??
    technicalReport?.load_speed_seconds ??
    lead?.load_speed_s ??
    lead?.load_speed_seconds

  const loadSpeedSeconds = typeof loadSpeedRaw === 'number' ? loadSpeedRaw : typeof loadSpeedRaw === 'string' ? Number(loadSpeedRaw) : null

  const speedTone =
    typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds)
      ? loadSpeedSeconds < 2
        ? 'text-emerald-600'
        : loadSpeedSeconds <= 4
          ? 'text-amber-600'
          : 'text-indigo-600'
      : 'text-slate-500'

  const seoErrors: string[] = Array.isArray(lead?.html_errors)
    ? (lead.html_errors as unknown[]).filter((v) => typeof v === 'string')
    : Array.isArray(lead?.htmlErrors)
      ? (lead.htmlErrors as unknown[]).filter((v) => typeof v === 'string')
      : []

  const opportunityItems = useMemo(() => {
    if (!lead) return []
    const out: string[] = []
    const cat = ((lead as any)?.categoria || (lead as any)?.category || '').toLowerCase()
    const nome = ((lead as any)?.nome || (lead as any)?.name || '').toLowerCase()
    const combined = `${nome} ${cat}`
    if (/costruzion|edili|edile|impian|cantier/.test(combined)) out.push('Settore ad alto rischio infortuni')
    if (/s\.?r\.?l|s\.?p\.?a/.test(nome)) out.push('Società di capitali — serve D&O e Cyber')
    if (/medic|dentist|clinic|farmaci/.test(combined)) out.push('Settore sanitario — RC Medica obbligatoria')
    if (/ristorant|bar |pizz|aliment|panific/.test(combined)) out.push('Rischio incendio e RC Terzi elevato')
    if (/trasport|logistic|spedizion/.test(combined)) out.push('Flotta veicoli e merci da assicurare')
    if (/avvocat|commerciali|notai|architect|ingegner|consulen/.test(combined)) out.push('RC Professionale obbligatoria')
    if (out.length === 0) out.push('Analisi rischi disponibile nel dettaglio')
    return out
  }, [lead])

  const [reviews, setReviews] = useState<any>(null)
  const reviewRiskSignals = useMemo(() => {
    if (!reviews?.reviews || !Array.isArray(reviews.reviews)) return null
    const texts = reviews.reviews.map((r: any) => r?.text || '').filter(Boolean)
    if (texts.length === 0) return null
    const result = analyzeReviewsForRisk(texts)
    return result.found ? result : null
  }, [reviews])
  const [social, setSocial] = useState<any>(null)
  const [ads, setAds] = useState<any>(null)
  const [competitors, setCompetitors] = useState<any>(null)
  const [trends, setTrends] = useState<any>(null) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [registry, setRegistry] = useState<any>(null)
  const [loadingReviews, setLoadingReviews] = useState(true)
  const [loadingSocial, setLoadingSocial] = useState(true)
  const [loadingAds, setLoadingAds] = useState(true)
  const [loadingCompetitors, setLoadingCompetitors] = useState(true)
  const [loadingTrends, setLoadingTrends] = useState(true)
  const [loadingRegistry, setLoadingRegistry] = useState(true)
  const [clayData, setClayData] = useState<any>(null)
  const [loadingClay, setLoadingClay] = useState(true)
  const [triggersData, setTriggersData] = useState<any>(null)
  const [loadingTriggers, setLoadingTriggers] = useState(false)
  const [peopleData, setPeopleData] = useState<any>(null)
  const [loadingPeople, setLoadingPeople] = useState(false)

  const [monitorStatus, setMonitorStatus] = useState<'idle' | 'saving' | 'monitored' | 'error'>('idle')
  const [monitorError, setMonitorError] = useState<string | null>(null)

  const [pitchLoading, setPitchLoading] = useState(false)
  const [pitchResult, setPitchResult] = useState<{ subject: string; body: string } | null>(null)
  const [pitchError, setPitchError] = useState<string | null>(null)
  const [showPitchModal, setShowPitchModal] = useState(false)

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const [coldEmail, setColdEmail] = useState('')

  useEffect(() => {
    if (!lead) return
    const name = encodeURIComponent(lead?.nome || lead?.azienda || '')
    const city = encodeURIComponent(lead?.citta || lead?.city || '')
    const website = encodeURIComponent(lead?.sito || lead?.website || lead?.url || '')
    const cat = encodeURIComponent(category || lead?.categoria || lead?.category || '')

    setLoadingReviews(true)
    setLoadingSocial(true)
    setLoadingAds(true)
    setLoadingCompetitors(true)
    setLoadingTrends(true)
    setLoadingRegistry(true)

    fetch('/api/lead-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          ...lead,
          nome: lead?.nome || lead?.azienda || lead?.business_name || '',
          citta: lead?.citta || lead?.city || location || '',
        },
      }),
    })
      .then((r) => r.json())
      .then((d) => setReviews(d))
      .catch(() => setReviews(null))
      .finally(() => setLoadingReviews(false))

    fetch('/api/lead-social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead }),
    })
      .then((r) => r.json())
      .then((d) => setSocial(d))
      .catch(() => setSocial(null))
      .finally(() => setLoadingSocial(false))

    fetch(`/api/lead-ads?name=${name}&website=${website}&city=${city}&category=${cat}`)
      .then((r) => r.json())
      .then((d) => setAds(d))
      .catch(() => setAds(null))
      .finally(() => setLoadingAds(false))

    fetch('/api/lead-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchCategory: category || '',
        lead: {
          ...lead,
          categoria: lead?.categoria || lead?.category || category || '',
          citta: lead?.citta || lead?.city || location || '',
        },
      }),
    })
      .then((r) => r.json())
      .then((d) => setCompetitors(d))
      .catch(() => setCompetitors(null))
      .finally(() => setLoadingCompetitors(false))

    // Trends section removed — was generating AI-hallucinated statistics
    setLoadingTrends(false)

    fetch('/api/lead-registry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          ...lead,
          categoria: lead?.categoria || lead?.category || category || '',
          citta: lead?.citta || lead?.city || location || '',
          indirizzo: lead?.indirizzo || lead?.address || lead?.via || '',
        },
      }),
    })
      .then((r) => r.json())
      .then((d) => setRegistry(d))
      .catch(() => setRegistry(null))
      .finally(() => setLoadingRegistry(false))

    // Clay-style enrichment (all sources)
    setLoadingClay(true)
    fetch('/api/enrich-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          nome: lead?.nome || lead?.azienda || lead?.business_name || '',
          sito: lead?.sito || lead?.website || lead?.url || '',
          telefono: lead?.telefono || lead?.phone || '',
          email: lead?.email || '',
          citta: lead?.citta || lead?.city || location || '',
          categoria: lead?.categoria || lead?.category || category || '',
          indirizzo: lead?.indirizzo || lead?.address || lead?.via || '',
        },
      }),
    })
      .then((r) => r.json())
      .then((d) => setClayData(d))
      .catch(() => setClayData(null))
      .finally(() => setLoadingClay(false))
  }, [lead, category])

  // Fetch B2B triggers once registry data is available
  useEffect(() => {
    if (!lead || loadingRegistry) return
    setLoadingTriggers(true)
    fetch('/api/lead-triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          nome: lead?.nome || lead?.azienda || lead?.business_name || '',
          citta: lead?.citta || lead?.city || location || '',
          categoria: lead?.categoria || lead?.category || category || '',
          sito: lead?.sito || lead?.website || lead?.url || '',
        },
        registry: registry || {},
      }),
    })
      .then((r) => r.json())
      .then((d) => { console.log('[TRIGGERS] Dati ricevuti:', d?.triggers?.length, 'trigger, summary:', d?.summary); setTriggersData(d) })
      .catch((err) => { console.error('[TRIGGERS] Fetch fallito:', err); setTriggersData(null) })
      .finally(() => setLoadingTriggers(false))

    // Fetch people enrichment in parallel
    setLoadingPeople(true)
    fetch('/api/lead-people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: lead?.nome || lead?.azienda || lead?.business_name || '',
        ragioneSociale: registry?.ragione_sociale || clayData?.ragioneSociale || clayData?.ragineSociale || null,
        city: lead?.citta || lead?.city || location || '',
        piva: registry?.partita_iva || clayData?.partitaIva || null,
        categoria: lead?.categoria || lead?.category || category || '',
        formaGiuridica: registry?.forma_giuridica || clayData?.formaGiuridica || null,
        website: lead?.sito || lead?.website || lead?.url || '',
        teamMembers: clayData?.teamMembers || [],
        personName: clayData?.personName || null,
        personRole: clayData?.personRole || null,
        linkedinPerson: clayData?.linkedinPerson || null,
        linkedinCompany: clayData?.linkedinCompany || null,
        titolareFromRegistry: registry?.titolare || null,
        titolareCF: registry?.codice_fiscale_titolare || null,
        titolareDataNascita: registry?.titolare_data_nascita || null,
        titolareSesso: registry?.titolare_sesso || null,
        titolareEta: registry?.titolare_eta || null,
      }),
    })
      .then((r) => r.json())
      .then((d) => setPeopleData(d))
      .catch(() => setPeopleData(null))
      .finally(() => setLoadingPeople(false))
  }, [lead, registry, loadingRegistry, category, location])

  useEffect(() => {
    const baseName = nome || 'Ciao'
    const settore = registry?.obblighi_assicurativi?.settore || categoria || ''
    const formaGiur = registry?.forma_giuridica || ''
    const gapTop = registry?.gap_analysis?.gaps?.[0]?.area || ''
    const polizzaPrincipale = registry?.bisogni_assicurativi_verificati?.playbook_commerciale?.prodotto_principale || ''

    let body = `Oggetto: Analisi gratuita coperture assicurative per ${baseName}\n\nGentile ${baseName},\n\n`
    if (settore) {
      body += `Mi occupo di consulenza assicurativa specializzata nel settore ${settore}`
      if (formaGiur) body += ` per aziende con forma ${formaGiur}`
      body += `.\n\n`
    } else {
      body += `Mi occupo di consulenza assicurativa per imprese.\n\n`
    }
    if (gapTop) {
      body += `Dalla nostra analisi preliminare, emerge che un'area critica per la vostra realtà è: ${gapTop}. Spesso le coperture standard non coprono adeguatamente questo rischio.\n\n`
    } else {
      body += `Ho analizzato il vostro settore: emergono alcuni rischi specifici che spesso non sono adeguatamente coperti.\n\n`
    }
    if (polizzaPrincipale) {
      body += `Posso inviarvi un'analisi gratuita focalizzata su ${polizzaPrincipale} con 3 raccomandazioni prioritarie?\n\n`
    } else {
      body += `Posso inviarvi un'analisi gratuita delle vostre coperture attuali con 3 raccomandazioni prioritarie?\n\n`
    }
    body += `Resta inteso che non c'è alcun impegno.\n\nCordiali saluti,\n[Il tuo nome]\nCKB Assicurazione`
    setColdEmail(body)
  }, [nome, registry, categoria])

  if (!lead) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-slate-500">Caricamento dettaglio lead...</p>
      </div>
    )
  }

  const copyToClipboard = async (text?: string) => {
    try {
      await navigator.clipboard.writeText(text || coldEmail)
    } catch {
      // ignore
    }
  }

  const onGeneraPitch = async () => {
    setPitchLoading(true)
    setPitchError(null)
    try {
      const result = await generatePitchAction({
        nome: nome || '',
        sito: sitoRaw || '',
        citta: citta || '',
        categoria: categoria || '',
        email: email || '',
        rating: lead?.rating ?? null,
        tech_stack: techStack,
        html_errors: seoErrors,
        page_speed: loadSpeedSeconds,
      })
      setPitchResult(result)
      setShowPitchModal(true)
    } catch (e) {
      setPitchError(e instanceof Error ? e.message : 'Errore generazione pitch')
    } finally {
      setPitchLoading(false)
    }
  }

  const onContatta = () => {
    if (email) {
      const subject = pitchResult?.subject || `Proposta per ${nome}`
      const body = pitchResult?.body || coldEmail
      window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank')
    } else if (telefono) {
      window.open(`tel:${telefono.replace(/\s/g, '')}`, '_blank')
    }
  }

  const onSalva = async () => {
    setSaveStatus('saving')
    try {
      const existing = JSON.parse(sessionStorage.getItem('ckb_saved_leads') || '[]')
      const alreadySaved = existing.some((l: any) => (l?.nome === nome && l?.sito === sitoRaw))
      if (!alreadySaved) {
        existing.push({ ...lead, saved_at: new Date().toISOString() })
        sessionStorage.setItem('ckb_saved_leads', JSON.stringify(existing))
      }
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  const onMonitorLead = async () => {
    try {
    setMonitorError(null)
    setMonitorStatus('saving')
    setMonitorError(null)

    const res = await fetch('/api/monitor-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchId,
        leadIndex,
        leadName: nome,
        leadWebsite: sitoRaw,
        leadCity: citta || location || '',
        leadCategory: categoria || category || '',
      }),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as any

    if (data?.id || data?.monitor?.id || data?.success === true) {
      setMonitorStatus('monitored')
      return
    }

    setMonitorStatus('error')
    setMonitorError('Risposta non valida')
  } catch (e) {
    setMonitorStatus('error')
    setMonitorError(e instanceof Error ? e.message : 'Errore')
  }

  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1280px] mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: 'clamp(1.4rem, 3vw, 1.8rem)',
              fontWeight: 700, color: '#0F172A',
              letterSpacing: '-0.02em', margin: 0,
            }}>
              {nome || 'Lead'}
            </h1>
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: '4px 12px', borderRadius: 999,
              background: score >= 70 ? '#FEF2F2' : score >= 40 ? '#FFF7ED' : '#F1F5F9',
              color: score >= 70 ? '#DC2626' : score >= 40 ? '#EA580C' : '#64748B',
              border: `1px solid ${score >= 70 ? '#FECACA' : score >= 40 ? '#FED7AA' : '#E2E8F0'}`,
              fontFamily: 'DM Sans, sans-serif',
            }}>
              {scoreMeta.label}
            </span>
          </div>
          <div style={{ fontSize: 14, color: '#64748B', fontFamily: 'DM Sans, sans-serif' }}>
            {citta || location || '—'}
            <span style={{ margin: '0 8px', color: '#CBD5E1' }}>•</span>
            {categoria || category || '—'}
          </div>
          {registry?.stima_premio?.totale_stimato && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#EEF2FF', border: '1px solid #C7D2FE',
              borderRadius: 8, padding: '4px 12px', marginTop: 6,
              fontSize: 12, fontWeight: 700, color: '#4338CA',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              <DollarSign size={13} />
              Potenziale stimato: {registry.stima_premio.totale_stimato}/anno
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={onGeneraPitch}
            disabled={pitchLoading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: pitchLoading ? '#A5B4FC' : '#6366F1', color: 'white',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: 'none', cursor: pitchLoading ? 'wait' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
            }}>
            {pitchLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {pitchLoading ? 'Generando...' : 'Genera Pitch'}
          </button>

          {monitorStatus === 'monitored' ? (
            <button disabled style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#F0FDF4', color: '#16A34A',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: '1px solid #BBF7D0', cursor: 'default',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              Monitorato ✓
            </button>
          ) : (
            <button
              onClick={onMonitorLead}
              disabled={monitorStatus === 'saving'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'white', color: '#475569',
                fontSize: 13, fontWeight: 600,
                padding: '9px 18px', borderRadius: 8,
                border: '1px solid #E2E8F0', cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}>
              🔔 Monitora
            </button>
          )}

          <button
            onClick={onContatta}
            disabled={!email && !telefono}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: (!email && !telefono) ? '#94A3B8' : '#0F172A', color: 'white',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: 'none', cursor: (!email && !telefono) ? 'not-allowed' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}>
            <MessageCircle size={14} />
            Contatta
          </button>

          <button
            onClick={onSalva}
            disabled={saveStatus === 'saving' || saveStatus === 'saved'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: saveStatus === 'saved' ? '#F0FDF4' : 'white',
              color: saveStatus === 'saved' ? '#16A34A' : '#475569',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: `1px solid ${saveStatus === 'saved' ? '#BBF7D0' : '#E2E8F0'}`,
              cursor: saveStatus === 'saved' ? 'default' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}>
            {saveStatus === 'saved' ? <Check size={14} /> : <BookmarkPlus size={14} />}
            {saveStatus === 'saved' ? 'Salvato' : saveStatus === 'saving' ? 'Salvataggio...' : 'Salva'}
          </button>

          <Link href="/dashboard" style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: 13, fontWeight: 500,
            color: '#94A3B8', textDecoration: 'none',
            fontFamily: 'DM Sans, sans-serif',
            padding: '9px 14px',
          }}>
            ← Torna
          </Link>
        </div>
      </div>

      {monitorStatus === 'error' && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 10, padding: '10px 16px',
          fontSize: 13, color: '#DC2626',
          fontFamily: 'DM Sans, sans-serif',
          marginBottom: 16,
        }}>
          Errore monitor: {monitorError || 'impossibile salvare'}
        </div>
      )}

      {/* Top 3 card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Contatti */}
        <div style={{
          background: 'white', border: '1px solid #F1F5F9',
          borderRadius: 16, padding: '24px',
          boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#94A3B8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: 'DM Sans, sans-serif', marginBottom: 16,
          }}>
            Contatti
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { label: 'Telefono', value: telefono || '—' },
              { label: 'Email', value: email || '—' },
              { label: 'Sito', value: sitoRaw || '—', href: sitoHref },
              { label: 'Indirizzo', value: indirizzo || '—' },
            ].map(({ label, value, href }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'flex-start',
                justifyContent: 'space-between', gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid #F8FAFC',
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: '#94A3B8',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontFamily: 'DM Sans, sans-serif', flexShrink: 0,
                }}>
                  {label}
                </span>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" style={{
                    fontSize: 13, fontWeight: 500, color: '#6366F1',
                    wordBreak: 'break-all', textAlign: 'right',
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    {value}
                  </a>
                ) : (
                  <span style={{
                    fontSize: 13, fontWeight: 500, color: '#0F172A',
                    wordBreak: 'break-all', textAlign: 'right',
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    {value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Sezione Analisi Tecnica nascosta — non rilevante per assicurazioni */}

        {/* Score */}
        <div style={{
          background: 'white', border: '1px solid #F1F5F9',
          borderRadius: 16, padding: '24px',
          boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#94A3B8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: 'DM Sans, sans-serif', marginBottom: 16,
          }}>
            Score & Opportunità
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: score >= 70
                ? 'linear-gradient(135deg, #EF4444, #F97316)'
                : score >= 40
                ? 'linear-gradient(135deg, #F97316, #EAB308)'
                : 'linear-gradient(135deg, #94A3B8, #64748B)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0,
              boxShadow: score >= 70
                ? '0 8px 20px rgba(239,68,68,0.3)'
                : score >= 40
                ? '0 8px 20px rgba(249,115,22,0.3)'
                : '0 8px 20px rgba(100,116,139,0.2)',
            }}>
              <span style={{
                fontSize: 22, fontWeight: 900, color: 'white',
                fontFamily: 'Syne, sans-serif',
              }}>
                {score}
              </span>
            </div>
            <div>
              <div style={{
                fontSize: 15, fontWeight: 700, color: '#0F172A',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {score >= 70 ? '🔥 HOT' : score >= 40 ? '⚡ WARM' : '❄️ COLD'}
              </div>
              <div style={{
                fontSize: 12, color: '#94A3B8',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                Score {score}/100
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-700 mb-2">Opportunità</div>
            {opportunityItems.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {opportunityItems.map((o, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-0.5 w-5 h-5 rounded-full 
                      bg-blue-100 border border-blue-200 
                      flex items-center justify-center 
                      text-blue-600 text-xs font-black shrink-0">
                      !
                    </span>
                    <span className="text-slate-800">{o}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-sm text-slate-500">—</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Insurance Summary (at-a-glance for broker) ── */}
      {registry && !loadingRegistry && (registry.forma_giuridica || registry.codice_ateco || registry.fatturato || registry.dipendenti) && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4 shadow-sm">
          <div className="flex items-center flex-wrap gap-3">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Profilo rapido</span>
            {registry.forma_giuridica && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                {safeStr(registry.forma_giuridica)}
              </span>
            )}
            {registry.codice_ateco && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
                ATECO {safeStr(registry.codice_ateco)}
              </span>
            )}
            {registry.fatturato && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                € {safeStr(registry.fatturato)}
              </span>
            )}
            {registry.dipendenti && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 border border-violet-200">
                {safeStr(registry.dipendenti)} dipendenti
              </span>
            )}
            {registry.classificazione_eu?.classe && (
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
                registry.classificazione_eu.classe === 'grande' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                registry.classificazione_eu.classe === 'media' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                registry.classificazione_eu.classe === 'piccola' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-slate-50 text-slate-600 border-slate-200'
              }`}>
                {safeStr(registry.classificazione_eu.label)}
              </span>
            )}
            {registry.obblighi_assicurativi?.polizze_obbligatorie?.slice(0, 2).map((p: string, i: number) => (
              <span key={i} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-600 border border-red-200">
                {typeof p === 'string' ? (p.length > 40 ? p.slice(0, 37) + '...' : p) : safeStr(p)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Clay Enrichment Data ── */}
      {loadingClay ? (
        <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <div>
            <p className="text-sm font-semibold text-blue-700">Arricchimento dati in corso...</p>
            <p className="text-xs text-blue-500">Scraping sito web, social professionali, INIPEC, Registro Imprese e fonti business verificate</p>
          </div>
        </div>
      ) : clayData && !clayData.error ? (
        <div className="mb-6 space-y-4">
          {/* Sources bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Fonti:</span>
            {(clayData.enrichmentSources || []).map((s: string) => (
              <span key={s} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 uppercase">{formatVisibleSource(s)}</span>
            ))}
            <span className="text-[10px] text-slate-400 ml-auto">
              Qualità: <strong className={clayData.enrichmentQuality >= 60 ? 'text-emerald-600' : clayData.enrichmentQuality >= 30 ? 'text-amber-600' : 'text-slate-500'}>{clayData.enrichmentQuality}/100</strong>
              {clayData.pagesScraped > 0 && <> · {clayData.pagesScraped} pagine scrapate</>}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Card: Referente / Persona */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Referente</span>
              </div>
              {(() => {
                const isCompanyName = (n: string) => /\b(?:s\.?r\.?l\.?s?\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|srl|srls|spa|sas|snc|ltd|llc|gmbh|inc|corp)\b/i.test(n)
                const rawTitolare = registry?.titolare || null
                // Try: 1) registry titolare, 2) Clay person, 3) first REAL person from peopleData (skip placeholders with confidenza<=10)
                const realPeople = (peopleData?.persone || []).filter((p: any) => p.confidenza > 10)
                const topPerson = realPeople.find((p: any) => /titolare|amministratore|socio unico|presidente|legale rappresentante/i.test(p.ruolo || ''))
                  || realPeople[0]
                const refName = (rawTitolare && !isCompanyName(rawTitolare)) ? rawTitolare
                  : (clayData?.personName && !isCompanyName(clayData.personName)) ? clayData.personName
                  : (topPerson?.nome && !isCompanyName(topPerson.nome)) ? topPerson.nome
                  : null
                const refRole = refName === rawTitolare ? 'Titolare / Legale Rappresentante'
                  : refName === clayData?.personName ? (clayData?.personRole || null)
                  : refName === topPerson?.nome ? (topPerson.ruolo || 'Dirigente')
                  : null
                const refPhoto = clayData?.personPhoto || null
                const refInitial = refName ? refName[0]?.toUpperCase() : '?'
                if (!refName) return <p className="text-sm text-slate-400">Nessun referente trovato</p>
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      {refPhoto ? (
                        <img src={refPhoto} alt="" className="w-12 h-12 rounded-full object-cover border border-slate-200" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-blue-600 font-bold text-base">
                          {refInitial}
                        </div>
                      )}
                      <div>
                        <p className="text-base font-bold text-slate-900">{refName}</p>
                        {refRole && <p className="text-sm text-slate-500">{refRole}</p>}
                      </div>
                    </div>
                    {registry?.titolare_eta && (
                      <span className="inline-block text-sm font-semibold px-2.5 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">
                        {safeStr(registry.titolare_eta)} anni{registry.titolare_sesso === 'F' ? ' · Donna' : registry.titolare_sesso === 'M' ? ' · Uomo' : ''}
                      </span>
                    )}
                    {registry?.codice_fiscale_titolare && (
                      <div className="text-xs font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                        C.F. {safeStr(registry.codice_fiscale_titolare)}
                        {registry.titolare_data_nascita && (
                          <span className="ml-1.5 font-sans">· nato/a {registry.titolare_data_nascita}</span>
                        )}
                      </div>
                    )}
                    {clayData.personSeniority && (
                      <span className="inline-block text-xs font-medium px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                        Seniority: {clayData.personSeniority}
                      </span>
                    )}
                    {clayData.employmentType && (
                      <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ml-1 ${
                        clayData.employmentType === 'Imprenditore' ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : clayData.employmentType.includes('P.IVA') ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-slate-50 text-slate-600 border border-slate-200'
                      }`}>
                        {clayData.employmentType}
                      </span>
                    )}
                    {!clayData.personName && registry?.titolare_fonte === 'privacy_policy_sito' && (
                      <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                        Fonte: Privacy Policy
                      </span>
                    )}
                    {clayData.linkedinPerson && (
                      <a href={clayData.linkedinPerson} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-sky-600 hover:text-sky-800 font-medium">
                        <Linkedin className="w-4 h-4" /> Profilo LinkedIn
                      </a>
                    )}
                  </div>
                )
              })()}

              {/* Team members */}
              {clayData.teamMembers?.length > 1 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Team ({clayData.teamMembers.length})</p>
                  <div className="space-y-1.5">
                    {clayData.teamMembers.slice(0, 5).map((m: any, i: number) => (
                      <div key={i} className="text-xs">
                        <span className="font-medium text-slate-800">{m.name}</span>
                        {m.role && <span className="text-slate-400"> · {m.role}</span>}
                      </div>
                    ))}
                    {clayData.teamMembers.length > 5 && (
                      <p className="text-[10px] text-slate-400">+{clayData.teamMembers.length - 5} altri</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Card: Tutti i Contatti */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Phone className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tutti i Contatti</span>
              </div>
              <div className="space-y-2">
                {/* Best email */}
                {clayData.bestEmail && (
                  <a href={`mailto:${clayData.bestEmail}`} className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Mail className="w-3.5 h-3.5" />
                    <span className="truncate">{clayData.bestEmail}</span>
                    {clayData.allEmails?.find((e: any) => e.email === clayData.bestEmail && e.verified) && (
                      <span className="text-[8px] bg-green-100 text-green-700 px-1 rounded font-bold">✓</span>
                    )}
                  </a>
                )}
                {/* PEC */}
                {clayData.pecEmail && clayData.pecEmail !== clayData.bestEmail && (
                  <a href={`mailto:${clayData.pecEmail}`} className="flex items-center gap-2 text-xs text-purple-600 hover:text-purple-800">
                    <Mail className="w-3.5 h-3.5" />
                    <span className="truncate">{clayData.pecEmail}</span>
                    <span className="text-[8px] bg-purple-100 text-purple-700 px-1 rounded font-bold">PEC</span>
                  </a>
                )}
                {/* All other emails */}
                {clayData.allEmails?.filter((e: any) => e.email !== clayData.bestEmail && e.email !== clayData.pecEmail).slice(0, 3).map((e: any, i: number) => (
                  <a key={i} href={`mailto:${e.email}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-800">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{e.email}</span>
                    <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded">{e.type}</span>
                  </a>
                ))}
                {/* Divider */}
                {(clayData.allEmails?.length > 0 && clayData.allPhones?.length > 0) && <div className="border-t border-slate-100 my-1" />}
                {/* Phones — only REAL validated numbers */}
                {(() => {
                  const isRealItPhone = (n: string) => {
                    const d = n.replace(/\D/g, '')
                    const local = d.startsWith('39') && d.length > 10 ? d.slice(2) : d
                    if (local.length < 9 || local.length > 11) return false
                    if (/^(\d)\1{5,}$/.test(local)) return false
                    // Block P.IVA: 11 digits not starting with 0 or 3 are P.IVA, not phones
                    if (local.length === 11 && !/^[03]/.test(local)) return false
                    // Block P.IVA patterns: 11 digits starting with 0 but with unusual structure
                    // Real Italian landlines: 0xx-xxxxxxx (area code 2-4 digits + number)
                    // P.IVA starting with 0: often 0xxxxxxxxxx with no valid area code pattern
                    if (local.length === 11 && /^0\d{10}$/.test(local)) {
                      // Check if it looks like a real phone: area codes are 02,06,010-099,0xx
                      // Real phones starting with 0 and 11 digits would have +39 prefix making 13 total
                      // Standalone 11-digit numbers starting with 0 are almost always P.IVA
                      return false
                    }
                    if (/^3[0-9]\d{8}$/.test(local)) return true
                    if (/^0[1-9]\d{6,9}$/.test(local)) return true
                    return false
                  }
                  const phones: { number: string; source: string; type: string; isMobile: boolean }[] = []
                  const seen = new Set<string>()
                  const addPhone = (num: string, src: string, type: string) => {
                    if (!num || !isRealItPhone(num)) return
                    const key = num.replace(/\D/g, '').slice(-9)
                    if (seen.has(key)) return
                    seen.add(key)
                    const d = num.replace(/\D/g, '')
                    const local = d.startsWith('39') && d.length > 10 ? d.slice(2) : d
                    phones.push({ number: num, source: src, type, isMobile: /^3[0-9]/.test(local) })
                  }
                  // Lead original phone
                  const origPhone = telefono || ''
                  origPhone.split(/[\/,;]+/).forEach((p: string) => {
                    const c = p.trim()
                    if (c) addPhone(c, 'Maps', c.replace(/\D/g, '').startsWith('3') ? 'mobile' : 'fisso')
                  })
                  // Mobile phone from enrichment
                  if (clayData.mobilePhone) addPhone(clayData.mobilePhone, 'enrichment', 'mobile')
                  // All enrichment phones
                  for (const p of (clayData.allPhones || [])) addPhone(p.number, p.source || 'enrichment', p.type || 'unknown')
                  if (phones.length === 0) return null
                  return phones.slice(0, 4).map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <a href={`tel:${p.number}`} className={`flex items-center gap-2 text-xs ${p.isMobile ? 'text-emerald-600 hover:text-emerald-800 font-medium' : 'text-slate-600'}`}>
                        <Phone className={`w-3.5 h-3.5 ${p.isMobile ? '' : 'text-slate-400'}`} />
                        {p.number}
                      </a>
                      <span className={`text-[8px] px-1 rounded font-bold ${p.isMobile ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{p.isMobile ? 'mobile' : 'fisso'}</span>
                      {p.source && <span className="text-[7px] text-slate-400">{p.source.replace('website:','sito')}</span>}
                      {p.isMobile && (
                        <a href={`https://wa.me/39${p.number.replace(/\D/g, '').replace(/^39/, '')}`} target="_blank" rel="noreferrer" className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold no-underline hover:bg-green-200">WA</a>
                      )}
                    </div>
                  ))
                })()}
                {/* Social links */}
                <div className="border-t border-slate-100 my-1" />
                <div className="flex flex-wrap gap-2">
                  {clayData.linkedinCompany && (
                    <a href={clayData.linkedinCompany} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg no-underline hover:bg-sky-100">
                      <Linkedin className="w-3 h-3" /> LinkedIn
                    </a>
                  )}
                  {clayData.facebook && (
                    <a href={clayData.facebook} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg no-underline hover:bg-blue-100">
                      <Facebook className="w-3 h-3" /> Facebook
                    </a>
                  )}
                  {clayData.instagram && (
                    <a href={clayData.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-pink-600 bg-pink-50 border border-pink-200 px-2 py-1 rounded-lg no-underline hover:bg-pink-100">
                      <Instagram className="w-3 h-3" /> {clayData.instagramHandle || 'Instagram'}
                    </a>
                  )}
                  {clayData.tiktok && (
                    <a href={clayData.tiktok} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg no-underline hover:bg-slate-100">
                      <Video className="w-3 h-3" /> TikTok
                    </a>
                  )}
                  {clayData.youtube && (
                    <a href={clayData.youtube} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg no-underline hover:bg-red-100">
                      <Video className="w-3 h-3" /> YouTube
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Intelligence & Segnali rimossa — spostata in Profilo Aziendale */}
          </div>
        </div>
      ) : null}

      {/* ── Persone Chiave + Polizze Personali ── */}
      {loadingPeople ? (
        <div className="mb-6 flex items-center gap-3 p-4 bg-violet-50 border border-violet-200 rounded-2xl">
          <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
          <div>
            <p className="text-sm font-semibold text-violet-700">Ricerca persone chiave...</p>
            <p className="text-xs text-violet-500">Scraping registro imprese, OpenCorporates, Google, sito web, news...</p>
          </div>
        </div>
      ) : peopleData?.persone?.length > 0 ? (
        <div className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center">
                <Users className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Persone Chiave — Intelligence Assicurativa</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                  {peopleData.fonti?.join(' · ')} — {peopleData.totale_trovate > 0 ? `${peopleData.totale_trovate} persone identificate` : 'Profili obbligatori per forma giuridica'}
                </p>
              </div>
            </div>
          </div>

          {/* Team recommendations */}
          {peopleData.raccomandazioni_team?.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-violet-100/50 border border-violet-200">
              <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-1.5">Raccomandazioni per il team</p>
              {peopleData.raccomandazioni_team.map((r: string, i: number) => (
                <p key={i} className="text-[11px] text-violet-800 flex items-start gap-1.5">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                  {r}
                </p>
              ))}
            </div>
          )}

          {/* Person cards */}
          <div className="space-y-3">
            {peopleData.persone.map((p: any, i: number) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {p.foto_url ? (
                      <img src={p.foto_url} alt={p.nome} className="w-10 h-10 rounded-full object-cover border-2 border-violet-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black ${
                        p.ruolo_normalizzato === 'titolare' ? 'bg-gradient-to-br from-amber-200 to-orange-200 text-orange-800' :
                        p.ruolo_normalizzato === 'amministratore' ? 'bg-gradient-to-br from-blue-200 to-indigo-200 text-indigo-800' :
                        p.ruolo_normalizzato === 'professionista' ? 'bg-gradient-to-br from-emerald-200 to-green-200 text-green-800' :
                        p.ruolo_normalizzato === 'socio' ? 'bg-gradient-to-br from-purple-200 to-violet-200 text-violet-800' :
                        p.ruolo_normalizzato === 'dirigente' ? 'bg-gradient-to-br from-cyan-200 to-blue-200 text-blue-800' :
                        'bg-gradient-to-br from-slate-200 to-gray-200 text-slate-700'
                      }`}>
                        {(p.confidenza <= 10 ? p.ruolo : p.nome)?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        {p.confidenza <= 10 ? p.ruolo : p.nome}
                        {p.eta && (
                          <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            {p.eta} anni{p.sesso === 'F' ? ' · Donna' : p.sesso === 'M' ? ' · Uomo' : ''}
                          </span>
                        )}
                        {p.confidenza > 0 && (
                          <span className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            p.confidenza >= 70 ? 'bg-emerald-100 text-emerald-700' :
                            p.confidenza >= 40 ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>{p.confidenza}%</span>
                        )}
                      </p>
                      {p.confidenza <= 10 && (
                        <p className="text-[10px] text-amber-600 italic">Nome reale non identificato — ruolo obbligatorio per questa forma giuridica</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-500">{p.ruolo}</span>
                        {p.fonti_multiple?.length > 1 ? (
                          <span className="text-[9px] text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded font-medium">
                            {p.fonti_multiple.length} fonti: {p.fonti_multiple.join(', ')}
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{p.fonte}</span>
                        )}
                        {p.codice_fiscale && (
                          <span className="text-[9px] font-mono text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                            C.F. {p.codice_fiscale}
                          </span>
                        )}
                        {p.data_nascita && !p.codice_fiscale && (
                          <span className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                            nato/a {p.data_nascita}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.note && (
                      <span className={`text-[9px] font-bold px-2 py-1 rounded-lg ${
                        p.ruolo_normalizzato === 'titolare' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                        p.ruolo_normalizzato === 'professionista' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                        'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>{p.note}</span>
                    )}
                  </div>
                </div>

                {/* Contact info row */}
                {(() => {
                  // Filter P.IVA from person phone field
                  const pTel = (() => {
                    if (!p.telefono) return null
                    const d = p.telefono.replace(/\D/g, '')
                    const local = d.startsWith('39') && d.length > 10 ? d.slice(2) : d
                    if (local.length === 11) return null // 11-digit = P.IVA
                    if (local.length < 6 || local.length > 13) return null
                    return p.telefono
                  })()
                  return null // just compute pTel
                })() || null}
                {(p.email || (() => { const d = (p.telefono||'').replace(/\D/g,''); const l = d.startsWith('39')&&d.length>10?d.slice(2):d; return l.length>=6&&l.length<=10?p.telefono:null })() || p.linkedin) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {p.email && (
                      <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2 py-1 rounded-lg transition-colors">
                        <Mail className="w-3 h-3" /> {p.email}
                      </a>
                    )}
                    {(() => {
                      if (!p.telefono) return null
                      const d = p.telefono.replace(/\D/g, '')
                      const local = d.startsWith('39') && d.length > 10 ? d.slice(2) : d
                      if (local.length === 11) return null
                      if (local.length < 6 || local.length > 10) return null
                      return (
                        <a href={`tel:${p.telefono}`} className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 px-2 py-1 rounded-lg transition-colors">
                          <Phone className="w-3 h-3" /> {p.telefono}
                        </a>
                      )
                    })()}
                    {p.linkedin && (
                      <a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-medium text-[#0077B5] bg-sky-50 hover:bg-sky-100 border border-sky-100 px-2 py-1 rounded-lg transition-colors">
                        <Linkedin className="w-3 h-3" /> LinkedIn
                      </a>
                    )}
                  </div>
                )}

                {p.polizze_personali?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Polizze personali</p>
                    <div className="space-y-1">
                      {p.polizze_personali.map((pol: any, j: number) => (
                        <div key={j} className="flex items-start gap-2">
                          <span className={`mt-0.5 shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded ${
                            pol.priorita === 'obbligatoria' ? 'bg-red-100 text-red-700' :
                            pol.priorita === 'critica' ? 'bg-orange-100 text-orange-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>{pol.priorita === 'obbligatoria' ? 'OBBL.' : pol.priorita === 'critica' ? 'CRIT.' : 'RACC.'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-slate-700">{pol.polizza}</p>
                            <p className="text-[10px] text-slate-500">{pol.motivo}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {p.rischi_personali?.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-[9px] font-bold text-red-400 uppercase tracking-wider mb-1">Rischi personali</p>
                    <div className="flex flex-wrap gap-1">
                      {p.rischi_personali.map((r: string, j: number) => (
                        <span key={j} className="text-[9px] font-medium px-2 py-0.5 rounded-lg bg-red-50 border border-red-100 text-red-600">{r}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Disclaimer accuratezza */}
          <div className="mt-4 p-3 rounded-xl bg-amber-50/60 border border-amber-200/50">
            <p className="text-[9px] text-amber-700 leading-relaxed">
              <span className="font-bold">&#9888; Nota:</span> I dati provengono da fonti pubbliche (Registro Imprese, CompanyReports, OpenCorporates, privacy policy, Google News). Le polizze personali sono <span className="font-bold">raccomandazioni basate sul ruolo e sulla forma giuridica</span>, non preventivi reali. Verificare sempre i dati prima di contattare il lead.
            </p>
          </div>
        </div>
      ) : null}

      {/* ── PROFILO AZIENDALE (in primo piano) ── */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 style={{
              fontSize: 15, fontWeight: 700, color: '#0F172A',
              fontFamily: 'Syne, sans-serif', margin: 0,
            }}>
              Profilo Aziendale
            </h2>
            <p style={{
              fontSize: 12, color: '#94A3B8',
              fontFamily: 'DM Sans, sans-serif', margin: 0,
            }}>
              Dati camerali, finanziari e intelligence assicurativa
            </p>
          </div>
        </div>

        {loadingRegistry ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-slate-700">Caricamento profilo aziendale...</p>
              <p className="text-xs text-slate-400">Scraping fonti pubbliche, VIES, CompanyReports, Tavily</p>
            </div>
          </div>
        ) : registry?.found === false ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
            <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">Azienda non trovata</p>
          </div>
        ) : registry ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            {registry.fonte === 'registro_imprese' ? (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs text-emerald-700 font-medium">Dati verificati dal Registro Imprese</span>
              </div>
            ) : registry.fonte === 'vies_verificato' ? (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs text-emerald-700 font-medium">P.IVA verificata tramite VIES</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {registry.ragione_sociale && (
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500">Ragione sociale</p>
                  <p className="text-sm font-bold text-slate-900">{safeStr(registry.ragione_sociale)}</p>
                </div>
              )}
              {registry.titolare && (
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500">
                    Titolare / Referente
                    {registry.titolare_fonte === 'privacy_policy_sito' ? (
                      <span className="ml-1.5 text-blue-600 font-semibold">✓ Privacy Policy</span>
                    ) : registry.titolare_fonte === 'tavily' ? (
                      <span className="ml-1.5 text-cyan-600 font-semibold">✓ Tavily</span>
                    ) : null}
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {safeStr(registry.titolare)}
                    {registry.titolare_eta ? (
                      <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {safeStr(registry.titolare_eta)} anni{registry.titolare_sesso === 'F' ? ' · Donna' : registry.titolare_sesso === 'M' ? ' · Uomo' : ''}
                      </span>
                    ) : null}
                  </p>
                </div>
              )}
              {registry.partita_iva && (
                <div>
                  <p className="text-xs text-gray-500">
                    Partita IVA
                    {registry.piva_verificata ? <span className="ml-1.5 text-emerald-600 font-semibold">✓ Verificata</span> : null}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">IT {safeStr(registry.partita_iva)}</p>
                </div>
              )}
              {registry.forma_giuridica && (
                <div>
                  <p className="text-xs text-gray-500">Forma giuridica</p>
                  <p className="text-sm font-semibold text-slate-900">{safeStr(registry.forma_giuridica)}</p>
                </div>
              )}
              {registry.codice_ateco && (
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500">
                    Codice ATECO
                    {registry.ateco_stimato ? <span className="ml-1.5 text-amber-500 font-normal text-[10px]">(stimato)</span> : null}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {safeStr(registry.codice_ateco)}
                    {registry.descrizione_ateco ? <span className="text-xs text-gray-400 font-normal ml-1.5">— {safeStr(registry.descrizione_ateco)}</span> : null}
                  </p>
                </div>
              )}
              {registry.fatturato && (
                <div>
                  <p className="text-xs text-gray-500">
                    Fatturato
                    {registry.fatturato_fonte ? (
                      <span className={`ml-1.5 font-semibold ${registry.fatturato_fonte === 'registro_imprese' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        ✓ {registry.fatturato_fonte === 'companyreports.it' ? 'CompanyReports.it' : registry.fatturato_fonte === 'openapi.it' ? 'OpenAPI.it' : registry.fatturato_fonte === 'tavily' ? 'Tavily' : 'Registro Imprese'}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    € {safeStr(registry.fatturato)}
                    {registry.fatturato_anno ? <span className="text-xs text-gray-400 font-normal ml-1">({safeStr(registry.fatturato_anno)})</span> : null}
                  </p>
                </div>
              )}
              {registry.dipendenti && (
                <div>
                  <p className="text-xs text-gray-500">
                    Dipendenti
                    {registry.dipendenti_fonte ? (
                      <span className={`ml-1.5 font-semibold ${registry.dipendenti_fonte === 'registro_imprese' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        ✓ {registry.dipendenti_fonte === 'ufficio_camerale' ? 'Ufficio Camerale' : registry.dipendenti_fonte === 'companyreports.it' ? 'CompanyReports.it' : registry.dipendenti_fonte === 'openapi.it' ? 'OpenAPI.it' : registry.dipendenti_fonte === 'tavily' ? 'Tavily' : 'Registro Imprese'}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm font-bold text-slate-900">{safeStr(registry.dipendenti)}</p>
                </div>
              )}
              {registry.capitale_sociale && (
                <div>
                  <p className="text-xs text-gray-500">Capitale sociale</p>
                  <p className="text-sm font-semibold text-slate-900">{safeStr(registry.capitale_sociale)}</p>
                </div>
              )}
              {registry.costo_personale && (
                <div>
                  <p className="text-xs text-gray-500">Costo del personale</p>
                  <p className="text-sm font-semibold text-slate-900">€ {safeStr(registry.costo_personale)}</p>
                </div>
              )}
              {registry.utile_netto && (
                <div>
                  <p className="text-xs text-gray-500">Utile Netto</p>
                  <p className="text-sm font-semibold text-slate-900">€ {safeStr(registry.utile_netto)}</p>
                </div>
              )}
              {registry.classe_fatturato && (
                <div>
                  <p className="text-xs text-gray-500">Classe Fatturato</p>
                  <p className="text-sm font-semibold text-slate-900">{safeStr(registry.classe_fatturato)}</p>
                </div>
              )}
              {registry.data_costituzione && (
                <div>
                  <p className="text-xs text-gray-500">Data costituzione</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {safeStr(registry.data_costituzione)}
                    {(() => {
                      const y = parseInt(String(registry.data_costituzione).match(/\d{4}/)?.[0] || '0')
                      if (y > 1900 && y <= new Date().getFullYear()) {
                        const anni = new Date().getFullYear() - y
                        return (
                          <span className={`ml-2 text-xs font-bold px-2 py-0.5 rounded-full ${anni >= 20 ? 'bg-emerald-100 text-emerald-700' : anni >= 10 ? 'bg-blue-100 text-blue-700' : anni >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                            {anni} anni di attività
                          </span>
                        )
                      }
                      return null
                    })()}
                  </p>
                </div>
              )}
              {registry.sede_legale && (
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500">
                    Sede legale
                    {registry.sede_legale_verificata ? <span className="ml-1.5 text-emerald-600 font-semibold">✓ VIES</span> : null}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">{safeStr(registry.sede_legale)}</p>
                </div>
              )}
              {registry.pec && (
                <div>
                  <p className="text-xs text-gray-500">
                    PEC
                    {registry.pec_fonte ? (
                      <span className="ml-1.5 text-emerald-600 font-semibold">✓ {registry.pec_fonte === 'inipec' ? 'INIPEC' : registry.pec_fonte === 'openapi.it' ? 'OpenAPI.it' : 'Registro Imprese'}</span>
                    ) : null}
                  </p>
                  <p className="text-sm font-semibold text-blue-700">{safeStr(registry.pec)}</p>
                </div>
              )}
              {registry.codice_rea && (
                <div>
                  <p className="text-xs text-gray-500">Codice REA</p>
                  <p className="text-sm font-semibold text-slate-900">{safeStr(registry.codice_rea)}</p>
                </div>
              )}
              {registry.stato && (
                <div>
                  <p className="text-xs text-gray-500">Stato</p>
                  <p className="text-sm font-semibold text-slate-900">{safeStr(registry.stato)}</p>
                </div>
              )}
              {registry.persone?.length > 0 && (
                <div className="md:col-span-2">
                  <p className="text-xs text-gray-500 mb-1">Persone Chiave</p>
                  <div className="flex flex-wrap gap-2">
                    {registry.persone.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-violet-50 rounded-lg border border-violet-100">
                        <div>
                          <p className="text-xs font-bold text-slate-900">{safeStr(p.nome)}</p>
                          <p className="text-[10px] text-slate-500">{safeStr(p.ruolo)}{p.quota ? ` · ${safeStr(p.quota)}` : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {registry.partita_iva && !registry.fatturato && !registry.dipendenti && (
                <div className="md:col-span-2 mt-1 p-2.5 rounded-lg border border-amber-200 bg-amber-50">
                  <p className="text-[11px] text-amber-800 font-medium">
                    Fatturato e dipendenti non disponibili — probabilmente ditta individuale o micro impresa senza obbligo di deposito bilancio pubblico.
                  </p>
                </div>
              )}
            </div>

            {/* Profilo Titolare dettagliato */}
            {registry.titolare && (registry.bio_titolare || registry.linkedin_titolare || registry.esperienze_titolare || registry.formazione_titolare || registry.competenze_titolare || registry.seniority_titolare) && (
              <div className="mt-4 rounded-2xl border border-indigo-200 p-5 bg-white shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
                    {String(registry.titolare).split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{safeStr(registry.titolare)}</p>
                    <p className="text-[10px] text-slate-500">{safeStr(registry.ruolo_titolare) || 'Titolare / Amministratore'}{registry.seniority_titolare ? ` · ${safeStr(registry.seniority_titolare)}` : ''}</p>
                  </div>
                </div>
                {registry.bio_titolare && (
                  <p className="text-xs text-slate-600 mb-3 leading-relaxed">{safeStr(registry.bio_titolare)}</p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {registry.linkedin_titolare && (
                    <div className="bg-indigo-50 rounded-lg p-2.5">
                      <p className="text-[9px] font-bold text-indigo-400 uppercase">LinkedIn</p>
                      <a href={String(registry.linkedin_titolare)} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-700 hover:underline">Profilo LinkedIn</a>
                    </div>
                  )}
                  {registry.instagram_titolare && (
                    <div className="bg-indigo-50 rounded-lg p-2.5">
                      <p className="text-[9px] font-bold text-indigo-400 uppercase">Instagram</p>
                      <a href={String(registry.instagram_titolare)} target="_blank" rel="noreferrer" className="text-xs font-bold text-pink-600 hover:underline">Instagram</a>
                    </div>
                  )}
                  {registry.facebook_titolare && (
                    <div className="bg-indigo-50 rounded-lg p-2.5">
                      <p className="text-[9px] font-bold text-indigo-400 uppercase">Facebook</p>
                      <a href={String(registry.facebook_titolare)} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600 hover:underline">Facebook</a>
                    </div>
                  )}
                  {registry.seniority_titolare && (
                    <div className="bg-indigo-50 rounded-lg p-2.5">
                      <p className="text-[9px] font-bold text-indigo-400 uppercase">Seniority</p>
                      <p className="text-xs font-bold text-slate-800 capitalize">{safeStr(registry.seniority_titolare)}</p>
                    </div>
                  )}
                </div>
                {registry.formazione_titolare && (
                  <div className="mt-2 bg-indigo-50 rounded-lg p-2.5">
                    <p className="text-[9px] font-bold text-indigo-400 uppercase mb-0.5">Formazione</p>
                    <p className="text-xs text-slate-700">{safeStr(registry.formazione_titolare)}</p>
                  </div>
                )}
                {registry.esperienze_titolare && Array.isArray(registry.esperienze_titolare) && registry.esperienze_titolare.length > 0 && (
                  <div className="mt-2 bg-indigo-50 rounded-lg p-2.5">
                    <p className="text-[9px] font-bold text-indigo-400 uppercase mb-0.5">Esperienze Precedenti</p>
                    <div className="space-y-0.5">
                      {registry.esperienze_titolare.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-slate-700">{e.ruolo && e.ruolo !== e.azienda ? `${safeStr(e.ruolo)} @ ` : ''}{safeStr(e.azienda)}{e.periodo ? ` (${safeStr(e.periodo)})` : ''}</p>
                      ))}
                    </div>
                  </div>
                )}
                {registry.competenze_titolare && Array.isArray(registry.competenze_titolare) && registry.competenze_titolare.length > 0 && (
                  <div className="mt-2 bg-indigo-50 rounded-lg p-2.5">
                    <p className="text-[9px] font-bold text-indigo-400 uppercase mb-0.5">Competenze</p>
                    <div className="flex flex-wrap gap-1">
                      {registry.competenze_titolare.map((c: string, i: number) => (
                        <span key={i} className="text-[10px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded font-bold">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Intelligence Assicurativa */}
            {(registry.certificazioni?.length > 0 || registry.ha_flotta_veicoli || registry.ha_immobili_proprieta || registry.partecipa_appalti_pubblici || registry.rischi_specifici?.length > 0 || registry.note_broker) && (
              <div className="mt-4 p-4 rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50">
                <p className="text-xs font-bold text-cyan-800 uppercase mb-3">Intelligence Assicurativa</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {registry.certificazioni?.length > 0 && (
                    <div>
                      <p className="text-[10px] text-cyan-700 font-bold uppercase mb-1">Certificazioni</p>
                      <div className="flex flex-wrap gap-1">
                        {registry.certificazioni.map((c: string, i: number) => (
                          <span key={i} className="text-[10px] bg-cyan-200 text-cyan-900 px-2 py-0.5 rounded font-bold">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {registry.ha_flotta_veicoli && (
                    <div>
                      <p className="text-[10px] text-cyan-700 font-bold uppercase">Flotta Veicoli</p>
                      <p className="text-xs text-slate-800">{registry.numero_veicoli ? `${registry.numero_veicoli} veicoli` : 'Presente'}</p>
                    </div>
                  )}
                  {registry.ha_immobili_proprieta && (
                    <div>
                      <p className="text-[10px] text-cyan-700 font-bold uppercase">Immobili di Proprietà</p>
                      <p className="text-xs text-slate-800">{registry.immobili_descrizione || 'Rilevati'}</p>
                    </div>
                  )}
                  {registry.partecipa_appalti_pubblici && (
                    <div>
                      <p className="text-[10px] text-cyan-700 font-bold uppercase">Appalti Pubblici</p>
                      <p className="text-xs text-slate-800">{registry.appalti_info || 'Partecipa a bandi/appalti'}</p>
                    </div>
                  )}
                  {registry.rischi_specifici?.length > 0 && (
                    <div className="md:col-span-2">
                      <p className="text-[10px] text-red-700 font-bold uppercase mb-1">Rischi Specifici</p>
                      <div className="flex flex-wrap gap-1">
                        {registry.rischi_specifici.map((r: string, i: number) => (
                          <span key={i} className="text-[10px] bg-red-100 text-red-800 px-2 py-0.5 rounded font-bold">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {registry.note_broker && (
                    <div className="md:col-span-2 mt-1 p-2 bg-amber-50 rounded-lg border border-amber-200">
                      <p className="text-[10px] text-amber-700 font-bold uppercase mb-0.5">Note per il Broker</p>
                      <p className="text-[11px] text-slate-700">{registry.note_broker}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Analisi AI */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{
            fontSize: 15, fontWeight: 700, color: '#0F172A',
            fontFamily: 'Syne, sans-serif', margin: '0 0 4px',
          }}>
            Analisi Rischio & Patrimonio
          </h2>
          <p style={{
            fontSize: 13, color: '#94A3B8',
            fontFamily: 'DM Sans, sans-serif', margin: 0,
          }}>
            Rischi settoriali, dati camerali, fatturato, recensioni e insight per la polizza
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Recensioni */}
          <div style={{
            background: 'white', border: '1px solid #F1F5F9',
            borderRadius: 16, padding: '24px',
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#FFFBEB', border: '1px solid #FDE68A',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Star size={16} color="#D97706" />
              </div>
              <h3 style={{
                fontSize: 14, fontWeight: 700, color: '#0F172A',
                fontFamily: 'Syne, sans-serif', margin: 0,
              }}>
                Recensioni Google
              </h3>
            </div>
            {loadingReviews ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2].map(i => <div key={i} style={{ height: 14, background: '#F1F5F9', borderRadius: 6 }} />)}
              </div>
            ) : Array.isArray(reviews?.reviews) ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, color: '#0F172A', fontFamily: 'Syne, sans-serif' }}>
                    {reviews.rating ?? 0}
                  </span>
                  <span style={{ color: '#F59E0B', fontSize: 16 }}>★</span>
                  <span style={{ fontSize: 13, color: '#94A3B8', fontFamily: 'DM Sans, sans-serif' }}>
                    ({reviews.total ?? 0} recensioni)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(reviews.reviews || []).slice(0, 5).map((r: any, i: number) => (
                    <div key={i} style={{
                      padding: '10px 12px', background: '#F8FAFC',
                      borderRadius: 10, border: '1px solid #F1F5F9',
                    }}>
                      <div style={{ fontSize: 11, color: '#F59E0B', marginBottom: 4 }}>
                        {typeof r?.stars === 'number' ? `${'★'.repeat(r.stars)}` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: '#475569', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5 }}>
                        {r?.text || ''}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Segnali di rischio dalle recensioni */}
                {reviewRiskSignals && (
                  <div style={{ marginTop: 16, padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <AlertTriangle size={14} color="#DC2626" />
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'DM Sans, sans-serif' }}>
                        Segnali di rischio rilevati
                      </span>
                    </div>
                    {reviewRiskSignals.signals.map((s: any, i: number) => (
                      <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid #FEE2E2' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6,
                            background: s.severity === 'high' ? '#FEE2E2' : '#FEF3C7',
                            color: s.severity === 'high' ? '#991B1B' : '#92400E',
                            textTransform: 'uppercase',
                          }}>{s.severity === 'high' ? 'ALTO' : 'MEDIO'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', fontFamily: 'DM Sans, sans-serif' }}>{s.keyword}</span>
                        </div>
                        <p style={{ fontSize: 10, color: '#64748B', fontFamily: 'DM Sans, sans-serif', margin: '2px 0' }}>{s.description}</p>
                        <p style={{ fontSize: 10, color: '#059669', fontWeight: 600, fontFamily: 'DM Sans, sans-serif' }}>{s.insurance_relevance}</p>
                        {s.review_excerpt && (
                          <p style={{ fontSize: 9, color: '#94A3B8', fontStyle: 'italic', fontFamily: 'DM Sans, sans-serif', marginTop: 2 }}>"{s.review_excerpt}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: '#94A3B8', fontFamily: 'DM Sans, sans-serif' }}>
                Nessuna recensione disponibile
              </p>
            )}
          </div>

          {/* Social */}
          <div style={{
            background: 'white', border: '1px solid #F1F5F9',
            borderRadius: 16, padding: '24px',
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#EFF6FF', border: '1px solid #BFDBFE',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Smartphone size={16} color="#3B82F6" />
              </div>
              <h3 style={{
                fontSize: 14, fontWeight: 700, color: '#0F172A',
                fontFamily: 'Syne, sans-serif', margin: 0,
              }}>
                Presenza Social
              </h3>
            </div>
            {loadingSocial ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : social ? (
              <div className="space-y-4">
                {/* Instagram */}
                {social.instagram ? (
                  <div className="p-4 rounded-xl border border-pink-200 bg-gradient-to-br from-pink-50 to-purple-50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Instagram className="w-4 h-4 text-pink-500" />
                        <span className="text-sm font-bold text-slate-800">Instagram</span>
                        {social.instagram.is_verified && <span className="text-blue-500 text-xs">✓</span>}
                        {social.instagram.is_business && <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">Business</span>}
                      </div>
                      <a href={social.instagram.url} target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:text-pink-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {social.instagram.full_name && <p className="text-xs text-slate-600 mb-2">@{social.instagram.username} · {social.instagram.full_name}</p>}
                    {social.instagram.error ? (
                      <p className="text-xs text-amber-600">Profilo trovato ma dati limitati (profilo privato o restrizioni)</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          {social.instagram.followers_display && (
                            <div className="text-center p-2 bg-white/70 rounded-lg">
                              <p className="text-base font-bold text-slate-900">{social.instagram.followers_display}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Follower</p>
                            </div>
                          )}
                          {social.instagram.following_display && (
                            <div className="text-center p-2 bg-white/70 rounded-lg">
                              <p className="text-base font-bold text-slate-900">{social.instagram.following_display}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Seguiti</p>
                            </div>
                          )}
                          {social.instagram.posts_display && (
                            <div className="text-center p-2 bg-white/70 rounded-lg">
                              <p className="text-base font-bold text-slate-900">{social.instagram.posts_display}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Post</p>
                            </div>
                          )}
                        </div>
                        {(social.instagram.engagement_display || social.instagram.avg_likes_display || social.instagram.last_post_date) && (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {social.instagram.engagement_display && (
                              <div className="text-center p-2 bg-white/70 rounded-lg">
                                <p className="text-base font-bold text-emerald-600">{social.instagram.engagement_display}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Engagement</p>
                              </div>
                            )}
                            {social.instagram.avg_likes_display && (
                              <div className="text-center p-2 bg-white/70 rounded-lg">
                                <p className="text-base font-bold text-slate-900">{social.instagram.avg_likes_display}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Like/post</p>
                              </div>
                            )}
                            {social.instagram.avg_comments_display && (
                              <div className="text-center p-2 bg-white/70 rounded-lg">
                                <p className="text-base font-bold text-slate-900">{social.instagram.avg_comments_display}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Commenti/post</p>
                              </div>
                            )}
                          </div>
                        )}
                        {(social.instagram.last_post_date || social.instagram.posting_frequency) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {social.instagram.last_post_date && (
                              <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${
                                (social.instagram.last_post_days_ago ?? 999) <= 7 ? 'bg-emerald-100 text-emerald-700' :
                                (social.instagram.last_post_days_ago ?? 999) <= 30 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                Ultimo post: {social.instagram.last_post_date}
                                {social.instagram.last_post_days_ago !== undefined && ` (${social.instagram.last_post_days_ago}g fa)`}
                              </span>
                            )}
                            {social.instagram.posting_frequency && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                                Frequenza: {social.instagram.posting_frequency}
                              </span>
                            )}
                            {social.instagram.category && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-purple-100 text-purple-700 font-medium">
                                {social.instagram.category}
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Instagram className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-500">Instagram</span>
                    </div>
                    <span className="text-xs bg-slate-200 text-slate-500 px-2.5 py-1 rounded-full">Non trovato</span>
                  </div>
                )}

                {/* TikTok */}
                {social.tiktok ? (
                  <div className="p-4 rounded-xl border border-slate-300 bg-gradient-to-br from-slate-50 to-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4 text-slate-800" />
                        <span className="text-sm font-bold text-slate-800">TikTok</span>
                      </div>
                      <a href={social.tiktok.url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {social.tiktok.nickname && <p className="text-xs text-slate-600 mb-2">@{social.tiktok.username} · {social.tiktok.nickname}</p>}
                    {social.tiktok.error ? (
                      <p className="text-xs text-amber-600">Profilo trovato ma dati limitati</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {social.tiktok.followers_display && (
                          <div className="text-center p-2 bg-white/70 rounded-lg">
                            <p className="text-base font-bold text-slate-900">{social.tiktok.followers_display}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Follower</p>
                          </div>
                        )}
                        {social.tiktok.likes_display && (
                          <div className="text-center p-2 bg-white/70 rounded-lg">
                            <p className="text-base font-bold text-slate-900">{social.tiktok.likes_display}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Like</p>
                          </div>
                        )}
                        {social.tiktok.video_count_display && (
                          <div className="text-center p-2 bg-white/70 rounded-lg">
                            <p className="text-base font-bold text-slate-900">{social.tiktok.video_count_display}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Video</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-500">TikTok</span>
                    </div>
                    <span className="text-xs bg-slate-200 text-slate-500 px-2.5 py-1 rounded-full">Non trovato</span>
                  </div>
                )}

                {/* Punteggio Digitale nascosto — non rilevante per assicurazioni */}

                {/* LinkedIn */}
                {social.linkedin && !social.linkedin.error ? (
                  <div className="p-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-sky-50 to-blue-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Linkedin className="w-4 h-4 text-sky-600" />
                        <span className="text-sm font-bold text-slate-800">LinkedIn</span>
                      </div>
                      <a href={social.linkedin.url} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {social.linkedin.company_name && <p className="text-xs text-slate-600 mb-2">{social.linkedin.company_name}</p>}
                    <div className="flex flex-wrap gap-2">
                      {social.linkedin.followers_display && (
                        <span className="text-[11px] px-2 py-1 rounded-full bg-white/70 text-slate-700 font-medium border border-sky-100">
                          {social.linkedin.followers_display} follower
                        </span>
                      )}
                      {social.linkedin.industry && (
                        <span className="text-[11px] px-2 py-1 rounded-full bg-sky-100 text-sky-700 font-medium">
                          {social.linkedin.industry}
                        </span>
                      )}
                    </div>
                    {social.linkedin.description && <p className="text-[11px] text-slate-500 mt-2 line-clamp-2">{social.linkedin.description}</p>}
                  </div>
                ) : social.social_links?.linkedin ? (
                  <a href={social.social_links.linkedin} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-sky-700 text-xs font-medium hover:bg-sky-100 transition-colors w-fit">
                    <Linkedin className="w-3 h-3" /> LinkedIn
                  </a>
                ) : null}

                {/* Facebook */}
                {social.facebook && !social.facebook.error ? (
                  <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Facebook className="w-4 h-4 text-blue-600" />
                      <div>
                        <span className="text-sm font-bold text-slate-800">{social.facebook.page_name || 'Facebook'}</span>
                        {social.facebook.likes_display && (
                          <span className="ml-2 text-[11px] text-blue-600 font-medium">{social.facebook.likes_display} like</span>
                        )}
                      </div>
                    </div>
                    <a href={social.facebook.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ) : social.social_links?.facebook ? (
                  <a href={social.social_links.facebook} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors w-fit">
                    <Facebook className="w-3 h-3" /> Facebook
                  </a>
                ) : null}

                {/* YouTube */}
                {social.social_links?.youtube && (
                  <a href={social.social_links.youtube} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100 transition-all w-fit">
                    <Video className="w-3 h-3" /> YouTube
                  </a>
                )}

                {/* Qualità Sito Web nascosta — non rilevante per assicurazioni */}

                {/* Domain Age */}
                {social.domain_info && social.domain_info.first_seen && (
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium border border-indigo-200">
                      Online dal {social.domain_info.first_seen}
                      {social.domain_info.domain_age_years && ` (${social.domain_info.domain_age_years} anni)`}
                    </span>
                    {social.domain_info.snapshots && (
                      <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                        {social.domain_info.snapshots} snapshot Wayback
                      </span>
                    )}
                  </div>
                )}

                {/* Pixel & Tecnologie nascoste — non rilevante per assicurazioni */}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati social non disponibili</p>
            )}
          </div>

          {/* Attività Pubblicitaria nascosta — non rilevante per assicurazioni */}

          <div className="bg-white rounded-2xl border 
            border-slate-200 p-6 shadow-sm 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-xl 
                bg-red-50 border border-red-200 
                flex items-center justify-center">
                <Target className="w-4 h-4 text-red-500" />
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Competitor Locali
              </h3>
            </div>
            {loadingCompetitors ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : Array.isArray(competitors?.competitors) && competitors.competitors.length > 0 ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  {(competitors.competitors || []).slice(0, 8).map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <span className="text-sm font-medium text-slate-900">{c?.name || '—'}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-yellow-600">★ {typeof c?.rating === 'number' ? c.rating : '—'}</span>
                        <span className="text-xs text-gray-600">({typeof c?.reviews_count === 'number' ? c.reviews_count : 0})</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-[10px] text-blue-700 font-medium">💡 Consiglio: se i competitor sono più strutturati (&gt;50 recensioni), è probabile che abbiano già un broker. Usa questo come leva: offri un check-up coperture gratuito per differenziarti.</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati competitor non disponibili</p>
            )}
          </div>

        </div>
      </div>

      {/* ── Rischio Territoriale (dati Protezione Civile) ── */}
      {registry?.rischio_territoriale && (
        <div className="mb-6 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Rischio Territoriale</h3>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{registry.rischio_territoriale.fonte}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Zona sismica */}
            <div className={`p-4 rounded-xl border-2 ${
              registry.rischio_territoriale.zona_sismica === 1 ? 'border-red-300 bg-red-50' :
              registry.rischio_territoriale.zona_sismica === 2 ? 'border-orange-300 bg-orange-50' :
              registry.rischio_territoriale.zona_sismica === 3 ? 'border-amber-200 bg-amber-50' :
              'border-green-200 bg-green-50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-600 uppercase">Zona Sismica</span>
                <span className={`text-2xl font-black ${
                  registry.rischio_territoriale.zona_sismica === 1 ? 'text-red-600' :
                  registry.rischio_territoriale.zona_sismica === 2 ? 'text-orange-600' :
                  registry.rischio_territoriale.zona_sismica === 3 ? 'text-amber-600' :
                  'text-green-600'
                }`}>{registry.rischio_territoriale.zona_sismica}</span>
              </div>
              <p className="text-xs font-semibold text-slate-700">{registry.rischio_territoriale.zona_sismica_label}</p>
            </div>

            {/* Rischio idrogeologico */}
            <div className={`p-4 rounded-xl border-2 ${
              registry.rischio_territoriale.rischio_idrogeologico === 'alto' ? 'border-blue-300 bg-blue-50' :
              registry.rischio_territoriale.rischio_idrogeologico === 'medio' ? 'border-sky-200 bg-sky-50' :
              'border-slate-200 bg-slate-50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-600 uppercase">Rischio Idrogeologico</span>
                <span className={`text-sm font-black uppercase ${
                  registry.rischio_territoriale.rischio_idrogeologico === 'alto' ? 'text-blue-600' :
                  registry.rischio_territoriale.rischio_idrogeologico === 'medio' ? 'text-sky-600' :
                  'text-slate-500'
                }`}>{registry.rischio_territoriale.rischio_idrogeologico}</span>
              </div>
              {registry.rischio_territoriale.dettaglio_idrogeologico && (
                <p className="text-xs text-slate-600">{registry.rischio_territoriale.dettaglio_idrogeologico}</p>
              )}
            </div>
          </div>

          {/* Polizze consigliate dal rischio territoriale */}
          {registry.rischio_territoriale.polizze_consigliate?.length > 0 && (
            <div className="mt-4 pt-3 border-t border-orange-200">
              <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-2">Polizze consigliate per il territorio</p>
              <div className="flex flex-wrap gap-1.5">
                {registry.rischio_territoriale.polizze_consigliate.map((p: string, i: number) => (
                  <span key={i} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white border border-orange-200 text-orange-800">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* Data accuracy footer */}
          <div className="mt-4 pt-3 border-t border-orange-200/50">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                ✓ DATI UFFICIALI
              </span>
              <span className="text-[9px] text-orange-500">
                Zona sismica: OPCM 3274/2003 + delibere regionali — Rischio idrogeologico: ISPRA + PAI regionali
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Obblighi Assicurativi ATECO (normativa INAIL/IVASS) ── */}
      {registry?.obblighi_assicurativi && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center">
              <Scale className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Obblighi Assicurativi — {registry.obblighi_assicurativi.settore}</h3>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{registry.obblighi_assicurativi.fonte}</p>
            </div>
          </div>

          {/* INAIL risk class */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-bold text-slate-600">Classe INAIL:</span>
            <span className={`text-xs font-black px-2.5 py-1 rounded-full uppercase ${
              registry.obblighi_assicurativi.classe_inail === 'molto_alto' ? 'bg-red-100 text-red-700 border border-red-200' :
              registry.obblighi_assicurativi.classe_inail === 'alto' ? 'bg-orange-100 text-orange-700 border border-orange-200' :
              registry.obblighi_assicurativi.classe_inail === 'medio' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
              'bg-green-100 text-green-700 border border-green-200'
            }`}>{registry.obblighi_assicurativi.classe_inail.replace('_', ' ')}</span>
            <span className="text-xs text-slate-500">Tasso indicativo: {registry.obblighi_assicurativi.tasso_inail_indicativo}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Polizze OBBLIGATORIE */}
            <div className="p-4 rounded-xl border-2 border-red-200 bg-red-50">
              <p className="text-[10px] font-black text-red-700 uppercase tracking-wider mb-2">Polizze Obbligatorie per Legge</p>
              <ul className="space-y-1.5">
                {registry.obblighi_assicurativi.polizze_obbligatorie.map((p: string, i: number) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-red-200 flex items-center justify-center text-red-700 text-[9px] font-black shrink-0">!</span>
                    <span className="text-xs text-slate-700">{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Polizze RACCOMANDATE */}
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50">
              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-2">Polizze Raccomandate</p>
              <ul className="space-y-1.5">
                {registry.obblighi_assicurativi.polizze_raccomandate.map((p: string, i: number) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-200 flex items-center justify-center text-emerald-700 text-[9px] font-black shrink-0">+</span>
                    <span className="text-xs text-slate-700">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Rischi principali */}
          <div className="mt-4 pt-3 border-t border-emerald-200">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Rischi principali del settore</p>
            <div className="flex flex-wrap gap-1.5">
              {registry.obblighi_assicurativi.rischi_principali.map((r: string, i: number) => (
                <span key={i} className="text-[10px] font-medium px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600">{r}</span>
              ))}
            </div>
          </div>

          {/* Normativa */}
          <div className="mt-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Riferimenti normativi</p>
            <div className="space-y-0.5">
              {registry.obblighi_assicurativi.normativa.map((n: string, i: number) => (
                <p key={i} className="text-[10px] text-slate-400">{n}</p>
              ))}
            </div>
          </div>

          {/* Data accuracy footer */}
          <div className="mt-4 pt-3 border-t border-emerald-200/50">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                ✓ NORMATIVA REALE
              </span>
              <span className="text-[9px] text-emerald-500">
                Obblighi basati su codice ATECO e normativa INAIL/IVASS vigente — {registry.obblighi_assicurativi.fonte}
              </span>
              {registry.ateco_stimato && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 border border-amber-200">
                  ATECO STIMATO
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {registry?.bisogni_assicurativi_verificati && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-sky-100 border border-sky-200 flex items-center justify-center">
                <Target className="w-4 h-4 text-sky-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Bisogni Assicurativi Verificati</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">solo fatti verificati + derivazioni commerciali</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Priorità commerciale</p>
              <div className={`mt-1 inline-flex items-center gap-2 rounded-xl px-3 py-2 border ${
                registry.bisogni_assicurativi_verificati.priorita_commerciale.level === 'altissima' ? 'bg-red-100 border-red-200 text-red-700' :
                registry.bisogni_assicurativi_verificati.priorita_commerciale.level === 'alta' ? 'bg-orange-100 border-orange-200 text-orange-700' :
                registry.bisogni_assicurativi_verificati.priorita_commerciale.level === 'media' ? 'bg-amber-100 border-amber-200 text-amber-700' :
                'bg-slate-100 border-slate-200 text-slate-600'
              }`}>
                <span className="text-sm font-black uppercase">{registry.bisogni_assicurativi_verificati.priorita_commerciale.level}</span>
                <span className="text-lg font-black">{registry.bisogni_assicurativi_verificati.priorita_commerciale.score}</span>
              </div>
            </div>
          </div>

          {registry.bisogni_assicurativi_verificati.playbook_commerciale && (
            <div className="mb-4 p-4 rounded-2xl border border-indigo-200 bg-white/90 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-indigo-600" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">Playbook Commerciale Immediato</h4>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">cosa vendere, a chi, e con che apertura</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50">
                  <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wider mb-1">Prodotto #1</p>
                  <p className="text-sm font-bold text-slate-900">{registry.bisogni_assicurativi_verificati.playbook_commerciale.prodotto_principale || 'Da definire'}</p>
                </div>
                <div className="p-3 rounded-xl border border-sky-100 bg-sky-50">
                  <p className="text-[10px] font-black text-sky-700 uppercase tracking-wider mb-1">Cross-sell</p>
                  <p className="text-sm font-bold text-slate-900">{registry.bisogni_assicurativi_verificati.playbook_commerciale.cross_sell || 'Nessun cross-sell prioritario'}</p>
                </div>
                <div className="p-3 rounded-xl border border-emerald-100 bg-emerald-50">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1">Decision maker</p>
                  <p className="text-sm font-bold text-slate-900">{registry.bisogni_assicurativi_verificati.playbook_commerciale.target_principale || 'Titolare / referente da identificare'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Angolo di attacco</p>
                  <p className="text-[11px] text-slate-700">{registry.bisogni_assicurativi_verificati.playbook_commerciale.angolo_attacco}</p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-1">Apertura call consigliata</p>
                  <p className="text-[11px] text-slate-700">{registry.bisogni_assicurativi_verificati.playbook_commerciale.apertura_consigliata}</p>
                </div>
              </div>

              <div className="mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50">
                <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider mb-1">Obiettivo della call</p>
                <p className="text-[11px] text-slate-800 font-medium">{registry.bisogni_assicurativi_verificati.playbook_commerciale.call_to_action}</p>
              </div>
            </div>
          )}

          {registry.bisogni_assicurativi_verificati.priorita_commerciale.reasons?.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-white/80 border border-sky-100">
              <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wider mb-2">Perché questo lead è prioritario</p>
              <div className="space-y-1">
                {registry.bisogni_assicurativi_verificati.priorita_commerciale.reasons.map((reason: string, i: number) => (
                  <p key={i} className="text-[11px] text-slate-700 flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                    {reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="p-4 rounded-xl border border-sky-200 bg-white/80">
              <p className="text-[10px] font-black text-sky-700 uppercase tracking-wider mb-2">Fatti verificati</p>
              <div className="space-y-2">
                {registry.bisogni_assicurativi_verificati.fatti_verificati?.map((fact: any) => (
                  <div key={fact.id} className="p-2 rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-800">{fact.label}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                        fact.confidence === 'alta' ? 'bg-emerald-100 text-emerald-700' :
                        fact.confidence === 'media' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{fact.confidence}</span>
                    </div>
                    <p className="text-xs text-slate-700 font-medium">{fact.value}</p>
                    <p className="text-[10px] text-slate-400">{fact.source}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-cyan-200 bg-white/80">
              <p className="text-[10px] font-black text-cyan-700 uppercase tracking-wider mb-2">Dati da verificare per aumentare la conversione</p>
              {registry.bisogni_assicurativi_verificati.dati_da_verificare?.length > 0 ? (
                <div className="space-y-2">
                  {registry.bisogni_assicurativi_verificati.dati_da_verificare.map((item: any, i: number) => (
                    <div key={i} className="p-2 rounded-lg border border-amber-200 bg-amber-50">
                      <p className="text-xs font-bold text-amber-800">{item.field}</p>
                      <p className="text-[11px] text-slate-700">{item.reason}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Impatto: {item.impact}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 font-medium">
                  Dataset già molto completo per una proposta commerciale mirata.
                </div>
              )}
            </div>
          </div>

          {registry.bisogni_assicurativi_verificati.bisogni_raccomandati?.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mb-2">Cosa vendere esattamente a questa azienda</p>
              <div className="space-y-2">
                {registry.bisogni_assicurativi_verificati.bisogni_raccomandati.map((need: any) => (
                  <div key={need.id} className="p-3 rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-900">{need.product}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                          need.priority === 'immediata' ? 'bg-red-100 text-red-700' :
                          need.priority === 'alta' ? 'bg-orange-100 text-orange-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{need.priority}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                          need.confidence === 'alta' ? 'bg-emerald-100 text-emerald-700' :
                          need.confidence === 'media' ? 'bg-sky-100 text-sky-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{need.confidence}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">Target: {need.target}</span>
                    </div>
                    <p className="text-[11px] text-slate-700 mb-1"><span className="font-semibold">Perché venderla:</span> {need.sales_reason}</p>
                    <p className="text-[11px] text-emerald-700 font-medium"><span className="font-semibold">Perché adesso:</span> {need.why_now}</p>
                    {need.evidence_ids?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {need.evidence_ids.map((evidenceId: string) => (
                          <span key={evidenceId} className="text-[10px] font-medium px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                            evidenza: {evidenceId.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {registry.bisogni_assicurativi_verificati.prossime_domande?.length > 0 && (
            <div className="pt-3 border-t border-sky-200">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Domande perfette per la prima call</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {registry.bisogni_assicurativi_verificati.prossime_domande.map((question: string, i: number) => (
                  <div key={i} className="p-2 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-700">
                    {question}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Gap Analysis Assicurativo ── */}
      {registry?.gap_analysis && registry.gap_analysis.gaps?.length > 0 && (
        <div className={`mb-6 rounded-2xl border-2 p-6 shadow-sm ${
          registry.gap_analysis.livello_rischio === 'critico' ? 'border-red-300 bg-gradient-to-br from-red-50 to-rose-50' :
          registry.gap_analysis.livello_rischio === 'alto' ? 'border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50' :
          registry.gap_analysis.livello_rischio === 'medio' ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50' :
          'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                registry.gap_analysis.livello_rischio === 'critico' ? 'bg-red-100 border border-red-200' :
                registry.gap_analysis.livello_rischio === 'alto' ? 'bg-orange-100 border border-orange-200' :
                'bg-amber-100 border border-amber-200'
              }`}>
                <AlertTriangle className={`w-4 h-4 ${
                  registry.gap_analysis.livello_rischio === 'critico' ? 'text-red-600' :
                  registry.gap_analysis.livello_rischio === 'alto' ? 'text-orange-600' :
                  'text-amber-600'
                }`} />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Gap Analysis Assicurativo</h3>
                <p className="text-xs text-slate-500">{registry.gap_analysis.sommario}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                registry.gap_analysis.livello_rischio === 'critico' ? 'bg-red-200' :
                registry.gap_analysis.livello_rischio === 'alto' ? 'bg-orange-200' :
                registry.gap_analysis.livello_rischio === 'medio' ? 'bg-amber-200' :
                'bg-green-200'
              }`}>
                <span className={`text-xl font-black ${
                  registry.gap_analysis.livello_rischio === 'critico' ? 'text-red-700' :
                  registry.gap_analysis.livello_rischio === 'alto' ? 'text-orange-700' :
                  registry.gap_analysis.livello_rischio === 'medio' ? 'text-amber-700' :
                  'text-green-700'
                }`}>{registry.gap_analysis.score}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {registry.gap_analysis.gaps.map((gap: any, i: number) => (
              <div key={i} className={`p-3 rounded-xl border ${
                gap.gravita === 'critico' ? 'border-red-200 bg-white' :
                gap.gravita === 'alto' ? 'border-orange-200 bg-white' :
                gap.gravita === 'medio' ? 'border-amber-200 bg-white' :
                'border-slate-200 bg-white'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                    gap.gravita === 'critico' ? 'bg-red-100 text-red-700' :
                    gap.gravita === 'alto' ? 'bg-orange-100 text-orange-700' :
                    gap.gravita === 'medio' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{gap.gravita}</span>
                  <span className="text-xs font-bold text-slate-800">{gap.area}</span>
                </div>
                <p className="text-[11px] text-slate-600 mb-1">{gap.descrizione}</p>
                <p className="text-[11px] text-emerald-700 font-semibold">{gap.azione}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stima Premio + Classificazione EU ── */}
      {registry?.stima_premio && (
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Stima Premio Annuale */}
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Stima Premio Annuale</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">{registry.stima_premio.fonte}</p>
              </div>
            </div>

            <div className="text-center mb-4 p-3 rounded-xl bg-white border border-indigo-200">
              <p className="text-2xl font-black text-indigo-700">{registry.stima_premio.totale_stimato}</p>
              <p className="text-[10px] text-slate-400">premio annuale totale stimato</p>
            </div>

            <div className="space-y-2">
              {registry.stima_premio.dettaglio.map((d: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/70 border border-indigo-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-700 truncate">{d.polizza}</p>
                    <p className="text-[10px] text-slate-400 truncate">{d.note}</p>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 whitespace-nowrap ml-2">
                    €{new Intl.NumberFormat('it-IT').format(d.premio_min)} - €{new Intl.NumberFormat('it-IT').format(d.premio_max)}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[9px] text-slate-400 mt-3 leading-relaxed">{registry.stima_premio.disclaimer}</p>
          </div>

          {/* Classificazione EU */}
          {registry.classificazione_eu && (
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">{registry.classificazione_eu.label}</h3>
                  <p className="text-[10px] text-slate-400">Reg. UE 651/2014 — classificazione PMI</p>
                </div>
              </div>

              <div className={`inline-block text-xs font-black px-3 py-1.5 rounded-full mb-4 ${
                registry.classificazione_eu.classe === 'grande' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                registry.classificazione_eu.classe === 'media' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                registry.classificazione_eu.classe === 'piccola' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>
                {registry.classificazione_eu.classe.toUpperCase()}
              </div>
              <p className="text-xs text-slate-600 mb-4">{registry.classificazione_eu.descrizione}</p>

              {registry.classificazione_eu.obblighi_extra?.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Obblighi normativi</p>
                  <ul className="space-y-1">
                    {registry.classificazione_eu.obblighi_extra.map((o: string, i: number) => (
                      <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {registry.classificazione_eu.opportunita_broker?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2">Opportunità commerciali</p>
                  <ul className="space-y-1">
                    {registry.classificazione_eu.opportunita_broker.map((o: string, i: number) => (
                      <li key={i} className="text-[11px] text-emerald-700 flex items-start gap-1.5">
                        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {pitchError && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 10, padding: '10px 16px',
          fontSize: 13, color: '#DC2626',
          fontFamily: 'DM Sans, sans-serif',
          marginBottom: 16,
        }}>
          Errore pitch: {pitchError}
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Cold Email Generata</h2>
          <Button size="sm" variant="secondary" onClick={() => copyToClipboard()} className="gap-2">
            <Copy className="h-4 w-4" />
            Copia
          </Button>
        </div>

        <div className="mt-3">
          <textarea
            value={coldEmail}
            onChange={(e) => setColdEmail(e.target.value)}
            className="w-full min-h-[160px] rounded-md border border-blue-200 bg-blue-50 p-6 text-sm text-blue-800 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-200"
          />
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <Mail className="h-4 w-4" />
          <span>Personalizza il testo prima di inviare.</span>
        </div>
      </Card>

      {/* Pitch Modal */}
      {showPitchModal && pitchResult && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }} onClick={() => setShowPitchModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 16,
              maxWidth: 640, width: '100%',
              maxHeight: '80vh', overflow: 'auto',
              padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}>
            <h3 style={{
              fontSize: 16, fontWeight: 700, color: '#0F172A',
              fontFamily: 'Syne, sans-serif', margin: '0 0 4px',
            }}>
              Pitch Commerciale
            </h3>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: '0 0 16px', fontFamily: 'DM Sans, sans-serif' }}>
              {nome} · {citta} · {categoria}
            </p>

            <div style={{
              background: '#F8FAFC', borderRadius: 10,
              padding: 16, marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Oggetto
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', fontFamily: 'DM Sans, sans-serif' }}>
                {pitchResult.subject}
              </div>
            </div>

            <div style={{
              background: '#F8FAFC', borderRadius: 10,
              padding: 16, marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Corpo
              </div>
              <div style={{ fontSize: 13, color: '#334155', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {pitchResult.body}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowPitchModal(false)}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  background: '#F1F5F9', color: '#475569',
                  fontSize: 13, fontWeight: 600,
                  border: '1px solid #E2E8F0', cursor: 'pointer',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                Chiudi
              </button>
              <button
                onClick={() => copyToClipboard(`${pitchResult.subject}\n\n${pitchResult.body}`)}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  background: 'white', color: '#475569',
                  fontSize: 13, fontWeight: 600,
                  border: '1px solid #E2E8F0', cursor: 'pointer',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                📋 Copia testo
              </button>
              {email && (
                <button
                  onClick={() => {
                    window.open(`mailto:${email}?subject=${encodeURIComponent(pitchResult.subject)}&body=${encodeURIComponent(pitchResult.body)}`, '_blank')
                  }}
                  style={{
                    padding: '10px 20px', borderRadius: 8,
                    background: '#6366F1', color: 'white',
                    fontSize: 13, fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                  }}>
                  ✉️ Apri nel client mail
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
