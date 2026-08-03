/**
 * AI 动作用途常量 - 按行为动作分配不同 AI 模型
 *
 * 与后端 app/constants/ai_usages.py 保持一致。
 * 新增动作时两处同步修改。
 */

export const GROUP_CORE = 'core';
export const GROUP_ASSIST = 'assist';
export const GROUP_ANALYSIS = 'analysis';

export interface AIUsageInfo {
  usage: string;
  label: string;
  description: string;
}

export interface AIUsageGroup {
  group: string;
  groupLabel: string;
  actions: AIUsageInfo[];
}

/** 动作分组中文名 */
export const GROUP_LABELS: Record<string, string> = {
  [GROUP_CORE]: '核心创作',
  [GROUP_ASSIST]: '辅助生成',
  [GROUP_ANALYSIS]: '分析类',
};

/** 分组顺序 */
export const GROUP_ORDER = [GROUP_CORE, GROUP_ASSIST, GROUP_ANALYSIS];

/** 全部动作定义（usage → 中文名 + 分组 + 说明） */
export const AI_USAGES: Record<string, { label: string; group: string; description: string }> = {
  default: { label: '默认配置', group: GROUP_CORE, description: '未单独配置的动作均使用此配置' },
  chapter_generation: { label: '章节正文生成', group: GROUP_CORE, description: '生成章节正文，主力消耗' },
  chapter_regeneration: { label: '整章重新生成', group: GROUP_CORE, description: '基于反馈重写整章' },
  partial_rewrite: { label: '局部重写', group: GROUP_CORE, description: '选区重写 / 一键改进' },
  outline: { label: '大纲生成', group: GROUP_CORE, description: '生成 / 重生成大纲' },
  wizard: { label: '向导生成', group: GROUP_CORE, description: '智能向导生成大纲、角色、世界观' },
  short_story: { label: '短故事生成', group: GROUP_CORE, description: '一键生成短篇故事' },
  polish: { label: 'AI 去味 / 润色', group: GROUP_ASSIST, description: '去除 AI 味、润色改写' },
  inspiration: { label: '灵感建议', group: GROUP_ASSIST, description: '生成灵感与情节建议' },
  character: { label: '角色卡生成', group: GROUP_ASSIST, description: '生成角色资料' },
  character_arc: { label: '角色弧光分析', group: GROUP_ASSIST, description: '分析角色成长弧光' },
  career: { label: '职业生成', group: GROUP_ASSIST, description: '生成职业信息' },
  organization: { label: '组织生成', group: GROUP_ASSIST, description: '生成组织 / 门派' },
  writing_style: { label: '写作风格', group: GROUP_ASSIST, description: '分析 / 生成写作风格' },
  chapter_analysis: { label: '章节内容分析', group: GROUP_ANALYSIS, description: '分析章节质量并反馈' },
  full_review: { label: '全文审查', group: GROUP_ANALYSIS, description: '整书一致性审查' },
  book_import: { label: '拆书导入', group: GROUP_ANALYSIS, description: '导入外部书籍并解析' },
  tianming: { label: '天命', group: GROUP_ANALYSIS, description: '天命相关 AI 调用' },
};

/** 前端渲染用的分组列表 */
export function usageListForFrontend(): AIUsageGroup[] {
  const groups: Record<string, AIUsageInfo[]> = {};
  for (const [usage, info] of Object.entries(AI_USAGES)) {
    if (!groups[info.group]) groups[info.group] = [];
    groups[info.group].push({ usage, label: info.label, description: info.description });
  }
  return GROUP_ORDER
    .filter((g) => groups[g]?.length)
    .map((g) => ({ group: g, groupLabel: GROUP_LABELS[g], actions: groups[g] }));
}
