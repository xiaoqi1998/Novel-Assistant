"""誓约数据模型 - 追踪小说中的誓约、契约、诅咒及其约束条件"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Float, JSON
from sqlalchemy.sql import func
from app.database import Base
import uuid


class Vow(Base):
    """誓约表 - 管理小说中的誓约、协议、契约、诅咒及其约束状态

    对应天命 15 维快照中的「誓约约束状态」维度：
    - 追踪誓约的参与方与约束条件
    - 追踪违约后果与截止时间
    - 防止 AI 写出"违约了却没后果"或"履约了却没奖励"的逻辑漏洞
    """
    __tablename__ = "vows"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)

    # 基本信息
    title = Column(String(200), nullable=False, comment="誓约标题")
    content = Column(Text, nullable=False, comment="誓约内容/条款详情")
    vow_type = Column(String(50), default="oath", comment="誓约类型: oath(誓言)/pact(契约)/contract(约定)/curse(诅咒)/geas(禁忌)/other(其他)")

    # 约束状态
    status = Column(String(20), default="active", index=True, comment="约束状态: active(生效中)/broken(已违约)/fulfilled(已履行)/expired(已过期)/suspended(已暂停)")
    status_changed_chapter = Column(Integer, comment="状态最后变更的章节号")

    # 参与方
    participants = Column(JSON, comment="""参与角色列表: [
        {
            "character_id": "uuid",
            "character_name": "张三",
            "role": "立约人/受约人/见证人"
        }
    ]""")

    # 约束条件与后果
    conditions = Column(JSON, comment="""约束条件列表: [
        {
            "condition": "不可伤害李四",
            "consequence": "遭受反噬",
            "is_fulfilled": false
        }
    ]""")
    breach_consequences = Column(Text, comment="违约后果描述（如遭受反噬、修为倒退等）")

    # 截止时间（可选）
    deadline_chapter = Column(Integer, comment="截止章节号（如有时间限制）")
    is_overdue = Column(String(10), default="no", comment="是否逾期: no(未逾期)/yes(已逾期)/n_a(无截止)")

    # 关联信息
    related_characters = Column(JSON, comment="关联角色ID列表")
    related_foreshadow_id = Column(String(36), ForeignKey("foreshadows.id", ondelete="SET NULL"), comment="关联伏笔ID")
    tags = Column(JSON, comment="标签列表: ['血誓', '契约', '诅咒']")

    # 重要性
    importance = Column(Float, default=0.5, comment="重要性评分 0.0-1.0")

    notes = Column(Text, comment="创作备注（仅作者可见）")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<Vow(id={self.id[:8]}, title={self.title}, type={self.vow_type}, status={self.status})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "title": self.title,
            "content": self.content,
            "vow_type": self.vow_type,
            "status": self.status or "active",
            "status_changed_chapter": self.status_changed_chapter,
            "participants": self.participants or [],
            "conditions": self.conditions or [],
            "breach_consequences": self.breach_consequences,
            "deadline_chapter": self.deadline_chapter,
            "is_overdue": self.is_overdue or "no",
            "related_characters": self.related_characters or [],
            "related_foreshadow_id": self.related_foreshadow_id,
            "tags": self.tags or [],
            "importance": self.importance or 0.5,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
