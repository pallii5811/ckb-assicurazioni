# Regression Test Suite — company-lookup

Suite di test di regressione per garantire **zero regressioni** durante i refactor del sistema di ricerca aziende.

## Filosofia

> Il miglior codice del mondo è inutile se non sai misurarlo.

Questa suite produce un **punteggio oggettivo** (su 200 punti) che rappresenta l'accuratezza attuale del sistema. Ogni modifica deve essere verificata contro questa suite **prima del commit**.

## File

- `companies-ground-truth.json` — 20 aziende italiane con dati verificati manualmente (P.IVA, ragione sociale, città, titolare, PEC attesa)
- `run-regression.ps1` — script PowerShell che chiama `/api/company-lookup` per ogni azienda e calcola lo score
- `results-*.json` — output di ogni run (per confronto tra baseline e post-fix)
- `README.md` — questo file

## Come si usa

### 1. Avvia il server Next.js
```powershell
npm run dev
```

### 2. Esegui la suite
```powershell
.\tests\regression\run-regression.ps1
```

Opzioni:
- `-BaseUrl http://localhost:3000` (default)
- `-TimeoutSec 300` (default per lookup)
- `-OutputFile tests/regression/results-mybaseline.json`

### 3. Leggi il risultato

Il punteggio totale è su 200 punti (20 aziende × 10 punti):
- **≥ 160 (80%)** → grade A, obiettivo Traccia A raggiunto
- **≥ 150 (75%)** → PASS
- **≥ 120 (60%)** → WARNING (accettabile baseline)
- **< 120 (60%)** → FAIL

## Regole di scoring per azienda

| Campo | Punti | Pass se |
|---|---|---|
| `partita_iva` | 4 | Esattamente uguale o entrambi null |
| `ragione_sociale` | 2 | Contiene la sottostringa attesa |
| `citta` | 1 | Contiene la città attesa |
| `titolare` | 2 | Nella lista `titolare_allowed` (o vuoto se lista null) |
| `pec` | 1 | Presente se `has_pec=true`, vuoto accettato se false |

**Regola critica**: `titolare` NON VUOTO ma fuori dalla lista = **0 punti** (hallucination = fail). Meglio vuoto che inventato.

## Workflow raccomandato

1. **Prima di qualsiasi refactor**: esegui la suite, salva il risultato come **baseline**
2. **Dopo ogni fix**: riesegui la suite. Se il punteggio scende → rollback.
3. **Ogni settimana**: riesegui la suite per rilevare regressioni silenti (es. siti terzi che cambiano layout)
4. **Aggiungi aziende** man mano che scopri casi edge nuovi

## Come aggiungere un'azienda

Apri `companies-ground-truth.json` e aggiungi un oggetto nell'array `companies`:

```json
{
  "query": "NOME AZIENDA SRL Milano",
  "expected": {
    "partita_iva": "12345678901",
    "ragione_sociale_contains": "nome azienda",
    "citta": "Milano",
    "titolare_allowed": ["Mario Rossi"],
    "has_pec": true
  },
  "notes": "Note per il futuro, es. 'ATTENZIONE omonimo X'"
}
```

Se `partita_iva` è null, la suite accetta che il risultato sia vuoto (per aziende non verificabili).
Se `titolare_allowed` è null, la suite accetta qualsiasi valore ma con credito parziale (1/2 pt).
