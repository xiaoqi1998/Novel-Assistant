"""补 add newapi_access_token to users

Revision ID: add_newapi_access_token_pg
Revises: add_user_feedback_pg
Create Date: 2026-07-25 10:00:00

补丁说明：
- PostgreSQL 侧 b1a2c3d4e5f6（添加newapi用户字段与订阅表）只补了
  newapi_user_id 与 newapi_key 两列；newapi_access_token 字段
  已在 ORM 模型中存在但从未通过迁移落到数据库，导致登录后回填
  access_token 时会触发 "column does not exist" 错误。
- 本迁移幂等地补上 newapi_access_token 列。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_newapi_access_token_pg'
down_revision: Union[str, None] = 'add_user_feedback'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name, column_name):
    inspector = sa.inspect(bind)
    cols = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in cols


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'users', 'newapi_access_token'):
        op.add_column(
            'users',
            sa.Column('newapi_access_token', sa.String(length=100), nullable=True,
                      comment='New API access_token（用于代理调用充值/订阅等 selfRoute 接口）')
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, 'users', 'newapi_access_token'):
        op.drop_column('users', 'newapi_access_token')
