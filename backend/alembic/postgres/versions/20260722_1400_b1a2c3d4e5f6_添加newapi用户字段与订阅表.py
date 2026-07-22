"""添加newapi用户字段与订阅表

Revision ID: b1a2c3d4e5f6
Revises: acdb1d611064
Create Date: 2026-07-22 14:00:00.000000

新增内容：
1. users 表追加 newapi_user_id / newapi_key 两列（New API 签发回填）
2. 新建 user_subscriptions 表（充值/订阅历史记录）
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'b1a2c3d4e5f6'
down_revision = 'acdb1d611064'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. users 表追加 New API 关联字段
    op.add_column('users', sa.Column('newapi_user_id', sa.Integer(), nullable=True, comment='New API 用户ID（签发后回填）'))
    op.add_column('users', sa.Column('newapi_key', sa.String(length=200), nullable=True, comment='New API 专属API Key (sk-xxx)'))
    op.create_index('ix_users_newapi_user_id', 'users', ['newapi_user_id'])

    # 2. 新建 user_subscriptions 订阅记录表
    op.create_table(
        'user_subscriptions',
        sa.Column('id', sa.String(length=36), primary_key=True, comment='UUID 主键'),
        sa.Column('user_id', sa.String(length=100), nullable=False, comment='关联用户ID'),
        sa.Column('plan_type', sa.String(length=20), nullable=False, comment='recharge | subscription'),
        sa.Column('plan_id', sa.String(length=50), nullable=True, comment='套餐ID'),
        sa.Column('amount_cents', sa.Integer(), nullable=False, server_default='0', comment='支付金额（分）'),
        sa.Column('quota_granted', sa.Float(), nullable=False, server_default='0', comment='授予的额度（美元）'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending', comment='pending | paid | cancelled | failed'),
        sa.Column('payment_channel', sa.String(length=20), nullable=True, comment='wechat | alipay | stripe | manual'),
        sa.Column('payment_txn_id', sa.String(length=200), nullable=True, comment='支付流水号'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True, comment='订阅开始时间'),
        sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True, comment='订阅到期时间（recharge 为 NULL）'),
        sa.Column('note', sa.Text(), nullable=True, comment='备注'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), comment='更新时间'),
    )
    op.create_index('ix_user_subscriptions_user_id', 'user_subscriptions', ['user_id'])
    op.create_index('ix_user_subscriptions_plan_type', 'user_subscriptions', ['plan_type'])
    op.create_index('ix_user_subscriptions_status', 'user_subscriptions', ['status'])
    op.create_index('ix_user_subscriptions_payment_txn_id', 'user_subscriptions', ['payment_txn_id'])
    op.create_index('ix_user_subscriptions_expired_at', 'user_subscriptions', ['expired_at'])


def downgrade() -> None:
    op.drop_index('ix_user_subscriptions_expired_at', table_name='user_subscriptions')
    op.drop_index('ix_user_subscriptions_payment_txn_id', table_name='user_subscriptions')
    op.drop_index('ix_user_subscriptions_status', table_name='user_subscriptions')
    op.drop_index('ix_user_subscriptions_plan_type', table_name='user_subscriptions')
    op.drop_index('ix_user_subscriptions_user_id', table_name='user_subscriptions')
    op.drop_table('user_subscriptions')

    op.drop_index('ix_users_newapi_user_id', table_name='users')
    op.drop_column('users', 'newapi_key')
    op.drop_column('users', 'newapi_user_id')
