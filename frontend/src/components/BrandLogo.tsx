import type { CSSProperties } from 'react';
import { BookOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { alphaColor } from '../utils/color';

interface BrandLogoProps {
  /** 整体尺寸（外框宽高，px），默认 30 */
  size?: number;
  /** 圆角，默认按尺寸自适应（size ≤ 40 → 8，否则 18） */
  borderRadius?: number;
  /** 渲染变体：'icon' 使用 BookOutlined 图标；'image' 使用 /logo.svg 图片 */
  variant?: 'icon' | 'image';
  /** 透传到外层 div 的样式（如 margin） */
  style?: CSSProperties;
}

/**
 * 品牌 Logo 组件：统一 Login / AppSidebar / AppTopBar 中的 Logo 区视觉。
 * 默认使用 BookOutlined 图标变体（与侧边栏一致），主题色渐变背景。
 */
export default function BrandLogo({
  size = 30,
  borderRadius,
  variant = 'icon',
  style,
}: BrandLogoProps) {
  const { token } = theme.useToken();
  const radius = borderRadius ?? (size <= 40 ? 8 : 18);
  const innerSize = Math.round(size * 0.55);

  return (
    <div
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${alphaColor(token.colorPrimary, 0.75)} 100%)`,
        borderRadius: radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: token.colorWhite,
        fontSize: innerSize,
        boxShadow: `0 ${size <= 40 ? 4 : 12}px ${size <= 40 ? 12 : 32}px ${alphaColor(token.colorPrimary, 0.3)}`,
        flexShrink: 0,
        ...style,
      }}
    >
      {variant === 'image' ? (
        <img
          src="/logo.svg"
          alt="墨笔"
          style={{ width: innerSize, height: innerSize, filter: 'brightness(0) invert(1)' }}
        />
      ) : (
        <BookOutlined />
      )}
    </div>
  );
}
