import 'server-only'

type TrendsAnalysis = {
  trend: 'growing' | 'stable' | 'declining'
  growthPercentage: number | null
  peakMonths: string[]
  bestContactTime: string
  marketOpportunity: string
  insights: string[]
  source: string
}

export async function analyzeTrends(category: string, city: string): Promise<TrendsAnalysis> {
  const cat = String(category || '').trim()
  const c = String(city || '').trim()

  if (!cat || !c) {
    return {
      trend: 'stable',
      growthPercentage: null,
      peakMonths: [],
      bestContactTime: 'Dati insufficienti',
      marketOpportunity: '',
      insights: [],
      source: 'error',
    }
  }

  // Bypass the legacy marketing pytrends backend completely for CKB Insurance
  // Instead, we go directly to the GPT specialized fallback.

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      trend: 'stable',
      growthPercentage: null,
      peakMonths: [],
      bestContactTime: '',
      marketOpportunity: '',
      insights: [],
      source: 'error',
    }
  }

  try {
    const prompt = `Sei un esperto di Risk Management e Broker Assicurativo in Italia.
Analizza il settore "${cat}" nella zona di "${c}".

REGOLE IMPORTANTI:
- NON inventare percentuali, numeri o statistiche. Se non conosci un dato preciso, NON scriverlo.
- Fornisci SOLO insight qualitativi e fattuali basati sulla tua conoscenza della normativa e del settore.
- Ogni insight deve essere una frase utile per un broker, senza numeri inventati.
- Indica la polizza più importante da proporre e il rischio principale non coperto nella maggior parte delle imprese di questo settore.

Rispondi SOLO con JSON:
{
  "trend": "growing|stable|declining",
  "growthPercentage": null,
  "peakMonths": [],
  "bestContactTime": "Nome della polizza chiave raccomandata per il settore",
  "marketOpportunity": "Il rischio principale spesso non coperto dalle imprese del settore (senza inventare percentuali)",
  "insights": [
    "Insight qualitativo 1: un rischio concreto del settore o normativa rilevante",
    "Insight qualitativo 2: una tendenza o obbligo normativo recente",
    "Insight qualitativo 3: un'opportunità commerciale per il broker"
  ]
}
Solo JSON, nessun testo aggiuntivo.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.1,
      }),
    })

    const data = (await res.json()) as any
    const content = data?.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

    return {
      trend: parsed?.trend || 'stable',
      growthPercentage: parsed?.growthPercentage ?? null,
      peakMonths: parsed?.peakMonths || [],
      bestContactTime: parsed?.bestContactTime || '',
      marketOpportunity: parsed?.marketOpportunity || '',
      insights: parsed?.insights || [],
      source: 'gpt',
    }
  } catch {
    return {
      trend: 'stable',
      growthPercentage: null,
      peakMonths: [],
      bestContactTime: '',
      marketOpportunity: '',
      insights: [],
      source: 'error',
    }
  }
}
