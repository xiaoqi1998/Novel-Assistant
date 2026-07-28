"""用户个人 Skill 数据模型

存储用户个人的 Skill 副本和自建 Skill，实现按用户隔离：
- is_custom=False：系统预置 Skill 的个人副本（用户编辑系统预置时 copy-on-write 产生）
- is_custom=True：用户从零创建的个人 Skill（仅本人可见）

系统预置 Skill 本身存储在磁盘 backend/app/skills/，不在此表。
"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, Index
from sqlalchemy.sql import func
from app.database import Base
import uuid


class UserSkill(Base):
    """用户个人 Skill 表"""
    __tablename__ = "user_skills"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(50), nullable=False, index=True, comment="用户ID")
    skill_key = Column(String(100), nullable=False, comment="模板键名，如 SKILL_STORY_LONG_WRITE")
    name = Column(String(100), nullable=False, comment="内部标识，如 story-long-write")
    display_name = Column(String(200), nullable=False, comment="UI 显示名称")
    category = Column(String(50), nullable=True, comment="分类")
    description = Column(Text, nullable=True, comment="描述")
    triggers = Column(Text, nullable=True, comment="触发词列表(JSON 数组)")
    body = Column(Text, nullable=False, comment="工作流指令（SKILL.md 正文）")
    references = Column(Text, nullable=True, comment="参考知识库 JSON {文件名: 内容}")
    writing_constraints = Column(Text, nullable=True, comment="辅助类 Skill 的创作约束")
    skill_type = Column(String(20), nullable=True, comment="writing/auxiliary/tool")
    is_custom = Column(Boolean, default=False, comment="True=用户自建，False=系统预置的个人副本")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index('idx_user_skill', 'user_id', 'skill_key', unique=True),
    )

    def __repr__(self):
        return f"<UserSkill(id={self.id}, user_id={self.user_id}, skill_key={self.skill_key}, is_custom={self.is_custom})>"
