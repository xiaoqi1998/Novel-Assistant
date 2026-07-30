import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, Typography, Button, Spin, theme, Dropdown, message, Result, Drawer, Modal } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  SettingOutlined,
  LineChartOutlined,
  EditOutlined,
  CheckSquareOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  PictureOutlined,
  FileTextOutlined,
  FileMarkdownOutlined,
} from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import { useShortStoryStore } from '../store/shortStoryStore';
import AppSidebar, { SidebarContent, EXPANDED_SIDER_WIDTH, COLLAPSED_SIDER_WIDTH, HEADER_HEIGHT } from '../components/AppSidebar';
import AppTopBar from '../components/AppTopBar';
import AppFooter from '../components/AppFooter';
import FloatingTaskPanel from '../components/FloatingTaskPanel';
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../utils/sidebarState';
import { useIsMobile } from '../utils/useIsMobile';
import { alphaColor } from '../utils/color';

const { Content } = Layout;
const { Text } = Typography;

const STATUS_CONFIG: Record<string, { color: string; text: string }> = {
  planning: { color: 'blue', text: '规划' },
  writing: { color: 'green', text: '创作' },
  polishing: { color: 'orange', text: '精修' },
  completed: { color: 'purple', text: '已完结' },
};

export default function ShortStoryDetail() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useIsMobile();
  const { token } = theme.useToken();
  const { currentStory, setCurrentStory, loading, setLoading } = useShortStoryStore();
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'markdown' | 'txt'>('markdown');

  // 切回桌面端时自动关闭抽屉
  useEffect(() => {
    if (!mobile) {
      setDrawerVisible(false);
    }
  }, [mobile]);

  useEffect(() => {
    setStoredSidebarCollapsed(collapsed);
  }, [collapsed]);

  const loadStory = async () => {
    if (!storyId) return;
    try {
      setLoading(true);
      setLoadError(null);
      const story = await shortStoryApi.get(storyId);
      setCurrentStory(story);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载失败';
      setLoadError(msg);
      showErrorToast(error, '加载短故事失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  // 菜单项（展开模式，分组格式）
  const menuItems: MenuProps['items'] = useMemo(
    () => [
      {
        type: 'group' as const,
        label: '创作管理',
        children: [
          { key: 'setup', icon: <SettingOutlined />, label: <Link to={`/short-story/${storyId}/setup`}>故事设定</Link> },
          { key: 'emotion-curve', icon: <LineChartOutlined />, label: <Link to={`/short-story/${storyId}/emotion-curve`}>情绪曲线</Link> },
          { key: 'content', icon: <EditOutlined />, label: <Link to={`/short-story/${storyId}/content`}>正文创作</Link> },
          { key: 'polish', icon: <CheckSquareOutlined />, label: <Link to={`/short-story/${storyId}/polish`}>精修笔记</Link> },
        ],
      },
    ],
    [storyId]
  );

  // 菜单项（折叠模式，扁平格式）
  const menuItemsCollapsed: MenuProps['items'] = useMemo(
    () => [
      { key: 'setup', icon: <SettingOutlined />, label: <Link to={`/short-story/${storyId}/setup`}>故事设定</Link> },
      { key: 'emotion-curve', icon: <LineChartOutlined />, label: <Link to={`/short-story/${storyId}/emotion-curve`}>情绪曲线</Link> },
      { key: 'content', icon: <EditOutlined />, label: <Link to={`/short-story/${storyId}/content`}>正文创作</Link> },
      { key: 'polish', icon: <CheckSquareOutlined />, label: <Link to={`/short-story/${storyId}/polish`}>精修笔记</Link> },
    ],
    [storyId]
  );

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/setup')) return 'setup';
    if (path.includes('/emotion-curve')) return 'emotion-curve';
    if (path.includes('/content')) return 'content';
    if (path.includes('/polish')) return 'polish';
    return 'setup';
  }, [location.pathname]);

  const handleGenerateCover = async () => {
    if (!currentStory) return;
    try {
      setCoverLoading(true);
      const res = await shortStoryApi.generateCover(currentStory.id);
      setCurrentStory({ ...currentStory, cover_image_url: res.cover_image_url });
      message.success('封面已生成');
    } catch (error) {
      showErrorToast(error, '生成封面失败');
    } finally {
      setCoverLoading(false);
    }
  };

  // 导出确认弹窗（对齐长篇小说 Chapters.tsx 的导出体验）
  const handleOpenExport = (format: 'markdown' | 'txt') => {
    setExportFormat(format);
    setExportModalOpen(true);
  };

  const handleConfirmExport = () => {
    if (!currentStory) return;
    try {
      if (exportFormat === 'markdown') {
        shortStoryApi.exportMarkdown(currentStory.id);
      } else {
        shortStoryApi.exportTxt(currentStory.id);
      }
      message.success('开始下载导出文件');
      setExportModalOpen(false);
    } catch (error) {
      showErrorToast(error, '导出失败，请重试');
    }
  };

  // 导出格式说明
  const exportFormatMeta: Record<'markdown' | 'txt', { label: string; tip: string }> = {
    markdown: {
      label: 'Markdown 电子书（推荐）',
      tip: '含元信息头（类型/状态/字数/情绪目标）、故事设定（梗概/反转/题材/平台）、正文，可在 VS Code / Typora 大纲栏快速跳转，可转换为 EPUB/PDF。',
    },
    txt: {
      label: 'TXT 纯文本',
      tip: '仅标题+正文，纯文本格式，便于复制粘贴到其他平台或再次拆书导入。',
    },
  };

  // 加载失败显示重试（对齐长篇小说）
  if (loadError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Result
          status="error"
          title="加载短故事失败"
          subTitle={loadError}
          extra={[
            <Button type="primary" key="retry" onClick={loadStory}>
              重试
            </Button>,
            <Button key="home" onClick={() => navigate('/')}>
              返回书架
            </Button>,
          ]}
        />
      </div>
    );
  }

  if (loading || !currentStory) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载短故事..." />
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[currentStory.status] || STATUS_CONFIG.planning;
  const desktopSiderWidth = collapsed ? COLLAPSED_SIDER_WIDTH : EXPANDED_SIDER_WIDTH;
  const headerHeight = mobile ? 56 : HEADER_HEIGHT;

  // 顶栏右侧统计卡片
  const statsActions = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div
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
          情绪
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: token.colorPrimary, lineHeight: 1 }}>
          {currentStory.emotion_goal || '未设'}
        </span>
      </div>
      <div
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
          已写
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
          {currentStory.current_words > 10000
            ? (currentStory.current_words / 10000).toFixed(1) + 'w'
            : currentStory.current_words}
          <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>字</span>
        </span>
      </div>
    </div>
  );

  // 侧边栏底部额外区域：导出 + 封面 + 返回主页
  const footerExtra = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: collapsed ? '0' : '0 4px' }}>
      {collapsed ? (
        <>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            title="返回书架"
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
        </>
      ) : (
        <>
          <Dropdown
            menu={{
              items: [
                { key: 'markdown', label: '导出 Markdown' },
                { key: 'txt', label: '导出 TXT' },
              ],
              onClick: ({ key }) => {
                if (key === 'markdown') handleOpenExport('markdown');
                else if (key === 'txt') handleOpenExport('txt');
              },
            }}
          >
            <Button icon={<DownloadOutlined />} block>
              导出
            </Button>
          </Dropdown>
          <Button
            icon={<PictureOutlined />}
            block
            loading={coverLoading}
            onClick={handleGenerateCover}
          >
            生成封面
          </Button>
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
            返回书架
          </Button>
        </>
      )}
    </div>
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
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <ThunderboltOutlined style={{ color: token.colorPrimary }} />
              <Text
                ellipsis
                style={{ fontWeight: 600, fontSize: 16, maxWidth: 300 }}
              >
                {currentStory.title}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: statusCfg.color === 'green' ? token.colorSuccess : token.colorTextSecondary,
                }}
              >
                · {statusCfg.text}
              </Text>
            </div>
          }
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
                  <ThunderboltOutlined />
                </div>
                <span style={{ fontWeight: 600, fontSize: 16 }}>短故事</span>
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
              height: `calc(100vh - ${headerHeight}px)`,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Outlet context={{ story: currentStory, reload: loadStory }} />
          </Content>
        </Layout>
      </Layout>

      {/* 底部版本条 */}
      <AppFooter sidebarWidth={mobile ? 0 : desktopSiderWidth} />

      {/* 后台任务浮窗（复用长篇小说 FloatingTaskPanel，传 storyId 作为 scope） */}
      <FloatingTaskPanel projectId={currentStory.id} />

      {/* 导出确认弹窗（对齐长篇小说 Chapters.tsx 的导出体验） */}
      <Modal
        title="导出短故事"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleConfirmExport}
        okText="确定导出"
        cancelText="取消"
        centered
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>《{currentStory.title}》</Text>
          <Text type="secondary" style={{ marginLeft: 8 }}>
            共 {currentStory.current_words} 字
          </Text>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {(['markdown', 'txt'] as const).map((fmt) => {
            const meta = exportFormatMeta[fmt];
            const selected = exportFormat === fmt;
            return (
              <div
                key={fmt}
                onClick={() => setExportFormat(fmt)}
                style={{
                  flex: 1,
                  padding: 12,
                  border: `2px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: selected ? alphaColor(token.colorPrimary, 0.06) : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {fmt === 'markdown' ? (
                    <FileMarkdownOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
                  ) : (
                    <FileTextOutlined style={{ color: token.colorTextSecondary, fontSize: 18 }} />
                  )}
                  <Text strong>{meta.label}</Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {meta.tip}
                </Text>
              </div>
            );
          })}
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          导出后将以文件下载方式保存到本地。
        </Text>
      </Modal>
    </Layout>
  );
}
