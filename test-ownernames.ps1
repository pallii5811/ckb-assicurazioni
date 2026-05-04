# Verifica Step 2d0: estrazione titolare dal NOME LEGALE
$tests = @(
  'RT SOLUTIONS S.A.S. DI GIANNOTTA RAFFAELE & C.'
  'RUFFA MICHELA'
  'RS PLANNER S.A.S DI SISTI PAOLO'
  'SALVATORE S.A.S. DI FIEMMINO GENNARO E C.'
)
$out = @("===== STEP 2d0 TEST $(Get-Date -Format 'HH:mm:ss') =====")
foreach ($q in $tests) {
  $body = (@{ query = $q } | ConvertTo-Json)
  $t0 = Get-Date
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/company-lookup" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 240 -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    $d = [int]((Get-Date)-$t0).TotalSeconds
    $out += ""
    $out += "--- $q (${d}s) ---"
    $out += "  P.IVA:   $($j.partita_iva)"
    $out += "  Sede:    $($j.sede_legale)"
    $out += "  TITOL:   $($j.titolare) [$($j.ruolo_titolare)]"
  } catch {
    $out += "  FAIL: $($_.Exception.Message)"
  }
}
$out | Out-File test-ownernames.txt -Encoding utf8
$out | ForEach-Object { Write-Host $_ }
