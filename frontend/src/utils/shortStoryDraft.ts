/**
 * 短故事本地草稿保护（localStorage 双层备份）
 *
 * 与长篇小说的 chapter draft 保护对齐：
 * - 编辑时防抖保存到 localStorage（与 API 保存并行）
 * - 加载时检测本地草稿是否比服务器版本新，提示恢复
 * - API 保存成功后清除本地草稿
 *
 * 支持两种草稿：
 * 1. 正文草稿（content）—— key: `mobinovel_short_story_draft_{storyId}_content`
 * 2. 设定草稿（setup 字段集合）—— key: `mobinovel_short_story_draft_{storyId}_setup`
 * 3. 统一草稿（content + polish_notes + checklist）—— key: `mobinovel_short_story_draft_{storyId}`
 *    通过 hasDraft / loadDraft / saveDraft / clearDraft 操作，自带时间比较与 null 校验。
 */

import type { ShortStoryDraft, ShortStoryChecklistItem } from '../types';

export interface ShortStoryContentDraft {
  storyId: string;
  content: string;
  savedAt: number;
}

export interface ShortStorySetupDraft {
  storyId: string;
  fields: Record<string, string>;
  savedAt: number;
}

const getContentDraftKey = (storyId: string): string =>
  `mobinovel_short_story_draft_${storyId}_content`;

const getSetupDraftKey = (storyId: string): string =>
  `mobinovel_short_story_draft_${storyId}_setup`;

// ============ 正文草稿 ============

export const loadStoryContentDraft = (
  storyId: string
): ShortStoryContentDraft | null => {
  try {
    const raw = localStorage.getItem(getContentDraftKey(storyId));
    if (!raw) return null;
    const data = JSON.parse(raw) as ShortStoryContentDraft;
    if (
      !data ||
      typeof data.content !== 'string' ||
      typeof data.savedAt !== 'number'
    ) {
      return null;
    }
    return data;
  } catch (error) {
    console.warn('读取短故事正文草稿失败:', error);
    return null;
  }
};

export const saveStoryContentDraft = (
  storyId: string,
  content: string
): void => {
  try {
    const draft: ShortStoryContentDraft = {
      storyId,
      content,
      savedAt: Date.now(),
    };
    localStorage.setItem(getContentDraftKey(storyId), JSON.stringify(draft));
  } catch (error) {
    console.warn('保存短故事正文草稿失败:', error);
  }
};

export const clearStoryContentDraft = (storyId: string): void => {
  try {
    localStorage.removeItem(getContentDraftKey(storyId));
  } catch (error) {
    console.warn('清除短故事正文草稿失败:', error);
  }
};

// ============ 设定草稿 ============

export const loadStorySetupDraft = (
  storyId: string
): ShortStorySetupDraft | null => {
  try {
    const raw = localStorage.getItem(getSetupDraftKey(storyId));
    if (!raw) return null;
    const data = JSON.parse(raw) as ShortStorySetupDraft;
    if (
      !data ||
      typeof data !== 'object' ||
      data.fields === null ||
      typeof data.fields !== 'object' ||
      typeof data.savedAt !== 'number'
    ) {
      return null;
    }
    return data;
  } catch (error) {
    console.warn('读取短故事设定草稿失败:', error);
    return null;
  }
};

export const saveStorySetupDraft = (
  storyId: string,
  fields: Record<string, string>
): void => {
  try {
    const draft: ShortStorySetupDraft = {
      storyId,
      fields,
      savedAt: Date.now(),
    };
    localStorage.setItem(getSetupDraftKey(storyId), JSON.stringify(draft));
  } catch (error) {
    console.warn('保存短故事设定草稿失败:', error);
  }
};

export const clearStorySetupDraft = (storyId: string): void => {
  try {
    localStorage.removeItem(getSetupDraftKey(storyId));
  } catch (error) {
    console.warn('清除短故事设定草稿失败:', error);
  }
};

// ============ 草稿时效性判断 ============

/**
 * 判断本地草稿是否已过期（被服务器版本更新覆盖）。
 *
 * 草稿的 savedAt 与服务器记录的 updated_at 比较：
 * - 若 draft.savedAt < serverUpdatedAt，说明草稿保存后服务器又有更新，草稿已过期，不应恢复。
 * - 若 serverUpdatedAt 缺失（无法判断），按"不过期"处理（草稿仍可恢复）。
 * - 若 draft 缺失或 savedAt 非法，按"过期"处理（无草稿可恢复）。
 *
 * @param draft 本地草稿（content 或 setup，需含 savedAt）
 * @param serverUpdatedAt 服务器记录的 updated_at（ISO 字符串 / Date / 毫秒时间戳）
 * @returns true 表示草稿已过期，不应弹出恢复框
 */
export function isDraftOutdated(
  draft: { savedAt: number } | null | undefined,
  serverUpdatedAt: string | number | Date | null | undefined
): boolean {
  if (!draft || typeof draft.savedAt !== 'number') {
    return true;
  }
  if (serverUpdatedAt == null) {
    return false;
  }
  const serverTs =
    typeof serverUpdatedAt === 'number'
      ? serverUpdatedAt
      : new Date(serverUpdatedAt).getTime();
  if (Number.isNaN(serverTs)) {
    return false;
  }
  return draft.savedAt < serverTs;
}

// ============ 统一草稿（content + polish_notes + checklist） ============
// key: `mobinovel_short_story_draft_{storyId}`（无 _content / _setup 后缀）
// 自带时间比较：仅当草稿时间戳比服务器 story.updated_at 更新时才提示恢复。

const DRAFT_KEY_PREFIX = 'mobinovel_short_story_draft_';

const getUnifiedDraftKey = (storyId: string): string =>
  `${DRAFT_KEY_PREFIX}${storyId}`;

/**
 * 判断本地统一草稿是否比服务器版本更新。
 *
 * @param draftSavedAt 草稿保存时间戳（毫秒）
 * @param serverUpdatedAt 服务器 story.updated_at（ISO 字符串 / Date / 毫秒时间戳）
 * @returns true 表示草稿比服务器更新（应提示恢复）；服务器时间缺失或非法时按"更新"处理（不丢用户数据）
 */
function isDraftNewerThanServer(
  draftSavedAt: number,
  serverUpdatedAt: string | number | Date | null | undefined
): boolean {
  if (serverUpdatedAt == null) return true;
  const serverTs =
    typeof serverUpdatedAt === 'number'
      ? serverUpdatedAt
      : new Date(serverUpdatedAt).getTime();
  if (Number.isNaN(serverTs)) return true;
  return draftSavedAt > serverTs;
}

/**
 * 判断是否存在可恢复的统一草稿。
 * 仅当草稿存在、字段合法、且时间戳比服务器 story.updated_at 更新时返回 true。
 *
 * @param storyId 短故事 ID
 * @param serverUpdatedAt 服务器 story.updated_at（用于时间比较）
 */
export function hasDraft(
  storyId: string,
  serverUpdatedAt?: string | number | Date | null
): boolean {
  return loadDraft(storyId, serverUpdatedAt) !== null;
}

/**
 * 读取统一草稿（含时间比较与全字段 null/undefined 校验）。
 *
 * 校验规则：
 * - raw 为 null/undefined → 返回 null（避免 JSON.parse(null) 异常）
 * - JSON 解析失败 → 返回 null
 * - storyId / savedAt / content 类型不符 → 返回 null
 * - polish_notes / checklist 缺失时使用默认值（'' / []）
 * - 草稿时间戳不比服务器新 → 返回 null（跳过恢复）
 *
 * @param storyId 短故事 ID
 * @param serverUpdatedAt 服务器 story.updated_at；草稿更旧则返回 null
 */
export function loadDraft(
  storyId: string,
  serverUpdatedAt?: string | number | Date | null
): ShortStoryDraft | null {
  try {
    const raw = localStorage.getItem(getUnifiedDraftKey(storyId));
    // null/undefined 校验，避免 JSON.parse(null) 异常
    if (raw == null) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    // 全字段校验
    if (typeof data.storyId !== 'string' || data.storyId !== storyId) return null;
    if (typeof data.savedAt !== 'number' || !Number.isFinite(data.savedAt)) return null;
    if (typeof data.content !== 'string') return null;
    // 时间比较：草稿不比服务器新则跳过恢复
    if (!isDraftNewerThanServer(data.savedAt, serverUpdatedAt)) return null;
    // 可选字段缺失时给默认值
    const polishNotes =
      typeof data.polish_notes === 'string' ? data.polish_notes : '';
    const checklist: ShortStoryChecklistItem[] = Array.isArray(data.checklist)
      ? data.checklist
      : [];
    return {
      storyId,
      content: data.content,
      polish_notes: polishNotes,
      checklist,
      savedAt: data.savedAt,
    };
  } catch (error) {
    console.warn('读取短故事统一草稿失败:', error);
    return null;
  }
}

/**
 * 保存统一草稿到 localStorage。
 */
export function saveDraft(
  storyId: string,
  data: {
    content: string;
    polish_notes?: string;
    checklist?: ShortStoryChecklistItem[];
  }
): void {
  try {
    const draft: ShortStoryDraft = {
      storyId,
      content: data.content,
      polish_notes: data.polish_notes ?? '',
      checklist: data.checklist ?? [],
      savedAt: Date.now(),
    };
    localStorage.setItem(getUnifiedDraftKey(storyId), JSON.stringify(draft));
  } catch (error) {
    console.warn('保存短故事统一草稿失败:', error);
  }
}

/**
 * 清除指定短故事的统一草稿。
 */
export function clearDraft(storyId: string): void {
  try {
    localStorage.removeItem(getUnifiedDraftKey(storyId));
  } catch (error) {
    console.warn('清除短故事统一草稿失败:', error);
  }
}

// ============ 草稿 TTL 清理 ============

/**
 * 清理 localStorage 中过期的短故事草稿。
 *
 * 遍历所有 `mobinovel_short_story_draft_*` 键（含正文草稿、设定草稿、统一草稿），
 * 删除 savedAt 距今超过 maxAgeHours 的草稿；解析失败或缺少 savedAt 的损坏草稿一并清除。
 *
 * 建议在 App 初始化时调用（如 App.tsx / main.tsx 顶层），避免积累过多过期草稿。
 *
 * @param maxAgeHours 最大保留时长（小时），默认 72
 * @returns 实际删除的草稿数量
 */
export function cleanExpiredDrafts(maxAgeHours = 72): number {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();
  const keysToRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          keysToRemove.push(key);
          continue;
        }
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || typeof data.savedAt !== 'number') {
          // 损坏草稿，清除
          keysToRemove.push(key);
          continue;
        }
        if (now - data.savedAt > maxAgeMs) {
          keysToRemove.push(key);
        }
      } catch {
        // JSON 解析失败，清除损坏草稿
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('清理过期短故事草稿失败:', error);
  }
  return keysToRemove.length;
}
