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
} from 'antd';
import { SaveOutlined, CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import { formatWordCount } from '../../utils/format';
import type { ShortStory, StorySegment } from '../../types';

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<string>(content);
  const [generatingSegment, setGeneratingSegment] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    try {
      const parsed = story.segments ? JSON.parse(story.segments) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setSegments(parsed);
      }
    } catch {
      setSegments([]);
    }
    setContent(story.content || '');
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

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    scheduleAutoSave();
  };

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
    try {
      setGeneratingSegment(stage);
      const res = await shortStoryApi.generateSegment(story.id, stage);
      const newContent = contentRef.current + (contentRef.current ? '\n\n' : '') + res.content;
      setContent(newContent);
      scheduleAutoSave();
      message.success('已生成本段内容');
    } catch (error) {
      showErrorToast(error, 'AI生成分段失败');
    } finally {
      setGeneratingSegment(null);
    }
  };

  const handlePolish = async () => {
    try {
      setPolishing(true);
      const res = await shortStoryApi.polish(story.id);
      setContent(res.content);
      scheduleAutoSave();
      message.success('已精修全文');
    } catch (error) {
      showErrorToast(error, 'AI精修失败');
    } finally {
      setPolishing(false);
    }
  };

  const hasGeneratedContent = currentWords > 100;

  const handleRegenerate = async () => {
    try {
      setRegenerating(true);
      await shortStoryApi.generateFull({
        initial_idea: story.logline || story.title || '重写故事',
        target_words: story.target_words || 12000,
        emotion_goal: story.emotion_goal || undefined,
        target_platform: story.target_platform || '知乎盐言',
      });
      // 刷新当前故事以获取新生成的内容
      await reload();
      message.success('已重新生成全文');
    } catch (error) {
      showErrorToast(error, 'AI重新生成失败');
    } finally {
      setRegenerating(false);
    }
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
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存
          </Button>
          {hasGeneratedContent && (
            <Button
              icon={<ReloadOutlined />}
              loading={regenerating}
              onClick={handleRegenerate}
              danger
            >
              AI一键重写全文
            </Button>
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
    </div>
  );
}
