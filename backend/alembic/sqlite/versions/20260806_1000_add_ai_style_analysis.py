"""为章节分析表添加AI味分析字段（SQLite）

Revision ID: add_ai_style_analysis_sqlite
Revises: add_short_story_key_points_sqlite
Create Date: 2026-08-06 10:00:00

新增：
- plot_analysis.ai_style_analysis 列 - 章节内容的AI味分析结果（JSON）：
  {ai_score, level, overall, signs[], strengths[], suggestions[]}
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_ai_style_analysis_sqlite'
down_revision: Union[str, None] = 'add_short_story_key_points_sqlite'
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

    if not _column_exists(bind, 'plot_analysis', 'ai_style_analysis'):
        with op.batch_alter_table('plot_analysis', schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('ai_style_analysis', sa.JSON(), nullable=True,
                          comment='AI味分析结果(JSON): {ai_score, level, overall, signs[], strengths[], suggestions[]}')
            )


def downgrade() -> None:
    bind = op.get_bind()

    if _column_exists(bind, 'plot_analysis', 'ai_style_analysis'):
        with op.batch_alter_table('plot_analysis', schema=None) as batch_op:
            batch_op.drop_column('ai_style_analysis')
