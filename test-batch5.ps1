# Batch test: 10 aziende + person-lookup sul titolare trovato
# Ground truth: amministrazionicomunali.it (Milano)
$ErrorActionPreference = 'Continue'
Write-Host "===== BATCH5 START $(Get-Date -Format 'HH:mm:ss') =====" -ForegroundColor Cyan

$tests = @(
  @{ q='REPOWER VENDITA ITALIA SPA';                       piva='13181080154'; sede='UBERTI' },
  @{ q='REPUTATION MANAGER S.P.A. SOCIETA BENEFIT';        piva='07569410967'; sede='MANGILI' },
  @{ q='RES FREEDATA S.R.L.';                              piva='10102720967'; sede='PIRELLI' },
  @{ q='RES PUBLICA SRL';                                  piva='06349250966'; sede='BUENOS AIRES' },
  @{ q='RES SYNESIS S.R.L.';                               piva='09445240964'; sede='PIRELLI' },
  @{ q='RELCO SRL Milano';                                 piva='01153950157'; sede='LAMBRATE' },
  @{ q='REMEMBER.MI SRL';                                  piva='07391350969'; sede='FONTANILI' },
  @{ q='REMTENE SRL';                                      piva='08747890963'; sede='VISCONTI VENOSTA' },
  @{ q='RENOVIT PUBLIC SOLUTIONS S.P.A.';                  piva='12374760150'; sede='MALIPIERO' },
  @{ q='REP S.R.L. CENTRO DI RICERCA SUGLI ENTI PUBBLICI'; piva='12420520962'; sede='DANTE' }
)

function CallApi($endpoint,$body){
  $t0=Get-Date
  try{
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/$endpoint" -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 300 -ErrorAction Stop
    $d = [int]((Get-Date)-$t0).TotalSeconds
    return @{ ok=$true; data=($r.Content | ConvertFrom-Json); dur=$d }
  } catch {
    $d = [int]((Get-Date)-$t0).TotalSeconds
    return @{ ok=$false; err=$_.Exception.Message; dur=$d }
  }
}

$summary = @()
$i = 0
foreach($t in $tests){
  $i++
  Write-Host ""
  Write-Host "===== [$i/$($tests.Count)] $($t.q) =====" -ForegroundColor Yellow
  $body = (@{ query=$t.q } | ConvertTo-Json -Compress)
  $resC = CallApi 'company-lookup' $body
  if(-not $resC.ok){
    Write-Host "  COMPANY FAIL ($($resC.dur)s): $($resC.err)" -ForegroundColor Red
    $summary += [PSCustomObject]@{ Q=$t.q; PivaOk='?'; SedeOk='?'; Titolare=''; PersonOk='?' }
    continue
  }
  $c = $resC.data
  $pivaOk = if($c.partita_iva -eq $t.piva){ 'OK' } else { "NO($($c.partita_iva))" }
  $sedeOk = if($c.sede_legale -and ($c.sede_legale -match $t.sede)){ 'OK' } elseif($c.indirizzo -and ($c.indirizzo -match $t.sede)){ 'OK(indir)' } else { "NO($($c.sede_legale)|$($c.indirizzo))" }
  Write-Host "  COMPANY ($($resC.dur)s)" -ForegroundColor Green
  Write-Host "    P.IVA:   $($c.partita_iva) [$pivaOk]"
  Write-Host "    Sede:    $($c.sede_legale) [$sedeOk]"
  Write-Host "    RagSoc:  $($c.ragione_sociale)"
  Write-Host "    Titolare:$($c.titolare) [$($c.ruolo_titolare)]"
  Write-Host "    Tel/Em:  $($c.telefono) / $($c.email)"
  Write-Host "    Sito:    $($c.sito)"
  Write-Host "    Fatt/Dip:$($c.fatturato) / $($c.dipendenti) (ATECO $($c.codice_ateco))"

  $personOk = 'skip'
  $personName = ''
  if($c.titolare -and ($c.titolare -notmatch '^(N/?D|non|sconosciuto)$')){
    $personName = $c.titolare
    $pq = "$($c.titolare) $($c.ragione_sociale)"
    Write-Host "  -> PERSON: $pq" -ForegroundColor Cyan
    $pbody = (@{ query=$pq } | ConvertTo-Json -Compress)
    $resP = CallApi 'person-lookup' $pbody
    if($resP.ok){
      $p = $resP.data
      $personOk = if($p.nome -or $p.email -or $p.telefono -or $p.linkedin){ 'OK' } else { 'EMPTY' }
      Write-Host "    PERSON ($($resP.dur)s): $personOk"
      Write-Host "      Nome:     $($p.nome)"
      Write-Host "      Ruolo:    $($p.ruolo_titolare)"
      Write-Host "      Email:    $($p.email)"
      Write-Host "      Tel/Cel:  $($p.telefono) / $($p.cellulare)"
      Write-Host "      LinkedIn: $($p.linkedin)"
      Write-Host "      Azienda:  $($p.dati_azienda.ragione_sociale) [$($p.dati_azienda.partita_iva)]"
    } else {
      $personOk = 'FAIL'
      Write-Host "    PERSON FAIL ($($resP.dur)s): $($resP.err)" -ForegroundColor Red
    }
  } else {
    Write-Host "  -> PERSON: skipped (no titolare)" -ForegroundColor DarkYellow
  }

  $summary += [PSCustomObject]@{
    Q = $t.q
    PivaOk = $pivaOk
    SedeOk = $sedeOk
    Titolare = $personName
    PersonOk = $personOk
  }
}

Write-Host ""
Write-Host "===== SUMMARY =====" -ForegroundColor Cyan
$summary | Format-Table -AutoSize
Write-Host "===== END $(Get-Date -Format 'HH:mm:ss') =====" -ForegroundColor Cyan
