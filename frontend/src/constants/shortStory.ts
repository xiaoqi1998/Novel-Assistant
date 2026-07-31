import type { ReactNode } from 'react';
import { createElement } from 'react';
import {
  ClockCircleOutlined,
  EditOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  AuditOutlined,
  TrophyOutlined,
} from '@ant-design/icons';

/**
 * 情绪目标配置（6 种）
 *
 * 颜色规范（Task 41.3）：6 个色相拉开区分，避免视觉混淆
 * - 意难平:     purple    （深沉遗憾）
 * - #反转震撼:  geekblue  （震撼蓝）
 * - 爽感释放:   gold      （爽快金）
 * - 治愈温暖:   green     （温暖绿，与意难平 purple 区分）
 * - 细思极恐:   magenta   （诡异粉紫，与意难平 purple 区分）
 * - 共鸣感动:   volcano   （暖橙红，与爽感 gold 区分）
 */
export interface EmotionGoalCurvePoint {
  stage: string;
  emotion: string;
  intensity: number;
}

export interface EmotionGoal {
  value: string;
  label: string;
  desc: string;
  color: string;
  default_curve: EmotionGoalCurvePoint[];
}

export const EMOTION_GOALS: EmotionGoal[] = [
  {
    value: '意难平',
    label: '意难平',
    desc: '主角错过或失去，留下深沉遗憾与回味',
    color: 'purple',
    default_curve: [
      { stage: 'opening', emotion: '紧张/震惊', intensity: 7 },
      { stage: 'buildup', emotion: '愤怒/屈辱', intensity: 9 },
      { stage: 'twist', emotion: '爽感/震撼', intensity: 10 },
      { stage: 'ending', emotion: '释怀/余味', intensity: 6 },
    ],
  },
  {
    value: '反转震撼',
    label: '反转震撼',
    desc: '通过出人意料的反转带来震撼与顿悟',
    color: 'geekblue',
    default_curve: [
      { stage: 'opening', emotion: '疑惑/好奇', intensity: 6 },
      { stage: 'buildup', emotion: '困惑/焦虑', intensity: 8 },
      { stage: 'twist', emotion: '震撼/顿悟', intensity: 10 },
      { stage: 'ending', emotion: '回味/惊叹', intensity: 7 },
    ],
  },
  {
    value: '爽感释放',
    label: '爽感释放',
    desc: '主角逆袭打脸，让读者获得情绪宣泄',
    color: 'gold',
    default_curve: [
      { stage: 'opening', emotion: '紧张/震惊', intensity: 7 },
      { stage: 'buildup', emotion: '愤怒/屈辱', intensity: 9 },
      { stage: 'twist', emotion: '爽感/释放', intensity: 10 },
      { stage: 'ending', emotion: '畅快/满足', intensity: 8 },
    ],
  },
  {
    value: '治愈温暖',
    label: '治愈温暖',
    desc: '温暖治愈的情感流转，让人心生暖意',
    color: 'green',
    default_curve: [
      { stage: 'opening', emotion: '低落/迷茫', intensity: 4 },
      { stage: 'buildup', emotion: '触动/共鸣', intensity: 6 },
      { stage: 'twist', emotion: '温暖/治愈', intensity: 8 },
      { stage: 'ending', emotion: '满足/余温', intensity: 7 },
    ],
  },
  {
    value: '细思极恐',
    label: '细思极恐',
    desc: '表层平静下藏着的诡异真相，让人不寒而栗',
    color: 'magenta',
    default_curve: [
      { stage: 'opening', emotion: '平静/疑惑', intensity: 5 },
      { stage: 'buildup', emotion: '不安/怀疑', intensity: 7 },
      { stage: 'twist', emotion: '恐惧/震撼', intensity: 10 },
      { stage: 'ending', emotion: '细思极恐', intensity: 8 },
    ],
  },
  {
    value: '共鸣感动',
    label: '共鸣感动',
    desc: '触动人心的情感共鸣，引发读者共情',
    color: 'volcano',
    default_curve: [
      { stage: 'opening', emotion: '平淡/代入', intensity: 5 },
      { stage: 'buildup', emotion: '触动/共鸣', intensity: 7 },
      { stage: 'twist', emotion: '感动/泪点', intensity: 9 },
      { stage: 'ending', emotion: '余味/回味', intensity: 8 },
    ],
  },
];

/**
 * 情绪目标颜色映射（按 value 索引，便于从故事字段直接查色）
 */
export const EMOTION_GOAL_COLOR: Record<string, { color: string; label: string }> =
  EMOTION_GOALS.reduce(
    (acc, item) => {
      acc[item.value] = { color: item.color, label: item.label };
      return acc;
    },
    {} as Record<string, { color: string; label: string }>,
  );

/**
 * 故事状态配置
 * - planning:    规划
 * - writing:     创作
 * - generating:  AI 生成中
 * - generated:   AI 已生成
 * - polishing:   精修
 * - completed:   已完结
 */
export interface StoryStatusCfg {
  label: string;
  color: string;
  icon?: ReactNode;
}

export const STORY_STATUS_CONFIG: Record<string, StoryStatusCfg> = {
  planning: { label: '规划', color: 'blue', icon: createElement(ClockCircleOutlined) },
  writing: { label: '创作', color: 'green', icon: createElement(EditOutlined) },
  generating: { label: '生成中', color: 'processing', icon: createElement(ThunderboltOutlined) },
  generated: { label: '已生成', color: 'cyan', icon: createElement(CheckCircleOutlined) },
  polishing: { label: '精修', color: 'orange', icon: createElement(AuditOutlined) },
  completed: { label: '已完结', color: 'purple', icon: createElement(TrophyOutlined) },
};

/**
 * 故事阶段配置
 *
 * 包含两套阶段定义：
 * - 内容分段阶段（4 段）：hook / escalation / climax / resolution
 * - 情绪曲线阶段（4 段）：opening / buildup / twist / ending
 *
 * 注：内容分段阶段使用 antd 预设色名（blue/gold/purple/cyan），
 * 情绪曲线阶段使用具体色值（与 EmotionCurve 历史实现保持一致，用于 SVG/Tag 渲染）。
 */
export interface StoryStageCfg {
  label: string;
  color: string;
  desc?: string;
}

export const STORY_STAGE_CONFIG: Record<string, StoryStageCfg> = {
  // 内容分段阶段
  hook: { label: '钩子', color: 'blue', desc: '开篇黄金钩子，前 300 字抓住注意力' },
  escalation: { label: '激化', color: 'gold', desc: '冲突激化与打压，反派嚣张主角劣势' },
  climax: { label: '高潮', color: 'purple', desc: '反转与高潮，亮出底牌的爆点' },
  resolution: { label: '收尾', color: 'cyan', desc: '收尾与爽点释放' },
  // 情绪曲线阶段
  opening: {
    label: '开头（死亡黄金钩子）',
    color: '#1677ff',
    desc: '前300字抛出核心危机现场，情绪紧张/震惊',
  },
  buildup: {
    label: '铺垫（冲突激化与打压）',
    color: '#fa8c16',
    desc: '反派嚣张主角劣势，愤怒/屈辱感拉到最高',
  },
  twist: {
    label: '反转（绝地反击）',
    color: '#f5222d',
    desc: '亮出底牌，剥洋葱式揭露，爆点情绪',
  },
  ending: {
    label: '结尾（爽点收尾）',
    color: '#722ed1',
    desc: '情绪释放，主角走向新人生，余味悠长',
  },
};

/**
 * 自查清单 8 类
 * - group: '开头' / '结构' / '人设'（用于按组聚合展示）
 */
export interface ChecklistCategoryCfg {
  color: string;
  group: string;
}

export const CHECKLIST_CATEGORIES: Record<string, ChecklistCategoryCfg> = {
  '开头查验': { color: 'blue', group: '开头' },
  '选题查验': { color: 'blue', group: '开头' },
  '卡点查验': { color: 'gold', group: '结构' },
  '废话查验': { color: 'gold', group: '结构' },
  '情绪曲线': { color: 'gold', group: '结构' },
  '去AI味查验': { color: 'gold', group: '结构' },
  '人设查验': { color: 'purple', group: '人设' },
  '对话查验': { color: 'purple', group: '人设' },
};

/**
 * 评分 5 维度
 *
 * 维度色按类别分组：
 * - 内容类（blue）：concept / structure
 * - 技术类（gold）：emotion
 * - 表达类（purple）：character / polish
 */
export interface StoryDimensionCfg {
  key: string;
  label: string;
  max_score: number;
  color: string;
}

export const STORY_DIMENSIONS: Record<string, StoryDimensionCfg> = {
  concept: { key: 'concept', label: '选题', max_score: 20, color: 'blue' },
  structure: { key: 'structure', label: '结构', max_score: 20, color: 'blue' },
  emotion: { key: 'emotion', label: '情绪', max_score: 20, color: 'gold' },
  character: { key: 'character', label: '人设对话', max_score: 20, color: 'purple' },
  polish: { key: 'polish', label: '完成度', max_score: 20, color: 'purple' },
};

/**
 * 评分等级颜色映射（使用 antd 预设语义色，深色模式自动适配）
 */
export const SCORE_LEVEL_COLOR: Record<string, string> = {
  '优秀': 'success',
  '良好': 'processing',
  '合格': 'warning',
  '待改进': 'error',
};
