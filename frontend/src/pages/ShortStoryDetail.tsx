import { useEffect, useState } from 'react';
import { useNavigate, useParams, Outlet, NavLink } from 'react-router-dom';
import { Layout, Typography, Button, Spin, theme, Grid, Dropdown, message } from 'antd';
import {
  ArrowLeftOutlined,
  SettingOutlined,
  LineChartOutlined,
  EditOutlined,
  CheckSquareOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import { useShortStoryStore } from '../store/shortStoryStore';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const STATUS_CONFIG: Record<string, { color: string; text: string }> = {
  planning: { color: 'blue', text: '规划' },
  writing: { color: 'green', text: '创作' },
  polishing: { color: 'orange', text: '精修' },
  completed: { color: 'purple', text: '已完结' },
};

export default function ShortStoryDetail() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();
  const { currentStory, setCurrentStory, loading, setLoading } = useShortStoryStore();
  const [collapsed, setCollapsed] = useState(isMobile);
  const [coverLoading, setCoverLoading] = useState(false);

  const loadStory = async () => {
    if (!storyId) return;
    try {
      setLoading(true);
      const story = await shortStoryApi.get(storyId);
      setCurrentStory(story);
    } catch (error) {
      showErrorToast(error, '加载短故事失败');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const menuItems = [
    { key: 'setup', icon: <SettingOutlined />, label: '故事设定', path: 'setup' },
    { key: 'emotion-curve', icon: <LineChartOutlined />, label: '情绪曲线', path: 'emotion-curve' },
    { key: 'content', icon: <EditOutlined />, label: '正文创作', path: 'content' },
    { key: 'polish', icon: <CheckSquareOutlined />, label: '精修笔记', path: 'polish' },
  ];

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

  if (loading || !currentStory) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载短故事..." />
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[currentStory.status] || STATUS_CONFIG.planning;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        collapsedWidth={isMobile ? 0 : 80}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ padding: '16px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            size="small"
            style={{ marginBottom: 8, padding: '0 4px' }}
          >
            {!collapsed && '返回书架'}
          </Button>
          {!collapsed && (
            <div>
              <Title
                level={5}
                ellipsis={{ tooltip: currentStory.title }}
                style={{ margin: '4px 0 0 0' }}
              >
                <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 6 }} />
                {currentStory.title}
              </Title>
              {currentStory.emotion_goal && (
                <Text
                  style={{
                    fontSize: 12,
                    color: token.colorTextSecondary,
                    display: 'block',
                    marginTop: 4,
                  }}
                >
                  情绪目标：{currentStory.emotion_goal}
                </Text>
              )}
              <Text
                style={{
                  fontSize: 12,
                  color: statusCfg.color === 'green' ? token.colorSuccess : token.colorTextSecondary,
                  display: 'block',
                  marginTop: 2,
                }}
              >
                状态：{statusCfg.text} · {currentStory.current_words}字
              </Text>
            </div>
          )}
        </div>

        <div style={{ padding: '8px 0' }}>
          {menuItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                color: isActive ? token.colorPrimary : token.colorText,
                background: isActive ? token.colorPrimaryBg : 'transparent',
                borderRight: isActive ? `3px solid ${token.colorPrimary}` : '3px solid transparent',
                textDecoration: 'none',
                fontSize: 14,
                transition: 'all 0.2s',
              })}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </div>

        {!collapsed && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <Dropdown
              menu={{
                items: [
                  { key: 'markdown', label: '导出 Markdown' },
                  { key: 'txt', label: '导出 TXT' },
                ],
                onClick: ({ key }) => {
                  if (key === 'markdown') shortStoryApi.exportMarkdown(currentStory.id);
                  else if (key === 'txt') shortStoryApi.exportTxt(currentStory.id);
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
              style={{ marginTop: 8 }}
            >
              生成封面
            </Button>
          </div>
        )}
      </Sider>

      <Content style={{ background: token.colorBgLayout, overflow: 'auto' }}>
        <Outlet context={{ story: currentStory, reload: loadStory }} />
      </Content>
    </Layout>
  );
}
