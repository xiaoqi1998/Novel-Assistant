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
 */

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
