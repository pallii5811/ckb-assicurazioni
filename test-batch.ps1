# Batch test: 10 aziende × (company-lookup + person-lookup sul titolare trovato)
# Ground truth dagli screenshot amministrazionicomunali.it
$companies = @(
  @{ name = "VISIOMECC S.R.L.";                piva = "07989760967"; addr = "Via Zante 14, Milano" },
  @{ name = "VISION DEPT S.R.L.";              piva = "09346340962"; addr = "Via Giovanni Battista Morgagni 6, Milano" },
  @{ name = "VISION ITALIA S.R.L. UNIPERSONALE"; piva = "11947290968"; addr = "Via Ripa di Porta Ticinese 39, Milano" },
  @{ name = "VISIONARIA FILM S.R.L.";          piva = "09490500965"; addr = "Via Francesco De Sanctis 32, Milano" },
  @{ name = "VISIT ITALY S.R.L.";              piva = "08368951219"; addr = "Via Filippo Argelati 10, Milano" },
  @{ name = "VISUAL ARTE SRL";                 piva = "00860230945"; addr = "Via Marco D'Agrate 23, Milano" },
  @{ name = "WINDY ENGINEERING S.R.L.";        piva = "12088300962"; addr = "Via dei Piatti 8, Milano" },
  @{ name = "WIP CONSULTING SRL";              piva = "08261310968"; addr = "Via Feltre 11, Milano" },
  @{ name = "WISEAIR S.R.L.";                  piva = "10700370967"; addr = "Via Andrea Costa 8, Milano" },
  @{ name = "WITHUB S.P.A.";                   piva = "10067080969"; addr = "Via Rubens 19, Milano" }
)

$csv = "test-results.csv"
"idx,azienda,piva_attesa,piva_trovata,piva_match,indirizzo_attesa,indirizzo_trovato,titolare,ruolo_titolare,fatturato,dipendenti,referente_azienda,referente_match,durata_sec" | Out-File $csv -Encoding utf8

function Test-Company {
  param($idx, $c)
  $t0 = Get-Date
  Write-Host "`n============================================================"
  Write-Host "[$idx/10] $($c.name)"
  Write-Host "  Atteso: P.IVA=$($c.piva)  Indirizzo=$($c.addr)"
  Write-Host "============================================================"
  $ret = [ordered]@{
    idx = $idx; azienda = $c.name; piva_attesa = $c.piva; piva_trovata = ""; piva_match = "";
    indirizzo_attesa = $c.addr; indirizzo_trovato = ""; titolare = ""; ruolo_titolare = "";
    fatturato = ""; dipendenti = ""; referente_azienda = ""; referente_match = ""; durata_sec = 0
  }
  try {
    $body = @{ query = $c.name } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/company-lookup" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 600 -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    $ret.piva_trovata = [string]$j.partita_iva
    $ret.piva_match = if ($j.partita_iva -eq $c.piva) { "SI" } else { "NO" }
    $ret.indirizzo_trovato = [string]$j.sede_legale
    $ret.titolare = [string]$j.titolare
    $ret.ruolo_titolare = [string]$j.ruolo_titolare
    $ret.fatturato = [string]$j.fatturato
    $ret.dipendenti = [string]$j.dipendenti
    Write-Host "  → AZIENDA: P.IVA=$($ret.piva_trovata) [$($ret.piva_match)]  titolare=$($ret.titolare)  fatt=$($ret.fatturato)  dip=$($ret.dipendenti)"
    # Se c'è un titolare, testa person-lookup
    if ($ret.titolare -and $ret.titolare.Length -gt 3) {
      Write-Host "  → REFERENTE-LOOKUP: $($ret.titolare)"
      $body2 = @{ query = $ret.titolare } | ConvertTo-Json -Compress
      try {
        $r2 = Invoke-WebRequest -Uri "http://localhost:3000/api/person-lookup" -Method POST -Body $body2 -ContentType "application/json" -TimeoutSec 600 -ErrorAction Stop
        $j2 = $r2.Content | ConvertFrom-Json
        $ret.referente_azienda = [string]$j2.azienda
        # Match se l'azienda del referente contiene il primo token del company name
        $firstWord = ($c.name -split '\s+')[0]
        $ret.referente_match = if ($ret.referente_azienda -match [regex]::Escape($firstWord)) { "SI" } else { "NO" }
        Write-Host "  → REFERENTE → azienda='$($ret.referente_azienda)' [$($ret.referente_match)]"
      } catch { Write-Host "  ! person-lookup FAILED: $($_.Exception.Message)" }
    } else {
      Write-Host "  ! Nessun titolare trovato, skip referente"
    }
  } catch { Write-Host "  ! company-lookup FAILED: $($_.Exception.Message)" }
  $ret.durata_sec = [int]((Get-Date) - $t0).TotalSeconds
  # Append CSV
  $line = "$($ret.idx),`"$($ret.azienda)`",$($ret.piva_attesa),$($ret.piva_trovata),$($ret.piva_match),`"$($ret.indirizzo_attesa)`",`"$($ret.indirizzo_trovato)`",`"$($ret.titolare)`",`"$($ret.ruolo_titolare)`",`"$($ret.fatturato)`",`"$($ret.dipendenti)`",`"$($ret.referente_azienda)`",$($ret.referente_match),$($ret.durata_sec)"
  $line | Out-File $csv -Append -Encoding utf8
  return $ret
}

$allResults = @()
for ($i = 0; $i -lt $companies.Count; $i++) {
  $allResults += Test-Company ($i + 1) $companies[$i]
}

Write-Host "`n============================================================"
Write-Host "TUTTI I TEST COMPLETATI — risultati in $csv"
Write-Host "============================================================"
$allResults | Format-Table idx, azienda, piva_match, referente_match, titolare, fatturato, durata_sec -AutoSize
