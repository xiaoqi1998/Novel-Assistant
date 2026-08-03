"""天命状态管理API - 物品/秘密/誓约/位置/快照的CRUD"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from sqlalchemy.exc import OperationalError, DatabaseError
from pydantic import BaseModel
from typing import Optional, List, Any
import uuid

from app.database import get_db
from app.models.item import Item
from app.models.secret import Secret
from app.models.vow import Vow
from app.models.character_location import CharacterLocation
from app.models.chapter_snapshot import ChapterSnapshot
from app.api.common import verify_project_access
from app.logger import get_logger

router = APIRouter(prefix="/tianming", tags=["天命状态管理"])
logger = get_logger(__name__)


def get_current_user_id(request: Request) -> str:
    """获取当前登录用户ID"""
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    return user_id


async def _verify_project(project_id: str, user_id: str, db: AsyncSession):
    """验证项目访问权限"""
    await verify_project_access(project_id, user_id, db)


async def _rebuild_latest_snapshot(
    db: AsyncSession, project_id: str, max_retries: int = 3
) -> None:
    """修改天命状态后重建最新快照的15维数据（工程化 best-effort）

    工程化要点：
    1. 重试机制：瞬时数据库故障自动重试（指数退避 0.3s/0.6s/1.2s）
    2. 事务隔离：每次重试独立事务，失败自动回滚，避免脏数据残留
    3. 错误分类：数据库瞬时错误(OperationalError/DatabaseError)可重试；
       业务/逻辑错误立即放弃，不浪费重试次数
    4. 幂等：重建基于当前状态聚合，重试不产生副作用
    5. best-effort：最终失败不影响主业务，仅记录告警（不抛出）
    """
    from app.services.snapshot_service import SnapshotService

    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            await SnapshotService.rebuild_latest_snapshot_data(db, project_id)
            await db.commit()
            if attempt > 1:
                logger.info(f"✅ 重建最新快照成功（第{attempt}次尝试）")
            return
        except (OperationalError, DatabaseError) as e:
            # 可重试的数据库瞬时故障（连接断开、死锁、锁等待超时等）
            last_error = e
            await db.rollback()
            if attempt < max_retries:
                wait = 0.3 * (2 ** (attempt - 1))  # 指数退避: 0.3s, 0.6s, 1.2s
                logger.warning(
                    f"⚠️ 重建最新快照失败（尝试{attempt}/{max_retries}），"
                    f"{wait:.1f}s后重试: {type(e).__name__}: {e}"
                )
                await asyncio.sleep(wait)
                continue
            logger.error(f"❌ 重建最新快照重试{max_retries}次仍失败: {e}")
        except Exception as e:
            # 不可重试的业务/逻辑错误，立即放弃，不浪费重试次数
            await db.rollback()
            logger.warning(
                f"重建最新快照遇到不可重试错误（不影响主操作）: "
                f"{type(e).__name__}: {e}"
            )
            return

    # 所有重试均失败（best-effort，不抛出）
    if last_error:
        logger.error(
            f"❌ 重建最新快照在{max_retries}次重试后仍失败（不影响主操作）: {last_error}"
        )


# ==================== 物品管理 ====================

class ItemCreate(BaseModel):
    name: str
    description: str
    item_type: str = "other"
    rarity: str = "common"
    current_holder_id: Optional[str] = None
    current_holder_name: Optional[str] = None
    status: str = "active"
    abilities: Optional[List[Any]] = None
    origin: Optional[str] = None
    appearance: Optional[str] = None
    tags: Optional[List[str]] = None
    importance: float = 0.5
    notes: Optional[str] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    item_type: Optional[str] = None
    rarity: Optional[str] = None
    current_holder_id: Optional[str] = None
    current_holder_name: Optional[str] = None
    status: Optional[str] = None
    abilities: Optional[List[Any]] = None
    origin: Optional[str] = None
    appearance: Optional[str] = None
    tags: Optional[List[str]] = None
    importance: Optional[float] = None
    notes: Optional[str] = None


@router.get("/projects/{project_id}/items", summary="获取物品列表")
async def list_items(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(Item).where(Item.project_id == project_id).order_by(Item.created_at.desc())
    )
    items = result.scalars().all()
    return [item.to_dict() for item in items]


@router.post("/projects/{project_id}/items", summary="创建物品")
async def create_item(project_id: str, item_data: ItemCreate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    item = Item(
        project_id=project_id,
        name=item_data.name,
        description=item_data.description,
        item_type=item_data.item_type,
        rarity=item_data.rarity,
        current_holder_id=item_data.current_holder_id,
        current_holder_name=item_data.current_holder_name,
        status=item_data.status,
        abilities=item_data.abilities,
        origin=item_data.origin,
        appearance=item_data.appearance,
        tags=item_data.tags,
        importance=item_data.importance,
        notes=item_data.notes,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    logger.info(f"✅ 创建物品: {item.name}")
    await _rebuild_latest_snapshot(db, item.project_id)
    return item.to_dict()


@router.put("/items/{item_id}", summary="更新物品")
async def update_item(item_id: str, item_data: ItemUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="物品不存在")
    await _verify_project(item.project_id, user_id, db)
    update_data = item_data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    await _rebuild_latest_snapshot(db, item.project_id)
    return item.to_dict()


@router.delete("/items/{item_id}", summary="删除物品")
async def delete_item(item_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="物品不存在")
    await _verify_project(item.project_id, user_id, db)
    await db.delete(item)
    await db.commit()
    await _rebuild_latest_snapshot(db, item.project_id)
    return {"message": "已删除"}


# ==================== 秘密管理 ====================

class SecretCreate(BaseModel):
    title: str
    content: str
    secret_type: str = "other"
    status: str = "hidden"
    knowers: Optional[List[Any]] = None
    related_characters: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    importance: float = 0.5
    notes: Optional[str] = None


class SecretUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    secret_type: Optional[str] = None
    status: Optional[str] = None
    knowers: Optional[List[Any]] = None
    related_characters: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    importance: Optional[float] = None
    notes: Optional[str] = None


@router.get("/projects/{project_id}/secrets", summary="获取秘密列表")
async def list_secrets(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(Secret).where(Secret.project_id == project_id).order_by(Secret.created_at.desc())
    )
    secrets = result.scalars().all()
    return [s.to_dict() for s in secrets]


@router.post("/projects/{project_id}/secrets", summary="创建秘密")
async def create_secret(project_id: str, secret_data: SecretCreate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    secret = Secret(
        project_id=project_id,
        title=secret_data.title,
        content=secret_data.content,
        secret_type=secret_data.secret_type,
        status=secret_data.status,
        knowers=secret_data.knowers,
        related_characters=secret_data.related_characters,
        tags=secret_data.tags,
        importance=secret_data.importance,
        notes=secret_data.notes,
    )
    db.add(secret)
    await db.commit()
    await db.refresh(secret)
    logger.info(f"✅ 创建秘密: {secret.title}")
    await _rebuild_latest_snapshot(db, secret.project_id)
    return secret.to_dict()


@router.put("/secrets/{secret_id}", summary="更新秘密")
async def update_secret(secret_id: str, secret_data: SecretUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    result = await db.execute(select(Secret).where(Secret.id == secret_id))
    secret = result.scalar_one_or_none()
    if not secret:
        raise HTTPException(status_code=404, detail="秘密不存在")
    await _verify_project(secret.project_id, user_id, db)
    update_data = secret_data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(secret, k, v)
    await db.commit()
    await db.refresh(secret)
    await _rebuild_latest_snapshot(db, secret.project_id)
    return secret.to_dict()


@router.delete("/secrets/{secret_id}", summary="删除秘密")
async def delete_secret(secret_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    result = await db.execute(select(Secret).where(Secret.id == secret_id))
    secret = result.scalar_one_or_none()
    if not secret:
        raise HTTPException(status_code=404, detail="秘密不存在")
    await _verify_project(secret.project_id, user_id, db)
    await db.delete(secret)
    await db.commit()
    await _rebuild_latest_snapshot(db, secret.project_id)
    return {"message": "已删除"}


# ==================== 誓约管理 ====================

class VowCreate(BaseModel):
    title: str
    content: str
    vow_type: str = "oath"
    status: str = "active"
    participants: Optional[List[Any]] = None
    conditions: Optional[List[Any]] = None
    breach_consequences: Optional[str] = None
    deadline_chapter: Optional[int] = None
    related_characters: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    importance: float = 0.5
    notes: Optional[str] = None


class VowUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    vow_type: Optional[str] = None
    status: Optional[str] = None
    participants: Optional[List[Any]] = None
    conditions: Optional[List[Any]] = None
    breach_consequences: Optional[str] = None
    deadline_chapter: Optional[int] = None
    related_characters: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    importance: Optional[float] = None
    notes: Optional[str] = None


@router.get("/projects/{project_id}/vows", summary="获取誓约列表")
async def list_vows(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(Vow).where(Vow.project_id == project_id).order_by(Vow.created_at.desc())
    )
    vows = result.scalars().all()
    return [v.to_dict() for v in vows]


@router.post("/projects/{project_id}/vows", summary="创建誓约")
async def create_vow(project_id: str, vow_data: VowCreate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    vow = Vow(
        project_id=project_id,
        title=vow_data.title,
        content=vow_data.content,
        vow_type=vow_data.vow_type,
        status=vow_data.status,
        participants=vow_data.participants,
        conditions=vow_data.conditions,
        breach_consequences=vow_data.breach_consequences,
        deadline_chapter=vow_data.deadline_chapter,
        related_characters=vow_data.related_characters,
        tags=vow_data.tags,
        importance=vow_data.importance,
        notes=vow_data.notes,
    )
    db.add(vow)
    await db.commit()
    await db.refresh(vow)
    logger.info(f"✅ 创建誓约: {vow.title}")
    await _rebuild_latest_snapshot(db, vow.project_id)
    return vow.to_dict()


@router.put("/vows/{vow_id}", summary="更新誓约")
async def update_vow(vow_id: str, vow_data: VowUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    result = await db.execute(select(Vow).where(Vow.id == vow_id))
    vow = result.scalar_one_or_none()
    if not vow:
        raise HTTPException(status_code=404, detail="誓约不存在")
    await _verify_project(vow.project_id, user_id, db)
    update_data = vow_data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(vow, k, v)
    await db.commit()
    await db.refresh(vow)
    await _rebuild_latest_snapshot(db, vow.project_id)
    return vow.to_dict()


@router.delete("/vows/{vow_id}", summary="删除誓约")
async def delete_vow(vow_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    result = await db.execute(select(Vow).where(Vow.id == vow_id))
    vow = result.scalar_one_or_none()
    if not vow:
        raise HTTPException(status_code=404, detail="誓约不存在")
    await _verify_project(vow.project_id, user_id, db)
    await db.delete(vow)
    await db.commit()
    await _rebuild_latest_snapshot(db, vow.project_id)
    return {"message": "已删除"}


# ==================== 角色位置管理 ====================

@router.get("/projects/{project_id}/locations", summary="获取角色位置列表")
async def list_locations(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(CharacterLocation).where(
            and_(
                CharacterLocation.project_id == project_id,
                CharacterLocation.is_current == True
            )
        ).order_by(CharacterLocation.created_at.desc())
    )
    locations = result.scalars().all()
    return [loc.to_dict() for loc in locations]


@router.get("/projects/{project_id}/locations/history/{character_id}", summary="获取角色位置历史")
async def get_location_history(project_id: str, character_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(CharacterLocation).where(
            and_(
                CharacterLocation.project_id == project_id,
                CharacterLocation.character_id == character_id
            )
        ).order_by(CharacterLocation.created_at.desc())
    )
    locations = result.scalars().all()
    return [loc.to_dict() for loc in locations]


# ==================== 章节快照查询 ====================

@router.get("/projects/{project_id}/snapshots/latest", summary="获取最新快照")
async def get_latest_snapshot(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """获取项目最新章节快照（15维事实快照）"""
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(ChapterSnapshot).where(
            and_(
                ChapterSnapshot.project_id == project_id,
                ChapterSnapshot.is_latest == True
            )
        ).order_by(ChapterSnapshot.chapter_number.desc()).limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        return {"message": "暂无快照", "snapshot": None}
    return snapshot.to_dict()


@router.get("/projects/{project_id}/snapshots", summary="获取快照列表")
async def list_snapshots(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """获取项目所有章节快照列表"""
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)
    result = await db.execute(
        select(ChapterSnapshot).where(
            ChapterSnapshot.project_id == project_id
        ).order_by(ChapterSnapshot.chapter_number.desc())
    )
    snapshots = result.scalars().all()
    return [{
        "id": s.id,
        "chapter_id": s.chapter_id,
        "chapter_number": s.chapter_number,
        "validation_status": s.validation_status,
        "needs_revision": s.needs_revision,
        "source": s.source,
        "is_latest": s.is_latest,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    } for s in snapshots]


@router.get("/snapshots/{snapshot_id}", summary="获取快照详情")
async def get_snapshot_detail(snapshot_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """获取指定快照的完整详情（含15维快照数据与12类CHANGES）"""
    user_id = get_current_user_id(request)
    result = await db.execute(select(ChapterSnapshot).where(ChapterSnapshot.id == snapshot_id))
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="快照不存在")
    await _verify_project(snapshot.project_id, user_id, db)
    return snapshot.to_dict()


# ==================== 角色维度反查 ====================

@router.get("/projects/{project_id}/characters/{character_id}/state", summary="获取角色天命状态聚合")
async def get_character_tianming_state(
    project_id: str, character_id: str,
    request: Request, db: AsyncSession = Depends(get_db)
):
    """聚合查询指定角色的天命状态：位置历史、持有物品、知情秘密、参与誓约。

    用于角色详情页面的「天命状态」面板联动展示。
    """
    user_id = get_current_user_id(request)
    await _verify_project(project_id, user_id, db)

    # 验证 character_id 确实属于该 project_id，防止越权查询
    from app.models.character import Character
    char_result = await db.execute(
        select(Character.id).where(
            and_(Character.id == character_id, Character.project_id == project_id)
        )
    )
    if not char_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="角色不存在或不属于该项目")

    # 位置历史（按到达章节倒序）
    loc_result = await db.execute(
        select(CharacterLocation)
        .where(and_(CharacterLocation.project_id == project_id,
                    CharacterLocation.character_id == character_id))
        .order_by(CharacterLocation.arrival_chapter_number.desc().nullslast())
    )
    locations = [loc.to_dict() for loc in loc_result.scalars().all()]

    # 持有物品（按重要性倒序）
    items_result = await db.execute(
        select(Item)
        .where(and_(Item.project_id == project_id,
                    Item.current_holder_id == character_id))
        .order_by(Item.importance.desc().nullslast())
    )
    items = [item.to_dict() for item in items_result.scalars().all()]

    # 知情秘密（knowers 数组中含 character_id）
    # SQLite/PG JSON 查询兼容性较差，这里先用 Python 过滤
    secrets_result = await db.execute(
        select(Secret).where(Secret.project_id == project_id)
    )
    all_secrets = secrets_result.scalars().all()
    secrets = []
    for s in all_secrets:
        knowers = s.knowers or []
        if any((k.get("character_id") if isinstance(k, dict) else None) == character_id
               for k in knowers):
            secrets.append(s.to_dict())

    # 参与誓约（participants 数组中含 character_id）
    vows_result = await db.execute(
        select(Vow).where(Vow.project_id == project_id)
    )
    all_vows = vows_result.scalars().all()
    vows = []
    for v in all_vows:
        participants = v.participants or []
        if any((p.get("character_id") if isinstance(p, dict) else None) == character_id
               for p in participants):
            vows.append(v.to_dict())

    return {
        "character_id": character_id,
        "project_id": project_id,
        "locations": locations,
        "items": items,
        "secrets": secrets,
        "vows": vows,
    }
