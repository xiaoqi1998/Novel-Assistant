"""New API 相关异常定义

用于在 AI 调用链路中区分"额度不足"等业务异常，便于上层接口返回标准化错误响应。
"""


class QuotaExhaustedError(Exception):
    """New API 额度不足

    当 New API 返回 402 Payment Required 或 quota is not enough 时抛出。
    章节生成等上层接口捕获此异常后，向用户返回"额度已用完，请充值"提示。
    """

    def __init__(self, message: str = "您的 AI 写作额度已用完，请前往个人中心充值后再继续使用。"):
        super().__init__(message)
        self.message = message


class NewAPIAuthError(Exception):
    """New API 认证失败（Root Token 无效或过期）"""

    def __init__(self, message: str = "New API 认证失败，请检查 Root Token 配置"):
        super().__init__(message)
        self.message = message


class NewAPIRequestError(Exception):
    """New API 请求失败（网络错误、5xx、响应解析失败等）"""

    def __init__(self, message: str = "New API 请求失败", status_code: int = None, response_text: str = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response_text = response_text


class NewAPIDisabledError(Exception):
    """New API 功能未启用（未配置 Root Token）"""

    def __init__(self, message: str = "New API 中转网关未启用"):
        super().__init__(message)
        self.message = message
