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
} from 'lucide-react'
import { calcOpportunityScore } from '@/components/ResultsTable'

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

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(coldEmail)
    } catch {
      // ignore
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
    <div style={{ padding: '24px', maxWidth: 1280, margin: '0 auto' }}>

      {/* Header */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        marginBottom: 24,
      }} className="md:flex-row md:items-start md:justify-between">
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
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#6366F1', color: 'white',
            fontSize: 13, fontWeight: 600,
            padding: '9px 18px', borderRadius: 8,
            border: 'none', cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
          }}>
            <Sparkles size={14} />
            Genera Pitch
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

          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#0F172A', color: 'white',
            fontSize: 13, fontWeight: 600,
            padding: '9px 18px', borderRadius: 8,
            border: 'none', cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            <MessageCircle size={14} />
            Contatta
          </button>

          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'white', color: '#475569',
            fontSize: 13, fontWeight: 600,
            padding: '9px 18px', borderRadius: 8,
            border: '1px solid #E2E8F0', cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            <BookmarkPlus size={14} />
            Salva
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
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16, marginBottom: 24,
      }} className="grid-cols-1 lg:grid-cols-3">

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

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }} className="grid-cols-1 md:grid-cols-2">

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
              <div className="space-y-3">
                {social?.source === 'error' ? (
                  <p className="text-gray-500 text-sm">Profilo non trovato</p>
                ) : social?.message ? (
                  <p className="text-gray-500 text-sm">{social.message}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {(['instagram', 'facebook'] as const).map((platform) => {
                      const data = social?.[platform]
                      const found = data?.found === true

                      return (
                        <div
                          key={platform}
                          className={`p-4 rounded-xl border flex 
                            items-center justify-between
                            ${found 
                              ? 'border-emerald-200 bg-emerald-50' 
                              : 'border-slate-200 bg-slate-50'
                            }`}
                        >
                          <span className="text-sm font-bold 
                            text-slate-800 capitalize">
                            {platform === 'instagram' ? 'Instagram' : 'Facebook'}
                          </span>
                          <span className={`text-xs font-bold px-3 py-1 
                            rounded-full
                            ${found 
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' 
                              : 'bg-slate-200 text-slate-500'
                            }`}>
                            {found ? 'Trovato' : 'Non trovato'}
                          </span>
                        </div>
                      )
                    })}
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
                ) : registry.fonte === 'google_maps' ? (
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                    <Target className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-blue-700 font-medium">Dati da Google Maps</span>
                  </div>
                ) : registry.fonte === 'google_maps_ai_ateco' ? (
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                    <Target className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-blue-700 font-medium">Dati da Google Maps &middot; Codice ATECO stimato</span>
                  </div>
                ) : registry.fonte === 'stima_ai' ? (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs text-amber-700 font-medium">Dati stimati da AI — potrebbero non essere accurati</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-2">
                  {registry.ragione_sociale ? (
                    <div>
                      <p className="text-xs text-gray-500">Ragione sociale</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.ragione_sociale}</p>
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
                      <p className="text-xs text-gray-500">Codice ATECO</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {registry.codice_ateco}
                        {registry.descrizione_ateco ? (
                          <span className="text-xs text-gray-400 font-normal ml-1.5">— {registry.descrizione_ateco}</span>
                        ) : null}
                      </p>
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
                      <p className="text-xs text-gray-500">Sede legale</p>
                      <p className="text-sm font-semibold text-slate-900">{registry.sede_legale}</p>
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

      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Cold Email Generata</h2>
          <Button size="sm" variant="secondary" onClick={copyToClipboard} className="gap-2">
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
    </div>
  )
}
