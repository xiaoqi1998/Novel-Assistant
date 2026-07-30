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
from app.services.short_story_ai_service import ShortStoryAIService, FullStoryGenerator, StoryScorer, StoryImprover, ChecklistChecker
from app.api.settings import get_user_ai_service
from app.logger import get_logger
from app.utils.sse_response import SSEResponse, create_sse_response, HEARTBEAT

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


def _build_default_emotion_curve(emotion_goal: str = "") -> str:
    """根据情绪目标构建默认情绪曲线

    不同情绪目标对应不同的各阶段情绪和强度
    """
    # 根据情绪目标选择不同的默认曲线
    curves = {
        "意难平": [
            {"stage": "opening", "emotion": "温馨/美好", "intensity": 6},
            {"stage": "buildup", "emotion": "误解/错过", "intensity": 8},
            {"stage": "twist", "emotion": "真相大白/心碎", "intensity": 10},
            {"stage": "ending", "emotion": "意难平/遗憾", "intensity": 7},
        ],
        "反转震撼": [
            {"stage": "opening", "emotion": "紧张/不安", "intensity": 7},
            {"stage": "buildup", "emotion": "疑惑/不安", "intensity": 8},
            {"stage": "twist", "emotion": "震撼/颠覆", "intensity": 10},
            {"stage": "ending", "emotion": "细思极恐/回味", "intensity": 7},
        ],
        "爽感释放": [
            {"stage": "opening", "emotion": "紧张/震惊", "intensity": 7},
            {"stage": "buildup", "emotion": "愤怒/屈辱", "intensity": 9},
            {"stage": "twist", "emotion": "爽感/震撼", "intensity": 10},
            {"stage": "ending", "emotion": "释怀/余味", "intensity": 6},
        ],
        "治愈温暖": [
            {"stage": "opening", "emotion": "低谷/孤独", "intensity": 5},
            {"stage": "buildup", "emotion": "温暖/靠近", "intensity": 7},
            {"stage": "twist", "emotion": "感动/双向奔赴", "intensity": 9},
            {"stage": "ending", "emotion": "治愈/幸福", "intensity": 8},
        ],
        "细思极恐": [
            {"stage": "opening", "emotion": "诡异/不安", "intensity": 6},
            {"stage": "buildup", "emotion": "恐惧/疑虑", "intensity": 8},
            {"stage": "twist", "emotion": "毛骨悚然/颠覆", "intensity": 10},
            {"stage": "ending", "emotion": "细思极恐/不寒而栗", "intensity": 8},
        ],
        "共鸣感动": [
            {"stage": "opening", "emotion": "平凡/日常", "intensity": 4},
            {"stage": "buildup", "emotion": "触动/共鸣", "intensity": 7},
            {"stage": "twist", "emotion": "感动/泪目", "intensity": 9},
            {"stage": "ending", "emotion": "温暖/余韵", "intensity": 7},
        ],
    }
    nodes = curves.get(emotion_goal, curves["爽感释放"])
    return json.dumps(nodes, ensure_ascii=False)


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
            emotion_curve=story.emotion_curve or "",
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
                emotion_curve=story.emotion_curve or "",
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

        # 不直接写入DB，返回对比数据供用户预览确认
        polished_words = _count_chinese_and_punctuation(polished)
        logger.info(
            f"AI精修预览生成: story_id={story_id}, {original_words}字→{polished_words}字（待用户确认）"
        )
        return {
            "original_content": original_content,
            "new_content": polished,
            "original_words": original_words,
            "new_words": polished_words,
            "revision_type": "polish",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI精修失败: story_id={story_id}, error={str(e)}", exc_info=True)
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
                emotion_curve="",  # 一键生成时无预设情绪曲线
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
            emotion_curve=_build_default_emotion_curve(story_data.get("emotion_goal", req.emotion_goal or "")),
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


@router.post("/{story_id}/regenerate", summary="AI重新生成现有短故事的正文（更新而非新建）")
async def regenerate_story(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    """对已有短故事重新AI生成正文，更新当前记录而非创建新记录。

    保留原story_id，覆盖title/logline/content等字段。
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

        initial_idea = story.logline or story.title or "重写一个精彩短故事"
        logger.info(
            f"开始AI重新生成短故事: story_id={story_id}, idea={initial_idea[:50]}, "
            f"target_words={story.target_words}"
        )

        try:
            story_data = await FullStoryGenerator.generate_full_story(
                ai_service=ai_service,
                initial_idea=initial_idea,
                target_words=story.target_words or 12000,
                emotion_goal=story.emotion_goal or "",
                target_platform=story.target_platform or "知乎盐言",
                emotion_curve=story.emotion_curve or "",
            )
        except Exception as ai_err:
            logger.error(
                f"AI重新生成调用失败，保留原文: story_id={story_id}, error={str(ai_err)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"AI重新生成失败，原文未改动: {str(ai_err)}")

        if not story_data or not story_data.get("title") or not story_data.get("content"):
            raise HTTPException(status_code=500, detail="AI生成结果不完整，原文未改动")

        # 更新现有记录
        old_words = story.current_words or 0
        story.title = story_data["title"]
        story.logline = story_data.get("logline", story.logline)
        story.genre = story_data.get("genre", story.genre)
        story.emotion_goal = story_data.get("emotion_goal", story.emotion_goal)
        story.twist_type = story_data.get("twist_type", story.twist_type)
        story.twist_content = story_data.get("twist_content", story.twist_content)
        story.twist_clues = json.dumps(story_data.get("twist_clues", []), ensure_ascii=False)
        if story_data.get("characters"):
            story.characters = json.dumps(story_data.get("characters", []), ensure_ascii=False)
        story.content = story_data.get("content", "")
        story.current_words = _count_chinese_and_punctuation(story.content)
        story.segments, _ = _recalc_segments_from_content(
            story.content, story.target_words or 12000, story.segments
        )
        # 清空旧评分（内容已变）
        story.score_data = None
        story.scored_at = None
        story.status = "writing"

        await db.commit()
        await db.refresh(story)

        logger.info(
            f"AI重新生成成功: story_id={story_id}, {old_words}字→{story.current_words}字"
        )
        return story
    except HTTPException:
        raise
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI重新生成失败(已回滚): story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"重新生成失败: {str(e)}")


# ============ SSE 流式生成端点 ============

@router.post("/generate-full-stream", summary="AI一键生成完整短故事（SSE流式）")
async def generate_full_story_stream(
    req: GenerateFullStoryRequest,
    request: Request,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """输入想法，AI流式生成完整短故事（设定+全文），自动创建记录。

    SSE事件流：
    - progress: {type, message, progress, status}
    - stage: {type, stage:"setup"/"segment_N", message, total_segments, segment_index?}
    - chunk: {type, content, segment_index}
    - complete: {type, data:{...完整故事数据}}
    - error: {type, error}
    - done
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    if not req.initial_idea or not req.initial_idea.strip():
        raise HTTPException(status_code=400, detail="请输入故事想法")

    initial_idea = req.initial_idea.strip()
    target_words = req.target_words
    emotion_goal = req.emotion_goal or ""
    target_platform = req.target_platform

    logger.info(
        f"开始AI流式生成完整短故事: user_id={user_id}, "
        f"idea_len={len(initial_idea)}, target_words={target_words}"
    )

    async def event_generator():
        db_session = None
        try:
            # 调用AI流式生成
            story_data = None
            async for event in FullStoryGenerator.generate_full_story_stream(
                ai_service=ai_service,
                initial_idea=initial_idea,
                target_words=target_words,
                emotion_goal=emotion_goal,
                target_platform=target_platform,
                emotion_curve="",
            ):
                evt_type = event.get("type")
                if evt_type == "complete":
                    story_data = event.get("data")
                    # 不直接透传complete，等DB保存后再发
                    yield await SSEResponse.send_progress("AI生成完成，正在保存到数据库...", 98, "processing")
                elif evt_type == "error":
                    yield await SSEResponse.send_error(event.get("error", "AI生成失败"), 500)
                    yield await SSEResponse.send_done()
                    return
                elif evt_type == "heartbeat":
                    # SSE注释心跳，前端自动忽略，仅用于保持连接活跃防止代理超时
                    yield await SSEResponse.send_heartbeat()
                else:
                    yield SSEResponse.format_sse(event)

            if not story_data or not story_data.get("title") or not story_data.get("content"):
                yield await SSEResponse.send_error("AI生成结果不完整（缺少标题或正文）", 500)
                yield await SSEResponse.send_done()
                return

            # 保存到DB（在生成器内创建独立session）
            async for db_session in get_db(request):
                import uuid
                story_id = str(uuid.uuid4())
                new_story = ShortStory(
                    id=story_id,
                    user_id=user_id,
                    title=story_data["title"],
                    logline=story_data.get("logline", ""),
                    genre=story_data.get("genre", ""),
                    target_platform=target_platform,
                    target_words=target_words,
                    current_words=0,
                    emotion_goal=story_data.get("emotion_goal", emotion_goal or ""),
                    emotion_curve=_build_default_emotion_curve(story_data.get("emotion_goal", emotion_goal or "")),
                    twist_type=story_data.get("twist_type", ""),
                    twist_content=story_data.get("twist_content", ""),
                    twist_clues=json.dumps(story_data.get("twist_clues", []), ensure_ascii=False),
                    characters=json.dumps(story_data.get("characters", []), ensure_ascii=False) if story_data.get("characters") else None,
                    content=story_data.get("content", ""),
                    segments=_build_default_segments(target_words),
                    polish_checklist=_build_default_polish_checklist(),
                    status="writing",
                )
                content = story_data.get("content", "")
                new_story.current_words = _count_chinese_and_punctuation(content)
                new_story.segments, _ = _recalc_segments_from_content(
                    content, target_words, new_story.segments
                )
                db_session.add(new_story)
                await db_session.commit()
                await db_session.refresh(new_story)

                logger.info(f"AI流式生成短故事保存成功: story_id={story_id}, words={new_story.current_words}")

                # 返回完整story对象（前端需要id用于跳转）
                from app.schemas.short_story import ShortStoryResponse
                story_resp = ShortStoryResponse.model_validate(new_story).model_dump(mode='json')
                yield await SSEResponse.send_result(story_resp)
                break

            yield await SSEResponse.send_done()
        except GeneratorExit:
            logger.warning("短故事流式生成被提前关闭（SSE断开）")
            raise
        except Exception as e:
            logger.error(f"短故事流式生成失败: {str(e)}", exc_info=True)
            if db_session:
                try:
                    await db_session.rollback()
                except Exception:
                    pass
            yield await SSEResponse.send_error(str(e), 500)
            yield await SSEResponse.send_done()
        finally:
            if db_session:
                try:
                    await db_session.close()
                except Exception:
                    pass

    return create_sse_response(event_generator())


@router.post("/{story_id}/regenerate-stream", summary="AI重新生成短故事正文（SSE流式）")
async def regenerate_story_stream(
    story_id: str,
    request: Request,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """对已有短故事流式重新AI生成正文，更新当前记录。

    SSE事件流同 generate-full-stream。
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 预加载story信息（使用临时session）
    story_snapshot = None
    async for temp_db in get_db(request):
        try:
            result = await temp_db.execute(
                select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
            )
            story = result.scalar_one_or_none()
            if not story:
                raise HTTPException(status_code=404, detail="短故事不存在")
            story_snapshot = {
                "id": story.id,
                "logline": story.logline or story.title or "重写一个精彩短故事",
                "target_words": story.target_words or 12000,
                "emotion_goal": story.emotion_goal or "",
                "target_platform": story.target_platform or "知乎盐言",
                "emotion_curve": story.emotion_curve or "",
            }
        finally:
            await temp_db.close()
        break

    logger.info(f"开始AI流式重新生成: story_id={story_id}")

    async def event_generator():
        db_session = None
        try:
            story_data = None
            async for event in FullStoryGenerator.generate_full_story_stream(
                ai_service=ai_service,
                initial_idea=story_snapshot["logline"],
                target_words=story_snapshot["target_words"],
                emotion_goal=story_snapshot["emotion_goal"],
                target_platform=story_snapshot["target_platform"],
                emotion_curve=story_snapshot["emotion_curve"],
            ):
                evt_type = event.get("type")
                if evt_type == "complete":
                    story_data = event.get("data")
                    yield await SSEResponse.send_progress("AI生成完成，正在更新数据库...", 98, "processing")
                elif evt_type == "error":
                    yield await SSEResponse.send_error(event.get("error", "AI生成失败"), 500)
                    yield await SSEResponse.send_done()
                    return
                elif evt_type == "heartbeat":
                    # SSE注释心跳，前端自动忽略，仅用于保持连接活跃防止代理超时
                    yield await SSEResponse.send_heartbeat()
                else:
                    yield SSEResponse.format_sse(event)

            if not story_data or not story_data.get("title") or not story_data.get("content"):
                yield await SSEResponse.send_error("AI生成结果不完整，原文未改动", 500)
                yield await SSEResponse.send_done()
                return

            # 更新DB
            async for db_session in get_db(request):
                result = await db_session.execute(
                    select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
                )
                story = result.scalar_one_or_none()
                if not story:
                    yield await SSEResponse.send_error("短故事不存在", 404)
                    yield await SSEResponse.send_done()
                    break

                story.title = story_data["title"]
                story.logline = story_data.get("logline", story.logline)
                story.genre = story_data.get("genre", story.genre)
                story.emotion_goal = story_data.get("emotion_goal", story.emotion_goal)
                story.twist_type = story_data.get("twist_type", story.twist_type)
                story.twist_content = story_data.get("twist_content", story.twist_content)
                story.twist_clues = json.dumps(story_data.get("twist_clues", []), ensure_ascii=False)
                if story_data.get("characters"):
                    story.characters = json.dumps(story_data.get("characters", []), ensure_ascii=False)
                story.content = story_data.get("content", "")
                story.current_words = _count_chinese_and_punctuation(story.content)
                story.segments, _ = _recalc_segments_from_content(
                    story.content, story.target_words or 12000, story.segments
                )
                story.score_data = None
                story.scored_at = None
                story.status = "writing"
                await db_session.commit()
                await db_session.refresh(story)

                logger.info(f"AI流式重新生成成功: story_id={story_id}, words={story.current_words}")
                from app.schemas.short_story import ShortStoryResponse
                story_resp = ShortStoryResponse.model_validate(story).model_dump(mode='json')
                yield await SSEResponse.send_result(story_resp)
                break

            yield await SSEResponse.send_done()
        except GeneratorExit:
            logger.warning("短故事流式重新生成被提前关闭（SSE断开）")
            raise
        except Exception as e:
            logger.error(f"短故事流式重新生成失败: {str(e)}", exc_info=True)
            if db_session:
                try:
                    await db_session.rollback()
                except Exception:
                    pass
            yield await SSEResponse.send_error(str(e), 500)
            yield await SSEResponse.send_done()
        finally:
            if db_session:
                try:
                    await db_session.close()
                except Exception:
                    pass

    return create_sse_response(event_generator())


@router.post("/{story_id}/generate-segment-stream", summary="AI生成分段正文（SSE流式）")
async def generate_segment_stream(
    story_id: str,
    req: GenerateSegmentRequest,
    request: Request,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """流式生成指定段落正文。

    SSE事件流：
    - progress: {type, message, progress, status}
    - chunk: {type, content}
    - complete: {type, content}
    - error: {type, error}
    - done
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 预加载
    story_snapshot = None
    target_segment = None
    async for temp_db in get_db(request):
        try:
            result = await temp_db.execute(
                select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
            )
            story = result.scalar_one_or_none()
            if not story:
                raise HTTPException(status_code=404, detail="短故事不存在")
            try:
                segments = json.loads(story.segments) if story.segments else []
            except (json.JSONDecodeError, TypeError):
                segments = json.loads(_build_default_segments(story.target_words or 12000))
            for seg in segments:
                if seg.get("stage") == req.segment_stage:
                    target_segment = seg
                    break
            if not target_segment:
                raise HTTPException(status_code=400, detail=f"未找到段落: {req.segment_stage}")
            story_snapshot = {
                "title": story.title,
                "logline": story.logline,
                "emotion_goal": story.emotion_goal,
                "twist_content": story.twist_content,
                "twist_type": story.twist_type,
                "twist_clues": story.twist_clues,
                "characters": story.characters,
                "target_platform": story.target_platform,
                "target_words": story.target_words,
                "emotion_curve": story.emotion_curve or "",
                "content": story.content or "",
            }
        finally:
            await temp_db.close()
        break

    logger.info(f"开始AI流式生成分段: story_id={story_id}, stage={req.segment_stage}")

    async def event_generator():
        try:
            content = None
            async for event in ShortStoryAIService.generate_segment_content_stream(
                ai_service=ai_service,
                story_data=story_snapshot,
                segment=target_segment,
                existing_content=story_snapshot["content"],
                emotion_curve=story_snapshot["emotion_curve"],
            ):
                evt_type = event.get("type")
                if evt_type == "complete":
                    content = event.get("content")
                    yield await SSEResponse.send_progress("段落生成完成", 100, "success")
                elif evt_type == "error":
                    yield await SSEResponse.send_error(event.get("error", "生成失败"), 500)
                    yield await SSEResponse.send_done()
                    return
                else:
                    yield SSEResponse.format_sse(event)

            if content is None:
                content = ""
            yield await SSEResponse.send_result({"content": content})
            yield await SSEResponse.send_done()
        except GeneratorExit:
            logger.warning("短故事分段流式生成被提前关闭（SSE断开）")
            raise
        except Exception as e:
            logger.error(f"短故事分段流式生成失败: {str(e)}", exc_info=True)
            yield await SSEResponse.send_error(str(e), 500)
            yield await SSEResponse.send_done()

    return create_sse_response(event_generator())


@router.post("/{story_id}/polish-stream", summary="AI精修润色正文（SSE流式）")
async def polish_story_stream(
    story_id: str,
    request: Request,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """流式精修润色正文，返回对比预览数据（不直接写DB，需用户确认）。

    SSE事件流：
    - progress/chunk: 同上
    - complete: {type, content}（精修后完整正文）
    - result: {type, data:{original_content, new_content, original_words, new_words, revision_type:"polish"}}
    - error/done
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 预加载
    story_snapshot = None
    async for temp_db in get_db(request):
        try:
            result = await temp_db.execute(
                select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
            )
            story = result.scalar_one_or_none()
            if not story:
                raise HTTPException(status_code=404, detail="短故事不存在")
            if not story.content:
                raise HTTPException(status_code=400, detail="正文为空，无法精修")
            story_snapshot = {
                "title": story.title or "",
                "emotion_goal": story.emotion_goal or "",
                "twist_content": story.twist_content or "",
                "content": story.content,
                "emotion_curve": story.emotion_curve or "",
                "current_words": story.current_words or _count_chinese_and_punctuation(story.content),
            }
        finally:
            await temp_db.close()
        break

    logger.info(f"开始AI流式精修: story_id={story_id}")

    async def event_generator():
        try:
            polished = None
            async for event in ShortStoryAIService.polish_content_stream(
                ai_service=ai_service,
                title=story_snapshot["title"],
                emotion_goal=story_snapshot["emotion_goal"],
                twist_content=story_snapshot["twist_content"],
                content=story_snapshot["content"],
                emotion_curve=story_snapshot["emotion_curve"],
            ):
                evt_type = event.get("type")
                if evt_type == "complete":
                    polished = event.get("content")
                    yield await SSEResponse.send_progress("精修完成，正在生成对比预览...", 95, "processing")
                elif evt_type == "error":
                    yield await SSEResponse.send_error(event.get("error", "精修失败"), 500)
                    yield await SSEResponse.send_done()
                    return
                else:
                    yield SSEResponse.format_sse(event)

            if not polished or len(polished.strip()) < 50:
                yield await SSEResponse.send_error("AI精修结果为空或过短，原文未改动", 500)
                yield await SSEResponse.send_done()
                return

            polished_words = _count_chinese_and_punctuation(polished)
            preview = {
                "original_content": story_snapshot["content"],
                "new_content": polished,
                "original_words": story_snapshot["current_words"],
                "new_words": polished_words,
                "revision_type": "polish",
            }
            logger.info(f"AI流式精修预览生成: story_id={story_id}, {story_snapshot['current_words']}字→{polished_words}字")
            yield await SSEResponse.send_result(preview)
            yield await SSEResponse.send_done()
        except GeneratorExit:
            logger.warning("短故事精修流式被提前关闭（SSE断开）")
            raise
        except Exception as e:
            logger.error(f"短故事精修流式失败: {str(e)}", exc_info=True)
            yield await SSEResponse.send_error(str(e), 500)
            yield await SSEResponse.send_done()

    return create_sse_response(event_generator())


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
                emotion_curve=story.emotion_curve or "",
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
                emotion_curve=story.emotion_curve or "",
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

        # 不直接写入DB，返回对比数据供用户预览确认
        improved_words = _count_chinese_and_punctuation(improved_content)
        logger.info(
            f"AI基于评分改进预览生成: story_id={story_id}, "
            f"{original_words}字→{improved_words}字（待用户确认）"
        )

        return {
            "original_content": original_content,
            "new_content": improved_content,
            "original_words": original_words,
            "new_words": improved_words,
            "revision_type": "improve",
            "score_total": score_data.get("total_score"),
            "score_level": score_data.get("level"),
            "top_issues": (score_data.get("top_issues") or [])[:3],
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"AI基于评分改进失败: story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"改进失败: {str(e)}")


@router.post("/{story_id}/improve-from-score-stream", summary="基于AI评分改进正文（SSE流式）")
async def improve_from_score_stream(
    story_id: str,
    request: Request,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """流式基于评分改进正文，返回对比预览数据（不直接写DB，需用户确认）。

    与 improve-from-score 功能一致，但采用 SSE 流式输出 + 心跳保活，
    解决长文本改进（数分钟）期间连接超时断开的问题。

    SSE事件流：
    - progress/chunk/heartbeat: 同 polish-stream
    - complete: {type, content}（改进后完整正文）
    - result: {type, data:{original_content, new_content, original_words, new_words, revision_type:"improve", score_total, score_level, top_issues}}
    - error/done
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 预加载
    story_snapshot = None
    async for temp_db in get_db(request):
        try:
            result = await temp_db.execute(
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

            original_words = story.current_words or _count_chinese_and_punctuation(story.content)
            story_snapshot = {
                "title": story.title or "",
                "content": story.content,
                "score_data": score_data,
                "emotion_goal": story.emotion_goal or "",
                "logline": story.logline or "",
                "twist_type": story.twist_type or "",
                "twist_content": story.twist_content or "",
                "genre": story.genre or "",
                "target_words": story.target_words or 12000,
                "emotion_curve": story.emotion_curve or "",
                "original_words": original_words,
            }
        finally:
            await temp_db.close()
        break

    logger.info(
        f"开始AI流式基于评分改进: story_id={story_id}, original_words={story_snapshot['original_words']}, "
        f"old_score={story_snapshot['score_data'].get('total_score')}/100"
    )

    async def event_generator():
        try:
            improved = None
            async for event in ShortStoryAIService.improve_from_score_stream(
                ai_service=ai_service,
                title=story_snapshot["title"],
                content=story_snapshot["content"],
                score_data=story_snapshot["score_data"],
                emotion_goal=story_snapshot["emotion_goal"],
                logline=story_snapshot["logline"],
                twist_type=story_snapshot["twist_type"],
                twist_content=story_snapshot["twist_content"],
                genre=story_snapshot["genre"],
                target_words=story_snapshot["target_words"],
                emotion_curve=story_snapshot["emotion_curve"],
            ):
                evt_type = event.get("type")
                if evt_type == "complete":
                    improved = event.get("content")
                    yield await SSEResponse.send_progress("改进完成，正在生成对比预览...", 95, "processing")
                elif evt_type == "error":
                    yield await SSEResponse.send_error(event.get("error", "改进失败"), 500)
                    yield await SSEResponse.send_done()
                    return
                elif evt_type == "heartbeat":
                    yield HEARTBEAT
                else:
                    yield SSEResponse.format_sse(event)

            if not improved or len(improved.strip()) < 100:
                yield await SSEResponse.send_error("AI改进结果为空或过短，原文未改动", 500)
                yield await SSEResponse.send_done()
                return

            improved_words = _count_chinese_and_punctuation(improved)
            sd = story_snapshot["score_data"]
            preview = {
                "original_content": story_snapshot["content"],
                "new_content": improved,
                "original_words": story_snapshot["original_words"],
                "new_words": improved_words,
                "revision_type": "improve",
                "score_total": sd.get("total_score"),
                "score_level": sd.get("level"),
                "top_issues": (sd.get("top_issues") or [])[:3],
            }
            logger.info(
                f"AI流式基于评分改进预览生成: story_id={story_id}, "
                f"{story_snapshot['original_words']}字→{improved_words}字（待用户确认）"
            )
            yield await SSEResponse.send_result(preview)
            yield await SSEResponse.send_done()
        except GeneratorExit:
            logger.warning("短故事改进流式被提前关闭（SSE断开）")
            raise
        except Exception as e:
            logger.error(f"短故事改进流式失败: {str(e)}", exc_info=True)
            yield await SSEResponse.send_error(str(e), 500)
            yield await SSEResponse.send_done()

    return create_sse_response(event_generator())


@router.post("/{story_id}/auto-check", summary="AI自动检查自查清单")
async def auto_check_checklist(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    """AI逐项检查自查清单，自动标记每项是否通过，并给出检查依据"""
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
            raise HTTPException(status_code=400, detail="正文为空，无法检查")

        # 解析当前自查清单
        try:
            checklist = json.loads(story.polish_checklist) if story.polish_checklist else []
        except (json.JSONDecodeError, TypeError):
            checklist = json.loads(_build_default_polish_checklist())

        if not checklist:
            raise HTTPException(status_code=400, detail="自查清单为空")

        logger.info(f"开始AI自动检查自查清单: story_id={story_id}, items={len(checklist)}")

        try:
            check_results = await ChecklistChecker.check_checklist(
                ai_service=ai_service,
                content=story.content,
                checklist=checklist,
                emotion_goal=story.emotion_goal or "",
                emotion_curve=story.emotion_curve or "",
            )
        except Exception as ai_err:
            logger.error(
                f"AI自动检查调用失败: story_id={story_id}, error={str(ai_err)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=f"AI自动检查失败: {str(ai_err)}")

        # 将AI检查结果合并回自查清单
        result_map = {r.get("id"): r for r in check_results if r.get("id")}
        for item in checklist:
            ai_result = result_map.get(item.get("id"))
            if ai_result:
                item["checked"] = ai_result.get("checked", False)
                item["evidence"] = ai_result.get("evidence", "")

        # 保存更新后的清单
        story.polish_checklist = json.dumps(checklist, ensure_ascii=False)
        await db.commit()

        logger.info(
            f"AI自动检查完成: story_id={story_id}, "
            f"passed={sum(1 for i in checklist if i.get('checked'))}/{len(checklist)}"
        )

        return {"checklist": checklist}
    except HTTPException:
        raise
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"AI自动检查失败(已回滚): story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"检查失败: {str(e)}")


class ConfirmRevisionRequest(BaseModel):
    """确认AI修改请求"""
    new_content: str
    revision_type: str  # polish | improve
    # improve类型需要这些（用于清空评分、记录历史）
    original_words: int | None = None
    score_total: int | None = None
    score_level: str | None = None
    top_issues: list[str] | None = None


@router.post("/{story_id}/confirm-revision", summary="确认AI修改正文（用户预览对比后确认）")
async def confirm_revision(
    story_id: str,
    req: ConfirmRevisionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """用户预览AI修改对比后确认保存。

    流程：
    1. AI生成修改预览（polish/improve端点不再直接写入DB）
    2. 前端展示原文vs修改后对比Modal
    3. 用户确认后调用本端点写入DB
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

        if not req.new_content or len(req.new_content.strip()) < 50:
            raise HTTPException(status_code=400, detail="修改内容为空或过短")

        original_content = story.content or ""
        original_words = req.original_words or story.current_words or _count_chinese_and_punctuation(original_content)
        new_words = _count_chinese_and_punctuation(req.new_content)

        # 更新正文
        story.content = req.new_content
        story.current_words = new_words
        story.segments, _ = _recalc_segments_from_content(
            req.new_content, story.target_words or 12000, story.segments
        )
        story.status = "polishing"

        # 记录修改历史到 polish_notes
        if req.revision_type == "improve":
            # 改进类型：清空旧评分，提示重新评分
            story.score_data = None
            story.scored_at = None
            improve_record = (
                f"\n---\n[AI基于评分改进] 原文 {original_words}字 → 改进后 {new_words}字\n"
                f"改进依据：总分 {req.score_total or '?'}/100（{req.score_level or '?'}）\n"
                f"重点解决：{'; '.join(req.top_issues or []) or '无'}\n"
                f"请重新评分验证改进效果。"
            )
        else:
            improve_record = (
                f"\n---\n[AI精修润色] 原文 {original_words}字 → 精修后 {new_words}字\n"
            )
        story.polish_notes = (story.polish_notes or "") + improve_record

        await db.commit()
        await db.refresh(story)

        logger.info(
            f"用户确认AI修改({req.revision_type})成功: story_id={story_id}, "
            f"{original_words}字→{new_words}字"
        )

        return {
            "content": story.content,
            "current_words": story.current_words,
            "original_words": original_words,
            "message": "已确认保存" + ("，请重新评分验证" if req.revision_type == "improve" else ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.error(f"确认AI修改失败(已回滚): story_id={story_id}, error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"确认失败: {str(e)}")


# ============ 后台任务端点（复用长篇小说 BackgroundTask 机制） ============
# 说明：BackgroundTask.project_id 无外键约束，本质是 scope id 字符串。
# 短故事后台任务用 story_id 作为 project_id，前端 FloatingTaskPanel 传 storyId 即可复用。
# 任务类型：short_story_regenerate / short_story_score / short_story_polish

@router.post("/{story_id}/regenerate-background", summary="AI后台重新生成短故事正文")
async def regenerate_story_background(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """后台重新生成短故事正文（关闭浏览器不影响生成，完成后自动保存）。

    返回 task_id，前端通过 GET /api/tasks/{task_id} 轮询进度，
    或在 FloatingTaskPanel 中查看进度。
    """
    from app.services.background_task_service import background_task_service, TaskProgressTracker

    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 校验故事存在
    result = await db.execute(
        select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
    )
    story = result.scalar_one_or_none()
    if not story:
        raise HTTPException(status_code=404, detail="短故事不存在")

    logger.info(f"创建短故事后台重写任务: story_id={story_id}, user_id={user_id}")

    # 创建后台任务记录（project_id=story_id，前端按 story_id 过滤）
    task = await background_task_service.create_task(
        user_id=user_id,
        project_id=story_id,
        task_type="short_story_regenerate",
        task_input={"story_id": story_id},
        db=db,
    )

    # 后台执行的函数
    async def _run_regenerate(task_id: str, bg_user_id: str):
        from app.database import get_engine
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession as BgAsyncSession

        engine = await get_engine(bg_user_id)
        AsyncSessionLocal = async_sessionmaker(engine, class_=BgAsyncSession, expire_on_commit=False)

        async with AsyncSessionLocal() as bg_db:
            tracker = TaskProgressTracker(task_id, bg_user_id, "短故事")
            try:
                await tracker.start("开始重新生成短故事...")

                # 获取AI服务
                from app.api.settings import get_user_ai_service_from_db
                bg_ai_service = await get_user_ai_service_from_db(bg_user_id, bg_db)

                # 重新加载故事
                bg_result = await bg_db.execute(
                    select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == bg_user_id)
                )
                bg_story = bg_result.scalar_one_or_none()
                if not bg_story:
                    await tracker.error("短故事不存在")
                    return

                await tracker.loading("准备AI提示词...", 0.5)

                # 调用生成器
                story_data = await FullStoryGenerator.generate_full_story(
                    ai_service=bg_ai_service,
                    initial_idea=bg_story.logline or bg_story.title or "",
                    target_words=bg_story.target_words or 12000,
                    emotion_goal=bg_story.emotion_goal or "",
                    target_platform=bg_story.target_platform or "知乎盐言",
                    emotion_curve=bg_story.emotion_curve or "",
                )

                await tracker.generating(current_chars=0, estimated_total=bg_story.target_words or 12000, message="AI生成完成，正在保存...")

                if not story_data or not story_data.get("content"):
                    await tracker.error("AI生成结果不完整")
                    return

                # 更新故事记录
                bg_story.title = story_data.get("title", bg_story.title)
                bg_story.logline = story_data.get("logline", bg_story.logline)
                bg_story.emotion_goal = story_data.get("emotion_goal", bg_story.emotion_goal)
                bg_story.twist_type = story_data.get("twist_type", bg_story.twist_type)
                bg_story.twist_content = story_data.get("twist_content", bg_story.twist_content)
                bg_story.twist_clues = json.dumps(story_data.get("twist_clues", []), ensure_ascii=False)
                bg_story.genre = story_data.get("genre", bg_story.genre)
                bg_story.content = story_data.get("content", "")
                bg_story.current_words = _count_chinese_and_punctuation(bg_story.content)
                bg_story.segments, _ = _recalc_segments_from_content(
                    bg_story.content, bg_story.target_words or 12000, bg_story.segments
                )
                # 重新生成后清空旧评分
                bg_story.score_data = None
                bg_story.scored_at = None
                await bg_db.commit()

                await tracker.complete("短故事重新生成完成")
                logger.info(f"短故事后台重写成功: story_id={story_id}, words={bg_story.current_words}")

            except Exception as e:
                logger.error(f"❌ 短故事后台重写失败: {e}", exc_info=True)
                await tracker.error(str(e))

    await background_task_service.spawn_background_task(
        task.id, user_id, _run_regenerate
    )

    return {
        "task_id": task.id,
        "task_type": "short_story_regenerate",
        "status": "pending",
        "message": "任务已创建，请通过 GET /api/tasks/{task_id} 查询进度"
    }


@router.post("/{story_id}/score-background", summary="AI后台评分短故事（5维评分）")
async def score_story_background(
    story_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """后台AI评分短故事（关闭浏览器不影响评分，完成后自动保存）。

    返回 task_id，前端通过 GET /api/tasks/{task_id} 轮询进度，
    或在 FloatingTaskPanel 中查看进度。
    """
    from app.services.background_task_service import background_task_service, TaskProgressTracker

    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 校验故事存在
    result = await db.execute(
        select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == user_id)
    )
    story = result.scalar_one_or_none()
    if not story:
        raise HTTPException(status_code=404, detail="短故事不存在")

    if not story.content:
        raise HTTPException(status_code=400, detail="正文为空，无法评分")

    logger.info(f"创建短故事后台评分任务: story_id={story_id}, user_id={user_id}")

    # 创建后台任务记录
    task = await background_task_service.create_task(
        user_id=user_id,
        project_id=story_id,
        task_type="short_story_score",
        task_input={"story_id": story_id},
        db=db,
    )

    # 后台执行的函数
    async def _run_score(task_id: str, bg_user_id: str):
        from app.database import get_engine
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession as BgAsyncSession

        engine = await get_engine(bg_user_id)
        AsyncSessionLocal = async_sessionmaker(engine, class_=BgAsyncSession, expire_on_commit=False)

        async with AsyncSessionLocal() as bg_db:
            tracker = TaskProgressTracker(task_id, bg_user_id, "评分")
            try:
                await tracker.start("开始AI评分...")

                # 获取AI服务
                from app.api.settings import get_user_ai_service_from_db
                bg_ai_service = await get_user_ai_service_from_db(bg_user_id, bg_db)

                # 重新加载故事
                bg_result = await bg_db.execute(
                    select(ShortStory).where(ShortStory.id == story_id, ShortStory.user_id == bg_user_id)
                )
                bg_story = bg_result.scalar_one_or_none()
                if not bg_story:
                    await tracker.error("短故事不存在")
                    return

                await tracker.loading("AI正在分析选题维度...", 0.5)

                # 调用评分器
                score_result = await StoryScorer.score_story(
                    ai_service=bg_ai_service,
                    title=bg_story.title or "",
                    content=bg_story.content,
                    emotion_goal=bg_story.emotion_goal or "",
                    logline=bg_story.logline or "",
                    twist_type=bg_story.twist_type or "",
                    twist_content=bg_story.twist_content or "",
                    genre=bg_story.genre or "",
                    target_words=bg_story.target_words or 12000,
                    emotion_curve=bg_story.emotion_curve or "",
                )

                await tracker.generating(current_chars=100, estimated_total=100, message="正在保存评分结果...")

                # 保存评分
                bg_story.score_data = json.dumps(score_result, ensure_ascii=False)
                bg_story.scored_at = datetime.now()
                await bg_db.commit()

                await tracker.complete("AI评分完成")
                logger.info(
                    f"短故事后台评分成功: story_id={story_id}, "
                    f"total_score={score_result.get('total_score')}, level={score_result.get('level')}"
                )

            except Exception as e:
                logger.error(f"❌ 短故事后台评分失败: {e}", exc_info=True)
                await tracker.error(str(e))

    await background_task_service.spawn_background_task(
        task.id, user_id, _run_score
    )

    return {
        "task_id": task.id,
        "task_type": "short_story_score",
        "status": "pending",
        "message": "任务已创建，请通过 GET /api/tasks/{task_id} 查询进度"
    }
