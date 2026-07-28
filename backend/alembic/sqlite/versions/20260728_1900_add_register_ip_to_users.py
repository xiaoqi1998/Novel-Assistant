"""添加 register_ip 字段到 users 表（SQLite）

Revision ID: add_register_ip_sqlite
Revises: add_user_skills_sqlite
Create Date: 2026-07-28 19:00:00

新增 register_ip 列，记录用户注册时的客户端 IP，用于限制每个 IP 的注册数量。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_register_ip_sqlite'
down_revision: Union[str, None] = 'add_user_skills_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name, column_name):
    inspector = sa.inspect(bind)
    cols = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in cols


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'users', 'register_ip'):
        op.add_column(
            'users',
            sa.Column('register_ip', sa.String(length=64), nullable=True,
                      comment='注册时的客户端IP（用于限制每IP注册数量）')
        )
        op.create_index('ix_users_register_ip', 'users', ['register_ip'])


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, 'users', 'register_ip'):
        op.drop_index('ix_users_register_ip', table_name='users')
        op.drop_column('users', 'register_ip')
