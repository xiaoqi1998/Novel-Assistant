"""天命六道验证门服务 - 章节快照的质检车间

核心职责：
1. 对 ChapterSnapshot 执行六道门校验
2. 前4门为规则引擎（毫秒级），后2门为AI判断（秒级）
3. 写入 ChapterSnapshot 的 4 个校验字段：
   - validation_status: not_checked/passed/warnings/failed
   - validation_report: 六道门详细结果
   - needs_revision: 是否需要修正
   - revision_suggestions: 结构化修正建议

六道门：
1. 协议解析门（规则）- CHANGES JSON 是否合法、12类key齐全
2. 引用检查门（规则）- CHANGES 引用的实体在数据库是否真实存在
3. 一致性检查门（规则）- 与前一章快照对比，已死角色是否复活等
4. 未知实体检查门（规则）- 正文出现的人名是否在角色表登记
5. 描写一致性门（AI）- 角色外貌/能力描写与档案是否一致
6. 蓝图存在性检查门（AI）- 大纲要求的实体/事件是否在本章出现

执行策略（已与用户确认）：
- 异步触发（快照创建后）：仅跑前4门规则门，毫秒级完成
- 手动触发（天命页"完整校验"）：跑全部6门，含2门AI
"""
from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple, TYPE_CHECKING
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import re
import json

from app.logger import get_logger

logger = get_logger(__name__)

if TYPE_CHECKING:
    from app.models.chapter_snapshot import ChapterSnapshot
    from app.models.character import Character
    from app.models.chapter import Chapter
    from app.models.item import Item
    from app.models.secret import Secret
    from app.models.vow import Vow


class ValidationService:
    """六道验证门服务"""

    # 六道门标识（与 chapter_snapshot.validation_report 结构对应）
    GATE_KEYS = [
        "protocol_parse",
        "reference_check",
        "consistency_check",
        "unknown_entity_check",
        "description_consistency",
        "blueprint_presence_check",
    ]

    # 规则门（前4门）- 异步触发时执行
    RULE_GATES = {
        "protocol_parse",
        "reference_check",
        "consistency_check",
        "unknown_entity_check",
    }

    # AI门（后2门）- 手动触发时执行
    AI_GATES = {
        "description_consistency",
        "blueprint_presence_check",
    }

    # 中文标签
    GATE_LABELS = {
        "protocol_parse": "协议解析",
        "reference_check": "引用检查",
        "consistency_check": "一致性检查",
        "unknown_entity_check": "未知实体",
        "description_consistency": "描写一致性",
        "blueprint_presence_check": "蓝图存在性",
    }

    # ==================== 总入口 ====================

    @staticmethod
    async def run_six_gates_and_update(
        db: AsyncSession,
        snapshot_id: str,
        content: str = "",
        run_ai_gates: bool = False,
        ai_service=None,
    ) -> Dict[str, Any]:
        """执行六道门校验并更新快照的4个校验字段

        Args:
            db: 数据库会话（独立事务）
            snapshot_id: 快照ID
            content: 章节正文（未知实体门需要）
            run_ai_gates: 是否执行AI门（False=仅规则门，True=全部6门）
            ai_service: AI服务实例（run_ai_gates=True时必传）

        Returns:
            校验结果摘要 {validation_status, validation_report, needs_revision, revision_suggestions}
        """
        from app.models.chapter_snapshot import ChapterSnapshot

        # 加载快照
        result = await db.execute(
            select(ChapterSnapshot).where(ChapterSnapshot.id == snapshot_id)
        )
        snapshot = result.scalar_one_or_none()
        if not snapshot:
            logger.warning(f"六道门校验失败：快照 {snapshot_id} 不存在")
            return {"validation_status": "not_checked", "validation_report": {}, "needs_revision": False, "revision_suggestions": []}

        logger.info(f"🔍 开始校验第{snapshot.chapter_number}章快照（AI门={'开启' if run_ai_gates else '关闭'}）")

        # 加载校验所需数据
        characters = await ValidationService._load_characters(db, snapshot.project_id)
        prev_snapshot = await ValidationService._load_prev_snapshot(db, snapshot.project_id, snapshot.chapter_number)
        chapter = await ValidationService._load_chapter(db, snapshot.chapter_id)

        # 执行规则门
        report: Dict[str, Any] = {}
        report["protocol_parse"] = ValidationService._gate_protocol_parse(snapshot.changes_data)
        report["reference_check"] = await ValidationService._gate_reference_check(
            db, snapshot.changes_data, snapshot.project_id, characters
        )
        report["consistency_check"] = ValidationService._gate_consistency_check(
            snapshot.changes_data, prev_snapshot, characters
        )
        report["unknown_entity_check"] = ValidationService._gate_unknown_entity(
            content or (chapter.content if chapter else ""), characters
        )

        # 执行AI门（可选）
        if run_ai_gates and ai_service:
            try:
                report["description_consistency"] = await ValidationService._gate_description_consistency(
                    ai_service, content or (chapter.content if chapter else ""), characters
                )
                report["blueprint_presence_check"] = await ValidationService._gate_blueprint_presence(
                    ai_service, db, snapshot, content or (chapter.content if chapter else "")
                )
            except Exception as e:
                logger.warning(f"AI门校验失败（不影响规则门结果）: {e}")
                # AI门失败标记为未校验
                report["description_consistency"] = {"passed": True, "issues": [], "skipped": True, "message": f"AI门执行失败: {e}"}
                report["blueprint_presence_check"] = {"passed": True, "issues": [], "skipped": True, "message": f"AI门执行失败: {e}"}
        else:
            # AI门未执行，标记为not_checked
            report["description_consistency"] = {"passed": True, "issues": [], "skipped": True, "message": "AI门未执行（需手动触发完整校验）"}
            report["blueprint_presence_check"] = {"passed": True, "issues": [], "skipped": True, "message": "AI门未执行（需手动触发完整校验）"}

        # 聚合状态
        validation_status, needs_revision, suggestions = ValidationService._aggregate_results(report)

        # 写入快照
        snapshot.validation_status = validation_status
        snapshot.validation_report = report
        snapshot.needs_revision = needs_revision
        snapshot.revision_suggestions = suggestions

        await db.commit()
        logger.info(f"✅ 第{snapshot.chapter_number}章校验完成: status={validation_status}, needs_revision={needs_revision}")

        return {
            "validation_status": validation_status,
            "validation_report": report,
            "needs_revision": needs_revision,
            "revision_suggestions": suggestions,
        }

    # ==================== 数据加载 ====================

    @staticmethod
    async def _load_characters(db: AsyncSession, project_id: str) -> List["Character"]:
        from app.models.character import Character
        result = await db.execute(
            select(Character).where(Character.project_id == project_id)
        )
        return list(result.scalars().all())

    @staticmethod
    async def _load_prev_snapshot(db: AsyncSession, project_id: str, current_chapter_number: int) -> Optional["ChapterSnapshot"]:
        """加载前一章快照用于一致性对比"""
        from app.models.chapter_snapshot import ChapterSnapshot
        result = await db.execute(
            select(ChapterSnapshot)
            .where(and_(
                ChapterSnapshot.project_id == project_id,
                ChapterSnapshot.chapter_number < current_chapter_number,
            ))
            .order_by(ChapterSnapshot.chapter_number.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def _load_chapter(db: AsyncSession, chapter_id: str) -> Optional["Chapter"]:
        from app.models.chapter import Chapter
        result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
        return result.scalar_one_or_none()

    # ==================== 门1：协议解析 ====================

    @staticmethod
    def _gate_protocol_parse(changes_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """协议解析门 - 检查CHANGES JSON是否合法、12类key齐全"""
        if not changes_data:
            return {
                "passed": False,
                "issues": [{"severity": "critical", "issue": "CHANGES为空，章节未声明任何状态变更"}],
            }

        # 检查必需的12类key
        required_keys = [
            "character_state_changes", "conflict_progress_changes", "new_plot_nodes",
            "foreshadow_actions", "location_state_changes", "faction_state_changes",
            "time_progression", "character_movements", "item_transfers",
            "secret_reveals", "vow_changes", "deadline_changes",
        ]
        missing_keys = [k for k in required_keys if k not in changes_data]
        if missing_keys:
            return {
                "passed": False,
                "issues": [{
                    "severity": "major",
                    "issue": f"CHANGES缺少必需的key: {', '.join(missing_keys)}",
                }],
            }

        # 检查key类型正确性
        type_issues = []
        for key in required_keys:
            if key == "time_progression":
                if not isinstance(changes_data.get(key), dict):
                    type_issues.append(f"{key} 应为对象(dict)")
            else:
                if not isinstance(changes_data.get(key), list):
                    type_issues.append(f"{key} 应为数组(list)")

        if type_issues:
            return {
                "passed": False,
                "issues": [{"severity": "major", "issue": "; ".join(type_issues)}],
            }

        return {"passed": True, "issues": []}

    # ==================== 门2：引用检查 ====================

    @staticmethod
    async def _gate_reference_check(
        db: AsyncSession, changes_data: Optional[Dict[str, Any]],
        project_id: str, characters: List["Character"]
    ) -> Dict[str, Any]:
        """引用检查门 - CHANGES引用的角色/物品/地点在数据库是否真实存在"""
        from app.models.item import Item
        from app.models.secret import Secret
        from app.models.vow import Vow

        if not changes_data:
            return {"passed": True, "issues": []}

        issues: List[Dict[str, Any]] = []
        char_names = {c.name for c in characters}
        item_names = {i.name for i in (await db.execute(select(Item).where(Item.project_id == project_id))).scalars().all()} if changes_data.get("item_transfers") else set()
        secret_titles = {s.title for s in (await db.execute(select(Secret).where(Secret.project_id == project_id))).scalars().all()} if changes_data.get("secret_reveals") else set()
        vow_titles = {v.title for v in (await db.execute(select(Vow).where(Vow.project_id == project_id))).scalars().all()} if changes_data.get("vow_changes") else set()

        # 检查角色移动引用的角色名
        for mv in changes_data.get("character_movements", []):
            name = mv.get("name") if isinstance(mv, dict) else None
            if name and name not in char_names:
                issues.append({
                    "severity": "major",
                    "issue": f"角色移动引用了未登记的角色「{name}」",
                    "field": "character_movements",
                    "suggestion": f"请先在角色表登记「{name}」，或修正CHANGES中的名称",
                })

        # 检查物品流转引用的物品名
        for it in changes_data.get("item_transfers", []):
            item_name = it.get("item_name") if isinstance(it, dict) else None
            if item_name and item_name not in item_names:
                issues.append({
                    "severity": "major",
                    "issue": f"物品流转引用了未登记的物品「{item_name}」",
                    "field": "item_transfers",
                })

        # 检查秘密揭露引用的秘密标题
        for sr in changes_data.get("secret_reveals", []):
            title = sr.get("title") if isinstance(sr, dict) else None
            if title and title not in secret_titles:
                issues.append({
                    "severity": "major",
                    "issue": f"秘密揭露引用了未登记的秘密「{title}」",
                    "field": "secret_reveals",
                })

        # 检查誓约变化引用的誓约标题
        for vc in changes_data.get("vow_changes", []):
            title = vc.get("title") if isinstance(vc, dict) else None
            if title and title not in vow_titles:
                issues.append({
                    "severity": "major",
                    "issue": f"誓约变化引用了未登记的誓约「{title}」",
                    "field": "vow_changes",
                })

        return {
            "passed": len(issues) == 0,
            "issues": issues,
        }

    # ==================== 门3：一致性检查 ====================

    @staticmethod
    def _gate_consistency_check(
        changes_data: Optional[Dict[str, Any]],
        prev_snapshot: Optional[ChapterSnapshot],
        characters: List[Character]
    ) -> Dict[str, Any]:
        """一致性检查门 - 与前一章快照对比，检测矛盾"""
        if not changes_data or not prev_snapshot:
            return {"passed": True, "issues": []}

        issues: List[Dict[str, Any]] = []
        prev_snapshot_data = prev_snapshot.snapshot_data or {}

        # 构建"已死亡/已销毁/已遗失"实体清单
        dead_chars = {c.name for c in characters if c.status == "deceased"}
        destroyed_items = set()
        lost_items = set()

        for item_state in prev_snapshot_data.get("item_states", []):
            status = item_state.get("status") if isinstance(item_state, dict) else None
            name = item_state.get("name") if isinstance(item_state, dict) else None
            if status == "destroyed" and name:
                destroyed_items.add(name)
            elif status == "lost" and name:
                lost_items.add(name)

        # 检查角色移动中是否包含已死角色"复活"
        for mv in changes_data.get("character_movements", []):
            name = mv.get("name") if isinstance(mv, dict) else None
            if name and name in dead_chars:
                issues.append({
                    "severity": "critical",
                    "issue": f"角色「{name}」在前一章已死亡，但本章再次出现移动记录",
                    "evidence": f"CHANGES.character_movements: {name} 从 {mv.get('from_location')} 到 {mv.get('to_location')}",
                    "suggestion": f"删除该角色的出现，或修改为回忆/幻觉/复活场景",
                })

        # 检查物品流转中是否引用已销毁物品
        for it in changes_data.get("item_transfers", []):
            item_name = it.get("item_name") if isinstance(it, dict) else None
            if item_name and item_name in destroyed_items:
                issues.append({
                    "severity": "critical",
                    "issue": f"物品「{item_name}」在前一章已摧毁，但本章再次出现流转记录",
                    "suggestion": f"删除该物品的流转，或修改为残片/重塑场景",
                })

        # 检查角色状态变化是否与当前状态矛盾
        for csc in changes_data.get("character_state_changes", []):
            name = csc.get("name") if isinstance(csc, dict) else None
            field_name = csc.get("field") if isinstance(csc, dict) else None
            if name and name in dead_chars and field_name != "status":
                issues.append({
                    "severity": "major",
                    "issue": f"角色「{name}」已死亡，但本章出现状态变化记录（{field_name}）",
                    "suggestion": "死亡角色不应有状态变化",
                })

        return {
            "passed": len(issues) == 0,
            "issues": issues,
        }

    # ==================== 门4：未知实体检查 ====================

    @staticmethod
    def _gate_unknown_entity(content: str, characters: List[Character]) -> Dict[str, Any]:
        """未知实体检查门 - 正文出现的人名是否在角色表登记"""
        if not content:
            return {"passed": True, "issues": [], "unknown_count": 0, "npc_count": 0}

        char_names = {c.name for c in characters if not c.is_organization}
        org_names = {c.name for c in characters if c.is_organization}
        all_known = char_names | org_names

        # 提取正文中可能的人名（中文姓名2-4字，大写英文姓名）
        # 使用简单规则：识别对话引号后的"XX道/说/笑/问"模式
        unknown_names = set()

        # 模式1：中文姓名 + 道/说/笑/问/喊/叫/答/怒/惊 等
        speech_patterns = [
            r'"[^"]*?"\s*["""]?\s*([\u4e00-\u9fa5]{2,4})\s*(?:道|说|笑|问|喊|叫|答|怒|惊|叹|嗤|冷声|冷哼|低声|轻声)',
            r'([\u4e00-\u9fa5]{2,4})\s*(?:道|说|笑|问|喊|叫|答|怒|惊|叹|嗤|冷声|冷哼|低声|轻声)\s*[:：]',
        ]
        for pattern in speech_patterns:
            matches = re.findall(pattern, content)
            for name in matches:
                # 过滤常见动词误识别
                if name in {"然后", "但是", "因为", "所以", "如果", "虽然", "不过", "于是", "突然", "忽然", "似乎", "这个", "那个", "什么", "怎么", "为何", "为什么"}:
                    continue
                if name not in all_known:
                    unknown_names.add(name)

        # 模式2：常见称呼（X先生/X姑娘/X公子/X长老/X师父 等）
        title_pattern = r'([\u4e00-\u9fa5]{2,3})(?:先生|姑娘|公子|长老|师父|师傅|大人|前辈|前辈|阁下|陛下|殿下|小姐|夫人|太太|老爷|少爷| Miss|Mr)'
        for name in re.findall(title_pattern, content):
            if name not in all_known:
                unknown_names.add(name)

        issues = []
        for name in list(unknown_names)[:20]:  # 限制最多报告20个
            issues.append({
                "severity": "minor",
                "issue": f"正文出现未登记的人名「{name}」",
                "suggestion": f"若为重要角色，请在角色表登记；若为路人NPC，可忽略",
            })

        return {
            "passed": len(unknown_names) == 0,
            "issues": issues,
            "unknown_count": len(unknown_names),
            "npc_count": len(unknown_names),  # 语义同义，保留两个key便于前端展示
        }

    # ==================== 门5：描写一致性（AI门） ====================

    @staticmethod
    async def _gate_description_consistency(
        ai_service, content: str, characters: List[Character]
    ) -> Dict[str, Any]:
        """描写一致性门（AI门）- 角色外貌/能力描写与档案是否一致"""
        if not content or not characters:
            return {"passed": True, "issues": []}

        # 只检查有外貌档案的主要角色（前5个，避免prompt过长）
        main_chars = [c for c in characters if c.appearance and not c.is_organization][:5]
        if not main_chars:
            return {"passed": True, "issues": [], "skipped": True, "message": "无角色外貌档案可校验"}

        char_profiles = "\n".join([
            f"- {c.name}：{(c.appearance or '')[:200]}"
            for c in main_chars
        ])

        prompt = f"""请检查以下章节正文中的角色外貌描写是否与角色档案一致。

## 角色档案
{char_profiles}

## 章节正文（节选前3000字）
{content[:3000]}

## 检查要求
1. 比对正文中角色外貌描写（如发色、瞳色、身高、伤疤、服装）与档案是否一致
2. 检查角色能力描写是否超出档案设定
3. 只报告明显矛盾，不报告细微差异

## 输出格式（JSON）
{{
  "issues": [
    {{
      "character": "角色名",
      "severity": "critical|major|minor",
      "issue": "问题描述",
      "evidence": "正文证据片段",
      "suggestion": "修正建议"
    }}
  ]
}}

若无不一致问题，返回 {{"issues": []}}。只输出JSON，不要其他文字。"""

        try:
            result = await ai_service.generate_text(
                prompt=prompt,
                temperature=0.1,
                max_tokens=1000,
                auto_mcp=False,
            )
            text = result.get("content", "") if isinstance(result, dict) else (result or "")
            # 清理可能的markdown包裹
            text = text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
            data = json.loads(text)
            issues = data.get("issues", [])
            return {
                "passed": len(issues) == 0,
                "issues": issues,
            }
        except json.JSONDecodeError as e:
            logger.warning(f"描写一致性门 AI输出解析失败: {e}")
            return {"passed": True, "issues": [], "skipped": True, "message": "AI输出解析失败"}
        except Exception as e:
            logger.warning(f"描写一致性门 执行失败: {e}")
            raise

    # ==================== 门6：蓝图存在性（AI门） ====================

    @staticmethod
    async def _gate_blueprint_presence(
        ai_service, db: AsyncSession, snapshot: ChapterSnapshot, content: str
    ) -> Dict[str, Any]:
        """蓝图存在性检查门（AI门）- 大纲要求的实体/事件是否在本章出现"""
        if not content:
            return {"passed": True, "issues": []}

        # 加载章节大纲
        chapter = await ValidationService._load_chapter(db, snapshot.chapter_id)
        if not chapter or not chapter.outline:
            return {"passed": True, "issues": [], "skipped": True, "message": "无章节大纲可校验"}

        outline_text = chapter.outline if isinstance(chapter.outline, str) else json.dumps(chapter.outline, ensure_ascii=False)

        prompt = f"""请检查章节正文是否完整呈现了大纲要求的关键实体和事件。

## 本章大纲
{outline_text[:2000]}

## 章节正文（节选前5000字）
{content[:5000]}

## 检查要求
1. 检查大纲要求的关键角色是否在本章出现
2. 检查大纲要求的关键事件是否在本章发生
3. 检查大纲要求的关键场景/地点是否在本章呈现
4. 只报告"明显缺失"的实体/事件，不报告细节差异

## 输出格式（JSON）
{{
  "issues": [
    {{
      "entity": "缺失的实体/事件名",
      "severity": "major|minor",
      "issue": "问题描述",
      "suggestion": "建议处理方式"
    }}
  ],
  "missing_entities": ["缺失实体1", "缺失实体2"]
}}

若全部齐全，返回 {{"issues": [], "missing_entities": []}}。只输出JSON，不要其他文字。"""

        try:
            result = await ai_service.generate_text(
                prompt=prompt,
                temperature=0.1,
                max_tokens=1000,
                auto_mcp=False,
            )
            text = result.get("content", "") if isinstance(result, dict) else (result or "")
            text = text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
            data = json.loads(text)
            issues = data.get("issues", [])
            missing = data.get("missing_entities", [])
            return {
                "passed": len(issues) == 0 and len(missing) == 0,
                "issues": issues,
                "missing_entities": missing,
            }
        except json.JSONDecodeError as e:
            logger.warning(f"蓝图存在性门 AI输出解析失败: {e}")
            return {"passed": True, "issues": [], "skipped": True, "message": "AI输出解析失败"}
        except Exception as e:
            logger.warning(f"蓝图存在性门 执行失败: {e}")
            raise

    # ==================== 结果聚合 ====================

    @staticmethod
    def _aggregate_results(report: Dict[str, Any]) -> Tuple[str, bool, List[Dict[str, Any]]]:
        """聚合六道门结果，生成 validation_status / needs_revision / revision_suggestions

        Returns:
            (validation_status, needs_revision, revision_suggestions)
            - validation_status: passed / warnings / failed
            - needs_revision: 是否需要修正（failed或warnings的critical级别）
            - revision_suggestions: 结构化修正建议
        """
        has_failed = False
        has_warning = False
        suggestions: List[Dict[str, Any]] = []

        for gate_key, gate_result in report.items():
            if not isinstance(gate_result, dict):
                continue

            # 跳过skipped的门
            if gate_result.get("skipped"):
                continue

            passed = gate_result.get("passed", True)
            issues = gate_result.get("issues", [])

            if not passed:
                has_failed = True
                # 将issues转为revision_suggestions
                for issue in issues:
                    if isinstance(issue, dict):
                        suggestions.append({
                            "gate": gate_key,
                            "gate_label": ValidationService.GATE_LABELS.get(gate_key, gate_key),
                            "severity": issue.get("severity", "major"),
                            "issue": issue.get("issue", ""),
                            "evidence": issue.get("evidence", ""),
                            "suggestion": issue.get("suggestion", ""),
                        })
            elif issues:
                # passed=True但有issues（warnings）
                has_warning = True
                for issue in issues:
                    if isinstance(issue, dict):
                        suggestions.append({
                            "gate": gate_key,
                            "gate_label": ValidationService.GATE_LABELS.get(gate_key, gate_key),
                            "severity": issue.get("severity", "minor"),
                            "issue": issue.get("issue", ""),
                            "evidence": issue.get("evidence", ""),
                            "suggestion": issue.get("suggestion", ""),
                        })

        # 决定状态
        if has_failed:
            validation_status = "failed"
        elif has_warning:
            validation_status = "warnings"
        else:
            validation_status = "passed"

        # needs_revision：failed必有critical/major级别建议
        critical_count = sum(1 for s in suggestions if s.get("severity") in ("critical", "major"))
        needs_revision = validation_status == "failed" and critical_count > 0

        return validation_status, needs_revision, suggestions
