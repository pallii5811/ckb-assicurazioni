import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import LeadDetailClient from './LeadDetailClient'

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ searchId: string; leadIndex: string }>
}) {
  const { searchId, leadIndex } = await params
  const idx = parseInt(leadIndex)

  // Fallback: lead data will be loaded from sessionStorage on the client
  if (searchId === '__local__') {
    return (
      <LeadDetailClient
        lead={null}
        searchId={searchId}
        leadIndex={idx}
        category={null}
        location={null}
      />
    )
  }

  let search: any = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('searches').select('results, category, location').eq('id', searchId).single()
    search = data
  } catch {
    // Supabase error (invalid UUID, network, etc.) — fall through to sessionStorage fallback
  }

  if (!search?.results) {
    // Fallback to sessionStorage on client side
    return (
      <LeadDetailClient
        lead={null}
        searchId={searchId}
        leadIndex={idx}
        category={search?.category ?? null}
        location={search?.location ?? null}
      />
    )
  }

  const results = Array.isArray(search.results)
    ? (search.results as any[])
    : typeof search.results === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(search.results)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })()
      : []

  const lead = results[idx]
  if (!lead) {
    // Fallback to sessionStorage on client side
    return (
      <LeadDetailClient
        lead={null}
        searchId={searchId}
        leadIndex={idx}
        category={search.category}
        location={search.location}
      />
    )
  }

  return (
    <LeadDetailClient
      lead={lead}
      searchId={searchId}
      leadIndex={idx}
      category={search.category}
      location={search.location}
    />
  )
}
