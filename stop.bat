@echo off
chcp 65001 > nul
title 墨笔 - 停止服务

echo ==================================================
echo   墨笔 - 停止服务
echo ==================================================
echo.

REM 查找并终止占用 8000 端口的进程
echo 正在查找占用 8000 端口的进程...

set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo 找到进程 PID: %%P
    taskkill /F /PID %%P > nul 2>&1
    if not errorlevel 1 (
        echo [OK] 已终止进程 %%P
        set FOUND=1
    )
)

if "!FOUND!"=="0" (
    echo [!] 未发现运行中的墨笔服务（端口 8000 无监听）
) else (
    echo.
    echo [OK] 墨笔服务已停止，端口 8000 已释放
)

echo.
pause
