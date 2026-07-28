import { useState, useEffect, useCallback } from 'react';
import {
  Button, Modal, Form, Input, Select, message, Progress, Timeline,
  Tag, Space, Empty, Spin, InputNumber, Divider, Popconfirm
} from 'antd';
import {
  PlusOutlined, ThunderboltOutlined, EditOutlined, DeleteOutlined,
  RocketOutlined
} from '@ant-design/icons';
import { characterArcApi } from '../services/api';
import type { CharacterArc, CharacterArcCreate } from '../types';

const { TextArea } = Input;

const ARC_TYPE_LABELS: Record<string, string> = {
  growth: '成长',
  fall: '堕落',
  redemption: '救赎',
  awakening: '顿悟',
  sacrifice: '牺牲',
};

const ARC_STAGE_LABELS: Record<string, string> = {
  trigger: '触发期',
  struggle: '挣扎期',
  turning_point: '转折期',
  transformation: '蜕变期',
  completion: '完成期',
};

const ARC_TYPE_COLORS: Record<string, string> = {
  growth: 'green',
  fall: 'red',
  redemption: 'blue',
  awakening: 'purple',
  sacrifice: 'orange',
};

interface CharacterArcPanelProps {
  characterId: string;
  projectId: string;
}

export function CharacterArcPanel({ characterId, projectId }: CharacterArcPanelProps) {
  const [arcs, setArcs] = useState<CharacterArc[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingArc, setEditingArc] = useState<CharacterArc | null>(null);
  const [generating, setGenerating] = useState(false);
  const [form] = Form.useForm();

  const loadArcs = useCallback(async () => {
    if (!characterId) return;
    setLoading(true);
    try {
      const data = await characterArcApi.getCharacterArcs(characterId);
      setArcs(data || []);
    } catch (e: any) {
      message.error(e?.message || '加载弧光失败');
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    loadArcs();
  }, [loadArcs]);

  const handleCreate = () => {
    setEditingArc(null);
    form.resetFields();
    form.setFieldsValue({
      arc_type: 'growth',
      current_stage: 'trigger',
      stage_progress: 0,
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const handleEdit = (arc: CharacterArc) => {
    setEditingArc(arc);
    form.setFieldsValue({
      ...arc,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (arcId: string) => {
    try {
      await characterArcApi.deleteArc(arcId);
      message.success('弧光已删除');
      loadArcs();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingArc) {
        await characterArcApi.updateArc(editingArc.id, values);
        message.success('弧光已更新');
      } else {
        const createData: CharacterArcCreate = {
          ...values,
          project_id: projectId,
          character_id: characterId,
        };
        await characterArcApi.createArc(createData);
        message.success('弧光已创建');
      }
      setIsModalOpen(false);
      loadArcs();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误，不提示
      message.error(e?.message || '保存失败');
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await characterArcApi.generateArc(projectId, characterId);
      message.success('AI 弧光已生成');
      loadArcs();
    } catch (e: any) {
      message.error(e?.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const activeArcs = arcs.filter(a => a.status === 'active');
  const inactiveArcs = arcs.filter(a => a.status !== 'active');

  return (
    <div style={{ marginTop: 16 }}>
      <Divider orientation="left" style={{ margin: '8px 0 12px' }}>
        <RocketOutlined style={{ marginRight: 6 }} />
        角色弧光 ({arcs.length})
      </Divider>

      <Space style={{ marginBottom: 12 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={handleCreate}>
          添加弧光
        </Button>
        <Button
          size="small"
          type="dashed"
          icon={<ThunderboltOutlined />}
          onClick={handleGenerate}
          loading={generating}
        >
          AI 生成
        </Button>
      </Space>

      <Spin spinning={loading}>
        {arcs.length === 0 && !loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无弧光，角色将缺乏成长轨迹"
            style={{ margin: '12px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeArcs.map((arc) => (
              <ArcCard
                key={arc.id}
                arc={arc}
                onEdit={() => handleEdit(arc)}
                onDelete={() => handleDelete(arc.id)}
              />
            ))}
            {inactiveArcs.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                  已结束的弧光:
                </div>
                {inactiveArcs.map((arc) => (
                  <ArcCard
                    key={arc.id}
                    arc={arc}
                    onEdit={() => handleEdit(arc)}
                    onDelete={() => handleDelete(arc.id)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </Spin>

      <Modal
        title={editingArc ? '编辑弧光' : '创建弧光'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        width={560}
        styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="弧光类型" name="arc_type" rules={[{ required: true }]}>
            <Select>
              {Object.entries(ARC_TYPE_LABELS).map(([k, v]) => (
                <Select.Option key={k} value={k}>{v}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="核心目标" name="core_goal" rules={[{ required: true, message: '请输入核心目标' }]}>
            <Input placeholder="角色在整个弧光中追求什么" />
          </Form.Item>
          <Form.Item label="动机" name="motivation">
            <TextArea rows={2} placeholder="为什么追求这个目标" />
          </Form.Item>
          <Form.Item label="内在冲突" name="internal_conflict">
            <TextArea rows={2} placeholder="阻碍角色达成目标的心理矛盾" />
          </Form.Item>
          <Form.Item label="近期外在目标" name="external_goal">
            <Input placeholder="本章/近几章可推进的小目标" />
          </Form.Item>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item label="当前阶段" name="current_stage" style={{ flex: 1, marginBottom: 12 }}>
              <Select>
                {Object.entries(ARC_STAGE_LABELS).map(([k, v]) => (
                  <Select.Option key={k} value={k}>{v}</Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="进度 (%)" name="stage_progress" style={{ width: 120, marginBottom: 12 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item label="状态" name="status">
            <Select>
              <Select.Option value="active">进行中</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
              <Select.Option value="abandoned">已放弃</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="预期完成章节" name="target_resolution_chapter">
            <InputNumber min={1} style={{ width: '100%' }} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function ArcCard({
  arc,
  onEdit,
  onDelete,
}: {
  arc: CharacterArc;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const typeLabel = ARC_TYPE_LABELS[arc.arc_type] || arc.arc_type;
  const typeColor = ARC_TYPE_COLORS[arc.arc_type] || 'default';
  const stageLabel = ARC_STAGE_LABELS[arc.current_stage || ''] || arc.current_stage || '触发期';
  const progress = arc.stage_progress || 0;
  const milestones = arc.milestones || [];

  return (
    <div
      style={{
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 6,
        padding: 12,
        backgroundColor: 'var(--color-fill-quaternary)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <Space wrap>
          <Tag color={typeColor}>{typeLabel}</Tag>
          {arc.status !== 'active' && (
            <Tag>{arc.status === 'completed' ? '已完成' : '已放弃'}</Tag>
          )}
          <span style={{ fontSize: 13, fontWeight: 500 }}>{arc.core_goal}</span>
        </Space>
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} />
          <Popconfirm title="确定删除此弧光？" onConfirm={onDelete} okText="删除" cancelText="取消">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>

      {arc.motivation && (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          动机：{arc.motivation}
        </div>
      )}
      {arc.internal_conflict && (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          内在冲突：{arc.internal_conflict}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Tag color="blue" style={{ margin: 0 }}>{stageLabel}</Tag>
        <Progress
          percent={progress}
          size="small"
          status={arc.status === 'completed' ? 'success' : 'active'}
          style={{ flex: 1, margin: 0 }}
        />
      </div>

      {milestones.length > 0 && (
        <Timeline
          style={{ marginTop: 8, paddingLeft: 4 }}
          items={milestones.slice(-5).reverse().map((m) => ({
            children: (
              <div style={{ fontSize: 12 }}>
                <strong>第{m.chapter}章</strong>
                {m.stage_shift && <Tag style={{ marginLeft: 4, fontSize: 11 }}>{m.stage_shift}</Tag>}
                <div style={{ color: 'var(--color-text-secondary)' }}>{m.event}</div>
                {m.goal_progress_delta ? (
                  <span style={{ color: m.goal_progress_delta > 0 ? '#52c41a' : '#ff4d4f', fontSize: 11 }}>
                    进度 {m.goal_progress_delta > 0 ? '+' : ''}{m.goal_progress_delta}
                  </span>
                ) : null}
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}
