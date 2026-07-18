"""全文审查修改 API

提供全文审查功能，支持单章/多章/全书审查。
采用两步式流程：
1. 审查阶段：AI输出详细修改建议报告（SSE流式）
2. 修改阶段：用户确认后，AI根据报告执行修改并覆盖原文
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, field_validator
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

    @field_validator("chapter_ids", mode="before")
    @classmethod
    def _coerce_chapter_ids(cls, v):
        # 兼容客户端误传单个字符串的情况：自动包装为单元素列表
        if v is None:
            return []
        if isinstance(v, str):
            return [v]
        return v


class ReviewApplyRequest(BaseModel):
    """执行修改请求"""
    project_id: str
    chapter_ids: List[str] = []
    review_report: str  # 审查报告内容

    @field_validator("chapter_ids", mode="before")
    @classmethod
    def _coerce_chapter_ids(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            return [v]
        return v


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


# ==================== 后台任务版本（支持关闭页面后继续运行 + 报告持久化）====================

REVIEW_TASK_TYPE = "full_review"
# GenerationHistory.model 字段标记，用于区分审查报告
REVIEW_REPORT_MODEL = "full-review-report"


@router.post("/start-background", summary="启动全文审查（后台任务）")
async def start_review_background(
    request: Request,
    body: ReviewStartRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    启动全文审查为后台任务。

    - 任务创建后立即返回 task_id，前端通过 GET /api/tasks/{task_id} 轮询进度
    - 关闭浏览器不影响审查，审查报告自动保存到 generation_history 表
    - 完成后 task_result 返回 {report_id, scope, chapter_count, total_chars, message}
    - 通过 GET /api/full-review/report/{report_id} 获取完整报告内容
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    # 校验 Skill 存在（提前失败，避免排队后才发现）
    skill_content = _get_skill_content()
    if not skill_content:
        raise HTTPException(status_code=500, detail="未找到全文审查 Skill，请检查 Skill 配置")

    # 预加载章节，用于校验和记录元信息
    if body.review_scope == "all" or not body.chapter_ids:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == body.project_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = list(result.scalars().all())
    else:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == body.project_id)
            .where(Chapter.id.in_(body.chapter_ids))
            .order_by(Chapter.chapter_number)
        )
        chapters = list(result.scalars().all())

    if not chapters:
        raise HTTPException(status_code=400, detail="未找到可审查的章节")

    from app.services.background_task_service import background_task_service
    task = await background_task_service.create_task(
        user_id=user_id,
        project_id=body.project_id,
        task_type=REVIEW_TASK_TYPE,
        task_input={
            "project_id": body.project_id,
            "chapter_ids": body.chapter_ids,
            "review_scope": body.review_scope,
            "chapter_count": len(chapters),
        },
        db=db,
    )

    # 捕获请求参数（闭包不能直接依赖原 body，因为后台函数运行时 API 的 db/session 已关闭）
    project_id = body.project_id
    chapter_ids = list(body.chapter_ids)
    review_scope = body.review_scope

    async def _run_full_review(task_id: str, bg_user_id: str):
        from app.database import get_engine
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession as BgAsyncSession
        from app.services.background_task_service import TaskProgressTracker
        from app.api.settings import get_user_ai_service_from_db
        from app.models.background_task import BackgroundTask
        from sqlalchemy import update as sql_update
        import asyncio

        engine = await get_engine(bg_user_id)
        AsyncSessionLocal = async_sessionmaker(engine, class_=BgAsyncSession, expire_on_commit=False)

        async with AsyncSessionLocal() as bg_db:
            tracker = TaskProgressTracker(task_id, bg_user_id, "全文审查")
            try:
                await tracker.start()

                # 重新加载章节（后台 session）
                if review_scope == "all" or not chapter_ids:
                    res = await bg_db.execute(
                        select(Chapter)
                        .where(Chapter.project_id == project_id)
                        .order_by(Chapter.chapter_number)
                    )
                    bg_chapters = list(res.scalars().all())
                else:
                    res = await bg_db.execute(
                        select(Chapter)
                        .where(Chapter.project_id == project_id)
                        .where(Chapter.id.in_(chapter_ids))
                        .order_by(Chapter.chapter_number)
                    )
                    bg_chapters = list(res.scalars().all())

                if not bg_chapters:
                    await tracker.error("未找到可审查的章节")
                    return

                # 重新获取 Skill 内容（避免使用闭包里可能过期的引用）
                bg_skill_content = _get_skill_content()
                if not bg_skill_content:
                    await tracker.error("未找到全文审查 Skill")
                    return

                bg_ai_service = await get_user_ai_service_from_db(bg_user_id, bg_db)
                bg_ai_service.default_system_prompt = bg_skill_content

                total_text = _build_review_prompt(bg_chapters)
                total_size = len(total_text.encode("utf-8"))
                logger.info(f"开始后台全文审查: {len(bg_chapters)}章, {total_size}字节, task={task_id[:8]}")

                await tracker.preparing(f"正在准备审查 {len(bg_chapters)} 个章节...")

                accumulated_report = ""
                chunk_count = 0

                async def _drain_stream(stream, label: str = ""):
                    """消费一个流式生成器，累积到 accumulated_report，并处理取消/进度。"""
                    nonlocal accumulated_report, chunk_count
                    async for item in stream:
                        if chunk_count % 10 == 0 and await tracker.check_cancelled():
                            logger.info(f"🚫 后台全文审查被取消: {task_id[:8]}")
                            return False
                        accumulated_report += item
                        chunk_count += 1
                        if chunk_count % 10 == 0:
                            await tracker.generating(
                                current_chars=len(accumulated_report),
                                estimated_total=max(total_size * 3, 5000),  # 报告通常比原文短，估算放宽
                                message=f"正在审查中... 已生成 {len(accumulated_report)} 字"
                            )
                        await asyncio.sleep(0)
                    return True

                if total_size > BLOCK_THRESHOLD:
                    blocks = _split_into_blocks(bg_chapters)
                    logger.info(f"文本超过 {BLOCK_THRESHOLD} 字节，分 {len(blocks)} 块审查")
                    for i, block in enumerate(blocks):
                        if await tracker.check_cancelled():
                            return
                        block_text = _build_review_prompt(block)
                        block_title = f"第{block[0].chapter_number}-{block[-1].chapter_number}章"
                        await tracker.generating(
                            current_chars=len(accumulated_report),
                            estimated_total=max(total_size * 3, 5000),
                            message=f"正在审查第 {i+1}/{len(blocks)} 块（{block_title}）..."
                        )
                        chunk_prompt = f"""请审查以下章节内容（第{i+1}块/共{len(blocks)}块）：

{block_text}

请按照审查流程执行：
1. 全局扫描
2. 专项审查（Gate A-G）
3. 输出问题清单和修改建议

请输出详细的审查报告。"""
                        try:
                            stream = bg_ai_service.generate_text_stream(
                                prompt=chunk_prompt,
                                system_prompt=bg_skill_content,
                                auto_mcp=False,
                            )
                            ok = await _drain_stream(stream, f"第{i+1}块")
                            if not ok:
                                return
                        except Exception as e:
                            logger.error(f"第{i+1}块审查失败: {e}")
                            accumulated_report += f"\n\n---\n\n⚠️ 第{i+1}块审查失败: {str(e)}\n\n"

                    if await tracker.check_cancelled():
                        return
                    await tracker.generating(
                        current_chars=len(accumulated_report),
                        estimated_total=max(total_size * 3, 5000),
                        message="正在执行跨块一致性审查..."
                    )
                    cross_prompt = """基于以上分块审查结果，请执行跨块一致性审查：

1. 检查人物设定是否一致（跨块）
2. 检查情节逻辑是否连贯（跨块）
3. 检查伏笔追踪是否完整（跨块）
4. 检查世界观设定是否统一（跨块）

请输出跨块一致性审查报告。"""
                    try:
                        stream = bg_ai_service.generate_text_stream(
                            prompt=cross_prompt,
                            system_prompt=bg_skill_content,
                            auto_mcp=False,
                        )
                        ok = await _drain_stream(stream, "跨块一致性")
                        if not ok:
                            return
                    except Exception as e:
                        logger.error(f"跨块审查失败: {e}")
                        accumulated_report += f"\n\n---\n\n⚠️ 跨块一致性审查失败: {str(e)}\n\n"
                else:
                    if await tracker.check_cancelled():
                        return
                    await tracker.generating(
                        current_chars=0,
                        estimated_total=max(total_size * 3, 5000),
                        message="正在执行全文审查..."
                    )
                    review_prompt = f"""请审查以下章节内容：

{total_text}

请按照审查流程执行：
1. Phase 1：全局扫描
2. Phase 2：专项审查（Gate A-G：情节逻辑、人物一致性、叙事视角、伏笔回收、节奏把控、文风统一、语病用词）
3. Phase 3：修改方案

请输出详细的审查报告，包含问题清单和修改建议。"""
                    try:
                        stream = bg_ai_service.generate_text_stream(
                            prompt=review_prompt,
                            system_prompt=bg_skill_content,
                            auto_mcp=False,
                        )
                        ok = await _drain_stream(stream)
                        if not ok:
                            return
                    except Exception as e:
                        logger.error(f"全文审查流式生成失败: {e}")
                        await tracker.error(f"审查失败: {str(e)}")
                        return

                # === 保存阶段 ===
                if await tracker.check_cancelled():
                    return
                await tracker.saving("正在保存审查报告...", 0.3)

                report_record = GenerationHistory(
                    project_id=project_id,
                    chapter_id=None,
                    prompt=f"全文审查报告 - 范围:{review_scope} - {len(bg_chapters)}章",
                    generated_content=accumulated_report,
                    model=REVIEW_REPORT_MODEL,
                )
                bg_db.add(report_record)
                await bg_db.commit()
                await bg_db.refresh(report_record)

                # task_result 只存摘要
                try:
                    async with AsyncSessionLocal() as result_db:
                        await result_db.execute(
                            sql_update(BackgroundTask)
                            .where(BackgroundTask.id == task_id)
                            .values(task_result={
                                "report_id": report_record.id,
                                "scope": review_scope,
                                "chapter_count": len(bg_chapters),
                                "total_chars": len(accumulated_report),
                                "message": f"审查完成，共 {len(bg_chapters)} 章",
                            })
                        )
                        await result_db.commit()
                except Exception as e:
                    logger.warning(f"⚠️ 更新任务结果摘要失败: {e}")

                await tracker.complete(f"审查完成，共 {len(bg_chapters)} 章，报告已保存")
                logger.info(f"✅ 后台全文审查完成: task={task_id[:8]} report={report_record.id[:8]}")

            except Exception as e:
                logger.error(f"❌ 后台全文审查失败: {e}", exc_info=True)
                await tracker.error(str(e))

    await background_task_service.spawn_background_task(
        task.id, user_id, _run_full_review
    )

    return {
        "task_id": task.id,
        "task_type": REVIEW_TASK_TYPE,
        "status": "pending",
        "message": "任务已创建，请通过 GET /api/tasks/{task_id} 查询进度",
    }


@router.get("/report/{report_id}", summary="获取审查报告内容")
async def get_review_report(
    report_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """根据 report_id 获取已保存的审查报告全文。"""
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    result = await db.execute(
        select(GenerationHistory).where(
            GenerationHistory.id == report_id,
            GenerationHistory.model == REVIEW_REPORT_MODEL,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="审查报告不存在")

    return {
        "id": report.id,
        "project_id": report.project_id,
        "content": report.generated_content,
        "prompt": report.prompt,
        "total_chars": len(report.generated_content or ""),
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


@router.get("/reports", summary="获取项目的审查报告列表")
async def list_review_reports(
    request: Request,
    project_id: str = Query(..., description="项目ID"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """列出项目下的审查报告记录（按时间倒序，只返回摘要，不含全文）。"""
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    result = await db.execute(
        select(GenerationHistory)
        .where(
            GenerationHistory.project_id == project_id,
            GenerationHistory.model == REVIEW_REPORT_MODEL,
        )
        .order_by(GenerationHistory.created_at.desc())
        .limit(limit)
    )
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": r.id,
                "project_id": r.project_id,
                "prompt": r.prompt,
                "total_chars": len(r.generated_content or ""),
                "preview": (r.generated_content or "")[:200],
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in items
        ],
        "total": len(items),
    }

