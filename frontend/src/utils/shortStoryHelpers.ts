/**
 * 短故事辅助工具函数。
 *
 * ShortStory.segments 在运行时为 JSON 字符串（后端存储格式），
 * 通过 parseSegments 解析为强类型的 ShortStorySegment[]，供 UI 层使用。
 */

import type { ShortStorySegment } from '../types';

/**
 * 解析 ShortStory.segments（JSON 字符串）为 ShortStorySegment[]。
 *
 * - 入参为 null / undefined / 空字符串 → 返回 []
 * - JSON 解析失败 → 返回 []
 * - 解析结果非数组 → 返回 []
 * - 数组中缺少必要字段（stage / target_words / actual_words / status）的条目会被过滤
 * - 必要字段类型不符的条目会被过滤，避免 UI 层访问 undefined 字段崩溃
 *
 * @param seg ShortStory.segments 字段值（JSON 字符串或 null/undefined）
 * @returns 强类型且经过校验的分段数组
 */
export function parseSegments(
  seg: string | null | undefined
): ShortStorySegment[] {
  if (!seg) return [];
  try {
    const parsed: unknown = JSON.parse(seg);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ShortStorySegment => {
      if (!item || typeof item !== 'object') return false;
      const obj = item as Record<string, unknown>;
      return (
        typeof obj.stage === 'string' &&
        typeof obj.target_words === 'number' &&
        typeof obj.actual_words === 'number' &&
        typeof obj.status === 'string'
      );
    });
  } catch {
    return [];
  }
}
