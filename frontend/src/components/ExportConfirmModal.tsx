import type { ReactNode } from 'react';
import { Modal, Typography, theme } from 'antd';
import { FileTextOutlined, FileMarkdownOutlined } from '@ant-design/icons';
import { alphaColor } from '../utils/color';

const { Text } = Typography;

export type ExportFormat = 'markdown' | 'txt';

export interface ExportFormatMeta {
  label: string;
  tip: string;
}

export interface ExportConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  format: ExportFormat;
  onFormatChange: (fmt: ExportFormat) => void;
  /** Modal 标题，默认 "导出短故事" */
  title?: string;
  /** 被导出对象名称（如故事标题） */
  subjectName: string;
  /** 字数统计，可选 */
  wordCount?: number;
  /** 格式说明，默认使用短故事导出的说明文案 */
  formatMeta?: Record<ExportFormat, ExportFormatMeta>;
  /** 标题与格式选择之间额外展示的信息（如目标平台提示） */
  extraInfo?: ReactNode;
}

/** 短故事导出默认格式说明 */
export const SHORT_STORY_EXPORT_META: Record<ExportFormat, ExportFormatMeta> = {
  markdown: {
    label: 'Markdown 电子书（推荐）',
    tip: '含元信息头（类型/状态/字数/情绪目标）、故事设定（梗概/反转/题材/平台）、正文，可在 VS Code / Typora 大纲栏快速跳转，可转换为 EPUB/PDF。',
  },
  txt: {
    label: 'TXT 纯文本',
    tip: '仅标题+正文，纯文本格式，便于复制粘贴到其他平台或再次拆书导入。',
  },
};

/**
 * 导出确认弹窗（共享组件）。
 * 封装 Markdown/TXT 格式选择 + 二次确认，供 ShortStoryDetail、ShortStoryBookshelf、ProjectDetail 等复用。
 */
export default function ExportConfirmModal({
  open,
  onCancel,
  onConfirm,
  format,
  onFormatChange,
  title = '导出短故事',
  subjectName,
  wordCount,
  formatMeta = SHORT_STORY_EXPORT_META,
  extraInfo,
}: ExportConfirmModalProps) {
  const { token } = theme.useToken();

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText="确定导出"
      cancelText="取消"
      centered
    >
      <div style={{ marginBottom: 12 }}>
        <Text strong>《{subjectName}》</Text>
        {wordCount !== undefined && (
          <Text type="secondary" style={{ marginLeft: 8 }}>
            共 {wordCount} 字
          </Text>
        )}
      </div>
      {extraInfo && <div style={{ marginBottom: 12 }}>{extraInfo}</div>}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {(['markdown', 'txt'] as const).map((fmt) => {
          const meta = formatMeta[fmt];
          const selected = format === fmt;
          return (
            <div
              key={fmt}
              onClick={() => onFormatChange(fmt)}
              style={{
                flex: 1,
                padding: 12,
                border: `2px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                borderRadius: 8,
                cursor: 'pointer',
                background: selected ? alphaColor(token.colorPrimary, 0.06) : 'transparent',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {fmt === 'markdown' ? (
                  <FileMarkdownOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
                ) : (
                  <FileTextOutlined style={{ color: token.colorTextSecondary, fontSize: 18 }} />
                )}
                <Text strong>{meta.label}</Text>
              </div>
              <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {meta.tip}
              </Text>
            </div>
          );
        })}
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        导出后将以文件下载方式保存到本地。
      </Text>
    </Modal>
  );
}
