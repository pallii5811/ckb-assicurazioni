// Quick test: solo BARBARESCHI per verificare il fix placeholder
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
  const r = await callApi('/api/person-lookup', { query: 'BARBARESCHI VALENTINA libero professionista torino' })
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`Tempo: ${dt}s`)
  console.log('Result:')
  for (const [k, v] of Object.entries(r)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    let s = typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120)
    console.log(`  ${k}: ${s}`)
  }
  // Verifica esplicita
  if (r.linkedin) {
    if (/[xyz]{4,}/i.test(r.linkedin)) {
      console.log('\n❌ FAIL: LinkedIn contiene ancora placeholder xxxx!')
      process.exit(1)
    } else {
      console.log('\n✓ LinkedIn sembra valido')
    }
  } else {
    console.log('\n✓ LinkedIn correttamente RIMOSSO (era placeholder)')
  }
}

main().catch(e => { console.error(e); process.exit(2) })
