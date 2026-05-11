/**
 * Mapping ATECO → Obblighi e raccomandazioni assicurative
 * Fonte: normativa italiana vigente, prassi IVASS, INAIL
 * 
 * Ogni settore ATECO ha polizze OBBLIGATORIE per legge e polizze RACCOMANDATE
 * Classe INAIL: determina il tasso di premio per infortuni
 */

export interface AtecoInsurance {
  settore: string
  classe_inail: 'basso' | 'medio' | 'alto' | 'molto_alto'
  tasso_inail_indicativo: string           // es. "30‰" — tasso medio per mille
  polizze_obbligatorie: string[]           // obbligatorie per legge
  polizze_raccomandate: string[]           // fortemente raccomandate per il settore
  rischi_principali: string[]              // rischi specifici del settore
  normativa: string[]                      // riferimenti normativi
  fonte: string
}

interface AtecoRule {
  pattern: RegExp
  data: Omit<AtecoInsurance, 'fonte'>
}

const ATECO_RULES: AtecoRule[] = [
  // ── INSTALLAZIONE IMPIANTI (43.2) ──
  {
    pattern: /^432/,
    data: {
      settore: 'Installazione impianti / impiantistica',
      classe_inail: 'alto',
      tasso_inail_indicativo: 'da verificare per voce di tariffa INAIL',
      polizze_obbligatorie: [
        'Posizioni INAIL / sicurezza lavoratori da verificare (D.Lgs. 81/2008)',
        'Abilitazioni e dichiarazioni di conformità DM 37/2008 da verificare',
        'Responsabilità civile verso terzi e prestatori da verificare',
      ],
      polizze_raccomandate: [
        'RC Installatore / RC post-intervento',
        'Tutela legale tecnica su contestazioni di conformità',
        'Polizza attrezzature e strumenti di lavoro',
        'CAR/EAR o garanzie specifiche se richieste da committente o contratto',
      ],
      rischi_principali: [
        'Danni a terzi durante installazione/manutenzione',
        'Danni post-intervento o malfunzionamento impianto',
        'Contestazioni su dichiarazioni di conformità',
        'Infortuni durante lavori presso clienti/cantieri',
        'Furto o danneggiamento attrezzature',
      ],
      normativa: [
        'DM 37/2008 — Installazione impianti',
        'D.Lgs. 81/2008 — Testo Unico Sicurezza',
        'Codice Civile — responsabilità civile per danni a terzi',
      ],
    },
  },
  // ── COSTRUZIONI (41-43) ──
  {
    pattern: /^4[1-3]/,
    data: {
      settore: 'Costruzioni / Edilizia',
      classe_inail: 'molto_alto',
      tasso_inail_indicativo: '50-110‰',
      polizze_obbligatorie: [
        'Posizioni INAIL / sicurezza lavoratori da verificare (D.Lgs. 81/2008)',
        'Responsabilità civile cantiere RCT/RCO da verificare',
        'CAR/EAR spesso richiesta da committenti o contratti di appalto',
      ],
      polizze_raccomandate: [
        'Polizza Decennale Postuma (garanzia strutturale)',
        'RC Professionale Progettazione',
        'Polizza Cauzioni per gare d\'appalto',
        'Polizza Attrezzature e Macchinari',
        'Polizza Interruzione Attività',
      ],
      rischi_principali: [
        'Infortuni sul lavoro (tasso tra i più alti in Italia)',
        'Danni a terzi in cantiere',
        'Crollo strutture / cedimenti',
        'Furto attrezzature di cantiere',
        'Responsabilità verso committente',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Testo Unico Sicurezza',
        'DPR 380/2001 — Testo Unico Edilizia',
        'D.Lgs. 50/2016 — Codice Appalti (polizze cauzioni)',
      ],
    },
  },

  // ── MANIFATTURA ALIMENTARE (10-12) ──
  {
    pattern: /^1[0-2]/,
    data: {
      settore: 'Industria Alimentare',
      classe_inail: 'alto',
      tasso_inail_indicativo: '35-60‰',
      polizze_obbligatorie: [
        'Responsabilità prodotto alimentare da verificare (Reg. CE 178/2002)',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
        'Responsabilità civile verso terzi da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Ritiro Prodotti (Product Recall)',
        'Polizza Contaminazione Accidentale',
        'Polizza Incendio (rischio alto per forni, frigoriferi)',
        'Polizza Interruzione Attività',
        'Polizza Trasporto Merci Deperibili',
      ],
      rischi_principali: [
        'Contaminazione alimentare e ritiro prodotti',
        'Incendio / esplosione impianti',
        'Infortuni da macchinari industriali',
        'Perdita catena del freddo',
        'Responsabilità prodotto difettoso',
      ],
      normativa: [
        'Reg. CE 178/2002 — Sicurezza alimentare',
        'D.Lgs. 81/2008 — Sicurezza sul lavoro',
        'Reg. CE 852/2004 — Igiene alimenti (HACCP)',
      ],
    },
  },

  // ── SANITÀ E ASSISTENZA SOCIALE (86-88) ──
  {
    pattern: /^8[6-8]/,
    data: {
      settore: 'Sanità e Assistenza Sociale',
      classe_inail: 'medio',
      tasso_inail_indicativo: '15-30‰',
      polizze_obbligatorie: [
        'RC sanitaria/malpractice da verificare nel perimetro L. 24/2017 "Gelli-Bianco"',
        'Responsabilità verso terzi e operatori da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Malpractice (per singolo professionista)',
        'Polizza Tutela Legale Sanitaria',
        'Cyber Risk (dati sanitari = dati sensibili GDPR)',
        'Polizza D&O per strutture sanitarie',
        'Polizza All Risks apparecchiature medicali',
      ],
      rischi_principali: [
        'Errore medico / malpractice',
        'Violazione dati sanitari (GDPR art. 9)',
        'Infezioni nosocomiali',
        'Danni da apparecchiature',
        'Contenzioso paziente',
      ],
      normativa: [
        'L. 24/2017 — Legge Gelli-Bianco (verifica obblighi RC sanitaria)',
        'GDPR — Protezione dati sanitari (sensibili)',
        'D.Lgs. 81/2008 — Rischio biologico operatori',
      ],
    },
  },

  // ── TRASPORTI E MAGAZZINAGGIO (49-53) ──
  {
    pattern: /^[45][0-3]|^49|^50|^51|^52|^53/,
    data: {
      settore: 'Trasporti e Logistica',
      classe_inail: 'alto',
      tasso_inail_indicativo: '40-80‰',
      polizze_obbligatorie: [
        'RCA veicoli da verificare se flotta/mezzi in uso',
        'RC vettoriale da verificare se trasporto merci conto terzi/CMR',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Merci Trasportate (All Risks)',
        'Polizza Flotta Veicoli (Libro Matricola)',
        'Polizza Kasko Veicoli Commerciali',
        'Polizza Interruzione Attività',
        'Responsabilità verso terzi in magazzino/deposito da verificare',
      ],
      rischi_principali: [
        'Incidenti stradali flotta',
        'Danneggiamento/perdita merci trasportate',
        'Furto merci in deposito o transito',
        'Infortuni autisti e magazzinieri',
        'Responsabilità per ritardi consegna',
      ],
      normativa: [
        'Codice della Strada — verifica RCA se mezzi soggetti a circolazione',
        'Convenzione CMR — RC vettoriale internazionale',
        'D.Lgs. 286/2005 — Autotrasporto conto terzi',
      ],
    },
  },

  // ── RISTORAZIONE E BAR (56) ──
  {
    pattern: /^56/,
    data: {
      settore: 'Ristorazione e Bar',
      classe_inail: 'medio',
      tasso_inail_indicativo: '20-40‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi/clienti da verificare',
        'Responsabilità prodotti somministrati da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Incendio (rischio cucina/forni)',
        'Polizza Furto e Rapina',
        'Polizza Danni da Acqua (allagamenti)',
        'Polizza Interruzione Attività',
        'Polizza Tutela Legale',
      ],
      rischi_principali: [
        'Incendio cucina / impianto gas',
        'Intossicazione alimentare clienti',
        'Scivolamento/caduta clienti nel locale',
        'Infortuni personale (tagli, ustioni)',
        'Furto incasso e attrezzature',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'Reg. CE 852/2004 — HACCP',
        'DM 37/2008 — Impianti gas e elettrici',
      ],
    },
  },

  // ── ATTIVITÀ PROFESSIONALI, SCIENTIFICHE, TECNICHE (69-75) ──
  {
    pattern: /^[67][0-5]|^69|^70|^71|^72|^73|^74|^75/,
    data: {
      settore: 'Attività Professionali e Consulenza',
      classe_inail: 'basso',
      tasso_inail_indicativo: '4-10‰',
      polizze_obbligatorie: [
        'RC professionale/E&O da verificare; obbligo solo se professionisti iscritti ad albo/STP',
      ],
      polizze_raccomandate: [
        'Cyber Risk (protezione dati clienti)',
        'Polizza D&O (se società di consulenza)',
        'Polizza Tutela Legale Professionale',
        'Polizza All Risks Elettronica (hardware/server)',
        'Key Person / continuità operativa da verificare',
      ],
      rischi_principali: [
        'Errore professionale / consulenza errata',
        'Violazione dati clienti (GDPR)',
        'Attacco informatico / ransomware',
        'Perdita dati / interruzione servizi IT',
        'Contenzioso con clienti',
      ],
      normativa: [
        'DPR 137/2012 — verifica RC professionale per iscritti ad albi',
        'GDPR — Protezione dati personali',
        'D.Lgs. 231/2001 — Responsabilità enti',
      ],
    },
  },

  // ── COMMERCIO ALL'INGROSSO E AL DETTAGLIO (45-47) ──
  {
    pattern: /^4[5-7]/,
    data: {
      settore: 'Commercio',
      classe_inail: 'basso',
      tasso_inail_indicativo: '8-20‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi/clienti da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Incendio Locale Commerciale',
        'Polizza Furto, Rapina, Atti Vandalici',
        'Polizza Merci in Magazzino',
        'Polizza Vetri e Insegne',
        'Polizza RC Prodotti (se vendita prodotti propri)',
        'Polizza Interruzione Attività',
      ],
      rischi_principali: [
        'Furto/rapina merci e incasso',
        'Incendio locale commerciale',
        'Infortunio cliente in negozio (scivolamento)',
        'Danneggiamento merci in magazzino',
        'Responsabilità da prodotto venduto',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'Codice del Consumo — Responsabilità prodotto',
      ],
    },
  },

  // ── MANIFATTURA MECCANICA / INDUSTRIA (10-32, esclude 33 che è Riparazione) ──
  // ★ FIX: ATECO 33 NON è manifattura ma "Riparazione e manutenzione macchine"
  // (servizi tecnici), gestito da entry dedicata sotto. ATECO 35-39 (energia,
  // acqua, rifiuti) gestito separatamente. Questo pattern copre solo 20-32.
  {
    pattern: /^(2[0-9]|3[0-2])/,
    data: {
      settore: 'Manifattura e Industria',
      classe_inail: 'alto',
      tasso_inail_indicativo: '30-70‰',
      polizze_obbligatorie: [
        'Responsabilità prodotto da verificare (Direttiva 85/374/CEE)',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
        'Responsabilità verso terzi e prestatori d\'opera da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Incendio Stabilimento',
        'Polizza Guasti Macchinari (Machinery Breakdown)',
        'Polizza Interruzione Attività',
        'Polizza Merci / Scorte in magazzino',
        'Polizza Inquinamento Ambientale (D.Lgs. 152/2006)',
        'Polizza Trasporto Merci',
      ],
      rischi_principali: [
        'Infortuni da macchinari industriali',
        'Incendio/esplosione stabilimento',
        'Prodotto difettoso — richiamo / recall',
        'Inquinamento ambientale',
        'Guasto macchinario critico — fermo produzione',
      ],
      normativa: [
        'Direttiva 85/374/CEE — RC Prodotti',
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'D.Lgs. 152/2006 — Tutela ambientale',
        'Direttiva Macchine 2006/42/CE',
      ],
    },
  },

  // ── INFORMATICA E TELECOMUNICAZIONI (61-63) ──
  {
    pattern: /^6[1-3]/,
    data: {
      settore: 'Informatica e Telecomunicazioni',
      classe_inail: 'basso',
      tasso_inail_indicativo: '4-8‰',
      polizze_obbligatorie: [
        'Technology E&O / RC professionale ICT da verificare su contratti, SLA e responsabilità verso clienti',
      ],
      polizze_raccomandate: [
        'Cyber Risk da qualificare su dati, accessi, backup, ransomware e continuità digitale',
        'Polizza D&O',
        'Polizza Tutela Legale IT',
        'Polizza All Risks Elettronica',
        'Polizza Errori & Omissioni (E&O)',
        'Polizza Key Man',
      ],
      rischi_principali: [
        'Attacco informatico / data breach',
        'Errore software con danni a cliente',
        'Violazione GDPR — sanzioni fino al 4% fatturato',
        'Interruzione servizi cloud/hosting',
        'Furto proprietà intellettuale',
      ],
      normativa: [
        'GDPR — Protezione dati (sanzioni fino a €20M o 4% fatturato)',
        'Direttiva NIS2 — da verificare se il soggetto rientra nel perimetro applicabile',
        'D.Lgs. 231/2001 — Responsabilità enti',
      ],
    },
  },

  // ── ALLOGGIO / TURISMO (55) ──
  {
    pattern: /^55/,
    data: {
      settore: 'Alloggio e Turismo',
      classe_inail: 'medio',
      tasso_inail_indicativo: '15-30‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi/ospiti da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Incendio Struttura',
        'Polizza Furto',
        'Polizza RC Conduzione',
        'Polizza Danni da Acqua',
        'Polizza Interruzione Attività Stagionale',
        'Polizza Tutela Legale',
      ],
      rischi_principali: [
        'Infortunio ospite in struttura',
        'Incendio struttura ricettiva',
        'Furto bagagli/beni ospiti',
        'Intossicazione alimentare (se con ristorazione)',
        'Danni strutturali da eventi atmosferici',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'DM 9/4/1994 — Prevenzione incendi strutture ricettive',
      ],
    },
  },

  // ── AGRICOLTURA (01-03) ──
  {
    pattern: /^0[1-3]/,
    data: {
      settore: 'Agricoltura e Pesca',
      classe_inail: 'alto',
      tasso_inail_indicativo: '40-90‰',
      polizze_obbligatorie: [
        'Posizioni INAIL / tutela infortuni lavoratori agricoli da verificare',
        'Responsabilità civile verso terzi da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Grandine e Gelo (colture)',
        'Polizza Multirischio Agricola (agevolata PAC)',
        'Polizza Bestiame (mortalità / malattia)',
        'Polizza Macchine Agricole',
        'Polizza Incendio Fabbricati Rurali',
        'Polizza RC Prodotti Agricoli',
      ],
      rischi_principali: [
        'Danni meteo a colture (grandine, gelo, siccità)',
        'Infortuni con macchine agricole',
        'Mortalità bestiame / epidemie',
        'Incendio fienili / strutture rurali',
        'RC da prodotti fitosanitari',
      ],
      normativa: [
        'Reg. UE 1305/2013 — Polizze agevolate FEASR',
        'D.Lgs. 102/2004 — Fondo di Solidarietà Nazionale',
        'D.Lgs. 81/2008 — Sicurezza lavoro agricolo',
      ],
    },
  },

  // ── SERVIZI FINANZIARI E ASSICURATIVI (64-66) ──
  {
    pattern: /^6[4-6]/,
    data: {
      settore: 'Servizi Finanziari e Assicurativi',
      classe_inail: 'basso',
      tasso_inail_indicativo: '3-6‰',
      polizze_obbligatorie: [
        'RC professionale da verificare se intermediario assicurativo/finanziario soggetto a obblighi IVASS o altra vigilanza',
        'Infedeltà dipendenti / crime da verificare in base ad attività vigilata, contratti e procedure interne',
      ],
      polizze_raccomandate: [
        'Cyber Risk (dati finanziari sensibili)',
        'Polizza D&O (alta esposizione dirigenti)',
        'Polizza Errori & Omissioni (E&O)',
        'Polizza Tutela Legale',
        'Polizza Crime / Frode',
        'Polizza All Risks Elettronica',
      ],
      rischi_principali: [
        'Frode interna/esterna',
        'Violazione normativa antiriciclaggio',
        'Errore consulenza finanziaria con danni a cliente',
        'Data breach dati finanziari sensibili',
        'Contenzioso con clienti per mis-selling',
      ],
      normativa: [
        'D.Lgs. 209/2005 — Codice Assicurazioni (RC intermediari)',
        'Reg. IVASS 40/2018 — Distribuzione assicurativa',
        'D.Lgs. 231/2007 — Antiriciclaggio',
        'GDPR — Dati finanziari sensibili',
      ],
    },
  },

  // ── ISTRUZIONE (85) ──
  {
    pattern: /^85/,
    data: {
      settore: 'Istruzione e Formazione',
      classe_inail: 'basso',
      tasso_inail_indicativo: '5-12‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi/alunni/genitori da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Infortuni Alunni/Studenti',
        'Polizza RC Professionale Docenti',
        'Polizza Incendio Struttura Scolastica',
        'Polizza Tutela Legale',
        'Cyber Risk (dati minori — GDPR art. 8)',
        'Polizza Responsabilità Patrimoniale',
      ],
      rischi_principali: [
        'Infortunio alunno durante attività scolastica',
        'Responsabilità docente per vigilanza',
        'Danni strutturali edificio scolastico',
        'Violazione privacy dati minori',
        'Bullismo/cyberbullismo — responsabilità istituto',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza ambienti scolastici',
        'DPR 547/1955 — Prevenzione infortuni',
        'GDPR art. 8 — Trattamento dati minori',
        'L. 71/2017 — Contrasto cyberbullismo',
      ],
    },
  },

  // ── ATTIVITÀ IMMOBILIARI (68) ──
  {
    pattern: /^68/,
    data: {
      settore: 'Attività Immobiliari',
      classe_inail: 'basso',
      tasso_inail_indicativo: '4-10‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi per conduzione/custodia immobili da verificare',
        'RC professionale da verificare se agente/intermediario immobiliare (DM 26/10/2007)',
      ],
      polizze_raccomandate: [
        'Polizza Globale Fabbricati',
        'Polizza Incendio Immobili',
        'Polizza RC Locazione (proprietario)',
        'Polizza Tutela Legale Immobiliare',
        'Polizza D&O (se società di gestione)',
        'Polizza Perdita Canoni Locazione',
      ],
      rischi_principali: [
        'Danni a terzi da difetto manutenzione immobile',
        'Incendio / crollo strutturale',
        'Contenzioso locatario/inquilino',
        'Errore professionale in intermediazione',
        'Morosità inquilini / perdita canoni',
      ],
      normativa: [
        'DM 26/10/2007 — verifica RC per agenti immobiliari',
        'Codice Civile art. 2051 — Custodia beni',
        'D.Lgs. 81/2008 — Sicurezza immobili',
      ],
    },
  },

  // ── ARTE, INTRATTENIMENTO, SPORT (90-93) ──
  {
    pattern: /^9[0-3]/,
    data: {
      settore: 'Arte, Intrattenimento e Sport',
      classe_inail: 'medio',
      tasso_inail_indicativo: '15-35‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi/pubblico/spettatori da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'Polizza Infortuni Sportivi / Artisti',
        'Polizza Annullamento Eventi',
        'Polizza RC Organizzazione Eventi',
        'Polizza All Risks Attrezzature',
        'Polizza Interruzione Attività Stagionale',
        'Polizza Tutela Legale',
      ],
      rischi_principali: [
        'Infortunio atleta/artista (perdita ingaggi)',
        'Danni a spettatori durante eventi',
        'Annullamento evento per cause di forza maggiore',
        'Danneggiamento attrezzature/strumenti',
        'RC da attività sportiva verso terzi',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza eventi',
        'DM 18/3/1996 — Sicurezza impianti sportivi',
        'L. 86/2023 — Riforma sport (verificare perimetro assicurazione sportivi)',
      ],
    },
  },

  // ── SERVIZI ALLA PERSONA (96) — parrucchieri, estetisti, lavanderie ──
  {
    pattern: /^96/,
    data: {
      settore: 'Servizi alla Persona',
      classe_inail: 'medio',
      tasso_inail_indicativo: '12-25‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi/clienti da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'RC Professionale (trattamenti estetici / acconciature)',
        'Polizza Incendio Locale',
        'Polizza Furto Attrezzature',
        'Polizza Danni da Prodotti Cosmetici',
        'Polizza Tutela Legale',
        'Polizza Interruzione Attività',
      ],
      rischi_principali: [
        'Danni da trattamento estetico errato (allergie, ustioni)',
        'Infortunio cliente nel salone',
        'Incendio da prodotti chimici/phon',
        'Furto attrezzature costose',
        'Contenzioso con cliente per danni',
      ],
      normativa: [
        'L. 174/2005 — Disciplina estetisti',
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'Reg. CE 1223/2009 — Sicurezza prodotti cosmetici',
      ],
    },
  },

  // ── ENERGIA E SERVIZI DI PUBBLICA UTILITÀ (35-39) ──
  {
    pattern: /^3[5-9]/,
    data: {
      settore: 'Energia e Utilities',
      classe_inail: 'alto',
      tasso_inail_indicativo: '25-50‰',
      polizze_obbligatorie: [
        'Responsabilità civile verso terzi da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
        'Responsabilità/inquinamento ambientale da verificare in base ad attività e autorizzazioni (D.Lgs. 152/2006)',
      ],
      polizze_raccomandate: [
        'Polizza All Risks Impianti Industriali',
        'Polizza Guasti Macchinari',
        'Polizza Interruzione Attività',
        'Polizza RC Inquinamento Graduale',
        'Polizza D&O',
        'Polizza Cyber Risk (SCADA / OT)',
      ],
      rischi_principali: [
        'Guasto impianto — interruzione fornitura',
        'Inquinamento ambientale da reflui/emissioni',
        'Infortuni da alta tensione / gas',
        'Attacco cyber a sistemi SCADA',
        'Danni a terzi da interruzione servizio',
      ],
      normativa: [
        'D.Lgs. 152/2006 — Codice Ambiente',
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'Direttiva NIS2 — Cybersecurity infrastrutture critiche',
        'D.Lgs. 164/2000 — Distribuzione gas',
      ],
    },
  },

  // ── RIPARAZIONE E MANUTENZIONE MACCHINARI INDUSTRIALI (33) ──
  // ATECO 33: Riparazione, manutenzione e installazione di macchine ed
  // apparecchiature. NON è manifattura — è SERVIZIO TECNICO B2B con leve
  // assicurative specifiche: RC Postuma (il prodotto manutentato fallisce →
  // danno al cliente), RC Professionale del tecnico certificato, cauzioni
  // per gare pubbliche (es. manutenzione estintori in scuole/ospedali).
  // Include: 33.11 metallo, 33.12 macchinari (estintori 33.12.55), 33.13
  // elettronica, 33.14 elettrica, 33.15 navi, 33.16 aeromobili, 33.17 mezzi,
  // 33.19 altre, 33.20 installazione macchinari industriali.
  {
    pattern: /^33/,
    data: {
      settore: 'Riparazione e Manutenzione Macchinari',
      classe_inail: 'medio',
      tasso_inail_indicativo: '15-35‰',
      polizze_obbligatorie: [
        'Responsabilità verso terzi da verificare; RCA solo se mezzi/circolazione su strada',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare (D.Lgs. 81/2008)',
      ],
      polizze_raccomandate: [
        'RC Postuma / Decennale Postuma — danno da malfunzionamento dopo intervento (CRITICA)',
        'RC Professionale Tecnico Manutentore (UNI 11224, UNI 9994 per antincendio, ecc.)',
        'Polizza Cose in Consegna (macchinari del cliente in officina)',
        'Polizza Cauzioni per gare pubbliche (DM 49/2018)',
        'Polizza RC Prodotto se sostituisce parti/ricambi',
        'Polizza Infortuni Trasferte (tecnici on-site)',
        'Polizza Tutela Legale (controversie su garanzie)',
        'Polizza Incendio Sede/Magazzino',
      ],
      rischi_principali: [
        'Malfunzionamento post-intervento → danno indiretto al cliente (es. estintore non funziona durante incendio)',
        'Errore di valutazione tecnica → danno economico al cliente',
        'Infortunio durante intervento on-site presso cliente',
        'Smarrimento/danneggiamento macchinario in consegna',
        'Sospensione contratto per inadempienza → escussione cauzione',
        'Contenzioso su garanzia legale (24 mesi consumatore, 12 mesi B2B)',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'UNI 9994 — Manutenzione estintori (per ATECO 33.12.55)',
        'UNI 11224 — Manutenzione impianti antincendio',
        'D.Lgs. 50/2016 + DM 49/2018 — Cauzioni appalti pubblici',
        'Codice Civile art. 1669 — Responsabilità decennale postuma',
        'Codice Civile art. 1490-1495 — Garanzia per vizi (riparazione)',
      ],
    },
  },

  // ── RIPARAZIONE VEICOLI E BENI (45.2, 95) ──
  {
    pattern: /^452|^95/,
    data: {
      settore: 'Riparazione Veicoli e Beni',
      classe_inail: 'medio',
      tasso_inail_indicativo: '20-40‰',
      polizze_obbligatorie: [
        'Responsabilità civile verso terzi da verificare',
        'Posizioni INAIL / tutela infortuni lavoratori da verificare',
      ],
      polizze_raccomandate: [
        'RC Professionale (riparazione auto/moto)',
        'Polizza Incendio Officina',
        'Polizza RC Cose in Consegna (veicoli clienti)',
        'Polizza Furto Attrezzature e Ricambi',
        'Polizza Inquinamento (oli, liquidi)',
        'Polizza Interruzione Attività',
      ],
      rischi_principali: [
        'Danno al veicolo del cliente durante riparazione',
        'Infortunio meccanico (schiacciamento, tagli)',
        'Incendio officina (solventi, carburanti)',
        'Inquinamento da oli e liquidi esausti',
        'Furto ricambi e attrezzature costose',
      ],
      normativa: [
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'D.Lgs. 152/2006 — Gestione rifiuti speciali',
        'Codice Civile art. 2051 — Custodia beni in consegna',
      ],
    },
  },

  // ── ESTRAZIONE E MINIERE (05-09) ──
  {
    pattern: /^0[5-9]/,
    data: {
      settore: 'Estrazione e Miniere',
      classe_inail: 'molto_alto',
      tasso_inail_indicativo: '60-120‰',
      polizze_obbligatorie: [
        'Posizioni INAIL / tutela infortuni lavoratori da verificare per attività ad alto rischio',
        'Responsabilità civile verso terzi da verificare',
        'Responsabilità/inquinamento ambientale da verificare in base ad attività e autorizzazioni (D.Lgs. 152/2006)',
      ],
      polizze_raccomandate: [
        'Polizza All Risks Impianti Estrattivi',
        'Polizza Guasti Macchinari Pesanti',
        'Polizza Interruzione Attività',
        'Polizza RC Inquinamento Graduale',
        'Polizza Cauzioni per concessioni minerarie',
        'Polizza Trasporto Materiali Pericolosi',
      ],
      rischi_principali: [
        'Crollo gallerie / cedimenti terreno',
        'Infortuni gravi da macchinari pesanti',
        'Inquinamento falde acquifere',
        'Esplosioni gas/polveri',
        'Malattie professionali (silicosi, asbestosi)',
      ],
      normativa: [
        'D.Lgs. 624/1996 — Sicurezza miniere e cave',
        'D.Lgs. 81/2008 — Sicurezza lavoro',
        'D.Lgs. 152/2006 — Tutela ambientale',
      ],
    },
  },
]

/**
 * Dato un codice ATECO o una categoria testuale, restituisce gli obblighi assicurativi
 */
export function getAtecoInsurance(atecoCode: string | null, category: string | null): AtecoInsurance | null {
  // Try by ATECO code first
  if (atecoCode) {
    const code = atecoCode.replace(/\./g, '')
    for (const rule of ATECO_RULES) {
      if (rule.pattern.test(code)) {
        return { ...rule.data, fonte: 'Normativa italiana, INAIL, IVASS' }
      }
    }
  }

  // Fallback: try to match by category text
  if (category) {
    const cat = category.toLowerCase()
    const categoryMap: [RegExp, number][] = [
      [/costruzion|edili|edile|impian|cantier|ristruttur|muratur/, 0],    // Costruzioni
      [/aliment|panific|pasticcer|conserv|lattier|macell|caseific/, 1],   // Alimentare
      [/medic|dentist|clinic|farmaci|odontoiat|fisioter|veterinar|ospedal/, 2], // Sanità
      [/trasport|logistic|spedizion|autotrasport|corriere|magazzin/, 3],  // Trasporti
      [/ristorant|bar |pizz|ristoro|pub |trattori|catering/, 4],         // Ristorazione
      [/consulen|avvocat|commerciali|notai|architect|ingegner|studio/, 5], // Professionali
      [/commerc|negozi|vendita|retail|ingrosso|dettaglio|ferramenta|abbiglia/, 6], // Commercio
      [/manifatt|fabbrica|produzion|industrial|metalmeccan|chimic|plastic/, 7], // Manifattura
      [/software|informatica|digitale|web |hosting|telecom|svilupp/, 8],  // IT
      [/hotel|albergo|b&b|agrituris|campeggio|ostello|resort|pension/, 9], // Alloggio
      [/agricol|agrar|alleva|vitic|oliv|pesca|ortofrutt|floricolt/, 10],  // Agricoltura
      [/banca|finanz|assicura|credito|leasing|investim|fondi|broker/, 11], // Finanza
      [/scuola|istruzion|formaz|univers|asilo|nido|doposcuola|accademia/, 12], // Istruzione
      [/immobil|agenzia.*casa|real estate|property|condomin/, 13],        // Immobiliare
      [/palestra|sport|cinema|teatro|discotec|evento|musica|danza|fitness/, 14], // Arte/Sport
      [/parrucchi|estetist|barbier|salone.*bellezza|beauty|spa |nail|lavander/, 15], // Persona
      [/energi|elettric|gas |idric|acquedott|rifiut|depuraz|fotovoltaic|eolico/, 16], // Energia
      [/officina|meccanico|carrozzeri|autoripara|gommist|elettrauto/, 17], // Riparazione
      [/cava |miner|estraz|petroli|trivella|geolog|perforaz/, 18],        // Estrazione
    ]

    for (const [re, idx] of categoryMap) {
      if (re.test(cat)) {
        const rule = ATECO_RULES[idx]
        return { ...rule.data, fonte: 'Normativa italiana, INAIL, IVASS' }
      }
    }
  }

  return null
}
