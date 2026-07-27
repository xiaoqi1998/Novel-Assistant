import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Result, Button } from 'antd';
import { authApi } from '../services/api';
import { sessionManager } from '../utils/sessionManager';
import FullScreenLoading from './FullScreenLoading';

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState<'unauth' | 'server_error' | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const checkAuth = async () => {
    setError(null);
    setIsAuthenticated(null);
    try {
      await authApi.getCurrentUser();
      setIsAuthenticated(true);
      // 启动会话管理器
      sessionManager.start();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        // 401：未登录或登录态失效，跳转登录
        setError('unauth');
      } else {
        // 5xx 响应或无 response（网络错误）视为服务故障，不跳转登录
        setError('server_error');
      }
      // 停止会话管理器
      sessionManager.stop();
    }
  };

  useEffect(() => {
    checkAuth();

    return () => {
      // 组件卸载时不停止会话管理器，让它在整个应用生命周期内运行
    };
  }, []);

  // 服务故障：展示重试页，不跳转登录
  if (error === 'server_error') {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}>
        <Result
          status="error"
          title="服务暂时不可用"
          subTitle="无法连接到服务器，请稍后重试"
          extra={[
            <Button type="primary" key="retry" onClick={() => checkAuth()}>
              重试
            </Button>,
            <Button key="login" onClick={() => navigate('/login')}>
              返回登录
            </Button>,
          ]}
        />
      </div>
    );
  }

  // 加载态
  if (isAuthenticated === null && error === null) {
    return <FullScreenLoading tip="正在验证身份…" />;
  }

  // 未登录：跳转登录页
  if (error === 'unauth' || !isAuthenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
}
