"""fix smtp_from_name server_default

Revision ID: fix_smtp_default
Revises: b1a2c3d4e5f6
Create Date: 2026-07-24 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fix_smtp_default'
down_revision: Union[str, None] = 'b1a2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 修正 smtp_from_name 的 server_default 从 'MuMuAINovel' 改为 '墨笔'
    op.alter_column(
        'settings', 'smtp_from_name',
        existing_type=sa.String(length=255),
        server_default='墨笔',
        existing_nullable=False,
        comment='发件人名称'
    )


def downgrade() -> None:
    op.alter_column(
        'settings', 'smtp_from_name',
        existing_type=sa.String(length=255),
        server_default='MuMuAINovel',
        existing_nullable=False,
        comment='发件人名称'
    )
