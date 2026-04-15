/**
 * POST /api/extract-email
 * Fast email extraction from a website URL
 * Scrapes homepage + /contatti + /contact for email addresses
 */
import { NextRequest, NextResponse } from 'next/server'

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const JUNK_EMAIL_RE = /^(noreply|no-reply|mailer|daemon|postmaster|webmaster|admin@localhost|test@|example@|sentry|wix|wordpress|support@sentry|email@example)/i
const JUNK_DOMAIN_RE = /\.(png|jpg|jpeg|gif|svg|css|js|woff|woff2|ttf|eot)$/i

function extractEmailsFromHtml(html: string): string[] {
  const raw = html.match(EMAIL_RE) || []
  const seen = new Set<string>()
  const emails: string[] = []
  for (const e of raw) {
    const lower = e.toLowerCase()
    if (seen.has(lower)) continue
    if (JUNK_EMAIL_RE.test(lower)) continue
    if (JUNK_DOMAIN_RE.test(lower)) continue
    // Skip emails from common CMS/framework artifacts
    if (lower.includes('example.com') || lower.includes('yoursite') || lower.includes('tuosito')) continue
    seen.add(lower)
    emails.push(lower)
  }
  return emails
}

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const urlRaw = typeof body.url === 'string' ? body.url.trim() : ''
    if (!urlRaw) {
      return NextResponse.json({ emails: [] })
    }

    const base = urlRaw.startsWith('http') ? urlRaw : `https://${urlRaw}`
    const baseClean = base.replace(/\/+$/, '')

    // Fetch homepage + contact pages in parallel
    const pages = [
      baseClean,
      `${baseClean}/contatti`,
      `${baseClean}/contacts`,
      `${baseClean}/contact`,
      `${baseClean}/chi-siamo`,
    ]

    const results = await Promise.allSettled(pages.map(p => fetchPage(p)))
    const allHtml = results.map(r => r.status === 'fulfilled' ? r.value : '').join('\n')

    const emails = extractEmailsFromHtml(allHtml)

    // Prioritize: info@ > preventivi@ > contatti@ > others
    emails.sort((a, b) => {
      const priority = (e: string) => {
        if (e.startsWith('info@')) return 0
        if (e.startsWith('preventivi@') || e.startsWith('preventivo@')) return 1
        if (e.startsWith('contatti@') || e.startsWith('contatto@')) return 2
        if (e.startsWith('commerciale@')) return 3
        return 10
      }
      return priority(a) - priority(b)
    })

    return NextResponse.json({
      emails: emails.slice(0, 5),
      primary: emails[0] || null,
    })
  } catch (e: any) {
    console.error('[extract-email] error:', e?.message)
    return NextResponse.json({ emails: [], primary: null })
  }
}
