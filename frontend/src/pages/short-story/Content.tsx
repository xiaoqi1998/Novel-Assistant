import { useEffect, useState, useRef, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Card,
  Typography,
  Input,
  Button,
  message,
  Tag,
  Progress,
  Alert,
  Tooltip,
  theme,
  Grid,
  Modal,
  Dropdown,
} from 'antd';
import type { MenuProps } from 'antd';
import { SaveOutlined, CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, RobotOutlined, DownOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import { formatWordCount } from '../../utils/format';
import RevisionPreviewModal from '../../components/RevisionPreviewModal';
import { SSELoadingOverlay } from '../../components/SSELoadingOverlay';
import { eventBus } from '../../store/eventBus';
import {
  loadStoryContentDraft,
  saveStoryContentDraft,
  clearStoryContentDraft,
} from '../../utils/shortStoryDraft';
import type { ShortStory, StorySegment, RevisionPreview } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

const STAGE_COLOR: Record<string, string> = {
  hook: '#1677ff',
  escalation: '#fa8c16',
  climax: '#f5222d',
  resolution: '#722ed1',
};

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
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const chinesePunctuation = (text.match(/[\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + chinesePunctuation + englishWords;
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
  const [generatingSegment, setGeneratingSegment] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revisionPreview, setRevisionPreview] = useState<RevisionPreview | null>(null);
  // SSE流式进度状态
  const [sseVisible, setSseVisible] = useState(false);
  const [sseProgress, setSseProgress] = useState(0);
  const [sseMessage, setSseMessage] = useState('');
  const [sseTitle, setSseTitle] = useState('AI生成中...');
  // 分段生成时的实时内容预览
  const [segmentPreview, setSegmentPreview] = useState('');

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

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

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  const handleSegmentStatusChange = (index: number, status: StorySegment['status']) => {
    const newSegs = [...segments];
    newSegs[index] = { ...newSegs[index], status };
    setSegments(newSegs);
    // 同步保存分段状态
    shortStoryApi
      .update(story.id, { segments: JSON.stringify(newSegs) })
      .then((updated) => updateCurrentStory(updated))
      .catch((err) => showErrorToast(err, '更新分段状态失败'));
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
      const res = await shortStoryApi.generateSegmentStream(story.id, stage, {
        onProgress: (msg, prog) => {
          setSseProgress(prog);
          setSseMessage(msg);
        },
        onChunk: (chunk) => {
          setSegmentPreview((prev) => prev + chunk);
        },
      });
      const newContent = contentRef.current + (contentRef.current ? '\n\n' : '') + (res.content || '');
      setContent(newContent);
      scheduleAutoSave();
      message.success('已生成本段内容');
    } catch (error) {
      showErrorToast(error, 'AI生成分段失败');
    } finally {
      setGeneratingSegment(null);
      setSseVisible(false);
      setSegmentPreview('');
    }
  };

  const handlePolish = async () => {
    setPolishing(true);
    setSseTitle('AI精修润色全文');
    setSseProgress(0);
    setSseMessage('正在准备精修...');
    setSseVisible(true);

    try {
      const preview = await shortStoryApi.polishStream(story.id, {
        onProgress: (msg, prog) => {
          setSseProgress(prog);
          setSseMessage(msg);
        },
      });
      setRevisionPreview(preview);
    } catch (error) {
      showErrorToast(error, 'AI精修失败');
    } finally {
      setPolishing(false);
      setSseVisible(false);
    }
  };

  const hasGeneratedContent = currentWords > 100;

  const handleRegenerate = async () => {
    setRegenerating(true);
    setSseTitle('AI重新生成全文');
    setSseProgress(0);
    setSseMessage('正在准备重新生成...');
    setSseVisible(true);

    try {
      await shortStoryApi.regenerateStream(story.id, {
        onProgress: (msg, prog) => {
          setSseProgress(prog);
          setSseMessage(msg);
        },
      });
      await reload();
      message.success('已重新生成全文');
    } catch (error) {
      showErrorToast(error, 'AI重新生成失败');
    } finally {
      setRegenerating(false);
      setSseVisible(false);
    }
  };

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

  // 重写按钮 Dropdown 菜单：前台重写 / 后台重写
  const regenerateMenuItems: MenuProps['items'] = [
    {
      key: 'foreground',
      label: '前台重写（SSE实时进度）',
      onClick: () => handleRegenerate(),
    },
    {
      key: 'background',
      label: '后台重写（可关页面）',
      icon: <CloudUploadOutlined />,
      onClick: () => handleRegenerateBackground(),
    },
  ];

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
            <Dropdown menu={{ items: regenerateMenuItems }} placement="bottomRight">
              <Button
                icon={<ReloadOutlined />}
                loading={regenerating}
                danger
              >
                AI一键重写全文 <DownOutlined />
              </Button>
            </Dropdown>
          )}
          <Button loading={polishing} onClick={handlePolish}>
            AI精修全文
          </Button>
        </div>
      </div>

      {hasGeneratedContent && (
        <Alert
          type="success"
          showIcon
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

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="黄金结构（1.5万字标准）"
        description={
          <div style={{ fontSize: 13 }}>
            <Text>Hook 5% · Escalation 20% · Climax 60% · Resolution 15%</Text>
            <br />
            <Text type="secondary">
              死亡黄金钩子前5%抛出危机现场 → 冲突激化20%积攒怒气 → 绝地反击60%剥洋葱式揭露 → 极致爽点15%清算收尾
            </Text>
          </div>
        }
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
          {segments.map((seg, index) => {
            const color = STAGE_COLOR[seg.stage] || token.colorPrimary;
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
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 13 }}>{seg.label}</Text>
                  <Tooltip title={`点击切换状态`}>
                    <Tag
                      color={statusCfg.color}
                      style={{ cursor: 'pointer', margin: 0 }}
                      onClick={() => {
                        const nextStatus: StorySegment['status'] =
                          seg.status === 'pending' ? 'writing' : seg.status === 'writing' ? 'completed' : 'pending';
                        handleSegmentStatusChange(index, nextStatus);
                      }}
                    >
                      {statusCfg.icon} {statusCfg.text}
                    </Tag>
                  </Tooltip>
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
          <TextArea
            value={content}
            onChange={handleContentChange}
            autoSize={{ minRows: 20 }}
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
        onCancel={() => setRevisionPreview(null)}
        onConfirmed={async (result) => {
          setContent(result.content);
          setRevisionPreview(null);
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
      />

      {/* 分段生成实时预览 */}
      {segmentPreview && sseVisible && (
        <Card
          size="small"
          title="实时生成预览"
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            width: 400,
            maxHeight: 300,
            zIndex: 1001,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
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
    </div>
  );
}
