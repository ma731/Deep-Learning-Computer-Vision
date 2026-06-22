# FreshGuard "go live" launcher: starts the API server + a public HTTPS tunnel
# so phones can scan a QR and open the app (camera works over https).
#
# Double-click, or run:  powershell -ExecutionPolicy Bypass -File scripts\go_live.ps1
#
# Uses a Cloudflare quick tunnel: NO "visit site" warning page (clean scan), free.
# The URL is random each launch, so generate the QR live from the laptop (phone
# icon in the app) rather than printing it ahead. The URL is written to
# .public_url, which the app reads live for its phone QR. Server + tunnel run in
# their own minimized windows and keep running after this script exits.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$py = "$root\.venv\Scripts\python.exe"
$cf = "$env:USERPROFILE\tools\cloudflared.exe"

if (-not (Test-Path $py)) { Write-Error "venv python not found at $py"; exit 1 }
if (-not (Test-Path $cf)) { Write-Error "cloudflared not found at $cf"; exit 1 }

# 1. Free port 8000 and stop any previous tunnels
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-Process cloudflared,ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. One-time firewall allow (UAC prompt only if the rule is missing)
if (-not (Get-NetFirewallRule -DisplayName "FreshGuard 8000" -ErrorAction SilentlyContinue)) {
  Write-Host "Adding firewall rule for port 8000 (approve the UAC prompt)..."
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',
      "New-NetFirewallRule -DisplayName 'FreshGuard 8000' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Any"
  } catch { Write-Warning "Firewall rule not added; local-Wi-Fi access may be blocked." }
}

# 3. Start the API server (own minimized window, survives this script)
Write-Host "Starting server..."
Start-Process -FilePath $py `
  -ArgumentList '-m','uvicorn','main:app','--app-dir','backend','--host','0.0.0.0','--port','8000' `
  -WindowStyle Minimized
$ok = $false
for ($i=0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8000/api/health | Out-Null; $ok = $true; break }
  catch { Start-Sleep 1 }
}
if (-not $ok) { Write-Warning "Server did not answer on :8000 yet; continuing anyway." }

# 4. Start the Cloudflare tunnel, capture the public URL
$out = "$env:TEMP\fg-tunnel.out"; $err = "$env:TEMP\fg-tunnel.err"
Remove-Item $out,$err -ErrorAction SilentlyContinue
Start-Process -FilePath $cf `
  -ArgumentList 'tunnel','--url','http://localhost:8000','--no-autoupdate','--protocol','http2' `
  -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Minimized

$tunnel = $null
for ($i=0; $i -lt 30; $i++) {
  Start-Sleep 1
  $m = Select-String -Path $out,$err -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
       Select-Object -First 1
  if ($m) { $tunnel = $m.Matches[0].Value; break }
}

Write-Host ""
if ($tunnel) {
  Set-Content -Path "$root\.public_url" -Value $tunnel -NoNewline -Encoding ascii
  $ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "169.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -First 1).IPAddress
  Write-Host "==================================================================" -ForegroundColor Green
  Write-Host "  FreshGuard is LIVE (no warning page)" -ForegroundColor Green
  Write-Host "  Public (phone camera works):  $tunnel" -ForegroundColor Green
  Write-Host "  Same Wi-Fi (upload only):      http://${ip}:8000" -ForegroundColor DarkGray
  Write-Host "==================================================================" -ForegroundColor Green
  Write-Host "  Open the app on this laptop, click the phone icon -> show the QR."
  Write-Host "  (URL changes each launch - always show the QR live, don't pre-print.)"
  Write-Host "  Keep this running during your demo. Closing the windows stops it."
} else {
  Write-Host "Server is up, but the tunnel URL wasn't detected. Check $err" -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Press Enter to close this launcher window (server + tunnel keep running)"
