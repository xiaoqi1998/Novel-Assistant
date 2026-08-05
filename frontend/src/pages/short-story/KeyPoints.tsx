import { useEffect, useRef, useState } from 'react';
import {
  Card,
  Input,
  Select,
  Button,
  Typography,
  Divider,
  message,
  Space,
  Tag,
  Checkbox,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import type {
  ShortStory,
  BeatDesign,
  DualLine,
  CharacterProfile,
  ShortStoryCharacter,
} from '../../types';

const { Text } = Typography;
const { TextArea } = Input;

const REVERSAL_GRADES = [
  { value: 'S', label: 'S · 认知反转', desc: '读者重新理解前文，改变情感判断，留下情绪' },
  { value: 'A', label: 'A · 身份/关系反转', desc: '角色真实身份/关系与认知错位' },
  { value: 'B', label: 'B · 事件真相反转', desc: '事件因果/动机真相被推翻，慎用' },
  { value: 'C', label: 'C · 单纯信息揭露', desc: '只揭信息不改情感判断，慎用' },
];

const PAYOFF_OPTIONS = [
  '翻盘',
  '恶人付出代价',
  '误会解除',
  '真相曝光',
  '遗憾无法挽回',
  '治愈重来',
];

interface KeyPointsProps {
  story: ShortStory;
}

export default function KeyPoints({ story }: KeyPointsProps) {
  const { updateCurrentStory } = useShortStoryStore();

  const [reversalGrade, setReversalGrade] = useState<string>('');
  const [beat, setBeat] = useState<BeatDesign>({});
  const [payoffs, setPayoffs] = useState<string[]>([]);
  const [dualLine, setDualLine] = useState<DualLine>({});
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [characters, setCharacters] = useState<ShortStoryCharacter[]>([]);

  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // 初始化：从 story 解析各字段
  useEffect(() => {
    setReversalGrade(story.reversal_grade || '');
    try {
      const b = story.beat_design ? JSON.parse(story.beat_design) : {};
      setBeat(typeof b === 'object' && b !== null ? b : {});
    } catch {
      setBeat({});
    }
    try {
      const p = story.emotional_payoff ? JSON.parse(story.emotional_payoff) : [];
      setPayoffs(Array.isArray(p) ? p : []);
    } catch {
      setPayoffs([]);
    }
    try {
      const d = story.dual_line ? JSON.parse(story.dual_line) : {};
      const j = Array.isArray(d.junction_nodes) ? d.junction_nodes : [];
      setDualLine({
        surface_line: d.surface_line || '',
        inner_line: d.inner_line || '',
        junction_nodes: j.length ? j : [''],
        reveal_point: d.reveal_point || '',
      });
    } catch {
      setDualLine({ surface_line: '', inner_line: '', junction_nodes: [''], reveal_point: '' });
    }
    try {
      const pr = story.character_profile ? JSON.parse(story.character_profile) : [];
      setProfiles(Array.isArray(pr) ? pr : []);
    } catch {
      setProfiles([]);
    }
    try {
      const ch = story.characters ? JSON.parse(story.characters) : [];
      setCharacters(Array.isArray(ch) ? ch : []);
    } catch {
      setCharacters([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  // 防抖保存
  const scheduleSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(false), 1500);
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const updateData = {
        reversal_grade: reversalGrade || undefined,
        beat_design: JSON.stringify(beat),
        emotional_payoff: JSON.stringify(payoffs),
        dual_line: JSON.stringify({
          ...dualLine,
          junction_nodes: (dualLine.junction_nodes || []).filter((j) => j.trim()),
        }),
        character_profile: JSON.stringify(profiles),
      };
      const updated = await shortStoryApi.update(story.id, updateData);
      updateCurrentStory(updated);
      setLastSaved(new Date());
      if (showMessage) message.success('关键点已保存');
    } catch (error) {
      showErrorToast(error, '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateBeat = (field: keyof BeatDesign, value: string) => {
    setBeat({ ...beat, [field]: value });
    scheduleSave();
  };

  const updateNode = (index: number, value: string) => {
    const nodes = [...(dualLine.junction_nodes || [])];
    nodes[index] = value;
    setDualLine({ ...dualLine, junction_nodes: nodes });
    scheduleSave();
  };

  const addNode = () => {
    setDualLine({ ...dualLine, junction_nodes: [...(dualLine.junction_nodes || []), ''] });
    scheduleSave();
  };

  const removeNode = (index: number) => {
    const nodes = [...(dualLine.junction_nodes || [])];
    nodes.splice(index, 1);
    setDualLine({ ...dualLine, junction_nodes: nodes.length ? nodes : [''] });
    scheduleSave();
  };

  const updateProfile = (index: number, field: keyof CharacterProfile, value: string) => {
    const newProfiles = [...profiles];
    newProfiles[index] = { ...newProfiles[index], [field]: value };
    setProfiles(newProfiles);
    scheduleSave();
  };

  const addProfile = () => {
    setProfiles([...profiles, { name: '', surface_goal: '', inner_need: '', fear: '', secret: '', motive: '', self_justification: '' }]);
    scheduleSave();
  };

  const removeProfile = (index: number) => {
    setProfiles(profiles.filter((_, i) => i !== index));
    scheduleSave();
  };

  // 角色显示名（有 profile 名称用 profile 的，否则用 characters 里同名角色的名字）
  const profileName = (p: CharacterProfile, i: number) => p.name || characters[i]?.name || `角色 ${i + 1}`;

  return (
    <Card
      title={
        <span>
          爆款关键点
          <Tag color="volcano" style={{ marginLeft: 8 }}>story-short-write</Tag>
        </span>
      }
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={() => handleSave(true)}
          >
            保存关键点
          </Button>
          {lastSaved && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {saving ? '保存中...' : `已保存 ${lastSaved.toLocaleTimeString('zh-CN')}`}
            </Text>
          )}
        </Space>
      }
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        反转等级、爆点设计、情绪收益点、双线叙事、人物四要素 —— 由 story-short-write 方法论驱动的短篇爆款关键设定，编辑后自动保存。
      </Text>

      {/* 反转等级 */}
      <Divider orientation="left" plain style={{ marginTop: 0 }}>
        <Text strong>反转等级</Text>
      </Divider>
      <Select
        value={reversalGrade || undefined}
        placeholder="选择反转等级（优先 S/A，C 级可放弃反转改靠情绪收尾）"
        onChange={(v) => { setReversalGrade(v || ''); scheduleSave(); }}
        options={REVERSAL_GRADES}
        allowClear
        style={{ width: '100%', maxWidth: 420 }}
      />
      {reversalGrade && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {REVERSAL_GRADES.find((g) => g.value === reversalGrade)?.desc}
        </Text>
      )}

      {/* 爆点设计 */}
      <Divider orientation="left" plain>
        <Text strong>爆点设计</Text>
      </Divider>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {([
          ['max_thrill_point', '最大爽点', '读者最想看到"翻盘/打脸/恶人付出代价/真相曝光"的瞬间'],
          ['max_tearjerker_point', '最大虐点', '读者最容易心疼/意难平/想评论的瞬间'],
          ['max_shock_point', '最大震撼点', 'S/A级反转揭晓或身份曝光，令人回看前文'],
          ['max_viral_line', '最大传播句', '一句话截图金句，可复用于标题或结尾'],
        ] as Array<[keyof BeatDesign, string, string]>).map(([key, label, ph]) => (
          <div key={key}>
            <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>{label}</Text>
            <TextArea
              value={beat[key] || ''}
              onChange={(e) => updateBeat(key, e.target.value)}
              rows={1}
              autoSize
              placeholder={ph}
            />
          </div>
        ))}
      </Space>

      {/* 情绪收益点 */}
      <Divider orientation="left" plain>
        <Text strong>情绪收益点</Text>
      </Divider>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        给读者可兑现的收益，保证"虐"后有"爆"的出口。
      </Text>
      <Checkbox.Group
        value={payoffs}
        onChange={(vals) => { setPayoffs(vals as string[]); scheduleSave(); }}
        options={PAYOFF_OPTIONS}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
      />

      {/* 双线叙事 */}
      <Divider orientation="left" plain>
        <Text strong>双线叙事</Text>
      </Divider>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
            表线 <Text type="secondary" style={{ fontWeight: 'normal' }}>（读者以为的故事）</Text>
          </Text>
          <TextArea
            value={dualLine.surface_line || ''}
            onChange={(e) => { setDualLine({ ...dualLine, surface_line: e.target.value }); scheduleSave(); }}
            rows={2}
            placeholder="主角在遭受什么痛点？反派/对立面表面在做什么？读者顺此得出什么错误结论？"
          />
        </div>
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
            里线 <Text type="secondary" style={{ fontWeight: 'normal' }}>（真实发生的故事）</Text>
          </Text>
          <TextArea
            value={dualLine.inner_line || ''}
            onChange={(e) => { setDualLine({ ...dualLine, inner_line: e.target.value }); scheduleSave(); }}
            rows={2}
            placeholder="真相是什么？反派/主角真正的动机是什么？读者为何被骗？"
          />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text strong style={{ fontSize: 13 }}>交汇节点 <Text type="secondary" style={{ fontWeight: 'normal' }}>（埋伏笔处，至少3个）</Text></Text>
            <Button size="small" type="link" icon={<PlusOutlined />} onClick={addNode} style={{ padding: 0, marginLeft: 'auto' }}>
              添加
            </Button>
          </div>
          {(dualLine.junction_nodes || []).map((node, index) => (
            <Space key={index} style={{ width: '100%', marginBottom: 6 }} align="start">
              <Tag color="geekblue" style={{ marginTop: 4 }}>节点{index + 1}</Tag>
              <TextArea
                value={node}
                onChange={(e) => updateNode(index, e.target.value)}
                rows={1}
                autoSize
                style={{ flex: 1 }}
                placeholder="表线看似 A，里线其实是 B —— 如何埋？"
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => removeNode(index)}
              />
            </Space>
          ))}
        </div>
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>反转揭晓点</Text>
          <TextArea
            value={dualLine.reveal_point || ''}
            onChange={(e) => { setDualLine({ ...dualLine, reveal_point: e.target.value }); scheduleSave(); }}
            rows={1}
            autoSize
            placeholder="在哪个节点引爆里线，让读者回看交汇点恍然大悟"
          />
        </div>
      </Space>

      {/* 人物四要素 */}
      <Divider orientation="left" plain>
        <Text strong>人物四要素</Text>
      </Divider>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        为关键角色补充欲望、恐惧与秘密，避免"为反转而存在的人"。
      </Text>
      {profiles.map((p, index) => {
        const isVillain = characters.find((c) => c.name === (p.name || characters[index]?.name))?.role === 'antagonist';
        return (
          <Card
            key={index}
            size="small"
            style={{ marginBottom: 8 }}
            title={profileName(p, index)}
            extra={
              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeProfile(index)} />
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Input
                value={p.name || ''}
                onChange={(e) => updateProfile(index, 'name', e.target.value)}
                placeholder="角色名（与上方人设速写对应）"
              />
              {([
                ['surface_goal', '表面目标', '想做成的事'],
                ['inner_need', '内心真正需求', '真正渴望却说不出口的东西'],
                ['fear', '最大恐惧', '最怕发生的事'],
                ['secret', '最不愿承认的秘密', '藏得最深的点'],
              ] as Array<[keyof CharacterProfile, string, string]>).map(([key, label, ph]) => (
                <div key={key}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>{label}</Text>
                  <TextArea value={p[key] || ''} onChange={(e) => updateProfile(index, key, e.target.value)} rows={1} autoSize placeholder={ph} />
                </div>
              ))}
              {isVillain && (
                <>
                  <Divider style={{ margin: '4px 0' }} />
                  {([
                    ['motive', '合理动机', '他这么做的原因'],
                    ['self_justification', '他认为自己正确的地方', '他眼中的正义'],
                  ] as Array<[keyof CharacterProfile, string, string]>).map(([key, label, ph]) => (
                    <div key={key}>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>{label}</Text>
                      <TextArea value={p[key] || ''} onChange={(e) => updateProfile(index, key, e.target.value)} rows={1} autoSize placeholder={ph} />
                    </div>
                  ))}
                </>
              )}
            </Space>
          </Card>
        );
      })}
      <Button type="dashed" icon={<PlusOutlined />} onClick={addProfile} block>
        添加角色四要素
      </Button>
    </Card>
  );
}
