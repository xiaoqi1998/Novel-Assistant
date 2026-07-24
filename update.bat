@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title 墨笔 - 更新版本

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set VENV_PY=%BACKEND%\venv\Scripts\python.exe

echo ==================================================
echo   墨笔 - 更新版本
echo ==================================================
echo.

REM 检查虚拟环境是否存在
if not exist "%VENV_PY%" (
    echo [X] 未检测到已安装的环境，请先双击 start.bat 完成首次启动
    echo.
    pause
    exit /b 1
)

REM ========== [1/5] 拉取最新代码 ==========
echo [1/5] 正在拉取最新代码...
where git > nul 2>&1
if errorlevel 1 (
    echo [!] 未检测到 git，跳过代码更新
    echo     如需更新代码，请手动安装 git 或下载新版压缩包覆盖
) else (
    pushd "%ROOT%"
    git pull
    if errorlevel 1 (
        echo [!] 代码拉取失败（可能有本地修改冲突），跳过
    ) else (
        echo [OK] 代码已更新
    )
    popd
)

REM ========== [2/5] 更新 Python 依赖 ==========
echo [2/5] 正在更新 Python 依赖...
pushd "%BACKEND%"
"%VENV_PY%" -m pip install -r requirements-lite.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -q
if errorlevel 1 (
    echo [!] Python 依赖更新失败，继续执行后续步骤
) else (
    echo [OK] Python 依赖已更新
)
popd

REM ========== [3/5] 数据库迁移 ==========
echo [3/5] 正在执行数据库迁移...
pushd "%BACKEND%"
"%VENV_PY%" -m alembic -c alembic-sqlite.ini upgrade head
if errorlevel 1 (
    echo [!] 数据库迁移出现警告
) else (
    echo [OK] 数据库迁移完成
)
popd

REM ========== [4/5] 更新前端依赖 ==========
echo [4/5] 正在更新前端依赖...
pushd "%FRONTEND%"
call npm install
if errorlevel 1 (
    echo [!] 前端依赖更新失败，继续执行后续步骤
) else (
    echo [OK] 前端依赖已更新
)
popd

REM ========== [5/5] 重新构建前端 ==========
echo [5/5] 正在重新构建前端...
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

echo.
echo ==================================================
echo   更新完成！
echo   双击 start.bat 重新启动应用即可
echo ==================================================
echo.
pause
