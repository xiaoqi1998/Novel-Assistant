"""角色弧光管理API"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import json

from app.database import get_db
from app.models.character_arc import CharacterArc
from app.models.character import Character
from app.models.project import Project
from app.schemas.character_arc import (
    CharacterArcCreate,
    CharacterArcUpdate,
    CharacterArcResponse,
    CharacterArcListResponse,
    CharacterArcGenerateRequest,
)
from app.services.ai_service import AIService
from app.services.character_arc_service import CharacterArcService
from app.services.json_helper import loads_json
from app.logger import get_logger
from app.api.settings import get_user_ai_service
from app.api.common import verify_project_access

router = APIRouter(prefix="/character-arcs", tags=["角色弧光管理"])
logger = get_logger(__name__)


def get_current_user_id(request: Request) -> str:
    """获取当前登录用户ID"""
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    return user_id


async def _get_character_with_access(
    character_id: str, user_id: str, db: AsyncSession
) -> Character:
    """获取角色并验证项目访问权限"""
    char_result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = char_result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")
    await verify_project_access(character.project_id, user_id, db)
    return character


@router.post("", response_model=CharacterArcResponse, summary="创建角色弧光")
async def create_arc(
    arc_data: CharacterArcCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """手动创建角色弧光"""
    user_id = get_current_user_id(request)
    await _get_character_with_access(arc_data.character_id, user_id, db)

    arc = CharacterArc(
        project_id=arc_data.project_id,
        character_id=arc_data.character_id,
        arc_type=arc_data.arc_type,
        core_goal=arc_data.core_goal,
        motivation=arc_data.motivation,
        internal_conflict=arc_data.internal_conflict,
        external_goal=arc_data.external_goal,
        current_stage=arc_data.current_stage or "trigger",
        stage_progress=arc_data.stage_progress or 0,
        target_resolution_chapter=arc_data.target_resolution_chapter,
        status=arc_data.status or "active",
    )
    db.add(arc)
    await db.commit()
    await db.refresh(arc)
    logger.info(f"✅ 创建角色弧光: character_id={arc_data.character_id}, type={arc_data.arc_type}")
    return arc


@router.get("/character/{character_id}", response_model=CharacterArcListResponse, summary="获取角色的弧光列表")
async def get_character_arcs(
    character_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取指定角色的所有弧光（含已完成/已放弃）"""
    user_id = get_current_user_id(request)
    await _get_character_with_access(character_id, user_id, db)

    result = await db.execute(
        select(CharacterArc)
        .where(CharacterArc.character_id == character_id)
        .order_by(CharacterArc.updated_at.desc())
    )
    arcs = result.scalars().all()
    return CharacterArcListResponse(arcs=arcs, total=len(arcs))


@router.get("/project/{project_id}", response_model=CharacterArcListResponse, summary="获取项目的所有弧光")
async def get_project_arcs(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    status_filter: str = None,
):
    """获取项目下所有角色的弧光，可按状态过滤"""
    user_id = get_current_user_id(request)
    await verify_project_access(project_id, user_id, db)

    query = (
        select(CharacterArc)
        .where(CharacterArc.project_id == project_id)
    )
    if status_filter:
        query = query.where(CharacterArc.status == status_filter)
    query = query.order_by(CharacterArc.updated_at.desc())

    result = await db.execute(query)
    arcs = result.scalars().all()
    return CharacterArcListResponse(arcs=arcs, total=len(arcs))


@router.get("/{arc_id}", response_model=CharacterArcResponse, summary="获取弧光详情")
async def get_arc(
    arc_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取弧光详情"""
    user_id = get_current_user_id(request)
    result = await db.execute(
        select(CharacterArc).where(CharacterArc.id == arc_id)
    )
    arc = result.scalar_one_or_none()
    if not arc:
        raise HTTPException(status_code=404, detail="弧光不存在")
    await verify_project_access(arc.project_id, user_id, db)
    return arc


@router.put("/{arc_id}", response_model=CharacterArcResponse, summary="更新弧光")
async def update_arc(
    arc_id: str,
    arc_data: CharacterArcUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """更新弧光信息"""
    user_id = get_current_user_id(request)
    result = await db.execute(
        select(CharacterArc).where(CharacterArc.id == arc_id)
    )
    arc = result.scalar_one_or_none()
    if not arc:
        raise HTTPException(status_code=404, detail="弧光不存在")
    await verify_project_access(arc.project_id, user_id, db)

    update_fields = arc_data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(arc, field, value)

    await db.commit()
    await db.refresh(arc)
    logger.info(f"✏️ 更新弧光: {arc_id}")
    return arc


@router.delete("/{arc_id}", summary="删除弧光")
async def delete_arc(
    arc_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """删除弧光"""
    user_id = get_current_user_id(request)
    result = await db.execute(
        select(CharacterArc).where(CharacterArc.id == arc_id)
    )
    arc = result.scalar_one_or_none()
    if not arc:
        raise HTTPException(status_code=404, detail="弧光不存在")
    await verify_project_access(arc.project_id, user_id, db)

    await db.delete(arc)
    await db.commit()
    logger.info(f"🗑️ 删除弧光: {arc_id}")
    return {"detail": "弧光已删除"}


@router.post("/generate", response_model=CharacterArcResponse, summary="AI生成角色弧光")
async def generate_arc(
    request_data: CharacterArcGenerateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    """根据角色信息和项目上下文，AI生成角色弧光建议并保存。

    非流式接口：调用 AI 生成结构化弧光 JSON，解析后入库。
    """
    user_id = get_current_user_id(request)
    project = await verify_project_access(request_data.project_id, user_id, db)
    character = await _get_character_with_access(request_data.character_id, user_id, db)

    arc_service = CharacterArcService(user_ai_service)
    arc = await arc_service.generate_arc_for_character(
        character=character,
        project=project,
        db=db,
        hint=request_data.hint or ""
    )
    if not arc:
        raise HTTPException(status_code=500, detail="弧光生成失败")
    await db.commit()
    await db.refresh(arc)
    return arc
