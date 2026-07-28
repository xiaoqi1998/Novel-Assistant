"""添加用户个人 Skill 表（PostgreSQL）

Revision ID: add_user_skills_pg
Revises: add_character_arcs_pg
Create Date: 2026-07-28 10:00:00

新增 user_skills 表，存储用户个人的 Skill 副本和自建 Skill：
- is_custom=False：系统预置 Skill 的个人副本（用户编辑系统预置时 copy-on-write 产生）
- is_custom=True：用户从零创建的个人 Skill（仅本人可见）

实现 Skills 模块按用户隔离，系统预置 Skill 仍存磁盘 backend/app/skills/。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_user_skills_pg'
down_revision: Union[str, None] = 'add_character_arcs_pg'
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

    if not _table_exists(bind, 'user_skills'):
        op.create_table(
            'user_skills',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('user_id', sa.String(length=50), nullable=False, comment='用户ID'),
            sa.Column('skill_key', sa.String(length=100), nullable=False,
                      comment='模板键名，如 SKILL_STORY_LONG_WRITE'),
            sa.Column('name', sa.String(length=100), nullable=False, comment='内部标识'),
            sa.Column('display_name', sa.String(length=200), nullable=False, comment='UI 显示名称'),
            sa.Column('category', sa.String(length=50), nullable=True, comment='分类'),
            sa.Column('description', sa.Text(), nullable=True, comment='描述'),
            sa.Column('triggers', sa.Text(), nullable=True, comment='触发词列表(JSON 数组)'),
            sa.Column('body', sa.Text(), nullable=False, comment='工作流指令（SKILL.md 正文）'),
            sa.Column('references', sa.Text(), nullable=True, comment='参考知识库 JSON'),
            sa.Column('writing_constraints', sa.Text(), nullable=True, comment='辅助类 Skill 的创作约束'),
            sa.Column('skill_type', sa.String(length=20), nullable=True,
                      comment='writing/auxiliary/tool'),
            sa.Column('is_custom', sa.Boolean(), nullable=True, comment='True=用户自建，False=系统预置副本'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_user_skills_user_id', 'user_skills', ['user_id'], unique=False)
        op.create_index('idx_user_skill', 'user_skills', ['user_id', 'skill_key'], unique=True)


def downgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, 'user_skills'):
        if _index_exists(bind, 'user_skills', 'idx_user_skill'):
            op.drop_index('idx_user_skill', table_name='user_skills')
        if _index_exists(bind, 'user_skills', 'ix_user_skills_user_id'):
            op.drop_index('ix_user_skills_user_id', table_name='user_skills')
        op.drop_table('user_skills')
