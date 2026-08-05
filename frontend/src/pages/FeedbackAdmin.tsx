import { useCallback, useEffect, useState } from 'react';
import {
  Table, Tag, Space, Button, Select, Input, Modal, Form, Alert,
  message, Popconfirm, Typography, Tooltip, Card, Statistic, Row, Col, theme,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, CheckCircleOutlined, ReloadOutlined,
  DeleteOutlined, MessageOutlined, CommentOutlined,
} from '@ant-design/icons';
import { feedbackApi } from '../services/api';
import type { FeedbackItem } from '../services/api';
import { useStore } from '../store';
import useIsMobile from '../utils/useIsMobile';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

// 采纳状态配置
const ADOPTION_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '待评估', color: 'default' },
  adopted: { label: '已采纳', color: 'green' },
  rejected: { label: '不采纳', color: 'red' },
};

// 解决状态配置
const RESOLVE_CONFIG: Record<string, { label: string; color: string }> = {
  unresolved: { label: '未解决', color: 'orange' },
  resolved: { label: '已解决', color: 'blue' },
};

export default function FeedbackAdmin() {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const { currentUser } = useStore();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [adoptionFilter, setAdoptionFilter] = useState<string>('all');
  const [resolveFilter, setResolveFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');

  // 回复弹窗
  const [replyModalVisible, setReplyModalVisible] = useState(false);
  const [replyTarget, setReplyTarget] = useState<FeedbackItem | null>(null);
  const [replyForm] = Form.useForm();
  const [replySaving, setReplySaving] = useState(false);

  const load = useCallback(async (
    nextPage = page,
    nextPageSize = pageSize,
    nextAdoption = adoptionFilter,
    nextResolve = resolveFilter,
    nextKeyword = keyword,
  ) => {
    setLoading(true);
    try {
      const resp = await feedbackApi.adminList({
        page: nextPage,
        limit: nextPageSize,
        adoption_status: nextAdoption,
        resolve_status: nextResolve,
        q: nextKeyword || undefined,
      });
      setItems(resp.data.items);
      setTotal(resp.data.total);
    } catch (e) {
      console.error('加载反馈列表失败:', e);
      message.error('加载反馈列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, adoptionFilter, resolveFilter, keyword]);

  useEffect(() => {
    if (currentUser?.is_admin) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.is_admin, page, pageSize, adoptionFilter, resolveFilter]);

  // 非管理员拦截
  if (!currentUser?.is_admin) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" showIcon message="无权限访问" description="只有管理员可以访问意见反馈管理。" />
      </div>
    );
  }

  const updateStatus = async (item: FeedbackItem, data: { adoption_status?: string; resolve_status?: string }) => {
    try {
      await feedbackApi.adminUpdate(item.id, data);
      message.success('状态已更新');
      void load();
    } catch (e) {
      console.error('更新反馈状态失败:', e);
      message.error('更新状态失败');
    }
  };

  const handleDelete = async (item: FeedbackItem) => {
    try {
      await feedbackApi.adminDelete(item.id);
      message.success('反馈已删除');
      void load();
    } catch (e) {
      console.error('删除反馈失败:', e);
      message.error('删除失败');
    }
  };

  const openReply = (item: FeedbackItem) => {
    setReplyTarget(item);
    replyForm.setFieldsValue({ admin_reply: item.admin_reply || '' });
    setReplyModalVisible(true);
  };

  const handleReplySave = async () => {
    if (!replyTarget) return;
    try {
      const values = await replyForm.validateFields();
      setReplySaving(true);
      await feedbackApi.adminUpdate(replyTarget.id, { admin_reply: values.admin_reply || '' });
      message.success('回复已保存');
      setReplyModalVisible(false);
      setReplyTarget(null);
      void load();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error('保存回复失败');
    } finally {
      setReplySaving(false);
    }
  };

  // 统计
  const adoptedCount = items.filter(i => i.adoption_status === 'adopted').length;
  const resolvedCount = items.filter(i => i.resolve_status === 'resolved').length;

  const columns = [
    {
      title: '反馈内容', dataIndex: 'content', key: 'content',
      render: (content: string, record: FeedbackItem) => (
        <div style={{ maxWidth: isMobile ? 220 : 420 }}>
          <Paragraph style={{ marginBottom: 4, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 3, expandable: 'collapsible' }}>
            {content}
          </Paragraph>
          {record.contact && (
            <Text type="secondary" style={{ fontSize: 12 }}>联系方式：{record.contact}</Text>
          )}
          {record.page && (
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>来源页：{record.page}</Text>
          )}
        </div>
      ),
    },
    {
      title: '提交人', key: 'user', width: 130,
      render: (_: unknown, record: FeedbackItem) => (
        <Space direction="vertical" size={0}>
          <Text>{record.display_name || record.username || '未知用户'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '-'}
          </Text>
        </Space>
      ),
    },
    {
      title: '采纳状态', dataIndex: 'adoption_status', key: 'adoption_status', width: 170,
      render: (status: string, record: FeedbackItem) => {
        const cfg = ADOPTION_CONFIG[status] || ADOPTION_CONFIG.pending;
        return (
          <Space size={4} wrap>
            <Tag color={cfg.color}>{cfg.label}</Tag>
            {status !== 'adopted' && (
              <Tooltip title="标记采纳">
                <Button
                  type="text" size="small" icon={<CheckOutlined style={{ color: token.colorSuccess }} />}
                  onClick={() => updateStatus(record, { adoption_status: 'adopted' })}
                />
              </Tooltip>
            )}
            {status !== 'rejected' && (
              <Tooltip title="标记不采纳">
                <Button
                  type="text" size="small" icon={<CloseOutlined style={{ color: token.colorError }} />}
                  onClick={() => updateStatus(record, { adoption_status: 'rejected' })}
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '解决状态', dataIndex: 'resolve_status', key: 'resolve_status', width: 170,
      render: (status: string, record: FeedbackItem) => {
        const cfg = RESOLVE_CONFIG[status] || RESOLVE_CONFIG.unresolved;
        return (
          <Space size={4} wrap>
            <Tag color={cfg.color}>{cfg.label}</Tag>
            <Tooltip title={status === 'resolved' ? '标记未解决' : '标记已解决'}>
              <Button
                type="text" size="small"
                icon={<CheckCircleOutlined style={{ color: status === 'resolved' ? token.colorWarning : token.colorPrimary }} />}
                onClick={() => updateStatus(record, { resolve_status: status === 'resolved' ? 'unresolved' : 'resolved' })}
              />
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '管理员回复', dataIndex: 'admin_reply', key: 'admin_reply', width: 160,
      render: (reply: string | undefined, record: FeedbackItem) => (
        <Space size={4}>
          {reply ? (
            <Tooltip title={reply}>
              <Text type="secondary" style={{ fontSize: 12, maxWidth: 90, display: 'inline-block' }} ellipsis>{reply}</Text>
            </Tooltip>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>暂无</Text>
          )}
          <Tooltip title="编辑回复">
            <Button type="text" size="small" icon={<MessageOutlined />} onClick={() => openReply(record)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '操作', key: 'actions', width: 70,
      render: (_: unknown, record: FeedbackItem) => (
        <Popconfirm title="确定删除该反馈？" onConfirm={() => handleDelete(record)}>
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Tooltip>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={isMobile ? 8 : 6}>
          <Card size="small"><Statistic title="本页反馈" value={items.length} prefix={<CommentOutlined />} /></Card>
        </Col>
        <Col span={isMobile ? 8 : 6}>
          <Card size="small"><Statistic title="本页已采纳" value={adoptedCount} valueStyle={{ color: token.colorSuccess }} /></Card>
        </Col>
        <Col span={isMobile ? 8 : 6}>
          <Card size="small"><Statistic title="本页已解决" value={resolvedCount} valueStyle={{ color: token.colorPrimary }} /></Card>
        </Col>
        <Col span={isMobile ? 24 : 6}>
          <Card size="small"><Statistic title="反馈总数" value={total} /></Card>
        </Col>
      </Row>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          value={adoptionFilter}
          onChange={(v) => { setAdoptionFilter(v); setPage(1); }}
          style={{ width: 130 }}
          options={[
            { value: 'all', label: '全部采纳状态' },
            { value: 'pending', label: '待评估' },
            { value: 'adopted', label: '已采纳' },
            { value: 'rejected', label: '不采纳' },
          ]}
        />
        <Select
          value={resolveFilter}
          onChange={(v) => { setResolveFilter(v); setPage(1); }}
          style={{ width: 130 }}
          options={[
            { value: 'all', label: '全部解决状态' },
            { value: 'unresolved', label: '未解决' },
            { value: 'resolved', label: '已解决' },
          ]}
        />
        <Input.Search
          placeholder="搜索内容 / 用户名"
          allowClear
          style={{ width: isMobile ? '100%' : 240 }}
          onSearch={(v) => { setKeyword(v); setPage(1); void load(1, pageSize, adoptionFilter, resolveFilter, v); }}
        />
        <Button icon={<ReloadOutlined spin={loading} />} onClick={() => void load()}>刷新</Button>
      </div>

      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: isMobile ? 800 : undefined }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条反馈`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <Modal
        title={replyTarget ? '编辑管理员回复' : '管理员回复'}
        open={replyModalVisible}
        onCancel={() => { setReplyModalVisible(false); setReplyTarget(null); }}
        onOk={handleReplySave}
        confirmLoading={replySaving}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        {replyTarget && (
          <div style={{ marginBottom: 12, padding: 8, background: token.colorFillAlter, borderRadius: 6, fontSize: 12 }}>
            <Text type="secondary">用户反馈：</Text>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{replyTarget.content}</div>
          </div>
        )}
        <Form form={replyForm} layout="vertical">
          <Form.Item
            name="admin_reply"
            label="回复内容"
            rules={[{ max: 2000, message: '回复不能超过2000字' }]}
          >
            <TextArea rows={4} placeholder="填写处理说明或给用户的答复（留空保存即清空回复）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
