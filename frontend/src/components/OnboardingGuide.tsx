import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, Button, Steps, Typography, theme } from 'antd';
import {
  RocketOutlined,
  FolderAddOutlined,
  GlobalOutlined,
  FileTextOutlined,
  StarOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Paragraph, Text } = Typography;

// 辅助：透明度工具（color-mix 实现半透明色）
const alpha = (color: string, a: number): string =>
  `color-mix(in srgb, ${color} ${(a * 100).toFixed(0)}%, transparent)`;

// localStorage 键名（v1 便于后续迭代时强制重新触发）
const ONBOARDING_KEY = 'novel_assistant_onboarding_v1';

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

interface GuideStep {
  icon: ReactNode;
  title: string;
  description: string;
  highlights: string[];
  cta?: { label: string; path: string };
}

const GUIDE_STEPS: GuideStep[] = [
  {
    icon: <RocketOutlined />,
    title: '欢迎使用墨笔',
    description: '你的 AI 小说创作助手。墨笔会帮你构建世界观、生成章节、追踪伏笔，让长篇创作不再卡壳。',
    highlights: [
      '支持都市、玄幻、言情、悬疑等多种题材',
      'AI 生成的同时保留你的最终决定权',
      '完整保留你的写作上下文，章节之间自然衔接',
    ],
  },
  {
    icon: <FolderAddOutlined />,
    title: '第一步：创建项目',
    description: '在「我的书架」点击「创建项目」，填写书名、题材、目标字数。系统会根据题材自动适配提示词与情绪曲线。',
    highlights: [
      '题材决定 AI 写作的风格与节奏',
      '目标字数影响章节拆分与节奏控制',
      '创建后仍可随时修改设定',
    ],
    cta: { label: '前往我的书架', path: '/' },
  },
  {
    icon: <GlobalOutlined />,
    title: '第二步：构建世界观与角色',
    description: '进入项目后，先完善「世界观设定」与「角色档案」。AI 会读取这些设定来生成符合你世界规则的内容。',
    highlights: [
      '世界观：时代背景、势力格局、核心规则',
      '角色：性格、背景、语言指纹、关系网络',
      '角色越多，AI 生成的对话越有辨识度',
    ],
  },
  {
    icon: <FileTextOutlined />,
    title: '第三步：大纲 → 章节',
    description: '在「大纲」页面规划章节骨架，每章会自动规划场景节拍、情绪曲线、章末钩子、信息释放节奏。生成章节时可流式查看 AI 写作过程。',
    highlights: [
      '大纲展开会自动设计章末追读钩子（防止结尾松散）',
      '场景节拍让章节内部结构紧凑',
      '信息节奏控制悬念的释放与保留',
    ],
  },
  {
    icon: <StarOutlined />,
    title: '第四步：反馈与改进',
    description: '阅读章节后给 AI 打分和反馈，墨笔会将你的反馈注入下一章生成。你的反馈会真正影响 AI，越用越懂你。',
    highlights: [
      '评分反馈直接进入下一章的上下文',
      '局部重写：选中文字即可一键改进',
      '章节分析：自动追踪钩子、伏笔、情绪、对话质量',
    ],
    cta: { label: '查看完整使用说明', path: '/help' },
  },
];

export default function OnboardingGuide() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);

  // 首次访问检测
  useEffect(() => {
    const record = readOnboardingRecord();
    if (!record || !record.completed) {
      // 延迟 600ms 弹出，避免和首屏渲染抢资源
      const timer = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

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
    if (current < GUIDE_STEPS.length - 1) {
      setCurrent(current + 1);
    } else {
      handleClose(false);
    }
  };

  const handlePrev = () => {
    if (current > 0) setCurrent(current - 1);
  };

  const handleCta = (path: string) => {
    handleClose(false);
    navigate(path);
  };

  const step = GUIDE_STEPS[current];
  const isLast = current === GUIDE_STEPS.length - 1;

  return (
    <Modal
      open={open}
      onCancel={() => handleClose(true)}
      footer={null}
      closable={false}
      maskClosable={false}
      width={560}
      centered
      styles={{
        mask: {
          // 透明蒙版：半透明黑色，仍能看到背后页面但被弱化
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        },
        body: { padding: 0 },
      }}
      style={{ zIndex: 2000 }}
    >
      <div
        style={{
          borderRadius: 16,
          overflow: 'hidden',
          background: token.colorBgContainer,
        }}
      >
        {/* 顶部图标区 */}
        <div
          style={{
            padding: '32px 32px 16px',
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryBg} 100%)`,
            textAlign: 'center',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: token.colorBgContainer,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              color: token.colorPrimary,
              boxShadow: `0 8px 24px ${token.colorPrimaryBg}`,
              marginBottom: 12,
            }}
          >
            {step.icon}
          </div>
          <Title level={4} style={{ margin: 0, color: token.colorText }}>
            {step.title}
          </Title>
          <div
            style={{
              position: 'absolute',
              top: 16,
              right: 20,
              fontSize: 12,
              color: token.colorTextSecondary,
              background: alpha(token.colorBgContainer, 0.6),
              padding: '2px 10px',
              borderRadius: 10,
            }}
          >
            {current + 1} / {GUIDE_STEPS.length}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ padding: '24px 32px 16px' }}>
          <Paragraph style={{ fontSize: 14, color: token.colorText, marginBottom: 16, lineHeight: 1.7 }}>
            {step.description}
          </Paragraph>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {step.highlights.map((h, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 12px',
                  background: alpha(token.colorPrimary, 0.04),
                  borderRadius: 8,
                  border: `1px solid ${alpha(token.colorPrimary, 0.08)}`,
                }}
              >
                <CheckOutlined style={{ color: token.colorSuccess, marginTop: 3, fontSize: 13 }} />
                <Text style={{ fontSize: 13, color: token.colorText, flex: 1 }}>{h}</Text>
              </div>
            ))}
          </div>

          {/* 步骤指示器 */}
          <Steps
            current={current}
            size="small"
            style={{ marginTop: 16, marginBottom: 4 }}
            items={GUIDE_STEPS.map((s) => ({ title: '', icon: s.icon }))}
          />
        </div>

        {/* 底部按钮区 */}
        <div
          style={{
            padding: '12px 32px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Button type="text" onClick={() => handleClose(true)} style={{ color: token.colorTextSecondary }}>
            跳过引导
          </Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              type="text"
              icon={<QuestionCircleOutlined />}
              onClick={() => handleCta('/help')}
            >
              查看完整说明
            </Button>
            {current > 0 && (
              <Button onClick={handlePrev}>上一步</Button>
            )}
            <Button type="primary" onClick={handleNext} icon={isLast ? <CheckOutlined /> : <RightOutlined />} iconPosition="end">
              {isLast ? '开始创作' : '下一步'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
