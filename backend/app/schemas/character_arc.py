"""角色弧光相关的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class CharacterArcCreate(BaseModel):
    """创建角色弧光的请求模型"""
    project_id: str = Field(..., description="项目ID")
    character_id: str = Field(..., description="角色ID")
    arc_type: str = Field("growth", description="弧光类型: growth/fall/redemption/awakening/sacrifice")
    core_goal: str = Field(..., description="核心目标：角色在整个弧光中追求什么")
    motivation: Optional[str] = Field(None, description="动机：为什么追求这个目标")
    internal_conflict: Optional[str] = Field(None, description="内在冲突：阻碍角色达成目标的心理矛盾")
    external_goal: Optional[str] = Field(None, description="近期外在目标")
    current_stage: Optional[str] = Field("trigger", description="当前阶段: trigger/struggle/turning_point/transformation/completion")
    stage_progress: Optional[int] = Field(0, ge=0, le=100, description="整体进度 0-100")
    target_resolution_chapter: Optional[int] = Field(None, description="预期完成弧光的章节号")
    status: Optional[str] = Field("active", description="状态: active/completed/abandoned")


class CharacterArcUpdate(BaseModel):
    """更新角色弧光的请求模型"""
    arc_type: Optional[str] = None
    core_goal: Optional[str] = None
    motivation: Optional[str] = None
    internal_conflict: Optional[str] = None
    external_goal: Optional[str] = None
    current_stage: Optional[str] = None
    stage_progress: Optional[int] = Field(None, ge=0, le=100, description="整体进度 0-100")
    target_resolution_chapter: Optional[int] = None
    status: Optional[str] = None


class CharacterArcResponse(BaseModel):
    """角色弧光响应模型"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    character_id: str
    arc_type: str
    core_goal: str
    motivation: Optional[str] = None
    internal_conflict: Optional[str] = None
    external_goal: Optional[str] = None
    current_stage: Optional[str] = None
    stage_progress: int = 0
    milestones: Optional[List[Dict[str, Any]]] = None
    target_resolution_chapter: Optional[int] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CharacterArcListResponse(BaseModel):
    """角色弧光列表响应模型"""
    arcs: List[CharacterArcResponse]
    total: int


class CharacterArcGenerateRequest(BaseModel):
    """AI生成角色弧光的请求模型"""
    project_id: str = Field(..., description="项目ID")
    character_id: str = Field(..., description="角色ID")
    hint: Optional[str] = Field(None, description="用户补充提示（如：希望这是一个救赎弧光）")
