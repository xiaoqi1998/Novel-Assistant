import { message, notification } from 'antd';

const DEFAULT_DURATION = {
  success: 2,
  info: 3,
  warning: 4,
  error: 5, // 错误提示时间稍长
};

const LONG_MESSAGE_THRESHOLD = 50; // 超过 50 字符视为长消息

/**
 * 统一 toast 服务，复用 antd message / notification 静态方法。
 * - success / info / warning：使用 message.*，默认时长按 DEFAULT_DURATION
 * - error：若 content 超过 LONG_MESSAGE_THRESHOLD，自动转 notification.error（右上角持久展示）；
 *   否则使用 message.error
 * - 所有方法支持自定义 duration 覆盖默认值
 */
export const toast = {
  success(content: string, duration?: number): void {
    message.success(content, duration ?? DEFAULT_DURATION.success);
  },

  info(content: string, duration?: number): void {
    message.info(content, duration ?? DEFAULT_DURATION.info);
  },

  warning(content: string, duration?: number): void {
    message.warning(content, duration ?? DEFAULT_DURATION.warning);
  },

  error(content: string, duration?: number): void {
    if (content.length > LONG_MESSAGE_THRESHOLD) {
      notification.error({
        message: '错误',
        description: content,
        duration: duration ?? 0, // 默认不自动关闭
      });
    } else {
      message.error(content, duration ?? DEFAULT_DURATION.error);
    }
  },
};
