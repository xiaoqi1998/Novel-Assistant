import { useState, useEffect } from 'react';
import { Typography, Badge, Grid, theme } from 'antd';
import { VERSION_INFO, getVersionString } from '../config/version';
import { checkLatestVersion } from '../services/versionService';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface AppFooterProps {
  sidebarWidth?: number;
}

export default function AppFooter({ sidebarWidth = 0 }: AppFooterProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [releaseUrl, setReleaseUrl] = useState('');
  const { token } = theme.useToken();
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  useEffect(() => {
    // 检查版本更新（每次都重新检查）
    const checkVersion = async () => {
      try {
        const result = await checkLatestVersion();
        setHasUpdate(result.hasUpdate);
        setLatestVersion(result.latestVersion);
        setReleaseUrl(result.releaseUrl);
      } catch {
        // 静默失败
      }
    };

    // 延迟3秒后检查，避免影响首次加载
    const timer = setTimeout(checkVersion, 3000);
    return () => clearTimeout(timer);
  }, []);

  // 点击版本号查看更新
  const handleVersionClick = () => {
    if (hasUpdate && releaseUrl) {
      window.open(releaseUrl, '_blank');
    }
  };

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
        <Badge dot={hasUpdate} offset={[-8, 2]}>
          <Text
            onClick={handleVersionClick}
            style={{
              fontSize: isMobile ? 11 : 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: token.colorTextSecondary,
              cursor: hasUpdate ? 'pointer' : 'default',
              transition: 'all 0.3s',
            }}
            title={hasUpdate ? `发现新版本 v${latestVersion}，点击查看` : '当前版本'}
          >
            <strong style={{ color: token.colorText }}>{VERSION_INFO.projectName}</strong>
            <span style={{ color: token.colorPrimary }}>{getVersionString()}</span>
            {hasUpdate && (
              <span style={{ color: token.colorSuccess, fontSize: isMobile ? 10 : 11 }}>
                · 有新版本 v{latestVersion}
              </span>
            )}
          </Text>
        </Badge>
      </div>
    </div>
  );
}
