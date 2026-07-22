"""New API 额度签发服务

负责在用户注册成功后：
1. 调用 New API Admin API 创建用户（带赠送额度）
2. 为该用户签发专属 API Key (sk-xxx)
3. 回写 User 表的 newapi_user_id / newapi_key
4. 同步更新用户 Settings 表的 api_provider / api_key / api_base_url 三字段（部分覆盖）
5. 新用户若 Settings 为新建，默认模型设为 deepseek-v4-pro

事务隔离契约：
- 调用方必须保证在主库 session.commit() 成功之后才调用本函数
- 本函数内部所有异常自行捕获 → logger.warning 记录，绝不向上抛出，确保注册主流程不被阻断
- 签发失败时 newapi_user_id 留空，由补签机制（provision_existing_users）兜底
"""
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.logger import get_logger
from app.models.user import User
from app.models.settings import Settings
from app.services.newapi_client import newapi_client

logger = get_logger(__name__)


async def provision_newapi_for_user(
    user_id: str,
    username: str,
    display_name: str,
    db_session: AsyncSession,
) -> None:
    """为单个用户签发 New API 账户与 Key

    幂等：若 User.newapi_user_id 已存在则跳过 New API 创建，仅补写缺失的 Settings 三字段。
    降级：new_api_enabled=False 时直接 return。
    异常隔离：所有异常自吞，仅 logger.warning，绝不阻断调用方主流程。

    Args:
        user_id: Novel-Assistant 用户ID
        username: 用户名（用于 New API 账户名）
        display_name: 显示名称
        db_session: 独立的数据库会话（调用方负责传入，与主库会话隔离）
    """
    # 降级：未启用 New API 时直接返回
    if not newapi_client.enabled:
        return

    try:
        # 读取当前 User 记录
        result = await db_session.execute(
            select(User).where(User.user_id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            logger.warning(f"[NewAPI-Provision] 用户不存在: {user_id}")
            return

        # 幂等：已签发则仅补 Settings
        if user.newapi_user_id:
            logger.info(f"[NewAPI-Provision] 用户已签发，仅补 Settings: user_id={user_id}, newapi_user_id={user.newapi_user_id}")
            await _sync_user_settings(user, db_session, api_key=user.newapi_key)
            return

        # 1. New API 创建用户（带赠送额度）
        newapi_username = f"novel_{user_id}"[:30]  # New API 用户名长度限制
        newapi_user = await newapi_client.create_user(
            username=newapi_username,
            display_name=display_name or username,
            quota=app_settings.NEW_API_GIFT_QUOTA,
            group=app_settings.NEW_API_DEFAULT_GROUP,
        )
        newapi_user_id = newapi_user.get("id")
        if not newapi_user_id:
            logger.error(f"[NewAPI-Provision] New API 创建用户未返回 id: {newapi_user}")
            return

        # 2. 签发专属 API Key
        token_data = await newapi_client.create_token(
            newapi_user_id=newapi_user_id,
            name=f"Novel_Assistant_Key_{user_id}"[:30],
        )
        api_key = token_data.get("key")
        if not api_key:
            logger.error(f"[NewAPI-Provision] New API 创建 Token 未返回 key: {token_data}")
            return

        # 3. 回写 User 表
        user.newapi_user_id = newapi_user_id
        user.newapi_key = api_key
        await db_session.commit()

        # 4. 同步 Settings（部分字段覆盖）
        await _sync_user_settings(user, db_session, api_key=api_key)

        logger.info(
            f"[NewAPI-Provision] 签发成功: user_id={user_id}, newapi_user_id={newapi_user_id}, quota={app_settings.NEW_API_GIFT_QUOTA}"
        )

    except Exception as e:
        # 事务隔离：仅记录日志，绝不阻断注册主流程
        logger.warning(
            f"[NewAPI-Provision] 签发失败（用户主流程不受影响）: user_id={user_id}, error={e}",
            exc_info=True,
        )
        # 回滚本会话的未提交变更，避免脏数据
        try:
            if db_session.in_transaction():
                await db_session.rollback()
        except Exception as rollback_err:
            logger.error(f"[NewAPI-Provision] 回滚失败: {rollback_err}")


async def _sync_user_settings(
    user: User,
    db_session: AsyncSession,
    api_key: Optional[str],
) -> None:
    """同步更新用户 Settings 记录（部分字段覆盖）

    只覆盖三字段：api_provider="openai"、api_key=sk-xxx、api_base_url=New API 的 /v1 端点
    保留不动：llm_model、temperature、max_tokens、system_prompt、preferences 等用户已有偏好
    新建 Settings 时设置默认模型为 NEW_API_DEFAULT_MODEL
    """
    try:
        result = await db_session.execute(
            select(Settings).where(Settings.user_id == user.user_id)
        )
        settings_row = result.scalar_one_or_none()

        is_new = settings_row is None
        if is_new:
            # 新建 Settings（最小化初始化，避免覆盖 read_env_defaults 的默认值）
            settings_row = Settings(
                user_id=user.user_id,
                preferences="{}",
            )
            db_session.add(settings_row)

        # 部分字段覆盖（仅这三项）
        settings_row.api_provider = "openai"
        settings_row.api_key = api_key or settings_row.api_key
        settings_row.api_base_url = f"{app_settings.NEW_API_BASE_URL}/v1"

        # 新用户默认模型
        if is_new:
            settings_row.llm_model = app_settings.NEW_API_DEFAULT_MODEL

        await db_session.commit()
        logger.info(
            f"[NewAPI-Provision] Settings 同步成功: user_id={user.user_id}, is_new={is_new}, model={settings_row.llm_model}"
        )
    except Exception as e:
        logger.warning(
            f"[NewAPI-Provision] Settings 同步失败: user_id={user.user_id}, error={e}",
            exc_info=True,
        )
        try:
            if db_session.in_transaction():
                await db_session.rollback()
        except Exception:
            pass


async def provision_existing_users(batch_size: int = 50) -> dict:
    """管理员批量补签存量用户

    遍历 newapi_user_id IS NULL 的用户，逐个调用 provision_newapi_for_user。
    供管理员接口 POST /api/newapi/admin/provision-existing 调用。

    Args:
        batch_size: 单次处理上限（避免长事务）

    Returns:
        {"total": N, "success": M, "failed": K}
    """
    if not newapi_client.enabled:
        return {"total": 0, "success": 0, "failed": 0, "message": "New API 未启用"}

    from app.database import get_engine
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

    engine = await get_engine("shared")
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    stats = {"total": 0, "success": 0, "failed": 0}

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.newapi_user_id.is_(None)).limit(batch_size)
        )
        users = result.scalars().all()

    stats["total"] = len(users)
    if not users:
        return stats

    for user in users:
        # 每个用户独立 session
        async with AsyncSessionLocal() as user_db:
            try:
                await provision_newapi_for_user(
                    user_id=user.user_id,
                    username=user.username,
                    display_name=user.display_name,
                    db_session=user_db,
                )
                # 重新查 user 看是否签发成功
                result = await user_db.execute(
                    select(User).where(User.user_id == user.user_id)
                )
                fresh = result.scalar_one_or_none()
                if fresh and fresh.newapi_user_id:
                    stats["success"] += 1
                else:
                    stats["failed"] += 1
            except Exception as e:
                logger.warning(f"[NewAPI-Provision] 补签失败: user_id={user.user_id}, error={e}")
                stats["failed"] += 1

    logger.info(f"[NewAPI-Provision] 批量补签完成: {stats}")
    return stats
