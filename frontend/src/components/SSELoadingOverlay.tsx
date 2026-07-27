import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Spin, Button, theme, Tooltip } from 'antd';
import { LoadingOutlined, StopOutlined, MinusOutlined } from '@ant-design/icons';

export interface SSELoadingOverlayProps {
  /** 是否显示（overlay 模式惯用字段） */
  loading?: boolean;
  /** 是否显示（modal 模式惯用字段；visible 优先于 loading） */
  visible?: boolean;
  /** 进度 0-100 */
  progress: number;
  /** 状态消息 */
  message: string;
  /** 展示模式：overlay 全屏覆盖层 / modal antd Modal 弹窗 */
  variant?: 'overlay' | 'modal';
  /** 标题 */
  title?: string;
  /** 是否显示百分比 */
  showPercentage?: boolean;
  /** 是否显示顶部 Spin 图标 */
  showIcon?: boolean;
  /** 取消回调 */
  onCancel?: () => void;
  /** 取消按钮文案 */
  cancelText?: string;
  /** 取消按钮文案（modal 模式兼容字段，优先级高于 cancelText） */
  cancelButtonText?: string;
  /** 是否显示"后台运行"按钮，默认 true */
  showMinimize?: boolean;
  /** 最小化时的外部回调（可选，便于父组件感知） */
  onMinimize?: () => void;
}

/** 将毫秒格式化为人类可读时长 */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) {
    return remainSec > 0 ? `${minutes} 分 ${remainSec} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours} 时 ${remainMin} 分` : `${hours} 小时`;
}

/**
 * 统一 SSE 加载组件
 * - variant='overlay'：全屏覆盖层（fixed + 半透明背景 + 居中卡片）
 * - variant='modal'：antd Modal 弹窗
 *
 * 支持 ETA 估算与"后台运行"最小化功能。
 */
export const SSELoadingOverlay: React.FC<SSELoadingOverlayProps> = ({
  loading,
  visible,
  progress,
  message,
  variant = 'overlay',
  title = 'AI生成中...',
  showPercentage = true,
  showIcon = true,
  onCancel,
  cancelText = '取消生成',
  cancelButtonText,
  showMinimize = true,
  onMinimize,
}) => {
  const { token } = theme.useToken();
  const isVisible = visible ?? loading ?? false;

  const startTimeRef = useRef<number | null>(null);
  const [minimized, setMinimized] = useState(false);

  // 可见性切换时重置开始时间与最小化状态
  useEffect(() => {
    if (isVisible) {
      startTimeRef.current = Date.now();
      setMinimized(false);
    } else {
      startTimeRef.current = null;
    }
  }, [isVisible]);

  // 进度回退（新任务复用同一组件实例）时重置开始时间
  const prevProgressRef = useRef(progress);
  useEffect(() => {
    if (isVisible && progress < prevProgressRef.current) {
      startTimeRef.current = Date.now();
    }
    prevProgressRef.current = progress;
  }, [progress, isVisible]);

  // ETA 估算：progress < 5% 时不显示（数据不足）
  const etaText = useMemo(() => {
    if (!isVisible || !startTimeRef.current) return '';
    if (progress < 5 || progress >= 100) return '';
    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed < 1000) return '';
    const rate = progress / elapsed; // progress per ms
    const remainingMs = (100 - progress) / rate;
    if (remainingMs <= 0) return '即将完成';
    return `预计还需 ${formatDuration(remainingMs)}`;
  }, [isVisible, progress]);

  if (!isVisible) return null;

  const handleMinimize = () => {
    setMinimized(true);
    onMinimize?.();
  };
  const handleRestore = () => setMinimized(false);

  // 最小化后：渲染浮动小按钮作为"恢复显示"入口，任务继续在后台运行
  if (minimized) {
    return (
      <Tooltip title="任务后台运行中，点击恢复显示">
        <Button
          type="primary"
          shape="circle"
          icon={<LoadingOutlined />}
          onClick={handleRestore}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 9999,
            boxShadow: token.boxShadowSecondary,
          }}
        />
      </Tooltip>
    );
  }

  const cancelBtnText = cancelButtonText ?? cancelText;
  const isComplete = progress === 100;
  const hasButtons = onCancel || showMinimize;

  const content = (
    <div>
      {/* 标题和图标 */}
      {showIcon && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Spin
            indicator={<LoadingOutlined style={{ fontSize: 48, color: token.colorPrimary }} spin />}
          />
          <div
            style={{
              fontSize: 20,
              fontWeight: 'bold',
              marginTop: 16,
              color: token.colorTextHeading,
            }}
          >
            {title}
          </div>
        </div>
      )}

      {/* 进度条 */}
      <div style={{ marginBottom: showPercentage ? 16 : 24 }}>
        <div
          style={{
            height: 12,
            background: token.colorFillTertiary,
            borderRadius: 6,
            overflow: 'hidden',
            marginBottom: showPercentage ? 12 : 0,
          }}
        >
          <div
            style={{
              height: '100%',
              background: isComplete
                ? `linear-gradient(90deg, ${token.colorSuccess} 0%, ${token.colorSuccessActive} 100%)`
                : `linear-gradient(90deg, ${token.colorPrimary} 0%, ${token.colorPrimaryActive} 100%)`,
              width: `${progress}%`,
              transition: 'all 0.3s ease',
              borderRadius: 6,
              boxShadow: progress > 0 ? token.boxShadow : 'none',
            }}
          />
        </div>

        {/* 进度百分比 */}
        {showPercentage && (
          <div
            style={{
              textAlign: 'center',
              fontSize: 32,
              fontWeight: 'bold',
              color: isComplete ? token.colorSuccess : token.colorPrimary,
              marginBottom: 8,
            }}
          >
            {progress}%
          </div>
        )}
      </div>

      {/* 状态消息 */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 16,
          color: token.colorText,
          minHeight: 24,
          padding: '0 20px',
        }}
      >
        {message || '准备生成...'}
      </div>

      {/* ETA 估算 */}
      {etaText && (
        <div
          style={{
            textAlign: 'center',
            fontSize: 13,
            color: token.colorTextSecondary,
            marginTop: 8,
          }}
        >
          {etaText}
        </div>
      )}

      {/* 提示文字 */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 13,
          color: token.colorTextTertiary,
          marginTop: 16,
          marginBottom: hasButtons ? 16 : 0,
        }}
      >
        请勿关闭页面，生成过程需要一定时间
      </div>

      {/* 按钮组：取消 + 后台运行 */}
      {hasButtons && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 16,
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          {onCancel && (
            <Button danger size="large" icon={<StopOutlined />} onClick={onCancel}>
              {cancelBtnText}
            </Button>
          )}
          {showMinimize && (
            <Button size="large" icon={<MinusOutlined />} onClick={handleMinimize}>
              后台运行
            </Button>
          )}
        </div>
      )}
    </div>
  );

  if (variant === 'modal') {
    return (
      <Modal
        title={null}
        open={isVisible}
        footer={null}
        closable={false}
        centered
        width={500}
        maskClosable={false}
        keyboard={false}
        styles={{ body: { padding: '40px 40px 32px' } }}
      >
        {content}
      </Modal>
    );
  }

  // overlay 模式
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: token.colorBgMask,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: token.colorBgElevated,
          borderRadius: 12,
          padding: '40px 60px',
          minWidth: 400,
          maxWidth: 600,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        {content}
      </div>
    </div>
  );
};

export default SSELoadingOverlay;
