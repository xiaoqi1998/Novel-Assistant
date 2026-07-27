import type { CSSProperties } from 'react';
import { Spin, theme } from 'antd';

interface FullScreenLoadingProps {
  /** 加载提示文案 */
  tip?: string;
  /** 是否全屏遮罩，默认 true */
  fullscreen?: boolean;
}

export default function FullScreenLoading({ tip, fullscreen = true }: FullScreenLoadingProps) {
  const { token } = theme.useToken();

  const baseStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const style: CSSProperties = fullscreen
    ? {
        ...baseStyle,
        position: 'fixed',
        inset: 0,
        background: token.colorBgLayout,
        zIndex: 9999,
      }
    : {
        ...baseStyle,
        minHeight: 200,
      };

  return (
    <div style={style}>
      <Spin size="large" />
      {tip ? (
        <div style={{ marginTop: 16, color: token.colorTextSecondary, fontSize: 14 }}>
          {tip}
        </div>
      ) : null}
    </div>
  );
}
