# Test batch finale - 20 aziende diverse per regione/settore
# Verifica: P.IVA, ragione_sociale, sito, telefono, email, pec, fatturato, dipendenti, titolare, confidence
$port = 3001
$base = "http://localhost:$port/api/company-lookup"

$companies = @(
    # Nord-Ovest
    "OMNIAPIEGA SRL carate brianza",
    "SCHIATTI ANGELO SRL seregno",
    # Nord-Est
    "CAREL INDUSTRIES SPA brugine",
    "DANIELI SPA buttrio",
    # Centro
    "LOCCIONI SPA angeli di rosora",
    "BRUNELLO CUCINELLI SPA solomeo",
    # Sud
    "FERRARO SPA marcianise",
    "NATUZZI SPA santeramo in colle",
    # Isole
    "FERRETTI SPA catania",
    "TISCALI SPA cagliari",
    # Micro/artigiani
    "IDRAULICA ROSSI SRL firenze",
    "PASTICCERIA DE LUCA napoli",
    # Settori specifici
    "MAPEI SPA milano",
    "BREMBO SPA stezzano",
    "TECHNOGYM SPA cesena",
    "CALZEDONIA SPA verona",
    "DALLARA AUTOMOBILI SPA varano de melegari",
    # Paesini piccoli (test KNOWN_CITIES)
    "OLEIFICIO FERRARA matera",
    "PASTIFICIO GRANORO corato",
    "CANTINA TOLLO tollo"
)

$results = @()
$i = 0

foreach ($q in $companies) {
    $i++
    Write-Host "`n[$i/20] Testing: $q" -ForegroundColor Cyan
    $startTime = Get-Date
    try {
        $body = @{ query = $q } | ConvertTo-Json
        $resp = Invoke-RestMethod -Uri $base -Method POST -Body $body -ContentType "application/json" -TimeoutSec 120
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        
        $obj = [PSCustomObject]@{
            Query            = $q
            Tempo_s          = [math]::Round($elapsed, 1)
            RagioneSociale   = if ($resp.ragione_sociale) { $resp.ragione_sociale.Substring(0, [Math]::Min(40, $resp.ragione_sociale.Length)) } else { "MISSING" }
            PIVA             = if ($resp.partita_iva) { $resp.partita_iva } else { "MISSING" }
            Sito             = if ($resp.sito) { "OK" } else { "MISSING" }
            Telefono         = if ($resp.telefono) { "OK" } else { "MISSING" }
            Email            = if ($resp.email) { "OK" } else { "MISSING" }
            PEC              = if ($resp.pec) { "OK" } else { "MISSING" }
            Fatturato        = if ($resp.fatturato) { "OK" } else { "MISSING" }
            Dipendenti       = if ($resp.dipendenti) { $resp.dipendenti } else { "MISSING" }
            Titolare         = if ($resp.titolare) { $resp.titolare.Substring(0, [Math]::Min(25, $resp.titolare.Length)) } else { "MISSING" }
            Confidence       = if ($resp.field_confidence) { ($resp.field_confidence | Get-Member -MemberType NoteProperty).Count.ToString() + " fields" } else { "NONE" }
            Fonti            = if ($resp.fonti) { ($resp.fonti -join ", ").Substring(0, [Math]::Min(60, ($resp.fonti -join ", ").Length)) } else { "NONE" }
            Error            = if ($resp.error) { $resp.error.Substring(0, [Math]::Min(50, $resp.error.Length)) } else { "" }
        }
        $results += $obj
        
        # Quick summary
        $fields = @('partita_iva','ragione_sociale','sito','telefono','email','pec','fatturato','dipendenti','titolare','codice_ateco')
        $found = ($fields | Where-Object { $resp.$_ -and $resp.$_ -ne '' }).Count
        $color = if ($found -ge 8) { "Green" } elseif ($found -ge 5) { "Yellow" } else { "Red" }
        Write-Host "  -> $found/10 fields | PIVA=$($resp.partita_iva) | ${elapsed}s" -ForegroundColor $color
        
    } catch {
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        $results += [PSCustomObject]@{
            Query = $q; Tempo_s = [math]::Round($elapsed,1); RagioneSociale = "ERROR"; PIVA = ""; Sito = ""; Telefono = ""; Email = ""; PEC = ""; Fatturato = ""; Dipendenti = ""; Titolare = ""; Confidence = ""; Fonti = ""; Error = $_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length))
        }
        Write-Host "  -> ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n`n========== REPORT FINALE ==========" -ForegroundColor Yellow
$results | Format-Table -AutoSize -Wrap

# Summary stats
$total = $results.Count
$withPiva = ($results | Where-Object { $_.PIVA -ne "MISSING" -and $_.PIVA -ne "" }).Count
$withSito = ($results | Where-Object { $_.Sito -eq "OK" }).Count
$withTel = ($results | Where-Object { $_.Telefono -eq "OK" }).Count
$withFatt = ($results | Where-Object { $_.Fatturato -eq "OK" }).Count
$withTit = ($results | Where-Object { $_.Titolare -ne "MISSING" -and $_.Titolare -ne "" }).Count
$withConf = ($results | Where-Object { $_.Confidence -ne "NONE" }).Count
$errors = ($results | Where-Object { $_.Error -ne "" }).Count

Write-Host "`nSTATISTICHE:" -ForegroundColor Yellow
Write-Host "  P.IVA trovata:    $withPiva / $total"
Write-Host "  Sito trovato:     $withSito / $total"
Write-Host "  Telefono trovato: $withTel / $total"
Write-Host "  Fatturato:        $withFatt / $total"
Write-Host "  Titolare:         $withTit / $total"
Write-Host "  Confidence score: $withConf / $total"
Write-Host "  Errori:           $errors / $total"

# Save CSV
$results | Export-Csv -Path "test-batch-final-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "`nRisultati salvati in test-batch-final-results.csv" -ForegroundColor Green
