"""项目管理API"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from typing import List
import json
import os
from urllib.parse import quote, unquote
from app.database import get_db
from app.models.project import Project
from app.models.character import Character
from app.models.outline import Outline
from app.models.chapter import Chapter
from app.models.generation_history import GenerationHistory
from app.models.relationship import CharacterRelationship, Organization, OrganizationMember
from app.models.memory import StoryMemory, PlotAnalysis
from app.models.foreshadow import Foreshadow
from app.models.career import Career, CharacterCareer
from app.models.analysis_task import AnalysisTask
from app.models.batch_generation_task import BatchGenerationTask
from app.models.character_arc import CharacterArc
from app.models.background_task import BackgroundTask
from app.models.chapter_snapshot import ChapterSnapshot
from app.models.character_location import CharacterLocation
from app.models.item import Item
from app.models.secret import Secret
from app.models.vow import Vow
from app.models.project_default_style import ProjectDefaultStyle
from app.models.regeneration_task import RegenerationTask
from app.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectListResponse
)
from app.schemas.import_export import (
    ExportOptions,
    ImportValidationResult,
    ImportResult
)
from app.services.import_export_service import ImportExportService
try:
    from app.services.memory_service import memory_service
except ImportError:
    memory_service = None
from app.logger import get_logger
from app.utils.data_consistency import (
    run_full_data_consistency_check,
    fix_missing_organization_records,
    fix_organization_member_counts
)

logger = get_logger(__name__)
router = APIRouter(prefix="/projects", tags=["项目管理"])


@router.post("", response_model=ProjectResponse, summary="创建项目")
async def create_project(
    project: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试创建项目")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"创建新项目: {project.title}, user_id={user_id}")
        
        # 创建项目时自动设置user_id
        project_data = project.model_dump()
        project_data['user_id'] = user_id
        db_project = Project(**project_data)
        
        db.add(db_project)
        await db.commit()
        await db.refresh(db_project)
        logger.info(f"项目创建成功: project_id={db_project.id}, user_id={user_id}")
        
        return db_project
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建项目失败: {str(e)}", exc_info=True)
        raise


@router.get("", response_model=ProjectListResponse, summary="获取项目列表")
async def get_projects(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    """获取当前用户的项目列表"""
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试获取项目列表")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.debug(f"获取项目列表: user_id={user_id}, skip={skip}, limit={limit}")
        
        # 只查询当前用户的项目
        count_result = await db.execute(
            select(func.count(Project.id)).where(Project.user_id == user_id)
        )
        total = count_result.scalar_one()
        
        result = await db.execute(
            select(Project)
            .where(Project.user_id == user_id)
            .order_by(Project.updated_at.desc())
            .offset(skip)
            .limit(limit)
        )
        projects = result.scalars().all()
        logger.info(f"获取项目列表成功: user_id={user_id}, 共{total}个项目")
        
        return ProjectListResponse(total=total, items=projects)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取项目列表失败: {str(e)}", exc_info=True)
        raise


@router.get("/{project_id}", response_model=ProjectResponse, summary="获取项目详情")
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试获取项目详情")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.debug(f"获取项目详情: project_id={project_id}, user_id={user_id}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        logger.info(f"获取项目详情成功: {project.title}")
        return project
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取项目详情失败: {str(e)}", exc_info=True)
        raise


@router.put("/{project_id}", response_model=ProjectResponse, summary="更新项目")
async def update_project(
    project_id: str,
    project_update: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试更新项目")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"更新项目: project_id={project_id}, user_id={user_id}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        update_data = project_update.model_dump(exclude_unset=True)
        logger.debug(f"更新字段: {list(update_data.keys())}")
        for field, value in update_data.items():
            setattr(project, field, value)
        
        await db.commit()
        await db.refresh(project)
        logger.info(f"项目更新成功: {project.title}")
        return project
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新项目失败: {str(e)}", exc_info=True)
        raise


@router.delete("/{project_id}", summary="删除项目")
async def delete_project(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试删除项目")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"删除项目: project_id={project_id}, user_id={user_id}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        project_title = project.title
        
        # 删除向量数据库中的记忆（user_id已在上面获取）
        if user_id:
            try:
                await memory_service.delete_project_memories(user_id, project_id)
                logger.info(f"✅ 向量数据库清理成功")
            except Exception as e:
                logger.warning(f"⚠️ 向量数据库清理失败（继续删除其他数据）: {str(e)}")
        else:
            logger.warning(f"⚠️ 未找到用户ID，跳过向量数据库清理")
        
        # === 删除所有关联数据（SQLite默认不启用外键约束，需要显式删除）===
        
        # 1. 删除角色关系
        relationships_result = await db.execute(
            delete(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
        )
        logger.debug(f"删除角色关系数: {relationships_result.rowcount}")
        
        # 2. 删除组织成员和组织
        orgs_result = await db.execute(
            select(Organization).where(Organization.project_id == project_id)
        )
        orgs = orgs_result.scalars().all()
        org_member_count = 0
        for org in orgs:
            members_result = await db.execute(
                delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
            )
            org_member_count += members_result.rowcount
        logger.debug(f"删除组织成员数: {org_member_count}")
        
        organizations_result = await db.execute(
            delete(Organization).where(Organization.project_id == project_id)
        )
        logger.debug(f"删除组织数: {organizations_result.rowcount}")
        
        # 3. 删除生成历史
        history_result = await db.execute(
            delete(GenerationHistory).where(GenerationHistory.project_id == project_id)
        )
        logger.debug(f"删除生成历史数: {history_result.rowcount}")
        
        # 4. 删除分析任务
        analysis_tasks_result = await db.execute(
            delete(AnalysisTask).where(AnalysisTask.project_id == project_id)
        )
        logger.debug(f"删除分析任务数: {analysis_tasks_result.rowcount}")
        
        # 5. 删除批量生成任务
        batch_tasks_result = await db.execute(
            delete(BatchGenerationTask).where(BatchGenerationTask.project_id == project_id)
        )
        logger.debug(f"删除批量生成任务数: {batch_tasks_result.rowcount}")
        
        # 6. 删除角色职业关联（先获取角色ID列表）
        characters_query = await db.execute(
            select(Character.id).where(Character.project_id == project_id)
        )
        character_ids = [row[0] for row in characters_query.fetchall()]
        
        if character_ids:
            character_careers_result = await db.execute(
                delete(CharacterCareer).where(CharacterCareer.character_id.in_(character_ids))
            )
            logger.debug(f"删除角色职业关联数: {character_careers_result.rowcount}")
        
        # 7. 删除职业体系
        careers_result = await db.execute(
            delete(Career).where(Career.project_id == project_id)
        )
        logger.debug(f"删除职业体系数: {careers_result.rowcount}")
        
        # 8. 删除故事记忆
        story_memories_result = await db.execute(
            delete(StoryMemory).where(StoryMemory.project_id == project_id)
        )
        logger.debug(f"删除故事记忆数: {story_memories_result.rowcount}")
        
        # 9. 删除章节（会级联删除 PlotAnalysis）
        chapters_result = await db.execute(
            delete(Chapter).where(Chapter.project_id == project_id)
        )
        logger.debug(f"删除章节数: {chapters_result.rowcount}")
        
        # 10. 删除大纲
        outlines_result = await db.execute(
            delete(Outline).where(Outline.project_id == project_id)
        )
        logger.debug(f"删除大纲数: {outlines_result.rowcount}")
        
        # 11. 删除角色
        characters_result = await db.execute(
            delete(Character).where(Character.project_id == project_id)
        )
        logger.debug(f"删除角色数: {characters_result.rowcount}")
        
        # 12. 删除伏笔
        foreshadows_result = await db.execute(
            delete(Foreshadow).where(Foreshadow.project_id == project_id)
        )
        logger.debug(f"删除伏笔数: {foreshadows_result.rowcount}")

        # 13. 删除角色弧光（SQLite 默认不启用外键级联，需显式删除）
        arcs_result = await db.execute(
            delete(CharacterArc).where(CharacterArc.project_id == project_id)
        )
        logger.debug(f"删除角色弧光数: {arcs_result.rowcount}")

        # 14. 删除关联的后台任务记录
        bg_tasks_result = await db.execute(
            delete(BackgroundTask).where(BackgroundTask.project_id == project_id)
        )
        logger.debug(f"删除后台任务数: {bg_tasks_result.rowcount}")

        # 15. 删除天命快照（章节事实快照）
        snapshots_result = await db.execute(
            delete(ChapterSnapshot).where(ChapterSnapshot.project_id == project_id)
        )
        logger.debug(f"删除天命快照数: {snapshots_result.rowcount}")

        # 16. 删除角色位置记录（需在删除角色之前）
        char_locations_result = await db.execute(
            delete(CharacterLocation).where(CharacterLocation.project_id == project_id)
        )
        logger.debug(f"删除角色位置记录数: {char_locations_result.rowcount}")

        # 17. 删除物品（天命物品体系）
        items_result = await db.execute(
            delete(Item).where(Item.project_id == project_id)
        )
        logger.debug(f"删除物品数: {items_result.rowcount}")

        # 18. 删除秘密（天命秘密体系）
        secrets_result = await db.execute(
            delete(Secret).where(Secret.project_id == project_id)
        )
        logger.debug(f"删除秘密数: {secrets_result.rowcount}")

        # 19. 删除誓言（天命誓言体系）
        vows_result = await db.execute(
            delete(Vow).where(Vow.project_id == project_id)
        )
        logger.debug(f"删除誓言数: {vows_result.rowcount}")

        # 20. 删除项目默认写作风格绑定
        default_styles_result = await db.execute(
            delete(ProjectDefaultStyle).where(ProjectDefaultStyle.project_id == project_id)
        )
        logger.debug(f"删除项目默认风格绑定数: {default_styles_result.rowcount}")

        # 21. 删除重新生成任务记录
        regen_tasks_result = await db.execute(
            delete(RegenerationTask).where(RegenerationTask.project_id == project_id)
        )
        logger.debug(f"删除重新生成任务数: {regen_tasks_result.rowcount}")

        # 22. 清理磁盘上的封面文件
        if project.cover_image_url:
            try:
                from app.config import PROJECT_ROOT
                cover_storage_dir = PROJECT_ROOT / "storage" / "generated_covers"
                old_filename = unquote(project.cover_image_url.rsplit("/", 1)[-1])
                old_file_path = cover_storage_dir / user_id / old_filename
                if os.path.exists(old_file_path):
                    os.remove(old_file_path)
                    logger.debug(f"已清理封面文件: {old_filename}")
            except Exception as cleanup_err:
                logger.warning(f"清理封面文件失败(忽略): {cleanup_err}")

        # 最后删除项目本身
        await db.delete(project)
        await db.commit()
        
        logger.info(f"项目删除成功: {project_title}")
        return {"message": "项目及所有关联数据（包括向量数据库）删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除项目失败: {str(e)}", exc_info=True)
        raise


@router.get("/{project_id}/export", summary="导出项目章节为TXT")
async def export_project_chapters(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    """
    导出项目的所有章节内容为TXT文本文件
    按章节顺序组织，使用便于再次拆书导入的纯章节格式
    """
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试导出项目")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"开始导出项目: project_id={project_id}, user_id={user_id}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == project_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = chapters_result.scalars().all()
        
        if not chapters:
            logger.warning(f"项目没有章节: {project_id}")
            raise HTTPException(status_code=404, detail="项目没有任何章节")
        
        txt_content = []
        
        for idx, chapter in enumerate(chapters):
            chapter_title = (chapter.title or "").strip() or f"未命名章节{chapter.chapter_number}"
            raw_content = (chapter.content or "").strip()
            if raw_content:
                formatted_lines = []
                for line in raw_content.splitlines():
                    stripped_line = line.strip()
                    if stripped_line:
                        formatted_lines.append(f"　　{stripped_line}")
                    else:
                        formatted_lines.append("")
                chapter_content = "\n".join(formatted_lines)
            else:
                chapter_content = "　　（本章暂无内容）"
            
            # 使用拆书强匹配可稳定识别的章节标题格式：第X章 标题
            txt_content.append(f"第{chapter.chapter_number}章 {chapter_title}")
            txt_content.append(chapter_content)
            
            # 章节之间只保留一个空行，避免装饰性分割线干扰拆书识别
            if idx < len(chapters) - 1:
                txt_content.append("")
        
        final_content = "\n".join(txt_content)
        
        safe_title = "".join(c for c in (project.title or "未命名项目") if c.isalnum() or c in (' ', '-', '_', '，', '。', '、'))
        filename = f"{safe_title}.txt"
        
        from urllib.parse import quote
        encoded_filename = quote(filename)
        
        logger.info(f"导出成功: {filename}, 共{len(chapters)}章, {len(final_content)}字符")
        
        return Response(
            content=final_content.encode('utf-8'),
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                "Content-Type": "text/plain; charset=utf-8"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出项目失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.get("/{project_id}/export-markdown", summary="导出项目为Markdown电子书")
async def export_project_markdown(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    """
    导出项目为 Markdown 格式电子书
    包含：元信息头、可点击目录、大纲、章节正文（章节标题用二级标题，便于编辑器大纲栏快速跳转）
    """
    try:
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试导出项目")
            raise HTTPException(status_code=401, detail="未登录")

        logger.info(f"开始导出项目 Markdown: project_id={project_id}, user_id={user_id}")

        # 查询项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")

        # 查询大纲（按 order_index 排序）
        outlines_result = await db.execute(
            select(Outline)
            .where(Outline.project_id == project_id)
            .order_by(Outline.order_index)
        )
        outlines = outlines_result.scalars().all()

        # 查询章节（按 chapter_number 排序）
        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == project_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = chapters_result.scalars().all()

        if not chapters:
            raise HTTPException(status_code=404, detail="项目没有任何章节")

        # 构建 Markdown 内容
        from datetime import datetime
        import re

        title = (project.title or "未命名项目").strip()
        lines: list[str] = []

        # ===== 文档头 =====
        lines.append(f"# {title}")
        lines.append("")

        # 元信息块（多行引用，便于阅读）
        status_map = {
            'planning': '规划中',
            'writing': '创作中',
            'completed': '已完成',
            'draft': '草稿',
        }
        meta_lines = []
        if project.genre:
            meta_lines.append(f"**类型**: {project.genre}")
        if project.status:
            meta_lines.append(f"**状态**: {status_map.get(project.status, project.status)}")
        if project.current_words:
            meta_lines.append(f"**字数**: {project.current_words:,}")
        if project.target_words:
            meta_lines.append(f"**目标字数**: {project.target_words:,}")
        meta_lines.append(f"**导出时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        for m in meta_lines:
            lines.append(f"> {m}")
        lines.append("")

        # 简介
        if project.description and project.description.strip():
            for desc_line in project.description.strip().splitlines():
                if desc_line.strip():
                    lines.append(f"> {desc_line.strip()}")
            lines.append("")

        # ===== 目录 =====
        def make_anchor(text: str) -> str:
            """生成 Markdown 锚点：小写、空格转-、保留字母数字汉字"""
            anchor = re.sub(r'[^\w\u4e00-\u9fa5\s-]', '', text.lower())
            anchor = re.sub(r'\s+', '-', anchor.strip())
            return anchor

        lines.append("## 目录")
        lines.append("")
        if outlines:
            lines.append(f"- [大纲](#{make_anchor('大纲')})")
        for chapter in chapters:
            ch_title = (chapter.title or "").strip() or f"未命名章节{chapter.chapter_number}"
            heading = f"第{chapter.chapter_number}章 {ch_title}"
            lines.append(f"- [{heading}](#{make_anchor(heading)})")
        lines.append("")

        # ===== 大纲 =====
        if outlines:
            lines.append("## 大纲")
            lines.append("")
            for outline in outlines:
                o_title = (outline.title or "").strip() or "未命名大纲"
                lines.append(f"### {o_title}")
                lines.append("")
                if outline.content and outline.content.strip():
                    lines.append(outline.content.strip())
                    lines.append("")
            lines.append("---")
            lines.append("")

        # ===== 章节正文 =====
        for idx, chapter in enumerate(chapters):
            ch_title = (chapter.title or "").strip() or f"未命名章节{chapter.chapter_number}"
            lines.append(f"## 第{chapter.chapter_number}章 {ch_title}")
            lines.append("")

            # 关联大纲标注
            if chapter.outline_id:
                matched = next((o for o in outlines if o.id == chapter.outline_id), None)
                if matched and matched.title:
                    lines.append(f"> 所属大纲: {matched.title}")
                    lines.append("")

            raw_content = (chapter.content or "").strip()
            if raw_content:
                lines.append(raw_content)
            else:
                lines.append("（本章暂无内容）")
            lines.append("")

            # 章节间分隔线
            if idx < len(chapters) - 1:
                lines.append("---")
                lines.append("")

        final_content = "\n".join(lines)

        # 文件名（与 TXT 保持一致的 safe_title 规则）
        safe_title = "".join(
            c for c in title
            if c.isalnum() or c in (' ', '-', '_', '，', '。', '、')
        ) or "未命名项目"
        filename = f"{safe_title}.md"
        encoded_filename = quote(filename)

        logger.info(
            f"导出 Markdown 成功: {filename}, 共{len(chapters)}章, "
            f"{len(outlines)}条大纲, {len(final_content)}字符"
        )

        return Response(
            content=final_content.encode('utf-8'),
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                "Content-Type": "text/markdown; charset=utf-8"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出 Markdown 失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.post("/{project_id}/check-consistency", summary="检查数据一致性")
async def check_project_consistency(
    project_id: str,
    request: Request,
    auto_fix: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """
    检查并修复项目的数据一致性问题
    
    Args:
        project_id: 项目ID
        auto_fix: 是否自动修复问题（默认True）
    
    返回检查报告，包含：
    - organization_records: 检查并修复缺失的Organization记录
    - member_counts: 检查并修复组织成员计数
    - relationships: 验证关系数据完整性
    - organization_members: 验证组织成员数据完整性
    """
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试检查数据一致性")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"开始数据一致性检查: project_id={project_id}, user_id={user_id}, auto_fix={auto_fix}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        report = await run_full_data_consistency_check(project_id, db, auto_fix)
        
        logger.info(f"数据一致性检查完成: {project_id}")
        return report
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"数据一致性检查失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"检查失败: {str(e)}")


@router.post("/{project_id}/fix-organizations", summary="修复组织记录")
async def fix_project_organizations(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    修复项目中缺失的Organization记录
    
    为所有is_organization=True但没有Organization记录的Character创建记录
    """
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试修复组织记录")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"开始修复组织记录: project_id={project_id}, user_id={user_id}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        fixed_count, total_count = await fix_missing_organization_records(project_id, db)
        
        logger.info(f"组织记录修复完成: {project_id}, 修复{fixed_count}/{total_count}")
        return {
            "message": "组织记录修复完成",
            "fixed": fixed_count,
            "total": total_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"修复组织记录失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"修复失败: {str(e)}")


@router.post("/{project_id}/fix-member-counts", summary="修复成员计数")
async def fix_project_member_counts(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    修复项目中所有组织的成员计数
    
    从实际成员记录重新计算每个组织的member_count
    """
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试修复成员计数")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"开始修复成员计数: project_id={project_id}, user_id={user_id}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        fixed_count, total_count = await fix_organization_member_counts(project_id, db)
        
        logger.info(f"成员计数修复完成: {project_id}, 修复{fixed_count}/{total_count}")
        return {
            "message": "成员计数修复完成",
            "fixed": fixed_count,
            "total": total_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"修复成员计数失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"修复失败: {str(e)}")


@router.post("/{project_id}/export-data", summary="导出项目数据为JSON")
async def export_project_data(
    project_id: str,
    request: Request,
    options: ExportOptions,
    db: AsyncSession = Depends(get_db)
):
    """
    导出项目完整数据为JSON格式
    
    Args:
        project_id: 项目ID
        options: 导出选项
            - include_generation_history: 是否包含生成历史
            - include_writing_styles: 是否包含写作风格
            - include_careers: 是否包含职业系统
            - include_memories: 是否包含故事记忆
            - include_plot_analysis: 是否包含剧情分析
    
    Returns:
        JSON文件下载
    """
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试导出项目数据")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"开始导出项目数据: project_id={project_id}, user_id={user_id}, options={options.model_dump()}")
        
        # 只查询当前用户的项目
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            logger.warning(f"项目不存在或无权访问: project_id={project_id}, user_id={user_id}")
            raise HTTPException(status_code=404, detail="项目不存在")
        
        # 导出数据（使用所有选项）
        export_data = await ImportExportService.export_project(
            project_id=project_id,
            db=db,
            include_generation_history=options.include_generation_history,
            include_writing_styles=options.include_writing_styles,
            include_careers=options.include_careers,
            include_memories=options.include_memories,
            include_plot_analysis=options.include_plot_analysis
        )
        
        # 转换为JSON
        json_content = export_data.model_dump_json(indent=2, exclude_none=True, by_alias=True)
        
        # 生成文件名
        safe_title = "".join(c for c in project.title if c.isalnum() or c in (' ', '-', '_'))
        from datetime import datetime
        date_str = datetime.now().strftime("%Y%m%d")
        filename = f"project_{safe_title}_{date_str}.json"
        encoded_filename = quote(filename)
        
        logger.info(f"项目数据导出成功: {filename}")
        
        return Response(
            content=json_content.encode('utf-8'),
            media_type="application/json; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                "Content-Type": "application/json; charset=utf-8"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出项目数据失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.post("/validate-import", response_model=ImportValidationResult, summary="验证导入文件")
async def validate_import_file(
    file: UploadFile = File(...)
):
    """
    验证导入文件的格式和内容
    
    Args:
        file: 上传的JSON文件
    
    Returns:
        验证结果
    """
    try:
        logger.info(f"验证导入文件: {file.filename}")
        
        # 检查文件类型
        if not file.filename.endswith('.json'):
            raise HTTPException(status_code=400, detail="只支持JSON格式文件")
        
        # 读取文件内容
        content = await file.read()
        
        # 检查文件大小（50MB限制）
        max_size = 50 * 1024 * 1024  # 50MB
        if len(content) > max_size:
            raise HTTPException(status_code=413, detail="文件大小超过50MB限制")
        
        # 解析JSON
        try:
            data = json.loads(content.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"无效的JSON格式: {str(e)}")
        
        # 验证数据
        validation_result = ImportExportService.validate_import_data(data)
        
        logger.info(f"文件验证完成: valid={validation_result.valid}")
        return validation_result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"验证导入文件失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"验证失败: {str(e)}")


@router.post("/import", response_model=ImportResult, summary="导入项目")
async def import_project(
    file: UploadFile = File(...),
    request: Request = None,
    db: AsyncSession = Depends(get_db)
):
    """
    导入项目数据（创建新项目）
    
    Args:
        file: 上传的JSON文件
    
    Returns:
        导入结果
    """
    try:
        # 从认证中间件获取用户ID
        user_id = getattr(request.state, 'user_id', None)
        if not user_id:
            logger.warning("未登录用户尝试导入项目")
            raise HTTPException(status_code=401, detail="未登录")
        
        logger.info(f"开始导入项目: {file.filename}, user_id={user_id}")
        
        # 检查文件类型
        if not file.filename.endswith('.json'):
            raise HTTPException(status_code=400, detail="只支持JSON格式文件")
        
        # 读取文件内容
        content = await file.read()
        
        # 检查文件大小
        max_size = 50 * 1024 * 1024  # 50MB
        if len(content) > max_size:
            raise HTTPException(status_code=413, detail="文件大小超过50MB限制")
        
        # 解析JSON
        try:
            data = json.loads(content.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"无效的JSON格式: {str(e)}")
        
        # 导入数据（传入user_id）
        import_result = await ImportExportService.import_project(data, db, user_id)
        
        if import_result.success:
            logger.info(f"项目导入成功: {import_result.project_id}")
        else:
            logger.warning(f"项目导入失败: {import_result.message}")
        
        return import_result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导入项目失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")