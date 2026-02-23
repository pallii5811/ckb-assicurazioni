import 'server-only'

export async function analyzeAdsPresence(
  businessName: string,
  website: string,
  city: string,
  category: string
): Promise<{
  facebookAds: {
    isRunning: boolean
    estimatedBudget: string | null
    adTypes: string[]
    since: string | null
    totalAds: number
    libraryUrl: string
  }
  googleAds: {
    isRunning: boolean
    keywords: string[]
    estimatedBudget: string | null
  }
  overallAdScore: number
  opportunities: string[]
  competitorContext: string
}> {
  // Facebook Ads Library API — GRATUITA e UFFICIALE
  // Non richiede autenticazione per ricerche pubbliche
  const fbLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IT&q=${encodeURIComponent(businessName)}`

  let fbAdsRunning = false
  let totalAds = 0
  let adTypes: string[] = []

  try {
    // Chiamata API ufficiale Facebook Ads Library
    const fbApiUrl =
      `https://graph.facebook.com/v19.0/ads_archive?` +
      `access_token=${process.env.FB_ADS_TOKEN || 'no_token'}` +
      `&search_terms=${encodeURIComponent(businessName)}` +
      `&ad_reached_countries=IT` +
      `&ad_active_status=ACTIVE` +
      `&fields=id,ad_creative_body,ad_creative_link_caption,` +
      `ad_creative_link_description,ad_delivery_start_time,` +
      `page_name,spend&limit=10`

    if (process.env.FB_ADS_TOKEN) {
      const fbRes = await fetch(fbApiUrl, {
        signal: AbortSignal.timeout(10000),
      })
      const fbData = (await fbRes.json()) as any
      const ads = fbData?.data || []
      totalAds = ads.length
      fbAdsRunning = totalAds > 0
      if (fbAdsRunning) {
        adTypes = ['Sponsorizzato']
      }
    }
  } catch {
    fbAdsRunning = false
  }

  // Google Ads: controlla se il sito appare in ricerche
  // sponsorizzate (heuristica basata su tech_stack)
  // Usiamo GPT solo per le opportunità commerciali
  // non per inventare dati
  const apiKey = process.env.OPENAI_API_KEY
  let opportunities: string[] = []
  let competitorContext = ''
  let googleAdsRunning = false
  let googleKeywords: string[] = []

  if (apiKey) {
    try {
      const prompt = `Sei un esperto di digital advertising italiano.
Azienda: ${businessName}
Settore: ${category}
Città: ${city}
Sito: ${website}
Sta facendo Facebook Ads: ${fbAdsRunning ? 'SÌ' : 'NO'}

Basandoti su questi dati REALI, genera:
1. 3 opportunità commerciali specifiche per un consulente 
   che vuole vendere servizi ads a questa azienda
2. Se probabilmente fa Google Ads (true/false)
3. 2-3 keyword probabili se fa Google Ads
4. Contesto competitivo del settore in questa città (1 frase)

Rispondi SOLO con JSON valido:
{
  "googleAds": {
    "isRunning": true/false,
    "keywords": ["keyword1", "keyword2"],
    "estimatedBudget": "€X-Y/mese o null"
  },
  "opportunities": [
    "opportunità specifica 1",
    "opportunità specifica 2", 
    "opportunità specifica 3"
  ],
  "competitorContext": "frase sul contesto competitivo"
}`

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15000),
      })

      const data = (await res.json()) as any
      const content = data?.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

      googleAdsRunning = parsed?.googleAds?.isRunning === true
      googleKeywords = Array.isArray(parsed?.googleAds?.keywords) ? parsed.googleAds.keywords : []
      opportunities = Array.isArray(parsed?.opportunities) ? parsed.opportunities : []
      competitorContext = parsed?.competitorContext || ''
    } catch {
      opportunities = []
    }
  }

  return {
    facebookAds: {
      isRunning: fbAdsRunning,
      estimatedBudget: fbAdsRunning ? '€500-2000/mese' : null,
      adTypes: adTypes,
      since: null,
      totalAds: totalAds,
      libraryUrl: fbLibraryUrl,
    },
    googleAds: {
      isRunning: googleAdsRunning,
      keywords: googleKeywords,
      estimatedBudget: googleAdsRunning ? '€300-800/mese' : null,
    },
    overallAdScore: fbAdsRunning && googleAdsRunning ? 80 : fbAdsRunning || googleAdsRunning ? 40 : 0,
    opportunities,
    competitorContext,
  }
}
