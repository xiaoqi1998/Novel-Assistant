"""拆书导入相关的 Pydantic Schema"""
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


TaskStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
ImportMode = Literal["append", "overwrite"]
ExtractLevel = Literal["basic", "standard", "deep"]
WarningLevel = Literal["info", "warning", "error"]
BookImportExtractMode = Literal["head", "tail", "full"]

# 拆书报告合法维度
REPORT_DIMENSIONS = {
    "writing_style",
    "outline_structure",
    "opening_formula",
    "character_design",
    "thrill_points",
    "foreshadowing",
}


class BookImportWarning(BaseModel):
    """导入告警信息"""
    code: str = Field(..., description="告警编码")
    message: str = Field(..., description="告警内容")
    level: WarningLevel = Field(default="warning", description="告警等级")


class ProjectSuggestion(BaseModel):
    """项目建议信息（可在预览页修改）"""
    title: str = Field(..., min_length=1, max_length=200, description="项目标题")
    description: Optional[str] = Field(None, description="项目简介")
    theme: Optional[str] = Field(None, description="主题")
    genre: Optional[str] = Field(None, description="类型")
    narrative_perspective: str = Field(default="第三人称", description="叙事视角")
    target_words: int = Field(default=100000, ge=1000, description="目标字数（默认10万字）")


class BookImportChapter(BaseModel):
    """预览章节"""
    title: str = Field(..., min_length=1, max_length=200, description="章节标题")
    content: str = Field(default="", description="章节正文")
    summary: Optional[str] = Field(None, description="章节摘要")
    chapter_number: int = Field(..., ge=1, description="章节序号")
    outline_title: Optional[str] = Field(None, description="关联大纲标题（可选）")


class BookImportOutline(BaseModel):
    """预览大纲"""
    title: str = Field(..., min_length=1, max_length=200, description="大纲标题")
    content: Optional[str] = Field(None, description="大纲内容")
    order_index: int = Field(..., ge=1, description="排序序号")
    structure: Optional[dict[str, Any]] = Field(None, description="结构化大纲（与系统大纲生成结构一致）")


class BookImportTaskCreateRequest(BaseModel):
    """创建拆书任务请求"""
    extract_mode: BookImportExtractMode = Field(default="head", description="提取范围：head=截取前N章，tail=截取末N章，full=整本")
    tail_chapter_count: int = Field(default=30, ge=5, le=9999, description="head/tail 模式下的截取章节数；需为5的倍数，超过50将按整本处理")


class BookImportUrlTaskCreateRequest(BaseModel):
    """在线拆书（URL）创建任务请求"""
    url: str = Field(..., min_length=1, max_length=1000, description="小说目录页链接（http/https）")
    extract_mode: BookImportExtractMode = Field(default="head", description="提取范围：head=截取前N章，tail=截取末N章，full=整本")
    chapter_count: int = Field(default=30, ge=5, le=9999, description="head/tail 模式下的截取章节数；需为5的倍数，超过50将按整本处理")


class BookImportTaskCreateResponse(BaseModel):
    """创建任务响应"""
    task_id: str
    status: TaskStatus


class BookImportTaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    status: TaskStatus
    progress: int = Field(..., ge=0, le=100)
    message: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BookImportPreviewResponse(BaseModel):
    """预览数据响应"""
    task_id: str
    project_suggestion: ProjectSuggestion
    chapters: list[BookImportChapter]
    outlines: list[BookImportOutline]
    warnings: list[BookImportWarning]


class BookImportApplyRequest(BaseModel):
    """确认导入请求（支持前端修订后的数据）"""
    project_suggestion: ProjectSuggestion
    chapters: list[BookImportChapter]
    outlines: list[BookImportOutline] = Field(default_factory=list)
    import_mode: ImportMode = Field(default="append", description="导入模式")
    report_dimensions: list[str] = Field(
        default_factory=list,
        description="拆书报告维度（可选）：writing_style/outline_structure/opening_formula/character_design/thrill_points/foreshadowing；为空则不生成报告",
    )


class BookImportApplyResponse(BaseModel):
    """确认导入响应"""
    success: bool
    project_id: str
    statistics: dict[str, int]
    warnings: list[BookImportWarning] = Field(default_factory=list)
    report_markdown: Optional[str] = Field(default=None, description="拆书报告 Markdown 内容（未勾选维度时为空）")


class BookImportRetryRequest(BaseModel):
    """重试失败步骤请求"""
    steps: list[str] = Field(..., min_length=1, description="需要重试的步骤名列表，如 world_building / career_system / characters")
