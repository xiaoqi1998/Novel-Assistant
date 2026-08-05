"""天命快照服务 - 解析 CHANGES 声明，写入章节快照，回写状态表

核心职责：
1. 从章节分析结果（PLOT_ANALYSIS 的 changes 字段）提取 12 类 CHANGES
2. 从章节生成结果（---CHANGES--- 分隔符后）提取 12 类 CHANGES
3. 将 CHANGES 写入 ChapterSnapshot 表（changes_data 字段）
4. 根据 CHANGES 回写 Item/Secret/Vow/CharacterLocation 四张新表
5. 聚合 15 维快照数据写入 ChapterSnapshot.snapshot_data
6. 提供获取项目最新快照的接口（供上下文构建器使用）

闭环：第 N 章快照写入 → 第 N+1 章上下文构建器读取快照 → AI 按快照写作
"""
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.models import (
    ChapterSnapshot, Character, CharacterArc, Foreshadow,
    Organization, OrganizationMember, CharacterRelationship,
    Item, Secret, Vow, CharacterLocation, Project,
)
from app.logger import get_logger
import json
import re

logger = get_logger(__name__)

# ---CHANGES--- 分隔符
CHANGES_SEPARATOR = "---CHANGES---"

# 兜底清洗：匹配 ---CHANGES--- 及之后所有内容（包括前导空格、换行、markdown 代码块等）
CHANGES_STRIP_RE = re.compile(r"\s*---CHANGES---\s*.*", re.DOTALL)


class SnapshotService:
    """天命快照服务 - 管理 15 维事实快照与 12 类 CHANGES 声明"""

    # 12 类 CHANGES 的 key 列表
    CHANGES_KEYS = [
        "character_state_changes",
        "conflict_progress_changes",
        "new_plot_nodes",
        "foreshadow_actions",
        "location_state_changes",
        "faction_state_changes",
        "time_progression",
        "character_movements",
        "item_transfers",
        "secret_reveals",
        "vow_changes",
        "deadline_changes",
    ]

    # ==================== 解析 CHANGES ====================

    @staticmethod
    def strip_changes_marker(text: Optional[str]) -> str:
        """最终兜底：从章节正文中删除 ---CHANGES--- 及后续 JSON。

        即使 AI 输出格式异常或 parse_changes_from_generation 解析失败，
        也能保证写入 chapter.content 的正文不含 CHANGES 声明。
        """
        if not text:
            return text or ""
        return CHANGES_STRIP_RE.sub("", text).rstrip()

    @staticmethod
    def parse_changes_from_generation(text: str) -> Tuple[str, Optional[Dict[str, Any]]]:
        """从章节生成结果中分离正文与 CHANGES 声明

        章节生成模板要求 AI 在正文后输出 ---CHANGES--- 分隔符 + JSON。
        此方法将文本拆分为 (纯正文, changes_dict)。

        Args:
            text: AI 生成的完整文本（正文 + ---CHANGES--- + JSON）

        Returns:
            (正文, changes字典)。如果未找到分隔符，changes 为 None。
        """
        if not text:
            return text, None

        idx = text.find(CHANGES_SEPARATOR)
        if idx == -1:
            # 未找到分隔符，整个文本作为正文处理
            logger.debug("未找到 ---CHANGES--- 分隔符，整段作为正文处理")
            return text, None

        # 分离正文和 CHANGES JSON；同步用正则兜底，确保 content 不含 ---CHANGES--- 及后续
        content = SnapshotService.strip_changes_marker(text[:idx])
        changes_raw = text[idx + len(CHANGES_SEPARATOR):].strip()

        if not changes_raw:
            logger.warning("找到 ---CHANGES--- 分隔符，但后面没有内容")
            return content, None

        # 尝试解析 JSON
        try:
            # 清理可能的 markdown 包裹
            changes_raw = changes_raw.strip()
            if changes_raw.startswith("```"):
                # 去除 markdown 代码块
                changes_raw = re.sub(r"^```(?:json)?\s*", "", changes_raw)
                changes_raw = re.sub(r"\s*```$", "", changes_raw)

            changes = json.loads(changes_raw)
            # 补齐缺失的 key
            for key in SnapshotService.CHANGES_KEYS:
                if key not in changes:
                    if key == "time_progression":
                        changes[key] = {}
                    else:
                        changes[key] = []
            logger.info(f"✅ 从生成结果解析出 CHANGES（{sum(len(v) if isinstance(v, list) else 1 for v in changes.values())} 项）")
            return content, changes
        except json.JSONDecodeError as e:
            logger.warning(f"⚠️ CHANGES JSON 解析失败: {e}")
            return content, None

    @staticmethod
    def parse_changes_from_analysis(analysis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """从 PLOT_ANALYSIS 分析结果中提取 changes 字段

        PLOT_ANALYSIS 模板已扩展，AI 在 JSON 输出中包含 changes 字段。

        Args:
            analysis: PlotAnalyzer.analyze_chapter 返回的分析结果

        Returns:
            changes 字典，如果分析结果中没有 changes 则返回 None
        """
        if not analysis:
            return None

        changes = analysis.get("changes")
        if not changes or not isinstance(changes, dict):
            logger.debug("分析结果中无 changes 字段")
            return None

        # 补齐缺失的 key
        for key in SnapshotService.CHANGES_KEYS:
            if key not in changes:
                if key == "time_progression":
                    changes[key] = {}
                else:
                    changes[key] = []

        logger.info(f"✅ 从分析结果提取 CHANGES（{sum(len(v) if isinstance(v, list) else 1 for v in changes.values())} 项）")
        return changes

    # ==================== 创建快照 ====================

    @staticmethod
    async def create_snapshot_from_analysis(
        db: AsyncSession,
        project_id: str,
        chapter_id: str,
        chapter_number: int,
        analysis: Dict[str, Any],
    ) -> Optional[ChapterSnapshot]:
        """从分析结果创建章节快照

        在 PlotAnalyzer 分析完成后调用，将分析结果中的 changes 持久化。

        Args:
            db: 数据库会话
            project_id: 项目ID
            chapter_id: 章节ID
            chapter_number: 章节号
            analysis: 分析结果

        Returns:
            创建的 ChapterSnapshot，失败返回 None
        """
        changes = SnapshotService.parse_changes_from_analysis(analysis)
        if not changes:
            logger.info(f"第{chapter_number}章分析结果无 CHANGES，跳过快照创建")
            return None

        return await SnapshotService._create_or_update_snapshot(
            db, project_id, chapter_id, chapter_number,
            changes, source="analysis"
        )

    @staticmethod
    async def create_snapshot_from_generation(
        db: AsyncSession,
        project_id: str,
        chapter_id: str,
        chapter_number: int,
        generation_text: str,
    ) -> Tuple[str, Optional[ChapterSnapshot]]:
        """从生成结果创建章节快照

        在章节生成完成后调用，分离正文与 CHANGES，将正文保存并将 CHANGES 持久化。
        同时同步触发六道门规则门校验（毫秒级，不阻塞生成流），AI门由用户在天命页手动触发。

        Args:
            db: 数据库会话
            project_id: 项目ID
            chapter_id: 章节ID
            chapter_number: 章节号
            generation_text: AI 生成的完整文本

        Returns:
            (纯正文, 快照对象)。快照可能为 None（如果无 CHANGES）。
        """
        content, changes = SnapshotService.parse_changes_from_generation(generation_text)

        if changes:
            snapshot = await SnapshotService._create_or_update_snapshot(
                db, project_id, chapter_id, chapter_number,
                changes, source="generation", content=content
            )
            return content, snapshot
        else:
            return content, None

    @staticmethod
    async def _create_or_update_snapshot(
        db: AsyncSession,
        project_id: str,
        chapter_id: str,
        chapter_number: int,
        changes: Dict[str, Any],
        source: str = "analysis",
        content: Optional[str] = None,
    ) -> ChapterSnapshot:
        """创建或更新章节快照（核心方法）

        1. 将旧快照的 is_latest 置为 False
        2. 根据 CHANGES 回写4张新表（Item/Secret/Vow/CharacterLocation）
        3. 聚合 15 维快照数据
        4. 创建 ChapterSnapshot 记录
        5. 同步触发六道门规则门校验（毫秒级，AI门由用户手动触发）

        Args:
            content: 章节正文（规则门校验需要，为None时从chapter表查询）
        """
        logger.info(f"📸 开始创建第{chapter_number}章快照（来源: {source}）")

        # 1. 标记旧快照为非最新
        await db.execute(
            update(ChapterSnapshot)
            .where(ChapterSnapshot.project_id == project_id)
            .where(ChapterSnapshot.is_latest == True)
            .values(is_latest=False)
        )

        # 2. 根据 CHANGES 回写状态表
        await SnapshotService._apply_changes_to_tables(
            db, project_id, chapter_id, chapter_number, changes
        )

        # 3. 构建 15 维快照
        snapshot_data = await SnapshotService._build_15dim_snapshot(
            db, project_id, chapter_number
        )

        # 4. 创建快照记录（upsert by chapter_id）
        existing = await db.execute(
            select(ChapterSnapshot).where(ChapterSnapshot.chapter_id == chapter_id)
        )
        existing_snapshot = existing.scalar_one_or_none()

        if existing_snapshot:
            # 更新已有快照
            existing_snapshot.changes_data = changes
            existing_snapshot.snapshot_data = snapshot_data
            existing_snapshot.source = source
            existing_snapshot.is_latest = True
            existing_snapshot.validation_status = "not_checked"
            snapshot = existing_snapshot
            logger.info(f"  📝 更新已有快照 chapter_id={chapter_id[:8]}")
        else:
            # 创建新快照
            snapshot = ChapterSnapshot(
                project_id=project_id,
                chapter_id=chapter_id,
                chapter_number=chapter_number,
                snapshot_data=snapshot_data,
                changes_data=changes,
                source=source,
                is_latest=True,
                validation_status="not_checked",
                needs_revision=False,
            )
            db.add(snapshot)
            logger.info(f"  ✨ 创建新快照 chapter_id={chapter_id[:8]}")

        await db.flush()
        logger.info(f"✅ 第{chapter_number}章快照创建完成")

        # 同步触发六道门规则门校验（毫秒级，不阻塞生成流）
        # AI门（描写一致性/蓝图存在性）由用户在天命页手动触发，避免增加2-5秒AI延迟
        try:
            from app.services.validation_service import ValidationService
            await ValidationService.run_six_gates_and_update(
                db=db,
                snapshot_id=snapshot.id,
                content=content or "",
                run_ai_gates=False,  # 仅规则门，AI门手动触发
            )
        except Exception as e:
            # 校验失败不影响快照创建（best-effort）
            logger.warning(f"⚠️ 六道门规则门校验失败（不影响快照创建）: {e}")

        return snapshot

    # ==================== 回写状态表 ====================

    @staticmethod
    async def _apply_changes_to_tables(
        db: AsyncSession,
        project_id: str,
        chapter_id: str,
        chapter_number: int,
        changes: Dict[str, Any],
    ) -> None:
        """根据 CHANGES 回写 Item/Secret/Vow/CharacterLocation 四张表"""

        # 1. 角色移动 → CharacterLocation
        movements = changes.get("character_movements", [])
        if movements:
            await SnapshotService._apply_character_movements(
                db, project_id, chapter_id, chapter_number, movements
            )

        # 2. 物品流转 → Item
        item_transfers = changes.get("item_transfers", [])
        if item_transfers:
            await SnapshotService._apply_item_transfers(
                db, project_id, chapter_number, item_transfers
            )

        # 3. 秘密揭露 → Secret
        secret_reveals = changes.get("secret_reveals", [])
        if secret_reveals:
            await SnapshotService._apply_secret_reveals(
                db, project_id, chapter_number, secret_reveals
            )

        # 4. 誓约变化 → Vow
        vow_changes = changes.get("vow_changes", [])
        if vow_changes:
            await SnapshotService._apply_vow_changes(
                db, project_id, chapter_number, vow_changes
            )

    @staticmethod
    async def _apply_character_movements(
        db: AsyncSession, project_id: str, chapter_id: str,
        chapter_number: int, movements: List[Dict[str, Any]]
    ) -> None:
        """应用角色移动变更 → 更新 CharacterLocation 表"""
        for mv in movements:
            char_name = mv.get("character_name", "")
            to_location = mv.get("to_location", "")
            from_location = mv.get("from_location", "")
            reason = mv.get("reason", "")

            if not char_name or not to_location:
                continue

            # 查找角色
            char_result = await db.execute(
                select(Character).where(
                    and_(
                        Character.project_id == project_id,
                        Character.name == char_name
                    )
                )
            )
            character = char_result.scalar_one_or_none()
            if not character:
                logger.warning(f"  移动变更：未找到角色「{char_name}」")
                continue

            # 将旧的当前位置标记为非当前
            await db.execute(
                update(CharacterLocation)
                .where(
                    and_(
                        CharacterLocation.character_id == character.id,
                        CharacterLocation.is_current == True
                    )
                )
                .values(is_current=False)
            )

            # 创建新的位置记录
            new_loc = CharacterLocation(
                project_id=project_id,
                character_id=character.id,
                location=to_location,
                previous_location=from_location,
                reason=reason,
                arrival_chapter_number=chapter_number,
                arrival_chapter_id=chapter_id,
                is_current=True,
            )
            db.add(new_loc)

            # 同步冗余字段到 Character 表，便于角色卡片直接展示当前位置
            character.current_location = to_location
            logger.info(f"  📍 {char_name}: {from_location} → {to_location}")

    @staticmethod
    async def _apply_item_transfers(
        db: AsyncSession, project_id: str,
        chapter_number: int, transfers: List[Dict[str, Any]]
    ) -> None:
        """应用物品流转变更 → 更新 Item 表"""
        for tr in transfers:
            item_name = tr.get("item_name", "")
            to_holder = tr.get("to_holder", "")
            new_status = tr.get("new_status", "")

            if not item_name:
                continue

            # 查找物品
            item_result = await db.execute(
                select(Item).where(
                    and_(
                        Item.project_id == project_id,
                        Item.name == item_name
                    )
                )
            )
            item = item_result.scalar_one_or_none()

            if item:
                # 更新已有物品
                if to_holder:
                    # 查找新持有者
                    holder_result = await db.execute(
                        select(Character).where(
                            and_(
                                Character.project_id == project_id,
                                Character.name == to_holder
                            )
                        )
                    )
                    holder = holder_result.scalar_one_or_none()
                    if holder:
                        item.current_holder_id = holder.id
                        item.current_holder_name = to_holder

                    # 追加到曾持有列表
                    related = item.related_characters or []
                    if item.current_holder_id and item.current_holder_id not in related:
                        related.append(item.current_holder_id)
                        item.related_characters = related

                if new_status:
                    item.status = new_status
                item.status_changed_chapter = chapter_number
                logger.info(f"  🗡️ {item_name} → 持有者: {to_holder}, 状态: {new_status}")
            else:
                # 物品不存在，自动创建（防止数据丢失）
                holder_id = None
                if to_holder:
                    holder_result = await db.execute(
                        select(Character).where(
                            and_(
                                Character.project_id == project_id,
                                Character.name == to_holder
                            )
                        )
                    )
                    holder = holder_result.scalar_one_or_none()
                    if holder:
                        holder_id = holder.id

                new_item = Item(
                    project_id=project_id,
                    name=item_name,
                    description=f"（自动创建于第{chapter_number}章，待补充描述）",
                    current_holder_id=holder_id,
                    current_holder_name=to_holder or None,
                    status=new_status or "active",
                    status_changed_chapter=chapter_number,
                )
                db.add(new_item)
                logger.info(f"  🗡️ 自动创建物品「{item_name}」")

    @staticmethod
    async def _apply_secret_reveals(
        db: AsyncSession, project_id: str,
        chapter_number: int, reveals: List[Dict[str, Any]]
    ) -> None:
        """应用秘密揭露变更 → 更新 Secret 表"""
        for rv in reveals:
            title = rv.get("title", "")
            new_knower = rv.get("new_knower", "")
            reveal_method = rv.get("reveal_method", "")

            if not title:
                continue

            # 查找秘密
            secret_result = await db.execute(
                select(Secret).where(
                    and_(
                        Secret.project_id == project_id,
                        Secret.title == title
                    )
                )
            )
            secret = secret_result.scalar_one_or_none()

            if secret:
                # 追加知情者
                knowers = secret.knowers or []
                if new_knower:
                    # 查找角色ID
                    char_result = await db.execute(
                        select(Character).where(
                            and_(
                                Character.project_id == project_id,
                                Character.name == new_knower
                            )
                        )
                    )
                    character = char_result.scalar_one_or_none()
                    knower_entry = {
                        "character_id": character.id if character else None,
                        "character_name": new_knower,
                        "revealed_at_chapter": chapter_number,
                        "reveal_method": reveal_method,
                    }
                    # 避免重复
                    if not any(k.get("character_name") == new_knower for k in knowers):
                        knowers.append(knower_entry)
                        secret.knowers = knowers

                # 更新揭露状态
                if secret.status == "hidden":
                    secret.status = "partially_revealed"
                elif secret.status == "partially_revealed":
                    # 如果知情者很多，升级为 revealed
                    if len(knowers) >= 3:
                        secret.status = "revealed"

                secret.status_changed_chapter = chapter_number
                logger.info(f"  🔑 秘密「{title}」新增知情者: {new_knower}")
            else:
                # 秘密不存在，自动创建
                knower_id = None
                if new_knower:
                    char_result = await db.execute(
                        select(Character).where(
                            and_(
                                Character.project_id == project_id,
                                Character.name == new_knower
                            )
                        )
                    )
                    character = char_result.scalar_one_or_none()
                    knower_id = character.id if character else None

                new_secret = Secret(
                    project_id=project_id,
                    title=title,
                    content=f"（自动创建于第{chapter_number}章，待补充内容）",
                    status="partially_revealed",
                    status_changed_chapter=chapter_number,
                    knowers=[{
                        "character_id": knower_id,
                        "character_name": new_knower,
                        "revealed_at_chapter": chapter_number,
                        "reveal_method": reveal_method,
                    }] if new_knower else [],
                )
                db.add(new_secret)
                logger.info(f"  🔑 自动创建秘密「{title}」")

    @staticmethod
    async def _apply_vow_changes(
        db: AsyncSession, project_id: str,
        chapter_number: int, vow_changes: List[Dict[str, Any]]
    ) -> None:
        """应用誓约变更 → 更新 Vow 表"""
        for vc in vow_changes:
            title = vc.get("title", "")
            change_action = vc.get("change_action", "")
            conditions = vc.get("conditions", "")

            if not title:
                continue

            # 查找誓约
            vow_result = await db.execute(
                select(Vow).where(
                    and_(
                        Vow.project_id == project_id,
                        Vow.title == title
                    )
                )
            )
            vow = vow_result.scalar_one_or_none()

            if vow:
                # 更新誓约状态
                action_map = {
                    "broken": "broken",
                    "fulfilled": "fulfilled",
                    "expired": "expired",
                    "suspended": "suspended",
                    "established": "active",
                }
                new_status = action_map.get(change_action, vow.status)
                vow.status = new_status
                vow.status_changed_chapter = chapter_number
                logger.info(f"  ⚖️ 誓约「{title}」状态 → {new_status}")
            else:
                # 誓约不存在，自动创建
                new_vow = Vow(
                    project_id=project_id,
                    title=title,
                    content=f"（自动创建于第{chapter_number}章，待补充内容）",
                    vow_type="oath",
                    status="active" if change_action == "established" else "broken",
                    status_changed_chapter=chapter_number,
                    breach_consequences=conditions if change_action == "broken" else None,
                )
                db.add(new_vow)
                logger.info(f"  ⚖️ 自动创建誓约「{title}」")

    # ==================== 构建 15 维快照 ====================

    @staticmethod
    async def _build_15dim_snapshot(
        db: AsyncSession, project_id: str, chapter_number: int
    ) -> Dict[str, Any]:
        """聚合 15 维事实快照数据

        从各状态表读取当前状态，聚合为 snapshot_data JSON。
        """
        snapshot = {}

        # 1. 角色状态
        chars_result = await db.execute(
            select(Character).where(
                and_(
                    Character.project_id == project_id,
                    Character.is_organization == False
                )
            )
        )
        characters = chars_result.scalars().all()
        snapshot["character_states"] = [
            {
                "character_id": c.id,
                "name": c.name,
                "status": c.status,
                "current_state": c.current_state,
                "state_updated_chapter": c.state_updated_chapter,
            }
            for c in characters
        ]

        # 2. 角色位置
        locs_result = await db.execute(
            select(CharacterLocation).where(
                and_(
                    CharacterLocation.project_id == project_id,
                    CharacterLocation.is_current == True
                )
            )
        )
        locations = locs_result.scalars().all()
        # 建立角色ID到位置的映射
        loc_map = {loc.character_id: loc for loc in locations}
        snapshot["character_locations"] = [
            {
                "character_id": c.id,
                "name": c.name,
                "location": loc_map[c.id].location if c.id in loc_map else "未知",
            }
            for c in characters
        ]

        # 3. 角色外貌
        snapshot["character_appearances"] = [
            {
                "character_id": c.id,
                "name": c.name,
                "appearance": c.appearance,
            }
            for c in characters if c.appearance
        ]

        # 4. 冲突进度（角色弧光）
        arcs_result = await db.execute(
            select(CharacterArc).where(
                and_(
                    CharacterArc.project_id == project_id,
                    CharacterArc.status == "active"
                )
            )
        )
        arcs = arcs_result.scalars().all()
        # 建立角色ID到弧光的映射
        char_map = {c.id: c.name for c in characters}
        snapshot["conflict_progress"] = [
            {
                "arc_id": arc.id,
                "character_name": char_map.get(arc.character_id, "未知"),
                "arc_type": arc.arc_type,
                "current_stage": arc.current_stage,
                "stage_progress": arc.stage_progress,
            }
            for arc in arcs
        ]

        # 5. 伏笔状态
        fs_result = await db.execute(
            select(Foreshadow).where(Foreshadow.project_id == project_id)
        )
        foreshadows = fs_result.scalars().all()
        snapshot["foreshadow_states"] = [
            {
                "foreshadow_id": f.id,
                "title": f.title,
                "status": f.status,
                "plant_chapter": f.plant_chapter_number,
                "target_chapter": f.target_resolve_chapter_number,
                "importance_tier": "Tier-1" if (f.importance or 0) >= 0.8 else "Tier-2",
            }
            for f in foreshadows if f.status in ("planted", "pending")
        ]

        # 6. 剧情节点（从最新快照继承，如果有）
        snapshot["plot_nodes"] = []  # 将在快照合并时从 CHANGES 补充

        # 7. 地点状态（从 Organization.location 提取，简化版）
        orgs_result = await db.execute(
            select(Organization).where(
                and_(
                    Organization.project_id == project_id,
                    Organization.is_organization == True
                )
            )
        )
        organizations = orgs_result.scalars().all()
        seen_locations = set()
        location_states = []
        for org in organizations:
            if org.location and org.location not in seen_locations:
                seen_locations.add(org.location)
                location_states.append({
                    "location_name": org.location,
                    "current_status": "normal",
                    "last_changed_chapter": None,
                })
        snapshot["location_states"] = location_states

        # 8. 势力状态
        snapshot["faction_states"] = [
            {
                "organization_id": org.id,
                "name": org.name,
                "power_level": org.power_level,
                "member_count": org.member_count,
                "status": "active",
                "location": org.location,
            }
            for org in organizations
        ]

        # 9. 时间线
        snapshot["timeline"] = {
            "current_chapter": chapter_number,
            "elapsed_chapters": chapter_number,
        }

        # 10. 物品状态
        items_result = await db.execute(
            select(Item).where(Item.project_id == project_id)
        )
        items = items_result.scalars().all()
        snapshot["item_states"] = [
            {
                "item_id": item.id,
                "name": item.name,
                "holder_id": item.current_holder_id,
                "holder_name": item.current_holder_name,
                "status": item.status,
            }
            for item in items
        ]

        # 11. 世界观硬约束
        proj_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = proj_result.scalar_one_or_none()
        constraints = []
        if project:
            if project.world_rules:
                constraints.append(project.world_rules)
            if project.world_atmosphere:
                constraints.append(f"世界氛围: {project.world_atmosphere}")
        snapshot["world_constraints"] = constraints

        # 12. 地点特征（简化版，从世界设定提取）
        snapshot["location_features"] = []
        if project and project.world_location:
            snapshot["location_features"].append({
                "location_name": project.world_location,
                "description": project.world_atmosphere or "",
            })

        # 13. 秘密状态
        secrets_result = await db.execute(
            select(Secret).where(Secret.project_id == project_id)
        )
        secrets = secrets_result.scalars().all()
        snapshot["secret_states"] = [
            {
                "secret_id": s.id,
                "title": s.title,
                "status": s.status,
                "knowers_count": len(s.knowers or []),
            }
            for s in secrets
        ]

        # 14. 誓约约束状态
        vows_result = await db.execute(
            select(Vow).where(Vow.project_id == project_id)
        )
        vows = vows_result.scalars().all()
        snapshot["vow_states"] = [
            {
                "vow_id": v.id,
                "title": v.title,
                "status": v.status,
                "deadline_chapter": v.deadline_chapter,
                "is_overdue": v.is_overdue,
            }
            for v in vows if v.status == "active"
        ]

        # 15. 关系状态
        rels_result = await db.execute(
            select(CharacterRelationship).where(
                CharacterRelationship.project_id == project_id
            )
        )
        relationships = rels_result.scalars().all()
        snapshot["relationship_states"] = [
            {
                "char_a_id": r.character_a_id,
                "char_b_id": r.character_b_id,
                "intimacy_level": r.intimacy_level,
                "status": r.status,
            }
            for r in relationships if r.status == "active"
        ]

        logger.info(f"  📊 15 维快照构建完成: {sum(len(v) if isinstance(v, list) else 1 for v in snapshot.values())} 项")
        return snapshot

    # ==================== 获取快照 ====================

    @staticmethod
    async def get_latest_snapshot(
        db: AsyncSession, project_id: str
    ) -> Optional[ChapterSnapshot]:
        """获取项目最新快照（供上下文构建器使用）

        下一章生成时，上下文构建器调用此方法读取最新快照，
        避免跨 6+ 张表分散查询。
        """
        result = await db.execute(
            select(ChapterSnapshot).where(
                and_(
                    ChapterSnapshot.project_id == project_id,
                    ChapterSnapshot.is_latest == True
                )
            ).order_by(ChapterSnapshot.chapter_number.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_snapshot_by_chapter(
        db: AsyncSession, chapter_id: str
    ) -> Optional[ChapterSnapshot]:
        """获取指定章节的快照"""
        result = await db.execute(
            select(ChapterSnapshot).where(ChapterSnapshot.chapter_id == chapter_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def rebuild_latest_snapshot_data(
        db: AsyncSession, project_id: str
    ) -> Optional[ChapterSnapshot]:
        """重建最新快照的15维事实数据（手动修改Item/Secret/Vow后调用）

        手动修改天命状态表后，最新快照的snapshot_data会过时。
        此方法重新聚合15维数据并更新最新快照的snapshot_data字段。
        不修改changes_data（CHANGES是历史记录，不应改动）。

        Returns:
            更新后的ChapterSnapshot，无最新快照返回None
        """
        result = await db.execute(
            select(ChapterSnapshot).where(
                and_(
                    ChapterSnapshot.project_id == project_id,
                    ChapterSnapshot.is_latest == True
                )
            ).order_by(ChapterSnapshot.chapter_number.desc()).limit(1)
        )
        snapshot = result.scalar_one_or_none()
        if not snapshot:
            logger.debug(f"项目{project_id[:8]}无最新快照，跳过重建")
            return None

        # 重新聚合15维快照数据
        new_snapshot_data = await SnapshotService._build_15dim_snapshot(
            db, project_id, snapshot.chapter_number
        )
        snapshot.snapshot_data = new_snapshot_data
        await db.flush()
        logger.info(f"🔄 已重建最新快照（第{snapshot.chapter_number}章）的15维数据")
        return snapshot

    @staticmethod
    def format_snapshot_for_context(snapshot: ChapterSnapshot) -> str:
        """将快照格式化为上下文字符串（注入到章节生成提示词）

        供 chapter_context_service.py 调用，替代分散查 6 张表的逻辑。
        """
        if not snapshot or not snapshot.snapshot_data:
            return "（暂无状态快照）"

        data = snapshot.snapshot_data
        lines = [f"=== 截至第{snapshot.chapter_number}章的状态快照 ===\n"]

        # 角色状态 + 位置
        char_states = data.get("character_states", [])
        char_locs = {c["character_id"]: c["location"] for c in data.get("character_locations", [])}
        if char_states:
            lines.append("【角色状态与位置】")
            for cs in char_states:
                loc = char_locs.get(cs.get("character_id"), "未知")
                lines.append(f"  • {cs.get('name')}: 状态={cs.get('status')}, 位置={loc}")
                if cs.get("current_state"):
                    lines.append(f"    心理: {cs['current_state']}")
            lines.append("")

        # 冲突进度（弧光）
        conflicts = data.get("conflict_progress", [])
        if conflicts:
            lines.append("【角色弧光进度】")
            for cf in conflicts:
                lines.append(f"  • {cf.get('character_name')}: {cf.get('arc_type')} → {cf.get('current_stage')} ({cf.get('stage_progress')}%)")
            lines.append("")

        # 伏笔状态
        foreshadows = data.get("foreshadow_states", [])
        if foreshadows:
            lines.append("【伏笔状态】")
            for fs in foreshadows:
                lines.append(f"  • {fs.get('title')}: {fs.get('status')} (埋于第{fs.get('plant_chapter')}章)")
            lines.append("")

        # 物品状态
        items = data.get("item_states", [])
        if items:
            lines.append("【物品状态】")
            for it in items:
                lines.append(f"  • {it.get('name')}: 持有者={it.get('holder_name')}, 状态={it.get('status')}")
            lines.append("")

        # 秘密状态
        secrets = data.get("secret_states", [])
        if secrets:
            lines.append("【秘密状态】")
            for sc in secrets:
                lines.append(f"  • {sc.get('title')}: {sc.get('status')} (知情者{sc.get('knowers_count')}人)")
            lines.append("")

        # 誓约状态
        vows = data.get("vow_states", [])
        if vows:
            lines.append("【誓约约束】")
            for vw in vows:
                deadline = f", 截止第{vw.get('deadline_chapter')}章" if vw.get("deadline_chapter") else ""
                lines.append(f"  • {vw.get('title')}: {vw.get('status')}{deadline}")
            lines.append("")

        # 世界观硬约束
        constraints = data.get("world_constraints", [])
        if constraints:
            lines.append("【世界观硬约束】")
            for con in constraints:
                lines.append(f"  • {con}")
            lines.append("")

        return "\n".join(lines)


# 全局实例
snapshot_service = SnapshotService()
