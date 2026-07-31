import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, Typography, Button, Spin, theme, Dropdown, message, Result, Drawer, Modal, Tag, Divider } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  SettingOutlined,
  EditOutlined,
  CheckSquareOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  PictureOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import { useShortStoryStore } from '../store/shortStoryStore';
import { eventBus } from '../store/eventBus';
import AppSidebar, { SidebarContent, EXPANDED_SIDER_WIDTH, COLLAPSED_SIDER_WIDTH, HEADER_HEIGHT } from '../components/AppSidebar';
import AppTopBar from '../components/AppTopBar';
import AppFooter from '../components/AppFooter';
import FloatingTaskPanel from '../components/FloatingTaskPanel';
import ExportConfirmModal from '../components/ExportConfirmModal';
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../utils/sidebarState';
import { useIsMobile } from '../utils/useIsMobile';
import { alphaColor } from '../utils/color';
import { STORY_STATUS_CONFIG } from '../constants/shortStory';

const { Content } = Layout;
const { Text } = Typography;

export default function ShortStoryDetail() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useIsMobile();
  const { token } = theme.useToken();
  const { currentStory, setCurrentStory, updateCurrentStory, loading, setLoading } = useShortStoryStore();
  // 用于取消旧的 loadStory 请求：每次调用自增，请求返回时若 ID 不匹配则忽略结果
  const loadStoryRequestIdRef = useRef(0);
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'markdown' | 'txt'>('markdown');
  // Task 39.5: 发布预览
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

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
    // 自增请求 ID，标记当前请求为最新；旧请求返回时若 ID 不匹配则忽略结果
    const requestId = ++loadStoryRequestIdRef.current;
    try {
      setLoading(true);
      setLoadError(null);
      const story = await shortStoryApi.get(storyId);
      // 已被新请求取代，丢弃旧结果（防止快速切换时旧请求覆盖新数据）
      if (requestId !== loadStoryRequestIdRef.current) return;
      setCurrentStory(story);
    } catch (error) {
      if (requestId !== loadStoryRequestIdRef.current) return;
      const msg = error instanceof Error ? error.message : '加载失败';
      setLoadError(msg);
      showErrorToast(error, '加载短故事失败');
    } finally {
      // 只有最新请求才负责清除 loading，避免旧请求误清
      if (requestId === loadStoryRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadStory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  // 组件卸载时清理 currentStory，避免返回书架再进入新故事时短暂显示旧数据
  useEffect(() => {
    return () => {
      setCurrentStory(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听后台任务完成事件：短故事相关任务完成后自动刷新 story
  // （如后台评分完成后，Polish 页面能自动显示最新评分结果）
  useEffect(() => {
    if (!storyId) return;
    const handleTaskCompleted = (data: unknown) => {
      const payload = data as { taskType?: string; projectId?: string; status?: string };
      // 仅处理短故事相关任务，且 project_id 匹配当前故事
      const shortStoryTaskTypes = [
        'short_story_regenerate',
        'short_story_score',
        'short_story_polish',
        'short_story_improve',
        'short_story_generate',
      ];
      if (
        payload?.taskType &&
        shortStoryTaskTypes.includes(payload.taskType) &&
        payload.projectId === storyId
      ) {
        // 短暂延迟，确保后端已写库
        setTimeout(() => {
          loadStory();
          message.success('后台任务已完成，数据已更新');
        }, 500);
      }
    };
    eventBus.on('task:completed', handleTaskCompleted);
    return () => {
      eventBus.off('task:completed', handleTaskCompleted);
    };
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
      { key: 'content', icon: <EditOutlined />, label: <Link to={`/short-story/${storyId}/content`}>正文创作</Link> },
      { key: 'polish', icon: <CheckSquareOutlined />, label: <Link to={`/short-story/${storyId}/polish`}>精修笔记</Link> },
    ],
    [storyId]
  );

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/setup')) return 'setup';
    if (path.includes('/content')) return 'content';
    if (path.includes('/polish')) return 'polish';
    return 'setup';
  }, [location.pathname]);

  const handleGenerateCover = async () => {
    if (!currentStory) return;
    try {
      setCoverLoading(true);
      const res = await shortStoryApi.generateCover(currentStory.id);
      // 使用 updateCurrentStory 合并全部封面相关字段，避免手动 spread 丢失 cover_status/cover_prompt
      updateCurrentStory({
        cover_image_url: res.cover_image_url,
        cover_status: res.cover_status,
        cover_prompt: res.cover_prompt,
      });
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

  const statusCfg = STORY_STATUS_CONFIG[currentStory.status] || STORY_STATUS_CONFIG.planning;
  const desktopSiderWidth = collapsed ? COLLAPSED_SIDER_WIDTH : EXPANDED_SIDER_WIDTH;
  const headerHeight = mobile ? 56 : HEADER_HEIGHT;

  // 顶栏右侧统计卡片（移动端隐藏统计卡片，仅保留封面按钮，避免顶栏拥挤）
  const statsActions = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {!mobile && (
        <>
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
        </>
      )}
      <Dropdown
        menu={{
          items: [
            { key: 'cover', label: '生成封面', icon: <PictureOutlined /> },
            { key: 'preview', label: '发布预览', icon: <EyeOutlined /> },
          ],
          onClick: ({ key }) => {
            if (key === 'cover') handleGenerateCover();
            else if (key === 'preview') setPreviewModalOpen(true);
          },
        }}
        placement="bottomRight"
      >
        <Button
          type="text"
          icon={<PictureOutlined />}
          loading={coverLoading}
          title="生成封面"
        />
      </Dropdown>
    </div>
  );

  // 侧边栏底部额外区域：导出 + 返回主页
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
                  color: currentStory.status === 'writing' ? token.colorSuccess : token.colorTextSecondary,
                }}
              >
                · {statusCfg.label}
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

      {/* 导出确认弹窗（共享组件 ExportConfirmModal） */}
      <ExportConfirmModal
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onConfirm={handleConfirmExport}
        format={exportFormat}
        onFormatChange={setExportFormat}
        subjectName={currentStory.title}
        wordCount={currentStory.current_words}
        extraInfo={
          currentStory.target_platform ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>目标平台：</Text>
              <Tag color="blue">{currentStory.target_platform}</Tag>
              <Text type="warning" style={{ fontSize: 12 }}>格式适配开发中（导出文件名将附带平台后缀）</Text>
            </div>
          ) : null
        }
      />

      {/* Task 39.5: 发布预览 Modal（按 target_platform 模拟排版） */}
      <Modal
        title="发布预览"
        open={previewModalOpen}
        onCancel={() => setPreviewModalOpen(false)}
        footer={<Button onClick={() => setPreviewModalOpen(false)}>关闭</Button>}
        width={mobile ? '100%' : 720}
        centered
      >
        <div>
          <Typography.Title level={3} style={{ marginBottom: 8 }}>
            {currentStory.title}
          </Typography.Title>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {currentStory.target_platform && <Tag color="blue">{currentStory.target_platform}</Tag>}
            {currentStory.genre && <Tag>{currentStory.genre}</Tag>}
            <Text type="secondary" style={{ fontSize: 12 }}>共 {currentStory.current_words} 字</Text>
          </div>
          {currentStory.logline && (
            <Typography.Paragraph type="secondary" style={{ fontStyle: 'italic', marginBottom: 0 }}>
              {currentStory.logline}
            </Typography.Paragraph>
          )}
          <Divider style={{ margin: '12px 0' }} />
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontSize: 15, marginBottom: 0 }}>
            {currentStory.content || '(暂无正文)'}
          </Typography.Paragraph>
        </div>
      </Modal>
    </Layout>
  );
}
