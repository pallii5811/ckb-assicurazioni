/**
 * POST /api/enrich-lead
 * Clay-style enrichment: combines ALL available sources for a single lead
 * 
 * Input: { lead: { nome, sito, telefono, email, citta, categoria, indirizzo } }
 *   OR:  { url: string }  (legacy: basic website scraping)
 * 
 * Output: Full ClayEnrichedLead object with all enriched data
 */
import { NextRequest, NextResponse } from 'next/server'
import { clayEnrichLead } from '@/lib/clay-enrichment'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    // ── New Clay-style enrichment (full lead) ───────────────────
    if (body.lead) {
      const enriched = await clayEnrichLead(body.lead)
      return NextResponse.json(enriched)
    }

    // ── Legacy: basic URL enrichment (backward compatible) ──────
    if (body.url) {
      const urlRaw = typeof body.url === 'string' ? body.url.trim() : ''
      if (!urlRaw) {
        return NextResponse.json({ error: 'URL mancante' }, { status: 400 })
      }
      // Use Clay enrichment with minimal lead data
      const enriched = await clayEnrichLead({
        nome: '',
        sito: urlRaw,
      })
      // Return in legacy format for backward compatibility
      return NextResponse.json({
        linkedin_url: enriched.linkedinCompany || enriched.linkedinPerson || null,
        instagram_url: enriched.instagram || null,
        facebook_url: enriched.facebook || null,
        partita_iva: enriched.partitaIva || null,
        anno_fondazione: enriched.dataCostutuzione?.slice(0, 4) || null,
        dipendenti_stimati: enriched.dipendenti || null,
        // New fields (ignored by old callers)
        clay_data: enriched,
      })
    }

    return NextResponse.json({ error: 'Specificare lead o url' }, { status: 400 })
  } catch (e: any) {
    console.error('[enrich-lead] error:', e)
    return NextResponse.json({
      linkedin_url: null,
      instagram_url: null,
      facebook_url: null,
      partita_iva: null,
      anno_fondazione: null,
      dipendenti_stimati: null,
      error: e.message || 'Errore enrichment',
    })
  }
}
