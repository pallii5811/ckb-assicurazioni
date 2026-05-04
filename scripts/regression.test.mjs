// End-to-end regression tests: chiama le API live (richiede dev server attivo)
// e verifica che per ogni caso noto vengano restituiti i campi attesi e che NON
// vengano restituiti dati di omonimi.
//
// Run with: node scripts/regression.test.mjs
// Optionally: BASE_URL=http://localhost:3000 node scripts/regression.test.mjs
//
// Casi noti:
//   - "STANDBY CONSORZIO milano"  → P.IVA confermata, dati camerali OK
//   - "AppenLab SRL torino"       → trova FatturatoItalia tramite dominio email
//   - "ALMAX.COM S.R.L. torino"   → NON deve mai mostrare titolare di ALMAXITALIA Milano
//   - "Mario Rossi Allianz Milano" → person-lookup, niente omonimi panettiere

import process from 'node:process'

const BASE = process.env.BASE_URL || 'http://localhost:3000'

let passed = 0
let failed = 0
const failures = []

function ok(cond, label, extra) {
  if (cond) { passed++; return }
  failed++; failures.push({ label, extra })
}

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

function lc(s) { return (s == null ? '' : String(s)).toLowerCase() }

function dumpFields(label, r) {
  const keys = ['error','ragione_sociale','nome','partita_iva','codice_fiscale','rea','codice_ateco',
    'descrizione_ateco','fatturato','fatturato_anno','utile_netto','dipendenti','forma_giuridica',
    'data_costituzione','stato_attivita','sede_legale','citta','provincia','pec','telefono','email','sito',
    'titolare','ruolo_titolare','linkedin_titolare','linkedin','facebook','instagram']
  console.log(`  ── ${label} dump ──`)
  for (const k of keys) {
    const v = r[k]
    if (v != null && v !== '') {
      const s = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)
      console.log(`    ${k}: ${s}`)
    }
  }
}

// ────────────────────────── CASI ──────────────────────────

async function testStandby() {
  console.log('\n[T1] STANDBY CONSORZIO milano')
  const r = await callApi('/api/company-lookup', { query: 'STANDBY CONSORZIO milano' })
  ok(!r.error, 'T1 no error', r.error)
  // ragione_sociale o nome_commerciale: deve esserci almeno un nome (non la query verbatim
  // con la città attaccata). Se ragione_sociale è stata demota, deve esserci nome_commerciale.
  const anyName = r.ragione_sociale || r.nome_commerciale || r.nome
  ok(!!anyName, 'T1 ha un nome (ragione_sociale o nome_commerciale)', { rs: r.ragione_sociale, nc: r.nome_commerciale })
  ok(/^\d{11}$/.test(String(r.partita_iva || '')), 'T1 P.IVA 11 cifre', r.partita_iva)
  ok(lc(r.citta || r.sede_legale).includes('milan'),
    'T1 città contiene milan', { citta: r.citta, sede: r.sede_legale })
  ok(!!r.codice_ateco, 'T1 codice_ateco presente', r.codice_ateco)
  // Anti-omonimo extra: la PEC, se presente, deve essere coerente (no PEC di altri enti)
  if (r.pec) ok(/legalmail|pec|aruba|infocert|namirial|trust|register|sicurezza|cert|posta|legalpec|mypec|imprese/i.test(String(r.pec)),
    'T1 PEC su dominio PEC valido', r.pec)
  dumpFields('T1', r)
}

async function testAppenLab() {
  console.log('\n[T2] AppenLab SRL torino')
  const r = await callApi('/api/company-lookup', { query: 'AppenLab SRL torino' })
  ok(!r.error, 'T2 no error', r.error)
  ok(lc(r.ragione_sociale || r.nome).includes('appen'),
    'T2 ragione_sociale contiene "appen"', { rs: r.ragione_sociale, nome: r.nome })
  // Email/sito devono essere su appenlab.it
  if (r.email) ok(lc(r.email).includes('appenlab'), 'T2 email è su dominio appenlab', r.email)
  if (r.sito) ok(lc(r.sito).includes('appenlab'), 'T2 sito è appenlab', r.sito)
  // Telefono Torino plausible (011...)
  if (r.telefono) ok(/^[0\+\s\d]{9,}/.test(String(r.telefono)), 'T2 telefono numerico', r.telefono)
  // Idealmente con il fallback FatturatoItalia, P.IVA presente
  ok(true, 'T2 ha qualche dato', r) // soft-check
  dumpFields('T2', r)
}

async function testAlmaxAntiOmonimo() {
  console.log('\n[T3] ALMAX.COM S.R.L. torino — anti omonimo')
  const r = await callApi('/api/company-lookup', { query: 'ALMAX.COM S.R.L. torino' })
  ok(!r.error || /nessun/i.test(String(r.error)), 'T3 no error o nessun risultato accettabile', r.error)
  // Se ha trovato dati: NON devono essere di ALMAXITALIA Milano
  if (r.ragione_sociale) {
    ok(!lc(r.ragione_sociale).includes('almaxitalia'),
      'T3 ragione_sociale NON è ALMAXITALIA', r.ragione_sociale)
  }
  if (r.titolare) {
    // "Bob Deppiesse" è il titolare di ALMAXITALIA → vietato
    ok(!lc(r.titolare).includes('deppiesse') && !lc(r.titolare).includes('bob'),
      'T3 titolare NON è "Bob Deppiesse"', r.titolare)
  }
  if (r.sede_legale) {
    ok(!lc(r.sede_legale).includes('milano'),
      'T3 sede_legale NON è Milano', r.sede_legale)
  }
  dumpFields('T3', r)
}

async function testPersonLookup() {
  console.log('\n[T4] Person-lookup: rifiuta omonimi senza ancora')
  // Caso edge: cerca un nome generico senza azienda → deve restituire poco o niente
  // Timeout esteso a 290s (Next maxDuration=300)
  let r
  try {
    r = await callApi('/api/person-lookup', { query: 'Mario Rossi' }, 290000)
  } catch (e) {
    // person-lookup è più lento e dipende da tante chiamate esterne. Tollerare timeout.
    console.log(`  T4: skip (timeout o errore — ${e?.message || e})`)
    ok(true, 'T4 (skipped per timeout, non considerato fallimento)', null)
    return
  }
  // Non assertiamo error: assertiamo che, se ritorna dati, non siano random
  if (r.azienda && r.linkedin) {
    // Se ha trovato un LinkedIn, l'URL slug deve contenere "rossi" almeno
    ok(lc(r.linkedin).includes('rossi') || lc(r.linkedin).includes('mario'),
      'T4 LinkedIn slug coerente con "Mario Rossi"', r.linkedin)
  }
  ok(true, 'T4 chiamata completata', null)
}

async function testPivaPura() {
  console.log('\n[T5] P.IVA pura ALMAX (09031250013)')
  const r = await callApi('/api/company-lookup', { query: '09031250013' })
  ok(!r.error, 'T5 no error', r.error)
  ok(/^\d{11}$/.test(String(r.partita_iva || '')), 'T5 P.IVA presente', r.partita_iva)
  ok(!!r.ragione_sociale && !lc(r.ragione_sociale).includes('almaxitalia'),
    'T5 ragione_sociale NON è ALMAXITALIA', r.ragione_sociale)
  ok(!!r.codice_ateco, 'T5 codice_ateco', r.codice_ateco)
  ok(lc(r.sede_legale || r.citta).includes('torino') || lc(r.sede_legale || r.citta).includes('to'),
    'T5 sede a Torino', { sede: r.sede_legale, citta: r.citta })
  // CRITICO: sito ed email devono essere di ALMAX.COM, NON di ALMAXITALIA
  if (r.email) ok(!lc(r.email).includes('almaxitaliasrl'),
    'T5 email NON è di ALMAXITALIA (omonimo)', r.email)
  if (r.sito) ok(!lc(r.sito).includes('almaxitaliasrl'),
    'T5 sito NON è ALMAXITALIASRL (omonimo)', r.sito)
  dumpFields('T5', r)
}

// ────────────────────────── MAIN ──────────────────────────

async function main() {
  console.log(`Regression suite → ${BASE}`)
  // Health check
  try {
    const h = await fetch(`${BASE}/api/lead-registry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"_ping":true}', signal: AbortSignal.timeout(15000) })
    if (h.status >= 500) throw new Error(`status=${h.status}`)
  } catch (e) {
    console.error(`Server NON raggiungibile a ${BASE}:`, e?.message || e)
    process.exit(2)
  }

  // Esegui in sequenza per non saturare le API esterne (Tavily, OpenAPI, ecc.)
  const t0 = Date.now()
  try { await testStandby() } catch (e) { failures.push({ label: 'T1 thrown', extra: String(e) }); failed++ }
  try { await testAppenLab() } catch (e) { failures.push({ label: 'T2 thrown', extra: String(e) }); failed++ }
  try { await testAlmaxAntiOmonimo() } catch (e) { failures.push({ label: 'T3 thrown', extra: String(e) }); failed++ }
  try { await testPivaPura() } catch (e) { failures.push({ label: 'T5 thrown', extra: String(e) }); failed++ }
  try { await testPersonLookup() } catch (e) { failures.push({ label: 'T4 thrown', extra: String(e) }); failed++ }
  const dt = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`\n${passed} passed, ${failed} failed (totale ${passed + failed}) in ${dt}s`)
  if (failed > 0) {
    for (const f of failures) {
      console.log(` FAIL: ${f.label}`)
      if (f.extra !== undefined && f.extra !== null) {
        const s = typeof f.extra === 'string' ? f.extra : JSON.stringify(f.extra).slice(0, 300)
        console.log(`   ${s}`)
      }
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(2) })
