/**
 * SECTOR PROFILES — Tassonomia settoriale italiana per bisogni assicurativi specifici.
 *
 * Principio di progettazione (non negoziabile):
 *   1. Ogni settore è matchato su ATECO + keyword descrizione (+ esclusioni opzionali).
 *   2. Ogni bisogno cita una norma italiana precisa o una prassi documentata.
 *   3. Nessun premio numerico: la quotazione va in compagnia.
 *   4. Le domande broker aprono la call e sondano lacune reali.
 *   5. I rischi sono desumibili dall'attività ATECO, mai inventati.
 *   6. Zero contenuti generici: se un settore non ha bisogni specifici verificabili,
 *      non lo si aggiunge qui (il fallback generico dell'engine resta attivo).
 *
 * Questo modulo è additivo rispetto a `insurance-needs-engine.ts`:
 * se `detectSectorProfiles` ritorna un array vuoto, l'engine si comporta come prima
 * (backward compatible, zero regressione).
 */

import type { InsuranceNeedRecommendation } from './insurance-needs-engine'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SectorMatchRule {
  /** Regex sui digit ATECO senza punti (es. /^812/ matcha 81.21, 81.22, 81.29). */
  atecoRe?: RegExp[]
  /** Regex sul testo descrittivo (descrizione_ateco + category + ragione_sociale, lowercase). */
  keywordRe?: RegExp[]
  /** Esclusioni: se matcha, il settore NON scatta (evita falsi positivi). */
  excludeRe?: RegExp[]
  /** Soglie di dimensione opzionali. */
  minEmployees?: number
  maxEmployees?: number
  minRevenue?: number
}

export interface SectorProfile {
  /** ID stabile (usato nei logs e per deduplicazione). */
  id: string
  /** Etichetta human-readable. */
  label: string
  /** Leva commerciale principale (1-2 righe) — perché questo settore ha bisogni specifici. */
  leva_commerciale: string
  /** Regole di match. */
  match: SectorMatchRule
  /** Bisogni assicurativi specifici (priorità e normativa citate). */
  needs: InsuranceNeedRecommendation[]
  /** Domande operative che il broker deve fare in call. */
  domande_broker: string[]
  /** Motivi commerciali forti (non generici). */
  commercial_reasons: string[]
  /** Normativa di riferimento citabile in consulenza. */
  normativa: string[]
}

export interface SectorDetectionInput {
  /** ATECO senza punti (es. "812100"). */
  atecoDigits: string
  /** Testo concatenato: descrizione_ateco + category + ragione_sociale (lowercase). */
  sectorText: string
  /** Forma giuridica uppercase (es. "SRL"). */
  legalForm: string
  /** Numero dipendenti (null se ignoto). */
  employees: number | null
  /** Fatturato annuo (null se ignoto). */
  revenue: number | null
}

// ═══════════════════════════════════════════════════════════════════
// MATCHER
// ═══════════════════════════════════════════════════════════════════

function hasAnyRegex(text: string, regexes?: RegExp[]): boolean {
  if (!text || !regexes || regexes.length === 0) return false
  return regexes.some(re => re.test(text))
}

function matchesProfile(match: SectorMatchRule, input: SectorDetectionInput): boolean {
  const atecoMatch = input.atecoDigits ? hasAnyRegex(input.atecoDigits, match.atecoRe) : false
  const kwMatch = input.sectorText ? hasAnyRegex(input.sectorText, match.keywordRe) : false
  // Deve matchare almeno uno tra ATECO e keyword
  if (!atecoMatch && !kwMatch) return false
  // Esclusioni (se una matcha, il settore NON scatta)
  if (match.excludeRe && hasAnyRegex(input.sectorText, match.excludeRe)) return false
  // Dimensioni
  if (typeof match.minEmployees === 'number') {
    if (input.employees === null || input.employees < match.minEmployees) return false
  }
  if (typeof match.maxEmployees === 'number') {
    if (input.employees === null || input.employees > match.maxEmployees) return false
  }
  if (typeof match.minRevenue === 'number') {
    if (input.revenue === null || input.revenue < match.minRevenue) return false
  }
  return true
}

/**
 * Ritorna tutti i profili settoriali che matchano l'input.
 * Più profili possono matchare contemporaneamente (es. ingegneria + R&D per uno studio
 * che fa anche ricerca): la dedup dei needs avviene in `insurance-needs-engine.ts`.
 */
export function detectSectorProfiles(input: SectorDetectionInput): SectorProfile[] {
  return SECTOR_PROFILES.filter(p => matchesProfile(p.match, input))
}

// ═══════════════════════════════════════════════════════════════════
// SECTOR PROFILES
// ═══════════════════════════════════════════════════════════════════

export const SECTOR_PROFILES: SectorProfile[] = [

  // ─────────────────────────────────────────────────────────────────
  // 1) PULIZIE, SANIFICAZIONE, DISINFESTAZIONE (ATECO 81.2x)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'pulizie_sanificazione',
    label: 'Imprese di pulizie, sanificazione e disinfestazione',
    leva_commerciale:
      'L\'azienda opera dentro i locali di terzi (uffici, sanità, industria, scuole). ' +
      'I beni del cliente sono in affidamento durante l\'intervento: la RCT standard ' +
      'esclude o limita "cose in consegna" e "danno da trattamento", lasciando ' +
      'l\'impresa scoperta su sinistri tipicamente ricorrenti.',
    match: {
      atecoRe: [/^812/, /^8121/, /^8122/, /^8129/, /^813/],
      keywordRe: [
        /\bpulizi[ae]\b/,
        /sanificaz/,
        /disinfestaz/,
        /disinfezion/,
        /derattizzaz/,
        /multiservizi/,
        /\bimpresa\s+di\s+puliz/,
      ],
      excludeRe: [/lavanderia\s+industriale/, /\bself[-\s]?service\b/],
    },
    needs: [
      {
        id: 'rc_pulizie_cose_in_consegna',
        product: 'RCT con estensione "cose in consegna" e "danno da trattamento"',
        target: 'Titolare / Responsabile operativo',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Il personale opera dentro locali di terzi, spesso con apparecchiature costose ' +
          '(server, arredi tecnici, pavimenti industriali in resina, macchinari sanitari). ' +
          'La RCT standard dei contratti tipo ANIA esclude i "beni in consegna/custodia" ' +
          'e il "danno da trattamento" (es. pavimento rovinato da prodotto non idoneo), ' +
          'che in questo settore sono il sinistro tipico.',
        why_now:
          'Un solo sinistro su pavimento tecnico o apparecchio elettromedicale supera ' +
          'facilmente €50.000. Senza l\'estensione, la polizza non risponde e ' +
          'l\'importo resta a carico dell\'azienda.',
        evidence_ids: ['codice_ateco', 'descrizione_ateco'],
        conversion_lever:
          'Molte gare pubbliche (scuole, sanità, ministeri, RSA) richiedono massimali RCT ' +
          '≥ €2-3 mln con cose-in-consegna esplicitamente incluse.',
      },
      {
        id: 'rc_pulizie_chimici',
        product: 'RC Prodotti utilizzati e rischio chimico (detergenti, biocidi, disinfestanti)',
        target: 'Titolare / RSPP',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'L\'uso di tensioattivi concentrati, acidi, biocidi (Reg. UE 528/2012) e ' +
          'prodotti classificati CLP (Reg. CE 1272/2008) espone a danni da allergia, ' +
          'intossicazione o contaminazione di superfici alimentari/sanitarie. ' +
          'La RC Prodotti generica spesso esclude il "prodotto utilizzato per servizio".',
        why_now:
          'Dal 2020 l\'uso di sanificanti ad ampio spettro (perossidi, ammoni quaternari) ' +
          'è aumentato drasticamente. I sinistri su personale cliente (dermatiti, vie ' +
          'respiratorie) sono in crescita.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'crime_pulizie_chiavi',
        product: 'Polizza Infedeltà dipendenti / Crime',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Il personale ha accesso a chiavi, codici allarme, uffici fuori orario. ' +
          'Il rischio di furto da parte di dipendenti o terzi indotti è strutturale ' +
          'e non è coperto dalla RCT.',
        why_now:
          'I clienti grandi (banche, studi professionali, farmacie) chiedono sempre ' +
          'più spesso copertura crime in fase contrattuale come requisito di qualifica fornitore.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La polizza RCT include esplicitamente "cose in consegna/custodia" e "danno da trattamento"? Con quale massimale, franchigia e scoperto?',
      'Operate in ambienti critici (sanità, data center, alimentare, beni culturali)? Le esclusioni di polizza sono compatibili?',
      'Chi custodisce chiavi, codici allarme e badge clienti? Avete una polizza crime/infedeltà dipendenti?',
      'Usate prodotti chimici classificati CLP o biocidi? La polizza copre danni da prodotto utilizzato nel servizio?',
      'Avete subappalti, soci lavoratori o interinali? Le loro responsabilità sono in RCO?',
      'Partecipate a gare pubbliche? Quali sono i massimali RCT/RCO minimi richiesti dai capitolati attivi?',
    ],
    commercial_reasons: [
      'Settore a margine basso: un sinistro "cose in consegna" può erodere l\'utile dell\'anno.',
      'Il committente pubblico impone massimali RCT elevati e spesso richiede l\'estensione a cose in consegna come requisito.',
      'La sanificazione post-COVID ha aumentato l\'uso di biocidi con rischi chimici in crescita.',
      'Il mercato HoReCa/Retail ha reso la polizza crime un requisito contrattuale standard.',
    ],
    normativa: [
      'L. 82/1994 — Disciplina attività imprese di pulizia, disinfestazione, sanificazione',
      'DM 274/1997 — Requisiti capacità economico-finanziaria e tecnico-organizzativa',
      'Reg. UE 528/2012 — Biocidi',
      'Reg. CE 1272/2008 (CLP) — Classificazione e etichettatura sostanze pericolose',
      'D.Lgs. 81/2008 — Sicurezza lavoratori (DVR rischio chimico art. 223-232)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 2) MARKETING, COMUNICAZIONE, PUBBLICITÀ, PR (ATECO 73, 70.21, 63.12)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'marketing_comunicazione',
    label: 'Agenzie marketing, comunicazione, pubblicità, PR, media planning',
    leva_commerciale:
      'Attività di produzione contenuti e gestione brand di clienti terzi. ' +
      'L\'esposizione vera è su diffamazione, violazione copyright/diritti d\'immagine, ' +
      'errori in campagne (contenuti ingannevoli), trattamento dati profilazione clienti. ' +
      'Una "RC Professionale" generica non copre bene questi rischi.',
    match: {
      atecoRe: [/^731/, /^732/, /^7021/, /^6312/, /^731[0-9]/, /^7311/, /^7312/],
      keywordRe: [
        /\bagenzia\s+(?:di\s+)?(?:marketing|comunicazion|pubblicit|pr\b|media)/,
        /\bagenzia\s+creativa\b/,
        /\bpubblicit[àa]\b/,
        /\bcomunicazione\s+(?:integrata|corporate|digitale)/,
        /\bbranding\b/,
        /\bweb\s+agency\b/,
        /\bdigital\s+agency\b/,
        /\bconsulenza\s+di\s+marketing\b/,
        /\bmedia\s+planning\b/,
        /\bsocial\s+media\s+management\b/,
        /\bpublic\s+relation/,
      ],
      excludeRe: [/\btipografia\b/, /\bstamperia\b/],
    },
    needs: [
      {
        id: 'rc_media_communication',
        product: 'RC Media & Communication Liability (E&O specifica agenzie)',
        target: 'Titolare / Account Director',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Le RC Professionali standard coprono "errore od omissione" generico. ' +
          'Per un\'agenzia servono estensioni su: diffamazione e ingiuria (art. 595 c.p.), ' +
          'violazione copyright e diritti d\'autore (L. 633/1941), violazione diritti ' +
          'd\'immagine (art. 10 c.c., art. 96-97 L. 633/1941), pratiche commerciali ' +
          'scorrette (D.Lgs. 206/2005 Codice del Consumo, art. 20-27).',
        why_now:
          'Le sanzioni AGCM per pubblicità ingannevole arrivano a €5 mln; una singola ' +
          'causa per violazione copyright su asset usato in campagna può superare ' +
          'il fatturato mensile dell\'agenzia.',
        evidence_ids: ['codice_ateco', 'descrizione_ateco'],
        conversion_lever:
          'I contratti con brand importanti impongono sempre più spesso clausole di ' +
          'indemnity illimitata: senza E&O dedicata l\'agenzia firma un rischio non coperto.',
      },
      {
        id: 'cyber_data_profilazione',
        product: 'Cyber Risk con estensione su dati di profilazione clienti',
        target: 'Titolare / DPO',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'L\'agenzia tratta liste email, CRM, dati di profilazione e cookie dei ' +
          'clienti dei committenti. È spesso responsabile del trattamento (art. 28 GDPR) ' +
          'o contitolare (art. 26 GDPR). Un data breach su una lista del cliente può ' +
          'innescare responsabilità solidale.',
        why_now:
          'GDPR art. 83: sanzioni fino a €20 mln o 4% fatturato annuo. Nel 2024 il ' +
          'Garante ha sanzionato più volte agenzie per cookie non conformi e profilazione illecita.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'tutela_legale_agenzie',
        product: 'Tutela Legale con contenzioso civile/amministrativo/autorità',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Le controversie con clienti (mancato pagamento, contestazioni su risultati ' +
          'KPI/ROAS) e con AGCM/AGCOM (pubblicità ingannevole, influencer marketing, ' +
          'product placement) richiedono difesa specializzata.',
        why_now:
          'Le delibere AGCOM su influencer marketing e trasparenza dei contenuti ' +
          'sponsorizzati hanno moltiplicato i procedimenti amministrativi sul settore.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La RC Professionale include esplicitamente diffamazione, violazione copyright e diritti d\'immagine?',
      'Gestite liste email, CRM o dati di profilazione dei clienti? Siete responsabili del trattamento o contitolari ai sensi GDPR?',
      'Le retainer/proposte prevedono clausole di indemnity illimitate verso il cliente?',
      'Avete storici di contestazioni su risultati attesi (KPI, ROAS, conversioni) non raggiunti?',
      'Lavorate con influencer/content creator? Avete clausole di manleva reciproca e una copertura specifica?',
      'In caso di data breach su lista clienti, chi notifica al Garante entro le 72h e chi sostiene i costi di notifica/rimedi?',
    ],
    commercial_reasons: [
      'La RC Professionale generica non copre diffamazione, copyright, diritti d\'immagine: sinistro medio €30-80k non coperto.',
      'AGCM/AGCOM hanno intensificato i controlli su pubblicità ingannevole, cookie e influencer marketing.',
      'I contratti con grandi brand impongono clausole di indemnity sempre più stringenti.',
      'GDPR art. 83: sanzioni fino al 4% del fatturato annuo.',
    ],
    normativa: [
      'L. 633/1941 — Protezione diritto d\'autore (copyright, diritti d\'immagine)',
      'Art. 10 c.c. — Abuso dell\'immagine altrui',
      'Art. 595 c.p. — Diffamazione a mezzo stampa/social',
      'D.Lgs. 206/2005 (Codice del Consumo) art. 20-27 — Pratiche commerciali scorrette',
      'Reg. UE 2016/679 (GDPR) art. 26, 28, 83 — Contitolarità, responsabile trattamento, sanzioni',
      'Delibere e linee guida AGCOM — Trasparenza pubblicità online, influencer marketing e contenuti sponsorizzati',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 3) INGEGNERIA, ARCHITETTURA, STUDI DI PROGETTAZIONE (ATECO 71.11, 71.12)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ingegneria_architettura',
    label: 'Studi di ingegneria, architettura, progettazione tecnica',
    leva_commerciale:
      'Rischio pluriennale: la responsabilità del progettista si estende fino a 10 anni ' +
      'dalla consegna dell\'opera (art. 1669 c.c.). Per appalti pubblici ≥ €1 mln la polizza ' +
      'di progettazione è requisito obbligatorio di gara (art. 24 comma 4 D.Lgs. 50/2016 / ' +
      'art. 39 D.Lgs. 36/2023).',
    match: {
      atecoRe: [/^7111/, /^7112/, /^71111/, /^71121/, /^74901/, /^74902/],
      keywordRe: [
        /\bstudio\s+(?:di\s+)?(?:ingegneria|architettura|progettazione)/,
        /\bingegnere\b/,
        /\barchitetto\b/,
        /\bprogettazione\s+(?:strutturale|impiantistica|architettonica|meccanica|elettrica)/,
        /\bgeometra\b/,
        /\bcalcolo\s+strutturale/,
        /\bdirezione\s+lavori/,
      ],
      excludeRe: [
        /\bcostruzion/,
        /\bristruttur/,
        /\bimpresa\s+edile/,
        /\binstallazione\s+impianti/,
      ],
    },
    needs: [
      {
        id: 'rc_progettista_decennale',
        product: 'RC Professionale Progettista con garanzia decennale postuma (art. 1669 c.c.)',
        target: 'Titolare studio / professionista iscritto albo',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Il progettista risponde per gravi difetti dell\'opera fino a 10 anni dalla ' +
          'consegna (art. 1669 c.c.). Le RC Professionali base coprono il periodo di ' +
          'polizza attivo ma spesso NON coprono la postuma decennale, che va attivata ' +
          'con estensione specifica o polizza dedicata per ogni incarico rilevante.',
        why_now:
          'Art. 24 c. 4 D.Lgs. 50/2016 (e art. 39 D.Lgs. 36/2023 nuovo Codice Appalti) ' +
          'rende la polizza progettista obbligatoria per partecipare a gare pubbliche ' +
          'di progettazione ≥ €1 mln. Per strutturali la decennale postuma è spesso ' +
          'richiesta dal committente privato in fase di contratto.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
        conversion_lever:
          'Per società di ingegneria (art. 46 D.Lgs. 50/2016) la polizza è requisito ' +
          'di qualificazione SOA/OG-OS su appalti integrati.',
      },
      {
        id: 'rc_professionale_multidisciplinare',
        product: 'RC Professionale Studio Associato / STP multidisciplinare',
        target: 'Tutti i soci professionisti iscritti',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Per studi associati o STP (L. 183/2011, DM 34/2013) la RC deve coprire ' +
          'tutti i professionisti iscritti. Il DPR 137/2012 art. 5 impone obbligo di ' +
          'RC per i professionisti iscritti ad albo, pena illecito disciplinare.',
        why_now:
          'Le compagnie oggi offrono polizze "a massimale unico" che lasciano esposto ' +
          'lo studio se più professionisti sono coinvolti nello stesso sinistro. Va ' +
          'verificato il "per sinistro" / "per anno" / "per professionista".',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
      {
        id: 'tutela_legale_tecnica',
        product: 'Tutela Legale tecnica (CTU, arbitrati, ricorsi)',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Le controversie tecniche (CTU, arbitrati rituali, ricorsi amministrativi su ' +
          'permessi e concessioni) hanno costi peritali e legali elevati che spesso ' +
          'non sono inclusi nella RC professionale base.',
        why_now:
          'Il contenzioso su appalti pubblici e su responsabilità condominiali è ' +
          'storicamente tra i più alti in Italia per durata e costi.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La RC professionale include la garanzia decennale postuma per i progetti strutturali e impiantistici?',
      'Partecipate a gare pubbliche ≥ €1 mln? Quali massimali chiedono i capitolati (di norma ≥ 10-20% valore opera)?',
      'Lo studio è associato o STP? Tutti i professionisti iscritti hanno copertura effettiva o è una polizza "a massimale unico" con rischio cumulo?',
      'Avete progetti di ristrutturazione/nuova costruzione in corso per privati? È stata pattuita una decennale postuma a garanzia del committente?',
      'Fate direzione lavori? La polizza copre il ruolo di DL (responsabilità solidale con l\'impresa)?',
      'Usate software BIM/CAD collaborativi in cloud? I dati progettuali dei clienti hanno una cyber coverage dedicata?',
    ],
    commercial_reasons: [
      'Rischio decennale strutturale non coperto nelle RC base: esposizione fino a 10 anni dopo la consegna.',
      'Polizza obbligatoria per appalti pubblici ≥ €1 mln (art. 24 D.Lgs. 50/2016 / art. 39 D.Lgs. 36/2023).',
      'Crescita del contenzioso su direzione lavori e responsabilità solidali.',
      'Studi associati/STP spesso sotto-assicurati rispetto al numero di professionisti coinvolti.',
    ],
    normativa: [
      'Art. 1669 c.c. — Responsabilità decennale per gravi difetti',
      'D.Lgs. 50/2016 art. 24 c. 4 + D.Lgs. 36/2023 art. 39 — Polizza progettisti obbligatoria appalti pubblici',
      'DPR 137/2012 art. 5 — Obbligo RC professionale iscritti albo',
      'L. 183/2011 + DM 34/2013 — Società tra professionisti (STP)',
      'D.Lgs. 81/2008 — Responsabilità coordinatore sicurezza (CSP/CSE)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 4) R&D / RICERCA SCIENTIFICA (ATECO 72)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'ricerca_sviluppo',
    label: 'Ricerca e sviluppo scientifico / R&D',
    leva_commerciale:
      'Attività su IP, brevetti, sperimentazione. La RC Professionale generica non copre ' +
      'sperimentazione, violazione brevetti di terzi, contaminazione campioni, perdita ' +
      'dati di ricerca. Inoltre l\'azienda tipicamente detiene IP del cliente in regime ' +
      'di confidenzialità (NDA): violazioni contrattuali importanti sono scoperte.',
    match: {
      atecoRe: [/^72/, /^721/, /^722/, /^7211/, /^7219/, /^7220/],
      keywordRe: [
        /\bricerca\s+(?:e\s+sviluppo|scientifica)/,
        /\bR\s*&\s*D\b/,
        /\bR&D\b/,
        /\binnovazione\s+tecnologica/,
        /\bbiotecnologi/,
        /\bsperimentazione\s+(?:clinica|preclinica|farmaceutica)/,
      ],
      excludeRe: [/\bscuola\b/, /\buniversit[àa]\s+degli\s+studi/],
    },
    needs: [
      {
        id: 'rc_ricerca_ip',
        product: 'RC Professionale R&D con copertura IP e confidenzialità',
        target: 'Titolare / Direttore scientifico',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'La responsabilità tipica è duplice: (1) violazione involontaria di brevetti ' +
          'di terzi durante la ricerca (art. 68-71 Codice Proprietà Industriale D.Lgs. ' +
          '30/2005); (2) violazione obblighi di confidenzialità verso committente ' +
          '(NDA) con danno reputazionale e perdita IP. Queste coperture richiedono ' +
          'estensioni specifiche su RC Professionale.',
        why_now:
          'Gli accordi di ricerca con grandi committenti (pharma, automotive, energia) ' +
          'impongono clausole di indemnity illimitate su IP e riservatezza.',
        evidence_ids: ['codice_ateco', 'descrizione_ateco'],
      },
      {
        id: 'cyber_dati_ricerca',
        product: 'Cyber Risk con estensione su perdita dati di ricerca e IP',
        target: 'Titolare / IT Manager',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'I dati di ricerca (protocolli, risultati, campioni digitali, algoritmi) ' +
          'sono l\'asset principale dell\'azienda. Un ransomware o un exfiltration ' +
          'event causa perdita competitiva permanente e può violare GDPR/NDA.',
        why_now:
          'ENISA e Clusit indicano il settore R&D tra i più mirati dal cyber-espionage ' +
          'negli ultimi 3 anni.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rc_sperimentazione_clinica',
        product: 'RC Sperimentazione clinica / preclinica (se pertinente)',
        target: 'Sponsor / CRO',
        priority: 'immediata',
        confidence: 'media',
        sales_reason:
          'Per sperimentazione su soggetti umani o animali, il DM 14/7/2009 e il ' +
          'Reg. UE 536/2014 impongono copertura assicurativa specifica a tutela dei ' +
          'partecipanti. La RC Professionale generale NON è sufficiente.',
        why_now:
          'Il Reg. UE 536/2014 ha uniformato i requisiti in UE dal 2022: polizze ' +
          'non conformi bloccano l\'autorizzazione AIFA allo studio.',
        evidence_ids: ['descrizione_ateco'],
      },
    ],
    domande_broker: [
      'Fate ricerca su commessa (contract research) con clausole di confidenzialità e IP di terzi? Le avete censite per polizza?',
      'La RC professionale copre violazione brevetti di terzi e violazione NDA (dolo escluso, colpa lieve/grave inclusa)?',
      'Fate sperimentazione su soggetti umani o animali? Avete polizza DM 14/7/2009 / Reg. UE 536/2014?',
      'Dove risiedono i dati di ricerca? Avete backup crittografati off-site e incident response plan?',
      'I finanziamenti (PNRR, Horizon Europe, Fondo Innovazione) hanno clausole assicurative specifiche da rispettare per rendicontazione?',
      'Avete spin-off o collaborazioni con università? I diritti d\'invenzione sono regolati contrattualmente e coperti?',
    ],
    commercial_reasons: [
      'Violazioni IP sono il primo costo di contenzioso del settore R&D.',
      'Sperimentazione clinica: polizza è requisito di autorizzazione AIFA/ISS, non opzionale.',
      'PNRR e Horizon Europe impongono rendicontazione con requisiti assicurativi espliciti.',
      'Cyber-espionage su R&D in crescita costante (Clusit, ENISA).',
    ],
    normativa: [
      'D.Lgs. 30/2005 (Codice Proprietà Industriale) — Brevetti, segreti commerciali',
      'Reg. UE 536/2014 — Sperimentazione clinica farmaci uso umano',
      'DM 14/7/2009 — Requisiti polizze assicurative per sperimentazione clinica',
      'D.Lgs. 26/2014 — Protezione animali utilizzati a fini scientifici',
      'Reg. UE 2016/679 (GDPR) — Dati personali in ricerca (art. 89 — ricerca scientifica)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 5) FOTOVOLTAICO / RINNOVABILI (ATECO 35.11 + 43.21.01 + 42.22)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'fotovoltaico_rinnovabili',
    label: 'Fotovoltaico, impianti rinnovabili, produzione energia da FER',
    leva_commerciale:
      'L\'impianto fotovoltaico/eolico ha vita utile 20-25 anni e genera ricavi via ' +
      'GSE (incentivi, ritiro dedicato, scambio sul posto). Due rischi principali: ' +
      '(1) fermo impianto = perdita di ricavi e di incentivi (BI specifica); ' +
      '(2) responsabilità dell\'installatore per vizi costruttivi (art. 1669 c.c.) ' +
      'e per mancato raggiungimento delle performance garantite.',
    match: {
      atecoRe: [/^3511/, /^35111/, /^432101/, /^4222/, /^4221/, /^43211/],
      keywordRe: [
        /\bfotovoltaic/,
        /\bsolare\s+termic/,
        /\beolic/,
        /\bbiogas\b/,
        /\bbiomass/,
        /\bimpiant[io]\s+(?:a\s+)?rinnovabil/,
        /\bproduzione\s+(?:di\s+)?energia\s+(?:elettrica\s+)?da\s+font/,
        /\binstallazione\s+(?:di\s+)?(?:pannelli|impianti)\s+(?:solari|fotovoltaici|eolici)/,
        /\bcolonnine\s+di\s+ricarica/,
      ],
    },
    needs: [
      {
        id: 'all_risks_fotovoltaico',
        product: 'All Risks Impianto FV/Eolico con copertura mancata produzione',
        target: 'Proprietario impianto / Socio',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'I moduli, gli inverter e la struttura sono esposti a grandine, fulmini, ' +
          'incendio, furto (rame/pannelli), eventi atmosferici estremi. La copertura ' +
          '"mancata produzione" (BI indicizzato su GSE/PUN) ricostruisce i ricavi persi ' +
          'durante il fermo ripristino — elemento critico quando l\'impianto è ' +
          'finanziato con mutuo/leasing pluriennale.',
        why_now:
          'Gli eventi climatici estremi (grandine 2022-2024) hanno generato sinistri ' +
          'massivi sui campi FV in Nord Italia. La L. 213/2023 (CAT-NAT) rende ' +
          'obbligatoria la copertura catastrofale su impianti/macchinari di proprietà.',
        evidence_ids: ['codice_ateco', 'ha_immobili_proprieta'],
        conversion_lever:
          'I finanziatori (banche, fondi green) chiedono cessione vincolo di polizza ' +
          'come garanzia del mutuo: senza, non erogano.',
      },
      {
        id: 'rc_installatore_fv',
        product: 'RC Installatore Fotovoltaico con postuma decennale (art. 1669 c.c.)',
        target: 'Titolare installatore',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'L\'installatore risponde per: (1) incendio su tetto da cattiva posa (art. ' +
          '1669 c.c.), (2) performance garantite (PR ratio, degradazione annua) verso ' +
          'committente, (3) conformità DM 37/2008 dell\'impianto elettrico. La RC ' +
          'Installatore generica spesso non copre la postuma decennale e le performance.',
        why_now:
          'I sinistri incendio tetto da connessioni FV difettose sono tra le ' +
          'principali cause di contenzioso post-installazione.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'cyber_monitoraggio_impianti',
        product: 'Cyber Risk su sistemi SCADA / monitoraggio remoto impianti',
        target: 'Titolare / IT Manager',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Gli impianti moderni sono monitorati via IoT/SCADA. Un attacco può bloccare ' +
          'il monitoraggio, falsare la misura GSE, o prendere il controllo degli ' +
          'inverter. Impianti > soglia NIS2 sono soggetti a obblighi di sicurezza.',
        why_now:
          'Direttiva UE 2022/2555 (NIS2) recepita con D.Lgs. 138/2024: operatori del ' +
          'settore energia sono soggetti ad obblighi cyber e notifica incidenti.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'L\'impianto ha copertura "mancata produzione/indemnity period" ≥ 12 mesi con massimale indicizzato sulle tariffe GSE/PUN correnti?',
      'La polizza include eventi catastrofali (grandine, fulmine, esondazione, sisma) come richiesto dalla L. 213/2023?',
      'L\'installatore ha RC con postuma decennale per incendio da posa difettosa e per performance garantite contrattualmente?',
      'C\'è cessione vincolo di polizza a banca/finanziatore?',
      'Il sistema di monitoraggio SCADA/IoT è segregato dalla rete aziendale? Siete soggetti NIS2 (D.Lgs. 138/2024)?',
      'Le colonnine di ricarica (se presenti) hanno RC verso utilizzatori e copertura danno elettrico ai veicoli?',
    ],
    commercial_reasons: [
      'L. 213/2023 rende obbligatoria la copertura CAT-NAT su impianti di proprietà dal 2025.',
      'Eventi meteo estremi 2022-2024 hanno triplicato i sinistri sui campi FV.',
      'I finanziatori chiedono vincolo di polizza come pre-condizione all\'erogazione.',
      'Performance garantite all\'investitore: il gap PR ratio è causa di contenzioso ricorrente.',
      'D.Lgs. 138/2024 (NIS2) estende obblighi cyber al settore energia.',
    ],
    normativa: [
      'L. 213/2023 art. 1 c. 101-111 + DM 18/2025 — Polizza catastrofale obbligatoria imprese',
      'Art. 1669 c.c. — Responsabilità decennale costruttore/installatore',
      'DM 37/2008 — Dichiarazione conformità impianti elettrici',
      'D.Lgs. 28/2011 — Promozione energia da fonti rinnovabili',
      'D.Lgs. 138/2024 (NIS2) — Cybersecurity operatori energia',
      'Disciplinari GSE FER-E / ritiro dedicato / scambio sul posto',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 6) METALMECCANICA / MECCANICA DI PRECISIONE (ATECO 24-30, esclude 33)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'metalmeccanica_industriale',
    label: 'Metalmeccanica, meccanica di precisione, produzione macchinari',
    leva_commerciale:
      'Filiera B2B con rischi strutturali multipli: (1) RC Prodotti su macchinari/ ' +
      'componenti consegnati a terzi (Direttiva Macchine 2006/42/CE), (2) fermo ' +
      'produzione da guasto macchinari critici (CNC, torni, linee automatizzate) ' +
      'con impatto su commesse JIT, (3) CAR/EAR durante installazione/avviamento ' +
      'presso cliente.',
    match: {
      atecoRe: [/^24/, /^25/, /^26/, /^27/, /^28/, /^29/, /^30/],
      keywordRe: [
        /\bmetalmeccanic/,
        /\bmeccanica\s+di\s+precisione/,
        /\bcarpenteria\s+metallic/,
        /\btornitura\b/,
        /\bfresatura\b/,
        /\bstamp(?:aggio|eria)\s+(?:metal|plastic)/,
        /\bmacchin[ae]\s+utensil/,
        /\bproduzione\s+(?:di\s+)?component/,
        /\blavorazione\s+(?:di\s+)?metall/,
      ],
      excludeRe: [/\briparazion\b/, /^33/],
    },
    needs: [
      {
        id: 'rc_prodotti_metalmeccanica',
        product: 'RC Prodotti con copertura ritiro (product recall) e Direttiva Macchine',
        target: 'Titolare / Responsabile qualità',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'La Direttiva Macchine 2006/42/CE (recepita D.Lgs. 17/2010) rende il ' +
          'fabbricante responsabile della sicurezza del macchinario per tutta la vita ' +
          'utile. La disciplina del prodotto difettoso (Direttiva 85/374/CEE recepita ' +
          'oggi nel D.Lgs. 206/2005 — Codice del Consumo, artt. 114-127) impone ' +
          'responsabilità oggettiva verso terzi. RC Prodotti base spesso NON copre ' +
          'il "product recall" (costi di ritiro/sostituzione massiva).',
        why_now:
          'Il nuovo Regolamento Macchine UE 2023/1230 entra in vigore dal gennaio ' +
          '2027 e introduce obblighi estesi su software e AI nei macchinari: polizza ' +
          'va allineata.',
        evidence_ids: ['codice_ateco', 'descrizione_ateco'],
      },
      {
        id: 'machinery_breakdown',
        product: 'Polizza Guasti Macchinari (Machinery Breakdown) + Business Interruption',
        target: 'Titolare / Direttore produzione',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'CNC, centri di lavoro, torni automatici e linee robotizzate sono asset ' +
          'critici con tempi di sostituzione/riparazione lunghi (8-20 settimane). ' +
          'La polizza incendio NON copre il "guasto intrinseco" (rottura meccanica/ ' +
          'elettronica senza causa esterna). Serve Machinery Breakdown dedicata con ' +
          'BI collegato alla perdita di margine.',
        why_now:
          'Supply chain 2023-2025 ancora instabile su ricambi elettronica industriale ' +
          '(chip, azionamenti): fermi macchina più lunghi del passato.',
        evidence_ids: ['codice_ateco', 'fatturato'],
      },
      {
        id: 'car_ear_installazione_cliente',
        product: 'CAR/EAR per installazione e avviamento macchinari presso cliente',
        target: 'Responsabile commerciale / After-sales',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Durante installazione e messa in servizio presso il cliente, il macchinario ' +
          'è di proprietà del produttore fino al collaudo finale. Rischio danno ' +
          'durante trasporto, sollevamento, connessione, test. La RC Prodotti non ' +
          'copre il danno al macchinario stesso prima del passaggio di proprietà.',
        why_now:
          'Le commesse export (Germania, Francia, USA) prevedono quasi sempre CAR/EAR ' +
          'come requisito contrattuale con polizze locali o multilocale.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La RC Prodotti include il product recall (costi di ritiro, sostituzione, informazione ai clienti)?',
      'Avete macchinari con valore singolo > €200k? Hanno copertura Machinery Breakdown con BI collegato?',
      'Installate i macchinari presso il cliente (anche estero)? Avete una CAR/EAR dedicata alla fase di installazione?',
      'Esportate in UE o extra-UE? Le polizze sono multi-giurisdizionali e coprono le clausole di indemnity dei contratti locali?',
      'I macchinari hanno dichiarazione CE e fascicolo tecnico aggiornato ai sensi D.Lgs. 17/2010 e al nuovo Reg. UE 2023/1230 (in vigore 2027)?',
      'Ci sono componenti software/IA nei vostri macchinari? La polizza copre responsabilità da malfunzionamento algoritmico?',
    ],
    commercial_reasons: [
      'Direttiva Macchine + Reg. UE 2023/1230 (2027) impongono evoluzioni delle coperture RC Prodotti.',
      'Guasti su CNC/robotica hanno tempi di ripristino 2-5× più lunghi post-2022 (ricambi chip).',
      'Export B2B chiede CAR/EAR come requisito contrattuale standard.',
      'Product recall su difetti sistematici può costare multipli del fatturato annuo.',
    ],
    normativa: [
      'Direttiva 85/374/CEE — RC Prodotti difettosi (recepita in D.Lgs. 206/2005 Codice del Consumo artt. 114-127)',
      'Direttiva Macchine 2006/42/CE + D.Lgs. 17/2010 — Sicurezza macchinari',
      'Reg. UE 2023/1230 — Nuovo Regolamento Macchine (in vigore 2027)',
      'D.Lgs. 81/2008 — Sicurezza lavoro (DVR linee produttive)',
      'D.Lgs. 152/2006 — Emissioni in atmosfera e scarichi industriali',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 7) CHIMICA / FARMACEUTICA (ATECO 20-21)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'chimica_farmaceutica',
    label: 'Industria chimica e farmaceutica',
    leva_commerciale:
      'Settore ad alta intensità di rischio: (1) RC Prodotti con esposizione globale ' +
      '(spesso USA/Germania), (2) Inquinamento ambientale (D.Lgs. 152/2006) con ' +
      'sanzioni penali e ripristino obbligatorio, (3) ADR per trasporto merci ' +
      'pericolose, (4) requisiti Seveso III per stabilimenti a rischio incidente rilevante.',
    match: {
      atecoRe: [/^20/, /^21/, /^201/, /^202/, /^203/, /^204/, /^205/, /^206/, /^211/, /^212/],
      keywordRe: [
        /\bchimic(?:a|o)\s+(?:industrial|fin|di\s+base)/,
        /\bfarmaceutic/,
        /\bpharma\b/,
        /\bAPI\s+(?:pharma|attivi)/,
        /\bproduzione\s+(?:di\s+)?(?:principi\s+attivi|farmaci|medicinali)/,
        /\bvernici\b/,
        /\badesiv/,
        /\bpolimer/,
        /\bsolvent/,
        /\bdetergenti\s+industrial/,
      ],
      excludeRe: [/\bfarmacia\s+(?:al\s+)?dettaglio/, /\bparafarmacia/],
    },
    needs: [
      {
        id: 'rc_prodotti_pharma_global',
        product: 'RC Prodotti globale (clausola USA/Canada + Worldwide)',
        target: 'Titolare / Legal / Export Manager',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Le aziende chimiche/farmaceutiche esportano con probabilità alta: anche ' +
          'una singola spedizione verso USA/Canada triggera la "USA/Canada ' +
          'jurisdiction" con franchigie e massimali ben superiori. La RC base italiana ' +
          'spesso esclude USA/Canada o richiede estensione premium.',
        why_now:
          'I contenziosi pharma negli USA (class action, punitive damages) possono ' +
          'raggiungere importi esponenziali: senza estensione specifica l\'export è ' +
          'un rischio non coperto.',
        evidence_ids: ['codice_ateco', 'descrizione_ateco'],
      },
      {
        id: 'rc_inquinamento_ambientale',
        product: 'RC Inquinamento Ambientale (Graduale + Accidentale) — danno ambientale D.Lgs. 152/2006',
        target: 'Titolare / RSPP / Responsabile ambiente',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Il D.Lgs. 152/2006 (Codice Ambiente) impone: (1) responsabilità oggettiva ' +
          'per danno ambientale (art. 298 bis - 303), (2) obbligo di ripristino a ' +
          'spese dell\'operatore, (3) sanzioni penali (art. 137 e seg.) per ' +
          'sversamenti e emissioni non autorizzate. La RC Inquinamento Accidentale ' +
          'standard NON copre il "graduale" (percolazione lenta, emissioni croniche) ' +
          'che è la causa tipica di danno nel settore chimico.',
        why_now:
          'I procedimenti per danno ambientale sono tra i più onerosi (ripristino ' +
          'falde, bonifiche siti contaminati SIN/SIR). La Direttiva UE 2024/1203 ' +
          '(Environmental Crime) rafforza le sanzioni penali recepimento 2026.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'trasporto_merci_adr',
        product: 'RC ADR / Assicurazione merci trasportate (sostanze pericolose)',
        target: 'Responsabile logistica / DSA (Consulente ADR)',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Il trasporto di sostanze chimiche è soggetto ad Accordo ADR (D.Lgs. 35/2010): ' +
          'obbligo di consulente DSA, documentazione specifica, veicoli omologati. La ' +
          'polizza merci standard NON copre sempre i danni da prodotto pericoloso e ' +
          'le penali da non conformità ADR.',
        why_now:
          'Le sanzioni ADR sono in costante inasprimento; un sinistro durante il ' +
          'trasporto attiva sia la RC vettoriale sia la responsabilità dello speditore.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'seveso_iii',
        product: 'Copertura Seveso III / stabilimenti a rischio incidente rilevante (se pertinente)',
        target: 'Gestore stabilimento',
        priority: 'immediata',
        confidence: 'media',
        sales_reason:
          'Il D.Lgs. 105/2015 (Seveso III) obbliga gli stabilimenti a rischio di ' +
          'incidente rilevante a documentare coperture assicurative a garanzia del ' +
          'ripristino ambientale e degli obblighi verso la popolazione. Non è ' +
          'opzionale: è condizione per l\'autorizzazione.',
        why_now:
          'Controlli ISPRA/ARPA in aumento; mancata documentazione polizza blocca ' +
          'l\'autorizzazione o la rinnova.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'Esportate in USA o Canada (anche via distributore)? La RC Prodotti include la clausola di giurisdizione USA/Canada?',
      'La polizza RC Inquinamento copre inquinamento graduale (non solo accidentale)? Con retroattività?',
      'Lo stabilimento è classificato come soglia inferiore o superiore ai sensi Seveso III (D.Lgs. 105/2015)?',
      'Trasportate o ricevete merci pericolose ADR? Avete Consulente DSA designato e polizza merci conforme?',
      'Avete siti di produzione esteri o distributori con contratti che richiedono RC cross-border e clausole di indemnity?',
      'Avete stoccaggio di sostanze extended SVHC (REACH)? Comunicazioni ECHA e coperture allineate?',
    ],
    commercial_reasons: [
      'USA/Canada exposure triggerabile anche da una sola spedizione: rischio massivo.',
      'Danno ambientale graduale è la causa tipica di contenzioso nel chimico ed è spesso NON coperto dalla RC base.',
      'Seveso III: polizza è requisito autorizzativo, non opzionale.',
      'Direttiva UE 2024/1203 (Environmental Crime) inasprisce sanzioni penali dal 2026.',
    ],
    normativa: [
      'D.Lgs. 152/2006 (Codice Ambiente) — Danno ambientale, bonifiche, AIA',
      'D.Lgs. 105/2015 — Seveso III (stabilimenti a rischio incidente rilevante)',
      'D.Lgs. 35/2010 — Accordo ADR trasporto merci pericolose',
      'Reg. CE 1907/2006 (REACH) — Registrazione sostanze chimiche',
      'Reg. CE 1272/2008 (CLP) — Classificazione, etichettatura, imballaggio',
      'Direttiva UE 2024/1203 — Environmental Crime (recepimento 2026)',
      'AIFA / EMA — Normative produzione farmaci e GMP',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 9) STUDI LEGALI / AVVOCATI (ATECO 69.10)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'studi_legali',
    label: 'Studi legali / Avvocati',
    leva_commerciale:
      'L\'avvocato è obbligato per legge (L. 247/2012 art. 12 + DM 22/9/2016) ad ' +
      'avere copertura RC professionale per la responsabilità verso clienti. ' +
      'La polizza tipo Cassa Forense è spesso sotto-dimensionata su massimali e ' +
      'manca retroattività adeguata per pratiche pluriennali.',
    match: {
      atecoRe: [/^6910/, /^69101/, /^69102/],
      keywordRe: [
        /\bstudio\s+(?:legale|avvocato|avvocati)/,
        /\bavvocato\b/,
        /\bavvocati\s+associati/,
        /\battivit[àa]\s+legale/,
      ],
      excludeRe: [/\bnotaio\b/, /\bnotari/],
    },
    needs: [
      {
        id: 'rc_professionale_avvocato',
        product: 'RC Professionale Avvocato (DM 22/9/2016) con retroattività e postuma estese',
        target: 'Titolare / Tutti i professionisti iscritti',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'La L. 247/2012 art. 12 e il DM 22/9/2016 (decreto attuativo) impongono ' +
          'all\'avvocato obbligo di RC professionale, con massimale minimo definito e ' +
          'pubblicità della copertura in ogni rapporto col cliente. La polizza Cassa ' +
          'Forense convenzionata copre il minimo legale, ma su pratiche complesse ' +
          '(M&A, fallimentare, fiscale tributario, pratiche pluriennali) è frequentemente ' +
          'inadeguata su massimale, retroattività e postuma.',
        why_now:
          'Il termine di prescrizione per responsabilità professionale è ordinariamente ' +
          'decennale (art. 2946 c.c.) e la giurisprudenza fa decorrere il termine dalla ' +
          'scoperta del danno: senza retroattività adeguata, sinistri scoperti dopo ' +
          'anni dalla pratica non sono coperti.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
      {
        id: 'cyber_studio_legale',
        product: 'Cyber Risk + GDPR per studio legale (dati sensibili clienti)',
        target: 'Titolare / DPO',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Lo studio tratta dati giudiziari (categoria art. 10 GDPR) e dati sensibili ' +
          '(art. 9 GDPR) di clienti. Ransomware, exfiltration o errori di invio email ' +
          'sono causa frequente di sanzioni GDPR e violazione segreto professionale ' +
          '(art. 622 c.p.).',
        why_now:
          'Il Garante ha sanzionato più studi legali per data breach negli ultimi 3 ' +
          'anni. La Direttiva NIS2 (D.Lgs. 138/2024) può applicarsi a studi sopra soglia.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'crime_infedelta_studio',
        product: 'Polizza Infedeltà dipendenti / Crime',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Lo studio gestisce conti dedicati, deposito fiduciario, somme sequestrate. ' +
          'Il rischio di sottrazione da collaboratori, praticanti o personale è ' +
          'strutturale e NON è coperto dalla RC professionale.',
        why_now:
          'I conti deposito hanno movimentazioni elevate; l\'Ordine richiede ' +
          'sempre più trasparenza sui flussi.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La polizza RC ha retroattività illimitata o limitata? Per pratiche pluriennali (fallimentare, M&A) la retroattività è adeguata?',
      'Il massimale "per sinistro" e "per anno" è sufficiente vs la pratica più rilevante in studio?',
      'Avete una postuma per cessazione attività? Per ogni socio che esce?',
      'Lo studio è associato/STA? Tutti i professionisti hanno copertura per cumulo sinistro?',
      'I dati clienti sono crittografati at-rest e in-transit? Avete incident response per data breach?',
      'Gestite conti deposito fiduciario o somme di terzi? Avete polizza crime/infedeltà?',
    ],
    commercial_reasons: [
      'Polizza Cassa Forense convenzionata spesso sotto-dimensionata su pratiche complesse.',
      'Prescrizione decennale (art. 2946 c.c.) decorrente dalla scoperta del danno: senza retroattività adeguata, sinistri non coperti.',
      'Cyber/GDPR: i dati giudiziari sono categoria a rischio massimo, sanzioni in crescita.',
      'Postuma per cessazione attività spesso assente o limitata: rischio per pensionamento/exit socio.',
    ],
    normativa: [
      'L. 247/2012 art. 12 — Obbligo RC professionale avvocato',
      'DM 22/9/2016 — Massimali minimi e condizioni RC avvocati',
      'Art. 622 c.p. — Segreto professionale',
      'Reg. UE 2016/679 (GDPR) art. 9-10 — Dati sensibili e giudiziari',
      'Art. 2946 c.c. — Prescrizione decennale ordinaria',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 10) STUDI COMMERCIALI / CONSULENTI DEL LAVORO (ATECO 69.20)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'studi_commerciali',
    label: 'Studi commerciali, dottori commercialisti, consulenti del lavoro',
    leva_commerciale:
      'Obbligo RC professionale ex DPR 137/2012 art. 5 e specifiche da Ordini ' +
      '(CNDCEC per commercialisti, CNO per consulenti del lavoro). La consulenza ' +
      'fiscale e tributaria espone a sanzioni amministrative trasferibili al cliente ' +
      'e a contenzioso pluriennale per errori dichiarazione.',
    match: {
      atecoRe: [/^6920/, /^69201/, /^69202/, /^69203/],
      keywordRe: [
        /\bstudio\s+(?:commercial|tributari|fiscal|contabil)/,
        /\bdottore?\s+commercialist/,
        /\bcommercialist/,
        /\bconsulente\s+del\s+lavoro/,
        /\brevisor[ei]\s+(?:dei\s+conti|legal)/,
        /\bperit[oi]\s+(?:commercial|contabil)/,
      ],
    },
    needs: [
      {
        id: 'rc_commercialista_consulente',
        product: 'RC Professionale Commercialista / Consulente del Lavoro / Revisore',
        target: 'Titolare / Soci professionisti',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'DPR 137/2012 art. 5 obbliga RC professionale. Per dichiarazioni fiscali ' +
          'errate, omessi versamenti, paghe non conformi, il cliente può rivalersi ' +
          'fino a 10 anni dopo (art. 2946 c.c.). Sanzioni amministrative tributarie ' +
          'spesso trasferibili in via di responsabilità professionale. Per revisore ' +
          'legale: D.Lgs. 39/2010 art. 25 prevede solidarietà con amministratori.',
        why_now:
          'Riforma fiscale 2023-2025 introduce nuovi adempimenti (cessione crediti, ' +
          'concordato preventivo biennale, fatturazione elettronica B2C) con ' +
          'responsabilità professionali estese.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
      {
        id: 'tutela_legale_tributaria',
        product: 'Tutela Legale tributaria (controversie con Agenzia Entrate / INPS)',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'I contenziosi tributari del cliente innescano spesso azioni di rivalsa ' +
          'verso il consulente. Difesa tecnica davanti a Commissioni Tributarie e ' +
          'in Cassazione ha costi peritali/legali elevati non inclusi nella RC base.',
        why_now:
          'Aumento significativo dei controlli fiscali post-PNRR e digitalizzazione ' +
          'Agenzia delle Entrate.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'cyber_studio_contabile',
        product: 'Cyber Risk + GDPR per studio contabile/paghe',
        target: 'Titolare / DPO',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Lo studio tratta dati anagrafici, bancari, sanitari (gestione paghe ' +
          'malattie), fiscali di centinaia/migliaia di soggetti. Un ransomware blocca ' +
          'l\'operatività paghe (sanzioni INPS per ritardo F24/UniEmens) e può ' +
          'innescare violazione GDPR.',
        why_now:
          'Attacchi mirati a studi contabili in crescita: l\'attaccante sa che il ' +
          'fermo > 48h causa multe INPS al cliente.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La RC professionale copre l\'attività di revisore legale (D.Lgs. 39/2010) con solidarietà verso amministratori?',
      'Retroattività e postuma per dichiarazioni e bilanci pluriennali sono adeguate?',
      'Avete clienti con consolidato fiscale / concordato preventivo biennale? Coperture allineate?',
      'Lo studio gestisce paghe e adempimenti INPS/INAIL? Cyber include estensione "fermo paghe" con costi sanzioni cliente?',
      'I dati clienti sono in cloud? Provider, jurisdiction, backup, encryption sono mappati?',
      'Avete una postuma per cessazione/cessione studio? Per socio che esce?',
    ],
    commercial_reasons: [
      'Riforma fiscale 2023-2025 ha esteso le responsabilità professionali.',
      'Contenzioso tributario in crescita post-PNRR: costi difesa elevati.',
      'Cyber: studi contabili tra i target preferiti del ransomware (alta probabilità di pagamento riscatto).',
      'Postuma per cessazione spesso assente: rischio per cessione/pensionamento.',
    ],
    normativa: [
      'DPR 137/2012 art. 5 — Obbligo RC professionale iscritti albi',
      'D.Lgs. 39/2010 — Revisione legale (responsabilità solidale con amministratori)',
      'L. 12/1979 — Consulenti del lavoro',
      'Statuto Ordini CNDCEC e CNO — Requisiti polizza RC',
      'Reg. UE 2016/679 (GDPR) — Trattamento dati clienti',
      'Art. 2946 c.c. — Prescrizione decennale',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 11) CONSULENZA AZIENDALE / MANAGEMENT CONSULTING (ATECO 70.22)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'consulenza_aziendale',
    label: 'Consulenza aziendale, management consulting, strategia',
    leva_commerciale:
      'Attività non regolamentata da albo, ma con contratti di consulenza che ' +
      'impongono clausole di indemnity verso committente. La RC Professionale ' +
      'generica è spesso inadeguata per consulenza M&A, ristrutturazione, ' +
      'IT consulting o consulenza fondi PNRR/UE.',
    match: {
      atecoRe: [/^7022/, /^70221/, /^70222/],
      keywordRe: [
        /\bconsulenza\s+(?:aziendal|direzional|strategic|organizzativ|manageriale|gestion)/,
        /\bmanagement\s+consulting/,
        /\bbusiness\s+consulting/,
        /\bstrategy\s+consulting/,
        /\bristrutturazione\s+aziendal/,
      ],
      excludeRe: [
        /\bconsulenza\s+(?:fiscal|tributari|legale|del\s+lavoro)/,
        /\bconsulenza\s+informatica/,
        /\bconsulenza\s+(?:marketing|comunicazion)/,
      ],
    },
    needs: [
      {
        id: 'eo_management_consulting',
        product: 'E&O Management Consulting (con clausole indemnity ampie)',
        target: 'Titolare / Partner',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'I contratti di consulenza con grandi committenti (industria, banche, PA) ' +
          'impongono indemnity reciproca, spesso con tetto pari o superiore al ' +
          'corrispettivo del progetto. Per consulenza M&A, ristrutturazione, due ' +
          'diligence, fondi PNRR, l\'esposizione supera abbondantemente la RC base.',
        why_now:
          'PNRR e gestione fondi UE 2021-2027: i progetti consulenziali hanno valori ' +
          'più alti e responsabilità documentali stringenti (revoca finanziamento se ' +
          'errori).',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
      {
        id: 'cyber_consulenza',
        product: 'Cyber Risk con copertura dati clienti e progetti riservati',
        target: 'Titolare / IT Manager',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'La consulenza tratta dati strategici riservati (business plan, M&A, ' +
          'numeri commerciali, IP). NDA e contratti impongono obblighi di sicurezza ' +
          'la cui violazione (anche colposa) genera responsabilità contrattuale.',
        why_now:
          'Le grandi committenti (banche, industria) impongono audit di cyber ' +
          'maturity come pre-condizione contrattuale.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'do_consulenza_partnership',
        product: 'D&O per società di consulenza con partnership',
        target: 'Soci / Partner',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Le società di consulenza con struttura partnership (SRL, STP, SAS) hanno ' +
          'amministratori e soci esposti a responsabilità verso soci, creditori e ' +
          'committenti. D&O dedicata protegge patrimonio personale.',
        why_now:
          'Strutture con partner che escono/entrano frequentemente espongono a ' +
          'contenzioso interno.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
    ],
    domande_broker: [
      'Quali sono le clausole di indemnity standard nei vostri contratti? La RC è dimensionata al valore del progetto più grande?',
      'Lavorate su fondi PNRR / Horizon Europe? Una rendicontazione errata o tardiva può causare revoca: chi risponde?',
      'Avete progetti M&A, ristrutturazione, due diligence in corso? Il massimale è adeguato?',
      'NDA con committenti hanno penali per data breach? La cyber le copre?',
      'La società è in partnership? Come è strutturata la D&O verso soci uscenti?',
      'Retroattività e postuma sono adeguate alla durata media dei progetti (3-5 anni)?',
    ],
    commercial_reasons: [
      'Contratti consulenziali con indemnity illimitata sempre più diffusi.',
      'PNRR/Horizon: revoca fondi per errori di rendicontazione = rivalsa diretta sul consulente.',
      'NDA con penali contrattuali specifiche su data breach.',
      'Partnership senza D&O dedicata = esposizione patrimonio personale soci.',
    ],
    normativa: [
      'Reg. UE 2021/241 (RRF/PNRR) — Obblighi rendicontazione fondi UE',
      'Reg. UE 2016/679 (GDPR) — Trattamento dati strategici clienti',
      'Art. 2392 c.c. / 2476 c.c. — Responsabilità amministratori',
      'Codice civile artt. 1218-1227 — Responsabilità contrattuale',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 12) VETERINARIA (ATECO 75.00)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'veterinaria',
    label: 'Studi veterinari, cliniche veterinarie',
    leva_commerciale:
      'Obbligo RC professionale ex DPR 137/2012 art. 5 + statuto FNOVI. Il veterinario ' +
      'risponde per malpractice clinica e per "animale in consegna" durante ' +
      'degenza/intervento. La RC professionale generica non copre adeguatamente la ' +
      'custodia dell\'animale (oggetto giuridico con valore affettivo ma trattato in ' +
      'parte come bene).',
    match: {
      atecoRe: [/^75/, /^7500/, /^75001/],
      keywordRe: [
        /\bveterinari/,
        /\bclinica\s+veterinaria/,
        /\bambulatorio\s+veterinari/,
        /\bospedale\s+veterinari/,
      ],
    },
    needs: [
      {
        id: 'rc_veterinario_malpractice',
        product: 'RC Professionale Veterinario con malpractice e animale in consegna',
        target: 'Titolare / Tutti i veterinari',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'DPR 137/2012 art. 5 obbliga la RC. La malpractice veterinaria è in ' +
          'crescita: il valore affettivo dell\'animale è sempre più riconosciuto dai ' +
          'tribunali con risarcimenti significativi anche per danno morale al ' +
          'proprietario. La copertura "animale in consegna" durante degenza ' +
          'chirurgica/post-operatoria è spesso esclusa dalla RC base.',
        why_now:
          'La giurisprudenza italiana 2020-2024 riconosce sempre più spesso il danno ' +
          'morale al proprietario in caso di morte/ferimento dell\'animale per ' +
          'negligenza veterinaria.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rc_struttura_clinica_vet',
        product: 'RC Struttura veterinaria (RCT) + property apparecchiature elettromedicali',
        target: 'Titolare clinica',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Cliniche e ambulatori hanno apparecchiature elettromedicali costose ' +
          '(ecografi, RX, anestesiologia) e ricevono animali e proprietari in struttura. ' +
          'RCT e property dedicata sono necessarie su valori reali, non sul fatturato.',
        why_now:
          'Strutture veterinarie sempre più tecnologiche; le apparecchiature ' +
          'rappresentano spesso il capitale principale.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rifiuti_sanitari_veterinari',
        product: 'RC Inquinamento per rifiuti sanitari veterinari',
        target: 'Titolare / RSPP',
        priority: 'media',
        confidence: 'media',
        sales_reason:
          'I rifiuti sanitari veterinari (taglienti, animali deceduti, farmaci scaduti) ' +
          'sono soggetti a DPR 254/2003. Gestione non conforme = sanzioni + ' +
          'responsabilità ambientale ex D.Lgs. 152/2006.',
        why_now:
          'Controlli ARPA su filiera smaltimento in aumento.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La RC copre esplicitamente "animale in consegna" durante degenza, intervento e post-operatorio?',
      'Massimale per sinistro è adeguato al danno morale riconosciuto dalla giurisprudenza recente (€10-50k tipici)?',
      'La struttura ha apparecchiature elettromedicali > €50k? Property dedicata su valori reali?',
      'Smaltite rifiuti sanitari ex DPR 254/2003 tramite ditta autorizzata? Avete documentazione FIR?',
      'Avete una pet sitter / pensione annessa? Coperture estese su ricovero non clinico?',
      'Personale: ASA/operatori e tecnici di laboratorio sono in RCO?',
    ],
    commercial_reasons: [
      'Giurisprudenza pro-animale in crescita: risarcimenti per danno morale sempre più frequenti.',
      'Apparecchiature elettromedicali di alto valore: property generica sotto-dimensionata.',
      'Rifiuti sanitari veterinari sotto controlli ARPA crescenti.',
    ],
    normativa: [
      'DPR 137/2012 art. 5 — Obbligo RC professionale iscritti albo',
      'DPR 254/2003 — Rifiuti sanitari (gestione e smaltimento)',
      'D.Lgs. 152/2006 — Responsabilità ambientale',
      'Reg. UE 2019/6 — Medicinali veterinari',
      'Codice deontologico FNOVI',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 13) IMMOBILIARE INTERMEDIAZIONE (ATECO 68.31)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'immobiliare_intermediazione',
    label: 'Agenzie immobiliari, intermediazione immobiliare',
    leva_commerciale:
      'Obbligo RC professionale ex L. 39/1989 art. 3 c. 5-bis + DM 26/10/2007 per ' +
      'agenti immobiliari iscritti al ruolo (oggi soppresso ma con requisiti ' +
      'trasferiti al REA). Errori di mediazione (informazioni omesse, vizi taciuti, ' +
      'titolarità non verificata) generano responsabilità verso entrambe le parti.',
    match: {
      atecoRe: [/^6831/, /^68311/, /^68312/],
      keywordRe: [
        /\bagenzia\s+immobiliar/,
        /\bmediazione\s+immobiliar/,
        /\bagente\s+immobiliar/,
      ],
      excludeRe: [/\bgestione\s+condomini/, /\bproperty\s+management/],
    },
    needs: [
      {
        id: 'rc_agente_immobiliare',
        product: 'RC Professionale Agente Immobiliare (DM 26/10/2007)',
        target: 'Titolare / Agenti iscritti',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'La L. 39/1989 art. 3 c. 5-bis e il DM 26/10/2007 impongono RC professionale ' +
          'obbligatoria per chi esercita mediazione immobiliare. L\'agente risponde ' +
          'verso entrambe le parti (acquirente e venditore) per errori di mediazione ' +
          '(art. 1759 c.c.), vizi taciuti, dichiarazioni urbanistiche non verificate.',
        why_now:
          'La giurisprudenza estende la responsabilità all\'agente anche per ' +
          'mancata verifica di abusi edilizi, conformità catastale e APE.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
      {
        id: 'tutela_legale_immobiliare',
        product: 'Tutela Legale per contenzioso mediazione',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Contenzioso ricorrente su provvigione contestata, vizi taciuti, ' +
          'risoluzione contratti. Costi legali e peritali elevati.',
        why_now:
          'Mercato immobiliare in fase di assestamento post-superbonus: contestazioni in aumento.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'crime_agenzia_immobiliare',
        product: 'Polizza Infedeltà dipendenti / Crime + cyber per pagamenti',
        target: 'Titolare',
        priority: 'media',
        confidence: 'media',
        sales_reason:
          'Agenzie gestiscono caparre, depositi, anticipi su rogito. Il rischio frode ' +
          'BEC (Business Email Compromise, bonifici dirottati) è documentato e in ' +
          'crescita nel settore.',
        why_now:
          'Truffe BEC sul settore immobiliare sono tra i casi più frequenti di ' +
          'cyber-crime ai danni di PMI italiane.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La RC copre verifica catastale, conformità urbanistica, APE, abusi edilizi (responsabilità estesa giurisprudenziale)?',
      'Trattate locazioni turistiche/brevi? La copertura include locazione (rischio diverso dalla vendita)?',
      'Gestite caparre o depositi di terzi? Avete polizza crime/infedeltà + cyber BEC?',
      'Avete franchising/collaboratori esterni? Le loro responsabilità sono in RCO/manleva?',
      'Lavorate su immobili commerciali / aste / espropri? Coperture specifiche?',
    ],
    commercial_reasons: [
      'Giurisprudenza ampliata: agente risponde per omessa verifica urbanistica/catastale/APE.',
      'BEC frauds (bonifici dirottati) in crescita nel settore.',
      'Locazioni brevi/turistiche: rischio nuovo non sempre coperto dalla RC vendita.',
    ],
    normativa: [
      'L. 39/1989 art. 3 c. 5-bis — Obbligo RC agente immobiliare',
      'DM 26/10/2007 — Massimali minimi RC mediazione',
      'Art. 1759 c.c. — Obbligo di informazione mediatore',
      'D.Lgs. 192/2005 (APE) — Attestato prestazione energetica',
      'L. 220/2012 — Riforma della disciplina condominiale (se gestione condominiale)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 14) GESTIONE RIFIUTI (ATECO 38-39)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'gestione_rifiuti',
    label: 'Gestione rifiuti, raccolta, trattamento, smaltimento, bonifiche',
    leva_commerciale:
      'Settore ad altissimo rischio ambientale e regolatorio. Iscrizione Albo Gestori ' +
      'Ambientali (D.Lgs. 152/2006 art. 212) richiede fideiussioni / polizze ' +
      'fideiussorie a garanzia degli obblighi. Responsabilità oggettiva per ' +
      'inquinamento e ripristino.',
    match: {
      atecoRe: [/^38/, /^39/, /^381/, /^382/, /^383/, /^390/],
      keywordRe: [
        /\bgestione\s+rifiuti/,
        /\braccolta\s+rifiuti/,
        /\btrattamento\s+rifiuti/,
        /\bsmaltimento\s+rifiuti/,
        /\brecupero\s+(?:di\s+)?materiali/,
        /\bbonifica\s+(?:di\s+)?sit/,
        /\bdecontaminaz/,
        /\bdiscarica\b/,
        /\bcompostaggio\b/,
      ],
    },
    needs: [
      {
        id: 'rc_inquinamento_gestori_rifiuti',
        product: 'RC Inquinamento Graduale + Accidentale + Bonifica sito',
        target: 'Titolare / Responsabile tecnico Albo',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'D.Lgs. 152/2006 (Codice Ambiente) impone responsabilità oggettiva per ' +
          'danno ambientale e obbligo di ripristino integrale. Iscrizione Albo ' +
          'Gestori Ambientali (art. 212) richiede garanzie finanziarie. La RC ' +
          'Inquinamento accidentale standard è inadeguata: serve graduale + bonifica ' +
          'sito su valori di ripristino reali.',
        why_now:
          'Direttiva UE 2024/1203 (Environmental Crime) inasprisce sanzioni penali. ' +
          'Controlli ARPA in costante aumento.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'polizze_fideiussorie_albo',
        product: 'Polizze fideiussorie iscrizione Albo Gestori Ambientali',
        target: 'Titolare',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'L\'iscrizione all\'Albo Gestori Ambientali (DM 120/2014) per categorie ' +
          'specifiche (1, 4, 5, 8, 9, 10) richiede prestazione di garanzie ' +
          'finanziarie (fideiussione assicurativa o bancaria). Senza, l\'attività ' +
          'è illecita.',
        why_now:
          'Aggiornamenti categoria e flussi rifiuti gestiti richiedono spesso ' +
          'incrementi del massimale fideiussorio.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rc_vettoriale_rifiuti_adr',
        product: 'RC Vettoriale + ADR per trasporto rifiuti',
        target: 'Responsabile logistica',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Trasporto rifiuti soggetto a CMR + ADR per rifiuti pericolosi (D.Lgs. ' +
          '35/2010). Necessari FIR, registro carico/scarico, Consulente Sicurezza ' +
          'Trasporti (DSA). Sinistro su carico = doppia responsabilità (vettoriale + ' +
          'inquinamento).',
        why_now:
          'Sistema RENTRI sostituisce SISTRI: nuovi obblighi documentali dal 2024-2025.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'A quali categorie Albo Gestori siete iscritti? Le fideiussioni in essere sono allineate ai volumi attuali?',
      'La RC Inquinamento copre il "graduale" oltre all\'accidentale? Include bonifica del sito?',
      'Trasportate rifiuti pericolosi ADR? Avete DSA e polizze allineate?',
      'Gestite stoccaggio temporaneo o messa in riserva (R13)? Property dedicata?',
      'Avete adesione RENTRI (D.M. 4/4/2023)? Procedure compatibili con le polizze?',
      'In caso di sub-conferimento a impianti terzi, la responsabilità solidale è coperta?',
    ],
    commercial_reasons: [
      'Albo Gestori = polizza fideiussoria obbligatoria, non opzionale.',
      'Direttiva UE 2024/1203 inasprisce sanzioni penali ambientali.',
      'Sistema RENTRI 2024-2025 introduce nuovi obblighi documentali.',
      'Bonifica sito può superare di multipli il fatturato annuo.',
    ],
    normativa: [
      'D.Lgs. 152/2006 art. 178-266 — Gestione rifiuti, art. 311 — Danno ambientale',
      'D.Lgs. 152/2006 art. 212 + DM 120/2014 — Albo Gestori Ambientali',
      'D.Lgs. 35/2010 — Accordo ADR rifiuti pericolosi',
      'DM 4/4/2023 (RENTRI) — Sistema di tracciabilità rifiuti',
      'Direttiva UE 2024/1203 — Environmental Crime (recepimento 2026)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 15) VIGILANZA PRIVATA / SICUREZZA (ATECO 80.1)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'vigilanza_privata',
    label: 'Vigilanza privata, sicurezza, trasporto valori, investigazioni',
    leva_commerciale:
      'Attività soggetta a licenza Prefettura (TULPS art. 134). Polizze obbligatorie ' +
      'a garanzia degli obblighi licenza, RC verso terzi e proprietà custodita. ' +
      'Uso armi (per GpG) impone copertura specifica su responsabilità dolosa/colposa.',
    match: {
      atecoRe: [/^80/, /^801/, /^8010/, /^802/, /^803/],
      keywordRe: [
        /\bvigilanza\s+(?:privata|armata|fissa|mobile)/,
        /\bistituto\s+di\s+vigilanza/,
        /\bguardia\s+(?:giurat|particolare\s+giurat)/,
        /\btrasporto\s+valor/,
        /\binvestigaz/,
        /\bservizi\s+di\s+sicurezza\s+privat/,
      ],
    },
    needs: [
      {
        id: 'rc_vigilanza_armi',
        product: 'RC Istituto Vigilanza + uso armi GpG',
        target: 'Titolare / Direttore tecnico',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'TULPS art. 134 + DM 269/2010 (riforma vigilanza privata) impongono ' +
          'licenza Prefettura con garanzie. Le GpG portano armi: in caso di uso ' +
          'colposo (sparo accidentale, errore di valutazione) e doloso (eccesso di ' +
          'difesa), l\'istituto risponde solidalmente. RC specifica obbligatoria.',
        why_now:
          'Sentenze recenti riconoscono responsabilità dell\'istituto anche per ' +
          'azioni eccessive della GpG in servizio.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'trasporto_valori_kasko',
        product: 'Polizza trasporto valori (denaro, gioielli, valori) + Kasko mezzi blindati',
        target: 'Responsabile operativo',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Trasporto valori espone a rapina e furto con massimali tipicamente elevati. ' +
          'Mezzi blindati hanno costo unitario significativo: Kasko dedicato + RC ' +
          'auto specifica sono necessari.',
        why_now:
          'Aumento sinistri trasporto valori in alcune regioni del Sud Italia.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'crime_vigilanza_chiavi',
        product: 'Polizza Crime (chiavi e codici clienti)',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Vigilanza fissa/mobile detiene chiavi, codici allarme e badge dei clienti. ' +
          'Furto da parte di GpG o terzi indotti = rischio strutturale non coperto da RCT.',
        why_now:
          'Clienti bancari/lusso impongono crime cover come requisito contrattuale.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'Avete licenza Prefettura attiva? Le garanzie a corredo licenza sono aggiornate?',
      'Quante GpG operative armate avete? La RC copre uso armi (colposo + doloso) con massimali adeguati?',
      'Fate trasporto valori? Massimale per spedizione e Kasko blindati sono dimensionati?',
      'Vigilanza fissa presso banche / gioiellerie / lusso? Crime cover e clausole specifiche del committente?',
      'Avete centrale operativa? Cyber coverage su sistemi di allarme remoti (rischio NIS2)?',
      'Investigazioni private (D.Lgs. 196/2003 + GDPR): copertura su trattamento dati indagine?',
    ],
    commercial_reasons: [
      'TULPS + DM 269/2010 rendono polizze condizione di licenza Prefettura.',
      'Responsabilità solidale istituto per azioni GpG: rischio dolo non sempre coperto.',
      'Clienti bancari/lusso impongono crime cover come requisito.',
      'Centrali operative sotto perimetro NIS2 in casi di infrastrutture critiche.',
    ],
    normativa: [
      'R.D. 773/1931 (TULPS) art. 133-141-bis — Licenze vigilanza',
      'DM 269/2010 — Riforma istituti vigilanza privata',
      'DPR 153/2008 — Regolamento esecuzione TULPS vigilanza',
      'D.Lgs. 138/2024 (NIS2) — Cybersecurity centrali operative critiche',
      'Reg. UE 2016/679 (GDPR) — Trattamento dati investigazioni',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 16) SOMMINISTRAZIONE LAVORO / AGENZIE PER IL LAVORO (ATECO 78.2/78.3)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'somministrazione_lavoro',
    label: 'Agenzie per il lavoro, somministrazione, ricerca e selezione',
    leva_commerciale:
      'Attività autorizzata Ministero del Lavoro (D.Lgs. 276/2003): cauzione e ' +
      'polizza fideiussoria sono requisiti dell\'autorizzazione. L\'agenzia è ' +
      'solidalmente responsabile con l\'utilizzatore per retribuzioni, contributi e ' +
      'infortuni dei lavoratori somministrati.',
    match: {
      atecoRe: [/^78/, /^782/, /^7820/, /^783/, /^7830/, /^781/, /^7810/],
      keywordRe: [
        /\bsomministrazione\s+(?:di\s+)?lavoro/,
        /\bagenzia\s+per\s+il\s+lavoro/,
        /\bagenzia\s+di\s+lavoro\s+interinal/,
        /\bricerca\s+(?:e\s+)?selezione\s+(?:del\s+)?personale/,
        /\bsearch\s+(?:&|and)\s+select/,
        /\bheadhunt/,
      ],
    },
    needs: [
      {
        id: 'fideiussione_ApL',
        product: 'Polizza fideiussoria autorizzazione ApL (D.Lgs. 276/2003 art. 4-5)',
        target: 'Titolare',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'L\'autorizzazione Ministero del Lavoro per ApL richiede cauzione ' +
          'fideiussoria a garanzia degli obblighi verso lavoratori e INPS/INAIL. ' +
          'Senza, l\'autorizzazione decade.',
        why_now:
          'Rinnovi e adeguamenti del massimale fideiussorio in base ai volumi ' +
          'somministrati richiedono attenzione costante.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rc_somministrazione_solidale',
        product: 'RC Somministrazione + RC Patrimoniale per responsabilità solidale',
        target: 'Titolare / Legale',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'D.Lgs. 276/2003 art. 23 prevede responsabilità solidale dell\'ApL con ' +
          'l\'utilizzatore per retribuzioni, contributi, infortuni dei lavoratori ' +
          'somministrati. La giurisprudenza recente di Cassazione conferma e amplia ' +
          'la solidarietà anche su danni da infortunio sul lavoro.',
        why_now:
          'Aumento dei contenziosi su corretto inquadramento e CCNL applicato; ' +
          'rischio rivalsa INPS/INAIL per omissioni dell\'utilizzatore.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'cyber_recruiting',
        product: 'Cyber Risk + GDPR per piattaforme di selezione e CV',
        target: 'Titolare / DPO',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'L\'agenzia detiene database di candidati (anche dati sensibili: salute, ' +
          'sindacale). Profilazione, ATS, screening automatizzato espongono a ' +
          'sanzioni GDPR (art. 22 — decisioni automatizzate).',
        why_now:
          'AI Act UE 2024/1689: i sistemi di selezione automatizzata sono ' +
          'classificati ad alto rischio dal 2026.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'Le fideiussioni Ministeriali sono allineate ai volumi somministrati correnti?',
      'La RC copre la responsabilità solidale ex art. 23 D.Lgs. 276/2003 anche per infortuni?',
      'Trattate dati sanitari/sindacali in selezione? Avete impact assessment GDPR e copertura per data breach?',
      'Usate ATS/screening AI per selezione? AI Act 2026: sistemi ad alto rischio coperti?',
      'Avete contestazioni in corso su CCNL applicato o livelli inquadramento? Tutela legale lavoro adeguata?',
    ],
    commercial_reasons: [
      'Fideiussioni ministeriali = requisito di autorizzazione, non opzionale.',
      'Solidarietà ApL/utilizzatore estesa anche agli infortuni dalla giurisprudenza Cassazione recente.',
      'AI Act 2026 classifica i sistemi di selezione come "ad alto rischio".',
      'Database candidati con dati sensibili = target preferito di data breach.',
    ],
    normativa: [
      'D.Lgs. 276/2003 — Disciplina occupazione e ApL',
      'D.Lgs. 276/2003 art. 23 — Responsabilità solidale ApL/utilizzatore',
      'D.Lgs. 81/2015 — Disciplina contratti di lavoro',
      'Reg. UE 2016/679 (GDPR) art. 22 — Decisioni automatizzate',
      'Reg. UE 2024/1689 (AI Act) — Sistemi AI ad alto rischio (in vigore 2026)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 17) NOLEGGIO (ATECO 77)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'noleggio',
    label: 'Noleggio veicoli, attrezzature, beni di consumo',
    leva_commerciale:
      'L\'azienda è proprietaria dei beni noleggiati: i beni sono al contempo asset ' +
      '(da proteggere) e oggetto di responsabilità verso il noleggiatore (uso, danni, ' +
      'sinistri durante il noleggio). RCA flotta, kasko e danni del conduttore sono ' +
      'tutti aspetti da coordinare.',
    match: {
      atecoRe: [/^77/, /^771/, /^7711/, /^7712/, /^7721/, /^7722/, /^7729/, /^773/, /^7733/, /^7734/, /^7735/, /^7739/],
      keywordRe: [
        /\bnoleggio\b/,
        /\brent\s+a\s+car/,
        /\bautoleggio/,
        /\bleasing\s+operativo/,
        /\bnoleggio\s+(?:auto|veicoli|attrezzatur|macchinari|mezzi|imbarcazion)/,
      ],
      excludeRe: [/\bleasing\s+finanziario/],
    },
    needs: [
      {
        id: 'flotta_libro_matricola',
        product: 'Polizza Flotta Libro Matricola con copertura conducente terzo',
        target: 'Titolare / Direttore operativo',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'I veicoli a noleggio sono guidati da terzi (clienti) tipicamente non ' +
          'identificabili in anticipo. Serve polizza flotta "libro matricola" con ' +
          'clausola "conducente terzo" anche occasionale, kasko e furto. Senza, ' +
          'in caso di sinistro con conducente non dichiarato la copertura può essere ' +
          'rifiutata.',
        why_now:
          'Le piattaforme di mobilità (short-term, peer-to-peer) hanno aumentato la ' +
          'rotazione conducenti e la complessità contrattuale.',
        evidence_ids: ['codice_ateco', 'ha_flotta_veicoli'],
      },
      {
        id: 'rc_noleggiatore_custodia',
        product: 'RC Noleggiatore + danni al bene noleggiato',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Art. 1571 e seg. c.c. (locazione) e art. 2051 c.c. (custodia): il ' +
          'noleggiatore risponde per vizi e cattivo funzionamento del bene. Allo ' +
          'stesso tempo, deve recuperare danni dal conduttore (franchigia conduttore, ' +
          'CDW, deposito cauzionale). Polizze dedicate disciplinano entrambi i lati.',
        why_now:
          'Contenzioso ricorrente su franchigie e danni non dichiarati alla ' +
          'restituzione: clausole chiare in polizza riducono il rischio.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'crime_bec_noleggio',
        product: 'Cyber + BEC su pagamenti e depositi cauzionali',
        target: 'Titolare',
        priority: 'media',
        confidence: 'media',
        sales_reason:
          'Prenotazioni online, depositi cauzionali, pagamenti carta espongono a ' +
          'frodi BEC e cyber. Inoltre i dati patente/documenti dei clienti sono ' +
          'tipologia GDPR sensibile.',
        why_now:
          'Frodi su carte e dirottamento bonifici in crescita nel settore.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'La flotta è in libro matricola con conducente terzo anche occasionale? Kasko e furto inclusi?',
      'Le franchigie conduttore (CDW) e i depositi cauzionali sono allineati al valore medio dei beni noleggiati?',
      'Trattate dati patente/documenti: tutto via portale crittografato? Cyber/GDPR coverage adeguata?',
      'Avete contratti con piattaforme P2P o intermediari? Le responsabilità solidali sono in polizza?',
      'Per noleggio attrezzature professionali (carrelli, gru, macchine): RC Operatore terzo + danno bene incluso?',
    ],
    commercial_reasons: [
      'Conducente terzo: senza clausola specifica la polizza non risponde.',
      'Libro matricola consente gestione efficiente di flotte variabili.',
      'BEC frauds: settore con alta digitalizzazione pagamenti.',
      'Dati patente/carte = GDPR sensibile.',
    ],
    normativa: [
      'Codice Civile artt. 1571-1606 — Locazione di cose',
      'Codice Civile art. 2051 — Responsabilità da custodia',
      'D.Lgs. 209/2005 — Codice Assicurazioni (RCA)',
      'Reg. UE 2016/679 (GDPR) — Dati patente e documenti',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 18) TRASPORTO PASSEGGERI (ATECO 49.3, 50.x)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'trasporto_passeggeri',
    label: 'Trasporto passeggeri (urbano, extraurbano, taxi, NCC, autolinee)',
    leva_commerciale:
      'Trasporto persone: RC Auto specifica + RC viaggiatori trasportati (art. 2054 ' +
      'c.c. e Convenzione di Vienna per trasporto stradale internazionale). Massimali ' +
      'minimi RCA per trasporto persone elevati (D.Lgs. 209/2005).',
    match: {
      atecoRe: [/^493/, /^4931/, /^4932/, /^4939/, /^501/, /^503/],
      keywordRe: [
        /\btrasporto\s+(?:di\s+)?passegger/,
        /\bautolinee\b/,
        /\bautonoleggio\s+con\s+conducente/,
        /\bN\.?C\.?C\.?\b/,
        /\bservizio\s+taxi/,
        /\btrasporto\s+(?:scolastic|turistic|gran\s+turism)/,
        /\bnavetta\s+aeroport/,
      ],
    },
    needs: [
      {
        id: 'rca_trasporto_passeggeri',
        product: 'RCA Trasporto Passeggeri con massimali maggiorati + RC viaggiatori',
        target: 'Titolare / Responsabile flotta',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'D.Lgs. 209/2005 art. 128 fissa massimali minimi RCA: per trasporto ' +
          'persone i livelli sono in costante revisione UE e spesso il minimo non è ' +
          'commercialmente sostenibile in caso di sinistro multi-passeggero. ' +
          'Art. 2054 c.c. + art. 1681 c.c. impongono responsabilità del vettore ' +
          'verso passeggeri trasportati.',
        why_now:
          'Direttiva UE 2021/2118 (Motor Insurance Directive) ha rivisto al rialzo i ' +
          'massimali minimi RCA dal 2023. Verifica necessaria.',
        evidence_ids: ['codice_ateco', 'ha_flotta_veicoli'],
      },
      {
        id: 'tutela_legale_trasporto',
        product: 'Tutela Legale + RC Conducente in caso di colpa grave',
        target: 'Titolare / Conducenti',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Procedimenti penali al conducente in caso di lesioni gravi/omicidio ' +
          'stradale (L. 41/2016): difesa tecnica costosa e non sempre inclusa in RCA. ' +
          'Inoltre rivalsa dell\'assicuratore in caso di colpa grave del conducente.',
        why_now:
          'L. 41/2016 (omicidio stradale) inasprisce sanzioni e procedimenti penali.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'flotta_kasko_trasporto',
        product: 'Kasko / Furto / Incendio flotta',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Veicoli di alto valore (NCC business, bus turistici, autobus elettrici/ibridi) ' +
          'richiedono Kasko su valore effettivo. Furto incluso per parcheggi notturni.',
        why_now:
          'Costo dei mezzi nuovi (specialmente elettrici/ibridi) molto aumentato ' +
          'post-2022: revisione dei valori assicurati necessaria.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'Massimali RCA sono aggiornati alla revisione Direttiva UE 2021/2118?',
      'RC viaggiatori trasportati è esplicitamente in polizza con massimale cumulato adeguato (es. bus 50 posti)?',
      'I conducenti hanno copertura difesa penale per omicidio stradale (L. 41/2016) e colpa grave?',
      'Veicoli elettrici/ibridi: il valore assicurato è aggiornato al costo di sostituzione attuale?',
      'Fate trasporto scolastico/disabili? Coperture e clausole specifiche del committente pubblico?',
      'Trasporto internazionale: Carta Verde + Convenzione di Vienna allineate?',
    ],
    commercial_reasons: [
      'Massimali RCA minimi rivisti al rialzo dal 2023 (UE 2021/2118).',
      'Omicidio stradale (L. 41/2016): difesa penale conducenti spesso non coperta.',
      'Veicoli elettrici/ibridi: valori assicurati spesso obsoleti.',
      'Trasporto scolastico/disabili: capitolati pubblici con clausole specifiche.',
    ],
    normativa: [
      'D.Lgs. 209/2005 art. 128 — Massimali minimi RCA',
      'Direttiva UE 2021/2118 — Revisione Motor Insurance Directive',
      'Art. 2054 c.c. — Circolazione veicoli',
      'Art. 1681 c.c. — Responsabilità vettore verso passeggeri',
      'L. 41/2016 — Omicidio stradale',
      'L. 21/1992 — Disciplina trasporto persone non di linea (taxi, NCC)',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 19) MAGAZZINAGGIO / LOGISTICA (ATECO 52.1, 52.29)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'magazzinaggio_logistica',
    label: 'Magazzinaggio, logistica, depositi, spedizionieri',
    leva_commerciale:
      'L\'azienda detiene merci di terzi in deposito (art. 1766 c.c.) o organizza il ' +
      'trasporto come spedizioniere (art. 1737 c.c.). Responsabilità per integrità, ' +
      'conservazione, riconsegna delle merci con limiti spesso inadeguati al valore ' +
      'reale stoccato.',
    match: {
      atecoRe: [/^521/, /^5210/, /^5229/, /^52291/, /^52292/, /^52293/],
      keywordRe: [
        /\bmagazzinaggio\b/,
        /\blogistica\b/,
        /\bdeposito\s+(?:merci|conto\s+terzi)/,
        /\bspedizionier/,
        /\bspedizioni\s+(?:internazional|conto\s+terzi)/,
        /\b3PL\b/,
        /\b4PL\b/,
        /\bfreight\s+forward/,
      ],
      excludeRe: [/\bcorriere\s+espresso/, /\bautotrasport/],
    },
    needs: [
      {
        id: 'rc_depositario',
        product: 'RC Depositario / Custodia merci in conto terzi (art. 1766 c.c.)',
        target: 'Titolare / Responsabile magazzino',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Art. 1766-1781 c.c. disciplina il deposito: il depositario risponde della ' +
          'conservazione della merce con diligenza professionale. Massimale per ' +
          'ubicazione e per evento va dimensionato sul valore medio merci stoccate, ' +
          'non sul valore immobile. Eventi tipici: incendio, allagamento, furto, ' +
          'errore di prelievo/spedizione, scarto difettoso.',
        why_now:
          'Aumento dei contratti 3PL/4PL con clausole di responsabilità ampia verso ' +
          'l\'industria committente.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rc_spedizioniere',
        product: 'RC Spedizioniere (art. 1737 c.c.) + RC vettoriale subvettori',
        target: 'Titolare',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Lo spedizioniere risponde della scelta del vettore (culpa in eligendo) e ' +
          'dei subvettori. Per spedizioni internazionali: CMR (D.Lgs. ratifica L. ' +
          '1621/1960), Convenzione di Montreal (aereo), Regole dell\'Aja-Visby ' +
          '(marittimo). Polizze coordinate sono spesso assenti o sotto-dimensionate.',
        why_now:
          'Supply chain post-COVID con rotazione vettori più alta: rischio culpa in ' +
          'eligendo aumentato.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'cyber_warehouse_wms',
        product: 'Cyber Risk + BI per WMS/TMS bloccati',
        target: 'Titolare / IT Manager',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Il WMS (Warehouse Management System) e il TMS (Transport Management ' +
          'System) sono critici: un fermo blocca picking, spedizioni, fatturazione. ' +
          'L\'industria committente (automotive, GDO, pharma) applica penali ' +
          'contrattuali per ritardi.',
        why_now:
          'Settore logistico è target frequente di ransomware mirato (l\'attaccante ' +
          'sa che il fermo è insostenibile e si paga il riscatto).',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'Qual è il valore medio merci in deposito per ubicazione? Massimali RC depositario allineati?',
      'I clienti hanno polizze proprie sulle loro merci? Coordinamento o doppia copertura?',
      'Per spedizioni internazionali, le polizze sono in regime CMR / Convenzione Montreal / Aja-Visby?',
      'WMS/TMS: provider, jurisdiction, backup, RTO/RPO? Cyber + BI con costi penali contrattuali?',
      'Le clausole con il committente includono indemnity ampie? Massimale dimensionato?',
      'Stoccate merci pericolose ADR o regolamentate (alcolici, tabacchi, farmaci, alimentari)? Coperture e autorizzazioni?',
    ],
    commercial_reasons: [
      'Contratti 3PL/4PL con responsabilità ampia verso industria.',
      'Internazionalizzazione = molteplici regimi (CMR, Montreal, Aja-Visby).',
      'Penali contrattuali per ritardi: cyber + BI necessari.',
      'Merci pericolose/regolamentate: coperture specifiche.',
    ],
    normativa: [
      'Codice Civile artt. 1766-1781 — Deposito',
      'Codice Civile artt. 1737-1741 — Spedizione',
      'Convenzione CMR — Trasporto stradale internazionale',
      'Convenzione di Montreal 1999 — Trasporto aereo',
      'Regole dell\'Aja-Visby — Trasporto marittimo',
      'D.Lgs. 286/2005 — Autotrasporto conto terzi',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 20) CALL CENTER / SERVIZI AMMINISTRATIVI ESTERNALIZZATI (ATECO 82)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'call_center_bpo',
    label: 'Call center, BPO, servizi amministrativi esternalizzati',
    leva_commerciale:
      'Trattamento massivo di dati clienti del committente come responsabile del ' +
      'trattamento (art. 28 GDPR). Il rischio sanzionatorio e di rivalsa contrattuale ' +
      'è strutturale e largamente sotto-stimato.',
    match: {
      atecoRe: [/^82/, /^821/, /^8211/, /^8219/, /^822/, /^8220/, /^8291/, /^8299/],
      keywordRe: [
        /\bcall\s+center/,
        /\bcontact\s+center/,
        /\bBPO\b/,
        /\bbusiness\s+process\s+outsourcing/,
        /\boutsourcing\s+amministrativ/,
        /\bservizi\s+amministrativ/,
        /\btelemarketing/,
      ],
    },
    needs: [
      {
        id: 'gdpr_responsabile_trattamento',
        product: 'Cyber Risk + GDPR Responsabile del Trattamento (art. 28-32 GDPR)',
        target: 'Titolare / DPO',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'L\'azienda è Responsabile del Trattamento per conto del committente (art. ' +
          '28 GDPR). Sanzioni dirette fino a €20 mln o 4% fatturato. Inoltre i ' +
          'contratti DPA (Data Processing Agreement) impongono indemnity verso il ' +
          'titolare per ogni breach o violazione di sicurezza (art. 32 GDPR).',
        why_now:
          'Garante italiano ha intensificato sanzioni a call center per ' +
          'telemarketing molesto e violazioni GDPR (sanzioni nel 2023-2024 oltre €50 mln).',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'rc_telemarketing_AGCOM',
        product: 'RC Professionale Telemarketing + sanzioni AGCOM/Garante',
        target: 'Titolare',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Registro Pubblico delle Opposizioni (DPR 178/2010), Codice della ' +
          'Privacy + GDPR, AGCOM: violazioni in telemarketing comportano sanzioni ' +
          'cumulative dirette. La RC Professionale generica non copre le sanzioni ' +
          'pecuniarie amministrative.',
        why_now:
          'L\'estensione del Registro Pubblico delle Opposizioni ai numeri di cellulare ' +
          'introdotta nel 2022 ha inasprito controlli e sanzioni.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'do_call_center',
        product: 'D&O per amministratori società di servizi BPO',
        target: 'Amministratori',
        priority: 'alta',
        confidence: 'media',
        sales_reason:
          'Multe Garante/AGCOM possono colpire direttamente amministratori per ' +
          'omessa vigilanza. D&O dedicata protegge patrimonio personale.',
        why_now:
          'Sanzioni a società ed amministratori sono in crescita.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
    ],
    domande_broker: [
      'Avete DPA (Data Processing Agreement) sottoscritti con tutti i committenti? Le indemnity sono coperte?',
      'Trattate dati sensibili (sanità, banche, telco)? Coperture e clausole speciali?',
      'Fate telemarketing? Procedure di check su RPO aggiornate dopo l\'estensione 2022 ai cellulari?',
      'Le sanzioni Garante/AGCOM ai vostri operatori sono trasferibili a polizza?',
      'Avete attività offshoring (es. operatori in paesi extra-UE)? Transfer impact assessment GDPR?',
      'In caso di data breach su lista del committente, chi notifica e chi sostiene i costi di rimedio?',
    ],
    commercial_reasons: [
      'GDPR sanzioni dirette fino al 4% del fatturato + rivalsa contrattuale.',
      'DPA con indemnity sempre più stringenti dalle grandi aziende.',
      'Estensione 2022 del Registro Pubblico delle Opposizioni anche ai cellulari.',
      'Sanzioni Garante a call center in crescita esponenziale 2023-2024.',
    ],
    normativa: [
      'Reg. UE 2016/679 (GDPR) artt. 28-32, 82-84 — Responsabile trattamento, sicurezza, sanzioni',
      'D.Lgs. 196/2003 (Codice Privacy) — Coordinamento con GDPR',
      'DPR 178/2010 + aggiornamento 2022 (estensione RPO ai numeri cellulari) — Registro Pubblico delle Opposizioni',
      'L. 5/2018 — Disposizioni in materia di tutela del consumatore',
      'Delibere AGCOM 86/21/CONS — Controlli telemarketing',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 21) INTERMEDIARI FINANZIARI E ASSICURATIVI (ATECO 66)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'intermediari_finanziari',
    label: 'Intermediari finanziari, assicurativi, broker, agenti',
    leva_commerciale:
      'Settore vigilato: IVASS per intermediari assicurativi (Reg. 40/2018), Banca ' +
      'd\'Italia/OAM per mediatori creditizi (D.Lgs. 141/2010), CONSOB per ' +
      'consulenti finanziari (D.Lgs. 58/1998 TUF). RC professionale è OBBLIGATORIA ' +
      'per legge come condizione di iscrizione al registro/albo.',
    match: {
      atecoRe: [/^66/, /^661/, /^662/, /^6621/, /^6622/, /^6629/, /^663/, /^6630/],
      keywordRe: [
        /\bbroker\s+(?:assicurativ|finanziar|crediti)/,
        /\bagenzia\s+(?:assicurativa|generale)/,
        /\bagente\s+assicurativ/,
        /\bsubagente\b/,
        /\bmediatore\s+(?:assicurativ|crediti|del\s+credito)/,
        /\bconsulente\s+finanziar/,
        /\bpromotore\s+finanziar/,
        /\bintermediar[ie]\s+(?:assicurativ|finanziar|crediti)/,
      ],
    },
    needs: [
      {
        id: 'rc_intermediario_ivass',
        product: 'RC Professionale Intermediario Assicurativo (Reg. IVASS 40/2018)',
        target: 'Titolare / Iscritto RUI',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'D.Lgs. 209/2005 art. 112 + Reg. IVASS 40/2018 impongono RC professionale ' +
          'obbligatoria per gli iscritti al RUI con massimale minimo definito da IVASS ' +
          'e periodicamente aggiornato. Senza copertura conforme, l\'iscrizione RUI ' +
          'è sospesa.',
        why_now:
          'IVASS aggiorna periodicamente i massimali minimi: verificare allineamento alla soglia corrente.',
        evidence_ids: ['codice_ateco', 'forma_giuridica'],
      },
      {
        id: 'rc_mediatore_creditizio',
        product: 'RC Professionale Mediatore Creditizio (D.Lgs. 141/2010)',
        target: 'Titolare / Iscritto OAM',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'D.Lgs. 141/2010 art. 128-novies + Regolamento OAM impongono RC ' +
          'professionale obbligatoria per mediatori creditizi e agenti in attività ' +
          'finanziaria. L\'OAM verifica annualmente.',
        why_now:
          'Aggiornamenti normativi OAM e Banca d\'Italia su requisiti e parametri.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'crime_intermediari',
        product: 'Polizza Crime / Infedeltà collaboratori + cyber',
        target: 'Titolare',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Gli intermediari movimentano premi/conti correnti (separati per D.Lgs. ' +
          '209/2005 art. 117). Rischio infedeltà collaboratori, frode cyber su ' +
          'movimentazioni, BEC. Non coperto da RC professionale.',
        why_now:
          'IVASS ha pubblicato linee guida specifiche su controlli antifrode e ' +
          'sicurezza informatica per intermediari.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'I massimali RC sono allineati alle soglie IVASS / OAM aggiornate alla data corrente?',
      'Avete conti separati premi (D.Lgs. 209/2005 art. 117)? Procedure crime/cyber per movimentazioni?',
      'I collaboratori (subagenti, sub-mediatori) hanno coperture estese o personali?',
      'Retroattività e postuma adeguate? Per cessazione attività la postuma è essenziale.',
      'Distribuzione digitale (IDD): la cyber copre violazioni in vendita online e profilazione?',
      'In caso di mis-selling, le sanzioni IVASS sono trasferibili a polizza?',
    ],
    commercial_reasons: [
      'RC professionale = requisito di iscrizione RUI/OAM, non opzionale.',
      'Massimali IVASS soggetti a revisione: rischio di sotto-copertura sopravvenuta.',
      'Conti premi separati = target di frode cyber/BEC.',
      'Distribuzione digitale (IDD) introduce nuovi rischi.',
    ],
    normativa: [
      'D.Lgs. 209/2005 (Codice delle Assicurazioni) art. 112-117',
      'Reg. IVASS 40/2018 — Distribuzione assicurativa (IDD)',
      'D.Lgs. 141/2010 — Mediatori creditizi, agenti in attività finanziaria',
      'D.Lgs. 58/1998 (TUF) — Consulenti finanziari',
      'D.Lgs. 231/2007 — Antiriciclaggio',
      'Direttiva UE 2016/97 (IDD) — Distribuzione assicurativa',
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // 8) RESTAURO BENI CULTURALI (ATECO 90.03.02 + 43.39 specifico)
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'restauro_beni_culturali',
    label: 'Restauro beni culturali, opere d\'arte, monumenti, archivi',
    leva_commerciale:
      'Attività su beni di valore unico e insostituibile (opere d\'arte, monumenti, ' +
      'archivi, libri antichi). Il restauratore risponde secondo il Codice dei Beni ' +
      'Culturali (D.Lgs. 42/2004) e nei contratti MiBAC/MiC con clausole di ' +
      'indemnity specifiche. La RC Professionale generica e la CAR/EAR non coprono ' +
      'bene il "danno all\'opera durante l\'intervento".',
    match: {
      atecoRe: [/^9003/, /^90032/, /^910/, /^91020/, /^91030/],
      keywordRe: [
        /\brestaur(?:o|atore)\s+(?:opere|beni|monument|dipint|statu|affresch|libr|archiv)/,
        /\bconservazione\s+(?:beni\s+culturali|opere\s+d['e]arte|monument)/,
        /\brestauratore\s+(?:di\s+)?beni\s+culturali/,
        /\bconservator[eio]\s+(?:di\s+)?museo/,
        /\bgalleri[ae]\s+d['e]arte\s+restaur/,
      ],
      excludeRe: [
        /\brestauro\s+(?:auto|mobili\s+moderni|case|appartament)/,
        /\bristrutturazione\s+edilizia/,
      ],
    },
    needs: [
      {
        id: 'rc_restauratore_opera',
        product: 'RC Restauratore beni culturali + All Risks opera',
        target: 'Restauratore / Titolare studio',
        priority: 'immediata',
        confidence: 'alta',
        sales_reason:
          'Il D.Lgs. 42/2004 (Codice Beni Culturali) e i capitolati MiC richiedono ' +
          'copertura specifica per "danno all\'opera durante intervento" con massimale ' +
          'dichiarato a valore d\'opera. La RC Professionale generica NON copre il ' +
          'danno materiale all\'opera in lavorazione. Serve una All Risks dedicata ' +
          'per il periodo di intervento (trasporto + permanenza in studio + restituzione).',
        why_now:
          'Il MiC e la Soprintendenza non autorizzano interventi senza polizza ' +
          'conforme; la mancanza blocca la cantierizzazione.',
        evidence_ids: ['codice_ateco', 'descrizione_ateco'],
      },
      {
        id: 'trasporto_opere_arte',
        product: 'Polizza trasporto opere d\'arte (nail-to-nail)',
        target: 'Titolare / Spedizioniere',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Il trasporto di beni culturali è la fase di massimo rischio (caduta, urti, ' +
          'variazioni termo-igrometriche). Le polizze "nail-to-nail" (chiodo-a-chiodo) ' +
          'coprono l\'opera dall\'asportazione dalla sede d\'origine fino al ' +
          'riposizionamento dopo l\'intervento.',
        why_now:
          'I prestiti per mostre e i trasporti cross-border richiedono polizze ' +
          'state indemnity o commercial nail-to-nail come condizione di movimento.',
        evidence_ids: ['codice_ateco'],
      },
      {
        id: 'property_laboratorio_restauro',
        product: 'Property Laboratorio con valore opere in consegna',
        target: 'Titolare',
        priority: 'alta',
        confidence: 'alta',
        sales_reason:
          'Nel laboratorio ci sono spesso opere di clienti/enti pubblici di valore ' +
          'milionario. La property standard limita fortemente "cose di terzi in ' +
          'consegna" e ha massimali inadeguati al valore reale detenuto.',
        why_now:
          'Incendio, allagamento, furto nel laboratorio: il danno sulle opere può ' +
          'superare il valore assicurato dell\'immobile. Massimale va tarato sul ' +
          'valore medio opere presenti, non sul valore laboratorio.',
        evidence_ids: ['codice_ateco'],
      },
    ],
    domande_broker: [
      'Qual è il valore medio e massimo delle opere in consegna nel laboratorio? La property ha massimale "cose di terzi in consegna" adeguato?',
      'I contratti MiC/Soprintendenza/privati hanno clausole di indemnity e richiedono polizze specifiche? Quali massimali chiedono?',
      'Fate trasporti di opere? Avete polizza nail-to-nail con condizioni termo-igrometriche in policy?',
      'Lavorate su opere di pregio internazionale (prestiti, mostre)? Serve state indemnity o commercial cover multilocale?',
      'Usate prodotti chimici/solventi nel restauro? RC per danno all\'opera da prodotto utilizzato c\'è?',
      'Avete un inventario fotografico pre-intervento e post-intervento delle opere? È condizione di polizza in caso di sinistro.',
    ],
    commercial_reasons: [
      'Opere in consegna di valore milionario: property standard sotto-dimensionata.',
      'Capitolati MiC richiedono polizze specifiche come condizione di autorizzazione.',
      'Trasporti nail-to-nail sono la fase di massimo rischio e richiedono polizza dedicata.',
      'Danno da prodotto di restauro spesso non coperto dalla RC Professionale base.',
    ],
    normativa: [
      'D.Lgs. 42/2004 (Codice dei Beni Culturali e del Paesaggio)',
      'Disciplinari MiC — Qualificazione restauratori beni culturali (D.Lgs. 42/2004 art. 29 e decreti attuativi)',
      'D.Lgs. 50/2016 + D.Lgs. 36/2023 — Appalti pubblici beni culturali (cat. OG2, OS2)',
      'L. 77/2006 — Misure speciali tutela patrimonio UNESCO',
      'Capitolati tipo MiC / Soprintendenze — Clausole assicurative standard',
    ],
  },

]
