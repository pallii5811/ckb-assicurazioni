'use client'

import { useEffect, useMemo, useState } from 'react'
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
} from 'lucide-react'
import { calcOpportunityScore } from '@/components/ResultsTable'
import { generatePitchAction } from '@/app/dashboard/actions'

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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
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

export default function LeadDetailClient({ lead: leadProp, searchId, leadIndex, category, location }: LeadDetailClientProps) {
  // Fallback: read from sessionStorage if lead was not provided by the server
  const [sessionLead, setSessionLead] = useState<any>(null)
  useEffect(() => {
    if (leadProp) return
    try {
      const raw = sessionStorage.getItem('ckb_results')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed[leadIndex]) {
          setSessionLead(parsed[leadIndex])
        }
      }
    } catch {}
  }, [leadProp, leadIndex])

  const lead = leadProp || sessionLead

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

  const telefono = isNonEmptyString(lead?.telefono) ? lead.telefono : isNonEmptyString(lead?.phone) ? lead.phone : ''
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
          : 'text-rose-600'
      : 'text-slate-500'

  const seoErrors: string[] = Array.isArray(lead?.html_errors)
    ? (lead.html_errors as unknown[]).filter((v) => typeof v === 'string')
    : Array.isArray(lead?.htmlErrors)
      ? (lead.htmlErrors as unknown[]).filter((v) => typeof v === 'string')
      : []

  const opportunityItems = useMemo(() => {
    if (!lead) return []
    const out: string[] = []
    if (!sslOk) out.push('SSL non attivo')
    if (!hasPixel) out.push('Meta Pixel assente')
    if (!hasGtm) out.push('Google Tag Manager assente')
    if (!hasGoogleAds) out.push('Google Ads assente')
    if (typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) && loadSpeedSeconds > 3) out.push('Sito lento')
    if (seoErrors.length > 0) out.push('Errori SEO/HTML presenti')
    if (techStack.length > 0) out.push('Tech stack identificato')
    return out
  }, [lead, hasGoogleAds, hasGtm, hasPixel, loadSpeedSeconds, seoErrors.length, sslOk, techStack.length])

  const [reviews, setReviews] = useState<any>(null)
  const [social, setSocial] = useState<any>(null)
  const [ads, setAds] = useState<any>(null)
  const [competitors, setCompetitors] = useState<any>(null)
  const [trends, setTrends] = useState<any>(null)
  const [registry, setRegistry] = useState<any>(null)
  const [loadingReviews, setLoadingReviews] = useState(true)
  const [loadingSocial, setLoadingSocial] = useState(true)
  const [loadingAds, setLoadingAds] = useState(true)
  const [loadingCompetitors, setLoadingCompetitors] = useState(true)
  const [loadingTrends, setLoadingTrends] = useState(true)
  const [loadingRegistry, setLoadingRegistry] = useState(true)

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

    fetch(`/api/lead-trends?category=${cat}&city=${city}`)
      .then((r) => r.json())
      .then((d) => setTrends(d))
      .catch(() => setTrends(null))
      .finally(() => setLoadingTrends(false))

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
  }, [lead, category])

  useEffect(() => {
    const baseName = nome || 'Ciao'
    setColdEmail(
      `Oggetto: Una proposta per ${baseName}\n\nCiao ${baseName},\n\nHo notato alcune opportunità sul vostro sito e credo si possa migliorare rapidamente performance e tracciamenti.\n\nSe ti va, posso mandarti un audit rapido (gratuito) con 3 interventi prioritari.\n\nTi interessa parlarne?\n\nGrazie,\n[Il tuo nome]`
    )
  }, [nome])

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

        {/* Analisi Tecnica */}
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
            Analisi Tecnica
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { label: 'SSL', ok: sslOk },
              { label: 'Meta Pixel', ok: hasPixel },
              { label: 'Google Tag Manager', ok: hasGtm },
              { label: 'Google Ads', ok: hasGoogleAds },
            ].map(({ label, ok }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid #F8FAFC',
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 500, color: '#334155',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  padding: '3px 10px', borderRadius: 999,
                  background: ok ? '#F0FDF4' : '#FEF2F2',
                  color: ok ? '#16A34A' : '#DC2626',
                  border: `1px solid ${ok ? '#BBF7D0' : '#FECACA'}`,
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {ok ? '✓ Attivo' : '✗ Assente'}
                </span>
              </div>
            ))}
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '10px 0',
            }}>
              <span style={{
                fontSize: 13, fontWeight: 500, color: '#334155',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                Velocità
              </span>
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds)
                  ? loadSpeedSeconds < 2 ? '#16A34A' : loadSpeedSeconds <= 4 ? '#D97706' : '#DC2626'
                  : '#94A3B8',
                fontFamily: 'DM Sans, sans-serif',
              }}>
                {typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds)
                  ? `${loadSpeedSeconds.toFixed(1)}s` : '—'}
              </span>
            </div>
          </div>

          {techStack.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#475569',
                marginBottom: 8, fontFamily: 'DM Sans, sans-serif',
              }}>
                Tech Stack
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {techStack.map((t, idx) => (
                  <span key={`${t}-${idx}`} style={{
                    fontSize: 10, fontWeight: 600,
                    padding: '2px 8px', borderRadius: 4,
                    background: t.includes('MISSING') || t.includes('NO ')
                      ? '#FEF2F2' : t.includes('SSL') || t.includes('MOBILE')
                      ? '#F0FDF4' : '#F8FAFC',
                    color: t.includes('MISSING') || t.includes('NO ')
                      ? '#DC2626' : t.includes('SSL') || t.includes('MOBILE')
                      ? '#16A34A' : '#475569',
                    border: '1px solid',
                    borderColor: t.includes('MISSING') || t.includes('NO ')
                      ? '#FECACA' : t.includes('SSL') || t.includes('MOBILE')
                      ? '#BBF7D0' : '#E2E8F0',
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {seoErrors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#475569',
                marginBottom: 8, fontFamily: 'DM Sans, sans-serif',
              }}>
                Errori SEO
              </div>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                {seoErrors.slice(0, 8).map((e, idx) => (
                  <li key={idx} style={{
                    fontSize: 12, color: '#64748B',
                    fontFamily: 'DM Sans, sans-serif',
                    marginBottom: 4, wordBreak: 'break-word',
                  }}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

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
                      bg-violet-100 border border-violet-200 
                      flex items-center justify-center 
                      text-violet-600 text-xs font-black shrink-0">
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

      {/* Analisi AI */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{
            fontSize: 15, fontWeight: 700, color: '#0F172A',
            fontFamily: 'Syne, sans-serif', margin: '0 0 4px',
          }}>
            Analisi AI
          </h2>
          <p style={{
            fontSize: 13, color: '#94A3B8',
            fontFamily: 'DM Sans, sans-serif', margin: 0,
          }}>
            Recensioni, social, ads, competitor, trend e profilo aziendale
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
                        {social.tiktok.is_verified && <span className="text-blue-500 text-xs">✓</span>}
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

                {/* Digital Maturity Score */}
                {social.digital_score && (
                  <div className={`p-4 rounded-xl border-2 ${
                    social.digital_score.score >= 80 ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100' :
                    social.digital_score.score >= 60 ? 'border-blue-300 bg-gradient-to-br from-blue-50 to-blue-100' :
                    social.digital_score.score >= 40 ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100' :
                    social.digital_score.score >= 20 ? 'border-orange-300 bg-gradient-to-br from-orange-50 to-orange-100' :
                    'border-red-300 bg-gradient-to-br from-red-50 to-red-100'
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-slate-800">Punteggio Digitale</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black ${
                          social.digital_score.score >= 80 ? 'text-emerald-600' :
                          social.digital_score.score >= 60 ? 'text-blue-600' :
                          social.digital_score.score >= 40 ? 'text-amber-600' :
                          social.digital_score.score >= 20 ? 'text-orange-600' : 'text-red-600'
                        }`}>{social.digital_score.score}</span>
                        <span className="text-[10px] text-slate-500">/100</span>
                      </div>
                    </div>
                    <span className={`inline-block text-[11px] px-2.5 py-1 rounded-full font-bold mb-3 ${
                      social.digital_score.score >= 80 ? 'bg-emerald-200 text-emerald-800' :
                      social.digital_score.score >= 60 ? 'bg-blue-200 text-blue-800' :
                      social.digital_score.score >= 40 ? 'bg-amber-200 text-amber-800' :
                      social.digital_score.score >= 20 ? 'bg-orange-200 text-orange-800' : 'bg-red-200 text-red-800'
                    }`}>{social.digital_score.level}</span>
                    <div className="space-y-1.5 mb-3">
                      {social.digital_score.breakdown?.map((b: any, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-600 w-28 truncate">{b.area}</span>
                          <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                              b.score / b.max >= 0.7 ? 'bg-emerald-400' : b.score / b.max >= 0.4 ? 'bg-amber-400' : 'bg-red-400'
                            }`} style={{ width: `${Math.round(b.score / b.max * 100)}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-500 w-10 text-right">{b.score}/{b.max}</span>
                        </div>
                      ))}
                    </div>
                    {social.digital_score.opportunities?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Opportunità di vendita</p>
                        <div className="flex flex-wrap gap-1">
                          {social.digital_score.opportunities.map((o: string, i: number) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/70 text-slate-700 border border-slate-200">{o}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* LinkedIn */}
                {social.linkedin && !social.linkedin.error ? (
                  <div className="p-4 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-blue-50">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-xs font-medium hover:bg-sky-100 transition-colors w-fit">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors w-fit">
                    <Video className="w-3 h-3" /> YouTube
                  </a>
                )}

                {/* Website Quality Score */}
                {social.website_score && (
                  <div className="p-4 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-slate-800">Qualità Sito Web</span>
                      <span className={`text-lg font-black ${
                        social.website_score.score >= 70 ? 'text-emerald-600' :
                        social.website_score.score >= 40 ? 'text-amber-600' : 'text-red-600'
                      }`}>{social.website_score.score}/100</span>
                    </div>
                    {social.website_score.strengths?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {social.website_score.strengths.map((s: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">{s}</span>
                        ))}
                      </div>
                    )}
                    {social.website_score.issues?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {social.website_score.issues.slice(0, 6).map((s: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">{s}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex gap-3 text-[10px] text-slate-400">
                      <span>{social.website_score.page_size_kb}KB</span>
                      <span>{social.website_score.image_count} img</span>
                      <span>{social.website_score.external_scripts_count} script</span>
                    </div>
                  </div>
                )}

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

                {/* Tech & Pixel Detection */}
                {social.tech && (
                  <div className="mt-2 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pixel & Tecnologie rilevate</p>
                    <div className="flex flex-wrap gap-1.5">
                      {social.tech.tiktok_pixel && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-bold">TikTok Pixel ✓</span>
                      )}
                      {social.tech.meta_pixel && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-bold">Meta Pixel ✓</span>
                      )}
                      {social.tech.google_analytics && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500 text-white text-[10px] font-bold">Google Analytics ✓</span>
                      )}
                      {social.tech.google_tag_manager && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500 text-white text-[10px] font-bold">GTM ✓</span>
                      )}
                      {social.tech.google_ads && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-600 text-white text-[10px] font-bold">Google Ads ✓</span>
                      )}
                      {social.tech.hotjar && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-500 text-white text-[10px] font-bold">Hotjar ✓</span>
                      )}
                      {social.tech.microsoft_clarity && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-500 text-white text-[10px] font-bold">Clarity ✓</span>
                      )}
                      {social.tech.hubspot && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-600 text-white text-[10px] font-bold">HubSpot ✓</span>
                      )}
                      {social.tech.mailchimp && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-600 text-white text-[10px] font-bold">Mailchimp ✓</span>
                      )}
                      {social.tech.cms && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-bold border border-indigo-200">{social.tech.cms}</span>
                      )}
                      {social.tech.has_ecommerce && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">E-commerce ✓</span>
                      )}
                      {social.tech.has_ssl === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 text-red-700 text-[10px] font-bold border border-red-200">No SSL ⚠</span>
                      )}
                      {social.tech.has_cookie_banner === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">No Cookie Banner ⚠</span>
                      )}
                      {social.tech.has_privacy_policy === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">No Privacy Policy ⚠</span>
                      )}
                      {!social.tech.tiktok_pixel && !social.tech.meta_pixel && !social.tech.google_analytics && !social.tech.google_tag_manager && !social.tech.google_ads && !social.tech.hotjar && !social.tech.microsoft_clarity && !social.tech.hubspot && !social.tech.mailchimp && !social.tech.cms && !social.tech.has_ecommerce && (
                        <span className="text-xs text-slate-400">Nessun pixel o tool di marketing rilevato</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati social non disponibili</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border 
            border-slate-200 p-6 shadow-sm 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-xl 
                bg-orange-50 border border-orange-200 
                flex items-center justify-center">
                <Megaphone className="w-4 h-4 text-orange-500" />
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Attività Pubblicitaria
              </h3>
            </div>
            {loadingAds ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : ads ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`p-3 rounded-lg border ${ads.facebookAds?.isRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
                  >
                    <p className="text-sm font-medium text-slate-900">Facebook Ads</p>
                    <p className={`text-xs ${ads.facebookAds?.isRunning ? 'text-green-700' : 'text-red-700'}`}>
                      {ads.facebookAds?.isRunning
                        ? `Attivo${ads.facebookAds.estimatedBudget ? ' · ' + ads.facebookAds.estimatedBudget : ''}`
                        : 'Non attivo'}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${ads.googleAds?.isRunning ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
                  >
                    <p className="text-sm font-medium text-slate-900">Google Ads</p>
                    <p className={`text-xs ${ads.googleAds?.isRunning ? 'text-green-700' : 'text-red-700'}`}>
                      {ads.googleAds?.isRunning
                        ? `Attivo${ads.googleAds.estimatedBudget ? ' · ' + ads.googleAds.estimatedBudget : ''}`
                        : 'Non attivo'}
                    </p>
                  </div>
                </div>
                {ads.opportunities?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-purple-700 mb-1">💡 Opportunità Ads</p>
                    <div className="flex flex-wrap gap-1">
                      {ads.opportunities.map((o: string, i: number) => (
                        <span key={i} className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">
                          {o}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati pubblicitari non disponibili</p>
            )}
          </div>

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
                {(competitors.competitors || []).length > 0 ? (
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
                ) : (
                  <p className="text-gray-500 text-sm">Nessun competitor trovato</p>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati competitor non disponibili</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border 
            border-slate-200 p-6 shadow-sm 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-xl 
                bg-violet-50 border border-violet-200 
                flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-violet-500" />
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Trend di Mercato
              </h3>
            </div>
            {loadingTrends ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
              </div>
            ) : trends ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`text-2xl ${trends.trend === 'growing' ? '📈' : trends.trend === 'declining' ? '📉' : '➡️'}`} />
                  <span
                    className={`font-semibold ${
                      trends.trend === 'growing' ? 'text-green-600' : trends.trend === 'declining' ? 'text-red-600' : 'text-yellow-600'
                    }`}
                  >
                    {trends.trend === 'growing'
                      ? `In crescita${trends.growthPercentage ? ' +' + trends.growthPercentage + '%' : ''}`
                      : trends.trend === 'declining'
                        ? 'In calo'
                        : 'Stabile'}
                  </span>
                </div>
                {trends.bestContactTime && (
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-700 font-medium">🕐 Momento migliore per contattare</p>
                    <p className="text-sm text-blue-900">{trends.bestContactTime}</p>
                  </div>
                )}
                {trends.insights?.length > 0 && (
                  <div className="space-y-1">
                    {trends.insights.map((ins: string, i: number) => (
                      <p key={i} className="text-sm text-gray-600">
                        💡 {ins}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Trend non disponibili</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border 
            border-slate-200 p-6 shadow-sm 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-xl 
                bg-slate-100 border border-slate-200 
                flex items-center justify-center">
                <Building2 className="w-4 h-4 text-slate-600" />
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Profilo Aziendale
              </h3>
            </div>
            {loadingRegistry ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : registry?.found === false ? (
              <p className="text-gray-500 text-sm">Azienda non trovata nel Registro Imprese</p>
            ) : registry ? (
              <div className="space-y-3">
                {registry.fonte === 'registro_imprese' ? (
                  <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-xs text-emerald-700 font-medium">Dati verificati dal Registro Imprese</span>
                  </div>
                ) : registry.fonte === 'vies_verificato' ? (
                  <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-xs text-emerald-700 font-medium">P.IVA verificata tramite VIES (Agenzia delle Entrate UE)</span>
                  </div>
                ) : registry.fonte === 'google_maps' ? (
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                    <Target className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-blue-700 font-medium">Dati da Google Maps</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-2">
                  {registry.ragione_sociale ? (
                    <div>
                      <p className="text-xs text-gray-500">Ragione sociale</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.ragione_sociale}</p>
                    </div>
                  ) : null}
                  {registry.partita_iva ? (
                    <div>
                      <p className="text-xs text-gray-500">
                        Partita IVA
                        {registry.piva_verificata ? (
                          <span className="ml-1.5 text-emerald-600 font-semibold">✓ Verificata</span>
                        ) : null}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">IT {registry.partita_iva}</p>
                    </div>
                  ) : null}
                  {registry.forma_giuridica ? (
                    <div>
                      <p className="text-xs text-gray-500">Forma giuridica</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.forma_giuridica}</p>
                    </div>
                  ) : null}
                  {registry.codice_ateco ? (
                    <div>
                      <p className="text-xs text-gray-500">
                        Codice ATECO
                        {registry.ateco_stimato ? (
                          <span className="ml-1.5 text-amber-500 font-normal text-[10px]">(stimato)</span>
                        ) : null}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        {registry.codice_ateco}
                        {registry.descrizione_ateco ? (
                          <span className="text-xs text-gray-400 font-normal ml-1.5">— {registry.descrizione_ateco}</span>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                  {registry.fatturato ? (
                    <div>
                      <p className="text-xs text-gray-500">
                        Fatturato
                        {registry.fatturato_fonte === 'registro_imprese' ? (
                          <span className="ml-1.5 text-emerald-600 font-semibold">✓ Registro Imprese</span>
                        ) : null}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        € {registry.fatturato}
                        {registry.fatturato_anno ? (
                          <span className="text-xs text-gray-400 font-normal ml-1">({registry.fatturato_anno})</span>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                  {registry.dipendenti ? (
                    <div>
                      <p className="text-xs text-gray-500">
                        Dipendenti
                        {registry.dipendenti_fonte === 'registro_imprese' ? (
                          <span className="ml-1.5 text-emerald-600 font-semibold">✓ Registro Imprese</span>
                        ) : null}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">{registry.dipendenti}</p>
                    </div>
                  ) : null}
                  {registry.costo_personale ? (
                    <div>
                      <p className="text-xs text-gray-500">Costo del personale</p>
                      <p className="text-sm font-semibold text-slate-900">€ {registry.costo_personale}</p>
                    </div>
                  ) : null}
                  {registry.capitale_sociale ? (
                    <div>
                      <p className="text-xs text-gray-500">Capitale sociale</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.capitale_sociale}</p>
                    </div>
                  ) : null}
                  {registry.data_costituzione ? (
                    <div>
                      <p className="text-xs text-gray-500">Data costituzione</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.data_costituzione}</p>
                    </div>
                  ) : null}
                  {registry.sede_legale ? (
                    <div>
                      <p className="text-xs text-gray-500">
                        Sede legale
                        {registry.sede_legale_verificata ? (
                          <span className="ml-1.5 text-emerald-600 font-semibold">✓ VIES</span>
                        ) : null}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">{registry.sede_legale}</p>
                    </div>
                  ) : null}
                  {registry.codice_rea ? (
                    <div>
                      <p className="text-xs text-gray-500">Codice REA</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.codice_rea}</p>
                    </div>
                  ) : null}
                  {registry.pec ? (
                    <div>
                      <p className="text-xs text-gray-500">PEC</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.pec}</p>
                    </div>
                  ) : null}
                  {registry.stato ? (
                    <div>
                      <p className="text-xs text-gray-500">Stato</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.stato}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati aziendali non disponibili</p>
            )}
          </div>
        </div>
      </div>

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
            className="w-full min-h-[160px] rounded-md border border-slate-200 bg-white p-3 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-200"
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
