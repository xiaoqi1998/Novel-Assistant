"""复现 base_client.py 中 stream 路径的 bug：return 出 async with 会导致响应被关闭。"""
import asyncio
import httpx
from httpx import ASGITransport


async def sse_app(scope, receive, send):
    body = b"data: chunk1\n\ndata: chunk2\n\ndata: [DONE]\n\n"
    headers = [(b"content-type", b"text/event-stream")]
    await send({"type": "http.response.start", "status": 200, "headers": headers})
    await send({"type": "http.response.body", "body": body, "more_body": False})


class Wrapper:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *exc):
        await self._response.aclose()


async def request_buggy(client, url):
    async with client.stream("POST", url) as response:
        response.raise_for_status()
        return Wrapper(response)


async def request_fixed(client, url):
    req = client.build_request("POST", url)
    response = await client.send(req, stream=True)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError:
        await response.aread()
        await response.aclose()
        raise
    return Wrapper(response)


async def use(name, fn):
    transport = ASGITransport(app=sse_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            async with await fn(client, "http://test/x") as response:
                count = 0
                async for line in response.aiter_lines():
                    count += 1
            print(f"[{name}] OK, read {count} lines")
        except Exception as e:
            print(f"[{name}] ERROR: {type(e).__name__}: {e}")


async def main():
    await use("buggy", request_buggy)
    await use("fixed", request_fixed)


asyncio.run(main())
