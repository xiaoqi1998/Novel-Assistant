"""Skill 提示词加载器

从 backend/app/skills/ 目录动态加载 oh-story-claudecode 格式的 Skill，
将其转换为 PromptService 兼容的系统默认模板。

每个 Skill 目录结构：
  skills/{skill_name}/
  ├── SKILL.md          # YAML元数据 + 完整工作流指令
  └── references/       # 参考知识库（可选）
      ├── xxx.md
      └── ...
"""

import os
import re
from typing import Any, List, Dict, Optional
import yaml
from app.logger import get_logger

logger = get_logger(__name__)

# Skills 目录路径：backend/app/skills/ （本文件在 backend/app/services/ 下）
SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills")


class _SkillYamlDumper(yaml.SafeDumper):
    pass


class _LiteralString(str):
    pass


def _literal_string_representer(dumper: yaml.SafeDumper, data: _LiteralString):
    return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|')


_SkillYamlDumper.add_representer(_LiteralString, _literal_string_representer)


def _parse_yaml_frontmatter(content: str) -> Dict[str, Any]:
    """解析 SKILL.md 开头的 YAML frontmatter"""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}

    yaml_text = match.group(1)

    try:
        metadata = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as e:
        logger.warning(f"解析 Skill YAML frontmatter 失败: {e}")
        return {}

    if not isinstance(metadata, dict):
        return {}

    result: Dict[str, Any] = {}
    for key in ("name", "display_name", "category", "description", "triggers",
                "writing_constraints", "skill_type"):
        value = metadata.get(key)
        if key == "triggers" and isinstance(value, list):
            result[key] = [str(item).strip() for item in value if str(item).strip()]
        elif value is not None:
            result[key] = str(value).strip()

    return result


def _template_key(name: str) -> str:
    return f"SKILL_{name.upper().replace('-', '_')}"


def _display_name_from_description(description: str, fallback: str) -> str:
    first_line = description.strip().splitlines()[0].strip() if description.strip() else ""
    if "。" in first_line:
        return first_line.split("。")[0].strip() or fallback
    return first_line or fallback


def _infer_category(name: str) -> str:
    if "long" in name:
        return "Skill·长篇"
    if "short" in name:
        return "Skill·短篇"
    if "deslop" in name:
        return "Skill·润色"
    if "browser" in name:
        return "Skill·工具"
    return "Skill"


def _infer_skill_type(name: str) -> str:
    """推断 Skill 类型：writing（创作类，互斥）/ auxiliary（辅助类，可叠加）/ tool（工具类，不参与创作注入）"""
    if "write" in name:
        return "writing"
    # 工具类 Skill：运行后产生结果存 DB 或输出报告，不参与创作约束注入
    # - extract（文风学习）：提取结果存 writing_styles 表，走 style_id 机制应用
    # - analyze（拆文）/ scan（扫榜）/ review（全文审查）：输出分析报告，不参与创作
    if any(kw in name for kw in ("extract", "analyze", "scan", "review")):
        return "tool"
    return "auxiliary"


def _extract_triggers(name: str, description: str, explicit_triggers: Any = None) -> List[str]:
    """获取触发词，优先使用结构化 triggers，旧文件则从描述中兼容提取。"""
    triggers: List[str] = []

    if isinstance(explicit_triggers, list):
        triggers.extend(str(item).strip() for item in explicit_triggers if str(item).strip())
    elif isinstance(explicit_triggers, str) and explicit_triggers.strip():
        triggers.extend(item.strip() for item in re.split(r'[\n,，、]+', explicit_triggers) if item.strip())

    if not triggers:
        triggers.append(f"/{name}")
        triggers.extend(re.findall(r'「(.+?)」', description))
        triggers.extend(match.group(1) for match in re.finditer(r'(?:^|[\s、，,。；;：:])(/[^\s、，,。；;：:「」]+)', description))

    if f"/{name}" not in triggers:
        triggers.insert(0, f"/{name}")

    return list(dict.fromkeys(triggers))


def _format_skill_frontmatter(metadata: Dict[str, Any]) -> str:
    data = {
        "name": metadata.get("name", ""),
        "display_name": metadata.get("display_name", ""),
        "category": metadata.get("category", "Skill"),
        "description": _LiteralString(metadata.get("description", "")),
        "triggers": metadata.get("triggers", []),
    }
    yaml_text = yaml.dump(
        data,
        Dumper=_SkillYamlDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).strip()
    return f"---\n{yaml_text}\n---"


def _get_skill_body(content: str) -> str:
    """获取 SKILL.md 中 YAML frontmatter 之后的内容（即工作流指令）"""
    match = re.match(r'^---\s*\n.*?\n---\s*\n', content, re.DOTALL)
    if match:
        return content[match.end():].strip()
    return content.strip()


def _get_references(skill_dir: str) -> Dict[str, str]:
    """读取 skill 目录下 references/ 中的所有 .md 文件"""
    refs_dir = os.path.join(skill_dir, "references")
    references = {}
    
    if not os.path.isdir(refs_dir):
        return references
    
    for filename in sorted(os.listdir(refs_dir)):
        if filename.endswith('.md'):
            filepath = os.path.join(refs_dir, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    ref_name = filename[:-3]  # 去掉 .md 后缀
                    references[ref_name] = f.read().strip()
            except Exception as e:
                logger.warning(f"读取参考文件失败: {filepath}, 错误: {e}")
    
    return references


def load_skills() -> List[Dict]:
    """
    从 skills 目录加载所有 Skill，返回模板列表。
    格式与 PromptService.get_all_system_templates() 返回的一致。
    
    Returns:
        List[Dict]: Skill 模板列表，每个包含：
            - template_key: 模板键名 (SKILL_{name})
            - template_name: 显示名称
            - category: 分类 ("Skill")
            - description: 描述
            - parameters: 参数列表
            - content: 完整工作流指令内容
            - references: 参考知识库字典
            - triggers: 触发词列表
    """
    skills = []
    
    if not os.path.isdir(SKILLS_DIR):
        logger.warning(f"Skills 目录不存在: {SKILLS_DIR}")
        return skills
    
    for skill_name in sorted(os.listdir(SKILLS_DIR)):
        skill_dir = os.path.join(SKILLS_DIR, skill_name)
        if not os.path.isdir(skill_dir):
            continue
        
        skill_md_path = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_md_path):
            continue
        
        try:
            with open(skill_md_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # 解析 YAML frontmatter
            metadata = _parse_yaml_frontmatter(content)
            
            # 获取工作流指令（去掉 YAML 部分）
            body = _get_skill_body(content)
            
            # 读取参考知识库
            references = _get_references(skill_dir)
            
            name = metadata.get('name', skill_name)
            desc = metadata.get('description', '')
            display_name = metadata.get('display_name') or _display_name_from_description(desc, name)
            category = metadata.get('category') or _infer_category(name)
            triggers = _extract_triggers(name, desc, metadata.get('triggers'))
            writing_constraints = metadata.get('writing_constraints', '')
            skill_type = metadata.get('skill_type') or _infer_skill_type(name)
            
            # 拼接参考知识库到内容（作为按需加载的附录）
            if references:
                ref_section = "\n\n---\n\n## 附录：参考资料知识库\n"
                ref_section += "（以下内容根据用户需求按需引用，不需要全部使用）\n"
                for ref_name, ref_content in references.items():
                    ref_section += f"\n### 参考资料：{ref_name}\n\n{ref_content}\n"
                full_content = body + ref_section
            else:
                full_content = body
            
            skill_template = {
                "template_key": _template_key(name),
                "name": name,
                "template_name": display_name,
                "display_name": display_name,
                "category": category,
                "skill_type": skill_type,  # writing（创作类）或 auxiliary（辅助类）
                "description": desc,
                "parameters": ["user_input"],
                "content": full_content,
                "body": body,  # 只含工作流指令，不含 references 附录
                "writing_constraints": writing_constraints,  # 辅助类 Skill 的创作约束（精简版）
                "references": references,
                "triggers": triggers,
                "is_skill": True,
            }
            
            skills.append(skill_template)
            logger.info(f"加载 Skill: {name} (分类: {category}, 参考: {len(references)} 个)")
            
        except Exception as e:
            logger.error(f"加载 Skill 失败: {skill_name}, 错误: {e}")
    
    return skills


def get_skill_by_trigger(user_input: str) -> Optional[Dict]:
    """
    根据用户输入匹配对应的 Skill
    
    Args:
        user_input: 用户输入的文本
        
    Returns:
        匹配到的 Skill 模板，未匹配返回 None
    """
    skills = load_skills()
    user_input_lower = user_input.lower().strip()
    
    for skill in skills:
        triggers = skill.get('triggers', [])
        for trigger in triggers:
            trigger_lower = trigger.lower()
            # 精确匹配触发词
            if user_input_lower == trigger_lower:
                return skill
            # 用户输入以触发词开头
            if user_input_lower.startswith(trigger_lower):
                return skill
    
    # 自然语言模糊匹配
    keyword_map = {
        "长篇写作": ["SKILL_STORY_LONG_WRITE"],
        "写长篇": ["SKILL_STORY_LONG_WRITE"],
        "帮我开书": ["SKILL_STORY_LONG_WRITE"],
        "写大纲": ["SKILL_STORY_LONG_WRITE"],
        "短篇写作": ["SKILL_STORY_SHORT_WRITE"],
        "写短篇": ["SKILL_STORY_SHORT_WRITE"],
        "写个盐言": ["SKILL_STORY_SHORT_WRITE"],
        "长篇拆文": ["SKILL_STORY_LONG_ANALYZE"],
        "拆书": ["SKILL_STORY_LONG_ANALYZE"],
        "分析黄金三章": ["SKILL_STORY_LONG_ANALYZE"],
        "短篇拆文": ["SKILL_STORY_SHORT_ANALYZE"],
        "分析短篇": ["SKILL_STORY_SHORT_ANALYZE"],
        "长篇扫榜": ["SKILL_STORY_LONG_SCAN"],
        "长篇什么火": ["SKILL_STORY_LONG_SCAN"],
        "起点排行": ["SKILL_STORY_LONG_SCAN"],
        "短篇扫榜": ["SKILL_STORY_SHORT_SCAN"],
        "短篇什么火": ["SKILL_STORY_SHORT_SCAN"],
        "去ai味": ["SKILL_STORY_DESLOP"],
        "去味": ["SKILL_STORY_DESLOP"],
        "太ai了": ["SKILL_STORY_DESLOP"],
        "润色": ["SKILL_STORY_DESLOP"],
        "文风学习": ["SKILL_STORY_STYLE_EXTRACT"],
        "学习我的文风": ["SKILL_STORY_STYLE_EXTRACT"],
        "提取文风": ["SKILL_STORY_STYLE_EXTRACT"],
        "分析我的写作风格": ["SKILL_STORY_STYLE_EXTRACT"],
        "我的写作风格": ["SKILL_STORY_STYLE_EXTRACT"],
        "浏览器": ["SKILL_BROWSER_CDP"],
    }
    
    for keyword, skill_keys in keyword_map.items():
        if keyword in user_input_lower:
            for skill in skills:
                if skill['template_key'] in skill_keys:
                    return skill
    
    return None


# 预加载缓存
_skills_cache = None

def get_all_skills_cached() -> List[Dict]:
    """获取所有 Skills（带缓存）"""
    global _skills_cache
    if _skills_cache is None:
        _skills_cache = load_skills()
    return _skills_cache

def refresh_skills_cache():
    """刷新 Skills 缓存"""
    global _skills_cache
    _skills_cache = load_skills()
    return _skills_cache


# ============ 去AI味约束（story-deslop）默认注入 ============
# 用户要求"去AI味默认调用"：所有正文生成场景（小说/短故事/重新生成/局部重写）
# 即使未显式选择去AI味辅助 Skill，也默认注入本约束。
_deslop_constraint_cache: Optional[str] = None
_DEFAULT_DESLOP_CONSTRAINT = (
    "去AI味写作约束（创作时遵循）：\n"
    "1. 段落长度以1-3句为主，长短交错，禁止整齐均匀的长段落；\n"
    "2. 情绪用动作/环境展示（如手在抖），禁止直接告诉（如很紧张）；\n"
    "3. 对白60%以上不加标签，用动作替代「说道/问道」；\n"
    "4. 禁AI套路句式：「眼中闪过一丝」「深吸一口气」「嘴角勾起一抹」「仿佛/犹如/宛若」「缓缓开口」；\n"
    "5. 禁过度对称排比与总结性长句；\n"
    "6. 长短句比例3:2，长句≤40字，连续3个同长度句子必须打断；\n"
    "7. 标点预算：破折号/分隔线全文≤3处且严禁连续装饰线，冒号每千字≤5处，感叹号每千字≤6个，严禁在正文使用括号/【】标注；\n"
    "8. 写完后自查：无模板化过渡词（然而/与此同时/值得注意的是）、无升华式收尾、无「说道」标签滥用、无情绪均匀无起伏；\n"
    "9. 结尾用动作/对话收尾，禁止总结、升华、点题。"
)


def get_deslop_constraints_cached() -> str:
    """获取 story-deslop 去AI味写作约束（带缓存），加载失败回退内置默认。"""
    global _deslop_constraint_cache
    if _deslop_constraint_cache is not None:
        return _deslop_constraint_cache
    try:
        for s in get_all_skills_cached():
            if s.get("template_key") == "SKILL_STORY_DESLOP":
                constraint = (s.get("writing_constraints") or "").strip()
                if constraint:
                    _deslop_constraint_cache = constraint
                    logger.info(f"已加载 story-deslop 去AI味约束（{len(constraint)}字符）")
                    return _deslop_constraint_cache
        logger.warning("未找到 story-deslop skill，使用内置去AI味默认约束")
    except Exception as e:
        logger.warning(f"加载 story-deslop 约束失败，使用内置默认: {e}")
    _deslop_constraint_cache = _DEFAULT_DESLOP_CONSTRAINT
    return _deslop_constraint_cache


def build_output_purity_block() -> str:
    """正文纯净输出约束块：严禁【】、————等装饰符号及一切非正文内容。

    小说/短故事所有正文生成场景都应追加，确保 AI 只输出可直接发布的纯正文。
    """
    return (
        "\n\n【输出纯净性（最高优先级，必须严格遵守）】\n"
        "以上方法论仅作为你创作时的内部思考原则，严禁将方法论内容写入输出正文。\n"
        "你的输出必须是纯净的小说正文，直接可发布，必须满足：\n"
        "1. 严禁在正文中出现任何装饰性符号：禁止【】『』「」等括号包裹的标注、禁止——————/——/---/***/~~~等分隔线或装饰线（破折号全篇≤3处）；\n"
        "2. 严禁出现任何解释、说明、总结、创作心得、前后缀、标题、Markdown标记、JSON或代码块；\n"
        "3. 严禁以『本段/本章/这一部分/以上方法论』等元叙述开头；\n"
        "4. 正文第一句即故事内容本身，最后一句即故事结尾，不得追加任何收尾语；\n"
        "5. 长短句交错（比例约3:2），长句≤40字，连续3个同长度句子必须打断；\n"
        "6. 严禁模板化过渡词（然而/与此同时/值得注意的是/不出所料）与升华式收尾。"
    )


def get_skill_detail(skill_key: str) -> Optional[Dict]:
    """根据 template_key 获取 Skill 完整详情（包括原始 SKILL.md 内容和独立 references）"""
    skills = get_all_skills_cached()
    for s in skills:
        if s["template_key"] == skill_key:
            # 找到对应的目录
            skill_name = skill_key.replace("SKILL_", "").lower().replace("_", "-")
            skill_dir = os.path.join(SKILLS_DIR, skill_name)
            if not os.path.isdir(skill_dir):
                # 尝试从 name 字段获取
                for d in os.listdir(SKILLS_DIR):
                    d_path = os.path.join(SKILLS_DIR, d)
                    if os.path.isdir(d_path):
                        md_path = os.path.join(d_path, "SKILL.md")
                        if os.path.isfile(md_path):
                            try:
                                with open(md_path, 'r', encoding='utf-8') as f:
                                    meta = _parse_yaml_frontmatter(f.read())
                                if f"SKILL_{meta.get('name', '').upper().replace('-', '_')}" == skill_key:
                                    skill_dir = d_path
                                    break
                            except:
                                pass

            # 读取原始 SKILL.md
            skill_md_path = os.path.join(skill_dir, "SKILL.md")
            raw_content = ""
            if os.path.isfile(skill_md_path):
                with open(skill_md_path, 'r', encoding='utf-8') as f:
                    raw_content = f.read()

            # 读取独立的 references（不拼接到 content 中）
            standalone_refs = {}
            refs_dir = os.path.join(skill_dir, "references")
            if os.path.isdir(refs_dir):
                for filename in sorted(os.listdir(refs_dir)):
                    if filename.endswith('.md'):
                        filepath = os.path.join(refs_dir, filename)
                        try:
                            with open(filepath, 'r', encoding='utf-8') as f:
                                standalone_refs[filename[:-3]] = f.read()
                        except:
                            pass

            return {
                **s,
                "raw_content": raw_content,
                "standalone_references": standalone_refs,
                "skill_dir": skill_dir,
            }
    return None


def _validate_skill_metadata(name: str, display_name: str, category: str, description: str, triggers: List[str], body: str):
    if not name.strip():
        raise ValueError("Skill 内部标识不能为空")
    if not re.fullmatch(r'[a-z0-9][a-z0-9\-]*', name.strip()):
        raise ValueError("Skill 内部标识只能包含小写字母、数字和短横线，且必须以字母或数字开头")
    if not display_name.strip():
        raise ValueError("显示名称不能为空")
    if not category.strip():
        raise ValueError("分类不能为空")
    if not description.strip():
        raise ValueError("描述不能为空")
    if not body.strip():
        raise ValueError("工作流指令不能为空")
    if not triggers:
        raise ValueError("至少需要一个触发词")


def create_skill_files(
    name: str,
    description: str,
    body: str,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
) -> Dict:
    """创建新的 Skill 文件"""
    import re
    name = name.strip().lower().replace("_", "-").replace(" ", "-")
    display_name = (display_name or _display_name_from_description(description, name)).strip()
    category = (category or _infer_category(name)).strip()
    triggers = _extract_triggers(name, description, triggers)
    _validate_skill_metadata(name, display_name, category, description, triggers, body)

    # 目录名：小写+短横线
    dir_name = name
    dir_name = re.sub(r'[^a-z0-9\-]', '', dir_name)
    if not dir_name:
        dir_name = "new-skill"
    
    skill_dir = os.path.join(SKILLS_DIR, dir_name)
    if os.path.exists(skill_dir):
        raise ValueError(f"Skill 目录已存在: {dir_name}")
    
    os.makedirs(skill_dir, exist_ok=True)
    
    frontmatter = _format_skill_frontmatter({
        "name": name,
        "display_name": display_name,
        "category": category,
        "description": description.strip(),
        "triggers": triggers,
    })
    skill_md_content = f"{frontmatter}\n\n{body.strip()}"
    
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(skill_md_content)
    
    # 创建 references
    if references:
        refs_dir = os.path.join(skill_dir, "references")
        os.makedirs(refs_dir, exist_ok=True)
        for ref_name, ref_content in references.items():
            ref_path = os.path.join(refs_dir, f"{ref_name}.md")
            with open(ref_path, 'w', encoding='utf-8') as f:
                f.write(ref_content)
    
    # 刷新缓存
    refresh_skills_cache()
    
    # 返回新建的 skill
    skills = get_all_skills_cached()
    for s in skills:
        if s["template_key"] == _template_key(name):
            return s
    return {"template_key": _template_key(name), "template_name": display_name, "category": category}


def update_skill_files(
    skill_key: str,
    description: Optional[str] = None,
    body: Optional[str] = None,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
) -> Dict:
    """更新已有 Skill 文件"""
    detail = get_skill_detail(skill_key)
    if not detail:
        raise ValueError(f"未找到 Skill: {skill_key}")
    
    skill_dir = detail.get("skill_dir", "")
    if not skill_dir or not os.path.isdir(skill_dir):
        raise ValueError(f"Skill 目录不存在: {skill_dir}")
    
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    
    # 读取现有内容
    with open(skill_md_path, 'r', encoding='utf-8') as f:
        raw = f.read()
    
    # 解析现有元数据
    metadata = _parse_yaml_frontmatter(raw)
    name = metadata.get('name', '')
    
    # 更新 SKILL.md
    final_desc = description if description is not None else metadata.get('description', '')
    final_body = body if body is not None else _get_skill_body(raw)
    final_display_name = display_name if display_name is not None else metadata.get('display_name') or _display_name_from_description(final_desc, name)
    final_category = category if category is not None else metadata.get('category') or _infer_category(name)
    final_triggers = _extract_triggers(name, final_desc, triggers if triggers is not None else metadata.get('triggers'))
    _validate_skill_metadata(name, final_display_name, final_category, final_desc, final_triggers, final_body)

    frontmatter = _format_skill_frontmatter({
        "name": name,
        "display_name": final_display_name.strip(),
        "category": final_category.strip(),
        "description": final_desc.strip(),
        "triggers": final_triggers,
    })
    new_content = f"{frontmatter}\n\n{final_body.strip()}"
    
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    # 更新 references
    if references is not None:
        refs_dir = os.path.join(skill_dir, "references")
        # 删除旧的 reference 文件
        if os.path.isdir(refs_dir):
            for f in os.listdir(refs_dir):
                if f.endswith('.md'):
                    os.remove(os.path.join(refs_dir, f))
        else:
            os.makedirs(refs_dir, exist_ok=True)
        
        # 写入新的 references
        for ref_name, ref_content in references.items():
            if ref_content.strip():  # 只写入非空内容
                ref_path = os.path.join(refs_dir, f"{ref_name}.md")
                with open(ref_path, 'w', encoding='utf-8') as f:
                    f.write(ref_content)
    
    # 刷新缓存
    refresh_skills_cache()
    
    # 返回更新后的详情
    return get_skill_detail(skill_key) or {}


def delete_skill_files(skill_key: str) -> bool:
    """删除 Skill 目录"""
    import shutil
    detail = get_skill_detail(skill_key)
    if not detail:
        raise ValueError(f"未找到 Skill: {skill_key}")

    skill_dir = detail.get("skill_dir", "")
    if not skill_dir or not os.path.isdir(skill_dir):
        raise ValueError(f"Skill 目录不存在")

    shutil.rmtree(skill_dir)
    refresh_skills_cache()
    return True


# ==================== 用户感知的 Skill 操作（按 user_id 隔离） ====================
#
# 系统预置 Skill 仍存磁盘（仅管理员可改），用户编辑/创建时写入 user_skills 表。
# 加载逻辑：合并系统预置 + 用户个人 Skill，用户 override 优先于系统预置。

import json as _json
from sqlalchemy import select as _select
from sqlalchemy.ext.asyncio import AsyncSession as _AsyncSession
from app.models.user_skill import UserSkill as _UserSkill


def _user_skill_to_dict(us: "_UserSkill", is_system_default: bool = False,
                        is_custom: bool = False) -> Dict[str, Any]:
    """将 UserSkill ORM 对象转换为与系统预置 skill dict 兼容的格式"""
    name = us.name or ""
    desc = us.description or ""
    display_name = us.display_name or name
    category = us.category or _infer_category(name)
    triggers_raw = us.triggers
    if isinstance(triggers_raw, str):
        try:
            triggers = _json.loads(triggers_raw) if triggers_raw.strip() else []
        except Exception:
            triggers = _extract_triggers(name, desc, None)
    elif isinstance(triggers_raw, list):
        triggers = triggers_raw
    else:
        triggers = _extract_triggers(name, desc, None)

    references: Dict[str, str] = {}
    refs_raw = us.references
    if isinstance(refs_raw, str):
        try:
            parsed = _json.loads(refs_raw) if refs_raw.strip() else {}
            if isinstance(parsed, dict):
                references = {str(k): str(v) for k, v in parsed.items()}
        except Exception:
            references = {}
    elif isinstance(refs_raw, dict):
        references = {str(k): str(v) for k, v in refs_raw.items()}

    body = us.body or ""
    # 拼接参考知识库到内容（与系统预置格式一致）
    if references:
        ref_section = "\n\n---\n\n## 附录：参考资料知识库\n"
        ref_section += "（以下内容根据用户需求按需引用，不需要全部使用）\n"
        for ref_name, ref_content in references.items():
            ref_section += f"\n### 参考资料：{ref_name}\n\n{ref_content}\n"
        full_content = body + ref_section
    else:
        full_content = body

    skill_type = us.skill_type or _infer_skill_type(name)

    return {
        "template_key": us.skill_key or _template_key(name),
        "name": name,
        "template_name": display_name,
        "display_name": display_name,
        "category": category,
        "skill_type": skill_type,
        "description": desc,
        "parameters": ["user_input"],
        "content": full_content,
        "body": body,
        "writing_constraints": us.writing_constraints or "",
        "references": references,
        "triggers": triggers,
        "is_skill": True,
        "is_system_default": is_system_default,
        "is_custom": is_custom if is_custom else (not is_system_default),
    }


def _user_skill_to_detail_dict(us: "_UserSkill") -> Dict[str, Any]:
    """将 UserSkill ORM 对象转换为详情 dict（含 raw_content / standalone_references）"""
    base = _user_skill_to_dict(us, is_system_default=False, is_custom=bool(us.is_custom))
    # 重建 raw_content（YAML frontmatter + body），便于前端展示
    frontmatter = _format_skill_frontmatter({
        "name": us.name or "",
        "display_name": us.display_name or "",
        "category": us.category or "",
        "description": us.description or "",
        "triggers": base["triggers"],
    })
    raw_content = f"{frontmatter}\n\n{(us.body or '').strip()}"
    base.update({
        "raw_content": raw_content,
        "standalone_references": base["references"],
        "skill_dir": "",  # 个人 Skill 不在磁盘
    })
    return base


async def get_all_skills_for_user(user_id: str, db: "_AsyncSession") -> List[Dict]:
    """获取用户可见的全部 Skill（系统预置 + 用户个人，用户 override 优先）"""
    # 1. 加载系统预置（磁盘缓存）
    system_skills = get_all_skills_cached()

    # 2. 查询用户个人 Skill（DB）
    result = await db.execute(
        _select(_UserSkill).where(_UserSkill.user_id == user_id)
    )
    user_skills = result.scalars().all()

    # 3. 合并：用户 override 覆盖同 skill_key 的系统预置；用户自建直接加入
    user_skill_map = {us.skill_key: us for us in user_skills}
    merged: List[Dict] = []

    for sys_skill in system_skills:
        key = sys_skill.get("template_key")
        if key and key in user_skill_map:
            us = user_skill_map.pop(key)
            merged.append(_user_skill_to_dict(us, is_system_default=False, is_custom=False))
        else:
            sys_skill_copy = dict(sys_skill)
            sys_skill_copy["is_system_default"] = True
            sys_skill_copy["is_custom"] = False
            merged.append(sys_skill_copy)

    # 剩下的 user_skills 都是 is_custom=True（用户自建，无系统预置对应项）
    for us in user_skill_map.values():
        merged.append(_user_skill_to_dict(us, is_system_default=False, is_custom=True))

    return merged


async def get_skill_detail_for_user(skill_key: str, user_id: str,
                                    db: "_AsyncSession") -> Optional[Dict]:
    """获取用户视角的 Skill 详情（优先个人副本，回退系统预置）"""
    # 1. 查用户个人
    result = await db.execute(
        _select(_UserSkill).where(
            _UserSkill.user_id == user_id,
            _UserSkill.skill_key == skill_key,
        )
    )
    user_skill = result.scalar_one_or_none()
    if user_skill:
        return _user_skill_to_detail_dict(user_skill)

    # 2. 回退到系统预置
    return get_skill_detail(skill_key)


def _is_system_preset_key(skill_key: str) -> bool:
    """判断 skill_key 是否对应系统预置 Skill"""
    for s in get_all_skills_cached():
        if s.get("template_key") == skill_key:
            return True
    return False


async def create_user_skill(
    user_id: str,
    db: "_AsyncSession",
    name: str,
    description: str,
    body: str,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
    writing_constraints: Optional[str] = None,
) -> Dict:
    """用户创建个人自建 Skill（is_custom=True）

    校验：
    - name 格式合法
    - skill_key 不与系统预置冲突
    - (user_id, skill_key) 不重复
    """
    name = name.strip().lower().replace("_", "-").replace(" ", "-")
    name = re.sub(r'[^a-z0-9\-]', '', name)
    if not name:
        raise ValueError("Skill 内部标识无效")
    if not re.fullmatch(r'[a-z0-9][a-z0-9\-]*', name):
        raise ValueError("Skill 内部标识只能包含小写字母、数字和短横线，且必须以字母或数字开头")

    skill_key = _template_key(name)

    # 不允许与系统预置冲突（用户不能用 story-long-write 这样的系统预置名）
    if _is_system_preset_key(skill_key):
        raise ValueError(f"名称 '{name}' 与系统预置 Skill 冲突，请换一个名称")

    # 校验是否已存在个人 Skill
    existing = await db.execute(
        _select(_UserSkill).where(
            _UserSkill.user_id == user_id,
            _UserSkill.skill_key == skill_key,
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"您已存在同名 Skill: {name}")

    display_name = (display_name or _display_name_from_description(description, name)).strip()
    category = (category or _infer_category(name)).strip()
    final_triggers = _extract_triggers(name, description, triggers)
    _validate_skill_metadata(name, display_name, category, description, final_triggers, body)

    skill_type = _infer_skill_type(name)
    refs_json = _json.dumps(references, ensure_ascii=False) if references else None
    triggers_json = _json.dumps(final_triggers, ensure_ascii=False)

    new_skill = _UserSkill(
        user_id=user_id,
        skill_key=skill_key,
        name=name,
        display_name=display_name,
        category=category,
        description=description.strip(),
        triggers=triggers_json,
        body=body.strip(),
        references=refs_json,
        writing_constraints=writing_constraints or "",
        skill_type=skill_type,
        is_custom=True,
    )
    db.add(new_skill)
    await db.commit()
    await db.refresh(new_skill)

    return _user_skill_to_dict(new_skill, is_system_default=False, is_custom=True)


async def upsert_user_skill_override(
    user_id: str,
    skill_key: str,
    db: "_AsyncSession",
    description: Optional[str] = None,
    body: Optional[str] = None,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
    writing_constraints: Optional[str] = None,
) -> Dict:
    """用户编辑系统预置 → 创建/更新个人副本（is_custom=False，copy-on-write）

    必须确认对应系统预置存在。
    """
    # 校验系统预置存在
    sys_detail = get_skill_detail(skill_key)
    if not sys_detail:
        raise ValueError(f"未找到系统预置 Skill: {skill_key}")

    sys_name = sys_detail.get("name", "")
    sys_desc = sys_detail.get("description", "")
    sys_triggers = sys_detail.get("triggers", [])
    sys_body = _get_skill_body(sys_detail.get("raw_content", ""))
    sys_display = sys_detail.get("display_name") or sys_detail.get("template_name") or sys_name
    sys_category = sys_detail.get("category") or _infer_category(sys_name)
    sys_refs = sys_detail.get("standalone_references", {}) or {}
    sys_constraints = sys_detail.get("writing_constraints", "") or ""

    # 决定最终值（用户传入优先，回退系统预置）
    final_desc = description if description is not None else sys_desc
    final_body = body if body is not None else sys_body
    final_display = display_name if display_name is not None else sys_display
    final_category = category if category is not None else sys_category
    final_triggers = _extract_triggers(
        sys_name, final_desc, triggers if triggers is not None else sys_triggers
    )
    final_constraints = writing_constraints if writing_constraints is not None else sys_constraints
    final_refs = references if references is not None else sys_refs

    _validate_skill_metadata(sys_name, final_display, final_category, final_desc, final_triggers, final_body)

    triggers_json = _json.dumps(final_triggers, ensure_ascii=False)
    refs_json = _json.dumps(final_refs, ensure_ascii=False) if final_refs else None

    # Upsert
    result = await db.execute(
        _select(_UserSkill).where(
            _UserSkill.user_id == user_id,
            _UserSkill.skill_key == skill_key,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.display_name = final_display.strip()
        existing.category = final_category.strip()
        existing.description = final_desc.strip()
        existing.triggers = triggers_json
        existing.body = final_body.strip()
        existing.references = refs_json
        existing.writing_constraints = final_constraints
        # is_custom 保持原值（若原本是副本则不变；理论上不应是 True，因为系统预置名段被拦截）
        await db.commit()
        await db.refresh(existing)
        return _user_skill_to_dict(existing, is_system_default=False, is_custom=False)
    else:
        new_override = _UserSkill(
            user_id=user_id,
            skill_key=skill_key,
            name=sys_name,
            display_name=final_display.strip(),
            category=final_category.strip(),
            description=final_desc.strip(),
            triggers=triggers_json,
            body=final_body.strip(),
            references=refs_json,
            writing_constraints=final_constraints,
            skill_type=sys_detail.get("skill_type") or _infer_skill_type(sys_name),
            is_custom=False,
        )
        db.add(new_override)
        await db.commit()
        await db.refresh(new_override)
        return _user_skill_to_dict(new_override, is_system_default=False, is_custom=False)


async def update_user_custom_skill(
    user_id: str,
    skill_key: str,
    db: "_AsyncSession",
    description: Optional[str] = None,
    body: Optional[str] = None,
    references: Optional[Dict[str, str]] = None,
    display_name: Optional[str] = None,
    category: Optional[str] = None,
    triggers: Optional[List[str]] = None,
    writing_constraints: Optional[str] = None,
) -> Dict:
    """用户更新个人自建 Skill（is_custom=True）"""
    result = await db.execute(
        _select(_UserSkill).where(
            _UserSkill.user_id == user_id,
            _UserSkill.skill_key == skill_key,
        )
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise ValueError(f"未找到个人 Skill: {skill_key}")
    if not existing.is_custom:
        # 副本类型的更新应走 upsert_user_skill_override
        raise ValueError(f"Skill {skill_key} 是系统预置副本，请使用 override 接口")

    name = existing.name
    final_desc = description if description is not None else (existing.description or "")
    final_body = body if body is not None else (existing.body or "")
    final_display = display_name if display_name is not None else (existing.display_name or name)
    final_category = category if category is not None else (existing.category or _infer_category(name))

    # triggers 处理
    if triggers is not None:
        final_triggers = _extract_triggers(name, final_desc, triggers)
    else:
        try:
            cur_trigs = _json.loads(existing.triggers) if existing.triggers else []
        except Exception:
            cur_trigs = []
        final_triggers = _extract_triggers(name, final_desc, cur_trigs)

    _validate_skill_metadata(name, final_display, final_category, final_desc, final_triggers, final_body)

    final_refs = references if references is not None else _safe_load_json(existing.references)
    final_constraints = writing_constraints if writing_constraints is not None else (existing.writing_constraints or "")

    existing.display_name = final_display.strip()
    existing.category = final_category.strip()
    existing.description = final_desc.strip()
    existing.triggers = _json.dumps(final_triggers, ensure_ascii=False)
    existing.body = final_body.strip()
    existing.references = _json.dumps(final_refs, ensure_ascii=False) if final_refs else None
    existing.writing_constraints = final_constraints

    await db.commit()
    await db.refresh(existing)
    return _user_skill_to_dict(existing, is_system_default=False, is_custom=True)


async def delete_user_skill(user_id: str, skill_key: str, db: "_AsyncSession") -> bool:
    """删除用户个人 Skill（副本或自建均可，系统预置本身不受影响）"""
    result = await db.execute(
        _select(_UserSkill).where(
            _UserSkill.user_id == user_id,
            _UserSkill.skill_key == skill_key,
        )
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise ValueError(f"未找到个人 Skill: {skill_key}")

    await db.delete(existing)
    await db.commit()
    return True


async def reset_user_skill_to_system(user_id: str, skill_key: str,
                                     db: "_AsyncSession") -> bool:
    """重置：删除用户个人副本，回退到系统预置

    仅对 is_custom=False 的副本有效；自建 Skill 不能 reset（应直接 delete）。
    """
    result = await db.execute(
        _select(_UserSkill).where(
            _UserSkill.user_id == user_id,
            _UserSkill.skill_key == skill_key,
        )
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise ValueError(f"未找到个人 Skill: {skill_key}")
    if existing.is_custom:
        raise ValueError(f"Skill {skill_key} 是用户自建，无法重置，请使用删除")

    # 校验系统预置仍存在
    if not _is_system_preset_key(skill_key):
        raise ValueError(f"系统预置 Skill {skill_key} 不存在，无法重置")

    await db.delete(existing)
    await db.commit()
    return True


async def get_skill_by_trigger_for_user(user_input: str, user_id: str,
                                        db: "_AsyncSession") -> Optional[Dict]:
    """根据用户输入匹配 Skill（基于用户可见的 Skill 列表）"""
    skills = await get_all_skills_for_user(user_id, db)
    user_input_lower = user_input.lower().strip()

    # 1. 触发词匹配（与原 get_skill_by_trigger 一致逻辑）
    for skill in skills:
        triggers = skill.get('triggers', [])
        for trigger in triggers:
            trigger_lower = trigger.lower()
            if user_input_lower == trigger_lower:
                return skill
            if user_input_lower.startswith(trigger_lower):
                return skill

    # 2. 自然语言模糊匹配（基于 template_key）
    keyword_map = {
        "长篇写作": ["SKILL_STORY_LONG_WRITE"],
        "写长篇": ["SKILL_STORY_LONG_WRITE"],
        "帮我开书": ["SKILL_STORY_LONG_WRITE"],
        "写大纲": ["SKILL_STORY_LONG_WRITE"],
        "短篇写作": ["SKILL_STORY_SHORT_WRITE"],
        "写短篇": ["SKILL_STORY_SHORT_WRITE"],
        "写个盐言": ["SKILL_STORY_SHORT_WRITE"],
        "长篇拆文": ["SKILL_STORY_LONG_ANALYZE"],
        "拆书": ["SKILL_STORY_LONG_ANALYZE"],
        "分析黄金三章": ["SKILL_STORY_LONG_ANALYZE"],
        "短篇拆文": ["SKILL_STORY_SHORT_ANALYZE"],
        "分析短篇": ["SKILL_STORY_SHORT_ANALYZE"],
        "长篇扫榜": ["SKILL_STORY_LONG_SCAN"],
        "长篇什么火": ["SKILL_STORY_LONG_SCAN"],
        "起点排行": ["SKILL_STORY_LONG_SCAN"],
        "短篇扫榜": ["SKILL_STORY_SHORT_SCAN"],
        "短篇什么火": ["SKILL_STORY_SHORT_SCAN"],
        "去ai味": ["SKILL_STORY_DESLOP"],
        "去味": ["SKILL_STORY_DESLOP"],
        "太ai了": ["SKILL_STORY_DESLOP"],
        "润色": ["SKILL_STORY_DESLOP"],
        "文风学习": ["SKILL_STORY_STYLE_EXTRACT"],
        "学习我的文风": ["SKILL_STORY_STYLE_EXTRACT"],
        "提取文风": ["SKILL_STORY_STYLE_EXTRACT"],
        "分析我的写作风格": ["SKILL_STORY_STYLE_EXTRACT"],
        "我的写作风格": ["SKILL_STORY_STYLE_EXTRACT"],
        "浏览器": ["SKILL_BROWSER_CDP"],
    }

    for keyword, skill_keys in keyword_map.items():
        if keyword in user_input_lower:
            for skill in skills:
                if skill.get('template_key') in skill_keys:
                    return skill

    return None


def _safe_load_json(raw: Optional[str]) -> Dict[str, str]:
    """安全加载 JSON 字符串为 dict，失败返回空 dict"""
    if not raw:
        return {}
    try:
        parsed = _json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}
