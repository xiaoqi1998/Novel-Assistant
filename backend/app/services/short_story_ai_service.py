"""短故事AI生成服务"""
import json
from typing import Optional
from app.services.ai_service import AIService
from app.services.json_helper import clean_json_response
from app.logger import get_logger

logger = get_logger(__name__)


# ============ Prompt 模板 ============

LOGLINE_SYSTEM = """你是短故事爆款选题专家。
根据用户的故事设定，生成6个一句话梗概。

爆款选题公式：极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念
三大黄金赛道：打脸复仇类、悬疑怪谈类、极致痛感类

每个梗概必须包含：主角+困境+反转+情绪落点，一句话说清爆点。
必须直击大众人性痛点（贪婪、背叛、嫉妒、爽快、感动），切忌平淡/小资/散文化。

返回JSON格式：{"options": ["梗概1", "梗概2", ...]}"""

LOGLINE_USER = """故事标题：{title}
情绪目标：{emotion_goal}
题材：{genre}
用户想法：{user_idea}

请生成6个一句话梗概，每个不超过100字。"""

TWIST_SYSTEM = """你是短故事反转设计专家。
根据故事设定，生成6组核心反转设计。

反转类型：身份反转、视角反转、动机反转、时间线反转。
反转必须出人意料但逻辑自洽，要有至少3个铺垫线索。

返回JSON格式：
{{"options": [
  {{"twist_type": "身份反转", "twist_content": "反转内容描述", "clues": ["线索1", "线索2", "线索3"]}},
  ...
]}}"""

TWIST_USER = """故事标题：{title}
一句话梗概：{logline}
情绪目标：{emotion_goal}

请生成6组核心反转设计，每组包含反转类型、反转内容和3个铺垫线索。"""

SEGMENT_SYSTEM = """你是短故事创作专家，精通黄金结构写作法。
根据故事设定和当前段落，生成短故事正文。

黄金结构原则：
- Hook（开头5%）：不写铺垫，第一句将读者推入冲突现场
- Escalation（冲突激化20%）：反派嚣张主角劣势，压抑读者情绪
- Climax（绝地反击60%）：剥洋葱式揭露真相，打一下→反派反扑→再揭露
- Resolution（收尾15%）：反派惨烈下场，主角走向新人生

写作要求：
- 每1000-1500字有一次小冲突或小揭秘
- 超过500字的纯说明性废话必须删掉
- 台词必须像真人说话，删除排比句和空洞形容词
- 每句台词必须具备暴露阴谋或推进爽点的功能
- 人设高度标签化

直接输出正文内容，不要加任何解释说明或标记。"""

SEGMENT_USER = """故事标题：{title}
一句话梗概：{logline}
情绪目标：{emotion_goal}
核心反转：{twist_content}
反转类型：{twist_type}
铺垫线索：{clues}
人设速写：{characters}
目标平台：{target_platform}
目标总字数：{target_words}

当前要写的段落：{segment_label}
本段目标字数：{segment_target_words}字
本段写作要点：{segment_desc}

{context_hint}

请直接输出本段正文内容（约{segment_target_words}字），不要输出任何其他内容。"""

POLISH_SYSTEM = """你是短故事精修专家。
根据自查清单对正文进行精修润色。

精修原则：
1. 开头查验：前300字必须出现核心矛盾，删掉铺垫背景
2. 废话查验：超过3行无意义的环境/心理描写全部删掉
3. 卡点查验：每段结尾勾住读者
4. 去AI味查验：台词口语化，删除排比句和空洞形容词
5. 情绪曲线：每1000-1500字有一次小冲突
6. 人设查验：角色标签化，一眼认清阵营
7. 对话查验：每句台词必须具备暴露阴谋或推进爽点的功能

直接输出精修后的完整正文，不要加任何解释。"""

POLISH_USER = """以下是短故事正文，请按照精修原则进行润色：

=== 故事设定 ===
标题：{title}
情绪目标：{emotion_goal}
核心反转：{twist_content}

=== 正文 ===
{content}

请直接输出精修后的完整正文。"""


# ============ 灵感模式 Prompt ============

INSPIRATION_EMOTION_SYSTEM = """你是短故事情绪目标推荐专家。
根据用户的原始想法，推荐6种适合的情绪目标。

情绪目标类型：
1. 意难平 - 迟来的深情、双向错过
2. 反转震撼 - 身份/视角/动机反转
3. 爽感释放 - 打脸复仇、绝地反击
4. 治愈温暖 - 双向奔赴、细水长流
5. 细思极恐 - 规则怪谈、死后反转
6. 共鸣感动 - 亲情、世情、成长

返回JSON格式：
{{"options": [
  {{"value": "意难平", "label": "意难平 - 迟来的深情", "heat": "🔥🔥🔥🔥", "reason": "适合原因"}},
  ...
]}}"""

INSPIRATION_EMOTION_USER = """用户想法：{initial_idea}

请推荐6种适合的情绪目标，包含市场热度。"""

INSPIRATION_LOGLINE_SYSTEM = """你是短故事一句话梗概生成专家。
根据情绪目标和原始想法，生成6个一句话梗概。

爆款公式：极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念
每个梗概包含：主角+困境+反转+情绪落点。

返回JSON格式：{"options": ["梗概1", "梗概2", ...]}"""

INSPIRATION_LOGLINE_USER = """原始想法：{initial_idea}
情绪目标：{emotion_goal}

请生成6个一句话梗概，每个不超过100字。"""

INSPIRATION_TWIST_SYSTEM = """你是短故事反转设计专家。
根据梗概和情绪目标，生成6组核心反转设计。

返回JSON格式：
{{"options": [
  {{"twist_type": "身份反转", "twist_content": "反转内容", "clues": ["线索1", "线索2", "线索3"]}},
  ...
]}}"""

INSPIRATION_TWIST_USER = """一句话梗概：{logline}
情绪目标：{emotion_goal}

请生成6组核心反转设计。"""

INSPIRATION_GENRE_SYSTEM = """你是短故事题材标签推荐专家。
推荐6个适合的短故事题材标签。

短故事标签参考：追妻、重生复仇、死人文学、小三、世情、仙侠、霸总、职场、校园、悬疑、怪谈、科幻。

返回JSON格式：{"options": ["标签1", "标签2", ...]}"""

INSPIRATION_GENRE_USER = """一句话梗概：{logline}
情绪目标：{emotion_goal}
核心反转：{twist_content}

请推荐6个题材标签。"""


class ShortStoryAIService:
    """短故事AI生成服务"""

    @staticmethod
    async def generate_loglines(
        ai_service: AIService,
        title: str,
        emotion_goal: str = "",
        genre: str = "",
        user_idea: str = "",
    ) -> list[str]:
        """生成一句话梗概选项"""
        system_prompt = LOGLINE_SYSTEM
        user_prompt = LOGLINE_USER.format(
            title=title or "未定",
            emotion_goal=emotion_goal or "未定",
            genre=genre or "未定",
            user_idea=user_idea or title or "",
        )

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt, system_prompt=system_prompt, temperature=0.8
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        data = json.loads(cleaned)
        options = data.get("options", [])
        return [str(o) for o in options if o][:6]

    @staticmethod
    async def generate_twists(
        ai_service: AIService,
        title: str,
        logline: str,
        emotion_goal: str = "",
    ) -> list[dict]:
        """生成核心反转设计选项"""
        system_prompt = TWIST_SYSTEM
        user_prompt = TWIST_USER.format(
            title=title or "未定",
            logline=logline or "未定",
            emotion_goal=emotion_goal or "未定",
        )

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt, system_prompt=system_prompt, temperature=0.75
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        data = json.loads(cleaned)
        options = data.get("options", [])
        return [o for o in options if isinstance(o, dict)][:6]

    @staticmethod
    async def generate_segment_content(
        ai_service: AIService,
        story_data: dict,
        segment: dict,
        existing_content: str = "",
    ) -> str:
        """生成指定段落的正文"""
        # 构建上下文提示
        context_hint = ""
        if existing_content:
            # 取已有正文的最后500字作为上下文
            tail = existing_content[-500:] if len(existing_content) > 500 else existing_content
            context_hint = f"已有正文（最后部分）：\n...{tail}\n\n请衔接上文继续写作。"

        clues_raw = story_data.get("twist_clues", "")
        try:
            clues = json.loads(clues_raw) if clues_raw else []
            clues_text = "；".join(clues) if clues else "未设定"
        except (json.JSONDecodeError, TypeError):
            clues_text = clues_raw or "未设定"

        chars_raw = story_data.get("characters", "")
        try:
            chars = json.loads(chars_raw) if chars_raw else []
            chars_text = "；".join(
                [f"{c.get('name', '')}({c.get('role', '')}): {c.get('desc', '')}" for c in chars]
            ) if chars else "未设定"
        except (json.JSONDecodeError, TypeError):
            chars_text = chars_raw or "未设定"

        user_prompt = SEGMENT_USER.format(
            title=story_data.get("title", "未定"),
            logline=story_data.get("logline", "未定"),
            emotion_goal=story_data.get("emotion_goal", "未定"),
            twist_content=story_data.get("twist_content", "未定"),
            twist_type=story_data.get("twist_type", "未定"),
            clues=clues_text,
            characters=chars_text,
            target_platform=story_data.get("target_platform", "未定"),
            target_words=story_data.get("target_words", 12000),
            segment_label=segment.get("label", ""),
            segment_target_words=segment.get("target_words", 1000),
            segment_desc=segment.get("desc", ""),
            context_hint=context_hint,
        )

        result = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt, system_prompt=SEGMENT_SYSTEM, temperature=0.7
        ):
            result += chunk

        return result.strip()

    @staticmethod
    async def polish_content(
        ai_service: AIService,
        title: str,
        emotion_goal: str,
        twist_content: str,
        content: str,
    ) -> str:
        """精修润色正文"""
        user_prompt = POLISH_USER.format(
            title=title or "未定",
            emotion_goal=emotion_goal or "未定",
            twist_content=twist_content or "未定",
            content=content or "",
        )

        result = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt, system_prompt=POLISH_SYSTEM, temperature=0.5
        ):
            result += chunk

        return result.strip()

    @staticmethod
    async def generate_inspiration_options(
        ai_service: AIService,
        step: str,
        context: dict,
    ) -> dict:
        """灵感模式：生成选项"""
        step_configs = {
            "emotion_goal": (INSPIRATION_EMOTION_SYSTEM, INSPIRATION_EMOTION_USER, 0.8),
            "logline": (INSPIRATION_LOGLINE_SYSTEM, INSPIRATION_LOGLINE_USER, 0.8),
            "twist": (INSPIRATION_TWIST_SYSTEM, INSPIRATION_TWIST_USER, 0.75),
            "genre": (INSPIRATION_GENRE_SYSTEM, INSPIRATION_GENRE_USER, 0.5),
        }

        if step not in step_configs:
            raise ValueError(f"不支持的步骤: {step}")

        system_template, user_template, temperature = step_configs[step]

        format_params = {
            "initial_idea": context.get("initial_idea", ""),
            "emotion_goal": context.get("emotion_goal", ""),
            "logline": context.get("logline", ""),
            "twist_content": context.get("twist_content", ""),
        }

        system_prompt = system_template.format(**format_params)
        user_prompt = user_template.format(**format_params)

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt, system_prompt=system_prompt, temperature=temperature
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        data = json.loads(cleaned)
        return data


# ============ 端到端生成 Prompt ============

FULL_STORY_SYSTEM = """你是短故事爆款创作专家，精通高概念选题与黄金结构写作法。

你的任务是：根据用户的核心想法，一次性生成完整的短故事成稿（包含故事设定和全文正文）。

【爆款选题公式】
极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念

【三大黄金赛道】
打脸复仇类、悬疑怪谈类、极致痛感类

【黄金结构（必须严格执行）】
1. 死亡黄金钩子（前5%）：不写任何铺垫，第一句将读者推入冲突现场
2. 冲突激化与打压（20%）：反派极致嚣张，主角劣势隐忍，压抑读者情绪到最高点
3. 绝地反击与多重反转（60%）：剥洋葱式揭露真相，打一下→反派反扑→再揭露更大真相
4. 极致爽点与收尾（15%）：反派惨烈下场，主角清醒独立走向新人生

【情绪曲线法则】
- 每1000-1500字必须有一次小冲突或小揭秘
- 不能有超过500字的纯说明性废话
- 波浪式情绪过山车：压抑→释放→新危机→再压抑→爆点

【人设与对话法则】
- 人设高度标签化：清醒大女主、极致恶毒绿茶、软饭硬吃渣男
- 删除所有日常寒暄，每句台词必须具备暴露阴谋或推进爽点的功能
- 台词口语化，删除排比句和空洞形容词

【输出格式】
必须返回如下JSON结构（content字段为完整正文，不要分段输出，是一个完整字符串）：
{
  "title": "故事标题（不超过30字，要有爆点）",
  "logline": "一句话梗概（主角+困境+反转+情绪落点）",
  "emotion_goal": "情绪目标（从：意难平/反转震撼/爽感释放/治愈温暖/细思极恐/共鸣感动 中选一个）",
  "twist_type": "反转类型（身份反转/视角反转/动机反转/时间线反转）",
  "twist_content": "核心反转内容描述",
  "twist_clues": ["铺垫线索1", "铺垫线索2", "铺垫线索3"],
  "genre": "题材标签（如：追妻/重生复仇/霸总/悬疑等）",
  "content": "完整正文（{}字左右，直接输出故事内容，不要加任何解释、标记、分段标题）"
}

注意：content字段必须是完整的故事正文，不能有"第一章"之类的标题，不能有AI解释说明，直接就是故事内容本身。"""

FULL_STORY_USER = """请根据以下要求创作一个完整的短故事：

【用户想法】{initial_idea}
{extra_requirements}

【目标字数】{target_words}字

请严格按照黄金结构创作，直接输出JSON结果。content字段必须是完整的、可直接发布的短故事正文。"""


class FullStoryGenerator:
    """端到端短故事生成器"""

    @staticmethod
    async def generate_full_story(
        ai_service: AIService,
        initial_idea: str,
        target_words: int = 12000,
        emotion_goal: str = "",
        target_platform: str = "知乎盐言",
    ) -> dict:
        """一次性生成完整短故事（设定+全文）

        Args:
            initial_idea: 用户的核心想法
            target_words: 目标字数
            emotion_goal: 情绪目标（可选，未指定则AI自选）
            target_platform: 目标平台

        Returns:
            dict: {title, logline, emotion_goal, twist_type, twist_content,
                   twist_clues, genre, content}
        """
        extra = ""
        if emotion_goal:
            extra += f"\n【指定情绪目标】{emotion_goal}"
        if target_platform:
            extra += f"\n【目标平台】{target_platform}"

        user_prompt = FULL_STORY_USER.format(
            initial_idea=initial_idea,
            extra_requirements=extra,
            target_words=target_words,
        )

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt,
            system_prompt=FULL_STORY_SYSTEM,
            temperature=0.75,
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        data = json.loads(cleaned)

        # 校验必要字段
        required = ["title", "logline", "content"]
        for field in required:
            if field not in data or not data[field]:
                raise ValueError(f"AI生成结果缺少必要字段: {field}")

        # 兜底默认值
        data.setdefault("emotion_goal", emotion_goal or "爽感释放")
        data.setdefault("twist_type", "")
        data.setdefault("twist_content", "")
        data.setdefault("twist_clues", [])
        data.setdefault("genre", "")

        return data
