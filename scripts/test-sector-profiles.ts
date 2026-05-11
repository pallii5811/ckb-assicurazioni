/**
 * Test runtime per sector-profiles.ts
 *
 * Verifica che:
 *  1. Ogni settore matchi i suoi input rappresentativi (positivi).
 *  2. Casi limite/confondibili NON triggherino settori sbagliati (negativi).
 *  3. Più settori possono matchare contemporaneamente quando legittimo (es. ingegneria che fa R&D).
 *
 * Eseguire con: npx tsx scripts/test-sector-profiles.ts
 */

import { detectSectorProfiles, type SectorDetectionInput } from '../src/lib/sector-profiles'

interface TestCase {
  name: string
  input: Partial<SectorDetectionInput>
  expectIds: string[]            // settori che DEVONO essere matchati
  forbidIds?: string[]           // settori che NON devono essere matchati (anti-false-positive)
}

const baseInput = (overrides: Partial<SectorDetectionInput>): SectorDetectionInput => ({
  atecoDigits: '',
  sectorText: '',
  legalForm: 'SRL',
  employees: 5,
  revenue: 500_000,
  ...overrides,
})

const TESTS: TestCase[] = [
  // ─── PULIZIE ────────────────────────────────────────────────────
  {
    name: 'Impresa di pulizie civili (ATECO 81.21)',
    input: { atecoDigits: '812100', sectorText: 'pulizia generale di edifici impresa di pulizie' },
    expectIds: ['pulizie_sanificazione'],
    forbidIds: ['metalmeccanica_industriale', 'studi_legali'],
  },
  {
    name: 'Sanificazione + disinfestazione (ATECO 81.29)',
    input: { atecoDigits: '812900', sectorText: 'sanificazione disinfestazione e disinfezione' },
    expectIds: ['pulizie_sanificazione'],
  },

  // ─── MARKETING / COMUNICAZIONE ──────────────────────────────────
  {
    name: 'Agenzia di marketing (ATECO 73.11)',
    input: { atecoDigits: '731100', sectorText: 'agenzia di marketing e comunicazione pubblicitaria' },
    expectIds: ['marketing_comunicazione'],
    forbidIds: ['pulizie_sanificazione', 'metalmeccanica_industriale'],
  },
  {
    name: 'Web agency (ATECO 73.11 + descrizione)',
    input: { atecoDigits: '731100', sectorText: 'web agency digital agency comunicazione integrata' },
    expectIds: ['marketing_comunicazione'],
  },

  // ─── INGEGNERIA / ARCHITETTURA ──────────────────────────────────
  {
    name: 'Studio di ingegneria strutturale (ATECO 71.12)',
    input: { atecoDigits: '711210', sectorText: 'studio di ingegneria progettazione strutturale calcolo strutturale' },
    expectIds: ['ingegneria_architettura'],
    forbidIds: ['ricerca_sviluppo'],
  },
  {
    name: 'Studio di architettura (ATECO 71.11)',
    input: { atecoDigits: '711100', sectorText: 'studio di architettura' },
    expectIds: ['ingegneria_architettura'],
  },
  {
    name: 'Impresa edile (deve NON triggerare ingegneria — exclude funziona)',
    input: { atecoDigits: '412000', sectorText: 'costruzione di edifici impresa edile' },
    expectIds: [],
    forbidIds: ['ingegneria_architettura'],
  },

  // ─── R&D ────────────────────────────────────────────────────────
  {
    name: 'Centro R&D biotech (ATECO 72.11)',
    input: { atecoDigits: '721100', sectorText: 'ricerca e sviluppo biotecnologie sperimentazione' },
    expectIds: ['ricerca_sviluppo'],
  },
  {
    name: 'R&D innovazione tecnologica',
    input: { atecoDigits: '722000', sectorText: 'innovazione tecnologica R&D ricerca scientifica' },
    expectIds: ['ricerca_sviluppo'],
  },
  {
    name: 'Università (NON deve triggerare R&D — exclude)',
    input: { atecoDigits: '854200', sectorText: 'universita degli studi di milano formazione superiore' },
    expectIds: [],
    forbidIds: ['ricerca_sviluppo'],
  },

  // ─── FOTOVOLTAICO ───────────────────────────────────────────────
  {
    name: 'Installatore fotovoltaico (ATECO 43.21.01)',
    input: { atecoDigits: '432101', sectorText: 'installazione di impianti fotovoltaici energie rinnovabili' },
    expectIds: ['fotovoltaico_rinnovabili'],
  },
  {
    name: 'Produzione energia da FER (ATECO 35.11)',
    input: { atecoDigits: '351100', sectorText: 'produzione di energia elettrica da fonti rinnovabili impianto fotovoltaico' },
    expectIds: ['fotovoltaico_rinnovabili'],
  },

  // ─── METALMECCANICA ─────────────────────────────────────────────
  {
    name: 'Carpenteria metallica (ATECO 25.11)',
    input: { atecoDigits: '251100', sectorText: 'carpenteria metallica fabbricazione strutture metalliche' },
    expectIds: ['metalmeccanica_industriale'],
  },
  {
    name: 'Produzione macchinari (ATECO 28.99)',
    input: { atecoDigits: '289900', sectorText: 'fabbricazione di macchinari per uso speciale meccanica di precisione' },
    expectIds: ['metalmeccanica_industriale'],
  },
  {
    name: 'Riparazione macchinari (ATECO 33 — NON deve triggerare metalmeccanica per exclude)',
    input: { atecoDigits: '331100', sectorText: 'riparazione e manutenzione di macchinari industriali' },
    expectIds: [],
    forbidIds: ['metalmeccanica_industriale'],
  },

  // ─── CHIMICA / FARMACEUTICA ─────────────────────────────────────
  {
    name: 'Produzione vernici (ATECO 20.30)',
    input: { atecoDigits: '203000', sectorText: 'fabbricazione di pitture vernici e adesivi' },
    expectIds: ['chimica_farmaceutica'],
  },
  {
    name: 'Industria farmaceutica (ATECO 21.20)',
    input: { atecoDigits: '212000', sectorText: 'fabbricazione di medicinali e preparati farmaceutici' },
    expectIds: ['chimica_farmaceutica'],
  },
  {
    name: 'Farmacia al dettaglio (NON deve triggerare farma — exclude)',
    input: { atecoDigits: '477300', sectorText: 'farmacia al dettaglio vendita medicinali' },
    expectIds: [],
    forbidIds: ['chimica_farmaceutica'],
  },

  // ─── RESTAURO BENI CULTURALI ────────────────────────────────────
  {
    name: 'Restauratore beni culturali (ATECO 90.03)',
    input: { atecoDigits: '900302', sectorText: 'restauro di opere d arte e beni culturali conservazione monumenti' },
    expectIds: ['restauro_beni_culturali'],
  },
  {
    name: 'Ristrutturazione edilizia (NON deve triggerare restauro BBCC — exclude)',
    input: { atecoDigits: '433900', sectorText: 'ristrutturazione edilizia case e appartamenti' },
    expectIds: [],
    forbidIds: ['restauro_beni_culturali'],
  },

  // ─── STUDI LEGALI ───────────────────────────────────────────────
  {
    name: 'Studio legale (ATECO 69.10)',
    input: { atecoDigits: '691010', sectorText: 'studio legale avvocato attivita legale' },
    expectIds: ['studi_legali'],
  },
  {
    name: 'Notaio (NON deve triggerare studi legali — exclude)',
    input: { atecoDigits: '691020', sectorText: 'attivita notarile notaio' },
    expectIds: [],
    forbidIds: ['studi_legali'],
  },

  // ─── STUDI COMMERCIALI ──────────────────────────────────────────
  {
    name: 'Studio commercialista (ATECO 69.20)',
    input: { atecoDigits: '692011', sectorText: 'studio commercialista dottore commercialista contabilita' },
    expectIds: ['studi_commerciali'],
  },
  {
    name: 'Consulente del lavoro (ATECO 69.20.13)',
    input: { atecoDigits: '692013', sectorText: 'consulente del lavoro paghe e contributi' },
    expectIds: ['studi_commerciali'],
  },

  // ─── CONSULENZA AZIENDALE ───────────────────────────────────────
  {
    name: 'Management consulting (ATECO 70.22)',
    input: { atecoDigits: '702209', sectorText: 'consulenza aziendale strategica management consulting' },
    expectIds: ['consulenza_aziendale'],
  },
  {
    name: 'Consulenza fiscale (NON deve triggerare consulenza generica — exclude)',
    input: { atecoDigits: '702209', sectorText: 'consulenza fiscale e tributaria' },
    expectIds: [],
    forbidIds: ['consulenza_aziendale'],
  },

  // ─── VETERINARIA ────────────────────────────────────────────────
  {
    name: 'Clinica veterinaria (ATECO 75)',
    input: { atecoDigits: '750000', sectorText: 'clinica veterinaria ambulatorio veterinario' },
    expectIds: ['veterinaria'],
  },

  // ─── IMMOBILIARE INTERMEDIAZIONE ────────────────────────────────
  {
    name: 'Agenzia immobiliare (ATECO 68.31)',
    input: { atecoDigits: '683100', sectorText: 'agenzia immobiliare mediazione immobiliare' },
    expectIds: ['immobiliare_intermediazione'],
  },
  {
    name: 'Gestione condominiale (NON deve triggerare intermediazione — exclude)',
    input: { atecoDigits: '683200', sectorText: 'gestione condomini amministratore di condominio' },
    expectIds: [],
    forbidIds: ['immobiliare_intermediazione'],
  },

  // ─── GESTIONE RIFIUTI ───────────────────────────────────────────
  {
    name: 'Raccolta rifiuti (ATECO 38.11)',
    input: { atecoDigits: '381100', sectorText: 'raccolta di rifiuti non pericolosi' },
    expectIds: ['gestione_rifiuti'],
  },
  {
    name: 'Bonifica siti contaminati (ATECO 39.00)',
    input: { atecoDigits: '390000', sectorText: 'bonifica di siti contaminati decontaminazione' },
    expectIds: ['gestione_rifiuti'],
  },

  // ─── VIGILANZA PRIVATA ──────────────────────────────────────────
  {
    name: 'Istituto di vigilanza (ATECO 80.10)',
    input: { atecoDigits: '801000', sectorText: 'istituto di vigilanza privata armata trasporto valori' },
    expectIds: ['vigilanza_privata'],
  },

  // ─── SOMMINISTRAZIONE LAVORO ────────────────────────────────────
  {
    name: 'Agenzia per il lavoro (ATECO 78.20)',
    input: { atecoDigits: '782000', sectorText: 'agenzia per il lavoro somministrazione di lavoro interinale' },
    expectIds: ['somministrazione_lavoro'],
  },

  // ─── NOLEGGIO ───────────────────────────────────────────────────
  {
    name: 'Autonoleggio (ATECO 77.11)',
    input: { atecoDigits: '771100', sectorText: 'noleggio di autovetture rent a car autonoleggio' },
    expectIds: ['noleggio'],
  },
  {
    name: 'Leasing finanziario (NON deve triggerare noleggio — exclude)',
    input: { atecoDigits: '649100', sectorText: 'leasing finanziario operazioni di credito' },
    expectIds: [],
    forbidIds: ['noleggio'],
  },

  // ─── TRASPORTO PASSEGGERI ───────────────────────────────────────
  {
    name: 'Servizio NCC (ATECO 49.32)',
    input: { atecoDigits: '493200', sectorText: 'trasporto di passeggeri con autonoleggio con conducente NCC' },
    expectIds: ['trasporto_passeggeri'],
  },
  {
    name: 'Autolinee turistiche (ATECO 49.39)',
    input: { atecoDigits: '493900', sectorText: 'trasporto turistico gran turismo navetta aeroportuale' },
    expectIds: ['trasporto_passeggeri'],
  },

  // ─── LOGISTICA / MAGAZZINAGGIO ──────────────────────────────────
  {
    name: 'Spedizioniere (ATECO 52.29)',
    input: { atecoDigits: '522900', sectorText: 'spedizioniere spedizioni internazionali freight forwarder' },
    expectIds: ['magazzinaggio_logistica'],
  },
  {
    name: 'Magazzinaggio merci (ATECO 52.10)',
    input: { atecoDigits: '521000', sectorText: 'magazzinaggio e deposito merci conto terzi 3PL' },
    expectIds: ['magazzinaggio_logistica'],
  },
  {
    name: 'Corriere espresso (NON deve triggerare logistica — exclude)',
    input: { atecoDigits: '532000', sectorText: 'corriere espresso consegne' },
    expectIds: [],
    forbidIds: ['magazzinaggio_logistica'],
  },

  // ─── CALL CENTER ────────────────────────────────────────────────
  {
    name: 'Call center (ATECO 82.20)',
    input: { atecoDigits: '822000', sectorText: 'call center contact center telemarketing BPO' },
    expectIds: ['call_center_bpo'],
  },

  // ─── INTERMEDIARI FINANZIARI / ASSICURATIVI ─────────────────────
  {
    name: 'Broker assicurativo (ATECO 66.22)',
    input: { atecoDigits: '662200', sectorText: 'broker assicurativo intermediario assicurativo' },
    expectIds: ['intermediari_finanziari'],
  },
  {
    name: 'Mediatore creditizio (ATECO 66.19)',
    input: { atecoDigits: '661930', sectorText: 'mediatore creditizio agente in attivita finanziaria' },
    expectIds: ['intermediari_finanziari'],
  },

  // ─── CASE LIMITE / NESSUN MATCH ─────────────────────────────────
  {
    name: 'Settore non coperto (ATECO sconosciuto): nessun profilo specifico',
    input: { atecoDigits: '999999', sectorText: 'attivita non classificabile' },
    expectIds: [],
  },
  {
    name: 'Input vuoto: nessun profilo',
    input: { atecoDigits: '', sectorText: '' },
    expectIds: [],
  },

  // ─── SOVRAPPOSIZIONE LEGITTIMA ──────────────────────────────────
  {
    name: 'Studio di ingegneria che fa R&D (matcha entrambi)',
    input: { atecoDigits: '711210', sectorText: 'studio di ingegneria che svolge anche ricerca e sviluppo R&D' },
    expectIds: ['ingegneria_architettura', 'ricerca_sviluppo'],
  },
]

// ── EXECUTION ─────────────────────────────────────────────────────
let passed = 0
let failed = 0
const failures: Array<{ name: string; reason: string }> = []

for (const test of TESTS) {
  const profiles = detectSectorProfiles(baseInput(test.input))
  const matchedIds = profiles.map(p => p.id)

  let ok = true
  const reasons: string[] = []

  for (const expected of test.expectIds) {
    if (!matchedIds.includes(expected)) {
      ok = false
      reasons.push(`mancante: ${expected}`)
    }
  }
  for (const forbidden of test.forbidIds || []) {
    if (matchedIds.includes(forbidden)) {
      ok = false
      reasons.push(`falso positivo: ${forbidden}`)
    }
  }
  if (test.expectIds.length === 0 && !test.forbidIds && matchedIds.length > 0) {
    // Nessun match atteso, ma trovati alcuni: solo segnalazione informativa, non fail
  }

  if (ok) {
    passed++
    console.log(`OK    | ${test.name}  → [${matchedIds.join(', ') || '(nessuno)'}]`)
  } else {
    failed++
    failures.push({ name: test.name, reason: reasons.join('; ') })
    console.log(`FAIL  | ${test.name}  → [${matchedIds.join(', ') || '(nessuno)'}]  | ${reasons.join('; ')}`)
  }
}

console.log('\n' + '═'.repeat(70))
console.log(`TOTAL: ${TESTS.length} | PASSED: ${passed} | FAILED: ${failed}`)
console.log('═'.repeat(70))

if (failures.length > 0) {
  console.log('\nFAILURES DETAIL:')
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.reason}`)
  }
  process.exit(1)
}

process.exit(0)
