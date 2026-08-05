"""意见反馈数据模型"""
from sqlalchemy import Column, String, Text, DateTime, Index
from sqlalchemy.sql import func
from app.database import Base


class Feedback(Base):
    """用户意见反馈"""
    __tablename__ = "feedbacks"

    id = Column(String(36), primary_key=True, comment="UUID")
    user_id = Column(String(100), nullable=False, comment="提交用户ID")
    username = Column(String(100), comment="提交用户名")
    display_name = Column(String(100), comment="提交用户显示名")
    content = Column(Text, nullable=False, comment="反馈内容")
    contact = Column(String(200), comment="联系方式（可选）")
    page = Column(String(200), comment="提交时所在页面（可选）")
    adoption_status = Column(
        String(20), default="pending", nullable=False,
        comment="采纳状态：pending待评估/adopted已采纳/rejected不采纳"
    )
    resolve_status = Column(
        String(20), default="unresolved", nullable=False,
        comment="解决状态：unresolved未解决/resolved已解决"
    )
    admin_reply = Column(Text, comment="管理员回复")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index("idx_feedbacks_adoption", "adoption_status"),
        Index("idx_feedbacks_resolve", "resolve_status"),
        Index("idx_feedbacks_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<Feedback(id={self.id}, user_id={self.user_id})>"
