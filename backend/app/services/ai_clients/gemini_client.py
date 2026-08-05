"""Gemini 客户端"""
import asyncio
from typing import Any, AsyncGenerator, Dict, List, Optional
import httpx
from app.services.ai_config import AIClientConfig, default_config
from app.services.ai_clients.base_client import friendly_network_error_message
from app.logger import get_logger

logger = get_logger(__name__)


class GeminiClient:
    """Google Gemini API 客户端"""

    def __init__(self, api_key: str, base_url: Optional[str] = None, config: Optional[AIClientConfig] = None):
        self.api_key = api_key
        self.base_url = (base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        self.config = config or default_config
        http_cfg = self.config.http
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=http_cfg.connect_timeout,
                read=http_cfg.read_timeout,
                write=http_cfg.write_timeout,
                pool=http_cfg.pool_timeout
            )
        )

    def _convert_tools_to_gemini(self, tools: list) -> list:
        """将 OpenAI 格式工具转换为 Gemini 格式"""
        gemini_tools = []
        for tool in tools:
            if tool.get("type") == "function":
                func = tool["function"]
                params = func.get("parameters", {}).copy() if func.get("parameters") else {}
                params.pop("$schema", None)
                params.pop("additionalProperties", None)
                if params and "type" not in params:
                    params["type"] = "object"
                decl = {
                    "name": func["name"],
                    "description": func.get("description") or func["name"],
                }
                if params:
                    decl["parameters"] = params
                gemini_tools.append(decl)
        return [{"functionDeclarations": gemini_tools}] if gemini_tools else []

    async def chat_completion(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        system_prompt: Optional[str] = None,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}/models/{model}:generateContent?key={self.api_key}"
        
        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
        
        payload = {
            "contents": contents,
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        if tools:
            payload["tools"] = self._convert_tools_to_gemini(tools)

        response = await self.client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        
        candidates = data.get("candidates", [])
        if not candidates or len(candidates) == 0:
            # 返回空内容而不是报错，保持流程继续
            return {
                "content": "",
                "tool_calls": None,
                "finish_reason": "stop"
            }
        
        parts = candidates[0].get("content", {}).get("parts", [])
        text = ""
        tool_calls = []
        
        for part in parts:
            if "text" in part:
                text += part["text"]
            elif "functionCall" in part:
                fc = part["functionCall"]
                tool_calls.append({
                    "id": f"call_{fc['name']}",
                    "type": "function",
                    "function": {"name": fc["name"], "arguments": fc.get("args", {})}
                })
        
        usage = data.get("usageMetadata") or {}
        prompt_tokens = usage.get("promptTokenCount")
        completion_tokens = usage.get("candidatesTokenCount")
        total_tokens = usage.get("totalTokenCount")
        return {
            "content": text,
            "tool_calls": tool_calls if tool_calls else None,
            "finish_reason": "tool_calls" if tool_calls else "stop",
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }
        }

    async def chat_completion_stream(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        system_prompt: Optional[str] = None,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成，支持工具调用
        
        Yields:
            Dict with keys:
            - content: str - 文本内容块
            - tool_calls: list - 工具调用列表（如果有）
            - done: bool - 是否结束
        """
        url = f"{self.base_url}/models/{model}:streamGenerateContent?key={self.api_key}&alt=sse"
        
        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
        
        payload = {
            "contents": contents,
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        if tools:
            payload["tools"] = self._convert_tools_to_gemini(tools)

        retry_cfg = self.config.retry
        max_attempts = max(1, retry_cfg.max_retries)
        yielded_any = False  # 是否已向调用方输出过内容（输出后不可重试，避免内容重复）

        for attempt in range(1, max_attempts + 1):
            completed = False
            try:
                async with self.client.stream("POST", url, json=payload) as response:
                    response.raise_for_status()
                    try:
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                data_str = line[6:]
                                if data_str.strip() == "[DONE]":
                                    completed = True
                                    break
                                import json
                                try:
                                    data = json.loads(data_str)
                                    usage = data.get("usageMetadata") or {}
                                    if usage:
                                        yielded_any = True
                                        yield {
                                            "usage": {
                                                "prompt_tokens": usage.get("promptTokenCount"),
                                                "completion_tokens": usage.get("candidatesTokenCount"),
                                                "total_tokens": usage.get("totalTokenCount"),
                                            }
                                        }
                                    candidates = data.get("candidates", [])
                                    if candidates and len(candidates) > 0:
                                        finish_reason = candidates[0].get("finishReason")
                                        parts = candidates[0].get("content", {}).get("parts", [])
                                        if parts and len(parts) > 0:
                                            text = ""
                                            function_calls = []
                                            for part in parts:
                                                if "text" in part:
                                                    text += part["text"]
                                                elif "functionCall" in part:
                                                    fc = part["functionCall"]
                                                    function_calls.append({
                                                        "id": f"call_{fc['name']}",
                                                        "type": "function",
                                                        "function": {
                                                            "name": fc["name"],
                                                            "arguments": fc.get("args", {})
                                                        }
                                                    })

                                            if text:
                                                yielded_any = True
                                                yield {"content": text}
                                            if function_calls:
                                                yielded_any = True
                                                yield {"tool_calls": function_calls}
                                        if finish_reason == "STOP":
                                            completed = True
                                            break
                                except json.JSONDecodeError:
                                    continue
                    except GeneratorExit:
                        # 生成器被关闭，这是正常的清理过程
                        logger.debug("Gemini 流式响应生成器被关闭(GeneratorExit)")
                        raise
                    except Exception as iter_error:
                        logger.error(f"Gemini 流式响应迭代出错: {str(iter_error)}")
                        raise
            except GeneratorExit:
                # 重新抛出GeneratorExit，让调用方处理
                raise
            except httpx.TransportError as e:
                # 上游中途断开（如 incomplete chunked read）：未输出内容时可重试，已输出则报错
                if not yielded_any and attempt < max_attempts:
                    delay = min(
                        retry_cfg.base_delay * (retry_cfg.exponential_base ** attempt),
                        retry_cfg.max_delay,
                    )
                    logger.warning(
                        "⚠️ Gemini 流式响应中途断开(未产出内容)，第 %s/%s 次重试，等待 %.1fs: %s",
                        attempt, max_attempts, delay, str(e) or type(e).__name__,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error(f"Gemini 流式请求网络中断: {type(e).__name__}: {str(e)}")
                raise type(e)(friendly_network_error_message(e)) from e
            except Exception as e:
                logger.error(f"Gemini 流式请求出错: {str(e)}")
                raise

            if completed:
                yield {"done": True}
                return
            # 未收到明确结束信号：未产出内容时可重试，否则按已接收内容处理
            if not yielded_any and attempt < max_attempts:
                logger.warning("⚠️ Gemini 流式响应未收到结束信号，第 %s/%s 次重试", attempt, max_attempts)
                continue
            logger.warning("Gemini 流式响应未收到结束信号，按已接收内容处理")
            yield {"done": True}
            return