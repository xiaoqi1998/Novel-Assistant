import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Card,
  Button,
  Steps,
  Collapse,
  Alert,
  Space,
  theme,
  Row,
  Col,
} from 'antd';
import {
  RocketOutlined,
  FolderAddOutlined,
  GlobalOutlined,
  TeamOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  StarOutlined,
  BulbOutlined,
  QuestionCircleOutlined,
  ArrowLeftOutlined,
  RedoOutlined,
  EditOutlined,
  FireOutlined,
  MessageOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  BookOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

// 透明度工具（color-mix）
const alpha = (color: string, a: number): string =>
  `color-mix(in srgb, ${color} ${(a * 100).toFixed(0)}%, transparent)`;

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: 'AI 生成的章节风格不符合我的预期怎么办？',
    a: '三个层级的调整：(1) 在「角色档案」中填写更详细的性格和语言指纹；(2) 在「写作风格」页面提取你已有章节的文风作为参考；(3) 在「提示词工坊」中自定义模板。最直接的办法是「局部重写」选中不满意的段落一键改进。',
  },
  {
    q: '章节之间出现情节断裂或角色状态错误？',
    a: '检查上一章是否完成了「章节分析」。章节分析会自动更新角色状态、埋入/回收伏笔、记录关键事件。如果跳过分析直接生成下一章，AI 会缺少上下文。建议在批量生成时勾选「自动分析」。',
  },
  {
    q: '生成的章节结尾总是太"圆满"怎么办？',
    a: '墨笔已内置「章末追读钩子」系统，会在大纲展开阶段为每章规划钩子类型（突然揭示、紧急危机、未完成动作等）。如果仍觉得不够，可在「大纲」页面手动修改 expansion_plan 中的 ending_hook 字段。',
  },
  {
    q: '对话听起来都像同一个人在说？',
    a: '在「角色档案」中为每个角色填写：口头禅、常用句式、话语长度偏好（短句/长句）、潜台词倾向（直接/含蓄/反讽）。这些「语言指纹」会注入到章节生成提示词，让 AI 写出有辨识度的对话。',
  },
  {
    q: 'AI 总是透露太多信息，悬念维持不住？',
    a: '墨笔的「信息释放节奏」功能会在大纲展开时规划 reveal_points（何时透露什么）和 withhold_points（保留什么）。在「大纲」页面展开任一章节可以看到 information_rhythm 字段，可手动调整。',
  },
  {
    q: '局部重写和整章重新生成有什么区别？',
    a: '局部重写：选中编辑器中的一段文字（≥10 字符），AI 只重写选中部分，前后文保持不变，适合"小修小补"。整章重新生成：丢弃整章内容重新生成，适合"大改"。中间还有「一键改进」按钮（在选区工具栏中），提供"让对话更有张力""去 AI 味"等预设改进。',
  },
  {
    q: '我打分后 AI 真的会改进吗？',
    a: '会的。你的评分和文字反馈会被写入下一章的上下文（quality_feedback 字段），AI 会看到具体的低分维度和建议。例如你给"对话质量"打 4 分并写"角色声音太像"，下一章生成时 AI 会收到"对话质量待改进，上一章评分 4/10，反馈：角色声音太像"的明确指令。',
  },
  {
    q: '如何让 AI 生成的内容更符合某个具体题材？',
    a: '创建项目时选择正确的题材（都市/玄幻/言情/悬疑）。不同题材会触发不同的提示词策略：玄幻多用「身份反转」钩子，言情多用「两难抉择」钩子，悬疑强调信息差设计。题材也会影响情绪曲线的默认走向。',
  },
];

interface StepItem {
  icon: ReactNode;
  title: string;
  description: string;
  detail: string;
}

const QUICK_STEPS: StepItem[] = [
  {
    icon: <FolderAddOutlined />,
    title: '创建项目',
    description: '在「我的书架」点击创建项目，填写书名、题材、目标字数。',
    detail: '题材决定 AI 的写作策略：都市偏日常对话、玄幻偏世界观铺陈、言情偏情感张力、悬疑偏信息节奏。',
  },
  {
    icon: <GlobalOutlined />,
    title: '构建世界观',
    description: '进入项目 →「世界观设定」，填写时代背景、势力格局、核心规则。',
    detail: '世界观越完整，AI 越不会写出"出戏"的内容。至少填写 3-5 条核心规则。',
  },
  {
    icon: <TeamOutlined />,
    title: '建立角色档案',
    description: '在「角色」页面为每个主要角色填写性格、背景、语言指纹、关系网络。',
    detail: '主角必须有完整档案。配角至少填写性格 + 一条关系。语言指纹（口头禅/句式/潜台词倾向）让对话有辨识度。',
  },
  {
    icon: <FileTextOutlined />,
    title: '规划大纲',
    description: '在「大纲」页面创建章节骨架，每章填关键事件、涉及角色、情绪基调。',
    detail: '展开大纲时 AI 会自动补充：场景节拍、情绪曲线、章末钩子、信息释放节奏。你可以在编辑器中手动调整这些规划。',
  },
  {
    icon: <ThunderboltOutlined />,
    title: '生成章节',
    description: '在「章节」页面点击「AI 创作」，选择写作风格、目标字数、AI 模型，流式生成。',
    detail: '生成完成后建议立即「阅读 → 评分」。评分会直接影响下一章生成质量。',
  },
  {
    icon: <StarOutlined />,
    title: '反馈与迭代',
    description: '阅读章节后打分 + 写反馈；选中段落可局部重写或一键改进。',
    detail: '反馈会被注入下一章的上下文。坚持 3-5 章反馈后，AI 会明显"懂你"。',
  },
];

interface FeatureCard {
  icon: ReactNode;
  title: string;
  description: string;
  color: string;
}

const FEATURES: FeatureCard[] = [
  {
    icon: <FireOutlined />,
    title: '章末追读钩子',
    description: '每章自动规划追读钩子（突然揭示/紧急危机/未完成动作等 13 种类型），防止结尾松散。AI 会按钩子类型撰写最后 200-400 字，让读者欲罢不能。',
    color: '#ff4d4f',
  },
  {
    icon: <EyeOutlined />,
    title: '场景节拍',
    description: '每章自动拆分为 2-4 个场景，每个场景有进入方式、目标、冲突、转折、退出方式。让章节内部结构紧凑，场景转换自然。',
    color: '#1677ff',
  },
  {
    icon: <MessageOutlined />,
    title: '对话质量控制',
    description: '注入对话写作指导：30% 潜台词比例、对话标签多样性（禁止连续"他说/她说"）、角色声音差异化、节奏控制（紧张短句/情感长句）。',
    color: '#52c41a',
  },
  {
    icon: <FieldTimeOutlined />,
    title: '信息释放节奏',
    description: '规划何时透露什么信息（reveal_points）、保留什么悬念（withhold_points）、制造什么信息差（information_gap）。让悬念持续积累而非一次性耗尽。',
    color: '#722ed1',
  },
  {
    icon: <BulbOutlined />,
    title: '情绪曲线',
    description: '每章规划情绪走向：起始 → 中段 → 高潮 → 结尾，以及转折触发点。让情绪起伏符合题材节奏，避免平淡。',
    color: '#fa8c16',
  },
  {
    icon: <BookOutlined />,
    title: '文风学习',
    description: '在「写作风格」页面提取你已有章节的文风特征（句长、节奏、用词偏好）。AI 生成时会注入你的文风，写出"像你写的"内容。',
    color: '#13c2c2',
  },
];

const TIPS: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <EditOutlined />,
    title: '选中文本 → 一键改进',
    desc: '在章节编辑器中选中任意 ≥10 字符的段落，会弹出浮动工具栏。除了"AI 重写"还有"让对话更有张力""去 AI 味""增加描写"等预设按钮。',
  },
  {
    icon: <RedoOutlined />,
    title: '后台生成，继续做别的',
    desc: '章节生成时点击「后台生成」可关闭弹窗，AI 在后台继续写。完成后通知你。适合批量生成多章。',
  },
  {
    icon: <CheckCircleOutlined />,
    title: '坚持反馈 3-5 章',
    desc: '前几章 AI 还在"了解你"，反馈越具体越好。坚持 3-5 章后，AI 会显著改善。',
  },
  {
    icon: <BulbOutlined />,
    title: '卡壳时用「灵感」',
    desc: '章节编辑器右下角有"💡 灵感"浮动按钮，提供"给我 3 个发展方向""帮我写章末钩子""润色这段对话"等快捷灵感辅助。',
  },
];

export default function HelpPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [activeFaq, setActiveFaq] = useState<string[]>([]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 64 }}>
      {/* 顶部 Hero */}
      <Card
        className="glass-card"
        style={{
          marginBottom: 24,
          background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryBg} 100%)`,
          border: 'none',
          color: token.colorText,
        }}
      >
        <Row gutter={[24, 16]} align="middle">
          <Col flex="auto">
            <Space direction="vertical" size={4}>
              <Space>
                <RocketOutlined style={{ fontSize: 32, color: token.colorText }} />
                <Title level={3} style={{ margin: 0, color: token.colorText }}>
                  使用说明
                </Title>
              </Space>
              <Text style={{ color: token.colorText, fontSize: 14, opacity: 0.9 }}>
                墨笔 · AI 小说创作助手 · 让长篇创作不再卡壳
              </Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/')}
                style={{ background: alpha(token.colorBgContainer, 0.6) }}
              >
                返回书架
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 快速开始 */}
      <Card
        title={
          <Space>
            <RocketOutlined style={{ color: token.colorPrimary }} />
            <span>快速开始</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Paragraph type="secondary" style={{ marginBottom: 24 }}>
          从零到生成第一章，只需 6 步。
        </Paragraph>
        <Steps
          current={-1}
          direction="vertical"
          size="small"
          items={QUICK_STEPS.map((s) => ({
            title: (
              <Space>
                <span style={{ color: token.colorPrimary }}>{s.icon}</span>
                <Text strong>{s.title}</Text>
              </Space>
            ),
            description: (
              <div>
                <Paragraph style={{ marginBottom: 4, marginTop: 4 }}>{s.description}</Paragraph>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 4 }}
                  message={<Text type="secondary" style={{ fontSize: 12 }}>{s.detail}</Text>}
                />
              </div>
            ),
          }))}
        />
      </Card>

      {/* 核心功能 */}
      <Card
        title={
          <Space>
            <BulbOutlined style={{ color: token.colorPrimary }} />
            <span>核心写作功能</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          墨笔的写作引擎会在大纲展开和章节生成时自动应用以下能力，让 AI 写出"像专业作家"的内容。
        </Paragraph>
        <Row gutter={[16, 16]}>
          {FEATURES.map((f) => (
            <Col xs={24} sm={12} lg={8} key={f.title}>
              <Card
                size="small"
                hoverable
                style={{ height: '100%' }}
                styles={{ body: { padding: 16 } }}
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: alpha(f.color, 0.12),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: f.color,
                        fontSize: 16,
                      }}
                    >
                      {f.icon}
                    </div>
                    <Text strong>{f.title}</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {f.description}
                  </Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 创作技巧 */}
      <Card
        title={
          <Space>
            <ThunderboltOutlined style={{ color: token.colorWarning }} />
            <span>高效使用技巧</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Row gutter={[16, 16]}>
          {TIPS.map((t, i) => (
            <Col xs={24} sm={12} key={i}>
              <Card size="small" style={{ height: '100%' }}>
                <Space align="start" size={12}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: alpha(token.colorPrimary, 0.1),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: token.colorPrimary,
                      flexShrink: 0,
                    }}
                  >
                    {t.icon}
                  </div>
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>
                      {t.title}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.7 }}>
                      {t.desc}
                    </Text>
                  </div>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* FAQ */}
      <Card
        title={
          <Space>
            <QuestionCircleOutlined style={{ color: token.colorPrimary }} />
            <span>常见问题</span>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Collapse
          accordion
          activeKey={activeFaq}
          onChange={setActiveFaq}
          items={FAQS.map((f, i) => ({
            key: String(i),
            label: <Text strong>{f.q}</Text>,
            children: (
              <Paragraph style={{ paddingLeft: 0, marginBottom: 0, lineHeight: 1.8 }}>
                {f.a}
              </Paragraph>
            ),
          }))}
        />
      </Card>

      {/* 底部 CTA */}
      <Card style={{ textAlign: 'center' }}>
        <Space direction="vertical" size={12}>
          <Title level={4} style={{ margin: 0 }}>
            准备好开始创作了吗？
          </Title>
          <Text type="secondary">从创建你的第一个项目开始，墨笔会一步步引导你。</Text>
          <Space>
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={() => navigate('/')}
            >
              前往我的书架
            </Button>
            <Button
              size="large"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
            >
              返回上一页
            </Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
