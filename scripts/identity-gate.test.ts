// @ts-nocheck
// Unit tests for identity-gate.ts
// Run with: npx tsx scripts/identity-gate.test.ts
//
// Pure-function tests, no network/I/O. Verify che il gate accetti i match veri
// e blocchi gli omonimi sui casi noti che ci hanno dato problemi.

import {
  normalizeDomain, normalizeCity, companyTokens, personTokens, extractPiva,
  pivaEquals, scoreCompanyMatch, scorePersonMatch, isCompanyMatch, isPersonMatch,
  safeMergeCompany, safeMergePerson, applyPatch,
} from '../src/lib/identity-gate'

let passed = 0
let failed = 0
const failures = []

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failed++; failures.push({ label, expected: e, actual: a })
}

function ge(actual, threshold, label) {
  if (actual >= threshold) { passed++; return }
  failed++; failures.push({ label, expected: `>= ${threshold}`, actual })
}

function lt(actual, threshold, label) {
  if (actual < threshold) { passed++; return }
  failed++; failures.push({ label, expected: `< ${threshold}`, actual })
}

// ───────────────────────────── HELPERS ─────────────────────────────

eq(normalizeDomain('https://www.appenlab.it/contatti'), 'appenlab.it', 'normalizeDomain url')
eq(normalizeDomain('info@appenlab.it'), 'appenlab.it', 'normalizeDomain email')
eq(normalizeDomain('LinkedIn.com/company/foo'), '', 'normalizeDomain skip social')
eq(normalizeDomain('fatturatoitalia.it/azienda/123'), '', 'normalizeDomain skip portal')
eq(normalizeDomain(''), '', 'normalizeDomain empty')

eq(normalizeCity('Torino'), 'torino', 'normalizeCity simple')
eq(normalizeCity('Reggio Emilia'), 'reggio emilia', 'normalizeCity multi')
eq(normalizeCity("L'Aquila"), "l'aquila", 'normalizeCity apostrofo')

eq(companyTokens('ALMAX.COM S.R.L.'), ['almax'], 'companyTokens almax')
eq(companyTokens('STANDBY CONSORZIO Soc. Coop.'), ['standby', 'consorzio'], 'companyTokens standby')
eq(companyTokens('Appen.lab S.r.l.'), ['appen', 'lab'], 'companyTokens appenlab')

eq(personTokens('Mario Rossi'), ['mario', 'rossi'], 'personTokens semplice')
eq(personTokens('Luca De Pierro'), ['luca', 'pierro'], 'personTokens con particella')

// Titoli professionali italiani — devono essere filtrati come stop words
eq(personTokens('Avv. Mario Rossi'), ['mario', 'rossi'], 'personTokens scarta Avv.')
eq(personTokens('Dott. Mario Rossi'), ['mario', 'rossi'], 'personTokens scarta Dott.')
eq(personTokens('Dott.ssa Anna Bianchi'), ['anna', 'bianchi'], 'personTokens scarta Dott.ssa')
eq(personTokens('Ing. Paolo Verdi'), ['paolo', 'verdi'], 'personTokens scarta Ing.')
eq(personTokens('Arch. Lucia Neri'), ['lucia', 'neri'], 'personTokens scarta Arch.')
eq(personTokens('Geom. Carlo Mori'), ['carlo', 'mori'], 'personTokens scarta Geom.')
eq(personTokens('Prof.ssa Maria Bianchi'), ['maria', 'bianchi'], 'personTokens scarta Prof.ssa')
eq(personTokens('Sig.ra Anna Verdi'), ['anna', 'verdi'], 'personTokens scarta Sig.ra')
eq(personTokens('Rag. Francesco Galli'), ['francesco', 'galli'], 'personTokens scarta Rag.')
eq(personTokens('Dr. John Smith'), ['john', 'smith'], 'personTokens scarta Dr.')
// Combinazioni multiple
eq(personTokens('Prof. Avv. Mario Rossi'), ['mario', 'rossi'], 'personTokens scarta titoli multipli')
eq(personTokens('Dott. Ing. Carlo Verdi'), ['carlo', 'verdi'], 'personTokens scarta Dott. + Ing.')

// Sanity: cognomi che CONTENGONO titoli ma non SONO titoli
eq(personTokens('Donatella Donati'), ['donatella', 'donati'], 'personTokens preserva cognomi tipo Donati (non confonde con "don")')
eq(personTokens('Massimo Profeta'), ['massimo', 'profeta'], 'personTokens preserva "Profeta" (non confonde con "prof")')
eq(personTokens('Roberto Avveduti'), ['roberto', 'avveduti'], 'personTokens preserva "Avveduti" (non confonde con "avv")')

// Edge case: il match person richiede ≥2 token. "Avv. Mario" da solo deve restare 'mario' = 1 token (non basta)
eq(personTokens('Avv. Mario'), ['mario'], 'personTokens "Avv. Mario" → solo "mario" (1 token)')

eq(extractPiva('P.IVA 12345678901 attiva'), '12345678901', 'extractPiva inline')
eq(extractPiva('codice fiscale 12345678901234 (16 cifre)'), null, 'extractPiva ignora 14 cifre')
eq(pivaEquals('12345678901', '12345678901'), true, 'pivaEquals true')
eq(pivaEquals('12345678901', '12345678902'), false, 'pivaEquals false')

// ─────────────────── COMPANY: match ALMAX (omonimo killer) ────────────

const almaxId = {
  ragione_sociale: 'ALMAX.COM S.R.L.',
  citta: 'Torino',
  provincia: 'TO',
}

// Caso vero: snippet che parla di ALMAX a Torino
{
  const ev = { source: 'Maps', trust: 'medium', text: 'ALMAX.COM SRL via Roma 12 Torino 10100 telefono', url: 'https://maps.google.com/?cid=123' }
  const r = scoreCompanyMatch(almaxId, ev)
  ge(r.score, 70, 'ALMAX Torino match true positive (Maps)')
}
// Caso omonimo: ALMAXITALIA SRL (Milano), titolare Bob Deppiesse
{
  const ev = { source: 'Tavily', trust: 'low', text: 'ALMAXITALIA SRL Milano - amministratore Bob Deppiesse - logistica', url: 'https://linkedin.com/in/bob-deppiesse' }
  const r = scoreCompanyMatch(almaxId, ev)
  lt(r.score, 70, 'ALMAX Torino blocca omonimo Milano (low-trust)')
  const m = isCompanyMatch(almaxId, ev)
  eq(m.action, 'skipped', 'ALMAX Torino isCompanyMatch skip omonimo')
}
// Caso P.IVA mismatch hard reject
{
  const idWithPiva = { ...almaxId, piva: '11111111111' }
  const ev = { source: 'X', trust: 'high', text: 'ALMAX.COM Torino', piva: '22222222222' }
  const m = isCompanyMatch(idWithPiva, ev)
  eq(m.action, 'skipped', 'P.IVA diversa = reject anche se trust=high')
}

// ─────────────────── COMPANY: match AppenLab (caso reale) ──────────────

const appenLabId = {
  ragione_sociale: 'Appen.lab S.r.l.',
  citta: 'Torino',
  dominio: 'appenlab.it',
}

// Snippet che cita il dominio
{
  const ev = { source: 'FatturatoItalia', trust: 'high', text: 'Appen.lab Srl con sede a Torino - sito appenlab.it', url: 'https://www.fatturatoitalia.it/azienda/appenlab' }
  const r = scoreCompanyMatch(appenLabId, ev)
  ge(r.score, 80, 'AppenLab match con dominio')
}
// Email che usa il dominio
{
  const ev = { source: 'Sito', trust: 'medium', domain: 'appenlab.it', text: 'info@appenlab.it' }
  const r = scoreCompanyMatch(appenLabId, ev)
  ge(r.score, 80, 'AppenLab match via email domain')
}

// ─────────────────── PERSON: nome + azienda ───────────────────────────

const marioId = { nome_completo: 'Mario Rossi', azienda: 'Allianz', citta: 'Milano' }

// Caso vero
{
  const ev = { source: 'Tavily', trust: 'medium', text: 'Mario Rossi consulente Allianz Milano', url: 'https://linkedin.com/in/mario-rossi-allianz' }
  const r = isPersonMatch(marioId, ev)
  eq(r.action, 'merged', 'Mario Rossi @ Allianz Milano accetta')
}
// Caso omonimo: Mario Rossi ma azienda diversa
{
  const ev = { source: 'Tavily', trust: 'low', text: 'Mario Rossi panettiere a Roma', url: 'https://example.com/mario' }
  const r = isPersonMatch(marioId, ev)
  eq(r.action, 'skipped', 'Mario Rossi panettiere Roma = omonimo (skip)')
}
// Solo nome, niente azienda
{
  const ev = { source: 'X', trust: 'medium', text: 'Mario Rossi è un nome comune', url: 'http://x.com' }
  const r = isPersonMatch(marioId, ev)
  eq(r.action, 'skipped', 'Solo nome senza ancore = skip')
}

// Caso reale: query "Avv. Vittorio Barosio" — il titolo nella query NON deve impedire il match
// con uno snippet che dice "Vittorio Barosio avvocato" (la fonte non scrive "Avv." letterale)
{
  const barosioId = { nome_completo: 'Avv. Vittorio Barosio', professione: 'avvocato', citta: 'Torino' }
  const ev = { source: 'Tavily', trust: 'medium', text: 'Vittorio Barosio è un avvocato a Torino esperto di diritto amministrativo', url: 'https://studiobarosio.it' }
  const r = isPersonMatch(barosioId, ev)
  eq(r.action, 'merged', 'Avv. Vittorio Barosio: il titolo nella query non blocca il match della fonte')
}

// ─────────────────── applyPatch + safeMerge ────────────────────────────

{
  const target = { ragione_sociale: 'Appen.lab S.r.l.', citta: 'Torino' }
  const written = applyPatch(target, { partita_iva: '12345678901', telefono: 'N/D', sito: 'http://appenlab.it' })
  eq(target.partita_iva, '12345678901', 'applyPatch scrive piva')
  eq(target.telefono, undefined, 'applyPatch scarta N/D')
  eq(target.sito, 'http://appenlab.it', 'applyPatch scrive sito')
  eq(written.sort(), ['partita_iva', 'sito'], 'applyPatch ritorna chiavi scritte')
}
{
  const target = { telefono: '011 1234567' }
  applyPatch(target, { telefono: '02 999999' }) // no overwrite
  eq(target.telefono, '011 1234567', 'applyPatch no-overwrite default')
  applyPatch(target, { telefono: '02 999999' }, { authoritativeKeys: new Set(['telefono']) })
  eq(target.telefono, '02 999999', 'applyPatch authoritative overwrites')
}
{
  const target = {}
  const ev = { source: 'Tavily', trust: 'low', text: 'ALMAXITALIA SRL Milano - Bob Deppiesse', url: 'https://linkedin.com/in/bob' }
  const r = safeMergeCompany(target, almaxId, ev, { titolare: 'Bob Deppiesse' })
  eq(r.result.action, 'skipped', 'safeMergeCompany blocca omonimo')
  eq(target.titolare, undefined, 'safeMergeCompany NON ha scritto titolare')
}
{
  const target = {}
  const ev = { source: 'Camerale', trust: 'high', text: 'ALMAX.COM SRL Torino P.IVA 12345678901', piva: '12345678901' }
  const r = safeMergeCompany(target, { ...almaxId, piva: '12345678901' }, ev, { fatturato: 500000 })
  eq(r.result.action, 'merged', 'safeMergeCompany accetta P.IVA match')
  eq(target.fatturato, 500000, 'safeMergeCompany ha scritto fatturato')
}

// ──────────────────────── REPORT ───────────────────────────

console.log(`\n${passed} passed, ${failed} failed (totale ${passed + failed})`)
if (failed > 0) {
  for (const f of failures) {
    console.log(` FAIL: ${f.label}`)
    console.log(`   expected: ${f.expected}`)
    console.log(`   actual  : ${f.actual}`)
  }
  process.exit(1)
}
process.exit(0)
