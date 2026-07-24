"""add user feedback fields to chapters

Revision ID: add_user_feedback_sqlite
Revises: fix_smtp_default_sqlite
Create Date: 2026-07-24 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'add_user_feedback_sqlite'
down_revision: Union[str, None] = 'fix_smtp_default_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 为 chapters 表添加用户反馈字段（用于质量反馈闭环）
    # SQLite 使用 batch_alter_table 模式
    with op.batch_alter_table('chapters', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_rating', sa.Integer(), nullable=True, comment='用户对本章的评分 1-5'))
        batch_op.add_column(sa.Column('user_feedback', sa.Text(), nullable=True, comment='用户对本章的文字反馈'))
        batch_op.add_column(sa.Column('user_feedback_at', sa.DateTime(), nullable=True, comment='用户反馈时间'))


def downgrade() -> None:
    with op.batch_alter_table('chapters', schema=None) as batch_op:
        batch_op.drop_column('user_feedback_at')
        batch_op.drop_column('user_feedback')
        batch_op.drop_column('user_rating')
