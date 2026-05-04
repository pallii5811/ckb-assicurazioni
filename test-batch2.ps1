$companies = @(
  @{ name = 'VISIOMECC S.R.L.';                piva = '07989760967'; addr = 'Via Zante 14, Milano' },
  @{ name = 'VISION DEPT S.R.L.';              piva = '09346340962'; addr = 'Via Giovanni Battista Morgagni 6, Milano' },
  @{ name = 'VISION ITALIA S.R.L. UNIPERSONALE'; piva = '11947290968'; addr = 'Via Ripa di Porta Ticinese 39, Milano' },
  @{ name = 'VISIONARIA FILM S.R.L.';          piva = '09490500965'; addr = 'Via Francesco De Sanctis 32, Milano' },
  @{ name = 'VISIT ITALY S.R.L.';              piva = '08368951219'; addr = 'Via Filippo Argelati 10, Milano' },
  @{ name = 'VISUAL ARTE SRL';                 piva = '00860230945'; addr = "Via Marco D'Agrate 23, Milano" },
  @{ name = 'WINDY ENGINEERING S.R.L.';        piva = '12088300962'; addr = 'Via dei Piatti 8, Milano' },
  @{ name = 'WIP CONSULTING SRL';              piva = '08261310968'; addr = 'Via Feltre 11, Milano' },
  @{ name = 'WISEAIR S.R.L.';                  piva = '10700370967'; addr = 'Via Andrea Costa 8, Milano' },
  @{ name = 'WITHUB S.P.A.';                   piva = '10067080969'; addr = 'Via Rubens 19, Milano' }
)

$csv = 'test-results.csv'
'idx|azienda|piva_attesa|piva_trovata|piva_match|indirizzo_trovato|titolare|ruolo|fatturato|dipendenti|referente_azienda|referente_match|dur' | Out-File $csv -Encoding utf8

function RunOne($idx, $c) {
  $t0 = Get-Date
  Write-Host ''
  Write-Host ('========== [{0}/10] {1} ==========' -f $idx, $c.name)
  Write-Host ('  Atteso: P.IVA={0}  Indirizzo={1}' -f $c.piva, $c.addr)
  $out = @{
    idx = $idx; name = $c.name; pivaE = $c.piva; pivaT = ''; pivaM = '?'; addrT = '';
    tit = ''; ruo = ''; fat = ''; dip = ''; refAz = ''; refM = '?'; dur = 0
  }
  try {
    $body = @{ query = $c.name } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/company-lookup' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 600 -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    $out.pivaT = [string]$j.partita_iva
    $out.pivaM = if ([string]$j.partita_iva -eq $c.piva) { 'OK' } else { 'KO' }
    $out.addrT = [string]$j.sede_legale
    $out.tit = [string]$j.titolare
    $out.ruo = [string]$j.ruolo_titolare
    $out.fat = [string]$j.fatturato
    $out.dip = [string]$j.dipendenti
    Write-Host ('  -> AZIENDA: P.IVA={0} [{1}] indir={2}' -f $out.pivaT, $out.pivaM, $out.addrT)
    Write-Host ('  -> titolare={0} ({1}) fat={2} dip={3}' -f $out.tit, $out.ruo, $out.fat, $out.dip)
    if ($out.tit -and $out.tit.Length -gt 3) {
      Write-Host ('  -> REFERENTE-LOOKUP: {0}' -f $out.tit)
      try {
        $body2 = @{ query = $out.tit } | ConvertTo-Json -Compress
        $r2 = Invoke-WebRequest -Uri 'http://localhost:3000/api/person-lookup' -Method POST -Body $body2 -ContentType 'application/json' -TimeoutSec 600 -ErrorAction Stop
        $j2 = $r2.Content | ConvertFrom-Json
        $out.refAz = [string]$j2.azienda
        $firstWord = ($c.name -split '\s+')[0]
        $out.refM = if ($out.refAz -match [regex]::Escape($firstWord)) { 'OK' } else { 'KO' }
        Write-Host ('  -> REFERENTE.azienda={0} [{1}]' -f $out.refAz, $out.refM)
      } catch { Write-Host ('  ! person-lookup FAILED: {0}' -f $_.Exception.Message) }
    } else { Write-Host '  ! nessun titolare, skip referente' }
  } catch { Write-Host ('  ! company-lookup FAILED: {0}' -f $_.Exception.Message) }
  $out.dur = [int]((Get-Date) - $t0).TotalSeconds
  $line = ('{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}|{9}|{10}|{11}|{12}' -f $out.idx, $out.name, $out.pivaE, $out.pivaT, $out.pivaM, $out.addrT, $out.tit, $out.ruo, $out.fat, $out.dip, $out.refAz, $out.refM, $out.dur)
  $line | Out-File $csv -Append -Encoding utf8
}

for ($i = 0; $i -lt $companies.Count; $i++) {
  RunOne ($i + 1) $companies[$i]
}

Write-Host ''
Write-Host '========== DONE =========='
Get-Content $csv | Format-Table -AutoSize
