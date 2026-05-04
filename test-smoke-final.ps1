$port = 3001
$base = "http://localhost:$port/api/company-lookup"
$companies = @(
    "OMNIAPIEGA SRL carate brianza",
    "O.M.I.S.A. SRL sovico",
    "G.E.M DI GORGONE MARCO milano",
    "CAREL INDUSTRIES SPA brugine",
    "PASTIFICIO GRANORO corato"
)

$results = @()
$i = 0
foreach ($q in $companies) {
    $i++
    Write-Host "`n[$i/5] $q" -ForegroundColor Cyan
    try {
        $body = @{ query = $q } | ConvertTo-Json
        $resp = Invoke-RestMethod -Uri $base -Method POST -Body $body -ContentType "application/json" -TimeoutSec 180
        $fields = @('partita_iva','ragione_sociale','sito','telefono','email','pec','fatturato','dipendenti','titolare','field_confidence')
        $found = ($fields | Where-Object { $resp.$_ -and $resp.$_ -ne '' }).Count
        Write-Host "  Fields: $found/10" -ForegroundColor $(if($found -ge 7){'Green'}elseif($found -ge 5){'Yellow'}else{'Red'})
        Write-Host "  RS: $($resp.ragione_sociale)"
        Write-Host "  PIVA: $($resp.partita_iva)"
        Write-Host "  Sito: $($resp.sito)"
        Write-Host "  Tel: $($resp.telefono)"
        Write-Host "  Email: $($resp.email)"
        Write-Host "  PEC: $($resp.pec)"
        Write-Host "  Fatt: $($resp.fatturato) | Dip: $($resp.dipendenti)"
        Write-Host "  Titolare: $($resp.titolare)"
        Write-Host "  Confidence: $(if($resp.field_confidence){($resp.field_confidence | ConvertTo-Json -Compress)}else{'NONE'})"
        $results += $resp
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}
