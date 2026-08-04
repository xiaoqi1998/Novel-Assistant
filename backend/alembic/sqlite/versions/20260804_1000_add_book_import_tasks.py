"""新增拆书任务持久化表与项目拆书报告字段（SQLite）

Revision ID: add_book_import_tasks_sqlite
Revises: add_char_current_location_sqlite
Create Date: 2026-08-04 10:00:00

新增：
1. book_import_tasks 表 - 持久化拆书任务状态与预览数据，重启后不丢任务
2. projects.analysis_report 列 - 拆书报告 Markdown 内容
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_book_import_tasks_sqlite'
down_revision: Union[str, None] = 'add_char_current_location_sqlite'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _column_exists(bind, table_name, column_name):
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return False
    columns = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, 'book_import_tasks'):
        op.create_table(
            'book_import_tasks',
            sa.Column('task_id', sa.String(length=36), primary_key=True, comment='任务ID'),
            sa.Column('user_id', sa.String(length=100), nullable=False, comment='用户ID'),
            sa.Column('source_type', sa.String(length=10), nullable=False, server_default='txt', comment='来源类型: txt/url'),
            sa.Column('source_url', sa.String(length=1000), nullable=True, comment='在线拆书来源链接'),
            sa.Column('filename', sa.String(length=500), nullable=True, comment='上传文件名或来源标识'),
            sa.Column('extract_mode', sa.String(length=10), nullable=True, server_default='head', comment='解析范围: head/tail/full'),
            sa.Column('tail_chapter_count', sa.Integer(), nullable=True, server_default='30', comment='head/tail 模式截取章节数'),
            sa.Column('import_mode', sa.String(length=20), nullable=True, server_default='append', comment='导入模式: append/overwrite'),
            sa.Column('project_id', sa.String(length=36), nullable=True, comment='目标项目ID'),
            sa.Column('create_new_project', sa.Boolean(), nullable=True, server_default=sa.text('1'), comment='是否新建项目'),
            sa.Column('status', sa.String(length=20), nullable=True, server_default='pending', comment='任务状态'),
            sa.Column('progress', sa.Integer(), nullable=True, server_default='0', comment='进度百分比(0-100)'),
            sa.Column('message', sa.String(length=500), nullable=True, comment='当前状态消息'),
            sa.Column('error', sa.Text(), nullable=True, comment='错误信息'),
            sa.Column('preview', sa.JSON(), nullable=True, comment='预览数据(JSON)'),
            sa.Column('imported_project_id', sa.String(length=36), nullable=True, comment='导入后生成的项目ID'),
            sa.Column('failed_steps', sa.JSON(), nullable=True, comment='失败步骤记录(JSON)'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), comment='创建时间'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), comment='更新时间'),
        )
        op.create_index('ix_book_import_tasks_user_id', 'book_import_tasks', ['user_id'])

    if not _column_exists(bind, 'projects', 'analysis_report'):
        with op.batch_alter_table('projects', schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('analysis_report', sa.Text(), nullable=True,
                          comment='拆书报告 Markdown 内容（拆书导入时按勾选维度生成）')
            )


def downgrade() -> None:
    bind = op.get_bind()

    if _column_exists(bind, 'projects', 'analysis_report'):
        with op.batch_alter_table('projects', schema=None) as batch_op:
            batch_op.drop_column('analysis_report')

    if _table_exists(bind, 'book_import_tasks'):
        op.drop_index('ix_book_import_tasks_user_id', table_name='book_import_tasks')
        op.drop_table('book_import_tasks')
