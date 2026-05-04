# Batch test: azienda + referente (person-lookup del titolare)
# Aggiunge "Milano" al query per disambiguare omonimi.
$tests = @(
  @{ name = 'ROYAL CANIN ITALIA';                          piva = '06822100969'; sede = 'Via Vezza D''Oglio 7 Milano' }
  @{ name = 'RS PLANNER S.A.S DI SISTI PAOLO';             piva = '07232770966'; sede = 'Via Zurigo 10 Milano';       attesoTitolare = 'Sisti Paolo' }
  @{ name = 'RSM SOCIETA DI REVISIONE';                    piva = '01889000509'; sede = 'Via San Prospero 1 Milano' }
  @{ name = 'RT PROGETTI SRL';                             piva = '09312200968'; sede = 'Via A. Locatelli 5 Milano' }
  @{ name = 'RT SOLUTIONS S.A.S. DI GIANNOTTA RAFFAELE';   piva = '10126300960'; sede = 'Via Caduti di Marcinelle 12 Milano'; attesoTitolare = 'Giannotta Raffaele' }
  @{ name = 'RUCOLA STUDIO';                               piva = '10658290969'; sede = 'Via Luciano Zuccoli 26 Milano' }
  @{ name = 'RUFFA MICHELA';                               piva = '04761880964'; sede = 'Via Cervignano 4 Milano';   attesoTitolare = 'Ruffa Michela' }
)

$out = @()
$out += "===== BATCH TEST $(Get-Date -Format 'HH:mm:ss') ====="

foreach ($t in $tests) {
  $queryText = "$($t.name) Milano"
  $body = (@{ query = $queryText } | ConvertTo-Json)
  $t0 = Get-Date
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/company-lookup" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 240 -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    $d = [int]((Get-Date)-$t0).TotalSeconds
    $pivaOk = if ($j.partita_iva -eq $t.piva) { 'OK' } else { "MISMATCH (got $($j.partita_iva))" }
    $out += ""
    $out += "########## $($t.name) ##########"
    $out += "  [COMPANY-LOOKUP ${d}s]"
    $out += "  P.IVA atteso:  $($t.piva) => $pivaOk"
    $out += "  Sede atteso:   $($t.sede)"
    $out += "  Sede trovata:  $($j.sede_legale)"
    $out += "  Ateco:         $($j.codice_ateco) $($j.descrizione_ateco)"
    $out += "  Fatturato:     $($j.fatturato) ($($j.fatturato_anno))"
    $out += "  Dipendenti:    $($j.dipendenti)"
    $out += "  Forma:         $($j.forma_giuridica)"
    $out += "  Costituzione:  $($j.data_costituzione)"
    if ($t.attesoTitolare) { $out += "  Titolare atteso: $($t.attesoTitolare)" }
    $out += "  TITOLARE:      $($j.titolare) [$($j.ruolo_titolare)]"
    $out += "  LinkedIn T:    $($j.linkedin_titolare)"
    $out += "  LinkedIn Az:   $($j.linkedin)"
    $out += "  Sito web:      $($j.sito_web)"
    $out += "  Email:         $($j.email)"
    $out += "  PEC:           $($j.pec)"
    $out += "  Telefono:      $($j.telefono)"
    $out += "  Cellulare:     $($j.cellulare)"
    $out += "  Fonti company: $($j.fonti -join ', ')"

    # Person-lookup: usa titolare trovato (se c'è) oppure atteso
    $personName = $null
    if ($j.titolare) { $personName = "$($j.titolare)" }
    elseif ($t.attesoTitolare) { $personName = $t.attesoTitolare }

    if ($personName) {
      $personQuery = "$personName $($t.name) Milano"
      $pbody = (@{ query = $personQuery } | ConvertTo-Json)
      $p0 = Get-Date
      try {
        $pr = Invoke-WebRequest -Uri "http://localhost:3000/api/person-lookup" -Method POST -Body $pbody -ContentType "application/json" -TimeoutSec 180 -ErrorAction Stop
        $pj = $pr.Content | ConvertFrom-Json
        $pd = [int]((Get-Date)-$p0).TotalSeconds
        $out += "  [PERSON-LOOKUP ${pd}s] query='$personQuery'"
        $out += "    Nome:       $($pj.nome)"
        $out += "    Ruolo:      $($pj.ruolo)"
        $out += "    Azienda:    $($pj.azienda)"
        $out += "    Città:      $($pj.citta)"
        $out += "    Email:      $($pj.email)"
        $out += "    Telefono:   $($pj.telefono)"
        $out += "    Cellulare:  $($pj.cellulare)"
        $out += "    LinkedIn:   $($pj.linkedin)"
        $out += "    Instagram:  $($pj.instagram)"
        $out += "    Facebook:   $($pj.facebook)"
        $out += "    Twitter/X:  $($pj.twitter)"
        $out += "    Sito:       $($pj.sito_web)"
        if ($pj.bio) { $out += "    Bio:        $($pj.bio.Substring(0, [Math]::Min(150, $pj.bio.Length)))..." }
      } catch {
        $out += "  [PERSON-LOOKUP FAILED] $($_.Exception.Message)"
      }
    } else {
      $out += "  [PERSON-LOOKUP] skipped (no titolare found)"
    }
  } catch {
    $d = [int]((Get-Date)-$t0).TotalSeconds
    $out += ""
    $out += "########## $($t.name) ##########"
    $out += "  FAILED: $($_.Exception.Message)"
  }
}

$out | Out-File test-batch4-results.txt -Encoding utf8
$out | ForEach-Object { Write-Host $_ }
