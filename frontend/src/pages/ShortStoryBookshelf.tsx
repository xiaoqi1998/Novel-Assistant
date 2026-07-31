import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Spin, Empty, Tag, Dropdown, message, Modal, theme, Typography, Result, Input, Select } from 'antd';
import { PlusOutlined, ThunderboltOutlined, BookOutlined, DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import { formatWordCount } from '../utils/format';
import { STORY_STATUS_CONFIG, EMOTION_GOAL_COLOR } from '../constants/shortStory';
import ExportConfirmModal from '../components/ExportConfirmModal';
import type { ShortStory } from '../types';

const { Text, Title } = Typography;

interface Props {
  isMobile: boolean;
}

export default function ShortStoryBookshelf({ isMobile }: Props) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [stories, setStories] = useState<ShortStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, contextHolder] = Modal.useModal();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'markdown' | 'txt'>('markdown');
  const [exportTargetStory, setExportTargetStory] = useState<ShortStory | null>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'updated' | 'created' | 'words'>('updated');

  const loadStories = async (silent: boolean = false) => {
    try {
      if (!silent) setLoading(true);
      setLoadError(null);
      const result = await shortStoryApi.list({ limit: 100 });
      setStories(result.items || []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载失败';
      setLoadError(msg);
      showErrorToast(error, '加载短故事列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadStories();
  }, []);

  // 切回标签页时静默刷新列表（不触发 loading，避免全屏 Spin 闪烁）
  useEffect(() => {
    const handleFocus = () => loadStories(true);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
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

  // 导出确认弹窗（对齐短故事详情页和长篇小说的导出体验）
  const handleOpenExport = (story: ShortStory, format: 'markdown' | 'txt') => {
    setExportTargetStory(story);
    setExportFormat(format);
    setExportModalOpen(true);
  };

  const handleConfirmExport = () => {
    if (!exportTargetStory) return;
    try {
      if (exportFormat === 'markdown') {
        shortStoryApi.exportMarkdown(exportTargetStory.id);
      } else {
        shortStoryApi.exportTxt(exportTargetStory.id);
      }
      message.success('开始下载导出文件');
      setExportModalOpen(false);
      setExportTargetStory(null);
    } catch (error) {
      showErrorToast(error, '导出失败，请重试');
    }
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
    if (!dateString || isNaN(new Date(dateString).getTime())) return '';
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

  // 搜索 + 状态筛选 + 排序
  const filteredStories = useMemo(() => {
    const list = stories.filter(
      (s) =>
        (keyword === '' || s.title.includes(keyword) || s.logline?.includes(keyword)) &&
        (statusFilter === 'all' || s.status === statusFilter)
    );
    return [...list].sort((a, b) => {
      if (sortKey === 'words') return b.current_words - a.current_words;
      if (sortKey === 'created') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [stories, keyword, statusFilter, sortKey]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" tip="加载短故事..." />
      </div>
    );
  }

  // 加载失败显示重试按钮（对齐短故事详情页和长篇小说）
  if (loadError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 16px' }}>
        <Result
          status="error"
          title="加载短故事列表失败"
          subTitle={loadError}
          extra={[
            <Button type="primary" key="retry" icon={<ReloadOutlined />} onClick={() => loadStories()}>
              重试
            </Button>,
            <Button key="home" onClick={() => navigate('/')}>
              返回首页
            </Button>,
          ]}
        />
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
          image={Empty.PRESENTED_IMAGE_DEFAULT}
          description={
            <span>
              还没有短故事，开始创建你的第一个吧
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
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <Input.Search
              placeholder="搜索标题或梗概"
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: isMobile ? '100%' : 240 }}
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: isMobile ? '100%' : 140 }}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'planning', label: '规划' },
                { value: 'writing', label: '创作' },
                { value: 'polishing', label: '精修' },
                { value: 'completed', label: '已完结' },
              ]}
            />
            <Select
              value={sortKey}
              onChange={(v) => setSortKey(v)}
              style={{ width: isMobile ? '100%' : 140 }}
              options={[
                { value: 'updated', label: '最近更新' },
                { value: 'created', label: '创建时间' },
                { value: 'words', label: '字数' },
              ]}
            />
          </div>
          {filteredStories.length === 0 ? (
            <Empty description="没有匹配的短故事" style={{ padding: '60px 0' }} />
          ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '100%' : '220px'}, 1fr))`,
            gap: 16,
          }}
        >
          {filteredStories.map((story) => {
            const progress = getProgress(story.current_words, story.target_words || 12000);
            const progressColor = getProgressColor(progress);
            const statusCfg = STORY_STATUS_CONFIG[story.status] || STORY_STATUS_CONFIG.planning;
            const emotionCfg = story.emotion_goal ? EMOTION_GOAL_COLOR[story.emotion_goal] : null;

            return (
              <Card
                key={story.id}
                hoverable
                style={{ overflow: 'hidden', position: 'relative' }}
                styles={{ body: { padding: 0 } }}
                onClick={() => handleEnter(story)}
                actions={[
                  <Dropdown
                    key="export"
                    menu={{
                      items: [
                        { key: 'markdown', label: 'Markdown' },
                        { key: 'txt', label: 'TXT' },
                      ],
                      onClick: ({ key, domEvent }) => {
                        domEvent.stopPropagation();
                        if (key === 'markdown') handleOpenExport(story, 'markdown');
                        else if (key === 'txt') handleOpenExport(story, 'txt');
                      },
                    }}
                    trigger={['click']}
                  >
                    <DownloadOutlined
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Dropdown>,
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
                    height: 80,
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
                    <BookOutlined style={{ fontSize: 32, color: token.colorPrimary, opacity: 0.35 }} />
                  )}
                  <Tag
                    color={statusCfg.color}
                    style={{ position: 'absolute', top: 8, right: 8, margin: 0, borderRadius: 4 }}
                  >
                    {statusCfg.label}
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
                      style={{ display: 'block', fontSize: 13, marginBottom: 8, lineHeight: 1.4 }}
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
                      <span>{formatWordCount(story.current_words)} 字 · {formatDate(story.updated_at)}</span>
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
                </div>
              </Card>
            );
          })}
        </div>
          )}
        </>
      )}

      {/* 导出确认弹窗（共享组件 ExportConfirmModal） */}
      <ExportConfirmModal
        open={exportModalOpen}
        onCancel={() => {
          setExportModalOpen(false);
          setExportTargetStory(null);
        }}
        onConfirm={handleConfirmExport}
        format={exportFormat}
        onFormatChange={setExportFormat}
        subjectName={exportTargetStory?.title || ''}
        wordCount={exportTargetStory?.current_words}
      />
    </div>
  );
}
