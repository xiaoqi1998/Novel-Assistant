"""添加 newapi 用户字段与订阅表（SQLite 补丁迁移）

Revision ID: add_newapi_fields_sqlite
Revises: add_user_feedback_sqlite
Create Date: 2026-07-25 10:00:00

补丁说明：
- 之前 SQLite 迁移链遗漏了 newapi_user_id / newapi_key / newapi_access_token 三个字段
  以及 user_subscriptions 订阅记录表，本次一次性补齐，与 PostgreSQL 迁移
  b1a2c3d4e5f6（添加newapi用户字段与订阅表）对齐，并补上同样遗漏的
  newapi_access_token 字段（PostgreSQL 侧亦缺失，单独迁移补齐）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_newapi_fields_sqlite'
down_revision: Union[str, None] = 'add_user_feedback_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name, column_name):
    """SQLite: 检查某列是否存在"""
    inspector = sa.inspect(bind)
    cols = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in cols


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _index_exists(bind, table_name, index_name):
    inspector = sa.inspect(bind)
    indexes = [i['name'] for i in inspector.get_indexes(table_name)]
    return index_name in indexes


def upgrade() -> None:
    bind = op.get_bind()

    # 1. users 表追加 New API 关联字段（幂等：旧库可能已部分添加）
    if not _column_exists(bind, 'users', 'newapi_user_id'):
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('newapi_user_id', sa.Integer(), nullable=True,
                          comment='New API 用户ID（签发后回填）')
            )
    if not _column_exists(bind, 'users', 'newapi_key'):
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('newapi_key', sa.String(length=200), nullable=True,
                          comment='New API 专属API Key (sk-xxx)')
            )
    if not _column_exists(bind, 'users', 'newapi_access_token'):
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('newapi_access_token', sa.String(length=100), nullable=True,
                          comment='New API access_token（用于代理调用充值/订阅等 selfRoute 接口）')
            )
    if not _index_exists(bind, 'users', 'ix_users_newapi_user_id'):
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.create_index('ix_users_newapi_user_id', ['newapi_user_id'], unique=False)

    # 2. 新建 user_subscriptions 订阅记录表（幂等）
    if not _table_exists(bind, 'user_subscriptions'):
        op.create_table(
            'user_subscriptions',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('user_id', sa.String(length=100), nullable=False, comment='关联用户ID'),
            sa.Column('plan_type', sa.String(length=20), nullable=False, comment='recharge | subscription'),
            sa.Column('plan_id', sa.String(length=50), nullable=True, comment='套餐ID'),
            sa.Column('amount_cents', sa.Integer(), nullable=False, server_default='0', comment='支付金额（分）'),
            sa.Column('quota_granted', sa.Float(), nullable=False, server_default='0', comment='授予的额度（美元）'),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='pending',
                      comment='pending | paid | cancelled | failed'),
            sa.Column('payment_channel', sa.String(length=20), nullable=True,
                      comment='wechat | alipay | stripe | manual'),
            sa.Column('payment_txn_id', sa.String(length=200), nullable=True, comment='支付流水号'),
            sa.Column('started_at', sa.DateTime(timezone=True), nullable=True, comment='订阅开始时间'),
            sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True,
                      comment='订阅到期时间（recharge 为 NULL）'),
            sa.Column('note', sa.Text(), nullable=True, comment='备注'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('user_subscriptions', schema=None) as batch_op:
            batch_op.create_index('ix_user_subscriptions_user_id', ['user_id'], unique=False)
            batch_op.create_index('ix_user_subscriptions_plan_type', ['plan_type'], unique=False)
            batch_op.create_index('ix_user_subscriptions_status', ['status'], unique=False)
            batch_op.create_index('ix_user_subscriptions_payment_txn_id', ['payment_txn_id'], unique=False)
            batch_op.create_index('ix_user_subscriptions_expired_at', ['expired_at'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, 'user_subscriptions'):
        with op.batch_alter_table('user_subscriptions', schema=None) as batch_op:
            batch_op.drop_index('ix_user_subscriptions_expired_at')
            batch_op.drop_index('ix_user_subscriptions_payment_txn_id')
            batch_op.drop_index('ix_user_subscriptions_status')
            batch_op.drop_index('ix_user_subscriptions_plan_type')
            batch_op.drop_index('ix_user_subscriptions_user_id')
        op.drop_table('user_subscriptions')

    if _index_exists(bind, 'users', 'ix_users_newapi_user_id'):
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.drop_index('ix_users_newapi_user_id')

    for col in ('newapi_access_token', 'newapi_key', 'newapi_user_id'):
        if _column_exists(bind, 'users', col):
            with op.batch_alter_table('users', schema=None) as batch_op:
                batch_op.drop_column(col)
