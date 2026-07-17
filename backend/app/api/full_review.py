"""全文审查修改 API

提供全文审查功能，支持单章/多章/全书审查。
采用两步式流程：
1. 审查阶段：AI输出详细修改建议报告（SSE流式）
2. 修改阶段：用户确认后，AI根据报告执行修改并覆盖原文
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_db
from app.user_manager import User
from app.api.settings import require_login, get_user_ai_service
from app.models.chapter import Chapter
from app.models.generation_history import GenerationHistory
from app.services.skill_loader import get_all_skills_cached
from app.services.ai_service import AIService
from app.utils.sse_response import SSEResponse, create_sse_response, wrap_stream_with_heartbeat, HEARTBEAT
from app.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/api/full-review", tags=["全文审查"])

# story-full-review Skill 的 template_key
REVIEW_SKILL_KEY = "SKILL_STORY_FULL_REVIEW"

# 分块阈值：100KB
BLOCK_THRESHOLD = 100_000
MAX_BLOCK_SIZE = 80_000


class ReviewStartRequest(BaseModel):
    """审查启动请求"""
    project_id: str
    chapter_ids: List[str] = []  # 空列表表示全书
    review_scope: str = "single"  # single | multi | all


class ReviewApplyRequest(BaseModel):
    """执行修改请求"""
    project_id: str
    chapter_ids: List[str] = []
    review_report: str  # 审查报告内容


class ReviewConfirmRequest(BaseModel):
    """确认覆盖请求"""
    chapter_id: str
    modified_content: str
    project_id: str


def _get_skill_content() -> Optional[str]:
    """获取 story-full-review Skill 内容"""
    try:
        skills = get_all_skills_cached()
        for s in skills:
            if s["template_key"] == REVIEW_SKILL_KEY:
                return s["content"]
        logger.warning(f"未找到 Skill: {REVIEW_SKILL_KEY}")
        return None
    except Exception as e:
        logger.error(f"加载 Skill 失败: {e}")
        return None


def _split_into_blocks(chapters: List[Chapter], max_size: int = MAX_BLOCK_SIZE) -> List[List[Chapter]]:
    """将章节列表分块，每块不超过 max_size 字节"""
    blocks = []
    current_block = []
    current_size = 0

    for ch in chapters:
        ch_size = len((ch.content or "").encode("utf-8"))
        # 如果单个章节就超过 max_size，单独成块
        if ch_size > max_size:
            if current_block:
                blocks.append(current_block)
                current_block = []
                current_size = 0
            blocks.append([ch])
            continue

        if current_size + ch_size > max_size:
            blocks.append(current_block)
            current_block = [ch]
            current_size = ch_size
        else:
            current_block.append(ch)
            current_size += ch_size

    if current_block:
        blocks.append(current_block)

    return blocks


def _build_review_prompt(chapters: List[Chapter]) -> str:
    """构建审查提示词"""
    parts = []
    for ch in chapters:
        parts.append(f"## 第{ch.chapter_number}章：{ch.title}\n\n{ch.content or ''}")
    return "\n\n---\n\n".join(parts)


@router.post("/start")
async def start_review(
    request: ReviewStartRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """
    启动全文审查（SSE流式）

    根据选择的章节范围，使用 story-full-review Skill 进行审查，
    输出详细的修改建议报告。
    """
    # 获取 Skill 内容
    skill_content = _get_skill_content()
    if not skill_content:
        async def error_gen():
            yield await SSEResponse.send_error("未找到全文审查 Skill，请检查 Skill 配置")
        return create_sse_response(error_gen())

    # 加载章节
    if request.review_scope == "all" or not request.chapter_ids:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == request.project_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = list(result.scalars().all())
    else:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == request.project_id)
            .where(Chapter.id.in_(request.chapter_ids))
            .order_by(Chapter.chapter_number)
        )
        chapters = list(result.scalars().all())

    if not chapters:
        async def error_gen():
            yield await SSEResponse.send_error("未找到可审查的章节")
        return create_sse_response(error_gen())

    # 获取用户 AI 服务
    try:
        ai_service = await get_user_ai_service(user=user, db=db)
        ai_service.default_system_prompt = skill_content
    except Exception as e:
        logger.error(f"创建 AI 服务失败: {e}")
        async def error_gen():
            yield await SSEResponse.send_error(f"AI 服务配置错误: {str(e)}")
        return create_sse_response(error_gen())

    # 构建完整文本
    total_text = _build_review_prompt(chapters)
    total_size = len(total_text.encode("utf-8"))

    logger.info(f"开始全文审查: {len(chapters)}章, {total_size}字节, scope={request.review_scope}")

    async def generate():
        try:
            yield await SSEResponse.send_progress(
                f"正在审查 {len(chapters)} 个章节...", 5
            )

            # 判断是否需要分块
            if total_size > BLOCK_THRESHOLD:
                blocks = _split_into_blocks(chapters)
                logger.info(f"文本超过 {BLOCK_THRESHOLD} 字节，分 {len(blocks)} 块审查")

                for i, block in enumerate(blocks):
                    block_text = _build_review_prompt(block)
                    block_title = f"第{block[0].chapter_number}-{block[-1].chapter_number}章"

                    yield await SSEResponse.send_progress(
                        f"正在审查第 {i+1}/{len(blocks)} 块（{block_title}）...",
                        int(5 + (85 * i / len(blocks)))
                    )

                    # 构建分块审查提示
                    chunk_prompt = f"""请审查以下章节内容（第{i+1}块/共{len(blocks)}块）：

{block_text}

请按照审查流程执行：
1. 全局扫描
2. 专项审查（Gate A-G）
3. 输出问题清单和修改建议

请输出详细的审查报告。"""

                    try:
                        stream = ai_service.generate_text_stream(
                            prompt=chunk_prompt,
                            system_prompt=skill_content,
                            auto_mcp=False,
                        )
                        async for item in wrap_stream_with_heartbeat(stream, heartbeat_interval=15.0):
                            if item is HEARTBEAT:
                                yield await SSEResponse.send_heartbeat()
                                continue
                            yield await SSEResponse.send_chunk(item)
                    except Exception as e:
                        logger.error(f"第{i+1}块审查失败: {e}")
                        yield await SSEResponse.send_chunk(
                            f"\n\n---\n\n⚠️ 第{i+1}块审查失败: {str(e)}\n\n"
                        )

                # 跨块一致性审查
                yield await SSEResponse.send_progress("正在执行跨块一致性审查...", 90)
                cross_prompt = """基于以上分块审查结果，请执行跨块一致性审查：

1. 检查人物设定是否一致（跨块）
2. 检查情节逻辑是否连贯（跨块）
3. 检查伏笔追踪是否完整（跨块）
4. 检查世界观设定是否统一（跨块）

请输出跨块一致性审查报告。"""

                try:
                    stream = ai_service.generate_text_stream(
                        prompt=cross_prompt,
                        system_prompt=skill_content,
                        auto_mcp=False,
                    )
                    async for item in wrap_stream_with_heartbeat(stream, heartbeat_interval=15.0):
                        if item is HEARTBEAT:
                            yield await SSEResponse.send_heartbeat()
                            continue
                        yield await SSEResponse.send_chunk(item)
                except Exception as e:
                    logger.error(f"跨块审查失败: {e}")
                    yield await SSEResponse.send_chunk(
                        f"\n\n---\n\n⚠️ 跨块一致性审查失败: {str(e)}\n\n"
                    )

            else:
                # 整体处理
                yield await SSEResponse.send_progress("正在执行全文审查...", 10)

                review_prompt = f"""请审查以下章节内容：

{total_text}

请按照审查流程执行：
1. Phase 1：全局扫描
2. Phase 2：专项审查（Gate A-G：情节逻辑、人物一致性、叙事视角、伏笔回收、节奏把控、文风统一、语病用词）
3. Phase 3：修改方案

请输出详细的审查报告，包含问题清单和修改建议。"""

                stream = ai_service.generate_text_stream(
                    prompt=review_prompt,
                    system_prompt=skill_content,
                    auto_mcp=False,
                )
                async for item in wrap_stream_with_heartbeat(stream, heartbeat_interval=15.0):
                    if item is HEARTBEAT:
                        yield await SSEResponse.send_heartbeat()
                        continue
                    yield await SSEResponse.send_chunk(item)

            yield await SSEResponse.send_progress("审查完成", 100, "success")
            yield await SSEResponse.send_done()

        except Exception as e:
            logger.error(f"全文审查失败: {e}")
            yield await SSEResponse.send_error(f"审查失败: {str(e)}")

    return create_sse_response(generate())


@router.post("/apply")
async def apply_modifications(
    request: ReviewApplyRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """
    根据审查报告执行AI修改（SSE流式）

    用户确认审查报告后，AI根据报告内容对原文进行修改，
    输出修改后的文本。
    """
    skill_content = _get_skill_content()
    if not skill_content:
        async def error_gen():
            yield await SSEResponse.send_error("未找到全文审查 Skill")
        return create_sse_response(error_gen())

    # 加载章节
    if not request.chapter_ids:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == request.project_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = list(result.scalars().all())
    else:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == request.project_id)
            .where(Chapter.id.in_(request.chapter_ids))
            .order_by(Chapter.chapter_number)
        )
        chapters = list(result.scalars().all())

    if not chapters:
        async def error_gen():
            yield await SSEResponse.send_error("未找到可修改的章节")
        return create_sse_response(error_gen())

    # 获取用户 AI 服务
    try:
        ai_service = await get_user_ai_service(user=user, db=db)
        ai_service.default_system_prompt = skill_content
    except Exception as e:
        logger.error(f"创建 AI 服务失败: {e}")
        async def error_gen():
            yield await SSEResponse.send_error(f"AI 服务配置错误: {str(e)}")
        return create_sse_response(error_gen())

    async def generate():
        try:
            yield await SSEResponse.send_progress(
                f"正在修改 {len(chapters)} 个章节...", 5
            )

            for idx, ch in enumerate(chapters):
                progress = int(5 + (85 * idx / len(chapters)))
                yield await SSEResponse.send_progress(
                    f"正在修改第{ch.chapter_number}章《{ch.title}》...（{idx+1}/{len(chapters)}）",
                    progress
                )

                modify_prompt = f"""基于以下审查报告，对章节内容进行修改。

## 审查报告
{request.review_report}

## 待修改章节：第{ch.chapter_number}章《{ch.title}》

{ch.content or ''}

## 修改要求
1. 严格按照审查报告中的修改建议执行
2. 遵循最小修改原则：能改一个词就不改一句
3. 保留作者意图，只改"怎么写"，不改"写什么"
4. 输出完整的修改后章节内容（包含标题）

请直接输出修改后的完整章节内容，不要添加额外说明。"""

                try:
                    stream = ai_service.generate_text_stream(
                        prompt=modify_prompt,
                        system_prompt=skill_content,
                        auto_mcp=False,
                    )

                    # 添加章节分隔标记（用于前端区分不同章节）
                    yield await SSEResponse.send_chunk(
                        f"\n\n===CHAPTER_START:{ch.id}===\n"
                    )

                    async for item in wrap_stream_with_heartbeat(stream, heartbeat_interval=15.0):
                        if item is HEARTBEAT:
                            yield await SSEResponse.send_heartbeat()
                            continue
                        yield await SSEResponse.send_chunk(item)

                    yield await SSEResponse.send_chunk(
                        f"\n===CHAPTER_END:{ch.id}===\n"
                    )

                except Exception as e:
                    logger.error(f"第{ch.chapter_number}章修改失败: {e}")
                    yield await SSEResponse.send_chunk(
                        f"\n\n⚠️ 第{ch.chapter_number}章修改失败: {str(e)}\n\n"
                    )

            yield await SSEResponse.send_progress("修改完成", 100, "success")
            yield await SSEResponse.send_done()

        except Exception as e:
            logger.error(f"AI修改失败: {e}")
            yield await SSEResponse.send_error(f"修改失败: {str(e)}")

    return create_sse_response(generate())


@router.post("/confirm")
async def confirm_overwrite(
    request: ReviewConfirmRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    """
    确认覆盖原章节内容

    在覆盖前自动备份原文到 generation_history 表。
    """
    try:
        # 加载原章节
        result = await db.execute(
            select(Chapter).where(Chapter.id == request.chapter_id)
        )
        chapter = result.scalar_one_or_none()

        if not chapter:
            raise HTTPException(status_code=404, detail="章节不存在")

        # 备份原文
        backup = GenerationHistory(
            project_id=request.project_id,
            chapter_id=chapter.id,
            prompt=f"全文审查修改备份 - 原文: {chapter.title}",
            generated_content=chapter.content,
            model="full-review-backup",
        )
        db.add(backup)

        # 更新章节内容
        chapter.content = request.modified_content
        chapter.word_count = len(request.modified_content)

        await db.commit()

        logger.info(f"章节 {chapter.id} 已更新，备份ID: {backup.id}")

        return {
            "success": True,
            "backup_id": backup.id,
            "message": "章节已更新，原文已备份"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"覆盖章节失败: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"覆盖失败: {str(e)}")
