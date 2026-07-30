#!/bin/bash
# 一键自动更新脚本 - 用于 1panel 计划任务
#
# 功能：
#   1. 检测未提交修改并自动提交，然后拉取最新代码
#   2. 检查并修复 Alembic 迁移冲突
#   3. 构建前端
#   4. 重启服务
#   5. 验证服务健康
#
# 用法：
#   ./auto-update.sh
#
# 日志位置：
#   /opt/1panel/apps/novel-assistant/logs/update.log

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 创建日志目录
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update.log"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error_exit() {
    log "❌ 错误: $1"
    exit 1
}

# 检查容器是否运行
check_container() {
    if ! docker ps --filter name=novel-assistant --format '{{.Names}}' | grep -q novel-assistant; then
        error_exit "容器未运行，请先启动: docker-compose up -d"
    fi
}

# 检查健康状态
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

# 拉取最新代码（检测未提交改动 -> 自动提交 -> 拉取）
pull_code() {
    log "📥 检查并拉取最新代码..."
    
    # 1. 检测是否有未提交的本地修改（包含已修改、新增、删除的文件）
    if [ -n "$(git status --porcelain)" ]; then
        log "⚠️  检测到未提交的本地修改，正在自动提交保存..."
        git add -A
        git commit -m "auto: 保存更新前的本地修改 [$(date '+%Y-%m-%d %H:%M:%S')]"
        log "✅ 本地修改已自动提交"
    else
        log "ℹ️  无未提交的本地修改"
    fi
    
    local before_commit=$(git rev-parse HEAD)
    
    # 2. 执行拉取
    if ! git pull; then
        error_exit "代码拉取失败！可能本地自动提交的代码与远程分支存在合并冲突，请手动解决"
    fi
    
    local after_commit=$(git rev-parse HEAD)
    
    if [ "$before_commit" = "$after_commit" ]; then
        log "ℹ️  已是最新代码，无更新"
    else
        log "✅ 更新到: $(git log -1 --oneline)"
    fi
}

# 检查并修复 Alembic 迁移冲突
fix_migration() {
    log "🔍 检查 Alembic 迁移..."
    
    # 检查是否有多个 head
    local heads=$(cd backend && alembic heads 2>&1)
    local head_count=$(echo "$heads" | grep -c "^[a-f0-9]" || true)
    
    if [ $head_count -gt 1 ]; then
        log "⚠️  检测到多个迁移 head，尝试修复..."
        
        # 获取最新的迁移文件
        local latest_migration=$(ls -t backend/alembic/postgres/versions/*.py | head -1)
        local migration_name=$(basename "$latest_migration" .py)
        
        # 找到需要修改的 down_revision
        local prev_migration=$(ls -t backend/alembic/postgres/versions/*.py | sed -n '2p')
        local prev_revision=$(grep "revision = " "$prev_migration" | head -1 | sed "s/.*revision = ['\"]\\([^'\"]*\\)['\"].*/\\1/")
        
        # 修复 postgres 迁移
        if grep -q "down_revision" "$latest_migration"; then
            sed -i "s/down_revision = .*/down_revision = '$prev_revision'/" "$latest_migration"
            log "✅ 修复 postgres 迁移: $migration_name"
        fi
        
        # 修复 sqlite 迁移
        local sqlite_migration="backend/alembic/sqlite/versions/$(basename "$latest_migration")"
        if [ -f "$sqlite_migration" ]; then
            sed -i "s/down_revision = .*/down_revision = '$prev_revision'/" "$sqlite_migration"
            log "✅ 修复 sqlite 迁移"
        fi
    else
        log "✅ 迁移链正常"
    fi
}

# 构建前端
build_frontend() {
    log "📦 构建前端..."
    
    if ! command -v npm &>/devnull; then
        error_exit "未找到 npm，请先安装 Node.js"
    fi
    
    cd frontend
    
    if ! npm install --silent 2>&1 | tail -5 >> "$LOG_FILE"; then
        error_exit "npm install 失败"
    fi
    
    if ! npm run build 2>&1 | tail -10 >> "$LOG_FILE"; then
        error_exit "前端构建失败"
    fi
    
    cd ..
    log "✅ 前端构建完成"
}

# 重启服务
restart_service() {
    log "🔄 重启服务..."
    
    if ! docker-compose restart 2>&1 | tee -a "$LOG_FILE"; then
        error_exit "服务重启失败"
    fi
    
    log "✅ 服务已重启"
}

# 验证服务
verify_service() {
    log "🔍 验证服务状态..."
    
    # 检查容器状态
    local status=$(docker ps --filter name=novel-assistant --format '{{.Status}}')
    if echo "$status" | grep -q "healthy"; then
        log "✅ 容器状态: $status"
    else
        log "⚠️  容器状态: $status"
    fi
    
    # 检查健康接口
    check_health
    
    # 验证代码版本
    local current_commit=$(git log -1 --oneline)
    log "📌 当前版本: $current_commit"
    
    # 验证前后端代码一致性
    local host_md5=$(md5sum backend/app/api/short_stories.py | awk '{print $1}')
    local container_md5=$(docker exec novel-assistant md5sum /app/app/api/short_stories.py | awk '{print $1}')
    
    if [ "$host_md5" = "$container_md5" ]; then
        log "✅ 后端代码一致: $host_md5"
    else
        log "⚠️  后端代码不一致！宿主机: $host_md5, 容器: $container_md5"
    fi
}

# 主流程
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

# 执行主流程
main "$@"