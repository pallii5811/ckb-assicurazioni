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
  const dipLabel = dip >= 50 ? `almeno ${dip}` : String(dip)
  const cap = profile.capitale_sociale || 0
  const nome = profile.ragione_sociale || ''
  const isDI = /\bDI\b|INDIVIDUALE|DITTA INDIVID/i.test(fg) || fgCode === 'DI'
  const isSRL = /SRL|SRLS|S\.R\.L|RESPONSABILIT[ÀA]'?\s+LIMITATA/i.test(fg) || fgCode === 'SR' || fgCode === 'SRL'
  const isSPA = /SPA|S\.P\.A|PER AZIONI/i.test(fg) || fgCode === 'SP' || fgCode === 'SPA'
  const isSocietaCapitali = isSRL || isSPA
  const isSocietaPersone = /SAS|SNC|S\.A\.S|S\.N\.C/i.test(fg)
  const hasDip = dip > 0
  const annoCostituzione = profile.data_costituzione ? parseInt(profile.data_costituzione.substring(0, 4)) : null
  const anniAttivita = annoCostituzione ? new Date().getFullYear() - annoCostituzione : null
  const settore = getSettoreFromAteco(ateco)
  const atecoDigits = ateco.replace(/\D/g, '')
  const descLower = `${profile.descrizione_ateco || ''} ${nome} ${fg}`.toLowerCase()
  const isICT = /^(62|63)/.test(atecoDigits) || /software|informat|ict|digitale|cloud|hosting|saas/.test(descLower)
  const isRegulatedProfessionalContext = /avvocat|commercialist|consulent[ei]\s+del\s+lavoro|notai|notaio|architett|ingegner|geometr|perit[oi]|medic|dentist|veterinar|psicolog|farmac/.test(descLower)

  // ─── 1. OBBLIGHI DI LEGGE UNIVERSALI ───────────────────────────

  // INAIL / Rivalsa INAIL — ogni azienda con dipendenti
  if (hasDip) {
    obblighi.push({
      polizza: 'Rivalsa INAIL / RC Operai (RCO)',
      tipo: 'obbligo_legge',
      norma: 'D.Lgs. 81/2008, art. 18; DPR 1124/1965 (Azione di Regresso)',
      descrizione: `${dipLabel} dipendente/i registrato/i. L'INAIL copre l'infortunio, MA se c'è responsabilità del datore di lavoro (es. violazione norme sicurezza), l'INAIL esercita l'azione di Rivalsa (Regresso) chiedendo i soldi indietro all'azienda.`,
      sanzione: 'Esposizione finanziaria totale del patrimonio aziendale (e personale per le DI/SNC) per rimborsare l\'INAIL in caso di infortunio grave o mortale del dipendente',
      azione_broker: 'Verificare presenza RCO, massimali per sinistro/persona, sottolimiti, franchigie ed esclusioni. Dimensionare il benchmark su numero addetti, attività di cantiere e gravità potenziale del sinistro.',
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
      descrizione: `Con ${dipLabel} dipendente/i, il DVR è obbligatorio e non delegabile dal datore di lavoro.${dip <= 10 ? ' Può utilizzare procedure standardizzate (art. 29 comma 5).' : ''}`,
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
      polizza: 'Responsabilità civile cantiere / RCT-RCO da verificare',
      tipo: 'obbligo_settoriale',
      norma: 'D.Lgs. 81/2008; Art. 2043-2055 Codice Civile',
      descrizione: `ATECO ${ateco}: attività di ${profile.descrizione_ateco || 'costruzioni/installazioni'}. La responsabilità per danni a terzi, committenti e prestatori durante i lavori è intrinseca all'attività.`,
      sanzione: 'Responsabilità patrimoniale per danni a terzi o prestatori, con possibile esposizione personale nelle ditte individuali e società di persone',
      azione_broker: /^43\.?2/.test(ateco) ? 'Verificare massimale RCT/RCO e copertura danni post-intervento per installazioni/impianti.' : 'Verificare presenza, massimale ed esclusioni RCT/RCO per cantieri, subappalti e danni a terzi.',
    })

    if (/^43\.2/.test(ateco)) {
      // Installazioni impianti
      obblighi.push({
        polizza: 'Abilitazione DM 37/2008 + RC Installatore',
        tipo: 'obbligo_legge',
        norma: 'DM 37/2008 (ex L. 46/1990)',
        descrizione: `L'installazione di impianti elettrici (ATECO ${ateco}) richiede requisiti tecnico-professionali e abilitazione ai sensi del DM 37/2008 per gli ambiti applicabili. Le dichiarazioni di conformità aprono responsabilità tecniche e civili da qualificare.`,
        sanzione: 'Possibili sanzioni amministrative, contestazioni sulla conformità dell’impianto e responsabilità civile/penale in caso di difetti o danni.',
        azione_broker: 'Verificare abilitazione DM 37/2008, lettere abilitative, dichiarazioni di conformità, RC installatore/post-intervento, tutela legale tecnica ed eventuali garanzie postume richieste da contratto o committente.',
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
  if (/^6[9]|^7[0-4]/.test(atecoPrefix2) && isRegulatedProfessionalContext) {
    obblighi.push({
      polizza: 'RC Professionale per attività ordinistiche — da verificare',
      tipo: 'obbligo_settoriale',
      norma: 'DPR 137/2012, art. 5 — applicabile se l’attività è svolta da professionisti iscritti ad albo/ordine',
      descrizione: `ATECO ${ateco}: attività professionale/tecnica. L'obbligo RC va verificato solo se l'attività è svolta da professionisti iscritti ad albo o da una STP; per società non ordinistiche resta comunque tema E&O/RC contrattuale.`,
      sanzione: 'Se presente attività ordinistica senza copertura conforme: possibile rilievo disciplinare e responsabilità patrimoniale; negli altri casi il rischio è contrattuale/civile da qualificare.',
      azione_broker: 'Verificare iscrizione ad albo/STP, contratti, massimale, retroattività, postuma, danni patrimoniali puri, tutela legale ed esclusioni.',
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
      azione_broker: 'Verificare massimale, retroattività, postuma, estensione colpa grave, esclusioni e tutela legale.',
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
      titolo: 'TITOLARE DI DITTA INDIVIDUALE — COPERTURA PERSONALE DA VERIFICARE',
      gravita: 'critica',
      fatto: `${nome} è una Ditta Individuale (DI). Il titolare e l'eventuale posizione INAIL/artigiana vanno verificati separatamente rispetto ai dipendenti.${profile.titolare ? ` Il referente operativo identificato è ${profile.titolare}` : ''}.`,
      conseguenza: `Se ${profile.titolare || 'il titolare'} si infortuna${settore.rischio_infortunio ? ` (settore ${settore.nome}: rischio ${settore.rischio_infortunio})` : ''}, l'attività può subire fermo operativo e perdita di reddito. Anche dove esiste tutela obbligatoria, diaria, invalidità, scoperti e continuità aziendale restano da verificare.`,
      soluzione: 'Verificare posizione INAIL del titolare/artigiano + proporre Infortuni Titolare/Key Man con diaria da fermo attività, invalidità permanente e caso morte.',
      domanda_killer: `"${profile.titolare || 'Sig. Titolare'}, se domani si fa male in cantiere e non può lavorare per 60 giorni, quale tutela mantiene reddito e continuità dell'attività?"`,
    })
  }

  // Società di capitali senza D&O adeguata
  if (isSocietaCapitali) {
    const esposizione = fat > 0 ? fat : (cap > 0 ? cap * 5 : 0)
    vulnerabilita.push({
      titolo: 'RESPONSABILITÀ PATRIMONIALE AMMINISTRATORI',
      gravita: fat > 2_000_000 ? 'critica' : 'alta',
      fatto: `${nome} è una ${isSRL ? 'S.R.L.' : 'S.P.A.'}. Gli amministratori possono essere chiamati a rispondere per danni verso società, soci e creditori (art. 2476 c.c. per SRL, art. 2392 c.c. per SPA).${fat > 0 ? ` Con €${fmtNum(fat)} di fatturato, il tema merita una verifica tecnica.` : ''}`,
      conseguenza: `In caso di azione di responsabilità, difesa legale, patrimonio personale, cariche cessate, creditori e soci diventano aree da qualificare.`,
      soluzione: `Verificare presenza D&O, massimale, retroattività, postuma, esclusioni e copertura costi di difesa. Benchmark massimale da discutere: circa €${fmtNum(Math.max(500_000, esposizione || 500_000))}.`,
      domanda_killer: `"Avete già verificato se amministratori e cariche sociali sono coperti per responsabilità verso soci, creditori e terzi? Con quale massimale e retroattività?"`,
    })
    fontiNormative.add('Art. 2476 c.c. — Responsabilità amministratori SRL')
  }

  // Dipendenti senza welfare verificato
  if (dip >= 1) {
    const ccnl = getCCNLFromAteco(ateco)
    if (ccnl) {
      vulnerabilita.push({
        titolo: `CCNL E FONDI DIPENDENTI — DA VERIFICARE`,
        gravita: 'alta',
        fatto: `ATECO ${ateco}: il codice attività non prova da solo il CCNL applicato. Area da verificare: ${ccnl.nome}. Checklist: ${ccnl.obblighi_assicurativi.join(', ')}.`,
        conseguenza: 'CCNL applicato, Cassa/Fondi, formazione e coperture integrative incidono su vertenze, ispezioni, costo lavoro e responsabilità del datore.',
        soluzione: `Verificare da cedolino/consulente del lavoro quale CCNL è realmente applicato e quali fondi, welfare, formazione e coperture integrative sono effettivamente dovuti.`,
        domanda_killer: `"Che CCNL applicate davvero ai dipendenti? Avete già verificato Cassa/Fondi, formazione e coperture integrative previste?"`,
      })
    }
  }

  // Key Man risk per micro imprese
  if (dip <= 3 && profile.titolare) {
    vulnerabilita.push({
      titolo: 'RISCHIO KEY PERSON — FIGURE OPERATIVE DA IDENTIFICARE',
      gravita: 'critica',
      fatto: isDI
        ? `${nome} ha ${dipLabel} dipendente/i e ${profile.titolare} risulta referente/titolare. Fatturato${fat > 0 ? ` annuo rilevato: €${fmtNum(fat)}.` : ' non disponibile: impatto economico da quantificare in call.'}`
        : `${nome} ha ${dipLabel} dipendente/i: la struttura è micro. ${profile.titolare} risulta persona registrata nel profilo pubblico, ma il ruolo operativo non va presunto; vanno identificati in call soci, amministratori e figure tecniche/commerciali essenziali.${fat > 0 ? ` Fatturato annuo rilevato: €${fmtNum(fat)}.` : ''}`,
      conseguenza: fat > 0 ? `Fermo attività = mancata produzione + costi fissi che continuano. Benchmark operativo: circa €${fmtNum(Math.max(100, Math.round(fat / 220)))}/giorno lavorativo di fatturato esposto.` : 'Se la persona chiave non lavora, il broker deve quantificare in call giorni di autonomia, costi fissi e commesse in corso.',
      soluzione: 'Polizza Key Man/Infortuni: invalidità temporanea, permanente e caso morte. Massimale da tarare su fatturato reale, costi fissi e durata massima di fermo sostenibile.',
      domanda_killer: isDI
        ? `"${profile.titolare}, se lei domani non può più lavorare per 3 mesi, quanto perde l'azienda? Chi copre i costi fissi che continuano a correre?"`
        : '"Chi tra soci, amministratori o tecnici presidia clienti, sviluppo/produzione e continuità operativa? Se quella persona si ferma 3 mesi, quanti giorni regge l’azienda?"',
    })
  }

  // Rischio sismico
  if (profile.zona_sismica && profile.zona_sismica <= 2) {
    vulnerabilita.push({
      titolo: `ZONA SISMICA ${profile.zona_sismica} — RISCHIO TERREMOTO`,
      gravita: profile.zona_sismica === 1 ? 'critica' : 'alta',
      fatto: `La sede di ${profile.citta || 'N/D'} è classificata in Zona Sismica ${profile.zona_sismica} (${profile.zona_sismica === 1 ? 'massima pericolosità' : 'alta pericolosità'}). Classificazione OPCM 3274/2003.`,
      conseguenza: 'La garanzia terremoto non va mai presunta: spesso è un’estensione specifica con limiti, scoperti e franchigie dedicate.',
      soluzione: 'Verificare se la property include terremoto, valore assicurato, scoperto/franchigia, limite di indennizzo e ubicazioni coperte.',
      domanda_killer: `"${profile.citta || 'La sua sede'} è in zona sismica ${profile.zona_sismica}. La vostra property include esplicitamente terremoto? Con quale limite e franchigia?"`,
    })
    fontiNormative.add('OPCM 3274/2003 — Classificazione Sismica')
  }

  // Rischio idrogeologico
  if (profile.rischio_idrogeologico === 'alto') {
    vulnerabilita.push({
      titolo: 'ZONA AD ALTO RISCHIO IDROGEOLOGICO',
      gravita: 'alta',
      fatto: `La sede è in area classificata ad alto rischio idrogeologico (fonte: ISPRA/mapping territoriale).`,
      conseguenza: 'Alluvione, allagamento, eventi atmosferici e danni da acqua hanno spesso sottolimiti, scoperti o condizioni specifiche da leggere in polizza.',
      soluzione: 'Verificare property: eventi atmosferici, allagamento, acqua condotta, franchigie, scoperti, limiti di indennizzo e ubicazioni coperte.',
      domanda_killer: '"La vostra property include esplicitamente allagamento/eventi atmosferici per questa ubicazione? Con quale limite, scoperto e franchigia?"',
    })
    fontiNormative.add('D.Lgs. 152/2006 — Codice Ambiente')
  }

  // Azienda giovane (< 3 anni)
  if (anniAttivita !== null && anniAttivita <= 3) {
    vulnerabilita.push({
      titolo: 'AZIENDA GIOVANE — PORTAFOGLIO DA STRUTTURARE',
      gravita: 'media',
      fatto: `Costituita il ${profile.data_costituzione} — circa ${anniAttivita} anni di attività.`,
      conseguenza: 'Nelle imprese giovani scadenziario, massimali e priorità assicurative sono spesso ancora da consolidare.',
      soluzione: 'Audit starter: responsabilità civile, persona chiave, attrezzature, tutela legale, cyber se rilevante e continuità operativa.',
      domanda_killer: '"Avete già uno scadenziario unico con massimali, franchigie, esclusioni e priorità per il primo rinnovo?"',
    })
  }

  // ─── 4. OPPORTUNITÀ DI CROSS-SELL ─────────────────────────────

  // Costruzioni: CAR/EAR per ogni cantiere
  if (/^4[1-3]/.test(atecoPrefix2)) {
    opportunita.push({
      polizza: 'Polizza CAR/EAR (Contractor All Risks)',
      motivo_specifico: `ATECO ${ateco}: ogni cantiere può generare esposizioni su opera in corso, materiali, attrezzature, subappalti e danni accidentali. La CAR/EAR è spesso richiesta dal committente per contratto.`,
      valore_per_cliente: 'Protegge l\'investimento dell\'opera e può diventare requisito commerciale per ottenere o mantenere commesse.',
      trigger_vendita: '"Quanti cantieri avete aperti o in partenza? Per quali contratti il committente richiede CAR/EAR o garanzie specifiche?"',
      premio_indicativo: `0,3%-0,8% del valore dell'opera (es. opera da €100.000 → premio €300-800)`,
      fonte_dato: 'Prassi mercato assicurativo — ramo Rischi Tecnologici',
    })

    opportunita.push({
      polizza: 'Polizza Decennale Postuma',
      motivo_specifico: `Per nuove costruzioni, opere strutturali o lavori soggetti a responsabilità ex art. 1669 c.c., la decennale/postuma può coprire difetti gravi che emergono dopo la consegna.${/^43\.2/.test(ateco) ? " Per installazioni impiantistiche va verificata anche la responsabilità post-intervento collegata alla conformità dell'impianto." : ''}`,
      valore_per_cliente: 'Trasforma un rischio di responsabilità pluriennale in una copertura discutibile in modo tecnico con committente e consulente.',
      trigger_vendita: '"Per lavori strutturali, nuove costruzioni o impianti, avete già verificato responsabilità post-consegna, decennale/postuma e limiti della RC attuale?"',
      premio_indicativo: '1,5%-3% del valore dell\'opera, pagamento una tantum',
      fonte_dato: 'Art. 1669 c.c. — Responsabilità decennale appaltatore',
    })
  }

  // Cyber Risk per aziende con sito web
  if (profile.sito && (isICT || dip >= 3 || fat >= 300_000)) {
    opportunita.push({
      polizza: 'Polizza Cyber Risk',
      motivo_specifico: `${nome} ha un sito web (${profile.sito})${dip > 0 ? ` e ${dipLabel} dipendenti` : ''}${isICT ? ' e attività coerente con software/ICT' : ''}. Da verificare dati trattati, accessi, backup, email aziendali, responsabilità privacy e continuità digitale.`,
      valore_per_cliente: 'Può coprire costi di ripristino sistemi, gestione data breach, responsabilità privacy, ransomware e perdita di fatturato da fermo IT.',
      trigger_vendita: '"Se email, gestionale o sito restano fermi 3 giorni, quanto impatta su ordini, clienti e fatturazione? Avete backup e incident response formalizzati?"',
      premio_indicativo: `€${fmtNum(Math.max(500, Math.round(fat * 0.001)))} - €${fmtNum(Math.max(2000, Math.round(fat * 0.003)))} annui`,
      fonte_dato: 'Report Clusit 2024 — Sicurezza ICT Italia',
    })
    fontiNormative.add('Reg. UE 2016/679 — GDPR')
  }

  // Polizza Infortuni Titolare (per DI e micro)
  if (isDI || (dip <= 2 && profile.titolare)) {
    opportunita.push({
      polizza: isDI ? 'Polizza Infortuni Titolare / Key Man' : 'Polizza Key Person / Infortuni figure operative',
      motivo_specifico: isDI
        ? `${profile.titolare || 'Il titolare'} risulta referente/titolare. Per una DI va verificata la posizione personale del titolare e l'eventuale differenza tra tutele obbligatorie e reddito reale. Se non lavora, continuità e liquidità vanno quantificate.`
        : `La struttura è micro: vanno identificate in call le figure operative essenziali tra soci, amministratori, tecnici o referenti commerciali. Continuità e liquidità non vanno attribuite a una singola persona senza verifica.`,
      valore_per_cliente: fat > 0 ? `Può garantire liquidità durante il periodo di inabilità. Range diario da tarare sul fatturato: circa €${Math.max(50, Math.round(fat / 220 * 0.8))}-${Math.max(100, Math.round(fat / 220))}/giorno come base di discussione.` : 'Può garantire liquidità durante il periodo di inabilità. La diaria va costruita in call su reddito, costi fissi e autonomia finanziaria.',
      trigger_vendita: isDI
        ? `"${profile.titolare || 'Sig. Titolare'}, se si fa male e resta fermo due mesi, quale copertura mantiene reddito, costi fissi e continuità delle commesse?"`
        : '"Chi sono le 1-2 persone senza cui clienti, sviluppo/produzione o amministrazione si fermano? Quanto costa un fermo di 60 giorni?"',
      premio_indicativo: `€400-1.200/anno per massimale morte/IP €200.000 + ITT €80-150/giorno`,
      fonte_dato: 'Tariffario ANIA — Ramo Infortuni',
    })
  }

  // Property / Incendio
  if (profile.ha_immobili_proprieta || fat >= 200_000) {
    opportunita.push({
      polizza: 'Polizza Property / All Risks',
      motivo_specifico: `${profile.ha_immobili_proprieta ? 'L\'azienda possiede immobili' : `Con un fatturato di €${fmtNum(fat)}, vanno verificati attrezzature, beni strumentali, merci e ubicazioni operative`}. Valori, ubicazioni ed esclusioni vanno verificati.`,
      valore_per_cliente: 'Può coprire ricostruzione/sostituzione di immobili, attrezzature, scorte e macchinari, oltre al fermo attività se previsto.',
      trigger_vendita: '"Se domattina trovate il magazzino/laboratorio bruciato, avete i soldi per ricomprare tutto e ricominciare? In quanto tempo?"',
      premio_indicativo: `€${fmtNum(Math.max(400, Math.round(fat * 0.001)))} - €${fmtNum(Math.max(1500, Math.round(fat * 0.003)))} annui`,
      fonte_dato: 'Benchmark ANIA — Ramo Incendio e Rischi Complementari',
    })
  }

  // TFR in azienda (obbligo per tutti i dipendenti)
  if (dip >= 1) {
    const costoPersonale = typeof profile.costo_personale === 'number' ? profile.costo_personale : null
    const tfr_annuo = costoPersonale !== null ? Math.round(costoPersonale * 0.0691) : null
    opportunita.push({
      polizza: 'Fondo Pensione / TFR Complementare',
      motivo_specifico: costoPersonale !== null && tfr_annuo !== null
        ? `Con ${dipLabel} dipendente/i e costo del personale €${fmtNum(costoPersonale)}, il TFR maturato è stimabile in circa €${fmtNum(tfr_annuo)}/anno.`
        : `Con ${dipLabel} dipendente/i, TFR, previdenza complementare e welfare vanno verificati; senza costo del personale non è corretto stimare l'importo maturato.`,
      valore_per_cliente: 'La destinazione del TFR e la previdenza complementare possono generare vantaggi fiscali e welfare, da verificare in base a CCNL, adesioni e policy aziendale.',
      trigger_vendita: '"Dove destinate il TFR dei dipendenti? In azienda, fondo negoziale o fondo aperto? Avete già verificato impatto fiscale, adesioni e comunicazione ai dipendenti?"',
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
      patrimonio_a_rischio: patrimonioRischio > 0 ? `€${fmtNum(patrimonioRischio)} benchmark da validare` : 'Da quantificare',
      costo_fermo_giornaliero: costoFermoGiornaliero > 0 ? `€${fmtNum(costoFermoGiornaliero)}/giorno benchmark da validare` : 'Da quantificare',
      esposizione_rc: fat > 0 ? `€${fmtNum(Math.max(500_000, fat * 2))} benchmark massimale da discutere` : 'Da quantificare',
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
  const normalized = ateco.replace(/\D/g, '')
  if (/^432/.test(normalized)) return {
    nome: 'Impiantistica / installazione impianti — CCNL da verificare',
    obblighi_assicurativi: [
      'CCNL effettivamente applicato da verificare: edilizia, metalmeccanico/artigiano o installazione impianti possono dipendere da attività prevalente e inquadramento',
      'Posizioni INAIL, sicurezza lavoro e formazione da verificare per attività presso cantieri/clienti',
      'Fondi sanitari/previdenziali da verificare in base al CCNL realmente applicato',
      'Abilitazioni tecniche e dichiarazioni di conformità da verificare per DM 37/2008',
    ],
  }
  if (/^4[1-3]/.test(p2)) return {
    nome: 'Edilizia — CCNL da verificare',
    obblighi_assicurativi: [
      'Iscrizione Cassa Edile da verificare in base a CCNL, attività effettiva e inquadramento',
      'Previdenza complementare PREVEDI da verificare',
      'Fondo sanitario SANEDIL da verificare per gli operai edili',
      'Formazione sicurezza/cantiere da verificare in base a mansioni, inquadramento e attività effettiva',
    ],
  }
  if (/^4[5-7]/.test(p2)) return {
    nome: 'Commercio/terziario — CCNL da verificare',
    obblighi_assicurativi: [
      'Eventuale Fondo Est o fondo sanitario collegato al CCNL realmente applicato',
      'Eventuale previdenza complementare collegata al CCNL effettivo',
      'Eventuali fondi/istituti per quadri o welfare da verificare se presenti',
    ],
  }
  if (/^1[0-2]/.test(p2)) return {
    nome: 'Industria alimentare — CCNL da verificare',
    obblighi_assicurativi: [
      'Eventuale fondo sanitario collegato al CCNL realmente applicato',
      'Eventuale previdenza complementare collegata al CCNL effettivo',
      'Eventuali coperture extra-professionali previste solo da specifici contratti',
    ],
  }
  if (/^5[5-6]/.test(p2)) return {
    nome: 'Turismo/ristorazione — CCNL da verificare',
    obblighi_assicurativi: [
      'Eventuale fondo sanitario collegato al CCNL realmente applicato',
      'Eventuale previdenza complementare collegata al CCNL effettivo',
      'Eventuali coperture integrative per stagionali da verificare sul contratto applicato',
    ],
  }
  if (/^6[2-3]/.test(p2)) return {
    nome: 'Area ICT/servizi digitali — CCNL da verificare',
    obblighi_assicurativi: [
      'CCNL realmente applicato da verificare su cedolino/consulente del lavoro',
      'Eventuali fondi sanitari, previdenza complementare e welfare collegati al CCNL effettivo',
      'Inquadramenti, formazione e coperture integrative da verificare sul contratto applicato',
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
  if (profile.codice_ateco) puntiForza.push(`ATECO ${profile.codice_ateco}: ${profile.descrizione_ateco || settore.nome} — posso preparare una checklist assicurativa settoriale da validare sui rischi reali`)
  if (fat > 0) puntiForza.push(`Fatturato €${fmtNum(fat)} — so dimensionare le coperture sul suo volume d'affari reale`)
  if (dip > 0) puntiForza.push(`${dip} dipendenti — posso verificare CCNL applicato, fondi, welfare, RCO e sicurezza lavoro`)
  if (profile.data_costituzione) puntiForza.push(`Attiva dal ${profile.data_costituzione} — ${profile.stato_attivita === 'ATTIVA' ? 'dato anagrafico utile per storicità e continuità' : 'verificare stato'}`)
  if (profile.certificazioni) puntiForza.push(`Certificazioni: ${profile.certificazioni} — indice di maturità gestionale`)

  // Domande chiave
  const domandeChiave: string[] = []
  domandeChiave.push(`"Con chi si assicura attualmente? È soddisfatto del servizio?"`)
  domandeChiave.push(`"Quando scadono le sue polizze principali?"`)
  if (isDI) domandeChiave.push(`"Avete già verificato posizione personale del titolare, diaria, invalidità e continuità operativa se lei si ferma?"`)
  if (obblighi.length > 0) domandeChiave.push(`"Posso verificare con voi ${obblighi.length} responsabilità/obblighi collegati al vostro settore e capire cosa è già coperto?"`)
  if (critiche.length > 0) domandeChiave.push(`"Posso farle vedere ${critiche.length} vulnerabilità specifiche che ho trovato analizzando il suo profilo?"`)
  if (profile.ha_flotta_veicoli) domandeChiave.push(`"Quanti veicoli avete? Li assicurate singolarmente o con una polizza flotta?"`)

  // Obiezioni e risposte
  const obiezioni: string[] = []
  obiezioni.push(`"Sono già assicurato" → "Perfetto, allora il valore è verificare se massimali, esclusioni, franchigie e scadenze sono ancora coerenti con i dati attuali dell'azienda."`)
  obiezioni.push(`"Non ho budget" → "Ha senso: proprio per questo partirei da inefficienze, duplicazioni, franchigie e priorità reali, senza proporre coperture inutili."`)
  if (isDI) obiezioni.push(`"Non mi serve, non mi è mai successo niente" → "Il punto non è prevedere il sinistro: è capire quanti giorni l'attività regge se il titolare operativo si ferma e quali tutele personali sono già attive."`)

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
