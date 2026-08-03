import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Tabs, Table, Button, Tag, Space, Modal, Form, Input, Select,
  InputNumber, message, Tooltip, Popconfirm, Empty, Row, Col,
  Card, Descriptions, Alert, Spin, theme as antdTheme, Typography, Collapse, Statistic
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, GiftOutlined, KeyOutlined, LockOutlined,
  EnvironmentOutlined, CameraOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import { tianmingApi, characterApi } from '../services/api';
import type {
  TianmingItem, TianmingItemCreate, TianmingItemUpdate,
  TianmingSecret, TianmingSecretCreate, TianmingSecretUpdate,
  TianmingVow, TianmingVowCreate, TianmingVowUpdate,
  TianmingCharacterLocation, TianmingSnapshotListItem, TianmingSnapshot,
  Character,
} from '../types';
import useIsMobile from '../utils/useIsMobile';

const { TextArea } = Input;
const { Option } = Select;
const { Link, Text } = Typography;

// ==================== 状态配置 ====================
const ITEM_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: '使用中', color: 'green' },
  destroyed: { label: '已摧毁', color: 'red' },
  lost: { label: '已遗失', color: 'orange' },
  sealed: { label: '已封印', color: 'purple' },
  consumed: { label: '已消耗', color: 'default' },
  transferred: { label: '已转交', color: 'blue' },
};

const ITEM_TYPE_CONFIG: Record<string, string> = {
  weapon: '武器', artifact: '法宝', consumable: '消耗品',
  key: '关键道具', material: '材料', other: '其他',
};

const RARITY_CONFIG: Record<string, { label: string; color: string }> = {
  common: { label: '普通', color: 'default' },
  rare: { label: '稀有', color: 'blue' },
  epic: { label: '史诗', color: 'purple' },
  legendary: { label: '传说', color: 'gold' },
  mythic: { label: '神话', color: 'magenta' },
};

const SECRET_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  hidden: { label: '完全隐藏', color: 'default' },
  partially_revealed: { label: '部分揭露', color: 'orange' },
  revealed: { label: '已揭露', color: 'blue' },
  public: { label: '公开知晓', color: 'green' },
};

const SECRET_TYPE_CONFIG: Record<string, string> = {
  identity: '身份', past_conspiracy: '旧日阴谋', true_purpose: '真实目的',
  hidden_relationship: '隐藏关系', hidden_power: '隐藏力量', other: '其他',
};

const VOW_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: '生效中', color: 'green' },
  broken: { label: '已违约', color: 'red' },
  fulfilled: { label: '已履行', color: 'blue' },
  expired: { label: '已过期', color: 'default' },
  suspended: { label: '已暂停', color: 'orange' },
};

const VOW_TYPE_CONFIG: Record<string, string> = {
  oath: '誓言', pact: '契约', contract: '约定',
  curse: '诅咒', geas: '禁忌', other: '其他',
};

const VALIDATION_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  not_checked: { label: '未校验', color: 'default' },
  passed: { label: '通过', color: 'green' },
  warnings: { label: '有警告', color: 'orange' },
  failed: { label: '未通过', color: 'red' },
};

// 15 维事实快照维度中文标签
const SNAPSHOT_DIM_LABELS: Record<string, string> = {
  character_states: '角色状态',
  character_locations: '角色位置',
  character_appearances: '角色外貌',
  conflict_progress: '冲突进度',
  foreshadow_states: '伏笔状态',
  plot_nodes: '剧情节点',
  location_states: '地点状态',
  faction_states: '势力状态',
  timeline: '时间线',
  item_states: '物品状态',
  world_constraints: '世界观约束',
  location_features: '地点特征',
  secret_states: '秘密状态',
  vow_states: '誓约约束',
  relationship_states: '关系状态',
};

// 12 类 CHANGES 中文标签
const CHANGES_TYPE_LABELS: Record<string, string> = {
  character_state_changes: '角色状态变化',
  conflict_progress_changes: '冲突进展变化',
  new_plot_nodes: '新情节节点',
  foreshadow_actions: '伏笔动作',
  location_state_changes: '场景状态变化',
  faction_state_changes: '势力状态变化',
  time_progression: '时间推进',
  character_movements: '角色移动',
  item_transfers: '物品转移',
  secret_reveals: '秘密揭露',
  vow_changes: '誓约变化',
  deadline_changes: '截止日期变化',
};

// ==================== 主组件 ====================
export default function Tianming() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const jumpToCharacter = useCallback((characterName: string) => {
    if (!projectId) return;
    // 通过路由 state 携带 characterName，Characters 页面接收后自动打开编辑 Modal
    navigate(`/project/${projectId}/characters`, { state: { openCharacterName: characterName } });
  }, [projectId, navigate]);

  if (!projectId) {
    return <Empty description="缺少项目ID" />;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Alert
        message={
          <Space>
            <InfoCircleOutlined />
            <span>天命状态追踪：章节生成/分析时会自动写入物品、秘密、誓约、位置和快照数据。此处可手动查看与维护。</span>
          </Space>
        }
        type="info"
        showIcon={false}
        style={{ marginBottom: 12 }}
        closable
      />
      <Tabs
        defaultActiveKey="items"
        destroyInactiveTabPane
        items={[
          {
            key: 'items',
            label: <span><GiftOutlined /> 物品</span>,
            children: <ItemsTab projectId={projectId} onJumpToCharacter={jumpToCharacter} />,
          },
          {
            key: 'secrets',
            label: <span><KeyOutlined /> 秘密</span>,
            children: <SecretsTab projectId={projectId} />,
          },
          {
            key: 'vows',
            label: <span><LockOutlined /> 誓约</span>,
            children: <VowsTab projectId={projectId} />,
          },
          {
            key: 'locations',
            label: <span><EnvironmentOutlined /> 角色位置</span>,
            children: <LocationsTab projectId={projectId} />,
          },
          {
            key: 'snapshots',
            label: <span><CameraOutlined /> 章节快照</span>,
            children: <SnapshotsTab projectId={projectId} />,
          },
        ]}
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  );
}

// ==================== 通用重要性渲染 ====================
function renderImportance(importance: number) {
  const stars = Math.round((importance || 0) * 5);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

// ==================== 物品 Tab ====================
function ItemsTab({ projectId, onJumpToCharacter }: {
  projectId: string;
  onJumpToCharacter?: (characterName: string) => void;
}) {
  const { token } = antdTheme.useToken();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<TianmingItem[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentItem, setCurrentItem] = useState<TianmingItem | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsData, charsData] = await Promise.all([
        tianmingApi.listItems(projectId),
        characterApi.getCharacters(projectId),
      ]);
      setItems(itemsData);
      setCharacters(charsData);
    } catch (e) {
      console.error('加载物品失败:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (values: TianmingItemCreate & { current_holder_name?: string }) => {
    try {
      // 同步持有者ID：表单只选了名称，从角色列表中查回ID写入 current_holder_id
      const holderName = values.current_holder_name;
      const holder = characters.find(c => c.name === holderName && !c.is_organization);
      const payload: TianmingItemCreate = {
        ...values,
        current_holder_id: holder?.id,
        current_holder_name: holderName,
      };
      if (currentItem) {
        await tianmingApi.updateItem(currentItem.id, payload as TianmingItemUpdate);
        message.success('物品更新成功');
      } else {
        await tianmingApi.createItem(projectId, payload);
        message.success('物品创建成功');
      }
      setEditModalVisible(false);
      form.resetFields();
      setCurrentItem(null);
      load();
    } catch (e) {
      console.error('保存物品失败:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await tianmingApi.deleteItem(id);
      message.success('物品已删除');
      load();
    } catch (e) {
      console.error('删除物品失败:', e);
    }
  };

  const openEdit = (item?: TianmingItem) => {
    setCurrentItem(item || null);
    if (item) {
      form.setFieldsValue({
        ...item,
        tags: item.tags || [],
        abilities: item.abilities || [],
      });
    } else {
      form.resetFields();
    }
    setEditModalVisible(true);
  };

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (name: string, record: TianmingItem) => (
        <Space direction="vertical" size={0}>
          <span>{name}</span>
          {record.current_holder_name && (
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
              持有：
              {onJumpToCharacter ? (
                <Link onClick={() => onJumpToCharacter(record.current_holder_name!)}>
                  {record.current_holder_name}
                </Link>
              ) : (
                record.current_holder_name
              )}
            </span>
          )}
        </Space>
      ),
    },
    {
      title: '类型', dataIndex: 'item_type', key: 'item_type', width: 100,
      render: (t: string) => ITEM_TYPE_CONFIG[t] || t,
    },
    {
      title: '稀有度', dataIndex: 'rarity', key: 'rarity', width: 90,
      render: (r: string) => {
        const cfg = RARITY_CONFIG[r];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : r;
      },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const cfg = ITEM_STATUS_CONFIG[s];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : s;
      },
    },
    {
      title: '重要性', dataIndex: 'importance', key: 'importance', width: 100,
      sorter: (a: TianmingItem, b: TianmingItem) => a.importance - b.importance,
      render: renderImportance,
    },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: unknown, record: TianmingItem) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定删除该物品？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 0 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={load}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>添加物品</Button>
      </div>
      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="暂无物品，章节生成/分析后会自动创建，也可手动添加" /> }}
      />
      <Modal
        title={currentItem ? '编辑物品' : '添加物品'}
        open={editModalVisible}
        centered
        onCancel={() => { setEditModalVisible(false); setCurrentItem(null); form.resetFields(); }}
        onOk={() => form.submit()}
        width={isMobile ? 'calc(100vw - 32px)' : 720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave} initialValues={{ item_type: 'other', rarity: 'common', status: 'active', importance: 0.5 }}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="name" label="物品名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如：青萍剑" maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="importance" label="重要性 (0-1)">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="物品描述" rules={[{ required: true, message: '请输入描述' }]}>
            <TextArea rows={3} placeholder="外观、用途等详细描述" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="item_type" label="类型">
                <Select>
                  {Object.entries(ITEM_TYPE_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rarity" label="稀有度">
                <Select>
                  {Object.entries(RARITY_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select>
                  {Object.entries(ITEM_STATUS_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="current_holder_name" label="持有者">
                <Select
                  showSearch
                  allowClear
                  placeholder="选择或输入持有者"
                  optionFilterProp="children"
                >
                  {characters.filter(c => !c.is_organization).map(c => (
                    <Option key={c.name} value={c.name}>{c.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tags" label="标签">
                <Select mode="tags" placeholder="如：神器、诅咒" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="origin" label="来源描述">
            <TextArea rows={2} placeholder="如何获得/打造" />
          </Form.Item>
          <Form.Item name="appearance" label="外观描述">
            <TextArea rows={2} placeholder="防止AI写出矛盾的外貌细节" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} placeholder="仅作者可见的备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ==================== 秘密 Tab ====================
function SecretsTab({ projectId }: { projectId: string }) {
  const { token } = antdTheme.useToken();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [secrets, setSecrets] = useState<TianmingSecret[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentSecret, setCurrentSecret] = useState<TianmingSecret | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tianmingApi.listSecrets(projectId);
      setSecrets(data);
    } catch (e) {
      console.error('加载秘密失败:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (values: TianmingSecretCreate) => {
    try {
      if (currentSecret) {
        await tianmingApi.updateSecret(currentSecret.id, values as TianmingSecretUpdate);
        message.success('秘密更新成功');
      } else {
        await tianmingApi.createSecret(projectId, values);
        message.success('秘密创建成功');
      }
      setEditModalVisible(false);
      form.resetFields();
      setCurrentSecret(null);
      load();
    } catch (e) {
      console.error('保存秘密失败:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await tianmingApi.deleteSecret(id);
      message.success('秘密已删除');
      load();
    } catch (e) {
      console.error('删除秘密失败:', e);
    }
  };

  const openEdit = (secret?: TianmingSecret) => {
    setCurrentSecret(secret || null);
    if (secret) {
      form.setFieldsValue({
        ...secret,
        tags: secret.tags || [],
      });
    } else {
      form.resetFields();
    }
    setEditModalVisible(true);
  };

  const columns = [
    {
      title: '标题', dataIndex: 'title', key: 'title', ellipsis: true,
      render: (title: string, record: TianmingSecret) => (
        <Space direction="vertical" size={0}>
          <span>{title}</span>
          {record.knowers && record.knowers.length > 0 && (
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
              知情者：{record.knowers.length}人
            </span>
          )}
        </Space>
      ),
    },
    {
      title: '类型', dataIndex: 'secret_type', key: 'secret_type', width: 100,
      render: (t: string) => SECRET_TYPE_CONFIG[t] || t,
    },
    {
      title: '揭露状态', dataIndex: 'status', key: 'status', width: 110,
      render: (s: string) => {
        const cfg = SECRET_STATUS_CONFIG[s];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : s;
      },
    },
    {
      title: '重要性', dataIndex: 'importance', key: 'importance', width: 100,
      sorter: (a: TianmingSecret, b: TianmingSecret) => a.importance - b.importance,
      render: renderImportance,
    },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: unknown, record: TianmingSecret) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定删除该秘密？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 0 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={load}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>添加秘密</Button>
      </div>
      <Table
        dataSource={secrets}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="暂无秘密，章节生成/分析后会自动创建，也可手动添加" /> }}
      />
      <Modal
        title={currentSecret ? '编辑秘密' : '添加秘密'}
        open={editModalVisible}
        centered
        onCancel={() => { setEditModalVisible(false); setCurrentSecret(null); form.resetFields(); }}
        onOk={() => form.submit()}
        width={isMobile ? 'calc(100vw - 32px)' : 720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave} initialValues={{ secret_type: 'other', status: 'hidden', importance: 0.5 }}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="title" label="秘密标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="如：主角的真实身世" maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="importance" label="重要性 (0-1)">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="content" label="秘密内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={4} placeholder="真相是什么" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="secret_type" label="类型">
                <Select>
                  {Object.entries(SECRET_TYPE_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="揭露状态">
                <Select>
                  {Object.entries(SECRET_STATUS_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tags" label="标签">
                <Select mode="tags" placeholder="如：身世、阴谋" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} placeholder="仅作者可见的备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ==================== 誓约 Tab ====================
function VowsTab({ projectId }: { projectId: string }) {
  const { token } = antdTheme.useToken();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [vows, setVows] = useState<TianmingVow[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentVow, setCurrentVow] = useState<TianmingVow | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tianmingApi.listVows(projectId);
      setVows(data);
    } catch (e) {
      console.error('加载誓约失败:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (values: TianmingVowCreate) => {
    try {
      if (currentVow) {
        await tianmingApi.updateVow(currentVow.id, values as TianmingVowUpdate);
        message.success('誓约更新成功');
      } else {
        await tianmingApi.createVow(projectId, values);
        message.success('誓约创建成功');
      }
      setEditModalVisible(false);
      form.resetFields();
      setCurrentVow(null);
      load();
    } catch (e) {
      console.error('保存誓约失败:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await tianmingApi.deleteVow(id);
      message.success('誓约已删除');
      load();
    } catch (e) {
      console.error('删除誓约失败:', e);
    }
  };

  const openEdit = (vow?: TianmingVow) => {
    setCurrentVow(vow || null);
    if (vow) {
      form.setFieldsValue({
        ...vow,
        tags: vow.tags || [],
      });
    } else {
      form.resetFields();
    }
    setEditModalVisible(true);
  };

  const columns = [
    {
      title: '标题', dataIndex: 'title', key: 'title', ellipsis: true,
      render: (title: string, record: TianmingVow) => (
        <Space direction="vertical" size={0}>
          <span>{title}</span>
          {record.deadline_chapter && (
            <span style={{ fontSize: 12, color: record.is_overdue === 'yes' ? token.colorError : token.colorTextTertiary }}>
              截止：第{record.deadline_chapter}章{record.is_overdue === 'yes' ? '（已逾期）' : ''}
            </span>
          )}
        </Space>
      ),
    },
    {
      title: '类型', dataIndex: 'vow_type', key: 'vow_type', width: 90,
      render: (t: string) => VOW_TYPE_CONFIG[t] || t,
    },
    {
      title: '约束状态', dataIndex: 'status', key: 'status', width: 110,
      render: (s: string) => {
        const cfg = VOW_STATUS_CONFIG[s];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : s;
      },
    },
    {
      title: '重要性', dataIndex: 'importance', key: 'importance', width: 100,
      sorter: (a: TianmingVow, b: TianmingVow) => a.importance - b.importance,
      render: renderImportance,
    },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: unknown, record: TianmingVow) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定删除该誓约？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 0 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={load}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>添加誓约</Button>
      </div>
      <Table
        dataSource={vows}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="暂无誓约，章节生成/分析后会自动创建，也可手动添加" /> }}
      />
      <Modal
        title={currentVow ? '编辑誓约' : '添加誓约'}
        open={editModalVisible}
        centered
        onCancel={() => { setEditModalVisible(false); setCurrentVow(null); form.resetFields(); }}
        onOk={() => form.submit()}
        width={isMobile ? 'calc(100vw - 32px)' : 720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave} initialValues={{ vow_type: 'oath', status: 'active', importance: 0.5 }}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="title" label="誓约标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="如：血誓不伤同门" maxLength={200} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="importance" label="重要性 (0-1)">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="content" label="誓约内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={4} placeholder="誓约条款详情" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="vow_type" label="类型">
                <Select>
                  {Object.entries(VOW_TYPE_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="约束状态">
                <Select>
                  {Object.entries(VOW_STATUS_CONFIG).map(([k, v]) => (
                    <Option key={k} value={k}>{v.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="deadline_chapter" label="截止章节">
                <InputNumber min={1} placeholder="无则留空" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="breach_consequences" label="违约后果">
            <TextArea rows={2} placeholder="如：遭受反噬、修为倒退" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="如：血誓、契约、诅咒" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} placeholder="仅作者可见的备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ==================== 角色位置 Tab（只读） ====================
function LocationsTab({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<TianmingCharacterLocation[]>([]);
  const [charMap, setCharMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locData, chars] = await Promise.all([
        tianmingApi.listLocations(projectId),
        characterApi.getCharacters(projectId),
      ]);
      setLocations(locData);
      const map: Record<string, string> = {};
      chars.forEach(c => { map[c.id] = c.name; });
      setCharMap(map);
    } catch (e) {
      console.error('加载角色位置失败:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    {
      title: '角色', dataIndex: 'character_id', key: 'character_id', ellipsis: true,
      render: (id: string) => charMap[id] || <span style={{ color: '#999' }}>未知角色</span>,
    },
    {
      title: '当前位置', dataIndex: 'location', key: 'location',
      render: (loc: string) => <Tag color="blue">{loc}</Tag>,
    },
    {
      title: '前一位置', dataIndex: 'previous_location', key: 'previous_location',
      render: (loc?: string) => loc || '-',
    },
    {
      title: '到达章节', dataIndex: 'arrival_chapter_number', key: 'arrival_chapter_number', width: 100,
      render: (n?: number) => n ? `第${n}章` : '-',
    },
    {
      title: '到达原因', dataIndex: 'reason', key: 'reason', ellipsis: true,
      render: (r?: string) => r || '-',
    },
    {
      title: '状态', dataIndex: 'is_current', key: 'is_current', width: 90,
      render: (cur: boolean) => cur ? <Tag color="green">当前位置</Tag> : <Tag>历史</Tag>,
    },
  ];

  return (
    <div>
      <Alert
        message="角色位置由章节生成/分析时自动写入，用于防止AI写出角色位置混乱。此处为只读视图。"
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
      />
      <div style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={load}>刷新</Button>
      </div>
      <Table
        dataSource={locations}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="暂无角色位置记录，章节生成/分析后会自动写入" /> }}
      />
    </div>
  );
}

// ==================== 章节快照 Tab ====================
function SnapshotsTab({ projectId }: { projectId: string }) {
  const { token } = antdTheme.useToken();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<TianmingSnapshotListItem[]>([]);
  const [latest, setLatest] = useState<TianmingSnapshot | null>(null);
  const [latestLoading, setLatestLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<TianmingSnapshot | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tianmingApi.listSnapshots(projectId);
      setSnapshots(data);
    } catch (e) {
      console.error('加载快照列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadLatest = useCallback(async () => {
    setLatestLoading(true);
    try {
      const resp = await tianmingApi.getLatestSnapshot(projectId);
      setLatest(resp.snapshot || null);
    } catch (e) {
      console.error('加载最新快照失败:', e);
    } finally {
      setLatestLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadList();
    loadLatest();
  }, [loadList, loadLatest]);

  const openDetail = async (snapshotId: string) => {
    setDetailVisible(true);
    setDetailLoading(true);
    try {
      const data = await tianmingApi.getSnapshotDetail(snapshotId);
      setDetail(data);
    } catch (e) {
      console.error('加载快照详情失败:', e);
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    {
      title: '章节', dataIndex: 'chapter_number', key: 'chapter_number', width: 80,
      render: (n: number) => `第${n}章`,
    },
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 100,
      render: (s: string) => {
        const map: Record<string, { label: string; color: string }> = {
          generation: { label: '生成时', color: 'blue' },
          analysis: { label: '分析时', color: 'green' },
          manual: { label: '手动', color: 'default' },
        };
        const cfg = map[s] || { label: s, color: 'default' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '校验状态', dataIndex: 'validation_status', key: 'validation_status', width: 110,
      render: (s: string) => {
        const cfg = VALIDATION_STATUS_CONFIG[s];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : s;
      },
    },
    {
      title: '是否最新', dataIndex: 'is_latest', key: 'is_latest', width: 90,
      render: (cur: boolean) => cur ? <Tag color="green">最新</Tag> : '-',
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180,
      render: (t?: string) => t ? new Date(t).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_: unknown, record: TianmingSnapshotListItem) => (
        <Tooltip title="查看详情">
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record.id)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      {/* 最新快照概览 */}
      <Card size="small" title="最新快照" style={{ marginBottom: 12 }} extra={
        <Button size="small" icon={<ReloadOutlined spin={latestLoading} />} onClick={loadLatest}>刷新</Button>
      }>
        {latestLoading ? (
          <Spin size="small" />
        ) : latest ? (
          <Descriptions size="small" column={isMobile ? 2 : 4}>
            <Descriptions.Item label="章节">第{latest.chapter_number}章</Descriptions.Item>
            <Descriptions.Item label="来源">
              {({ generation: '生成时', analysis: '分析时', manual: '手动' } as Record<string, string>)[latest.source] || latest.source}
            </Descriptions.Item>
            <Descriptions.Item label="校验状态">
              {VALIDATION_STATUS_CONFIG[latest.validation_status]?.label || latest.validation_status}
            </Descriptions.Item>
            <Descriptions.Item label="需修正">{latest.needs_revision ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="15维快照维度数" span={2}>
              {Object.keys(latest.snapshot_data || {}).length}
            </Descriptions.Item>
            <Descriptions.Item label="CHANGES类别数" span={2}>
              {Object.keys(latest.changes_data || {}).length}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Empty description="暂无快照" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      <div style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={loadList}>刷新列表</Button>
      </div>
      <Table
        dataSource={snapshots}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="暂无快照，章节生成/分析后会自动创建" /> }}
      />

      <Modal
        title={detail ? `第${detail.chapter_number}章 快照详情` : '快照详情'}
        open={detailVisible}
        centered
        onCancel={() => { setDetailVisible(false); setDetail(null); }}
        footer={[<Button key="close" onClick={() => setDetailVisible(false)}>关闭</Button>]}
        width={isMobile ? 'calc(100vw - 32px)' : 900}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : detail ? (
          <Tabs
            items={[
              {
                key: 'snapshot',
                label: '15维事实快照',
                children: (
                  <div>
                    <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                      {Object.entries(SNAPSHOT_DIM_LABELS).map(([key, label]) => {
                        const data = (detail.snapshot_data || {})?.[key];
                        const count = Array.isArray(data) ? data.length : (data ? 1 : 0);
                        return (
                          <Col span={isMobile ? 12 : 6} key={key}>
                            <Card size="small" style={{ opacity: count > 0 ? 1 : 0.5 }}>
                              <Statistic title={label} value={count} suffix="项" valueStyle={{ fontSize: 16 }} />
                            </Card>
                          </Col>
                        );
                      })}
                    </Row>
                    <Alert message="点击下方面板查看各维度详细数据（JSON格式，供高级用户/调试使用）" type="info" showIcon style={{ marginBottom: 8 }} />
                    <Collapse
                      size="small"
                      items={Object.entries(SNAPSHOT_DIM_LABELS).map(([key, label]) => {
                        const data = (detail.snapshot_data || {})?.[key];
                        const isEmpty = data === null || data === undefined || (Array.isArray(data) && data.length === 0);
                        const count = Array.isArray(data) ? data.length : (data ? 1 : 0);
                        return {
                          key,
                          label: (
                            <Space>
                              <span>{label}</span>
                              <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>
                            </Space>
                          ),
                          children: isEmpty ? (
                            <Text type="secondary">无数据</Text>
                          ) : (
                            <pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', background: token.colorFillAlter, padding: 8, borderRadius: 4, fontSize: 12 }}>
                              {JSON.stringify(data, null, 2)}
                            </pre>
                          ),
                        };
                      })}
                    />
                  </div>
                ),
              },
              {
                key: 'changes',
                label: '12类CHANGES',
                children: (
                  <div>
                    <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                      {Object.entries(CHANGES_TYPE_LABELS).map(([key, label]) => {
                        const data = (detail.changes_data || {})?.[key];
                        const count = Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : (data ? 1 : 0));
                        return (
                          <Col span={isMobile ? 12 : 6} key={key}>
                            <Card size="small" style={{ opacity: count > 0 ? 1 : 0.5 }}>
                              <Statistic title={label} value={count} suffix="项" valueStyle={{ fontSize: 16 }} />
                            </Card>
                          </Col>
                        );
                      })}
                    </Row>
                    <Alert message="CHANGES是AI生成章节时声明的状态变更，点击下方面板查看详情" type="info" showIcon style={{ marginBottom: 8 }} />
                    <Collapse
                      size="small"
                      items={Object.entries(CHANGES_TYPE_LABELS).map(([key, label]) => {
                        const data = (detail.changes_data || {})?.[key];
                        const isEmpty = data === null || data === undefined || (Array.isArray(data) && data.length === 0) || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
                        const count = Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : (data ? 1 : 0));
                        return {
                          key,
                          label: (
                            <Space>
                              <span>{label}</span>
                              <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>
                            </Space>
                          ),
                          children: isEmpty ? (
                            <Text type="secondary">无数据</Text>
                          ) : (
                            <pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', background: token.colorFillAlter, padding: 8, borderRadius: 4, fontSize: 12 }}>
                              {JSON.stringify(data, null, 2)}
                            </pre>
                          ),
                        };
                      })}
                    />
                  </div>
                ),
              },
              {
                key: 'validation',
                label: '门禁校验',
                children: detail.validation_report ? (
                  <div>
                    <Alert message="门禁校验报告（JSON格式，展示六道验证门的检查结果）" type="info" showIcon style={{ marginBottom: 8 }} />
                    <pre style={{ margin: 0, maxHeight: 400, overflow: 'auto', background: token.colorFillAlter, padding: 12, borderRadius: 4, fontSize: 12 }}>
                      {JSON.stringify(detail.validation_report, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <Empty description="未执行门禁校验" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ),
              },
            ]}
          />
        ) : null}
      </Modal>
    </div>
  );
}
