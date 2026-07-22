"""New API 业务路由

聚合所有 New API 相关业务接口，前端只对接本路由，不感知 New API 存在。
所有接口需登录鉴权（复用 require_login），管理员接口需 require_admin。

路由前缀：/api/newapi
"""
from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.database import get_db, get_engine
from app.logger import get_logger
from app.models.user import User
from app.models.settings import Settings
from app.models.user_subscription import UserSubscription
from app.services.newapi_client import newapi_client
from app.services.newapi_errors import NewAPIDisabledError, NewAPIRequestError
from app.services.newapi_provisioning import provision_newapi_for_user
from app.api.settings import require_login, require_admin

logger = get_logger(__name__)

router = APIRouter(prefix="/newapi", tags=["New API 额度中心"])


# ==================== 响应模型 ====================

class BalanceResponse(BaseModel):
    enabled: bool = Field(..., description="New API 是否启用")
    bound: bool = Field(..., description="当前用户是否已签发 Key")
    total_quota: float = Field(0, description="总额度（钱包+订阅）")
    used_quota: float = Field(0, description="已用额度（钱包+订阅）")
    remaining_quota: float = Field(0, description="剩余额度（钱包+订阅）")
    wallet_remaining_quota: float = Field(0, description="钱包剩余额度")
    subscription_remaining_quota: float = Field(0, description="订阅剩余额度")
    estimated_words: int = Field(0, description="估算可生成字数")


class StatusResponse(BaseModel):
    enabled: bool
    bound: bool
    is_subscribed: bool
    subscription_expired_at: Optional[str] = None
    current_model: Optional[str] = None
    default_model: str


class ModelItem(BaseModel):
    id: str
    name: str
    pricing: dict


class ModelsResponse(BaseModel):
    enabled: bool
    models: List[ModelItem]
    is_subscribed: bool
    current_model: Optional[str] = None


class RechargeRequest(BaseModel):
    amount: int = Field(..., description="充值金额（与 topup_info.amount_options 一致）")
    payment_method: str = Field("waffo_pancake", description="支付方式")


class SwitchModelRequest(BaseModel):
    model_id: str


# ==================== 内部工具 ====================

async def _get_user_by_id(db: AsyncSession, user_id: str) -> User:
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return user


async def _get_user_settings_row(db: AsyncSession, user_id: str) -> Optional[Settings]:
    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    return result.scalar_one_or_none()


async def _is_user_subscribed(db: AsyncSession, user_id: str) -> bool:
    """判断用户是否为有效订阅用户

    存在 plan_type="subscription" 且 status="paid" 且 expired_at > now() 的记录即为订阅用户。
    """
    now = datetime.now()
    result = await db.execute(
        select(UserSubscription).where(
            UserSubscription.user_id == user_id,
            UserSubscription.plan_type == "subscription",
            UserSubscription.status == "paid",
            UserSubscription.expired_at > now,
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _get_subscription_expiry(db: AsyncSession, user_id: str) -> Optional[datetime]:
    """获取当前有效订阅的最近到期时间"""
    now = datetime.now()
    result = await db.execute(
        select(UserSubscription.expired_at).where(
            UserSubscription.user_id == user_id,
            UserSubscription.plan_type == "subscription",
            UserSubscription.status == "paid",
            UserSubscription.expired_at > now,
        ).order_by(UserSubscription.expired_at.desc()).limit(1)
    )
    return result.scalar_one_or_none()


def _estimate_words(balance_usd: float) -> int:
    """粗略估算可生成中文字数

    保守假设：$1 ≈ 可消费 10 万 tokens（综合输入输出均价及上下文消耗）
    1 token ≈ 1.5 中文字符
    """
    if balance_usd <= 0:
        return 0
    tokens = balance_usd * 100_000
    return int(tokens * 1.5)


# ==================== 路由：余额与状态 ====================

@router.get("/balance", response_model=BalanceResponse)
async def get_balance(user: User = Depends(require_login)):
    """查询当前用户余额（钱包 + 活跃订阅额度）"""
    if not newapi_client.enabled:
        return BalanceResponse(enabled=False, bound=False)

    # 用独立 session 读 User
    engine = await get_engine("_global_users_")
    from sqlalchemy.ext.asyncio import async_sessionmaker
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with AsyncSessionLocal() as db:
        db_user = await _get_user_by_id(db, user.user_id)
        if not db_user.newapi_key:
            return BalanceResponse(enabled=True, bound=False)

        try:
            bal = await newapi_client.get_balance_via_key(db_user.newapi_key)
        except (NewAPIRequestError, NewAPIDisabledError) as e:
            logger.warning(f"查询钱包余额失败: {e}")
            return BalanceResponse(enabled=True, bound=True)

        wallet_total = bal["total_quota"]
        wallet_used = bal["used_quota"]
        wallet_remaining = bal["remaining_quota"]

        # 查询活跃订阅额度并合并
        subscription_remaining = 0.0
        subscription_total = 0.0
        subscription_used = 0.0
        if db_user.newapi_access_token and db_user.newapi_user_id:
            try:
                self_resp = await newapi_client.get_subscription_self(
                    db_user.newapi_access_token, db_user.newapi_user_id
                )
                if self_resp.get("success") and isinstance(self_resp.get("data"), dict):
                    subs = self_resp["data"].get("subscriptions", []) or []
                    quota_per_unit = getattr(app_settings, "NEW_API_QUOTA_PER_UNIT", 500000)
                    for sub_summary in subs:
                        sub = sub_summary.get("subscription") if isinstance(sub_summary, dict) else None
                        if not isinstance(sub, dict) or sub.get("status") != "active":
                            continue
                        total = float(sub.get("amount_total", 0))
                        used = float(sub.get("amount_used", 0))
                        subscription_total += total / quota_per_unit if quota_per_unit else 0
                        subscription_used += used / quota_per_unit if quota_per_unit else 0
                        subscription_remaining += (total - used) / quota_per_unit if quota_per_unit else 0
            except Exception as e:
                logger.warning(f"查询订阅额度失败: {e}")

    total = wallet_total + subscription_total
    used = wallet_used + subscription_used
    remaining = wallet_remaining + subscription_remaining
    estimated_words = _estimate_words(remaining)
    return BalanceResponse(
        enabled=True,
        bound=True,
        total_quota=round(total, 4),
        used_quota=round(used, 4),
        remaining_quota=round(remaining, 4),
        wallet_remaining_quota=round(wallet_remaining, 4),
        subscription_remaining_quota=round(subscription_remaining, 4),
        estimated_words=estimated_words,
    )


@router.get("/status", response_model=StatusResponse)
async def get_status(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """查询 New API 绑定状态 + 订阅状态"""
    if not newapi_client.enabled:
        return StatusResponse(
            enabled=False, bound=False, is_subscribed=False,
            default_model=app_settings.NEW_API_DEFAULT_MODEL,
        )

    db_user = await _get_user_by_id(db, user.user_id)
    settings_row = await _get_user_settings_row(db, user.user_id)
    is_subscribed = await _is_user_subscribed(db, user.user_id)
    expiry = await _get_subscription_expiry(db, user.user_id)

    return StatusResponse(
        enabled=True,
        bound=bool(db_user.newapi_user_id),
        is_subscribed=is_subscribed,
        subscription_expired_at=expiry.isoformat() if expiry else None,
        # 只有订阅用户才展示其自定义模型；非订阅用户固定显示默认模型
        current_model=settings_row.llm_model if is_subscribed and settings_row else None,
        default_model=app_settings.NEW_API_DEFAULT_MODEL,
    )


# ==================== 路由：模型列表与切换 ====================

@router.get("/models", response_model=ModelsResponse)
async def get_models(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """获取可用模型列表（含价格）"""
    if not newapi_client.enabled:
        return ModelsResponse(
            enabled=False, models=[], is_subscribed=False,
            current_model=app_settings.NEW_API_DEFAULT_MODEL,
        )

    db_user = await _get_user_by_id(db, user.user_id)
    settings_row = await _get_user_settings_row(db, user.user_id)
    is_subscribed = await _is_user_subscribed(db, user.user_id)

    if not db_user.newapi_key:
        # 未签发时返回默认模型
        return ModelsResponse(
            enabled=True, models=[], is_subscribed=is_subscribed,
            current_model=settings_row.llm_model if is_subscribed and settings_row else app_settings.NEW_API_DEFAULT_MODEL,
        )

    try:
        models = await newapi_client.list_models(
            db_user.newapi_key,
            access_token=db_user.newapi_access_token,
            newapi_user_id=db_user.newapi_user_id,
        )
        # 应用白名单过滤
        whitelist = app_settings.NEW_API_SUBSCRIPTION_MODELS or []
        if whitelist:
            models = [m for m in models if m["id"] in whitelist]
    except (NewAPIRequestError, NewAPIDisabledError) as e:
        logger.warning(f"获取模型列表失败: {e}")
        models = []

    return ModelsResponse(
        enabled=True,
        models=[ModelItem(**m) for m in models],
        is_subscribed=is_subscribed,
        current_model=settings_row.llm_model if is_subscribed and settings_row else app_settings.NEW_API_DEFAULT_MODEL,
    )


@router.put("/model")
async def switch_model(
    req: SwitchModelRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """切换当前用户模型（仅订阅用户可用）"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")

    is_subscribed = await _is_user_subscribed(db, user.user_id)
    if not is_subscribed:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "subscription_required",
                "message": "切换模型需要订阅，当前仅可用 deepseek-v4-pro",
            },
        )

    settings_row = await _get_user_settings_row(db, user.user_id)
    if not settings_row:
        raise HTTPException(status_code=404, detail="用户设置不存在")

    # 白名单校验
    whitelist = app_settings.NEW_API_SUBSCRIPTION_MODELS or []
    if whitelist and req.model_id not in whitelist:
        raise HTTPException(status_code=400, detail="该模型不在允许列表内")

    settings_row.llm_model = req.model_id
    await db.commit()

    return {"status": "ok", "model": req.model_id}


# ==================== 路由：充值与订阅 ====================

# ==================== 路由：充值与订阅（代理 New API 接口） ====================


async def _get_user_creds(db: AsyncSession, user_id: str):
    """获取用户的 newapi_access_token 和 newapi_user_id（用于代理调用 New API 接口）"""
    db_user = await _get_user_by_id(db, user_id)
    if not db_user.newapi_user_id:
        raise HTTPException(status_code=400, detail="尚未激活 AI 服务，请先在个人中心激活")
    if not db_user.newapi_access_token:
        raise HTTPException(
            status_code=400,
            detail="访问凭证缺失，请重新登录后重试",
        )
    return db_user.newapi_access_token, db_user.newapi_user_id


@router.get("/topup/info")
async def get_topup_info(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """获取充值信息（支付方式、金额档位、最低充值等）—— 代理 New API"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")
    access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
    try:
        resp = await newapi_client.get_topup_info(access_token, newapi_user_id)
        return resp
    except (NewAPIRequestError, NewAPIDisabledError) as e:
        raise HTTPException(status_code=502, detail=f"获取充值信息失败: {e}")


@router.get("/subscription/plans")
async def get_subscription_plans(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """获取订阅套餐列表 —— 代理 New API"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")
    access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
    try:
        resp = await newapi_client.get_subscription_plans(access_token, newapi_user_id)
        return resp
    except (NewAPIRequestError, NewAPIDisabledError) as e:
        raise HTTPException(status_code=502, detail=f"获取订阅套餐失败: {e}")


@router.get("/subscription/self")
async def get_subscription_self(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """获取当前用户的订阅状态 —— 代理 New API"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")
    access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
    try:
        resp = await newapi_client.get_subscription_self(access_token, newapi_user_id)
        return resp
    except (NewAPIRequestError, NewAPIDisabledError) as e:
        raise HTTPException(status_code=502, detail=f"获取订阅状态失败: {e}")


@router.get("/topup/history")
async def get_topup_history(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """获取充值历史 —— 代理 New API"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")
    access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
    try:
        resp = await newapi_client.get_topup_history(access_token, newapi_user_id)
        return resp
    except (NewAPIRequestError, NewAPIDisabledError) as e:
        raise HTTPException(status_code=502, detail=f"获取充值历史失败: {e}")


class TopupRequest(BaseModel):
    amount: int = Field(..., description="充值金额（与 topup_info.amount_options 一致）")
    payment_method: str = Field("waffo_pancake", description="支付方式")


@router.post("/topup")
async def create_topup(
    req: TopupRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """发起充值 —— 代理 New API（返回支付链接）"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")
    access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
    try:
        resp = await newapi_client.request_topup(
            access_token, newapi_user_id, req.amount, req.payment_method
        )
        return resp
    except NewAPIRequestError as e:
        status = 401 if e.status_code == 401 else 502
        raise HTTPException(status_code=status, detail=str(e))
    except NewAPIDisabledError as e:
        raise HTTPException(status_code=502, detail=f"发起充值失败: {e}")


class SubscribeRequest(BaseModel):
    plan_id: int = Field(..., description="订阅套餐 ID（从 subscription/plans 获取）")
    payment_method: str = Field("balance", description="支付方式（balance=余额支付）")


@router.post("/subscribe")
async def create_subscription(
    req: SubscribeRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """购买订阅 —— 代理 New API（余额支付扣款 + 授予订阅额度）

    订阅成功后同步回写本地 UserSubscription 表，使个人中心状态立即生效。
    """
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")
    access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
    try:
        resp = await newapi_client.subscribe_plan(
            access_token, newapi_user_id, req.plan_id, req.payment_method
        )
    except NewAPIRequestError as e:
        status = 401 if e.status_code == 401 else 502
        raise HTTPException(status_code=status, detail=str(e))
    except NewAPIDisabledError as e:
        raise HTTPException(status_code=502, detail=f"订阅失败: {e}")

    # 同步 New API 订阅状态到本地
    try:
        self_resp = await newapi_client.get_subscription_self(access_token, newapi_user_id)
        if self_resp.get("success") and isinstance(self_resp.get("data"), dict):
            subs = self_resp["data"].get("subscriptions", []) or []
            for sub_summary in subs:
                sub = sub_summary.get("subscription") if isinstance(sub_summary, dict) else None
                if not isinstance(sub, dict):
                    continue
                if sub.get("status") != "active":
                    continue
                # 写入/更新本地记录
                started_at = datetime.fromtimestamp(sub.get("start_time", 0))
                expired_at = datetime.fromtimestamp(sub.get("end_time", 0))
                amount_total = float(sub.get("amount_total", 0))
                # quota 单位转换：New API quota / QuotaPerUnit -> 美元
                quota_per_unit = getattr(app_settings, "NEW_API_QUOTA_PER_UNIT", 500000)
                quota_granted = amount_total / quota_per_unit if quota_per_unit else 0

                # 查找是否已有同 plan 的 paid subscription，有则更新，无则新建
                existing = await db.execute(
                    select(UserSubscription).where(
                        UserSubscription.user_id == user.user_id,
                        UserSubscription.plan_type == "subscription",
                        UserSubscription.plan_id == str(req.plan_id),
                        UserSubscription.status == "paid",
                    )
                )
                existing_row = existing.scalar_one_or_none()
                if existing_row:
                    existing_row.expired_at = expired_at
                    existing_row.started_at = started_at
                    existing_row.quota_granted = max(existing_row.quota_granted, quota_granted)
                    existing_row.note = f"续期/同步自 New API subscription_id={sub.get('id')}"
                else:
                    db.add(
                        UserSubscription(
                            user_id=user.user_id,
                            plan_type="subscription",
                            plan_id=str(req.plan_id),
                            amount_cents=0,
                            quota_granted=quota_granted,
                            status="paid",
                            payment_channel="balance",
                            started_at=started_at,
                            expired_at=expired_at,
                            note=f"同步自 New API subscription_id={sub.get('id')}",
                        )
                    )
                await db.commit()

                # 如果套餐配置了升级分组，同步到 New API
                upgrade_group = sub.get("upgrade_group") or ""
                if upgrade_group:
                    try:
                        await newapi_client.set_user_group(newapi_user_id, upgrade_group)
                        logger.info(
                            f"[NewAPI] 订阅后升级用户分组: user_id={user.user_id}, group={upgrade_group}"
                        )
                    except Exception as e:
                        logger.warning(f"[NewAPI] 订阅后升级分组失败: {e}")
                break
    except Exception as e:
        logger.warning(f"[NewAPI] 订阅成功后同步本地状态失败: {e}")
        # 不影响主流程，New API 侧订阅已生效

    return resp


# ==================== 路由：充值/订阅历史（保留旧接口兼容前端） ====================

@router.get("/subscriptions")
async def list_subscriptions(user: User = Depends(require_login), db: AsyncSession = Depends(get_db)):
    """查询当前用户充值/订阅历史（优先代理 New API，无凭证时回退本地）"""
    # 尝试用代理调用 New API
    try:
        access_token, newapi_user_id = await _get_user_creds(db, user.user_id)
        resp = await newapi_client.get_topup_history(access_token, newapi_user_id)
        if resp.get("success"):
            # New API 返回分页对象 {page, page_size, total, items: [...]}
            data = resp.get("data") or {}
            if isinstance(data, dict):
                items = data.get("items", []) or []
            elif isinstance(data, list):
                items = data
            else:
                items = []
            return {"items": items, "total": data.get("total", len(items)) if isinstance(data, dict) else len(items)}
    except Exception as e:
        logger.warning(f"代理查询充值历史失败，回退本地: {e}")

    # 回退：本地订阅记录
    result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user.user_id)
        .order_by(desc(UserSubscription.created_at))
        .limit(50)
    )
    subs = result.scalars().all()
    return {"items": [s.to_dict() for s in subs], "total": len(subs)}


# ==================== 路由：自助激活 ====================

@router.post("/activate")
async def activate_self(user: User = Depends(require_login)):
    """当前用户自助激活 New API 服务（补签）"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")

    engine = await get_engine("_global_users_")
    from sqlalchemy.ext.asyncio import async_sessionmaker
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with AsyncSessionLocal() as prov_db:
        # 检查是否已绑定
        result = await prov_db.execute(
            select(User).where(User.user_id == user.user_id)
        )
        db_user = result.scalar_one_or_none()
        if db_user and db_user.newapi_user_id:
            return {"status": "ok", "message": "已激活", "newapi_user_id": db_user.newapi_user_id}

        await provision_newapi_for_user(
            user_id=user.user_id,
            username=user.username,
            display_name=user.display_name,
            db_session=prov_db,
        )
        # 重新查
        result = await prov_db.execute(
            select(User).where(User.user_id == user.user_id)
        )
        db_user = result.scalar_one_or_none()
        if db_user and db_user.newapi_user_id:
            return {"status": "ok", "newapi_user_id": db_user.newapi_user_id}
        raise HTTPException(status_code=500, detail="激活失败，请稍后重试或联系管理员")


# ==================== 路由：管理员接口 ====================

@router.post("/admin/provision-existing")
async def admin_provision_existing(
    request: Request,
    admin: User = Depends(require_admin),
):
    """（管理员）批量补签存量用户"""
    if not newapi_client.enabled:
        raise HTTPException(status_code=503, detail="New API 未启用")

    from app.services.newapi_provisioning import provision_existing_users
    stats = await provision_existing_users()
    return stats


@router.post("/admin/sync-balance")
async def admin_sync_balance(
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """（管理员）强制同步某用户余额到本地（占位：仅返回查询结果）"""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="无效的请求体")
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="缺少 user_id")

    db_user = await _get_user_by_id(db, user_id)
    if not db_user.newapi_user_id:
        raise HTTPException(status_code=400, detail="用户未激活 New API")

    try:
        newapi_user = await newapi_client.get_user(db_user.newapi_user_id)
        return {
            "user_id": user_id,
            "newapi_user_id": db_user.newapi_user_id,
            "quota": float(newapi_user.get("quota", 0)),
        }
    except (NewAPIRequestError, NewAPIDisabledError) as e:
        raise HTTPException(status_code=502, detail=f"同步失败: {e}")


# 需要迁移 user_id 的数据表（按依赖顺序）
# settings 表有 UNIQUE(user_id) 约束，单独处理
_LEGACY_MIGRATION_TABLES = [
    "projects",
    "writing_styles",
    "user_subscriptions",
    "mcp_plugins",
    "prompt_templates",
    "background_tasks",
    "regeneration_tasks",
    "analysis_tasks",
    "batch_generation_tasks",
]


@router.post("/admin/migrate-legacy-admin")
async def admin_migrate_legacy_admin(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """（管理员）一次性数据迁移：把 legacy 管理员（local_*/linuxdo_*/email_*/admin_created_*）
    的所有项目数据迁移到当前 New API 管理员账号下。

    场景：原 admin/admin123 在墨笔内已有项目数据，切换到 New API root 登录后 user_id 变更
    （local_xxx → newapi_xxx），需把旧 user_id 下的所有数据 reassign 到当前 user_id。

    幂等：可重复调用；已迁移过的数据不会重复处理。
    """
    current_user_id = admin.user_id
    if not current_user_id.startswith("newapi_"):
        raise HTTPException(
            status_code=400,
            detail="当前账号非 New API 账号（user_id 不是 newapi_* 前缀），无需/无法迁移",
        )

    from sqlalchemy import text
    from app.models.user import User as UserModel

    # 查找所有 legacy 管理员
    result = await db.execute(
        select(UserModel).where(
            UserModel.is_admin == True,
            UserModel.user_id != current_user_id,
            # newapi_ 前缀的不算 legacy
            ~UserModel.user_id.like("newapi\\_%"),
        )
    )
    legacy_admins = result.scalars().all()

    if not legacy_admins:
        return {
            "status": "ok",
            "message": "无 legacy 管理员需要迁移",
            "migrated_count": 0,
            "details": [],
        }

    stats = []
    for legacy in legacy_admins:
        legacy_id = legacy.user_id
        per_user_stats = {"legacy_user_id": legacy_id, "tables": {}}

        # settings 表（UNIQUE 约束）：先删除当前用户的 settings（避免冲突），再迁移 legacy 的
        await db.execute(
            text("DELETE FROM settings WHERE user_id = :new_id"),
            {"new_id": current_user_id},
        )
        result = await db.execute(
            text("UPDATE settings SET user_id = :new_id WHERE user_id = :old_id"),
            {"new_id": current_user_id, "old_id": legacy_id},
        )
        per_user_stats["tables"]["settings"] = result.rowcount or 0

        # 其余表（无 UNIQUE 约束，直接 UPDATE）
        for table_name in _LEGACY_MIGRATION_TABLES:
            try:
                result = await db.execute(
                    text(
                        f"UPDATE {table_name} SET user_id = :new_id WHERE user_id = :old_id"
                    ),
                    {"new_id": current_user_id, "old_id": legacy_id},
                )
                per_user_stats["tables"][table_name] = result.rowcount or 0
            except Exception as table_err:
                # 表可能不存在于某些部署中，记录但继续
                logger.warning(
                    f"[迁移] 表 {table_name} 迁移失败（可能未建表）: {table_err}"
                )
                per_user_stats["tables"][table_name] = f"error: {table_err}"

        # 删除 legacy 用户的密码记录（user_passwords 表）
        try:
            await db.execute(
                text("DELETE FROM user_passwords WHERE user_id = :old_id"),
                {"old_id": legacy_id},
            )
        except Exception:
            pass

        # 删除 legacy 用户行
        await db.execute(
            text("DELETE FROM users WHERE user_id = :old_id"),
            {"old_id": legacy_id},
        )

        stats.append(per_user_stats)
        logger.info(
            f"[迁移] legacy 管理员 {legacy_id} 数据已迁移到 {current_user_id}: {per_user_stats['tables']}"
        )

    await db.commit()

    return {
        "status": "ok",
        "message": f"已迁移 {len(stats)} 个 legacy 管理员账号到当前用户 {current_user_id}",
        "migrated_count": len(stats),
        "details": stats,
    }
