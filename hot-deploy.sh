#!/bin/bash
# 快速热更新部署脚本 - Docker Compose V1/V2 兼容版
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 自动检测 docker compose 命令（新版 docker compose 或旧版 docker-compose）
if docker compose version &>/dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "❌ 未找到 docker compose 命令，请安装 Docker Compose"
    exit 1
fi

if ! docker ps --filter name=novel-assistant --format '{{.Names}}' | grep -q novel-assistant; then
    echo "❌ 容器未运行，请先启动: $DOCKER_COMPOSE up -d"
    exit 1
fi

TARGET="${1:-all}"

update_backend() {
    echo "🔄 重启后端（volume 已挂载源码，重启即生效）..."
    # 重启容器 → entrypoint 重新启动 uvicorn，读取最新挂载的源码
    $DOCKER_COMPOSE restart
    echo "✅ 后端更新完成（约3秒）"
}

update_frontend() {
    echo "build frontend..."
    if command -v npm &>/dev/null; then
        LOG_DIR="$PROJECT_DIR/logs"
        mkdir -p "$LOG_DIR"
        FE_LOG="$LOG_DIR/frontend-build.log"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ==== frontend build start ====" >> "$FE_LOG"
        # 限制 Node 内存，低配服务器防 OOM
        export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=1024"
        # 捕获完整输出，避免管道掩盖退出码
        local build_output
        if ! build_output=$(cd frontend && npm run build 2>&1); then
            echo "$build_output" >> "$FE_LOG"
            echo "❌ 前端构建失败！完整错误已写入: $FE_LOG" >&2
            echo "---------- 末尾 20 行 ----------" >&2
            echo "$build_output" | tail -20 >&2
            echo "--------------------------------" >&2
            exit 1
        fi
        echo "$build_output" >> "$FE_LOG"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ==== frontend build ok ====" >> "$FE_LOG"
        echo "✅ 前端构建成功，日志: $FE_LOG"
    else
        echo "⚠️ 本地无 npm，跳过前端构建"
        echo "   如需更新前端，请先安装 Node.js，或使用开发模式："
        echo "   $DOCKER_COMPOSE -f docker-compose.dev.yml up -d"
    fi
}

case "$TARGET" in
    backend)  update_backend ;;
    frontend) update_frontend ;;
    all)      update_frontend ; update_backend ;;
    *) echo "usage: $0 [backend|frontend|all]" ; exit 1 ;;
esac
echo "deploy ok"
