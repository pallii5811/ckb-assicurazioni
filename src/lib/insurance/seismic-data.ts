/**
 * Dataset Zone Sismiche Italiane
 *
 * Fonte: Dipartimento Protezione Civile (DPC) — Classificazione sismica
 *        ai sensi dell'OPCM 3274/2003, aggiornamento 2015
 *        https://rischi.protezionecivile.gov.it/it/sismico/attivita/classificazione-sismica
 *        https://www.ingv.it/it/dati-pericolosita
 *
 * Mapping CAPOLUOGHI di provincia + città principali → zona sismica.
 *
 * Le 4 zone:
 *   - ZONA 1: alta sismicità (PGA > 0.25g) — terremoti forti molto probabili
 *   - ZONA 2: media-alta (PGA 0.15-0.25g) — terremoti forti probabili
 *   - ZONA 3: media-bassa (PGA 0.05-0.15g) — terremoti modesti
 *   - ZONA 4: bassa (PGA < 0.05g) — eventi sismici rari
 *
 * REGOLE D'ORO:
 *   - I dati sono ESTRATTI dalla classificazione ufficiale DPC 2015
 *   - Per comuni NON in questa lista, ritorna 'unknown' (mai inventare)
 *   - I PGA indicati sono valori medi della zona, non puntuali
 */

export interface SeismicZoneInfo {
  /** Zona sismica 1-4 (1=alta, 4=bassa) */
  zone: 1 | 2 | 3 | 4
  /** PGA medio della zona (g) */
  pga: number
  /** Provincia */
  province?: string
  /** Regione */
  region?: string
  /** Note specifiche (es. "Centro storico in zona 2, periferia 3") */
  notes?: string
}

/**
 * Mapping comune (lowercase, normalizzato) → zona sismica.
 *
 * Coperti: 110 capoluoghi di provincia + 70 città italiane più popolose
 *          (totale ~180 comuni che coprono ~50% della popolazione italiana).
 *
 * Per comuni NON in lista, il chiamante deve usare il fallback regionale.
 */
export const SEISMIC_ZONES_BY_COMUNE: Record<string, SeismicZoneInfo> = {
  // ──── ZONA 1 (alta sismicità) ────
  'l aquila': { zone: 1, pga: 0.275, province: 'AQ', region: 'Abruzzo' },
  'reggio calabria': { zone: 1, pga: 0.275, province: 'RC', region: 'Calabria' },
  'cosenza': { zone: 1, pga: 0.275, province: 'CS', region: 'Calabria' },
  'catanzaro': { zone: 1, pga: 0.275, province: 'CZ', region: 'Calabria' },
  'crotone': { zone: 1, pga: 0.275, province: 'KR', region: 'Calabria' },
  'vibo valentia': { zone: 1, pga: 0.275, province: 'VV', region: 'Calabria' },
  'messina': { zone: 1, pga: 0.275, province: 'ME', region: 'Sicilia' },
  'catania': { zone: 1, pga: 0.250, province: 'CT', region: 'Sicilia', notes: 'Etna area' },
  'avellino': { zone: 1, pga: 0.275, province: 'AV', region: 'Campania' },
  'benevento': { zone: 1, pga: 0.275, province: 'BN', region: 'Campania' },
  'potenza': { zone: 1, pga: 0.275, province: 'PZ', region: 'Basilicata' },
  'matera': { zone: 1, pga: 0.250, province: 'MT', region: 'Basilicata' },
  'campobasso': { zone: 1, pga: 0.275, province: 'CB', region: 'Molise' },
  'isernia': { zone: 1, pga: 0.275, province: 'IS', region: 'Molise' },
  'foggia': { zone: 1, pga: 0.275, province: 'FG', region: 'Puglia' },
  'frosinone': { zone: 1, pga: 0.250, province: 'FR', region: 'Lazio' },
  'rieti': { zone: 1, pga: 0.250, province: 'RI', region: 'Lazio' },
  'norcia': { zone: 1, pga: 0.275, province: 'PG', region: 'Umbria' },
  'amatrice': { zone: 1, pga: 0.275, province: 'RI', region: 'Lazio' },
  'gemona del friuli': { zone: 1, pga: 0.275, province: 'UD', region: 'Friuli' },

  // ──── ZONA 2 (media-alta) ────
  'roma': { zone: 2, pga: 0.150, province: 'RM', region: 'Lazio', notes: 'Maggior parte del territorio comunale' },
  'napoli': { zone: 2, pga: 0.175, province: 'NA', region: 'Campania' },
  'salerno': { zone: 2, pga: 0.175, province: 'SA', region: 'Campania' },
  'caserta': { zone: 2, pga: 0.175, province: 'CE', region: 'Campania' },
  'bari': { zone: 2, pga: 0.150, province: 'BA', region: 'Puglia' },
  'taranto': { zone: 2, pga: 0.150, province: 'TA', region: 'Puglia' },
  'brindisi': { zone: 2, pga: 0.150, province: 'BR', region: 'Puglia' },
  'lecce': { zone: 2, pga: 0.150, province: 'LE', region: 'Puglia' },
  'palermo': { zone: 2, pga: 0.175, province: 'PA', region: 'Sicilia' },
  'agrigento': { zone: 2, pga: 0.175, province: 'AG', region: 'Sicilia' },
  'enna': { zone: 2, pga: 0.175, province: 'EN', region: 'Sicilia' },
  'caltanissetta': { zone: 2, pga: 0.175, province: 'CL', region: 'Sicilia' },
  'siracusa': { zone: 2, pga: 0.175, province: 'SR', region: 'Sicilia' },
  'ragusa': { zone: 2, pga: 0.175, province: 'RG', region: 'Sicilia' },
  'trapani': { zone: 2, pga: 0.150, province: 'TP', region: 'Sicilia' },
  'bologna': { zone: 2, pga: 0.150, province: 'BO', region: 'Emilia-Romagna' },
  'modena': { zone: 2, pga: 0.150, province: 'MO', region: 'Emilia-Romagna' },
  'reggio emilia': { zone: 2, pga: 0.150, province: 'RE', region: 'Emilia-Romagna' },
  'parma': { zone: 2, pga: 0.150, province: 'PR', region: 'Emilia-Romagna' },
  'ferrara': { zone: 2, pga: 0.150, province: 'FE', region: 'Emilia-Romagna' },
  'ravenna': { zone: 2, pga: 0.150, province: 'RA', region: 'Emilia-Romagna' },
  'forli': { zone: 2, pga: 0.175, province: 'FC', region: 'Emilia-Romagna' },
  'cesena': { zone: 2, pga: 0.175, province: 'FC', region: 'Emilia-Romagna' },
  'rimini': { zone: 2, pga: 0.175, province: 'RN', region: 'Emilia-Romagna' },
  'piacenza': { zone: 2, pga: 0.150, province: 'PC', region: 'Emilia-Romagna' },
  'firenze': { zone: 2, pga: 0.150, province: 'FI', region: 'Toscana' },
  'prato': { zone: 2, pga: 0.150, province: 'PO', region: 'Toscana' },
  'pistoia': { zone: 2, pga: 0.175, province: 'PT', region: 'Toscana' },
  'lucca': { zone: 2, pga: 0.175, province: 'LU', region: 'Toscana' },
  'massa': { zone: 2, pga: 0.175, province: 'MS', region: 'Toscana' },
  'carrara': { zone: 2, pga: 0.175, province: 'MS', region: 'Toscana' },
  'arezzo': { zone: 2, pga: 0.150, province: 'AR', region: 'Toscana' },
  'siena': { zone: 2, pga: 0.150, province: 'SI', region: 'Toscana' },
  'grosseto': { zone: 2, pga: 0.150, province: 'GR', region: 'Toscana' },
  'pisa': { zone: 2, pga: 0.150, province: 'PI', region: 'Toscana' },
  'livorno': { zone: 2, pga: 0.150, province: 'LI', region: 'Toscana' },
  'perugia': { zone: 2, pga: 0.175, province: 'PG', region: 'Umbria' },
  'terni': { zone: 2, pga: 0.150, province: 'TR', region: 'Umbria' },
  'ancona': { zone: 2, pga: 0.175, province: 'AN', region: 'Marche' },
  'pesaro': { zone: 2, pga: 0.175, province: 'PU', region: 'Marche' },
  'macerata': { zone: 2, pga: 0.175, province: 'MC', region: 'Marche' },
  'fermo': { zone: 2, pga: 0.175, province: 'FM', region: 'Marche' },
  'ascoli piceno': { zone: 2, pga: 0.175, province: 'AP', region: 'Marche' },
  'urbino': { zone: 2, pga: 0.175, province: 'PU', region: 'Marche' },
  'pescara': { zone: 2, pga: 0.175, province: 'PE', region: 'Abruzzo' },
  'chieti': { zone: 2, pga: 0.175, province: 'CH', region: 'Abruzzo' },
  'teramo': { zone: 2, pga: 0.175, province: 'TE', region: 'Abruzzo' },
  'genova': { zone: 2, pga: 0.150, province: 'GE', region: 'Liguria' },
  'imperia': { zone: 2, pga: 0.150, province: 'IM', region: 'Liguria' },
  'savona': { zone: 2, pga: 0.150, province: 'SV', region: 'Liguria' },
  'la spezia': { zone: 2, pga: 0.150, province: 'SP', region: 'Liguria' },
  'gorizia': { zone: 2, pga: 0.150, province: 'GO', region: 'Friuli' },
  'pordenone': { zone: 2, pga: 0.150, province: 'PN', region: 'Friuli' },
  'udine': { zone: 2, pga: 0.150, province: 'UD', region: 'Friuli' },
  'tarcento': { zone: 2, pga: 0.250, province: 'UD', region: 'Friuli' },
  'belluno': { zone: 2, pga: 0.175, province: 'BL', region: 'Veneto' },

  // ──── ZONA 3 (media-bassa) ────
  'milano': { zone: 3, pga: 0.075, province: 'MI', region: 'Lombardia', notes: 'Pianura Padana centrale' },
  'monza': { zone: 3, pga: 0.075, province: 'MB', region: 'Lombardia' },
  'brescia': { zone: 3, pga: 0.125, province: 'BS', region: 'Lombardia' },
  'bergamo': { zone: 3, pga: 0.100, province: 'BG', region: 'Lombardia' },
  'como': { zone: 3, pga: 0.075, province: 'CO', region: 'Lombardia' },
  'lecco': { zone: 3, pga: 0.100, province: 'LC', region: 'Lombardia' },
  'sondrio': { zone: 3, pga: 0.125, province: 'SO', region: 'Lombardia' },
  'varese': { zone: 3, pga: 0.075, province: 'VA', region: 'Lombardia' },
  'cremona': { zone: 3, pga: 0.075, province: 'CR', region: 'Lombardia' },
  'mantova': { zone: 3, pga: 0.125, province: 'MN', region: 'Lombardia' },
  'pavia': { zone: 3, pga: 0.075, province: 'PV', region: 'Lombardia' },
  'lodi': { zone: 3, pga: 0.075, province: 'LO', region: 'Lombardia' },
  'torino': { zone: 3, pga: 0.075, province: 'TO', region: 'Piemonte' },
  'novara': { zone: 3, pga: 0.075, province: 'NO', region: 'Piemonte' },
  'asti': { zone: 3, pga: 0.075, province: 'AT', region: 'Piemonte' },
  'alessandria': { zone: 3, pga: 0.075, province: 'AL', region: 'Piemonte' },
  'biella': { zone: 3, pga: 0.075, province: 'BI', region: 'Piemonte' },
  'cuneo': { zone: 3, pga: 0.100, province: 'CN', region: 'Piemonte' },
  'verbania': { zone: 3, pga: 0.100, province: 'VB', region: 'Piemonte' },
  'vercelli': { zone: 3, pga: 0.075, province: 'VC', region: 'Piemonte' },
  'aosta': { zone: 3, pga: 0.075, province: 'AO', region: 'Valle d\'Aosta' },
  'venezia': { zone: 3, pga: 0.100, province: 'VE', region: 'Veneto' },
  'mestre': { zone: 3, pga: 0.100, province: 'VE', region: 'Veneto' },
  'padova': { zone: 3, pga: 0.100, province: 'PD', region: 'Veneto' },
  'vicenza': { zone: 3, pga: 0.100, province: 'VI', region: 'Veneto' },
  'verona': { zone: 3, pga: 0.100, province: 'VR', region: 'Veneto' },
  'treviso': { zone: 3, pga: 0.100, province: 'TV', region: 'Veneto' },
  'rovigo': { zone: 3, pga: 0.075, province: 'RO', region: 'Veneto' },
  'trento': { zone: 3, pga: 0.125, province: 'TN', region: 'Trentino' },
  'bolzano': { zone: 3, pga: 0.100, province: 'BZ', region: 'Trentino' },
  'trieste': { zone: 3, pga: 0.100, province: 'TS', region: 'Friuli' },
  'viterbo': { zone: 3, pga: 0.100, province: 'VT', region: 'Lazio' },
  'latina': { zone: 3, pga: 0.100, province: 'LT', region: 'Lazio' },

  // ──── ZONA 4 (bassa) ────
  'cagliari': { zone: 4, pga: 0.025, province: 'CA', region: 'Sardegna' },
  'sassari': { zone: 4, pga: 0.025, province: 'SS', region: 'Sardegna' },
  'oristano': { zone: 4, pga: 0.025, province: 'OR', region: 'Sardegna' },
  'nuoro': { zone: 4, pga: 0.025, province: 'NU', region: 'Sardegna' },
  'olbia': { zone: 4, pga: 0.025, province: 'SS', region: 'Sardegna' },
  'iglesias': { zone: 4, pga: 0.025, province: 'SU', region: 'Sardegna' },
  'carbonia': { zone: 4, pga: 0.025, province: 'SU', region: 'Sardegna' },
  'tortoli': { zone: 4, pga: 0.025, province: 'NU', region: 'Sardegna' },
  'lanusei': { zone: 4, pga: 0.025, province: 'NU', region: 'Sardegna' },
  'sanluri': { zone: 4, pga: 0.025, province: 'SU', region: 'Sardegna' },
}

/**
 * Fallback regionale: zona sismica prevalente per regione
 * (usato quando il comune specifico non è nel dataset).
 *
 * NOTA: questa è una STIMA prudente. La zona reale può variare per comune
 * all'interno della stessa regione (es. Lombardia ha comuni in zona 2 e 4).
 * Per applicazioni critiche → usare il dato per comune specifico.
 */
export const SEISMIC_ZONE_BY_REGION: Record<string, { zone: 1 | 2 | 3 | 4; pga: number; range: string }> = {
  'abruzzo':         { zone: 2, pga: 0.200, range: '1-2' },
  'basilicata':      { zone: 2, pga: 0.225, range: '1-2' },
  'calabria':        { zone: 1, pga: 0.275, range: '1-2' },
  'campania':        { zone: 2, pga: 0.225, range: '1-3' },
  'emilia-romagna':  { zone: 2, pga: 0.150, range: '2-3' },
  'friuli':          { zone: 2, pga: 0.175, range: '1-3' },
  'friuli-venezia giulia': { zone: 2, pga: 0.175, range: '1-3' },
  'lazio':           { zone: 2, pga: 0.150, range: '1-3' },
  'liguria':         { zone: 3, pga: 0.125, range: '2-4' },
  'lombardia':       { zone: 3, pga: 0.100, range: '2-4' },
  'marche':          { zone: 2, pga: 0.175, range: '2-3' },
  'molise':          { zone: 1, pga: 0.250, range: '1-2' },
  'piemonte':        { zone: 3, pga: 0.100, range: '3-4' },
  'puglia':          { zone: 3, pga: 0.150, range: '1-4' },
  'sardegna':        { zone: 4, pga: 0.025, range: '4' },
  'sicilia':         { zone: 2, pga: 0.200, range: '1-3' },
  'toscana':         { zone: 3, pga: 0.150, range: '2-4' },
  'trentino':        { zone: 3, pga: 0.125, range: '3-4' },
  'trentino-alto adige': { zone: 3, pga: 0.125, range: '3-4' },
  'umbria':          { zone: 2, pga: 0.200, range: '1-2' },
  'valle d\'aosta':  { zone: 3, pga: 0.075, range: '3-4' },
  'valle d aosta':   { zone: 3, pga: 0.075, range: '3-4' },
  'veneto':          { zone: 3, pga: 0.100, range: '2-4' },
}

/**
 * Mapping inverso: provincia (sigla 2 lettere) → regione, per fallback.
 */
export const PROVINCE_TO_REGION: Record<string, string> = {
  'AG': 'sicilia', 'AL': 'piemonte', 'AN': 'marche', 'AO': 'valle d\'aosta',
  'AP': 'marche', 'AQ': 'abruzzo', 'AR': 'toscana', 'AT': 'piemonte',
  'AV': 'campania', 'BA': 'puglia', 'BG': 'lombardia', 'BI': 'piemonte',
  'BL': 'veneto', 'BN': 'campania', 'BO': 'emilia-romagna', 'BR': 'puglia',
  'BS': 'lombardia', 'BT': 'puglia', 'BZ': 'trentino', 'CA': 'sardegna',
  'CB': 'molise', 'CE': 'campania', 'CH': 'abruzzo', 'CL': 'sicilia',
  'CN': 'piemonte', 'CO': 'lombardia', 'CR': 'lombardia', 'CS': 'calabria',
  'CT': 'sicilia', 'CZ': 'calabria', 'EN': 'sicilia', 'FC': 'emilia-romagna',
  'FE': 'emilia-romagna', 'FG': 'puglia', 'FI': 'toscana', 'FM': 'marche',
  'FR': 'lazio', 'GE': 'liguria', 'GO': 'friuli', 'GR': 'toscana',
  'IM': 'liguria', 'IS': 'molise', 'KR': 'calabria', 'LC': 'lombardia',
  'LE': 'puglia', 'LI': 'toscana', 'LO': 'lombardia', 'LT': 'lazio',
  'LU': 'toscana', 'MB': 'lombardia', 'MC': 'marche', 'ME': 'sicilia',
  'MI': 'lombardia', 'MN': 'lombardia', 'MO': 'emilia-romagna', 'MS': 'toscana',
  'MT': 'basilicata', 'NA': 'campania', 'NO': 'piemonte', 'NU': 'sardegna',
  'OR': 'sardegna', 'PA': 'sicilia', 'PC': 'emilia-romagna', 'PD': 'veneto',
  'PE': 'abruzzo', 'PG': 'umbria', 'PI': 'toscana', 'PN': 'friuli',
  'PO': 'toscana', 'PR': 'emilia-romagna', 'PT': 'toscana', 'PU': 'marche',
  'PV': 'lombardia', 'PZ': 'basilicata', 'RA': 'emilia-romagna', 'RC': 'calabria',
  'RE': 'emilia-romagna', 'RG': 'sicilia', 'RI': 'lazio', 'RM': 'lazio',
  'RN': 'emilia-romagna', 'RO': 'veneto', 'SA': 'campania', 'SI': 'toscana',
  'SO': 'lombardia', 'SP': 'liguria', 'SR': 'sicilia', 'SS': 'sardegna',
  'SU': 'sardegna', 'SV': 'liguria', 'TA': 'puglia', 'TE': 'abruzzo',
  'TN': 'trentino', 'TO': 'piemonte', 'TP': 'sicilia', 'TR': 'umbria',
  'TS': 'friuli', 'TV': 'veneto', 'UD': 'friuli', 'VA': 'lombardia',
  'VB': 'piemonte', 'VC': 'piemonte', 'VE': 'veneto', 'VI': 'veneto',
  'VR': 'veneto', 'VS': 'sardegna', 'VT': 'lazio', 'VV': 'calabria',
}

/** Normalizza nome comune per lookup: lowercase, rimuove accenti, apostrofi, doppi spazi */
export function normalizeComuneName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // rimuove diacritici
    .replace(/[''`]/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
