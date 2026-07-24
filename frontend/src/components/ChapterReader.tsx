/**
 * 章节阅读器组件
 * 提供沉浸式阅读体验，支持主题切换、字体调节、翻页导航等功能
 */
import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Slider, Radio, Space, Typography, Spin, message, theme, Rate, Input, Collapse, Tag, Empty, Tooltip } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  SettingOutlined,
  FontSizeOutlined,
  BgColorsOutlined,
  CloseOutlined,
  ColumnHeightOutlined,
  CheckCircleOutlined,
  LineChartOutlined,
  BulbOutlined,
  ArrowRightOutlined
} from '@ant-design/icons';
import type { Chapter } from '../types';

// 阅读器设置接口
interface ReaderSettings {
  fontSize: number;       // 字体大小
  theme: 'light' | 'sepia' | 'dark';  // 主题模式
  lineHeight: number;     // 行高
}

// 组件属性接口
interface ChapterReaderProps {
  visible: boolean;                           // 是否显示
  chapter: Chapter;                           // 当前章节
  onClose: () => void;                        // 关闭回调
  onChapterChange: (chapterId: string) => void;  // 章节切换回调
}

// 导航信息接口
interface NavigationInfo {
  previous: { id: string; chapter_number: number; title: string } | null;
  next: { id: string; chapter_number: number; title: string } | null;
  current: { id: string; chapter_number: number; title: string };
}

interface ReaderThemeStyle {
  bg: string;
  text: string;
  headerBg: string;
  border: string;
}

// 本地存储key
const SETTINGS_STORAGE_KEY = 'chapter-reader-settings';

// 从本地存储加载设置
const loadSettings = (): ReaderSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('加载阅读器设置失败:', e);
  }
  return {
    fontSize: 18,
    theme: 'light',
    lineHeight: 1.8
  };
};

// 保存设置到本地存储
const saveSettings = (settings: ReaderSettings) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('保存阅读器设置失败:', e);
  }
};

export default function ChapterReader({ 
  visible, 
  chapter, 
  onClose, 
  onChapterChange 
}: ChapterReaderProps) {
  const { token } = theme.useToken();

  // 阅读器设置
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  
  // 导航信息
  const [navigation, setNavigation] = useState<NavigationInfo | null>(null);
  
  // 加载状态
  const [loading, setLoading] = useState(false);
  
  // 设置面板显示状态
  const [showSettings, setShowSettings] = useState(false);
  
  // 移动端检测
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // 章节评分状态
  const [userRating, setUserRating] = useState<number | null>(null);
  const [userFeedback, setUserFeedback] = useState<string>('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // 反馈影响追踪（E3）
  type ImpactScores = {
    pacing?: number;
    engagement?: number;
    coherence?: number;
    overall?: number;
  };
  type ImpactData = {
    nextChapterNumber: number | null;
    nextChapterTitle: string | null;
    feedbackKeywords: string[];
    nextChapterScores: ImpactScores | null;
    nextChapterSuggestions: string[];
  };
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactData, setImpactData] = useState<ImpactData | null>(null);

  // 响应式检测
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 获取章节导航信息
  useEffect(() => {
    if (visible && chapter?.id) {
      setLoading(true);
      fetch(`/api/chapters/${chapter.id}/navigation`)
        .then(res => {
          if (!res.ok) throw new Error('获取导航失败');
          return res.json();
        })
        .then(data => {
          setNavigation(data);
          setLoading(false);
        })
        .catch(err => {
          console.error('获取导航信息失败:', err);
          message.error('获取章节导航信息失败');
          setLoading(false);
        });
    }
  }, [visible, chapter?.id]);

  // 保存设置变更
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // 加载已有用户反馈
  useEffect(() => {
    if (visible && chapter?.id) {
      fetch(`/api/chapters/${chapter.id}/feedback`)
        .then(res => {
          if (!res.ok) return null;
          return res.json();
        })
        .then(data => {
          if (data && data.user_rating != null) {
            setUserRating(data.user_rating);
            setUserFeedback(data.user_feedback || '');
            setFeedbackSubmitted(true);
          } else {
            setUserRating(null);
            setUserFeedback('');
            setFeedbackSubmitted(false);
          }
        })
        .catch(() => {
          setUserRating(null);
          setUserFeedback('');
          setFeedbackSubmitted(false);
        });
    }
  }, [visible, chapter?.id]);

  // 提交章节反馈
  const handleSubmitFeedback = useCallback(async () => {
    if (userRating === null) {
      message.warning('请先选择评分');
      return;
    }
    setFeedbackSaving(true);
    try {
      const res = await fetch(`/api/chapters/${chapter.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: userRating,
          feedback: userFeedback.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('提交失败');
      const data = await res.json();
      message.success(data.message || '反馈已保存');
      setFeedbackSubmitted(true);
      // 反馈提交成功后加载影响数据
      loadImpactData();
    } catch (err) {
      message.error('提交反馈失败');
    } finally {
      setFeedbackSaving(false);
    }
  }, [chapter?.id, userRating, userFeedback]);

  // 加载反馈影响追踪数据（E3）
  // 策略：当用户已反馈且存在下一章时，拉取下一章的 PLOT_ANALYSIS 评分
  // 关键词从用户反馈中简单抽取（低分维度 + 反馈文本前若干字）
  const loadImpactData = useCallback(async () => {
    if (!chapter?.id || !navigation?.next) {
      setImpactData(null);
      return;
    }
    setImpactLoading(true);
    try {
      const nextId = navigation.next.id;
      const [analysisRes] = await Promise.all([
        fetch(`/api/chapters/${nextId}/analysis/status`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      let nextScores: ImpactScores | null = null;
      let nextSuggestions: string[] = [];
      if (analysisRes && analysisRes.status === 'completed' && analysisRes.analysis_id) {
        // 拉取分析详情
        const detailRes = await fetch(`/api/chapters/${nextId}/analysis`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (detailRes?.analysis) {
          const a = detailRes.analysis;
          nextScores = {
            pacing: a.pacing_score,
            engagement: a.engagement_score,
            coherence: a.coherence_score,
            overall: a.overall_quality_score,
          };
          nextSuggestions = Array.isArray(a.suggestions) ? a.suggestions.slice(0, 3) : [];
        }
      }
      // 提取反馈关键词：低分维度 + 反馈文本片段
      const keywords: string[] = [];
      if (userRating !== null && userRating < 4) {
        if (userRating <= 2) keywords.push('整体质量待改进');
        if (userFeedback) {
          // 简单分词：按标点切分取前 2 段
          const segments = userFeedback.split(/[，。！？;；,.\n\s]+/).filter(s => s.trim().length >= 2).slice(0, 2);
          keywords.push(...segments);
        }
      } else if (userRating !== null && userRating >= 4) {
        keywords.push('整体质量良好');
        if (userFeedback) {
          const segments = userFeedback.split(/[，。！？;；,.\n\s]+/).filter(s => s.trim().length >= 2).slice(0, 2);
          keywords.push(...segments);
        }
      }
      setImpactData({
        nextChapterNumber: navigation.next.chapter_number,
        nextChapterTitle: navigation.next.title,
        feedbackKeywords: keywords,
        nextChapterScores: nextScores,
        nextChapterSuggestions: nextSuggestions,
      });
    } catch (err) {
      console.warn('加载反馈影响数据失败:', err);
      setImpactData(null);
    } finally {
      setImpactLoading(false);
    }
  }, [chapter?.id, navigation?.next, userRating, userFeedback]);

  // 当导航信息和反馈状态变化时加载影响数据
  useEffect(() => {
    if (feedbackSubmitted && navigation?.next) {
      loadImpactData();
    } else {
      setImpactData(null);
    }
  }, [feedbackSubmitted, navigation?.next?.id, loadImpactData]);

  // 上一章
  const handlePrevious = useCallback(() => {
    if (navigation?.previous) {
      setLoading(true);
      onChapterChange(navigation.previous.id);
    }
  }, [navigation?.previous, onChapterChange]);

  // 下一章
  const handleNext = useCallback(() => {
    if (navigation?.next) {
      setLoading(true);
      onChapterChange(navigation.next.id);
    }
  }, [navigation?.next, onChapterChange]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;
      
      // 忽略输入框中的按键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      switch (e.key) {
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case 'Escape':
          onClose();
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, handlePrevious, handleNext, onClose]);

  // 章节变化后自动回到顶部
  useEffect(() => {
    if (chapter?.id) {
      setLoading(false);
      // 找到滚动容器并滚动到顶部
      const scrollContainer = document.querySelector('.reader-scroll-container');
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    }
  }, [chapter?.id]);

  // 当前主题样式
  const themeStyles: Record<ReaderSettings['theme'], ReaderThemeStyle> = {
    light: {
      bg: token.colorBgContainer,
      text: token.colorText,
      headerBg: token.colorBgElevated,
      border: token.colorBorderSecondary,
    },
    sepia: {
      bg: `color-mix(in srgb, ${token.colorWarningBg} 72%, ${token.colorBgContainer} 28%)`,
      text: `color-mix(in srgb, ${token.colorText} 85%, ${token.colorTextSecondary} 15%)`,
      headerBg: `color-mix(in srgb, ${token.colorWarningBg} 58%, ${token.colorBgElevated} 42%)`,
      border: `color-mix(in srgb, ${token.colorWarningBorder} 65%, ${token.colorBorder} 35%)`,
    },
    dark: {
      bg: `color-mix(in srgb, ${token.colorTextBase} 92%, ${token.colorBgContainer} 8%)`,
      text: `color-mix(in srgb, ${token.colorTextLightSolid} 82%, ${token.colorTextSecondary} 18%)`,
      headerBg: `color-mix(in srgb, ${token.colorTextBase} 84%, ${token.colorBgElevated} 16%)`,
      border: `color-mix(in srgb, ${token.colorTextBase} 60%, ${token.colorBorder} 40%)`,
    },
  };
  const currentTheme = themeStyles[settings.theme];

  // 更新设置的便捷函数
  const updateSettings = (key: keyof ReaderSettings, value: number | string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{
        maxWidth: '100vw',
        top: 0,
        margin: 0,
        padding: 0,
        height: '100vh',
        overflow: 'hidden'
      }}
      styles={{
        content: {
          height: '100vh',
          borderRadius: 0,
          boxShadow: 'none',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        },
        body: {
          flex: 1,
          padding: 0,
          background: currentTheme.bg,
          overflow: 'hidden',
          height: '100%',
          scrollbarWidth: 'thin',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
      closable={false}
      maskClosable={false}
    >
      {/* 顶部工具栏 */}
      <div style={{
        flex: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: isMobile ? '10px 12px' : '12px 20px',
        borderBottom: `1px solid ${currentTheme.border}`,
        background: currentTheme.headerBg,
        zIndex: 10
      }}>
        <Button 
          type="text" 
          icon={<CloseOutlined />} 
          onClick={onClose}
          style={{ color: currentTheme.text }}
        >
          {!isMobile && '关闭'}
        </Button>
        
        <Typography.Title 
          level={5} 
          style={{ 
            margin: 0, 
            color: currentTheme.text,
            maxWidth: isMobile ? '60%' : '70%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: isMobile ? 14 : 16
          }}
        >
          第{chapter.chapter_number}章：{chapter.title}
        </Typography.Title>
        
        <Button
          type={showSettings ? 'primary' : 'text'}
          icon={<SettingOutlined />}
          onClick={() => setShowSettings(!showSettings)}
          style={{ color: showSettings ? undefined : currentTheme.text }}
          title="阅读设置"
        />
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div style={{
          padding: isMobile ? '12px 16px' : '16px 24px',
          borderBottom: `1px solid ${currentTheme.border}`,
          background: currentTheme.headerBg
        }}>
          <Space 
            direction={isMobile ? 'vertical' : 'horizontal'} 
            size="large"
            style={{ width: '100%' }}
            wrap
          >
            {/* 字体大小 */}
            <div style={{ minWidth: isMobile ? '100%' : 200 }}>
              <Space style={{ marginBottom: 8, color: currentTheme.text }}>
                <FontSizeOutlined />
                <span>字体大小: {settings.fontSize}px</span>
              </Space>
              <Slider
                min={14}
                max={28}
                value={settings.fontSize}
                onChange={v => updateSettings('fontSize', v)}
                style={{ margin: '8px 0' }}
              />
            </div>

            {/* 行高 */}
            <div style={{ minWidth: isMobile ? '100%' : 200 }}>
              <Space style={{ marginBottom: 8, color: currentTheme.text }}>
                <ColumnHeightOutlined />
                <span>行高: {settings.lineHeight}</span>
              </Space>
              <Slider
                min={1.4}
                max={2.5}
                step={0.1}
                value={settings.lineHeight}
                onChange={v => updateSettings('lineHeight', v)}
                style={{ margin: '8px 0' }}
              />
            </div>

            {/* 主题 */}
            <div>
              <Space style={{ marginBottom: 8, color: currentTheme.text }}>
                <BgColorsOutlined />
                <span>主题</span>
              </Space>
              <div>
                <Radio.Group
                  value={settings.theme}
                  onChange={e => updateSettings('theme', e.target.value)}
                  buttonStyle="solid"
                  size={isMobile ? 'small' : 'middle'}
                >
                  <Radio.Button value="light">日间</Radio.Button>
                  <Radio.Button value="sepia">护眼</Radio.Button>
                  <Radio.Button value="dark">夜间</Radio.Button>
                </Radio.Group>
              </div>
            </div>
          </Space>
        </div>
      )}

      {/* 章节内容区域 */}
      <div
        className="reader-scroll-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative',
          scrollBehavior: 'smooth'
        }}
      >
        <Spin spinning={loading} tip="加载中...">
          <div
            style={{
              maxWidth: 1000,
              margin: '0 auto',
              padding: isMobile ? '24px 16px 40px' : '40px 60px 40px',
              minHeight: '100%',
              fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            color: currentTheme.text,
            whiteSpace: 'pre-wrap',
            textAlign: 'justify',
            wordBreak: 'break-word',
            overflowWrap: 'break-word'
          }}
        >
          {chapter.content ? (
            // 按段落渲染内容，优化阅读体验
            chapter.content.split('\n').map((paragraph, index) => (
              paragraph.trim() ? (
                <p
                  key={index}
                  style={{
                    textIndent: '2em',
                    margin: 0,
                    marginBottom: '0.8em'
                  }}
                >
                  {paragraph}
                </p>
              ) : (
                <br key={index} />
              )
            ))
          ) : (
            <div style={{ 
              textAlign: 'center', 
              padding: '60px 20px',
              color: currentTheme.text,
              opacity: 0.6
            }}>
              暂无内容
            </div>
          )}
          </div>
        </Spin>

        {/* 章节评分反馈区 */}
        {chapter.content && (
          <div style={{
            maxWidth: 1000,
            margin: '0 auto',
            padding: isMobile ? '0 16px 24px' : '0 60px 24px',
            borderTop: `1px solid ${currentTheme.border}`,
            marginTop: 24,
            paddingTop: 20
          }}>
            <div style={{ marginBottom: 12, color: currentTheme.text, fontWeight: 500 }}>
              {feedbackSubmitted ? '✅ 已反馈，你的评价会影响下一章的生成质量' : '给本章打分，帮助 AI 改进下一章'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Rate
                value={userRating ?? 0}
                onChange={(val) => {
                  setUserRating(val);
                  setFeedbackSubmitted(false);
                }}
                disabled={feedbackSaving}
              />
              <Input.TextArea
                value={userFeedback}
                onChange={(e) => setUserFeedback(e.target.value)}
                placeholder="可选：写下你觉得哪里好/哪里需要改进（会直接告诉 AI）"
                autoSize={{ minRows: 1, maxRows: 3 }}
                maxLength={1000}
                disabled={feedbackSaving}
                style={{
                  maxWidth: isMobile ? '100%' : 400,
                  background: currentTheme.bg,
                  color: currentTheme.text,
                  borderColor: currentTheme.border
                }}
              />
              <Button
                type="primary"
                size="small"
                loading={feedbackSaving}
                onClick={handleSubmitFeedback}
                disabled={userRating === null}
              >
                {feedbackSubmitted ? '更新反馈' : '提交反馈'}
              </Button>
            </div>

            {/* E3：反馈影响追踪面板（仅在已提交反馈且存在下一章时显示） */}
            {feedbackSubmitted && navigation?.next && (
              <div style={{ marginTop: 16 }}>
                <Collapse
                  size="small"
                  items={[{
                    key: 'impact',
                    label: (
                      <Space size={6}>
                        <LineChartOutlined style={{ color: token.colorPrimary }} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          反馈影响追踪
                        </span>
                        {impactData?.nextChapterScores?.overall != null && (
                          <Tag color="blue" style={{ fontSize: 11, marginInline: 0 }}>
                            下一章评分 {impactData.nextChapterScores.overall.toFixed(1)}/10
                          </Tag>
                        )}
                      </Space>
                    ),
                    children: (
                      <Spin spinning={impactLoading} size="small">
                        {impactData ? (
                          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                            {/* 反馈关键词 */}
                            <div style={{ marginBottom: 10 }}>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                你的反馈关键词：
                              </Typography.Text>
                              <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {impactData.feedbackKeywords.length > 0 ? (
                                  impactData.feedbackKeywords.map((kw, i) => (
                                    <Tag key={i} color="purple" style={{ fontSize: 11 }}>{kw}</Tag>
                                  ))
                                ) : (
                                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>（无文字反馈，仅评分）</Typography.Text>
                                )}
                              </div>
                            </div>

                            {/* 注入下一章的提示 */}
                            <div style={{
                              padding: '8px 10px',
                              background: `color-mix(in srgb, ${token.colorSuccessBg} 60%, transparent)`,
                              borderRadius: 6,
                              marginBottom: 10,
                              border: `1px solid ${token.colorSuccessBorder}`,
                            }}>
                              <Typography.Text style={{ fontSize: 12, color: token.colorSuccess }}>
                                <CheckCircleOutlined /> 已注入下一章生成上下文
                              </Typography.Text>
                              <div style={{ marginTop: 4, fontSize: 11, color: token.colorTextSecondary }}>
                                下一章生成时 AI 会看到：
                                <span style={{ color: token.colorText, fontWeight: 500 }}>
                                  &ldquo;上一章评分 {userRating ?? '-'}/5{userFeedback ? `，反馈：${userFeedback.slice(0, 40)}${userFeedback.length > 40 ? '...' : ''}` : ''}&rdquo;
                                </span>
                              </div>
                            </div>

                            {/* 下一章评分对比 */}
                            {impactData.nextChapterScores ? (
                              <div>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  下一章《{impactData.nextChapterTitle}》的 AI 自评：
                                </Typography.Text>
                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(4, 1fr)',
                                  gap: 8,
                                  marginTop: 6,
                                }}>
                                  {[
                                    { label: '节奏', value: impactData.nextChapterScores.pacing },
                                    { label: '吸引力', value: impactData.nextChapterScores.engagement },
                                    { label: '连贯', value: impactData.nextChapterScores.coherence },
                                    { label: '整体', value: impactData.nextChapterScores.overall },
                                  ].map((item) => (
                                    <div key={item.label} style={{
                                      textAlign: 'center',
                                      padding: '4px 0',
                                      background: `color-mix(in srgb, ${token.colorPrimaryBg} 50%, transparent)`,
                                      borderRadius: 4,
                                    }}>
                                      <div style={{ fontSize: 10, color: token.colorTextSecondary }}>{item.label}</div>
                                      <div style={{ fontSize: 14, fontWeight: 600, color: token.colorPrimary }}>
                                        {item.value != null ? item.value.toFixed(1) : '-'}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {impactData.nextChapterSuggestions.length > 0 && (
                                  <div style={{ marginTop: 8 }}>
                                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                      <BulbOutlined /> 下一章改进建议：
                                    </Typography.Text>
                                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                      {impactData.nextChapterSuggestions.map((s, i) => (
                                        <li key={i} style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 2 }}>
                                          {s}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: token.colorTextSecondary }}>
                                <Tooltip title="下一章尚未完成 PLOT_ANALYSIS 分析，生成后可查看对比">
                                  <span><ArrowRightOutlined /> 下一章尚未分析，暂无评分对比数据</span>
                                </Tooltip>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无影响数据" />
                        )}
                      </Spin>
                    ),
                  }]}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部导航栏 */}
      <div style={{
        flex: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: isMobile ? '12px 16px' : '16px 24px',
        borderTop: `1px solid ${currentTheme.border}`,
        background: currentTheme.headerBg,
        zIndex: 100
      }}>
        <Button
          type="primary"
          icon={<LeftOutlined />}
          disabled={!navigation?.previous || loading}
          onClick={handlePrevious}
          size={isMobile ? 'middle' : 'large'}
        >
          {!isMobile && '上一章'}
        </Button>
        
        <div style={{ 
          textAlign: 'center',
          color: currentTheme.text,
          fontSize: isMobile ? 12 : 14
        }}>
          <div>{chapter.word_count || 0} 字</div>
          {navigation && (
            <div style={{ fontSize: isMobile ? 10 : 12, opacity: 0.7 }}>
              {navigation.previous ? `← ${navigation.previous.title}` : '已是第一章'}
              {' | '}
              {navigation.next ? `${navigation.next.title} →` : '已是最后一章'}
            </div>
          )}
        </div>
        
        <Button
          type="primary"
          disabled={!navigation?.next || loading}
          onClick={handleNext}
          size={isMobile ? 'middle' : 'large'}
        >
          {!isMobile && '下一章'}
          <RightOutlined />
        </Button>
      </div>
    </Modal>
  );
}