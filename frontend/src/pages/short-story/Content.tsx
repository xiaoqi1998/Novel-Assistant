import { useEffect, useState, useRef, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Card,
  Collapse,
  Typography,
  Input,
  InputNumber,
  Button,
  message,
  Tag,
  Progress,
  Alert,
  Tooltip,
  theme,
  Grid,
  Modal,
  Drawer,
  Empty,
  Spin,
} from 'antd';
import { SaveOutlined, CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, RobotOutlined, CloseOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import { formatWordCount } from '../../utils/format';
import RevisionPreviewModal from '../../components/RevisionPreviewModal';
import { SSELoadingOverlay } from '../../components/SSELoadingOverlay';
import { SSEPostClient } from '../../utils/sseClient';
import { eventBus } from '../../store/eventBus';
import { getProjectTasks, deleteTask } from '../../services/backgroundTaskService';
import {
  loadStoryContentDraft,
  saveStoryContentDraft,
  clearStoryContentDraft,
} from '../../utils/shortStoryDraft';
import { STORY_STAGE_CONFIG } from '../../constants/shortStory';
import type { ShortStory, StorySegment, RevisionPreview } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

const STATUS_CONFIG: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  pending: { color: 'default', text: '待写', icon: <ClockCircleOutlined /> },
  writing: { color: 'processing', text: '创作中', icon: <ClockCircleOutlined /> },
  completed: { color: 'success', text: '已完成', icon: <CheckCircleOutlined /> },
};

interface ContextType {
  story: ShortStory;
  reload: () => Promise<void>;
}

function countWords(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const stripped = text.replace(/[\u4e00-\u9fa5]/g, ' ');
  const englishWords = (stripped.match(/[A-Za-z0-9]+/g) || []).length;
  return chineseChars + englishWords;
}

export default function Content() {
  const { story, reload } = useOutletContext<ContextType>();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();
  const { updateCurrentStory } = useShortStoryStore();
  const [content, setContent] = useState(story.content || '');
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lastDraftSaveTime, setLastDraftSaveTime] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<string>(content);
  const sseClientRef = useRef<SSEPostClient | null>(null);
  const prevStoryIdRef = useRef<string>(story.id);
  const [generatingSegment, setGeneratingSegment] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revisionPreview, setRevisionPreview] = useState<RevisionPreview | null>(null);
  // 后台任务预览关联的 task_id，确认或取消后用于删除任务记录避免重复弹窗
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  // SSE流式进度状态
  const [sseVisible, setSseVisible] = useState(false);
  const [sseProgress, setSseProgress] = useState(0);
  const [sseMessage, setSseMessage] = useState('');
  const [sseTitle, setSseTitle] = useState('AI生成中...');
  // 分段生成时的实时内容预览
  const [segmentPreview, setSegmentPreview] = useState('');

  // Task 39.1: 版本历史
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [revisionHistory, setRevisionHistory] = useState<Array<{ content: string; saved_at: string; revision_type: string }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Task 39.2: 目标字数动态调整
  const [targetWordsInput, setTargetWordsInput] = useState(story.target_words || 12000);
  const targetWordsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // 后台重写任务完成处理：读取 task_result 弹出对比预览供用户确认
  // （regenerate-background 完成后预览存于 task_result，需主动读取；不直接写库）
  const handleRegenerateTaskCompleted = async (taskId: string) => {
    try {
      const { getTaskStatus } = await import('../../services/backgroundTaskService');
      const taskStatus = await getTaskStatus(taskId);
      if (taskStatus.status === 'completed' && taskStatus.task_result) {
        const tr = taskStatus.task_result as Record<string, unknown>;
        // regenerate task_result 用 content 字段，映射到 new_content 供 diff 展示
        setRevisionPreview({
          ...(tr as unknown as RevisionPreview),
          new_content: (tr.new_content as string) || (tr.content as string) || '',
        });
        setPendingTaskId(taskId);
      }
    } catch {
      // 查询失败忽略
    }
  };

  // mount 时查询是否有已完成的 regenerate 任务待确认（处理从别的页面跳转来的情况）
  useEffect(() => {
    if (!story.id) return;
    let cancelled = false;
    (async () => {
      try {
        const tasks = await getProjectTasks(story.id);
        const pendingRegen = tasks.items.find(
          (t) =>
            t.task_type === 'short_story_regenerate' &&
            t.status === 'completed' &&
            t.task_result
        );
        if (!cancelled && pendingRegen) {
          const tr = pendingRegen.task_result as Record<string, unknown>;
          setRevisionPreview({
            ...(tr as unknown as RevisionPreview),
            new_content: (tr.new_content as string) || (tr.content as string) || '',
          });
          setPendingTaskId(pendingRegen.id);
        }
      } catch {
        // 查询失败忽略
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [story.id]);

  // 监听后台任务完成事件：regenerate 完成后弹预览
  useEffect(() => {
    if (!story.id) return;
    const handleTaskCompleted = (data: unknown) => {
      const payload = data as { taskId?: string; taskType?: string; projectId?: string };
      if (
        payload?.taskType === 'short_story_regenerate' &&
        payload.projectId === story.id &&
        payload.taskId
      ) {
        handleRegenerateTaskCompleted(payload.taskId);
      }
    };
    eventBus.on('task:completed', handleTaskCompleted);
    return () => {
      eventBus.off('task:completed', handleTaskCompleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  // 加载时检测未保存的本地草稿（与服务器版本不同时提示恢复）
  useEffect(() => {
    try {
      const parsed = story.segments ? JSON.parse(story.segments) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setSegments(parsed);
      }
    } catch {
      setSegments([]);
    }
    const serverContent = story.content || '';
    setContent(serverContent);

    // 检测本地草稿
    const draft = loadStoryContentDraft(story.id);
    if (draft && draft.content !== serverContent) {
      const draftTime = new Date(draft.savedAt).toLocaleString('zh-CN');
      Modal.confirm({
        title: '检测到未保存的正文草稿',
        content: `是否恢复本地草稿？草稿保存时间：${draftTime}`,
        okText: '恢复草稿',
        cancelText: '使用服务器版本',
        centered: true,
        onOk: () => {
          setContent(draft.content);
          setLastDraftSaveTime(draft.savedAt);
          message.info('已恢复本地草稿');
        },
        onCancel: () => {
          clearStoryContentDraft(story.id);
          message.info('已丢弃草稿，使用服务器版本');
        },
      });
    } else if (draft) {
      // 草稿与服务器内容一致，清理无用草稿
      clearStoryContentDraft(story.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  // 监听 story.content 变化：当 story.id 不变但 content 变化时（如重写/精修完成后 reload 触发），
  // 同步 content state。[story.id] effect 负责初次加载和切故事时的初始化（含草稿检测）。
  useEffect(() => {
    if (prevStoryIdRef.current === story.id && contentRef.current !== (story.content || '')) {
      setContent(story.content || '');
      contentRef.current = story.content || '';
    }
    prevStoryIdRef.current = story.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.content, story.id]);

  const currentWords = useMemo(() => countWords(content), [content]);
  const targetWords = story.target_words || 12000;
  const progress = Math.min(Math.round((currentWords / targetWords) * 100), 100);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const updated = await shortStoryApi.update(story.id, {
        content: contentRef.current,
      });
      updateCurrentStory(updated);
      setLastSaved(new Date());
      // 服务器保存成功后清除本地草稿
      clearStoryContentDraft(story.id);
      setLastDraftSaveTime(null);
      if (showMessage) message.success('已保存');
    } catch (error) {
      showErrorToast(error, '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const scheduleAutoSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(false), 2000);
  };

  // 草稿防抖保存（与API保存并行，网络失败时仍有本地备份）
  const scheduleDraftSave = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveStoryContentDraft(story.id, contentRef.current);
      setLastDraftSaveTime(Date.now());
    }, 1000);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    scheduleAutoSave();
    scheduleDraftSave();
  };

  // Task 39.2: 同步目标字数（切故事或后端更新后）
  useEffect(() => {
    setTargetWordsInput(story.target_words || 12000);
  }, [story.target_words, story.id]);

  // Task 39.2: 修改目标字数（防抖调用 update API，后端 Task 2 会重算 segments）
  const handleTargetWordsChange = (v: number | null) => {
    if (v == null) return;
    setTargetWordsInput(v);
    if (targetWordsTimerRef.current) clearTimeout(targetWordsTimerRef.current);
    targetWordsTimerRef.current = setTimeout(async () => {
      try {
        const updated = await shortStoryApi.update(story.id, { target_words: v });
        updateCurrentStory(updated);
        // 同步后端重算的 segments
        if (updated.segments) {
          try {
            const parsed = JSON.parse(updated.segments);
            if (Array.isArray(parsed)) setSegments(parsed);
          } catch {
            // segments 解析失败忽略
          }
        }
        message.success('目标字数已更新，分段已重算');
      } catch (error) {
        showErrorToast(error, '更新目标字数失败');
      }
    }, 800);
  };

  // Task 39.1: 打开版本历史 Drawer
  const handleOpenHistory = async () => {
    setHistoryDrawerOpen(true);
    setLoadingHistory(true);
    try {
      const history = await shortStoryApi.getRevisionHistory(story.id);
      setRevisionHistory(Array.isArray(history) ? history : []);
    } catch (error: any) {
      if (error?.response?.status === 404) {
        // 后端端点不可用时，从 story.revision_history 字段解析（兼容降级）
        try {
          const parsed = story.revision_history ? JSON.parse(story.revision_history) : [];
          setRevisionHistory(Array.isArray(parsed) ? parsed : []);
        } catch {
          setRevisionHistory([]);
        }
      } else {
        showErrorToast(error, '加载版本历史失败');
        setRevisionHistory([]);
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  // Task 39.1: 回滚到指定版本
  const handleRollback = (revision: { content: string; saved_at: string; revision_type: string }) => {
    Modal.confirm({
      title: '确认回滚到该版本？',
      content: `保存时间：${revision.saved_at ? new Date(revision.saved_at).toLocaleString('zh-CN') : '未知'}，当前正文将被覆盖。`,
      okText: '确认回滚',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          setContent(revision.content);
          contentRef.current = revision.content;
          const updated = await shortStoryApi.update(story.id, { content: revision.content });
          updateCurrentStory(updated);
          setHistoryDrawerOpen(false);
          message.success('已回滚到该版本');
        } catch (error) {
          showErrorToast(error, '回滚失败');
        }
      },
    });
  };

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (targetWordsTimerRef.current) clearTimeout(targetWordsTimerRef.current);
    };
  }, []);

  // SSE 取消生成：中止请求并重置所有 SSE 相关状态
  const handleSseCancel = () => {
    sseClientRef.current?.abort();
    sseClientRef.current = null;
    setSseVisible(false);
    setRegenerating(false);
    setPolishing(false);
    setGeneratingSegment(null);
    setSegmentPreview('');
    message.info('已取消生成');
  };

  const handleGenerateSegment = async (stage: string) => {
    const seg = segments.find((s) => s.stage === stage);
    setGeneratingSegment(stage);
    setSseTitle(`AI生成「${seg?.label || stage}」段落`);
    setSseProgress(0);
    setSseMessage('正在准备生成...');
    setSegmentPreview('');
    setSseVisible(true);

    try {
      const client = new SSEPostClient(
        `/api/short-stories/${story.id}/generate-segment-stream`,
        { segment_stage: stage },
        {
          onProgress: (msg, prog) => {
            setSseProgress(prog);
            setSseMessage(msg);
          },
          onChunk: (chunk) => {
            setSegmentPreview((prev) => prev + chunk);
          },
        }
      );
      sseClientRef.current = client;
      const res = await client.connect() as { content: string };
      const generatedContent = res.content || '';
      const newContent = contentRef.current + (contentRef.current ? '\n\n' : '') + generatedContent;
      setContent(newContent);
      scheduleAutoSave();

      // 回写分段 actual_words
      const segIndex = segments.findIndex((s) => s.stage === stage);
      if (segIndex >= 0) {
        const wordCount = countWords(generatedContent);
        const newSegments = [...segments];
        newSegments[segIndex] = { ...newSegments[segIndex], actual_words: wordCount };
        setSegments(newSegments);
        updateCurrentStory({ segments: JSON.stringify(newSegments) });
        shortStoryApi
          .update(story.id, { segments: JSON.stringify(newSegments) })
          .catch((err) => showErrorToast(err, '更新分段进度失败'));
      }

      message.success('已生成本段内容');
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showErrorToast(error, 'AI生成分段失败');
      }
    } finally {
      setGeneratingSegment(null);
      setSseVisible(false);
      setSegmentPreview('');
      sseClientRef.current = null;
    }
  };

  const handlePolish = async () => {
    if (!content || content.trim().length < 100) {
      message.warning('正文内容过短，无法精修（至少需要100字）');
      return;
    }
    setPolishing(true);
    setSseTitle('AI润色全文');
    setSseProgress(0);
    setSseMessage('正在准备精修...');
    setSseVisible(true);

    try {
      const client = new SSEPostClient(
        `/api/short-stories/${story.id}/polish-stream`,
        {},
        {
          onProgress: (msg, prog) => {
            setSseProgress(prog);
            setSseMessage(msg);
          },
        }
      );
      sseClientRef.current = client;
      const preview = await client.connect() as RevisionPreview;
      setRevisionPreview(preview);
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showErrorToast(error, 'AI润色失败');
      }
    } finally {
      setPolishing(false);
      setSseVisible(false);
      sseClientRef.current = null;
    }
  };

  const hasGeneratedContent = currentWords > 100;

  // 后台重写：创建后台任务后立即返回，关闭浏览器不影响生成
  // 任务进度通过 FloatingTaskPanel 查看，完成后自动保存
  const handleRegenerateBackground = async () => {
    Modal.confirm({
      title: '后台重新生成全文',
      content: '将在后台重新生成全文，可关闭页面，完成后右下角浮窗会提示。当前正文会被覆盖。',
      okText: '开始后台生成',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        try {
          await shortStoryApi.regenerateBackground(story.id);
          message.success('已创建后台重写任务，可关闭页面，完成后右下角浮窗会提示');
          // 通知 FloatingTaskPanel 立即刷新
          eventBus.emit('background-task-created');
        } catch (error) {
          showErrorToast(error, '创建后台重写任务失败');
        }
      },
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>正文创作</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastSaved && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {saving ? '保存中...' : `已保存 ${lastSaved.toLocaleTimeString('zh-CN')}`}
            </Text>
          )}
          {lastDraftSaveTime && !lastSaved && (
            <Tooltip title="本地草稿已自动保存，网络恢复后可手动点保存或刷新页面恢复">
              <Text type="warning" style={{ fontSize: 12 }}>
                📝 草稿已备份 {new Date(lastDraftSaveTime).toLocaleTimeString('zh-CN')}
              </Text>
            </Tooltip>
          )}
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存
          </Button>
          {hasGeneratedContent && (
            <Button
              icon={<ReloadOutlined />}
              loading={regenerating}
              danger
              onClick={handleRegenerateBackground}
            >
              AI一键重写全文
            </Button>
          )}
          <Button loading={polishing} onClick={handlePolish}>
            AI润色全文
          </Button>
        </div>
      </div>

      {/* Task 39.2: 目标字数动态调整 + Task 39.1: 版本历史入口 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>目标字数</Text>
          <InputNumber
            size="small"
            min={8000}
            max={20000}
            step={1000}
            value={targetWordsInput}
            onChange={handleTargetWordsChange}
            style={{ width: 110 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>修改后分段将自动重算</Text>
        </div>
        <Button icon={<HistoryOutlined />} onClick={handleOpenHistory}>
          版本历史
        </Button>
      </div>

      {hasGeneratedContent && (
        <Alert
          type="success"
          icon={<RobotOutlined />}
          style={{ marginBottom: 16 }}
          message="正文已由AI自动生成完成"
          description={
            <div style={{ fontSize: 13 }}>
              <Text>当前共 {formatWordCount(currentWords)} 字，所有分段已完成。你可以直接精修全文，或点击下方分段中的「AI生成」重写单段。</Text>
              <br />
              <Text type="secondary">不满意？点击右上角「AI一键重写全文」重新生成。</Text>
            </div>
          }
        />
      )}

      <Collapse
        size="small"
        style={{ marginBottom: 16 }}
        items={[{
          key: 'structure',
          label: <Text strong>参考结构（约占字数比例，非硬约束）</Text>,
          children: (
            <div style={{ fontSize: 13 }}>
              <Text>开头 5% · 铺垫 20% · 高潮 60% · 结尾 15%（参考值）</Text>
              <br />
              <Text type="secondary">
                开头前5%抛出核心冲突 → 铺垫20%逐步激化矛盾 → 高潮60%展开反转与揭露 → 结尾15%收束情绪
              </Text>
            </div>
          ),
        }]}
      />

      <div style={{ display: 'flex', gap: 16, flexDirection: isMobile ? 'column' : 'row' }}>
        {/* 左侧分段进度面板 */}
        <Card
          size="small"
          title="分段进度"
          style={{
            width: isMobile ? '100%' : 280,
            flexShrink: 0,
            position: isMobile ? 'static' : 'sticky',
            top: 16,
            alignSelf: 'flex-start',
          }}
        >
          {/* 总进度 */}
          <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text strong>总字数</Text>
              <Text style={{ color: progress >= 100 ? token.colorSuccess : token.colorPrimary }}>
                {formatWordCount(currentWords)} / {formatWordCount(targetWords)}
              </Text>
            </div>
            <Progress percent={progress} size="small" status={progress >= 100 ? 'success' : 'active'} />
          </div>

          {/* 各段进度 */}
          {segments.map((seg) => {
            const color = STORY_STAGE_CONFIG[seg.stage]?.color || token.colorPrimary;
            const segProgress = seg.target_words > 0 ? Math.min(Math.round((seg.actual_words / seg.target_words) * 100), 100) : 0;
            const statusCfg = STATUS_CONFIG[seg.status] || STATUS_CONFIG.pending;

            return (
              <div
                key={seg.stage}
                style={{
                  marginBottom: 12,
                  padding: 8,
                  background: token.colorBgTextHover,
                  borderRadius: 6,
                  borderLeft: `3px solid ${token.colorBorderSecondary}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 13 }}>{seg.label}</Text>
                  <Tag color={statusCfg.color} style={{ margin: 0 }} aria-label={`分段状态：${statusCfg.text}`}>
                    {statusCfg.icon} {statusCfg.text}
                  </Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                  目标 {formatWordCount(seg.target_words)} 字（{Math.round(seg.target_ratio * 100)}%）
                </Text>
                <Progress percent={segProgress} size="small" strokeColor={color} />
                <Button
                  size="small"
                  type="link"
                  loading={generatingSegment === seg.stage}
                  onClick={() => handleGenerateSegment(seg.stage)}
                  style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                >
                  AI生成
                </Button>
              </div>
            );
          })}
        </Card>

        {/* 右侧编辑器 */}
        <Card
          size="small"
          style={{ flex: 1, minWidth: 0 }}
          styles={{ body: { padding: 0 } }}
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>正文编辑器</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                实时字数：{formatWordCount(currentWords)}
              </Text>
            </div>
          }
        >
          {!content && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: token.colorTextSecondary }}>
              <EditOutlined style={{ fontSize: 48, marginBottom: 16, display: 'block' }} />
              <Text>开始创作你的短故事，或点击右上角"AI润色全文"让AI帮你生成</Text>
            </div>
          )}
          <TextArea
            value={content}
            onChange={handleContentChange}
            autoSize={{ minRows: isMobile ? 10 : 20 }}
            style={{
              border: 'none',
              borderRadius: 0,
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: 15,
              lineHeight: 1.8,
              padding: 16,
            }}
            placeholder="开始创作你的短故事...

第一步：死亡黄金钩子（前5%）
不写任何铺垫，第一句就将读者推入冲突现场。
例：结婚当天，老公把前女友带上了主桌。

第二步：冲突激化与打压（20%）
反派极致嚣张，主角处于劣势或隐忍蓄力，将读者的愤怒/屈辱感拉到最高点。

第三步：绝地反击与多重反转（60%）
亮出底牌，一波三折。打一下→反派反扑→再揭露更大真相。

第四步：极致爽点与收尾（15%）
反派惨烈下场，主角清醒独立走向新人生，干净利落收尾。"
          />
        </Card>
      </div>

      {/* AI修改对比预览Modal */}
      <RevisionPreviewModal
        open={!!revisionPreview}
        storyId={story.id}
        preview={revisionPreview}
        onCancel={() => {
          setRevisionPreview(null);
          // 取消时删除后台任务记录，避免下次进页面重复弹窗
          if (pendingTaskId) {
            deleteTask(pendingTaskId).catch(() => {});
            setPendingTaskId(null);
          }
        }}
        onConfirmed={async (result) => {
          setContent(result.content);
          contentRef.current = result.content;
          setRevisionPreview(null);
          // 确认后删除后台任务记录
          if (pendingTaskId) {
            deleteTask(pendingTaskId).catch(() => {});
            setPendingTaskId(null);
          }
          await reload();
          message.success('已确认保存AI修改');
        }}
      />

      {/* SSE流式生成进度弹窗 */}
      <SSELoadingOverlay
        visible={sseVisible}
        progress={sseProgress}
        message={sseMessage}
        variant="modal"
        title={sseTitle}
        showMinimize={false}
        cancelButtonText="取消生成"
        onCancel={handleSseCancel}
      />

      {/* 分段生成实时预览 */}
      {segmentPreview && sseVisible && (
        <Card
          size="small"
          title="实时生成预览"
          extra={
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setSegmentPreview('')}
            />
          }
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            width: isMobile ? 'calc(100vw - 32px)' : 400,
            maxHeight: 300,
            zIndex: 1001,
            boxShadow: token.boxShadowSecondary,
          }}
          styles={{ body: { maxHeight: 240, overflow: 'auto', padding: 12 } }}
        >
          <Typography.Paragraph
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 13,
              lineHeight: 1.6,
              margin: 0,
              color: token.colorTextSecondary,
            }}
          >
            {segmentPreview.slice(-500)}
          </Typography.Paragraph>
        </Card>
      )}

      {/* Task 39.1: 版本历史 Drawer */}
      <Drawer
        title="版本历史"
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        width={isMobile ? '100%' : 480}
      >
        {loadingHistory ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin tip="加载版本历史..." />
          </div>
        ) : revisionHistory.length === 0 ? (
          <Empty description="暂无版本历史" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              点击某条历史可回滚到该版本（当前正文将被覆盖）
            </Text>
            {revisionHistory.map((rev, idx) => {
              const typeColor =
                rev.revision_type === 'polish' ? 'blue' :
                rev.revision_type === 'improve' ? 'purple' :
                rev.revision_type === 'regenerate' ? 'gold' : 'default';
              return (
                <Card
                  key={idx}
                  size="small"
                  hoverable
                  style={{ marginBottom: 8 }}
                  onClick={() => handleRollback(rev)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Tag color={typeColor}>{rev.revision_type || 'save'}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {rev.saved_at ? new Date(rev.saved_at).toLocaleString('zh-CN') : '未知时间'}
                    </Text>
                  </div>
                  <Typography.Paragraph
                    ellipsis={{ rows: 3 }}
                    style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: token.colorTextSecondary }}
                  >
                    {rev.content || '(空内容)'}
                  </Typography.Paragraph>
                </Card>
              );
            })}
          </div>
        )}
      </Drawer>
    </div>
  );
}
