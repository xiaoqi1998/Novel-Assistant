import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { theme, Drawer } from 'antd';
import {
  BookOutlined,
  UploadOutlined,
  ApiOutlined,
  FileSearchOutlined,
  SettingOutlined,
  MailOutlined,
  WalletOutlined,
  QuestionCircleOutlined,
  TeamOutlined,
  CommentOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useStore } from '../store';
import AppSidebar, { SidebarContent, EXPANDED_SIDER_WIDTH, COLLAPSED_SIDER_WIDTH, HEADER_HEIGHT } from './AppSidebar';
import AppTopBar from './AppTopBar';
import AppFooter from './AppFooter';
import GlobalQuotaModal from './GlobalQuotaModal';
import OnboardingGuide from './OnboardingGuide';
import AnnouncementModal from './AnnouncementModal';
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../utils/sidebarState';
import useIsMobile from '../utils/useIsMobile';
import { alphaColor } from '../utils/color';
import { formatWordCount } from '../utils/format';

/** 路由 → 菜单 key 映射 */
const PATH_TO_KEY: Record<string, string> = {
  '/': 'projects',
  '/projects': 'projects',
  '/book-import': 'book-import',
  '/mcp-plugins': 'mcp',
  '/prompt-templates': 'prompts',
  '/help': 'help',
  '/settings': 'settings',
  '/system-settings': 'system-settings',
  '/feedback-admin': 'feedback-admin',
  '/user-management': 'user-management',
  '/account': 'account',
};

/** 路由 → 标题映射 */
const PATH_TO_TITLE: Record<string, string> = {
  '/': '我的书架',
  '/projects': '我的书架',
  '/book-import': '拆书导入',
  '/mcp-plugins': 'MCP 插件',
  '/prompt-templates': '提示词管理',
  '/help': '使用说明',
  '/settings': 'API 设置',
  '/system-settings': '系统设置',
  '/feedback-admin': '意见反馈',
  '/user-management': '用户管理',
  '/account': '个人中心',
};

/** 菜单 key → 路由路径映射 */
const KEY_TO_PATH: Record<string, string> = {
  projects: '/',
  'book-import': '/book-import',
  mcp: '/mcp-plugins',
  prompts: '/prompt-templates',
  help: '/help',
  settings: '/settings',
  'system-settings': '/system-settings',
  'feedback-admin': '/feedback-admin',
  'user-management': '/user-management',
  account: '/account',
};

/** 旧 ?view= → 新路由 映射（兼容旧链接） */
const VIEW_TO_PATH: Record<string, string> = {
  projects: '/',
  'book-import': '/book-import',
  mcp: '/mcp-plugins',
  prompts: '/prompt-templates',
  help: '/help',
  settings: '/settings',
  'system-settings': '/system-settings',
  account: '/account',
};

export default function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { projects, currentUser, loadCurrentUser } = useStore();
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [drawerVisible, setDrawerVisible] = useState(false);
  const mobile = useIsMobile();

  // 切回桌面端时自动关闭抽屉
  useEffect(() => {
    if (!mobile) {
      setDrawerVisible(false);
    }
  }, [mobile]);

  // 持久化折叠状态
  useEffect(() => {
    setStoredSidebarCollapsed(collapsed);
  }, [collapsed]);

  // 加载当前用户（用于判断是否显示"系统设置"菜单，由 store 全局共享）
  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  // 兼容旧 ?view= 链接：检测到则重定向到新路由
  useEffect(() => {
    const view = new URLSearchParams(location.search).get('view');
    if (view && VIEW_TO_PATH[view]) {
      const target = VIEW_TO_PATH[view];
      navigate(target, { replace: true });
    }
  }, [location.search, navigate]);

  const isAdmin = !!currentUser?.is_admin;

  const handleMenuClick = useCallback(
    (key: string) => {
      const target = KEY_TO_PATH[key];
      if (target) {
        navigate(target);
      }
      if (mobile) {
        setDrawerVisible(false);
      }
    },
    [navigate, mobile]
  );

  // 全局菜单（展开态：分组）
  const sideMenuItems: MenuProps['items'] = useMemo(
    () => [
      {
        key: 'projects',
        icon: <BookOutlined />,
        label: '我的书架',
      },
      {
        type: 'group',
        label: '创作工具',
        children: [
          { key: 'book-import', icon: <UploadOutlined />, label: '拆书导入' },
          { key: 'mcp', icon: <ApiOutlined />, label: 'MCP 插件' },
          { key: 'prompts', icon: <FileSearchOutlined />, label: '提示词管理' },
          { key: 'help', icon: <QuestionCircleOutlined />, label: <span className="onboarding-help-btn">使用说明</span> },
        ],
      },
      {
        type: 'group',
        label: '系统设置',
        children: [
          { key: 'settings', icon: <SettingOutlined />, label: 'API 设置' },
          { key: 'account', icon: <WalletOutlined />, label: '个人中心' },
          ...(isAdmin ? [{ key: 'system-settings', icon: <MailOutlined />, label: '系统设置' }] : []),
          ...(isAdmin ? [{ key: 'feedback-admin', icon: <CommentOutlined />, label: '意见反馈' }] : []),
          ...(isAdmin ? [{ key: 'user-management', icon: <TeamOutlined />, label: '用户管理' }] : []),
        ],
      },
    ],
    [isAdmin]
  );

  // 折叠态扁平菜单
  const sideMenuItemsCollapsed: MenuProps['items'] = useMemo(
    () => [
      { key: 'projects', icon: <BookOutlined />, label: '我的书架' },
      { key: 'book-import', icon: <UploadOutlined />, label: '拆书导入' },
      { key: 'mcp', icon: <ApiOutlined />, label: 'MCP 插件' },
      { key: 'prompts', icon: <FileSearchOutlined />, label: '提示词管理' },
      { key: 'help', icon: <QuestionCircleOutlined />, label: <span className="onboarding-help-btn">使用说明</span> },
      { key: 'settings', icon: <SettingOutlined />, label: 'API 设置' },
      { key: 'account', icon: <WalletOutlined />, label: '个人中心' },
      ...(isAdmin ? [{ key: 'system-settings', icon: <MailOutlined />, label: '系统设置' }] : []),
      ...(isAdmin ? [{ key: 'feedback-admin', icon: <CommentOutlined />, label: '意见反馈' }] : []),
      ...(isAdmin ? [{ key: 'user-management', icon: <TeamOutlined />, label: '用户管理' }] : []),
    ],
    [isAdmin]
  );

  const selectedKey = PATH_TO_KEY[location.pathname] || 'projects';
  const currentTitle = PATH_TO_TITLE[location.pathname] || '我的书架';
  const isBookshelf = location.pathname === '/' || location.pathname === '/projects';

  // 书架页统计卡片（瘦身版）
  const bookshelfStats = useMemo(() => {
    if (!isBookshelf || projects.length === 0) return null;

    const totalWords = projects.reduce((sum, p) => sum + (p.current_words || 0), 0);
    const totalChapters = projects.reduce((sum, p) => sum + (p.chapter_count || 0), 0);
    const activeProjects = projects.filter((p) => p.status === 'writing').length;
    const completedProjects = projects.filter((p) => {
      const progress =
        p.target_words && p.target_words > 0
          ? Math.min(Math.round(((p.current_words || 0) / p.target_words) * 100), 100)
          : 0;
      return progress >= 100 || p.status === 'completed';
    }).length;

    return mobile ? (
      // 移动端：顶栏紧凑数字（3项目 · 12章 · 1.2W字）
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 12,
          color: token.colorTextSecondary,
          fontFamily: 'Monaco, monospace',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        <span style={{ fontWeight: 600, color: token.colorPrimary }}>{projects.length}</span>
        <span>项目</span>
        <span style={{ color: token.colorTextQuaternary }}>·</span>
        <span style={{ fontWeight: 600, color: token.colorPrimary }}>{totalChapters}</span>
        <span>章</span>
        <span style={{ color: token.colorTextQuaternary }}>·</span>
        <span style={{ fontWeight: 600, color: token.colorPrimary }}>{formatWordCount(totalWords)}</span>
        <span>字</span>
      </div>
    ) : (
      // 桌面端：完整统计卡片
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: '创作中', value: activeProjects, unit: '本' },
          { label: '已完结', value: completedProjects, unit: '本' },
          { label: '总字数', value: totalWords, unit: '字', raw: true },
        ].map((item, index) => (
          <div
            key={index}
            className="glass-card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              minWidth: 48,
              height: 40,
              padding: '0 10px',
            }}
          >
            <span style={{ fontSize: 10, color: token.colorTextSecondary, marginBottom: 2, lineHeight: 1 }}>
              {item.label}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: token.colorPrimary,
                lineHeight: 1,
                fontFamily: 'Monaco, monospace',
              }}
            >
              {item.raw ? formatWordCount(item.value) : item.value}
              {item.unit && (
                <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.8 }}>{item.unit}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  }, [isBookshelf, projects, mobile, token]);

  const desktopSiderWidth = collapsed ? COLLAPSED_SIDER_WIDTH : EXPANDED_SIDER_WIDTH;
  const headerHeight = mobile ? 56 : HEADER_HEIGHT;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgLayout,
        overflow: 'hidden',
      }}
    >
      {/* 桌面端侧边栏 */}
      {!mobile && (
        <AppSidebar
          menuItems={collapsed ? sideMenuItemsCollapsed : sideMenuItems}
          collapsed={collapsed}
          onToggleCollapsed={setCollapsed}
          selectedKeys={[selectedKey]}
          onMenuClick={handleMenuClick}
        />
      )}

      {/* 顶栏 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: mobile ? 0 : desktopSiderWidth,
          right: 0,
          zIndex: 1000,
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <AppTopBar
          title={currentTitle}
          actions={bookshelfStats}
          onMenuClick={mobile ? () => setDrawerVisible(true) : undefined}
          leftPlaceholder={false}
        />
      </div>

      {/* 移动端 Drawer */}
      {mobile && (
        <Drawer
          className="glass-panel"
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                }}
              >
                <BookOutlined />
              </div>
              <span style={{ fontWeight: 600, fontSize: 16, fontFamily: token.fontFamily, color: token.colorText }}>
                墨笔
              </span>
            </div>
          }
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          width={280}
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
        >
          <SidebarContent
            menuItems={sideMenuItems}
            collapsed={false}
            onToggleCollapsed={() => {}}
            selectedKeys={[selectedKey]}
            onMenuClick={handleMenuClick}
            showCollapsedThemeButton={false}
          />
        </Drawer>
      )}

      {/* 主内容区 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          marginLeft: mobile ? 0 : desktopSiderWidth,
          marginTop: headerHeight,
          transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: mobile ? '16px 16px 64px' : '24px 24px 64px',
            background: isBookshelf
              ? `linear-gradient(180deg, ${alphaColor(token.colorPrimary, 0.04)} 0%, transparent 26%)`
              : token.colorBgLayout,
          }}
        >
          <div style={{ maxWidth: 1440, margin: '0 auto' }}>
            <Outlet />
          </div>
        </div>
      </div>

      {/* 底部版本条 */}
      <AppFooter sidebarWidth={mobile ? 0 : desktopSiderWidth} />

      {/* 全局额度不足 / 需要订阅 Modal */}
      <GlobalQuotaModal />

      {/* 系统公告弹窗 */}
      <AnnouncementModal />

      {/* 首次访问新人引导（透明蒙版多步骤浮窗） */}
      <OnboardingGuide />
    </div>
  );
}
