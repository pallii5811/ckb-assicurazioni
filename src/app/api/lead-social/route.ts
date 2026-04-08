import { NextRequest, NextResponse } from 'next/server'

// ── Helpers ──────────────────────────────────────────────────────

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || ''

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
}

async function fetchHtml(url: string, timeout = 8000): Promise<string> {
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeout), redirect: 'follow' })
    if (!r.ok) return ''
    return await r.text()
  } catch { return '' }
}

// ── Extract social links from website HTML ───────────────────────

interface SocialLinks {
  instagram?: string
  tiktok?: string
  facebook?: string
  linkedin?: string
  youtube?: string
}

function extractSocialLinks(html: string): SocialLinks {
  const links: SocialLinks = {}
  // Instagram
  const ig = html.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+))\/?["']/i)
  if (ig && ig[2] && !['p', 'explore', 'reel', 'stories', 'accounts'].includes(ig[2].toLowerCase())) {
    links.instagram = ig[2].replace(/\/+$/, '')
  }
  // TikTok
  const tt = html.match(/href=["'](https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]+))\/?["']/i)
  if (tt && tt[2]) links.tiktok = tt[2].replace(/\/+$/, '')
  // Facebook
  const fb = html.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9_./-]+))["']/i)
  if (fb && fb[2] && !['sharer', 'share', 'dialog', 'plugins'].includes(fb[2].split('/')[0].toLowerCase())) {
    links.facebook = `https://facebook.com/${fb[2].replace(/\/+$/, '')}`
  }
  // LinkedIn
  const li = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+))\/?["']/i)
  if (li) links.linkedin = li[1]
  // YouTube
  const yt = html.match(/href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9_-]+))\/?["']/i)
  if (yt) links.youtube = yt[1]
  return links
}

// ── Detect pixels & tech stack from website HTML ─────────────────

interface TechDetection {
  tiktok_pixel: boolean
  meta_pixel: boolean
  google_analytics: boolean
  google_tag_manager: boolean
  google_ads: boolean
  hotjar: boolean
  microsoft_clarity: boolean
  hubspot: boolean
  mailchimp: boolean
  cms?: string
  has_ssl?: boolean
  has_cookie_banner: boolean
  has_privacy_policy: boolean
  has_ecommerce: boolean
}

function detectTech(html: string, url: string): TechDetection {
  const h = html.toLowerCase()
  return {
    tiktok_pixel: h.includes('ttq.load') || h.includes('analytics.tiktok.com'),
    meta_pixel: h.includes("fbq('init") || h.includes('fbq("init') || h.includes('connect.facebook.net/en_US/fbevents'),
    google_analytics: h.includes('gtag(') || h.includes('google-analytics.com') || h.includes('googletagmanager.com/gtag'),
    google_tag_manager: h.includes('googletagmanager.com/gtm') || h.includes('gtm.start'),
    google_ads: h.includes('googleads.') || h.includes('googlesyndication.') || h.includes("gtag('config', 'AW-"),
    hotjar: h.includes('hotjar.com') || h.includes('hj('),
    microsoft_clarity: h.includes('clarity.ms'),
    hubspot: h.includes('hubspot.com') || h.includes('hs-scripts.com') || h.includes('hbspt.'),
    mailchimp: h.includes('mailchimp.com') || h.includes('list-manage.com') || h.includes('mc.us'),
    cms: detectCms(h),
    has_ssl: url.startsWith('https'),
    has_cookie_banner: h.includes('cookie') && (h.includes('consent') || h.includes('banner') || h.includes('accett') || h.includes('gdpr')),
    has_privacy_policy: h.includes('privacy') && (h.includes('policy') || h.includes('informativa')),
    has_ecommerce: h.includes('add-to-cart') || h.includes('addtocart') || h.includes('woocommerce') || h.includes('shopify') || h.includes('prestashop') || h.includes('/cart') || h.includes('carrello'),
  }
}

function detectCms(h: string): string | undefined {
  if (h.includes('wp-content') || h.includes('wp-includes') || h.includes('wordpress')) return 'WordPress'
  if (h.includes('shopify.com') || h.includes('cdn.shopify')) return 'Shopify'
  if (h.includes('squarespace.com') || h.includes('squarespace-cdn')) return 'Squarespace'
  if (h.includes('wix.com') || h.includes('wixsite') || h.includes('parastorage.com')) return 'Wix'
  if (h.includes('webflow.com') || h.includes('assets.website-files')) return 'Webflow'
  if (h.includes('prestashop') || h.includes('presta')) return 'PrestaShop'
  if (h.includes('joomla')) return 'Joomla'
  if (h.includes('drupal')) return 'Drupal'
  return undefined
}

// ── Instagram public profile scraping ────────────────────────────

interface InstagramData {
  username: string
  full_name?: string
  biography?: string
  followers?: number
  following?: number
  posts_count?: number
  is_verified?: boolean
  is_business?: boolean
  profile_pic?: string
  external_url?: string
  engagement_rate?: number
  avg_likes?: number
  avg_comments?: number
  last_post_date?: string
  last_post_days_ago?: number
  posting_frequency?: string
  category?: string
  error?: string
}

function calcEngagement(posts: any[], followers: number): Partial<InstagramData> {
  if (!posts || posts.length === 0 || !followers) return {}
  let totalLikes = 0, totalComments = 0
  let latestTs = 0
  const validPosts: number[] = []
  for (const p of posts.slice(0, 12)) {
    const node = p.node || p
    const likes = node.edge_liked_by?.count ?? node.like_count ?? node.likes ?? 0
    const comments = node.edge_media_to_comment?.count ?? node.comment_count ?? node.comments ?? 0
    totalLikes += likes
    totalComments += comments
    const ts = node.taken_at_timestamp ?? node.taken_at ?? 0
    if (ts > latestTs) latestTs = ts
    if (ts) validPosts.push(ts)
  }
  const count = posts.slice(0, 12).length
  const avgLikes = Math.round(totalLikes / count)
  const avgComments = Math.round(totalComments / count)
  const engRate = parseFloat(((totalLikes + totalComments) / count / followers * 100).toFixed(2))
  const result: Partial<InstagramData> = { engagement_rate: engRate, avg_likes: avgLikes, avg_comments: avgComments }
  if (latestTs > 0) {
    const d = new Date(latestTs * 1000)
    result.last_post_date = d.toISOString().split('T')[0]
    result.last_post_days_ago = Math.round((Date.now() - d.getTime()) / 86400000)
  }
  if (validPosts.length >= 2) {
    validPosts.sort((a, b) => b - a)
    const spanDays = (validPosts[0] - validPosts[validPosts.length - 1]) / 86400
    if (spanDays > 0) {
      const postsPerWeek = (validPosts.length / spanDays) * 7
      if (postsPerWeek >= 7) result.posting_frequency = `${Math.round(postsPerWeek / 7)}/giorno`
      else if (postsPerWeek >= 1) result.posting_frequency = `${Math.round(postsPerWeek)}/settimana`
      else result.posting_frequency = `${Math.round(postsPerWeek * 4.3)}/mese`
    }
  }
  return result
}

async function scrapeInstagram(username: string): Promise<InstagramData | null> {
  if (!username) return null

  // ── Method 1: RapidAPI Instagram Scraper (most reliable) ────────
  if (RAPIDAPI_KEY) {
    try {
      const res = await fetch(
        `https://instagram-scraper-api2.p.rapidapi.com/v1/info?username_or_id_or_url=${encodeURIComponent(username)}`,
        {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
          },
          signal: AbortSignal.timeout(10000),
        }
      )
      if (res.ok) {
        const json = (await res.json()) as any
        const d = json?.data || json
        if (d && (d.follower_count !== undefined || d.edge_followed_by)) {
          const followers = d.follower_count ?? d.edge_followed_by?.count ?? 0
          const result: InstagramData = {
            username: d.username || username,
            full_name: d.full_name || undefined,
            biography: d.biography || undefined,
            followers,
            following: d.following_count ?? d.edge_follow?.count,
            posts_count: d.media_count ?? d.edge_owner_to_timeline_media?.count,
            is_verified: d.is_verified,
            is_business: d.is_business_account || d.is_professional_account,
            profile_pic: d.profile_pic_url_hd || d.hd_profile_pic_url_info?.url || d.profile_pic_url,
            external_url: d.external_url || d.bio_links?.[0]?.url || undefined,
            category: d.category_name || d.category || undefined,
          }
          // Try to get recent posts for engagement
          const posts = d.edge_owner_to_timeline_media?.edges || d.items || []
          if (posts.length > 0 && followers > 0) {
            Object.assign(result, calcEngagement(posts, followers))
          }
          // If no posts in profile response, try posts endpoint
          if (!result.engagement_rate && followers > 0) {
            try {
              const postsRes = await fetch(
                `https://instagram-scraper-api2.p.rapidapi.com/v1.2/posts?username_or_id_or_url=${encodeURIComponent(username)}`,
                {
                  headers: {
                    'X-RapidAPI-Key': RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
                  },
                  signal: AbortSignal.timeout(10000),
                }
              )
              if (postsRes.ok) {
                const postsJson = (await postsRes.json()) as any
                const items = postsJson?.data?.items || postsJson?.items || postsJson?.data?.edges || []
                if (items.length > 0) Object.assign(result, calcEngagement(items, followers))
              }
            } catch { /* posts fetch failed, ok */ }
          }
          return result
        }
      }
    } catch { /* RapidAPI failed, try fallbacks */ }
  }

  // ── Method 2: Instagram web API (often rate-limited) ────────────
  try {
    const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
      headers: {
        ...BROWSER_HEADERS,
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const json = (await res.json()) as any
      const u = json?.data?.user
      if (u) {
        const followers = u.edge_followed_by?.count ?? u.follower_count ?? 0
        const result: InstagramData = {
          username,
          full_name: u.full_name || undefined,
          biography: u.biography || undefined,
          followers,
          following: u.edge_follow?.count ?? u.following_count,
          posts_count: u.edge_owner_to_timeline_media?.count ?? u.media_count,
          is_verified: u.is_verified,
          is_business: u.is_business_account || u.is_professional_account,
          profile_pic: u.profile_pic_url_hd || u.profile_pic_url,
          external_url: u.external_url || undefined,
          category: u.category_name || undefined,
        }
        const posts = u.edge_owner_to_timeline_media?.edges || []
        if (posts.length > 0 && followers > 0) {
          Object.assign(result, calcEngagement(posts, followers))
        }
        return result
      }
    }
  } catch { /* try fallback */ }

  // ── Method 3: HTML meta tags (last resort) ─────────────────────
  try {
    const html = await fetchHtml(`https://www.instagram.com/${username}/`, 8000)
    if (!html || html.length < 1000) return { username, error: 'profilo_non_accessibile' }

    const result: InstagramData = { username }

    const descM = html.match(/meta\s+(?:name|property)=["'](?:og:)?description["']\s+content=["']([^"']+)/i)
    if (descM) {
      const desc = descM[1]
      const fol = desc.match(/([\d,.]+[KkMm]?)\s*Follower/i)
      if (fol) result.followers = parseCount(fol[1])
      const fing = desc.match(/([\d,.]+[KkMm]?)\s*Following/i)
      if (fing) result.following = parseCount(fing[1])
      const posts = desc.match(/([\d,.]+[KkMm]?)\s*Post/i)
      if (posts) result.posts_count = parseCount(posts[1])
    }

    const titleM = html.match(/<title>([^<]+)/i)
    if (titleM) {
      const nameM = titleM[1].match(/^(.+?)\s*[\((@]/)
      if (nameM) result.full_name = nameM[1].trim()
    }

    if (html.includes('"is_verified":true')) result.is_verified = true

    return result.followers !== undefined ? result : { username, error: 'dati_limitati' }
  } catch { return { username, error: 'errore_scraping' } }
}

function parseCount(s: string): number {
  if (!s) return 0
  const clean = s.replace(/,/g, '').trim()
  const num = parseFloat(clean)
  if (clean.toLowerCase().endsWith('k')) return Math.round(num * 1000)
  if (clean.toLowerCase().endsWith('m')) return Math.round(num * 1000000)
  return Math.round(num)
}

// ── TikTok public profile scraping ───────────────────────────────

interface TikTokData {
  username: string
  nickname?: string
  bio?: string
  followers?: number
  following?: number
  likes?: number
  video_count?: number
  is_verified?: boolean
  profile_pic?: string
  error?: string
}

async function scrapeTikTok(username: string): Promise<TikTokData | null> {
  if (!username) return null
  try {
    const html = await fetchHtml(`https://www.tiktok.com/@${username}`, 10000)
    if (!html || html.length < 1000) return { username, error: 'profilo_non_accessibile' }

    const result: TikTokData = { username }

    // Extract from __UNIVERSAL_DATA_FOR_REHYDRATION__
    const jsonM = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i)
    if (jsonM) {
      try {
        const data = JSON.parse(jsonM[1]) as any
        const userInfo = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo
        const u = userInfo?.user
        const stats = userInfo?.stats

        if (u) {
          result.nickname = u.nickname
          result.bio = u.signature
          result.is_verified = u.verified
          result.profile_pic = u.avatarLarger || u.avatarMedium
        }
        if (stats) {
          result.followers = stats.followerCount
          result.following = stats.followingCount
          result.likes = stats.heartCount || stats.heart
          result.video_count = stats.videoCount
        }
      } catch { /* JSON parse failed */ }
    }

    // Fallback: SIGI_STATE (newer TikTok format)
    if (result.followers === undefined) {
      const sigiM = html.match(/<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i)
      if (sigiM) {
        try {
          const sigi = JSON.parse(sigiM[1]) as any
          const users = sigi?.UserModule?.users || {}
          const stats = sigi?.UserModule?.stats || {}
          const uid = Object.keys(users)[0]
          if (uid && users[uid]) {
            result.nickname = users[uid].nickname
            result.bio = users[uid].signature
            result.is_verified = users[uid].verified
            result.profile_pic = users[uid].avatarLarger
          }
          if (uid && stats[uid]) {
            result.followers = stats[uid].followerCount
            result.following = stats[uid].followingCount
            result.likes = stats[uid].heartCount || stats[uid].heart
            result.video_count = stats[uid].videoCount
          }
        } catch { /* ignore */ }
      }
    }

    // Fallback: meta tags
    if (result.followers === undefined) {
      const descM = html.match(/meta\s+(?:name|property)=["'](?:og:)?description["']\s+content=["']([^"']+)/i)
      if (descM) {
        const desc = descM[1]
        const fol = desc.match(/([\d,.]+[KkMm]?)\s*Follower/i)
        if (fol) result.followers = parseCount(fol[1])
        const likes = desc.match(/([\d,.]+[KkMm]?)\s*(?:Like|Mi piace)/i)
        if (likes) result.likes = parseCount(likes[1])
      }
    }

    return result.followers !== undefined ? result : { username, error: 'dati_limitati' }
  } catch { return { username, error: 'errore_scraping' } }
}

// ── Format numbers for display ───────────────────────────────────

function formatNumber(n: number | undefined): string | undefined {
  if (n === undefined || n === null) return undefined
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  if (n >= 1000) return new Intl.NumberFormat('it-IT').format(n)
  return String(n)
}

// ── Main route ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { lead } = body

  const website = lead?.sito || lead?.website || ''

  const response: Record<string, any> = {
    social_links: {},
    tech: null,
    instagram: null,
    tiktok: null,
  }

  // Step 1: Fetch website HTML → extract social links + detect tech
  let siteHtml = ''
  let siteUrl = ''
  if (website) {
    siteUrl = website.startsWith('http') ? website : `https://${website}`
    siteHtml = await fetchHtml(siteUrl)
  }

  if (siteHtml) {
    response.social_links = extractSocialLinks(siteHtml)
    response.tech = detectTech(siteHtml, siteUrl)
  }

  // Use social links from lead data if not found in HTML
  const igUsername = response.social_links.instagram
    || extractUsernameFromUrl(lead?.instagram, 'instagram.com')
  const ttUsername = response.social_links.tiktok
    || extractUsernameFromUrl(lead?.tiktok, 'tiktok.com/@')

  // Step 2 & 3: Scrape Instagram and TikTok in parallel
  const [igData, ttData] = await Promise.all([
    igUsername ? scrapeInstagram(igUsername) : Promise.resolve(null),
    ttUsername ? scrapeTikTok(ttUsername) : Promise.resolve(null),
  ])

  if (igData) {
    response.instagram = {
      ...igData,
      followers_display: formatNumber(igData.followers),
      following_display: formatNumber(igData.following),
      posts_display: formatNumber(igData.posts_count),
      avg_likes_display: formatNumber(igData.avg_likes),
      avg_comments_display: formatNumber(igData.avg_comments),
      engagement_display: igData.engagement_rate !== undefined ? `${igData.engagement_rate}%` : undefined,
      url: `https://instagram.com/${igData.username}`,
    }
  }

  if (ttData) {
    response.tiktok = {
      ...ttData,
      followers_display: formatNumber(ttData.followers),
      following_display: formatNumber(ttData.following),
      likes_display: formatNumber(ttData.likes),
      video_count_display: formatNumber(ttData.video_count),
      url: `https://tiktok.com/@${ttData.username}`,
    }
  }

  return NextResponse.json(response)
}

function extractUsernameFromUrl(url: string | undefined, domain: string): string | null {
  if (!url) return null
  try {
    const match = url.match(new RegExp(domain.replace('.', '\\.') + '\\/?@?([a-zA-Z0-9_.]+)', 'i'))
    return match?.[1] || null
  } catch { return null }
}
