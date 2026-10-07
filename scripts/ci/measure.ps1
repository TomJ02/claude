# Mesure la consommation du singe "en vie normale" : processeur et mémoire de
# l'appli et de ses processus WebView2, sur une durée donnée.
#
#   ./scripts/ci/measure.ps1 -Exe dist/Singe-de-bureau.exe -Seconds 40
#
# Indicatif seulement : sur les machines d'intégration continue il n'y a pas
# de carte graphique, la 3D y est calculée par le processeur (sur un vrai PC,
# c'est la carte graphique qui travaille et le chiffre est plus bas).
param(
  [Parameter(Mandatory)] [string] $Exe,
  [int] $Seconds = 40,
  [int] $Warmup = 15
)
$ErrorActionPreference = 'Stop'

function Get-Tree([int] $rootId) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($rootId)
  do {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true }
    }
  } while ($added)
  $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
}

function Get-Usage([int] $rootId) {
  $procs = @(Get-Tree $rootId)
  [pscustomobject]@{
    Count   = $procs.Count
    CpuMs   = ($procs | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum
    Private = ($procs | Measure-Object PrivateMemorySize64 -Sum).Sum
    Ids     = $procs.Id
  }
}

$app = Start-Process (Resolve-Path $Exe).Path -PassThru
Start-Sleep -Seconds $Warmup # démarrage, chute, premiers pas
if ($app.HasExited) { throw "l'appli s'est arrêtée toute seule (code $($app.ExitCode))" }

$a = Get-Usage $app.Id
$t = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$b = Get-Usage $app.Id
$elapsed = $t.Elapsed.TotalMilliseconds
if ($app.HasExited) { throw "l'appli s'est arrêtée pendant la mesure (code $($app.ExitCode))" }
Stop-Process -Id $b.Ids -Force -ErrorAction SilentlyContinue

$cores = [Environment]::ProcessorCount
$oneCore = ($b.CpuMs - $a.CpuMs) / $elapsed * 100
$total = $oneCore / $cores
$mem = $b.Private / 1MB
$lines = @(
  '### Consommation du singe (machine sans carte graphique)',
  '',
  "| Mesure sur $Seconds s | Valeur |",
  '|---|---|',
  ('| Processeur (comme le Gestionnaire des tâches, {0} cœurs) | {1:N1} % |' -f $cores, $total),
  ('| Processeur (d''un seul cœur) | {0:N1} % |' -f $oneCore),
  ('| Mémoire privée (appli + WebView2, {0} processus) | {1:N0} Mo |' -f $b.Count, $mem)
)
$lines
if ($env:GITHUB_STEP_SUMMARY) { $lines -join "`n" | Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8 }
