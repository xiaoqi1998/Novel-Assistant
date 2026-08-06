"""OpenAI 客户端"""
import asyncio
import json
from typing import Any, AsyncGenerator, Dict, Optional

import httpx

from app.logger import get_logger, summarize_log_value, safe_preview
from .base_client import BaseAIClient, friendly_network_error_message, _log_raw_response_body

logger = get_logger(__name__)

# 工具参数 schema 中需要递归剔除的字段
_SCHEMA_FORBIDDEN_KEYS = ("$schema", "$defs", "definitions", "$ref", "$dynamicRef", "$id")


def _clean_schema_node(node: Any) -> Any:
    """递归清理 JSON Schema 中不被上游模型网关接受的字段。"""
    if isinstance(node, dict):
        return {
            k: _clean_schema_node(v)
            for k, v in node.items()
            if k not in _SCHEMA_FORBIDDEN_KEYS
        }
    if isinstance(node, list):
        return [_clean_schema_node(v) for v in node]
    return node


def _normalize_tool_parameters(parameters: Any) -> Dict[str, Any]:
    """规范化工具参数 schema，确保是合法的 object 类型且无非法字段。"""
    if not isinstance(parameters, dict):
        return {"type": "object", "properties": {}, "required": []}
    cleaned = _clean_schema_node(parameters)
    cleaned.setdefault("type", "object")
    properties = cleaned.get("properties")
    if not isinstance(properties, dict) or not properties:
        cleaned["properties"] = {}
        # 没有属性时不允许声明 required，否则网关可能报 400
        cleaned.pop("required", None)
    return cleaned


def _message_content_length(content: Any) -> int:
    if content is None:
        return 0
    if isinstance(content, str):
        return len(content)
    return len(json.dumps(content, ensure_ascii=False, default=str))


def _log_request_summary(payload: Dict[str, Any]) -> None:
    messages = payload.get("messages") or []
    message_chars = sum(_message_content_length(message.get("content")) for message in messages if isinstance(message, dict))
    logger.debug(
        "📤 OpenAI 请求摘要: model=%s, messages=%s, message_chars=%s, tools=%s, stream=%s, max_tokens=%s",
        payload.get("model"),
        len(messages),
        message_chars,
        len(payload.get("tools") or []),
        bool(payload.get("stream")),
        payload.get("max_tokens"),
    )


def _log_response_summary(data: Dict[str, Any]) -> None:
    choices = data.get("choices") or []
    first_choice = choices[0] if choices else {}
    message = first_choice.get("message") or {}
    content = message.get("content") or ""
    tool_calls = message.get("tool_calls") or []
    usage = data.get("usage") or {}
    logger.debug(
        "📥 OpenAI 响应摘要: choices=%s, finish_reason=%s, content_length=%s, tool_calls=%s, usage=%s",
        len(choices),
        first_choice.get("finish_reason"),
        len(content) if isinstance(content, str) else _message_content_length(content),
        len(tool_calls),
        summarize_log_value(usage),
    )


class OpenAIClient(BaseAIClient):
    """OpenAI API 客户端"""

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _build_payload(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
        stream: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        # temperature 兼容处理：
        # 1. Claude 系列（含经 OpenAI 兼容网关转发的 claude-*）不接受非默认 temperature，
        #    传 0.7 等值会被网关 400 拒绝，必须省略（使用模型默认值 1）。
        # 2. temperature 为 None 或 == 1.0 时省略，等价于模型默认值，减少不必要参数。
        _is_claude = model.lower().startswith("claude")
        if temperature is not None and temperature != 1.0 and not _is_claude:
            payload["temperature"] = temperature
        elif _is_claude and temperature is not None and temperature != 1.0:
            logger.info("🔄 模型 %s 不支持非默认 temperature，已省略该参数（使用模型默认值 1）", model)
        if stream:
            payload["stream"] = True
        if tools:
            # 深度清理 MCP 工具参数 schema 中的非法字段（如 $schema/$ref/definitions 等）
            cleaned = []
            for t in tools:
                tc = dict(t)
                func = tc.get("function")
                if isinstance(func, dict):
                    tc["function"] = dict(func)
                    if "parameters" in tc["function"]:
                        tc["function"]["parameters"] = _normalize_tool_parameters(
                            tc["function"]["parameters"]
                        )
                cleaned.append(tc)
            payload["tools"] = cleaned
            if tool_choice:
                # 部分上游/模型（如 qwen3.7-max via micuapi.ai）不支持 "required" 强制工具选择，
                # 会返回 400。降级为 "auto" 以兼容（auto 仍能触发工具调用）。
                if tool_choice == "required":
                    logger.warning(
                        "⚠️ tool_choice='required' 不被上游支持，降级为 'auto' 以避免 400"
                    )
                    tool_choice = "auto"
                payload["tool_choice"] = tool_choice
            # 记录实际发送的工具结构，便于排查上游 400（如某工具 schema 非法）
            tool_summary = []
            for t in cleaned:
                fn = t.get("function", {})
                params = fn.get("parameters", {})
                tool_summary.append({
                    "name": fn.get("name"),
                    "param_type": params.get("type"),
                    "required": params.get("required"),
                    "prop_keys": list((params.get("properties") or {}).keys())[:10],
                    "has_forbidden": any(
                        k in str(params) for k in ("$ref", "definitions", "$dynamicRef")
                    ),
                })
            logger.warning(
                "📤 发送工具列表(%d): tool_choice=%s 结构=%s",
                len(cleaned), tool_choice, safe_preview(str(tool_summary), 2000),
            )
        return payload

    async def chat_completion(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = self._build_payload(messages, model, temperature, max_tokens, tools, tool_choice)
        
        _log_request_summary(payload)
        
        data = await self._request_with_retry("POST", "/chat/completions", payload)
        
        _log_response_summary(data)

        choices = data.get("choices", [])
        if not choices or len(choices) == 0:
            raise ValueError("API 返回空 choices 或 choices 为空列表")

        choice = choices[0]
        message = choice.get("message", {})
        usage = data.get("usage") or {}
        return {
            "content": message.get("content", ""),
            "tool_calls": message.get("tool_calls"),
            "finish_reason": choice.get("finish_reason"),
            "usage": {
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
            },
        }

    async def chat_completion_stream(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
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
        payload = self._build_payload(messages, model, temperature, max_tokens, tools, tool_choice, stream=True)

        retry_cfg = self.config.retry
        max_attempts = max(1, retry_cfg.max_retries)
        yielded_any = False  # 是否已向调用方输出过内容（输出后不可重试，避免内容重复）

        for attempt in range(1, max_attempts + 1):
            tool_calls_buffer = {}  # 收集工具调用块
            completed = False
            try:
                async with await self._request_with_retry("POST", "/chat/completions", payload, stream=True) as response:
                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as status_err:
                        # 流式分支的异常在 base_client 之外抛出，需在此补记上游真实错误体
                        if status_err.response is not None:
                            logger.error(
                                "🚨 流式请求上游状态错误: status=%s body_preview=%s",
                                status_err.response.status_code,
                                safe_preview(status_err.response.text, 1000),
                            )
                            _log_raw_response_body(status_err.response, "http_status_error_stream")
                        raise
                    try:
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                data_str = line[6:]
                                if data_str.strip() == "[DONE]":
                                    # 流结束，检查是否有工具调用需要处理
                                    if tool_calls_buffer:
                                        yield {"tool_calls": list(tool_calls_buffer.values()), "done": True}
                                    yield {"done": True}
                                    completed = True
                                    break
                                try:
                                    data = json.loads(data_str)
                                    choices = data.get("choices", [])
                                    if choices and len(choices) > 0:
                                        delta = choices[0].get("delta", {})
                                        content = delta.get("content", "")

                                        # 检查工具调用
                                        tc_list = delta.get("tool_calls")
                                        if tc_list:
                                            for tc in tc_list:
                                                index = tc.get("index", 0)
                                                if index not in tool_calls_buffer:
                                                    tool_calls_buffer[index] = tc
                                                else:
                                                    existing = tool_calls_buffer[index]
                                                    # 合并 function.arguments
                                                    if "function" in tc and "function" in existing:
                                                        if tc["function"].get("arguments"):
                                                            existing["function"]["arguments"] = (
                                                                existing["function"].get("arguments", "") +
                                                                tc["function"]["arguments"]
                                                            )

                                        usage = data.get("usage")
                                        if usage:
                                            yielded_any = True
                                            yield {
                                                "usage": {
                                                    "prompt_tokens": usage.get("prompt_tokens"),
                                                    "completion_tokens": usage.get("completion_tokens"),
                                                    "total_tokens": usage.get("total_tokens"),
                                                }
                                            }

                                        if content:
                                            yielded_any = True
                                            yield {"content": content}

                                except json.JSONDecodeError:
                                    continue
                    except GeneratorExit:
                        # 生成器被关闭，这是正常的清理过程
                        logger.debug("流式响应生成器被关闭(GeneratorExit)")
                        raise
                    except httpx.TransportError:
                        # 流式读取中途上游断开（如 incomplete chunked read），交给外层决定重试或报错
                        raise
                    except Exception as iter_error:
                        logger.error(f"流式响应迭代出错: {str(iter_error)}")
                        raise
            except GeneratorExit:
                # 重新抛出GeneratorExit，让调用方处理
                raise
            except httpx.TransportError as e:
                # 上游中途断开：未输出过任何内容时可安全重试；已输出则报错避免内容重复
                if not yielded_any and attempt < max_attempts:
                    delay = min(
                        retry_cfg.base_delay * (retry_cfg.exponential_base ** attempt),
                        retry_cfg.max_delay,
                    )
                    logger.warning(
                        "⚠️ 流式响应中途断开(未产出内容)，第 %s/%s 次重试，等待 %.1fs: %s",
                        attempt, max_attempts, delay, str(e) or type(e).__name__,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error(f"流式请求网络中断: {type(e).__name__}: {str(e)}")
                raise type(e)(friendly_network_error_message(e)) from e
            except Exception as e:
                logger.error(f"流式请求出错: {str(e)}")
                raise

            if completed:
                return
            # 上游未发送 [DONE] 就结束了（部分代理会静默关连接）：未产出内容时可重试
            if not yielded_any and attempt < max_attempts:
                logger.warning("⚠️ 流式响应未收到 [DONE] 即结束，第 %s/%s 次重试", attempt, max_attempts)
                continue
            logger.warning("流式响应未收到 [DONE] 即结束，按已接收内容处理")
            if tool_calls_buffer:
                yield {"tool_calls": list(tool_calls_buffer.values()), "done": True}
            yield {"done": True}
            return
