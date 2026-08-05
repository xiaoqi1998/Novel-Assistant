"""Git 拉取后自动生成更新公告

机制：
- 应用启动时调用 auto_generate_update_announcement()
- 读取当前 Git HEAD，与公告库中上一条自动公告记录的 hash 对比
- 有新提交（即 git pull 后重启了服务）则把新提交按类型整理成更新公告自动发布
- 首次运行仅记录基线 hash（hidden 公告），不产生面向用户的公告
- 非 Git 环境 / git 不可用 / 配置关闭时静默跳过，绝不影响应用启动

关闭方式：环境变量 AUTO_UPDATE_ANNOUNCEMENT=false

提交内容不适合给用户看时的三种屏蔽方式：
1. commit message 里加 [skip-changelog] / [no-changelog] / [内部] / [不公告] 标记
2. 使用默认屏蔽的内部前缀：chore / ci / build / style / test / release / wip / Merge 等
3. 项目根目录 .changelogignore 文件：每行一条正则，匹配提交标题即排除
"""
import os
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.database import get_engine
from app.models.announcement import Announcement
from app.logger import get_logger

logger = get_logger(__name__)

# 自动公告标题前缀（用于识别"上一条自动公告"，管理员手动公告不受影响）
AUTO_TITLE_PREFIX = "[自动更新]"
# 正文最多展示的提交条数，超出部分折叠为一行计数
MAX_COMMITS_IN_CONTENT = 30
# 公告全局数据库的引擎标识（与 announcements API 保持一致）
ANNOUNCEMENT_DB_KEY = "_announcements_"

# 提交信息分类规则（按顺序匹配，命中即归类）
_CATEGORY_RULES = [
    ("新增功能", [r"^feat", r"^新增", r"^添加", r"^实现", r"^支持"]),
    ("问题修复", [r"^fix", r"^修复", r"^修正", r"^解决"]),
    ("性能优化", [r"^perf", r"^优化", r"^提速"]),
    ("重构调整", [r"^refactor", r"^重构", r"^调整"]),
    ("文档更新", [r"^docs?", r"^文档", r"^说明"]),
]
_CATEGORY_ORDER = ["新增功能", "问题修复", "性能优化", "重构调整", "文档更新", "其他变更"]

# ============ 面向用户的提交过滤 ============
# 1）提交信息带这些标记的，一律不展示给用户（可加在 commit message 任意位置）
_SKIP_MARKERS = re.compile(r"\[(skip|no)[-_ ]changelog\]|\[内部\]|\[不公告\]", re.IGNORECASE)
# 2）默认屏蔽的内部提交前缀（配置/样式/测试/杂务/合并提交等，对用户无意义）
_SKIP_PREFIXES = re.compile(
    r"^(chore|ci|build|style|test|release|wip|tmp|temp)(\([^)]*\))?:|^Merge\s|^(合并|临时|调试|测试提交)",
    re.IGNORECASE,
)
# 3）项目根目录 .changelogignore：每行一条正则（# 开头为注释），匹配 subject 即排除
CHANGELOG_IGNORE_FILE = ".changelogignore"

# 正文展示时剔除的 Conventional Commits 英文前缀（如 feat: / fix(scope):）
_PREFIX_STRIP = re.compile(r"^(feat|fix|perf|refactor|docs?|chore|style|test|build|ci)(\([^)]*\))?:\s*", re.IGNORECASE)


def _project_root() -> Path:
    """项目根目录（backend/app/services/x.py 向上三级）"""
    return Path(__file__).resolve().parents[3]


def _load_ignore_patterns(root: Path) -> list[re.Pattern]:
    """加载 .changelogignore 自定义排除规则（每行一条正则，# 注释，非法行跳过）"""
    ignore_file = root / CHANGELOG_IGNORE_FILE
    if not ignore_file.is_file():
        return []
    patterns = []
    try:
        for line in ignore_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                patterns.append(re.compile(line, re.IGNORECASE))
            except re.error:
                logger.warning(f".changelogignore 非法正则已跳过: {line!r}")
    except Exception as e:
        logger.warning(f"读取 .changelogignore 失败（已忽略）: {e}")
    return patterns


def _filter_commits_for_users(
    commits: list[tuple[str, str]], root: Path
) -> tuple[list[tuple[str, str]], int]:
    """过滤不适合展示给用户的提交，返回 (保留的提交, 被过滤数量)"""
    ignore_patterns = _load_ignore_patterns(root)
    kept: list[tuple[str, str]] = []
    skipped = 0
    for short, subject in commits:
        if _SKIP_MARKERS.search(subject) or _SKIP_PREFIXES.match(subject):
            skipped += 1
            continue
        if any(p.search(subject) for p in ignore_patterns):
            skipped += 1
            continue
        kept.append((short, subject))
    return kept, skipped


def _run_git(args: list[str], cwd: Path) -> Optional[str]:
    """执行 git 命令，失败返回 None（静默降级）"""
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=15,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except Exception:
        return None


def _get_head_hashes(cwd: Path) -> Optional[tuple[str, str]]:
    """获取当前 HEAD 的（短hash, 完整hash），非 Git 环境返回 None"""
    full = _run_git(["rev-parse", "HEAD"], cwd)
    if not full:
        return None
    short = _run_git(["rev-parse", "--short", "HEAD"], cwd) or full[:7]
    return short, full


def _classify(subject: str) -> str:
    """按提交信息前缀归类"""
    for category, patterns in _CATEGORY_RULES:
        for pattern in patterns:
            if re.match(pattern, subject, re.IGNORECASE):
                return category
    return "其他变更"


def _extract_prev_hash(title: str) -> Optional[str]:
    """从自动公告标题中解析上一次记录的完整 hash

    标题格式：
    - "[自动更新] abc1234 → def5678 (def5678...完整hash)"
    - "[自动更新] 基线 (完整hash)"
    """
    match = re.search(r"\(([0-9a-f]{7,40})\)$", title)
    return match.group(1) if match else None


def _build_announcement_content(commits: list[tuple[str, str]], head_short: str) -> tuple[str, str]:
    """把提交列表整理为公告正文，返回 (content, summary)

    commits: [(短hash, subject), ...] 按时间倒序（新→旧）
    """
    categorized: dict[str, list[tuple[str, str]]] = {}
    for short, subject in commits:
        categorized.setdefault(_classify(subject), []).append((short, subject))

    lines = [f"本次共更新 {len(commits)} 个提交，已更新至 {head_short}。", ""]
    for category in _CATEGORY_ORDER:
        items = categorized.get(category)
        if not items:
            continue
        lines.append(f"【{category}】")
        for short, subject in items:
            # 剔除 feat:/fix: 等英文前缀，保留中文语义前缀
            display_subject = _PREFIX_STRIP.sub("", subject).strip() or subject
            lines.append(f"· {display_subject}")
        lines.append("")

    if len(commits) > MAX_COMMITS_IN_CONTENT:
        lines.append(f"（仅展示最近 {MAX_COMMITS_IN_CONTENT} 条，其余 {len(commits) - MAX_COMMITS_IN_CONTENT} 条详见 Git 记录）")

    lines.append(f"更新时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    content = "\n".join(lines)

    # 摘要取最新一条提交
    first_subject = commits[0][1] if commits else ""
    summary = f"更新至 {head_short}，共 {len(commits)} 个提交：{first_subject}"
    if len(summary) > 255:
        summary = summary[:252] + "..."
    return content, summary


async def _ensure_announcement_table(engine) -> None:
    """兼容未执行 Alembic 迁移的旧部署：确保 announcements 表存在"""
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Announcement.__table__.create(sync_conn, checkfirst=True)
        )


async def _find_last_auto_announcement(session: AsyncSession) -> Optional[Announcement]:
    """查找最近一条自动公告（按标题前缀识别）"""
    result = await session.execute(
        select(Announcement)
        .where(Announcement.title.like(f"{AUTO_TITLE_PREFIX}%"))
        .order_by(Announcement.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def auto_generate_update_announcement() -> None:
    """启动时自动生成更新公告（git pull 有新提交时）"""
    if os.getenv("AUTO_UPDATE_ANNOUNCEMENT", "").lower() in ("false", "0", "off"):
        logger.info("自动生成更新公告已关闭（AUTO_UPDATE_ANNOUNCEMENT）")
        return

    root = _project_root()
    hashes = _get_head_hashes(root)
    if not hashes:
        logger.info("非 Git 环境或 git 不可用，跳过自动更新公告")
        return
    head_short, head_full = hashes

    engine = await get_engine(ANNOUNCEMENT_DB_KEY)
    await _ensure_announcement_table(engine)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_maker() as session:
        last = await _find_last_auto_announcement(session)

        # 首次运行：记录基线 hash（hidden，不面向用户），下次启动才开始对比
        if not last:
            baseline = Announcement(
                id=str(uuid.uuid4()),
                title=f"{AUTO_TITLE_PREFIX} 基线 ({head_full})",
                content=f"自动更新公告基线记录，当前版本：{head_short}",
                level="info",
                status="hidden",
                pinned=False,
                author_name="系统",
                publish_at=datetime.utcnow(),
            )
            session.add(baseline)
            await session.commit()
            logger.info(f"自动更新公告：已记录基线 hash={head_short}")
            return

        prev_hash = _extract_prev_hash(last.title)
        if not prev_hash or prev_hash == head_full:
            logger.info("自动更新公告：无新提交，跳过")
            return

        # 校验旧 hash 是否仍可达（rebase/浅克隆可能失效）
        if not _run_git(["rev-parse", "--verify", f"{prev_hash}^{{commit}}"], root):
            logger.warning(f"自动更新公告：旧 hash {prev_hash[:7]} 不可达，重置基线为 {head_short}")
            last.title = f"{AUTO_TITLE_PREFIX} 基线 ({head_full})"
            last.updated_at = datetime.utcnow()
            await session.commit()
            return

        # 读取 prev..HEAD 的提交（新→旧）
        log_output = _run_git(
            ["log", f"{prev_hash}..{head_full}", "--pretty=format:%h%x09%s", "--max-count=100"],
            root,
        )
        commits = []
        if log_output:
            for line in log_output.splitlines():
                parts = line.split("\t", 1)
                if len(parts) == 2 and parts[1].strip():
                    commits.append((parts[0], parts[1].strip()))

        if not commits:
            logger.info("自动更新公告：git log 为空，仅更新基线")
            last.title = f"{AUTO_TITLE_PREFIX} 基线 ({head_full})"
            last.updated_at = datetime.utcnow()
            await session.commit()
            return

        # 过滤不适合展示给用户的提交（[skip-changelog] 标记 / 内部前缀 / .changelogignore）
        commits, skipped_count = _filter_commits_for_users(commits, root)
        if skipped_count:
            logger.info(f"自动更新公告：已过滤 {skipped_count} 条内部提交")
        if not commits:
            logger.info("自动更新公告：新提交均为内部提交，不生成公告，仅更新基线")
            last.title = f"{AUTO_TITLE_PREFIX} 基线 ({head_full})"
            last.updated_at = datetime.utcnow()
            await session.commit()
            return

        content, summary = _build_announcement_content(commits, head_short)
        prev_short = prev_hash[:7]

        announcement = Announcement(
            id=str(uuid.uuid4()),
            title=f"{AUTO_TITLE_PREFIX} {prev_short} → {head_short} ({head_full})",
            content=content,
            summary=summary,
            level="success",
            status="published",
            pinned=False,
            author_name="系统",
            publish_at=datetime.utcnow(),
        )
        session.add(announcement)
        await session.commit()
        logger.info(
            f"自动更新公告已生成: {prev_short} → {head_short}，共 {len(commits)} 个提交"
        )
