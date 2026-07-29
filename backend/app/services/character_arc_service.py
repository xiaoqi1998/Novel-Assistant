"""角色弧光服务 - 提供弧光生成和管理功能"""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
import json

from app.models.character_arc import CharacterArc
from app.models.character import Character
from app.models.project import Project
from app.services.ai_service import AIService
from app.logger import get_logger

logger = get_logger(__name__)


class CharacterArcService:
    """角色弧光服务"""

    def __init__(self, ai_service: AIService):
        self.ai_service = ai_service

    @staticmethod
    def _build_arc_prompt(character: Character, project: Project, hint: str = "") -> str:
        """构建弧光生成 Prompt"""
        char_summary_parts = [f"姓名：{character.name}"]
        if character.role_type:
            role_map = {"protagonist": "主角", "antagonist": "反派", "supporting": "配角"}
            char_summary_parts.append(f"角色定位：{role_map.get(character.role_type, character.role_type)}")
        if character.personality:
            char_summary_parts.append(f"性格：{character.personality[:300]}")
        if character.background:
            char_summary_parts.append(f"背景：{character.background[:300]}")
        if getattr(character, 'current_state', None):
            char_summary_parts.append(f"当前心理/处境：{character.current_state[:200]}")
        char_summary = "\n".join(char_summary_parts)

        project_summary_parts = []
        if project.title:
            project_summary_parts.append(f"书名：{project.title}")
        if project.genre:
            project_summary_parts.append(f"类型：{project.genre}")
        if project.theme:
            project_summary_parts.append(f"主题：{project.theme}")
        if getattr(project, 'world_rules', None):
            project_summary_parts.append(f"世界规则：{project.world_rules[:300]}")
        project_summary = "\n".join(project_summary_parts)

        hint_text = f"\n用户补充要求：{hint}" if hint else ""

        prompt = f"""你是资深网文编辑，请为以下角色设计一条有深度的成长弧光。

【项目信息】
{project_summary}

【角色信息】
{char_summary}{hint_text}

请输出严格的 JSON（不要包裹在 markdown 代码块中，不要有任何额外文字），结构如下：
{{
  "arc_type": "growth|fall|redemption|awakening|sacrifice",
  "core_goal": "角色在整个弧光中追求的核心目标（一句话，具体可执行）",
  "motivation": "为什么追求这个目标（内在驱动力，50-100字）",
  "internal_conflict": "阻碍角色达成目标的心理矛盾（50-100字）",
  "external_goal": "近期外在目标（本章/近几章可推进的小目标）",
  "current_stage": "trigger",
  "stage_progress": 0,
  "target_resolution_chapter": null
}}

设计原则：
1. 弧光类型要与角色定位匹配（主角适合 growth/redemption，反派适合 fall/awakening）
2. 核心目标要具体，避免"变强""复仇"等空泛表述，要有明确的方向
3. 内在冲突要真实，是角色性格中真实的矛盾，不是外部强加的
4. 动机要深刻，与角色的背景故事和创伤相关
5. 近期目标要执行，能在接下来几章中推进"""
        return prompt

    @staticmethod
    def _clean_json_content(content: str) -> str:
        """清理可能的 markdown 代码块包裹"""
        content = content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            content = "\n".join(lines).strip()
        return content

    async def generate_arc_for_character(
        self,
        character: Character,
        project: Project,
        db: AsyncSession,
        hint: str = ""
    ) -> Optional[CharacterArc]:
        """为指定角色自动生成弧光并入库。

        失败时返回 None，避免影响主流程。
        """
        try:
            prompt = self._build_arc_prompt(character, project, hint)

            gen_response = await self.ai_service.generate_text(
                prompt=prompt,
                temperature=0.7,
            )

            content = gen_response.get("content", "") if isinstance(gen_response, dict) else str(gen_response)
            content = self._clean_json_content(content)

            arc_json = json.loads(content)

            arc = CharacterArc(
                project_id=project.id,
                character_id=character.id,
                arc_type=arc_json.get("arc_type", "growth"),
                core_goal=arc_json.get("core_goal", "未设定"),
                motivation=arc_json.get("motivation"),
                internal_conflict=arc_json.get("internal_conflict"),
                external_goal=arc_json.get("external_goal"),
                current_stage=arc_json.get("current_stage", "trigger"),
                stage_progress=arc_json.get("stage_progress", 0),
                target_resolution_chapter=arc_json.get("target_resolution_chapter"),
                status="active",
            )
            db.add(arc)
            await db.flush()
            logger.info(f"✅ 自动生成角色弧光: character_id={character.id}, type={arc.arc_type}")
            return arc

        except json.JSONDecodeError as e:
            logger.error(f"自动生成弧光 JSON 解析失败: {e}, content={content[:200]}")
            return None
        except Exception as e:
            logger.error(f"自动生成弧光失败: {e}")
            return None
