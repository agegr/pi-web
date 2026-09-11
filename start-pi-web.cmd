@echo off
setlocal
cd /d "%~dp0"
title Pi Web

if /i "%~1"=="--elevated" set "PI_WEB_ELEVATED=1"
set "PI_WEB_SCRIPT=%~f0"
set "PI_WEB_DIR=%~dp0"

rem Keep Pi Web on the same credential directory as the Pi CLI.
if not defined PI_CODING_AGENT_DIR set "PI_CODING_AGENT_DIR=%USERPROFILE%\.pi\agent"

rem AuthStorage needs to create auth.json.lock when reading/refreshing OAuth credentials.
set "PI_WEB_WRITE_PROBE=%PI_CODING_AGENT_DIR%\pi-web-write-probe-%RANDOM%-%RANDOM%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:PI_WEB_WRITE_PROBE; try { [System.IO.Directory]::CreateDirectory($p) | Out-Null; [System.IO.Directory]::Delete($p); exit 0 } catch { exit 1 }"
if errorlevel 1 if not defined PI_WEB_ELEVATED (
  echo Pi Web needs permission to access %PI_CODING_AGENT_DIR%.
  echo Requesting administrator permission once so the existing login can be used.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd='call ' + [char]34 + $env:PI_WEB_SCRIPT + [char]34 + ' --elevated'; Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/c',$cmd) -WorkingDirectory $env:PI_WEB_DIR -Verb RunAs"
  if errorlevel 1 (
    echo Could not obtain administrator permission. Pi Web was not started.
    exit /b 1
  )
  exit /b 0
)
if errorlevel 1 (
  echo Pi Web cannot write to %PI_CODING_AGENT_DIR% even with administrator permission.
  exit /b 1
)

if not defined PI_WEB_CLASH_PROXY set "PI_WEB_CLASH_PROXY=http://127.0.0.1:7897"
set "HTTP_PROXY=%PI_WEB_CLASH_PROXY%"
set "HTTPS_PROXY=%PI_WEB_CLASH_PROXY%"
set "NO_PROXY=localhost,127.0.0.1,::1"
set "http_proxy=%HTTP_PROXY%"
set "https_proxy=%HTTPS_PROXY%"
set "no_proxy=%NO_PROXY%"

node "%~dp0bin\pi-web-launcher.js"
exit /b %errorlevel%
