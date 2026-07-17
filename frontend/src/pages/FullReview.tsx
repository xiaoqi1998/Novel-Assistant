import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Button, Select, Radio, Space, Typography, message, Progress,
  Alert, Tag, Spin, Modal, Empty
} from 'antd';
import {
  AuditOutlined, PlayCircleOutlined, CopyOutlined, DownloadOutlined,
  EditOutlined, CheckOutlined, ReloadOutlined,
  StopOutlined, ExclamationCircleOutlined, FileTextOutlined
} from '@ant-design/icons';
import axios from 'axios';
import './FullReview.css';

const { Title, Text } = Typography;

type ReviewStep = 'select' | 'reviewing' | 'reviewed' | 'modifying' | 'modified' | 'confirming';
type ReviewScope = 'single' | 'multi' | 'all';

interface ChapterInfo {
  id: string;
  chapter_number: number;
  title: string;
  word_count: number;
}

interface ModifiedChapter {
  chapterId: string;
  title: string;
  originalContent: string;
  modifiedContent: string;
  confirmed: boolean;
}

const FullReview: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  const [step, setStep] = useState<ReviewStep>('select');
  const [scope, setScope] = useState<ReviewScope>('single');
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [reviewReport, setReviewReport] = useState('');
  const [, setModifiedContent] = useState('');
  const [modifiedChapters, setModifiedChapters] = useState<ModifiedChapter[]>([]);
  const [progress, setProgress] = useState({ message: '', percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const reviewReportRef = useRef('');
  const modifiedContentRef = useRef('');
  const modifiedChaptersRef = useRef<ModifiedChapter[]>([]);

  // 加载章节列表
  useEffect(() => {
    if (!projectId) return;
    loadChapters();
  }, [projectId]);

  const loadChapters = async () => {
    setChaptersLoading(true);
    try {
      const response = await axios.get(`/api/chapters/project/${projectId}`);
      const items = response.data.items || [];
      setChapters(items.map((ch: any) => ({
        id: ch.id,
        chapter_number: ch.chapter_number,
        title: ch.title,
        word_count: ch.word_count || 0,
      })));
    } catch {
      message.error('加载章节列表失败');
    } finally {
      setChaptersLoading(false);
    }
  };

  // 开始审查
  const startReview = async () => {
    if (scope !== 'all' && selectedChapterIds.length === 0) {
      message.warning('请选择要审查的章节');
      return;
    }

    setStep('reviewing');
    setError(null);
    setReviewReport('');
    reviewReportRef.current = '';
    setProgress({ message: '正在启动审查...', percent: 0 });
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/full-review/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          chapter_ids: scope === 'all' ? [] : selectedChapterIds,
          review_scope: scope,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                reviewReportRef.current += data.content;
                setReviewReport(reviewReportRef.current);
              } else if (data.type === 'progress') {
                setProgress({ message: data.message, percent: data.progress });
              } else if (data.type === 'error') {
                setError(data.error);
                if (reviewReportRef.current) {
                  setStep('reviewed');
                } else {
                  setStep('select');
                }
              } else if (data.type === 'done') {
                setStep('reviewed');
              }
            } catch {
              // 忽略非JSON行
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || '审查请求失败');
        if (reviewReportRef.current) {
          setStep('reviewed');
        } else {
          setStep('select');
        }
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // 中断审查
  const stopReview = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    if (reviewReportRef.current) {
      setStep('reviewed');
      message.info('审查已中断，已保留已获取的部分结果');
    } else {
      setStep('select');
    }
  };

  // 复制报告
  const copyReport = () => {
    navigator.clipboard.writeText(reviewReport).then(() => {
      message.success('报告已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败，请手动选择文本复制');
    });
  };

  // 下载报告
  const downloadReport = () => {
    const blob = new Blob([reviewReport], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `全文审查报告_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 执行AI修改
  const applyModifications = async () => {
    setStep('modifying');
    setError(null);
    setModifiedContent('');
    modifiedContentRef.current = '';
    setModifiedChapters([]);
    modifiedChaptersRef.current = [];
    setProgress({ message: '正在启动AI修改...', percent: 0 });
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/full-review/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          chapter_ids: scope === 'all' ? [] : selectedChapterIds,
          review_report: reviewReport,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentChapterId: string | null = null;
      let currentChapterContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                const content = data.content;

                // 检测章节标记
                const startMatch = content.match(/===CHAPTER_START:([^=]+)===/);
                const endMatch = content.match(/===CHAPTER_END:([^=]+)===/);

                if (startMatch) {
                  currentChapterId = startMatch[1];
                  currentChapterContent = '';
                  // 移除标记本身
                  const cleanedContent = content.replace(/===CHAPTER_START:[^=]+===\n?/g, '');
                  if (cleanedContent) {
                    currentChapterContent += cleanedContent;
                  }
                } else if (endMatch) {
                  if (currentChapterId) {
                    const chapter = chapters.find(c => c.id === currentChapterId);
                    const cleanedContent = currentChapterContent.replace(/===CHAPTER_END:[^=]+===\n?/g, '');
                    modifiedChaptersRef.current.push({
                      chapterId: currentChapterId,
                      title: chapter?.title || `章节${currentChapterId}`,
                      originalContent: '',
                      modifiedContent: cleanedContent.trim(),
                      confirmed: false,
                    });
                    setModifiedChapters([...modifiedChaptersRef.current]);
                  }
                  currentChapterId = null;
                  currentChapterContent = '';
                } else if (currentChapterId) {
                  currentChapterContent += content;
                }

                modifiedContentRef.current += content;
                setModifiedContent(modifiedContentRef.current);
              } else if (data.type === 'progress') {
                setProgress({ message: data.message, percent: data.progress });
              } else if (data.type === 'error') {
                setError(data.error);
                if (modifiedChaptersRef.current.length > 0) {
                  setStep('modified');
                } else {
                  setStep('reviewed');
                }
              } else if (data.type === 'done') {
                setStep('modified');
              }
            } catch {
              // 忽略非JSON行
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'AI修改请求失败');
        if (modifiedChaptersRef.current.length > 0) {
          setStep('modified');
        } else {
          setStep('reviewed');
        }
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // 确认覆盖单个章节
  const confirmOverwrite = async (chapterId: string, content: string) => {
    setStep('confirming');
    try {
      const response = await axios.post('/api/full-review/confirm', {
        chapter_id: chapterId,
        modified_content: content,
        project_id: projectId,
      });

      if (response.data.success) {
        message.success(`章节已更新，原文已备份`);
        // 标记为已确认
        setModifiedChapters(prev =>
          prev.map(ch =>
            ch.chapterId === chapterId ? { ...ch, confirmed: true } : ch
          )
        );
      }
    } catch (err: any) {
      message.error(`覆盖失败: ${err.response?.data?.detail || err.message}`);
    } finally {
      setStep('modified');
    }
  };

  // 批量确认覆盖
  const confirmAllOverwrites = async () => {
    Modal.confirm({
      title: '确认覆盖全部章节',
      icon: <ExclamationCircleOutlined />,
      content: `将覆盖 ${modifiedChapters.filter(ch => !ch.confirmed).length} 个章节的原文，原文会自动备份。是否继续？`,
      okText: '确认覆盖',
      cancelText: '取消',
      onOk: async () => {
        for (const ch of modifiedChapters) {
          if (!ch.confirmed) {
            await confirmOverwrite(ch.chapterId, ch.modifiedContent);
          }
        }
        message.success('全部章节已更新');
      },
    });
  };

  // 重置
  const resetReview = () => {
    setStep('select');
    setReviewReport('');
    setModifiedContent('');
    setModifiedChapters([]);
    setError(null);
    setProgress({ message: '', percent: 0 });
    reviewReportRef.current = '';
    modifiedContentRef.current = '';
    modifiedChaptersRef.current = [];
  };

  return (
    <div className="full-review-page">
      <div className="full-review-header">
        <Title level={3}>
          <AuditOutlined /> 全文审查修改
        </Title>
        <Text type="secondary">对已完成的章节进行系统性审查，检查情节逻辑、人物一致性、节奏把控等问题</Text>
      </div>

      {error && (
        <Alert
          message="错误"
          description={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" danger onClick={() => setError(null)}>
              知道了
            </Button>
          }
        />
      )}

      {/* Step 1: 选择审查范围 */}
      {(step === 'select') && (
        <Card title="第一步：选择审查范围" bordered>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Text strong>审查范围：</Text>
              <Radio.Group
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setSelectedChapterIds([]);
                }}
                style={{ marginLeft: 16 }}
              >
                <Radio.Button value="single">单章审查</Radio.Button>
                <Radio.Button value="multi">多章审查</Radio.Button>
                <Radio.Button value="all">全书审查</Radio.Button>
              </Radio.Group>
            </div>

            {scope !== 'all' && (
              <div>
                <Text strong>选择章节：</Text>
                {chaptersLoading ? (
                  <Spin size="small" style={{ marginLeft: 16 }} />
                ) : chapters.length === 0 ? (
                  <Empty description="暂无章节" style={{ margin: '16px 0' }} />
                ) : (
                  <Select
                    mode={scope === 'multi' ? 'multiple' : undefined}
                    style={{ width: '100%', marginTop: 8 }}
                    placeholder={scope === 'single' ? '请选择一个章节' : '请选择多个章节'}
                    value={selectedChapterIds}
                    onChange={setSelectedChapterIds}
                    showSearch
                    optionFilterProp="label"
                    maxTagCount="responsive"
                  >
                    {chapters.map(ch => (
                      <Select.Option
                        key={ch.id}
                        value={ch.id}
                        label={`第${ch.chapter_number}章 ${ch.title}`}
                      >
                        <Space>
                          <Tag color="blue">第{ch.chapter_number}章</Tag>
                          <span>{ch.title}</span>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {ch.word_count}字
                          </Text>
                        </Space>
                      </Select.Option>
                    ))}
                  </Select>
                )}
              </div>
            )}

            {scope === 'all' && (
              <Alert
                message="全书审查"
                description={`将对全部 ${chapters.length} 个章节进行审查。文本较长时会自动分块处理，避免AI遗忘前文。`}
                type="info"
                showIcon
              />
            )}

            <div>
              <Button
                type="primary"
                size="large"
                icon={<PlayCircleOutlined />}
                onClick={startReview}
                disabled={
                  isStreaming ||
                  (scope !== 'all' && selectedChapterIds.length === 0) ||
                  chapters.length === 0
                }
              >
                开始审查
              </Button>
            </div>
          </Space>
        </Card>
      )}

      {/* Step 2: 审查报告 */}
      {(step === 'reviewing' || step === 'reviewed') && (
        <Card
          title={
            <Space>
              <FileTextOutlined />
              <span>第二步：审查报告</span>
              {step === 'reviewing' && <Tag color="processing">审查中</Tag>}
              {step === 'reviewed' && <Tag color="success">审查完成</Tag>}
            </Space>
          }
          bordered
          extra={
            <Space>
              {step === 'reviewing' && (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={stopReview}
                >
                  中断审查
                </Button>
              )}
              {step === 'reviewed' && (
                <>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={copyReport}
                    disabled={!reviewReport}
                  >
                    复制报告
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={downloadReport}
                    disabled={!reviewReport}
                  >
                    下载报告
                  </Button>
                  <Button
                    type="primary"
                    icon={<EditOutlined />}
                    onClick={applyModifications}
                    disabled={!reviewReport || isStreaming}
                  >
                    AI修改
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={resetReview}
                  >
                    重新选择
                  </Button>
                </>
              )}
            </Space>
          }
        >
          {(step === 'reviewing' && progress.message) && (
            <div style={{ marginBottom: 16 }}>
              <Progress percent={progress.percent} size="small" />
              <Text type="secondary">{progress.message}</Text>
            </div>
          )}

          {reviewReport ? (
            <div className="review-report-content">
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                fontSize: 14,
                lineHeight: 1.8,
                maxHeight: '60vh',
                overflow: 'auto',
                padding: 16,
                background: '#fafafa',
                borderRadius: 8,
              }}>
                {reviewReport}
              </pre>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin tip="正在生成审查报告..." />
            </div>
          )}
        </Card>
      )}

      {/* Step 3: AI修改结果 */}
      {(step === 'modifying' || step === 'modified' || step === 'confirming') && (
        <Card
          title={
            <Space>
              <EditOutlined />
              <span>第三步：AI修改结果</span>
              {step === 'modifying' && <Tag color="processing">修改中</Tag>}
              {step === 'modified' && <Tag color="success">修改完成</Tag>}
            </Space>
          }
          bordered
          extra={
            <Space>
              {step === 'modifying' && (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={() => {
                    abortControllerRef.current?.abort();
                    setIsStreaming(false);
                    setStep('modified');
                  }}
                >
                  中断修改
                </Button>
              )}
              {step === 'modified' && (
                <>
                  {modifiedChapters.filter(ch => !ch.confirmed).length > 0 && (
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={confirmAllOverwrites}
                      loading={false}
                    >
                      确认覆盖全部（{modifiedChapters.filter(ch => !ch.confirmed).length}）
                    </Button>
                  )}
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={resetReview}
                  >
                    重新审查
                  </Button>
                </>
              )}
            </Space>
          }
        >
          {(step === 'modifying' && progress.message) && (
            <div style={{ marginBottom: 16 }}>
              <Progress percent={progress.percent} size="small" />
              <Text type="secondary">{progress.message}</Text>
            </div>
          )}

          {modifiedChapters.length > 0 ? (
            <div className="modified-chapters-list">
              {modifiedChapters.map((ch, idx) => (
                <Card
                  key={ch.chapterId}
                  size="small"
                  title={
                    <Space>
                      <Tag color="blue">第{idx + 1}章</Tag>
                      <span>{ch.title}</span>
                      {ch.confirmed && <Tag color="success">已覆盖</Tag>}
                    </Space>
                  }
                  style={{ marginBottom: 12 }}
                  extra={
                    !ch.confirmed && step === 'modified' && (
                      <Space>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => {
                            navigator.clipboard.writeText(ch.modifiedContent);
                            message.success('已复制修改后内容');
                          }}
                        >
                          复制
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          icon={<CheckOutlined />}
                          onClick={() => confirmOverwrite(ch.chapterId, ch.modifiedContent)}
                        >
                          确认覆盖
                        </Button>
                      </Space>
                    )
                  }
                >
                  <div style={{
                    maxHeight: 300,
                    overflow: 'auto',
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 6,
                  }}>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      lineHeight: 1.6,
                      margin: 0,
                    }}>
                      {ch.modifiedContent}
                    </pre>
                  </div>
                </Card>
              ))}
            </div>
          ) : step === 'modifying' ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin tip="AI正在修改章节内容..." />
            </div>
          ) : (
            <Empty description="暂无修改结果" />
          )}
        </Card>
      )}
    </div>
  );
};

export default FullReview;
