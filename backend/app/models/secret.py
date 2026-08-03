"""秘密数据模型 - 追踪小说中的秘密及其知情角色"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Float, JSON
from sqlalchemy.sql import func
from app.database import Base
import uuid


class Secret(Base):
    """秘密表 - 管理小说中的秘密及其揭露状态

    对应天命 15 维快照中的「秘密状态」维度：
    - 追踪每个秘密的知情角色列表
    - 追踪揭露状态（hidden/partially_revealed/revealed/public）
    - 防止 AI 写出"不该知道的人知道了"的逻辑错误
    """
    __tablename__ = "secrets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)

    # 基本信息
    title = Column(String(200), nullable=False, comment="秘密标题")
    content = Column(Text, nullable=False, comment="秘密详细内容（真相是什么）")
    secret_type = Column(String(50), default="other", comment="秘密类型: identity(身份)/past_conspiracy(旧日阴谋)/true_purpose(真实目的)/hidden_relationship(隐藏关系)/hidden_power(隐藏力量)/other(其他)")

    # 揭露状态
    status = Column(String(30), default="hidden", index=True, comment="揭露状态: hidden(完全隐藏)/partially_revealed(部分揭露)/revealed(已揭露给关键角色)/public(公开知晓)")
    status_changed_chapter = Column(Integer, comment="状态最后变更的章节号")

    # 知情角色（核心字段）
    knowers = Column(JSON, comment="""知情角色列表: [
        {
            "character_id": "uuid",
            "character_name": "张三",
            "revealed_at_chapter": 15,
            "reveal_method": "亲眼目睹/被告知/自行推理/偷听"
        }
    ]""")

    # 关联信息
    related_characters = Column(JSON, comment="关联角色ID列表（与秘密相关的角色，不一定是知情者）")
    related_foreshadow_id = Column(String(36), ForeignKey("foreshadows.id", ondelete="SET NULL"), comment="关联伏笔ID（如秘密本身就是一个伏笔）")
    tags = Column(JSON, comment="标签列表: ['身世', '阴谋', '反转']")

    # 重要性
    importance = Column(Float, default=0.5, comment="重要性评分 0.0-1.0")

    notes = Column(Text, comment="创作备注（仅作者可见）")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<Secret(id={self.id[:8]}, title={self.title}, status={self.status}, knowers={len(self.knowers or [])})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "title": self.title,
            "content": self.content,
            "secret_type": self.secret_type,
            "status": self.status or "hidden",
            "status_changed_chapter": self.status_changed_chapter,
            "knowers": self.knowers or [],
            "related_characters": self.related_characters or [],
            "related_foreshadow_id": self.related_foreshadow_id,
            "tags": self.tags or [],
            "importance": self.importance or 0.5,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
