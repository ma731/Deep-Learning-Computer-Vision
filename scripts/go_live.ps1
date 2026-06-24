# FreshGuard "go live" launcher: starts the API server + a public HTTPS tunnel
# so phones can scan a QR and open the app (camera works over https).
#
# Double-click, or run:  powershell -ExecutionPolicy Bypass -File scripts\go_live.ps1
#
# Uses your reserved ngrok static domain, so the public URL (and therefore the
# QR) is the SAME every launch - print it once and reuse it for the whole demo
# period. First visit shows a one-time ngrok "Visit Site" page; tap it once.
# Server + tunnel run in their own minimized windows and keep running after this
# script exits. The URL is written to .public_url, which the app reads live.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$py = "$root\.venv\Scripts\python.exe"
$ng = "$env:USERPROFILE\tools\ngrok.exe"

# Your free reserved ngrok static domain (stable for the whole demo period).
$DOMAIN = "depraved-brewing-decathlon.ngrok-free.dev"
$PUBLIC = "https://$DOMAIN"

if (-not (Test-Path $py)) { Write-Error "venv python not found at $py"; exit 1 }
if (-not (Test-Path $ng)) { Write-Error "ngrok not found at $ng"; exit 1 }

# 1. Free port 8000 and stop any previous tunnels
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-Process ngrok,cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

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

# 4. Start the tunnel pinned to the reserved static domain
Start-Process -FilePath $ng -ArgumentList 'http',"--url=$PUBLIC",'8000' -WindowStyle Minimized
Start-Sleep 4
$live = $false
for ($i=0; $i -lt 15; $i++) {
  try {
    $t = (Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 http://localhost:4040/api/tunnels).tunnels
    if ($t | Where-Object { $_.public_url -eq $PUBLIC }) { $live = $true; break }
  } catch {}
  Start-Sleep 1
}

Set-Content -Path "$root\.public_url" -Value $PUBLIC -NoNewline -Encoding ascii
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "169.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  FreshGuard is LIVE" -ForegroundColor Green
Write-Host "  Public (phone camera works):  $PUBLIC" -ForegroundColor Green
Write-Host "  Same Wi-Fi (upload only):      http://${ip}:8000" -ForegroundColor DarkGray
Write-Host "==================================================================" -ForegroundColor Green
if (-not $live) { Write-Warning "ngrok did not confirm the tunnel; check the ngrok window." }
Write-Host "  Same URL every launch - the QR is reusable (print it once)."
Write-Host "  First visit shows an ngrok 'Visit Site' page; tap it once."
Write-Host "  Keep this running during your demo. Closing the windows stops it."
Write-Host ""
Read-Host "Press Enter to close this launcher window (server + tunnel keep running)"
