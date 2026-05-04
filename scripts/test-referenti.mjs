// Test referenti reali estratti dai test azienda precedenti.
// Run: node scripts/test-referenti.mjs

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

function dump(label, r) {
  console.log(`\n  ── ${label} ──`)
  if (!r || typeof r !== 'object') {
    console.log(`    [risposta non-oggetto]: ${JSON.stringify(r).slice(0,120)}`)
    return
  }
  const keys = ['error','nome_completo','nome','cognome','azienda','ruolo','professione',
    'telefono','telefono_fonte','cellulare','email','email_fonte','pec',
    'sito','linkedin','instagram','facebook','twitter','twitter_x',
    'sede','citta','provincia','indirizzo',
    'eta','data_nascita','luogo_nascita','stato_civile',
    'partita_iva','codice_fiscale',
    'esperienze_precedenti','formazione','competenze','anni_esperienza',
    'cariche_societarie','numero_aziende_attive','storico_imprenditoriale',
    'rischi_professionali','polizze_consigliate','priorita_commerciale',
    'fonti','warnings']
  let printed = 0
  for (const k of keys) {
    const v = r[k]
    if (v == null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    let s = typeof v === 'object' ? JSON.stringify(v).slice(0, 150) : String(v).slice(0, 150)
    console.log(`    ${k}: ${s}`)
    printed++
  }
  if (printed === 0) console.log('    (vuoto)')
}

async function testRef(label, query) {
  console.log(`\n══════════════════════════════════════════════`)
  console.log(`REFERENTE: ${label}  →  query="${query}"`)
  console.log(`══════════════════════════════════════════════`)
  const t0 = Date.now()
  try {
    const r = await callApi('/api/person-lookup', { query })
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  [tempo: ${dt}s]`)
    dump(label, r)
    return r
  } catch (e) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  ERRORE [${dt}s]: ${e?.message || e}`)
    return null
  }
}

async function main() {
  console.log(`Test referenti → ${BASE}`)

  // Referente reale 1: Maurizia Rebola titolare BARNEY'S SRL Torino (trovato nel test prec.)
  await testRef(
    'Maurizia Rebola (referente BARNEY\'S SRL torino)',
    "Maurizia Rebola BARNEY'S SRL torino"
  )

  // Libero professionista 2: Vittorio Barosio avvocato torino (già testato, riprova)
  await testRef(
    'Vittorio Barosio (avvocato torino)',
    'Vittorio Barosio avvocato torino'
  )

  // Test omonimo: nome generico SENZA ancore — il sistema deve essere conservativo
  await testRef(
    'Maurizia Rebola SENZA ancore (test anti-omonimo)',
    'Maurizia Rebola'
  )

  console.log(`\n──────── DONE ────────`)
}

main().catch(e => { console.error(e); process.exit(1) })
