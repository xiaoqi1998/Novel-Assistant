"""add user feedback fields to chapters

Revision ID: add_user_feedback
Revises: fix_smtp_default
Create Date: 2026-07-24 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'add_user_feedback'
down_revision: Union[str, None] = 'fix_smtp_default'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 为 chapters 表添加用户反馈字段（用于质量反馈闭环）
    op.add_column('chapters', sa.Column('user_rating', sa.Integer(), nullable=True, comment='用户对本章的评分 1-5'))
    op.add_column('chapters', sa.Column('user_feedback', sa.Text(), nullable=True, comment='用户对本章的文字反馈'))
    op.add_column('chapters', sa.Column('user_feedback_at', sa.DateTime(), nullable=True, comment='用户反馈时间'))


def downgrade() -> None:
    op.drop_column('chapters', 'user_feedback_at')
    op.drop_column('chapters', 'user_feedback')
    op.drop_column('chapters', 'user_rating')
