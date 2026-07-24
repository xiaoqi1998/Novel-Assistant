"""写作风格 Schema"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class WritingStyleBase(BaseModel):
    """写作风格基础模型"""
    name: str = Field(..., description="风格名称")
    style_type: str = Field(..., description="风格类型：preset/custom")
    preset_id: Optional[str] = Field(None, description="预设风格ID")
    description: Optional[str] = Field(None, description="风格描述")
    prompt_content: str = Field(..., description="风格提示词内容")


class WritingStyleCreate(BaseModel):
    """创建写作风格（仅用于创建用户自定义风格）"""
    name: str = Field(..., description="风格名称")
    style_type: Optional[str] = Field(None, description="风格类型：preset/custom")
    preset_id: Optional[str] = Field(None, description="预设风格ID")
    description: Optional[str] = Field(None, description="风格描述")
    prompt_content: str = Field(..., description="风格提示词内容")


class WritingStyleUpdate(BaseModel):
    """更新写作风格"""
    name: Optional[str] = None
    description: Optional[str] = None
    prompt_content: Optional[str] = None


class SetDefaultStyleRequest(BaseModel):
    """设置默认风格请求"""
    project_id: str = Field(..., description="项目ID")


class WritingStyleResponse(BaseModel):
    """写作风格响应"""
    id: int
    user_id: Optional[str] = None  # NULL 表示全局预设风格
    name: str
    style_type: str
    preset_id: Optional[str] = None
    description: Optional[str] = None
    prompt_content: str
    is_default: bool
    order_index: int
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class WritingStyleListResponse(BaseModel):
    """写作风格列表响应"""
    total: int
    styles: list[WritingStyleResponse]


class StyleExtractRequest(BaseModel):
    """文风提取请求"""
    project_id: str = Field(..., description="项目ID")
    chapter_ids: Optional[list[str]] = Field(None, description="指定章节ID列表，为空则自动选最近5章")


class StyleExtractResponse(BaseModel):
    """文风提取响应"""
    overall_positioning: str = Field(..., description="整体风格定位")
    dimensions: dict = Field(..., description="7维度文风档案")
    writing_instruction: str = Field(..., description="综合写作指令（可直接保存为WritingStyle）")
    sampled_chapters: list[dict] = Field(..., description="采样的章节信息")


class SaveExtractedStyleRequest(BaseModel):
    """保存提取文风的请求"""
    name: str = Field("我的文风 - 自动提取", description="风格名称")
    writing_instruction: str = Field(..., description="综合写作指令（来自 /extract 的输出）")
    description: Optional[str] = Field(None, description="风格描述")