@echo off
title MoBi - One-Click Start

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set BACKEND_URL=http://localhost:8000
set FRONTEND_URL=http://localhost:5173

echo ==================================================
echo  MoBi (ий??) - One-Click Start
echo  Backend: %BACKEND_URL%
echo  Frontend: %FRONTEND_URL%
echo ==================================================
echo.

REM ========== Pre-check ==========
where python > nul 2>&1
if errorlevel 1 (
    echo [X] python not found, please install Python 3.10+
    pause
    exit /b 1
)

where npm > nul 2>&1
if errorlevel 1 (
    echo [X] npm not found, please install Node.js 16+
    pause
    exit /b 1
)

if not exist "%BACKEND%\.env" (
    echo [!] backend .env not found, copying from .env.example
    if exist "%BACKEND%\.env.example" (
        copy "%BACKEND%\.env.example" "%BACKEND%\.env" > nul
    ) else (
        echo [X] backend .env.example not found, cannot start
        pause
        exit /b 1
    )
)

if not exist "%FRONTEND%\node_modules" (
    echo [*] frontend deps not installed, running npm install...
    pushd "%FRONTEND%"
    call npm install
    popd
)

echo.
echo [1/3] Starting backend (FastAPI)...
start "MoBi-Backend" /D "%BACKEND%" python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

echo [2/3] Starting frontend (Vite)...
start "MoBi-Frontend" /D "%FRONTEND%" npm run dev

echo [3/3] Waiting for services to be ready, then opening browser...
timeout /t 6 /nobreak > nul
start "" "%FRONTEND_URL%"

echo.
echo ==================================================
echo  Started!
echo  Frontend: %FRONTEND_URL%
echo  Backend API docs: %BACKEND_URL%/docs
echo  Local account: admin / admin123
echo ==================================================
echo.
echo Close the backend/frontend windows to stop services.
pause
