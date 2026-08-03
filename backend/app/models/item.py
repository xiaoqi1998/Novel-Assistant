"""物品数据模型 - 追踪小说中的道具、武器、宝物及其持有者状态"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Float, JSON
from sqlalchemy.sql import func
from app.database import Base
import uuid


class Item(Base):
    """物品表 - 管理小说中出现的所有物品及其流转状态

    对应天命 15 维快照中的「物品状态」维度：
    - 追踪物品当前持有者
    - 追踪物品状态（active/destroyed/lost/sealed/consumed/transferred）
    - 记录物品能力与来源，防止 AI 写出矛盾描写
    """
    __tablename__ = "items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)

    # 基本信息
    name = Column(String(200), nullable=False, comment="物品名称")
    description = Column(Text, nullable=False, comment="物品详细描述（外观、用途等）")
    item_type = Column(String(50), default="other", comment="物品类型: weapon(武器)/artifact(法宝)/consumable(消耗品)/key(关键道具)/material(材料)/other(其他)")
    rarity = Column(String(50), default="common", comment="稀有度: common(普通)/rare(稀有)/epic(史诗)/legendary(传说)/mythic(神话)")

    # 持有者状态
    current_holder_id = Column(String(36), ForeignKey("characters.id", ondelete="SET NULL"), comment="当前持有者角色ID")
    current_holder_name = Column(String(100), comment="当前持有者名称（冗余存储便于查询）")
    status = Column(String(20), default="active", comment="物品状态: active(使用中)/destroyed(已摧毁)/lost(已遗失)/sealed(已封印)/consumed(已消耗)/transferred(已转交)")
    status_changed_chapter = Column(Integer, comment="状态最后变更的章节号")

    # 物品详情
    abilities = Column(JSON, comment="物品能力列表: ['飞行', '斩断精铁']")
    origin = Column(Text, comment="物品来源描述（如何获得/打造）")
    appearance = Column(Text, comment="物品外观描述（防止 AI 写出矛盾）")

    # 关联信息
    related_characters = Column(JSON, comment="曾持有过的角色ID列表")
    related_foreshadow_id = Column(String(36), ForeignKey("foreshadows.id", ondelete="SET NULL"), comment="关联伏笔ID（如物品是伏笔核心）")
    tags = Column(JSON, comment="标签列表: ['神器', '诅咒', '传承']")

    # 重要性
    importance = Column(Float, default=0.5, comment="重要性评分 0.0-1.0")

    notes = Column(Text, comment="创作备注（仅作者可见）")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<Item(id={self.id[:8]}, name={self.name}, status={self.status}, holder={self.current_holder_name})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "name": self.name,
            "description": self.description,
            "item_type": self.item_type,
            "rarity": self.rarity,
            "current_holder_id": self.current_holder_id,
            "current_holder_name": self.current_holder_name,
            "status": self.status or "active",
            "status_changed_chapter": self.status_changed_chapter,
            "abilities": self.abilities or [],
            "origin": self.origin,
            "appearance": self.appearance,
            "related_characters": self.related_characters or [],
            "related_foreshadow_id": self.related_foreshadow_id,
            "tags": self.tags or [],
            "importance": self.importance or 0.5,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
