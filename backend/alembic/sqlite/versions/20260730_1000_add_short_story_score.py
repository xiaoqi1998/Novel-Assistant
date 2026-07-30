"""添加短故事AI评分字段（SQLite）

Revision ID: add_short_story_score_sqlite
Revises: add_short_stories_sqlite
Create Date: 2026-07-30 10:00:00

新增 short_stories 表的 AI 评分字段：
- score_data: AI评分结果JSON（含total_score/level/dimensions/overall_evaluation等）
- scored_at: 最近评分时间

评分维度覆盖爆款方法论5维度：
1. 选题维度（高概念+爆款公式+三大黄金赛道）
2. 结构维度（黄金比例 Hook/Escalation/Climax/Resolution）
3. 情绪维度（每1000-1500字小冲突+波浪式过山车）
4. 人设对话维度（标签化人设+功能性台词）
5. 完成度维度（开头/废话/卡点/去AI味4项自查清单）
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_short_story_score_sqlite'
down_revision: Union[str, None] = 'add_short_stories_sqlite'
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

    if not _column_exists(bind, 'short_stories', 'score_data'):
        op.add_column(
            'short_stories',
            sa.Column('score_data', sa.Text(), nullable=True, comment='AI评分结果JSON'),
        )

    if not _column_exists(bind, 'short_stories', 'scored_at'):
        op.add_column(
            'short_stories',
            sa.Column('scored_at', sa.DateTime(), nullable=True, comment='最近评分时间'),
        )


def downgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'short_stories'):
        return

    if _column_exists(bind, 'short_stories', 'scored_at'):
        op.drop_column('short_stories', 'scored_at')

    if _column_exists(bind, 'short_stories', 'score_data'):
        op.drop_column('short_stories', 'score_data')
