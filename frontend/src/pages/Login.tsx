import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Form,
  Grid,
  Input,
  Layout,
  Spin,
  Tabs,
  Typography,
  message,
  theme,
} from 'antd';
import {
  LockOutlined,
  MailOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { authApi } from '../services/api';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ThemeSwitch from '../components/ThemeSwitch';

const { Title, Paragraph } = Typography;

interface AuthConfig {
  // 新字段：New API 对齐后的认证开关
  newapi_auth_enabled: boolean;
  newapi_register_enabled: boolean;
  // 兼容旧字段（恒 false，保留以避免历史代码报错）
  local_auth_enabled: boolean;
  linuxdo_enabled: boolean;
  email_auth_enabled: boolean;
  email_register_enabled: boolean;
}

interface NewApiLoginValues {
  username: string;
  password: string;
}

interface NewApiRegisterValues {
  username: string;
  password: string;
  confirmPassword: string;
  email?: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    newapi_auth_enabled: false,
    newapi_register_enabled: false,
    local_auth_enabled: false,
    linuxdo_enabled: false,
    email_auth_enabled: false,
    email_register_enabled: false,
  });
  const [newApiLoginForm] = Form.useForm<NewApiLoginValues>();
  const [newApiRegisterForm] = Form.useForm<NewApiRegisterValues>();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;
  const primaryButtonShadow = `0 8px 20px ${alphaColor(token.colorPrimary, 0.28)}`;

  const newapiAuthEnabled = authConfig.newapi_auth_enabled;
  const newapiRegisterEnabled = authConfig.newapi_register_enabled;

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await authApi.getCurrentUser();
        const redirect = searchParams.get('redirect') || '/';
        navigate(redirect);
      } catch {
        try {
          const config = await authApi.getAuthConfig();
          setAuthConfig(config as AuthConfig);
        } catch (error) {
          console.error('获取认证配置失败:', error);
          setAuthConfig({
            newapi_auth_enabled: true,
            newapi_register_enabled: true,
            local_auth_enabled: false,
            linuxdo_enabled: false,
            email_auth_enabled: false,
            email_register_enabled: false,
          });
        }
        setChecking(false);
      }
    };
    checkAuth();
  }, [navigate, searchParams]);

  const handleLoginSuccess = () => {
    message.success('登录成功！');
    const redirect = searchParams.get('redirect') || '/';
    navigate(redirect);
  };

  const handleNewApiLogin = async (values: NewApiLoginValues) => {
    try {
      setLoading(true);
      const response = await authApi.newApiLogin(values.username, values.password);
      if (response.success) {
        handleLoginSuccess();
      }
    } catch (error) {
      console.error('New API 登录失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewApiRegister = async (values: NewApiRegisterValues) => {
    try {
      setLoading(true);
      const response = await authApi.newApiRegister({
        username: values.username,
        password: values.password,
        email: values.email?.trim() || undefined,
      });
      if (response.success) {
        message.success(response.message || '注册成功，已自动登录');
        handleLoginSuccess();
      }
    } catch (error) {
      console.error('New API 注册失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loginTips = useMemo(() => {
    const tips: string[] = [
      '使用 New API 账号登录；如无账号请先注册。',
      '管理员为 New API 的 admin/root 角色账号。',
    ];
    return tips;
  }, []);

  const renderNewApiLogin = () => (
    <Form
      form={newApiLoginForm}
      layout="vertical"
      onFinish={handleNewApiLogin}
      size="large"
      style={{ marginTop: 16 }}
    >
      <Form.Item
        name="username"
        label="账号"
        rules={[{ required: true, message: '请输入账号' }]}
      >
        <Input
          prefix={<UserOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请输入 New API 账号"
          autoComplete="username"
          style={{ height: 46, borderRadius: 12 }}
        />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请输入密码"
          autoComplete="current-password"
          style={{ height: 46, borderRadius: 12 }}
        />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          block
          style={{
            height: 46,
            fontSize: 16,
            fontWeight: 600,
            background: `linear-gradient(90deg, ${token.colorPrimary} 0%, ${alphaColor(token.colorPrimary, 0.86)} 100%)`,
            border: 'none',
            borderRadius: '12px',
            boxShadow: primaryButtonShadow,
          }}
        >
          登录系统
        </Button>
      </Form.Item>
    </Form>
  );

  const renderNewApiRegister = () => (
    <Form
      form={newApiRegisterForm}
      layout="vertical"
      onFinish={handleNewApiRegister}
      size="large"
      style={{ marginTop: 16 }}
    >
      <Form.Item
        name="username"
        label="账号"
        rules={[
          { required: true, message: '请输入账号' },
          { min: 3, message: '账号至少 3 位' },
        ]}
      >
        <Input
          prefix={<UserOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="设置账号（至少 3 位）"
          autoComplete="username"
          style={{ height: 46, borderRadius: 12 }}
        />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 8, message: '密码至少 8 位' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="设置密码（至少 8 位）"
          autoComplete="new-password"
          style={{ height: 46, borderRadius: 12 }}
        />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        label="确认密码"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再次输入密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请再次输入密码"
          autoComplete="new-password"
          style={{ height: 46, borderRadius: 12 }}
        />
      </Form.Item>
      <Form.Item
        name="email"
        label="邮箱（选填）"
        rules={[
          { type: 'email', message: '请输入有效的邮箱地址' },
        ]}
      >
        <Input
          prefix={<MailOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="选填，用于密码找回"
          autoComplete="email"
          style={{ height: 46, borderRadius: 12 }}
        />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          block
          style={{
            height: 46,
            fontSize: 16,
            fontWeight: 600,
            background: `linear-gradient(90deg, ${token.colorPrimary} 0%, ${alphaColor(token.colorPrimary, 0.86)} 100%)`,
            border: 'none',
            borderRadius: '12px',
            boxShadow: primaryButtonShadow,
          }}
        >
          注册并登录
        </Button>
      </Form.Item>
      <Paragraph style={{ marginTop: 12, marginBottom: 0, color: token.colorTextSecondary, fontSize: 12 }}>
        注册后即可使用 New API 账号登录墨笔，初始赠送 $5 写作额度。
      </Paragraph>
    </Form>
  );

  const authTabs = [
    ...(newapiAuthEnabled
      ? [
          {
            key: 'newapi-login',
            label: '登录',
            children: renderNewApiLogin(),
          },
        ]
      : []),
    ...(newapiRegisterEnabled
      ? [
          {
            key: 'newapi-register',
            label: '注册',
            children: renderNewApiRegister(),
          },
        ]
      : []),
  ];

  if (checking) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: token.colorBgLayout,
        }}
      >
        <Spin size="large" style={{ color: token.colorPrimary }} />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#0a0a0a', position: 'relative', overflow: 'hidden' }}>
      {/* 右上角 ThemeSwitch 浮窗 - 保留原样 */}
      <div
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 10,
          padding: '8px 10px',
          borderRadius: 12,
          background: alphaColor(token.colorBgContainer, 0.7),
          border: `1px solid ${alphaColor(token.colorPrimary, 0.1)}`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <ThemeSwitch size="small" />
      </div>

      {/* 极光光斑层 */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div className="login-aurora-blob-1" style={{
          position: 'absolute', top: '-15%', left: '-10%',
          width: 480, height: 480, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.55) 0%, transparent 70%)',
          filter: 'blur(80px)',
          willChange: 'transform',
        }} />
        <div className="login-aurora-blob-2" style={{
          position: 'absolute', bottom: '-20%', right: '-10%',
          width: 420, height: 420, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79,70,229,0.45) 0%, transparent 70%)',
          filter: 'blur(80px)',
          willChange: 'transform',
        }} />
        <div className="login-aurora-blob-3" style={{
          position: 'absolute', top: '40%', left: '50%',
          width: 360, height: 360, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(192,38,211,0.30) 0%, transparent 70%)',
          filter: 'blur(80px)',
          willChange: 'transform',
        }} />
        {/* 网格叠加 */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.06) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          opacity: 0.5,
        }} />
      </div>

      {/* 主内容区 */}
      <div style={{
        position: 'relative', zIndex: 1,
        minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? '24px 16px' : '40px 24px',
      }}>
        <div style={{
          width: '100%', maxWidth: 1100,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 24 : 64,
          alignItems: 'center',
        }}>
          {/* 左列：品牌视觉区 */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: isMobile ? 'center' : 'flex-start',
            textAlign: isMobile ? 'center' : 'left',
            color: '#f0f0f0',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              margin: isMobile ? '0 0 16px' : '0 0 24px',
              background: `linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 12px 32px rgba(124,58,237,0.4)',
            }}>
              <img src="/logo.svg" alt="墨笔" style={{ width: 36, height: 36, filter: 'brightness(0) invert(1)' }} />
            </div>
            <h1 style={{
              fontSize: isMobile ? 40 : 64,
              fontWeight: 800,
              margin: 0,
              background: 'linear-gradient(135deg, #f0f0f0 0%, #C4B5FD 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '-0.02em',
            }}>
              墨笔
            </h1>
            <p style={{
              fontSize: isMobile ? 14 : 18,
              color: 'rgba(240,240,240,0.7)',
              margin: isMobile ? '8px 0 0' : '12px 0 0',
              maxWidth: 420,
            }}>
              以墨为笔，绘万千世界。AI 驱动的小说创作助手，让灵感自由流淌。
            </p>
            {!isMobile && (
              <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { icon: '✦', title: '智能生成', desc: '大纲、角色、章节 AI 一键创作' },
                  { icon: '◆', title: '多模型支持', desc: '兼容 OpenAI / DeepSeek / 通义等主流模型' },
                  { icon: '◉', title: '一站式工作流', desc: '从世界观到成书，全流程覆盖' },
                ].map((f) => (
                  <div key={f.title} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: '#7C3AED', fontSize: 18 }}>{f.icon}</span>
                    <span>
                      <strong style={{ color: '#f0f0f0', fontSize: 14 }}>{f.title}</strong>
                      <span style={{ color: 'rgba(240,240,240,0.55)', fontSize: 13, marginLeft: 8 }}>{f.desc}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右列：登录卡 */}
          <div style={{
            width: '100%',
            maxWidth: isMobile ? 420 : 460,
            flexShrink: 0,
          }}>
            <div className="glass-card" style={{
              width: '100%',
              padding: isMobile ? '32px 28px' : '40px 36px',
              borderRadius: 24,
              boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.15)',
            }}>
              <div style={{ marginBottom: 20 }}>
                <Title level={4} style={{ margin: 0, fontWeight: 700, color: token.colorText }}>
                  {isMobile ? '登录墨笔' : '欢迎回来'}
                </Title>
                <Paragraph style={{ margin: '4px 0 0', color: token.colorTextSecondary, fontSize: 12 }}>
                  登录以继续你的小说创作
                </Paragraph>
              </div>

              <div>
                {authTabs.length > 0 ? (
                  <Tabs defaultActiveKey={authTabs[0].key} items={authTabs} />
                ) : null}

                {!newapiAuthEnabled && !newapiRegisterEnabled ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="当前未启用可用登录方式"
                    description="New API 登录未启用，请联系管理员在系统配置中开启 New API。"
                  />
                ) : null}

                <Divider style={{ margin: '20px 0 14px' }} />
                <Alert
                  type="info"
                  showIcon
                  icon={<SafetyCertificateOutlined />}
                  style={{ background: alphaColor(token.colorPrimary, 0.06), borderRadius: 12 }}
                  message="登录说明"
                  description={(
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {loginTips.map((tip) => (
                        <li key={tip} style={{ marginBottom: 4 }}>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  )}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
