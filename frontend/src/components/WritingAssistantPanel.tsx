/**
 * 写作助手侧边栏 - 聚合写作上下文（E1）
 *
 * 在章节编辑器右侧展示当前章节的写作上下文：
 * - 本章大纲（从 expansion_plan 提取）
 * - 出场角色（从 expansion_plan.character_focus）
 * - 情绪曲线（从 expansion_plan.emotion_curve 可视化）
 * - 章末钩子（从 expansion_plan.ending_hook）
 * - 场景节拍（从 expansion_plan.scene_beats）
 * - 信息节奏（从 expansion_plan.information_rhythm）
 */
import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Collapse, Tag, Empty, Spin, Typography, theme, Tooltip, Button } from 'antd';
import {
  FileTextOutlined,
  TeamOutlined,
  FireOutlined,
  BgColorsOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  ReloadOutlined,
  BulbOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface WritingAssistantPanelProps {
  chapterId: string;
}

// expansion_plan 解析后的结构（部分字段）
interface ParsedPlan {
  key_events?: string[];
  character_focus?: string[];
  emotional_tone?: string;
  narrative_goal?: string;
  conflict_type?: string;
  emotion_curve?: {
    start?: string;
    middle?: string;
    peak?: string;
    end?: string;
    transitions?: string[];
  };
  ending_hook?: {
    type?: string;
    description?: string;
    target_emotion?: string;
  };
  scene_beats?: Array<{
    scene_order?: number;
    location?: string;
    entry_hook?: string;
    scene_goal?: string;
    conflict?: string;
    turning_point?: string;
    exit_hook?: string;
    estimated_words?: number;
  }>;
  information_rhythm?: {
    reveal_points?: Array<{ timing?: string; info?: string; method?: string }>;
    withhold_points?: Array<{ info?: string; reason?: string; hint_type?: string }>;
    information_gap?: string;
  };
}

const parsePlan = (raw?: string): ParsedPlan | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedPlan;
  } catch {
    return null;
  }
};

const HOOK_TYPE_COLORS: Record<string, string> = {
  突然揭示: 'red',
  紧急危机: 'volcano',
  未完成动作: 'orange',
  身份反转: 'purple',
  两难抉择: 'magenta',
  神秘物品: 'geekblue',
  倒计时: 'gold',
  承诺威胁: 'lime',
  离奇消失: 'cyan',
  隐藏含义: 'blue',
  意象钩子: 'green',
  回声钩子: 'green',
  留白钩子: 'default',
};

export default function WritingAssistantPanel({ chapterId }: WritingAssistantPanelProps) {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [chapterNumber, setChapterNumber] = useState<number | null>(null);

  const loadContext = async () => {
    if (!chapterId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/chapters/${chapterId}`);
      if (!res.ok) {
        setPlan(null);
        return;
      }
      const data = await res.json();
      setChapterNumber(data.chapter_number ?? null);
      setPlan(parsePlan(data.expansion_plan));
    } catch (err) {
      console.warn('加载写作上下文失败:', err);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  // 情绪曲线数据点
  const emotionPoints = useMemo(() => {
    if (!plan?.emotion_curve) return [];
    const c = plan.emotion_curve;
    return [
      { label: '起始', value: c.start },
      { label: '中段', value: c.middle },
      { label: '高潮', value: c.peak },
      { label: '结尾', value: c.end },
    ].filter(p => p.value);
  }, [plan]);

  const hasAnyData = !!(
    plan?.key_events?.length ||
    plan?.character_focus?.length ||
    plan?.emotional_tone ||
    plan?.emotion_curve ||
    plan?.ending_hook ||
    plan?.scene_beats?.length ||
    plan?.information_rhythm
  );

  const alpha = (color: string, a: number) => `color-mix(in srgb, ${color} ${(a * 100).toFixed(0)}%, transparent)`;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: alpha(token.colorBgElevated, 0.6),
      borderLeft: `1px solid ${token.colorBorderSecondary}`,
    }}>
      {/* 顶部标题栏 */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BulbOutlined style={{ color: token.colorPrimary, fontSize: 14 }} />
          <Text strong style={{ fontSize: 13 }}>写作助手</Text>
          {chapterNumber != null && (
            <Tag style={{ fontSize: 10, marginInline: 0 }}>第{chapterNumber}章</Tag>
          )}
        </div>
        <Tooltip title="刷新上下文">
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadContext}
            loading={loading}
          />
        </Tooltip>
      </div>

      {/* 内容区（滚动） */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 16px' }}>
        <Spin spinning={loading && !plan} size="small">
          {!hasAnyData && !loading ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {plan === null
                    ? '本章尚未展开大纲'
                    : '本章无扩展规划信息'}
                </span>
              }
              style={{ marginTop: 40 }}
            />
          ) : (
            <Collapse
              size="small"
              defaultActiveKey={['outline', 'characters', 'emotion', 'hook', 'scenes', 'rhythm']}
              ghost
              items={[
                // 1. 本章大纲
                plan?.narrative_goal || plan?.conflict_type || plan?.emotional_tone ? {
                  key: 'outline',
                  label: (
                    <Space size={4}>
                      <FileTextOutlined style={{ color: token.colorPrimary }} />
                      <Text strong style={{ fontSize: 12 }}>本章大纲</Text>
                    </Space>
                  ),
                  children: (
                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                      {plan?.narrative_goal && (
                        <div style={{ marginBottom: 6 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>叙事目标：</Text>
                          <div>{plan.narrative_goal}</div>
                        </div>
                      )}
                      {plan?.conflict_type && (
                        <div style={{ marginBottom: 6 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>冲突类型：</Text>
                          <Tag color="orange" style={{ fontSize: 11 }}>{plan.conflict_type}</Tag>
                        </div>
                      )}
                      {plan?.emotional_tone && (
                        <div style={{ marginBottom: 6 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>情感基调：</Text>
                          <Tag color="purple" style={{ fontSize: 11 }}>{plan.emotional_tone}</Tag>
                        </div>
                      )}
                      {plan?.key_events && plan.key_events.length > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>关键事件：</Text>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {plan.key_events.map((e, i) => (
                              <li key={i} style={{ fontSize: 11, marginBottom: 2, color: token.colorTextSecondary }}>
                                {e}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ),
                } : null,

                // 2. 出场角色
                plan?.character_focus && plan.character_focus.length > 0 ? {
                  key: 'characters',
                  label: (
                    <Space size={4}>
                      <TeamOutlined style={{ color: token.colorSuccess }} />
                      <Text strong style={{ fontSize: 12 }}>出场角色</Text>
                      <Tag style={{ fontSize: 10, marginInline: 0 }}>{plan.character_focus.length}</Tag>
                    </Space>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {plan.character_focus.map((c, i) => (
                        <Tag key={i} color="blue" style={{ fontSize: 11 }}>{c}</Tag>
                      ))}
                    </div>
                  ),
                } : null,

                // 3. 情绪曲线
                emotionPoints.length > 0 ? {
                  key: 'emotion',
                  label: (
                    <Space size={4}>
                      <BgColorsOutlined style={{ color: token.colorWarning }} />
                      <Text strong style={{ fontSize: 12 }}>情绪曲线</Text>
                    </Space>
                  ),
                  children: (
                    <div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 4,
                        marginBottom: 6,
                      }}>
                        {emotionPoints.map((p, i) => (
                          <div key={i} style={{
                            textAlign: 'center',
                            padding: '4px 2px',
                            background: alpha(token.colorWarningBg, 0.5),
                            borderRadius: 4,
                          }}>
                            <div style={{ fontSize: 10, color: token.colorTextSecondary }}>{p.label}</div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: token.colorText }}>{p.value}</div>
                          </div>
                        ))}
                      </div>
                      {plan?.emotion_curve?.transitions && plan.emotion_curve.transitions.length > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>情绪转折：</Text>
                          <ul style={{ margin: '2px 0 0 14px', padding: 0 }}>
                            {plan.emotion_curve.transitions.map((t, i) => (
                              <li key={i} style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 2 }}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ),
                } : null,

                // 4. 章末钩子
                plan?.ending_hook?.type ? {
                  key: 'hook',
                  label: (
                    <Space size={4}>
                      <FireOutlined style={{ color: token.colorError }} />
                      <Text strong style={{ fontSize: 12 }}>章末钩子</Text>
                    </Space>
                  ),
                  children: (
                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                      <div style={{ marginBottom: 6 }}>
                        <Tag color={HOOK_TYPE_COLORS[plan.ending_hook.type] || 'red'} style={{ fontSize: 11 }}>
                          {plan.ending_hook.type}
                        </Tag>
                        {plan.ending_hook.target_emotion && (
                          <Tag style={{ fontSize: 11, marginInline: 0 }}>
                            目标情绪：{plan.ending_hook.target_emotion}
                          </Tag>
                        )}
                      </div>
                      {plan.ending_hook.description && (
                        <div style={{
                          padding: '6px 8px',
                          background: alpha(token.colorErrorBg, 0.4),
                          borderRadius: 4,
                          border: `1px solid ${alpha(token.colorErrorBorder, 0.5)}`,
                          fontSize: 11,
                          color: token.colorText,
                        }}>
                          {plan.ending_hook.description}
                        </div>
                      )}
                      <div style={{ marginTop: 6, fontSize: 10, color: token.colorTextSecondary }}>
                        <ThunderboltOutlined /> 最后 200-400 字必须围绕此钩子展开
                      </div>
                    </div>
                  ),
                } : null,

                // 5. 场景节拍
                plan?.scene_beats && plan.scene_beats.length > 0 ? {
                  key: 'scenes',
                  label: (
                    <Space size={4}>
                      <EyeOutlined style={{ color: token.colorInfo }} />
                      <Text strong style={{ fontSize: 12 }}>场景节拍</Text>
                      <Tag style={{ fontSize: 10, marginInline: 0 }}>{plan.scene_beats.length} 场景</Tag>
                    </Space>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {plan.scene_beats.map((beat, i) => (
                        <div key={i} style={{
                          padding: '6px 8px',
                          background: alpha(token.colorInfoBg, 0.4),
                          borderRadius: 4,
                          border: `1px solid ${alpha(token.colorInfoBorder, 0.4)}`,
                          fontSize: 11,
                          lineHeight: 1.6,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <Text strong style={{ fontSize: 11 }}>场景 {beat.scene_order ?? i + 1}</Text>
                            {beat.estimated_words != null && (
                              <Text type="secondary" style={{ fontSize: 10 }}>约{beat.estimated_words}字</Text>
                            )}
                          </div>
                          {beat.location && (
                            <div><Text type="secondary" style={{ fontSize: 10 }}>地点：</Text>{beat.location}</div>
                          )}
                          {beat.scene_goal && (
                            <div><Text type="secondary" style={{ fontSize: 10 }}>目标：</Text>{beat.scene_goal}</div>
                          )}
                          {beat.conflict && (
                            <div><Text type="secondary" style={{ fontSize: 10 }}>冲突：</Text>{beat.conflict}</div>
                          )}
                          {beat.turning_point && (
                            <div><Text type="secondary" style={{ fontSize: 10 }}>转折：</Text>{beat.turning_point}</div>
                          )}
                          {beat.entry_hook && (
                            <div><Text type="secondary" style={{ fontSize: 10 }}>进入：</Text>{beat.entry_hook}</div>
                          )}
                          {beat.exit_hook && (
                            <div><Text type="secondary" style={{ fontSize: 10 }}>退出：</Text>{beat.exit_hook}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ),
                } : null,

                // 6. 信息节奏
                plan?.information_rhythm && (
                  plan.information_rhythm.reveal_points?.length ||
                  plan.information_rhythm.withhold_points?.length ||
                  plan.information_rhythm.information_gap
                ) ? {
                  key: 'rhythm',
                  label: (
                    <Space size={4}>
                      <FieldTimeOutlined style={{ color: token.colorPurple }} />
                      <Text strong style={{ fontSize: 12 }}>信息节奏</Text>
                    </Space>
                  ),
                  children: (
                    <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                      {plan.information_rhythm.reveal_points?.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>释放点：</Text>
                          {plan.information_rhythm.reveal_points.map((rp, i) => (
                            <div key={i} style={{ marginTop: 2, paddingLeft: 8 }}>
                              <Tag color="green" style={{ fontSize: 10 }}>{rp.timing || '未指定'}</Tag>
                              <span>{rp.info}</span>
                              {rp.method && (
                                <Text type="secondary" style={{ fontSize: 10 }}>（{rp.method}）</Text>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {plan.information_rhythm.withhold_points?.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>保留点：</Text>
                          {plan.information_rhythm.withhold_points.map((wp, i) => (
                            <div key={i} style={{ marginTop: 2, paddingLeft: 8 }}>
                              <Tag color="red" style={{ fontSize: 10 }}>保留</Tag>
                              <span>{wp.info}</span>
                              {wp.reason && (
                                <Text type="secondary" style={{ fontSize: 10 }}>（{wp.reason}）</Text>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {plan.information_rhythm.information_gap && (
                        <div style={{
                          padding: '6px 8px',
                          background: alpha(token.colorPurpleBg, 0.4),
                          borderRadius: 4,
                          border: `1px solid ${alpha(token.colorPurpleBorder || token.colorBorder, 0.4)}`,
                        }}>
                          <Text type="secondary" style={{ fontSize: 10 }}>信息差：</Text>
                          <span>{plan.information_rhythm.information_gap}</span>
                        </div>
                      )}
                    </div>
                  ),
                } : null,
              ].filter(Boolean) as Array<{ key: string; label: ReactNode; children: ReactNode }>}
            />
          )}
        </Spin>
      </div>
    </div>
  );
}

// 内部辅助组件（避免 import 整个 Space）
function Space({ size = 4, children }: { size?: number; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: size }}>{children}</span>;
}
