import { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Card,
  Typography,
  Input,
  Slider,
  Button,
  message,
  Tag,
  Alert,
  theme,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import type { ShortStory, EmotionNode } from '../../types';

const { Title, Text } = Typography;

const STAGE_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  opening: {
    label: '开头（死亡黄金钩子）',
    color: '#1677ff',
    desc: '前300字抛出核心危机现场，情绪紧张/震惊',
  },
  buildup: {
    label: '铺垫（冲突激化与打压）',
    color: '#fa8c16',
    desc: '反派嚣张主角劣势，愤怒/屈辱感拉到最高',
  },
  twist: {
    label: '反转（绝地反击）',
    color: '#f5222d',
    desc: '亮出底牌，剥洋葱式揭露，爆点情绪',
  },
  ending: {
    label: '结尾（爽点收尾）',
    color: '#722ed1',
    desc: '情绪释放，主角走向新人生，余味悠长',
  },
};

const DEFAULT_NODES: EmotionNode[] = [
  { stage: 'opening', emotion: '紧张/震惊', intensity: 7 },
  { stage: 'buildup', emotion: '愤怒/屈辱', intensity: 9 },
  { stage: 'twist', emotion: '爽感/震撼', intensity: 10 },
  { stage: 'ending', emotion: '释怀/余味', intensity: 6 },
];

interface ContextType {
  story: ShortStory;
  reload: () => Promise<void>;
}

export default function EmotionCurve() {
  const { story } = useOutletContext<ContextType>();
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
  const pointSpacing = (width - padding * 2) / (nodes.length - 1);
  const points = nodes.map((node, i) => ({
    x: padding + i * pointSpacing,
    y: height - padding - ((node.intensity - 1) / 9) * (height - padding * 2),
    node,
  }));

  // 生成平滑路径
  const pathD = points.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const cpX = (prev.x + point.x) / 2;
    return `${acc} Q ${cpX} ${prev.y}, ${cpX} ${(prev.y + point.y) / 2} T ${point.x} ${point.y}`;
  }, '');

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>情绪曲线</Title>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
          保存
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="波浪式情绪过山车"
        description={
          <Text style={{ fontSize: 13 }}>
            长篇看世界观，短故事只看情绪波动。每1000-1500字必须有一次小冲突或小揭秘，不能有超过500字的纯说明性废话。
            永远让读者处于"气得牙痒痒"或"爽得起鸡皮疙瘩"的状态。
          </Text>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
          <svg width={width} height={height} style={{ minWidth: width }}>
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

            {/* 曲线 */}
            <path d={pathD} fill="none" stroke={token.colorPrimary} strokeWidth={2.5} />

            {/* 渐变填充 */}
            <path
              d={`${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`}
              fill={token.colorPrimaryBg}
              opacity={0.5}
            />

            {/* 数据点 */}
            {points.map((point, i) => {
              const cfg = STAGE_CONFIG[point.node.stage];
              return (
                <g key={i}>
                  <circle cx={point.x} cy={point.y} r={6} fill={cfg.color} />
                  <text x={point.x} y={point.y - 12} textAnchor="middle" fontSize={11} fill={cfg.color} fontWeight="bold">
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
      </Card>

      {nodes.map((node, index) => {
        const cfg = STAGE_CONFIG[node.stage];
        return (
          <Card
            key={node.stage}
            size="small"
            style={{ marginBottom: 12, borderLeft: `4px solid ${cfg.color}` }}
            title={
              <span>
                <Tag color={cfg.color}>{cfg.label}</Tag>
              </span>
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
    </div>
  );
}
