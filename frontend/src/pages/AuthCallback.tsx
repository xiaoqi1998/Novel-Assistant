import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin, theme } from 'antd';

/**
 * 认证回调占位页
 *
 * 历史上用于 LinuxDO OAuth 回调后展示"首次登录设置密码"弹窗。
 * 已对齐 New API 账号体系后，LinuxDO OAuth 已移除，本页仅保留路由兼容，
 * 直接重定向到首页（已登录）或登录页（未登录）。
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { token } = theme.useToken();

  useEffect(() => {
    // 直接跳转首页；若未登录会被 ProtectedRoute 拦截到 /login
    const redirect = sessionStorage.getItem('login_redirect') || '/';
    sessionStorage.removeItem('login_redirect');
    navigate(redirect, { replace: true });
  }, [navigate]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryHover} 100%)`,
    }}>
      <div style={{ textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 20, color: token.colorWhite, fontSize: 16 }}>
          正在跳转...
        </div>
      </div>
    </div>
  );
}
