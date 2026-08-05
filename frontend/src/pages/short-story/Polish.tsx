import { useEffect, useState, useRef, useMemo } from 'react';
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
} from 'antd';
import { SaveOutlined, CheckCircleOutlined, TrophyOutlined, ReloadOutlined, AuditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { eventBus } from '../../store/eventBus';
import { shortStoryApi } from '../../services/api';
import { getTaskStatus, getProjectTasks, deleteTask } from '../../services/backgroundTaskService';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import useIsMobile from '../../utils/useIsMobile';
import RevisionPreviewModal from '../../components/RevisionPreviewModal';
import {
  CHECKLIST_CATEGORIES,
  SCORE_LEVEL_COLOR,
  STORY_DIMENSIONS,
} from '../../constants/shortStory';
import type { ShortStory, PolishChecklistItem, StoryScoreResult, StoryScoreDimension, RevisionPreview } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface ContextType {
  story: ShortStory;
  reload: () => Promise<void>;
}

export default function Polish() {
  const { story, reload } = useOutletContext<ContextType>();
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const { updateCurrentStory } = useShortStoryStore();
  const [checklist, setChecklist] = useState<PolishChecklistItem[]>([]);
  // Task 39.4: 自定义检查项草稿（按类别分组）
  const [newItemDraft, setNewItemDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState(story.polish_notes || '');
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 标记用户是否已编辑对应字段，防止后台刷新覆盖编辑态
  const notesDirtyRef = useRef(false);
  const checklistDirtyRef = useRef(false);
  const [polishing, setPolishing] = useState(false);
  const [polishHint, setPolishHint] = useState('');

  // AI评分相关
  const [scoreResult, setScoreResult] = useState<StoryScoreResult | null>(null);
  // 后台评分任务运行中（用于 AI 操作互斥）
  const [scoring, setScoring] = useState(false);
  // 基于评分改进相关（改进为后台任务，running 期间保持 true 直到任务完成/失败）
  const [improving, setImproving] = useState(false);
  // AI自动检查相关
  const [autoChecking, setAutoChecking] = useState(false);
  // AI修改预览
  const [revisionPreview, setRevisionPreview] = useState<RevisionPreview | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  // 自动评分（改进确认后自动触发）
  const [autoScoring, setAutoScoring] = useState(false);

  // Effect A：仅依赖 story.id 初始化 notes 和 checklist
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
    // 切换故事时重置 dirty 标记
    notesDirtyRef.current = false;
    checklistDirtyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  // Effect B：仅依赖 story.score_data 更新 scoreResult，不覆盖 notes/checklist
  useEffect(() => {
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
  }, [story.score_data]);

  // 组件卸载时清理自动评分 loading 消息，避免离开页面后残留
  useEffect(() => {
    return () => message.destroy('autoScore');
  }, []);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const updated = await shortStoryApi.update(story.id, {
        polish_checklist: JSON.stringify(checklist),
        polish_notes: notes,
      });
      updateCurrentStory(updated);
      // 保存成功后重置 dirty 标记
      notesDirtyRef.current = false;
      checklistDirtyRef.current = false;
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
    checklistDirtyRef.current = true;
    scheduleAutoSave();
  };

  // Task 39.4: 添加自定义检查项
  const addCustomItem = (category: string) => {
    const text = (newItemDraft[category] || '').trim();
    if (!text) { message.warning('请输入检查项内容'); return; }
    const newItem: PolishChecklistItem = {
      id: 'custom_' + Date.now() + Math.random().toString(36).slice(2, 8),
      category,
      item: text,
      checked: false,
      fix: '',
    };
    setChecklist([...checklist, newItem]);
    setNewItemDraft({ ...newItemDraft, [category]: '' });
    checklistDirtyRef.current = true;
    scheduleAutoSave();
  };

  // Task 39.4: 删除检查项
  const removeChecklistItem = (id: string) => {
    setChecklist(checklist.filter((item) => item.id !== id));
    checklistDirtyRef.current = true;
    scheduleAutoSave();
  };

  // 后台评分：创建后台任务后立即返回，关闭浏览器不影响评分
  // 任务进度通过 FloatingTaskPanel 查看，完成后自动保存
  const handleScoreBackground = async () => {
    if (!story.content || story.content.trim().length < 100) {
      message.warning('正文内容过短，无法评分（至少需要100字）');
      return;
    }
    try {
      setScoring(true);
      await shortStoryApi.scoreBackground(story.id);
      message.success(`已创建后台评分任务，可关闭页面，完成后右下角浮窗会提示`);
      // 通知 FloatingTaskPanel 立即刷新
      eventBus.emit('background-task-created');
    } catch (error) {
      setScoring(false);
      showErrorToast(error, '创建后台评分任务失败');
    }
  };

  // 基于评分改进：改为后台任务（关闭页面不影响），完成后自动弹出对比预览
  // improving 标志在任务完成/失败时由 task:completed 监听器清除，此处不在 finally 清除
  const handleImprove = async () => {
    if (!scoreResult) {
      message.warning('请先进行AI评分，才能基于评分改进点修订正文');
      return;
    }
    try {
      setImproving(true);
      await shortStoryApi.improveFromScoreBackground(story.id);
      message.success('已创建后台改进任务，可关闭页面，完成后会自动弹出对比预览');
      // 通知 FloatingTaskPanel 立即刷新
      eventBus.emit('background-task-created');
    } catch (error) {
      setImproving(false);
      showErrorToast(error, '创建后台改进任务失败');
    }
  };

  // 监听后台任务终态（completed/failed/cancelled）：清理 AI 操作互斥锁
  // 改进任务 completed 时读取 task_result 弹出对比预览供用户确认；failed 时提示错误
  // （任务在后台跑，切页面不丢失；回到本页且任务完成时自动弹预览）
  // 注意：监听 task:finished（覆盖失败/取消），避免任务失败时 scoring/improving 锁卡死、按钮永久禁用
  useEffect(() => {
    if (!story.id) return;
    const handleTaskFinished = async (data: unknown) => {
      const payload = data as { taskId?: string; taskType?: string; projectId?: string; status?: string };
      if (payload?.projectId !== story.id) return;
      // 评分任务终态：清除 scoring 锁，AI 操作互斥解除；completed 时刷新最新评分到页面
      if (payload.taskType === 'short_story_score') {
        setScoring(false);
        if (payload.status === 'completed') {
          try {
            const updated = await shortStoryApi.get(story.id);
            updateCurrentStory(updated); // Effect B 会根据 score_data 更新评分展示
            message.success('后台评分完成，评分结果已更新');
          } catch {
            // 刷新失败忽略，用户可手动刷新页面查看
          }
        }
      }
      // 改进任务终态：清除 improving 锁，completed 时弹出对比预览，failed 时提示
      if (payload.taskType === 'short_story_improve' && payload.taskId) {
        setImproving(false);
        try {
          const taskStatus = await getTaskStatus(payload.taskId);
          if (taskStatus.status === 'completed' && taskStatus.task_result) {
            setRevisionPreview(taskStatus.task_result as unknown as RevisionPreview);
            setPendingTaskId(payload.taskId);
            message.success('AI改进完成，请预览确认');
          } else if (taskStatus.status === 'failed') {
            message.error('AI改进失败：' + (taskStatus.error_message || '请稍后重试'));
          }
        } catch {
          // 查询任务结果失败，忽略（用户可手动重试）
        }
      }
    };
    eventBus.on('task:finished', handleTaskFinished);
    return () => {
      eventBus.off('task:finished', handleTaskFinished);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  // mount 时查询是否有已完成的 improve 任务待确认（处理从别的页面跳转来的情况）
  // 注意：列表接口 getProjectTasks 不返回 task_result，需用 getTaskStatus 取详情
  useEffect(() => {
    if (!story.id) return;
    let cancelled = false;
    (async () => {
      try {
        const tasks = await getProjectTasks(story.id);
        // 同步后台任务运行态：若有 running/pending 的评分/改进任务，标记 aiBusy
        const hasActiveScore = tasks.items.some(
          (t) => t.task_type === 'short_story_score' && (t.status === 'running' || t.status === 'pending')
        );
        const hasActiveImprove = tasks.items.some(
          (t) => t.task_type === 'short_story_improve' && (t.status === 'running' || t.status === 'pending')
        );
        if (!cancelled) {
          if (hasActiveScore) setScoring(true);
          if (hasActiveImprove) setImproving(true);
        }
        // 查找已完成的 improve 任务（不依赖列表的 task_result，改用详情接口取）
        const pendingImprove = tasks.items.find(
          (t) => t.task_type === 'short_story_improve' && t.status === 'completed'
        );
        if (!cancelled && pendingImprove) {
          const detail = await getTaskStatus(pendingImprove.id);
          if (!cancelled && detail.status === 'completed' && detail.task_result) {
            setRevisionPreview(detail.task_result as unknown as RevisionPreview);
            setPendingTaskId(pendingImprove.id);
          }
        }
      } catch {
        // 查询失败忽略
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

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
  const grouped = useMemo(() => {
    const result: Record<string, PolishChecklistItem[]> = {};
    checklist.forEach((item) => {
      if (!result[item.category]) result[item.category] = [];
      result[item.category].push(item);
    });
    return result;
  }, [checklist]);

  const checkedCount = checklist.filter((i) => i.checked).length;
  // AI 操作互斥：任一 AI 操作运行中时，禁用其他 AI 操作按钮，避免并发触发
  const aiBusy = polishing || scoring || improving || autoChecking || autoScoring;
  const totalCount = checklist.length;
  const allChecked = totalCount > 0 && checkedCount === totalCount;

  return (
    <div style={{ padding: isMobile ? 12 : 24, maxWidth: 900, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'center',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 8 : 0,
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>精修笔记</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
          <Button loading={polishing} disabled={aiBusy} onClick={handlePolish}>
            AI润色全文
          </Button>
          <Button
            type="primary"
            loading={scoring}
            disabled={aiBusy}
            onClick={handleScoreBackground}
          >
            <TrophyOutlined /> AI评分
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存
          </Button>
        </div>
      </div>

      {(polishing || scoring || improving) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              <Spin size="small" style={{ marginRight: 8 }} />
              {polishing ? polishHint : scoring ? 'AI后台评分中，完成后自动显示结果…' : 'AI后台改进中，完成后自动弹出对比预览…'}
            </span>
          }
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
        style={{ marginBottom: 16, borderColor: token.colorBorder }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrophyOutlined style={{ color: token.colorWarning }} />
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
        {autoScoring ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin tip={autoScoring ? '已确认改进，正在创建后台重新评分任务…' : 'AI正在按爆款方法论评分中…'} size="large" />
            <div style={{ marginTop: 16, color: token.colorTextSecondary, fontSize: 13 }}>
              评分维度：选题 / 结构 / 情绪 / 人设对话 / 完成度
            </div>
          </div>
        ) : scoreResult ? (
          <ScoreResultView
            result={scoreResult}
            onRescore={handleScoreBackground}
            onImprove={handleImprove}
            improving={improving}
            aiBusy={aiBusy}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_DEFAULT}
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
            <Button type="primary" ghost icon={<TrophyOutlined />} onClick={handleScoreBackground} disabled={aiBusy}>
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
                disabled={aiBusy}
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
            <div key={category} style={{ marginBottom: 16, padding: 12, background: token.colorFillQuaternary, borderRadius: 6 }}>
              <div style={{ marginBottom: 8 }}>
                <Tag color={CHECKLIST_CATEGORIES[category]?.color || 'default'} style={{ marginRight: 8 }}>
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
                    {/* Task 39.4: 删除检查项 */}
                    <Tooltip title="删除该检查项">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeChecklistItem(item.id)}
                      />
                    </Tooltip>
                  </div>
                </div>
              ))}
              {/* Task 39.4: 添加自定义检查项 */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Input
                  size="small"
                  placeholder="添加自定义检查项..."
                  value={newItemDraft[category] || ''}
                  onChange={(e) => setNewItemDraft({ ...newItemDraft, [category]: e.target.value })}
                  onPressEnter={() => addCustomItem(category)}
                />
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => addCustomItem(category)}
                >
                  添加
                </Button>
              </div>
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
            notesDirtyRef.current = true;
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

      <Collapse
        size="small"
        style={{ marginTop: 16 }}
        items={[{
          key: 'principles',
          label: <Text strong>精修核心原则（参考）</Text>,
          children: (
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
          ),
        }]}
      />

      {/* AI修改对比预览Modal */}
      <RevisionPreviewModal
        open={!!revisionPreview}
        storyId={story.id}
        preview={revisionPreview}
        onCancel={() => {
          setRevisionPreview(null);
          if (pendingTaskId) {
            deleteTask(pendingTaskId).catch(() => {});
            setPendingTaskId(null);
          }
        }}
        onConfirmed={async () => {
          const wasImprove = revisionPreview?.revision_type === 'improve';
          setRevisionPreview(null);
          if (pendingTaskId) {
            deleteTask(pendingTaskId).catch(() => {});
            setPendingTaskId(null);
          }
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
            // 改进类型：自动创建后台评分任务（只触发一次AI评分，不阻塞页面，关浏览器不影响）
            try {
              setAutoScoring(true);
              await shortStoryApi.scoreBackground(story.id);
              message.success({
                content: '已确认保存改进，已自动创建后台重新评分任务，完成后右下角浮窗会提示',
                key: 'autoScore',
                duration: 5,
              });
              // 通知 FloatingTaskPanel 立即刷新
              eventBus.emit('background-task-created');
            } catch (error) {
              message.destroy('autoScore');
              showErrorToast(error, '自动创建后台评分任务失败，可手动点击评分按钮重试');
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
  aiBusy,
}: {
  result: StoryScoreResult;
  onRescore: () => void;
  onImprove: () => void;
  improving: boolean;
  aiBusy: boolean;
}) {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const levelColorMap: Record<string, string> = {
    '优秀': token.colorSuccess,
    '良好': token.colorPrimary,
    '合格': token.colorWarning,
    '待改进': token.colorError,
  };
  const levelColor = levelColorMap[result.level] || token.colorText;

  return (
    <div>
      {/* 总分头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 24, marginBottom: 16, flexWrap: 'wrap' }}>
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
          <div style={{ fontSize: 14, color: token.colorTextSecondary }}>总分 / 100</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Tag color={SCORE_LEVEL_COLOR[result.level] || 'default'} style={{ fontSize: 16, padding: '4px 16px', marginBottom: 8 }}>
            {result.level}
          </Tag>
          <div style={{ color: token.colorTextSecondary, fontSize: 13, lineHeight: 1.6 }}>
            {result.overall_evaluation}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: isMobile ? 'stretch' : 'flex-end', width: isMobile ? '100%' : 'auto' }}>
          <Tooltip title="把评分给出的改进点（最严重问题/优先级建议/各维度问题与建议）喂给AI，让其针对性修订正文。改进后旧评分清空，需重新评分验证效果。">
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={improving}
              disabled={aiBusy}
              onClick={onImprove}
              size="small"
              block={isMobile}
            >
              基于评分改进正文
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={onRescore} size="small" disabled={aiBusy} block={isMobile}>
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
        <Card size="small" type="inner" title={<Text type="danger">⚠️ 最严重问题</Text>} style={{ marginBottom: 12, background: token.colorErrorBg }}>
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
        <Card size="small" type="inner" title={<Text type="success">🎯 按优先级排序的修改建议</Text>} style={{ marginBottom: 12, background: token.colorSuccessBg }}>
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
                <Tag color={STORY_DIMENSIONS[dim.key]?.color || 'default'} style={{ marginRight: 8 }}>
                  {dim.name}
                </Tag>
                <Text strong style={{ color: dim.score / dim.max_score >= 0.8 ? token.colorSuccess : dim.score / dim.max_score >= 0.6 ? token.colorWarning : token.colorError }}>
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
  const { token } = theme.useToken();
  const percent = Math.round((dim.score / dim.max_score) * 100);
  const color = STORY_DIMENSIONS[dim.key]?.color || 'blue';
  const status = percent >= 80 ? 'success' : percent >= 60 ? 'normal' : 'exception';

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 13 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: token.colorPrimary, marginRight: 8 }} />
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
        <div style={{ marginBottom: 8, padding: 8, background: token.colorFillAlter, borderRadius: 4, borderLeft: `3px solid ${token.colorBorderSecondary}` }}>
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
