# 墨笔（Novel-Assistant）AI 调用效率优化分析

> 范围：backend/app 下所有用到大模型 / Embedding 的地方
> 结论先行：**当前没有任何 AI 响应缓存、也没有 Prefix/Prompt Caching；长上下文每次完整重发并重计费；限流偏保守且全局信号量会跨用户互相阻塞；子任务没有分流到廉价模型。** 这几点叠加，是 AI 成本与延迟的主要来源。下面按「影响 × 实现成本」排序给出可落地建议。

---

## 一、AI 调用架构速览

| 层 | 文件 | 职责 |
|---|---|---|
| 统一入口 | `services/ai_service.py` (`AIService`) | `generate_text` / `generate_text_stream` / `call_with_json_retry`，自动加载 MCP 工具 |
| Provider 层 | `services/ai_providers/{openai,anthropic,gemini}_provider.py` | 组装 messages，调用 client |
| Client 层 | `services/ai_clients/{openai,anthropic,gemini}_client.py` + `base_client.py` | HTTP 请求、重试、限流、连接池 |
| 业务调用方 | `chapter_regenerator`、`prompt_service`、`plot_analyzer`、`polish`、`outlines`、`wizard_stream`、`short_story_ai_service`、`character_arc_service`、`auto_organization_service`、`cover_generation_service` | 拼装 prompt 并调用 |
| 记忆/检索 | `services/memory_service.py`（ChromaDB + bge-small-zh） | 每次生成前 `build_context_for_generation` 拉相关记忆 |

已具备的良好基础（先肯定，避免误改）：
- HTTP 连接池（`base_client._http_client_pool`，keepalive=50/100）✅
- MCP 工具按实例缓存（`AIService._cached_tools`）✅
- 重试 + 指数退避（`RetryConfig`）✅
- 流式生成已普遍使用 ✅

---

## 二、核心发现（按优先级）

### 🥇 1. 缺少 Prompt 前缀缓存（ROI 最高，零质量风险）
**现状**：`ai_providers/*.py` 每次都把 `system_prompt`（写作风格 + Skill 指令）+ 世界观 + 角色设定 + 记忆上下文完整塞进 messages。全仓搜索 `cache_control|prompt_cache|cached_tokens` **零命中**，说明三家厂商的缓存能力都没用上。

**代价**：写长篇时 system + 世界观 + 角色动辄几千 token，且同一项目内多次调用（章节续写、重写、润色、去味）前缀几乎不变，却每次重新计费、重新 prefill。

**收益**（官方折扣）：
- Anthropic `cache_control`：缓存命中输入 **1/10 价** + 跳过 prefill 延迟
- OpenAI 自动 Prompt Caching：命中前缀 **5 折**
- Gemini Context Caching：缓存 token **约 1/4 价**

**落地**：在 `anthropic_provider.generate / generate_stream` 给静态前缀（system + 世界观 + 角色）的最后一个 content block 加 `{"cache_control": {"type": "ephemeral"}}`；OpenAI 把稳定前缀放在 system/user 开头即可自动命中。注意前缀必须**完全稳定**——变化部分（本章大纲、用户指令）放最后。

> 风险：Anthropic 缓存最小 1024 token、TTL 5min；同一项目前缀稳定即可稳定命中。需把「会变的章节内容」与「不变的世界观/角色」在 prompt 拼接处分开。

---

### 🥇 2. 缺少 AI 响应缓存（去重 / 重生成 / 去味）
**现状**：`generate_text` 每次无条件打 API。`chapter_regenerator.regenerate_with_feedback`（重新生成）、`polish`（AI 去味）、`outlines`（大纲）、`call_with_json_retry`（JSON 解析失败整段重发）都是高重复场景。

**代价**：用户多次「重新生成同一章」「对同段落反复去味」「重试 JSON」都全额付费且等待。

**建议**：在 `AIService` 加一层响应缓存（key = `hash(provider+model+system_prompt+prompt+temperature+max_tokens)`，可选加 `user_id` 隔离）。
- 存储：优先 SQLite（`data/` 已有 `.db`），多实例/分布式再上 Redis。
- TTL：30min~24h，写操作（保存章节）后失效。
- 对 `temperature>0` 的内容生成可只做**短 TTL 或关闭**，但把**结构化输出**（大纲、角色卡、JSON 解析、标签）默认开启缓存——这些对一致性反而更友好。

**收益**：去味/润色/重试类请求命中率极高，直接省 token + 降延迟到毫秒级。

---

### 🥈 3. 限流配置偏保守 + 全局信号量跨用户阻塞
**现状**（`ai_config.py`）：
```python
RateLimitConfig(max_concurrent_requests=5, request_delay=0.2)
```
`base_client._request_with_retry` 里 **每个请求**都在全局信号量内 `await asyncio.sleep(0.2)`。

**代价**：
- 信号量是**全局单例**（`_global_semaphore`），任一 key 的慢请求都会拖住所有用户/所有 key。
- 对自建/NewAPI（本项目大量走 NewAPI）这类高配额端点，`0.2s` 固定延迟 + 并发 5 严重限制吞吐。

**建议**：
- 把信号量改**按 API key 维度**（每个 key 一个 `Semaphore`），避免 A 用户阻塞 B 用户。
- `request_delay` 改为**可配置、且对本地/NewAPI 端点设为 0**；真实 OpenAI/Anthropic 云端再保留小延迟。
- 并发数按 key 的配额动态读取（可先做成配置项，后续从 `429` 自适应）。

---

### 🥈 4. 记忆检索每次多发 Embedding + 多次查询
**现状**（`memory_service.build_context_for_generation`）：每次章节生成串行做 4~5 次 `search_memories`，每次都 `embedding_model.encode(query)`（CPU、bge-small-zh），外加 `get_recent_memories(limit=100)` 再裁到 20。

**代价**：每次正文生成前就白烧 4~5 次 embedding 推理 + 多次 Chroma 查询；长篇小说一章接一章就是几十次无谓 encode。

**建议**：
- 把多次 query 收集后**一次 `encode(list_of_queries)`**（SentenceTransformer 原生支持 batch），一次得到所有向量。
- 多个 `collection.query` 用 `asyncio.gather` 并行。
- `get_recent_memories` 的 `limit=100` 直接降到实际需要的上限（如 20），减少内存拷贝。
- 对**同一章的连续多次生成**（重写/去味同一章）可复用本次构建的 context，避免重复检索。

---

### 🥈 5. 上下文注入无预算控制（小任务也被灌满记忆）
**现状**：无论任务轻重，`build_context_for_generation` 固定拉 `recent(3) + relevant(10) + 全部未完结伏笔 + 角色 + 情节点`，常达 30+ 条记忆文本。

**代价**：对「润色一段 / AI 去味一句话 / 生成标题」这类轻任务，注入 30 条记忆既浪费 token 又可能干扰输出。

**建议**：按任务类型给定 **context token 预算**：
- 轻任务（去味、润色、标题、标签）：只注入 `recent(1~2)`，甚至跳过语义检索。
- 重任务（开新章、重写）：才拉 full context。
- recent 与 relevant 有重叠，做一次去重（`_format_memories` 后按 `id` 去重）再拼接。

---

### 🥉 6. 子任务没有分流到廉价/快速模型
**现状**：全仓搜索 `fast_model|mini|haiku|子任务分流` **零命中**——所有任务（分类、去味检测、标签、标题、角色卡、正文）都用用户配置的同一个主模型。

**建议**（低成本高收益）：引入「路由模型」概念，把低复杂度子任务分流：
- 分类 / 去味判定 / 标签生成 / 标题建议 / 短摘要 → 廉价快模型（如 `gpt-4o-mini` / `claude-haiku` / 本地小模型）。
- 实际小说正文、情节推理、大纲 → 主模型。
- 可在 `AIService` 增加 `generate_text(..., tier="fast"|"smart")` 自动选模型，调用方零改造。

---

### 🥉 7. 可并行的 AI 调用未并行
**现状**：大纲生成、角色弧光分析、灵感建议等多是串行 `await`。`asyncio.gather` 仅见于 MCP facade 内部。

**建议**：彼此无依赖的调用用 `asyncio.gather` 并发，例如：
- 大纲的多卷/多章并行生成（保留顺序再组装）。
- 多角色弧光分析并行。
- 「灵感」多条建议并行生成后去重。

> 注意受第 3 点信号量约束——并行前先解决限流，否则只是把串行瓶颈换成排队瓶颈。

---

### 🥉 8. 工具调用多轮重发全量 prompt（配合 #1 缓解）
**现状**：`_handle_tool_calls` 每轮把 `original_prompt + tool_context` 整段重发；流式侧同理（`openai_provider._generate_with_tools`）。

**代价**：多轮工具调用时输入 token 随轮次线性增长。

**建议**：接入 #1 的前缀缓存后，重发的 `original_prompt`（含稳定前缀）会命中缓存；同时可对 `tool_context` 做截断/`build_tool_context(format="compact")` 控制体积。

---

## 三、优先级矩阵

| # | 优化项 | 成本节省 | 延迟改善 | 实现难度 | 质量风险 |
|---|---|---|---|---|---|
| 1 | Prompt 前缀缓存 | 高 | 高 | 低 | 无 |
| 2 | AI 响应缓存 | 高 | 极高 | 中 | 低（结构化默认开） |
| 3 | 限流/信号量按 key | 中（吞吐） | 中 | 低 | 无 |
| 4 | Embedding 批处理+并行 | 中 | 中 | 低 | 无 |
| 5 | Context 预算控制 | 中 | 中 | 中 | 低 |
| 6 | 子任务模型分流 | 高 | 中 | 中 | 低 |
| 7 | 并行独立调用 | 低 | 中 | 中 | 无 |
| 8 | 工具轮次 token 控制 | 低 | 低 | 低 | 无 |

**推荐实施顺序**：1 → 2 → 3 → 4 → 6 → 5。1/2/4 风险极低且立竿见影，建议先做。

---

## 四、最小可行落地（示意）

**1. 前缀缓存（Anthropic provider 示例）**
```python
# services/ai_providers/anthropic_provider.py
msgs = []
if system_prompt:
    msgs.append({"role": "system", "content": [
        {"type": "text", "text": STABLE_PREFIX},          # 世界观+角色+Skill
        {"type": "text", "text": VARIABLE_SUFFIX,         # 写作风格等
         "cache_control": {"type": "ephemeral"}},
    ]})
msgs.append({"role": "user", "content": prompt})          # 变化部分放最后
```

**2. 响应缓存（AIService 层）**
```python
async def generate_text(self, prompt, **kw):
    key = cache_key(self.api_provider, self.default_model, kw.get("system_prompt"), prompt, ...)
    hit = await response_cache.get(key)
    if hit: return hit
    resp = await prov.generate(...)
    await response_cache.set(key, resp, ttl=...)
    return resp
```

**3. 按 key 信号量**
```python
_semaphores: dict[str, asyncio.Semaphore] = {}
def _sem_for(key): 
    return _semaphores.setdefault(key, asyncio.Semaphore(cfg.max_concurrent_requests))
```

---

## 五、注意与风险
- 前缀缓存要求前缀**字节级稳定**：务必把「会变的世界观编辑」与「稳定的项目设定」分开，编辑世界观后应让缓存自然过期（TTL 5min 足够）。
- 响应缓存对 `temperature=0` 的确定性输出最安全；对创意正文建议短 TTL 或仅结构化任务开启，避免用户觉得「每次重写都一样」。
- 改动集中在 `ai_service.py` / `*_provider.py` / `base_client.py` / `memory_service.py`，不影响前端与业务逻辑，可灰度（先开缓存、再开分流）。
- 部署形态为 Docker/本地 exe，缓存存储用 SQLite 最省事，无需引入新基础设施。

---

## 六、下一步
如果你想，我可以直接挑 **优先级 1+2（前缀缓存 + 响应缓存）** 先落地——这两个改动小、零质量风险、收益最大。也可以先把 `#3 限流/信号量` 和 `#4 Embedding 批处理` 一起做，把生成吞吐拉起来。你定范围，我来改。
