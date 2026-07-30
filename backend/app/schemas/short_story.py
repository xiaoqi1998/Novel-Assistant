"""短故事相关的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class ShortStoryBase(BaseModel):
    """短故事基础模型"""
    title: str = Field(..., description="故事标题")
    logline: Optional[str] = Field(None, description="一句话梗概：主角+困境+反转+情绪落点")
    genre: Optional[str] = Field(None, description="题材标签")
    target_platform: Optional[str] = Field(None, description="目标平台")
    target_words: Optional[int] = Field(default=12000, ge=8000, le=20000, description="目标字数，8000-20000")


class ShortStoryCreate(ShortStoryBase):
    """创建短故事的请求模型"""
    emotion_goal: Optional[str] = Field(None, description="情绪目标")
    emotion_goal_desc: Optional[str] = Field(None, description="情绪目标描述")
    twist_type: Optional[str] = Field(None, description="反转类型")
    twist_content: Optional[str] = Field(None, description="反转内容")
    twist_clues: Optional[str] = Field(None, description="铺垫线索JSON")
    emotion_curve: Optional[str] = Field(None, description="情绪曲线JSON")
    characters: Optional[str] = Field(None, description="人设速写JSON")
    content: Optional[str] = Field(None, description="完整正文")
    segments: Optional[str] = Field(None, description="分段进度JSON")
    polish_notes: Optional[str] = Field(None, description="精修笔记")
    polish_checklist: Optional[str] = Field(None, description="精修清单JSON")


class ShortStoryUpdate(BaseModel):
    """更新短故事的请求模型"""
    title: Optional[str] = None
    logline: Optional[str] = None
    genre: Optional[str] = None
    target_platform: Optional[str] = None
    target_words: Optional[int] = Field(default=None, ge=8000, le=20000)
    emotion_goal: Optional[str] = None
    emotion_goal_desc: Optional[str] = None
    twist_type: Optional[str] = None
    twist_content: Optional[str] = None
    twist_clues: Optional[str] = None
    emotion_curve: Optional[str] = None
    characters: Optional[str] = None
    content: Optional[str] = None
    segments: Optional[str] = None
    polish_notes: Optional[str] = None
    polish_checklist: Optional[str] = None
    status: Optional[str] = None
    # current_words 由正文内容自动计算，不允许手动修改


class ShortStoryResponse(ShortStoryBase):
    """短故事响应模型"""
    id: str
    current_words: int
    status: str
    emotion_goal: Optional[str] = None
    emotion_goal_desc: Optional[str] = None
    twist_type: Optional[str] = None
    twist_content: Optional[str] = None
    twist_clues: Optional[str] = None
    emotion_curve: Optional[str] = None
    characters: Optional[str] = None
    content: Optional[str] = None
    segments: Optional[str] = None
    polish_notes: Optional[str] = None
    polish_checklist: Optional[str] = None
    cover_image_url: Optional[str] = None
    cover_prompt: Optional[str] = None
    cover_status: Optional[str] = None
    score_data: Optional[str] = None
    scored_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShortStoryListResponse(BaseModel):
    """短故事列表响应模型"""
    total: int
    items: list[ShortStoryResponse]
