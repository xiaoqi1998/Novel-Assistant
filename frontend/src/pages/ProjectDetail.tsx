import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, Spin, Button, Drawer, Result, theme } from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  TeamOutlined,
  BookOutlined,
  GlobalOutlined,
  ApartmentOutlined,
  BankOutlined,
  EditOutlined,
  FundOutlined,
  TrophyOutlined,
  BulbOutlined,
  CloudOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import { useCharacterSync, useOutlineSync, useChapterSync } from '../store/hooks';
import { projectApi } from '../services/api';
import AppSidebar, { SidebarContent, EXPANDED_SIDER_WIDTH, COLLAPSED_SIDER_WIDTH, HEADER_HEIGHT } from '../components/AppSidebar';
import AppTopBar from '../components/AppTopBar';
import AppFooter from '../components/AppFooter';
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../utils/sidebarState';
import FloatingTaskPanel from '../components/FloatingTaskPanel';
import { alphaColor } from '../utils/color';
import { useIsMobile } from '../utils/useIsMobile';

const { Content } = Layout;

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [drawerVisible, setDrawerVisible] = useState(false);
  const mobile = useIsMobile();
  const [loadError, setLoadError] = useState<string | null>(null);
  const { token } = theme.useToken();

  // 切回桌面端时自动关闭抽屉
  useEffect(() => {
    if (!mobile) {
      setDrawerVisible(false);
    }
  }, [mobile]);

  useEffect(() => {
    setStoredSidebarCollapsed(collapsed);
  }, [collapsed]);

  const {
    currentProject,
    setCurrentProject,
    clearProjectData,
    loading,
    setLoading,
    outlines,
    characters,
    chapters,
  } = useStore();

  const { refreshCharacters } = useCharacterSync();
  const { refreshOutlines } = useOutlineSync();
  const { refreshChapters } = useChapterSync();

  const loadProjectData = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setLoadError(null);
      const project = await projectApi.getProject(id);
      setCurrentProject(project);
      await Promise.all([refreshOutlines(id), refreshCharacters(id), refreshChapters(id)]);
    } catch (error) {
      console.error('加载项目数据失败:', error);
      setLoadError(error instanceof Error ? error.message : '加载项目数据失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setCurrentProject, refreshOutlines, refreshCharacters, refreshChapters]);

  useEffect(() => {
    if (projectId) {
      loadProjectData(projectId);
    }

    return () => {
      clearProjectData();
    };
  }, [projectId, clearProjectData, loadProjectData]);

  const menuItems = useMemo(
    () => [
      {
        type: 'group' as const,
        label: '创作管理',
        children: [
          { key: 'world-setting', icon: <GlobalOutlined />, label: <Link to={`/project/${projectId}/world-setting`} className="onboarding-world-menu">世界设定</Link> },
          { key: 'characters', icon: <TeamOutlined />, label: <Link to={`/project/${projectId}/characters`}>角色管理</Link> },
          { key: 'organizations', icon: <BankOutlined />, label: <Link to={`/project/${projectId}/organizations`}>组织管理</Link> },
          { key: 'careers', icon: <TrophyOutlined />, label: <Link to={`/project/${projectId}/careers`}>职业管理</Link> },
          { key: 'relationships', icon: <ApartmentOutlined />, label: <Link to={`/project/${projectId}/relationships`}>关系管理</Link> },
          { key: 'outline', icon: <FileTextOutlined />, label: <Link to={`/project/${projectId}/outline`}>大纲管理</Link> },
          { key: 'chapters', icon: <BookOutlined />, label: <Link to={`/project/${projectId}/chapters`} className="onboarding-chapters-menu">章节管理</Link> },
          { key: 'chapter-analysis', icon: <FundOutlined />, label: <Link to={`/project/${projectId}/chapter-analysis`}>剧情分析</Link> },
          { key: 'foreshadows', icon: <BulbOutlined />, label: <Link to={`/project/${projectId}/foreshadows`}>伏笔管理</Link> },
        ],
      },
      {
        type: 'group' as const,
        label: '创作工具',
        children: [
          { key: 'writing-styles', icon: <EditOutlined />, label: <Link to={`/project/${projectId}/writing-styles`}>写作风格</Link> },
          { key: 'prompt-workshop', icon: <CloudOutlined />, label: <Link to={`/project/${projectId}/prompt-workshop`}>提示词工坊</Link> },
          { key: 'skill-chat', icon: <ThunderboltOutlined />, label: <Link to={`/project/${projectId}/skill-chat`}>Skill 工具箱</Link> },
          { key: 'skill-manage', icon: <SettingOutlined />, label: <Link to={`/project/${projectId}/skill-manage`}>Skill 管理</Link> },
          { key: 'full-review', icon: <AuditOutlined />, label: <Link to={`/project/${projectId}/full-review`}>全文审查</Link> },
        ],
      },
    ],
    [projectId]
  );

  const menuItemsCollapsed = useMemo(
    () => [
      { key: 'world-setting', icon: <GlobalOutlined />, label: <Link to={`/project/${projectId}/world-setting`} className="onboarding-world-menu">世界设定</Link> },
      { key: 'careers', icon: <TrophyOutlined />, label: <Link to={`/project/${projectId}/careers`}>职业管理</Link> },
      { key: 'characters', icon: <TeamOutlined />, label: <Link to={`/project/${projectId}/characters`}>角色管理</Link> },
      { key: 'relationships', icon: <ApartmentOutlined />, label: <Link to={`/project/${projectId}/relationships`}>关系管理</Link> },
      { key: 'organizations', icon: <BankOutlined />, label: <Link to={`/project/${projectId}/organizations`}>组织管理</Link> },
      { key: 'outline', icon: <FileTextOutlined />, label: <Link to={`/project/${projectId}/outline`}>大纲管理</Link> },
      { key: 'chapters', icon: <BookOutlined />, label: <Link to={`/project/${projectId}/chapters`} className="onboarding-chapters-menu">章节管理</Link> },
      { key: 'chapter-analysis', icon: <FundOutlined />, label: <Link to={`/project/${projectId}/chapter-analysis`}>剧情分析</Link> },
      { key: 'foreshadows', icon: <BulbOutlined />, label: <Link to={`/project/${projectId}/foreshadows`}>伏笔管理</Link> },
      { key: 'writing-styles', icon: <EditOutlined />, label: <Link to={`/project/${projectId}/writing-styles`}>写作风格</Link> },
      { key: 'prompt-workshop', icon: <CloudOutlined />, label: <Link to={`/project/${projectId}/prompt-workshop`}>提示词工坊</Link> },
      { key: 'skill-chat', icon: <ThunderboltOutlined />, label: <Link to={`/project/${projectId}/skill-chat`}>Skill 工具箱</Link> },
      { key: 'skill-manage', icon: <SettingOutlined />, label: <Link to={`/project/${projectId}/skill-manage`}>Skill 管理</Link> },
      { key: 'full-review', icon: <AuditOutlined />, label: <Link to={`/project/${projectId}/full-review`}>全文审查</Link> },
    ],
    [projectId]
  );

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/world-setting')) return 'world-setting';
    if (path.includes('/careers')) return 'careers';
    if (path.includes('/relationships')) return 'relationships';
    if (path.includes('/organizations')) return 'organizations';
    if (path.includes('/outline')) return 'outline';
    if (path.includes('/characters')) return 'characters';
    if (path.includes('/chapter-analysis')) return 'chapter-analysis';
    if (path.includes('/foreshadows')) return 'foreshadows';
    if (path.includes('/chapters')) return 'chapters';
    if (path.includes('/writing-styles')) return 'writing-styles';
    if (path.includes('/prompt-workshop')) return 'prompt-workshop';
    if (path.includes('/skill-chat')) return 'skill-chat';
    if (path.includes('/skill-manage')) return 'skill-manage';
    if (path.includes('/full-review')) return 'full-review';
    return 'world-setting';
  }, [location.pathname]);

  if (loadError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Result
          status="error"
          title="加载失败"
          subTitle={loadError}
          extra={[
            <Button key="retry" type="primary" onClick={() => projectId && loadProjectData(projectId)}>
              重试
            </Button>,
            <Button key="home" onClick={() => navigate('/')}>
              返回主页
            </Button>,
          ]}
        />
      </div>
    );
  }

  if (loading || !currentProject) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 4 个统计卡片（瘦身版）
  const statsActions = !mobile && (
    <div style={{ display: 'flex', gap: 10 }}>
      {[
        { label: '大纲', value: outlines.length, unit: '条' },
        { label: '角色', value: characters.length, unit: '个' },
        { label: '章节', value: chapters.length, unit: '章' },
        { label: '已写', value: currentProject.current_words, unit: '字', raw: true },
      ].map((item, index) => (
        <div
          key={index}
          className="glass-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 48,
            height: 40,
            padding: '0 10px',
            borderRadius: 10,
            cursor: 'default',
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
            {item.raw
              ? item.value > 10000
                ? (item.value / 10000).toFixed(1) + 'w'
                : item.value
              : item.value}
            <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>{item.unit}</span>
          </span>
        </div>
      ))}
    </div>
  );

  const desktopSiderWidth = collapsed ? COLLAPSED_SIDER_WIDTH : EXPANDED_SIDER_WIDTH;
  const headerHeight = mobile ? 56 : HEADER_HEIGHT;

  // 返回主页按钮（侧边栏底部额外区域）
  const footerExtra = collapsed ? (
    <Button
      type="text"
      icon={<ArrowLeftOutlined />}
      onClick={() => navigate('/')}
      title="返回主页"
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
  ) : (
    <Button
      type="text"
      icon={<ArrowLeftOutlined />}
      onClick={() => navigate('/')}
      block
      style={{
        color: token.colorText,
        height: 40,
        justifyContent: 'flex-start',
        padding: '0 12px',
      }}
    >
      返回主页
    </Button>
  );

  return (
    <Layout style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
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
          title={currentProject.title}
          actions={statsActions}
          onMenuClick={mobile ? () => setDrawerVisible(true) : undefined}
          showMobileHomeButton
          leftPlaceholder={false}
        />
      </div>

      <Layout style={{ marginTop: headerHeight }}>
        {mobile ? (
          <Drawer
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    background: `linear-gradient(135deg, ${token.colorPrimary}, ${alphaColor(token.colorPrimary, 0.7)})`,
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
                <span style={{ fontWeight: 600, fontSize: 16 }}>墨笔</span>
              </div>
            }
            placement="left"
            onClose={() => setDrawerVisible(false)}
            open={drawerVisible}
            width={280}
            styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
          >
            <SidebarContent
              menuItems={menuItems}
              collapsed={false}
              onToggleCollapsed={() => {}}
              selectedKeys={[selectedKey]}
              onMenuClick={() => mobile && setDrawerVisible(false)}
              footerExtra={footerExtra}
              showCollapsedThemeButton={false}
            />
          </Drawer>
        ) : (
          <AppSidebar
            menuItems={collapsed ? menuItemsCollapsed : menuItems}
            collapsed={collapsed}
            onToggleCollapsed={setCollapsed}
            selectedKeys={[selectedKey]}
            onMenuClick={() => {}}
            footerExtra={footerExtra}
          />
        )}

        <Layout
          style={{
            marginLeft: mobile ? 0 : desktopSiderWidth,
            transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <Content
            style={{
              background: 'transparent',
              padding: mobile ? 12 : 24,
              paddingBottom: mobile ? 56 : 64,
              height: mobile ? `calc(100vh - ${headerHeight}px)` : `calc(100vh - ${headerHeight}px)`,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Outlet />
          </Content>
        </Layout>
      </Layout>

      {/* 底部版本条 */}
      <AppFooter sidebarWidth={mobile ? 0 : desktopSiderWidth} />

      {/* 悬浮任务框 */}
      {projectId && <FloatingTaskPanel projectId={projectId} />}
    </Layout>
  );
}
