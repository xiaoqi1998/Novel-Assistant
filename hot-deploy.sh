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
        (cd frontend && npm run build)
        echo "frontend done"
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
