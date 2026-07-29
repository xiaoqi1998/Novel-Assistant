import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Card,
  Form,
  Input,
  Button,
  Select,
  InputNumber,
  message,
  Typography,
  Divider,
  Alert,
  Spin,
  theme,
} from 'antd';
import { ArrowLeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';

const { Title, Text } = Typography;
const { TextArea } = Input;

const EMOTION_GOALS = [
  { value: '意难平', label: '意难平 - 迟来的深情、双向错过', heat: '🔥🔥🔥🔥' },
  { value: '反转震撼', label: '反转震撼 - 身份/视角/动机反转', heat: '🔥🔥🔥🔥🔥' },
  { value: '爽感释放', label: '爽感释放 - 打脸复仇、绝地反击', heat: '🔥🔥🔥🔥🔥' },
  { value: '治愈温暖', label: '治愈温暖 - 双向奔赴、细水长流', heat: '🔥🔥🔥' },
  { value: '细思极恐', label: '细思极恐 - 规则怪谈、死后反转', heat: '🔥🔥🔥🔥' },
  { value: '共鸣感动', label: '共鸣感动 - 亲情、世情、成长', heat: '🔥🔥🔥' },
];

const TWIST_TYPES = [
  { value: '身份反转', label: '身份反转 - 我是我，我也不是我' },
  { value: '视角反转', label: '视角反转 - 叙述者其实是反派' },
  { value: '动机反转', label: '动机反转 - 好人变坏、坏人变好' },
  { value: '时间线反转', label: '时间线反转 - 过去现在未来错位' },
];

const TARGET_PLATFORMS = [
  { value: '知乎盐言', label: '知乎盐言故事' },
  { value: '番茄短篇', label: '番茄短篇' },
  { value: '七猫短篇', label: '七猫短篇' },
  { value: '黑岩', label: '黑岩阅读' },
  { value: '点众', label: '点众文学' },
];

const GENRE_OPTIONS = [
  '追妻', '重生复仇', '死人文学', '小三', '世情', '仙侠',
  '霸总', '职场', '校园', '悬疑', '怪谈', '科幻',
];

interface WizardState {
  title?: string;
  logline?: string;
  genre?: string;
  emotion_goal?: string;
  twist_type?: string;
  target_platform?: string;
}

export default function ShortStoryWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 从灵感模式或 ProjectWizardNew 跳转携带的预填数据
  const presetState = (location.state as WizardState | null) || {};
  const presetFromUrl = new URLSearchParams(location.search);
  const initialTitle = presetState.title || presetFromUrl.get('title') || '';

  const onFinish = async (values: any) => {
    try {
      setSubmitting(true);
      const result = await shortStoryApi.create({
        title: values.title,
        logline: values.logline,
        genre: values.genre,
        target_platform: values.target_platform,
        target_words: values.target_words,
        emotion_goal: values.emotion_goal,
        twist_type: values.twist_type,
        twist_content: values.twist_content,
      });
      message.success('短故事创建成功');
      navigate(`/short-story/${result.id}/setup`);
    } catch (error) {
      showErrorToast(error, '创建短故事失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
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
            创建短故事
          </Title>
          <Text type="secondary">
            高概念选题 · 情绪驱动 · 8000-20000字单文档
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
                三大黄金赛道：打脸复仇类（抓奸反击/假千金归来/绿茶背叛）、悬疑怪谈类（规则怪谈/死后反转）、极致痛感类（追悔莫及/绝症误会/双向错过）
              </Text>
            </div>
          }
        />

        <Spin spinning={submitting} tip="创建中...">
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            initialValues={{
              title: initialTitle,
              target_words: 12000,
              target_platform: '知乎盐言',
              ...presetState,
            }}
          >
            <Form.Item
              name="title"
              label="故事标题"
              rules={[{ required: true, message: '请输入故事标题' }]}
            >
              <Input placeholder="例：结婚当天，老公把前女友带上了主桌" maxLength={200} />
            </Form.Item>

            <Form.Item
              name="logline"
              label="一句话梗概"
              tooltip="主角+困境+反转+情绪落点，必须一句话说清爆点"
            >
              <TextArea
                rows={2}
                placeholder="例：被丈夫和闺蜜联手陷害的我，在绝症确诊当天意外获得了重生的机会"
                maxLength={500}
                showCount
              />
            </Form.Item>

            <Form.Item name="emotion_goal" label="情绪目标">
              <Select
                placeholder="选择核心情绪"
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
            </Form.Item>

            <Form.Item name="twist_type" label="反转类型">
              <Select
                placeholder="选择核心反转类型"
                options={TWIST_TYPES}
                allowClear
              />
            </Form.Item>

            <Form.Item
              name="twist_content"
              label="反转内容"
              tooltip="核心反转设计：亮出什么底牌？如何剥洋葱式揭露？"
            >
              <TextArea
                rows={2}
                placeholder="例：主角其实是真正的千金，而绿茶闺蜜才是冒牌货，最终身份揭露让所有人震惊"
                maxLength={500}
              />
            </Form.Item>

            <Form.Item name="genre" label="题材标签">
              <Select
                placeholder="选择题材赛道"
                options={GENRE_OPTIONS.map((g) => ({ value: g, label: g }))}
                allowClear
              />
            </Form.Item>

            <Form.Item name="target_platform" label="目标平台">
              <Select options={TARGET_PLATFORMS} />
            </Form.Item>

            <Form.Item
              name="target_words"
              label="目标字数"
              rules={[{ required: true, message: '请输入目标字数' }]}
            >
              <InputNumber
                min={8000}
                max={20000}
                step={1000}
                style={{ width: '100%' }}
                formatter={(value) => `${value} 字`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(value) => Number(value?.replace(/[^\d]/g, '')) as unknown as 8000}
              />
            </Form.Item>

            <Divider />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <Button onClick={() => navigate('/')}>取消</Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                icon={<ThunderboltOutlined />}
              >
                创建并开始创作
              </Button>
            </div>
          </Form>
        </Spin>
      </Card>
    </div>
  );
}
