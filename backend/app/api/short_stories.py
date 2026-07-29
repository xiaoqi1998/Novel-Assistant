"""短故事管理API"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
import json
import re

from app.database import get_db
from app.models.short_story import ShortStory
from app.schemas.short_story import (
    ShortStoryCreate,
    ShortStoryUpdate,
    ShortStoryResponse,
    ShortStoryListResponse
)
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
    """根据正文内容重新计算分段字数和状态"""
    total_words = _count_chinese_and_punctuation(content)
    if not existing_segments:
        existing_segments = _build_default_segments(target_words)

    try:
        segments = json.loads(existing_segments)
    except (json.JSONDecodeError, TypeError):
        segments = json.loads(_build_default_segments(target_words))

    # 根据总字数比例分配实际字数到各段（简单均分比例）
    for seg in segments:
        seg["target_words"] = int(target_words * seg["target_ratio"])
        # 这里简化处理：实际字数由前端在保存时更新
        # 后端只计算总字数

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
        return {"message": "删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除短故事失败: {str(e)}", exc_info=True)
        raise
