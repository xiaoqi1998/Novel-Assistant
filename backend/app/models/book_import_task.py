"""拆书导入任务数据模型 - 持久化任务状态，重启后不丢任务"""
from sqlalchemy import Column, String, Integer, DateTime, Boolean, JSON, Text
from sqlalchemy.sql import func
from app.database import Base


class BookImportTaskRecord(Base):
    """拆书导入任务表 - 持久化拆书任务状态与预览数据"""
    __tablename__ = "book_import_tasks"

    task_id = Column(String(36), primary_key=True, comment="任务ID")
    user_id = Column(String(100), nullable=False, index=True, comment="用户ID")

    # 来源信息
    source_type = Column(String(10), default="txt", nullable=False, comment="来源类型: txt/url")
    source_url = Column(String(1000), comment="在线拆书来源链接")
    filename = Column(String(500), comment="上传文件名或来源标识")

    # 解析配置
    extract_mode = Column(String(10), default="head", comment="解析范围: head/tail/full")
    tail_chapter_count = Column(Integer, default=30, comment="head/tail 模式截取章节数")
    import_mode = Column(String(20), default="append", comment="导入模式: append/overwrite")
    project_id = Column(String(36), comment="目标项目ID（导入已有项目时使用）")
    create_new_project = Column(Boolean, default=True, comment="是否新建项目")

    # 任务状态
    status = Column(String(20), default="pending", comment="任务状态: pending/running/completed/failed/cancelled")
    progress = Column(Integer, default=0, comment="进度百分比(0-100)")
    message = Column(String(500), comment="当前状态消息")
    error = Column(Text, comment="错误信息")

    # 预览与结果（JSON 序列化存储）
    preview = Column(JSON, comment="预览数据(JSON)")
    imported_project_id = Column(String(36), comment="导入后生成的项目ID")
    failed_steps = Column(JSON, comment="失败步骤记录(JSON)")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<BookImportTaskRecord(task_id={self.task_id[:8]}, source={self.source_type}, status={self.status})>"
