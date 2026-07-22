"""
用户订阅记录模型 - 充值与订阅历史

记录每一次充值/订阅操作，用于：
- 个人中心展示历史记录
- 判断用户当前是否为订阅用户（解锁模型切换权限）
- 对账（与 New API 后台的额度变更记录核对）

订阅判断逻辑：存在 plan_type="subscription" 且 status="paid" 且 expired_at > now() 的记录。
"""
from sqlalchemy import Column, String, Integer, Float, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base
import uuid


def _gen_uuid() -> str:
    return str(uuid.uuid4())


class UserSubscription(Base):
    """用户充值/订阅记录"""
    __tablename__ = "user_subscriptions"

    id = Column(String(36), primary_key=True, default=_gen_uuid, comment="UUID 主键")
    user_id = Column(String(100), nullable=False, index=True, comment="关联用户ID")
    # 记录类型：recharge=单次充值，subscription=月度/年度订阅
    plan_type = Column(String(20), nullable=False, index=True, comment="recharge | subscription")
    # 套餐标识（如 monthly/yearly，或 recharge_10/recharge_50 等档位）
    plan_id = Column(String(50), nullable=True, comment="套餐ID")
    # 金额（分），1元=100分
    amount_cents = Column(Integer, nullable=False, default=0, comment="支付金额（分）")
    # 授予的 New API quota（美元）
    quota_granted = Column(Float, nullable=False, default=0, comment="授予的额度（美元）")
    # 状态：pending=待支付，paid=已支付，cancelled=已取消，failed=失败
    status = Column(String(20), nullable=False, default="pending", index=True, comment="pending | paid | cancelled | failed")
    # 支付渠道
    payment_channel = Column(String(20), nullable=True, comment="wechat | alipay | stripe | manual")
    # 支付流水号（支付网关返回，占位）
    payment_txn_id = Column(String(200), nullable=True, index=True, comment="支付流水号")
    # 订阅周期（recharge 时 expired_at 为 NULL，subscription 时为到期时间）
    started_at = Column(DateTime(timezone=True), nullable=True, comment="订阅开始时间")
    expired_at = Column(DateTime(timezone=True), nullable=True, index=True, comment="订阅到期时间（recharge 为 NULL）")
    # 备注
    note = Column(Text, nullable=True, comment="备注")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "plan_type": self.plan_type,
            "plan_id": self.plan_id,
            "amount_cents": self.amount_cents,
            "amount_yuan": round(self.amount_cents / 100, 2) if self.amount_cents else 0,
            "quota_granted": self.quota_granted,
            "status": self.status,
            "payment_channel": self.payment_channel,
            "payment_txn_id": self.payment_txn_id,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "expired_at": self.expired_at.isoformat() if self.expired_at else None,
            "note": self.note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
