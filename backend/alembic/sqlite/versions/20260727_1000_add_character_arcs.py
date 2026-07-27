"""添加角色弧光表（SQLite）

Revision ID: add_character_arcs_sqlite
Revises: add_newapi_fields_sqlite
Create Date: 2026-07-27 10:00:00

新增 character_arcs 表，存储角色长期成长轨迹：
- 核心目标、动机、内在冲突
- 当前阶段与进度（由章节分析自动更新）
- 里程碑历史（保留完整成长轨迹）

与 Character.current_state（单章快照）职责不同，弧光关注长期成长。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_character_arcs_sqlite'
down_revision: Union[str, None] = 'add_newapi_fields_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _index_exists(bind, table_name, index_name):
    inspector = sa.inspect(bind)
    indexes = [i['name'] for i in inspector.get_indexes(table_name)]
    return index_name in indexes


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'character_arcs'):
        op.create_table(
            'character_arcs',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('project_id', sa.String(length=36), nullable=False, comment='关联项目ID'),
            sa.Column('character_id', sa.String(length=36), nullable=False, comment='关联角色ID'),
            sa.Column('arc_type', sa.String(length=50), nullable=False,
                      comment='弧光类型: growth/fall/redemption/awakening/sacrifice'),
            sa.Column('core_goal', sa.Text(), nullable=False, comment='核心目标'),
            sa.Column('motivation', sa.Text(), nullable=True, comment='动机'),
            sa.Column('internal_conflict', sa.Text(), nullable=True, comment='内在冲突'),
            sa.Column('external_goal', sa.Text(), nullable=True, comment='近期外在目标'),
            sa.Column('current_stage', sa.String(length=50), nullable=True,
                      server_default='trigger',
                      comment='当前阶段: trigger/struggle/turning_point/transformation/completion'),
            sa.Column('stage_progress', sa.Integer(), nullable=True, server_default='0',
                      comment='整体进度 0-100'),
            sa.Column('milestones', sa.JSON(), nullable=True, comment='里程碑列表JSON'),
            sa.Column('target_resolution_chapter', sa.Integer(), nullable=True,
                      comment='预期完成弧光的章节号'),
            sa.Column('status', sa.String(length=20), nullable=True, server_default='active',
                      comment='状态: active/completed/abandoned'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['character_id'], ['characters.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('character_arcs', schema=None) as batch_op:
            batch_op.create_index('ix_character_arcs_project_id', ['project_id'], unique=False)
            batch_op.create_index('ix_character_arcs_character_id', ['character_id'], unique=False)
            batch_op.create_index('ix_character_arcs_status', ['status'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, 'character_arcs'):
        with op.batch_alter_table('character_arcs', schema=None) as batch_op:
            if _index_exists(bind, 'character_arcs', 'ix_character_arcs_status'):
                batch_op.drop_index('ix_character_arcs_status')
            if _index_exists(bind, 'character_arcs', 'ix_character_arcs_character_id'):
                batch_op.drop_index('ix_character_arcs_character_id')
            if _index_exists(bind, 'character_arcs', 'ix_character_arcs_project_id'):
                batch_op.drop_index('ix_character_arcs_project_id')
        op.drop_table('character_arcs')
