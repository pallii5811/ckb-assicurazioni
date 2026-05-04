// Test esteso: aziende reali da amministrazionicomunali.it (Torino)
// Lancia company-lookup + person-lookup con ancore corrette e mostra tutti i campi.
// Run: node scripts/extended-test.mjs

const BASE = process.env.BASE_URL || 'http://localhost:3000'

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

const COMPANY_KEYS = [
  'error', 'ragione_sociale', 'nome_commerciale', 'nome', 'partita_iva', 'codice_fiscale',
  'rea', 'codice_ateco', 'descrizione_ateco',
  'fatturato', 'fatturato_anno', 'utile_netto', 'totale_attivo', 'dipendenti',
  'forma_giuridica', 'data_costituzione', 'capitale_sociale', 'stato_attivita',
  'sede_legale', 'citta', 'provincia', 'cap', 'pec', 'telefono', 'email',
  'sito', 'sito_web', 'indirizzo', 'categoria',
  'titolare', 'ruolo_titolare', 'linkedin_titolare',
  'linkedin', 'facebook', 'instagram', 'twitter', 'youtube',
  'fonti', 'warnings',
]

const PERSON_KEYS = [
  'error', 'nome_completo', 'azienda', 'ruolo', 'professione',
  'telefono', 'telefono_fonte', 'cellulare', 'email', 'pec',
  'sito', 'linkedin', 'instagram', 'facebook', 'twitter',
  'sede', 'citta', 'provincia', 'indirizzo',
  'eta', 'data_nascita', 'luogo_nascita',
  'partita_iva', 'codice_fiscale',
  'fonti', 'warnings',
]

function dump(label, r, keys) {
  console.log(`\n  ── ${label} ──`)
  if (!r || typeof r !== 'object') {
    console.log(`    [risposta non-oggetto]: ${JSON.stringify(r).slice(0,120)}`)
    return
  }
  let printed = 0
  for (const k of keys) {
    const v = r[k]
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    let s
    if (typeof v === 'object') s = JSON.stringify(v).slice(0, 120)
    else s = String(v).slice(0, 120)
    console.log(`    ${k}: ${s}`)
    printed++
  }
  if (printed === 0) console.log(`    (vuoto)`)
}

async function testCompany(label, query) {
  console.log(`\n══════════════════════════════════════════════`)
  console.log(`COMPANY: ${label}  →  query="${query}"`)
  console.log(`══════════════════════════════════════════════`)
  const t0 = Date.now()
  try {
    const r = await callApi('/api/company-lookup', { query })
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  [tempo: ${dt}s]`)
    dump(label, r, COMPANY_KEYS)
    return r
  } catch (e) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  ERRORE [${dt}s]: ${e?.message || e}`)
    return null
  }
}

async function testPerson(label, body) {
  console.log(`\n══════════════════════════════════════════════`)
  console.log(`PERSON: ${label}  →  ${JSON.stringify(body)}`)
  console.log(`══════════════════════════════════════════════`)
  const t0 = Date.now()
  try {
    const r = await callApi('/api/person-lookup', body)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  [tempo: ${dt}s]`)
    dump(label, r, PERSON_KEYS)
    return r
  } catch (e) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  ERRORE [${dt}s]: ${e?.message || e}`)
    return null
  }
}

async function main() {
  console.log(`Extended test → ${BASE}`)

  // Health check
  try {
    const h = await fetch(`${BASE}/api/lead-registry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"_ping":true}', signal: AbortSignal.timeout(15000)
    })
    if (h.status >= 500) throw new Error(`status=${h.status}`)
  } catch (e) {
    console.error(`Server NON raggiungibile a ${BASE}:`, e?.message || e)
    process.exit(2)
  }

  // ────────────── AZIENDE (nome + città) ──────────────
  const arching = await testCompany('ARCHING (nome + città)', 'ARCHING SRL torino')

  // ────────────── AZIENDA (P.IVA pura) ──────────────
  const arciibuzz = await testCompany('ARCIIBUZZ (P.IVA pura)', '10707250014')

  // ────────────── AZIENDA piccola (nome + città) ──────────────
  const barneys = await testCompany('BARNEY\'S (nome + città)', "BARNEY'S SRL torino")

  // ────────────── REFERENTE: usa il titolare trovato dell'azienda ──────────────
  if (arching && arching.titolare) {
    await testPerson(
      `Referente di ARCHING (${arching.titolare})`,
      { query: `${arching.titolare} ARCHING SRL torino` }
    )
  } else {
    console.log('\n[SKIP REFERENTE] ARCHING non ha titolare individuato — salto person-lookup mirato')
  }

  // ────────────── LIBERO PROFESSIONISTA (nome + cognome + professione + città) ──────────────
  await testPerson(
    'BAROSIO VITTORIO (avvocato + città)',
    { query: 'BAROSIO VITTORIO avvocato torino' }
  )

  await testPerson(
    'BARBARESCHI VALENTINA (libero professionista torino)',
    { query: 'BARBARESCHI VALENTINA libero professionista torino' }
  )

  console.log(`\n──────── DONE ────────`)
}

main().catch(e => { console.error(e); process.exit(1) })
