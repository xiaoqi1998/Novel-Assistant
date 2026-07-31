"""添加短故事版本历史字段（SQLite）

Revision ID: add_revision_history_sqlite
Revises: add_short_story_score_sqlite
Create Date: 2026-07-31 10:00:00

新增 short_stories 表的 revision_history 字段：
- revision_history: 版本历史JSON数组（重生成确认时备份原文: [{content, title, saved_at}]）

用于重生成预览确认流程：用户确认重生成时，将当前原文备份到此字段。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_revision_history_sqlite'
down_revision: Union[str, None] = 'add_short_story_score_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name, column_name):
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return False
    columns = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in columns


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'short_stories'):
        return

    if not _column_exists(bind, 'short_stories', 'revision_history'):
        op.add_column(
            'short_stories',
            sa.Column('revision_history', sa.Text(), nullable=True, comment='版本历史JSON数组: [{content, title, saved_at}]'),
        )


def downgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'short_stories'):
        return

    if _column_exists(bind, 'short_stories', 'revision_history'):
        op.drop_column('short_stories', 'revision_history')
