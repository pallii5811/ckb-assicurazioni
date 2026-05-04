/**
 * Test LIVE Insurance Radar su aziende REALI (Torino).
 *
 * Approccio:
 *   - Chiama /api/lead-registry (no auth) per anagrafica + bilancio
 *   - Usa direttamente i moduli interni per i calcoli (premium-extractor,
 *     workforce, seismic-risk, cauzioni)
 *   - Stampa un report comparativo per 6 aziende eterogenee
 *
 * Uso:  node scripts/insurance-radar-live.test.mjs
 *       (richiede dev server attivo su localhost:3000)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Carica .env.local manualmente ───
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) {
      const v = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  }
}

const BASE = process.env.BASE_URL || 'http://localhost:3000'

// ─── Aziende selezionate dalla lista (settori eterogenei attesi) ───
const COMPANIES = [
  { piva: '12543200013', name: 'BUILD UP SRL', citta: 'Torino', address: 'via BERNARDINO TELESIO 69, Torino', expected: 'costruzioni' },
  { piva: '00893890012', name: 'BUS COMPANY SRL', citta: 'Torino', address: 'VIA SEBASTIANO CABOTO 35, Torino', expected: 'trasporti' },
  { piva: '11619890012', name: 'BUSINESS INFORMATION TECHNOLOGY 4K', citta: 'Torino', address: 'CORSO LUIGI EINAUDI 55 D, Torino', expected: 'IT/servizi' },
  { piva: '06294960015', name: 'BUZZI, NOTARO & ANTONIELLI D\'OULX S.P.A.', citta: 'Torino', address: 'CORSO VITTORIO EMANUELE II, 6, Torino', expected: 'studio professionale' },
  { piva: '11375970016', name: 'C2R ENERGY CONSULTING S.R.L.', citta: 'Torino', address: 'VIA DEI MILLE 23B, Torino', expected: 'consulenza energia' },
  { piva: '08466090019', name: 'C.I.T. CENTRO INFISSI TORINO S.R.L.', citta: 'Torino', address: 'CORSO VINZAGLIO 12 BIS, Torino', expected: 'infissi/edilizia' },
]

async function callLeadRegistry(name, citta) {
  try {
    const res = await fetch(`${BASE}/api/lead-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          nome: name,
          azienda: name,
          citta,
          sito: '',
          indirizzo: '',
          categoria: '',
        },
        _skipPersonEnrichment: true,
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return await res.json()
  } catch (e) {
    return { error: e.message }
  }
}

// ─── Importa i moduli interni (server-side TS) via tsx ───
async function loadModules() {
  // dynamic import: tsx li transpila al volo
  const balance = await import('../src/lib/insurance/balance-sheet.ts')
  const sectors = await import('../src/lib/insurance/sector-benchmarks.ts')
  const premium = await import('../src/lib/insurance/premium-extractor.ts')
  const workforce = await import('../src/lib/insurance/workforce.ts')
  const seismic = await import('../src/lib/insurance/seismic-risk.ts')
  return { balance, sectors, premium, workforce, seismic }
}

function fmt(n) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

async function analyzeCompany(company, mods) {
  const start = Date.now()
  console.log('\n' + '═'.repeat(78))
  console.log(`${company.name}  —  P.IVA ${company.piva}`)
  console.log(`Settore atteso: ${company.expected}  |  Città: ${company.citta}`)
  console.log('═'.repeat(78))

  // ── 1. Anagrafica via /api/lead-registry ──
  const lr = await callLeadRegistry(company.name, company.citta)
  if (lr?.error) {
    console.log(`  ❌ lead-registry: ${lr.error}`)
    return
  }

  console.log(`  Lead-registry: ${lr.found ? '✅ found' : '⚠️ not found'}`)
  if (lr.found) {
    console.log(`    • Ragione sociale: ${lr.ragione_sociale || '—'}`)
    console.log(`    • P.IVA risolta:   ${lr.partita_iva || '—'}  ${lr.partita_iva === company.piva ? '✓ match' : '⚠ NON match con quella fornita'}`)
    console.log(`    • ATECO:           ${lr.codice_ateco || '—'}  ${lr.descrizione_ateco ? `(${lr.descrizione_ateco})` : ''}`)
    console.log(`    • Fatturato:       ${lr.fatturato ? fmt(parseFloat(String(lr.fatturato))) : '—'}  (anno ${lr.fatturato_anno || '—'})`)
    console.log(`    • Dipendenti:      ${lr.dipendenti || '—'}`)
    console.log(`    • Sede:            ${lr.sede_legale || '—'}`)
  }

  // ── 2. Costruisci ResolvedCompanyIdentity manualmente (con fallback Tavily ATECO) ──
  const identity = {
    ragioneSociale: lr.ragione_sociale || company.name,
    piva: (lr.partita_iva || company.piva || '').replace(/\D/g, ''),
    ateco: lr.codice_ateco,
    atecoDescription: lr.descrizione_ateco,
    sede_legale: lr.sede_legale,
    sourcesUsed: lr.found ? ['lead-registry'] : [],
    atecoResolved: !!lr.codice_ateco,
  }

  // Fallback Tavily se ATECO mancante
  if (!identity.atecoResolved && process.env.TAVILY_API_KEY) {
    console.log(`  🔎 ATECO mancante: provo fallback Tavily...`)
    try {
      const tav = await mods.balance.fetchAtecoFromTavily(identity.ragioneSociale, identity.piva)
      if (tav) {
        identity.ateco = tav.code
        identity.atecoDescription = identity.atecoDescription || tav.description
        identity.atecoResolved = true
        identity.sourcesUsed.push('tavily-ateco-fallback')
        console.log(`     ✓ ATECO trovato via Tavily: ${tav.code} (fonte: ${tav.source})`)
      } else {
        console.log(`     ✗ ATECO non trovato neanche via Tavily`)
      }
    } catch (e) {
      console.log(`     ⚠ Tavily error: ${e.message}`)
    }
  }

  // ── 3. Costruisci BalanceSheetData dai dati lead-registry ──
  const lrYearMatch = lr.fatturato_anno ? parseInt(String(lr.fatturato_anno), 10) : null
  const balanceLatest = lrYearMatch && lrYearMatch >= 2010 ? mods.balance.leadRegistryToBalanceYear(lr) : null

  // Apply sanitize
  let dataQualityWarnings = []
  let cleanLatest = balanceLatest
  if (balanceLatest) {
    const sanitized = mods.balance.sanitizeBalanceYear(balanceLatest)
    cleanLatest = sanitized.sanitized
    dataQualityWarnings = sanitized.warnings
  }
  const balanceData = {
    years: cleanLatest ? [cleanLatest] : [],
    latest: cleanLatest,
    source: lr.found ? 'lead-registry' : 'no-data',
    fetchedAt: new Date().toISOString(),
    dataQualityWarnings,
  }

  // ── 4. Footprint ──
  const fp = mods.premium.buildInsuranceFootprint({
    piva: identity.piva,
    ragioneSociale: identity.ragioneSociale,
    ateco: identity.ateco,
    atecoDescription: identity.atecoDescription,
    citta: company.citta,
    balance: balanceData,
    sourcesUsed: identity.sourcesUsed,
    fetchStartTs: start,
  })

  console.log(`\n  📊 PREMI ASSICURATIVI`)
  console.log(`    • Settore: ${fp.sectorMacro || '—'}`)
  if (fp.premiums.declared) console.log(`    • Dichiarato:    ${fmt(fp.premiums.declared.value)} (${fp.premiums.declared.year || '?'})`)
  if (fp.premiums.estimated) console.log(`    • Stimato:       ${fmt(fp.premiums.estimated.min)} – ${fmt(fp.premiums.estimated.max)}`)
  if (fp.premiums.fairMarket) console.log(`    • Fair Market:   ${fmt(fp.premiums.fairMarket.min)} – ${fmt(fp.premiums.fairMarket.max)}`)
  if (fp.premiums.savingOpportunity) console.log(`    • Saving:        ${fmt(fp.premiums.savingOpportunity.min)} – ${fmt(fp.premiums.savingOpportunity.max)}`)

  console.log(`\n  💼 ASSET ASSICURABILI`)
  if (fp.assets.tangibleAssetsValue) console.log(`    • Immobilizzazioni materiali: ${fmt(fp.assets.tangibleAssetsValue.value)}`)
  else console.log(`    • Immobilizzazioni materiali: — (non in bilancio o scartato dal sanitize)`)
  if (fp.assets.employees) console.log(`    • Dipendenti: ${fp.assets.employees.value}`)
  if (fp.assets.payroll) console.log(`    • Costo personale: ${fmt(fp.assets.payroll.value)}`)
  if (fp.assets.estimatedVehicles) console.log(`    • Veicoli stimati: ${fp.assets.estimatedVehicles.min}–${fp.assets.estimatedVehicles.max}`)

  // ── 5. Workforce ──
  const wf = mods.workforce.analyzeWorkforce({
    bs: cleanLatest,
    ateco: identity.ateco,
    source: balanceData.source,
  })
  console.log(`\n  👥 WORKFORCE`)
  if (wf.employees) console.log(`    • Dipendenti: ${wf.employees.value}`)
  if (wf.payroll) console.log(`    • Costo personale: ${fmt(wf.payroll.value)}`)
  if (wf.avgCostPerEmployee) console.log(`    • Costo medio/dip: ${fmt(wf.avgCostPerEmployee.value)}`)
  if (wf.tfrAccrual) console.log(`    • TFR maturato/anno: ${fmt(wf.tfrAccrual.value)}`)
  if (wf.probableCCNL?.[0]) console.log(`    • CCNL probabile: ${wf.probableCCNL[0].code}`)
  if (wf.welfareOpportunities?.length > 0) {
    console.log(`    • Top 3 welfare:`)
    for (const w of wf.welfareOpportunities.slice(0, 3)) {
      console.log(`        - ${w.ramo}: ${fmt(w.totalAnnualPremium.min)} – ${fmt(w.totalAnnualPremium.max)}/anno  [P${w.priority}]`)
    }
  }

  // ── 6. Sismic ──
  const seismic = mods.seismic.analyzeSeismicRisk({ address: company.address })
  console.log(`\n  🌍 RISCHIO SISMICO`)
  if (seismic.seismic) {
    console.log(`    • Zona ${seismic.seismic.zone} (${seismic.seismic.label})`)
    console.log(`    • Score globale: ${seismic.globalScore}/100`)
    if (seismic.premiumImpact) console.log(`    • Impatto premio: ${seismic.premiumImpact.percentMin}% / ${seismic.premiumImpact.percentMax}%`)
  } else {
    console.log(`    • non risolto (indirizzo non parsato)`)
  }

  // ── 7. Warnings ──
  if (fp.meta.warnings.length > 0) {
    console.log(`\n  ⚠️  WARNINGS DI QUALITÀ DATI`)
    for (const w of fp.meta.warnings) {
      console.log(`    • ${w.length > 200 ? w.slice(0, 197) + '...' : w}`)
    }
  } else {
    console.log(`\n  ✅ Nessun warning di qualità dati`)
  }

  // ── 8. Top opportunità commerciali ──
  if (fp.opportunities?.length > 0) {
    console.log(`\n  🎯 TOP 3 OPPORTUNITÀ COMMERCIALI`)
    for (const op of fp.opportunities.slice(0, 3)) {
      console.log(`    • ${op.ramo}: ${fmt(op.estimatedAnnualPremium.min)} – ${fmt(op.estimatedAnnualPremium.max)}  [P${op.priority}]`)
    }
  }

  console.log(`\n  ⏱  durata: ${Date.now() - start}ms`)
}

// ─────────────────────────────────────────────────────────────────────────────

;(async () => {
  console.log('Insurance Radar — Test LIVE su aziende reali')
  console.log(`BASE: ${BASE}`)
  console.log(`Tavily key: ${process.env.TAVILY_API_KEY ? '✓ configurata' : '✗ MANCANTE'}`)

  const mods = await loadModules()

  for (const company of COMPANIES) {
    try {
      await analyzeCompany(company, mods)
    } catch (e) {
      console.log(`\n❌ Errore su ${company.name}: ${e.message}`)
      console.log(e.stack?.slice(0, 500))
    }
  }

  console.log('\n' + '═'.repeat(78))
  console.log('Fine test.')
})()
