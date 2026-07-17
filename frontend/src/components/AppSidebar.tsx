import type { ReactNode } from 'react';
import { Button, Menu, Space, theme } from 'antd';
import type { MenuProps } from 'antd';
import { BookOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import ThemeSwitch from './ThemeSwitch';
import UserMenu from './UserMenu';
import { useThemeMode } from '../theme/useThemeMode';
import { BulbOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons';

export const EXPANDED_SIDER_WIDTH = 240;
export const COLLAPSED_SIDER_WIDTH = 64;
export const HEADER_HEIGHT = 64;

interface AppSidebarProps {
  /** 菜单项（已根据折叠/分组形态由父组件计算好） */
  menuItems: MenuProps['items'];
  /** 当前是否折叠 */
  collapsed: boolean;
  /** 切换折叠状态 */
  onToggleCollapsed: (collapsed: boolean) => void;
  /** 当前选中的菜单 key */
  selectedKeys: string[];
  /** 菜单点击回调 */
  onMenuClick?: (key: string) => void;
  /** 底部额外区域（如"返回主页"按钮）；不传则只渲染主题切换 + 用户菜单 */
  footerExtra?: ReactNode;
  /** 是否显示折叠状态下的紧凑主题切换按钮（默认 true） */
  showCollapsedThemeButton?: boolean;
}

/**
 * 应用统一侧边栏（桌面端固定 Sider）。
 * 移动端 Drawer 由父组件复用 <SidebarContent/> 自行渲染。
 */
export default function AppSidebar({
  menuItems,
  collapsed,
  onToggleCollapsed,
  selectedKeys,
  onMenuClick,
  footerExtra,
  showCollapsedThemeButton = true,
}: AppSidebarProps) {
  const { token } = theme.useToken();
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  return (
    <div
      className="glass-panel"
      style={{
        width: collapsed ? COLLAPSED_SIDER_WIDTH : EXPANDED_SIDER_WIDTH,
        borderRight: `1px solid ${alphaColor(token.colorPrimary, 0.08)}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        height: '100vh',
        overflow: 'hidden',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: 1000,
      }}
    >
      <SidebarContent
        menuItems={menuItems}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        selectedKeys={selectedKeys}
        onMenuClick={onMenuClick}
        footerExtra={footerExtra}
        showCollapsedThemeButton={showCollapsedThemeButton}
      />
    </div>
  );
}

/**
 * 侧边栏内部内容（桌面 Sider 与移动 Drawer 共用）。
 */
export function SidebarContent({
  menuItems,
  collapsed,
  onToggleCollapsed,
  selectedKeys,
  onMenuClick,
  footerExtra,
  showCollapsedThemeButton = true,
}: AppSidebarProps) {
  const { token } = theme.useToken();
  const { mode, resolvedMode, setMode } = useThemeMode();
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  const cycleThemeMode = () => {
    const nextMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    setMode(nextMode);
  };
  const collapsedThemeIcon = mode === 'light' ? <BulbOutlined /> : mode === 'dark' ? <MoonOutlined /> : <DesktopOutlined />;

  return (
    <>
      {/* Logo 区（与顶栏同高 64） */}
      <div
        style={{
          height: HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? 0 : '0 14px',
          background: `linear-gradient(135deg, ${alphaColor(token.colorPrimary, 0.12)}, ${alphaColor(token.colorPrimary, 0.04)})`,
          flexShrink: 0,
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          borderBottom: `1px solid ${alphaColor(token.colorPrimary, 0.08)}`,
        }}
      >
        {collapsed ? (
          <Button
            type="text"
            icon={<MenuUnfoldOutlined />}
            onClick={() => onToggleCollapsed(false)}
            style={{
              color: token.colorText,
              width: '100%',
              height: '100%',
              padding: 0,
              borderRadius: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  background: `linear-gradient(135deg, ${token.colorPrimary}, ${alphaColor(token.colorPrimary, 0.75)})`,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: token.colorWhite,
                  fontSize: 16,
                  boxShadow: `0 4px 12px ${alphaColor(token.colorPrimary, 0.3)}`,
                  flexShrink: 0,
                }}
              >
                <BookOutlined />
              </div>
              <span
                style={{
                  color: token.colorText,
                  fontWeight: 600,
                  fontSize: 15,
                  fontFamily: token.fontFamily,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                墨笔
              </span>
            </div>
            <Button
              type="text"
              icon={<MenuFoldOutlined />}
              onClick={() => onToggleCollapsed(true)}
              style={{
                color: token.colorTextSecondary,
                width: 32,
                height: 32,
                padding: 0,
                flexShrink: 0,
              }}
            />
          </>
        )}
      </div>

      {/* 菜单 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <Menu
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={selectedKeys}
          style={{ borderRight: 0, paddingTop: 12, width: '100%' }}
          onClick={({ key }) => onMenuClick?.(key)}
          items={menuItems}
        />
      </div>

      {/* 底部 */}
      <div
        style={{
          padding: collapsed ? '12px 8px' : '14px 16px',
          borderTop: `1px solid ${alphaColor(token.colorPrimary, 0.08)}`,
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <Space direction="vertical" style={{ width: '100%', alignItems: 'center' }} size={10}>
            {showCollapsedThemeButton && (
              <Button
                type="text"
                icon={collapsedThemeIcon}
                onClick={cycleThemeMode}
                title={`主题模式：${mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}（点击切换）`}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  background: alphaColor(token.colorPrimary, 0.08),
                  border: `1px solid ${alphaColor(token.colorPrimary, 0.15)}`,
                  color: token.colorPrimary,
                  padding: 0,
                }}
              />
            )}
            {footerExtra}
            <UserMenu compact />
          </Space>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
                color: token.colorTextTertiary,
              }}
            >
              <span>主题模式</span>
              <span>{resolvedMode === 'dark' ? '深色' : '浅色'}</span>
            </div>
            <ThemeSwitch block />
            {footerExtra}
            <UserMenu />
          </div>
        )}
      </div>
    </>
  );
}
