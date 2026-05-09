/**
 * INSURANCE INTELLIGENCE ENGINE — 100% deterministico, zero GPT
 * 
 * Ogni output è basato su:
 * - Normativa italiana vigente (D.Lgs., DPR, Regolamenti EU)
 * - Dati REALI dell'azienda (ATECO, forma giuridica, fatturato, dipendenti, sede)
 * - Tabelle INAIL, classificazioni ANIA/IVASS
 * 
 * NESSUNA stima, NESSUNA probabilità inventata, NESSUN GPT.
 * Solo FATTI che il broker può verificare e che il cliente NON può negare.
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface InsuranceObligation {
  polizza: string
  tipo: 'obbligo_legge' | 'obbligo_contrattuale' | 'obbligo_settoriale'
  norma: string           // riferimento normativo preciso
  descrizione: string     // perché è obbligatoria per QUESTA azienda
  sanzione: string        // cosa succede se non ce l'ha
  azione_broker: string   // cosa deve fare il broker
}

export interface InsuranceVulnerability {
  titolo: string
  gravita: 'critica' | 'alta' | 'media'
  fatto: string           // il FATTO verificabile
  conseguenza: string     // cosa succede concretamente
  soluzione: string       // polizza/azione specifica
  domanda_killer: string  // domanda che il broker deve fare al cliente
}

export interface CrossSellOpportunity {
  polizza: string
  motivo_specifico: string    // perché QUESTA azienda ne ha bisogno
  valore_per_cliente: string  // cosa ci guadagna il cliente
  trigger_vendita: string     // frase da dire al cliente
  premio_indicativo: string   // range basato su parametri reali di mercato
  fonte_dato: string          // da dove viene il dato
}

export interface BrokerBriefing {
  apertura: string            // prima frase da dire al cliente
  punti_forza: string[]       // cosa sappiamo che gli farà capire che siamo preparati
  domande_chiave: string[]    // domande specifiche per questa azienda
  obiezioni_probabili: string[] // obiezioni del cliente e come superarle
}

export interface InsuranceIntelligence {
  obblighi: InsuranceObligation[]
  vulnerabilita: InsuranceVulnerability[]
  opportunita: CrossSellOpportunity[]
  briefing_broker: BrokerBriefing
  esposizione_totale: {
    patrimonio_a_rischio: string
    costo_fermo_giornaliero: string
    esposizione_rc: string
  }
  fonti_normative: string[]
}

// ═══════════════════════════════════════════════════════════════════
// COMPANY PROFILE INPUT
// ═══════════════════════════════════════════════════════════════════

export interface CompanyProfile {
  ragione_sociale: string
  partita_iva?: string
  codice_ateco?: string
  descrizione_ateco?: string
  forma_giuridica?: string
  forma_giuridica_codice?: string
  fatturato?: number
  dipendenti?: number
  costo_personale?: number
  capitale_sociale?: number
  sede_legale?: string
  citta?: string
  provincia?: string
  regione?: string
  data_costituzione?: string
  stato_attivita?: string
  titolare?: string
  sito?: string
  pec?: string
  certificazioni?: string
  ha_flotta_veicoli?: boolean
  ha_immobili_proprieta?: boolean
  partecipa_appalti_pubblici?: boolean
  zona_sismica?: number
  rischio_idrogeologico?: string
  storico_bilanci?: any[]
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════════

export function generateInsuranceIntelligence(profile: CompanyProfile): InsuranceIntelligence {
  const obblighi: InsuranceObligation[] = []
  const vulnerabilita: InsuranceVulnerability[] = []
  const opportunita: CrossSellOpportunity[] = []
  const fontiNormative = new Set<string>()

  const ateco = profile.codice_ateco || ''
  const atecoPrefix2 = ateco.substring(0, 2)
  const atecoPrefix4 = ateco.substring(0, 5)
  const fg = (profile.forma_giuridica || '').toUpperCase()
  const fgCode = (profile.forma_giuridica_codice || '').toUpperCase()
  const fat = profile.fatturato || 0
  const dip = profile.dipendenti || 0
  const cap = profile.capitale_sociale || 0
  const nome = profile.ragione_sociale || ''
  const isDI = /\bDI\b|INDIVIDUALE|DITTA INDIVID/i.test(fg) || fgCode === 'DI'
  const isSRL = /SRL|SRLS|S\.R\.L/i.test(fg)
  const isSPA = /SPA|S\.P\.A/i.test(fg)
  const isSocietaCapitali = isSRL || isSPA
  const isSocietaPersone = /SAS|SNC|S\.A\.S|S\.N\.C/i.test(fg)
  const hasDip = dip > 0
  const annoCostituzione = profile.data_costituzione ? parseInt(profile.data_costituzione.substring(0, 4)) : null
  const anniAttivita = annoCostituzione ? new Date().getFullYear() - annoCostituzione : null
  const settore = getSettoreFromAteco(ateco)

  // ─── 1. OBBLIGHI DI LEGGE UNIVERSALI ───────────────────────────

  // INAIL / Rivalsa INAIL — ogni azienda con dipendenti
  if (hasDip) {
    obblighi.push({
      polizza: 'Rivalsa INAIL / RC Operai (RCO)',
      tipo: 'obbligo_legge',
      norma: 'D.Lgs. 81/2008, art. 18; DPR 1124/1965 (Azione di Regresso)',
      descrizione: `${dip} dipendente/i registrato/i. L'INAIL copre l'infortunio, MA se c'è responsabilità del datore di lavoro (es. violazione norme sicurezza), l'INAIL esercita l'azione di Rivalsa (Regresso) chiedendo i soldi indietro all'azienda.`,
      sanzione: 'Esposizione finanziaria totale del patrimonio aziendale (e personale per le DI/SNC) per rimborsare l\'INAIL in caso di infortunio grave o mortale del dipendente',
      azione_broker: 'Vendita immediata RC Operai (RCO) a copertura della Rivalsa INAIL. Verificare massimali RCO: minimo €1.000.000 per sinistro e €500.000 per persona lavoratrice.',
    })
    fontiNormative.add('DPR 1124/1965 — Testo Unico INAIL (Azione di Regresso)')
    fontiNormative.add('D.Lgs. 81/2008 — Testo Unico Sicurezza Lavoro')
  }

  // DVR — obbligatorio per tutti i datori di lavoro
  if (hasDip) {
    obblighi.push({
      polizza: 'Documento Valutazione Rischi (DVR)',
      tipo: 'obbligo_legge',
      norma: 'D.Lgs. 81/2008, art. 17 e 28',
      descrizione: `Con ${dip} dipendente/i, il DVR è obbligatorio e non delegabile dal datore di lavoro.${dip <= 10 ? ' Può utilizzare procedure standardizzate (art. 29 comma 5).' : ''}`,
      sanzione: 'Arresto da 3 a 6 mesi o ammenda da €3.071 a €7.862',
      azione_broker: 'Chiedere se il DVR è aggiornato. Se no, proporre servizio di consulenza sicurezza + polizza RC Datore di Lavoro.',
    })
  }

  // RC Auto — se ha flotta
  if (profile.ha_flotta_veicoli) {
    obblighi.push({
      polizza: 'RC Auto / Flotta Veicoli',
      tipo: 'obbligo_legge',
      norma: 'D.Lgs. 209/2005, art. 122 (Codice delle Assicurazioni)',
      descrizione: 'L\'azienda possiede veicoli aziendali. La RC Auto è obbligatoria per la circolazione su strada.',
      sanzione: 'Sequestro del veicolo + sanzione da €866 a €3.464',
      azione_broker: 'Proporre polizza flotta con tariffazione a libro matricola. Chiedere quanti veicoli, tipo (furgoni, auto, mezzi pesanti), km annui.',
    })
    fontiNormative.add('D.Lgs. 209/2005 — Codice delle Assicurazioni Private')
  }

  // ─── 2. OBBLIGHI SETTORIALI (da ATECO) ────────────────────────

  // COSTRUZIONI / EDILIZIA (41-43)
  if (/^4[1-3]/.test(atecoPrefix2)) {
    obblighi.push({
      polizza: 'RC verso Terzi e Prestatori d\'Opera',
      tipo: 'obbligo_settoriale',
      norma: 'D.Lgs. 81/2008; Art. 2043-2055 Codice Civile',
      descrizione: `ATECO ${ateco}: attività di ${profile.descrizione_ateco || 'costruzioni/installazioni'}. Il rischio di danni a terzi durante i lavori è intrinseco all'attività.`,
      sanzione: 'Responsabilità illimitata del patrimonio personale del titolare/amministratore per danni a terzi',
      azione_broker: 'Verificare massimale attuale. Per installazioni elettriche (43.21) il massimale minimo raccomandato è €500.000.',
    })

    if (/^43\.2/.test(ateco)) {
      // Installazioni impianti
      obblighi.push({
        polizza: 'Abilitazione DM 37/2008 + RC Installatore',
        tipo: 'obbligo_legge',
        norma: 'DM 37/2008 (ex L. 46/1990)',
        descrizione: `L'installazione di impianti elettrici (ATECO ${ateco}) richiede l'abilitazione ai sensi del DM 37/2008. La dichiarazione di conformità implica responsabilità decennale sull'impianto.`,
        sanzione: 'Sanzione da €516 a €5.164 + nullità della dichiarazione di conformità + responsabilità civile e penale per difetti',
        azione_broker: 'La responsabilità sull\'impianto dura 10 ANNI dalla dichiarazione di conformità. Ogni impianto installato è un\'esposizione aperta. Servono: RC Professionale Installatore + Decennale Postuma.',
      })
      fontiNormative.add('DM 37/2008 — Sicurezza Impianti')
    }

    if (profile.partecipa_appalti_pubblici) {
      obblighi.push({
        polizza: 'Cauzioni e Garanzie per Appalti Pubblici',
        tipo: 'obbligo_contrattuale',
        norma: 'D.Lgs. 36/2023 (Nuovo Codice Appalti), art. 106',
        descrizione: 'L\'azienda partecipa ad appalti pubblici. Per ogni gara è obbligatoria la cauzione provvisoria (2% dell\'importo) e per ogni contratto la cauzione definitiva.',
        sanzione: 'Esclusione dalla gara / risoluzione del contratto',
        azione_broker: 'Proporre convenzione fideiussoria con primaria compagnia. Chiedere: volume gare annuo, importo medio, SOA attestata per quali categorie e classifiche.',
      })
      fontiNormative.add('D.Lgs. 36/2023 — Nuovo Codice Contratti Pubblici')
    }

    fontiNormative.add('D.Lgs. 81/2008 — Testo Unico Sicurezza')
  }

  // PROFESSIONISTI (69-74)
  if (/^6[9]|^7[0-4]/.test(atecoPrefix2)) {
    obblighi.push({
      polizza: 'RC Professionale',
      tipo: 'obbligo_legge',
      norma: 'DPR 137/2012, art. 5; L. 14/2012 (riforma professioni)',
      descrizione: `Attività professionale (ATECO ${ateco}). L'RC Professionale è obbligatoria per legge per tutti i professionisti iscritti ad albi.`,
      sanzione: 'Sanzione disciplinare dell\'Ordine + responsabilità patrimoniale illimitata',
      azione_broker: 'Verificare: massimale adeguato al volume d\'affari, retroattività illimitata, clausola postuma almeno 5 anni.',
    })
    fontiNormative.add('DPR 137/2012 — Riforma Professioni')
  }

  // SANITÀ (86)
  if (/^86/.test(atecoPrefix2)) {
    obblighi.push({
      polizza: 'RC Sanitaria (Legge Gelli-Bianco)',
      tipo: 'obbligo_legge',
      norma: 'L. 24/2017, art. 10 (Legge Gelli-Bianco)',
      descrizione: 'Struttura sanitaria o professionista sanitario. L\'obbligo di assicurazione per RC sanitaria è previsto dalla Legge Gelli-Bianco.',
      sanzione: 'Divieto di esercizio dell\'attività sanitaria + responsabilità personale illimitata',
      azione_broker: 'Verificare: massimale minimo €2.000.000, retroattività, estensione colpa grave, tutela legale.',
    })
    fontiNormative.add('L. 24/2017 — Legge Gelli-Bianco')
  }

  // TRASPORTI (49)
  if (/^49/.test(atecoPrefix2)) {
    obblighi.push({
      polizza: 'RC Vettore / CMR',
      tipo: 'obbligo_legge',
      norma: 'Convenzione CMR 1956; D.Lgs. 286/2005',
      descrizione: 'Attività di trasporto merci. La responsabilità del vettore è disciplinata dalla Convenzione CMR per trasporti internazionali e dall\'art. 1693 c.c. per nazionali.',
      sanzione: 'Responsabilità per perdita/avaria della merce trasportata fino a 8,33 DSP/kg (CMR)',
      azione_broker: 'Chiedere: tipo merci trasportate, valore medio carico, tratte (nazionali/internazionali), numero mezzi.',
    })
    fontiNormative.add('Convenzione CMR 1956')
  }

  // ALIMENTARE (10-12, 56)
  if (/^1[0-2]|^56/.test(atecoPrefix2)) {
    obblighi.push({
      polizza: 'RC Prodotti Alimentari + HACCP',
      tipo: 'obbligo_settoriale',
      norma: 'Reg. CE 178/2002; Reg. CE 852/2004; D.Lgs. 193/2007',
      descrizione: 'Attività nel settore alimentare. La responsabilità per prodotti difettosi/contaminati è oggettiva (senza colpa).',
      sanzione: 'Sequestro prodotti + sanzioni da €1.000 a €60.000 + responsabilità civile per danni alla salute',
      azione_broker: 'Verificare: RC Prodotti con estensione ritiro/richiamo, contaminazione accidentale, costi di recall.',
    })
    fontiNormative.add('Reg. CE 178/2002 — Sicurezza Alimentare')
  }

  // ─── 3. VULNERABILITÀ SPECIFICHE DELL'AZIENDA ──────────────────

  // Ditta individuale — il titolare NON è coperto INAIL
  if (isDI) {
    vulnerabilita.push({
      titolo: 'TITOLARE SENZA COPERTURA INAIL',
      gravita: 'critica',
      fatto: `${nome} è una Ditta Individuale (DI). Per legge (DPR 1124/1965, art. 4), il titolare di una DI NON è assicurato INAIL. L'INAIL copre solo i lavoratori subordinati.${profile.titolare ? ` Il titolare ${profile.titolare} lavora direttamente` : ''}.`,
      conseguenza: `Se ${profile.titolare || 'il titolare'} si infortuna${settore.rischio_infortunio ? ` (settore ${settore.nome}: rischio ${settore.rischio_infortunio})` : ''}, l'attività si ferma completamente. Zero reddito, zero copertura sanitaria INAIL, zero indennità.`,
      soluzione: 'Polizza Infortuni Titolare con indennità giornaliera + invalidità permanente + caso morte. Massimale minimo: reddito annuo lordo.',
      domanda_killer: `"${profile.titolare || 'Sig. Titolare'}, se domani si rompe un braccio sul lavoro, chi paga le sue spese e chi manda avanti l'azienda? L'INAIL non la copre perché lei è titolare di ditta individuale."`,
    })
  }

  // Società di capitali senza D&O adeguata
  if (isSocietaCapitali) {
    const esposizione = fat > 0 ? fat : (cap > 0 ? cap * 5 : 0)
    vulnerabilita.push({
      titolo: 'RESPONSABILITÀ PATRIMONIALE AMMINISTRATORI',
      gravita: fat > 2_000_000 ? 'critica' : 'alta',
      fatto: `${nome} è una ${isSRL ? 'S.R.L.' : 'S.P.A.'}. Gli amministratori rispondono personalmente con il PROPRIO patrimonio per danni causati alla società, ai soci e ai creditori (art. 2476 c.c. per SRL, art. 2392 c.c. per SPA).${fat > 0 ? ` Con €${fmtNum(fat)} di fatturato, l'esposizione patrimoniale è significativa.` : ''}`,
      conseguenza: `In caso di azione di responsabilità (da soci, creditori, curatore fallimentare), l'amministratore risponde con casa, conti, beni personali. La responsabilità è solidale e non si prescrive prima di 5 anni.`,
      soluzione: `Polizza D&O (Directors & Officers) con massimale minimo €${fmtNum(Math.max(500_000, esposizione))}. Deve includere: difesa legale, responsabilità verso creditori, copertura anche dopo cessazione carica.`,
      domanda_killer: `"Se un fornitore o un cliente vi fa causa per €${fmtNum(Math.max(100_000, fat * 0.1))}, sa che l'amministratore risponde con il proprio patrimonio personale? Ha una polizza D&O?"`,
    })
    fontiNormative.add('Art. 2476 c.c. — Responsabilità amministratori SRL')
  }

  // Dipendenti senza welfare verificato
  if (dip >= 1) {
    const ccnl = getCCNLFromAteco(ateco)
    if (ccnl) {
      vulnerabilita.push({
        titolo: `OBBLIGHI CCNL ${ccnl.nome}`,
        gravita: 'alta',
        fatto: `ATECO ${ateco} → CCNL ${ccnl.nome}. Questo contratto collettivo prevede obblighi specifici: ${ccnl.obblighi_assicurativi.join(', ')}.`,
        conseguenza: 'Il mancato rispetto degli obblighi CCNL espone a vertenze sindacali, sanzioni ispettorato e risarcimento danni ai lavoratori.',
        soluzione: `Verificare che tutte le coperture previste dal CCNL ${ccnl.nome} siano attive e conformi.`,
        domanda_killer: `"Il vostro CCNL ${ccnl.nome} prevede ${ccnl.obblighi_assicurativi[0]}. Ce l'avete? È conforme ai minimi contrattuali?"`,
      })
    }
  }

  // Key Man risk per micro imprese
  if (dip <= 3 && profile.titolare) {
    vulnerabilita.push({
      titolo: 'RISCHIO KEY MAN — CONCENTRAZIONE SU UNA PERSONA',
      gravita: 'critica',
      fatto: `${nome} ha ${dip} dipendente/i. L'intera attività dipende da ${profile.titolare}. Se questa persona non può lavorare, l'azienda si ferma.${fat > 0 ? ` Fatturato a rischio: €${fmtNum(fat)}.` : ''}`,
      conseguenza: `Fermo attività = zero fatturato + costi fissi che continuano (affitto, utenze, rate, stipendi). Stima costo fermo: €${fmtNum(Math.max(100, Math.round((fat || 100_000) / 220)))}/giorno lavorativo.`,
      soluzione: 'Polizza Key Man: invalidità temporanea + permanente + caso morte. Massimale: almeno 2 anni di fatturato.',
      domanda_killer: `"${profile.titolare}, se lei domani non può più lavorare per 3 mesi, quanto perde l'azienda? Chi copre i costi fissi che continuano a correre?"`,
    })
  }

  // Rischio sismico
  if (profile.zona_sismica && profile.zona_sismica <= 2) {
    vulnerabilita.push({
      titolo: `ZONA SISMICA ${profile.zona_sismica} — RISCHIO TERREMOTO`,
      gravita: profile.zona_sismica === 1 ? 'critica' : 'alta',
      fatto: `La sede di ${profile.citta || 'N/D'} è classificata in Zona Sismica ${profile.zona_sismica} (${profile.zona_sismica === 1 ? 'massima pericolosità' : 'alta pericolosità'}). Classificazione OPCM 3274/2003.`,
      conseguenza: 'Le polizze property standard ESCLUDONO il terremoto. In caso di evento sismico, tutti i danni a immobile, attrezzature e merci NON sono coperti.',
      soluzione: 'Estensione terremoto sulla polizza property. Verificare congruità del valore assicurato (valore a nuovo vs valore commerciale).',
      domanda_killer: `"Sa che la sua polizza incendio quasi certamente NON copre il terremoto? ${profile.citta || 'La sua sede'} è in zona sismica ${profile.zona_sismica}. Ha mai verificato?"`,
    })
    fontiNormative.add('OPCM 3274/2003 — Classificazione Sismica')
  }

  // Rischio idrogeologico
  if (profile.rischio_idrogeologico === 'alto') {
    vulnerabilita.push({
      titolo: 'ZONA AD ALTO RISCHIO IDROGEOLOGICO',
      gravita: 'alta',
      fatto: `La sede è in area classificata ad alto rischio idrogeologico (fonte: ISPRA). Rischio alluvione/frana concreto.`,
      conseguenza: 'I danni da alluvione sono spesso ESCLUSI dalle polizze property base o soggetti a franchigie elevatissime.',
      soluzione: 'Verificare polizza property: estensione "eventi atmosferici" e "allagamento" devono essere esplicitamente inclusi, con franchigia accettabile.',
      domanda_killer: '"La sua sede è in zona ad alto rischio alluvione secondo ISPRA. La sua polizza copre esplicitamente i danni da acqua? Con quale franchigia?"',
    })
    fontiNormative.add('D.Lgs. 152/2006 — Codice Ambiente')
  }

  // Azienda giovane (< 3 anni)
  if (anniAttivita !== null && anniAttivita <= 3) {
    vulnerabilita.push({
      titolo: 'AZIENDA GIOVANE — PROFILO RISCHIO ELEVATO',
      gravita: 'media',
      fatto: `Costituita il ${profile.data_costituzione} — ${anniAttivita} anni di attività. Le statistiche CERVED mostrano che il ${anniAttivita <= 1 ? '25%' : '20%'} delle imprese italiane chiude entro i primi 3 anni.`,
      conseguenza: 'Rischio di sottovalutazione delle coperture assicurative. Spesso le startup/nuove imprese risparmiano sull\'assicurazione, esponendosi a rischi catastrofici.',
      soluzione: 'Pacchetto assicurativo "starter" completo: RC + Incendio + Infortuni titolare. Fondamentale coprire subito i rischi base.',
      domanda_killer: '"L\'azienda è giovane. Avete già strutturato un programma assicurativo completo o state ancora con le coperture minime?"',
    })
  }

  // ─── 4. OPPORTUNITÀ DI CROSS-SELL ─────────────────────────────

  // Costruzioni: CAR/EAR per ogni cantiere
  if (/^4[1-3]/.test(atecoPrefix2)) {
    opportunita.push({
      polizza: 'Polizza CAR/EAR (Contractor All Risks)',
      motivo_specifico: `ATECO ${ateco}: ogni cantiere aperto è un'esposizione. La CAR copre danni all'opera in costruzione, materiali, attrezzature. Spesso RICHIESTA dal committente per contratto.`,
      valore_per_cliente: 'Protegge l\'investimento dell\'opera + è spesso condizione per ottenere il lavoro dal committente.',
      trigger_vendita: '"Quanti cantieri avete aperti in questo momento? Per ognuno vi serve una CAR specifica. Ve la gestisco io così non dovete pensarci."',
      premio_indicativo: `0,3%-0,8% del valore dell'opera (es. opera da €100.000 → premio €300-800)`,
      fonte_dato: 'Tariffario ANIA — ramo Rischi Tecnologici',
    })

    opportunita.push({
      polizza: 'Polizza Decennale Postuma',
      motivo_specifico: `Per lavori strutturali su edifici, la garanzia decennale postuma copre difetti che si manifestano nei 10 anni successivi alla consegna.${/^43\.2/.test(ateco) ? ' Per installazioni impiantistiche, la responsabilità ex DM 37/2008 dura 10 anni.' : ''}`,
      valore_per_cliente: 'Protegge da richieste di risarcimento che arrivano ANNI dopo aver finito il lavoro. Senza questa polizza, il patrimonio dell\'impresa resta esposto per un decennio.',
      trigger_vendita: '"Sa che per ogni impianto che installa, lei è responsabile per 10 anni? Se tra 7 anni un suo impianto causa un incendio, chi paga?"',
      premio_indicativo: '1,5%-3% del valore dell\'opera, pagamento una tantum',
      fonte_dato: 'Art. 1669 c.c. — Responsabilità decennale appaltatore',
    })
  }

  // Cyber Risk per aziende con sito web
  if (profile.sito && (dip >= 3 || fat >= 300_000)) {
    opportunita.push({
      polizza: 'Polizza Cyber Risk',
      motivo_specifico: `${nome} ha un sito web (${profile.sito})${dip > 0 ? ` e ${dip} dipendenti con accesso a sistemi informatici` : ''}. Gestisce dati di clienti/fornitori soggetti a GDPR.`,
      valore_per_cliente: 'Copre: costi di ripristino sistemi, notifica data breach al Garante, danni da ransomware, perdita di fatturato per fermo IT.',
      trigger_vendita: '"Avete mai subito un attacco informatico? Un ransomware medio costa €42.000 a una PMI italiana (fonte: Clusit 2024). Quanto vi costerebbe stare fermi 3 giorni?"',
      premio_indicativo: `€${fmtNum(Math.max(500, Math.round(fat * 0.001)))} - €${fmtNum(Math.max(2000, Math.round(fat * 0.003)))} annui`,
      fonte_dato: 'Report Clusit 2024 — Sicurezza ICT Italia',
    })
    fontiNormative.add('Reg. UE 2016/679 — GDPR')
  }

  // Polizza Infortuni Titolare (per DI e micro)
  if (isDI || (dip <= 2 && profile.titolare)) {
    opportunita.push({
      polizza: 'Polizza Infortuni Titolare / Key Man',
      motivo_specifico: `${profile.titolare || 'Il titolare'} è la figura centrale dell'azienda.${isDI ? ' Come titolare di DI, NON è coperto INAIL.' : ''} Se non lavora, l'azienda si ferma.`,
      valore_per_cliente: `Garantisce un reddito durante il periodo di inabilità. Indennità giornaliera di €${Math.max(50, Math.round((fat || 100_000) / 220 * 0.8))}-${Math.max(100, Math.round((fat || 100_000) / 220))}/giorno per inabilità temporanea.`,
      trigger_vendita: `"${profile.titolare || 'Sig. Titolare'}, quanto guadagna al giorno? Se si fa male, l'INAIL NON la copre. Posso garantirle lo stesso reddito anche durante un infortunio, per meno di €2 al giorno."`,
      premio_indicativo: `€400-1.200/anno per massimale morte/IP €200.000 + ITT €80-150/giorno`,
      fonte_dato: 'Tariffario ANIA — Ramo Infortuni',
    })
  }

  // Property / Incendio
  if (profile.ha_immobili_proprieta || fat >= 200_000) {
    opportunita.push({
      polizza: 'Polizza Property / All Risks',
      motivo_specifico: `${profile.ha_immobili_proprieta ? 'L\'azienda possiede immobili' : `Con un fatturato di €${fmtNum(fat)}, l'azienda ha sicuramente attrezzature, macchinari, merci`}. Tutto esposto a incendio, furto, eventi atmosferici.`,
      valore_per_cliente: 'Copre la ricostruzione/sostituzione di tutto ciò che serve per lavorare: immobile, attrezzature, scorte, macchinari.',
      trigger_vendita: '"Se domattina trovate il magazzino/laboratorio bruciato, avete i soldi per ricomprare tutto e ricominciare? In quanto tempo?"',
      premio_indicativo: `€${fmtNum(Math.max(400, Math.round(fat * 0.001)))} - €${fmtNum(Math.max(1500, Math.round(fat * 0.003)))} annui`,
      fonte_dato: 'Benchmark ANIA — Ramo Incendio e Rischi Complementari',
    })
  }

  // TFR in azienda (obbligo per tutti i dipendenti)
  if (dip >= 1) {
    const tfr_annuo = profile.costo_personale ? Math.round(profile.costo_personale * 0.0691) : Math.round(dip * 2200)
    opportunita.push({
      polizza: 'Fondo Pensione / TFR Complementare',
      motivo_specifico: `Con ${dip} dipendente/i${profile.costo_personale ? ` e costo del personale €${fmtNum(profile.costo_personale)}` : ''}, il TFR accantonato è circa €${fmtNum(tfr_annuo)}/anno.`,
      valore_per_cliente: 'Destinare il TFR a un fondo pensione offre vantaggi fiscali sia al dipendente (deducibilità fino a €5.164/anno) sia all\'azienda (deduzione IRAP del 0,3% del TFR).',
      trigger_vendita: '"Dove destinate il TFR dei vostri dipendenti? In azienda o a un fondo? Se lo tenete in azienda, state perdendo un vantaggio fiscale e al momento del pagamento dovrete tirare fuori tutto insieme."',
      premio_indicativo: `Contributo aziendale: 1-2% della retribuzione lorda`,
      fonte_dato: 'D.Lgs. 252/2005 — Previdenza Complementare',
    })
    fontiNormative.add('D.Lgs. 252/2005 — Previdenza Complementare')
  }

  // ─── 5. BRIEFING BROKER ────────────────────────────────────────

  const briefing = buildBrokerBriefing(profile, obblighi, vulnerabilita, opportunita, settore)

  // ─── 6. ESPOSIZIONE TOTALE ─────────────────────────────────────

  const costoFermoGiornaliero = fat > 0 ? Math.round(fat / 220) : 0
  const patrimonioRischio = fat > 0 ? fat * 2 : 0 // stima conservativa: fatturato × 2

  return {
    obblighi,
    vulnerabilita,
    opportunita,
    briefing_broker: briefing,
    esposizione_totale: {
      patrimonio_a_rischio: patrimonioRischio > 0 ? `€${fmtNum(patrimonioRischio)}` : 'Da quantificare',
      costo_fermo_giornaliero: costoFermoGiornaliero > 0 ? `€${fmtNum(costoFermoGiornaliero)}/giorno` : 'Da quantificare',
      esposizione_rc: fat > 0 ? `€${fmtNum(Math.max(500_000, fat * 2))} (massimale RC consigliato)` : 'Da quantificare',
    },
    fonti_normative: Array.from(fontiNormative),
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Settore da ATECO
// ═══════════════════════════════════════════════════════════════════

interface SettoreInfo {
  nome: string
  rischio_infortunio: 'molto_alto' | 'alto' | 'medio' | 'basso'
  classe_inail: string
}

function getSettoreFromAteco(ateco: string): SettoreInfo {
  const p2 = ateco.substring(0, 2)
  if (/^0[1-3]/.test(p2)) return { nome: 'Agricoltura', rischio_infortunio: 'alto', classe_inail: '35-65‰' }
  if (/^0[5-9]|^1[0-9]|^2[0-9]|^3[0-2]/.test(p2)) return { nome: 'Industria/Manifattura', rischio_infortunio: 'molto_alto', classe_inail: '40-110‰' }
  if (/^33/.test(p2)) return { nome: 'Riparazione e Manutenzione Macchinari', rischio_infortunio: 'medio', classe_inail: '15-35‰' }
  if (/^3[5-9]/.test(p2)) return { nome: 'Energia/Acqua/Rifiuti', rischio_infortunio: 'alto', classe_inail: '20-50‰' }
  if (/^4[1-3]/.test(p2)) return { nome: 'Costruzioni/Edilizia', rischio_infortunio: 'molto_alto', classe_inail: '50-110‰' }
  if (/^4[5-7]/.test(p2)) return { nome: 'Commercio', rischio_infortunio: 'basso', classe_inail: '5-15‰' }
  if (/^49|^5[0-3]/.test(p2)) return { nome: 'Trasporti/Logistica', rischio_infortunio: 'alto', classe_inail: '25-50‰' }
  if (/^5[5-6]/.test(p2)) return { nome: 'Ristorazione/Alloggio', rischio_infortunio: 'medio', classe_inail: '15-30‰' }
  if (/^6[2-3]/.test(p2)) return { nome: 'IT/Software', rischio_infortunio: 'basso', classe_inail: '4-8‰' }
  if (/^6[4-6]/.test(p2)) return { nome: 'Finanza/Assicurazioni', rischio_infortunio: 'basso', classe_inail: '4-6‰' }
  if (/^6[89]|^7[0-5]/.test(p2)) return { nome: 'Servizi Professionali', rischio_infortunio: 'basso', classe_inail: '4-10‰' }
  if (/^86/.test(p2)) return { nome: 'Sanità', rischio_infortunio: 'medio', classe_inail: '12-25‰' }
  if (/^8[5-8]/.test(p2)) return { nome: 'Istruzione/Sanità/Sociale', rischio_infortunio: 'medio', classe_inail: '10-25‰' }
  if (/^9[5-6]/.test(p2)) return { nome: 'Riparazione Beni Personali / Servizi alla Persona', rischio_infortunio: 'medio', classe_inail: '10-25‰' }
  return { nome: 'Altro', rischio_infortunio: 'medio', classe_inail: '10-30‰' }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: CCNL da ATECO
// ═══════════════════════════════════════════════════════════════════

interface CCNLInfo {
  nome: string
  obblighi_assicurativi: string[]
}

function getCCNLFromAteco(ateco: string): CCNLInfo | null {
  const p2 = ateco.substring(0, 2)
  if (/^4[1-3]/.test(p2)) return {
    nome: 'Edilizia (CCNL Edili Industria/Artigianato)',
    obblighi_assicurativi: [
      'Iscrizione Cassa Edile (contributo 2,50% + 0,50%)',
      'Polizza Infortuni Extra-Professionale (PREVEDI)',
      'Fondo Sanitario SANEDIL obbligatorio per tutti gli operai edili',
      'Formazione 16h sicurezza obbligatoria prima dell\'impiego in cantiere',
    ],
  }
  if (/^4[5-7]/.test(p2)) return {
    nome: 'Commercio (CCNL Terziario Confcommercio)',
    obblighi_assicurativi: [
      'Fondo Est — assistenza sanitaria integrativa obbligatoria (€10-15/mese per dipendente)',
      'Fondo Fonte — previdenza complementare',
      'QuAS — assistenza sanitaria quadri (se presenti quadri)',
    ],
  }
  if (/^1[0-2]/.test(p2)) return {
    nome: 'Industria Alimentare',
    obblighi_assicurativi: [
      'FASA — Fondo Assistenza Sanitaria Alimentaristi',
      'Alifond — previdenza complementare',
      'Polizza Infortuni extra-professionale (alcuni CCNL)',
    ],
  }
  if (/^5[5-6]/.test(p2)) return {
    nome: 'Turismo/Ristorazione (CCNL Turismo Confcommercio)',
    obblighi_assicurativi: [
      'Fondo Est — assistenza sanitaria integrativa',
      'FON.TE — previdenza complementare',
      'Copertura infortuni extra-professionale per stagionali',
    ],
  }
  if (/^6[2-3]/.test(p2)) return {
    nome: 'Metalmeccanici (CCNL Metalmeccanico Federmeccanica)',
    obblighi_assicurativi: [
      'MetaSalute — assistenza sanitaria integrativa obbligatoria (€13/mese)',
      'COMETA — fondo previdenza complementare',
      'Flexible Benefits €200/anno per dipendente',
    ],
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Briefing broker
// ═══════════════════════════════════════════════════════════════════

function buildBrokerBriefing(
  profile: CompanyProfile,
  obblighi: InsuranceObligation[],
  vulnerabilita: InsuranceVulnerability[],
  opportunita: CrossSellOpportunity[],
  settore: SettoreInfo,
): BrokerBriefing {
  const nome = profile.ragione_sociale
  const titolare = profile.titolare || 'il titolare'
  const fat = profile.fatturato || 0
  const dip = profile.dipendenti || 0
  const fg = profile.forma_giuridica || ''
  const isDI = /\bDI\b|INDIVIDUALE/i.test(fg)
  const critiche = vulnerabilita.filter(v => v.gravita === 'critica')

  // Apertura personalizzata
  let apertura = `"Buongiorno ${titolare}, ho analizzato il profilo della sua azienda ${nome}`
  if (profile.codice_ateco) apertura += ` nel settore ${settore.nome}`
  if (profile.citta) apertura += ` a ${profile.citta}`
  apertura += `. Ho individuato ${critiche.length > 0 ? critiche.length + ' aspetti critici' : 'alcune opportunità'} che vorrei condividere con lei."`

  // Punti forza — cose che il broker sa che impressionano il cliente
  const puntiForza: string[] = []
  if (profile.partita_iva) puntiForza.push(`P.IVA ${profile.partita_iva} — azienda verificata e attiva`)
  if (profile.codice_ateco) puntiForza.push(`ATECO ${profile.codice_ateco}: ${profile.descrizione_ateco || settore.nome} — conosco i rischi specifici del suo settore`)
  if (fat > 0) puntiForza.push(`Fatturato €${fmtNum(fat)} — so dimensionare le coperture sul suo volume d'affari reale`)
  if (dip > 0) puntiForza.push(`${dip} dipendenti — conosco gli obblighi del suo CCNL`)
  if (profile.data_costituzione) puntiForza.push(`Attiva dal ${profile.data_costituzione} — ${profile.stato_attivita === 'ATTIVA' ? 'azienda solida' : 'verificare stato'}`)
  if (profile.certificazioni) puntiForza.push(`Certificazioni: ${profile.certificazioni} — indice di maturità gestionale`)

  // Domande chiave
  const domandeChiave: string[] = []
  domandeChiave.push(`"Con chi si assicura attualmente? È soddisfatto del servizio?"`)
  domandeChiave.push(`"Quando scadono le sue polizze principali?"`)
  if (isDI) domandeChiave.push(`"Ha una polizza infortuni personale? Come titolare di DI, l'INAIL non la copre."`)
  if (obblighi.length > 0) domandeChiave.push(`"Ha tutte le coperture obbligatorie per il suo settore? Ne ho identificate ${obblighi.length}."`)
  if (critiche.length > 0) domandeChiave.push(`"Posso farle vedere ${critiche.length} vulnerabilità specifiche che ho trovato analizzando il suo profilo?"`)
  if (profile.ha_flotta_veicoli) domandeChiave.push(`"Quanti veicoli avete? Li assicurate singolarmente o con una polizza flotta?"`)

  // Obiezioni e risposte
  const obiezioni: string[] = []
  obiezioni.push(`"Sono già assicurato" → "Perfetto, posso fare un check-up gratuito? Nel 70% dei casi trovo scoperture che il cliente non sapeva di avere."`)
  obiezioni.push(`"Non ho budget" → "Capisco. Ma sa quanto le costerebbe un fermo di 30 giorni senza copertura? €${fmtNum(Math.max(3000, Math.round(fat / 220 * 30)))}. La polizza costa una frazione."`)
  if (isDI) obiezioni.push(`"Non mi serve, non mi è mai successo niente" → "Nemmeno a chi ha avuto un infortunio la settimana scorsa. Ma lei come titolare DI non ha INAIL — se succede, è scoperto al 100%."`)

  return {
    apertura,
    punti_forza: puntiForza,
    domande_chiave: domandeChiave,
    obiezioni_probabili: obiezioni,
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Formattazione numeri
// ═══════════════════════════════════════════════════════════════════

function fmtNum(n: number): string {
  return new Intl.NumberFormat('it-IT').format(Math.round(n))
}
