#!/bin/bash
# 开发模式启动脚本
# 同时启动:
#   1. 后端 uvicorn --reload（代码变更自动重载）
#   2. 前端 Vite dev server（HMR 热更新）
#
# 用法: 由 Docker 容器自动调用

set -e

echo "================================================"
echo "🔧 开发模式启动"
echo "================================================"

# ---- 数据库初始化（与生产模式相同）----

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-mumuai}"
DB_NAME="${POSTGRES_DB:-mumuai_novel}"

echo "⏳ 等待数据库启动..."
MAX_RETRIES=30
RETRY_COUNT=0
while ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ 错误: 数据库连接超时"
        exit 1
    fi
    sleep 1
done
echo "✅ 数据库连接成功"

sleep 2

if ! PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
    sleep 3
fi

echo "🔄 执行数据库迁移..."
cd /app
alembic upgrade head
echo "✅ 数据库迁移成功"

# ---- 启动后端（热重载模式）----

echo "🚀 启动后端 (uvicorn --reload)..."

# --reload 监听 /app/app 目录（volume 挂载的源码）
# 修改 backend/app/ 下任意 .py 文件，uvicorn 自动重启
uvicorn app.main:app \
    --host "${APP_HOST:-0.0.0.0}" \
    --port "${APP_PORT:-8000}" \
    --reload \
    --reload-dir /app/app \
    --log-level info \
    --access-log \
    --use-colors &

UVICORN_PID=$!
echo "✅ 后端已启动 (PID: $UVICORN_PID, reload 模式)"

# ---- 启动前端 Vite 开发服务器 ----

echo "🎨 启动前端 Vite dev server (HMR)..."
cd /frontend

# Vite dev server 绑定 0.0.0.0 以便容器外访问
# --host 0.0.0.0 使 HMR WebSocket 可从浏览器连接
npx vite --host 0.0.0.0 --port 5173 &

VITE_PID=$!
echo "✅ 前端已启动 (PID: $VITE_PID, HMR 模式)"
echo ""
echo "================================================"
echo "  📡 后端 API:  http://localhost:8000"
echo "  🎨 前端 HMR:  http://localhost:5173"
echo "  📝 修改代码后自动生效，无需重建镜像"
echo "================================================"

# 等待任意子进程退出
wait -n $UVICORN_PID $VITE_PID 2>/dev/null || true

# 如果其中一个退出，杀掉另一个
echo "⚠️ 检测到进程退出，关闭所有服务..."
kill $UVICORN_PID $VITE_PID 2>/dev/null || true
