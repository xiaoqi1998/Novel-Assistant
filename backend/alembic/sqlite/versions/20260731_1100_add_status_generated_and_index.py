"""短故事状态语义统一 + 复合索引（SQLite）

Revision ID: add_status_generated_and_index_sqlite
Revises: add_revision_history_sqlite
Create Date: 2026-07-31 11:00:00

1. 状态语义统一：将 writing 状态且 content 非空的记录迁移为 generated 状态，
   区分"创作中(writing)"与"已生成全文(generated)"。
2. 新增 (user_id, updated_at) 复合索引，优化按用户查询列表（按 updated_at 排序）的性能。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_status_generated_and_index_sqlite'
down_revision: Union[str, None] = 'add_revision_history_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _index_exists(bind, table_name, index_name):
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return False
    indexes = [i['name'] for i in inspector.get_indexes(table_name)]
    return index_name in indexes


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'short_stories'):
        return

    # 1. 状态语义统一：writing 且 content 非空 → generated
    op.execute(
        "UPDATE short_stories SET status = 'generated' "
        "WHERE status = 'writing' AND content IS NOT NULL AND content <> ''"
    )

    # 2. 新增 (user_id, updated_at) 复合索引
    if not _index_exists(bind, 'short_stories', 'ix_short_stories_user_id_updated_at'):
        op.create_index(
            'ix_short_stories_user_id_updated_at',
            'short_stories',
            ['user_id', 'updated_at'],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'short_stories'):
        return

    if _index_exists(bind, 'short_stories', 'ix_short_stories_user_id_updated_at'):
        op.drop_index('ix_short_stories_user_id_updated_at', table_name='short_stories')

    # 回滚状态迁移：generated → writing（无法精确还原，仅做近似回滚）
    op.execute(
        "UPDATE short_stories SET status = 'writing' WHERE status = 'generated'"
    )
