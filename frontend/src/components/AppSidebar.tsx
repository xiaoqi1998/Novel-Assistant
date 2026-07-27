import type { ReactNode } from 'react';
import { Button, Menu, Space, theme } from 'antd';
import type { MenuProps } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import ThemeSwitch from './ThemeSwitch';
import UserMenu from './UserMenu';
import BrandLogo from './BrandLogo';
import { useThemeMode } from '../theme/useThemeMode';
import type { ThemeMode } from '../theme/themeStorage';
import { BulbOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons';
import { alphaColor } from '../utils/color';

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

  const cycleThemeMode = () => {
    // 只在 light/dark 间切换；若当前为 system 模式则切到当前解析模式的对立面
    const nextMode: ThemeMode = resolvedMode === 'dark' ? 'light' : 'dark';
    setMode(nextMode);
  };
  const toggleSystemMode = () => {
    // 独立的 system 开关：当前为 system 则退出到 resolvedMode，否则进入 system
    setMode(mode === 'system' ? resolvedMode : 'system');
  };
  const collapsedThemeIcon = resolvedMode === 'dark' ? <MoonOutlined /> : <BulbOutlined />;
  const isSystemMode = mode === 'system';

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
            aria-label="展开侧边栏"
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
              <BrandLogo size={30} />
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
              aria-label="折叠侧边栏"
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
          aria-label={collapsed ? '导航菜单（已折叠）' : undefined}
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
              <>
                <Button
                  type="text"
                  icon={collapsedThemeIcon}
                  onClick={cycleThemeMode}
                  title={`主题模式：${resolvedMode === 'dark' ? '深色' : '浅色'}（点击切换）`}
                  aria-label={`主题模式：${resolvedMode === 'dark' ? '深色' : '浅色'}，点击切换`}
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
                <Button
                  type="text"
                  icon={<DesktopOutlined />}
                  onClick={toggleSystemMode}
                  title={isSystemMode ? '当前跟随系统（点击退出）' : '跟随系统（点击启用）'}
                  aria-label={isSystemMode ? '当前跟随系统，点击退出' : '跟随系统，点击启用'}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: isSystemMode ? alphaColor(token.colorPrimary, 0.18) : 'transparent',
                    border: `1px solid ${isSystemMode ? alphaColor(token.colorPrimary, 0.3) : alphaColor(token.colorBorder, 0.4)}`,
                    color: isSystemMode ? token.colorPrimary : token.colorTextTertiary,
                    padding: 0,
                  }}
                />
              </>
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
              <span>{mode === 'system' ? `跟随系统·${resolvedMode === 'dark' ? '深色' : '浅色'}` : resolvedMode === 'dark' ? '深色' : '浅色'}</span>
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
