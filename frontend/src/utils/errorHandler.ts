import { message } from 'antd';

/**
 * 判断值是否为带有指定属性的对象
 */
function hasProperty<T extends string>(obj: unknown, key: T): obj is Record<T, unknown> {
  return typeof obj === 'object' && obj !== null && key in obj;
}

/**
 * 从未知错误对象中安全提取字符串消息
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 从错误对象中提取可读的错误消息
 * 优先级：error.response.data.detail > error.response.data.message > error.message > 网络错误兜底 > 默认兜底
 */
export function extractErrorMessage(error: unknown): string {
  // 1. axios 错误格式：error.response.data.detail
  if (hasProperty(error, 'response') && hasProperty(error.response, 'data')) {
    const data = (error as { response: { data: unknown } }).response.data;
    if (hasProperty(data, 'detail')) {
      const detail = asString(data.detail);
      if (detail) return detail;
    }
    // 2. error.response.data.message
    if (hasProperty(data, 'message')) {
      const msg = asString(data.message);
      if (msg) return msg;
    }
  }

  // 3. error.message
  if (hasProperty(error, 'message')) {
    const msg = asString(error.message);
    if (msg) {
      // 4. 网络错误（无 response 且 message 含 'Network Error'）
      if (!hasProperty(error, 'response') && /Network Error/i.test(msg)) {
        return '网络错误，请检查网络连接';
      }
      return msg;
    }
  }

  // 5. 兜底
  return '操作失败，请重试';
}

/**
 * 提取错误消息并用 antd message.error 展示
 * @param error 错误对象
 * @param fallbackMessage 可选，覆盖默认兜底文案
 */
export function showErrorToast(error: unknown, fallbackMessage?: string): void {
  const extracted = extractErrorMessage(error);
  // 若提取到的是默认兜底文案且调用方提供了 fallbackMessage，则使用 fallbackMessage
  const finalMessage =
    extracted === '操作失败，请重试' && fallbackMessage ? fallbackMessage : extracted;
  message.error(finalMessage);
}
