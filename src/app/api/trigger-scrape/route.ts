import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { category, city } = body

    if (!category || !city) {
      return NextResponse.json({ error: 'category and city required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // AUTO-RECOVERY: unstick jobs that have been processing for >15 min
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data: stuckJobs } = await supabase
      .from('searches')
      .select('id')
      .eq('status', 'processing')
      .lt('created_at', fifteenMinAgo)
      .limit(10)
    if (stuckJobs && stuckJobs.length > 0) {
      const stuckIds = stuckJobs.map((j: any) => j.id)
      await supabase.from('searches').update({ status: 'error' }).in('id', stuckIds)
      console.log('[trigger-scrape] unstuck', stuckIds.length, 'jobs:', stuckIds)
    }

    // Check if there's already a recent pending/processing job for same category+city
    const { data: existing } = await supabase
      .from('searches')
      .select('id, status, created_at')
      .ilike('location', city)
      .ilike('category', category)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      const cAt = typeof existing.created_at === 'string' ? existing.created_at : null
      const cMs = cAt ? Date.parse(cAt) : NaN
      const isRecent = Number.isFinite(cMs) && Date.now() - cMs <= 10 * 60 * 1000
      if (isRecent) {
        console.log('[trigger-scrape] reusing existing job:', existing.id, existing.status)
        return NextResponse.json({ job_id: existing.id, reused: true })
      }
      // Old stuck pending job — reset it
      if (!Number.isFinite(cMs) || Date.now() - cMs > 10 * 60 * 1000) {
        await supabase.from('searches').update({ status: 'error' }).eq('id', existing.id)
        console.log('[trigger-scrape] marked old stuck job as error:', existing.id)
      }
    }

    // Also check for recently completed jobs — re-scraping the same query
    // returns the same results, so reuse the completed job instead of wasting worker time
    const { data: completedJob } = await supabase
      .from('searches')
      .select('id, status, created_at')
      .ilike('location', city)
      .ilike('category', category)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (completedJob?.id) {
      const cAt = typeof completedJob.created_at === 'string' ? completedJob.created_at : null
      const cMs = cAt ? Date.parse(cAt) : NaN
      const isRecent = Number.isFinite(cMs) && Date.now() - cMs <= 30 * 60 * 1000
      if (isRecent) {
        console.log('[trigger-scrape] reusing completed job (no point re-scraping same query):', completedJob.id)
        return NextResponse.json({ job_id: completedJob.id, reused: true })
      }
    }

    // Insert a new pending job — the VPS worker polls Supabase and will pick it up
    const { data: insertData, error: insertError } = await supabase
      .from('searches')
      .insert({
        user_id: user?.id,
        category,
        location: city,
        status: 'pending',
        results: [],
        created_at: new Date().toISOString(),
      })
      .select()

    if (insertError) {
      // Handle duplicate key — requeue existing job
      if (String(insertError.code) === '23505') {
        const { data: dupRow } = await supabase
          .from('searches')
          .select('id')
          .ilike('location', city)
          .ilike('category', category)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (dupRow?.id) {
          await supabase
            .from('searches')
            .update({ status: 'pending', created_at: new Date().toISOString() })
            .eq('id', dupRow.id)
          console.log('[trigger-scrape] requeued duplicate:', dupRow.id)
          return NextResponse.json({ job_id: dupRow.id, reused: true })
        }
      }
      console.error('[trigger-scrape] insert error:', insertError.message)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const jobId = insertData?.[0]?.id
    console.log('[trigger-scrape] new job created:', jobId)
    return NextResponse.json({ job_id: jobId })

  } catch (error) {
    console.error('trigger-scrape error:', error)
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 500 }
    )
  }
}
