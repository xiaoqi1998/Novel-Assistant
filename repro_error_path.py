"""复现 DeepSeek 场景：流式请求返回 HTTP 错误时，外层 except 访问 .text 触发 ResponseNotRead。"""
import asyncio
import httpx
from httpx import ASGITransport


async def error_app(scope, receive, send):
    body = b'{"error":{"message":"rate limited","code":429}}'
    headers = [(b"content-type", b"application/json")]
    await send({"type": "http.response.start", "status": 429, "headers": headers})
    await send({"type": "http.response.body", "body": body, "more_body": False})


class Wrapper:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *exc):
        await self._response.aclose()


# 模拟当前 base_client 的 stream 分支 + 外层 except 访问 .text
async def request_buggy(client, url):
    try:
        async with client.stream("POST", url) as response:
            try:
                response.raise_for_status()
                return Wrapper(response)
            except httpx.HTTPStatusError:
                # 流分支：raise 后 async with 退出 → aclose()
                raise
    except httpx.HTTPStatusError as e:
        # 外层 except：访问 e.response.text（模拟 safe_preview / _log_raw_response_body）
        preview = e.response.text  # <- 这里会抛 ResponseNotRead
        print(f"[buggy] 外层看到 body: {preview[:60]!r}")
        raise


async def main():
    transport = ASGITransport(app=error_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            async with await request_buggy(client, "http://test/x") as r:
                async for line in r.aiter_lines():
                    pass
        except Exception as e:
            print(f"[buggy] 最终异常: {type(e).__name__}: {e}")


asyncio.run(main())
