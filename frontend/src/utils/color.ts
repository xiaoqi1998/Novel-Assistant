/**
 * 将颜色与透明度组合为 color-mix 表达式，用于在保持主题色变量语义的同时生成半透明色。
 *
 * 例：alphaColor('var(--colorPrimary)', 0.5) → 'color-mix(in srgb, var(--colorPrimary) 50%, transparent)'
 *
 * @param color 任意可被 color-mix 接受的颜色值（如 #7C3AED、token.colorPrimary 等）
 * @param alpha 透明度 0~1（0 完全透明，1 完全不透明）
 */
export const alphaColor = (color: string, alpha: number): string =>
  `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

export default alphaColor;
