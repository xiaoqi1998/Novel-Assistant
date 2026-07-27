"""角色弧光数据模型 - 追踪角色的长期成长轨迹"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Float, JSON
from sqlalchemy.sql import func
from app.database import Base
import uuid


class CharacterArc(Base):
    """角色弧光表 - 记录角色的核心目标、动机、成长阶段与里程碑

    与 Character.current_state（单章快照）职责不同：
    - current_state: 当下心理/处境，由章节分析直接覆盖
    - arc: 长期成长轨迹，保留 milestones 历史，支持角色多段弧光（如先成长后救赎）

    一个角色可同时拥有多条弧光（如主线成长 + 感情线救赎），
    但通常只有一条 status='active' 的主弧光。
    """
    __tablename__ = "character_arcs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    character_id = Column(String(36), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)

    # 弧光类型
    arc_type = Column(String(50), nullable=False, comment="弧光类型: growth(成长)/fall(堕落)/redemption(救赎)/awakening(顿悟)/sacrifice(牺牲)")

    # 弧光核心定义（作者/AI 设定，长期不变）
    core_goal = Column(Text, nullable=False, comment="核心目标：角色在整个弧光中追求什么")
    motivation = Column(Text, comment="动机：为什么追求这个目标（内在驱动力）")
    internal_conflict = Column(Text, comment="内在冲突：阻碍角色达成目标的心理矛盾")
    external_goal = Column(Text, comment="本章/近期外在目标（可随阶段调整）")

    # 弧光当前进度（由章节分析自动更新）
    current_stage = Column(
        String(50),
        default="trigger",
        comment="当前阶段: trigger(触发)/struggle(挣扎)/turning_point(转折)/transformation(蜕变)/completion(完成)"
    )
    stage_progress = Column(Integer, default=0, comment="整体进度 0-100")

    # 里程碑历史（保留完整成长轨迹）
    milestones = Column(JSON, comment="""里程碑列表（按时间顺序）: [
        {
            "chapter": 5,
            "chapter_id": "uuid",
            "event": "事件描述",
            "stage_shift": "trigger→struggle",
            "goal_progress_delta": 10,
            "timestamp": "2026-07-27T10:00:00"
        }
    ]""")

    # 目标完成章节（可选，作者预期）
    target_resolution_chapter = Column(Integer, comment="预期完成弧光的章节号")

    # 弧光状态
    status = Column(String(20), default="active", comment="状态: active(进行中)/completed(已完成)/abandoned(已放弃)")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<CharacterArc(id={self.id[:8]}, char_id={self.character_id[:8]}, type={self.arc_type}, stage={self.current_stage}, progress={self.stage_progress})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "character_id": self.character_id,
            "arc_type": self.arc_type,
            "core_goal": self.core_goal,
            "motivation": self.motivation,
            "internal_conflict": self.internal_conflict,
            "external_goal": self.external_goal,
            "current_stage": self.current_stage,
            "stage_progress": self.stage_progress or 0,
            "milestones": self.milestones or [],
            "target_resolution_chapter": self.target_resolution_chapter,
            "status": self.status or "active",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
