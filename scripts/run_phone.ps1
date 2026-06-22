# Launch FreshGuard so a phone on the SAME Wi-Fi can reach it.
# Binds 0.0.0.0 (all interfaces) - NOT 127.0.0.1, which only the laptop can see.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\run_phone.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Free the port if something is already on it
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# One-time firewall allow (idempotent). Needs admin; pops a UAC prompt if missing.
if (-not (Get-NetFirewallRule -DisplayName "FreshGuard 8000" -ErrorAction SilentlyContinue)) {
  Write-Host "Adding firewall rule for port 8000 (approve the UAC prompt)..."
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',
      "New-NetFirewallRule -DisplayName 'FreshGuard 8000' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Any"
  } catch { Write-Warning "Firewall rule not added - phone access may be blocked until you allow port 8000." }
}

# Show the LAN URL to type / QR on the phone
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "169.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "  Phone URL:  http://${ip}:8000" -ForegroundColor Green
Write-Host "  (same Wi-Fi only; camera needs the tunnel - see notes)" -ForegroundColor DarkGray
Write-Host ""

.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
