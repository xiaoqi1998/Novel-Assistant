import { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Typography,
  Divider,
  message,
  Space,
  Tag,
} from 'antd';
import { SaveOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import type { ShortStory, ShortStoryCharacter } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

const EMOTION_GOALS = [
  '意难平', '反转震撼', '爽感释放', '治愈温暖', '细思极恐', '共鸣感动',
];

const TWIST_TYPES = [
  '身份反转', '视角反转', '动机反转', '时间线反转',
];

const TARGET_PLATFORMS = ['知乎盐言', '番茄短篇', '七猫短篇', '黑岩', '点众'];

const GENRE_OPTIONS = [
  '追妻', '重生复仇', '死人文学', '小三', '世情', '仙侠',
  '霸总', '职场', '校园', '悬疑', '怪谈', '科幻',
];

interface ContextType {
  story: ShortStory;
  reload: () => Promise<void>;
}

export default function Setup() {
  const { story } = useOutletContext<ContextType>();
  const { updateCurrentStory } = useShortStoryStore();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [characters, setCharacters] = useState<ShortStoryCharacter[]>([]);
  const [clues, setClues] = useState<string[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const parsedChars = story.characters ? JSON.parse(story.characters) : [];
      setCharacters(Array.isArray(parsedChars) ? parsedChars : []);
    } catch {
      setCharacters([]);
    }
    try {
      const parsedClues = story.twist_clues ? JSON.parse(story.twist_clues) : [];
      setClues(Array.isArray(parsedClues) ? parsedClues : []);
    } catch {
      setClues([]);
    }
    form.setFieldsValue({
      title: story.title,
      logline: story.logline,
      genre: story.genre,
      target_platform: story.target_platform,
      target_words: story.target_words,
      emotion_goal: story.emotion_goal,
      emotion_goal_desc: story.emotion_goal_desc,
      twist_type: story.twist_type,
      twist_content: story.twist_content,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const values = form.getFieldsValue();
      const updateData = {
        ...values,
        characters: JSON.stringify(characters),
        twist_clues: JSON.stringify(clues),
      };
      const updated = await shortStoryApi.update(story.id, updateData);
      updateCurrentStory(updated);
      if (showMessage) message.success('已保存');
    } catch (error) {
      showErrorToast(error, '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 自动保存（防抖）
  const scheduleAutoSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(false), 1500);
  };

  const addCharacter = () => {
    setCharacters([...characters, { name: '', role: 'protagonist', desc: '', relationship: '' }]);
    scheduleAutoSave();
  };

  const updateCharacter = (index: number, field: keyof ShortStoryCharacter, value: string) => {
    const newChars = [...characters];
    newChars[index] = { ...newChars[index], [field]: value };
    setCharacters(newChars);
    scheduleAutoSave();
  };

  const removeCharacter = (index: number) => {
    setCharacters(characters.filter((_, i) => i !== index));
    scheduleAutoSave();
  };

  const addClue = () => {
    setClues([...clues, '']);
    scheduleAutoSave();
  };

  const updateClue = (index: number, value: string) => {
    const newClues = [...clues];
    newClues[index] = value;
    setClues(newClues);
    scheduleAutoSave();
  };

  const removeClue = (index: number) => {
    setClues(clues.filter((_, i) => i !== index));
    scheduleAutoSave();
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>故事设定</Title>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={() => handleSave(true)}
        >
          保存
        </Button>
      </div>

      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => scheduleAutoSave()}
      >
        <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="故事标题" rules={[{ required: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="logline" label="一句话梗概" tooltip="主角+困境+反转+情绪落点">
            <TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="genre" label="题材标签" style={{ flex: 1, marginBottom: 0 }}>
              <Select options={GENRE_OPTIONS.map((g) => ({ value: g, label: g }))} allowClear />
            </Form.Item>
            <Form.Item name="target_platform" label="目标平台" style={{ flex: 1, marginBottom: 0 }}>
              <Select options={TARGET_PLATFORMS.map((p) => ({ value: p, label: p }))} allowClear />
            </Form.Item>
            <Form.Item name="target_words" label="目标字数" style={{ flex: 1, marginBottom: 0 }}>
              <InputNumber min={8000} max={20000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
        </Card>

        <Card
          title={
            <span>
              情绪目标
              <Tag color="orange" style={{ marginLeft: 8 }}>核心</Tag>
            </span>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="emotion_goal" label="情绪类型">
            <Select options={EMOTION_GOALS.map((e) => ({ value: e, label: e }))} allowClear />
          </Form.Item>
          <Form.Item name="emotion_goal_desc" label="情绪描述">
            <TextArea rows={2} placeholder="描述希望读者读完后产生什么样的情绪反应" maxLength={500} />
          </Form.Item>
        </Card>

        <Card
          title={
            <span>
              核心反转
              <Tag color="red" style={{ marginLeft: 8 }}>爆点</Tag>
            </span>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="twist_type" label="反转类型">
            <Select options={TWIST_TYPES.map((t) => ({ value: t, label: t }))} allowClear />
          </Form.Item>
          <Form.Item name="twist_content" label="反转内容" tooltip="亮出什么底牌？如何剥洋葱式揭露？">
            <TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>

          <Divider style={{ margin: '12px 0' }} />

          <div style={{ marginBottom: 8 }}>
            <Text strong>铺垫线索</Text>
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              至少3个，分布在铺垫和升级阶段
            </Text>
          </div>
          {clues.map((clue, index) => (
            <Space key={index} style={{ width: '100%', marginBottom: 8 }} align="start">
              <Tag color="blue" style={{ marginTop: 4 }}>线索{index + 1}</Tag>
              <TextArea
                value={clue}
                onChange={(e) => updateClue(index, e.target.value)}
                rows={1}
                style={{ flex: 1 }}
                placeholder={`第${index + 1}个铺垫线索...`}
                autoSize
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeClue(index)}
              />
            </Space>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={addClue} block>
            添加铺垫线索
          </Button>
        </Card>

        <Card
          title={
            <span>
              人设速写
              <Tag color="purple" style={{ marginLeft: 8 }}>标签化</Tag>
            </span>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            短篇篇幅有限，人设高度标签化：清醒大女主、极致恶毒绿茶、软饭硬吃渣男、冷酷深情霸总。读者一眼认清阵营。
          </Text>
          {characters.map((char, index) => (
            <Card
              key={index}
              size="small"
              style={{ marginBottom: 8 }}
              extra={
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeCharacter(index)}
                />
              }
              title={`角色 ${index + 1}`}
            >
              <Space style={{ width: '100%' }} size="middle" wrap>
                <Form.Item label="姓名" style={{ marginBottom: 0 }}>
                  <Input
                    value={char.name}
                    onChange={(e) => updateCharacter(index, 'name', e.target.value)}
                    style={{ width: 120 }}
                  />
                </Form.Item>
                <Form.Item label="定位" style={{ marginBottom: 0 }}>
                  <Select
                    value={char.role}
                    onChange={(v) => updateCharacter(index, 'role', v)}
                    style={{ width: 120 }}
                    options={[
                      { value: 'protagonist', label: '主角' },
                      { value: 'key', label: '关键人物' },
                    ]}
                  />
                </Form.Item>
                <Form.Item label="关系" style={{ marginBottom: 0 }}>
                  <Input
                    value={char.relationship || ''}
                    onChange={(e) => updateCharacter(index, 'relationship', e.target.value)}
                    style={{ width: 140 }}
                    placeholder="与主角的关系"
                  />
                </Form.Item>
              </Space>
              <Form.Item label="描述" style={{ marginTop: 8, marginBottom: 0 }}>
                <TextArea
                  value={char.desc}
                  onChange={(e) => updateCharacter(index, 'desc', e.target.value)}
                  rows={2}
                  placeholder="标签化人设描述，例：极致恶毒绿茶，表面温柔实则心机深沉"
                />
              </Form.Item>
            </Card>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={addCharacter} block>
            添加角色
          </Button>
        </Card>
      </Form>
    </div>
  );
}
