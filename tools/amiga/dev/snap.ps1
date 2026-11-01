# Dev helper: boots an ADF in WinUAE (A1200, AROS ROM), captures the emulator window only (PrintWindow),
# without taking keyboard focus or playing sound.
#   snap.ps1 -Adf file.adf -Out shot.png -Times "8,12"   -> shot_0.png, shot_1.png
param([string]$Adf, [string]$Out, [string]$Times = "12", [string]$Extra = "")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 public struct RECT { public int L, T, R, B; } }
"@
[W]::SetProcessDPIAware() | Out-Null
$prev = [W]::GetForegroundWindow()
$uae = Join-Path $PSScriptRoot "..\..\..\.toolchain\amiga-debug\extension\bin\win32\winuae-gdb.exe"
$a = @("-s","use_gui=no","-s","quickstart=a1200,0","-s","kickstart_rom_file=:AROS","-s","floppy0=$Adf",
  "-s","win32.start_not_captured=true","-s","win32.nonotificationicon=yes",
  "-s","win32.inactive_pause=false","-s","win32.inactive_nosound=true","-s","win32.inactive_input=0",
  "-s","win32.active_capture_automatically=false",
  "-s","sound_output=interrupts",
  "-s","gfx_width_windowed=720","-s","gfx_height_windowed=568","-s","gfx_linemode=double","-s","floppy_speed=0",
  "-s","cycle_exact=true","-s","cpu_cycle_exact=true","-s","cpu_memory_cycle_exact=true","-s","blitter_cycle_exact=true") + ($Extra -split ' ' | Where-Object { $_ })
$p = Start-Process -FilePath $uae -ArgumentList $a -PassThru
$t0 = Get-Date; $i = 0; $shown = $false
foreach ($t in ($Times -split ',')) {
  while (((Get-Date) - $t0).TotalSeconds -lt [double]$t) {
    Start-Sleep -Milliseconds 100
    if (-not $shown) { $p.Refresh(); if ($p.MainWindowHandle -ne 0 -and [W]::GetForegroundWindow() -eq $p.MainWindowHandle -and $prev -ne 0) { [W]::SetForegroundWindow($prev) | Out-Null } }
  }
  $p.Refresh(); $h = $p.MainWindowHandle
  if (-not $shown) { [W]::ShowWindow($h, 4) | Out-Null; $shown = $true; Start-Sleep -Milliseconds 600; if ($prev -ne 0) { [W]::SetForegroundWindow($prev) | Out-Null } }
  $r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc(); $ok = [W]::PrintWindow($h, $hdc, 2); $g.ReleaseHdc($hdc); $g.Dispose()
  $f = $Out -replace '\.png$', "_$i.png"
  $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  "saved $f ${w}x${hh} ok=$ok"
  $i++
}
Stop-Process -Id $p.Id -Force
