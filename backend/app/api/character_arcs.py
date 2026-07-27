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

    # 构建角色摘要
    char_summary_parts = [f"姓名：{character.name}"]
    if character.role_type:
        role_map = {"protagonist": "主角", "antagonist": "反派", "supporting": "配角"}
        char_summary_parts.append(f"角色定位：{role_map.get(character.role_type, character.role_type)}")
    if character.personality:
        char_summary_parts.append(f"性格：{character.personality[:300]}")
    if character.background:
        char_summary_parts.append(f"背景：{character.background[:300]}")
    if character.current_state:
        char_summary_parts.append(f"当前心理/处境：{character.current_state[:200]}")
    char_summary = "\n".join(char_summary_parts)

    # 构建项目摘要
    project_summary_parts = []
    if project.title:
        project_summary_parts.append(f"书名：{project.title}")
    if project.genre:
        project_summary_parts.append(f"类型：{project.genre}")
    if project.theme:
        project_summary_parts.append(f"主题：{project.theme}")
    if getattr(project, 'world_rules', None):
        project_summary_parts.append(f"世界规则：{project.world_rules[:300]}")
    project_summary = "\n".join(project_summary_parts)

    hint_text = f"\n用户补充要求：{request_data.hint}" if request_data.hint else ""

    prompt = f"""你是资深网文编辑，请为以下角色设计一条有深度的成长弧光。

【项目信息】
{project_summary}

【角色信息】
{char_summary}{hint_text}

请输出严格的 JSON（不要包裹在 markdown 代码块中，不要有任何额外文字），结构如下：
{{
  "arc_type": "growth|fall|redemption|awakening|sacrifice",
  "core_goal": "角色在整个弧光中追求的核心目标（一句话，具体可执行）",
  "motivation": "为什么追求这个目标（内在驱动力，50-100字）",
  "internal_conflict": "阻碍角色达成目标的心理矛盾（50-100字）",
  "external_goal": "近期外在目标（本章/近几章可推进的小目标）",
  "current_stage": "trigger",
  "stage_progress": 0,
  "target_resolution_chapter": null
}}

设计原则：
1. 弧光类型要与角色定位匹配（主角适合 growth/redemption，反派适合 fall/awakening）
2. 核心目标要具体，避免"变强""复仇"等空泛表述，要有明确的方向
3. 内在冲突要真实，是角色性格中真实的矛盾，不是外部强加的
4. 动机要深刻，与角色的背景故事和创伤相关
5. 近期目标要可执行，能在接下来几章中推进"""

    try:
        gen_response = await user_ai_service.generate_text(
            prompt=prompt,
            temperature=0.7,
        )
    except Exception as e:
        logger.error(f"弧光生成 AI 调用失败: {e}")
        raise HTTPException(status_code=500, detail=f"弧光生成失败: {str(e)}")

    content = gen_response.get("content", "") if isinstance(gen_response, dict) else str(gen_response)
    content = content.strip()

    # 清理可能的 markdown 代码块包裹
    if content.startswith("```"):
        lines = content.split("\n")
        # 去掉首尾的 ``` 行
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()

    try:
        arc_json = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"弧光生成 JSON 解析失败: {e}, content={content[:200]}")
        raise HTTPException(status_code=500, detail="弧光生成结果解析失败")

    # 创建弧光记录
    arc = CharacterArc(
        project_id=request_data.project_id,
        character_id=request_data.character_id,
        arc_type=arc_json.get("arc_type", "growth"),
        core_goal=arc_json.get("core_goal", "未设定"),
        motivation=arc_json.get("motivation"),
        internal_conflict=arc_json.get("internal_conflict"),
        external_goal=arc_json.get("external_goal"),
        current_stage=arc_json.get("current_stage", "trigger"),
        stage_progress=arc_json.get("stage_progress", 0),
        target_resolution_chapter=arc_json.get("target_resolution_chapter"),
        status="active",
    )
    db.add(arc)
    await db.commit()
    await db.refresh(arc)
    logger.info(f"✅ AI生成角色弧光: character_id={request_data.character_id}, type={arc.arc_type}")
    return arc
