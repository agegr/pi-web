@echo off
setlocal

set "SCRIPT=%~dp0\pi-web-dev.js"
title pi-web-dev
echo Starting pi-web (dev branch)...
echo Press Ctrl+C to stop.
echo.
node "%SCRIPT%" %*
