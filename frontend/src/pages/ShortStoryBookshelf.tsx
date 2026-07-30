import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Spin, Empty, Tag, Dropdown, message, Modal, theme, Typography } from 'antd';
import { PlusOutlined, ThunderboltOutlined, BookOutlined, DeleteOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import { formatWordCount } from '../utils/format';
import type { ShortStory } from '../types';

const { Text, Title } = Typography;

interface Props {
  isMobile: boolean;
}

const EMOTION_GOAL_CONFIG: Record<string, { color: string; label: string }> = {
  '意难平': { color: 'purple', label: '意难平' },
  '反转震撼': { color: 'red', label: '反转震撼' },
  '爽感释放': { color: 'orange', label: '爽感释放' },
  '治愈温暖': { color: 'green', label: '治愈温暖' },
  '细思极恐': { color: 'magenta', label: '细思极恐' },
  '共鸣感动': { color: 'blue', label: '共鸣感动' },
};

const STATUS_CONFIG: Record<string, { color: string; text: string }> = {
  planning: { color: 'blue', text: '规划' },
  writing: { color: 'green', text: '创作' },
  polishing: { color: 'orange', text: '精修' },
  completed: { color: 'purple', text: '已完结' },
};

export default function ShortStoryBookshelf({ isMobile }: Props) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [stories, setStories] = useState<ShortStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, contextHolder] = Modal.useModal();

  const loadStories = async () => {
    try {
      setLoading(true);
      const result = await shortStoryApi.list({ limit: 100 });
      setStories(result.items || []);
    } catch (error) {
      showErrorToast(error, '加载短故事列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStories();
  }, []);

  const handleEnter = (story: ShortStory) => {
    navigate(`/short-story/${story.id}/setup`);
  };

  const handleDelete = (story: ShortStory) => {
    modal.confirm({
      title: '确认删除短故事？',
      content: `删除《${story.title}》后将无法恢复。`,
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
          await shortStoryApi.delete(story.id);
          message.success('短故事已删除');
          await loadStories();
        } catch (error) {
          showErrorToast(error, '删除失败');
        }
      },
    });
  };

  const getProgress = (current: number, target: number) => {
    if (!target) return 0;
    return Math.min(Math.round((current / target) * 100), 100);
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return token.colorSuccess;
    if (progress >= 50) return token.colorPrimary;
    if (progress >= 20) return token.colorWarning;
    return token.colorError;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const createMenuItems = [
    {
      key: 'wizard',
      label: 'AI 生成短故事',
      icon: <ThunderboltOutlined />,
      onClick: () => navigate('/short-story-wizard'),
    },
    {
      key: 'inspiration',
      label: '灵感模式生成',
      icon: <ThunderboltOutlined />,
      onClick: () => navigate('/inspiration?mode=short'),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" tip="加载短故事..." />
      </div>
    );
  }

  return (
    <div>
      {contextHolder}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
            短故事书架
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            高概念·情绪驱动·8000-20000字单文档创作
          </Text>
        </div>

        <Dropdown menu={{ items: createMenuItems }} placement="bottomRight">
          <Button type="primary" icon={<PlusOutlined />}>
            创建短故事
          </Button>
        </Dropdown>
      </div>

      {stories.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              还没有短故事
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                短故事以情绪为核心，单文档创作，适合知乎盐言/番茄短篇等平台
              </Text>
            </span>
          }
          style={{ padding: '80px 0' }}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/short-story-wizard')}>
            创建第一个短故事
          </Button>
        </Empty>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '100%' : '220px'}, 1fr))`,
            gap: 16,
          }}
        >
          {stories.map((story) => {
            const progress = getProgress(story.current_words, story.target_words || 12000);
            const progressColor = getProgressColor(progress);
            const statusCfg = STATUS_CONFIG[story.status] || STATUS_CONFIG.planning;
            const emotionCfg = story.emotion_goal ? EMOTION_GOAL_CONFIG[story.emotion_goal] : null;

            return (
              <Card
                key={story.id}
                hoverable
                style={{ overflow: 'hidden', position: 'relative' }}
                bodyStyle={{ padding: 0 }}
                onClick={() => handleEnter(story)}
                actions={[
                  <DeleteOutlined
                    key="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(story);
                    }}
                  />,
                ]}
              >
                {/* 封面区域 */}
                <div
                  style={{
                    height: 160,
                    background: story.cover_image_url
                      ? `url(${story.cover_image_url}) center/cover`
                      : `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorInfoBg})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {!story.cover_image_url && (
                    <BookOutlined style={{ fontSize: 48, color: token.colorPrimary, opacity: 0.5 }} />
                  )}
                  <Tag
                    color={statusCfg.color}
                    style={{ position: 'absolute', top: 8, right: 8, margin: 0, borderRadius: 4 }}
                  >
                    {statusCfg.text}
                  </Tag>
                  {emotionCfg && (
                    <Tag
                      color={emotionCfg.color}
                      style={{ position: 'absolute', top: 8, left: 8, margin: 0, borderRadius: 4 }}
                    >
                      {emotionCfg.label}
                    </Tag>
                  )}
                </div>

                {/* 信息区域 */}
                <div style={{ padding: 12 }}>
                  <Text
                    strong
                    ellipsis={{ tooltip: story.title }}
                    style={{ display: 'block', fontSize: 15, marginBottom: 4 }}
                  >
                    {story.title}
                  </Text>

                  {story.logline && (
                    <Text
                      type="secondary"
                      ellipsis={{ tooltip: story.logline }}
                      style={{ display: 'block', fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}
                    >
                      {story.logline}
                    </Text>
                  )}

                  {/* 字数进度 */}
                  <div style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: token.colorTextSecondary,
                        marginBottom: 2,
                      }}
                    >
                      <span>{formatWordCount(story.current_words)} 字</span>
                      <span>{progress}%</span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: token.colorBorderSecondary,
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: '100%',
                          background: progressColor,
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                  </div>

                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatDate(story.updated_at)}
                  </Text>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
