"""AI 动作用途常量 - 按行为动作分配不同 AI 模型

每个 usage 值对应一类 AI 调用动作，用户（订阅用户）可在系统设置里为每个动作
指定不同的 API 预设；非订阅用户所有动作一律使用默认模型（NEW_API_DEFAULT_MODEL）。

前端与后端共用本清单。新增动作只需在 AI_USAGES 中追加条目。
"""

# 动作分组（用于前端排版）
GROUP_CORE = "core"        # 核心创作
GROUP_ASSIST = "assist"    # 辅助生成
GROUP_ANALYSIS = "analysis"  # 分析类

# usage 值 → (中文名, 分组, 说明)
AI_USAGES = {
    "default": ("默认配置", GROUP_CORE, "未单独配置的动作均使用此配置"),
    "chapter_generation": ("章节正文生成", GROUP_CORE, "生成章节正文，主力消耗"),
    "chapter_regeneration": ("整章重新生成", GROUP_CORE, "基于反馈重写整章"),
    "partial_rewrite": ("局部重写", GROUP_CORE, "选区重写 / 一键改进"),
    "outline": ("大纲生成", GROUP_CORE, "生成 / 重生成大纲"),
    "wizard": ("向导生成", GROUP_CORE, "智能向导生成大纲、角色、世界观"),
    "short_story": ("短故事生成", GROUP_CORE, "一键生成短篇故事"),
    "polish": ("AI 去味 / 润色", GROUP_ASSIST, "去除 AI 味、润色改写"),
    "inspiration": ("灵感建议", GROUP_ASSIST, "生成灵感与情节建议"),
    "character": ("角色卡生成", GROUP_ASSIST, "生成角色资料"),
    "character_arc": ("角色弧光分析", GROUP_ASSIST, "分析角色成长弧光"),
    "career": ("职业生成", GROUP_ASSIST, "生成职业信息"),
    "organization": ("组织生成", GROUP_ASSIST, "生成组织 / 门派"),
    "writing_style": ("写作风格", GROUP_ASSIST, "分析 / 生成写作风格"),
    "chapter_analysis": ("章节内容分析", GROUP_ANALYSIS, "分析章节质量并反馈"),
    "full_review": ("全文审查", GROUP_ANALYSIS, "整书一致性审查"),
    "book_import": ("拆书导入", GROUP_ANALYSIS, "导入外部书籍并解析"),
    "tianming": ("天命", GROUP_ANALYSIS, "天命相关 AI 调用"),
}

# 分组中文名
GROUP_LABELS = {
    GROUP_CORE: "核心创作",
    GROUP_ASSIST: "辅助生成",
    GROUP_ANALYSIS: "分析类",
}

# 分组顺序
GROUP_ORDER = [GROUP_CORE, GROUP_ASSIST, GROUP_ANALYSIS]


def get_usage_label(usage: str) -> str:
    """获取动作中文名"""
    info = AI_USAGES.get(usage)
    return info[0] if info else usage


def all_usage_keys() -> list:
    """全部动作 usage 值（含 default）"""
    return list(AI_USAGES.keys())


def configurable_usage_keys() -> list:
    """可配置动作（不含 default，default 即主配置本身）"""
    return [k for k in AI_USAGES if k != "default"]


def usage_list_for_frontend() -> list:
    """前端用的分组列表结构"""
    groups = {}
    for usage, (label, group, desc) in AI_USAGES.items():
        groups.setdefault(group, []).append({
            "usage": usage,
            "label": label,
            "description": desc,
        })
    return [
        {"group": g, "group_label": GROUP_LABELS[g], "actions": groups.get(g, [])}
        for g in GROUP_ORDER
        if groups.get(g)
    ]
