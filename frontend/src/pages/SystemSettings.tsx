import { useCallback, useEffect, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { Alert, Button, Card, Col, DatePicker, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Switch, Table, Tag, Tabs, Typography, message, theme } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { BellOutlined, BranchesOutlined, DeleteOutlined, EditOutlined, EyeInvisibleOutlined, PlusOutlined, ReloadOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import { announcementApi, authApi } from '../services/api';
import type { Announcement, AnnouncementCreate, AnnouncementLevel, AnnouncementStatus, AnnouncementUpdate, GitAnnouncementDraft, GitCommitItem, User } from '../types';
import MarkdownRenderer from '../components/MarkdownRenderer';
import useIsMobile from '../utils/useIsMobile';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea, Search } = Input;

const announcementLevelText: Record<AnnouncementLevel, string> = {
  info: '通知',
  success: '成功',
  warning: '警告',
  error: '重要',
};

const announcementLevelColor: Record<AnnouncementLevel, string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

const announcementStatusText: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '已发布',
  hidden: '已隐藏',
};

const announcementStatusColor: Record<AnnouncementStatus, string> = {
  draft: 'default',
  published: 'green',
  hidden: 'red',
};

type AnnouncementStatusFilter = AnnouncementStatus | 'all';

interface AnnouncementFormValues {
  title: string;
  content: string;
  summary?: string;
  level: AnnouncementLevel;
  status: AnnouncementStatus;
  pinned?: boolean;
  publish_at?: Dayjs | null;
  expire_at?: Dayjs | null;
}

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '-';
  }
  return dayjs(value).format('YYYY-MM-DD HH:mm');
};

const toIsoStringOrNull = (value?: Dayjs | null) => {
  if (!value) {
    return null;
  }
  return value.toISOString();
};

export default function SystemSettingsPage() {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const [announcementForm] = Form.useForm<AnnouncementFormValues>();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [gitDraftLoading, setGitDraftLoading] = useState(false);
  const [gitDraft, setGitDraft] = useState<GitAnnouncementDraft | null>(null);
  const [gitPreviewOpen, setGitPreviewOpen] = useState(false);
  const [announcementStatusFilter, setAnnouncementStatusFilter] = useState<AnnouncementStatusFilter>('all');
  const [announcementSearchKeyword, setAnnouncementSearchKeyword] = useState('');
  const [announcementPagination, setAnnouncementPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const { current: announcementCurrentPage, pageSize: announcementPageSize } = announcementPagination;

  const announcementContent = Form.useWatch('content', announcementForm) || '';

  const headerBackground = `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryHover} 100%)`;
  const announcementAdminAvailable = true;

  const loadAnnouncements = useCallback(async (page: number, pageSize: number, keyword: string) => {
    if (!announcementAdminAvailable) {
      setAnnouncements([]);
      setAnnouncementPagination(prev => ({ ...prev, total: 0 }));
      return;
    }

    setAnnouncementLoading(true);
    try {
      const result = await announcementApi.adminList({
        status: announcementStatusFilter,
        q: keyword.trim() || undefined,
        page,
        limit: pageSize,
        include_expired: true,
      });
      setAnnouncements(result.data?.items || []);
      setAnnouncementPagination({
        current: result.data?.page || page,
        pageSize: result.data?.limit || pageSize,
        total: result.data?.total || 0,
      });
    } catch (error) {
      console.error('加载公告列表失败:', error);
      message.error('加载公告列表失败，请确认账号拥有管理员权限');
    } finally {
      setAnnouncementLoading(false);
    }
  }, [announcementAdminAvailable, announcementStatusFilter]);

  const loadData = async () => {
    setInitialLoading(true);
    try {
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);
    } catch (error) {
      console.error('加载系统设置失败:', error);
      message.error('加载系统设置失败');
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentUser?.is_admin) {
      void loadAnnouncements(announcementCurrentPage, announcementPageSize, announcementSearchKeyword);
    }
  }, [currentUser?.is_admin, announcementStatusFilter, loadAnnouncements, announcementCurrentPage, announcementPageSize, announcementSearchKeyword]);

  const openCreateAnnouncementModal = () => {
    if (!announcementAdminAvailable) {
      message.warning('需要管理员权限');
      return;
    }
    setEditingAnnouncement(null);
    announcementForm.setFieldsValue({
      title: '',
      summary: '',
      content: '',
      level: 'info',
      status: 'published',
      pinned: false,
      publish_at: dayjs(),
      expire_at: null,
    });
    setAnnouncementModalOpen(true);
  };

  const handleFetchGitDraft = async () => {
    if (!announcementAdminAvailable) {
      message.warning('需要管理员权限');
      return;
    }
    setGitDraftLoading(true);
    setGitDraft(null);
    try {
      const res = await announcementApi.gitDraft();
      const draft = res.data;
      setGitDraft(draft);
      if (!draft.ok) {
        message.warning(draft.message || '暂无可生成的公告草稿');
      }
      setGitPreviewOpen(true);
    } catch (error) {
      console.error('读取 Git 提交生成公告失败:', error);
      message.error('读取 Git 提交失败，请确认服务器为 Git 环境');
      setGitPreviewOpen(false);
    } finally {
      setGitDraftLoading(false);
    }
  };

  const handleUseGitDraft = () => {
    if (!gitDraft?.ok || !gitDraft.title) {
      return;
    }
    setEditingAnnouncement(null);
    announcementForm.setFieldsValue({
      title: gitDraft.title,
      summary: gitDraft.summary || '',
      content: gitDraft.content || '',
      level: 'success',
      status: 'published',
      pinned: false,
      publish_at: dayjs(),
      expire_at: null,
    });
    setGitPreviewOpen(false);
    setGitDraft(null);
    setAnnouncementModalOpen(true);
  };

  const openEditAnnouncementModal = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    announcementForm.setFieldsValue({
      title: announcement.title,
      summary: announcement.summary || '',
      content: announcement.content,
      level: announcement.level,
      status: announcement.status || 'published',
      pinned: announcement.pinned,
      publish_at: announcement.publish_at ? dayjs(announcement.publish_at) : null,
      expire_at: announcement.expire_at ? dayjs(announcement.expire_at) : null,
    });
    setAnnouncementModalOpen(true);
  };

  const closeAnnouncementModal = () => {
    if (announcementForm.isFieldsTouched()) {
      Modal.confirm({
        title: '未保存的改动',
        content: '有未保存的改动，确认关闭？',
        centered: true,
        okText: '丢弃改动',
        cancelText: '继续编辑',
        onOk: () => {
          setAnnouncementModalOpen(false);
          setEditingAnnouncement(null);
          announcementForm.resetFields();
        },
      });
    } else {
      setAnnouncementModalOpen(false);
      setEditingAnnouncement(null);
      announcementForm.resetFields();
    }
  };

  const validateAnnouncementWindow = (values: AnnouncementFormValues) => {
    if (values.publish_at && values.expire_at && !values.expire_at.isAfter(values.publish_at)) {
      message.warning('过期时间必须晚于发布时间');
      return false;
    }
    return true;
  };

  const appendMarkdownSnippet = (snippet: string) => {
    const currentContent = announcementForm.getFieldValue('content') || '';
    const separator = currentContent && !currentContent.endsWith('\n') ? '\n\n' : '';
    announcementForm.setFieldsValue({ content: `${currentContent}${separator}${snippet}` });
  };

  const buildAnnouncementCreatePayload = (values: AnnouncementFormValues): AnnouncementCreate => {
    const publishAt = toIsoStringOrNull(values.publish_at);
    const expireAt = toIsoStringOrNull(values.expire_at);
    const payload: AnnouncementCreate = {
      title: values.title.trim(),
      content: values.content.trim(),
      summary: values.summary?.trim() || undefined,
      level: values.level,
      status: values.status,
      pinned: Boolean(values.pinned),
    };

    if (publishAt) {
      payload.publish_at = publishAt;
    }
    if (expireAt) {
      payload.expire_at = expireAt;
    }

    return payload;
  };

  const buildAnnouncementUpdatePayload = (values: AnnouncementFormValues): AnnouncementUpdate => ({
    title: values.title.trim(),
    content: values.content.trim(),
    summary: values.summary?.trim() || undefined,
    level: values.level,
    status: values.status,
    pinned: Boolean(values.pinned),
    publish_at: toIsoStringOrNull(values.publish_at),
    expire_at: toIsoStringOrNull(values.expire_at),
  });

  const handleSaveAnnouncement = async (values: AnnouncementFormValues) => {
    if (!validateAnnouncementWindow(values)) {
      return;
    }

    setAnnouncementSaving(true);
    try {
      if (editingAnnouncement) {
        await announcementApi.adminUpdate(editingAnnouncement.id, buildAnnouncementUpdatePayload(values));
        message.success('公告已更新');
      } else {
        await announcementApi.adminCreate(buildAnnouncementCreatePayload(values));
        message.success('公告已创建');
      }
      closeAnnouncementModal();
      await loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    } catch (error) {
      console.error('保存公告失败:', error);
      message.error('保存公告失败，请确认账号拥有管理员权限');
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    try {
      await announcementApi.adminDelete(announcementId);
      message.success('公告已删除');
      await loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    } catch (error) {
      console.error('删除公告失败:', error);
      message.error('删除公告失败');
    }
  };

  const handleAnnouncementStatusChange = async (announcementId: string, action: 'publish' | 'hide') => {
    try {
      if (action === 'publish') {
        await announcementApi.adminPublish(announcementId);
        message.success('公告已发布');
      } else {
        await announcementApi.adminHide(announcementId);
        message.success('公告已隐藏');
      }
      await loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    } catch (error) {
      console.error('更新公告状态失败:', error);
      message.error('更新公告状态失败');
    }
  };

  const handleAnnouncementSearch = (value: string) => {
    const keyword = value.trim();
    setAnnouncementSearchKeyword(keyword);
    setAnnouncementPagination(prev => ({ ...prev, current: 1 }));
    void loadAnnouncements(1, announcementPagination.pageSize, keyword);
  };

  const handleAnnouncementTableChange = (pagination: TablePaginationConfig) => {
    const nextPage = pagination.current || 1;
    const nextPageSize = pagination.pageSize || announcementPagination.pageSize;
    void loadAnnouncements(nextPage, nextPageSize, announcementSearchKeyword);
  };

  const announcementColumns: ColumnsType<Announcement> = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 240,
      render: (title: string, record) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            <Text strong>{title}</Text>
            {record.pinned && <Tag color="gold">置顶</Tag>}
          </Space>
          {record.summary && <Text type="secondary" style={{ fontSize: 12 }}>{record.summary}</Text>}
        </Space>
      ),
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: AnnouncementLevel) => <Tag color={announcementLevelColor[level]}>{announcementLevelText[level]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status?: AnnouncementStatus) => {
        const currentStatus = status || 'published';
        return <Tag color={announcementStatusColor[currentStatus]}>{announcementStatusText[currentStatus]}</Tag>;
      },
    },
    {
      title: '发布时间',
      dataIndex: 'publish_at',
      key: 'publish_at',
      width: 150,
      render: (value?: string | null) => <Text type="secondary">{formatDateTime(value)}</Text>,
    },
    {
      title: '过期时间',
      dataIndex: 'expire_at',
      key: 'expire_at',
      width: 150,
      render: (value?: string | null) => <Text type="secondary">{formatDateTime(value)}</Text>,
    },
    {
      title: '作者',
      dataIndex: 'author_name',
      key: 'author_name',
      width: 120,
      render: (value?: string | null) => value || '-',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 240,
      render: (_, record) => {
        const currentStatus = record.status || 'published';
        return (
          <Space size="small" wrap>
            <Button size="small" icon={<EditOutlined />} disabled={!announcementAdminAvailable} onClick={() => openEditAnnouncementModal(record)}>
              编辑
            </Button>
            {currentStatus !== 'published' ? (
              <Button size="small" type="primary" icon={<SendOutlined />} disabled={!announcementAdminAvailable} onClick={() => void handleAnnouncementStatusChange(record.id, 'publish')}>
                发布
              </Button>
            ) : (
              <Button size="small" icon={<EyeInvisibleOutlined />} disabled={!announcementAdminAvailable} onClick={() => void handleAnnouncementStatusChange(record.id, 'hide')}>
                隐藏
              </Button>
            )}
            <Popconfirm
              title="删除公告"
              description="删除后客户端将不再同步该公告，确认删除吗？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteAnnouncement(record.id)}
              disabled={!announcementAdminAvailable}
            >
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!announcementAdminAvailable}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  if (initialLoading) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!currentUser?.is_admin) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" showIcon message="无权限访问" description="只有管理员可以访问系统设置。" />
      </div>
    );
  }

  return (
    <div>
      <div>
      <Card
        bordered={false}
        style={{
          marginBottom: 24,
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: `0 12px 32px ${token.colorFillSecondary}`,
        }}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{ background: headerBackground, padding: '28px 32px', color: '#fff' }}>
          <Space direction="vertical" size={6}>
            <Space>
              <SettingOutlined />
              <Title level={3} style={{ color: '#fff', margin: 0 }}>系统设置</Title>
            </Space>
            <Paragraph style={{ color: 'rgba(255,255,255,0.88)', margin: 0 }}>
              仅管理员可见，用于维护公告发布。
            </Paragraph>
          </Space>
        </div>
      </Card>

      <Tabs
        defaultActiveKey="announcements"
        items={[
          {
            key: 'announcements',
            label: (
              <Space>
                <BellOutlined />
                公告管理
              </Space>
            ),
            children: (
              <Card bordered={false} style={{ borderRadius: 16 }}>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    message="公告发布入口"
                    description="管理员发布的公告会保存到本地数据库，并展示给所有登录用户。"
                  />

                  <Row gutter={[16, 16]} justify="space-between" align="middle">
                    <Col xs={24} lg={14}>
                      <Space wrap>
                        <Button type="primary" icon={<PlusOutlined />} disabled={!announcementAdminAvailable} onClick={openCreateAnnouncementModal}>
                          新建公告
                        </Button>
                        <Button
                          icon={<BranchesOutlined />}
                          loading={gitDraftLoading}
                          disabled={!announcementAdminAvailable}
                          onClick={() => { void handleFetchGitDraft(); }}
                        >
                          从Git生成公告
                        </Button>
                        <Button icon={<ReloadOutlined />} loading={announcementLoading} onClick={() => { void loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword); }}>
                          刷新列表
                        </Button>
                        <Tag color="green">本地公告</Tag>
                      </Space>
                    </Col>
                    <Col xs={24} lg={10} style={{ textAlign: 'right' }}>
                      <Space wrap>
                        <Search
                          allowClear
                          placeholder="搜索标题、摘要或正文"
                          style={{ width: 220 }}
                          onSearch={handleAnnouncementSearch}
                          disabled={!announcementAdminAvailable}
                        />
                        <Text type="secondary">状态</Text>
                        <Select<AnnouncementStatusFilter>
                          style={{ width: 120, textAlign: 'left' }}
                          value={announcementStatusFilter}
                          disabled={!announcementAdminAvailable}
                          onChange={(value) => {
                            setAnnouncementStatusFilter(value);
                            setAnnouncementPagination(prev => ({ ...prev, current: 1 }));
                          }}
                          options={[
                            { label: '全部', value: 'all' },
                            { label: '草稿', value: 'draft' },
                            { label: '已发布', value: 'published' },
                            { label: '已隐藏', value: 'hidden' },
                          ]}
                        />
                      </Space>
                    </Col>
                  </Row>

                  <Table<Announcement>
                    rowKey="id"
                    columns={announcementColumns}
                    dataSource={announcements}
                    loading={announcementLoading}
                    pagination={{
                      current: announcementPagination.current,
                      pageSize: announcementPagination.pageSize,
                      total: announcementPagination.total,
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 条公告`,
                    }}
                    onChange={handleAnnouncementTableChange}
                    scroll={{ x: 1200 }}
                  />
                </Space>
              </Card>
            ),
          },
        ]}
      />
      </div>

      <Modal
        title={editingAnnouncement ? '编辑公告' : '新建公告'}
        open={announcementModalOpen}
        onCancel={closeAnnouncementModal}
        onOk={() => announcementForm.submit()}
        confirmLoading={announcementSaving}
        okText={editingAnnouncement ? '保存修改' : '创建公告'}
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 32px)' : 1200}
        destroyOnClose
      >
        <Form form={announcementForm} layout="vertical" onFinish={handleSaveAnnouncement} preserve={false}>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item
                name="title"
                label="公告标题"
                rules={[
                  { required: true, message: '请输入公告标题' },
                  { max: 120, message: '公告标题不能超过 120 个字符' },
                  { whitespace: true, message: '公告标题不能为空白字符' },
                ]}
              >
                <Input placeholder="请输入公告标题" maxLength={120} showCount />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="level" label="公告级别" rules={[{ required: true, message: '请选择公告级别' }]}>
                <Select>
                  <Option value="info">通知</Option>
                  <Option value="success">成功</Option>
                  <Option value="warning">警告</Option>
                  <Option value="error">重要</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="summary" label="摘要" rules={[{ max: 255, message: '摘要不能超过 255 个字符' }]}>
            <Input placeholder="可选，用于列表和时间轴的简短说明" maxLength={255} showCount />
          </Form.Item>

          <Card
            size="small"
            title="公告正文（Markdown / 安全 HTML）"
            style={{ marginBottom: 24, borderRadius: 12 }}
            extra={<Text type="secondary">支持 Markdown，以及居中图片、换行、强调等安全 HTML</Text>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap>
                <Button size="small" onClick={() => appendMarkdownSnippet('## 小标题')}>标题</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('**重点内容**')}>粗体</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('- 列表项\n- 列表项')}>列表</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('> 引用说明')}>引用</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('[链接文字](https://example.com)')}>链接</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('<p align="center">\n  <img src="https://via.placeholder.com/600x400" alt="图片说明文字" width="200"/>\n  <br>\n  <em>在此输入图片描述</em>\n</p>')}>居中图片</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('```\n代码内容\n```')}>代码块</Button>
              </Space>

              <Row gutter={16}>
                <Col xs={24} lg={12}>
                  <Form.Item
                    name="content"
                    label="编辑"
                    rules={[
                      { required: true, message: '请输入公告正文' },
                      { whitespace: true, message: '公告正文不能为空白字符' },
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <TextArea
                      style={{ height: 420, resize: 'vertical' }}
                      placeholder={[
                        '请输入 Markdown 或安全 HTML 公告内容，例如：',
                        '## 更新说明',
                        '- 支持列表',
                        '- 支持 **重点内容**',
                        '> 支持引用说明',
                        '[查看详情](https://example.com)',
                        '',
                        '<p align="center">',
                        '  <img src="https://via.placeholder.com/600x400" alt="图片说明文字" width="200"/>',
                        '  <br>',
                        '  <em>在此输入图片描述</em>',
                        '</p>',
                      ].join('\n')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={12}>
                  <Text strong>预览</Text>
                  <div
                    style={{
                      marginTop: 8,
                      minHeight: 336,
                      maxHeight: 420,
                      overflow: 'auto',
                      padding: 16,
                      borderRadius: 10,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      background: token.colorFillQuaternary,
                    }}
                  >
                    <MarkdownRenderer content={announcementContent} />
                  </div>
                </Col>
              </Row>
            </Space>
          </Card>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="status" label="发布状态" rules={[{ required: true, message: '请选择发布状态' }]}>
                <Select>
                  <Option value="draft">草稿</Option>
                  <Option value="published">立即发布</Option>
                  <Option value="hidden">隐藏</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="publish_at" label="发布时间">
                <DatePicker style={{ width: '100%' }} showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="expire_at"
                label="过期时间"
                dependencies={['publish_at']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs | null) {
                      const publishAt = getFieldValue('publish_at') as Dayjs | null;
                      if (!value || !publishAt || value.isAfter(publishAt)) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('过期时间必须晚于发布时间'));
                    },
                  }),
                ]}
              >
                <DatePicker style={{ width: '100%' }} showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="pinned" label="置顶公告" valuePropName="checked" extra="置顶公告会优先展示在客户端公告时间轴顶部。">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <BranchesOutlined />
            从 Git 提交生成公告
          </Space>
        }
        open={gitPreviewOpen}
        onCancel={() => { setGitPreviewOpen(false); setGitDraft(null); }}
        onOk={handleUseGitDraft}
        okText="使用草稿创建公告"
        okButtonProps={{ disabled: !gitDraft?.ok }}
        cancelText="关闭"
        width={isMobile ? 'calc(100vw - 32px)' : 860}
      >
        {gitDraftLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
            <div style={{ marginTop: 12 }}><Text type="secondary">正在读取 Git 提交并整理公告内容...</Text></div>
          </div>
        ) : gitDraft ? (
          gitDraft.ok ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                type="success"
                showIcon
                message={gitDraft.message || '已生成公告草稿'}
                description={
                  <Space direction="vertical" size={4}>
                    <Text>当前版本：<Text code>{gitDraft.head_short}</Text>
                      {gitDraft.prev_short ? <>（自 <Text code>{gitDraft.prev_short}</Text> 起的增量更新）</> : '（无基线，读取最近提交）'}</Text>
                    {gitDraft.skipped ? <Text type="secondary">已过滤 {gitDraft.skipped} 条内部提交（chore/ci/test 等）</Text> : null}
                  </Space>
                }
              />
              <div>
                <Text strong>提交列表（{gitDraft.commits?.length || 0} 条）</Text>
                <div
                  style={{
                    marginTop: 8,
                    maxHeight: 200,
                    overflow: 'auto',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 8,
                    padding: 8,
                  }}
                >
                  {(gitDraft.commits || []).map((commit: GitCommitItem) => (
                    <div key={commit.short} style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'flex-start' }}>
                      <Text code style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{commit.short}</Text>
                      <Tag style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{commit.category}</Tag>
                      <Text style={{ fontSize: 13 }}>{commit.subject}</Text>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Text strong>建议标题</Text>
                <div style={{ marginTop: 4 }}><Text code>{gitDraft.title}</Text></div>
              </div>
              <div>
                <Text strong>公告正文预览</Text>
                <div
                  style={{
                    marginTop: 8,
                    maxHeight: 260,
                    overflow: 'auto',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 8,
                    padding: 12,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <MarkdownRenderer content={gitDraft.content || ''} />
                </div>
              </div>
              <Alert
                type="info"
                showIcon
                message="确认后将以草稿内容打开编辑框，可继续修改标题、正文后发布。"
              />
            </Space>
          ) : (
            <Alert
              type="warning"
              showIcon
              message="暂无可生成的公告"
              description={gitDraft.message || '未读取到可展示的 Git 提交'}
            />
          )
        ) : null}
      </Modal>
    </div>
  );
}
