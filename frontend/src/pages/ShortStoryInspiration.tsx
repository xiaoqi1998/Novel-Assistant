import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Button, Typography, message, Spin, Tag, theme, Space } from 'antd';
import { SendOutlined, ArrowLeftOutlined, ThunderboltOutlined, ReloadOutlined } from '@ant-design/icons';
import { shortInspirationApi, shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';

const { Text } = Typography;
const { TextArea } = Input;

type Step = 'idea' | 'emotion_goal' | 'logline' | 'twist' | 'genre' | 'confirm' | 'complete';

interface Message {
  type: 'ai' | 'user';
  content: string;
  options?: any[];
  optionType?: 'emotion' | 'logline' | 'twist' | 'genre';
  optionsDisabled?: boolean;
  step?: Step;
}

interface StoryData {
  initial_idea: string;
  emotion_goal: string;
  logline: string;
  twist_type: string;
  twist_content: string;
  twist_clues: string[];
  genre: string;
}

const STEP_LABEL: Record<string, string> = {
  emotion_goal: '情绪目标',
  logline: '一句话梗概',
  twist: '核心反转',
  genre: '题材标签',
};

const ShortStoryInspiration: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [currentStep, setCurrentStep] = useState<Step>('idea');
  const [messages, setMessages] = useState<Message[]>([
    {
      type: 'ai',
      content: '欢迎来到短故事灵感模式！短故事以情绪为核心，8000-20000字单文档创作。\n\n请告诉我你想写一个什么样的短故事？比如："一个关于背叛和复仇的故事"、"结婚当天发现老公的秘密"。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [storyData, setStoryData] = useState<StoryData>({
    initial_idea: '',
    emotion_goal: '',
    logline: '',
    twist_type: '',
    twist_content: '',
    twist_clues: [],
    genre: '',
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  };

  const updateLastAiMessage = (patch: Partial<Message>) => {
    setMessages((prev) => {
      const newMsgs = [...prev];
      for (let i = newMsgs.length - 1; i >= 0; i--) {
        if (newMsgs[i].type === 'ai') {
          newMsgs[i] = { ...newMsgs[i], ...patch };
          break;
        }
      }
      return newMsgs;
    });
  };

  const handleIdeaSubmit = async () => {
    if (!input.trim()) {
      message.warning('请输入你的故事想法');
      return;
    }

    const idea = input.trim();
    setStoryData((prev) => ({ ...prev, initial_idea: idea }));
    addMessage({ type: 'user', content: idea });
    setInput('');
    setCurrentStep('emotion_goal');

    await generateOptions('emotion_goal', { initial_idea: idea });
  };

  const generateOptions = async (step: Step, context: Record<string, string>) => {
    setLoading(true);
    addMessage({
      type: 'ai',
      content: '正在为你生成选项...',
      options: [],
      optionType: step as any,
      step,
    });

    try {
      const result = await shortInspirationApi.generateOptions({
        step,
        context,
      });

      updateLastAiMessage({
        content: result.prompt || `请选择${STEP_LABEL[step] || step}：`,
        options: result.options || [],
      });
    } catch (error) {
      updateLastAiMessage({
        content: '生成失败，请重试或手动输入。',
        options: ['重新生成', '手动输入'],
      });
      showErrorToast(error, '生成选项失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = async (option: any, step: Step) => {
    // 禁用选项
    updateLastAiMessage({ optionsDisabled: true });

    if (typeof option === 'string') {
      if (option === '重新生成') {
        const ctx: Record<string, string> = { initial_idea: storyData.initial_idea };
        if (storyData.emotion_goal) ctx.emotion_goal = storyData.emotion_goal;
        if (storyData.logline) ctx.logline = storyData.logline;
        if (storyData.twist_content) ctx.twist_content = storyData.twist_content;
        await generateOptions(step, ctx);
        return;
      }
      if (option === '手动输入') {
        addMessage({ type: 'user', content: '我选择手动输入' });
        setCurrentStep(step);
        return;
      }

      addMessage({ type: 'user', content: option });

      if (step === 'emotion_goal') {
        setStoryData((prev) => ({ ...prev, emotion_goal: option }));
        const nextStep: Step = 'logline';
        setCurrentStep(nextStep);
        await generateOptions(nextStep, { initial_idea: storyData.initial_idea, emotion_goal: option });
      } else if (step === 'logline') {
        setStoryData((prev) => ({ ...prev, logline: option }));
        const nextStep: Step = 'twist';
        setCurrentStep(nextStep);
        await generateOptions(nextStep, { initial_idea: storyData.initial_idea, emotion_goal: storyData.emotion_goal, logline: option });
      } else if (step === 'genre') {
        setStoryData((prev) => ({ ...prev, genre: option }));
        setStoryData((prev) => ({ ...prev, genre: option }));
        showConfirm({ ...storyData, genre: option });
      }
    } else if (typeof option === 'object') {
      // 反转选项
      const optionStr = `${option.twist_type}：${option.twist_content}`;
      addMessage({ type: 'user', content: optionStr });

      setStoryData((prev) => ({
        ...prev,
        twist_type: option.twist_type || '',
        twist_content: option.twist_content || '',
        twist_clues: option.clues || [],
      }));

      const nextStep: Step = 'genre';
      setCurrentStep(nextStep);
      await generateOptions(nextStep, {
        initial_idea: storyData.initial_idea,
        emotion_goal: storyData.emotion_goal,
        logline: storyData.logline,
        twist_content: option.twist_content || '',
      });
    }
  };

  const showConfirm = (data: StoryData) => {
    setCurrentStep('confirm');
    const cluesText = data.twist_clues.length > 0 ? data.twist_clues.map((c, i) => `  ${i + 1}. ${c}`).join('\n') : '  无';
    addMessage({
      type: 'ai',
      content: `完美！以下是你的短故事设定：

**情绪目标**：${data.emotion_goal}
**一句话梗概**：${data.logline}
**核心反转**：${data.twist_type} - ${data.twist_content}
**铺垫线索**：
${cluesText}
**题材标签**：${data.genre}

确认创建短故事吗？`,
      options: ['✅ 确认创建', '🔄 重新选择'],
      optionType: 'confirm' as any,
      step: 'confirm',
    });
  };

  const handleConfirm = async (option: string) => {
    updateLastAiMessage({ optionsDisabled: true });
    addMessage({ type: 'user', content: option });

    if (option === '✅ 确认创建') {
      setLoading(true);
      try {
        const result = await shortStoryApi.create({
          title: storyData.logline.slice(0, 50) || '未命名短故事',
          logline: storyData.logline,
          genre: storyData.genre,
          emotion_goal: storyData.emotion_goal,
          twist_type: storyData.twist_type,
          twist_content: storyData.twist_content,
          twist_clues: JSON.stringify(storyData.twist_clues),
          target_words: 12000,
          target_platform: '知乎盐言',
        });
        addMessage({
          type: 'ai',
          content: `短故事《${result.title}》创建成功！正在跳转到工作区...`,
        });
        setTimeout(() => {
          navigate(`/short-story/${result.id}/setup`);
        }, 1500);
      } catch (error) {
        showErrorToast(error, '创建短故事失败');
      } finally {
        setLoading(false);
      }
    } else if (option === '🔄 重新选择') {
      // 回到情绪目标选择
      setCurrentStep('emotion_goal');
      await generateOptions('emotion_goal', { initial_idea: storyData.initial_idea });
    }
  };

  const handleSend = async () => {
    if (currentStep === 'idea') {
      await handleIdeaSubmit();
    }
  };

  const handleRestart = () => {
    setMessages([
      {
        type: 'ai',
        content: '让我们重新开始。请告诉我你想写一个什么样的短故事？',
      },
    ]);
    setCurrentStep('idea');
    setStoryData({
      initial_idea: '',
      emotion_goal: '',
      logline: '',
      twist_type: '',
      twist_content: '',
      twist_clues: [],
      genre: '',
    });
  };

  // 渲染选项卡片
  const renderOptions = (msg: Message) => {
    if (!msg.options || msg.options.length === 0 || msg.optionsDisabled) return null;

    if (msg.step === 'confirm') {
      return (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {msg.options.map((opt) => (
            <Button
              key={opt}
              type={opt.includes('确认') ? 'primary' : 'default'}
              onClick={() => handleConfirm(opt)}
              loading={loading}
            >
              {opt}
            </Button>
          ))}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {msg.options.map((opt, idx) => {
          if (typeof opt === 'string') {
            return (
              <Card
                key={idx}
                size="small"
                hoverable
                style={{ cursor: 'pointer' }}
                onClick={() => handleSelectOption(opt, msg.step!)}
              >
                <Text>{opt}</Text>
              </Card>
            );
          } else if (typeof opt === 'object') {
            const o = opt as any;
            return (
              <Card
                key={idx}
                size="small"
                hoverable
                style={{ cursor: 'pointer' }}
                onClick={() => handleSelectOption(o, msg.step!)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {o.heat && <Tag color="orange">{o.heat}</Tag>}
                  {o.twist_type && <Tag color="red">{o.twist_type}</Tag>}
                  {o.value && <Tag color="blue">{o.value}</Tag>}
                </div>
                <Text strong>{o.label || o.twist_content || o.value}</Text>
                {o.reason && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{o.reason}</Text>
                  </div>
                )}
                {o.twist_content && (
                  <div style={{ marginTop: 4 }}>
                    <Text>{o.twist_content}</Text>
                  </div>
                )}
                {o.clues && Array.isArray(o.clues) && o.clues.length > 0 && (
                  <div style={{ marginTop: 8, padding: 8, background: token.colorBgTextHover, borderRadius: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 'bold' }}>铺垫线索：</Text>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {o.clues.map((c: string, i: number) => (
                        <li key={i}>
                          <Text style={{ fontSize: 12 }}>{c}</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>
        <Space>
          <ThunderboltOutlined style={{ color: token.colorPrimary }} />
          <Text strong>短故事灵感模式</Text>
        </Space>
        <Button type="text" icon={<ReloadOutlined />} onClick={handleRestart} size="small">
          重新开始
        </Button>
      </div>

      <Card styles={{ body: { padding: 16 } }}>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', marginBottom: 16 }}>
          {messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: msg.type === 'user' ? token.colorPrimary : token.colorBgContainer,
                  color: msg.type === 'user' ? '#fff' : token.colorText,
                  border: msg.type === 'user' ? 'none' : `1px solid ${token.colorBorderSecondary}`,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
                {renderOptions(msg)}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
              <div style={{ padding: '10px 14px' }}>
                <Spin size="small" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {currentStep === 'idea' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述你想写的短故事..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={loading}
            >
              发送
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ShortStoryInspiration;
