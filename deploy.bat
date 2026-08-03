@echo off
REM Pure-ASCII launcher. All Chinese UI lives in deploy.ps1 (PowerShell handles UTF-8).
title Mobenovel - Remote Deploy
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
echo.
pause
