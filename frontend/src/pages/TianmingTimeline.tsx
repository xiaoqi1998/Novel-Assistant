import { useState, useEffect, useCallback } from 'react';
import {
  Card, Spin, Empty, Tag, Space, Button, Typography, Row, Col, Statistic,
  Timeline, Alert, Tooltip, message, theme as antdTheme,
} from 'antd';
import {
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ExclamationCircleOutlined, MinusCircleOutlined, CameraOutlined,
  SafetyCertificateOutlined, EditFilled, ThunderboltOutlined,
} from '@ant-design/icons';
import { tianmingApi } from '../services/api';
import type { TianmingSnapshotTimelineItem } from '../types';
import useIsMobile from '../utils/useIsMobile';

const { Title, Text, Paragraph } = Typography;

// 状态展示配置（与 Tianming.tsx 共用语义）
const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  timelineColor: string;
  icon: React.ReactNode;
}> = {
  not_checked: {
    label: '未校验',
    color: 'default',
    timelineColor: 'gray',
    icon: <MinusCircleOutlined />,
  },
  passed: {
    label: '通过',
    color: 'green',
    timelineColor: 'green',
    icon: <CheckCircleOutlined />,
  },
  warnings: {
    label: '有警告',
    color: 'orange',
    timelineColor: 'orange',
    icon: <ExclamationCircleOutlined />,
  },
  failed: {
    label: '未通过',
    color: 'red',
    timelineColor: 'red',
    icon: <CloseCircleOutlined />,
  },
};

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  generation: { label: '生成时', color: 'blue' },
  analysis: { label: '分析时', color: 'cyan' },
  manual: { label: '手动', color: 'default' },
};

// 来源图标
const SOURCE_ICON: Record<string, React.ReactNode> = {
  generation: <CameraOutlined />,
  analysis: <SafetyCertificateOutlined />,
  manual: <EditFilled />,
};

interface Props {
  projectId: string;
}

export default function TianmingTimelineView({ projectId }: Props) {
  const { token } = antdTheme.useToken();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState<TianmingSnapshotTimelineItem[]>([]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await tianmingApi.getSnapshotsTimeline(projectId);
      // 按章节号升序存储，时间线从早到晚
      const sorted = [...data].sort((a, b) => a.chapter_number - b.chapter_number);
      setTimeline(sorted);
    } catch (e) {
      console.error('加载时间线失败:', e);
      message.error('加载时间线失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // 聚合统计
  const total = timeline.length;
  const stats = {
    passed: timeline.filter(t => t.validation_status === 'passed').length,
    warnings: timeline.filter(t => t.validation_status === 'warnings').length,
    failed: timeline.filter(t => t.validation_status === 'failed').length,
    not_checked: timeline.filter(t => t.validation_status === 'not_checked').length,
    needs_revision: timeline.filter(t => t.needs_revision).length,
    latest_checked: timeline.filter(t => t.validation_status !== 'not_checked').length,
  };
  const ai_gate_coverage = total > 0 ? Math.round((stats.latest_checked / total) * 100) : 0;
  const pass_rate = stats.latest_checked > 0
    ? Math.round((stats.passed / stats.latest_checked) * 100)
    : 0;

  // 时间线项（倒序展示，最新在上）
  const timelineItems = [...timeline].reverse().map(item => {
    const cfg = STATUS_CONFIG[item.validation_status] || STATUS_CONFIG.not_checked;
    const sourceCfg = SOURCE_CONFIG[item.source] || { label: item.source, color: 'default' };
    const sourceIcon = SOURCE_ICON[item.source] || <CameraOutlined />;
    const borderColor = cfg.timelineColor === 'gray' ? token.colorBorder : cfg.timelineColor;
    return {
      key: item.id,
      color: cfg.timelineColor as string,
      dot: (
        <Tooltip title={cfg.label}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: token.colorBgContainer, border: `1px solid ${borderColor}` }}>
            <span style={{ color: borderColor, fontSize: 11 }}>
              {cfg.icon}
            </span>
          </span>
        </Tooltip>
      ),
      children: (
        <Card
          size="small"
          style={{
            marginBottom: 8,
            borderColor: borderColor,
            borderWidth: item.is_latest ? 2 : 1,
          }}
          title={
            <Space size={6} wrap>
              <Text strong>第 {item.chapter_number} 章</Text>
              {item.is_latest && <Tag color="green">最新</Tag>}
              <Tag color={cfg.color} icon={cfg.icon as React.ReactNode}>{cfg.label}</Tag>
              <Tag color={sourceCfg.color} icon={sourceIcon as React.ReactNode}>{sourceCfg.label}</Tag>
            </Space>
          }
          extra={
            <Space size="small">
              {item.needs_revision && (
                <Tooltip title="含修正建议">
                  <Tag color="orange" icon={<ThunderboltOutlined />}>需修正</Tag>
                </Tooltip>
              )}
              {item.suggestions_count > 0 && (
                <Tag color="red">{item.suggestions_count} 条建议</Tag>
              )}
            </Space>
          }
        >
          <Paragraph type="secondary" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            {item.created_at && (
              <>创建：{new Date(item.created_at).toLocaleString('zh-CN')}</>
            )}
            {item.updated_at && item.updated_at !== item.created_at && (
              <><br />更新：{new Date(item.updated_at).toLocaleString('zh-CN')}</>
            )}
          </Paragraph>
        </Card>
      ),
    };
  });

  return (
    // 跟随页面自然滚动（不锁定高度），避免内容被裁剪后无法下滑
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Alert
        message={
          <Space>
            <SafetyCertificateOutlined />
            <span>状态时间线：展示每章快照的校验-修正演进轨迹。绿色=通过、橙色=有警告、红色=未通过、灰色=未校验。</span>
          </Space>
        }
        type="info"
        showIcon={false}
        style={{ marginBottom: 12 }}
        closable
      />

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={5} style={{ margin: 0 }}>章节-校验-修正演进</Title>
        <Button icon={<ReloadOutlined spin={loading} />} onClick={load}>刷新</Button>
      </div>

      {/* 顶部统计概览 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col span={isMobile ? 12 : 4}>
          <Card size="small">
            <Statistic title="快照总数" value={total} suffix="章" valueStyle={{ fontSize: 18 }} prefix={<CameraOutlined />} />
          </Card>
        </Col>
        <Col span={isMobile ? 12 : 4}>
          <Card size="small">
            <Statistic
              title="校验通过"
              value={stats.passed}
              suffix="章"
              valueStyle={{ fontSize: 18, color: token.colorSuccess }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={isMobile ? 12 : 4}>
          <Card size="small">
            <Statistic
              title="未通过"
              value={stats.failed + stats.warnings}
              suffix="章"
              valueStyle={{ fontSize: 18, color: stats.failed + stats.warnings > 0 ? token.colorWarning : token.colorSuccess }}
              prefix={<ExclamationCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={isMobile ? 12 : 4}>
          <Card size="small">
            <Statistic
              title="待修正"
              value={stats.needs_revision}
              suffix="章"
              valueStyle={{ fontSize: 18, color: stats.needs_revision > 0 ? token.colorError : token.colorTextSecondary }}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
        <Col span={isMobile ? 12 : 4}>
          <Card size="small">
            <Statistic
              title="AI门覆盖"
              value={ai_gate_coverage}
              suffix="%"
              valueStyle={{ fontSize: 18, color: token.colorPrimary }}
              prefix={<SafetyCertificateOutlined />}
            />
          </Card>
        </Col>
        <Col span={isMobile ? 12 : 4}>
          <Card size="small">
            <Statistic
              title="通过率"
              value={pass_rate}
              suffix="%"
              valueStyle={{ fontSize: 18, color: pass_rate >= 80 ? token.colorSuccess : pass_rate >= 50 ? token.colorWarning : token.colorError }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 状态分布条 */}
      {total > 0 && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Text strong style={{ fontSize: 12 }}>状态分布：</Text>
            <div style={{ flex: 1, minWidth: 200, height: 12, background: token.colorFillSecondary, borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
              {(['passed', 'warnings', 'failed', 'not_checked'] as const).map(k => {
                const count = stats[k];
                if (count === 0) return null;
                const color = {
                  passed: token.colorSuccess,
                  warnings: token.colorWarning,
                  failed: token.colorError,
                  not_checked: token.colorFill,
                }[k];
                const width = (count / total) * 100;
                return (
                  <Tooltip key={k} title={`${STATUS_CONFIG[k].label}: ${count} 章 (${Math.round(width)}%)`}>
                    <div style={{ width: `${width}%`, background: color, height: '100%' }} />
                  </Tooltip>
                );
              })}
            </div>
            <Space size={8} wrap>
              {(['passed', 'warnings', 'failed', 'not_checked'] as const).map(k => (
                <Space key={k} size={4}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: {
                    passed: token.colorSuccess,
                    warnings: token.colorWarning,
                    failed: token.colorError,
                    not_checked: token.colorFill,
                  }[k] }} />
                  <Text style={{ fontSize: 11 }}>{STATUS_CONFIG[k].label} {stats[k]}</Text>
                </Space>
              ))}
            </Space>
          </div>
        </Card>
      )}

      {/* 时间线主体（随页面滚动） */}
      <div style={{ paddingRight: 4 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : timelineItems.length > 0 ? (
          <Timeline
            items={timelineItems}
            mode="left"
            style={{ paddingTop: 4 }}
          />
        ) : (
          <Empty description="暂无快照数据，章节生成/分析后会自动创建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>

      {/* 底部提示 */}
      <div style={{ paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          切换到「章节快照」Tab 可对单个章节执行重新校验或 AI 修正
        </Text>
      </div>
    </div>
  );
}
