# Auto-test de l'exécutable sur un vrai bureau Windows (intégration continue).
#
# Ouvre le Bloc-notes (une vraie fenêtre à faire bouger), lance le singe en
# mode auto-test (SINGE_SELFTEST), fait une capture d'écran pendant qu'il vit,
# puis vérifie le rapport écrit par l'appli (voir src-tauri/src/selftest.rs et
# src/renderer/selftest.js).
#
#   ./scripts/ci/selftest.ps1 -Exe dist/Singe-de-bureau.exe -Out ci-out
param(
  [Parameter(Mandatory)] [string] $Exe,
  [string] $Out = 'ci-out'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$report = Join-Path $Out 'selftest.json'
Remove-Item $report -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Save-Screen([string] $path) {
  try {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $op = [System.Drawing.CopyPixelOperation]::SourceCopy -bor [System.Drawing.CopyPixelOperation]::CaptureBlt
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size, $op)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  } catch { Write-Warning "capture impossible : $_" }
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
"Écran : $($screen.Bounds.Width)x$($screen.Bounds.Height), zone de travail $($screen.WorkingArea)"

# Une fenêtre d'application ordinaire, que le singe a le droit de déplacer
$notepad = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 3

$env:SINGE_SELFTEST = $report
$env:SINGE_SELFTEST_MOVE_CLASS = 'Notepad'
$env:SINGE_DEBUG = '1'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$app = Start-Process (Resolve-Path $Exe).Path -PassThru `
  -RedirectStandardError (Join-Path $Out 'stderr.log') -RedirectStandardOutput (Join-Path $Out 'stdout.log')
$null = $app.Handle # sinon PowerShell ne connaît pas le code de sortie

Start-Sleep -Seconds 6
Save-Screen (Join-Path $Out 'ecran-1.png')
Start-Sleep -Seconds 4
Save-Screen (Join-Path $Out 'ecran-2.png')

if (-not $app.WaitForExit(150000)) {
  Stop-Process -Id $app.Id -Force
  throw "l'appli ne s'est pas arrêtée toute seule (auto-test bloqué)"
}
"Auto-test terminé en $([int]$sw.Elapsed.TotalSeconds) s, code de sortie $($app.ExitCode)"
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item Env:SINGE_SELFTEST, Env:SINGE_SELFTEST_MOVE_CLASS, Env:SINGE_DEBUG

Get-Content (Join-Path $Out 'stderr.log') -ErrorAction SilentlyContinue | Select-Object -Last 30
if (-not (Test-Path $report)) { throw 'pas de rapport d''auto-test' }
$raw = Get-Content $report -Raw
$raw
$r = $raw | ConvertFrom-Json

# ---------------------------------------------------------------------------
#  Vérifications
# ---------------------------------------------------------------------------
$failures = @()
function Check([string] $name, [bool] $ok) {
  if ($ok) { "  OK      $name" } else { "  ÉCHEC   $name"; $script:failures += $name }
}

$p = $r.renderer
Check 'rapport complet (pas de délai dépassé)'      ($null -eq $r.error -and $null -ne $p)
Check 'WebGL disponible'                             ([bool]$p.webgl)
Check 'aucune erreur JavaScript'                     ($p.errors.Count -eq 0)
Check 'le singe atterrit au sol'                     ([bool]$p.landed)
Check 'une banane tombe et se pose'                  ([bool]$p.bananaLanded)
Check 'on lui donne la banane, il la mange'          ([bool]$p.fed -and [bool]$p.ate)
Check 'il fait caca, on nettoie'                     ([bool]$p.pooped -and [bool]$p.cleaned)
Check 'images 3D des objets'                         ([bool]$p.sprites)
Check 'détection du singe sous la souris'            ([bool]$p.hitTest)
Check "animation fluide ($($p.fpsWalking) i/s en marchant)" ($p.fpsWalking -ge 25)
Check 'clics traversants hors du singe'              ([bool]$r.hover.ignoringBefore -and [bool]$r.hover.ignoringAway)
Check 'le singe capte la souris quand on le survole' ($null -ne $r.hover -and -not [bool]$r.hover.ignoringOverMonkey)
Check "liste des fenêtres ($($r.windowsSeen) vues, $($r.ledges) rebords)" ([bool]$r.windowTracker -and $r.windowsSeen -gt 0)
Check 'le Bloc-notes est repéré'                     ([bool]$r.moveWindow.found)
$m = $r.moveWindow
$moved = $m.started -and $m.before -and $m.after -and
  [math]::Abs(($m.after.left - $m.before.left) - 150) -le 12 -and
  [math]::Abs(($m.after.top - $m.before.top) - 60) -le 12
Check 'bêtise : il déplace le Bloc-notes de 150×60 px' ([bool]$moved)
Check 'bêtise : note « DONNE BANANES !! » écrite'    ([bool]$r.noteWritten)
Check "sortie propre (code $($app.ExitCode))"        ($app.ExitCode -eq 0)

if ($failures.Count) { throw "$($failures.Count) vérification(s) en échec : $($failures -join ', ')" }
'Tout est bon.'
