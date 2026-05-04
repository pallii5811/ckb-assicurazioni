const BASE = 'http://localhost:3000'

async function callApi(path, body, timeoutMs = 290000) {
  const ctrl = new AbortController()
  const tt = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    return await r.json()
  } finally { clearTimeout(tt) }
}

async function main() {
  const t0 = Date.now()
  const r = await callApi('/api/person-lookup', { query: 'Vittorio Barosio avvocato torino' })
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`Tempo: ${dt}s`)
  if (r.error) {
    console.log(`❌ ERROR ancora presente: ${r.error}`)
    process.exit(1)
  }
  console.log('✓ Nessun errore. Dati:')
  for (const [k, v] of Object.entries(r)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    let s = typeof v === 'object' ? JSON.stringify(v).slice(0, 150) : String(v).slice(0, 150)
    console.log(`  ${k}: ${s}`)
  }
}

main().catch(e => { console.error(e); process.exit(2) })
