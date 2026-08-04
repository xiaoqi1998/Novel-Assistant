"""MCP 插件默认预设配置（小说创作场景）

新用户首次访问 MCP 插件管理（插件列表为空）时，自动初始化这套默认插件。
也可通过 POST /mcp/plugins/restore-defaults 手动恢复。

预设围绕小说创作的实际需求：
- 资料搜索与网页提取（历史背景/职业细节/地理风物查证）
- 公开知识库检索

说明：
- enabled=True 的插件免密钥开箱即用
- enabled=False 的插件需要用户自行申请免费 API Key 后编辑 URL 再启用
"""
from typing import Any

# 默认插件预设列表（按 sort_order 顺序创建）
DEFAULT_MCP_PRESETS: list[dict[str, Any]] = [
    {
        "plugin_name": "tavily",
        "display_name": "Tavily 搜索与资料研究",
        "description": (
            "写作资料核心工具：联网搜索历史背景/职业细节/地理风物，"
            "还能直接提取网页正文、爬取站点、综合研究。"
            "免费申请 API Key：https://tavily.com （每月1000次免费额度），"
            "注册后编辑本插件地址，将 YOUR_TAVILY_API_KEY 替换为你的 Key（形如 tvly-xxx），再启用。"
        ),
        "plugin_type": "streamable_http",
        "server_url": "https://mcp.tavily.com/mcp/?tavilyApiKey=YOUR_TAVILY_API_KEY",
        "headers": {},
        "category": "search",
        "sort_order": 1,
        "enabled": False,
    },
    {
        "plugin_name": "deepwiki",
        "display_name": "DeepWiki 知识库检索",
        "description": (
            "免密钥开箱即用：检索公开知识库与开源项目资料，"
            "写科技/行业题材时可查证技术细节与实现原理。"
        ),
        "plugin_type": "streamable_http",
        "server_url": "https://mcp.deepwiki.com/mcp",
        "headers": {},
        "category": "search",
        "sort_order": 2,
        "enabled": True,
    },
    {
        "plugin_name": "context7",
        "display_name": "Context7 最新资料查询",
        "description": (
            "免密钥开箱即用：获取各领域库/框架的最新官方文档，"
            "写现实题材时可用于查证最新规则与资料。"
        ),
        "plugin_type": "streamable_http",
        "server_url": "https://mcp.context7.com/mcp",
        "headers": {},
        "category": "api",
        "sort_order": 3,
        "enabled": True,
    },
]
