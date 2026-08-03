"""添加天命状态追踪五张表（SQLite）

Revision ID: add_tianming_state_sqlite
Revises: add_status_generated_and_index_sqlite
Create Date: 2026-08-03 10:00:00

新增五张表，对齐天命 15 维事实快照机制：
1. items          - 物品表（物品状态维度，追踪持有者与状态流转）
2. secrets        - 秘密表（秘密状态维度，追踪知情角色与揭露进度）
3. vows           - 誓约表（誓约约束维度，追踪参与方与违约后果）
4. character_locations - 角色位置表（位置维度，记录移动轨迹，is_current 标记当前位置）
5. chapter_snapshots   - 章节快照表（核心，聚合 15 维快照 + 12 类 CHANGES 声明 + 门禁校验结果）

闭环关键：第 N 章快照写入后，第 N+1 章上下文构建器直接读取 chapter_snapshots，
不再跨 6+ 张表分散查询。连贯性靠每章状态回写，不依赖模型记忆。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_tianming_state_sqlite'
down_revision: Union[str, None] = 'add_status_generated_and_index_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _index_exists(bind, table_name, index_name):
    inspector = sa.inspect(bind)
    indexes = [i.get('name') for i in inspector.get_indexes(table_name)]
    return index_name in indexes


def upgrade() -> None:
    bind = op.get_bind()

    # === 1. 物品表 ===
    if not _table_exists(bind, 'items'):
        op.create_table(
            'items',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('project_id', sa.String(length=36), nullable=False, comment='关联项目ID'),
            sa.Column('name', sa.String(length=200), nullable=False, comment='物品名称'),
            sa.Column('description', sa.Text(), nullable=False, comment='物品详细描述'),
            sa.Column('item_type', sa.String(length=50), nullable=True, server_default='other',
                      comment='物品类型: weapon/artifact/consumable/key/material/other'),
            sa.Column('rarity', sa.String(length=50), nullable=True, server_default='common',
                      comment='稀有度: common/rare/epic/legendary/mythic'),
            sa.Column('current_holder_id', sa.String(length=36), nullable=True, comment='当前持有者角色ID'),
            sa.Column('current_holder_name', sa.String(length=100), nullable=True, comment='当前持有者名称（冗余）'),
            sa.Column('status', sa.String(length=20), nullable=True, server_default='active',
                      comment='物品状态: active/destroyed/lost/sealed/consumed/transferred'),
            sa.Column('status_changed_chapter', sa.Integer(), nullable=True, comment='状态变更章节号'),
            sa.Column('abilities', sa.JSON(), nullable=True, comment='物品能力列表'),
            sa.Column('origin', sa.Text(), nullable=True, comment='物品来源描述'),
            sa.Column('appearance', sa.Text(), nullable=True, comment='物品外观描述'),
            sa.Column('related_characters', sa.JSON(), nullable=True, comment='曾持有过的角色ID列表'),
            sa.Column('related_foreshadow_id', sa.String(length=36), nullable=True, comment='关联伏笔ID'),
            sa.Column('tags', sa.JSON(), nullable=True, comment='标签列表'),
            sa.Column('importance', sa.Float(), nullable=True, server_default='0.5', comment='重要性评分 0.0-1.0'),
            sa.Column('notes', sa.Text(), nullable=True, comment='创作备注'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['current_holder_id'], ['characters.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['related_foreshadow_id'], ['foreshadows.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('items', schema=None) as batch_op:
            batch_op.create_index('ix_items_project_id', ['project_id'], unique=False)
            batch_op.create_index('ix_items_status', ['status'], unique=False)
            batch_op.create_index('ix_items_current_holder_id', ['current_holder_id'], unique=False)

    # === 2. 秘密表 ===
    if not _table_exists(bind, 'secrets'):
        op.create_table(
            'secrets',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('project_id', sa.String(length=36), nullable=False, comment='关联项目ID'),
            sa.Column('title', sa.String(length=200), nullable=False, comment='秘密标题'),
            sa.Column('content', sa.Text(), nullable=False, comment='秘密详细内容'),
            sa.Column('secret_type', sa.String(length=50), nullable=True, server_default='other',
                      comment='秘密类型: identity/past_conspiracy/true_purpose/hidden_relationship/hidden_power/other'),
            sa.Column('status', sa.String(length=30), nullable=True, server_default='hidden',
                      comment='揭露状态: hidden/partially_revealed/revealed/public'),
            sa.Column('status_changed_chapter', sa.Integer(), nullable=True, comment='状态变更章节号'),
            sa.Column('knowers', sa.JSON(), nullable=True, comment='知情角色列表JSON'),
            sa.Column('related_characters', sa.JSON(), nullable=True, comment='关联角色ID列表'),
            sa.Column('related_foreshadow_id', sa.String(length=36), nullable=True, comment='关联伏笔ID'),
            sa.Column('tags', sa.JSON(), nullable=True, comment='标签列表'),
            sa.Column('importance', sa.Float(), nullable=True, server_default='0.5', comment='重要性评分 0.0-1.0'),
            sa.Column('notes', sa.Text(), nullable=True, comment='创作备注'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['related_foreshadow_id'], ['foreshadows.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('secrets', schema=None) as batch_op:
            batch_op.create_index('ix_secrets_project_id', ['project_id'], unique=False)
            batch_op.create_index('ix_secrets_status', ['status'], unique=False)

    # === 3. 誓约表 ===
    if not _table_exists(bind, 'vows'):
        op.create_table(
            'vows',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('project_id', sa.String(length=36), nullable=False, comment='关联项目ID'),
            sa.Column('title', sa.String(length=200), nullable=False, comment='誓约标题'),
            sa.Column('content', sa.Text(), nullable=False, comment='誓约内容/条款详情'),
            sa.Column('vow_type', sa.String(length=50), nullable=True, server_default='oath',
                      comment='誓约类型: oath/pact/contract/curse/geas/other'),
            sa.Column('status', sa.String(length=20), nullable=True, server_default='active',
                      comment='约束状态: active/broken/fulfilled/expired/suspended'),
            sa.Column('status_changed_chapter', sa.Integer(), nullable=True, comment='状态变更章节号'),
            sa.Column('participants', sa.JSON(), nullable=True, comment='参与角色列表JSON'),
            sa.Column('conditions', sa.JSON(), nullable=True, comment='约束条件列表JSON'),
            sa.Column('breach_consequences', sa.Text(), nullable=True, comment='违约后果描述'),
            sa.Column('deadline_chapter', sa.Integer(), nullable=True, comment='截止章节号'),
            sa.Column('is_overdue', sa.String(length=10), nullable=True, server_default='no',
                      comment='是否逾期: no/yes/n_a'),
            sa.Column('related_characters', sa.JSON(), nullable=True, comment='关联角色ID列表'),
            sa.Column('related_foreshadow_id', sa.String(length=36), nullable=True, comment='关联伏笔ID'),
            sa.Column('tags', sa.JSON(), nullable=True, comment='标签列表'),
            sa.Column('importance', sa.Float(), nullable=True, server_default='0.5', comment='重要性评分 0.0-1.0'),
            sa.Column('notes', sa.Text(), nullable=True, comment='创作备注'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['related_foreshadow_id'], ['foreshadows.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('vows', schema=None) as batch_op:
            batch_op.create_index('ix_vows_project_id', ['project_id'], unique=False)
            batch_op.create_index('ix_vows_status', ['status'], unique=False)

    # === 4. 角色位置表 ===
    if not _table_exists(bind, 'character_locations'):
        op.create_table(
            'character_locations',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('project_id', sa.String(length=36), nullable=False, comment='关联项目ID'),
            sa.Column('character_id', sa.String(length=36), nullable=False, comment='关联角色ID'),
            sa.Column('location', sa.String(length=200), nullable=False, comment='当前位置名称'),
            sa.Column('previous_location', sa.String(length=200), nullable=True, comment='前一位置名称'),
            sa.Column('reason', sa.Text(), nullable=True, comment='到达原因'),
            sa.Column('arrival_chapter_number', sa.Integer(), nullable=True, comment='到达章节号'),
            sa.Column('arrival_chapter_id', sa.String(length=36), nullable=True, comment='到达章节ID'),
            sa.Column('is_current', sa.Boolean(), nullable=True, server_default=sa.text('true'),
                      comment='是否为角色当前位置'),
            sa.Column('companions', sa.JSON(), nullable=True, comment='同行角色ID列表'),
            sa.Column('notes', sa.Text(), nullable=True, comment='位置备注'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['character_id'], ['characters.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['arrival_chapter_id'], ['chapters.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('character_locations', schema=None) as batch_op:
            batch_op.create_index('ix_character_locations_project_id', ['project_id'], unique=False)
            batch_op.create_index('ix_character_locations_character_id', ['character_id'], unique=False)
            batch_op.create_index('ix_character_locations_is_current', ['is_current'], unique=False)

    # === 5. 章节快照表（核心）===
    if not _table_exists(bind, 'chapter_snapshots'):
        op.create_table(
            'chapter_snapshots',
            sa.Column('id', sa.String(length=36), nullable=False, comment='UUID 主键'),
            sa.Column('project_id', sa.String(length=36), nullable=False, comment='关联项目ID'),
            sa.Column('chapter_id', sa.String(length=36), nullable=False, comment='关联章节ID（唯一）'),
            sa.Column('chapter_number', sa.Integer(), nullable=False, comment='章节号'),
            sa.Column('snapshot_data', sa.JSON(), nullable=True, comment='15 维事实快照JSON'),
            sa.Column('changes_data', sa.JSON(), nullable=True, comment='12 类 CHANGES 声明JSON'),
            sa.Column('validation_status', sa.String(length=20), nullable=True, server_default='not_checked',
                      comment='校验状态: not_checked/passed/warnings/failed'),
            sa.Column('validation_report', sa.JSON(), nullable=True, comment='六道门禁校验结果JSON'),
            sa.Column('needs_revision', sa.Boolean(), nullable=True, server_default=sa.text('false'),
                      comment='是否需要修正'),
            sa.Column('revision_suggestions', sa.JSON(), nullable=True, comment='修正建议列表'),
            sa.Column('source', sa.String(length=20), nullable=True, server_default='analysis',
                      comment='快照来源: generation/analysis/manual'),
            sa.Column('is_latest', sa.Boolean(), nullable=True, server_default=sa.text('true'),
                      comment='是否为项目最新快照'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(),
                      onupdate=sa.func.now(), comment='更新时间'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('chapter_id', name='uq_chapter_snapshots_chapter_id'),
        )
        with op.batch_alter_table('chapter_snapshots', schema=None) as batch_op:
            batch_op.create_index('ix_chapter_snapshots_project_id', ['project_id'], unique=False)
            batch_op.create_index('ix_chapter_snapshots_chapter_number', ['chapter_number'], unique=False)
            batch_op.create_index('ix_chapter_snapshots_is_latest', ['is_latest'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()

    # 章节快照表
    if _table_exists(bind, 'chapter_snapshots'):
        with op.batch_alter_table('chapter_snapshots', schema=None) as batch_op:
            if _index_exists(bind, 'chapter_snapshots', 'ix_chapter_snapshots_is_latest'):
                batch_op.drop_index('ix_chapter_snapshots_is_latest')
            if _index_exists(bind, 'chapter_snapshots', 'ix_chapter_snapshots_chapter_number'):
                batch_op.drop_index('ix_chapter_snapshots_chapter_number')
            if _index_exists(bind, 'chapter_snapshots', 'ix_chapter_snapshots_project_id'):
                batch_op.drop_index('ix_chapter_snapshots_project_id')
        op.drop_table('chapter_snapshots')

    # 角色位置表
    if _table_exists(bind, 'character_locations'):
        with op.batch_alter_table('character_locations', schema=None) as batch_op:
            if _index_exists(bind, 'character_locations', 'ix_character_locations_is_current'):
                batch_op.drop_index('ix_character_locations_is_current')
            if _index_exists(bind, 'character_locations', 'ix_character_locations_character_id'):
                batch_op.drop_index('ix_character_locations_character_id')
            if _index_exists(bind, 'character_locations', 'ix_character_locations_project_id'):
                batch_op.drop_index('ix_character_locations_project_id')
        op.drop_table('character_locations')

    # 誓约表
    if _table_exists(bind, 'vows'):
        with op.batch_alter_table('vows', schema=None) as batch_op:
            if _index_exists(bind, 'vows', 'ix_vows_status'):
                batch_op.drop_index('ix_vows_status')
            if _index_exists(bind, 'vows', 'ix_vows_project_id'):
                batch_op.drop_index('ix_vows_project_id')
        op.drop_table('vows')

    # 秘密表
    if _table_exists(bind, 'secrets'):
        with op.batch_alter_table('secrets', schema=None) as batch_op:
            if _index_exists(bind, 'secrets', 'ix_secrets_status'):
                batch_op.drop_index('ix_secrets_status')
            if _index_exists(bind, 'secrets', 'ix_secrets_project_id'):
                batch_op.drop_index('ix_secrets_project_id')
        op.drop_table('secrets')

    # 物品表
    if _table_exists(bind, 'items'):
        with op.batch_alter_table('items', schema=None) as batch_op:
            if _index_exists(bind, 'items', 'ix_items_current_holder_id'):
                batch_op.drop_index('ix_items_current_holder_id')
            if _index_exists(bind, 'items', 'ix_items_status'):
                batch_op.drop_index('ix_items_status')
            if _index_exists(bind, 'items', 'ix_items_project_id'):
                batch_op.drop_index('ix_items_project_id')
        op.drop_table('items')
