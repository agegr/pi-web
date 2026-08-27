<#
.SYNOPSIS
  Restart the pi-web dev server on port 30141 without "port already in use".

.DESCRIPTION
  1. Finds every process LISTENING on port 30141 (any address).
  2. Kills the whole process tree (taskkill /T /F). Graceful WM_CLOSE is
     ignored by node console processes, so force is the reliable stop.
  3. Waits until the port is actually free before starting.
  4. Optionally backs up .next (-Clean), or only acts when the server is
     down (-IfDown), or only reports (-CheckOnly).
  5. Starts 'npm run dev' in the foreground, or detached with a log file
     (-Log), or the LAN variant (-Lan).

  Rationale: a stale 'next dev' holding 30141 makes the new one fail with
  "address already in use" (and a second instance would also contend for
  .next/dev/lock). This script kills the exact listener first, so the
  restart can never hit either failure.

.PARAMETER Port
  Port to manage. Defaults to 30141.

.PARAMETER Log
  Detached mode: start the server in the background and redirect output to
  .dsh-dev.log / .dsh-dev.err.log, then return immediately.

.PARAMETER Clean
  Move .next aside (.next.bak-<timestamp>) before starting, forcing a fresh
  compile. Use when the dev graph is corrupted.

.PARAMETER IfDown
  Only restart when the server is NOT already healthy: probe
  http://127.0.0.1:<Port>/; on HTTP 200 print a message and exit 0 without
  killing anything (mirrors the AGENTS.md "reuse the healthy process" rule).

.PARAMETER CheckOnly
  Only report what holds the port; never kill or start.

.PARAMETER Lan
  Start 'npm run dev:lan' (0.0.0.0) instead of 'npm run dev'.

.EXAMPLE
  .\restart-dev.cmd                # kill stale listener, start dev in this window
  .\restart-dev.cmd -Log           # kill, start detached with logs
  .\restart-dev.cmd -IfDown        # restart only if the server is down
  .\restart-dev.cmd -CheckOnly     # just show who owns the port
#>
[CmdletBinding()]
param(
  [int]$Port = 30141,
  [switch]$Log,
  [switch]$Clean,
  [switch]$IfDown,
  [switch]$CheckOnly,
  [switch]$Lan
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Get-Listeners {
  # Preferred: NetTCPIP module (exact owning PID). Fallback: netstat -ano.
  try {
    $p = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalPort -eq $Port } |
      Select-Object -ExpandProperty OwningProcess -Unique)
    if ($p.Count -gt 0) { return $p }
  } catch { }
  $p = @(netstat -ano |
    Select-String ":$Port\s" |
    Where-Object { $_.Line -match 'LISTENING' } |
    ForEach-Object { ($_.Line -split '\s+')[-1] } |
    Where-Object { $_ -match '^\d+$' } |
    Sort-Object -Unique)
  return $p
}

function Get-CommandLine([int]$ProcessId) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return '<gone>' }
  return $proc.CommandLine
}

# --- -IfDown: reuse a healthy server instead of restarting -----------------
if ($IfDown) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3
    if ($resp.StatusCode -eq 200) {
      Write-Host "[restart] server already healthy on 127.0.0.1:$Port (HTTP 200) - not restarting." -ForegroundColor Green
      exit 0
    }
  } catch { }
  Write-Host "[restart] -IfDown: no healthy server detected, restarting..." -ForegroundColor Yellow
}

# --- 1. find + report the owner --------------------------------------------
$pids = @(Get-Listeners)
if ($pids.Count -eq 0) {
  Write-Host "[restart] port $Port is free; nothing to kill." -ForegroundColor Green
} else {
  foreach ($procId in $pids) {
    Write-Host "[restart] port $Port held by PID $procId : $(Get-CommandLine $procId)" -ForegroundColor Yellow
  }
  if ($CheckOnly) { Write-Host "[restart] CheckOnly - leaving it running." -ForegroundColor Cyan; exit 0 }

  foreach ($procId in $pids) {
    # Windows console processes (node/npm) have no window, so taskkill without
    # /F sends WM_CLOSE into the void and fails with "could not be terminated"
    # (the bug that bit the first version of this script). Force-kill the whole
    # tree — the equivalent of Ctrl+C for a detached dev server. cmd /c wraps
    # the call so taskkill's stderr text cannot surface as a fatal
    # NativeCommandError under $ErrorActionPreference = 'Stop'.
    Write-Host "[restart] killing PID $procId and its child tree (taskkill /T /F) ..."
    cmd /c "taskkill /PID $procId /T /F >nul 2>&1"
  }

  # --- 2. wait up to 10s for the port to free -------------------------------
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    $still = @(Get-Listeners)
    if ($still.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }

  $left = @(Get-Listeners)
  if ($left.Count -gt 0) {
    Write-Host "[restart] port $Port still held by $($left -join ','); retrying force-kill ..." -ForegroundColor Red
    foreach ($procId in $left) { cmd /c "taskkill /PID $procId /T /F >nul 2>&1" }
    Start-Sleep -Seconds 2
  }
  $left = @(Get-Listeners)
  if ($left.Count -gt 0) {
    Write-Host "[restart] FAILED to free port $Port (still held by $($left -join ','))" -ForegroundColor Red
    exit 1
  }
  Write-Host "[restart] port $Port is free." -ForegroundColor Green
}
if ($CheckOnly) { Write-Host "[restart] port $Port is free." -ForegroundColor Green; exit 0 }

# --- 3. optional .next backup ------------------------------------------------
if ($Clean) {
  if (Test-Path '.next') {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $bak = ".next.bak-$stamp"
    Move-Item '.next' $bak
    Write-Host "[restart] moved .next -> $bak (fresh compile on next start)" -ForegroundColor Yellow
  } else {
    Write-Host "[restart] no .next to back up; skipping -Clean." -ForegroundColor Yellow
  }
}

# --- 4. start ----------------------------------------------------------------
$scriptName = if ($Lan) { 'dev:lan' } else { 'dev' }
Write-Host "[restart] starting: npm run $scriptName (port $Port) ..." -ForegroundColor Cyan
if ($Log) {
  $outLog = Join-Path $Root '.dsh-dev.log'
  $errLog = Join-Path $Root '.dsh-dev.err.log'
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', $scriptName -WorkingDirectory $Root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden
  Write-Host "[restart] detached; logs -> .dsh-dev.log / .dsh-dev.err.log" -ForegroundColor Green
} else {
  npm run $scriptName
  exit $LASTEXITCODE
}
