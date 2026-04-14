/**
 * Rischio territoriale italiano — dati REALI
 * Fonte: Protezione Civile, OPCM 3274/2003 aggiornata + delibere regionali, ISPRA
 * 
 * Zona sismica 1: rischio molto alto (es. Calabria, Sicilia orientale, Friuli, Irpinia)
 * Zona sismica 2: rischio alto (es. Abruzzo, Campania, Emilia-Romagna, Marche)
 * Zona sismica 3: rischio medio-basso (es. Lombardia, Veneto, Piemonte)
 * Zona sismica 4: rischio molto basso (es. Sardegna, parte Piemonte)
 *
 * NOTA: i comuni sono mappati individualmente dove differiscono dalla provincia.
 * Il lookup cerca prima il comune esatto, poi la provincia.
 */

// Comuni e province → zona sismica (1 = massimo rischio, 4 = minimo)
// Include sia capoluoghi di provincia sia comuni rilevanti che differiscono dalla zona provinciale
const SEISMIC_ZONES: Record<string, number> = {
  // ═══════════════════════════════════════════════════════
  // ZONA 1 — Rischio MOLTO ALTO
  // ═══════════════════════════════════════════════════════

  // Calabria (tutta zona 1)
  'cosenza': 1, 'catanzaro': 1, 'reggio calabria': 1, 'vibo valentia': 1, 'crotone': 1,
  'rende': 1, 'lamezia terme': 1, 'castrovillari': 1, 'corigliano-rossano': 1, 'corigliano calabro': 1,
  'rossano': 1, 'paola': 1, 'amantea': 1, 'acri': 1, 'san giovanni in fiore': 1,
  'catanzaro lido': 1, 'soverato': 1, 'sellia marina': 1, 'gioia tauro': 1, 'palmi': 1,
  'siderno': 1, 'locri': 1, 'melito di porto salvo': 1, 'villa san giovanni': 1, 'bagnara calabra': 1,
  'tropea': 1, 'pizzo': 1, 'serra san bruno': 1, 'isola di capo rizzuto': 1, 'cirò marina': 1,

  // Sicilia orientale (zona 1)
  'messina': 1, 'catania': 1, 'siracusa': 1, 'ragusa': 1,
  'taormina': 1, 'milazzo': 1, 'barcellona pozzo di gotto': 1, 'patti': 1, 'capo d\'orlando': 1,
  'acireale': 1, 'giarre': 1, 'caltagirone': 1, 'paternò': 1, 'adrano': 1, 'misterbianco': 1,
  'gravina di catania': 1, 'san giovanni la punta': 1, 'aci castello': 1, 'tremestieri etneo': 1,
  'augusta': 1, 'noto': 1, 'avola': 1, 'floridia': 1, 'lentini': 1, 'carlentini': 1,
  'modica': 1, 'comiso': 1, 'vittoria': 1, 'scicli': 1, 'ispica': 1, 'pozzallo': 1,

  // Basilicata (tutta zona 1)
  'potenza': 1, 'matera': 1,
  'melfi': 1, 'venosa': 1, 'lauria': 1, 'rionero in vulture': 1, 'lagonegro': 1,
  'policoro': 1, 'pisticci': 1, 'bernalda': 1, 'nova siri': 1, 'montescaglioso': 1,

  // Campania zona 1 (Irpinia, Sannio)
  'avellino': 1, 'benevento': 1,
  'ariano irpino': 1, 'montella': 1, 'lioni': 1, 'calitri': 1, 'sant\'angelo dei lombardi': 1,
  'bisaccia': 1, 'conza della campania': 1, 'nusco': 1, 'solofra': 1, 'atripalda': 1,
  'san giorgio del sannio': 1, 'montesarchio': 1, 'telese terme': 1, 'airola': 1,
  'cerreto sannita': 1, 'guardia sanframondi': 1, 'sant\'agata de\' goti': 1,

  // Molise (zona 1)
  'campobasso': 1, 'isernia': 1,
  'termoli': 1, 'larino': 1, 'bojano': 1, 'venafro': 1, 'agnone': 1,

  // Abruzzo zona 1 (L'Aquila, Rieti interno)
  'l\'aquila': 1, 'rieti': 1,
  'sulmona': 1, 'avezzano': 1, 'celano': 1, 'tagliacozzo': 1, 'castel di sangro': 1,
  'amatrice': 1, 'accumoli': 1, 'cittareale': 1, 'antrodoco': 1, 'borgorose': 1,

  // Umbria zona 1 (Valnerina, Nursino)
  'norcia': 1, 'cascia': 1, 'preci': 1, 'cerreto di spoleto': 1,
  'spoleto': 1, 'foligno': 1,

  // Friuli zona 1 (storica)
  'udine': 1, 'tolmezzo': 1, 'gemona del friuli': 1, 'tarcento': 1, 'cividale del friuli': 1,

  // Puglia zona 1
  'foggia': 1, 'san severo': 1, 'lucera': 1, 'cerignola': 1, 'manfredonia': 1,
  'san giovanni rotondo': 1, 'monte sant\'angelo': 1, 'vieste': 1, 'peschici': 1,

  // ═══════════════════════════════════════════════════════
  // ZONA 2 — Rischio ALTO
  // ═══════════════════════════════════════════════════════

  // Campania zona 2 (area vesuviana, casertano, salernitano)
  'napoli': 2, 'caserta': 2, 'salerno': 2,
  'torre del greco': 2, 'torre annunziata': 2, 'ercolano': 2, 'portici': 2, 'san giorgio a cremano': 2,
  'castellammare di stabia': 2, 'pozzuoli': 2, 'giugliano in campania': 2, 'marano di napoli': 2,
  'afragola': 2, 'casoria': 2, 'acerra': 2, 'nola': 2, 'pompei': 2, 'sorrento': 2,
  'amalfi': 2, 'positano': 2, 'ravello': 2, 'cava de\' tirreni': 2, 'nocera inferiore': 2,
  'battipaglia': 2, 'eboli': 2, 'agropoli': 2, 'sapri': 2, 'vallo della lucania': 2,
  'aversa': 2, 'maddaloni': 2, 'marcianise': 2, 'santa maria capua vetere': 2, 'capua': 2,
  'mondragone': 2, 'sessa aurunca': 2, 'piedimonte matese': 2,

  // Abruzzo zona 2
  'teramo': 2, 'pescara': 2, 'chieti': 2,
  'giulianova': 2, 'roseto degli abruzzi': 2, 'silvi': 2, 'montesilvano': 2,
  'francavilla al mare': 2, 'ortona': 2, 'lanciano': 2, 'vasto': 2, 'san salvo': 2, 'atessa': 2,

  // Lazio zona 2
  'frosinone': 2, 'latina': 2,
  'cassino': 2, 'sora': 2, 'alatri': 2, 'anagni': 2, 'ferentino': 2, 'veroli': 2, 'ceccano': 2,
  'formia': 2, 'gaeta': 2, 'minturno': 2, 'fondi': 2, 'terracina': 2, 'aprilia': 2,

  // Umbria zona 2
  'perugia': 2, 'terni': 2,
  'città di castello': 2, 'gubbio': 2, 'assisi': 2, 'bastia umbra': 2, 'todi': 2,
  'orvieto': 2, 'narni': 2, 'amelia': 2, 'marsciano': 2,

  // Marche (tutta zona 2)
  'ancona': 2, 'pesaro': 2, 'pesaro e urbino': 2, 'macerata': 2, 'ascoli piceno': 2, 'fermo': 2,
  'senigallia': 2, 'jesi': 2, 'fabriano': 2, 'osimo': 2, 'fano': 2, 'urbino': 2, 'fossombrone': 2,
  'civitanova marche': 2, 'tolentino': 2, 'camerino': 2, 'san benedetto del tronto': 2,
  'grottammare': 2, 'porto sant\'elpidio': 2, 'porto san giorgio': 2, 'recanati': 2, 'loreto': 2,

  // Emilia-Romagna (zona 2 — storicamente colpita)
  'parma': 2, 'reggio emilia': 2, 'modena': 2, 'bologna': 2, 'ferrara': 2,
  'forlì': 2, 'forli': 2, 'forlì-cesena': 2, 'rimini': 2, 'ravenna': 2,
  'cesena': 2, 'imola': 2, 'faenza': 2, 'lugo': 2, 'carpi': 2, 'sassuolo': 2, 'formigine': 2,
  'mirandola': 2, 'cento': 2, 'bondeno': 2, 'comacchio': 2, 'argenta': 2,
  'fidenza': 2, 'salsomaggiore terme': 2, 'langhirano': 2,
  'scandiano': 2, 'correggio': 2, 'guastalla': 2, 'castelnovo ne\' monti': 2,
  'casalecchio di reno': 2, 'san lazzaro di savena': 2, 'castel san pietro terme': 2, 'budrio': 2,
  'cattolica': 2, 'riccione': 2, 'bellaria-igea marina': 2, 'santarcangelo di romagna': 2,

  // Puglia zona 2 (centro-sud)
  'bari': 2, 'bat': 2, 'barletta': 2, 'taranto': 2, 'brindisi': 2, 'lecce': 2,
  'andria': 2, 'trani': 2, 'bisceglie': 2, 'molfetta': 2, 'bitonto': 2, 'altamura': 2,
  'gravina in puglia': 2, 'corato': 2, 'ruvo di puglia': 2,
  'monopoli': 2, 'conversano': 2, 'gioia del colle': 2, 'noci': 2,
  'martina franca': 2, 'massafra': 2, 'grottaglie': 2, 'manduria': 2,
  'francavilla fontana': 2, 'fasano': 2, 'ostuni': 2, 'mesagne': 2,
  'gallipoli': 2, 'nardò': 2, 'galatina': 2, 'maglie': 2, 'casarano': 2, 'tricase': 2,

  // Sicilia occidentale/centrale (zona 2)
  'palermo': 2, 'trapani': 2, 'agrigento': 2, 'caltanissetta': 2, 'enna': 2,
  'bagheria': 2, 'termini imerese': 2, 'cefalù': 2, 'monreale': 2, 'partinico': 2,
  'marsala': 2, 'mazara del vallo': 2, 'castelvetrano': 2, 'alcamo': 2, 'erice': 2,
  'sciacca': 2, 'licata': 2, 'canicattì': 2, 'favara': 2, 'ribera': 2,
  'gela': 2, 'niscemi': 2, 'mussomeli': 2, 'piazza armerina': 2, 'nicosia': 2,

  // Friuli-Venezia Giulia zona 2
  'trieste': 2, 'gorizia': 2, 'pordenone': 2,
  'monfalcone': 2, 'cormons': 2, 'sacile': 2, 'maniago': 2, 'spilimbergo': 2,
  'cervignano del friuli': 2, 'latisana': 2, 'codroipo': 2, 'san daniele del friuli': 2,

  // Toscana zona 2 (Mugello, Garfagnana, Amiata, Lunigiana)
  'firenze': 2, 'arezzo': 2, 'siena': 2, 'grosseto': 2,
  'borgo san lorenzo': 2, 'pontassieve': 2, 'empoli': 2, 'scandicci': 2, 'sesto fiorentino': 2,
  'cortona': 2, 'sansepolcro': 2, 'bibbiena': 2, 'montevarchi': 2, 'san giovanni valdarno': 2,
  'poggibonsi': 2, 'montepulciano': 2, 'chiusi': 2, 'colle di val d\'elsa': 2, 'montalcino': 2,
  'follonica': 2, 'orbetello': 2, 'massa marittima': 2, 'pitigliano': 2,
  'pontremoli': 2, 'fivizzano': 2, 'aulla': 2, // Lunigiana — zona 2, non zona 3 come Massa
  'barga': 2, 'castelnuovo di garfagnana': 2, // Garfagnana — zona 2
  'san marcello piteglio': 2, 'abetone': 2, // Appennino pistoiese — zona 2

  // ═══════════════════════════════════════════════════════
  // ZONA 3 — Rischio MEDIO-BASSO
  // ═══════════════════════════════════════════════════════

  // Lazio zona 3
  'roma': 3, 'viterbo': 3,
  'fiumicino': 3, 'guidonia montecelio': 3, 'tivoli': 3, 'velletri': 3, 'anzio': 3,
  'nettuno': 3, 'pomezia': 3, 'ardea': 3, 'ciampino': 3, 'frascati': 3,
  'civitavecchia': 3, 'cerveteri': 3, 'ladispoli': 3, 'bracciano': 3,
  'montefiascone': 3, 'tarquinia': 3, 'tuscania': 3,

  // Toscana zona 3 (costa e pianura)
  'pisa': 3, 'livorno': 3, 'lucca': 3, 'massa': 3, 'pistoia': 3, 'prato': 3,
  'viareggio': 3, 'forte dei marmi': 3, 'pietrasanta': 3, 'camaiore': 3,
  'carrara': 3, 'montecatini terme': 3, 'pescia': 3, 'capannori': 3,
  'cascina': 3, 'san giuliano terme': 3, 'pontedera': 3, 'san miniato': 3,
  'piombino': 3, 'cecina': 3, 'rosignano marittimo': 3, 'collesalvetti': 3,
  'montemurlo': 3, 'carmignano': 3, 'poggio a caiano': 3,

  // Lombardia (zona 3)
  'milano': 3, 'bergamo': 3, 'brescia': 3, 'como': 3, 'cremona': 3, 'lecco': 3,
  'lodi': 3, 'mantova': 3, 'monza': 3, 'monza e brianza': 3, 'pavia': 3, 'sondrio': 3, 'varese': 3,
  'sesto san giovanni': 3, 'cinisello balsamo': 3, 'rho': 3, 'legnano': 3, 'busto arsizio': 3,
  'gallarate': 3, 'saronno': 3, 'desio': 3, 'seregno': 3, 'lissone': 3, 'brugherio': 3,
  'cologno monzese': 3, 'rozzano': 3, 'corsico': 3, 'san donato milanese': 3, 'segrate': 3,
  'treviglio': 3, 'dalmine': 3, 'seriate': 3, 'romano di lombardia': 3,
  'desenzano del garda': 3, 'montichiari': 3, 'lumezzane': 3, 'chiari': 3,
  'cantù': 3, 'erba': 3, 'mariano comense': 3,
  'codogno': 3, 'casalpusterlengo': 3,
  'voghera': 3, 'vigevano': 3, 'mortara': 3, 'stradella': 3,
  'crema': 3, 'casalmaggiore': 3,

  // Piemonte (zona 3)
  'torino': 3, 'alessandria': 3, 'asti': 3, 'cuneo': 3, 'novara': 3, 'vercelli': 3, 'biella': 3,
  'verbania': 3, 'verbano-cusio-ossola': 3,
  'moncalieri': 3, 'collegno': 3, 'rivoli': 3, 'grugliasco': 3, 'nichelino': 3,
  'settimo torinese': 3, 'chieri': 3, 'pinerolo': 3, 'ivrea': 3, 'chivasso': 3,
  'alba': 3, 'bra': 3, 'fossano': 3, 'saluzzo': 3, 'mondovì': 3,
  'casale monferrato': 3, 'tortona': 3, 'novi ligure': 3, 'acqui terme': 3, 'ovada': 3,
  'borgomanero': 3, 'arona': 3, 'galliate': 3, 'trecate': 3,
  'borgosesia': 3, 'varallo': 3,

  // Veneto (zona 3)
  'venezia': 3, 'padova': 3, 'vicenza': 3, 'verona': 3, 'treviso': 3, 'belluno': 3, 'rovigo': 3,
  'mestre': 3, 'chioggia': 3, 'jesolo': 3, 'caorle': 3, 'san donà di piave': 3,
  'abano terme': 3, 'selvazzano dentro': 3, 'cittadella': 3, 'este': 3, 'monselice': 3,
  'bassano del grappa': 2, 'schio': 3, 'valdagno': 3, 'arzignano': 3, 'thiene': 3, // Bassano zona 2!
  'villafranca di verona': 3, 'san bonifacio': 3, 'legnago': 3, 'bussolengo': 3,
  'castelfranco veneto': 3, 'montebelluna': 3, 'conegliano': 3, 'vittorio veneto': 3,
  'feltre': 2, 'sedico': 2, 'agordo': 2, // zone pedemontane bellunesi — zona 2
  'cortina d\'ampezzo': 3, 'pieve di cadore': 3,
  'adria': 3, 'porto viro': 3, 'badia polesine': 3,

  // Trentino-Alto Adige (zona 3)
  'trento': 3, 'bolzano': 3,
  'rovereto': 3, 'riva del garda': 3, 'arco': 3, 'pergine valsugana': 3, 'levico terme': 3,
  'merano': 3, 'bressanone': 3, 'brunico': 3, 'laives': 3, 'appiano sulla strada del vino': 3,

  // Liguria (zona 3)
  'genova': 3, 'savona': 3, 'imperia': 3, 'la spezia': 3,
  'sanremo': 3, 'ventimiglia': 3, 'bordighera': 3, 'diano marina': 3,
  'albenga': 3, 'finale ligure': 3, 'loano': 3, 'varazze': 3,
  'rapallo': 3, 'chiavari': 3, 'sestri levante': 3, 'lavagna': 3, 'recco': 3,
  'sarzana': 3, 'lerici': 3, 'santo stefano di magra': 3,

  // Emilia zona 3 (Piacenza)
  'piacenza': 3, 'fiorenzuola d\'arda': 3, 'castel san giovanni': 3,

  // Valle d'Aosta (zona 3)
  'aosta': 3, 'courmayeur': 3, 'saint-vincent': 3, 'châtillon': 3,

  // ═══════════════════════════════════════════════════════
  // ZONA 4 — Rischio MOLTO BASSO
  // ═══════════════════════════════════════════════════════
  'sassari': 4, 'nuoro': 4, 'oristano': 4, 'cagliari': 4, 'sud sardegna': 4,
  'olbia': 4, 'olbia-tempio': 4, 'carbonia': 4, 'carbonia-iglesias': 4, 'medio campidano': 4,
  'ogliastra': 4,
  'alghero': 4, 'porto torres': 4, 'tempio pausania': 4, 'ozieri': 4,
  'tortolì': 4, 'lanusei': 4, 'iglesias': 4, 'guspini': 4, 'sanluri': 4,
  'quartu sant\'elena': 4, 'selargius': 4, 'assemini': 4, 'capoterra': 4,
  'sestu': 4, 'monserrato': 4, 'elmas': 4,
}

// Rischio idrogeologico per aree note (alluvioni, frane, vulcanismo)
// Fonte: ISPRA, PAI regionali, cronaca storica eventi
const HYDRO_RISK_AREAS: Record<string, { risk: 'alto' | 'medio' | 'basso'; detail: string }> = {
  // ── RISCHIO ALTO ──
  'genova': { risk: 'alto', detail: 'Storico rischio alluvionale — eventi gravi 2011, 2014, 2019' },
  'firenze': { risk: 'alto', detail: 'Rischio esondazione Arno — alluvione storica 1966' },
  'venezia': { risk: 'alto', detail: 'Rischio acqua alta ricorrente — subsidenza e maree, MOSE' },
  'napoli': { risk: 'alto', detail: 'Rischio vulcanico Vesuvio + bradisismo Campi Flegrei + frane collinari' },
  'catania': { risk: 'alto', detail: 'Rischio vulcanico Etna + colate laviche + alluvioni' },
  'salerno': { risk: 'alto', detail: 'Rischio idrogeologico elevato + frane costiere (Costiera Amalfitana, Vietri 1954)' },
  'cosenza': { risk: 'alto', detail: 'Elevato rischio frane + alluvioni — zona appenninica calabra' },
  'reggio calabria': { risk: 'alto', detail: 'Rischio sismico zona 1 + frane + alluvioni torrentizie' },
  'messina': { risk: 'alto', detail: 'Rischio sismico massimo + alluvioni storiche (Giampilieri 2009)' },
  'l\'aquila': { risk: 'alto', detail: 'Terremoto 2009 — ricostruzione ancora in corso, rischio frane montane' },
  'amatrice': { risk: 'alto', detail: 'Terremoto 2016 — distruzione quasi totale, area instabile' },
  'norcia': { risk: 'alto', detail: 'Terremoto 2016 — gravi danni strutturali, frane circostanti' },
  'ascoli piceno': { risk: 'alto', detail: 'Zona terremoto 2016-2017 — rischio sismico + frane appennino' },
  'potenza': { risk: 'alto', detail: 'Rischio sismico zona 1 + frane frequenti su terreno argilloso' },
  'matera': { risk: 'alto', detail: 'Rischio sismico zona 1 + dissesto idrogeologico gravine' },
  'pozzuoli': { risk: 'alto', detail: 'Bradisismo Campi Flegrei — rischio vulcanico attivo, evacuazione pianificata' },
  'torre del greco': { risk: 'alto', detail: 'Zona rossa Vesuvio — rischio vulcanico alto, colate piroclastiche' },
  'ercolano': { risk: 'alto', detail: 'Zona rossa Vesuvio — rischio eruzione e lahar' },
  'castellammare di stabia': { risk: 'alto', detail: 'Rischio frane Monte Faito + zona vesuviana' },
  'sarno': { risk: 'alto', detail: 'Frana catastrofica 1998 — 160 vittime, rischio colate di fango' },
  'cava de\' tirreni': { risk: 'alto', detail: 'Rischio frane collinari + alluvioni torrenti' },
  'amalfi': { risk: 'alto', detail: 'Frane costiere ricorrenti — Costiera Amalfitana' },
  'vietri sul mare': { risk: 'alto', detail: 'Alluvione storica 1954 — rischio frane e colate' },
  'soverato': { risk: 'alto', detail: 'Alluvione 2000 — rischio torrenti calabresi' },
  'vibo valentia': { risk: 'alto', detail: 'Rischio frane + alluvioni — terreno instabile' },
  'crotone': { risk: 'alto', detail: 'Alluvione 1996 e 2020 — esondazione Esaro' },
  'catanzaro': { risk: 'alto', detail: 'Rischio frane collinari + alluvioni torrenti ionici' },
  'lamezia terme': { risk: 'alto', detail: 'Rischio alluvionale pianura lametina' },
  'gioia tauro': { risk: 'alto', detail: 'Rischio sismico + alluvionale costa tirrenica' },
  'noto': { risk: 'alto', detail: 'Terremoto storico 1693 — ricostruzione barocca, zona sismica attiva' },
  'augusta': { risk: 'alto', detail: 'Rischio sismico + industriale (polo petrolchimico)' },
  'camerino': { risk: 'alto', detail: 'Terremoto 2016 — gravi danni, centro storico inagibile' },
  'tolentino': { risk: 'alto', detail: 'Terremoto 2016 — danni significativi' },
  'avellino': { risk: 'alto', detail: 'Terremoto Irpinia 1980 — 2914 vittime, rischio sismico massimo' },
  'benevento': { risk: 'alto', detail: 'Rischio sismico + alluvionale fiume Calore' },
  'campobasso': { risk: 'alto', detail: 'Rischio sismico zona 1 + frane su argille' },
  'sulmona': { risk: 'alto', detail: 'Rischio sismico elevato — conca peligna, zona 1' },
  'avezzano': { risk: 'alto', detail: 'Terremoto 1915 — 30.000 vittime, rischio massimo' },

  // ── RISCHIO MEDIO ──
  'roma': { risk: 'medio', detail: 'Rischio allagamento zone periferiche — esondazione Tevere e Aniene' },
  'milano': { risk: 'medio', detail: 'Rischio esondazione Seveso e Lambro in zone nord, allagamenti urbani' },
  'torino': { risk: 'medio', detail: 'Rischio esondazione Po e Dora in aree golenali' },
  'palermo': { risk: 'medio', detail: 'Rischio alluvionale per eventi meteo estremi + frane Monte Pellegrino' },
  'bologna': { risk: 'medio', detail: 'Rischio sismico medio + alluvionale pianura padana, subsidenza' },
  'parma': { risk: 'medio', detail: 'Rischio esondazione torrenti appenninici (Parma, Baganza)' },
  'modena': { risk: 'medio', detail: 'Terremoto Emilia 2012 — zona storicamente colpita, liquefazione suoli' },
  'ferrara': { risk: 'medio', detail: 'Terremoto Emilia 2012 — terreno alluvionale instabile, subsidenza' },
  'ravenna': { risk: 'medio', detail: 'Subsidenza costiera + rischio alluvionale, alluvione Romagna 2023' },
  'rimini': { risk: 'medio', detail: 'Rischio alluvionale costiero + erosione, alluvione 2023' },
  'foggia': { risk: 'medio', detail: 'Rischio sismico + alluvionale Tavoliere, grandinate' },
  'chiavari': { risk: 'medio', detail: 'Rischio alluvionale Entella — eventi 2014' },
  'rapallo': { risk: 'medio', detail: 'Rischio alluvionale + mareggiata 2018' },
  'la spezia': { risk: 'medio', detail: 'Rischio alluvionale — Cinque Terre, eventi 2011' },
  'savona': { risk: 'medio', detail: 'Rischio alluvionale — esondazione Letimbro, evento 2014' },
  'pisa': { risk: 'medio', detail: 'Rischio esondazione Arno a valle di Firenze' },
  'lucca': { risk: 'medio', detail: 'Rischio esondazione Serchio' },
  'massa': { risk: 'medio', detail: 'Rischio alluvionale torrenti apuani + frane cave marmo' },
  'carrara': { risk: 'medio', detail: 'Rischio frane cave marmo + alluvioni' },
  'perugia': { risk: 'medio', detail: 'Rischio sismico medio + frane collinari' },
  'terni': { risk: 'medio', detail: 'Rischio sismico + alluvionale Nera/Velino' },
  'ancona': { risk: 'medio', detail: 'Rischio frane costiere + sismico medio-alto' },
  'pesaro': { risk: 'medio', detail: 'Rischio alluvionale Foglia + sismico medio' },
  'fermo': { risk: 'medio', detail: 'Rischio sismico + frane collinari marchigiane' },
  'frosinone': { risk: 'medio', detail: 'Rischio sismico zona 2 + alluvionale valle del Sacco' },
  'latina': { risk: 'medio', detail: 'Rischio allagamento pianura pontina' },
  'caserta': { risk: 'medio', detail: 'Rischio alluvionale Volturno + area vesuviana' },
  'taranto': { risk: 'medio', detail: 'Rischio sismico medio + rischio industriale (ILVA)' },
  'bari': { risk: 'medio', detail: 'Rischio allagamento urbano — lame baresi' },
  'brindisi': { risk: 'medio', detail: 'Rischio costiero + rischio industriale (petrolchimico)' },
  'trapani': { risk: 'medio', detail: 'Rischio sismico medio + erosione costiera' },
  'agrigento': { risk: 'medio', detail: 'Rischio frane + erosione costiera (crollo palazzine 2016)' },
  'caltanissetta': { risk: 'medio', detail: 'Rischio frane su terreno argilloso + sismico' },
  'enna': { risk: 'medio', detail: 'Rischio frane montane + sismico' },
  'gela': { risk: 'medio', detail: 'Rischio alluvionale + rischio industriale (petrolchimico)' },
  'vicenza': { risk: 'medio', detail: 'Rischio alluvionale Bacchiglione — alluvione 2010' },
  'padova': { risk: 'medio', detail: 'Rischio alluvionale Bacchiglione e Brenta' },
  'verona': { risk: 'medio', detail: 'Rischio esondazione Adige — alluvione storica 1882' },
  'belluno': { risk: 'medio', detail: 'Rischio frane montane + alluvionale (Vajont 1963 vicino)' },
  'rovigo': { risk: 'medio', detail: 'Rischio alluvionale delta Po — terreno sotto livello mare' },
  'mantova': { risk: 'medio', detail: 'Rischio alluvionale pianura padana — Mincio e Po' },
  'cremona': { risk: 'medio', detail: 'Rischio esondazione Po' },
  'piacenza': { risk: 'medio', detail: 'Rischio esondazione Po e Trebbia' },
  'brescia': { risk: 'medio', detail: 'Rischio alluvionale valli prealpine + rischio industriale' },
  'sondrio': { risk: 'medio', detail: 'Rischio frane montane Valtellina (disastro 1987)' },
  'varese': { risk: 'medio', detail: 'Rischio esondazione Olona + frane prealpine' },
  'como': { risk: 'medio', detail: 'Rischio esondazione lago + frane collinari' },
  'lecco': { risk: 'medio', detail: 'Rischio frane prealpine + esondazione Adda' },
  'alessandria': { risk: 'medio', detail: 'Rischio alluvionale — alluvione Tanaro 1994' },
  'cuneo': { risk: 'medio', detail: 'Rischio alluvionale valli alpine (alluvione 1994)' },
  'novara': { risk: 'medio', detail: 'Rischio alluvionale risaie — pianura padana' },
  'vercelli': { risk: 'medio', detail: 'Rischio alluvionale Sesia e risaie' },
  'biella': { risk: 'medio', detail: 'Rischio alluvionale torrenti prealpini' },
  'verbania': { risk: 'medio', detail: 'Rischio esondazione lago Maggiore + frane montane' },
  'aosta': { risk: 'medio', detail: 'Rischio valanghe + frane montane + alluvione Dora Baltea' },
  'cesena': { risk: 'medio', detail: 'Alluvione Romagna maggio 2023 — esondazione Savio' },
  'faenza': { risk: 'medio', detail: 'Alluvione Romagna maggio 2023 — esondazione Lamone, gravi danni' },
  'lugo': { risk: 'medio', detail: 'Alluvione Romagna 2023 — allagamento esteso' },
  'forlì': { risk: 'medio', detail: 'Alluvione Romagna 2023 — esondazione Montone e Ronco' },
  'imola': { risk: 'medio', detail: 'Rischio alluvionale Santerno — evento 2023' },
  'mirandola': { risk: 'medio', detail: 'Terremoto Emilia 2012 — epicentro, danni gravissimi' },
  'cento': { risk: 'medio', detail: 'Terremoto Emilia 2012 — danni significativi' },
  'carpi': { risk: 'medio', detail: 'Terremoto Emilia 2012 — danni centro storico' },
  'bondeno': { risk: 'medio', detail: 'Terremoto Emilia 2012 — liquefazione suoli' },

  // ── RISCHIO BASSO ──
  'lecce': { risk: 'basso', detail: 'Rischio sismico moderato — terreno carsico stabile' },
  'cagliari': { risk: 'basso', detail: 'Rischio idrogeologico basso — zona stabile, sismicità minima' },
  'sassari': { risk: 'basso', detail: 'Rischio sismico minimo (zona 4), territorio stabile' },
  'olbia': { risk: 'basso', detail: 'Rischio alluvionale localizzato (evento 2013), generalmente stabile' },
  'nuoro': { risk: 'basso', detail: 'Rischio sismico minimo, frane localizzate in montagna' },
  'oristano': { risk: 'basso', detail: 'Rischio basso, pianura del Campidano stabile' },
}

export interface TerritorialRisk {
  zona_sismica: number | null          // 1-4
  zona_sismica_label: string           // "Zona 1 - Rischio molto alto"
  rischio_idrogeologico: 'alto' | 'medio' | 'basso' | 'non classificato'
  dettaglio_idrogeologico: string
  polizze_consigliate: string[]        // polizze raccomandate per il territorio
  fonte: string
}

function normalizeCity(city: string): string {
  return city.toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '')     // remove province codes like "(MI)"
    .replace(/\bprovincia di\b/gi, '')
    .replace(/\bcittà metropolitana di\b/gi, '')
    .trim()
}

export function getTerritorialRisk(city: string): TerritorialRisk {
  const normalized = normalizeCity(city)
  
  // Try exact match first, then partial
  let zone: number | null = SEISMIC_ZONES[normalized] ?? null
  if (zone === null) {
    for (const [key, val] of Object.entries(SEISMIC_ZONES)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        zone = val
        break
      }
    }
  }

  const zoneLabels: Record<number, string> = {
    1: 'Zona 1 — Rischio sismico MOLTO ALTO',
    2: 'Zona 2 — Rischio sismico ALTO',
    3: 'Zona 3 — Rischio sismico MEDIO-BASSO',
    4: 'Zona 4 — Rischio sismico MOLTO BASSO',
  }

  // Hydro risk
  let hydro = HYDRO_RISK_AREAS[normalized] ?? null
  if (!hydro) {
    for (const [key, val] of Object.entries(HYDRO_RISK_AREAS)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        hydro = val
        break
      }
    }
  }

  // Insurance recommendations based on territorial risk
  const polizze: string[] = []
  if (zone === 1 || zone === 2) {
    polizze.push('Polizza Terremoto (fortemente raccomandata)')
    polizze.push('Polizza All Risks Immobili')
  }
  if (zone === 1) {
    polizze.push('Polizza Interruzione Attività post-sisma')
  }
  if (hydro?.risk === 'alto') {
    polizze.push('Polizza Alluvione/Eventi Atmosferici')
    polizze.push('Polizza Danni Indiretti')
  } else if (hydro?.risk === 'medio') {
    polizze.push('Polizza Eventi Atmosferici')
  }
  if (normalized.includes('napoli') || normalized.includes('catania') || normalized.includes('messina')) {
    polizze.push('Polizza Rischio Vulcanico')
  }

  return {
    zona_sismica: zone,
    zona_sismica_label: zone ? zoneLabels[zone] : 'Non classificato',
    rischio_idrogeologico: hydro?.risk ?? 'non classificato',
    dettaglio_idrogeologico: hydro?.detail ?? '',
    polizze_consigliate: polizze,
    fonte: 'Protezione Civile — OPCM 3274/2003, ISPRA',
  }
}
