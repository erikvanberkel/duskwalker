# Dev helper: decodes the grey bands drawn by ExcShow (debug builds). Looks for the a5a5a5a5 marker.
param([string]$File)
Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile($File)
$runs = @(); $prev = -1; $start = 0
for ($y = 50; $y -lt $b.Height - 40; $y++) { $v = [int][math]::Round($b.GetPixel(380, $y).R / 17); if ($v -ne $prev) { if ($prev -ge 0) { $runs += ,@($prev, ($y - $start)) }; $prev = $v; $start = $y } }
$b.Dispose()
$nibs = ''
foreach ($r in $runs) { $n = [math]::Max(1, [int][math]::Round($r[1] / 10)); for ($k = 0; $k -lt $n; $k++) { $nibs += '{0:x}' -f $r[0] } }
$i = $nibs.IndexOf('a5a5a5a5')
if ($i -lt 0) { "no marker: $nibs"; return }
$s = $nibs.Substring($i + 8)
"PC=$($s.Substring(0,8)) FAULT=$($s.Substring(8,8)) STACK=$($s.Substring(16,8)) A2=$($s.Substring(24,8)) A3=$($s.Substring(32,8))"
