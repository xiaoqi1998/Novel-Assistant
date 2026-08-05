#!/bin/bash
# 一键自动更新脚本 - 针对低配服务器优化版
#
# 日志位置：
#   /opt/1panel/apps/novel-assistant/logs/update.log

set -e
set -o pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update.log"

# 自动检测 docker compose 命令（新版 docker compose 或旧版 docker-compose）
if docker compose version &>/dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE=""
fi

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error_exit() {
    log "❌ 错误: $1"
    exit 1
}

check_container() {
    if ! docker ps --filter name=novel-assistant --format '{{.Names}}' | grep -q novel-assistant; then
        error_exit "容器未运行，请先启动: docker compose up -d"
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

# 记录本次更新前后的 commit（供公告生成使用）
UPDATE_PREV_COMMIT=""
UPDATE_NEW_COMMIT=""

# 拉取最新代码
pull_code() {
    log "📥 检查并拉取最新代码..."

    if [ -n "$(git status --porcelain)" ]; then
        log "⚠️  检测到未提交的本地修改，自动提交保存..."
        git add -A
        git commit -m "auto: 保存更新前的本地修改 [$(date '+%Y-%m-%d %H:%M:%S')] [内部]"
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
        UPDATE_PREV_COMMIT="$before_commit"
        UPDATE_NEW_COMMIT="$after_commit"
    fi
}

# 显式生成更新公告：仅在有新提交时，根据 deploy.ps1 传入的确认（参数或环境变量）发布
# 参数 $1: 非空 = 已确认发布（--announce）；否则看环境变量 ANNOUNCE_CONFIRM
generate_announcement() {
    local announce_arg="${1:-}"

    if [ -z "$UPDATE_PREV_COMMIT" ] || [ -z "$UPDATE_NEW_COMMIT" ]; then
        return 0
    fi

    # 检查是否开启自动公告（默认开启）
    if [ "${AUTO_UPDATE_ANNOUNCEMENT:-true}" = "false" ] || [ "${AUTO_UPDATE_ANNOUNCEMENT:-true}" = "0" ]; then
        log "ℹ️  自动更新公告已关闭（AUTO_UPDATE_ANNOUNCEMENT），跳过"
        return 0
    fi

    if [ -z "$DOCKER_COMPOSE" ]; then
        log "⚠️  未找到 docker compose，跳过公告生成"
        return 0
    fi

    log "📢 检测到代码更新（$UPDATE_PREV_COMMIT → $UPDATE_NEW_COMMIT）"

    # 先展示本次更新涉及的用户可见提交，供确认
    echo ""
    echo "===== 本次更新的提交（过滤掉内部提交）====="
    git log --pretty=format:"%h %s" "${UPDATE_PREV_COMMIT}..${UPDATE_NEW_COMMIT}" --max-count=50 2>/dev/null | head -50
    echo ""
    echo "=============================================="

    # 是否发布公告由外部（deploy.ps1 本地交互确认后）通过【脚本参数 --announce】或【环境变量 ANNOUNCE_CONFIRM】传入
    # 两者任一为真即发布；值可为 yes / 1 / true / auto
    local confirm_val="${ANNOUNCE_CONFIRM:-<空>}"
    local arg_desc="参数=${announce_arg:+是}，ANNOUNCE_CONFIRM=${confirm_val}"
    if [ -n "$announce_arg" ] || [ "$ANNOUNCE_CONFIRM" = "yes" ] \
        || [ "$ANNOUNCE_CONFIRM" = "1" ] || [ "$ANNOUNCE_CONFIRM" = "true" ] \
        || [ "$ANNOUNCE_CONFIRM" = "auto" ]; then
        log "📢 已确认发布公告（$arg_desc）"
    else
        log "⏭️  未确认发布公告（$arg_desc），跳过"
        return 0
    fi

    # 容器内执行，复用 DATABASE_URL 与依赖；失败不影响部署
    # 脚本位于 /app/app/scripts/ 下，复用 ./backend/app 实时挂载，无需重建容器
    log "📢 正在发布更新公告..."
    if ! $DOCKER_COMPOSE exec -T novel-assistant \
        python /app/app/scripts/generate_update_announcement.py \
        --prev "$UPDATE_PREV_COMMIT" --new "$UPDATE_NEW_COMMIT" 2>&1 | tee -a "$LOG_FILE"; then
        log "⚠️  更新公告生成失败（不影响部署）"
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

    if ! command -v npm &>/dev/null; then
        error_exit "未找到 npm，请先安装 Node.js"
    fi

    cd frontend

    # 限制 Node 内存最大 1024MB（512MB 会导致大型构建 OOM 崩溃）
    export NODE_OPTIONS="--max-old-space-size=1024"

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

    # 执行构建（使用临时文件捕获完整输出，避免管道掩盖退出码）
    local build_output
    if ! build_output=$(npm run build 2>&1); then
        echo "$build_output" | tail -20 >> "$LOG_FILE"
        cd ..
        error_exit "前端构建失败（npm run build 退出码非零）"
    fi
    echo "$build_output" | tail -10 >> "$LOG_FILE"

    cd ..
    log "✅ 前端构建完成"
}

restart_service() {
    log "🔄 重启服务..."
    if [ -z "$DOCKER_COMPOSE" ]; then
        error_exit "未找到 docker compose 命令，请安装 Docker Compose"
    fi
    if ! $DOCKER_COMPOSE restart 2>&1 | tee -a "$LOG_FILE"; then
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

    # 支持 --announce：显式要求发布更新公告（由 deploy.ps1 本地确认后传入）
    local announce_requested=""
    for arg in "$@"; do
        case "$arg" in
            --announce) announce_requested="1" ;;
        esac
    done

    check_container
    pull_code
    fix_migration
    build_frontend
    generate_announcement "$announce_requested"
    restart_service
    verify_service

    log "=========================================="
    log "🎉 自动更新完成！"
    log "=========================================="
}

main "$@"
