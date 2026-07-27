/**
 * 格式化字数显示
 * - <1000：原值
 * - <10000：1.2K
 * - <1000000：1.2W
 * - 否则：1.2M
 *
 * 整数末尾的 .0 会被去除（如 10.0K → 10K）。
 *
 * @param count 字数
 * @returns 格式化后的字符串，如 "1.2K", "3.5W", "1.2M"
 */
export const formatWordCount = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 10000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (count < 1000000) return (count / 10000).toFixed(1).replace(/\.0$/, '') + 'W';
  return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
};

export default formatWordCount;
