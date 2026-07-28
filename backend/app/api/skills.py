"""Skill 聊天 API

提供 Skill 列表查询和基于 Skill 的流式聊天功能。
用户选择一个 Skill 后，以该 Skill 的工作流指令作为系统提示词进行对话。

用户隔离说明：
- 系统预置 Skill 存磁盘，所有用户可见，仅管理员可改
- 普通用户编辑系统预置 → 创建个人副本（copy-on-write）写入 user_skills 表
- 普通用户可创建/编辑/删除自己的个人自建 Skill
- 用户 A 的编辑/自建不会影响用户 B
"""
from fastapi import APIRouter, Request, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List, Dict

from app.database import get_db
from app.user_manager import User
from app.api.settings import require_login, require_admin
from app.services.skill_loader import (
    get_all_skills_cached,
    get_all_skills_for_user,
    get_skill_by_trigger_for_user,
    get_skill_detail,
    get_skill_detail_for_user,
    create_skill_files,
    update_skill_files,
    delete_skill_files,
    refresh_skills_cache,
    create_user_skill,
    upsert_user_skill_override,
    update_user_custom_skill,
    delete_user_skill,
    reset_user_skill_to_system,
    _get_skill_body,
    _is_system_preset_key,
)
from app.services.ai_service import AIService, create_user_ai_service
from app.utils.sse_response import SSEResponse, create_sse_response, wrap_stream_with_heartbeat, HEARTBEAT
from app.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/api/skills", tags=["Skills"])


class SkillChatRequest(BaseModel):
    """Skill 聊天请求"""
    skill_key: str  # SKILL_STORY_LONG_WRITE 等
    message: str    # 用户消息
    history: Optional[List[dict]] = None  # 历史对话 [{"role": "user/assistant", "content": "..."}]


class SkillCreateRequest(BaseModel):
    """创建 Skill 请求"""
    name: str           # Skill 名称（英文，如 my-new-skill）
    display_name: str   # UI 显示名称
    category: str       # Skill 分类
    description: str    # Skill 描述
    triggers: List[str] # 触发词列表
    body: str           # 工作流指令（Markdown 正文）
    references: Optional[Dict[str, str]] = None  # 参考知识库 {"文件名": "内容"}
    writing_constraints: Optional[str] = None  # 辅助类 Skill 的创作约束


class SkillUpdateRequest(BaseModel):
    """更新 Skill 请求"""
    display_name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    triggers: Optional[List[str]] = None
    body: Optional[str] = None
    references: Optional[Dict[str, str]] = None
    writing_constraints: Optional[str] = None


def _skill_list_item(s: Dict, user: User) -> Dict:
    """构造列表返回项，附加权限标识"""
    is_system_default = bool(s.get("is_system_default", False))
    is_custom = bool(s.get("is_custom", False))
    is_admin = bool(getattr(user, "is_admin", False))

    # can_edit: 任何登录用户都可以"编辑"（普通用户编辑系统预置会创建副本）
    can_edit = True
    # can_delete: 只有管理员能删系统预置；个人副本/自建所有者可删
    if is_system_default:
        can_delete = is_admin
    else:
        can_delete = True
    # can_reset: 只有个人副本（非自建）可以重置回系统默认
    can_reset = (not is_system_default) and (not is_custom)

    return {
        "template_key": s.get("template_key", ""),
        "name": s.get("name", ""),
        "template_name": s.get("template_name", ""),
        "display_name": s.get("display_name", s.get("template_name", "")),
        "category": s.get("category", ""),
        "description": s.get("description", ""),
        "triggers": s.get("triggers", []),
        "is_system_default": is_system_default,
        "is_custom": is_custom,
        "can_edit": can_edit,
        "can_delete": can_delete,
        "can_reset": can_reset,
    }


@router.get("/list")
async def list_skills(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """获取当前用户可见的 Skill 列表（系统预置 + 个人 Skill，个人副本优先）"""
    skills = await get_all_skills_for_user(user.user_id, db)
    return [_skill_list_item(s, user) for s in skills]


@router.post("/match")
async def match_skill(
    request: Request,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """根据用户输入匹配最合适的 Skill（基于当前用户可见的 Skill 列表）"""
    body = await request.json()
    user_input = body.get("user_input", "")

    if not user_input:
        return {"matched": False}

    skill = await get_skill_by_trigger_for_user(user_input, user.user_id, db)
    if skill:
        return {
            "matched": True,
            "skill": {
                "template_key": skill["template_key"],
                "template_name": skill["template_name"],
                "category": skill["category"],
                "description": skill["description"],
            }
        }
    return {"matched": False}


@router.post("/chat")
async def skill_chat(
    request: SkillChatRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """
    基于 Skill 的流式聊天

    接收用户消息和 Skill 标识，以 Skill 内容作为系统提示词，
    通过用户的 AI 配置进行流式回复。
    """
    # 查找 Skill（用户视角）
    skills = await get_all_skills_for_user(user.user_id, db)
    skill = None
    for s in skills:
        if s["template_key"] == request.skill_key:
            skill = s
            break

    if not skill:
        async def error_gen():
            yield await SSEResponse.send_error(f"未找到 Skill: {request.skill_key}")
        return create_sse_response(error_gen())

    # 获取系统提示词（Skill 内容）
    system_prompt = skill["content"]

    # 构建完整提示词（将历史消息拼接到提示词中）
    history_text = ""
    if request.history:
        for msg in request.history[-20:]:
            role_label = "用户" if msg.get("role") == "user" else "助手"
            history_text += f"\n{role_label}: {msg.get('content', '')}"

    full_prompt = request.message
    if history_text:
        full_prompt = f"以下是之前的对话历史：{history_text}\n\n用户最新消息: {request.message}"

    # 获取用户 AI 配置
    from app.api.settings import get_user_ai_service
    try:
        ai_service = await get_user_ai_service(user=user, db=db)
        # 覆盖系统提示词为 Skill 内容
        ai_service.default_system_prompt = system_prompt
    except Exception as e:
        logger.error(f"创建 AI 服务失败: {e}")
        async def error_gen():
            yield await SSEResponse.send_error(f"AI 服务配置错误: {str(e)}")
        return create_sse_response(error_gen())

    # 流式生成
    async def generate():
        try:
            yield await SSEResponse.send_progress(f"正在使用 {skill['template_name']}...", 10)

            stream = ai_service.generate_text_stream(
                prompt=full_prompt,
                system_prompt=system_prompt,
                auto_mcp=False,  # Skill 聊天不使用 MCP 工具
            )

            async for item in wrap_stream_with_heartbeat(stream, heartbeat_interval=15.0):
                if item is HEARTBEAT:
                    yield await SSEResponse.send_heartbeat()
                    continue
                yield await SSEResponse.send_chunk(item)

            yield await SSEResponse.send_progress("回复完成", 100, "success")
            yield await SSEResponse.send_done()

        except Exception as e:
            logger.error(f"Skill 聊天生成失败: {e}")
            yield await SSEResponse.send_error(f"生成失败: {str(e)}")

    return create_sse_response(generate())


# ==================== Skill 管理 CRUD API ====================

@router.get("/detail/{skill_key:path}")
async def get_skill_detail_api(
    skill_key: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """获取 Skill 详细信息（包括原始内容和 references，按用户视角）"""
    detail = await get_skill_detail_for_user(skill_key, user.user_id, db)
    if not detail:
        raise HTTPException(status_code=404, detail=f"未找到 Skill: {skill_key}")

    return {
        "template_key": detail["template_key"],
        "name": detail.get("name", ""),
        "template_name": detail["template_name"],
        "display_name": detail.get("display_name", detail["template_name"]),
        "category": detail["category"],
        "description": detail["description"],
        "triggers": detail.get("triggers", []),
        "body": _get_skill_body(detail.get("raw_content", "")) if detail.get("raw_content") else detail.get("body", ""),
        "raw_content": detail.get("raw_content", ""),
        "standalone_references": detail.get("standalone_references", {}),
        "is_system_default": bool(detail.get("is_system_default", False)),
        "is_custom": bool(detail.get("is_custom", False)),
        "skill_type": detail.get("skill_type", ""),
        "writing_constraints": detail.get("writing_constraints", ""),
    }


@router.post("/create")
async def create_skill(
    request: SkillCreateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """创建新 Skill

    分支逻辑：
    - 管理员 + 系统预置名段（不与现有系统预置冲突）→ 写磁盘 create_skill_files
    - 普通用户 / 管理员创建个人 Skill → 写 DB create_user_skill
    """
    try:
        # 名称规范化后判断是否会与系统预置冲突
        import re
        normalized_name = request.name.strip().lower().replace("_", "-").replace(" ", "-")
        normalized_name = re.sub(r'[^a-z0-9\-]', '', normalized_name)
        from app.services.skill_loader import _template_key
        normalized_key = _template_key(normalized_name)

        is_admin = bool(getattr(user, "is_admin", False))

        # 管理员且名称不与系统预置冲突 → 写磁盘（创建新的系统预置）
        # 普通用户或名称与系统预置冲突 → 写 DB 个人 Skill
        if is_admin and not _is_system_preset_key(normalized_key):
            result = create_skill_files(
                name=request.name,
                display_name=request.display_name,
                category=request.category,
                description=request.description,
                triggers=request.triggers,
                body=request.body,
                references=request.references,
            )
            return {"success": True, "skill": result, "storage": "disk"}
        else:
            result = await create_user_skill(
                user_id=user.user_id,
                db=db,
                name=request.name,
                display_name=request.display_name,
                category=request.category,
                description=request.description,
                triggers=request.triggers,
                body=request.body,
                references=request.references,
                writing_constraints=request.writing_constraints,
            )
            return {"success": True, "skill": result, "storage": "user_db"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"创建 Skill 失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建失败: {str(e)}")


@router.put("/update/{skill_key:path}")
async def update_skill(
    skill_key: str,
    request: SkillUpdateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """更新 Skill

    分支逻辑：
    - 管理员 + 系统预置 → 写磁盘 update_skill_files
    - 普通用户 + 系统预置 → 创建/更新个人副本 upsert_user_skill_override
    - 个人自建 Skill → update_user_custom_skill
    - 个人副本 Skill → upsert_user_skill_override（覆盖更新）
    """
    try:
        is_admin = bool(getattr(user, "is_admin", False))
        is_system = _is_system_preset_key(skill_key)

        # 判断用户是否已有该 skill 的个人记录
        from sqlalchemy import select
        from app.models.user_skill import UserSkill
        existing_result = await db.execute(
            select(UserSkill).where(
                UserSkill.user_id == user.user_id,
                UserSkill.skill_key == skill_key,
            )
        )
        existing_user_skill = existing_result.scalar_one_or_none()

        if is_system and is_admin and not existing_user_skill:
            # 管理员直接改系统预置（写磁盘）
            result = update_skill_files(
                skill_key=skill_key,
                display_name=request.display_name,
                category=request.category,
                description=request.description,
                triggers=request.triggers,
                body=request.body,
                references=request.references,
            )
            return {"success": True, "skill": result, "storage": "disk"}
        elif is_system and not is_admin and not existing_user_skill:
            # 普通用户编辑系统预置 → 创建个人副本
            result = await upsert_user_skill_override(
                user_id=user.user_id,
                skill_key=skill_key,
                db=db,
                description=request.description,
                body=request.body,
                references=request.references,
                display_name=request.display_name,
                category=request.category,
                triggers=request.triggers,
                writing_constraints=request.writing_constraints,
            )
            return {"success": True, "skill": result, "storage": "user_override"}
        elif existing_user_skill:
            # 用户已有个人记录（副本或自建）
            if existing_user_skill.is_custom:
                result = await update_user_custom_skill(
                    user_id=user.user_id,
                    skill_key=skill_key,
                    db=db,
                    description=request.description,
                    body=request.body,
                    references=request.references,
                    display_name=request.display_name,
                    category=request.category,
                    triggers=request.triggers,
                    writing_constraints=request.writing_constraints,
                )
                return {"success": True, "skill": result, "storage": "user_custom"}
            else:
                # 个人副本更新
                result = await upsert_user_skill_override(
                    user_id=user.user_id,
                    skill_key=skill_key,
                    db=db,
                    description=request.description,
                    body=request.body,
                    references=request.references,
                    display_name=request.display_name,
                    category=request.category,
                    triggers=request.triggers,
                    writing_constraints=request.writing_constraints,
                )
                return {"success": True, "skill": result, "storage": "user_override"}
        else:
            # 既不是系统预置，用户也没有个人记录 → 不存在
            raise ValueError(f"未找到 Skill: {skill_key}")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"更新 Skill 失败: {e}")
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")


@router.delete("/delete/{skill_key:path}")
async def delete_skill(
    skill_key: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """删除 Skill

    分支逻辑：
    - 管理员 + 系统预置 → 删磁盘 delete_skill_files
    - 普通用户 + 系统预置（无个人副本） → 403 拒绝（提示用 reset）
    - 个人副本 / 自建 → delete_user_skill
    """
    try:
        is_admin = bool(getattr(user, "is_admin", False))
        is_system = _is_system_preset_key(skill_key)

        from sqlalchemy import select
        from app.models.user_skill import UserSkill
        existing_result = await db.execute(
            select(UserSkill).where(
                UserSkill.user_id == user.user_id,
                UserSkill.skill_key == skill_key,
            )
        )
        existing_user_skill = existing_result.scalar_one_or_none()

        if is_system and is_admin and not existing_user_skill:
            # 管理员删系统预置
            delete_skill_files(skill_key)
            return {"success": True, "message": f"已删除系统预置 Skill: {skill_key}", "storage": "disk"}
        elif is_system and not is_admin and not existing_user_skill:
            # 普通用户不能删系统预置
            raise ValueError("系统预置 Skill 不可删除，如需恢复原版请使用「重置」功能")
        elif existing_user_skill:
            # 删除个人副本或自建
            await delete_user_skill(user.user_id, skill_key, db)
            label = "个人自建" if existing_user_skill.is_custom else "个人副本"
            return {"success": True, "message": f"已删除{label} Skill: {skill_key}", "storage": "user_db"}
        else:
            raise ValueError(f"未找到 Skill: {skill_key}")
    except ValueError as e:
        # 区分 403（权限）和 404（不存在）
        msg = str(e)
        if "不可删除" in msg:
            raise HTTPException(status_code=403, detail=msg)
        raise HTTPException(status_code=404, detail=msg)
    except Exception as e:
        logger.error(f"删除 Skill 失败: {e}")
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.post("/reset/{skill_key:path}")
async def reset_skill(
    skill_key: str,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """重置 Skill：删除用户个人副本，回退到系统预置

    仅对个人副本（is_custom=False）有效；自建 Skill 不可重置。
    """
    try:
        await reset_user_skill_to_system(user.user_id, skill_key, db)
        return {"success": True, "message": f"已重置 Skill: {skill_key}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"重置 Skill 失败: {e}")
        raise HTTPException(status_code=500, detail=f"重置失败: {str(e)}")


@router.post("/refresh-cache")
async def refresh_cache(user: User = Depends(require_admin)):
    """手动刷新系统预置 Skill 缓存（仅管理员）"""
    skills = refresh_skills_cache()
    return {"success": True, "count": len(skills)}
