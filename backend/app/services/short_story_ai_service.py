"""短故事AI生成服务"""
import json
from typing import Optional, AsyncGenerator, Dict, Any
from app.services.ai_service import AIService
from app.services.json_helper import clean_json_response
from app.utils.sse_response import wrap_stream_with_heartbeat, HEARTBEAT
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
{emotion_curve_hint}
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
{emotion_curve_hint}
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
        result = [str(o) for o in options if o][:6]
        logger.debug(f"AI生成梗概完成: 返回{len(result)}个选项, 响应长度={len(accumulated)}")
        return result

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
        result = [o for o in options if isinstance(o, dict)][:6]
        logger.debug(f"AI生成反转完成: 返回{len(result)}个选项, 响应长度={len(accumulated)}")
        return result

    @staticmethod
    async def generate_segment_content(
        ai_service: AIService,
        story_data: dict,
        segment: dict,
        existing_content: str = "",
        emotion_curve: str = "",
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

        emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve or story_data.get("emotion_curve", ""))

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
            emotion_curve_hint=emotion_curve_hint,
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

        logger.debug(
            f"AI生成分段完成: stage={segment.get('stage')}, "
            f"target_words={segment.get('target_words')}, actual_chars={len(result)}"
        )
        return result.strip()

    @staticmethod
    async def polish_content(
        ai_service: AIService,
        title: str,
        emotion_goal: str,
        twist_content: str,
        content: str,
        emotion_curve: str = "",
    ) -> str:
        """精修润色正文"""
        emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)
        user_prompt = POLISH_USER.format(
            title=title or "未定",
            emotion_goal=emotion_goal or "未定",
            twist_content=twist_content or "未定",
            emotion_curve_hint=emotion_curve_hint,
            content=content or "",
        )

        result = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt, system_prompt=POLISH_SYSTEM, temperature=0.5
        ):
            result += chunk

        logger.debug(f"AI精修完成: 原文长度={len(content)}, 精修后长度={len(result)}")
        return result.strip()

    # ============ 流式变体（SSE） ============

    @staticmethod
    async def generate_segment_content_stream(
        ai_service: AIService,
        story_data: dict,
        segment: dict,
        existing_content: str = "",
        emotion_curve: str = "",
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """生成指定段落的正文（流式版）。

        yield 事件结构：
        - {"type": "progress", "message": "...", "progress": 0-100, "status": "processing"}
        - {"type": "chunk", "content": "文本片段"}
        - {"type": "complete", "content": "完整正文"}
        - {"type": "error", "error": "..."}
        """
        try:
            context_hint = ""
            if existing_content:
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

            emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve or story_data.get("emotion_curve", ""))

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
                emotion_curve_hint=emotion_curve_hint,
                segment_label=segment.get("label", ""),
                segment_target_words=segment.get("target_words", 1000),
                segment_desc=segment.get("desc", ""),
                context_hint=context_hint,
            )

            yield {"type": "progress", "message": f"AI正在生成「{segment.get('label', segment.get('stage', ''))}」段落...", "progress": 15, "status": "processing"}

            result = ""
            async for chunk in ai_service.generate_text_stream(
                prompt=user_prompt, system_prompt=SEGMENT_SYSTEM, temperature=0.7
            ):
                result += chunk
                yield {"type": "chunk", "content": chunk}

            logger.debug(
                f"AI生成分段流式完成: stage={segment.get('stage')}, actual_chars={len(result)}"
            )
            yield {"type": "complete", "content": result.strip()}
        except Exception as e:
            logger.error(f"AI生成分段流式失败: {str(e)}", exc_info=True)
            yield {"type": "error", "error": str(e)}

    @staticmethod
    async def polish_content_stream(
        ai_service: AIService,
        title: str,
        emotion_goal: str,
        twist_content: str,
        content: str,
        emotion_curve: str = "",
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """精修润色正文（流式版）。

        yield 事件结构同 generate_segment_content_stream。
        """
        try:
            emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)
            user_prompt = POLISH_USER.format(
                title=title or "未定",
                emotion_goal=emotion_goal or "未定",
                twist_content=twist_content or "未定",
                emotion_curve_hint=emotion_curve_hint,
                content=content or "",
            )

            yield {"type": "progress", "message": "AI正在精修润色正文...", "progress": 15, "status": "processing"}

            result = ""
            async for chunk in ai_service.generate_text_stream(
                prompt=user_prompt, system_prompt=POLISH_SYSTEM, temperature=0.5
            ):
                result += chunk
                yield {"type": "chunk", "content": chunk}

            logger.debug(f"AI精修流式完成: 原文长度={len(content)}, 精修后长度={len(result)}")
            yield {"type": "complete", "content": result.strip()}
        except Exception as e:
            logger.error(f"AI精修流式失败: {str(e)}", exc_info=True)
            yield {"type": "error", "error": str(e)}

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


# ============ 两阶段生成 Prompt（解决单次超时问题） ============

STAGE1_SETUP_SYSTEM = """你是短故事爆款创作专家。
你的任务是：根据用户想法，设计短故事的核心设定（不写正文），为后续分段写作做准备。

【爆款方法论】
- 选题必须高概念：一句话能说清爆点
- 爆款公式：极致反差/道德冲突+强身份标签+迫切危机悬念
- 三大黄金赛道：打脸复仇类、悬疑怪谈类、极致痛感类
- 黄金结构：Hook 5% + Escalation 20% + Climax 60% + Resolution 15%
- 情绪曲线：每1000-1500字一次小冲突/揭秘，波浪式过山车
- 人设标签化：清醒大女主/极致恶毒绿茶/软饭硬吃渣男等
- 对话功能性：每句台词必须暴露阴谋或推进爽点

【输出格式】
必须返回如下JSON结构（不包含正文，只有设定和分段大纲）：
{
  "title": "故事标题（不超过30字，要有爆点）",
  "logline": "一句话梗概（主角+困境+反转+情绪落点）",
  "emotion_goal": "情绪目标（从：意难平/反转震撼/爽感释放/治愈温暖/细思极恐/共鸣感动 中选一个）",
  "twist_type": "反转类型（身份反转/视角反转/动机反转/时间线反转）",
  "twist_content": "核心反转内容描述",
  "twist_clues": ["铺垫线索1", "铺垫线索2", "铺垫线索3"],
  "genre": "题材标签",
  "characters": [{"name": "角色名", "role": "主角/反派/配角", "desc": "标签化人设描述", "relationship": "与主角的关系"}],
  "segments_outline": [
    {
      "stage": "hook",
      "label": "死亡黄金钩子",
      "target_words": 600,
      "plot": "这一段的具体情节要点（开篇第一句如何抛出核心危机、主要冲突是什么、出场人物）"
    },
    {
      "stage": "escalation",
      "label": "冲突激化与打压",
      "target_words": 2400,
      "plot": "这一段的具体情节要点（反派如何嚣张、主角如何隐忍、情绪压抑到什么程度）"
    },
    {
      "stage": "climax",
      "label": "绝地反击与多重反转",
      "target_words": 7200,
      "plot": "这一段的具体情节要点（第一次反击、反派反扑、揭露更大真相、情绪爆点节奏）"
    },
    {
      "stage": "resolution",
      "label": "极致爽点与收尾",
      "target_words": 1800,
      "plot": "这一段的具体情节要点（反派下场、主角新人生、收尾方式）"
    }
  ]
}

注意：segments_outline 中的 target_words 之和应等于总目标字数。只输出JSON，不要加任何解释。"""

STAGE1_SETUP_USER = """请根据以下要求设计短故事的核心设定：

【用户想法】{initial_idea}
{extra_requirements}

【目标字数】{target_words}字

请设计完整的设定和分段大纲，直接输出JSON。"""


STAGE2_SEGMENT_SYSTEM = """你是短故事爆款写作专家。
你的任务是：根据已有的故事设定和分段大纲，撰写指定分段的正文。

【写作原则】
1. 严格按大纲的情节要点写，不要偏离设定
2. 与前文衔接自然，不要重复前文内容
3. 符合爆款方法论：人设标签化、对话功能性、情绪曲线节奏
4. 台词口语化，删除排比句和空洞形容词，去AI味
5. 不要写章节标题、不要加任何解释说明、直接输出故事正文
6. 字数尽量接近目标字数，但以情节完整为准

【黄金结构法则】
- Hook段：第一句就抛出核心危机，不写铺垫
- Escalation段：反派极致嚣张，主角劣势隐忍，压抑到最高点
- Climax段：剥洋葱式揭露，打一下→反派反扑→再揭露更大真相
- Resolution段：反派惨烈下场，主角清醒独立，干净利落收尾

【情绪曲线法则】
每1000-1500字必须有一次小冲突或小揭秘，不能有超过500字的纯说明性废话。"""

STAGE2_SEGMENT_USER = """请撰写以下分段的正文：

=== 故事设定 ===
标题：{title}
一句话梗概：{logline}
情绪目标：{emotion_goal}
核心反转：{twist_type} - {twist_content}
铺垫线索：{twist_clues}
{emotion_curve_hint}
=== 人设速写 ===
{characters}

=== 当前分段任务 ===
阶段：{segment_label}（{segment_stage}）
目标字数：{segment_target_words}字
情节要点：{segment_plot}

=== 前文末尾（用于衔接，不要重复） ===
{previous_ending}

请直接输出本分段的故事正文，不要加任何标题、解释或标记。"""


class FullStoryGenerator:
    """端到端短故事生成器"""

    @staticmethod
    async def generate_full_story(
        ai_service: AIService,
        initial_idea: str,
        target_words: int = 12000,
        emotion_goal: str = "",
        target_platform: str = "知乎盐言",
        emotion_curve: str = "",
    ) -> dict:
        """两阶段生成完整短故事（设定+分段正文），解决单次AI调用超时问题

        阶段1：生成核心设定+分段大纲（快速，几秒）
        阶段2：按大纲分段生成正文（每段独立调用，避免单次超时）

        Args:
            initial_idea: 用户的核心想法
            target_words: 目标字数
            emotion_goal: 情绪目标（可选，未指定则AI自选）
            target_platform: 目标平台
            emotion_curve: 情绪曲线JSON（可选）

        Returns:
            dict: {title, logline, emotion_goal, twist_type, twist_content,
                   twist_clues, genre, content, characters, segments_outline}
        """
        # ============ 阶段1：生成设定+大纲 ============
        extra = ""
        if emotion_goal:
            extra += f"\n【指定情绪目标】{emotion_goal}"
        if target_platform:
            extra += f"\n【目标平台】{target_platform}"
        # 注入情绪曲线到阶段1提示
        emotion_curve_hint_stage1 = _format_emotion_curve_for_prompt(emotion_curve)
        if emotion_curve_hint_stage1:
            extra += f"\n{emotion_curve_hint_stage1}"

        stage1_prompt = STAGE1_SETUP_USER.format(
            initial_idea=initial_idea,
            extra_requirements=extra,
            target_words=target_words,
        )

        logger.info(f"阶段1开始：生成设定和大纲, idea_len={len(initial_idea)}, target_words={target_words}")

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=stage1_prompt,
            system_prompt=STAGE1_SETUP_SYSTEM,
            temperature=0.75,
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        setup_data = json.loads(cleaned)

        # 校验必要字段
        required = ["title", "logline"]
        for field in required:
            if field not in setup_data or not setup_data[field]:
                raise ValueError(f"AI生成设定缺少必要字段: {field}")

        segments_outline = setup_data.get("segments_outline") or []
        if not segments_outline or len(segments_outline) < 4:
            # 大纲不完整，退化为默认黄金结构
            segments_outline = [
                {"stage": "hook", "label": "死亡黄金钩子", "target_words": int(target_words * 0.05), "plot": "开篇抛出核心危机"},
                {"stage": "escalation", "label": "冲突激化与打压", "target_words": int(target_words * 0.20), "plot": "反派嚣张，主角隐忍"},
                {"stage": "climax", "label": "绝地反击与多重反转", "target_words": int(target_words * 0.60), "plot": "多重反转，揭露真相"},
                {"stage": "resolution", "label": "极致爽点与收尾", "target_words": int(target_words * 0.15), "plot": "反派下场，主角新生"},
            ]
            setup_data["segments_outline"] = segments_outline

        logger.info(
            f"阶段1完成: title={setup_data.get('title')}, "
            f"segments={len(segments_outline)}, "
            f"emotion_goal={setup_data.get('emotion_goal')}"
        )

        # ============ 阶段2：分段生成正文 ============
        title = setup_data.get("title", "未命名")
        logline = setup_data.get("logline", "")
        seg_emotion_goal = setup_data.get("emotion_goal", emotion_goal or "爽感释放")
        twist_type = setup_data.get("twist_type", "")
        twist_content = setup_data.get("twist_content", "")
        twist_clues = setup_data.get("twist_clues", [])
        characters = setup_data.get("characters", [])

        # 格式化人设和线索
        chars_text = "\n".join(
            f"- {c.get('name', '?')}（{c.get('role', '?')}）: {c.get('desc', '')}，与主角关系：{c.get('relationship', '')}"
            for c in characters
        ) if characters else "未设定"
        clues_text = "、".join(twist_clues) if twist_clues else "未设定"

        # 情绪曲线提示（优先使用传入的，否则用阶段1AI生成的）
        seg_emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)

        full_content_parts = []
        previous_ending = ""

        for idx, seg in enumerate(segments_outline):
            seg_stage = seg.get("stage", "")
            seg_label = seg.get("label", "")
            seg_target_words = seg.get("target_words", 1000)
            seg_plot = seg.get("plot", "")

            logger.info(
                f"阶段2-分段{idx+1}/{len(segments_outline)}开始: "
                f"stage={seg_stage}, target_words={seg_target_words}"
            )

            seg_prompt = STAGE2_SEGMENT_USER.format(
                title=title,
                logline=logline,
                emotion_goal=seg_emotion_goal,
                twist_type=twist_type,
                twist_content=twist_content,
                twist_clues=clues_text,
                emotion_curve_hint=seg_emotion_curve_hint,
                characters=chars_text,
                segment_label=seg_label,
                segment_stage=seg_stage,
                segment_target_words=seg_target_words,
                segment_plot=seg_plot,
                previous_ending=previous_ending[-500:] if previous_ending else "（本段为开篇，无前文）",
            )

            seg_content = ""
            try:
                async for chunk in ai_service.generate_text_stream(
                    prompt=seg_prompt,
                    system_prompt=STAGE2_SEGMENT_SYSTEM,
                    temperature=0.7,
                ):
                    seg_content += chunk
            except Exception as seg_err:
                logger.error(
                    f"阶段2-分段{idx+1}生成失败: stage={seg_stage}, error={str(seg_err)}",
                    exc_info=True,
                )
                # 单段失败用占位符，保证整体能返回（用户可手动重写该段）
                seg_content = f"\n\n【{seg_label}段生成失败，请手动重写：{str(seg_err)[:100]}】\n\n"

            full_content_parts.append(seg_content.strip())
            # 取末尾500字作为下一段的衔接上下文
            previous_ending = seg_content[-500:] if seg_content else ""

            logger.info(
                f"阶段2-分段{idx+1}/{len(segments_outline)}完成: "
                f"stage={seg_stage}, actual_chars={len(seg_content)}"
            )

        # 合并所有分段
        full_content = "\n\n".join(p for p in full_content_parts if p)

        logger.info(
            f"AI两阶段生成短故事完成: title={title}, "
            f"content_length={len(full_content)}, segments={len(segments_outline)}"
        )

        # 组装最终结果
        setup_data["content"] = full_content
        # 兜底默认值
        setup_data.setdefault("emotion_goal", emotion_goal or "爽感释放")
        setup_data.setdefault("twist_type", "")
        setup_data.setdefault("twist_content", "")
        setup_data.setdefault("twist_clues", [])
        setup_data.setdefault("genre", "")

        return setup_data

    @staticmethod
    async def generate_full_story_stream(
        ai_service: AIService,
        initial_idea: str,
        target_words: int = 12000,
        emotion_goal: str = "",
        target_platform: str = "知乎盐言",
        emotion_curve: str = "",
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """两阶段生成完整短故事（流式版）。

        yield 事件结构：
        - {"type": "progress", "message": "...", "progress": 0-100, "status": "processing"}
        - {"type": "chunk", "content": "文本片段", "segment_index": int}
        - {"type": "stage", "stage": "setup"/"segment_N", "message": "...", "total_segments": N}
        - {"type": "complete", "data": {...完整故事数据}}
        - {"type": "error", "error": "..."}
        """
        try:
            # ============ 阶段1：生成设定+大纲 ============
            extra = ""
            if emotion_goal:
                extra += f"\n【指定情绪目标】{emotion_goal}"
            if target_platform:
                extra += f"\n【目标平台】{target_platform}"
            emotion_curve_hint_stage1 = _format_emotion_curve_for_prompt(emotion_curve)
            if emotion_curve_hint_stage1:
                extra += f"\n{emotion_curve_hint_stage1}"

            stage1_prompt = STAGE1_SETUP_USER.format(
                initial_idea=initial_idea,
                extra_requirements=extra,
                target_words=target_words,
            )

            yield {"type": "stage", "stage": "setup", "message": "正在生成核心设定与分段大纲...", "total_segments": 0}
            yield {"type": "progress", "message": "阶段1/2：AI正在构思选题、反转与黄金结构...", "progress": 5, "status": "processing"}

            accumulated = ""
            async for chunk in wrap_stream_with_heartbeat(
                ai_service.generate_text_stream(
                    prompt=stage1_prompt,
                    system_prompt=STAGE1_SETUP_SYSTEM,
                    temperature=0.75,
                ),
                heartbeat_interval=15.0,
            ):
                # 心跳哨兵：透传给HTTP端点发送SSE注释保活，不混入AI响应
                if chunk is HEARTBEAT:
                    yield {"type": "heartbeat"}
                    continue
                accumulated += chunk
                # 阶段1的chunk不透传给前端（是JSON结构，对用户无意义），仅发进度
                yield {"type": "progress", "message": f"阶段1/2：AI正在构思设定...（{len(accumulated)}字符）", "progress": min(5 + len(accumulated) // 200, 18), "status": "processing"}

            cleaned = clean_json_response(accumulated)
            setup_data = json.loads(cleaned)

            required = ["title", "logline"]
            for field in required:
                if field not in setup_data or not setup_data[field]:
                    raise ValueError(f"AI生成设定缺少必要字段: {field}")

            segments_outline = setup_data.get("segments_outline") or []
            if not segments_outline or len(segments_outline) < 4:
                segments_outline = [
                    {"stage": "hook", "label": "死亡黄金钩子", "target_words": int(target_words * 0.05), "plot": "开篇抛出核心危机"},
                    {"stage": "escalation", "label": "冲突激化与打压", "target_words": int(target_words * 0.20), "plot": "反派嚣张，主角隐忍"},
                    {"stage": "climax", "label": "绝地反击与多重反转", "target_words": int(target_words * 0.60), "plot": "多重反转，揭露真相"},
                    {"stage": "resolution", "label": "极致爽点与收尾", "target_words": int(target_words * 0.15), "plot": "反派下场，主角新生"},
                ]
                setup_data["segments_outline"] = segments_outline

            logger.info(
                f"阶段1完成(流式): title={setup_data.get('title')}, "
                f"segments={len(segments_outline)}"
            )

            yield {"type": "progress", "message": f"设定完成，标题《{setup_data.get('title', '')}》，开始分段创作...", "progress": 20, "status": "processing"}

            # ============ 阶段2：分段生成正文 ============
            title = setup_data.get("title", "未命名")
            logline = setup_data.get("logline", "")
            seg_emotion_goal = setup_data.get("emotion_goal", emotion_goal or "爽感释放")
            twist_type = setup_data.get("twist_type", "")
            twist_content = setup_data.get("twist_content", "")
            twist_clues = setup_data.get("twist_clues", [])
            characters = setup_data.get("characters", [])

            chars_text = "\n".join(
                f"- {c.get('name', '?')}（{c.get('role', '?')}）: {c.get('desc', '')}，与主角关系：{c.get('relationship', '')}"
                for c in characters
            ) if characters else "未设定"
            clues_text = "、".join(twist_clues) if twist_clues else "未设定"

            seg_emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)

            full_content_parts = []
            previous_ending = ""
            total_segments = len(segments_outline)
            # 阶段2占总进度的 20% → 92%，每段均分
            segment_progress_span = 72.0 / max(total_segments, 1)

            for idx, seg in enumerate(segments_outline):
                seg_stage = seg.get("stage", "")
                seg_label = seg.get("label", "")
                seg_target_words = seg.get("target_words", 1000)
                seg_plot = seg.get("plot", "")

                yield {
                    "type": "stage",
                    "stage": f"segment_{idx + 1}",
                    "message": f"阶段2/2：正在创作第 {idx + 1}/{total_segments} 段「{seg_label}」...",
                    "total_segments": total_segments,
                    "segment_index": idx,
                }

                seg_start_progress = 20 + int(idx * segment_progress_span)
                seg_end_progress = 20 + int((idx + 1) * segment_progress_span)
                yield {
                    "type": "progress",
                    "message": f"第 {idx + 1}/{total_segments} 段「{seg_label}」创作中...",
                    "progress": seg_start_progress,
                    "status": "processing",
                }

                seg_prompt = STAGE2_SEGMENT_USER.format(
                    title=title,
                    logline=logline,
                    emotion_goal=seg_emotion_goal,
                    twist_type=twist_type,
                    twist_content=twist_content,
                    twist_clues=clues_text,
                    emotion_curve_hint=seg_emotion_curve_hint,
                    characters=chars_text,
                    segment_label=seg_label,
                    segment_stage=seg_stage,
                    segment_target_words=seg_target_words,
                    segment_plot=seg_plot,
                    previous_ending=previous_ending[-500:] if previous_ending else "（本段为开篇，无前文）",
                )

                seg_content = ""
                seg_chunk_count = 0
                try:
                    async for chunk in wrap_stream_with_heartbeat(
                        ai_service.generate_text_stream(
                            prompt=seg_prompt,
                            system_prompt=STAGE2_SEGMENT_SYSTEM,
                            temperature=0.7,
                        ),
                        heartbeat_interval=15.0,
                    ):
                        # 心跳哨兵：透传给HTTP端点发送SSE注释保活
                        if chunk is HEARTBEAT:
                            yield {"type": "heartbeat"}
                            continue
                        seg_content += chunk
                        seg_chunk_count += 1
                        yield {"type": "chunk", "content": chunk, "segment_index": idx}
                        # 每3个chunk发一次进度
                        if seg_chunk_count % 3 == 0:
                            # 段内子进度：根据已生成字符数估算
                            sub_prog = min(len(seg_content) / max(seg_target_words, 1), 1.0)
                            cur_prog = seg_start_progress + int((seg_end_progress - seg_start_progress) * sub_prog)
                            yield {
                                "type": "progress",
                                "message": f"第 {idx + 1}/{total_segments} 段「{seg_label}」创作中...（{len(seg_content)}字符）",
                                "progress": cur_prog,
                                "status": "processing",
                            }
                except Exception as seg_err:
                    logger.error(f"阶段2-分段{idx + 1}生成失败(流式): stage={seg_stage}, error={str(seg_err)}", exc_info=True)
                    seg_content = f"\n\n【{seg_label}段生成失败，请手动重写：{str(seg_err)[:100]}】\n\n"
                    yield {"type": "chunk", "content": seg_content, "segment_index": idx}

                full_content_parts.append(seg_content.strip())
                previous_ending = seg_content[-500:] if seg_content else ""
                # 段完成，推进到段结束进度
                yield {
                    "type": "progress",
                    "message": f"第 {idx + 1}/{total_segments} 段「{seg_label}」完成（{len(seg_content)}字符）",
                    "progress": seg_end_progress,
                    "status": "processing",
                }

            full_content = "\n\n".join(p for p in full_content_parts if p)

            yield {"type": "progress", "message": "正在整理完整故事...", "progress": 95, "status": "processing"}

            setup_data["content"] = full_content
            setup_data.setdefault("emotion_goal", emotion_goal or "爽感释放")
            setup_data.setdefault("twist_type", "")
            setup_data.setdefault("twist_content", "")
            setup_data.setdefault("twist_clues", [])
            setup_data.setdefault("genre", "")

            logger.info(
                f"AI两阶段生成短故事完成(流式): title={title}, "
                f"content_length={len(full_content)}, segments={total_segments}"
            )

            yield {"type": "complete", "data": setup_data}
        except Exception as e:
            logger.error(f"AI两阶段生成短故事失败(流式): {str(e)}", exc_info=True)
            yield {"type": "error", "error": str(e)}


# ============ AI 评分 Prompt ============

SCORE_SYSTEM = """你是短故事爆款评审专家，严格按爆款方法论对短故事进行评分。

【评分维度】（总分100分）

1. 选题维度（20分）- concept
   - 是否具备高概念：一句话说清爆点
   - 爆款公式：极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念
   - 是否直击人性痛点（贪婪、背叛、嫉妒、爽快、感动）
   - 三大黄金赛道匹配度：打脸复仇/悬疑怪谈/极致痛感
   - 切忌平淡/小资/散文化

2. 结构维度（25分）- structure
   - Hook（前5%）：第一句是否将读者推入冲突现场，不写铺垫
   - Escalation（20%）：反派嚣张主角劣势，压抑读者情绪到最高点
   - Climax（60%）：剥洋葱式揭露真相，打一下→反派反扑→再揭露更大真相
   - Resolution（15%）：反派惨烈下场，主角清醒独立走向新人生

3. 情绪维度（20分）- emotion
   - 每1000-1500字有一次小冲突或小揭秘
   - 不能有超过500字的纯说明性废话
   - 波浪式情绪过山车：压抑→释放→新危机→再压抑→爆点
   - 读者始终处于"气得牙痒痒"或"爽得起鸡皮疙瘩"状态

4. 人设对话维度（20分）- character
   - 人设高度标签化（清醒大女主/极致恶毒绿茶/软饭硬吃渣男等）
   - 删除所有日常寒暄
   - 每句台词必须具备暴露阴谋或推进爽点的功能
   - 台词口语化，删除排比句和空洞形容词

5. 完成度维度（15分）- polish
   - 开头查验：前300字是否出现核心矛盾（没有则扣分）
   - 废话查验：是否有超过3行无意义环境/心理描写（有则扣分）
   - 卡点查验：免费章节结束句是否有让人非看下一章不可的欲望
   - 去AI味查验：台词是否像真人说话，是否有排比句和空洞形容词

【返回JSON格式】
{{
  "total_score": 85,
  "level": "良好",
  "dimensions": [
    {{
      "key": "concept",
      "name": "选题维度",
      "score": 18,
      "max_score": 20,
      "evaluation": "整体评价",
      "evidence": "从正文中摘录的具体证据（原文片段）",
      "issues": ["问题1", "问题2"],
      "suggestions": ["改进建议1", "改进建议2"]
    }},
    ...（5个维度）
  ],
  "overall_evaluation": "总体评价（200字内）",
  "top_issues": ["最严重的3个问题"],
  "improvement_priority": ["按优先级排序的修改建议"]
}}

level规则：90+ 优秀，75-89 良好，60-74 合格，<60 待改进
evidence必须引用正文原文片段作为依据，不能空谈。"""

SCORE_USER = """请对以下短故事进行评分：

【故事设定】
标题：{title}
情绪目标：{emotion_goal}
一句话梗概：{logline}
核心反转：{twist_type} - {twist_content}
题材标签：{genre}
目标字数：{target_words}
{emotion_curve_hint}
【正文】
{content}

请严格按5个维度评分，每个维度的evidence必须引用正文原文片段。"""


class StoryScorer:
    """短故事AI评分器"""

    @staticmethod
    async def score_story(
        ai_service: AIService,
        title: str,
        content: str,
        emotion_goal: str = "",
        logline: str = "",
        twist_type: str = "",
        twist_content: str = "",
        genre: str = "",
        target_words: int = 12000,
        emotion_curve: str = "",
    ) -> dict:
        """对短故事进行5维评分"""
        if not content or len(content.strip()) < 100:
            raise ValueError("正文内容过短，无法评分（至少需要100字）")

        emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)
        user_prompt = SCORE_USER.format(
            title=title or "未命名",
            emotion_goal=emotion_goal or "未设定",
            logline=logline or "未设定",
            twist_type=twist_type or "未设定",
            twist_content=twist_content or "未设定",
            genre=genre or "未设定",
            target_words=target_words,
            emotion_curve_hint=emotion_curve_hint,
            content=content,
        )

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt,
            system_prompt=SCORE_SYSTEM,
            temperature=0.3,  # 评分需要稳定
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        data = json.loads(cleaned)

        # 校验
        if "total_score" not in data or "dimensions" not in data:
            raise ValueError("AI评分结果格式错误")

        if not isinstance(data["dimensions"], list) or len(data["dimensions"]) != 5:
            raise ValueError("AI评分结果维度不完整")

        logger.info(
            f"AI评分完成: total_score={data.get('total_score')}, level={data.get('level')}, "
            f"content_length={len(content)}"
        )
        return data


# ============ 基于评分改进正文 Prompt ============

IMPROVE_SYSTEM = """你是短故事爆款修订专家。
你的任务是：根据AI评分给出的改进点，对短故事正文进行精准修订，提升作品质量。

【修订原则】
1. 必须严格针对评分给出的 issues（问题）、suggestions（改进建议）、top_issues（最严重问题）、improvement_priority（优先级建议）进行修改
2. 保留原文的整体框架、核心反转、主要人物和关键情节，不要推倒重写
3. 修订要精准到位：评分指出的问题必须解决，没问题的部分不要乱改
4. 修订后必须仍然符合爆款方法论：黄金结构比例、情绪曲线节奏、人设标签化、台词功能性
5. 修订后正文长度应与原文相近（允许±15%浮动），不要大幅扩写或删减
6. 直接输出修订后的完整正文，不要加任何解释、说明或前后缀

【爆款方法论备忘】
- 黄金结构：Hook 5% + Escalation 20% + Climax 60% + Resolution 15%
- 情绪曲线：每1000-1500字一次小冲突/揭秘，无超过500字纯说明
- 人设：标签化（清醒大女主/极致恶毒绿茶/软饭硬吃渣男等），一眼认清阵营
- 对话：每句台词必须具备暴露阴谋或推进爽点的功能，删日常寒暄
- 开头：前300字必须出现核心矛盾，不写铺垫
- 去AI味：台词口语化，删排比句和空洞形容词"""

IMPROVE_USER = """请根据AI评分的改进点，对以下短故事正文进行精准修订。

=== 故事设定 ===
标题：{title}
情绪目标：{emotion_goal}
一句话梗概：{logline}
核心反转：{twist_type} - {twist_content}
题材标签：{genre}
目标字数：{target_words}
{emotion_curve_hint}
=== 当前评分 ===
总分：{total_score}/100（{level}）
总体评价：{overall_evaluation}

=== 最严重问题（必须优先解决）===
{top_issues}

=== 按优先级排序的修改建议 ===
{improvement_priority}

=== 各维度详细问题与建议 ===
{dimensions_detail}

=== 原文正文 ===
{content}

请严格按上述改进点修订正文，直接输出修订后的完整正文，不要加任何解释。"""


def _format_emotion_curve_for_prompt(emotion_curve: str | None) -> str:
    """将emotion_curve JSON转为AI Prompt可读的文本

    emotion_curve格式: [{"stage": "opening", "emotion": "紧张/震惊", "intensity": 7}, ...]
    """
    if not emotion_curve:
        return ""
    try:
        nodes = json.loads(emotion_curve)
        if not isinstance(nodes, list) or not nodes:
            return ""
    except (json.JSONDecodeError, TypeError):
        return ""

    stage_map = {
        "opening": "开头（Hook）",
        "buildup": "铺垫（冲突激化）",
        "twist": "反转（高潮）",
        "ending": "结尾（收尾）",
    }
    lines = ["【情绪曲线设定】"]
    for node in nodes:
        stage = node.get("stage", "")
        emotion = node.get("emotion", "")
        intensity = node.get("intensity", 5)
        label = stage_map.get(stage, stage)
        lines.append(f"  {label}：情绪「{emotion}」，强度{intensity}/10")
    lines.append("请严格按此情绪曲线设定控制各段情绪节奏。")
    return "\n".join(lines)


def _format_dimensions_for_improve(dimensions: list) -> str:
    """将评分维度格式化为改进输入文本"""
    lines = []
    for dim in dimensions:
        name = dim.get("name", "")
        score = dim.get("score", 0)
        max_score = dim.get("max_score", 0)
        issues = dim.get("issues", [])
        suggestions = dim.get("suggestions", [])

        lines.append(f"【{name}】得分 {score}/{max_score}")
        if issues:
            lines.append("  问题：")
            for i, issue in enumerate(issues, 1):
                lines.append(f"    {i}. {issue}")
        if suggestions:
            lines.append("  建议：")
            for i, s in enumerate(suggestions, 1):
                lines.append(f"    {i}. {s}")
        lines.append("")
    return "\n".join(lines).strip()


class StoryImprover:
    """基于评分结果的短故事改进器"""

    @staticmethod
    async def improve_from_score(
        ai_service: AIService,
        title: str,
        content: str,
        score_data: dict,
        emotion_goal: str = "",
        logline: str = "",
        twist_type: str = "",
        twist_content: str = "",
        genre: str = "",
        target_words: int = 12000,
        emotion_curve: str = "",
    ) -> str:
        """根据AI评分结果改进正文"""
        if not content or len(content.strip()) < 100:
            raise ValueError("正文内容过短，无法改进（至少需要100字）")

        if not score_data or "dimensions" not in score_data:
            raise ValueError("评分数据无效，无法改进")

        top_issues = score_data.get("top_issues") or []
        improvement_priority = score_data.get("improvement_priority") or []
        dimensions = score_data.get("dimensions") or []

        if not top_issues and not improvement_priority and not any(d.get("issues") or d.get("suggestions") for d in dimensions):
            raise ValueError("评分结果中没有需要改进的问题，无需改进")

        emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)
        user_prompt = IMPROVE_USER.format(
            title=title or "未命名",
            emotion_goal=emotion_goal or "未设定",
            logline=logline or "未设定",
            twist_type=twist_type or "未设定",
            twist_content=twist_content or "未设定",
            genre=genre or "未设定",
            target_words=target_words,
            emotion_curve_hint=emotion_curve_hint,
            total_score=score_data.get("total_score", 0),
            level=score_data.get("level", "未评级"),
            overall_evaluation=score_data.get("overall_evaluation", ""),
            top_issues="\n".join(f"{i+1}. {issue}" for i, issue in enumerate(top_issues)) if top_issues else "无",
            improvement_priority="\n".join(f"{i+1}. {s}" for i, s in enumerate(improvement_priority)) if improvement_priority else "无",
            dimensions_detail=_format_dimensions_for_improve(dimensions),
            content=content,
        )

        result = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt,
            system_prompt=IMPROVE_SYSTEM,
            temperature=0.55,  # 修订需要一定创造性但保持稳定
        ):
            result += chunk

        logger.info(
            f"AI基于评分改进完成: 原文长度={len(content)}, 改进后长度={len(result)}, "
            f"原评分={score_data.get('total_score')}/100"
        )
        return result.strip()


# ============ AI 自查清单 Prompt ============

CHECKLIST_SYSTEM = """你是短故事爆款质量检查专家。
你的任务是：根据爆款方法论，对短故事正文逐项检查自查清单中的每一项，判断是否通过。

【检查标准】
1. 开头查验：前300字是否出现核心矛盾？如果开头是铺垫背景、环境描写、人物介绍而非冲突现场，则不通过。
2. 废话查验：是否有超过3行无意义的环境/心理描写？排比句和空洞描写也算废话。
3. 卡点查验：每个段落结尾是否勾住读者继续看？是否有让人非看下去不可的悬念？
4. 去AI味查验：台词是否像真人说话？是否有大篇幅排比句和空洞形容词？AI常见的"不禁"、"竟然"等标记词。
5. 情绪曲线：每1000-1500字是否有一次小冲突或小揭秘？是否有超过500字纯说明性废话？
6. 人设查验：人设是否高度标签化？读者能否一眼认清阵营？
7. 对话查验：每句台词是否具备暴露阴谋或推进爽点的功能？日常寒暄是否已删除？
8. 选题查验：选题是否具备高概念？一句话能否说清爆点？

【返回格式】
必须返回如下JSON：
{
  "items": [
    {"id": "opening_conflict", "checked": true, "evidence": "前300字中'他一把将她抵在墙上'直接制造冲突"},
    {"id": "no_padding", "checked": false, "evidence": "第5段有4行纯环境描写'夕阳西下...余晖洒在...'"},
    ...
  ]
}
每个item必须包含id、checked（是否通过）、evidence（检查依据，引用正文片段）。"""

CHECKLIST_USER = """请对以下短故事正文逐项检查自查清单：

【情绪目标】{emotion_goal}
【情绪曲线设定】{emotion_curve_hint}

【自查清单项】
{checklist_items}

【正文】
{content}

请逐项检查，返回JSON结果。每项必须引用正文片段作为检查依据。"""


class ChecklistChecker:
    """AI自查清单检查器"""

    @staticmethod
    async def check_checklist(
        ai_service: AIService,
        content: str,
        checklist: list[dict],
        emotion_goal: str = "",
        emotion_curve: str = "",
    ) -> list[dict]:
        """AI逐项检查自查清单，返回每项的checked和evidence"""
        if not content or len(content.strip()) < 100:
            raise ValueError("正文内容过短，无法检查（至少需要100字）")

        if not checklist:
            raise ValueError("自查清单为空")

        # 格式化清单项
        items_text = "\n".join(
            f"{i+1}. id={item.get('id')}, 检查项：{item.get('item')}"
            for i, item in enumerate(checklist)
        )

        emotion_curve_hint = _format_emotion_curve_for_prompt(emotion_curve)

        user_prompt = CHECKLIST_USER.format(
            emotion_goal=emotion_goal or "未设定",
            emotion_curve_hint=emotion_curve_hint or "未设定",
            checklist_items=items_text,
            content=content,
        )

        accumulated = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=user_prompt,
            system_prompt=CHECKLIST_SYSTEM,
            temperature=0.2,  # 检查需要精确稳定
        ):
            accumulated += chunk

        cleaned = clean_json_response(accumulated)
        data = json.loads(cleaned)

        results = data.get("items", [])
        if not isinstance(results, list):
            raise ValueError("AI检查结果格式错误")

        logger.info(
            f"AI自查清单完成: items={len(results)}, "
            f"passed={sum(1 for r in results if r.get('checked'))}, "
            f"failed={sum(1 for r in results if not r.get('checked'))}"
        )
        return results
