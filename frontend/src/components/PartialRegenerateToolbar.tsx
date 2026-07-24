import type { FC } from 'react';
import { Button, Tooltip, theme, Dropdown } from 'antd';
import { EditOutlined, ThunderboltOutlined } from '@ant-design/icons';

interface PartialRegenerateToolbarProps {
  visible: boolean;
  position: { top: number; left: number };
  onRegenerate: () => void;
  /** E2：一键改进回调，参数为预设的改进要求 */
  onQuickImprove?: (presetInstructions: string) => void;
  selectedText: string;
}

// E2：预设改进选项
const QUICK_IMPROVE_PRESETS: Array<{ key: string; label: string; instructions: string }> = [
  {
    key: 'deslop',
    label: '去 AI 味',
    instructions: '去除 AI 痕迹（工整排比、机械总结、重复修辞），让文字更口语化、更像真人手笔，保留作者个人文风',
  },
  {
    key: 'dialogue',
    label: '对话张力',
    instructions: '增强这段对话的张力：增加潜台词，让角色的话语更有辨识度，去掉空话套话，每句对话必须承载信息或情绪',
  },
  {
    key: 'detail',
    label: '增加细节',
    instructions: '在不改变情节的前提下增加感官细节（视觉/听觉/触觉）、动作描写、环境氛围，让画面感更强',
  },
  {
    key: 'tighten',
    label: '收紧节奏',
    instructions: '精简冗余描写，删去不承载信息的修饰语，用短句加快节奏，让这一段更紧凑有力',
  },
  {
    key: 'emotion',
    label: '强化情感',
    instructions: '放大这段的情感张力：让情绪转折更明显，加入角色的内心独白或微表情，让读者能感同身受',
  },
];

/**
 * 局部重写浮动工具栏
 * 当用户在章节内容编辑器中选中文本时显示
 */
export const PartialRegenerateToolbar: FC<PartialRegenerateToolbarProps> = ({
  visible,
  position,
  onRegenerate,
  onQuickImprove,
  selectedText
}) => {
  const { token } = theme.useToken();

  if (!visible || !selectedText) return null;

  // 限制显示的选中文本长度
  const displayText = selectedText.length > 20 
    ? selectedText.substring(0, 20) + '...' 
    : selectedText;

  return (
    <div
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 10000,
        background: token.colorBgElevated,
        borderRadius: 8,
        boxShadow: token.boxShadow,
        padding: '6px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        animation: 'fadeIn 0.2s ease-out',
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Tooltip
        title={`AI重写选中内容: "${displayText}"`}
        placement="top"
      >
        <Button
          type="primary"
          size="small"
          icon={<EditOutlined />}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRegenerate();
          }}
          style={{
            background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)',
            border: 'none',
            fontWeight: 500,
            boxShadow: token.boxShadowSecondary,
          }}
        >
          AI重写
        </Button>
      </Tooltip>

      {/* E2：一键改进下拉菜单 */}
      {onQuickImprove && (
        <Dropdown
          menu={{
            items: QUICK_IMPROVE_PRESETS.map(p => ({
              key: p.key,
              label: p.label,
            })),
            onClick: ({ key }) => {
              const preset = QUICK_IMPROVE_PRESETS.find(p => p.key === key);
              if (preset && onQuickImprove) {
                onQuickImprove(preset.instructions);
              }
            },
          }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title="一键改进"
          >
            一键改进
          </Button>
        </Dropdown>
      )}

      <span style={{ 
        fontSize: 12, 
        color: token.colorTextTertiary,
        maxWidth: 150,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        已选 {selectedText.length} 字
      </span>
    </div>
  );
};

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
if (!document.head.querySelector('style[data-partial-regenerate-toolbar]')) {
  style.setAttribute('data-partial-regenerate-toolbar', 'true');
  document.head.appendChild(style);
}

export default PartialRegenerateToolbar;