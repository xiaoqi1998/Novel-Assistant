import { Typography, Grid, theme } from 'antd';
import { VERSION_INFO, getVersionWithHash } from '../config/version';
import { alphaColor } from '../utils/color';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface AppFooterProps {
  sidebarWidth?: number;
}

export default function AppFooter({ sidebarWidth = 0 }: AppFooterProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();

  // 计算左边距：桌面端有侧边栏时需要偏移
  const leftOffset = isMobile ? 0 : sidebarWidth;

  return (
    <div
      className="glass-header"
      style={{
        position: 'fixed',
        bottom: 0,
        left: leftOffset,
        right: 0,
        padding: isMobile ? '6px 12px' : '8px 16px',
        zIndex: 100,
        boxShadow: `0 -2px 16px ${alphaColor(token.colorText, 0.06)}`,
        transition: 'left 0.3s ease', // 平滑过渡
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <Text
          style={{
            fontSize: isMobile ? 11 : 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: token.colorTextSecondary,
          }}
        >
          <strong style={{ color: token.colorText }}>{VERSION_INFO.projectName}</strong>
          <span style={{ color: token.colorPrimary }}>{getVersionWithHash()}</span>
        </Text>
      </div>
    </div>
  );
}
