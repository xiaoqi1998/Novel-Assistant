"""角色位置数据模型 - 追踪角色当前位置与移动轨迹"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Boolean, JSON
from sqlalchemy.sql import func
from app.database import Base
import uuid


class CharacterLocation(Base):
    """角色位置表 - 记录角色位置变更历史，追踪完整移动轨迹

    对应天命 15 维快照中的「角色位置」维度：
    - 每次位置变更追加一条记录，前一条 is_current 置为 False
    - 查询"当前位置"取 is_current=True 的记录
    - 防止 AI 写出"角色在A地却出现在B地"的位置混乱
    """
    __tablename__ = "character_locations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    character_id = Column(String(36), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)

    # 位置信息
    location = Column(String(200), nullable=False, comment="当前位置名称")
    previous_location = Column(String(200), comment="前一位置名称（便于追踪轨迹）")
    reason = Column(Text, comment="到达原因（如追踪敌人、被传送、逃亡等）")

    # 章节关联
    arrival_chapter_number = Column(Integer, comment="到达章节号")
    arrival_chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="SET NULL"), comment="到达章节ID")

    # 是否当前位置
    is_current = Column(Boolean, default=True, index=True, comment="是否为角色当前位置（便于快速查询）")

    # 额外信息
    companions = Column(JSON, comment="同行角色ID列表（如有结伴移动）")
    notes = Column(Text, comment="位置备注（如隐藏、伪装等）")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")

    def __repr__(self):
        return f"<CharacterLocation(char_id={self.character_id[:8]}, loc={self.location}, current={self.is_current})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "character_id": self.character_id,
            "location": self.location,
            "previous_location": self.previous_location,
            "reason": self.reason,
            "arrival_chapter_number": self.arrival_chapter_number,
            "arrival_chapter_id": self.arrival_chapter_id,
            "is_current": self.is_current if self.is_current is not None else True,
            "companions": self.companions or [],
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
