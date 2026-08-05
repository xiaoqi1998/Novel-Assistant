"""Git 提交读取与更新公告草稿生成

职责：
- 读取当前仓库 git 提交（与上次自动公告的 hash 对比取增量，无基线时取最近 N 条）
- 过滤不适合展示给用户的提交（[skip-changelog] 标记 / 内部前缀 / .changelogignore）
- 按类型分类整理为公告草稿（标题 / 正文 / 摘要 / 提交列表），不落库
- 供「公告管理」页面调用：先预览整理结果，确认后再由 API 创建公告

旧机制说明：
- 曾经有 CLI 脚本 backend/app/scripts/generate_update_announcement.py + 启动时
  auto_generate_update_announcement() 自动发布公告，均已移除；
  现改为在公告管理页面由管理员手动触发（见 build_git_announcement_draft）。

提交内容不适合给用户看时的三种屏蔽方式：
1. commit message 里加 [skip-changelog] / [no-changelog] / [内部] / [不公告] 标记
2. 使用默认屏蔽的内部前缀：chore / ci / build / style / test / release / wip / Merge 等
3. 项目根目录 .changelogignore 文件：每行一条正则，匹配提交标题即排除
"""
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.announcement import Announcement
from app.logger import get_logger

logger = get_logger(__name__)

# 自动公告标题前缀（用于识别"上一条自动公告"，管理员手动公告不受影响）
AUTO_TITLE_PREFIX = "[自动更新]"
# 正文最多展示的提交条数，超出部分折叠为一行计数
MAX_COMMITS_IN_CONTENT = 30

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
    """项目根目录（含 .git 的仓库根）

    优先级：
    1. 环境变量 PROJECT_GIT_DIR（容器部署时显式指定）
    2. 从当前文件向上逐级查找 .git 目录（兼容容器内挂载 .git 到 /app 的场景）
    3. 回退：源码文件向上三级
    """
    env_root = os.getenv("PROJECT_GIT_DIR", "").strip()
    if env_root:
        candidate = Path(env_root)
        if candidate.is_dir():
            return candidate
    current = Path(__file__).resolve().parent
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
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
    """执行 git 命令，失败返回 None（含诊断日志）

    兼容场景：
    - 容器未安装 git（FileNotFoundError）
    - 挂载的 .git 属主不一致（safe.directory，通过环境变量解除）
    - git 命令本身报错（如 HEAD 不存在）
    """
    if shutil.which("git") is None:
        logger.error(f"git 命令不存在（PATH 中未找到 git），cwd={cwd}")
        return None
    try:
        env = os.environ.copy()
        # 容器内挂载的 .git 目录文件属主可能与运行进程不一致，
        # git 会报 "detected dubious ownership / unsafe repository"，
        # 通过环境变量解除 safe.directory 限制（仅信任本仓库目录）。
        if "GIT_CONFIG_COUNT" not in env:
            env["GIT_CONFIG_COUNT"] = "1"
            env["GIT_CONFIG_KEY_0"] = "safe.directory"
            env["GIT_CONFIG_VALUE_0"] = str(cwd)
        result = subprocess.run(
            ["git"] + args,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=15,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            logger.warning(f"git {args} 执行失败 rc={result.returncode} (cwd={cwd}): {stderr[:500]}")
            return None
        return result.stdout.strip()
    except FileNotFoundError:
        logger.error(f"git 命令不存在（FileNotFoundError），cwd={cwd}")
        return None
    except Exception as e:
        logger.error(f"git 执行异常: {e} (cwd={cwd})")
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

    标题格式（优先完整 hash，兼容旧版 short hash）：
    - "[自动更新] abc1234 → def5678 (def5678...完整hash)"   # 新格式：括号内完整 hash
    - "[自动更新] abc1234 → def5678"                        # 旧格式：箭头后 short hash
    - "[自动更新] 基线 (完整hash)"
    """
    match = re.search(r"\(([0-9a-f]{7,40})\)$", title)
    if match:
        return match.group(1)
    # 兼容旧格式：解析箭头后的 short hash（def5678），经 rev-parse 校验后仍可作为增量起点
    match = re.search(r"→\s*([0-9a-f]{7,40})\s*$", title)
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


async def _find_last_auto_announcement(session: AsyncSession) -> Optional[Announcement]:
    """查找最近一条自动公告（按标题前缀识别）"""
    result = await session.execute(
        select(Announcement)
        .where(Announcement.title.like(f"{AUTO_TITLE_PREFIX}%"))
        .order_by(Announcement.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _draft_result(
    *,
    ok: bool,
    message: str,
    git_available: bool = True,
    head_short: Optional[str] = None,
    head_full: Optional[str] = None,
    prev_short: Optional[str] = None,
    range_desc: str = "",
    commits: Optional[list[dict]] = None,
    skipped: int = 0,
    title: str = "",
    content: str = "",
    summary: str = "",
) -> dict:
    """构造统一的公告草稿返回结构"""
    return {
        "ok": ok,
        "message": message,
        "git_available": git_available,
        "head_short": head_short,
        "head_full": head_full,
        "prev_short": prev_short,
        "range_desc": range_desc,
        "commits": commits or [],
        "skipped": skipped,
        "title": title,
        "content": content,
        "summary": summary,
    }


async def build_git_announcement_draft(
    session: AsyncSession,
    *,
    max_count: int = 100,
) -> dict:
    """根据当前 git 版本读取提交并整理为公告草稿（不落库）。

    供「公告管理」页面调用：先展示整理结果，管理员确认后再由 API 创建公告。

    增量逻辑：
    - 若库中存在上一条自动公告，取其标题中记录的 hash 作为起点（prev..HEAD 增量）；
    - 若无基线或 hash 不可达，则读取最近 max_count 条提交。

    Args:
        session: 全局公告库会话（用于查询上一条自动公告的 hash）
        max_count: 无基线时读取的最近提交条数

    Returns:
        {
            "ok": bool,
            "message": str,
            "git_available": bool,
            "head_short": str|None,
            "head_full": str|None,
            "prev_short": str|None,
            "range_desc": str,       # 例如 "abc1234 → def5678" 或 "最近 100 条提交"
            "commits": list[dict],   # 过滤后的用户可见提交 [{short, subject, category}]
            "skipped": int,          # 被过滤的内部提交数量
            "title": str,            # 建议标题
            "content": str,          # 整理后的公告正文
            "summary": str,          # 建议摘要
        }
    """
    if os.getenv("AUTO_UPDATE_ANNOUNCEMENT", "").lower() in ("false", "0", "off"):
        logger.info("更新公告功能已关闭（AUTO_UPDATE_ANNOUNCEMENT），跳过草稿生成")
        return _draft_result(ok=False, message="更新公告功能已关闭（AUTO_UPDATE_ANNOUNCEMENT）", git_available=False)

    # 逐环节诊断 git 环境，给出精确失败原因
    env_root = os.getenv("PROJECT_GIT_DIR", "").strip()
    root = _project_root()

    if shutil.which("git") is None:
        logger.error("容器内未安装 git 命令（当前为旧镜像），无法读取提交记录")
        return _draft_result(
            ok=False,
            message="服务器容器内未安装 git（当前为旧镜像）。Dockerfile 已包含 git，请在服务器执行：bash auto-update.sh --rebuild 重新构建镜像后重试",
            git_available=False,
        )

    if env_root:
        env_root_path = Path(env_root)
        if not env_root_path.is_dir():
            logger.error(f"PROJECT_GIT_DIR 配置的目录不存在: {env_root}")
            return _draft_result(
                ok=False,
                message=f"PROJECT_GIT_DIR 配置的目录不存在: {env_root}，请检查 docker-compose 挂载",
                git_available=False,
            )
        if not (env_root_path / ".git").exists() and not (env_root_path / "HEAD").exists():
            logger.error(f"PROJECT_GIT_DIR 目录不是 Git 仓库（缺少 .git/HEAD）: {env_root}")
            return _draft_result(
                ok=False,
                message=f"PROJECT_GIT_DIR 目录 {env_root} 未挂载 Git 仓库信息（缺少 .git），请检查 docker-compose volumes",
                git_available=False,
            )

    hashes = _get_head_hashes(root)
    if not hashes:
        logger.info(f"git 不可用或非 Git 仓库（目录: {root}），无法读取提交")
        return _draft_result(
            ok=False,
            message=f"无法读取 Git 提交记录（仓库目录: {root}），请查看服务器日志确认原因",
            git_available=False,
        )
    head_short, head_full = hashes

    # 尝试从上次自动公告解析 prev hash，实现增量（prev..HEAD）
    prev_hash: Optional[str] = None
    prev_short: Optional[str] = None
    try:
        last = await _find_last_auto_announcement(session)
        if last:
            candidate = _extract_prev_hash(last.title)
            if candidate and _run_git(["rev-parse", "--verify", f"{candidate}^{{commit}}"], root):
                prev_hash = candidate
                prev_short = candidate[:7]
    except Exception as e:
        logger.warning(f"查询上次公告 hash 失败，改为读取最近提交: {e}")

    if prev_hash:
        range_arg = f"{prev_hash}..{head_full}"
        range_desc = f"{prev_short} → {head_short}"
    else:
        range_arg = f"-{max_count}"
        range_desc = f"最近 {max_count} 条提交"

    # 读取提交（新→旧）
    log_output = _run_git(
        ["log", range_arg, "--pretty=format:%h%x09%s", "--date=short"],
        root,
    )
    commits: list[tuple[str, str]] = []
    if log_output:
        for line in log_output.splitlines():
            parts = line.split("\t", 1)
            if len(parts) == 2 and parts[1].strip():
                commits.append((parts[0], parts[1].strip()))

    if not commits:
        return _draft_result(
            ok=False,
            message="没有可展示的提交（可能已是最新版本）",
            head_short=head_short,
            head_full=head_full,
            prev_short=prev_short,
            range_desc=range_desc,
        )

    # 过滤不适合展示给用户的提交
    commits, skipped = _filter_commits_for_users(commits, root)
    if not commits:
        return _draft_result(
            ok=False,
            message="新提交均为内部提交（chore/ci/test 等），无需发布公告",
            head_short=head_short,
            head_full=head_full,
            prev_short=prev_short,
            range_desc=range_desc,
            skipped=skipped,
        )

    content, summary = _build_announcement_content(commits, head_short)
    # 标题末尾追加完整 hash，供下次生成时作为增量起点（prev..HEAD）
    title = f"{AUTO_TITLE_PREFIX} {range_desc} ({head_full})"

    commit_items = [
        {"short": short, "subject": subject, "category": _classify(subject)}
        for short, subject in commits
    ]

    logger.info(
        f"已读取 git 提交并整理公告草稿: {range_desc}，可见提交 {len(commit_items)} 条，过滤 {skipped} 条"
    )
    return _draft_result(
        ok=True,
        message="已读取 git 提交并整理公告草稿",
        head_short=head_short,
        head_full=head_full,
        prev_short=prev_short,
        range_desc=range_desc,
        commits=commit_items,
        skipped=skipped,
        title=title,
        content=content,
        summary=summary,
    )
