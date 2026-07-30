"""短故事管理API"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from pydantic import BaseModel
from typing import Optional
from urllib.parse import quote
import json
import re
import os
import asyncio
from datetime import datetime

from app.database import get_db
from app.models.short_story import ShortStory
from app.schemas.short_story import (
    ShortStoryCreate,
    ShortStoryUpdate,
    ShortStoryResponse,
    ShortStoryListResponse
)
from app.services.ai_service import AIService
from app.services.short_story_ai_service import ShortStoryAIService, FullStoryGenerator, StoryScorer, StoryImprover
from app.api.settings import get_user_ai_service
from app.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/short-stories", tags=["短故事管理"])


def _count_chinese_and_punctuation(text: str) -> int:
    """统计中文字符和中文标点的数量"""
    if not text:
        return 0
    # 中文字符范围
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
    # 中文标点
    chinese_punctuation = len(re.findall(r'[\u3000-\u303f\uff00-\uffef]', text))
    # 英文单词（简单按空格分割的非空字符串计数）
    english_words = len([w for w in re.findall(r'[a-zA-Z]+', text)])
    return chinese_chars + chinese_punctuation + english_words


def _build_default_segments(target_words: int) -> str:
    """构建默认分段进度（黄金结构：Hook 5% + Escalation 20% + Climax 60% + Resolution 15%）"""
    segments = [
        {"stage": "hook", "label": "死亡黄金钩子", "target_ratio": 0.05, "target_words": int(target_words * 0.05), "actual_words": 0, "status": "pending", "desc": "前300字抛出核心危机现场，第一句将读者推入冲突"},
        {"stage": "escalation", "label": "冲突激化与打压", "target_ratio": 0.20, "target_words": int(target_words * 0.20), "actual_words": 0, "status": "pending", "desc": "反派极致嚣张，主角劣势隐忍，将读者愤怒/屈辱感拉到最高点"},
        {"stage": "climax", "label": "绝地反击与多重反转", "target_ratio": 0.60, "target_words": int(target_words * 0.60), "actual_words": 0, "status": "pending", "desc": "剥洋葱式揭露真相，打一下→反派反扑→再揭露更大真相"},
        {"stage": "resolution", "label": "极致爽点与收尾", "target_ratio": 0.15, "target_words": int(target_words * 0.15), "actual_words": 0, "status": "pending", "desc": "反派惨烈下场，主角清醒独立走向新人生，干净利落收尾"},
    ]
    return json.dumps(segments, ensure_ascii=False)


def _build_default_polish_checklist() -> str:
    """构建默认精修自查清单"""
    checklist = [
        {"id": "opening_conflict", "category": "开头查验", "item": "前300字是否出现了核心矛盾？", "checked": False, "fix": "如果没有，删掉前面的铺垫背景"},
        {"id": "no_padding", "category": "废话查验", "item": "有没有超过3行无意义的环境或心理描写？", "checked": False, "fix": "如果有，全部删掉"},
        {"id": "hook_point", "category": "卡点查验", "item": "免费章节结束的那一句话，有没有让人非看下一章不可的欲望？", "checked": False, "fix": "如果没有，重写结尾制造悬念"},
        {"id": "anti_ai", "category": "去AI味查验", "item": "台词读起来像不像真人说的话？是否有大篇幅的排比句和空洞形容词？", "checked": False, "fix": "改写台词为口语化，删除排比句和空洞形容词"},
        {"id": "emotion_curve", "category": "情绪曲线", "item": "每1000-1500字是否有一次小冲突或小揭秘？", "checked": False, "fix": "不能有超过500字的纯说明性废话"},
        {"id": "character_tags", "category": "人设查验", "item": "人设是否高度标签化（一眼认清阵营）？", "checked": False, "fix": "简化为清醒大女主/极致恶毒绿茶/软饭硬吃渣男等标签"},
        {"id": "dialogue_function", "category": "对话查验", "item": "每句台词是否具备暴露阴谋或推进爽点的功能？", "checked": False, "fix": "删掉所有日常寒暄，每句台词必须有功能"},
        {"id": "high_concept", "category": "选题查验", "item": "选题是否具备高概念（一句话说清爆点）？", "checked": False, "fix": "公式：极致反差/道德冲突+强身份标签+迫切危机悬念"},
    ]
    return json.dumps(checklist, ensure_ascii=False)


def _recalc_segments_from_content(content: str, target_words: int, existing_segments: str | None) -> tuple[str, int]:
    """根据正文内容重新计算分段字数和状态

    有正文时：按目标比例分配实际字数到各段，并标记为 completed
    无正文时：只重置 target_words，状态保持 pending
    """
    total_words = _count_chinese_and_punctuation(content)
    if not existing_segments:
        existing_segments = _build_default_segments(target_words)

    try:
        segments = json.loads(existing_segments)
    except (json.JSONDecodeError, TypeError):
        segments = json.loads(_build_default_segments(target_words))

    has_content = total_words > 0
    for seg in segments:
        seg["target_words"] = int(target_words * seg["target_ratio"])
        if has_content:
            # 按目标比例分配实际字数（近似），并标记已完成
            seg["actual_words"] = int(total_words * seg["target_ratio"])
            seg["status"] = "completed"
        else:
            seg["actual_words"] = 0
            seg["status"] = "pending"

    return json.dumps(segments, ensure_ascii=False), total_words


@router.post("", response_model=ShortStoryResponse, summary="创建短故事")
async def create_short_story(
    story: ShortStoryCreate,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        story_data = story.model_dump()
        story_data['user_id'] = user_id

        # 初始化分段进度
        target_words = story_data.get('target_words') or 12000
        story_data['segments'] = _build_default_segments(target_words)

        # 初始化精修自查清单
        if not story_data.get('polish_checklist'):
            story_data['polish_checklist'] = _build_default_polish_checklist()

        # 如果有正文，计算字数
        if story_data.get('content'):
            story_data['current_words'] = _count_chinese_and_punctuation(story_data['content'])
            story_data['segments'], story_data['current_words'] = _recalc_segments_from_content(
                story_data['content'], target_words, story_data['segments']
            )

        db_story = ShortStory(**story_data)
        db.add(db_story)
        await db.commit()
        await db.refresh(db_story)
        logger.info(f"短故事创建成功: story_id={db_story.id}, user_id={user_id}")
        return db_story
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建短故事失败: {str(e)}", exc_info=True)
        raise


@router.get("", response_model=ShortStoryListResponse, summary="获取短故事列表")
async def get_short_stories(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        count_result = await db.execute(
            select(func.count(ShortStory.id)).where(ShortStory.user_id == user_id)
        )
        total = count_result.scalar_one()

        result = await db.execute(
            select(ShortStory)
            .where(ShortStory.user_id == user_id)
            .order_by(ShortStory.updated_at.desc())
            .offset(skip)
            .limit(limit)
        )
        stories = result.scalars().all()
        logger.info(f"获取短故事列表: user_id={user_id}, total={total}, returned={len(stories)}")
        return ShortStoryListResponse(total=total, items=stories)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取短故事列表失败: {str(e)}", exc_info=True)
        raise


@router.get("/{story_id}", response_model=ShortStoryResponse, summary="获取短故事详情")
async def get_short_story(
    story_id: str,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(
                ShortStory.id == story_id,
                ShortStory.user_id == user_id
            )
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")
        return story
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取短故事详情失败: {str(e)}", exc_info=True)
        raise


@router.put("/{story_id}", response_model=ShortStoryResponse, summary="更新短故事")
async def update_short_story(
    story_id: str,
    story_update: ShortStoryUpdate,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(
                ShortStory.id == story_id,
                ShortStory.user_id == user_id
            )
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        update_data = story_update.model_dump(exclude_unset=True)

        # 如果更新了正文，重新计算字数和分段
        if 'content' in update_data:
            target_words = story.target_words or 12000
            new_content = update_data['content'] or ""
            update_data['current_words'] = _count_chinese_and_punctuation(new_content)
            update_data['segments'], _ = _recalc_segments_from_content(
                new_content, target_words, story.segments
            )

        # 如果更新了目标字数，重新计算分段的目标字数
        if 'target_words' in update_data and update_data['target_words']:
            target_words = update_data['target_words']
            existing_segments = story.segments
            try:
                segments = json.loads(existing_segments) if existing_segments else []
                for seg in segments:
                    seg['target_words'] = int(target_words * seg.get('target_ratio', 0))
                update_data['segments'] = json.dumps(segments, ensure_ascii=False)
            except (json.JSONDecodeError, TypeError):
                update_data['segments'] = _build_default_segments(target_words)

        for field, value in update_data.items():
            setattr(story, field, value)

        await db.commit()
        await db.refresh(story)
        logger.info(
            f"更新短故事: story_id={story_id}, fields={list(update_data.keys())}, "
            f"current_words={story.current_words}"
        )
        return story
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新短故事失败: {str(e)}", exc_info=True)
        raise


@router.delete("/{story_id}", summary="删除短故事")
async def delete_short_story(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(
                ShortStory.id == story_id,
                ShortStory.user_id == user_id
            )
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        await db.delete(story)
        await db.commit()
        logger.info(f"删除短故事: story_id={story_id}, user_id={user_id}")
        return {"message": "删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除短故事失败: {str(e)}", exc_info=True)
        raise


# ============ AI 生成端点 ============

class GenerateLoglinesRequest(BaseModel):
    title: Optional[str] = None
    emotion_goal: Optional[str] = None
    genre: Optional[str] = None
    user_idea: Optional[str] = None


@router.post("/{story_id}/generate-loglines", summary="AI生成一句话梗概")
async def generate_loglines(
    story_id: str,
    req: GenerateLoglinesRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        options = await ShortStoryAIService.generate_loglines(
            ai_service=ai_service,
            title=req.title or story.title or "",
            emotion_goal=req.emotion_goal or story.emotion_goal or "",
            genre=req.genre or story.genre or "",
            user_idea=req.user_idea or story.logline or "",
        )
        logger.info(f"AI生成梗概成功: story_id={story_id}, options_count={len(options) if isinstance(options, list) else 'N/A'}")
        return {"options": options}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI生成梗概失败: story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/{story_id}/generate-twists", summary="AI生成核心反转设计")
async def generate_twists(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        options = await ShortStoryAIService.generate_twists(
            ai_service=ai_service,
            title=story.title or "",
            logline=story.logline or "",
            emotion_goal=story.emotion_goal or "",
        )
        logger.info(f"AI生成反转成功: story_id={story_id}, options_count={len(options) if isinstance(options, list) else 'N/A'}")
        return {"options": options}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI生成反转失败: story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


class GenerateSegmentRequest(BaseModel):
    segment_stage: str  # hook / escalation / climax / resolution


@router.post("/{story_id}/generate-segment", summary="AI生成分段正文")
async def generate_segment(
    story_id: str,
    req: GenerateSegmentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        # 解析分段
        try:
            segments = json.loads(story.segments) if story.segments else []
        except (json.JSONDecodeError, TypeError):
            segments = json.loads(_build_default_segments(story.target_words or 12000))

        target_segment = None
        for seg in segments:
            if seg.get("stage") == req.segment_stage:
                target_segment = seg
                break

        if not target_segment:
            raise HTTPException(status_code=400, detail=f"未找到段落: {req.segment_stage}")

        story_data = {
            "title": story.title,
            "logline": story.logline,
            "emotion_goal": story.emotion_goal,
            "twist_content": story.twist_content,
            "twist_type": story.twist_type,
            "twist_clues": story.twist_clues,
            "characters": story.characters,
            "target_platform": story.target_platform,
            "target_words": story.target_words,
        }

        logger.info(f"开始AI生成分段: story_id={story_id}, stage={req.segment_stage}, target_words={target_segment.get('target_words')}")
        content = await ShortStoryAIService.generate_segment_content(
            ai_service=ai_service,
            story_data=story_data,
            segment=target_segment,
            existing_content=story.content or "",
        )
        generated_words = _count_chinese_and_punctuation(content)
        logger.info(
            f"AI生成分段成功: story_id={story_id}, stage={req.segment_stage}, "
            f"generated_words={generated_words}"
        )
        return {"content": content}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI生成分段失败: story_id={story_id}, stage={req.segment_stage}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/{story_id}/polish", summary="AI精修润色正文")
async def polish_story(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        if not story.content:
            raise HTTPException(status_code=400, detail="正文为空，无法精修")

        original_content = story.content
        original_words = story.current_words or _count_chinese_and_punctuation(original_content)
        logger.info(f"开始AI精修: story_id={story_id}, original_words={original_words}")

        try:
            polished = await ShortStoryAIService.polish_content(
                ai_service=ai_service,
                title=story.title or "",
                emotion_goal=story.emotion_goal or "",
                twist_content=story.twist_content or "",
                content=story.content,
            )
        except Exception as ai_err:
            # 错误恢复：AI精修失败时保留原文，状态不前进
            logger.error(
                f"AI精修调用失败，保留原文: story_id={story_id}, error={str(ai_err)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"AI精修失败，原文未改动: {str(ai_err)}")

        # 校验精修结果有效性
        if not polished or len(polished.strip()) < 50:
            logger.warning(f"AI精修结果过短或为空，保留原文: story_id={story_id}, polished_len={len(polished) if polished else 0}")
            raise HTTPException(status_code=500, detail="AI精修结果为空或过短，原文未改动")

        # 更新正文
        story.content = polished
        story.current_words = _count_chinese_and_punctuation(polished)
        story.segments, _ = _recalc_segments_from_content(
            polished, story.target_words or 12000, story.segments
        )
        story.status = "polishing"
        await db.commit()
        await db.refresh(story)
        logger.info(
            f"AI精修成功: story_id={story_id}, {original_words}字→{story.current_words}字"
        )
        return {"content": polished, "current_words": story.current_words}
    except HTTPException:
        raise
    except Exception as e:
        # 兜底恢复：未知异常时回滚未提交的改动
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI精修失败(已回滚): story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"精修失败: {str(e)}")


# ============ 导出端点 ============

@router.get("/{story_id}/export-markdown", summary="导出短故事为Markdown")
async def export_markdown(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        # 构建安全文件名
        safe_title = re.sub(r'[^\w\u4e00-\u9fa5\s\-_，。、]', '', story.title)[:50].strip() or "短故事"
        safe_title = safe_title.replace(' ', '_')

        status_map = {"planning": "规划中", "writing": "创作中", "polishing": "精修中", "completed": "已完结"}
        export_time = datetime.now().strftime("%Y-%m-%d %H:%M")

        logger.info(f"导出Markdown: story_id={story_id}, title={story.title}, words={story.current_words}")
        md = f"""# {story.title}

> **类型**: 短故事
> **状态**: {status_map.get(story.status, story.status)}
> **字数**: {story.current_words} 字
> **目标字数**: {story.target_words} 字
> **情绪目标**: {story.emotion_goal or '未设定'}
> **导出时间**: {export_time}

---

## 故事设定

**一句话梗概**: {story.logline or '未设定'}

**核心反转**: {story.twist_content or '未设定'}

**反转类型**: {story.twist_type or '未设定'}

**题材标签**: {story.genre or '未设定'}

**目标平台**: {story.target_platform or '未设定'}

---

## 正文

{story.content or '（暂无正文）'}
"""

        encoded_filename = quote(f"{safe_title}.md")
        return Response(
            content=md,
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出短故事Markdown失败: {str(e)}", exc_info=True)
        raise


@router.get("/{story_id}/export-txt", summary="导出短故事为TXT")
async def export_txt(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        safe_title = re.sub(r'[^\w\u4e00-\u9fa5\s\-_，。、]', '', story.title)[:50].strip() or "短故事"
        safe_title = safe_title.replace(' ', '_')

        txt = f"""{story.title}

{story.content or '（暂无正文）'}
"""
        logger.info(f"导出TXT: story_id={story_id}, title={story.title}, words={story.current_words}")
        encoded_filename = quote(f"{safe_title}.txt")
        return Response(
            content=txt,
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出短故事TXT失败: {str(e)}", exc_info=True)
        raise


# ============ 封面生成端点 ============

@router.post("/{story_id}/generate-cover", summary="生成短故事封面")
async def generate_cover(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        if story.cover_status == "generating":
            raise HTTPException(status_code=409, detail="封面正在生成中，请稍候")

        # 延迟导入，避免循环依赖
        from app.services.cover_generation_service import (
            CoverGenerationService, GENERATED_COVER_STORAGE_DIR,
            GENERATED_COVER_PUBLIC_PREFIX, COVER_WIDTH, COVER_HEIGHT
        )
        from app.services.prompt_service import PromptService
        from app.api.settings import get_user_ai_service_from_db
        from sqlalchemy import select as sa_select
        from app.models.settings import Settings

        # 获取用户设置
        settings_result = await db.execute(
            sa_select(Settings).where(Settings.user_id == user_id)
        )
        settings = settings_result.scalar_one_or_none()
        if not settings:
            raise HTTPException(status_code=400, detail="请先在设置中配置封面生成参数")

        if not settings.cover_enabled:
            raise HTTPException(status_code=400, detail="封面生成未启用，请先在设置中开启")

        # 构建封面提示词（复用 PromptService）
        cover_prompt = await PromptService.build_novel_cover_prompt(story, user_id, db)

        story.cover_status = "generating"
        story.cover_prompt = cover_prompt
        await db.commit()
        logger.info(f"开始生成封面: story_id={story_id}, title={story.title}")

        try:
            service = CoverGenerationService()
            provider = service._build_provider(settings)
            cover_result = await provider.generate_cover(
                prompt=cover_prompt,
                model=settings.cover_image_model,
                width=COVER_WIDTH,
                height=COVER_HEIGHT,
            )

            # 保存文件
            from datetime import datetime as dt
            user_dir = GENERATED_COVER_STORAGE_DIR / user_id
            user_dir.mkdir(parents=True, exist_ok=True)
            timestamp = dt.utcnow().strftime("%Y%m%d%H%M%S")
            safe_ext = cover_result.get("file_extension", "png")
            filename = f"{story_id}_{timestamp}.{safe_ext}"
            file_path = user_dir / filename
            file_path.write_bytes(cover_result["content"])

            cover_url = f"{GENERATED_COVER_PUBLIC_PREFIX}/{quote(user_id)}/{quote(filename)}"

            story.cover_image_url = cover_url
            story.cover_status = "ready"
            await db.commit()
            await db.refresh(story)
            logger.info(f"封面生成成功: story_id={story_id}, cover_url={cover_url}")

            return {
                "cover_status": "ready",
                "cover_image_url": cover_url,
                "cover_prompt": cover_prompt,
                "message": "封面生成成功",
            }
        except Exception as e:
            # 错误恢复：标记封面为失败，便于用户重试
            story.cover_status = "failed"
            await db.commit()
            logger.error(
                f"封面生成失败(已标记failed可重试): story_id={story_id}, error={str(e)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"封面生成失败: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成短故事封面失败: {str(e)}", exc_info=True)
        raise


# ============ 端到端生成端点 ============

class GenerateFullStoryRequest(BaseModel):
    initial_idea: str
    target_words: int = 12000
    emotion_goal: Optional[str] = None
    target_platform: str = "知乎盐言"


@router.post("/generate-full", summary="AI一键生成完整短故事（设定+全文）")
async def generate_full_story(
    req: GenerateFullStoryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    """输入想法，AI一次性生成完整短故事（设定+全文），自动创建记录"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        if not req.initial_idea or not req.initial_idea.strip():
            raise HTTPException(status_code=400, detail="请输入故事想法")

        logger.info(
            f"开始AI一键生成完整短故事: user_id={user_id}, "
            f"idea_len={len(req.initial_idea)}, target_words={req.target_words}, "
            f"emotion_goal={req.emotion_goal}, platform={req.target_platform}"
        )

        # 调用AI生成完整短故事（先生成，失败则不创建DB记录）
        try:
            story_data = await FullStoryGenerator.generate_full_story(
                ai_service=ai_service,
                initial_idea=req.initial_idea.strip(),
                target_words=req.target_words,
                emotion_goal=req.emotion_goal or "",
                target_platform=req.target_platform,
            )
        except Exception as ai_err:
            # 错误恢复：AI生成失败时不创建任何DB记录，避免脏数据
            logger.error(
                f"AI一键生成调用失败，未创建DB记录: user_id={user_id}, error={str(ai_err)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"AI生成失败: {str(ai_err)}")

        # 校验生成结果
        if not story_data or not story_data.get("title") or not story_data.get("content"):
            logger.error(
                f"AI生成结果不完整: user_id={user_id}, "
                f"has_title={bool(story_data and story_data.get('title'))}, "
                f"has_content={bool(story_data and story_data.get('content'))}"
            )
            raise HTTPException(status_code=500, detail="AI生成结果不完整（缺少标题或正文）")

        # 创建短故事记录
        import uuid
        story_id = str(uuid.uuid4())
        target_words = req.target_words

        new_story = ShortStory(
            id=story_id,
            user_id=user_id,
            title=story_data["title"],
            logline=story_data.get("logline", ""),
            genre=story_data.get("genre", ""),
            target_platform=req.target_platform,
            target_words=target_words,
            current_words=0,
            emotion_goal=story_data.get("emotion_goal", req.emotion_goal or ""),
            twist_type=story_data.get("twist_type", ""),
            twist_content=story_data.get("twist_content", ""),
            twist_clues=json.dumps(story_data.get("twist_clues", []), ensure_ascii=False),
            characters=json.dumps(story_data.get("characters", []), ensure_ascii=False) if story_data.get("characters") else None,
            content=story_data.get("content", ""),
            segments=_build_default_segments(target_words),
            polish_checklist=_build_default_polish_checklist(),
            status="writing",
        )

        # 计算字数和分段
        content = story_data.get("content", "")
        new_story.current_words = _count_chinese_and_punctuation(content)
        new_story.segments, _ = _recalc_segments_from_content(
            content, target_words, new_story.segments
        )

        db.add(new_story)
        await db.commit()
        await db.refresh(new_story)
        logger.info(
            f"AI一键生成完整短故事成功: story_id={story_id}, user_id={user_id}, "
            f"title={new_story.title}, words={new_story.current_words}"
        )
        return new_story
    except HTTPException:
        raise
    except ValueError as e:
        # 错误恢复：JSON解析失败时回滚
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI生成结果解析失败(已回滚): user_id={user_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI生成结果格式错误: {str(e)}")
    except Exception as e:
        # 兜底恢复：未知异常时回滚
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI生成完整短故事失败(已回滚): user_id={user_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


# ============ AI 评分端点 ============

@router.post("/{story_id}/score", summary="AI评分短故事（5维评分）")
async def score_story(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    """对短故事进行5维AI评分，依据爆款方法论"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        if not story.content:
            raise HTTPException(status_code=400, detail="正文为空，无法评分")

        content_words = _count_chinese_and_punctuation(story.content)
        logger.info(f"开始AI评分: story_id={story_id}, title={story.title}, words={content_words}")

        # 错误恢复：保留旧评分引用，AI失败时不清空
        old_score_data = story.score_data

        try:
            score_result = await StoryScorer.score_story(
                ai_service=ai_service,
                title=story.title or "",
                content=story.content,
                emotion_goal=story.emotion_goal or "",
                logline=story.logline or "",
                twist_type=story.twist_type or "",
                twist_content=story.twist_content or "",
                genre=story.genre or "",
                target_words=story.target_words or 12000,
            )
        except Exception as ai_err:
            # 错误恢复：AI评分失败时保留旧评分，不清空
            logger.error(
                f"AI评分调用失败，保留旧评分: story_id={story_id}, error={str(ai_err)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"AI评分失败，旧评分保留: {str(ai_err)}")

        # 保存评分到数据库
        story.score_data = json.dumps(score_result, ensure_ascii=False)
        story.scored_at = datetime.now()
        await db.commit()

        logger.info(
            f"AI评分成功: story_id={story_id}, total_score={score_result.get('total_score')}, "
            f"level={score_result.get('level')}"
        )
        return score_result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI评分失败(已回滚): story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"评分失败: {str(e)}")


@router.get("/{story_id}/score", summary="获取已保存的AI评分")
async def get_score(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取已保存的评分结果"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        if not story.score_data:
            raise HTTPException(status_code=404, detail="尚未评分")

        return json.loads(story.score_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取评分失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取失败: {str(e)}")


@router.post("/{story_id}/improve-from-score", summary="基于AI评分改进正文")
async def improve_from_score(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    """根据AI评分给出的改进点（issues/suggestions/top_issues/improvement_priority）
    自动修订正文，形成"评分→改进→再评分"的质量闭环。

    流程：
    1. 读取已保存的 score_data（评分结果）
    2. 把改进点喂给AI，让其针对性修订正文
    3. 保存修订后的正文，保留原文备份到 polish_notes
    4. 清空旧评分（scored_at/score_data），提示用户重新评分
    """
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            raise HTTPException(status_code=401, detail="未登录")

        result = await db.execute(
            select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
        )
        story = result.scalar_one_or_none()
        if not story:
            raise HTTPException(status_code=404, detail="短故事不存在")

        if not story.content:
            raise HTTPException(status_code=400, detail="正文为空，无法改进")

        if not story.score_data:
            raise HTTPException(status_code=400, detail="尚未评分，请先进行AI评分")

        try:
            score_data = json.loads(story.score_data)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(status_code=400, detail="评分数据格式错误，请重新评分")

        # 保留原文备份
        original_content = story.content
        original_words = story.current_words or _count_chinese_and_punctuation(original_content)
        logger.info(
            f"开始AI基于评分改进: story_id={story_id}, original_words={original_words}, "
            f"old_score={score_data.get('total_score')}/100"
        )

        try:
            improved_content = await StoryImprover.improve_from_score(
                ai_service=ai_service,
                title=story.title or "",
                content=story.content,
                score_data=score_data,
                emotion_goal=story.emotion_goal or "",
                logline=story.logline or "",
                twist_type=story.twist_type or "",
                twist_content=story.twist_content or "",
                genre=story.genre or "",
                target_words=story.target_words or 12000,
            )
        except Exception as ai_err:
            # 错误恢复：AI改进失败时保留原文和旧评分
            logger.error(
                f"AI改进调用失败，保留原文和旧评分: story_id={story_id}, error={str(ai_err)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"AI改进失败，原文和旧评分保留: {str(ai_err)}")

        if not improved_content or len(improved_content.strip()) < 100:
            logger.warning(
                f"AI改进结果过短或为空，保留原文: story_id={story_id}, "
                f"improved_len={len(improved_content) if improved_content else 0}"
            )
            raise HTTPException(status_code=500, detail="AI改进结果为空或过短，原文未改动")

        # 更新正文
        story.content = improved_content
        story.current_words = _count_chinese_and_punctuation(improved_content)
        story.segments, _ = _recalc_segments_from_content(
            improved_content, story.target_words or 12000, story.segments
        )
        story.status = "polishing"

        # 清空旧评分，提示重新评分
        story.score_data = None
        story.scored_at = None

        # 记录改进历史到 polish_notes
        improve_record = (
            f"\n---\n[AI基于评分改进] 原文 {original_words}字 → 改进后 {story.current_words}字\n"
            f"改进依据：总分 {score_data.get('total_score', '?')}/100（{score_data.get('level', '?')}）\n"
            f"重点解决：{'; '.join((score_data.get('top_issues') or [])[:3]) or '无'}\n"
            f"请重新评分验证改进效果。"
        )
        story.polish_notes = (story.polish_notes or "") + improve_record

        await db.commit()
        await db.refresh(story)

        logger.info(
            f"AI基于评分改进正文成功: story_id={story_id}, "
            f"{original_words}字→{story.current_words}字"
        )

        return {
            "content": improved_content,
            "current_words": story.current_words,
            "original_words": original_words,
            "message": "已基于评分改进点修订正文，请重新评分验证",
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI基于评分改进失败(已回滚): story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"改进失败: {str(e)}")
