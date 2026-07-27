import React from 'react';
import { SSELoadingOverlay } from './SSELoadingOverlay';
import type { SSELoadingOverlayProps } from './SSELoadingOverlay';

/**
 * 薄封装：以 modal 模式渲染统一 SSE 加载组件。
 * 仅为向后兼容保留，新代码请直接使用 SSELoadingOverlay 并指定 variant="modal"。
 */
export const SSEProgressModal: React.FC<SSELoadingOverlayProps> = (props) => (
  <SSELoadingOverlay {...props} variant="modal" />
);

export default SSEProgressModal;
