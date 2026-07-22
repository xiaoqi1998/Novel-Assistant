"""New API Admin 客户端

封装对 New API（基于 One API）管理接口的调用：
- 创建用户、创建 Token（注册签发）
- 查询/更新用户额度（余额展示、充值）
- 设置用户分组（订阅升级）
- 获取模型列表含价格（前端模型选择器）

所有调用在服务端完成，持有 Root Admin Token，绝不暴露给前端。
New API 文档参考：https://github.com/songquanpeng/one-api / New API fork
"""
from typing import Optional, Dict, Any, List
import asyncio
import httpx
import secrets
import string

from app.config import settings
from app.logger import get_logger
from app.services.newapi_errors import NewAPIAuthError, NewAPIRequestError, NewAPIDisabledError

logger = get_logger(__name__)


def _random_password(length: int = 20) -> str:
    """生成随机密码（仅用于 New API 内部账户，用户不感知）"""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


class NewAPIClient:
    """New API 管理客户端（单例）"""

    def __init__(self):
        self._base_url: str = settings.NEW_API_BASE_URL.rstrip("/")
        self._root_token: Optional[str] = settings.NEW_API_ROOT_TOKEN
        self._timeout: int = settings.NEW_API_REQUEST_TIMEOUT

    @property
    def enabled(self) -> bool:
        """是否启用（配置了 Root Token 且 NEW_API_ENABLED=True）"""
        return bool(settings.NEW_API_ENABLED and self._root_token)

    def _admin_headers(self) -> Dict[str, str]:
        """Admin API 请求头（Root Token）"""
        if not self._root_token:
            raise NewAPIDisabledError("NEW_API_ROOT_TOKEN 未配置")
        return {
            "Authorization": f"Bearer {self._root_token}",
            "Content-Type": "application/json",
            "New-Api-User": "1",  # Root 管理员标识
        }

    def _v1_url(self, path: str) -> str:
        """OpenAI 兼容接口 URL（/v1 前缀）"""
        return f"{self._base_url}/v1{path}"

    def _admin_url(self, path: str) -> str:
        """Admin API URL（/api 前缀）"""
        return f"{self._base_url}/api{path}"

    # ==================== 公开端点代理（无需 Root Token） ====================

    async def login_user(self, username: str, password: str) -> Dict[str, Any]:
        """代理调用 New API POST /api/user/login（公开端点，无需 Root Token）

        用于墨笔登录：后端代理将用户名密码转发给 New API 验证，
        验证通过后由墨笔签发自己的会话 Token。

        Returns:
            New API 返回的 data 字段：{id, username, display_name, role, status, group}
        Raises:
            NewAPIAuthError: 用户名或密码错误
            NewAPIRequestError: New API 不可达 / 启用 2FA / 其它错误
        """
        payload = {"username": username, "password": password}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._admin_url("/user/login"), json=payload)
        except Exception as e:
            logger.error(f"[NewAPI] login_user 请求失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"New API 服务不可达: {e}") from e

        # 处理限流（429）：等待后重试
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 5))
            logger.warning(f"[NewAPI] 登录触发限流，等待 {retry_after}s 后重试")
            await asyncio.sleep(retry_after)
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(
                        self._admin_url("/user/login"),
                        json={"username": username, "password": password},
                    )
            except Exception as e:
                logger.error(f"[NewAPI] 登录重试失败: {e}", exc_info=True)
                raise NewAPIRequestError(f"New API 服务不可达: {e}") from e

        try:
            data = resp.json()
        except Exception as e:
            raise NewAPIRequestError(
                f"New API 登录响应非 JSON (HTTP {resp.status_code})",
                status_code=resp.status_code,
                response_text=resp.text[:500],
            ) from e

        # New API 登录失败通常返回 200 + {success:false, message:...}
        if not data.get("success", False):
            raise NewAPIAuthError(data.get("message", "用户名或密码错误"))

        payload_data = data.get("data", {}) or {}
        # 2FA 检查
        if payload_data.get("require_2fa"):
            raise NewAPIRequestError("该账号启用了两步验证，暂不支持，请在 New API 后台关闭 2FA 后重试")
        return payload_data

    async def register_user(
        self,
        username: str,
        password: str,
        email: Optional[str] = None,
        verification_code: Optional[str] = None,
        aff_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        """代理调用 New API POST /api/user/register（公开端点）

        Returns:
            New API 响应 JSON（含 success/message）
        Raises:
            NewAPIRequestError: 注册失败（用户名已存在 / 参数错误等）
        """
        payload = {"username": username, "password": password}
        if email:
            payload["email"] = email
        if verification_code:
            payload["verification_code"] = verification_code
        if aff_code:
            payload["aff_code"] = aff_code

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._admin_url("/user/register"), json=payload)
        except Exception as e:
            logger.error(f"[NewAPI] register_user 请求失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"New API 服务不可达: {e}") from e

        # 处理限流（429）：等待后重试
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 5))
            logger.warning(f"[NewAPI] 注册触发限流，等待 {retry_after}s 后重试")
            await asyncio.sleep(retry_after)
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._admin_url("/user/register"), json=payload)
            except Exception as e:
                logger.error(f"[NewAPI] 注册重试失败: {e}", exc_info=True)
                raise NewAPIRequestError(f"New API 服务不可达: {e}") from e

        try:
            data = resp.json()
        except Exception as e:
            raise NewAPIRequestError(
                f"New API 注册响应非 JSON (HTTP {resp.status_code})",
                status_code=resp.status_code,
                response_text=resp.text[:500],
            ) from e

        if not data.get("success", False):
            raise NewAPIRequestError(data.get("message", "注册失败"))
        return data

    # ==================== 用户管理 ====================

    async def create_user(
        self,
        username: str,
        display_name: str,
        quota: float,
        group: str = "default",
    ) -> Dict[str, Any]:
        """创建 New API 用户

        Args:
            username: 用户名（建议加 novel_ 前缀避免冲突）
            display_name: 显示名称
            quota: 初始额度（美元，如 5 表示 $5）
            group: 分组

        Returns:
            包含 id 等字段的用户对象
        """
        payload = {
            "username": username,
            "password": _random_password(),
            "display_name": display_name,
            "quota": int(quota),  # New API quota 为整数
            "group": group,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    self._admin_url("/user/"),
                    headers=self._admin_headers(),
                    json=payload,
                )
                data = self._handle_response(resp, "create_user")
                # New API 返回 {success, message, data:{id,...}} 或直接对象
                user_data = data.get("data", data) if isinstance(data, dict) else data
                logger.info(
                    f"[NewAPI] 创建用户成功: username={username}, newapi_user_id={user_data.get('id')}, quota={quota}"
                )
                return user_data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] create_user 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"创建用户失败: {e}") from e

    async def get_user(self, newapi_user_id: int) -> Dict[str, Any]:
        """查询用户信息（含 quota 余额）"""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self._admin_url(f"/user/{newapi_user_id}"),
                    headers=self._admin_headers(),
                )
                data = self._handle_response(resp, "get_user")
                user_data = data.get("data", data) if isinstance(data, dict) else data
                return user_data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] get_user 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"查询用户失败: {e}") from e

    async def update_user_quota(self, newapi_user_id: int, quota: float) -> Dict[str, Any]:
        """更新用户额度（覆盖式）

        Args:
            newapi_user_id: New API 用户 ID
            quota: 新的额度值（美元）
        """
        payload = {
            "id": newapi_user_id,
            "quota": int(quota),
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.put(
                    self._admin_url("/user/"),
                    headers=self._admin_headers(),
                    json=payload,
                )
                data = self._handle_response(resp, "update_user_quota")
                logger.info(
                    f"[NewAPI] 更新额度: newapi_user_id={newapi_user_id}, quota={quota}"
                )
                return data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] update_user_quota 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"更新额度失败: {e}") from e

    async def get_balance_via_key(self, api_key: str) -> Dict[str, float]:
        """用用户的 sk-xxx key 通过 OpenAI 兼容 billing 接口查余额（不需要 Root Token）

        Returns:
            {"total_quota": float, "used_quota": float, "remaining_quota": float}
            单位为额度（与 New API quota/QuotaPerUnit 一致）
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                headers = {"Authorization": f"Bearer {api_key}"}
                # billing 接口路径为 /v1/dashboard/billing/...（无 /api 前缀）
                base = self._base_url
                # 总额度（剩余+已用）
                sub_resp = await client.get(
                    f"{base}/v1/dashboard/billing/subscription",
                    headers=headers,
                )
                sub_data = sub_resp.json()
                total_quota = float(sub_data.get("hard_limit_usd", 0))

                # 已用额度
                usage_resp = await client.get(
                    f"{base}/v1/dashboard/billing/usage",
                    headers=headers,
                )
                usage_data = usage_resp.json()
                used_quota = float(usage_data.get("total_usage", 0)) / 100  # OpenAI 格式是分

                remaining = total_quota - used_quota
                return {
                    "total_quota": round(total_quota, 4),
                    "used_quota": round(used_quota, 4),
                    "remaining_quota": round(remaining, 4),
                }
        except Exception as e:
            logger.error(f"[NewAPI] get_balance_via_key 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"查询余额失败: {e}") from e

    async def add_user_quota(self, newapi_user_id: int, add_amount: float) -> float:
        """累加用户额度（先查后加，避免覆盖）

        Args:
            newapi_user_id: New API 用户 ID
            add_amount: 增加的额度（美元）

        Returns:
            更新后的新额度
        """
        user = await self.get_user(newapi_user_id)
        current_quota = float(user.get("quota", 0))
        new_quota = current_quota + add_amount
        await self.update_user_quota(newapi_user_id, new_quota)
        return new_quota

    async def set_user_group(self, newapi_user_id: int, group: str) -> Dict[str, Any]:
        """设置用户分组（订阅升级用）"""
        payload = {
            "id": newapi_user_id,
            "group": group,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.put(
                    self._admin_url("/user/"),
                    headers=self._admin_headers(),
                    json=payload,
                )
                data = self._handle_response(resp, "set_user_group")
                logger.info(
                    f"[NewAPI] 设置分组: newapi_user_id={newapi_user_id}, group={group}"
                )
                return data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] set_user_group 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"设置分组失败: {e}") from e

    # ==================== Token 管理 ====================

    async def create_token(
        self,
        newapi_user_id: int,
        name: str = "Novel_Assistant_Internal_Key",
        remain_quota: int = -1,
        expired_time: int = -1,
    ) -> Dict[str, Any]:
        """为指定用户创建专属 API Key

        Args:
            newapi_user_id: New API 用户 ID
            name: Token 名称
            remain_quota: -1 表示不单独限制 Key 额度，消耗用户总余额
            expired_time: -1 表示永不过期

        Returns:
            包含 key (sk-xxx) 等字段的 Token 对象
        """
        payload = {
            "name": name,
            "remain_quota": remain_quota,
            "expired_time": expired_time,
            "user_id": newapi_user_id,
            "unlimited_quota": True,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    self._admin_url("/token/"),
                    headers=self._admin_headers(),
                    json=payload,
                )
                data = self._handle_response(resp, "create_token")
                token_data = data.get("data", data) if isinstance(data, dict) else data
                # New API 返回的 key 可能是 "sk-xxx" 字符串
                if isinstance(token_data, str):
                    token_data = {"key": token_data}
                logger.info(
                    f"[NewAPI] 创建Token成功: newapi_user_id={newapi_user_id}, key={token_data.get('key', '')[:12]}..."
                )
                return token_data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] create_token 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"创建 Token 失败: {e}") from e

    async def create_token_with_credentials(
        self,
        username: str,
        password: str,
        newapi_user_id: int,
        name: str = "Novel_Assistant_Key",
    ) -> Optional[str]:
        """用用户凭据登录 New API 并获取专属 API Key（不需要 Root Token）

        流程：
        1. 用 username/password 登录 New API，获取 session cookie
        2. 尝试创建新 token（已存在或达上限时忽略错误，复用现有）
        3. 查询 token 列表，取最新的 token id（列表默认按 id 倒序）
        4. 调 POST /api/token/{id}/key 获取完整 key（GetFullKey，明文）
        5. 返回 sk-{key} 格式的完整 API Key

        幂等：若用户已有 token，直接复用最新的，不重复创建。

        Returns:
            sk-xxx 格式的完整 key，失败返回 None
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                # 1. 登录拿 session cookie
                login_resp = await client.post(
                    self._admin_url("/user/login"),
                    json={"username": username, "password": password},
                )
                login_data = login_resp.json()
                if not login_data.get("success"):
                    logger.warning(f"[NewAPI] 凭据登录失败: {login_data.get('message')}")
                    return None

                headers = {"New-Api-User": str(newapi_user_id)}

                # 2. 尝试创建 token（失败则复用现有）
                create_resp = await client.post(
                    self._admin_url("/token/"),
                    json={
                        "name": name[:50],
                        "remain_quota": -1,
                        "expired_time": -1,
                        "unlimited_quota": True,
                    },
                    headers=headers,
                )
                create_data = create_resp.json()
                if not create_data.get("success"):
                    logger.info(f"[NewAPI] 创建 token 跳过（可能已存在或达上限）: {create_data.get('message')}")

                # 3. 查 token 列表，取最新的 token id
                list_resp = await client.get(
                    self._admin_url("/token/"),
                    headers=headers,
                )
                list_data = list_resp.json()
                tokens = list_data.get("data", {})
                if isinstance(tokens, dict):
                    tokens = tokens.get("items", [])
                if not isinstance(tokens, list) or not tokens:
                    logger.warning(f"[NewAPI] token 列表为空: newapi_user_id={newapi_user_id}")
                    return None

                token_id = tokens[0].get("id")
                if not token_id:
                    logger.warning("[NewAPI] token 列表首项无 id")
                    return None

                # 4. 获取完整 key（GetFullKey 接口返回明文 key，不含 sk- 前缀）
                key_resp = await client.post(
                    self._admin_url(f"/token/{token_id}/key"),
                    headers=headers,
                )
                key_data = key_resp.json()
                if key_data.get("success"):
                    key = key_data.get("data", {}).get("key", "")
                    if key:
                        full_key = f"sk-{key}"
                        logger.info(
                            f"[NewAPI] 凭据获取 token 成功: newapi_user_id={newapi_user_id}, "
                            f"token_id={token_id}, key={full_key[:12]}..."
                        )
                        return full_key

                logger.warning(f"[NewAPI] 获取 token key 失败: {key_data.get('message')}")
                return None
        except Exception as e:
            logger.error(f"[NewAPI] create_token_with_credentials 失败: {e}", exc_info=True)
            return None

    # ==================== 用户凭据代理调用（充值/订阅/订单查询） ====================

    async def _proxy_with_access_token(
        self,
        access_token: str,
        newapi_user_id: int,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """用 access_token 代理调用 New API selfRoute 接口（不需要密码，不需要 Root Token）

        用于充值、订阅、订单查询等用户自助操作。

        Args:
            access_token: New API 用户的 access_token（非 sk-xxx key）
            newapi_user_id: 用户 ID（用于 New-Api-User header）
            method: HTTP 方法（GET/POST/PUT/DELETE）
            path: 接口路径（不含 /api 前缀，如 "/user/topup/info"）
            json_body: 请求体

        Returns:
            New API 响应 JSON
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                headers = {
                    "Authorization": access_token,
                    "New-Api-User": str(newapi_user_id),
                }
                url = self._admin_url(path)
                if method.upper() == "GET":
                    resp = await client.get(url, headers=headers)
                elif method.upper() == "POST":
                    resp = await client.post(url, json=json_body or {}, headers=headers)
                elif method.upper() == "PUT":
                    resp = await client.put(url, json=json_body or {}, headers=headers)
                elif method.upper() == "DELETE":
                    resp = await client.delete(url, headers=headers)
                else:
                    raise NewAPIRequestError(f"不支持的 HTTP 方法: {method}")

                try:
                    data = resp.json()
                except Exception:
                    raise NewAPIRequestError(
                        f"New API 响应非 JSON (HTTP {resp.status_code}): {resp.text[:200]}"
                    )
                # access_token 失效时返回 401，给出明确提示
                if resp.status_code == 401 or (
                    isinstance(data, dict) and "Unauthorized" in data.get("message", "")
                ):
                    raise NewAPIRequestError(
                        "访问凭证已过期，请退出后重新登录",
                        status_code=401,
                    )
                return data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] _proxy_with_access_token 失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"代理调用失败: {e}") from e

    async def generate_access_token(self, username: str, password: str, newapi_user_id: int) -> Optional[str]:
        """用凭据登录后生成 New API access_token（用于后续代理调用）

        Returns:
            access_token 字符串，失败返回 None
        """
        async def _do_login(client: httpx.AsyncClient) -> httpx.Response:
            return await client.post(
                self._admin_url("/user/login"),
                json={"username": username, "password": password},
            )

        async def _do_generate_token(client: httpx.AsyncClient) -> httpx.Response:
            return await client.get(
                self._admin_url("/user/token"),
                headers={"New-Api-User": str(newapi_user_id)},
            )

        async def _retry_on_429(do_request):
            """遇到 429 时等待 Retry-After 后重试一次"""
            resp = await do_request()
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                logger.warning(f"[NewAPI] 生成 access_token 触发限流，等待 {retry_after}s 后重试")
                await asyncio.sleep(retry_after)
                resp = await do_request()
            return resp

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                # 1. 登录拿 session cookie（带 429 重试）
                login_resp = await _retry_on_429(lambda: _do_login(client))
                try:
                    login_data = login_resp.json()
                except Exception as e:
                    logger.warning(
                        f"[NewAPI] 生成 access_token 登录响应非 JSON (HTTP {login_resp.status_code}): {login_resp.text[:200]}"
                    )
                    return None
                if not login_data.get("success"):
                    logger.warning(f"[NewAPI] 生成 access_token 登录失败: {login_data.get('message')}")
                    return None

                # 2. 生成 access_token（带 429 重试）
                token_resp = await _retry_on_429(lambda: _do_generate_token(client))
                try:
                    token_data = token_resp.json()
                except Exception as e:
                    logger.warning(
                        f"[NewAPI] 生成 access_token 响应非 JSON (HTTP {token_resp.status_code}): {token_resp.text[:200]}"
                    )
                    return None
                if token_data.get("success"):
                    return token_data.get("data")
                logger.warning(f"[NewAPI] 生成 access_token 失败: {token_data.get('message')}")
                return None
        except Exception as e:
            logger.error(f"[NewAPI] generate_access_token 失败: {e}", exc_info=True)
            return None

    async def get_topup_info(self, access_token: str, newapi_user_id: int) -> Dict[str, Any]:
        """获取充值信息（支付方式、金额档位、最低充值等）"""
        return await self._proxy_with_access_token(
            access_token, newapi_user_id, "GET", "/user/topup/info"
        )

    async def get_subscription_plans(self, access_token: str, newapi_user_id: int) -> Dict[str, Any]:
        """获取订阅套餐列表"""
        return await self._proxy_with_access_token(
            access_token, newapi_user_id, "GET", "/subscription/plans"
        )

    async def get_subscription_self(self, access_token: str, newapi_user_id: int) -> Dict[str, Any]:
        """获取当前用户的订阅状态"""
        return await self._proxy_with_access_token(
            access_token, newapi_user_id, "GET", "/subscription/self"
        )

    async def get_topup_history(self, access_token: str, newapi_user_id: int) -> Dict[str, Any]:
        """获取充值历史"""
        return await self._proxy_with_access_token(
            access_token, newapi_user_id, "GET", "/user/topup/self"
        )

    async def request_topup(
        self,
        access_token: str,
        newapi_user_id: int,
        amount: int,
        payment_method: str = "waffo_pancake",
    ) -> Dict[str, Any]:
        """发起充值（调用 New API 的支付接口）

        Args:
            amount: 充值金额（New API 内部单位，与 topup_info.amount_options 一致）
            payment_method: 支付方式（waffo_pancake/waffo/stripe/creem/epay 等）
        """
        if payment_method == "waffo_pancake":
            path = "/user/waffo-pancake/pay"
            body = {"amount": amount}
        elif payment_method == "waffo":
            path = "/user/waffo/pay"
            body = {"amount": amount}
        elif payment_method == "stripe":
            path = "/user/stripe/pay"
            body = {"amount": amount}
        elif payment_method == "creem":
            path = "/user/creem/pay"
            body = {"amount": amount}
        elif payment_method == "epay":
            path = "/user/pay"
            body = {"amount": amount, "payment_method": "epay"}
        else:
            raise NewAPIRequestError(f"不支持的支付方式: {payment_method}")
        return await self._proxy_with_access_token(
            access_token, newapi_user_id, "POST", path, json_body=body,
        )

    async def subscribe_plan(
        self,
        access_token: str,
        newapi_user_id: int,
        plan_id: int,
        payment_method: str = "balance",
    ) -> Dict[str, Any]:
        """购买订阅（余额支付）

        Args:
            plan_id: 订阅套餐 ID（从 get_subscription_plans 获取）
            payment_method: 支付方式（balance=余额支付）
        """
        if payment_method != "balance":
            raise NewAPIRequestError("暂只支持余额支付订阅")
        return await self._proxy_with_access_token(
            access_token, newapi_user_id, "POST", "/subscription/balance/pay",
            json_body={"plan_id": plan_id},
        )

    # ==================== 模型列表 ====================

    async def list_models(
        self,
        user_api_key: str,
        access_token: Optional[str] = None,
        newapi_user_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """获取可用模型列表（含价格）

        使用用户的 API Key 调用 /v1/models 拿模型列表，
        再使用 access_token 调用 /api/pricing 拿真实价格后合并。

        Args:
            user_api_key: 用户的 New API Key（sk-xxx）
            access_token: 用户的 New API access_token（用于 /api/pricing）
            newapi_user_id: 用户的 New API 用户 ID

        Returns:
            模型列表，每个元素含 {id, name, pricing:{input, output}}
        """
        # 1. 取模型列表
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self._v1_url("/models"),
                    headers={"Authorization": f"Bearer {user_api_key}"},
                )
                if resp.status_code != 200:
                    raise NewAPIRequestError(
                        f"获取模型列表失败 (HTTP {resp.status_code})",
                        status_code=resp.status_code,
                        response_text=resp.text[:500],
                    )
                data = resp.json()
                models = data.get("data", []) if isinstance(data, dict) else data
        except (NewAPIAuthError, NewAPIRequestError):
            raise
        except Exception as e:
            logger.error(f"[NewAPI] list_models 请求失败: {e}", exc_info=True)
            raise NewAPIRequestError(f"获取模型列表失败: {e}") from e

        # 2. 取价格（可选，失败不影响列表展示）
        pricing_map: Dict[str, Dict[str, float]] = {}
        group_ratio = 1.0
        quota_per_unit = 500_000
        if access_token and newapi_user_id:
            try:
                pricing_resp = await self._proxy_with_access_token(
                    access_token, newapi_user_id, "GET", "/pricing"
                )
                if pricing_resp.get("success") and isinstance(pricing_resp.get("data"), list):
                    for p in pricing_resp["data"]:
                        if not isinstance(p, dict):
                            continue
                        name = p.get("model_name") or p.get("model", "")
                        if name:
                            pricing_map[name] = p
                    # 取当前用户分组倍率（通常 default）
                    gr = pricing_resp.get("group_ratio")
                    if isinstance(gr, dict) and gr:
                        group_ratio = next(iter(gr.values()), 1.0)
            except Exception as e:
                logger.warning(f"[NewAPI] 获取模型价格失败，将返回零价格: {e}")

        # 3. 合并输出
        result = []
        for m in models:
            if not isinstance(m, dict):
                continue
            model_id = m.get("id") or m.get("name", "")
            if not model_id:
                continue
            price_info = pricing_map.get(model_id, {})
            if price_info:
                model_ratio = float(price_info.get("model_ratio", 0) or 0)
                completion_ratio = float(price_info.get("completion_ratio", 1) or 1)
                # 价格：$/百万 tokens
                input_price = model_ratio * group_ratio / quota_per_unit * 1_000_000
                output_price = model_ratio * completion_ratio * group_ratio / quota_per_unit * 1_000_000
                pricing = {"input": round(input_price, 4), "output": round(output_price, 4)}
            else:
                pricing = {"input": 0, "output": 0}
            result.append({
                "id": model_id,
                "name": m.get("name", model_id),
                "pricing": pricing,
            })
        logger.info(f"[NewAPI] 获取模型列表成功: {len(result)} 个模型")
        return result

    # ==================== 内部工具 ====================

    def _handle_response(self, resp: httpx.Response, op: str) -> Dict[str, Any]:
        """统一处理 Admin API 响应"""
        if resp.status_code == 401:
            raise NewAPIAuthError(f"{op}: Root Token 无效或过期")
        if resp.status_code == 403:
            raise NewAPIAuthError(f"{op}: 无管理员权限")

        try:
            data = resp.json()
        except Exception as e:
            raise NewAPIRequestError(
                f"{op}: 响应非 JSON (HTTP {resp.status_code})",
                status_code=resp.status_code,
                response_text=resp.text[:500],
            ) from e

        # New API 成功响应通常 {success: true, ...}，失败 {success: false, message: ...}
        if isinstance(data, dict) and data.get("success") is False:
            message = data.get("message", "未知错误")
            raise NewAPIRequestError(
                f"{op}: {message}",
                status_code=resp.status_code,
                response_text=str(data)[:500],
            )

        if resp.status_code >= 400:
            raise NewAPIRequestError(
                f"{op}: HTTP {resp.status_code}",
                status_code=resp.status_code,
                response_text=resp.text[:500],
            )

        return data


# 全局单例
newapi_client = NewAPIClient()
