'use client'

import { useEffect, useState } from 'react'
import { Facebook, Hash, Instagram, Linkedin, Loader2, Calendar, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getEnrichment, saveEnrichment } from '@/app/dashboard/enrichment/actions'
import type { LeadEnrichment } from '@/types/enrichment'

type Props = {
  website: string
  leadName: string
}

type EnrichmentPreview = {
  linkedin_url: string | null
  instagram_url: string | null
  facebook_url: string | null
  partita_iva: string | null
  anno_fondazione: string | null
  dipendenti_stimati: string | null
  error?: string
}

export function LeadEnrichmentPanel({ website, leadName }: Props) {
  const [enrichment, setEnrichment] = useState<LeadEnrichment | null>(null)
  const [preview, setPreview] = useState<EnrichmentPreview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [hasChecked, setHasChecked] = useState(false)

  useEffect(() => {
    if (!isExpanded || hasChecked) return
    const site = typeof website === 'string' ? website.trim() : ''
    if (!site) return

    setHasChecked(true)
    getEnrichment(site).then((data) => {
      if (data) {
        setEnrichment(data)
        setPreview(null)
      }
    })
  }, [hasChecked, isExpanded, website])

  const handleEnrich = async () => {
    const site = typeof website === 'string' ? website.trim() : ''
    if (!site) return

    setIsLoading(true)
    try {
      const res = await fetch('/api/enrich-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: site }),
      })

      const data = (await res.json().catch(() => null)) as any

      console.log('ENRICH RESULT:', data)

      const nextPreview: EnrichmentPreview = {
        linkedin_url: data?.linkedin_url ?? null,
        instagram_url: data?.instagram_url ?? null,
        facebook_url: data?.facebook_url ?? null,
        partita_iva: data?.partita_iva ?? null,
        anno_fondazione: data?.anno_fondazione ?? null,
        dipendenti_stimati: data?.dipendenti_stimati ?? null,
        error: typeof data?.error === 'string' ? data.error : undefined,
      }

      setPreview(nextPreview)

      const result = await saveEnrichment(site, {
        linkedin_url: data?.linkedin_url ?? null,
        instagram_url: data?.instagram_url ?? null,
        facebook_url: data?.facebook_url ?? null,
        partita_iva: data?.partita_iva ?? null,
        anno_fondazione: data?.anno_fondazione ?? null,
        dipendenti_stimati: data?.dipendenti_stimati ?? null,
        extra_data: { lead_name: leadName || null, api_error: data?.error ?? null },
      })

      if (result.success && result.data) {
        setEnrichment(result.data)
        setPreview(null)
      }
    } catch (e) {
      console.error('Enrichment error:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const view = (enrichment as any) || preview

  const hasAnyResponse = !!view

  const hasData =
    !!view &&
    !!(
      (view as any).linkedin_url ||
      (view as any).instagram_url ||
      (view as any).facebook_url ||
      (view as any).partita_iva ||
      (view as any).anno_fondazione ||
      (view as any).dipendenti_stimati
    )

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setIsExpanded((p) => !p)}
        className="mt-1 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-gradient-to-r from-violet-600/10 to-purple-600/5 px-3 py-1 text-xs font-semibold text-violet-700 transition-all duration-200 hover:from-violet-600 hover:to-purple-600 hover:text-white"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Arricchisci
        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {isExpanded ? (
        <div className="mt-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
          {!hasAnyResponse ? (
            <Button
              size="sm"
              onClick={handleEnrich}
              disabled={isLoading || !website}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-7"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" /> Analisi in corso...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 mr-1" /> Analizza azienda
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-1.5">
              {view?.error ? (
                <div className="text-xs text-amber-700">{view.error}</div>
              ) : null}

              {(view as any).linkedin_url ? (
                <a
                  href={(view as any).linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-blue-700 hover:underline"
                >
                  <Linkedin className="w-3 h-3" /> LinkedIn
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Linkedin className="w-3 h-3" /> LinkedIn: Non trovato
                </div>
              )}

              {(view as any).instagram_url ? (
                <a
                  href={(view as any).instagram_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-pink-600 hover:underline"
                >
                  <Instagram className="w-3 h-3" /> Instagram
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Instagram className="w-3 h-3" /> Instagram: Non trovato
                </div>
              )}

              {(view as any).facebook_url ? (
                <a
                  href={(view as any).facebook_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                >
                  <Facebook className="w-3 h-3" /> Facebook
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Facebook className="w-3 h-3" /> Facebook: Non trovato
                </div>
              )}

              {(view as any).partita_iva ? (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Hash className="w-3 h-3" /> P.IVA: {(view as any).partita_iva}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Hash className="w-3 h-3" /> P.IVA: Non trovata
                </div>
              )}

              {(view as any).anno_fondazione ? (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Calendar className="w-3 h-3" /> Dal {(view as any).anno_fondazione}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Calendar className="w-3 h-3" /> Anno: Non trovato
                </div>
              )}

              <button
                type="button"
                onClick={handleEnrich}
                disabled={isLoading}
                className="text-xs text-purple-500 hover:text-purple-700 mt-1"
              >
                {isLoading ? 'Aggiornamento...' : 'Aggiorna dati'}
              </button>

              {!hasData ? <div className="text-xs text-gray-500">Nessun dato trovato sul sito.</div> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
