"""为 characters 表添加 current_location 冗余字段（SQLite）

Revision ID: add_char_current_location_sqlite
Revises: add_tianming_state_sqlite
Create Date: 2026-08-03 11:00:00

新增字段：characters.current_location
来源：天命机制 snapshot_service._apply_character_movements 在写入 CharacterLocation 时同步更新，
便于角色卡片/列表直接展示当前位置，无需 JOIN character_locations 表。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_char_current_location_sqlite'
down_revision: Union[str, None] = 'add_tianming_state_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name, column_name):
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return False
    columns = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'characters', 'current_location'):
        with op.batch_alter_table('characters', schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('current_location', sa.String(length=200), nullable=True,
                          comment='角色当前位置（由天命机制自动同步）')
            )


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, 'characters', 'current_location'):
        with op.batch_alter_table('characters', schema=None) as batch_op:
            batch_op.drop_column('current_location')
