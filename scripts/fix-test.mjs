// Test post-fix: ARCHIBUZZ + Barosio per verificare derivazione sito + scrape ufficiocamerale
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

function dumpAll(label, r) {
  console.log(`\n══════ ${label} ══════`)
  if (!r || typeof r !== 'object') { console.log('(non-object)'); return }
  for (const [k, v] of Object.entries(r)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    let s = typeof v === 'object' ? JSON.stringify(v).slice(0, 130) : String(v).slice(0, 130)
    console.log(`  ${k}: ${s}`)
  }
}

async function main() {
  console.log(`Fix verification → ${BASE}`)

  // Health check
  try {
    const h = await fetch(`${BASE}/api/lead-registry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"_ping":true}', signal: AbortSignal.timeout(15000) })
    if (h.status >= 500) throw new Error(`status=${h.status}`)
  } catch (e) {
    console.error(`Server NON raggiungibile: ${e?.message || e}`)
    process.exit(2)
  }

  // 1) ARCHIBUZZ P.IVA pura (era il caso peggiore)
  let t0 = Date.now()
  const archi = await callApi('/api/company-lookup', { query: '10707250014' })
  console.log(`\n[1] ARCHIBUZZ P.IVA tempo: ${((Date.now()-t0)/1000).toFixed(1)}s`)
  dumpAll('ARCHIBUZZ (P.IVA 10707250014)', archi)

  // VERIFICHE chiave
  console.log('\n  CHECK ARCHIBUZZ:')
  console.log(`    sito presente?      ${!!archi.sito} (${archi.sito || 'VUOTO'})`)
  console.log(`    PEC presente?       ${!!archi.pec} (${archi.pec || 'VUOTO'})`)
  console.log(`    REA presente?       ${!!archi.rea} (${archi.rea || 'VUOTO'})`)
  console.log(`    titolare presente?  ${!!archi.titolare} (${archi.titolare || 'VUOTO'})`)
  console.log(`    LinkedIn presente?  ${!!archi.linkedin} (${archi.linkedin || 'VUOTO'})`)

  // 2) BAROSIO avvocato
  t0 = Date.now()
  const baro = await callApi('/api/person-lookup', { query: 'Vittorio Barosio avvocato torino' })
  console.log(`\n[2] BAROSIO tempo: ${((Date.now()-t0)/1000).toFixed(1)}s`)
  dumpAll('BAROSIO Vittorio (avvocato torino)', baro)

  console.log('\n  CHECK BAROSIO:')
  console.log(`    sito presente?      ${!!baro.sito} (${baro.sito || 'VUOTO'})`)
  console.log(`    indirizzo presente? ${!!baro.indirizzo} (${baro.indirizzo || 'VUOTO'})`)

  console.log('\n──── FINE ────')
}

main().catch(e => { console.error(e); process.exit(1) })
