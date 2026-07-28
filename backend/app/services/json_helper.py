"""JSON 处理工具类"""
import json
import re
from typing import Any, Dict, List, Union
from app.logger import get_logger, safe_preview

try:
    import json5
    HAS_JSON5 = True
except ImportError:
    HAS_JSON5 = False

logger = get_logger(__name__)


# 中文引号/括号到ASCII的映射
_QUOTE_MAP = {
    '\u201c': '"',  # " → "
    '\u201d': '"',  # " → "
    '\u2018': "'",  # ' → '
    '\u2019': "'",  # ' → '
    '\u300e': '"',  # 『 → "
    '\u300f': '"',  # 』 → "
    '\u300c': '"',  # 「 → "
    '\u300d': '"',  # 」 → "
}


def _is_content_quote(text: str, pos: int) -> bool:
    """
    判断字符串值内的 '"' 是否为内容引号（需转义）而非 JSON 结束引号。
    
    合法 JSON 中，字符串结束引号之后的非空白字符必须是：
    ',' (值分隔) / '}' (关闭对象) / ']' (关闭数组)
    
    如果 '"' 后面不符合这些模式，则是 AI 写入的内容引号，需要转义。
    """
    j = pos + 1
    
    # 跳过空格和制表符
    while j < len(text) and text[j] in ' \t':
        j += 1
    
    if j >= len(text):
        return False  # 文本末尾，视为结束引号
    
    ch = text[j]
    
    # } 或 ] → 结束引号
    if ch in ('}', ']'):
        return False
    
    # 换行 → 检查下一行开头判断
    if ch == '\n' or ch == '\r':
        k = j + (2 if (ch == '\r' and j + 1 < len(text) and text[j + 1] == '\n') else 1)
        while k < len(text) and text[k] in ' \t':
            k += 1
        if k >= len(text):
            return False
        # 下一行以 " (JSON key) 或 } 或 ] 开头 → 结束引号
        if text[k] == '"' or text[k] in ('}', ']'):
            return False
        return True
    
    # , → 需要检查逗号后面是什么
    if ch == ',':
        k = j + 1
        while k < len(text) and text[k] in ' \t':
            k += 1
        
        if k >= len(text):
            return False
        
        # 逗号后跟换行 → 检查下一行
        if text[k] in ('\n', '\r'):
            k2 = k + (2 if (text[k] == '\r' and k + 1 < len(text) and text[k + 1] == '\n') else 1)
            while k2 < len(text) and text[k2] in ' \t\n\r':
                k2 += 1
            if k2 >= len(text):
                return False
            if text[k2] == '"' or text[k2] in ('}', ']'):
                return False
            return True
        
        after_comma = text[k]
        
        # 结构性逗号后应为 JSON 值的开头
        if after_comma == '"':
            return False  # 字符串值或 key
        if after_comma.isdigit() or after_comma == '-':
            return False  # 数字
        if after_comma in ('{', '['):
            return False  # 对象/数组
        if text[k:k+4] in ('true', 'null'):
            return False
        if text[k:k+5] == 'false':
            return False
        
        # 逗号后不是 JSON 值开头 → 内容逗号，引号是内容引号
        return True
    
    # : → 通常在字符串结束后不可能出现，保守处理为结束引号
    if ch == ':':
        return False
    
    # 其他字符（中文、字母等）→ 内容引号
    return True


def _fix_json_string_values(text: str) -> str:
    """
    上下文感知的 JSON 修复，区分字符串内外分别处理。
    
    字符串值内：
    1. 裸换行符/制表符 → 转义
    2. 中文引号（""等） → 转义为 \\"
    3. 未转义的 ASCII 双引号 → 智能检测：内容引号转义，结束引号保留
    4. 中文逗号/冒号 → 保留原样（是内容字符）
    
    结构位置（字符串外）：
    1. 中文引号 → ASCII 引号
    2. 中文逗号 → ASCII 逗号
    3. 中文冒号 → ASCII 冒号
    """
    if not text or '"' not in text:
        return text
    
    result = []
    i = 0
    in_string = False
    fixed_count = 0
    
    while i < len(text):
        c = text[i]
        
        # === 非字符串内（结构位置）===
        if not in_string:
            # 结构位置的中文标点 → ASCII
            if c == '\uff0c':  # ，→ ,
                result.append(',')
                fixed_count += 1
                i += 1
                continue
            if c == '\uff1a':  # ：→ :
                result.append(':')
                fixed_count += 1
                i += 1
                continue
            if c in _QUOTE_MAP:
                result.append(_QUOTE_MAP[c])
                fixed_count += 1
                i += 1
                continue
            
            # ASCII 双引号 → 进入字符串
            if c == '"':
                in_string = True
                result.append(c)
                i += 1
                continue
            
            result.append(c)
            i += 1
            continue
        
        # === 字符串值内 ===
        
        # 转义字符处理
        if c == '\\':
            if i + 1 < len(text):
                next_c = text[i + 1]
                if next_c in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't'):
                    result.append(c)
                    result.append(next_c)
                    i += 2
                    continue
                elif next_c == 'u':
                    if i + 5 < len(text) and all(text[i+2+k] in '0123456789abcdefABCDEF' for k in range(4)):
                        result.append(text[i:i+6])
                        i += 6
                        continue
                    else:
                        result.append(next_c)
                        fixed_count += 1
                        i += 2
                        continue
                else:
                    result.append(next_c)
                    fixed_count += 1
                    i += 2
                    continue
            else:
                fixed_count += 1
                i += 1
                continue
        
        # ASCII 双引号 → 智能判断是结束引号还是内容引号
        if c == '"':
            if _is_content_quote(text, i):
                # 内容引号，需要转义
                result.append('\\')
                result.append('"')
                fixed_count += 1
                i += 1
                continue
            else:
                # 结束引号
                in_string = False
                result.append(c)
                i += 1
                continue
        
        # 裸换行符 → 转义
        if c == '\n':
            result.append('\\')
            result.append('n')
            fixed_count += 1
            i += 1
            continue
        
        if c == '\r':
            if i + 1 < len(text) and text[i + 1] == '\n':
                result.append('\\')
                result.append('n')
                fixed_count += 1
                i += 2
            else:
                result.append('\\')
                result.append('n')
                fixed_count += 1
                i += 1
            continue
        
        if c == '\t':
            result.append('\\')
            result.append('t')
            fixed_count += 1
            i += 1
            continue
        
        # 中文引号处理
        if c in _QUOTE_MAP:
            mapped = _QUOTE_MAP[c]
            if mapped == '"':
                # 中文双引号在字符串内需要转义
                result.append('\\')
                result.append('"')
            else:
                # 中文单引号在双引号字符串内不需要转义，直接替换
                result.append(mapped)
            fixed_count += 1
            i += 1
            continue
        
        # 其他字符（包括中文逗号、中文冒号）→ 保留原样
        result.append(c)
        i += 1
    
    if fixed_count > 0:
        logger.debug(f"✅ 修复了{fixed_count}个JSON问题（引号/控制字符/中文标点）")
    
    return ''.join(result)


def _fix_all_invalid_escapes(text: str) -> str:
    """
    兜底修复：扫描整个文本中的无效JSON转义序列。
    
    当 _fix_json_string_values 因字符串边界追踪错误而遗漏某些无效转义时，
    此函数作为兜底，不依赖字符串状态追踪，扫描整个文本修复所有无效转义。
    
    有效JSON转义：\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX
    其他 \\X 均为无效转义，修复方式为去掉反斜杠只保留字符。
    """
    if '\\' not in text:
        return text
    
    result = []
    i = 0
    fixed = 0
    
    while i < len(text):
        if text[i] == '\\' and i + 1 < len(text):
            next_c = text[i + 1]
            if next_c in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't'):
                # 有效转义，保留
                result.append(text[i])
                result.append(next_c)
                i += 2
                continue
            elif next_c == 'u':
                # Unicode 转义，检查是否有4个十六进制字符
                if i + 5 < len(text) and all(
                    text[i + 2 + k] in '0123456789abcdefABCDEF' 
                    for k in range(4)
                ):
                    result.append(text[i:i + 6])
                    i += 6
                    continue
                else:
                    # 不完整的unicode转义，去掉反斜杠
                    result.append(next_c)
                    fixed += 1
                    i += 2
                    continue
            else:
                # 无效转义（如 \引 \影 \某种 等），去掉反斜杠只保留字符
                result.append(next_c)
                fixed += 1
                i += 2
                continue
        else:
            result.append(text[i])
            i += 1
    
    if fixed > 0:
        logger.info(f"✅ 兜底修复了{fixed}个无效JSON转义序列")
    
    return ''.join(result)


def _fix_multiple_objects_as_value(text: str) -> str:
    """
    修复AI生成的JSON中，多个对象作为属性值但未合并的问题。
    
    示例：
        "key": {"a": "1"}, {"b": "2"}  →  "key": {"a": "1", "b": "2"}
    
    AI有时在输出对象类型的属性值时，输出了多个独立的对象而不是合并为一个。
    例如 relationship_changes 字段输出多个角色关系变化时可能出现此问题。
    此函数检测并合并这些对象。
    """
    if '{' not in text or '}' not in text:
        return text
    
    # 匹配嵌套层级不超过2的对象: { ... } 其中 ... 不含 { 或仅含单层嵌套
    nested_obj = r'\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}'
    
    # 模式：属性冒号后跟一个对象，然后逗号和另一个对象（没有属性名）
    # 即 "key": {obj1}, {obj2} → "key": {obj1, obj2}
    pattern = r'(":)\s*(' + nested_obj + r')\s*,\s*(' + nested_obj + r')'
    
    def merge_objects(match):
        colon = match.group(1)
        obj1_content = match.group(2)[1:-1]  # 去掉外层的 { }
        obj2_content = match.group(3)[1:-1]  # 去掉外层的 { }
        # 合并为一个对象
        return f'{colon} {{{obj1_content}, {obj2_content}}}'
    
    prev = None
    count = 0
    max_iterations = 10
    while prev != text and count < max_iterations:
        prev = text
        text = re.sub(pattern, merge_objects, text)
        count += 1
    
    if count > 1:
        logger.info(f"✅ 修复了{count - 1}处多对象属性值合并")
    
    return text


def _truncate_and_close(text: str) -> str:
    """
    截断 JSON 到最后一个合法元素边界，并自动补全闭合括号。

    当 AI 输出被截断（流式超时、token 耗尽）或 JSON 中间部分损坏时，
    逐步从后往前找到可以截断的位置，丢弃损坏的尾部，补全闭合括号。

    策略：
    1. 从后往前扫描，找到最后一个 , 或 : 的位置（这些是元素分隔符）
    2. 截断到该位置之前（丢弃不完整的元素）
    3. 补全未闭合的括号和字符串
    """
    if not text:
        return text

    # 先尝试找到最后一个合法的截断点
    # 合法截断点：字符串值结束后的逗号、数组/对象元素结束后的逗号
    # 从后往前找，跳过空白和尾部垃圾

    best_result = text  # 默认不截断

    # 从后往前逐步尝试截断
    # 找所有可能的截断位置：逗号后紧跟 { 或 " 或 [ 或数字
    # 或 逗号后换行
    truncate_positions = []

    for i in range(len(text) - 1, 0, -1):
        c = text[i]
        # 逗号是元素分隔符，可能是好的截断点
        if c == ',':
            # 检查逗号前面是否在字符串内（粗略判断）
            # 逗号后面跳过空白后应该是下一个元素的开始
            j = i + 1
            while j < len(text) and text[j] in ' \t\n\r':
                j += 1
            if j < len(text) and text[j] in ('"', '{', '[', 't', 'f', 'n') or text[j].isdigit() or text[j] == '-':
                # 这是一个合法的元素分隔逗号，截断到这里（保留逗号前的元素）
                truncate_positions.append(i)
        # 冒号后面跟值也是截断点（丢弃不完整的键值对）
        elif c == ':':
            j = i + 1
            while j < len(text) and text[j] in ' \t\n\r':
                j += 1
            if j < len(text) and text[j] in ('"', '{', '[', 't', 'f', 'n') or text[j].isdigit() or text[j] == '-':
                truncate_positions.append(i)

    # 依次尝试每个截断位置
    for pos in truncate_positions:
        candidate = text[:pos]  # 截断到逗号/冒号之前

        # 重新计算栈状态
        stack = []
        in_string = False
        k = 0
        while k < len(candidate):
            ch = candidate[k]
            if ch == '"':
                if not in_string:
                    in_string = True
                else:
                    num_bs = 0
                    m = k - 1
                    while m >= 0 and candidate[m] == '\\':
                        num_bs += 1
                        m -= 1
                    if num_bs % 2 == 0:
                        in_string = False
                k += 1
                continue
            if in_string:
                k += 1
                continue
            if ch in ('{', '['):
                stack.append(ch)
            elif ch == '}' and stack and stack[-1] == '{':
                stack.pop()
            elif ch == ']' and stack and stack[-1] == '[':
                stack.pop()
            k += 1

        # 闭合未闭合的字符串
        if in_string:
            candidate += '"'

        # 补全未闭合的括号
        close_map = {'{': '}', '[': ']'}
        for opener in reversed(stack):
            candidate += close_map[opener]

        # 尝试解析
        try:
            json.loads(candidate)
            logger.info(f"✅ 截断修复成功：截断到位置 {pos}，丢弃了 {len(text) - pos} 个尾部字符")
            return candidate
        except json.JSONDecodeError:
            continue

    # 所有截断位置都失败，返回原文
    return best_result


def clean_json_response(text: str) -> str:
    """清洗 AI 返回的 JSON（改进版 - 流式安全）"""
    try:
        if not text:
            logger.warning("⚠️ clean_json_response: 输入为空")
            return text
        
        original_length = len(text)
        logger.debug(f"🔍 开始清洗JSON，原始长度: {original_length}")
        
        # 上下文感知修复：中文引号/逗号/冒号、裸控制字符、未转义的内容引号
        # （区分字符串内外：结构位置替换为ASCII，字符串内保留或转义）
        text = _fix_json_string_values(text)
        
        # 去除 markdown 代码块
        text = re.sub(r'^```json\s*\n?', '', text, flags=re.MULTILINE | re.IGNORECASE)
        text = re.sub(r'^```\s*\n?', '', text, flags=re.MULTILINE)
        text = re.sub(r'\n?```\s*$', '', text, flags=re.MULTILINE)
        text = text.strip()
        
        if len(text) != original_length:
            logger.debug(f"   移除markdown后长度: {len(text)}")
        
        # 尝试直接解析（快速路径）
        try:
            json.loads(text)
            logger.debug(f"✅ 直接解析成功，无需清洗")
            return text
        except Exception:
            pass
        
        # 找到第一个 { 或 [
        start = -1
        for i, c in enumerate(text):
            if c in ('{', '['):
                start = i
                break
        
        if start == -1:
            logger.warning(f"⚠️ 未找到JSON起始符号 {{ 或 [")
            logger.debug(f"   文本预览: {safe_preview(text, 200)}")
            return text
        
        if start > 0:
            logger.debug(f"   跳过前{start}个字符")
            text = text[start:]
        
        # 改进的括号匹配算法（更严格的字符串处理 + 不匹配修复 + 自动补全）
        stack = []
        i = 0
        end = -1
        in_string = False
        # 记录需要插入的闭合括号（用于修复不匹配的括号）
        insertions = []  # [(position, char)]

        while i < len(text):
            c = text[i]

            # 处理字符串状态
            if c == '"':
                if not in_string:
                    # 进入字符串
                    in_string = True
                else:
                    # 检查是否是转义的引号
                    num_backslashes = 0
                    j = i - 1
                    while j >= 0 and text[j] == '\\':
                        num_backslashes += 1
                        j -= 1

                    # 偶数个反斜杠表示引号未被转义，字符串结束
                    if num_backslashes % 2 == 0:
                        in_string = False

                i += 1
                continue

            # 在字符串内部，跳过所有字符
            if in_string:
                i += 1
                continue

            # 处理括号（只有在字符串外部才有效）
            if c == '{' or c == '[':
                stack.append(c)
            elif c == '}':
                if len(stack) > 0 and stack[-1] == '{':
                    stack.pop()
                    if len(stack) == 0:
                        end = i + 1
                        logger.debug(f"✅ 找到JSON结束位置: {end}")
                        break
                elif len(stack) > 0:
                    # 括号不匹配：栈顶是 [ 但遇到了 }
                    # 尝试修复：先闭合栈顶的 [ → ]，然后匹配当前的 }
                    logger.warning(f"⚠️ 括号不匹配：遇到 }} 但栈顶是 {stack[-1]}，尝试修复")
                    # 在当前位置前插入 ] 来闭合栈顶的 [
                    if stack[-1] == '[':
                        insertions.append((i, ']'))
                        stack.pop()
                        # 现在栈顶可能是 {，再次检查
                        if len(stack) > 0 and stack[-1] == '{':
                            stack.pop()
                            if len(stack) == 0:
                                # 需要同时插入 ] 和 }
                                end = i + 1  # 原来的 } 还在
                                break
                        # 否则继续扫描
                    else:
                        logger.warning(f"⚠️ 无法修复的括号不匹配，跳过此 }}")
                else:
                    # 栈为空遇到 }，忽略多余的闭合括号
                    logger.warning(f"⚠️ 遇到多余的 }}，忽略")
            elif c == ']':
                if len(stack) > 0 and stack[-1] == '[':
                    stack.pop()
                    if len(stack) == 0:
                        end = i + 1
                        logger.debug(f"✅ 找到JSON结束位置: {end}")
                        break
                elif len(stack) > 0:
                    # 括号不匹配：栈顶是 { 但遇到了 ]
                    # 尝试修复：先闭合栈顶的 { → }，然后匹配当前的 ]
                    logger.warning(f"⚠️ 括号不匹配：遇到 ] 但栈顶是 {stack[-1]}，尝试修复")
                    if stack[-1] == '{':
                        insertions.append((i, '}'))
                        stack.pop()
                        if len(stack) > 0 and stack[-1] == '[':
                            stack.pop()
                            if len(stack) == 0:
                                end = i + 1
                                break
                    else:
                        logger.warning(f"⚠️ 无法修复的括号不匹配，跳过此 ]")
                else:
                    # 栈为空遇到 ]，忽略多余的闭合括号
                    logger.warning(f"⚠️ 遇到多余的 ]，忽略")

            i += 1

        # 检查未闭合的字符串
        if in_string:
            logger.warning(f"⚠️ 字符串未闭合，JSON可能不完整")

        # 应用括号插入修复
        if insertions:
            # 从后往前插入，避免位置偏移
            sorted_insertions = sorted(insertions, key=lambda x: x[0], reverse=True)
            text_list = list(text)
            for pos, char in sorted_insertions:
                text_list.insert(pos, char)
            text = ''.join(text_list)
            logger.info(f"✅ 插入了{len(insertions)}个修复括号")

        # 提取结果
        if end > 0:
            # 如果有插入，end 位置需要调整
            if insertions:
                offset = sum(1 for pos, _ in insertions if pos < end)
                end += offset
            result = text[:end]
            logger.debug(f"✅ JSON清洗完成，结果长度: {len(result)}")
        else:
            # 未找到结束位置，尝试自动补全未闭合的括号
            if stack or in_string:
                result = text
                # 先闭合未闭合的字符串
                if in_string:
                    result += '"'
                    logger.info(f"✅ 自动补全未闭合字符串")
                # 从内到外补全未闭合的括号
                close_map = {'{': '}', '[': ']'}
                for opener in reversed(stack):
                    result += close_map[opener]
                logger.info(f"✅ 自动补全了{len(stack)}个未闭合括号: {''.join(close_map[o] for o in reversed(stack))}")
                stack = []  # 栈已清空
            else:
                result = text
                logger.warning(f"⚠️ 未找到JSON结束位置，返回全部内容（长度: {len(result)}）")
        
        # 验证清洗后的结果
        try:
            json.loads(result)
            logger.debug(f"✅ 清洗后JSON验证成功")
        except json.JSONDecodeError as e:
            logger.warning(f"⚠️ 清洗后JSON仍然无效: {e}，尝试修复结构性问题...")
            
            # 修复1：合并多对象属性值（AI可能输出 "key": {a:1}, {b:2} ）
            result = _fix_multiple_objects_as_value(result)
            
            try:
                json.loads(result)
                logger.info(f"✅ 修复多对象属性值后JSON验证成功")
            except json.JSONDecodeError:
                pass  # 继续尝试其他修复
            else:
                return result
            
            # 修复2：兜底修复无效转义序列（不依赖字符串边界追踪）
            logger.warning(f"⚠️ 继续尝试兜底修复无效转义...")
            result = _fix_all_invalid_escapes(result)
            try:
                json.loads(result)
                logger.info(f"✅ 兜底修复后JSON验证成功")
            except json.JSONDecodeError as e2:
                # 修复3：再次尝试合并多对象属性值（转义修复后可能产生新的合并机会）
                result = _fix_multiple_objects_as_value(result)
                try:
                    json.loads(result)
                    logger.info(f"✅ 二次修复后JSON验证成功")
                except json.JSONDecodeError as e3:
                    # 修复4：截断到最后一个合法元素边界并补全闭合括号
                    # 处理 AI 输出截断或中间损坏的场景
                    logger.warning(f"⚠️ 尝试截断修复...")
                    truncated = _truncate_and_close(result)
                    if truncated != result:
                        try:
                            json.loads(truncated)
                            logger.info(f"✅ 截断修复后JSON验证成功")
                            result = truncated
                        except json.JSONDecodeError as e4:
                            logger.error(f"❌ 所有修复后JSON仍然无效: {e4}")
                            logger.debug(f"   结果预览: {safe_preview(result, 500)}")
                            logger.debug(f"   结果结尾长度: {min(len(result), 200)}")
                    else:
                        logger.error(f"❌ 所有修复后JSON仍然无效: {e3}")
                        logger.debug(f"   结果预览: {safe_preview(result, 500)}")
                        logger.debug(f"   结果结尾长度: {min(len(result), 200)}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ clean_json_response 出错: {e}")
        logger.error(f"   文本长度: {len(text) if text else 0}")
        logger.error(f"   文本预览: {safe_preview(text, 200)}")
        raise


def parse_json(text: str) -> Union[Dict, List]:
    """解析 JSON，优先使用标准json，失败后用json5容错解析"""
    cleaned = clean_json_response(text)
    
    # 优先使用标准 json
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, Exception):
        pass
    
    # json5 容错解析（处理单引号、多余逗号、宽松格式等）
    if HAS_JSON5:
        try:
            logger.info("🔄 标准JSON解析失败，使用json5容错解析")
            result = json5.loads(cleaned)
            logger.info("✅ json5容错解析成功")
            return result
        except Exception as e5:
            logger.error(f"❌ json5容错解析也失败: {e5}")
    
    # 最终失败
    logger.error(f"❌ parse_json 完全失败")
    logger.error(f"   原始文本长度: {len(text) if text else 0}")
    logger.error(f"   清洗后文本长度: {len(cleaned) if cleaned else 0}")
    logger.debug(f"   清洗后文本预览: {safe_preview(cleaned, 500)}")
    raise json.JSONDecodeError("JSON解析失败（标准和json5均失败）", cleaned, 0)


def loads_json(text: str) -> Any:
    """
    json.loads 的容错替代品，可直接替换 json.loads()。
    优先用标准 json.loads，失败后自动降级到 json5。
    适用于解析 AI 返回的、可能包含不规范格式的 JSON。
    """
    # 优先使用标准 json
    try:
        return json.loads(text)
    except (json.JSONDecodeError, Exception):
        pass
    
    # 兜底修复无效转义序列后重试
    fixed_text = _fix_all_invalid_escapes(text)
    if fixed_text != text:
        try:
            result = json.loads(fixed_text)
            logger.info("✅ 兜底修复无效转义后json.loads成功")
            return result
        except (json.JSONDecodeError, Exception):
            pass
    
    # json5 容错解析
    if HAS_JSON5:
        try:
            logger.info("🔄 json.loads失败，使用json5容错解析")
            result = json5.loads(text)
            logger.info("✅ json5容错解析成功")
            return result
        except Exception as e5:
            # json5也失败，尝试对修复后的文本使用json5
            if fixed_text != text:
                try:
                    result = json5.loads(fixed_text)
                    logger.info("✅ 兜底修复无效转义后json5容错解析成功")
                    return result
                except Exception:
                    pass
            logger.error(f"❌ json5容错解析也失败: {e5}")
    
    # 最终失败，抛出标准异常
    raise json.JSONDecodeError("JSON解析失败（标准和json5均失败）", text, 0)
