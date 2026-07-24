"""从云端提示词工坊拉取所有提示词并导入本地数据库"""
import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from app.config import settings, INSTANCE_ID
from app.database import Base, get_engine
from app.models.prompt_workshop import PromptWorkshopItem
from sqlalchemy import select

CLOUD_URL = settings.WORKSHOP_CLOUD_URL
TIMEOUT = 60


async def fetch_all_items() -> list:
    """从云端分页拉取所有提示词"""
    all_items = []
    page = 1
    limit = 100
    # 添加虚拟用户标识以通过认证
    headers = {
        "X-Instance-ID": INSTANCE_ID,
        "X-User-ID": f"{INSTANCE_ID}:system",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=TIMEOUT, verify=False) as client:
        while True:
            url = f"{CLOUD_URL}/api/prompt-workshop/items"
            params = {"sort": "newest", "page": page, "limit": limit}
            print(f"正在拉取第 {page} 页...")
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            # API 返回格式: {"success": true, "data": {"total": N, "items": [...]}}
            resp_data = data.get("data", data)
            items = resp_data.get("items", [])
            if not items:
                break
            all_items.extend(items)
            print(f"  获取 {len(items)} 条，累计 {len(all_items)} 条")

            total = resp_data.get("total", 0)
            if len(all_items) >= total:
                break
            page += 1

    return all_items


async def import_to_local(items: list):
    """导入到本地数据库"""
    # 使用虚拟用户ID获取引擎（PostgreSQL模式下所有用户共享同一个引擎）
    engine = await get_engine("system")
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # 查询本地已有的 ID
        result = await db.execute(select(PromptWorkshopItem.id))
        existing_ids = set(row[0] for row in result.all())

        new_count = 0
        skip_count = 0
        for item in items:
            item_id = item.get("id")
            if item_id in existing_ids:
                skip_count += 1
                continue

            record = PromptWorkshopItem(
                id=item_id,
                name=item.get("name", ""),
                description=item.get("description", ""),
                prompt_content=item.get("prompt_content", ""),
                category=item.get("category", "general"),
                tags=item.get("tags"),
                author_id=item.get("author_id"),
                author_name=item.get("author_name"),
                source_instance=item.get("source_instance"),
                is_official=item.get("is_official", False),
                download_count=item.get("download_count", 0),
                like_count=item.get("like_count", 0),
                status=item.get("status", "active"),
            )
            db.add(record)
            new_count += 1

        await db.commit()
        print(f"\n导入完成: 新增 {new_count} 条，跳过(已存在) {skip_count} 条")


async def main():
    print(f"云端地址: {CLOUD_URL}")
    print(f"实例ID: {INSTANCE_ID}")
    print("=" * 50)

    items = await fetch_all_items()
    print(f"\n共拉取 {len(items)} 条提示词")

    # 同时导出 JSON 备份
    backup_path = "/app/workshop_export.json"
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"JSON 备份已保存: {backup_path}")

    await import_to_local(items)


if __name__ == "__main__":
    asyncio.run(main())
