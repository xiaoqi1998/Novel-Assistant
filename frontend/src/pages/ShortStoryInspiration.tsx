import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Button, Typography, message, Spin, Tag, theme, Space, Progress, Result } from 'antd';
import { SendOutlined, ArrowLeftOutlined, ThunderboltOutlined, ReloadOutlined, CheckCircleOutlined, EditOutlined } from '@ant-design/icons';
import { shortInspirationApi, shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import type { ShortStory } from '../types';

const { Text, Title } = Typography;
const { TextArea } = Input;

type Phase = 'idea' | 'emotion_goal' | 'generating' | 'done';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [phase]);

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

  // 阶段2：选择情绪目标后，直接AI一键生成完整故事
  const handleSelectEmotion = async (emotion: string) => {
    setPhase('generating');
    setGenProgress(10);

    // 模拟进度推进（实际生成在后台进行）
    const progressTimer = setInterval(() => {
      setGenProgress((p) => {
        if (p >= 90) return p;
        return p + Math.random() * 8;
      });
    }, 1500);

    try {
      const story = await shortStoryApi.generateFull({
        initial_idea: initialIdea,
        emotion_goal: emotion,
        target_words: 12000,
        target_platform: '知乎盐言',
      });

      clearInterval(progressTimer);
      setGenProgress(100);
      setGeneratedStory(story);
      setPhase('done');
      message.success('短故事生成完成！');
    } catch (error) {
      clearInterval(progressTimer);
      showErrorToast(error, 'AI生成失败');
      setPhase('emotion_goal');
    }
  };

  const handleRestart = () => {
    setPhase('idea');
    setInput('');
    setInitialIdea('');
    setEmotionOptions([]);
    setGeneratedStory(null);
    setGenProgress(0);
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

  // 渲染生成中
  const renderGenerating = () => (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <Spin size="large" />
      <Title level={4} style={{ marginTop: 24, marginBottom: 8 }}>
        <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
        AI 正在创作短故事
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        正在按黄金结构生成完整故事（设定+全文），请稍候...
      </Text>
      <div style={{ maxWidth: 400, margin: '0 auto' }}>
        <Progress percent={Math.round(genProgress)} status="active" strokeColor={token.colorPrimary} />
      </div>
      <div style={{ marginTop: 24, textAlign: 'left', maxWidth: 400, margin: '24px auto 0' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {genProgress < 30 && '构思高概念选题...'}
          {genProgress >= 30 && genProgress < 60 && '设计核心反转与铺垫线索...'}
          {genProgress >= 60 && genProgress < 90 && '按黄金结构创作正文...'}
          {genProgress >= 90 && '精修润色...'}
        </Text>
      </div>
    </div>
  );

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
              {generatedStory.emotion_goal && <Tag color="orange">{generatedStory.emotion_goal}</Tag>}
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

            <div style={{ marginTop: 24, padding: 16, background: token.colorBgTextHover, borderRadius: 8 }}>
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
