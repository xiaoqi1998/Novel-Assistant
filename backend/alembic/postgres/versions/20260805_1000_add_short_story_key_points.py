"""添加短故事爆款关键点字段（PostgreSQL）

Revision ID: add_short_story_key_points_pg
Revises: add_book_import_tasks_pg
Create Date: 2026-08-05 10:00:00

新增 short_stories 表的爆款关键点字段（story-short-write 方法论）：
- reversal_grade: 反转等级（S认知反转/A身份关系反转/B事件真相反转/C单纯信息揭露）
- beat_design: 爆点设计JSON {max_thrill_point, max_tearjerker_point, max_shock_point, max_viral_line}
- emotional_payoff: 情绪收益点JSON数组
- dual_line: 双线叙事JSON {surface_line, inner_line, junction_nodes, reveal_point}
- character_profile: 人物四要素JSON
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_short_story_key_points_pg'
down_revision: Union[str, None] = 'add_book_import_tasks_pg'
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

    new_columns = [
        ('reversal_grade', sa.String(50)),
        ('beat_design', sa.Text()),
        ('emotional_payoff', sa.Text()),
        ('dual_line', sa.Text()),
        ('character_profile', sa.Text()),
    ]
    for col_name, col_type in new_columns:
        if not _column_exists(bind, 'short_stories', col_name):
            op.add_column('short_stories', sa.Column(col_name, col_type, nullable=True))


def downgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'short_stories'):
        return

    for col_name, _ in [
        ('reversal_grade', sa.String(50)),
        ('beat_design', sa.Text()),
        ('emotional_payoff', sa.Text()),
        ('dual_line', sa.Text()),
        ('character_profile', sa.Text()),
    ]:
        if _column_exists(bind, 'short_stories', col_name):
            op.drop_column('short_stories', col_name)
