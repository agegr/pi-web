@echo off
rem Restart the pi-web dev server on 127.0.0.1:30141 without port conflicts.
rem Usage:  restart-dev.cmd [-Log] [-Clean] [-IfDown] [-CheckOnly] [-Lan] [-Port N]
rem   -Log       run detached, output to .dsh-dev.log / .dsh-dev.err.log
rem   -Clean     move .next aside first (fresh compile)
rem   -IfDown    only restart when the server is NOT already healthy
rem   -CheckOnly only show what holds the port, do nothing else
rem   -Lan       use npm run dev:lan (0.0.0.0) instead of dev
rem   -Port N    manage port N instead of 30141
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-dev.ps1" %*
exit /b %errorlevel%
