import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Modal, Button, Typography, theme } from 'antd';
import {
  FolderAddOutlined,
  GlobalOutlined,
  BookOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  CheckOutlined,
  LeftOutlined,
  CompassOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { alphaColor } from '../utils/color';

const { Title, Paragraph, Text } = Typography;

// localStorage 键名
const ONBOARDING_KEY = 'mobinovel_onboarding_completed';

interface OnboardingRecord {
  completed: boolean;
  completedAt: string;
  skipped: boolean;
}

const readOnboardingRecord = (): OnboardingRecord | null => {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.completed === 'boolean') {
      return parsed as OnboardingRecord;
    }
  } catch (err) {
    console.warn('读取新手引导记录失败:', err);
  }
  return null;
};

const writeOnboardingRecord = (record: OnboardingRecord) => {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn('保存新手引导记录失败:', err);
  }
};

interface CoachStep {
  selector: string;
  icon: ReactNode;
  title: string;
  description: string;
  highlights: string[];
  /** 元素不可见时显示的提示 */
  fallbackNote?: string;
}

const COACH_STEPS: CoachStep[] = [
  {
    selector: '.onboarding-create-btn',
    icon: <FolderAddOutlined />,
    title: '第一步：创建项目',
    description: '点击「创建项目」开始你的第一部小说。填写书名、题材、目标字数，系统会根据题材自动适配提示词与情绪曲线，并初始化项目向导。',
    highlights: [
      '题材决定 AI 写作的风格、节奏与情绪曲线',
      '目标字数影响章节拆分与节奏控制',
      '可选「一对一」或「一对多」大纲章节模式',
      '创建后仍可在世界设定中随时修改',
    ],
  },
  {
    selector: '.onboarding-world-menu',
    icon: <GlobalOutlined />,
    title: '第二步：构建创作设定',
    description: '进入项目后，在侧边栏「创作管理」分组下完善设定数据。这些设定会被 AI 读取，作为后续生成章节、校验一致性的依据。',
    highlights: [
      '世界设定：时代背景、势力格局、核心规则（越完整，AI 越不会"出戏"）',
      '角色管理：主角、配角的性格、外貌、关系；角色卡片可一键跳转',
      '组织 / 职业 / 关系：势力归属、职业阶段、人际网络，供章节生成引用',
      '大纲管理：展开大纲后自动设计章末钩子、场景节拍',
    ],
    fallbackNote: '进入任意项目后可查看此菜单',
  },
  {
    selector: '.onboarding-chapters-menu',
    icon: <BookOutlined />,
    title: '第三步：章节生成与剧情工具',
    description: '在「章节管理」页面 AI 生成章节、流式查看写作过程；每章生成时会自动写入章节快照。配合「剧情分析」「伏笔管理」可追踪剧情节奏与悬念。',
    highlights: [
      '章节管理：AI 流式生成、自动设计钩子/节拍/情绪曲线',
      '生成时自动创建 15 维事实快照与 12 类 CHANGES 声明',
      '剧情分析：按章节回顾冲突进度、节奏曲线',
      '伏笔管理：埋设/回收伏笔，AI 生成时自动引用',
    ],
    fallbackNote: '进入任意项目后可查看此菜单',
  },
  {
    selector: '.onboarding-tianming-menu',
    icon: <CompassOutlined />,
    title: '第四步：天命状态校验与修正',
    description: '「天命状态」是质检中心。章节生成后自动跑前 4 道规则门（毫秒级）；发现问题可手动触发后 2 道 AI 门，再一键应用 AI 修正。',
    highlights: [
      '六道门：协议/引用/一致性/未知实体（规则门）+ 描写一致性/蓝图存在（AI门）',
      '修正循环：AI 生成建议 → 用户确认 → SSE 流式重写 → 自动重新校验',
      '物品/秘密/誓约/位置：章节生成时自动写入，也可手动维护',
      '章节快照：每章保留 15 维事实快照，供前后对比与一致性检查',
    ],
    fallbackNote: '进入任意项目后可查看此菜单',
  },
  {
    selector: '.onboarding-help-btn',
    icon: <ThunderboltOutlined />,
    title: '第五步：创作工具箱',
    description: '侧边栏「创作工具」分组提供进阶能力：调风格、调提示词、扩展 Skill、全文审查。这些都是可选的高阶工具，按需使用。',
    highlights: [
      '写作风格：保存/应用作者风格样本，统一全文语感',
      '提示词工坊：可视化调试与版本管理提示词',
      'Skill 工具箱 / Skill 管理：扩展 AI 能力的插件体系',
      '全文审查：完成后统一审查敏感词、设定冲突、伏笔回收',
    ],
    fallbackNote: '进入任意项目后可查看此菜单',
  },
  {
    selector: '.onboarding-help-btn',
    icon: <QuestionCircleOutlined />,
    title: '第六步：随时查看帮助',
    description: '点击侧边栏的「使用说明」随时查看完整指南、核心功能介绍和常见问题；也可在此重新触发本引导。',
    highlights: [
      '快速开始：本引导可随时重新查看',
      '核心功能：钩子、节拍、情绪曲线、六道门',
      '常见问题：风格、对话、悬念、修正循环',
      '工作流推荐：设定 → 大纲 → 章节 → 天命校验 → 工具润色',
    ],
  },
];

// 计算说明卡片位置（根据目标元素位置智能放置）
const computePopoverPosition = (rect: DOMRect): CSSProperties => {
  const popoverWidth = 340;
  const popoverHeight = 380; // 估算高度（6步引导含4条highlights）
  const gap = 16;
  const margin = 16;

  // 优先放在下方
  if (rect.bottom + popoverHeight + gap < window.innerHeight) {
    return {
      top: rect.bottom + gap,
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - popoverWidth - margin)),
    };
  }
  // 上方
  if (rect.top - popoverHeight - gap > 0) {
    return {
      top: rect.top - popoverHeight - gap,
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - popoverWidth - margin)),
    };
  }
  // 右侧
  if (rect.right + popoverWidth + gap < window.innerWidth) {
    return {
      top: Math.max(margin, Math.min(rect.top, window.innerHeight - popoverHeight - margin)),
      left: rect.right + gap,
    };
  }
  // 左侧
  return {
    top: Math.max(margin, Math.min(rect.top, window.innerHeight - popoverHeight - margin)),
    left: Math.max(margin, rect.left - popoverWidth - gap),
  };
};

export default function OnboardingGuide() {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  // 跳过确认时暂停引导，避免与 Modal.confirm 的 z-index 冲突
  const [paused, setPaused] = useState(false);

  // 首次访问检测
  useEffect(() => {
    const record = readOnboardingRecord();
    if (!record || !record.completed) {
      // 延迟 600ms 弹出，避免和首屏渲染抢资源
      const timer = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  // 监听"重新查看引导"事件（由 HelpPage 按钮触发）
  useEffect(() => {
    const handleRestart = () => {
      setCurrent(0);
      setPaused(false);
      setOpen(true);
    };
    window.addEventListener('onboarding:restart', handleRestart);
    return () => window.removeEventListener('onboarding:restart', handleRestart);
  }, []);

  // 定位目标元素（含重试机制，处理跨页面导航后元素延迟渲染）
  useEffect(() => {
    if (!open) return;
    const step = COACH_STEPS[current];

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const updatePosition = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setTargetRect(rect);
          return;
        }
      }
      // 元素不存在或不可见，重试
      if (attempts < 8) {
        attempts++;
        retryTimer = setTimeout(updatePosition, 120);
      } else {
        setTargetRect(null);
      }
    };

    const initialTimer = setTimeout(updatePosition, 100);

    // 监听 resize 和 scroll 实时更新位置
    const handleResize = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setTargetRect(rect);
        } else {
          setTargetRect(null);
        }
      } else {
        setTargetRect(null);
      }
    };
    // resize 加 debounce，scroll 保持实时
    let resizeTimeoutId: number | undefined;
    const handleDebouncedResize = () => {
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
      resizeTimeoutId = window.setTimeout(handleResize, 150);
    };
    window.addEventListener('resize', handleDebouncedResize);
    window.addEventListener('scroll', handleResize, true);

    return () => {
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('resize', handleDebouncedResize);
      window.removeEventListener('scroll', handleResize, true);
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
    };
  }, [open, current]);

  const handleClose = (skipped: boolean) => {
    writeOnboardingRecord({
      completed: true,
      completedAt: new Date().toISOString(),
      skipped,
    });
    setOpen(false);
    setCurrent(0);
  };

  const handleNext = () => {
    if (current < COACH_STEPS.length - 1) {
      setCurrent(current + 1);
    } else {
      handleClose(false);
    }
  };

  const handlePrev = () => {
    if (current > 0) setCurrent(current - 1);
  };

  const handleSkipClick = () => {
    // 暂停引导，让 Modal.confirm 正常显示在最上层
    setPaused(true);
    Modal.confirm({
      title: '跳过新手引导？',
      content: '您可以随时在帮助页重新查看引导，确定要跳过吗？',
      okText: '确定跳过',
      cancelText: '继续查看',
      onOk: () => {
        handleClose(true);
        setPaused(false);
      },
      onCancel: () => setPaused(false),
    });
  };

  if (!open || paused) return null;

  const step = COACH_STEPS[current];
  const isLast = current === COACH_STEPS.length - 1;
  const hasTarget = !!targetRect;

  const popoverStyle: CSSProperties = hasTarget && targetRect
    ? computePopoverPosition(targetRect)
    : {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };

  return (
    <>
      {/* 高亮遮罩：目标元素可见时用 box-shadow 挖洞，不可见时用全屏遮罩 */}
      {hasTarget && targetRect ? (
        <div
          style={{
            position: 'fixed',
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            border: `2px solid ${token.colorPrimary}`,
            pointerEvents: 'none',
            zIndex: 2000,
            transition: 'top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease',
          }}
        />
      ) : (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            zIndex: 2000,
          }}
        />
      )}

      {/* 说明卡片 */}
      <div
        style={{
          position: 'fixed',
          width: 340,
          maxHeight: 'calc(100vh - 32px)',
          background: token.colorBgContainer,
          borderRadius: 12,
          boxShadow: token.boxShadowSecondary,
          zIndex: 2001,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: hasTarget ? 'top 0.3s ease, left 0.3s ease' : 'none',
          ...popoverStyle,
        }}
      >
        {/* 顶部图标区 */}
        <div
          style={{
            padding: '18px 20px 12px',
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryBg} 100%)`,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: token.colorBgContainer,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                color: token.colorPrimary,
                flexShrink: 0,
                boxShadow: `0 4px 12px ${alphaColor(token.colorPrimary, 0.2)}`,
              }}
            >
              {step.icon}
            </div>
            <Title level={5} style={{ margin: 0, color: token.colorText, flex: 1, lineHeight: 1.3 }}>
              {step.title}
            </Title>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 16,
              fontSize: 11,
              color: token.colorTextSecondary,
              background: alphaColor(token.colorBgContainer, 0.6),
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            {current + 1} / {COACH_STEPS.length}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ padding: '14px 20px 12px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <Paragraph style={{ fontSize: 13, color: token.colorText, marginBottom: 10, lineHeight: 1.6 }}>
            {step.description}
          </Paragraph>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {step.highlights.map((h, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '6px 10px',
                  background: alphaColor(token.colorPrimary, 0.04),
                  borderRadius: 6,
                  border: `1px solid ${alphaColor(token.colorPrimary, 0.08)}`,
                }}
              >
                <CheckOutlined style={{ color: token.colorSuccess, marginTop: 2, fontSize: 12 }} />
                <Text style={{ fontSize: 12, color: token.colorText, flex: 1 }}>{h}</Text>
              </div>
            ))}
          </div>

          {step.fallbackNote && !hasTarget && (
            <div
              style={{
                marginTop: 10,
                padding: '6px 10px',
                background: alphaColor(token.colorWarning, 0.08),
                borderRadius: 6,
                border: `1px solid ${alphaColor(token.colorWarning, 0.16)}`,
                fontSize: 12,
                color: token.colorWarning,
                textAlign: 'center',
              }}
            >
              {step.fallbackNote}
            </div>
          )}
        </div>

        {/* 底部按钮区 */}
        <div
          style={{
            padding: '10px 20px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          <Button type="text" size="small" onClick={handleSkipClick} style={{ color: token.colorTextSecondary }}>
            跳过引导
          </Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {current > 0 && (
              <Button size="small" icon={<LeftOutlined />} onClick={handlePrev}>上一步</Button>
            )}
            <Button size="small" type="primary" onClick={handleNext} icon={isLast ? <CheckOutlined /> : <RightOutlined />} iconPosition="end">
              {isLast ? '开始创作' : '下一步'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
