import { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Card,
  Typography,
  Input,
  Button,
  message,
  Checkbox,
  Tag,
  Alert,
  Empty,
  Progress,
  theme,
  Spin,
  Collapse,
  Divider,
  Tooltip,
  Dropdown,
} from 'antd';
import type { MenuProps } from 'antd';
import { SaveOutlined, CheckCircleOutlined, TrophyOutlined, ReloadOutlined, AuditOutlined, DownOutlined } from '@ant-design/icons';
import { eventBus } from '../../store/eventBus';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import RevisionPreviewModal from '../../components/RevisionPreviewModal';
import type { ShortStory, PolishChecklistItem, StoryScoreResult, StoryScoreDimension, RevisionPreview } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

const CATEGORY_COLOR: Record<string, string> = {
  '开头查验': 'blue',
  '废话查验': 'orange',
  '卡点查验': 'gold',
  '去AI味查验': 'red',
  '情绪曲线': 'purple',
  '人设查验': 'magenta',
  '对话查验': 'cyan',
  '选题查验': 'green',
};

interface ContextType {
  story: ShortStory;
  reload: () => Promise<void>;
}

// 评分等级颜色映射
const LEVEL_COLOR: Record<string, string> = {
  '优秀': '#52c41a',
  '良好': '#1890ff',
  '合格': '#faad14',
  '待改进': '#ff4d4f',
};

// 维度颜色映射
const DIMENSION_COLOR: Record<string, string> = {
  concept: '#52c41a',
  structure: '#1890ff',
  emotion: '#722ed1',
  character: '#eb2f96',
  polish: '#fa8c16',
};

export default function Polish() {
  const { story, reload } = useOutletContext<ContextType>();
  const { token } = theme.useToken();
  const { updateCurrentStory } = useShortStoryStore();
  const [checklist, setChecklist] = useState<PolishChecklistItem[]>([]);
  const [notes, setNotes] = useState(story.polish_notes || '');
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishHint, setPolishHint] = useState('');

  // AI评分相关
  const [scoreResult, setScoreResult] = useState<StoryScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);
  // 基于评分改进相关
  const [improving, setImproving] = useState(false);
  const [improveHint, setImproveHint] = useState('');
  // AI自动检查相关
  const [autoChecking, setAutoChecking] = useState(false);
  // AI修改预览
  const [revisionPreview, setRevisionPreview] = useState<RevisionPreview | null>(null);
  // 自动评分（改进确认后自动触发）
  const [autoScoring, setAutoScoring] = useState(false);

  useEffect(() => {
    try {
      const parsed = story.polish_checklist ? JSON.parse(story.polish_checklist) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setChecklist(parsed);
      }
    } catch {
      setChecklist([]);
    }
    setNotes(story.polish_notes || '');

    // 加载已有评分
    try {
      if (story.score_data) {
        const parsed = JSON.parse(story.score_data);
        if (parsed && parsed.total_score !== undefined) {
          setScoreResult(parsed);
        }
      } else {
        setScoreResult(null);
      }
    } catch {
      setScoreResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id, story.score_data]);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const updated = await shortStoryApi.update(story.id, {
        polish_checklist: JSON.stringify(checklist),
        polish_notes: notes,
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

  const toggleItem = (id: string) => {
    const newList = checklist.map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    setChecklist(newList);
    scheduleAutoSave();
  };

  const handleScore = async () => {
    if (!story.content || story.content.trim().length < 100) {
      message.warning('正文内容过短，无法评分（至少需要100字）');
      return;
    }
    try {
      setScoring(true);
      const result = await shortStoryApi.score(story.id);
      setScoreResult(result);
      message.success(`AI评分完成：${result.total_score}分（${result.level}）`);
      // 重新拉取story以同步scored_at
      try {
        const updated = await shortStoryApi.get(story.id);
        updateCurrentStory(updated);
      } catch {
        // 同步失败不影响主流程
      }
    } catch (error) {
      showErrorToast(error, 'AI评分失败');
    } finally {
      setScoring(false);
    }
  };

  // 后台评分：创建后台任务后立即返回，关闭浏览器不影响评分
  // 任务进度通过 FloatingTaskPanel 查看，完成后自动保存
  const handleScoreBackground = async () => {
    if (!story.content || story.content.trim().length < 100) {
      message.warning('正文内容过短，无法评分（至少需要100字）');
      return;
    }
    try {
      await shortStoryApi.scoreBackground(story.id);
      message.success(`已创建后台评分任务，可关闭页面，完成后右下角浮窗会提示`);
      // 通知 FloatingTaskPanel 立即刷新
      eventBus.emit('background-task-created');
    } catch (error) {
      showErrorToast(error, '创建后台评分任务失败');
    }
  };

  // 评分按钮 Dropdown 菜单：前台评分（后台评分为主按钮默认行为，下拉仅保留前台作为可选）
  const scoreMenuItems: MenuProps['items'] = [
    {
      key: 'foreground',
      label: '前台评分（阻塞等待结果，不推荐切换页面）',
      onClick: () => handleScore(),
    },
  ];

  const handleImprove = async () => {
    if (!scoreResult) {
      message.warning('请先进行AI评分，才能基于评分改进点修订正文');
      return;
    }
    try {
      setImproving(true);
      setImproveHint('AI正在基于评分改进正文...');
      const preview = await shortStoryApi.improveFromScoreStream(story.id, {
        onProgress: (msg) => setImproveHint(msg || 'AI正在改进正文...'),
        onChunk: () => setImproveHint('AI正在生成改进内容...'),
      });
      if (preview) setRevisionPreview(preview);
    } catch (error) {
      showErrorToast(error, 'AI改进失败');
    } finally {
      setImproving(false);
      setImproveHint('');
    }
  };

  const handlePolish = async () => {
    try {
      setPolishing(true);
      setPolishHint('AI正在精修润色正文...');
      const preview = await shortStoryApi.polishStream(story.id, {
        onProgress: (msg) => setPolishHint(msg || 'AI正在精修润色...'),
        onChunk: () => setPolishHint('AI正在生成润色内容...'),
      });
      if (preview) setRevisionPreview(preview);
    } catch (error) {
      showErrorToast(error, 'AI润色失败');
    } finally {
      setPolishing(false);
      setPolishHint('');
    }
  };

  const handleAutoCheck = async () => {
    if (!story.content || story.content.trim().length < 100) {
      message.warning('正文内容过短，无法检查（至少需要100字）');
      return;
    }
    try {
      setAutoChecking(true);
      const result = await shortStoryApi.autoCheck(story.id);
      setChecklist(result.checklist);
      const passedCount = result.checklist.filter((i) => i.checked).length;
      message.success(`AI自查完成：${passedCount}/${result.checklist.length} 项通过`);
      // 同步story
      try {
        const updated = await shortStoryApi.get(story.id);
        updateCurrentStory(updated);
      } catch {
        // 同步失败不影响主流程
      }
    } catch (error) {
      showErrorToast(error, 'AI自查失败');
    } finally {
      setAutoChecking(false);
    }
  };

  // 按类别分组
  const grouped: Record<string, PolishChecklistItem[]> = {};
  checklist.forEach((item) => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  const checkedCount = checklist.filter((i) => i.checked).length;
  const totalCount = checklist.length;
  const allChecked = totalCount > 0 && checkedCount === totalCount;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>精修笔记</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button loading={polishing} onClick={handlePolish}>
            AI润色正文
          </Button>
          <Dropdown.Button
            type="primary"
            loading={scoring || improving || autoScoring}
            disabled={improving || autoScoring}
            onClick={handleScoreBackground}
            menu={{ items: scoreMenuItems }}
            placement="bottomRight"
            icon={<DownOutlined />}
          >
            <TrophyOutlined /> AI评分
          </Dropdown.Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存
          </Button>
        </div>
      </div>

      {(polishing || improving) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={<span><Spin size="small" style={{ marginRight: 8 }} />{polishing ? polishHint : improveHint}</span>}
        />
      )}

      <Alert
        type={allChecked ? 'success' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          allChecked ? (
            <span>
              <CheckCircleOutlined style={{ marginRight: 8 }} />
              全部自查项已通过！可以发布了
            </span>
          ) : (
            <span>
              完稿自查清单：已通过 {checkedCount}/{totalCount} 项
              {totalCount > 0 && (
                <Progress percent={Math.round((checkedCount / totalCount) * 100)} size="small" style={{ marginTop: 4 }} />
              )}
            </span>
          )
        }
        description={
          <Text style={{ fontSize: 13 }}>
            只要有一条不符合就立刻修改。短故事的成败在于细节打磨，每个自查项都直接影响读者留存率。
          </Text>
        }
      />

      {/* AI评分结果区 */}
      <Card
        size="small"
        style={{ marginBottom: 16, borderColor: scoreResult ? LEVEL_COLOR[scoreResult.level] || token.colorBorder : token.colorBorder }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrophyOutlined style={{ color: '#fa8c16' }} />
            <span>AI评分（爆款方法论5维度）</span>
          </div>
        }
        extra={
          scoreResult && story.scored_at ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              评分时间：{new Date(story.scored_at).toLocaleString('zh-CN')}
            </Text>
          ) : null
        }
      >
        {scoring || autoScoring ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin tip={autoScoring ? '已确认改进，正在自动重新评分…' : 'AI正在按爆款方法论评分中…'} size="large" />
            <div style={{ marginTop: 16, color: token.colorTextSecondary, fontSize: 13 }}>
              评分维度：选题 / 结构 / 情绪 / 人设对话 / 完成度
            </div>
          </div>
        ) : scoreResult ? (
          <ScoreResultView
            result={scoreResult}
            onRescore={handleScore}
            onImprove={handleImprove}
            improving={improving}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                暂未评分
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  点击右上角「AI评分」按钮，依据爆款方法论对正文进行5维度评分
                </Text>
              </span>
            }
          >
            <Button type="primary" ghost icon={<TrophyOutlined />} onClick={handleScore} loading={scoring}>
              开始AI评分
            </Button>
          </Empty>
        )}
      </Card>

      <Card
        size="small"
        title="完稿自查清单"
        style={{ marginBottom: 16 }}
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title="AI逐项检查自查清单，自动判断每项是否通过并给出依据">
              <Button
                size="small"
                type="primary"
                ghost
                icon={<AuditOutlined />}
                loading={autoChecking}
                onClick={handleAutoCheck}
              >
                AI自动检查
              </Button>
            </Tooltip>
            <Tag color={allChecked ? 'success' : 'warning'}>
              {checkedCount}/{totalCount}
            </Tag>
          </div>
        }
      >
        {totalCount === 0 ? (
          <Empty description="暂无自查清单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <Tag color={CATEGORY_COLOR[category] || 'default'} style={{ marginRight: 8 }}>
                  {category}
                </Tag>
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    marginBottom: 8,
                    padding: 12,
                    background: item.checked ? token.colorSuccessBg : token.colorBgTextHover,
                    borderRadius: 6,
                    border: `1px solid ${item.checked ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Checkbox
                      checked={item.checked}
                      onChange={() => toggleItem(item.id)}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1 }}>
                      <Text
                        strong={!item.checked}
                        delete={item.checked}
                        style={{
                          color: item.checked ? token.colorTextSecondary : token.colorText,
                        }}
                      >
                        {item.item}
                      </Text>
                      {/* AI检查依据 */}
                      {item.evidence && (
                        <div style={{ marginTop: 4, padding: '4px 8px', background: token.colorFillAlter, borderRadius: 4, borderLeft: `3px solid ${item.checked ? token.colorSuccess : token.colorError}` }}>
                          <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
                            AI依据：{item.evidence}
                          </Text>
                        </div>
                      )}
                      {!item.checked && (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            修改建议：{item.fix}
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>

      <Card
        size="small"
        title="修改记录"
        style={{ marginBottom: 16 }}
      >
        <TextArea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            scheduleAutoSave();
          }}
          rows={6}
          placeholder="记录每次精修的修改要点：
1. 哪一段改了什么？
2. 为什么要改？
3. 改完效果如何？

例：
v1：开头太散，删掉300字背景介绍，直接从冲突现场切入
v2：第3段对话太书面，改成口语化
v3：结尾增加一句留白，强化余味"
          style={{ fontFamily: 'inherit' }}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="精修核心原则"
        description={
          <div style={{ fontSize: 13 }}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>开头查验：前300字必须出现核心矛盾</li>
              <li>废话查验：超过3行的环境/心理描写必须删掉</li>
              <li>卡点查验：每段结尾必须勾住读者继续看</li>
              <li>去AI味查验：台词必须像真人说的话</li>
              <li>情绪曲线：每1000-1500字必须有一次小冲突</li>
              <li>人设查验：角色标签化，一眼认清阵营</li>
              <li>对话查验：每句台词必须具备暴露阴谋或推进爽点的功能</li>
            </ul>
          </div>
        }
      />

      {/* AI修改对比预览Modal */}
      <RevisionPreviewModal
        open={!!revisionPreview}
        storyId={story.id}
        preview={revisionPreview}
        onCancel={() => setRevisionPreview(null)}
        onConfirmed={async () => {
          const wasImprove = revisionPreview?.revision_type === 'improve';
          setRevisionPreview(null);
          // 改进类型：清空旧评分展示
          if (wasImprove) {
            setScoreResult(null);
          }
          await reload();
          // 同步notes显示修改记录
          try {
            const updated = await shortStoryApi.get(story.id);
            updateCurrentStory(updated);
            if (updated.polish_notes) setNotes(updated.polish_notes);
          } catch {
            // 同步失败不影响主流程
          }

          if (wasImprove) {
            // 改进类型：自动触发重新评分
            message.loading({ content: '已确认保存改进，正在自动重新评分...', key: 'autoScore', duration: 0 });
            try {
              setAutoScoring(true);
              const scoreResult = await shortStoryApi.score(story.id);
              setScoreResult(scoreResult);
              message.success({
                content: `自动评分完成：${scoreResult.total_score}分（${scoreResult.level}）`,
                key: 'autoScore',
                duration: 5,
              });
              // 同步story状态
              try {
                const updated = await shortStoryApi.get(story.id);
                updateCurrentStory(updated);
              } catch {
                // 同步失败不影响主流程
              }
            } catch (error) {
              message.destroy('autoScore');
              showErrorToast(error, '自动评分失败，可手动点击评分按钮重试');
            } finally {
              setAutoScoring(false);
            }
          } else {
            message.success('已确认保存AI润色', 4);
          }
        }}
      />
    </div>
  );
}

// ============ AI评分结果展示组件 ============

function ScoreResultView({
  result,
  onRescore,
  onImprove,
  improving,
}: {
  result: StoryScoreResult;
  onRescore: () => void;
  onImprove: () => void;
  improving: boolean;
}) {
  const { token } = theme.useToken();
  const levelColor = LEVEL_COLOR[result.level] || token.colorText;

  return (
    <div>
      {/* 总分头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center', minWidth: 120 }}>
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: levelColor,
              lineHeight: 1,
            }}
          >
            {result.total_score}
          </div>
          <div style={{ fontSize: 13, color: token.colorTextSecondary }}>总分 / 100</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Tag color={levelColor} style={{ fontSize: 16, padding: '4px 16px', marginBottom: 8 }}>
            {result.level}
          </Tag>
          <div style={{ color: token.colorTextSecondary, fontSize: 13, lineHeight: 1.6 }}>
            {result.overall_evaluation}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <Tooltip title="把评分给出的改进点（最严重问题/优先级建议/各维度问题与建议）喂给AI，让其针对性修订正文。改进后旧评分清空，需重新评分验证效果。">
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={improving}
              onClick={onImprove}
              size="small"
            >
              基于评分改进正文
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={onRescore} size="small" disabled={improving}>
            重新评分
          </Button>
        </div>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* 5维度评分进度条 */}
      <div style={{ marginBottom: 16 }}>
        {result.dimensions.map((dim) => (
          <DimensionRow key={dim.key} dim={dim} />
        ))}
      </div>

      {/* Top问题 */}
      {result.top_issues && result.top_issues.length > 0 && (
        <Card size="small" type="inner" title={<Text type="danger">⚠️ 最严重问题</Text>} style={{ marginBottom: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {result.top_issues.map((issue, idx) => (
              <li key={idx} style={{ marginBottom: 4, fontSize: 13, color: token.colorText }}>
                {issue}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 优先改进建议 */}
      {result.improvement_priority && result.improvement_priority.length > 0 && (
        <Card size="small" type="inner" title={<Text type="success">🎯 按优先级排序的修改建议</Text>} style={{ marginBottom: 12 }}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {result.improvement_priority.map((s, idx) => (
              <li key={idx} style={{ marginBottom: 6, fontSize: 13, color: token.colorText }}>
                {s}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* 各维度详情（折叠） */}
      <Collapse
        size="small"
        items={result.dimensions.map((dim) => ({
          key: dim.key,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
              <span>
                <Tag color={DIMENSION_COLOR[dim.key] || 'default'} style={{ marginRight: 8 }}>
                  {dim.name}
                </Tag>
                <Text strong style={{ color: dim.score / dim.max_score >= 0.8 ? '#52c41a' : dim.score / dim.max_score >= 0.6 ? '#faad14' : '#ff4d4f' }}>
                  {dim.score}/{dim.max_score}
                </Text>
              </span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                得分率 {Math.round((dim.score / dim.max_score) * 100)}%
              </Text>
            </div>
          ),
          children: <DimensionDetail dim={dim} />,
        }))}
      />
    </div>
  );
}

function DimensionRow({ dim }: { dim: StoryScoreDimension }) {
  const percent = Math.round((dim.score / dim.max_score) * 100);
  const color = DIMENSION_COLOR[dim.key] || '#1890ff';
  const status = percent >= 80 ? 'success' : percent >= 60 ? 'normal' : 'exception';

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 13 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }} />
          {dim.name}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: 600 }}>
          {dim.score}/{dim.max_score}
        </Text>
      </div>
      <Progress percent={percent} size="small" status={status} strokeColor={color} />
    </div>
  );
}

function DimensionDetail({ dim }: { dim: StoryScoreDimension }) {
  const { token } = theme.useToken();
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ marginBottom: 8 }}>
        <Text strong>评价：</Text>
        <Text>{dim.evaluation}</Text>
      </div>

      {dim.evidence && (
        <div style={{ marginBottom: 8, padding: 8, background: token.colorFillAlter, borderRadius: 4, borderLeft: `3px solid ${DIMENSION_COLOR[dim.key] || '#1890ff'}` }}>
          <Text strong>正文证据：</Text>
          <Text type="secondary" style={{ fontStyle: 'italic' }}>
            "{dim.evidence}"
          </Text>
        </div>
      )}

      {dim.issues && dim.issues.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="danger" strong>问题：</Text>
          <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
            {dim.issues.map((issue, idx) => (
              <li key={idx} style={{ marginBottom: 2 }}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {dim.suggestions && dim.suggestions.length > 0 && (
        <div>
          <Text type="success" strong>改进建议：</Text>
          <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
            {dim.suggestions.map((s, idx) => (
              <li key={idx} style={{ marginBottom: 2 }}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
