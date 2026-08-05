"""意见反馈 API

- 登录用户可通过 POST /api/feedbacks 提交意见反馈
- 管理员可通过 /api/feedbacks/admin/* 查看、标记采纳/不采纳、解决/未解决、回复、删除
"""
from datetime import datetime
from typing import Optional, AsyncGenerator
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_engine
from app.models.feedback import Feedback
from app.logger import get_logger

router = APIRouter(prefix="/feedbacks", tags=["意见反馈"])
logger = get_logger(__name__)

# 与公告共用全局库（不依赖用户登录态的独立数据库）
GLOBAL_DB_KEY = "_announcements_"

ADOPTION_STATUSES = {"pending", "adopted", "rejected"}
RESOLVE_STATUSES = {"unresolved", "resolved"}


async def get_global_db() -> AsyncGenerator[AsyncSession, None]:
    """获取不依赖登录态的全局数据库会话"""
    engine = await get_engine(GLOBAL_DB_KEY)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        try:
            yield session
            if session.in_transaction():
                await session.rollback()
        except Exception:
            if session.in_transaction():
                await session.rollback()
            raise


def check_admin(request: Request) -> None:
    """校验管理员权限"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    if not getattr(request.state, "is_admin", False):
        raise HTTPException(status_code=403, detail="需要管理员权限")


def _feedback_to_dict(item: Feedback) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "username": item.username,
        "display_name": item.display_name,
        "content": item.content,
        "contact": item.contact,
        "page": item.page,
        "adoption_status": item.adoption_status,
        "resolve_status": item.resolve_status,
        "admin_reply": item.admin_reply,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


# ============ 请求模型 ============

class FeedbackCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000, description="反馈内容")
    contact: Optional[str] = Field(None, max_length=200, description="联系方式（可选）")
    page: Optional[str] = Field(None, max_length=200, description="提交时所在页面")


class FeedbackAdminUpdate(BaseModel):
    adoption_status: Optional[str] = None
    resolve_status: Optional[str] = None
    admin_reply: Optional[str] = Field(None, max_length=2000)


# ============ 用户侧接口 ============

@router.post("", summary="提交意见反馈")
async def create_feedback(
    data: FeedbackCreate,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """登录用户提交意见反馈"""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="反馈内容不能为空")

    user = getattr(request.state, "user", None)
    feedback = Feedback(
        id=str(uuid.uuid4()),
        user_id=user_id,
        username=getattr(user, "username", None),
        display_name=getattr(user, "display_name", None),
        content=content,
        contact=(data.contact or "").strip() or None,
        page=(data.page or "").strip() or None,
        adoption_status="pending",
        resolve_status="unresolved",
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    logger.info(f"用户提交意见反馈: user_id={user_id}, id={feedback.id}, len={len(content)}")
    return {"success": True, "item": _feedback_to_dict(feedback)}


# ============ 管理员侧接口 ============

@router.get("/admin/items", summary="管理员获取反馈列表")
async def admin_list_feedbacks(
    request: Request,
    adoption_status: Optional[str] = Query(None, description="采纳状态过滤"),
    resolve_status: Optional[str] = Query(None, description="解决状态过滤"),
    q: Optional[str] = Query(None, description="关键字搜索（内容/用户名）"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_global_db),
):
    check_admin(request)

    query = select(Feedback)
    count_query = select(func.count(Feedback.id))

    if adoption_status and adoption_status != "all":
        query = query.where(Feedback.adoption_status == adoption_status)
        count_query = count_query.where(Feedback.adoption_status == adoption_status)
    if resolve_status and resolve_status != "all":
        query = query.where(Feedback.resolve_status == resolve_status)
        count_query = count_query.where(Feedback.resolve_status == resolve_status)
    if q and q.strip():
        like_value = f"%{q.strip()}%"
        keyword_condition = or_(
            Feedback.content.ilike(like_value),
            Feedback.username.ilike(like_value),
            Feedback.display_name.ilike(like_value),
        )
        query = query.where(keyword_condition)
        count_query = count_query.where(keyword_condition)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = query.order_by(Feedback.created_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "success": True,
        "data": {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [_feedback_to_dict(item) for item in items],
        },
    }


@router.put("/admin/items/{feedback_id}", summary="管理员更新反馈状态")
async def admin_update_feedback(
    feedback_id: str,
    data: FeedbackAdminUpdate,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """标记采纳/不采纳、解决/未解决、填写管理员回复"""
    check_admin(request)

    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")

    if data.adoption_status is not None:
        if data.adoption_status not in ADOPTION_STATUSES:
            raise HTTPException(status_code=400, detail="采纳状态取值无效")
        feedback.adoption_status = data.adoption_status
    if data.resolve_status is not None:
        if data.resolve_status not in RESOLVE_STATUSES:
            raise HTTPException(status_code=400, detail="解决状态取值无效")
        feedback.resolve_status = data.resolve_status
    if data.admin_reply is not None:
        feedback.admin_reply = data.admin_reply.strip() or None

    feedback.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(feedback)

    logger.info(
        f"管理员更新反馈: id={feedback_id}, adoption={feedback.adoption_status}, resolve={feedback.resolve_status}"
    )
    return {"success": True, "item": _feedback_to_dict(feedback)}


@router.delete("/admin/items/{feedback_id}", summary="管理员删除反馈")
async def admin_delete_feedback(
    feedback_id: str,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    check_admin(request)

    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")

    await db.delete(feedback)
    await db.commit()
    return {"success": True, "message": "删除成功"}
