import { useState } from 'react';
import { Modal, Button, Typography, Tag, Row, Col, Spin, message } from 'antd';
import { CheckOutlined, CloseOutlined, SwapOutlined } from '@ant-design/icons';
import { shortStoryApi } from '../services/api';
import { showErrorToast } from '../utils/errorHandler';
import type { RevisionPreview } from '../types';
import { formatWordCount } from '../utils/format';

const { Text, Paragraph } = Typography;

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

  if (!preview) return null;

  const isImprove = preview.revision_type === 'improve';
  const wordsDiff = preview.new_words - preview.original_words;

  const handleConfirm = async () => {
    try {
      setConfirming(true);
      const result = await shortStoryApi.confirmRevision(storyId, {
        new_content: preview.new_content,
        revision_type: preview.revision_type,
        original_words: preview.original_words,
        score_total: preview.score_total,
        score_level: preview.score_level,
        top_issues: preview.top_issues,
      });
      message.success(result.message || '已确认保存');
      onConfirmed({ content: result.content, current_words: result.current_words });
    } catch (error) {
      showErrorToast(error, '确认保存失败');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SwapOutlined />
          <span>AI修改对比预览</span>
          <Tag color={isImprove ? 'purple' : 'blue'}>
            {isImprove ? '基于评分改进' : 'AI精修润色'}
          </Tag>
        </div>
      }
      width="90%"
      style={{ maxWidth: 1200, top: 20 }}
      styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={onCancel}>
          取消（放弃修改）
        </Button>,
        <Button
          key="confirm"
          type="primary"
          icon={<CheckOutlined />}
          loading={confirming}
          onClick={handleConfirm}
        >
          确认采用修改后版本
        </Button>,
      ]}
    >
      {/* 字数对比信息 */}
      <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Text type="secondary">原文字数：</Text>
            <Text strong>{formatWordCount(preview.original_words)}</Text>
          </Col>
          <Col>
            <SwapOutlined style={{ color: '#999' }} />
          </Col>
          <Col>
            <Text type="secondary">修改后：</Text>
            <Text strong>{formatWordCount(preview.new_words)}</Text>
            <Tag
              color={wordsDiff > 0 ? 'orange' : wordsDiff < 0 ? 'green' : 'default'}
              style={{ marginLeft: 8 }}
            >
              {wordsDiff > 0 ? `+${wordsDiff}` : wordsDiff} 字
            </Tag>
          </Col>
          {isImprove && preview.score_total != null && (
            <Col>
              <Text type="secondary">原评分：</Text>
              <Text strong style={{ color: '#722ed1' }}>
                {preview.score_total}/100（{preview.score_level}）
              </Text>
            </Col>
          )}
        </Row>
        {isImprove && preview.top_issues && preview.top_issues.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>本次重点解决：</Text>
            {preview.top_issues.map((issue, i) => (
              <Tag key={i} color="red" style={{ marginLeft: 4, fontSize: 12 }}>
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

      {/* 左右对比 */}
      <Row gutter={16}>
        <Col span={12}>
          <div
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 8,
              height: '50vh',
              overflow: 'auto',
              padding: 12,
              background: '#fffbe6',
            }}
          >
            <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #ffe58f' }}>
              <Tag color="warning">原文（修改前）</Tag>
            </div>
            <Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              {preview.original_content}
            </Paragraph>
          </div>
        </Col>
        <Col span={12}>
          <div
            style={{
              border: '1px solid #d9d9d9',
              borderRadius: 8,
              height: '50vh',
              overflow: 'auto',
              padding: 12,
              background: '#f6ffed',
            }}
          >
            <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #b7eb8f' }}>
              <Tag color="success">修改后（AI {isImprove ? '改进' : '精修'}）</Tag>
            </div>
            <Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.8,
                margin: 0,
              }}
            >
              {preview.new_content}
            </Paragraph>
          </div>
        </Col>
      </Row>
    </Modal>
  );
}
