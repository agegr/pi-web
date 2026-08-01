$ErrorActionPreference = "Stop"

$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$address = "http://127.0.0.1:30141"
$port = 30141
$packageJson = Join-Path $projectRoot "package.json"

if (-not (Test-Path -LiteralPath $packageJson)) {
  throw "Pi Web project directory was not found: $projectRoot"
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  $logDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "pi-web"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

  $stdoutLog = Join-Path $logDirectory "pi-web-dev.stdout.log"
  $stderrLog = Join-Path $logDirectory "pi-web-dev.stderr.log"
  Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $projectRoot `
    -ArgumentList @("-NoProfile", "-Command", "npm.cmd run dev") `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog | Out-Null

  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 500
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  } while (-not $listener -and (Get-Date) -lt $deadline)

  if (-not $listener) {
    throw "Pi Web did not start within 20 seconds. Check: $stderrLog"
  }
}

Start-Process $address
