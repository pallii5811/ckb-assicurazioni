# Regression Test Suite for /api/company-lookup
# Usage: .\tests\regression\run-regression.ps1 [-BaseUrl http://localhost:3000]
#
# Scoring rules per company (max 10 points):
#   4 pt - partita_iva equals expected (or both null)
#   2 pt - ragione_sociale contains expected substring (case-insensitive)
#   1 pt - citta matches (case-insensitive)
#   2 pt - titolare in titolare_allowed list (empty is OK if list is null)
#          HALLUCINATION RULE: non-empty titolare NOT in allowed list = 0 points
#   1 pt - pec present if has_pec=true, empty accepted if has_pec=false
#
# Passing threshold: total >= 75% (150/200). Track A target: >= 80% (160/200).

param(
  [string]$BaseUrl = "http://localhost:3000",
  [int]$TimeoutSec = 300,
  [string]$OutputFile = "tests/regression/results-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
)

$ErrorActionPreference = 'Stop'
$groundTruthPath = Join-Path $PSScriptRoot 'companies-ground-truth.json'
if (-not (Test-Path $groundTruthPath)) { throw "Ground truth file not found: $groundTruthPath" }

$groundTruth = Get-Content $groundTruthPath -Raw -Encoding UTF8 | ConvertFrom-Json
$companies = $groundTruth.companies

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host " REGRESSION TEST SUITE - /api/company-lookup" -ForegroundColor Cyan
Write-Host " Target: $BaseUrl" -ForegroundColor Cyan
Write-Host " Companies: $($companies.Count) | Max score: $($companies.Count * 10)" -ForegroundColor Cyan
Write-Host " Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

$results = @()
$totalScore = 0
$maxScore = $companies.Count * 10

foreach ($c in $companies) {
  $q = $c.query
  $exp = $c.expected
  $t0 = Get-Date

  Write-Host ("- [{0}] " -f $q) -ForegroundColor Yellow -NoNewline

  $body = @{ query = $q } | ConvertTo-Json -Compress
  $actual = $null
  $errMsg = $null
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/company-lookup" -Method POST -Body $body `
      -ContentType 'application/json' -TimeoutSec $TimeoutSec -ErrorAction Stop
    $actual = $r.Content | ConvertFrom-Json
  } catch {
    $errMsg = $_.Exception.Message
    Write-Host "HTTP FAIL: $errMsg" -ForegroundColor Red
    $results += [PSCustomObject]@{
      query = $q; score = 0; max = 10; details = @{ error = $errMsg }
      actual = $null; expected = $exp
    }
    continue
  }
  $dur = [int]((Get-Date) - $t0).TotalSeconds

  # ----- Scoring -----
  $score = 0
  $details = [ordered]@{}

  # 1) P.IVA (4 points)
  $actPiva = if ($actual.partita_iva) { [string]$actual.partita_iva -replace '\D', '' } else { '' }
  $expPiva = if ($exp.partita_iva) { [string]$exp.partita_iva -replace '\D', '' } else { '' }
  if ($expPiva -eq '' -and $actPiva -eq '') {
    $score += 4; $details.piva = "OK both empty"
  } elseif ($expPiva -eq '' -and $actPiva -ne '') {
    $score += 2; $details.piva = "PARTIAL expected null got $actPiva"
  } elseif ($expPiva -ne '' -and $actPiva -eq '') {
    $details.piva = "FAIL expected $expPiva got empty"
  } elseif ($actPiva -eq $expPiva) {
    $score += 4; $details.piva = "OK $actPiva"
  } else {
    $details.piva = "FAIL expected $expPiva got $actPiva WRONG"
  }

  # 2) Ragione sociale contains (2 points)
  $actRs = if ($actual.ragione_sociale) { [string]$actual.ragione_sociale } else { '' }
  $expRsContains = if ($exp.ragione_sociale_contains) { [string]$exp.ragione_sociale_contains } else { '' }
  if ($expRsContains -eq '') {
    $score += 2; $details.rs = "OK no expected"
  } elseif ($actRs.ToLower().Contains($expRsContains.ToLower())) {
    $score += 2; $details.rs = "OK '$actRs'"
  } else {
    $details.rs = "FAIL expected contain '$expRsContains' got '$actRs'"
  }

  # 3) Citta (1 point)
  $actCitta = if ($actual.citta) { [string]$actual.citta } else { '' }
  if (-not $actCitta -and $actual.sede_legale) {
    $sede = [string]$actual.sede_legale
    if ($sede -match '\b([A-Za-z][A-Za-z''.\s\-]{2,})\s*(?:\(|$)') { $actCitta = $Matches[1].Trim() }
  }
  $expCitta = if ($exp.citta) { [string]$exp.citta } else { '' }
  if ($expCitta -eq '' -and $actCitta -eq '') {
    $score += 1; $details.citta = "OK both empty"
  } elseif ($expCitta -eq '') {
    $score += 1; $details.citta = "OK no expected"
  } elseif ($actCitta.ToLower().Contains($expCitta.ToLower())) {
    $score += 1; $details.citta = "OK '$actCitta'"
  } else {
    $details.citta = "FAIL expected '$expCitta' got '$actCitta'"
  }

  # 4) Titolare (2 points) - HALLUCINATION RULE: non-empty name outside allowed = 0
  $actTit = if ($actual.titolare) { [string]$actual.titolare } else { '' }
  $allowedList = $exp.titolare_allowed
  if ($null -eq $allowedList) {
    if ($actTit -eq '') {
      $score += 2; $details.titolare = "OK empty no ground truth"
    } else {
      $score += 1; $details.titolare = "PARTIAL '$actTit' no ground truth"
    }
  } else {
    if ($actTit -eq '') {
      $details.titolare = "FAIL expected $($allowedList -join ',') got empty"
    } else {
      $matched = $false
      foreach ($name in $allowedList) {
        if ($actTit.ToLower().Contains($name.ToLower()) -or $name.ToLower().Contains($actTit.ToLower())) {
          $matched = $true; break
        }
      }
      if ($matched) {
        $score += 2; $details.titolare = "OK '$actTit'"
      } else {
        $details.titolare = "FAIL HALLUCINATION expected $($allowedList -join ',') got '$actTit'"
      }
    }
  }

  # 5) PEC (1 point)
  $actPec = if ($actual.pec) { [string]$actual.pec } else { '' }
  if ($exp.has_pec -eq $true) {
    if ($actPec -match '@') {
      $score += 1; $details.pec = "OK '$actPec'"
    } else {
      $details.pec = "FAIL expected PEC got empty"
    }
  } else {
    $score += 1; $details.pec = "OK no requirement"
  }

  $pct = [int]($score * 10)
  $color = if ($pct -ge 80) { 'Green' } elseif ($pct -ge 60) { 'Yellow' } else { 'Red' }
  Write-Host ("${score}/10 (${pct}%) [${dur}s]") -ForegroundColor $color
  foreach ($k in $details.Keys) {
    $line = "    $k : $($details[$k])"
    $lcolor = if ($details[$k] -like 'OK*') { 'DarkGreen' }
              elseif ($details[$k] -like 'PARTIAL*') { 'DarkYellow' }
              else { 'DarkRed' }
    Write-Host $line -ForegroundColor $lcolor
  }

  $totalScore += $score
  $results += [PSCustomObject]@{
    query = $q
    score = $score
    max = 10
    duration_sec = $dur
    details = $details
    actual = @{
      partita_iva = $actual.partita_iva
      ragione_sociale = $actual.ragione_sociale
      citta = $actual.citta
      sede_legale = $actual.sede_legale
      titolare = $actual.titolare
      pec = $actual.pec
      fonti = $actual.fonti
    }
    expected = $exp
  }
}

$pctTotal = [math]::Round(($totalScore / $maxScore) * 100, 1)
$passGrade = if ($pctTotal -ge 80) { 'A >=80%' }
             elseif ($pctTotal -ge 75) { 'PASS >=75%' }
             elseif ($pctTotal -ge 60) { 'WARNING >=60%' }
             else { 'FAIL <60%' }
$color = if ($pctTotal -ge 80) { 'Green' } elseif ($pctTotal -ge 75) { 'Yellow' } else { 'Red' }

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host (" TOTAL SCORE: {0}/{1} ({2}%) - {3}" -f $totalScore, $maxScore, $pctTotal, $passGrade) -ForegroundColor $color
Write-Host "===================================================================" -ForegroundColor Cyan

$outDir = Split-Path -Parent $OutputFile
if (-not (Test-Path $outDir)) { New-Item -Path $outDir -ItemType Directory | Out-Null }
$summary = [PSCustomObject]@{
  timestamp = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
  base_url = $BaseUrl
  total_score = $totalScore
  max_score = $maxScore
  percent = $pctTotal
  grade = $passGrade
  results = $results
}
$summary | ConvertTo-Json -Depth 10 | Out-File -FilePath $OutputFile -Encoding utf8
Write-Host ""
Write-Host "Results saved to: $OutputFile" -ForegroundColor Gray

if ($pctTotal -ge 75) { exit 0 } else { exit 1 }
