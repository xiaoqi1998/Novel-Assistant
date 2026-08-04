"""在线拆书抓取服务：目录页识别、章节抓取与 HTML 正文提取"""
from __future__ import annotations

import asyncio
import re
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

from app.logger import get_logger
from app.services.txt_parser_service import NOVEL_AD_LINE_PATTERNS

logger = get_logger(__name__)


class WebFetchService:
    """在线拆书抓取服务（URL -> 章节列表）"""

    MAX_CHAPTERS = 300          # 单本抓取章节上限
    CONCURRENCY = 4             # 章节抓取并发数
    PAGE_TIMEOUT = 20.0         # 单页超时（秒）
    CONNECT_TIMEOUT = 15.0      # 连接超时（秒）
    PAGE_MAX_ATTEMPTS = 3       # 单页最大尝试次数
    MIN_TOC_LINKS = 5           # 判定为目录页所需的最少章节链接数
    MIN_CONTENT_LENGTH = 200    # 单章正文最短长度（低于则视为抓取失败）

    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )

    # 章节标题文本特征
    CHAPTER_TITLE_PATTERNS = [
        re.compile(r"^第\s*[0-9零一二三四五六七八九十百千万两〇]+\s*[章节回卷集部篇]"),
        re.compile(r"^chapter\s*\d+", re.IGNORECASE),
        re.compile(r"^\d{1,4}\s*[、.．:：]"),
    ]
    # 章节链接 href 特征
    CHAPTER_HREF_PATTERNS = [
        re.compile(r"chapter", re.IGNORECASE),
        re.compile(r"/\d+\.html?$", re.IGNORECASE),
        re.compile(r"_\d+\.html?$", re.IGNORECASE),
    ]

    # 页面正文提取时需要移除的噪音标签
    NOISE_TAGS = ("script", "style", "nav", "header", "footer", "ins", "iframe", "noscript", "aside", "form")

    # 站点可抓取性诊断特征
    SPA_MARKERS = (
        "__NUXT__", "__NEXT_DATA__", '__APP_DATA__',
        'id="app"', "id='app'", 'id="root"', "id='root'",
        "data-reactroot", "window.__INITIAL_STATE__",
    )
    APP_ONLY_KEYWORDS = (
        "打开APP", "下载APP", "APP内阅读", "在APP中阅读", "客户端阅读",
        "扫码阅读", "打开七猫免费小说", "打开番茄免费小说", "到APP中继续阅读",
    )
    LOGIN_KEYWORDS = (
        "请先登录", "登录后阅读", "登录后可阅读", "需要登录才能阅读", "登录后预览全文",
    )
    # SPA 判定下可见文本密度阈值：SSR 完整页面文本通常远超此值
    SPA_TEXT_THRESHOLD = 3000

    SUPPORTED_HINT = (
        "支持的链接：目录页包含完整章节列表（每章一个链接）、"
        "章节正文直接输出在 HTML 中的免费小说站点（如笔趣阁类站点）。"
    )

    async def fetch_novel_from_url(
        self,
        *,
        url: str,
        extract_mode: str = "head",
        chapter_count: int = 30,
        progress_callback=None,
    ) -> tuple[list[dict], list[str]]:
        """
        从目录页/单章页 URL 抓取小说章节。

        Returns:
            (chapters, warnings)
            chapters 结构与 txt_parser_service.split_chapters() 一致：
            [{title, content, chapter_number}]
        """
        from bs4 import BeautifulSoup

        async def _notify(message: str, progress: int) -> None:
            if progress_callback:
                try:
                    await progress_callback(message, progress)
                except Exception:
                    logger.debug("拆书抓取进度回调失败", exc_info=True)

        parsed_root = urlparse(url)
        if parsed_root.scheme not in {"http", "https"} or not parsed_root.netloc:
            raise ValueError("链接格式无效，请提供 http/https 开头的小说目录页链接")

        await _notify("正在访问链接并识别页面类型...", 2)
        html, final_url = await self._fetch_page(url)
        soup = BeautifulSoup(html, "html.parser")
        self._strip_noise(soup)

        chapter_links = self._extract_chapter_links(soup, base_url=final_url, root_host=parsed_root.netloc)

        if len(chapter_links) < self.MIN_TOC_LINKS:
            # 按单章页处理
            title, content = self._extract_single_page(soup)
            if len(content) < self.MIN_CONTENT_LENGTH:
                raise ValueError(self._diagnose_unfetchable(soup, html, chapter_links))
            return (
                [{"title": title or "第1章", "content": content, "chapter_number": 1}],
                [],
            )

        # 目录页处理：控制抓取范围
        warnings: list[str] = []
        total_links = len(chapter_links)
        if total_links > self.MAX_CHAPTERS:
            warnings.append(f"目录共 {total_links} 章，超出上限 {self.MAX_CHAPTERS} 章，已按截取规则处理")

        if extract_mode == "head":
            selected = chapter_links[: max(1, chapter_count)]
        elif extract_mode == "tail":
            selected = chapter_links[-max(1, chapter_count):]
        else:
            selected = chapter_links[: self.MAX_CHAPTERS]

        await _notify(f"已识别 {total_links} 章，开始抓取选中的 {len(selected)} 章...", 5)

        semaphore = asyncio.Semaphore(self.CONCURRENCY)
        failed_titles: list[str] = []

        async def _fetch_one(idx: int, link_title: str, link_url: str) -> Optional[dict]:
            async with semaphore:
                for attempt in range(2):
                    try:
                        page_html, _ = await self._fetch_page(link_url)
                        page_soup = BeautifulSoup(page_html, "html.parser")
                        self._strip_noise(page_soup)
                        title, content = self._extract_single_page(page_soup, fallback_title=link_title)
                        if len(content) >= self.MIN_CONTENT_LENGTH:
                            return {"title": title or link_title, "content": content, "_order": idx}
                        if attempt == 0:
                            await asyncio.sleep(0.5)
                    except Exception as exc:
                        if attempt == 0:
                            await asyncio.sleep(0.5)
                            continue
                        logger.warning(f"章节抓取失败 {link_url}: {exc}")
                return None

        tasks = [
            asyncio.create_task(_fetch_one(idx, title, href))
            for idx, (title, href) in enumerate(selected)
        ]

        results: list[Optional[dict]] = []
        done_count = 0
        total = len(tasks)
        for future in asyncio.as_completed(tasks):
            result = await future
            results.append(result)
            done_count += 1
            # 抓取阶段进度：5% -> 90%
            progress = 5 + int(85 * done_count / max(1, total))
            if done_count % max(1, total // 10) == 0 or done_count == total:
                await _notify(f"已抓取 {done_count}/{total} 章...", progress)

        chapters: list[dict] = []
        ordered = sorted([r for r in results if r], key=lambda x: x["_order"])
        for item in ordered:
            chapters.append(
                {
                    "title": item["title"][:200],
                    "content": item["content"],
                    "chapter_number": len(chapters) + 1,
                }
            )

        failed_count = total - len(ordered)
        if failed_count > 0:
            warnings.append(f"共 {failed_count} 章抓取失败已跳过（网络超时或页面结构无法解析）")

        if not chapters:
            # 抽样诊断：抓取第一个章节链接分析不可抓原因
            reason = await self._diagnose_chapter_fetch_failure(selected[0][1])
            raise ValueError(reason)

        await _notify(f"抓取完成，共获得 {len(chapters)} 章正文", 92)
        return chapters, warnings

    # ---- 站点可抓取性诊断 ----

    def _diagnose_unfetchable(self, soup, html: str, chapter_links: list[tuple[str, str]]) -> str:
        """目录/单章页无法提取正文时，诊断原因并返回可读错误信息"""
        visible_text = soup.get_text(strip=True)
        text_len = len(visible_text)

        is_spa = any(marker in html for marker in self.SPA_MARKERS) and text_len < self.SPA_TEXT_THRESHOLD
        if is_spa:
            return (
                "该站点内容通过 JavaScript 动态加载，服务端返回的页面中没有章节正文，暂不支持在线拆书。"
                f"{self.SUPPORTED_HINT}"
            )
        if any(keyword in html for keyword in self.APP_ONLY_KEYWORDS):
            return (
                "该站点为 App 专属内容，网页端不提供可抓取的正文（需在 App 内阅读），暂不支持在线拆书。"
                f"{self.SUPPORTED_HINT}"
            )
        if any(keyword in html for keyword in self.LOGIN_KEYWORDS):
            return (
                "该站点需要登录后才能阅读章节内容，暂不支持在线拆书。"
                f"{self.SUPPORTED_HINT}"
            )
        if chapter_links:
            return (
                "页面中识别到的章节链接与当前站点域名不一致（或链接结构无法解析），暂不支持。"
                f"{self.SUPPORTED_HINT}"
            )
        return (
            "未能识别到章节目录或章节正文。请粘贴包含完整章节列表的小说目录页链接。"
            f"{self.SUPPORTED_HINT}"
        )

    async def _diagnose_chapter_fetch_failure(self, sample_url: str) -> str:
        """目录识别成功但所有章节正文都失败时，抽样一章诊断原因"""
        from bs4 import BeautifulSoup

        try:
            html, _ = await self._fetch_page(sample_url)
        except Exception as exc:
            return (
                f"章节目录识别成功，但章节页面无法访问（{type(exc).__name__}）："
                "目标站点可能限流或需要特殊访问条件，请稍后重试或更换链接。"
            )

        soup = BeautifulSoup(html, "html.parser")
        self._strip_noise(soup)
        _, content = self._extract_single_page(soup)
        if len(content) >= self.MIN_CONTENT_LENGTH:
            return "所有章节均抓取失败（可能为瞬时网络问题），请稍后重试。"

        return self._diagnose_unfetchable(soup, html, [])

    async def _fetch_page(self, url: str) -> tuple[str, str]:
        """抓取单个页面（带重试），返回 (html 文本, 最终 URL)"""
        timeout = httpx.Timeout(self.PAGE_TIMEOUT, connect=self.CONNECT_TIMEOUT)
        headers = {"User-Agent": self.USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9"}
        last_exc: Optional[Exception] = None
        for attempt in range(self.PAGE_MAX_ATTEMPTS):
            try:
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    return self._decode_html(response.content, response.headers.get("content-type", "")), str(response.url)
            except httpx.TimeoutException as exc:
                last_exc = exc
                logger.warning(
                    f"页面抓取超时（第{attempt + 1}/{self.PAGE_MAX_ATTEMPTS}次） {url}: {type(exc).__name__}"
                )
                if attempt < self.PAGE_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.warning(
                    f"页面抓取失败（第{attempt + 1}/{self.PAGE_MAX_ATTEMPTS}次） {url}: {type(exc).__name__} {exc}"
                )
                if attempt < self.PAGE_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
        # 所有重试失败：抛出带可读信息的异常（httpx 部分异常 str() 为空）
        exc_name = type(last_exc).__name__ if last_exc else "NetworkError"
        raise RuntimeError(f"页面访问失败（{exc_name}）：目标站点可能限流或无法连通，请稍后重试或更换链接")

    @staticmethod
    def _decode_html(content: bytes, content_type: str) -> str:
        """按 Content-Type / meta 声明解码 HTML，兜底 gb18030 与 utf-8"""
        declared = ""
        match = re.search(r"charset=([\w\-]+)", content_type or "", re.IGNORECASE)
        if match:
            declared = match.group(1)
        else:
            head_sample = content[:2048].decode("ascii", errors="ignore")
            meta_match = re.search(r"charset=[\"']?([\w\-]+)", head_sample, re.IGNORECASE)
            if meta_match:
                declared = meta_match.group(1)

        candidates = []
        if declared:
            candidates.append(declared)
        candidates.extend(["utf-8", "gb18030", "big5"])

        for enc in candidates:
            try:
                return content.decode(enc)
            except (UnicodeDecodeError, LookupError):
                continue
        return content.decode("utf-8", errors="ignore")

    def _strip_noise(self, soup) -> None:
        for tag_name in self.NOISE_TAGS:
            for tag in soup.find_all(tag_name):
                tag.decompose()

    def _is_chapter_link(self, text: str, href: str) -> bool:
        if not href or href.startswith(("javascript:", "#", "mailto:")):
            return False
        if text and any(pattern.search(text) for pattern in self.CHAPTER_TITLE_PATTERNS):
            return True
        if href and any(pattern.search(href) for pattern in self.CHAPTER_HREF_PATTERNS):
            # href 命中时需锚文本非空，避免把分页/导航链接误判为章节
            return bool(text)
        return False

    def _extract_chapter_links(self, soup, *, base_url: str, root_host: str) -> list[tuple[str, str]]:
        """按 DOM 顺序提取章节链接 [(title, absolute_url)]，仅保留同域链接并去重"""
        links: list[tuple[str, str]] = []
        seen: set[str] = set()

        for anchor in soup.find_all("a", href=True):
            text = anchor.get_text(strip=True)[:200]
            href = anchor["href"].strip()
            if not self._is_chapter_link(text, href):
                continue

            absolute = urljoin(base_url, href)
            parsed = urlparse(absolute)
            if parsed.scheme not in {"http", "https"}:
                continue
            if parsed.netloc != root_host:
                continue
            if absolute in seen:
                continue

            seen.add(absolute)
            links.append((text or f"第{len(links) + 1}章", absolute))

        return links

    def _extract_single_page(self, soup, *, fallback_title: str = "") -> tuple[str, str]:
        """从章节页提取 (标题, 正文)"""
        title = fallback_title
        heading = soup.find(["h1", "h2"])
        if heading:
            heading_text = heading.get_text(strip=True)
            if heading_text:
                title = heading_text[:200]

        container = self._find_content_container(soup)
        if container is None:
            return title, ""

        raw_lines = container.get_text("\n").split("\n")
        cleaned: list[str] = []
        for line in raw_lines:
            normalized = line.strip().replace("\u3000", "")
            if not normalized:
                continue
            if self._is_noise_line(normalized):
                continue
            cleaned.append(normalized)

        if not self._has_novel_like_content(cleaned):
            # 无小说正文特征（如纯 UI/菜单文本），视为无正文，交由诊断逻辑给出原因
            return title, ""

        return title, "\n\n".join(cleaned).strip()

    @staticmethod
    def _has_novel_like_content(lines: list[str]) -> bool:
        """判断文本是否具备小说正文特征：多个长段落。

        用于过滤纯 UI/菜单/表单文本（短行堆砌，如 App 引导页、举报表单等）。
        """
        if not lines:
            return False
        long_lines = [line for line in lines if len(line) >= 30]
        if len(long_lines) < 3:
            return False
        long_text_len = sum(len(line) for line in long_lines)
        total_len = sum(len(line) for line in lines)
        return total_len > 0 and long_text_len / total_len >= 0.5

    @staticmethod
    def _find_content_container(soup):
        """优先 <article>，否则取文本密度最高的 <div>"""
        article = soup.find("article")
        if article:
            return article

        best = None
        best_score = 0
        for div in soup.find_all("div"):
            text = div.get_text(strip=True)
            length = len(text)
            if length < 200:
                continue
            # 文本密度：纯文本长度 / (链接文本长度 + 1)，正文区链接占比通常很低
            link_text_length = sum(len(a.get_text(strip=True)) for a in div.find_all("a"))
            density = length / (link_text_length + 1)
            score = length * min(density, 50)
            if score > best_score:
                best_score = score
                best = div
        return best

    @staticmethod
    def _is_noise_line(line: str) -> bool:
        """过滤广告/站点声明等噪音行"""
        if len(line) > 150:
            return False
        return any(keyword in line for keyword in NOVEL_AD_LINE_PATTERNS)


web_fetch_service = WebFetchService()
