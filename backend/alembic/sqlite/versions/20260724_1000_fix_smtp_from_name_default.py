"""fix smtp_from_name server_default

Revision ID: fix_smtp_default_sqlite
Revises: 3a08fc61773f
Create Date: 2026-07-24 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fix_smtp_default_sqlite'
down_revision: Union[str, None] = '3a08fc61773f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('settings', schema=None) as batch_op:
        batch_op.alter_column(
            'smtp_from_name',
            existing_type=sa.String(length=255),
            server_default='墨笔',
            existing_nullable=False,
            comment='发件人名称'
        )


def downgrade() -> None:
    with op.batch_alter_table('settings', schema=None) as batch_op:
        batch_op.alter_column(
            'smtp_from_name',
            existing_type=sa.String(length=255),
            server_default='MuMuAINovel',
            existing_nullable=False,
            comment='发件人名称'
        )
