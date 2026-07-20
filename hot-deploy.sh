#!/bin/bash
# 快速热更新部署脚本
#
# 原理：docker-compose.yml 已通过 volume 挂载源码，
#        后端: ./backend/app → /app/app (只读)
#        前端: ./backend/static → /app/static (只读)
#        修改宿主机文件后，只需重启后端进程即可生效。
#
# 用法:
#   ./hot-deploy.sh backend   # 只重启后端（约3秒）
#   ./hot-deploy.sh frontend  # 构建前端 + 刷新即生效（约10秒构建）
#   ./hot-deploy.sh all       # 前端+后端

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if ! docker ps --filter name=novel-assistant --format '{{.Names}}' | grep -q novel-assistant; then
    echo "❌ 容器未运行，请先启动: docker-compose up -d"
    exit 1
fi

TARGET="${1:-all}"

update_backend() {
    echo "🔄 重启后端（volume 已挂载源码，重启即生效）..."
    # 重启容器 → entrypoint 重新启动 uvicorn，读取最新挂载的源码
    docker-compose restart
    echo "✅ 后端更新完成（约3秒）"
}

update_frontend() {
    echo "📦 构建前端..."
    if command -v npm &>/dev/null; then
        (cd frontend && npm run build)
        echo "✅ 前端构建完成，刷新浏览器即可（volume 已挂载 static 目录）"
    else
        echo "⚠️ 本地无 npm，跳过前端构建"
        echo "   如需更新前端，请先安装 Node.js，或使用开发模式："
        echo "   docker-compose -f docker-compose.dev.yml up -d"
    fi
}

case "$TARGET" in
    backend)
        update_backend
        ;;
    frontend)
        update_frontend
        ;;
    all)
        update_frontend
        update_backend
        ;;
    *)
        echo "用法: $0 [backend|frontend|all]"
        echo ""
        echo "  backend   - 只重启后端（约3秒，源码通过 volume 已挂载）"
        echo "  frontend  - 构建前端并生效（需本地 npm）"
        echo "  all       - 前端+后端"
        exit 1
        ;;
esac

echo "🎉 部署完成！"
