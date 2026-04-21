/**
 * Gemini 2.5 Flash con Google Search grounding.
 * Usato per estrazione di dati camerali accurati (fatturato, dipendenti, titolare, ecc.).
 * Fallback: se Gemini fallisce, il chiamante deve usare Tavily+GPT come prima.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/grounding
 */

// Modelli da provare in ordine:
// 1. gemini-2.5-flash-lite → free tier più generoso per grounding, accurato per nostro caso
// 2. gemini-2.5-flash → più potente ma spesso sovraccarico (503) sul free tier
// NOTA: 2.5-pro, flash-latest, 2.0-flash hanno quota free ridotta per grounding (429 istantaneo)
const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

function getApiKey(): string {
  return process.env.GEMINI_API_KEY || ''
}

export function isGeminiEnabled(): boolean {
  return !!getApiKey() && process.env.USE_GEMINI_GROUNDING !== 'false'
}

/**
 * Query Gemini with Google Search grounding and expect JSON response.
 * Returns null if anything fails (caller should fallback to Tavily).
 */
export async function geminiGroundedExtract<T = Record<string, any>>(
  prompt: string,
  opts?: { timeoutMs?: number }
): Promise<T | null> {
  if (!isGeminiEnabled()) return null

  const timeoutMs = opts?.timeoutMs ?? 25000
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1, // low for factual extraction
      maxOutputTokens: 2048,
    },
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // For each model: try up to N times with exponential backoff on 503, then move to next model on definitive failure.
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i]
    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${getApiKey()}`
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          console.log(`[GEMINI ${model}] attempt ${attempt}/${MAX_ATTEMPTS} HTTP ${res.status}: ${errText.slice(0, 150)}`)
          // 503 = overload → retry with backoff
          if (res.status === 503 && attempt < MAX_ATTEMPTS) {
            await sleep(1000 * attempt) // 1s, 2s backoff
            continue
          }
          // 429 = quota on this model → move to next model immediately
          // 4xx/5xx others = hard fail, move to next model
          break // exit attempt loop, try next model
        }

        const data = await res.json() as any
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        if (!text) {
          console.log(`[GEMINI ${model}] Empty response`)
          break
        }

        // Extract JSON from response (may be wrapped in ```json ... ```)
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/)
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text
        try {
          const parsed = JSON.parse(jsonStr) as T
          const sources = data?.candidates?.[0]?.groundingMetadata?.groundingChunks
            ?.map((c: any) => c?.web?.uri || c?.web?.title)
            ?.filter(Boolean) || []
          console.log(`[GEMINI ${model}] OK${sources.length ? ` — fonti: ${sources.slice(0, 3).join(', ')}` : ''}`)
          return parsed
        } catch {
          console.log(`[GEMINI ${model}] JSON parse failed: ${text.slice(0, 200)}`)
          return null
        }
      } catch (e: any) {
        console.log(`[GEMINI ${model}] attempt ${attempt}/${MAX_ATTEMPTS} error: ${e?.message || e}`)
        if (attempt < MAX_ATTEMPTS) { await sleep(1000 * attempt); continue }
        break
      }
    }
  }
  return null
}

/**
 * Specialized: extract camerale/financial data for an Italian company.
 * Uses Google Search grounding to find ufficiocamerale.it, reportaziende.it, bilanci ufficiali.
 */
export async function geminiExtractCompanyData(params: {
  companyName: string
  partitaIva?: string
  city?: string
}): Promise<{
  ragione_sociale?: string | null
  partita_iva?: string | null
  codice_fiscale?: string | null
  codice_ateco?: string | null
  descrizione_ateco?: string | null
  forma_giuridica?: string | null
  sede_legale?: string | null
  pec?: string | null
  capitale_sociale?: string | null
  data_costituzione?: string | null
  fatturato?: string | null
  utile_netto?: string | null
  totale_attivo?: string | null
  dipendenti?: string | null
  fatturato_anno?: string | null
  titolare?: string | null
  ruolo_titolare?: string | null
  telefono?: string | null
  email?: string | null
  sito_web?: string | null
  fonti?: string[] | null
} | null> {
  const { companyName, partitaIva, city } = params
  const idLine = partitaIva ? `P.IVA ${partitaIva}` : (city ? `con sede a ${city}` : '')

  const prompt = `Cerca su Google tutti i dati disponibili sull'azienda italiana "${companyName}"${idLine ? ' (' + idLine + ')' : ''}.

Fonti da consultare: ufficiocamerale.it, reportaziende.it, registroimprese.it, companyreports.it, bilanci ufficiali, sito aziendale, Google Knowledge Graph.

LINEE GUIDA:
- Estrai tutti i dati che riesci a trovare. Se un campo non lo trovi, metti null.
- NON inventare numeri. Se non sai, metti null.
- Importi in euro come NUMERO INTERO (es. 70165 per €70.165 — niente punti, virgole o simboli €).
- Dipendenti come stringa (es. "38" o "20-49" o "0").
- Titolare = rappresentante legale/amministratore unico/AD dalla visura camerale (se trovato).
- Data costituzione formato "YYYY".
- ATECO formato "XX.XX.XX" (es. "62.01.00").

Rispondi SOLO con oggetto JSON valido (usa null per campi mancanti):
{
  "ragione_sociale": "nome completo dell'azienda",
  "partita_iva": "11 cifre",
  "codice_fiscale": "CF azienda se diverso dalla P.IVA",
  "codice_ateco": "XX.XX.XX",
  "descrizione_ateco": "descrizione attività",
  "forma_giuridica": "SRL / SPA / SAS / SNC / ecc",
  "sede_legale": "indirizzo completo con CAP e città",
  "pec": "indirizzo PEC",
  "capitale_sociale": "importo in euro come numero intero",
  "data_costituzione": "YYYY",
  "fatturato": "ultimo fatturato disponibile in euro come numero intero",
  "utile_netto": "ultimo utile netto in euro come numero intero",
  "totale_attivo": "totale attivo bilancio in euro come numero intero",
  "dipendenti": "numero dipendenti come stringa",
  "fatturato_anno": "anno del fatturato (es. 2024)",
  "titolare": "nome e cognome del rappresentante legale camerale",
  "ruolo_titolare": "Rappresentante Legale / Amministratore Unico / Amministratore Delegato",
  "telefono": "telefono ufficiale azienda",
  "email": "email ufficiale azienda (NON PEC)",
  "sito_web": "URL sito web ufficiale",
  "fonti": ["url delle fonti usate"]
}`

  return await geminiGroundedExtract(prompt, { timeoutMs: 25000 })
}
