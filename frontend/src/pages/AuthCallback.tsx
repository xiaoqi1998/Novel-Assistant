import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FullScreenLoading from '../components/FullScreenLoading';

/**
 * 认证回调占位页
 *
 * 历史上用于 LinuxDO OAuth 回调后展示"首次登录设置密码"弹窗。
 * 已对齐 New API 账号体系后，LinuxDO OAuth 已移除，本页仅保留路由兼容，
 * 直接重定向到首页（已登录）或登录页（未登录）。
 */
export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // 直接跳转首页；若未登录会被 ProtectedRoute 拦截到 /login
    const redirect = sessionStorage.getItem('login_redirect') || '/';
    sessionStorage.removeItem('login_redirect');
    navigate(redirect, { replace: true });
  }, [navigate]);

  return <FullScreenLoading tip="正在跳转…" />;
}
