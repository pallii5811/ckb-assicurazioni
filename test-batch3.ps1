# Batch test: aziende da amministrazionicomunali.it con P.IVA attesa
$tests = @(
  @{ name = 'SAIT';                                piva = '00297910630'; sede = 'Via Vitruvio 11 Milano' }
  @{ name = 'SALADINO ANDREA';                     piva = '07750250966'; sede = 'Piazza Adigrat 2 Milano' }
  @{ name = 'SAN GIACOMO S.R.L.';                  piva = '02644040137'; sede = 'Via Accademia 48 Milano' }
  @{ name = 'SANGALLI MARKETING & COMMUNICATIONS'; piva = '03267760969'; sede = 'Via Morimondo 26 Milano' }
  @{ name = 'SANIXAIR S.R.L.';                     piva = '10779980969'; sede = 'Via Alfredo Pizzoni 3 Milano' }
)

$out = @()
$out += "===== BATCH TEST $(Get-Date -Format 'HH:mm:ss') ====="

foreach ($t in $tests) {
  $body = (@{ query = $t.name } | ConvertTo-Json)
  $t0 = Get-Date
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/company-lookup" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 240 -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    $d = [int]((Get-Date)-$t0).TotalSeconds
    $pivaOk = if ($j.partita_iva -eq $t.piva) { 'OK' } else { "MISMATCH (got $($j.partita_iva))" }
    $out += ""
    $out += "--- $($t.name) (${d}s) ---"
    $out += "  P.IVA atteso: $($t.piva) => $pivaOk"
    $out += "  Sede atteso: $($t.sede)"
    $out += "  Sede trovata: $($j.sede_legale)"
    $out += "  Ateco:       $($j.codice_ateco) $($j.descrizione_ateco)"
    $out += "  Fatturato:   $($j.fatturato) ($($j.fatturato_anno))"
    $out += "  Dipendenti:  $($j.dipendenti)"
    $out += "  Forma:       $($j.forma_giuridica)"
    $out += "  Costituzione:$($j.data_costituzione)"
    $out += "  TITOLARE:    $($j.titolare) [$($j.ruolo_titolare)]"
    $out += "  LinkedIn T:  $($j.linkedin_titolare)"
    $out += "  LinkedIn Az: $($j.linkedin)"
    $out += "  Sito:        $($j.sito_web)"
    $out += "  Email:       $($j.email)"
    $out += "  PEC:         $($j.pec)"
    $out += "  Telefono:    $($j.telefono)"
    $out += "  Cellulare:   $($j.cellulare)"
    $out += "  Fonti:       $($j.fonti -join ', ')"
  } catch {
    $d = [int]((Get-Date)-$t0).TotalSeconds
    $out += ""
    $out += "--- $($t.name) (${d}s) ---"
    $out += "  FAILED: $($_.Exception.Message)"
  }
}

$out | Out-File test-batch3-results.txt -Encoding utf8
$out | ForEach-Object { Write-Host $_ }
