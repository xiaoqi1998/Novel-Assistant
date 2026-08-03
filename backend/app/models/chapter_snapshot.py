"""章节快照数据模型 - 聚合天命 15 维事实快照与 12 类 CHANGES 声明"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Boolean, JSON
from sqlalchemy.sql import func
from app.database import Base
import uuid


class ChapterSnapshot(Base):
    """章节快照表 - 每章生成/分析后写入的完整状态快照

    这是天命机制的核心：将分散在 Character/CharacterArc/Foreshadow/Organization/
    Item/Secret/Vow/CharacterLocation 等表的状态聚合为单表，供下一章上下文构建器
    直接读取，避免跨 6+ 张表分散查询。

    快照包含两部分：
    1. snapshot_data: 15 维事实快照（截至本章的状态字段值）
    2. changes_data: 12 类 CHANGES 声明（本章发生的状态变更，原始记录便于追溯）

    闭环关键：第 N 章的快照经门禁校验通过后写入 → 第 N+1 章读取最新快照。
    连贯不靠模型记忆，靠每章的状态回写。
    """
    __tablename__ = "chapter_snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    chapter_number = Column(Integer, nullable=False, comment="章节号")

    # === 15 维事实快照（JSON 聚合）===
    snapshot_data = Column(JSON, comment="""15 维事实快照: {
        "character_states": [{"character_id, name, status, current_state, appearance_snapshot}],
        "character_locations": [{"character_id, name, location}],
        "character_appearances": [{"character_id, name, hair_color, eye_color, features}],
        "conflict_progress": [{"arc_id, character_name, arc_type, current_stage, stage_progress}],
        "foreshadow_states": [{"foreshadow_id, title, status, plant_chapter, target_chapter, importance_tier}],
        "plot_nodes": [{"chapter, event, importance, keywords}],
        "location_states": [{"location_name, current_status, last_changed_chapter}],
        "faction_states": [{"organization_id, name, power_level, member_count, status, location}],
        "timeline": {"current_time_period, elapsed_time, key_time_events},
        "item_states": [{"item_id, name, holder_id, holder_name, status}],
        "world_constraints": ["凡人不可飞行", "修为不可倒退"],
        "location_features": [{"location_name, description, environment_details}],
        "secret_states": [{"secret_id, title, status, knowers}],
        "vow_states": [{"vow_id, title, status, participants, deadline_chapter, is_overdue}],
        "relationship_states": [{"char_a, char_b, intimacy_level, status}]
    }""")

    # === 12 类 CHANGES 声明（本章变更原始记录）===
    changes_data = Column(JSON, comment="""12 类变更声明: {
        "character_state_changes": [{character_id, name, field, old_value, new_value, reason}],
        "conflict_progress_changes": [{arc_id, character_name, new_stage, stage_progress_delta, event}],
        "new_plot_nodes": [{keywords, summary, involved_characters, story_line}],
        "foreshadow_actions": [{foreshadow_id, title, action: setup/payoff}],
        "location_state_changes": [{location_id, location_name, new_status, trigger_event}],
        "faction_state_changes": [{organization_id, name, new_status, trigger_event}],
        "time_progression": {current_time_period, elapsed_time, key_time_event},
        "character_movements": [{character_id, name, from_location, to_location, reason}],
        "item_transfers": [{item_id, item_name, from_holder, to_holder, new_status}],
        "secret_reveals": [{secret_id, title, new_knower, reveal_method}],
        "vow_changes": [{vow_id, title, change_action, related_characters, conditions}],
        "deadline_changes": [{deadline_id, title, change_action, trigger_condition, deadline_chapter}]
    }""")

    # === 门禁校验结果（阶段2使用）===
    validation_status = Column(String(20), default="not_checked", comment="校验状态: not_checked/passed/warnings/failed")
    validation_report = Column(JSON, comment="""六道门禁校验结果: {
        "protocol_parse": {"passed": true, "message": "..."},
        "reference_check": {"passed": true, "issues": []},
        "consistency_check": {"passed": true, "issues": []},
        "unknown_entity_check": {"passed": true, "unknown_count": 0, "npc_count": 0},
        "description_consistency": {"passed": true, "issues": []},
        "blueprint_presence_check": {"passed": true, "missing_entities": []}
    }""")
    needs_revision = Column(Boolean, default=False, comment="是否需要修正（门禁不通过时标记）")
    revision_suggestions = Column(JSON, comment="修正建议列表: ['建议1', '建议2']")

    # === 快照来源 ===
    source = Column(String(20), default="analysis", comment="快照来源: generation(章节生成时提取)/analysis(章节分析时提取)/manual(手动)")
    is_latest = Column(Boolean, default=True, index=True, comment="是否为项目最新快照（便于下一章快速读取）")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<ChapterSnapshot(chapter={self.chapter_number}, validation={self.validation_status}, latest={self.is_latest})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "chapter_id": self.chapter_id,
            "chapter_number": self.chapter_number,
            "snapshot_data": self.snapshot_data or {},
            "changes_data": self.changes_data or {},
            "validation_status": self.validation_status or "not_checked",
            "validation_report": self.validation_report or {},
            "needs_revision": self.needs_revision if self.needs_revision is not None else False,
            "revision_suggestions": self.revision_suggestions or [],
            "source": self.source or "analysis",
            "is_latest": self.is_latest if self.is_latest is not None else True,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
