import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Button, Typography, message, Spin, Tag, theme, Space, Result, Steps, Progress } from 'antd';
import { SendOutlined, ArrowLeftOutlined, ThunderboltOutlined, ReloadOutlined, CheckCircleOutlined, EditOutlined, BulbOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { shortInspirationApi, shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import { SSEPostClient } from '../utils/sseClient';
import type { ShortStory } from '../types';
import { EMOTION_GOAL_COLOR } from '../constants/shortStory';

const { Text, Title } = Typography;
const { TextArea } = Input;

type Phase = 'idea' | 'emotion_goal' | 'generating' | 'done';

// 黄金结构默认分段标签（按 Climax 60% 黄金比例）
const SEG_LABELS = ['黄金钩子', '冲突激化', '高潮反转', '爽点收尾'];
const SEG_DESCS = ['开篇抛出核心危机', '反派嚣张主角隐忍', '多重反转揭露真相', '反派下场主角新生'];

// 创作小知识轮播文案
const CREATIVE_TIPS = [
  '黄金结构：Hook 5% / Escalation 20% / Climax 60% / Resolution 15%',
  '爆款公式：极致反差 + 道德冲突 + 强身份标签 + 迫切危机',
  '反转要早埋线索，后文揭晓才不会突兀',
  '情绪目标是故事的灵魂，决定读者读完后产生什么反应',
  '结尾留白，让读者意难平才会反复回味',
];

const EMOTION_GOAL_DESC: Record<string, string> = {
  '意难平': '迟来的深情、双向错过',
  '反转震撼': '身份/视角/动机反转',
  '爽感释放': '打脸复仇、绝地反击',
  '治愈温暖': '双向奔赴、细水长流',
  '细思极恐': '规则怪谈、死后反转',
  '共鸣感动': '亲情、世情、成长',
};

const ShortStoryInspiration: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [phase, setPhase] = useState<Phase>('idea');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialIdea, setInitialIdea] = useState('');
  const [emotionOptions, setEmotionOptions] = useState<any[]>([]);
  const [generatedStory, setGeneratedStory] = useState<ShortStory | null>(null);
  const [genProgress, setGenProgress] = useState(0);
  const [genMessage, setGenMessage] = useState('正在准备生成...');
  // 生成过程可视化状态
  const [totalSegments, setTotalSegments] = useState(0);
  const [currentSegIdx, setCurrentSegIdx] = useState(-1); // -1=设定阶段, 0..N-1=分段
  const [segWordCounts, setSegWordCounts] = useState<number[]>([]);
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const sseClientRef = useRef<SSEPostClient | null>(null);
  // 记录流式生成过程中后端已创建的 storyId，用于取消时清理孤儿故事
  const createdStoryIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [phase]);

  // 生成中：计时器 + 创作小知识轮播
  useEffect(() => {
    if (phase !== 'generating') return;
    const tickTimer = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
    const tipTimer = setInterval(() => setTipIndex((i) => (i + 1) % CREATIVE_TIPS.length), 10000);
    return () => {
      clearInterval(tickTimer);
      clearInterval(tipTimer);
    };
  }, [phase]);

  // 格式化已用时长 mm:ss
  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 重置生成状态
  const resetGenState = () => {
    setGenProgress(0);
    setGenMessage('正在准备生成...');
    setTotalSegments(0);
    setCurrentSegIdx(-1);
    setSegWordCounts([]);
    setTipIndex(0);
    setElapsedSecs(0);
    createdStoryIdRef.current = null;
  };

  // 阶段1：提交想法，获取情绪目标选项
  const handleIdeaSubmit = async () => {
    if (!input.trim()) {
      message.warning('请输入你的故事想法');
      return;
    }
    const idea = input.trim();
    setInitialIdea(idea);
    setLoading(true);
    setPhase('emotion_goal');

    try {
      const result = await shortInspirationApi.generateOptions({
        step: 'emotion_goal',
        context: { initial_idea: idea },
      });
      setEmotionOptions(result.options || []);
    } catch (error) {
      // 降级：直接用默认情绪目标列表
      setEmotionOptions([
        { value: '爽感释放', label: '爽感释放', heat: '🔥🔥🔥🔥🔥', reason: '打脸复仇类短篇最受欢迎' },
        { value: '反转震撼', label: '反转震撼', heat: '🔥🔥🔥🔥🔥', reason: '身份/视角反转最抓人' },
        { value: '意难平', label: '意难平', heat: '🔥🔥🔥🔥', reason: '迟来的深情最戳心' },
        { value: '细思极恐', label: '细思极恐', heat: '🔥🔥🔥🔥', reason: '规则怪谈类脑洞大' },
        { value: '治愈温暖', label: '治愈温暖', heat: '🔥🔥🔥', reason: '双向奔赴细水长流' },
        { value: '共鸣感动', label: '共鸣感动', heat: '🔥🔥🔥', reason: '亲情世情最易共情' },
      ]);
      showErrorToast(error, 'AI推荐失败，已加载默认选项');
    } finally {
      setLoading(false);
    }
  };

  // 取消生成
  const handleCancelGenerate = () => {
    sseClientRef.current?.abort();
    sseClientRef.current = null;
    // 清理孤儿故事：若后端已创建 story 记录但用户取消生成，则删除避免残留
    const orphanId = createdStoryIdRef.current;
    if (orphanId) {
      createdStoryIdRef.current = null;
      shortStoryApi.delete(orphanId).catch(() => {
        // 静默失败：清理孤儿失败不阻塞用户流程
      });
    }
    setPhase('emotion_goal');
    resetGenState();
    message.info('已取消生成');
  };

  // 阶段2：选择情绪目标后，SSE流式AI一键生成完整故事
  const handleSelectEmotion = async (emotion: string) => {
    setPhase('generating');
    resetGenState();

    const client = new SSEPostClient(
      '/api/short-stories/generate-full-stream',
      {
        initial_idea: initialIdea,
        emotion_goal: emotion,
        target_words: 12000,
        target_platform: '知乎盐言',
      },
      {
        onProgress: (msg, prog) => {
          setGenProgress(prog);
          setGenMessage(msg);
        },
        onStage: (stage, _msg, total, segIdx) => {
          if (total > 0) setTotalSegments(total);
          if (stage === 'setup') {
            setCurrentSegIdx(-1);
          } else if (stage.startsWith('segment_')) {
            const idx = segIdx !== undefined ? segIdx : parseInt(stage.split('_')[1], 10) - 1;
            setCurrentSegIdx(idx);
            // 初始化该段字数计数
            setSegWordCounts((prev) => {
              const next = [...prev];
              while (next.length <= idx) next.push(0);
              return next;
            });
          }
        },
        onChunk: (_content, segIdx) => {
          if (segIdx !== undefined) {
            setSegWordCounts((prev) => {
              const next = [...prev];
              while (next.length <= segIdx) next.push(0);
              next[segIdx] += _content.length;
              return next;
            });
          }
        },
        onError: (error) => {
          showErrorToast(error, 'AI生成失败');
        },
        onResult: (data) => {
          // 后端在保存后发送 result 事件，携带完整 story（含 id）；记录以便取消时清理孤儿
          if (data?.id) createdStoryIdRef.current = data.id;
        },
      }
    );
    sseClientRef.current = client;

    try {
      const story = await client.connect();
      setGeneratedStory(story);
      setGenProgress(100);
      setPhase('done');
      message.success('短故事生成完成！');
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showErrorToast(error, 'AI生成失败');
      }
      setPhase('emotion_goal');
    } finally {
      sseClientRef.current = null;
    }
  };

  const handleRestart = () => {
    setPhase('idea');
    setInput('');
    setInitialIdea('');
    setEmotionOptions([]);
    setGeneratedStory(null);
    resetGenState();
  };

  const handleViewStory = () => {
    if (generatedStory) {
      navigate(`/short-story/${generatedStory.id}/content`);
    }
  };

  // 渲染情绪目标选择卡片
  const renderEmotionOptions = () => {
    if (emotionOptions.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" tip="正在推荐情绪目标..." />
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <Title level={5} style={{ margin: 0 }}>
            <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
            选择情绪目标
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            情绪目标是短故事的核心，决定读者读完后产生什么样的情绪反应。选择后AI将一键生成完整故事。
          </Text>
        </div>
        {emotionOptions.map((opt, idx) => {
          const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
          return (
            <Card
              key={idx}
              size="small"
              hoverable
              style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              onClick={() => handleSelectEmotion(o.value || o.label)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {o.heat && <Tag color="orange">{o.heat}</Tag>}
                    <Text strong style={{ fontSize: 15 }}>{o.label || o.value}</Text>
                  </div>
                  {o.reason && (
                    <Text type="secondary" style={{ fontSize: 12 }}>{o.reason}</Text>
                  )}
                  {!o.reason && EMOTION_GOAL_DESC[o.value] && (
                    <Text type="secondary" style={{ fontSize: 12 }}>{EMOTION_GOAL_DESC[o.value]}</Text>
                  )}
                </div>
                <ThunderboltOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  // 渲染生成中：黄金结构可视化 + 进度 + 创作小知识轮播
  const renderGenerating = () => {
    // 构建 Steps 项：第0项=构思设定，后续=分段
    const segCount = totalSegments || 4;
    const currentStep = currentSegIdx + 1; // -1 → 0(setup), 0..N-1 → 1..N
    const items = [
      {
        title: '构思设定',
        description: '选题·反转·大纲',
        status: (currentSegIdx < 0 ? 'process' : 'finish') as 'wait' | 'process' | 'finish',
      },
    ];
    for (let i = 0; i < segCount; i++) {
      let status: 'wait' | 'process' | 'finish' = 'wait';
      if (currentSegIdx > i) status = 'finish';
      else if (currentSegIdx === i) status = 'process';
      else if (currentSegIdx < 0) status = 'wait';
      // setup完成后但还没进入第一段：第一段标记为process
      if (currentSegIdx === -1 && i === 0) status = 'wait';
      items.push({
        title: SEG_LABELS[i] || `第${i + 1}段`,
        description: SEG_DESCS[i] || '',
        status,
      });
    }

    // 当前段实时字数
    const currentWords = currentSegIdx >= 0 ? (segWordCounts[currentSegIdx] || 0) : 0;
    // 动态 ETA：基于已用时长和当前进度估算剩余时间（进度不足时提示计算中）
    const etaText =
      genProgress > 5 && elapsedSecs > 2
        ? `预计剩余 ${formatElapsed(Math.max(0, Math.round(elapsedSecs / (genProgress / 100) - elapsedSecs)))}`
        : '预计时间计算中...';

    return (
      <div style={{ padding: '32px 8px' }}>
        {/* AI 灵感星云动画 */}
        <div
          className="ai-creative-orb"
          style={{ ['--orb-color' as any]: token.colorPrimary, ['--orb-glow' as any]: `${token.colorPrimary}33` }}
        >
          <div className="orb-ring ring1" />
          <div className="orb-ring ring2" />
          <div className="orbit orbit-a"><span className="particle" /></div>
          <div className="orb-core">
            <ThunderboltOutlined />
          </div>
        </div>

        {/* 顶部标题 + 预计时间 */}
        <div style={{ textAlign: 'center', marginBottom: 28, marginTop: 16 }}>
          <Title level={4} style={{ marginBottom: 4 }}>
            AI 正在创作短故事
          </Title>
          <Space size="middle" style={{ color: token.colorTextSecondary, fontSize: 13 }}>
            <span><ClockCircleOutlined style={{ marginRight: 4 }} />{etaText}</span>
            <span>已用时 <Text strong style={{ color: token.colorPrimary }}>{formatElapsed(elapsedSecs)}</Text></span>
          </Space>
        </div>

        {/* 黄金结构可视化 Steps */}
        <div style={{ marginBottom: 28, padding: '0 4px' }}>
          <Steps
            size="small"
            current={currentStep}
            items={items}
            responsive
          />
        </div>

        {/* 进度条 */}
        <div style={{ marginBottom: 12 }}>
          <Progress
            percent={genProgress}
            status="active"
            strokeColor={{ from: token.colorPrimary, to: token.colorSuccess }}
            strokeWidth={10}
          />
        </div>

        {/* 当前状态消息 + 段字数 */}
        <div style={{ textAlign: 'center', marginBottom: 24, minHeight: 44 }}>
          <Text style={{ fontSize: 14, color: token.colorText }}>
            {genMessage}
          </Text>
          {currentSegIdx >= 0 && currentWords > 0 && (
            <div style={{ marginTop: 4 }}>
              <Tag color="blue" style={{ fontSize: 12 }}>本段 {currentWords} 字</Tag>
            </div>
          )}
        </div>

        {/* 创作小知识轮播 */}
        <div
          key={tipIndex}
          style={{
            background: token.colorFillTertiary,
            borderRadius: 8,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            animation: 'shortStoryTipFade 0.6s ease',
          }}
        >
          <BulbOutlined style={{ color: token.colorWarning, fontSize: 18, flexShrink: 0 }} />
          <Text style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {CREATIVE_TIPS[tipIndex]}
          </Text>
        </div>

        {/* 取消按钮 */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Button onClick={handleCancelGenerate} icon={<ArrowLeftOutlined />}>
            取消生成
          </Button>
        </div>

        {/* 动画样式：AI 灵感星云 + 轮播淡入 */}
        <style>{`
          @keyframes shortStoryTipFade {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          /* AI 灵感星云：中心发光核心 */
          .ai-creative-orb {
            position: relative;
            width: 180px;
            height: 180px;
            margin: 0 auto 8px;
          }
          .ai-creative-orb .orb-core {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 64px;
            height: 64px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            color: #fff;
            background: radial-gradient(circle at 35% 30%, var(--orb-color), color-mix(in srgb, var(--orb-color) 60%, #000 40%));
            box-shadow: 0 0 24px var(--orb-glow), 0 0 48px var(--orb-glow), inset 0 0 12px rgba(255,255,255,0.15);
            animation: orbCorePulse 2.4s ease-in-out infinite;
            z-index: 3;
          }
          @keyframes orbCorePulse {
            0%, 100% { box-shadow: 0 0 18px var(--orb-glow), 0 0 36px var(--orb-glow), inset 0 0 12px rgba(255,255,255,0.15); transform: translate(-50%, -50%) scale(1); }
            50% { box-shadow: 0 0 28px var(--orb-glow), 0 0 64px var(--orb-glow), inset 0 0 16px rgba(255,255,255,0.45); transform: translate(-50%, -50%) scale(1.08); }
          }
          /* 脉动光环：三层错开延迟向外扩散 */
          .ai-creative-orb .orb-ring {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            border-radius: 50%;
            border: 2px solid var(--orb-color);
            opacity: 0;
            pointer-events: none;
          }
          .ai-creative-orb .ring1 { width: 64px; height: 64px; animation: orbRingPulse 2.4s ease-out infinite; }
          .ai-creative-orb .ring2 { width: 64px; height: 64px; animation: orbRingPulse 2.4s ease-out infinite 0.8s; }
          @keyframes orbRingPulse {
            0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0.7; border-width: 2px; }
            100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; border-width: 1px; }
          }
          /* 轨道粒子：单条椭圆轨道，粒子沿边缘旋转 */
          .ai-creative-orb .orbit {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            border-radius: 50%;
            pointer-events: none;
          }
          .ai-creative-orb .orbit-a {
            width: 120px; height: 120px;
            animation: orbSpin 6s linear infinite;
          }
          @keyframes orbSpin {
            from { transform: translate(-50%, -50%) rotate(0deg); }
            to { transform: translate(-50%, -50%) rotate(360deg); }
          }
          .ai-creative-orb .particle {
            position: absolute;
            top: -4px;
            left: 50%;
            transform: translateX(-50%);
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--orb-color);
            box-shadow: 0 0 4px var(--orb-color), 0 0 7px var(--orb-glow);
          }
          @media (prefers-reduced-motion: reduce) {
            .ai-creative-orb .orb-core,
            .ai-creative-orb .orb-ring,
            .ai-creative-orb .orbit { animation: none; }
            .ai-creative-orb .orb-ring { opacity: 0.3; transform: translate(-50%, -50%) scale(1.6); }
          }
        `}</style>
      </div>
    );
  };

  // 渲染生成完成
  const renderDone = () => {
    if (!generatedStory) return null;
    return (
      <Result
        status="success"
        icon={<CheckCircleOutlined style={{ color: token.colorSuccess }} />}
        title={`《${generatedStory.title}》生成完成！`}
        subTitle={
          <div>
            <div style={{ marginBottom: 8 }}>
              {generatedStory.emotion_goal && <Tag color={EMOTION_GOAL_COLOR[generatedStory.emotion_goal]?.color}>{generatedStory.emotion_goal}</Tag>}
              {generatedStory.genre && <Tag color="blue">{generatedStory.genre}</Tag>}
              {generatedStory.twist_type && <Tag color="red">{generatedStory.twist_type}</Tag>}
            </div>
            <Text type="secondary">{generatedStory.logline}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {generatedStory.current_words} 字
            </Text>
          </div>
        }
        extra={[
          <Button
            type="primary"
            size="large"
            key="view"
            icon={<EditOutlined />}
            onClick={handleViewStory}
          >
            查看正文
          </Button>,
          <Button key="restart" icon={<ReloadOutlined />} onClick={handleRestart}>
            再写一个
          </Button>,
        ]}
      />
    );
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>
        <Space>
          <ThunderboltOutlined style={{ color: token.colorPrimary }} />
          <Text strong>短故事灵感模式</Text>
        </Space>
        {phase !== 'idea' && phase !== 'generating' && (
          <Button type="text" icon={<ReloadOutlined />} onClick={handleRestart} size="small">
            重新开始
          </Button>
        )}
        {(phase === 'idea' || phase === 'generating') && <div style={{ width: 80 }} />}
      </div>

      <Card styles={{ body: { padding: 24 } }}>
        {phase === 'idea' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <ThunderboltOutlined style={{ fontSize: 40, color: token.colorPrimary, marginBottom: 12 }} />
              <Title level={4} style={{ margin: 0 }}>
                你想写一个什么样的短故事？
              </Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                输入你的核心想法，AI将按爆款公式+黄金结构一键生成完整故事
              </Text>
            </div>

            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例：结婚当天，老公把前女友带上了主桌&#10;例：一个关于背叛和复仇的故事&#10;例：假千金归来复仇"
              autoSize={{ minRows: 4, maxRows: 8 }}
              style={{ marginBottom: 16, fontSize: 15 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleIdeaSubmit();
                }
              }}
            />

            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={handleIdeaSubmit}
              loading={loading}
              block
            >
              开始创作
            </Button>

            <div style={{ marginTop: 24, padding: 12, background: token.colorFillQuaternary, borderRadius: 6, border: `1px dashed ${token.colorBorder}` }}>
              <Text strong style={{ fontSize: 13 }}>
                <ThunderboltOutlined style={{ marginRight: 6 }} />
                爆款选题公式
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                三大黄金赛道：打脸复仇类、悬疑怪谈类、极致痛感类
              </Text>
            </div>
          </div>
        )}

        {phase === 'emotion_goal' && renderEmotionOptions()}

        {phase === 'generating' && renderGenerating()}

        {phase === 'done' && renderDone()}

        <div ref={messagesEndRef} />
      </Card>
    </div>
  );
};

export default ShortStoryInspiration;
