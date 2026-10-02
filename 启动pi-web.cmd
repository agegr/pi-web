@echo off
chcp 65001 >nul
title Pi Web（本地增强版）
cd /d D:\.Projects\projects\pi-web-fork

echo ============================================
echo   Pi Web 本地增强版（含图片/视频背景功能）
echo ============================================
echo 正在停止 30141 端口上已有的 pi-web 实例...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :30141 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo 正在启动 pi-web（127.0.0.1:30141）...
echo 浏览器会自动打开；关闭本窗口即停止服务。
echo.
call npm run start
pause
