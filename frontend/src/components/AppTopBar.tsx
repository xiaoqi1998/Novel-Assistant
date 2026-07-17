import type { ReactNode } from 'react';
import { Button, theme } from 'antd';
import { MenuUnfoldOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { HEADER_HEIGHT } from './AppSidebar';

interface AppTopBarProps {
  /** 标题（左对齐） */
  title: ReactNode;
  /** 右侧操作区（统计卡片、按钮等） */
  actions?: ReactNode;
  /** 移动端汉堡按钮回调（不传则不显示汉堡） */
  onMenuClick?: () => void;
  /** 是否显示移动端右侧"主页"返回按钮（项目详情页用） */
  showMobileHomeButton?: boolean;
  /** 桌面端左侧是否留出占位空间以保持标题视觉对齐（默认 true） */
  leftPlaceholder?: boolean;
}

/**
 * 应用统一顶栏（玻璃态 glass-header）。
 * 标题左对齐，移动端汉堡按钮置于最左。
 */
export default function AppTopBar({
  title,
  actions,
  onMenuClick,
  showMobileHomeButton = false,
  leftPlaceholder = true,
}: AppTopBarProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const alphaColor = (color: string, alpha: number) =>
    `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  return (
    <div
      className="glass-header"
      style={{
        padding: isMobile ? '0 12px' : '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        height: isMobile ? 56 : HEADER_HEIGHT,
        flexShrink: 0,
        transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        boxShadow: `0 2px 12px ${alphaColor(token.colorText, 0.06)}`,
        borderBottom: `1px solid ${alphaColor(token.colorPrimary, 0.1)}`,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        {isMobile && onMenuClick && (
          <Button
            type="text"
            icon={<MenuUnfoldOutlined />}
            onClick={onMenuClick}
            style={{
              fontSize: 18,
              color: token.colorText,
              width: 36,
              height: 36,
              flexShrink: 0,
            }}
          />
        )}
        <h2
          style={{
            margin: 0,
            color: token.colorText,
            fontSize: isMobile ? 16 : 20,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: 'left',
            flex: isMobile ? 1 : 'none',
          }}
        >
          {title}
        </h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {actions}
        {isMobile && showMobileHomeButton && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            style={{
              fontSize: 14,
              color: token.colorText,
              height: 36,
              padding: '0 8px',
            }}
          >
            主页
          </Button>
        )}
      </div>

      {/* 桌面端左侧占位（保持标题与左侧栏 Logo 区视觉对齐） */}
      {!isMobile && leftPlaceholder && <div style={{ width: 0 }} />}
    </div>
  );
}
