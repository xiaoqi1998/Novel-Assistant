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
    PAGE_TIMEOUT = 10.0         # 单页超时（秒）
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
                raise ValueError("未能识别到目录或章节正文，请尝试粘贴小说目录页链接")
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
            raise ValueError("所有章节均抓取失败，请确认链接可正常访问或更换目录页链接")

        await _notify(f"抓取完成，共获得 {len(chapters)} 章正文", 92)
        return chapters, warnings

    async def _fetch_page(self, url: str) -> tuple[str, str]:
        """抓取单个页面，返回 (html 文本, 最终 URL)"""
        timeout = httpx.Timeout(self.PAGE_TIMEOUT, connect=8.0)
        headers = {"User-Agent": self.USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9"}
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            response = await client.get(url)
            response.raise_for_status()
            return self._decode_html(response.content, response.headers.get("content-type", "")), str(response.url)

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

        return title, "\n\n".join(cleaned).strip()

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
