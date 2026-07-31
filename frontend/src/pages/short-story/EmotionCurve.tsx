import { useEffect, useState, useRef } from 'react';
import {
  Card,
  Typography,
  Input,
  Slider,
  Button,
  message,
  Tag,
  Empty,
  theme,
} from 'antd';
import { SaveOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import { STORY_STAGE_CONFIG } from '../../constants/shortStory';
import type { ShortStory, EmotionNode } from '../../types';

const { Title, Text } = Typography;

interface EmotionCurveEditorProps {
  story: ShortStory;
  /** 内嵌模式：隐藏页面级标题/Alert/外层 padding，由父容器提供 Card 包装 */
  embedded?: boolean;
}

const DEFAULT_NODES: EmotionNode[] = [
  { stage: 'opening', emotion: '紧张/震惊', intensity: 7 },
  { stage: 'buildup', emotion: '愤怒/屈辱', intensity: 9 },
  { stage: 'twist', emotion: '爽感/震撼', intensity: 10 },
  { stage: 'ending', emotion: '释怀/余味', intensity: 6 },
];

/**
 * 情绪曲线编辑器（节点增删 + SVG 预览）。
 * 既可作为独立组件被 Setup.tsx 内嵌（embedded=true），也可作为路由页使用。
 * 注：原独立 Tab 已合并进 Setup.tsx，路由已移除，此处保留组件供 Setup 引用。
 */
export default function EmotionCurveEditor({ story, embedded = false }: EmotionCurveEditorProps) {
  const { token } = theme.useToken();
  const { updateCurrentStory } = useShortStoryStore();
  const [nodes, setNodes] = useState<EmotionNode[]>(DEFAULT_NODES);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const parsed = story.emotion_curve ? JSON.parse(story.emotion_curve) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setNodes(parsed);
      } else {
        setNodes(DEFAULT_NODES);
      }
    } catch {
      setNodes(DEFAULT_NODES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const updated = await shortStoryApi.update(story.id, {
        emotion_curve: JSON.stringify(nodes),
      });
      updateCurrentStory(updated);
      if (showMessage) message.success('已保存');
    } catch (error) {
      showErrorToast(error, '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const scheduleAutoSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(false), 1500);
  };

  const updateNode = (index: number, field: keyof EmotionNode, value: string | number) => {
    const newNodes = [...nodes];
    newNodes[index] = { ...newNodes[index], [field]: value };
    setNodes(newNodes);
    scheduleAutoSave();
  };

  // 计算SVG曲线点位
  const width = 600;
  const height = 240;
  const padding = 40;
  // 节点数 <= 1 时不计算间距，避免除零
  const pointSpacing = nodes.length <= 1 ? 0 : (width - padding * 2) / (nodes.length - 1);
  const points = nodes.map((node, i) => ({
    // 节点数为 1 时居中显示；为 0 时该分支不会执行
    x: nodes.length === 1 ? width / 2 : padding + i * pointSpacing,
    y: height - padding - ((node.intensity - 1) / 9) * (height - padding * 2),
    node,
  }));

  // 生成平滑路径（points 为空时返回空字符串）
  const pathD = points.length === 0
    ? ''
    : points.reduce((acc, point, i) => {
        if (i === 0) return `M ${point.x} ${point.y}`;
        const prev = points[i - 1];
        const cpX = (prev.x + point.x) / 2;
        return `${acc} Q ${cpX} ${prev.y}, ${cpX} ${(prev.y + point.y) / 2} T ${point.x} ${point.y}`;
      }, '');

  return (
    <div style={embedded ? undefined : { padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {!embedded && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>情绪曲线</Title>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存
          </Button>
        </div>
      )}

      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button size="small" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存曲线
          </Button>
        </div>
      )}

      <Card size="small" title="情绪曲线总览" style={{ marginBottom: 16 }}>
        {nodes.length === 0 ? (
          <Empty description="暂无情绪节点" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ maxWidth: width }} role="img" aria-label="情绪曲线图">
              {/* 坐标轴 */}
              <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke={token.colorBorder} />
              <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke={token.colorBorder} />

              {/* Y轴标签 */}
              {[1, 5, 10].map((v) => {
                const y = height - padding - ((v - 1) / 9) * (height - padding * 2);
                return (
                  <g key={v}>
                    <text x={padding - 8} y={y + 4} textAnchor="end" fontSize={11} fill={token.colorTextSecondary}>
                      {v}
                    </text>
                    <line x1={padding - 4} y1={y} x2={padding} y2={y} stroke={token.colorBorder} />
                  </g>
                );
              })}
              <text x={padding - 30} y={height / 2} textAnchor="middle" fontSize={11} fill={token.colorTextSecondary} transform={`rotate(-90, ${padding - 30}, ${height / 2})`}>
                情绪强度
              </text>

              {/* 曲线（points 为空时不渲染） */}
              {pathD && <path d={pathD} fill="none" stroke={token.colorPrimary} strokeWidth={2.5} style={{ transition: 'all 0.3s ease' }} />}

              {/* 渐变填充（至少 2 个点才有意义） */}
              {points.length >= 2 && (
                <path
                  d={`${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`}
                  fill={token.colorPrimaryBg}
                  opacity={0.5}
                  style={{ transition: 'all 0.3s ease' }}
                />
              )}

              {/* 数据点 */}
              {points.map((point, i) => {
                const cfg = STORY_STAGE_CONFIG[point.node.stage];
                return (
                  <g key={i}>
                    <circle cx={point.x} cy={point.y} r={6} fill={token.colorPrimary} style={{ transition: 'all 0.3s ease' }} />
                    <text x={point.x} y={point.y - 12} textAnchor="middle" fontSize={11} fill={token.colorText} fontWeight="bold">
                      {point.node.intensity}
                    </text>
                    <text x={point.x} y={height - padding + 16} textAnchor="middle" fontSize={11} fill={token.colorTextSecondary}>
                      {cfg.label.split('（')[0]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </Card>

      {nodes.map((node, index) => {
        const cfg = STORY_STAGE_CONFIG[node.stage];
        return (
          <Card
            key={index}
            size="small"
            style={{ marginBottom: 12, borderLeft: `4px solid ${token.colorBorderSecondary}` }}
            title={
              <span>
                <Tag color={cfg.color}>{cfg.label}</Tag>
              </span>
            }
            extra={
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setNodes(nodes.filter((_, i) => i !== index));
                  scheduleAutoSave();
                }}
              />
            }
          >
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              {cfg.desc}
            </Text>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: '1 1 200px' }}>
                <Text strong style={{ fontSize: 13 }}>情绪：</Text>
                <Input
                  value={node.emotion}
                  onChange={(e) => updateNode(index, 'emotion', e.target.value)}
                  style={{ width: 'calc(100% - 60px)', marginLeft: 8 }}
                  placeholder="例：愤怒/屈辱"
                />
              </div>
              <div style={{ flex: '1 1 280px' }}>
                <Text strong style={{ fontSize: 13 }}>强度：</Text>
                <Slider
                  min={1}
                  max={10}
                  value={node.intensity}
                  onChange={(v) => updateNode(index, 'intensity', v)}
                  style={{ width: 'calc(100% - 60px)', display: 'inline-block', marginLeft: 8 }}
                  marks={{ 1: '1', 5: '5', 10: '10' }}
                />
              </div>
            </div>
          </Card>
        );
      })}

      <Button
        type="dashed"
        icon={<PlusOutlined />}
        block
        style={{ marginBottom: 16 }}
        onClick={() => {
          setNodes([...nodes, { stage: 'opening', emotion: '', intensity: 5 }]);
          scheduleAutoSave();
        }}
      >
        添加节点
      </Button>
    </div>
  );
}
