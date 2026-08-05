"""显式生成更新公告（由 auto-update.sh 在 git pull 之后触发）

用法：
    python /app/app/scripts/generate_update_announcement.py --prev <old_hash> --new <new_hash> [--force]

- --prev: 更新前的 commit hash
- --new:  更新后的 commit hash
- --force: 即使提交被过滤为空也生成一条公告（默认不生成）

本脚本通过 docker compose exec 在容器内运行，复用已配置的 DATABASE_URL 与公告库。
相比"容器启动时隐式生成"，触发时机更明确：只有 git pull 真的拉到新提交时才执行。

位置说明：脚本放在 backend/app/scripts/ 下，复用 ./backend/app:/app/app:ro 实时挂载，
git pull 后无需重建容器即可生效（避免依赖新增 volumes 挂载必须 up -d 的问题）。
"""
import argparse
import asyncio
import sys
from pathlib import Path

# 确保能 import app 包。
# 脚本位于 backend/app/scripts/ 下：
#   parents[0] = backend/app/scripts
#   parents[1] = backend/app   （app 包本身）
#   parents[2] = backend       （import app 需要 backend 在 path）
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


async def main() -> int:
    parser = argparse.ArgumentParser(description="显式生成更新公告")
    parser.add_argument("--prev", required=True, help="更新前的 commit hash")
    parser.add_argument("--new", required=True, help="更新后的 commit hash")
    parser.add_argument("--force", action="store_true", help="即使无可展示提交也生成公告")
    args = parser.parse_args()

    if not args.prev or not args.new:
        print("❌ 必须提供 --prev 与 --new")
        return 1

    from app.services.update_announcement_service import (
        generate_update_announcement_from_range,
    )

    try:
        ok = await generate_update_announcement_from_range(
            args.prev, args.new, force=args.force
        )
    except Exception as e:  # 公告失败绝不影响部署
        print(f"⚠️ 更新公告生成异常（不影响部署）: {e}")
        return 0

    if ok:
        print(f"✅ 已生成更新公告: {args.prev[:7]} → {args.new[:7]}")
    else:
        print("ℹ️  未生成公告（无面向用户的提交或已关闭）")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
