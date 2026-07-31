#!/bin/bash
# 快速热更新部署脚本 - Docker Compose V1/V2 兼容版
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if docker compose version &>/dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "docker compose not found"
    exit 1
fi

if ! docker ps --filter name=novel-assistant --format '{{.Names}}' | grep -q novel-assistant; then
    echo "container not running: $DOCKER_COMPOSE up -d"
    exit 1
fi

TARGET="${1:-all}"

update_backend() {
    echo "restart backend..."
    $DOCKER_COMPOSE restart
    echo "backend done"
}

update_frontend() {
    echo "build frontend..."
    if command -v npm &>/dev/null; then
        (cd frontend && npm run build)
        echo "frontend done"
    else
        echo "no npm, skip frontend"
    fi
}

case "$TARGET" in
    backend)  update_backend ;;
    frontend) update_frontend ;;
    all)      update_frontend ; update_backend ;;
    *) echo "usage: $0 [backend|frontend|all]" ; exit 1 ;;
esac
echo "deploy ok"
