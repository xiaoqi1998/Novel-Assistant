"""AI去味API - 核心特色功能"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.generation_history import GenerationHistory
from app.models.writing_style import WritingStyle
from app.schemas.polish import PolishRequest, PolishResponse
from app.services.ai_service import AIService
from app.services.prompt_service import prompt_service, PromptService
from app.logger import get_logger
from app.api.settings import get_user_ai_service

router = APIRouter(prefix="/polish", tags=["AI去味"])
logger = get_logger(__name__)


async def _get_user_style_content(
    db: AsyncSession,
    user_id: str,
    writing_style_id: int = None
) -> str:
    """
    获取用户文风档案内容，用于注入到去味提示词。

    查询优先级：
    1. 显式传入 writing_style_id：按 ID 查询，需属于该用户
    2. 未传入：查询用户默认自定义风格（style_type='custom'，按 order_index 升序取第一个）

    Returns:
        文风提示词内容字符串；无任何匹配时返回空字符串（向后兼容）
    """
    if not user_id:
        return ""

    try:
        if writing_style_id is not None:
            stmt = select(WritingStyle).where(
                WritingStyle.id == writing_style_id,
                WritingStyle.user_id == user_id
            )
        else:
            stmt = (
                select(WritingStyle)
                .where(
                    WritingStyle.user_id == user_id,
                    WritingStyle.style_type == "custom"
                )
                .order_by(WritingStyle.order_index.asc(), WritingStyle.updated_at.desc())
                .limit(1)
            )
        result = await db.execute(stmt)
        style = result.scalar_one_or_none()
        if style and style.prompt_content:
            return style.prompt_content
    except Exception as e:
        logger.warning(f"查询用户文风档案失败，降级为通用去味: {e}")

    return ""


@router.post("", response_model=PolishResponse, summary="AI去味")
async def polish_text(
    request: PolishRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    AI去味 - 将AI生成的文本改写得更像人类作家的手笔

    核心功能：
    - 去除AI痕迹（工整排比、重复修辞、机械总结）
    - 增加人性化（口语化、不完美细节、真实情感）
    - 优化叙事（自然节奏、简单词汇、松弛感）
    - 让对话更生活化
    - 保留用户个人文风（如已配置 WritingStyle）

    这是本项目的核心特色功能！
    """
    try:
        # 获取用户ID
        user_id = getattr(http_request.state, 'user_id', None)

        # 查询用户文风档案（注入到去味提示词，保留用户个人笔感）
        style_content = await _get_user_style_content(
            db, user_id, request.writing_style_id
        )
        if style_content:
            logger.info(f"已加载用户文风档案，长度: {len(style_content)}")
        else:
            logger.info("未配置用户文风档案，按通用真人基准去味")

        # 获取自定义提示词模板
        template = await PromptService.get_template("AI_DENOISING", user_id, db)
        # 格式化提示词
        prompt = PromptService.format_prompt(
            template,
            original_text=request.original_text,
            style_content=style_content
        )

        logger.info(f"开始AI去味处理，原文长度: {len(request.original_text)}")

        # 调用AI进行去味处理
        polished_text = await user_ai_service.generate_text(
            prompt=prompt,
            provider=request.provider,
            model=request.model,
            temperature=request.temperature,
            max_tokens=len(request.original_text) * 2  # 预留足够token
        )

        # 计算字数
        word_count_before = len(request.original_text)
        word_count_after = len(polished_text)

        logger.info(f"AI去味完成，处理后长度: {word_count_after}")

        # 如果提供了项目ID，记录到历史
        if request.project_id:
            history = GenerationHistory(
                project_id=request.project_id,
                generation_type="polish",
                prompt=f"原文: {request.original_text[:100]}...",
                result=polished_text,
                provider=request.provider or "default",
                model=request.model or "default"
            )
            db.add(history)
            await db.commit()

        return PolishResponse(
            original_text=request.original_text,
            polished_text=polished_text,
            word_count_before=word_count_before,
            word_count_after=word_count_after
        )

    except Exception as e:
        logger.error(f"AI去味失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI去味失败: {str(e)}")


@router.post("/batch", summary="批量AI去味")
async def polish_batch(
    texts: list[str],
    project_id: int = None,
    provider: str = None,
    model: str = None,
    writing_style_id: int = None,
    http_request: Request = None,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    批量处理多个文本的AI去味

    适用于一次性处理多个章节或段落。
    支持注入用户文风档案（writing_style_id），保留用户个人笔感。
    """
    try:
        # 获取用户ID
        user_id = getattr(http_request.state, 'user_id', None) if http_request else None

        # 批量处理只查询一次文风档案，避免重复 DB 查询
        style_content = await _get_user_style_content(
            db, user_id, writing_style_id
        )

        results = []

        for idx, text in enumerate(texts):
            logger.info(f"处理第 {idx+1}/{len(texts)} 个文本")

            # 获取自定义提示词模板
            template = await PromptService.get_template("AI_DENOISING", user_id, db)
            # 格式化提示词
            prompt = PromptService.format_prompt(
                template,
                original_text=text,
                style_content=style_content
            )

            polished_text = await user_ai_service.generate_text(
                prompt=prompt,
                provider=provider,
                model=model
            )

            results.append({
                "index": idx,
                "original": text,
                "polished": polished_text,
                "word_count_before": len(text),
                "word_count_after": len(polished_text)
            })

        logger.info(f"批量AI去味完成，共处理 {len(results)} 个文本")

        return {
            "total": len(results),
            "results": results
        }

    except Exception as e:
        logger.error(f"批量AI去味失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"批量AI去味失败: {str(e)}")
