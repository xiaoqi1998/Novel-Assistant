@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title 墨笔 - 一键启动

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set VENV=%BACKEND%\venv
set VENV_PY=%VENV%\Scripts\python.exe
set PORT=8000
set URL=http://localhost:%PORT%

echo ==================================================
echo   墨笔 (MoBi) - 一键启动
echo   访问地址: %URL%
echo ==================================================
echo.

REM ========== 环境检查 ==========
where python > nul 2>&1
if errorlevel 1 (
    echo [X] 未检测到 Python，请先安装 Python 3.10+
    echo     下载地址: https://www.python.org/downloads/
    echo     安装时请勾选 "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

where npm > nul 2>&1
if errorlevel 1 (
    echo [X] 未检测到 Node.js，请先安装 Node.js 16+
    echo     下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] 环境检查通过: Python + Node.js
echo.

REM ========== [1/7] 创建虚拟环境 ==========
if not exist "%VENV_PY%" (
    echo [1/7] 首次启动，正在创建 Python 虚拟环境...
    pushd "%BACKEND%"
    python -m venv venv
    if errorlevel 1 (
        echo [X] 创建虚拟环境失败
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] 虚拟环境创建完成
) else (
    echo [1/7] 虚拟环境已存在，跳过
)

REM ========== [2/7] 安装 Python 依赖 ==========
"%VENV_PY%" -c "import fastapi" > nul 2>&1
if errorlevel 1 (
    echo [2/7] 首次启动，正在安装 Python 依赖（精简版，约 100MB）...
    echo       使用国内镜像加速，请耐心等待 1-3 分钟...
    pushd "%BACKEND%"
    "%VENV_PY%" -m pip install --upgrade pip -q -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
    "%VENV_PY%" -m pip install -r requirements-lite.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
    if errorlevel 1 (
        echo [X] Python 依赖安装失败
        echo     请检查网络连接，或尝试手动运行:
        echo     cd backend ^&^& pip install -r requirements-lite.txt
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] Python 依赖安装完成
) else (
    echo [2/7] Python 依赖已安装，跳过
)

REM ========== [3/7] 生成配置文件 ==========
if not exist "%BACKEND%\.env" (
    echo [3/7] 首次启动，正在生成配置文件...
    pushd "%BACKEND%"

    REM 生成随机会话密钥
    for /f "delims=" %%K in ('"%VENV_PY%" -c "import secrets;print(secrets.token_hex(32))"') do set SECRET_KEY=%%K

    REM 计算数据库路径（正斜杠格式，aiosqlite 要求）
    for /f "delims=" %%D in ('"%VENV_PY%" -c "import os;print(os.path.abspath(os.path.join(os.getcwd(),'..','data','ai_story.db')).replace(chr(92),'/'))"') do set DB_PATH=%%D

    REM 确保数据目录存在
    if not exist "%ROOT%data" mkdir "%ROOT%data"

    REM 写入 .env 配置
    (
        echo APP_NAME=墨笔
        echo APP_VERSION=1.5.2
        echo APP_HOST=0.0.0.0
        echo APP_PORT=8000
        echo DEBUG=false
        echo TZ=Asia/Shanghai
        echo.
        echo DATABASE_URL=sqlite+aiosqlite:///!DB_PATH!
        echo.
        echo LOG_LEVEL=INFO
        echo LOG_TO_FILE=true
        echo LOG_FILE_PATH=logs/app.log
        echo LOG_MAX_BYTES=10485760
        echo LOG_BACKUP_COUNT=5
        echo.
        echo CORS_ORIGINS=["http://localhost:8000","http://127.0.0.1:8000"]
        echo.
        echo SESSION_SECRET_KEY=!SECRET_KEY!
        echo SESSION_EXPIRE_MINUTES=120
        echo.
        echo LOCAL_AUTH_ENABLED=true
        echo LOCAL_AUTH_USERNAME=admin
        echo LOCAL_AUTH_PASSWORD=admin123
        echo LOCAL_AUTH_DISPLAY_NAME=本地管理员
        echo.
        echo OPENAI_API_KEY=请在此填写你的API Key
        echo OPENAI_BASE_URL=https://api.openai.com/v1
        echo DEFAULT_AI_PROVIDER=openai
        echo DEFAULT_MODEL=gpt-4o-mini
        echo.
        echo NEW_API_ENABLED=false
        echo WORKSHOP_MODE=client
        echo WORKSHOP_CLOUD_URL=
    ) > ".env"

    if errorlevel 1 (
        echo [X] 配置文件生成失败
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] 配置文件已生成 ^(.env^)
    echo      默认账号: admin / admin123
    echo      请稍后在「设置」页填入 AI API Key
) else (
    echo [3/7] 配置文件已存在，跳过
)

REM ========== [4/7] 安装前端依赖 ==========
if not exist "%FRONTEND%\node_modules" (
    echo [4/7] 首次启动，正在安装前端依赖...
    pushd "%FRONTEND%"
    call npm install
    if errorlevel 1 (
        echo [X] 前端依赖安装失败
        echo     请检查网络连接，或尝试手动运行: cd frontend ^&^& npm install
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] 前端依赖安装完成
) else (
    echo [4/7] 前端依赖已安装，跳过
)

REM ========== [5/7] 构建前端 ==========
if not exist "%BACKEND%\static\index.html" (
    echo [5/7] 首次启动，正在构建前端^（约 1-2 分钟^)...
    pushd "%FRONTEND%"
    call npm run build
    if errorlevel 1 (
        echo [X] 前端构建失败
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] 前端构建完成
) else (
    echo [5/7] 前端已构建，跳过
)

REM ========== [6/7] 数据库迁移 ==========
echo [6/7] 正在检查数据库迁移...
pushd "%BACKEND%"
"%VENV_PY%" -m alembic -c alembic-sqlite.ini upgrade head
if errorlevel 1 (
    echo [!] 数据库迁移出现警告，尝试继续启动...
) else (
    echo [OK] 数据库就绪
)
popd

REM ========== [7/7] 启动应用 ==========
echo.
echo [7/7] 正在启动应用...
echo.
echo ==================================================
echo   启动完成！
echo   访问地址: %URL%
echo   默认账号: admin / admin123
echo   API 文档: %URL%/docs
echo.
echo   停止服务: 按 Ctrl+C 或关闭此窗口
echo   更新版本: 双击 update.bat
echo ==================================================
echo.

REM 延迟 5 秒后自动打开浏览器（后台执行，不阻塞）
start "" cmd /c "timeout /t 5 /nobreak > nul & start %URL%"

REM 前台运行后端（前后端同源，单端口 8000）
cd /d "%BACKEND%"
"%VENV_PY%" -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%

echo.
echo 应用已停止。
pause
