#!/bin/bash
# 一键自动更新脚本 - 针对低配服务器优化版
#
# 日志位置：
#   /opt/1panel/apps/novel-assistant/logs/update.log

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error_exit() {
    log "❌ 错误: $1"
    exit 1
}

check_container() {
    if ! docker ps --filter name=novel-assistant --format '{{.Names}}' | grep -q novel-assistant; then
        error_exit "容器未运行，请先启动: docker-compose up -d"
    fi
}

check_health() {
    local max_wait=30
    local wait_count=0
    
    while [ $wait_count -lt $max_wait ]; do
        if curl -s http://localhost:8000/health | grep -q '"ok"'; then
            log "✅ 健康检查通过"
            return 0
        fi
        sleep 1
        wait_count=$((wait_count + 1))
    done
    
    error_exit "健康检查超时，服务可能未正常启动"
}

# 拉取最新代码
pull_code() {
    log "📥 检查并拉取最新代码..."
    
    if [ -n "$(git status --porcelain)" ]; then
        log "⚠️  检测到未提交的本地修改，自动提交保存..."
        git add -A
        git commit -m "auto: 保存更新前的本地修改 [$(date '+%Y-%m-%d %H:%M:%S')]"
    fi
    
    local before_commit=$(git rev-parse HEAD)
    
    if ! git pull --no-rebase --no-edit; then
        error_exit "代码拉取失败！存在冲突，请手动解决"
    fi
    
    local after_commit=$(git rev-parse HEAD)
    
    if [ "$before_commit" = "$after_commit" ]; then
        log "ℹ️  已是最新代码，无更新"
    else
        log "✅ 更新到: $(git log -1 --oneline)"
    fi
}

# 修复 Alembic 迁移
fix_migration() {
    log "🔍 检查 Alembic 迁移..."
    local heads=$(cd backend && alembic heads 2>&1)
    local head_count=$(echo "$heads" | grep -c "^[a-f0-9]" || true)
    
    if [ $head_count -gt 1 ]; then
        log "⚠️  检测到多个迁移 head，尝试修复..."
        local latest_migration=$(ls -t backend/alembic/postgres/versions/*.py | head -1)
        local prev_migration=$(ls -t backend/alembic/postgres/versions/*.py | sed -n '2p')
        local prev_revision=$(grep "revision = " "$prev_migration" | head -1 | sed "s/.*revision = ['\"]\\([^'\"]*\\)['\"].*/\\1/")
        
        if grep -q "down_revision" "$latest_migration"; then
            sed -i "s/down_revision = .*/down_revision = '$prev_revision'/" "$latest_migration"
        fi
        
        local sqlite_migration="backend/alembic/sqlite/versions/$(basename "$latest_migration")"
        if [ -f "$sqlite_migration" ]; then
            sed -i "s/down_revision = .*/down_revision = '$prev_revision'/" "$sqlite_migration"
        fi
        log "✅ 修复迁移完成"
    else
        log "✅ 迁移链正常"
    fi
}

# 低资源占用构建前端
build_frontend() {
    log "📦 构建前端（低资源模式）..."
    
    if ! command -v npm &>/devnull; then
        error_exit "未找到 npm，请先安装 Node.js"
    fi
    
    cd frontend
    
    # 限制 Node 内存最大 512MB，防止挤爆服务器内存导致 Swap 卡死
    export NODE_OPTIONS="--max-old-space-size=512"
    
    # 智能检查：如果 package.json 没变且 node_modules 存在，跳过 npm install
    if [ ! -d "node_modules" ] || git diff HEAD@{1} HEAD -- package.json | grep -q "package.json"; then
        log "🔄 检测到依赖变更，执行 npm install..."
        if ! npm install --silent 2>&1 | tail -5 >> "$LOG_FILE"; then
            cd ..
            error_exit "npm install 失败"
        fi
    else
        log "ℹ️  依赖未变更，跳过 npm install"
    fi
    
    # 执行构建
    if ! npm run build 2>&1 | tail -10 >> "$LOG_FILE"; then
        cd ..
        error_exit "前端构建失败"
    fi
    
    cd ..
    log "✅ 前端构建完成"
}

restart_service() {
    log "🔄 重启服务..."
    if ! docker-compose restart 2>&1 | tee -a "$LOG_FILE"; then
        error_exit "服务重启失败"
    fi
    log "✅ 服务已重启"
}

verify_service() {
    log "🔍 验证服务状态..."
    check_health
    log "📌 当前版本: $(git log -1 --oneline)"
}

main() {
    log "=========================================="
    log "🚀 开始自动更新"
    log "=========================================="
    
    check_container
    pull_code
    fix_migration
    build_frontend
    restart_service
    verify_service
    
    log "=========================================="
    log "🎉 自动更新完成！"
    log "=========================================="
}

main "$@"