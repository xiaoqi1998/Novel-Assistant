import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Card,
  Input,
  Button,
  Select,
  InputNumber,
  message,
  Typography,
  Alert,
  Spin,
  Progress,
  theme,
} from 'antd';
import { ArrowLeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { eventBus } from '../store/eventBus';
import { showErrorToast } from '../utils/errorHandler';

const { Title, Text } = Typography;
const { TextArea } = Input;

const EMOTION_GOALS = [
  { value: '爽感释放', label: '爽感释放 - 打脸复仇、绝地反击', heat: '🔥🔥🔥🔥🔥' },
  { value: '反转震撼', label: '反转震撼 - 身份/视角/动机反转', heat: '🔥🔥🔥🔥🔥' },
  { value: '意难平', label: '意难平 - 迟来的深情、双向错过', heat: '🔥🔥🔥🔥' },
  { value: '细思极恐', label: '细思极恐 - 规则怪谈、死后反转', heat: '🔥🔥🔥🔥' },
  { value: '治愈温暖', label: '治愈温暖 - 双向奔赴、细水长流', heat: '🔥🔥🔥' },
  { value: '共鸣感动', label: '共鸣感动 - 亲情、世情、成长', heat: '🔥🔥🔥' },
];

const TARGET_PLATFORMS = [
  { value: '知乎盐言', label: '知乎盐言故事' },
  { value: '番茄短篇', label: '番茄短篇' },
  { value: '七猫短篇', label: '七猫短篇' },
  { value: '黑岩', label: '黑岩阅读' },
  { value: '点众', label: '点众文学' },
];

type Phase = 'input' | 'generating';

export default function ShortStoryWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const presetFromUrl = new URLSearchParams(location.search);
  const initialTitle = presetFromUrl.get('title') || '';

  const [phase, setPhase] = useState<Phase>('input');
  const [form, setForm] = useState({
    initial_idea: initialTitle,
    emotion_goal: '爽感释放',
    target_platform: '知乎盐言',
    target_words: 12000,
  });
  const [genProgress, setGenProgress] = useState(0);
  const [genMessage, setGenMessage] = useState('正在准备生成...');

  const handleGenerate = async () => {
    if (!form.initial_idea.trim()) {
      message.warning('请输入你的故事想法');
      return;
    }

    setPhase('generating');
    setGenProgress(10);
    setGenMessage('正在创建后台生成任务...');

    // 改用后台任务：创建后立即跳转书架，AI 在后台运行，切页面/关浏览器不影响
    // 进度通过右下角 FloatingTaskPanel 查看，完成后书架出现新书，点击浮窗进入新故事
    try {
      await shortStoryApi.generateFullBackground({
        initial_idea: form.initial_idea.trim(),
        emotion_goal: form.emotion_goal,
        target_words: form.target_words,
        target_platform: form.target_platform,
      });
      // 通知 FloatingTaskPanel 立即刷新
      eventBus.emit('background-task-created');
      setGenProgress(100);
      setGenMessage('后台任务已创建，正在跳转书架...');
      message.success('已创建后台生成任务，可在书架查看进度，完成后点击右下角浮窗进入新故事');
      // 跳转书架，由 FloatingTaskPanel 显示进度
      setTimeout(() => {
        navigate('/');
      }, 1200);
    } catch (error: any) {
      showErrorToast(error, '创建后台生成任务失败');
      setPhase('input');
    }
  };

  // 返回输入页（后台任务创建很快，正常情况下不会用到此按钮）
  const handleCancelGenerate = () => {
    setPhase('input');
    setGenProgress(0);
    setGenMessage('正在准备生成...');
    message.info('已取消');
  };

  if (phase === 'generating') {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <Spin size="large" tip="AI正在创作中..." />
        <Title level={3} style={{ marginTop: 24, marginBottom: 8 }}>
          <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
          AI 正在创作短故事
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
          {genMessage || '正在按黄金结构生成完整故事（设定+全文），请稍候...'}
        </Text>
        <div style={{ maxWidth: 400, margin: '0 auto' }}>
          <Progress percent={Math.round(genProgress)} status="active" strokeColor={token.colorPrimary} />
        </div>
        <div style={{ marginTop: 24 }}>
          <Button danger onClick={handleCancelGenerate} icon={<ArrowLeftOutlined />}>
            取消生成
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px' }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/')}
        style={{ marginBottom: 16 }}
      >
        返回书架
      </Button>

      <Card>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <ThunderboltOutlined style={{ fontSize: 40, color: token.colorPrimary, marginBottom: 12 }} />
          <Title level={3} style={{ margin: 0 }}>
            AI 生成短故事
          </Title>
          <Text type="secondary">
            输入想法，AI一键生成完整故事（设定+全文）
          </Text>
        </div>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
          message="爆款选题公式"
          description={
            <div style={{ fontSize: 13 }}>
              <Text strong>极致反差/道德伦理冲突 + 强身份标签 + 迫切的危机悬念</Text>
              <br />
              <Text type="secondary">
                三大黄金赛道：打脸复仇类、悬疑怪谈类、极致痛感类
              </Text>
            </div>
          }
        />

        <div style={{ marginBottom: 20 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            故事想法 <Text type="danger">*</Text>
          </Text>
          <TextArea
            value={form.initial_idea}
            onChange={(e) => setForm({ ...form, initial_idea: e.target.value })}
            placeholder="例：结婚当天，老公把前女友带上了主桌&#10;例：假千金归来复仇&#10;例：一个关于背叛和绝地反击的故事"
            autoSize={{ minRows: 4, maxRows: 8 }}
            style={{ fontSize: 15 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div style={{ flex: '1 1 200px' }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>情绪目标</Text>
            <Select
              value={form.emotion_goal}
              onChange={(v) => setForm({ ...form, emotion_goal: v })}
              style={{ width: '100%' }}
              options={EMOTION_GOALS.map((e) => ({
                value: e.value,
                label: (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{e.label}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>{e.heat}</Text>
                  </div>
                ),
              }))}
            />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>目标平台</Text>
            <Select
              value={form.target_platform}
              onChange={(v) => setForm({ ...form, target_platform: v })}
              style={{ width: '100%' }}
              options={TARGET_PLATFORMS}
            />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>目标字数</Text>
            <InputNumber
              min={8000}
              max={20000}
              step={1000}
              value={form.target_words}
              onChange={(v) => setForm({ ...form, target_words: v || 12000 })}
              style={{ width: '100%' }}
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={(value) => (value ? Number(value.replace(/[^\d]/g, '')) : 0)}
            />
          </div>
        </div>

        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          onClick={handleGenerate}
          block
        >
          AI 一键生成完整短故事
        </Button>

        <div style={{ marginTop: 16, padding: 12, background: token.colorBgTextHover, borderRadius: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            AI 将自动完成：高概念选题 → 核心反转设计 → 黄金结构正文创作 → 写入数据库
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            生成完成后可直接进入工作区查看/编辑正文，也可重新生成某段或AI精修。
          </Text>
        </div>
      </Card>
    </div>
  );
}
