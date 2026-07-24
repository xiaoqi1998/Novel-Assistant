/**
 * 卡壳灵感浮动按钮（E5）
 *
 * 浮动在章节编辑器右下角，点击弹出预设灵感菜单。
 * 选中后直接在编辑器光标位置插入引导性注释文本，
 * 帮助用户突破写作卡壳，不消耗 AI 额度。
 */
import { useState } from 'react';
import { Button, Dropdown, Modal, theme, Tooltip } from 'antd';
import { BulbOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';

interface InspirationButtonProps {
  /** 插入文本到编辑器光标位置 */
  onInsertText: (text: string) => void;
}

interface Preset {
  key: string;
  label: string;
  icon: string;
  desc: string;
  /** 生成插入文本的函数 */
  build: () => string;
}

const PRESETS: Preset[] = [
  {
    key: 'direction',
    label: '发展方向',
    icon: '🧭',
    desc: '列出 3 条可能的情节走向',
    build: () =>
      `\n\n【灵感提示 · 发展方向】\n此刻可以从以下三条路径中选择：\n1. 顺向推进：让主角按原计划行动，但遇到一个意外障碍\n2. 反向转折：主角发现之前的判断完全错误，必须推翻重来\n3. 侧向切入：切换到配角视角，从另一条线揭示新信息\n→ 选定后删除此提示，继续写作\n\n`,
  },
  {
    key: 'hook',
    label: '章末钩子',
    icon: '🪝',
    desc: '设计一个悬念结尾',
    build: () =>
      `\n\n【灵感提示 · 章末钩子】\n本章结尾可以用以下方式制造追读点：\n- 突然揭示：一个隐藏已久的事实浮出水面\n- 紧急危机：主角陷入必须立刻解决的险境\n- 未完成动作：关键行动被打断，悬而未决\n- 身份反转：某人的真实身份与表面相反\n→ 选定类型后删除此提示，围绕钩子撰写最后 200-400 字\n\n`,
  },
  {
    key: 'dialogue',
    label: '对话张力',
    icon: '💬',
    desc: '让对话更有潜台词',
    build: () =>
      `\n\n【灵感提示 · 对话张力】\n这段对话可以增强张力的方式：\n- 让角色说反话（嘴上说 A，心里想 B）\n- 加入一个只有读者知道的秘密，角色却不知道\n- 用短句交锋制造紧张感，每句不超过 10 字\n- 让一方突然沉默，用动作或表情代替回答\n→ 删除此提示，重写对话\n\n`,
  },
  {
    key: 'transition',
    label: '场景过渡',
    icon: '🎬',
    desc: '流畅切换到下一场景',
    build: () =>
      `\n\n【场景过渡】\n[时间流逝：三天后 / 次日清晨 / 黄昏时分]\n[地点切换：从 ___ 到 ___]\n[视角转换：切到配角 ___ 视角]\n→ 填写后删除方括号，自然过渡到下一场景\n\n`,
  },
  {
    key: 'emotion',
    label: '情感爆发',
    icon: '🔥',
    desc: '放大角色的情感转折',
    build: () =>
      `\n\n【灵感提示 · 情感爆发】\n这个瞬间可以让情感更强烈的技巧：\n- 加入角色的内心独白（用斜体或独立成段）\n- 用一个微小的动作细节暗示情绪（颤抖的手、咬紧的牙）\n- 让环境呼应情绪（雨、风、光线变化）\n- 留白：在情绪最浓处戛然而止，让读者自己补完\n→ 删除此提示，强化这段描写\n\n`,
  },
  {
    key: 'foreshadow',
    label: '埋伏笔',
    icon: '🌱',
    desc: '为后续埋下一个伏笔',
    build: () =>
      `\n\n【灵感提示 · 埋伏笔】\n可以在此处埋下伏笔：\n- 一个看似不经意的物件（之后会成为关键）\n- 一句角色随口说的话（之后会应验）\n- 一个异常的小细节（读者第一遍会忽略，回头才恍然）\n- 一个未解释的动作（背后有隐情）\n→ 伏笔要在 5-15 章后回收，删除此提示后自然埋入\n\n`,
  },
  {
    key: 'stuck',
    label: '卡壳急救',
    icon: '🆘',
    desc: '完全不知道怎么写时',
    build: () =>
      `\n\n【灵感提示 · 卡壳急救】\n写不下去时试试：\n1. 删掉最后一段，从更早的地方重新开始\n2. 切换视角，从配角的眼睛看这一幕\n3. 跳过这段，先写下一章，回头再补\n4. 问自己：如果主角此刻做了最不该做的事，会发生什么？\n5. 让一个完全意外的角色突然出现\n→ 选一条试试，删除此提示\n\n`,
  },
];

export default function InspirationButton({ onInsertText }: InspirationButtonProps) {
  const { token } = theme.useToken();
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSelect = (preset: Preset) => {
    const text = preset.build();
    setPreviewText(text);
    setPreviewVisible(true);
    setCopied(false);
  };

  const handleInsert = () => {
    onInsertText(previewText);
    setPreviewVisible(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(previewText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <Dropdown
        menu={{
          items: PRESETS.map(p => ({
            key: p.key,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{p.icon}</span>
                <span style={{ fontWeight: 500 }}>{p.label}</span>
                <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
                  {p.desc}
                </span>
              </div>
            ),
          })),
          onClick: ({ key }) => {
            const preset = PRESETS.find(p => p.key === key);
            if (preset) handleSelect(preset);
          },
        }}
        trigger={['click']}
        placement="topRight"
      >
        <Tooltip title="卡壳了？点这里获取灵感" placement="left">
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<BulbOutlined />}
            style={{
              position: 'fixed',
              bottom: 80,
              right: 40,
              zIndex: 1000,
              width: 48,
              height: 48,
              background: `linear-gradient(135deg, ${token.colorWarning} 0%, ${token.colorPrimary} 100%)`,
              border: 'none',
              boxShadow: `0 4px 12px ${token.colorWarningBg}`,
              fontSize: 20,
            }}
          />
        </Tooltip>
      </Dropdown>

      {/* 预览 Modal */}
      <Modal
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BulbOutlined style={{ color: token.colorWarning }} />
            <span>灵感提示</span>
          </div>
        }
        width={600}
        footer={[
          <Button key="copy" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={handleCopy}>
            {copied ? '已复制' : '复制文本'}
          </Button>,
          <Button key="insert" type="primary" onClick={handleInsert}>
            插入到光标位置
          </Button>,
        ]}
      >
        <pre style={{
          background: token.colorBgTextHover,
          padding: 16,
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          margin: 0,
          maxHeight: '50vh',
          overflowY: 'auto',
        }}>
          {previewText}
        </pre>
        <div style={{ marginTop: 12, fontSize: 12, color: token.colorTextSecondary }}>
          提示：这是引导文本，帮助你突破卡壳。插入后请删除【】提示部分，保留你自己的创作内容。
        </div>
      </Modal>
    </>
  );
}
