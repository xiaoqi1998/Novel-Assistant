"""
认证 API - New API 账号体系对齐

登录与注册全部代理 New API 的公开端点：
- POST /auth/newapi/login  → 代理 New API POST /api/user/login
- POST /auth/newapi/register → 代理 New API POST /api/user/register

验证通过后由墨笔签发自己的 HMAC 会话 Token（复用 _set_login_cookies）。
New API role >= 10（admin/root）的用户自动获得墨笔管理员权限。

历史遗留的本地登录 / 邮箱验证码 / LinuxDO OAuth / 密码绑定体系已全部移除。
"""
from fastapi import APIRouter, HTTPException, Response, Request
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.user_manager import User as UserDTO
from app.logger import get_logger
from app.config import settings
from app.database import get_engine
from app.models.user import User as UserModel
from app.security import create_session_token
from app.services.newapi_errors import NewAPIAuthError, NewAPIRequestError

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))


def get_china_now():
    """获取中国当前时间"""
    return datetime.now(CHINA_TZ)


logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["认证"])


# ==================== 响应/请求模型 ====================


class LocalLoginResponse(BaseModel):
    """登录响应（保留旧名以兼容前端类型）"""
    success: bool
    message: str
    user: Optional[dict] = None


class NewApiLoginRequest(BaseModel):
    """New API 账号登录请求"""
    username: str
    password: str


class NewApiRegisterRequest(BaseModel):
    """New API 账号注册请求"""
    username: str
    password: str
    email: Optional[str] = None
    verification_code: Optional[str] = None


# ==================== 内部工具 ====================


async def _get_global_session() -> AsyncSession:
    """获取全局数据库会话"""
    engine = await get_engine("_global_users_")
    session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    return session_maker()


def _admin_roles() -> set:
    """解析 NEW_API_ADMIN_ROLES 配置为整数集合"""
    raw = getattr(settings, "NEW_API_ADMIN_ROLES", "") or ""
    return {int(x.strip()) for x in raw.split(",") if x.strip().isdigit()}


def _is_session_cookie_secure() -> bool:
    """判断会话 Cookie 是否启用 Secure 标记。"""
    if settings.SESSION_COOKIE_SECURE is not None:
        return settings.SESSION_COOKIE_SECURE
    return not settings.debug


def _set_login_cookies(response: Response, user_id: str):
    """设置登录 Cookie"""
    max_age = settings.SESSION_EXPIRE_MINUTES * 60
    session_token = create_session_token(user_id, max_age)
    cookie_secure = _is_session_cookie_secure()
    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=cookie_secure,
    )

    china_now = get_china_now()
    expire_time = china_now + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
    expire_at = int(expire_time.timestamp())

    response.set_cookie(
        key="session_expire_at",
        value=str(expire_at),
        max_age=max_age,
        httponly=False,
        samesite="lax",
        secure=cookie_secure,
    )


async def _find_or_create_from_newapi(
    newapi_user_id: int,
    username: str,
    display_name: str,
    role: int,
    password: str,
) -> UserDTO:
    """根据 New API user_id 查找或创建墨笔本地用户，并确保 newapi_key 存在。

    - 已存在：更新基本信息与最后登录时间，必要时提升管理员状态
    - 不存在：创建新本地用户，user_id = newapi_{id}，is_admin 根据 role 映射
    - newapi_key 缺失时用用户凭据自动签发（独立 session，异常自吞不阻断登录）
    """
    is_admin = role in _admin_roles()
    user_id = f"newapi_{newapi_user_id}"
    final_display_name = (display_name or username).strip() or username

    async with await _get_global_session() as session:
        result = await session.execute(
            select(UserModel).where(UserModel.newapi_user_id == newapi_user_id)
        )
        user = result.scalar_one_or_none()

        if user:
            user.username = username
            user.display_name = final_display_name
            user.last_login = datetime.now()
            if is_admin and not user.is_admin:
                user.is_admin = True
            await session.commit()
            await session.refresh(user)
            user_dict = user.to_dict()
            has_newapi_key = bool(user.newapi_key)
        else:
            user = UserModel(
                user_id=user_id,
                username=username,
                display_name=final_display_name,
                avatar_url=None,
                trust_level=10 if is_admin else 1,
                is_admin=is_admin,
                # linuxdo_id 字段 NOT NULL，复用填 newapi_{id}（语义已迁移）
                linuxdo_id=user_id,
                newapi_user_id=newapi_user_id,
                created_at=datetime.now(),
                last_login=datetime.now(),
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            user_dict = user.to_dict()
            has_newapi_key = False

    # 确保 newapi_key 存在（用用户凭据签发，独立 session，异常自吞）
    if not has_newapi_key:
        try:
            from app.services.newapi_client import newapi_client
            if settings.NEW_API_ENABLED:
                key = await newapi_client.create_token_with_credentials(
                    username=username,
                    password=password,
                    newapi_user_id=newapi_user_id,
                )
                if key:
                    async with await _get_global_session() as ks:
                        result = await ks.execute(
                            select(UserModel).where(UserModel.user_id == user_id)
                        )
                        u = result.scalar_one_or_none()
                        if u:
                            u.newapi_key = key
                            await ks.commit()
                            user_dict["newapi_key"] = key
        except Exception as e:
            logger.warning(f"[New API 登录] 为用户 {user_id} 创建 Token 失败: {e}")

    # 确保 newapi_access_token 存在（用于代理调用充值/订阅接口，异常自吞）
    # 每次登录都重新生成 access_token（保证始终有效，New API 每次生成会使旧 token 失效）
    try:
        from app.services.newapi_client import newapi_client
        if settings.NEW_API_ENABLED:
            access_token = await newapi_client.generate_access_token(
                username=username,
                password=password,
                newapi_user_id=newapi_user_id,
            )
            if access_token:
                async with await _get_global_session() as ks:
                    result = await ks.execute(
                        select(UserModel).where(UserModel.user_id == user_id)
                    )
                    u = result.scalar_one_or_none()
                    if u:
                        u.newapi_access_token = access_token
                        await ks.commit()
                        user_dict["newapi_access_token"] = access_token
    except Exception as e:
        logger.warning(f"[New API 登录] 为用户 {user_id} 生成 access_token 失败: {e}")

    return UserDTO(**user_dict)


# ==================== 路由：认证配置 ====================


@router.get("/config")
async def get_auth_config():
    """获取认证配置信息

    前端据此决定渲染哪些登录入口。本版本仅保留 New API 登录与注册，
    旧字段保留为 false 以兼容前端历史代码。
    """
    enabled = bool(settings.NEW_API_ENABLED)
    return {
        "newapi_auth_enabled": enabled,
        "newapi_register_enabled": enabled,
        # 兼容旧前端字段（恒 false，不再有对应入口）
        "local_auth_enabled": False,
        "linuxdo_enabled": False,
        "email_auth_enabled": False,
        "email_register_enabled": False,
    }


# ==================== 路由：New API 登录 ====================


@router.post("/newapi/login", response_model=LocalLoginResponse)
async def newapi_login(request: NewApiLoginRequest, response: Response):
    """New API 账号登录（代理 New API POST /api/user/login）"""
    if not settings.NEW_API_ENABLED:
        raise HTTPException(status_code=403, detail="New API 登录未启用")

    username = (request.username or "").strip()
    if not username or not request.password:
        raise HTTPException(status_code=400, detail="请输入账号和密码")

    try:
        from app.services.newapi_client import newapi_client
        newapi_user = await newapi_client.login_user(username, request.password)
    except NewAPIAuthError:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    except NewAPIRequestError as e:
        # 2FA / New API 不可达等
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"[New API 登录] 调用失败: {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="New API 服务暂不可用")

    try:
        newapi_user_id = int(newapi_user.get("id"))
    except (TypeError, ValueError):
        logger.error(f"[New API 登录] 返回数据缺少 id 字段: {newapi_user}")
        raise HTTPException(status_code=502, detail="New API 返回数据异常")

    username = newapi_user.get("username") or username
    display_name = newapi_user.get("display_name") or username
    role = int(newapi_user.get("role", 1))
    status = int(newapi_user.get("status", 1))
    if status != 1:
        raise HTTPException(status_code=403, detail="账号已被封禁，请联系管理员")

    user = await _find_or_create_from_newapi(newapi_user_id, username, display_name, role, request.password)
    _set_login_cookies(response, user.user_id)
    logger.info(
        f"✅ [New API 登录] 用户 {user.user_id} (newapi_user_id={newapi_user_id}, role={role}) 登录成功"
    )
    return LocalLoginResponse(success=True, message="登录成功", user=user.dict())


# ==================== 路由：New API 注册 ====================


@router.post("/newapi/register", response_model=LocalLoginResponse)
async def newapi_register(request: NewApiRegisterRequest, response: Response):
    """New API 账号注册（代理 New API POST /api/user/register，成功后自动登录）"""
    if not settings.NEW_API_ENABLED:
        raise HTTPException(status_code=403, detail="New API 注册未启用")

    username = (request.username or "").strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="账号至少 3 位")
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")

    try:
        from app.services.newapi_client import newapi_client
        await newapi_client.register_user(
            username=username,
            password=request.password,
            email=request.email,
            verification_code=request.verification_code,
        )
    except NewAPIRequestError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[New API 注册] 调用失败: {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="New API 服务暂不可用")

    # 注册成功，自动走登录流程
    try:
        from app.services.newapi_client import newapi_client
        newapi_user = await newapi_client.login_user(username, request.password)
    except Exception as e:
        logger.warning(f"[New API 注册] 注册成功但自动登录失败: {e}")
        return LocalLoginResponse(
            success=True, message="注册成功，请使用新账号登录", user=None
        )

    try:
        newapi_user_id = int(newapi_user.get("id"))
    except (TypeError, ValueError):
        return LocalLoginResponse(
            success=True, message="注册成功，请使用新账号登录", user=None
        )

    user = await _find_or_create_from_newapi(
        newapi_user_id,
        username,
        newapi_user.get("display_name") or username,
        int(newapi_user.get("role", 1)),
        request.password,
    )
    _set_login_cookies(response, user.user_id)
    logger.info(f"✅ [New API 注册] 用户 {user.user_id} 注册并自动登录成功")
    return LocalLoginResponse(success=True, message="注册成功，已自动登录", user=user.dict())


# ==================== 路由：会话维持 ====================


@router.post("/refresh")
async def refresh_session(request: Request, response: Response):
    """刷新会话 - 延长登录状态"""
    if not hasattr(request.state, "user") or not request.state.user:
        raise HTTPException(status_code=401, detail="未登录，无法刷新会话")

    user = request.state.user

    session_expire_at = request.cookies.get("session_expire_at")
    if session_expire_at:
        try:
            expire_timestamp = int(session_expire_at)
            current_timestamp = int(get_china_now().timestamp())
            remaining_minutes = (expire_timestamp - current_timestamp) / 60

            if remaining_minutes > settings.SESSION_REFRESH_THRESHOLD_MINUTES:
                logger.info(f"⏱️ [刷新会话] 用户 {user.user_id} 会话仍有效，剩余 {int(remaining_minutes)} 分钟")
                return {
                    "message": "会话仍然有效，无需刷新",
                    "remaining_minutes": int(remaining_minutes),
                    "expire_at": expire_timestamp,
                }
        except (ValueError, TypeError):
            pass

    _set_login_cookies(response, user.user_id)

    china_now = get_china_now()
    expire_time = china_now + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
    expire_at = int(expire_time.timestamp())

    logger.info(f"[刷新会话] 用户: {user.user_id}")
    return {
        "message": "会话刷新成功",
        "expire_at": expire_at,
        "remaining_minutes": settings.SESSION_EXPIRE_MINUTES,
    }


@router.post("/logout")
async def logout(request: Request, response: Response):
    """退出登录"""
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        logger.info(f"🚪 [退出] 用户 {user_id} 退出登录")

    response.delete_cookie("user_id")
    response.delete_cookie("session_token")
    response.delete_cookie("session_expire_at")
    return {"message": "退出登录成功"}


@router.get("/user")
async def get_current_user(request: Request):
    """获取当前登录用户信息"""
    if not hasattr(request.state, "user") or not request.state.user:
        raise HTTPException(status_code=401, detail="未登录")

    return request.state.user.dict()
