"""添加短故事表（SQLite）

Revision ID: add_short_stories_sqlite
Revises: add_user_skills_sqlite
Create Date: 2026-07-29 10:00:00

新增 short_stories 表，存储短故事创作数据：
- 基本信息、情绪目标、核心反转、情绪曲线、人设速写、正文与分段、精修、状态与封面
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_short_stories_sqlite'
down_revision: Union[str, None] = 'add_user_skills_sqlite'
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
        op.create_table(
            'short_stories',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID主键'),
            sa.Column('user_id', sa.String(length=100), nullable=False, comment='用户ID'),
            sa.Column('title', sa.String(length=200), nullable=False, comment='故事标题'),
            sa.Column('logline', sa.Text(), nullable=True, comment='一句话梗概'),
            sa.Column('genre', sa.String(length=50), nullable=True, comment='题材标签'),
            sa.Column('target_platform', sa.String(length=50), nullable=True, comment='目标平台'),
            sa.Column('target_words', sa.Integer(), nullable=True, default=12000, comment='目标字数'),
            sa.Column('current_words', sa.Integer(), nullable=True, default=0, comment='当前字数'),
            sa.Column('emotion_goal', sa.String(length=50), nullable=True, comment='情绪目标'),
            sa.Column('emotion_goal_desc', sa.Text(), nullable=True, comment='情绪目标描述'),
            sa.Column('twist_type', sa.String(length=50), nullable=True, comment='反转类型'),
            sa.Column('twist_content', sa.Text(), nullable=True, comment='反转内容'),
            sa.Column('twist_clues', sa.Text(), nullable=True, comment='铺垫线索JSON'),
            sa.Column('emotion_curve', sa.Text(), nullable=True, comment='情绪曲线JSON'),
            sa.Column('characters', sa.Text(), nullable=True, comment='人设速写JSON'),
            sa.Column('content', sa.Text(), nullable=True, comment='完整正文'),
            sa.Column('segments', sa.Text(), nullable=True, comment='分段进度JSON'),
            sa.Column('polish_notes', sa.Text(), nullable=True, comment='精修笔记'),
            sa.Column('polish_checklist', sa.Text(), nullable=True, comment='精修清单JSON'),
            sa.Column('status', sa.String(length=20), nullable=True, default='planning', comment='状态'),
            sa.Column('cover_image_url', sa.String(length=1000), nullable=True, comment='封面图片地址'),
            sa.Column('cover_prompt', sa.Text(), nullable=True, comment='封面生成提示词'),
            sa.Column('cover_status', sa.String(length=20), nullable=True, default='none', comment='封面状态'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now(), comment='更新时间'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('short_stories', schema=None) as batch_op:
            batch_op.create_index('ix_short_stories_user_id', ['user_id'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, 'short_stories'):
        with op.batch_alter_table('short_stories', schema=None) as batch_op:
            if _index_exists(bind, 'short_stories', 'ix_short_stories_user_id'):
                batch_op.drop_index('ix_short_stories_user_id')
        op.drop_table('short_stories')
