import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Select,
  message,
  Card,
  Space,
  Tag,
  Popconfirm,
  Empty,
  Typography,
  Row,
  Col,
  theme,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  SearchOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import { writingStyleApi } from '../services/api';
import type { WritingStyle, WritingStyleCreate, WritingStyleUpdate } from '../types';
import { useIsMobile } from '../utils/useIsMobile';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

export default function WritingStyles() {
  const { currentProject } = useStore();
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStyle, setEditingStyle] = useState<WritingStyle | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const { token } = theme.useToken();

  const isMobile = useIsMobile();
  
  // 卡片网格配置
  const gridConfig = {
    gutter: isMobile ? 8 : 16, // 卡片之间的间距
    xs: 24,
    sm: 24,
    md: 12,
    lg: 8,
    xl: 6,
  };

  // 加载风格列表 - 如果有项目则加载项目风格（包含默认标记），否则加载用户风格
  useEffect(() => {
    loadStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const loadStyles = useCallback(async () => {
    try {
      setLoading(true);
      // 如果有当前项目，使用项目API获取（包含is_default标记）
      // 否则使用用户API获取（所有风格的is_default都是false）
      const response = currentProject?.id
        ? await writingStyleApi.getProjectStyles(currentProject.id)
        : await writingStyleApi.getUserStyles();
      
      // 排序：默认风格优先显示
      const sortedStyles = (response.styles || []).sort((a, b) => {
        // 默认风格排在最前面
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        // 其他按原有顺序（order_index）
        return 0;
      });
      
      setStyles(sortedStyles);
    } catch {
      message.error('加载风格列表失败');
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id]);

  const handleCreate = async (values: { name: string; description?: string; prompt_content: string }) => {
    try {
      const createData: WritingStyleCreate = {
        name: values.name,
        style_type: 'custom',
        description: values.description,
        prompt_content: values.prompt_content,
      };

      await writingStyleApi.createStyle(createData);
      message.success('创建成功');
      setIsCreateModalOpen(false);
      createForm.resetFields();
      await loadStyles();
    } catch {
      message.error('创建失败');
    }
  };

  const handleEdit = (style: WritingStyle) => {
    setEditingStyle(style);
    editForm.setFieldsValue({
      name: style.name,
      description: style.description,
      prompt_content: style.prompt_content,
    });
    setIsEditModalOpen(true);
  };

  const handleUpdate = async (values: WritingStyleUpdate) => {
    if (!editingStyle) return;

    try {
      await writingStyleApi.updateStyle(editingStyle.id, values);
      message.success('更新成功');
      setIsEditModalOpen(false);
      editForm.resetFields();
      setEditingStyle(null);
      await loadStyles();
    } catch {
      message.error('更新失败');
    }
  };

  const handleDelete = async (styleId: number) => {
    try {
      await writingStyleApi.deleteStyle(styleId);
      message.success('删除成功');
      await loadStyles();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSetDefault = async (styleId: number) => {
    if (!currentProject?.id) {
      message.warning('请先选择项目');
      return;
    }
    
    try {
      await writingStyleApi.setDefaultStyle(styleId, currentProject.id);
      message.success('设置默认风格成功');
      await loadStyles();
    } catch {
      message.error('设置失败');
    }
  };

  const showCreateModal = () => {
    createForm.resetFields();
    setIsCreateModalOpen(true);
  };

  const handleCreateCancel = () => {
    if (createForm.isFieldsTouched()) {
      Modal.confirm({
        title: '未保存的改动',
        content: '有未保存的改动，确认关闭？',
        centered: true,
        okText: '丢弃改动',
        cancelText: '继续编辑',
        onOk: () => {
          setIsCreateModalOpen(false);
          createForm.resetFields();
        },
      });
    } else {
      setIsCreateModalOpen(false);
      createForm.resetFields();
    }
  };

  const handleEditCancel = () => {
    if (editForm.isFieldsTouched()) {
      Modal.confirm({
        title: '未保存的改动',
        content: '有未保存的改动，确认关闭？',
        centered: true,
        okText: '丢弃改动',
        cancelText: '继续编辑',
        onOk: () => {
          setIsEditModalOpen(false);
          editForm.resetFields();
          setEditingStyle(null);
        },
      });
    } else {
      setIsEditModalOpen(false);
      editForm.resetFields();
      setEditingStyle(null);
    }
  };

  const getStyleTypeColor = (styleType: string) => {
    return styleType === 'preset' ? 'blue' : 'purple';
  };

  const getStyleTypeLabel = (styleType: string) => {
    return styleType === 'preset' ? '预设' : '自定义';
  };

  const filteredStyles = useMemo(() => {
    let list = styles;

    // 按名称搜索
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      list = list.filter((s) => s.name?.toLowerCase().includes(term));
    }

    // 类型筛选（根据 style_type 或 user_id 判断）
    if (typeFilter !== 'all') {
      list = list.filter((s) => {
        const isPreset = s.style_type === 'preset' || s.user_id === null;
        if (typeFilter === 'preset') return isPreset;
        if (typeFilter === 'custom') return !isPreset;
        return true;
      });
    }

    return list;
  }, [styles, searchTerm, typeFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: token.colorBgContainer,
        padding: isMobile ? '12px 0' : '16px 0',
        marginBottom: isMobile ? 12 : 16,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 24 }}>
            <EditOutlined style={{ marginRight: 8 }} />
            写作风格管理
          </h2>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={showCreateModal}
          >
            创建自定义风格
          </Button>
        </div>
        {styles.length > 0 && (
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 8 : 12,
            alignItems: isMobile ? 'stretch' : 'center',
          }}>
            <Input
              prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
              placeholder="按名称搜索写作风格..."
              allowClear
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1, maxWidth: isMobile ? '100%' : 320 }}
            />
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ minWidth: 120, width: isMobile ? '100%' : undefined }}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'preset', label: '预设' },
                { value: 'custom', label: '自定义' },
              ]}
            />
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {styles.length === 0 ? (
          <Empty description="暂无风格数据" />
        ) : filteredStyles.length === 0 ? (
          <Empty description="没有符合条件的写作风格" />
        ) : (
          <Row
            gutter={[0, gridConfig.gutter]}
            style={{ marginLeft: 0, marginRight: 0 }}
          >
            {filteredStyles.map((style) => (
              <Col
                xs={gridConfig.xs}
                sm={gridConfig.sm}
                md={gridConfig.md}
                lg={gridConfig.lg}
                xl={gridConfig.xl}
                key={style.id}
                style={{
                  paddingLeft: 0,
                  paddingRight: gridConfig.gutter / 2,
                  marginBottom: gridConfig.gutter
                }}
              >
                <Card
                  hoverable
                  style={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 12,
                    border: style.is_default ? `2px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                  }}
                  bodyStyle={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '16px',
                  }}
                  actions={[
                    <span
                      key="default"
                      onClick={() => !style.is_default && handleSetDefault(style.id)}
                      style={{ cursor: style.is_default ? 'default' : 'pointer' }}
                    >
                      {style.is_default ? (
                        <StarFilled style={{ color: token.colorWarning, fontSize: 18 }} />
                      ) : (
                        <StarOutlined style={{ fontSize: 18 }} />
                      )}
                    </span>,
                    <EditOutlined
                      key="edit"
                      onClick={() => style.user_id !== null && handleEdit(style)}
                      style={{
                        fontSize: 18,
                        cursor: style.user_id === null ? 'not-allowed' : 'pointer',
                        color: style.user_id === null ? token.colorTextQuaternary : undefined
                      }}
                    />,
                    <Popconfirm
                      key="delete"
                      title="确定删除这个风格吗？"
                      description={style.is_default ? '这是默认风格，删除后需要设置新的默认风格' : undefined}
                      onConfirm={() => handleDelete(style.id)}
                      okText="确定"
                      cancelText="取消"
                      disabled={style.user_id === null}
                    >
                      <DeleteOutlined
                        style={{
                          fontSize: 18,
                          color: style.user_id === null ? token.colorTextQuaternary : undefined,
                          cursor: style.user_id === null ? 'not-allowed' : 'pointer'
                        }}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Space style={{ marginBottom: 12 }} wrap>
                      <Text strong style={{ fontSize: 16 }}>{style.name}</Text>
                      <Tag color={getStyleTypeColor(style.style_type)}>
                        {getStyleTypeLabel(style.style_type)}
                      </Tag>
                      {style.is_default && <Tag color="gold">默认</Tag>}
                    </Space>
                    
                    {style.description && (
                      <Paragraph
                        type="secondary"
                        style={{ fontSize: 13, marginBottom: 12 }}
                        ellipsis={{ rows: 2, tooltip: style.description }}
                      >
                        {style.description}
                      </Paragraph>
                    )}
                    
                    <Paragraph
                      type="secondary"
                      style={{
                        fontSize: 12,
                        marginBottom: 0,
                        backgroundColor: token.colorFillAlter,
                        padding: 8,
                        borderRadius: 4,
                        flex: 1,
                        minHeight: 60,
                      }}
                      ellipsis={{ rows: 3, tooltip: style.prompt_content }}
                    >
                      {style.prompt_content}
                    </Paragraph>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      {/* 创建自定义风格 Modal */}
      <Modal
        title="创建自定义风格"
        open={isCreateModalOpen}
        onCancel={handleCreateCancel}
        footer={null}
        centered
        width={isMobile ? 'calc(100vw - 32px)' : 600}
        style={isMobile ? { maxWidth: 'calc(100vw - 32px)', margin: '0 16px' } : undefined}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreate}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="风格名称"
            name="name"
            rules={[{ required: true, message: '请输入风格名称' }]}
          >
            <Input placeholder="如：武侠风、科幻风" />
          </Form.Item>
          
          <Form.Item label="风格描述" name="description">
            <TextArea rows={2} placeholder="简要描述这个风格的特点..." />
          </Form.Item>
          
          <Form.Item
            label="提示词内容"
            name="prompt_content"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea
              rows={6}
              placeholder="输入风格的提示词，用于引导AI生成符合该风格的内容..."
            />
          </Form.Item>
          
          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={handleCreateCancel}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑风格 Modal */}
      <Modal
        title="编辑写作风格"
        open={isEditModalOpen}
        onCancel={handleEditCancel}
        footer={null}
        centered
        width={isMobile ? 'calc(100vw - 32px)' : 600}
        style={isMobile ? { maxWidth: 'calc(100vw - 32px)', margin: '0 16px' } : undefined}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdate} style={{ marginTop: 16 }}>
          <Form.Item
            label="风格名称"
            name="name"
            rules={[{ required: true, message: '请输入风格名称' }]}
          >
            <Input placeholder="输入风格名称" />
          </Form.Item>
          
          <Form.Item label="风格描述" name="description">
            <TextArea rows={2} placeholder="简要描述这个风格的特点..." />
          </Form.Item>
          
          <Form.Item
            label="提示词内容"
            name="prompt_content"
            rules={[{ required: true, message: '请输入提示词内容' }]}
          >
            <TextArea 
              rows={6} 
              placeholder="输入风格的提示词..."
            />
          </Form.Item>
          
          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={handleEditCancel}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}