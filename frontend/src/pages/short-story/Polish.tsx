import { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Card,
  Typography,
  Input,
  Button,
  message,
  Checkbox,
  Tag,
  Alert,
  Empty,
  Progress,
  theme,
} from 'antd';
import { SaveOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../../services/api';
import { showErrorToast } from '../../utils/errorHandler';
import { useShortStoryStore } from '../../store/shortStoryStore';
import type { ShortStory, PolishChecklistItem } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

const CATEGORY_COLOR: Record<string, string> = {
  '开头查验': 'blue',
  '废话查验': 'orange',
  '卡点查验': 'gold',
  '去AI味查验': 'red',
  '情绪曲线': 'purple',
  '人设查验': 'magenta',
  '对话查验': 'cyan',
  '选题查验': 'green',
};

interface ContextType {
  story: ShortStory;
  reload: () => Promise<void>;
}

export default function Polish() {
  const { story } = useOutletContext<ContextType>();
  const { token } = theme.useToken();
  const { updateCurrentStory } = useShortStoryStore();
  const [checklist, setChecklist] = useState<PolishChecklistItem[]>([]);
  const [notes, setNotes] = useState(story.polish_notes || '');
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [polishing, setPolishing] = useState(false);

  useEffect(() => {
    try {
      const parsed = story.polish_checklist ? JSON.parse(story.polish_checklist) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setChecklist(parsed);
      }
    } catch {
      setChecklist([]);
    }
    setNotes(story.polish_notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  const handleSave = async (showMessage = true) => {
    try {
      setSaving(true);
      const updated = await shortStoryApi.update(story.id, {
        polish_checklist: JSON.stringify(checklist),
        polish_notes: notes,
      });
      updateCurrentStory(updated);
      if (showMessage) message.success('已保存');
    } catch (error) {
      showErrorToast(error, '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const scheduleAutoSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(false), 1500);
  };

  const toggleItem = (id: string) => {
    const newList = checklist.map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    setChecklist(newList);
    scheduleAutoSave();
  };

  const handlePolish = async () => {
    try {
      setPolishing(true);
      await shortStoryApi.polish(story.id);
      message.success('正文已AI润色更新');
      const now = new Date();
      const timestamp = `${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      const newRecord = `[${timestamp}] AI润色正文：已完成全文AI精修润色`;
      const newNotes = notes ? `${notes}\n${newRecord}` : newRecord;
      setNotes(newNotes);
      const updated = await shortStoryApi.update(story.id, {
        polish_checklist: JSON.stringify(checklist),
        polish_notes: newNotes,
      });
      updateCurrentStory(updated);
    } catch (error) {
      showErrorToast(error, 'AI润色失败');
    } finally {
      setPolishing(false);
    }
  };

  // 按类别分组
  const grouped: Record<string, PolishChecklistItem[]> = {};
  checklist.forEach((item) => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  const checkedCount = checklist.filter((i) => i.checked).length;
  const totalCount = checklist.length;
  const allChecked = totalCount > 0 && checkedCount === totalCount;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>精修笔记</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button loading={polishing} onClick={handlePolish}>
            AI润色正文
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存
          </Button>
        </div>
      </div>

      <Alert
        type={allChecked ? 'success' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          allChecked ? (
            <span>
              <CheckCircleOutlined style={{ marginRight: 8 }} />
              全部自查项已通过！可以发布了
            </span>
          ) : (
            <span>
              完稿自查清单：已通过 {checkedCount}/{totalCount} 项
              {totalCount > 0 && (
                <Progress percent={Math.round((checkedCount / totalCount) * 100)} size="small" style={{ marginTop: 4 }} />
              )}
            </span>
          )
        }
        description={
          <Text style={{ fontSize: 13 }}>
            只要有一条不符合就立刻修改。短故事的成败在于细节打磨，每个自查项都直接影响读者留存率。
          </Text>
        }
      />

      <Card
        size="small"
        title="完稿自查清单"
        style={{ marginBottom: 16 }}
        extra={
          <Tag color={allChecked ? 'success' : 'warning'}>
            {checkedCount}/{totalCount}
          </Tag>
        }
      >
        {totalCount === 0 ? (
          <Empty description="暂无自查清单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <Tag color={CATEGORY_COLOR[category] || 'default'} style={{ marginRight: 8 }}>
                  {category}
                </Tag>
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    marginBottom: 8,
                    padding: 12,
                    background: item.checked ? token.colorSuccessBg : token.colorBgTextHover,
                    borderRadius: 6,
                    border: `1px solid ${item.checked ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Checkbox
                      checked={item.checked}
                      onChange={() => toggleItem(item.id)}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1 }}>
                      <Text
                        strong={!item.checked}
                        delete={item.checked}
                        style={{
                          color: item.checked ? token.colorTextSecondary : token.colorText,
                        }}
                      >
                        {item.item}
                      </Text>
                      {!item.checked && (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            修改建议：{item.fix}
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>

      <Card
        size="small"
        title="修改记录"
        style={{ marginBottom: 16 }}
      >
        <TextArea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            scheduleAutoSave();
          }}
          rows={6}
          placeholder="记录每次精修的修改要点：
1. 哪一段改了什么？
2. 为什么要改？
3. 改完效果如何？

例：
v1：开头太散，删掉300字背景介绍，直接从冲突现场切入
v2：第3段对话太书面，改成口语化
v3：结尾增加一句留白，强化余味"
          style={{ fontFamily: 'inherit' }}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="精修核心原则"
        description={
          <div style={{ fontSize: 13 }}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>开头查验：前300字必须出现核心矛盾</li>
              <li>废话查验：超过3行的环境/心理描写必须删掉</li>
              <li>卡点查验：每段结尾必须勾住读者继续看</li>
              <li>去AI味查验：台词必须像真人说的话</li>
              <li>情绪曲线：每1000-1500字必须有一次小冲突</li>
              <li>人设查验：角色标签化，一眼认清阵营</li>
              <li>对话查验：每句台词必须具备暴露阴谋或推进爽点的功能</li>
            </ul>
          </div>
        }
      />
    </div>
  );
}
