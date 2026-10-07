# Auto-test de l'exécutable sur un vrai bureau Windows (intégration continue).
#
# Ouvre le Bloc-notes (une vraie fenêtre à faire bouger), lance le singe en
# mode auto-test (SINGE_SELFTEST), compare l'écran avant / pendant (le singe
# doit être visible, et le reste du bureau intact : fenêtre transparente), puis
# vérifie le rapport écrit par l'appli (voir src-tauri/src/selftest.rs et
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
# Capture de l'écran (BitBlt avec CAPTUREBLT : fenêtres transparentes comprises)
# et comparaison de deux captures, en C# pour la vitesse.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SingeCapture {
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc, IntPtr bmp, uint start, uint lines, int[] bits, ref BITMAPINFOHEADER bi, uint usage);
  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAPINFOHEADER {
    public uint biSize; public int biWidth, biHeight; public ushort biPlanes, biBitCount;
    public uint biCompression, biSizeImage; public int biXPelsPerMeter, biYPelsPerMeter; public uint biClrUsed, biClrImportant;
  }
  public static int[] Grab(int x, int y, int w, int h) {
    IntPtr sdc = GetDC(IntPtr.Zero), mdc = CreateCompatibleDC(sdc), bmp = CreateCompatibleBitmap(sdc, w, h);
    IntPtr old = SelectObject(mdc, bmp);
    BitBlt(mdc, 0, 0, w, h, sdc, x, y, 0x00CC0020 | 0x40000000); // SRCCOPY | CAPTUREBLT
    SelectObject(mdc, old);
    var bi = new BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
    var px = new int[w * h];
    GetDIBits(mdc, bmp, 0, (uint)h, px, ref bi, 0);
    DeleteObject(bmp); DeleteDC(mdc); ReleaseDC(IntPtr.Zero, sdc);
    return px;
  }
  // Pixels qui ont nettement changé : nombre et rectangle englobant.
  public static int[] Diff(int[] a, int[] b, int w) {
    int n = 0, x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
    for (int i = 0; i < a.Length; i++) {
      int p = a[i], q = b[i], d = 0;
      for (int s = 0; s < 24; s += 8) d = Math.Max(d, Math.Abs(((p >> s) & 255) - ((q >> s) & 255)));
      if (d <= 40) continue;
      n++;
      int x = i % w, y = i / w;
      x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); x1 = Math.Max(x1, x); y1 = Math.Max(y1, y);
    }
    return new[] { n, x0, y0, x1, y1 };
  }
}
'@

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
function Get-Screen { , [SingeCapture]::Grab($bounds.X, $bounds.Y, $bounds.Width, $bounds.Height) } # la virgule : renvoie le tableau d'un bloc
function Save-Png([int[]] $px, [string] $path) {
  try {
    $bmp = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
    $rect = [System.Drawing.Rectangle]::new(0, 0, $bounds.Width, $bounds.Height)
    $data = $bmp.LockBits($rect, 'WriteOnly', [System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
    [System.Runtime.InteropServices.Marshal]::Copy($px, 0, $data.Scan0, $px.Length)
    $bmp.UnlockBits($data)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } catch { Write-Warning "image non enregistrée : $_" }
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
"Écran : $($screen.Bounds.Width)x$($screen.Bounds.Height), zone de travail $($screen.WorkingArea)"

# Une fenêtre d'application ordinaire, que le singe a le droit de déplacer
$notepad = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 3
$before = Get-Screen # le bureau sans le singe
Save-Png $before (Join-Path $Out 'ecran-avant.png')

$env:SINGE_SELFTEST = $report
$env:SINGE_SELFTEST_MOVE_CLASS = 'Notepad'
$env:SINGE_DEBUG = '1'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$app = Start-Process (Resolve-Path $Exe).Path -PassThru `
  -RedirectStandardError (Join-Path $Out 'stderr.log') -RedirectStandardOutput (Join-Path $Out 'stdout.log')
$null = $app.Handle # sinon PowerShell ne connaît pas le code de sortie

# Pendant qu'il vit : seuls le singe (et ses objets) doivent changer l'écran.
$diffs = foreach ($t in 1..2) {
  Start-Sleep -Seconds 4
  $now = Get-Screen
  Save-Png $now (Join-Path $Out "ecran-$t.png")
  , [SingeCapture]::Diff($before, $now, $bounds.Width)
}
$area = $bounds.Width * $bounds.Height
foreach ($d in $diffs) {
  '  capture : {0} pixels changés ({1:N2} % de l''écran), zone x {2}-{3}, y {4}-{5}' -f $d[0], ($d[0] / $area * 100), $d[1], $d[3], $d[2], $d[4]
}

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
Check 'absent de la barre des tâches et d''Alt+Tab'  ([bool]$r.hiddenFromAltTab)
Check "liste des fenêtres ($($r.windowsSeen) vues, $($r.ledges) rebords)" ([bool]$r.windowTracker -and $r.windowsSeen -gt 0)
Check 'le Bloc-notes est repéré'                     ([bool]$r.moveWindow.found)
$m = $r.moveWindow
$moved = $m.started -and $m.before -and $m.after -and
  [math]::Abs(($m.after.left - $m.before.left) - 150) -le 12 -and
  [math]::Abs(($m.after.top - $m.before.top) - 60) -le 12
Check 'bêtise : il déplace le Bloc-notes de 150×60 px' ([bool]$moved)
Check 'bêtise : note « DONNE BANANES !! » écrite'    ([bool]$r.noteWritten)
$changed = ($diffs | ForEach-Object { $_[0] } | Measure-Object -Maximum).Maximum
Check "le singe est visible à l'écran ($changed pixels)" ($changed -ge 300)
Check 'fenêtre transparente : le bureau reste visible autour' (($diffs | Where-Object { $_[0] -gt $area * 0.08 }).Count -eq 0)
Check "sortie propre (code $($app.ExitCode))"        ($app.ExitCode -eq 0)

if ($failures.Count) { throw "$($failures.Count) vérification(s) en échec : $($failures -join ', ')" }
'Tout est bon.'
