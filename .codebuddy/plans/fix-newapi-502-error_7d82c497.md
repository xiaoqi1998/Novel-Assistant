---
name: fix-newapi-502-error
overview: 修复AI调用持续返回502 Bad Gateway的问题。根因是用户Settings中api_base_url指向new-api网关（http://new-api:3000/v1），而该网关的上游渠道配置异常或容器不可达。需要从配置层面修复，并提供诊断工具定位具体问题。
todos:
  - id: remote-diagnose
    content: SSH远程诊断new-api网关连通性，测试chuan.click与容器内地址
    status: completed
  - id: fix-db-config
    content: 通过SQL将用户Settings中失效的api_base_url更新为可用端点
    status: completed
    dependencies:
      - remote-diagnose
  - id: fix-frontend-default
    content: 修改Settings.tsx默认api_base_url为可用地址
    status: completed
    dependencies:
      - remote-diagnose
  - id: add-diagnose-script
    content: 新增backend/scripts/diagnose_ai.py连通性诊断脚本
    status: completed
  - id: verify-and-deploy
    content: 部署验证AI调用恢复正常，确认章节分析成功
    status: completed
    dependencies:
      - fix-db-config
      - fix-frontend-default
---

## 用户需求

用户后端日志显示所有 AI 请求到 `http://new-api:3000/v1/chat/completions` 均返回 502 Bad Gateway，响应体为 new-api 网关包装的上游错误 `{"error":{"message":"openai_error","type":"bad_response_status_code"}}`，导致章节分析（plot_analyzer）3 次重试后全部失败、批量生成中断。用户希望解决该 502 问题，恢复 AI 调用正常。

## 产品概述

本任务为线上故障修复，目标是恢复 AI 调用链路连通性。需从网关诊断、配置修正、默认值和诊断工具四个层面入手，确保用户 Settings 中的 `api_base_url` 指向可用端点，且前端默认值不再误导用户配置失效网关地址。

## 核心功能

- 远程诊断 new-api 网关（chuan.click 及容器内地址）的可用性与渠道健康状态
- 修正用户数据库中失效的 `api_base_url` 配置，回退至可用端点
- 修正前端 Settings 默认值，避免新用户误配不可达地址
- 提供可复用的 AI 连通性诊断脚本，便于后续快速排障

## 技术栈

- 后端：Python (FastAPI) + httpx + SQLAlchemy (Async)
- 前端：React + TypeScript + Ant Design
- 部署：Docker / 1Panel，远程服务器 `root@43.255.122.252`，应用容器 `novel-assistant`，数据库为 PostgreSQL 容器 `1Panel-postgresql-QDKg`（库 `mumuai_novel`）
- 网关：new-api（One API 中转网关），当前 `.env` 配置 `NEW_API_BASE_URL=https://chuan.click`，前端默认 `http://new-api:3000/v1`

## 实现方案

### 总体策略

502 源于 new-api 网关向上游转发失败（上游 Key 失效/余额不足/模型不存在/容器不可达）。修复策略分三步：

1. **诊断**：SSH 远程进入应用容器，用 curl 分别测试 `https://chuan.click/v1`（.env 配置的公网地址）和 `http://new-api:3000/v1`（前端默认容器内地址）的非流式与流式连通性，确认哪个端点可用。
2. **修正配置**：若容器内 `new-api:3000` 不可达但 `chuan.click` 可用，则通过 SQL 将用户 Settings 表中 `api_base_url` 字段批量更新为 `https://chuan.click/v1`；若两者皆不可用，则改用直连上游（如 `https://api.deepseek.com/v1`）。
3. **代码修正**：将前端 `Settings.tsx` 默认值从 `http://new-api:3000/v1` 改为从环境变量或 `.env` 读取的可用地址；新增诊断脚本。

### 关键技术决策

- **不修改重试逻辑**：当前 3×3×3=27 次重试是合理的韧性设计，502 是持续性故障不应靠重试解决，应从根源修正端点。
- **优先使用 chuan.click**：`.env` 已配置 `NEW_API_BASE_URL=https://chuan.click` 且 `NEW_API_ENABLED=true`，说明公网网关是预期路径，应统一到该地址。
- **数据库修正用 SQL 而非代码迁移**：单次运维操作，直接 `docker exec` PostgreSQL 执行 UPDATE 更高效，避免引入不必要的迁移文件。

### 性能与可靠性

- 诊断脚本使用 `stream:false` 先验证基础连通性，再测流式，避免长连接占用。
- SQL 更新加 `WHERE api_base_url LIKE '%new-api:3000%'` 条件，避免误改已正确的配置。
- 修改前端默认值不影响已存用户数据，仅对新用户生效，无破坏性。

## 实现注意事项

- 远程操作必须走 SSH 免密（`deploy.ps1` 配置），操作 PostgreSQL 需 `docker exec -i 1Panel-postgresql-QDKg psql` 并加 `-i` 传入 SQL。
- 修改用户配置前先 `SELECT` 确认当前值，避免盲目覆盖。
- 前端默认值修改后需重新构建前端镜像并热部署。
- 诊断脚本放在 `backend/scripts/` 下，复用现有 `ai_config.py` 的超时配置。

## 架构设计

```
用户配置(Settings.api_base_url)
    └─ AIService → OpenAIClient → httpx → 网关/上游
问题点：api_base_url = http://new-api:3000/v1 (容器内地址，远程不可达)
修复后：api_base_url = https://chuan.click/v1 (公网网关，.env已配置)
```

## 目录结构

```
backend/
├── app/
│   ├── api/
│   │   └── settings.py          # [MODIFY] 第158行前端默认值 http://new-api:3000/v1 → 读取可用地址
│   └── config.py                # [REFERENCE] 确认 NEW_API_BASE_URL 默认值，不改
├── scripts/
│   └── diagnose_ai.py           # [NEW] AI连通性诊断脚本，测试指定base_url的流式/非流式请求
└── .env                         # [REFERENCE] NEW_API_BASE_URL=https://chuan.click 已正确

frontend/
└── src/
    └── pages/
        └── Settings.tsx         # [MODIFY] 第158行默认 api_base_url 改为从配置或环境变量获取
```

## 关键代码结构

无需新增复杂接口，诊断脚本核心逻辑：

```python
async def test_endpoint(base_url: str, api_key: str, model: str):
    # 1. 非流式测试 stream=False
    # 2. 流式测试 stream=True，验证 [DONE] 正常接收
    # 返回 (ok: bool, detail: str)
```