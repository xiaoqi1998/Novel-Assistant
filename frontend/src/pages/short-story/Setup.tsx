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
  Modal,
  Tooltip,
  theme,
  Collapse,
} from 'antd';
import { SaveOutlined, PlusOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import useIsMobile from '../../utils/useIsMobile';
import {
  loadStorySetupDraft,
  saveStorySetupDraft,
  clearStorySetupDraft,
} from '../../utils/shortStoryDraft';
import EmotionCurveEditor from './EmotionCurve';
import KeyPoints from './KeyPoints';
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
  const { token } = theme.useToken();
  const { story } = useOutletContext<ContextType>();
  const { updateCurrentStory } = useShortStoryStore();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [characters, setCharacters] = useState<ShortStoryCharacter[]>([]);
  const [clues, setClues] = useState<string[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastDraftSaveTime, setLastDraftSaveTime] = useState<number | null>(null);
  const [generatingLogline, setGeneratingLogline] = useState(false);
  const [generatingTwist, setGeneratingTwist] = useState(false);
  const [generatingClues, setGeneratingClues] = useState(false);
  const [generatingChars, setGeneratingChars] = useState(false);
  const [autoCompleting, setAutoCompleting] = useState(false);
  const [loglineOptions, setLoglineOptions] = useState<string[]>([]);
  const [loglineModalOpen, setLoglineModalOpen] = useState(false);
  const [twistOptions, setTwistOptions] = useState<Array<{ twist_type: string; twist_content: string; clues: string[] }>>([]);
  const [twistModalOpen, setTwistModalOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const isMobile = useIsMobile();

  // 比较表单字段与服务器版本是否一致
  const isFormSameAsServer = (fields: Record<string, any>): boolean => {
    const serverFields: Record<string, any> = {
      title: story.title,
      logline: story.logline,
      genre: story.genre,
      target_platform: story.target_platform,
      target_words: story.target_words,
      emotion_goal: story.emotion_goal,
      emotion_goal_desc: story.emotion_goal_desc,
      twist_type: story.twist_type,
      twist_content: story.twist_content,
    };
    for (const key of Object.keys(serverFields)) {
      const sVal = serverFields[key] ?? '';
      const dVal = fields[key] ?? '';
      if (String(sVal) !== String(dVal)) return false;
    }
    return true;
  };

  // 比较角色/线索与服务器版本是否一致
  const isListSameAsServer = (
    list: any[],
    serverJson: string | null | undefined
  ): boolean => {
    let serverList: any[] = [];
    try {
      const parsed = serverJson ? JSON.parse(serverJson) : [];
      serverList = Array.isArray(parsed) ? parsed : [];
    } catch {
      serverList = [];
    }
    return JSON.stringify(list) === JSON.stringify(serverList);
  };

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

    // 检测未保存的本地设定草稿
    const draft = loadStorySetupDraft(story.id);
    if (draft) {
      const formSame = isFormSameAsServer(draft.fields);
      const draftChars = Array.isArray((draft.fields as any)?.characters)
        ? (draft.fields as any).characters
        : characters;
      const draftClues = Array.isArray((draft.fields as any)?.clues)
        ? (draft.fields as any).clues
        : clues;
      const charsSame = isListSameAsServer(draftChars, story.characters);
      const cluesSame = isListSameAsServer(draftClues, story.twist_clues);

      if (!formSame || !charsSame || !cluesSame) {
        const draftTime = new Date(draft.savedAt).toLocaleString('zh-CN');
        Modal.confirm({
          title: '检测到未保存的设定草稿',
          content: `是否恢复本地草稿？草稿保存时间：${draftTime}`,
          okText: '恢复草稿',
          cancelText: '使用服务器版本',
          centered: true,
          onOk: () => {
            const { characters: dChars, clues: dClues, ...formFields } = draft.fields as any;
            form.setFieldsValue(formFields);
            if (Array.isArray(dChars)) setCharacters(dChars);
            if (Array.isArray(dClues)) setClues(dClues);
            setLastDraftSaveTime(draft.savedAt);
            message.info('已恢复本地设定草稿');
          },
          onCancel: () => {
            clearStorySetupDraft(story.id);
            message.info('已丢弃草稿，使用服务器版本');
          },
        });
      } else {
        // 草稿与服务器一致，清理
        clearStorySetupDraft(story.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  const handleSave = async (showMessage = true) => {
    // 自动保存（showMessage=false）时校验失败静默跳过；手动保存时校验失败由 antd 在表单项下显示错误
    let values: Record<string, any>;
    try {
      values = await form.validateFields();
    } catch {
      // 校验未通过：手动保存时 antd 会自动展示字段错误；自动保存静默跳过
      return;
    }
    try {
      setSaving(true);
      const updateData = {
        ...values,
        characters: JSON.stringify(characters),
        twist_clues: JSON.stringify(clues),
      };
      const updated = await shortStoryApi.update(story.id, updateData);
      updateCurrentStory(updated);
      // 服务器保存成功后清除本地草稿
      clearStorySetupDraft(story.id);
      setLastDraftSaveTime(null);
      setLastSaved(new Date());
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

  // 草稿防抖保存（与API保存并行，网络失败时仍有本地备份）
  const scheduleDraftSave = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const values = form.getFieldsValue();
      saveStorySetupDraft(story.id, {
        ...values,
        characters: characters as any,
        clues: clues as any,
      });
      setLastDraftSaveTime(Date.now());
    }, 1000);
  };

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  const addCharacter = () => {
    setCharacters([...characters, { id: Date.now().toString() + Math.random().toString(36).slice(2, 8), name: '', role: 'protagonist', desc: '', relationship: '' }]);
    scheduleAutoSave();
    scheduleDraftSave();
  };

  const updateCharacter = (index: number, field: keyof ShortStoryCharacter, value: string) => {
    const newChars = [...characters];
    newChars[index] = { ...newChars[index], [field]: value };
    setCharacters(newChars);
    scheduleAutoSave();
    scheduleDraftSave();
  };

  const removeCharacter = (index: number) => {
    setCharacters(characters.filter((_, i) => i !== index));
    scheduleAutoSave();
    scheduleDraftSave();
  };

  const addClue = () => {
    setClues([...clues, '']);
    scheduleAutoSave();
    scheduleDraftSave();
  };

  const updateClue = (index: number, value: string) => {
    const newClues = [...clues];
    newClues[index] = value;
    setClues(newClues);
    scheduleAutoSave();
    scheduleDraftSave();
  };

  const removeClue = (index: number) => {
    setClues(clues.filter((_, i) => i !== index));
    scheduleAutoSave();
    scheduleDraftSave();
  };

  const handleGenerateLogline = async () => {
    if (!form.getFieldValue('title')) { message.warning('请先填写故事标题'); return; }
    if (!form.getFieldValue('emotion_goal')) { message.warning('请先选择情绪目标'); return; }
    if (!form.getFieldValue('genre')) { message.warning('请先选择题材标签'); return; }
    try {
      setGeneratingLogline(true);
      const values = form.getFieldsValue();
      const res = await shortStoryApi.generateLoglines(story.id, {
        title: values.title,
        emotion_goal: values.emotion_goal,
        genre: values.genre,
      });
      setLoglineOptions(res.options || []);
      setLoglineModalOpen(true);
    } catch (error) {
      showErrorToast(error, 'AI生成梗概失败');
    } finally {
      setGeneratingLogline(false);
    }
  };

  const handleGenerateTwist = async () => {
    if (!form.getFieldValue('title')) { message.warning('请先填写故事标题'); return; }
    try {
      setGeneratingTwist(true);
      const res = await shortStoryApi.generateTwists(story.id);
      setTwistOptions(res.options || []);
      setTwistModalOpen(true);
    } catch (error) {
      showErrorToast(error, 'AI设计反转失败');
    } finally {
      setGeneratingTwist(false);
    }
  };

  // Task 38.1: AI 生成线索
  const handleGenerateClues = async () => {
    if (!form.getFieldValue('title')) { message.warning('请先填写故事标题'); return; }
    try {
      setGeneratingClues(true);
      const values = form.getFieldsValue();
      const res = await shortStoryApi.generateClues(story.id, {
        title: values.title,
        logline: values.logline,
        genre: values.genre,
      });
      if (res.clues && res.clues.length > 0) {
        setClues(res.clues);
        scheduleAutoSave();
        scheduleDraftSave();
        message.success('已生成线索');
      } else {
        message.info('AI未返回线索，请稍后重试');
      }
    } catch (error: any) {
      if (error?.response?.status === 404) {
        message.info('AI生成线索功能即将上线');
      } else {
        showErrorToast(error, 'AI生成线索失败');
      }
    } finally {
      setGeneratingClues(false);
    }
  };

  // Task 38.2: AI 生成标签化人设
  const handleGenerateCharacters = async () => {
    if (!form.getFieldValue('title')) { message.warning('请先填写故事标题'); return; }
    try {
      setGeneratingChars(true);
      const values = form.getFieldsValue();
      const res = await shortStoryApi.generateCharacters(story.id, {
        title: values.title,
        logline: values.logline,
        genre: values.genre,
      });
      if (res.characters && res.characters.length > 0) {
        const newChars = res.characters.map((c) => ({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
          name: c.name || '',
          role: c.role || 'key',
          desc: c.desc || '',
          relationship: c.relationship || '',
        }));
        setCharacters([...characters, ...newChars]);
        scheduleAutoSave();
        scheduleDraftSave();
        message.success('已生成角色');
      } else {
        message.info('AI未返回角色，请稍后重试');
      }
    } catch (error: any) {
      if (error?.response?.status === 404) {
        message.info('AI生成角色功能即将上线');
      } else {
        showErrorToast(error, 'AI生成角色失败');
      }
    } finally {
      setGeneratingChars(false);
    }
  };

  // Task 38.3: 一键 AI 补全设定（基于最小输入）
  const handleAutoCompleteSetup = async () => {
    if (!form.getFieldValue('title')) { message.warning('请先填写故事标题'); return; }
    try {
      setAutoCompleting(true);
      const values = form.getFieldsValue();
      const res = await shortStoryApi.autoCompleteSetup(story.id, {
        title: values.title,
        genre: values.genre,
        emotion_goal: values.emotion_goal,
      });
      if (res.logline) form.setFieldsValue({ logline: res.logline });
      if (res.twist_type) form.setFieldsValue({ twist_type: res.twist_type });
      if (res.twist_content) form.setFieldsValue({ twist_content: res.twist_content });
      if (res.clues && res.clues.length > 0) setClues(res.clues);
      if (res.characters && res.characters.length > 0) {
        const newChars = res.characters.map((c) => ({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
          name: c.name || '',
          role: c.role || 'key',
          desc: c.desc || '',
          relationship: c.relationship || '',
        }));
        setCharacters(newChars);
      }
      scheduleAutoSave();
      scheduleDraftSave();
      message.success('AI已补全设定');
    } catch (error: any) {
      if (error?.response?.status === 404) {
        message.info('一键AI补全设定功能即将上线');
      } else {
        showErrorToast(error, 'AI补全设定失败');
      }
    } finally {
      setAutoCompleting(false);
    }
  };

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
        <Title level={4} style={{ margin: 0 }}>故事设定</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
          {lastDraftSaveTime && (
            <Tooltip title="本地草稿已自动保存，网络恢复后可手动点保存或刷新页面恢复">
              <Text type="warning" style={{ fontSize: 12 }}>
                📝 草稿已备份 {new Date(lastDraftSaveTime).toLocaleTimeString('zh-CN')}
              </Text>
            </Tooltip>
          )}
          <Button
            icon={<ThunderboltOutlined />}
            loading={autoCompleting}
            onClick={handleAutoCompleteSetup}
          >
            一键AI补全设定
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={() => handleSave(true)}
          >
            保存
          </Button>
          {lastSaved && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {saving ? '保存中...' : `已保存 ${lastSaved.toLocaleTimeString('zh-CN')}`}
            </Text>
          )}
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => {
          scheduleAutoSave();
          scheduleDraftSave();
        }}
      >
        <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="故事标题" rules={[{ required: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="logline"
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                一句话梗概
                <Button size="small" type="link" loading={generatingLogline} onClick={handleGenerateLogline} style={{ padding: 0 }}>
                  AI生成
                </Button>
              </span>
            }
            tooltip="主角+困境+反转+情绪落点"
          >
            <TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="emotion_goal" label="情绪目标">
            <Select options={EMOTION_GOALS.map((e) => ({ value: e, label: e }))} allowClear />
          </Form.Item>
          <Form.Item name="emotion_goal_desc" label="情绪描述">
            <TextArea rows={2} placeholder="描述希望读者读完后产生什么样的情绪反应" maxLength={500} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle" wrap>
            <Form.Item name="genre" label="题材标签" style={{ flex: 1, marginBottom: 0 }}>
              <Select options={GENRE_OPTIONS.map((g) => ({ value: g, label: g }))} allowClear />
            </Form.Item>
            <Form.Item name="target_words" label="目标字数" style={{ flex: 1, marginBottom: 0 }}>
              <InputNumber min={8000} max={20000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
        </Card>

        <Collapse
          size="small"
          style={{ marginBottom: 16 }}
          items={[{
            key: 'advanced',
            label: <span><Text strong>高级设定</Text> <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>平台 / 核心反转 / 人设速写</Text></span>,
            children: (
              <>
                <Form.Item name="target_platform" label="目标平台" style={{ marginBottom: 16 }}>
                  <Select options={TARGET_PLATFORMS.map((p) => ({ value: p, label: p }))} allowClear />
                </Form.Item>

                <Card
                  size="small"
                  style={{ marginBottom: 16 }}
                  title={
                    <span>
                      核心反转
                      <Tag color="red" style={{ marginLeft: 8 }}>爆点</Tag>
                    </span>
                  }
                >
                  <Form.Item name="twist_type" label="反转类型">
                    <Select options={TWIST_TYPES.map((t) => ({ value: t, label: t }))} allowClear />
                  </Form.Item>
                  <Form.Item
                    name="twist_content"
                    label={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        反转内容
                        <Button size="small" type="link" loading={generatingTwist} onClick={handleGenerateTwist} style={{ padding: 0 }}>
                          AI设计反转
                        </Button>
                      </span>
                    }
                    tooltip="亮出什么底牌？如何剥洋葱式揭露？"
                  >
                    <TextArea rows={3} maxLength={1000} showCount />
                  </Form.Item>

                  <Divider style={{ margin: '12px 0' }} />

                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Text strong>铺垫线索</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      至少3个，分布在铺垫和升级阶段
                    </Text>
                    <Button
                      size="small"
                      type="link"
                      loading={generatingClues}
                      onClick={handleGenerateClues}
                      style={{ padding: 0, marginLeft: 'auto' }}
                    >
                      AI生成线索
                    </Button>
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
                  size="small"
                  title={
                    <span>
                      人设速写
                      <Tag color="purple" style={{ marginLeft: 8 }}>标签化</Tag>
                    </span>
                  }
                  extra={
                    <Button
                      size="small"
                      type="link"
                      loading={generatingChars}
                      onClick={handleGenerateCharacters}
                      style={{ padding: 0 }}
                    >
                      AI生成角色
                    </Button>
                  }
                >
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                    短篇篇幅有限，人设高度标签化：清醒大女主、极致恶毒绿茶、软饭硬吃渣男、冷酷深情霸总。读者一眼认清阵营。
                  </Text>
                  {characters.map((char, index) => (
                    <Card
                      key={char.id || index}
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
                        <Form.Item label="姓名" style={{ marginBottom: isMobile ? 8 : 0, width: isMobile ? '100%' : 'auto' }}>
                          <Input
                            value={char.name}
                            onChange={(e) => updateCharacter(index, 'name', e.target.value)}
                            style={{ width: isMobile ? '100%' : 120 }}
                          />
                        </Form.Item>
                        <Form.Item label="定位" style={{ marginBottom: isMobile ? 8 : 0, width: isMobile ? '100%' : 'auto' }}>
                          <Select
                            value={char.role}
                            onChange={(v) => updateCharacter(index, 'role', v)}
                            style={{ width: isMobile ? '100%' : 120 }}
                            options={[
                              { value: 'protagonist', label: '主角' },
                              { value: 'key', label: '关键人物' },
                              { value: 'antagonist', label: '反派' },
                            ]}
                          />
                        </Form.Item>
                        <Form.Item label="关系" style={{ marginBottom: isMobile ? 8 : 0, width: isMobile ? '100%' : 'auto' }}>
                          <Input
                            value={char.relationship || ''}
                            onChange={(e) => updateCharacter(index, 'relationship', e.target.value)}
                            style={{ width: isMobile ? '100%' : 140 }}
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
              </>
            ),
          }]}
        />
      </Form>

      <Card
        title="情绪曲线"
        size="small"
        style={{ marginBottom: 16 }}
      >
        <EmotionCurveEditor story={story} embedded />
      </Card>

      <KeyPoints story={story} />

      <Modal
        title="AI生成梗概选项"
        open={loglineModalOpen}
        onCancel={() => setLoglineModalOpen(false)}
        footer={null}
        centered
        width={isMobile ? '92%' : 520}
      >
        {loglineOptions.map((opt, idx) => (
          <div
            key={idx}
            style={{
              padding: 12,
              marginBottom: 8,
              background: token.colorBgTextHover,
              borderRadius: 6,
              cursor: 'pointer',
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
            onClick={() => {
              form.setFieldsValue({ logline: opt });
              setLoglineModalOpen(false);
              scheduleAutoSave();
              scheduleDraftSave();
              message.success('已填入梗概');
            }}
          >
            <Text>{opt}</Text>
          </div>
        ))}
      </Modal>

      <Modal
        title="AI设计反转选项"
        open={twistModalOpen}
        onCancel={() => setTwistModalOpen(false)}
        footer={null}
        centered
        width={isMobile ? '92%' : 520}
      >
        {twistOptions.map((opt, idx) => (
          <div
            key={idx}
            style={{
              padding: 12,
              marginBottom: 8,
              background: token.colorBgTextHover,
              borderRadius: 6,
              cursor: 'pointer',
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
            onClick={() => {
              form.setFieldsValue({ twist_type: opt.twist_type, twist_content: opt.twist_content });
              setClues(opt.clues || []);
              setTwistModalOpen(false);
              scheduleAutoSave();
              scheduleDraftSave();
              message.success('已填入反转设计');
            }}
          >
            <div>
              <Tag color="red">{opt.twist_type}</Tag>
            </div>
            <div style={{ marginTop: 6 }}>
              <Text>{opt.twist_content}</Text>
            </div>
            {opt.clues && opt.clues.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>铺垫线索：</Text>
                {opt.clues.map((c, i) => (
                  <Tag key={i} color="blue" style={{ marginBottom: 4 }}>{c}</Tag>
                ))}
              </div>
            )}
          </div>
        ))}
      </Modal>
    </div>
  );
}
