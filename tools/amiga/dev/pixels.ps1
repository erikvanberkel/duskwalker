# Dev helper: prints the colour at a few points of each PNG (fractions of the client area).
param([string[]]$Files)
Add-Type -AssemblyName System.Drawing
foreach ($f in $Files) {
  $b = [System.Drawing.Bitmap]::FromFile($f)
  $out = @()
  foreach ($pt in @(@(0.5,0.3),@(0.5,0.5),@(0.3,0.7),@(0.7,0.85))) {
    $c = $b.GetPixel([int]($b.Width*$pt[0]), [int](60 + ($b.Height-100)*$pt[1]))
    $out += ('#{0:x2}{1:x2}{2:x2}' -f $c.R,$c.G,$c.B)
  }
  "$([System.IO.Path]::GetFileName($f)) $($b.Width)x$($b.Height): $($out -join ' ')"
  $b.Dispose()
}
