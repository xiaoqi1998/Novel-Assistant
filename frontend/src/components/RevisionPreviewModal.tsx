import { useState } from 'react';
import { Modal, Button, Typography, Tag, Row, Col, message, theme } from 'antd';
import { CheckOutlined, CloseOutlined, SwapOutlined } from '@ant-design/icons';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import useIsMobile from '../utils/useIsMobile';
import type { RevisionPreview } from '../types';
import { formatWordCount } from '../utils/format';

const { Text } = Typography;

interface RevisionPreviewModalProps {
  open: boolean;
  storyId: string;
  preview: RevisionPreview | null;
  onCancel: () => void;
  onConfirmed: (result: { content: string; current_words: number }) => void;
}

/**
 * AI修改正文对比预览Modal
 * 左侧原文 / 右侧修改后，用户确认后才保存
 */
export default function RevisionPreviewModal({
  open,
  storyId,
  preview,
  onCancel,
  onConfirmed,
}: RevisionPreviewModalProps) {
  const [confirming, setConfirming] = useState(false);
  const { token } = theme.useToken();
  const isMobile = useIsMobile();

  // 不再提前 return null：始终渲染 Modal，由 open 控制，保留关闭动画
  const isImprove = preview?.revision_type === 'improve';
  const isRegenerate = preview?.revision_type === 'regenerate';
  const wordsDiff = preview ? preview.new_words - preview.original_words : 0;

  const handleConfirm = async () => {
    if (!preview) return;
    try {
      setConfirming(true);
      if (isRegenerate) {
        // regenerate 整体重写：调 confirm-regenerate，传完整字段（title/logline/genre/twist_*/characters/content）
        // 原文备份到版本历史由后端处理
        const result = await shortStoryApi.confirmRegenerate(storyId, {
          title: preview.title || '',
          logline: preview.logline,
          genre: preview.genre,
          emotion_goal: preview.emotion_goal,
          twist_type: preview.twist_type,
          twist_content: preview.twist_content,
          twist_clues: preview.twist_clues,
          characters: preview.characters,
          content: preview.content || preview.new_content,
        });
        message.success(result.message || '已确认保存，原内容已备份到版本历史');
        // confirm-regenerate 返回不含 content，用 preview 的内容回填
        onConfirmed({ content: preview.content || preview.new_content, current_words: result.current_words });
      } else {
        // polish/improve：调 confirm-revision，只写正文
        const result = await shortStoryApi.confirmRevision(storyId, {
          new_content: preview.new_content,
          revision_type: preview.revision_type as 'polish' | 'improve',
          original_words: preview.original_words,
          score_total: preview.score_total,
          score_level: preview.score_level,
          top_issues: preview.top_issues,
        });
        message.success(result.message || '已确认保存');
        onConfirmed({ content: result.content, current_words: result.current_words });
      }
    } catch (error) {
      showErrorToast(error, '确认保存失败');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={open && !!preview}
      onCancel={onCancel}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SwapOutlined />
          <span>AI修改对比预览</span>
          <Tag color={isRegenerate ? 'gold' : isImprove ? 'purple' : 'blue'}>
            {isRegenerate ? 'AI重新生成' : isImprove ? '基于评分改进' : 'AI精修润色'}
          </Tag>
        </div>
      }
      width={isMobile ? '95%' : '90%'}
      style={{ maxWidth: 1200, top: isMobile ? 10 : 20 }}
      styles={{ body: { maxHeight: isMobile ? '65vh' : '70vh', overflow: 'auto' } }}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={onCancel} block={isMobile}>
          取消（放弃修改）
        </Button>,
        <Button
          key="confirm"
          type="primary"
          icon={<CheckOutlined />}
          loading={confirming}
          onClick={handleConfirm}
          block={isMobile}
        >
          确认采用修改后版本
        </Button>,
      ]}
    >
      {/* 字数对比信息 */}
      <div style={{ marginBottom: 16, padding: 12, background: token.colorFillQuaternary, borderRadius: 8 }}>
        <Row gutter={isMobile ? [8, 8] : 16} align="middle" style={isMobile ? { rowGap: 8 } : undefined}>
          <Col>
            <Text type="secondary">原文字数：</Text>
            <Text strong>{formatWordCount(preview?.original_words ?? 0)}</Text>
          </Col>
          <Col>
            <SwapOutlined style={{ color: token.colorTextTertiary }} />
          </Col>
          <Col>
            <Text type="secondary">修改后：</Text>
            <Text strong>{formatWordCount(preview?.new_words ?? 0)}</Text>
            <Tag
              color={wordsDiff > 0 ? 'blue' : wordsDiff < 0 ? 'default' : 'default'}
              style={{ marginLeft: 8 }}
            >
              {wordsDiff > 0 ? `+${wordsDiff}` : wordsDiff} 字
            </Tag>
          </Col>
          {isImprove && preview?.score_total != null && (
            <Col>
              <Text type="secondary">原评分：</Text>
              <Text strong style={{ color: token.colorPrimary }}>
                {preview.score_total}/100（{preview.score_level}）
              </Text>
            </Col>
          )}
        </Row>
        {isImprove && preview?.top_issues && preview.top_issues.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>本次重点解决：</Text>
            {preview.top_issues.map((issue, i) => (
              <Tag key={i} color="error" style={{ marginLeft: 4, fontSize: 12 }}>
                {issue}
              </Tag>
            ))}
          </div>
        )}
        {isImprove && (
          <div style={{ marginTop: 8 }}>
            <Text type="warning" style={{ fontSize: 12 }}>
              * 确认保存后旧评分将清空，请重新评分验证改进效果
            </Text>
          </div>
        )}
      </div>

      {/* 行级 diff 对比（react-diff-viewer-continued，splitView 左右并排高亮新增/删除行） */}
      <div style={{ border: `1px solid ${token.colorBorder}`, borderRadius: 8, overflow: 'hidden' }}>
        <ReactDiffViewer
          oldValue={preview?.original_content ?? ''}
          newValue={preview?.new_content ?? ''}
          splitView={!isMobile}
          leftTitle="原文（修改前）"
          rightTitle={`修改后（AI ${isRegenerate ? '重新生成' : isImprove ? '改进' : '精修'}）`}
          useDarkTheme={false}
          hideLineNumbers={false}
          styles={{
            contentText: { fontSize: 14, lineHeight: 1.8 },
            lineNumber: { fontSize: 12 },
          }}
        />
      </div>
    </Modal>
  );
}
