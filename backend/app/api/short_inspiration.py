"""短故事灵感模式API"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from app.services.ai_service import AIService
from app.services.short_story_ai_service import ShortStoryAIService
from app.api.settings import get_ai_service_for_usage
from app.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/short-inspiration", tags=["短故事灵感模式"])


class GenerateOptionsRequest(BaseModel):
    step: str  # emotion_goal / logline / twist / genre
    context: dict


class GenerateOptionsResponse(BaseModel):
    prompt: str
    options: list


# 各步骤的引导语
STEP_GUIDE = {
    "emotion_goal": "基于你的想法，我推荐以下情绪目标。情绪目标是短故事的核心，决定了读者读完后产生什么样的情绪反应。",
    "logline": "很好！现在来生成一句话梗概。爆款公式：极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念。",
    "twist": "接下来设计核心反转。反转必须出人意料但逻辑自洽，每组反转包含3个铺垫线索。",
    "genre": "最后选择题材标签。题材决定了你的短故事在哪个赛道竞争。",
}


@router.post("/generate-options", response_model=GenerateOptionsResponse, summary="生成短故事灵感选项")
async def generate_options(
    req: GenerateOptionsRequest,
    request: Request,
    ai_service: AIService = Depends(get_ai_service_for_usage("inspiration")),
):
    try:
        # 显式鉴权：对齐 short_stories.py 风格，从 request.state 取用户身份
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        if req.step not in STEP_GUIDE:
            raise HTTPException(status_code=400, detail=f"不支持的步骤: {req.step}，支持: emotion_goal/logline/twist/genre")

        result = await ShortStoryAIService.generate_inspiration_options(
            ai_service=ai_service,
            step=req.step,
            context=req.context,
        )

        options = result.get("options", [])
        guide = STEP_GUIDE.get(req.step, "")

        logger.info(
            f"生成短故事灵感选项成功: user_id={user_id}, step={req.step}, "
            f"options_count={len(options) if isinstance(options, list) else 0}"
        )
        return GenerateOptionsResponse(
            prompt=guide,
            options=options if isinstance(options, list) else [],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成短故事灵感选项失败: step={req.step}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")
