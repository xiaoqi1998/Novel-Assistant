/**
 * 浏览器通知工具
 * 封装 Notification API，提供简洁的通知发送接口
 *
 * 使用方式：
 * - notify('标题', '正文') - 发送通知（仅在页面不在焦点时）
 * - notify('标题', '正文', onClick) - 点击通知时聚焦窗口并执行回调
 *
 * 特性：
 * - 仅在页面不在焦点时（document.hidden === true）发送，避免重复打扰
 * - 首次使用前自动请求权限（Notification.requestPermission()）
 * - 权限被拒绝或不支持时静默降级（不报错）
 * - 点击通知默认聚焦当前窗口（window.focus()）
 */

export type NotificationClickHandler = () => void;

/**
 * 请求通知权限
 * 仅在权限尚未授予且未被拒绝时请求
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * 发送浏览器系统通知
 *
 * @param title 通知标题
 * @param body  通知正文
 * @param onClick 点击通知时的额外回调（window.focus() 已内置）
 *
 * 注意：
 * - 仅在页面不在焦点时（document.hidden === true）发送，避免重复打扰
 * - 如果浏览器不支持通知或权限被拒绝，静默降级（不报错）
 * - 首次使用时会自动请求权限
 */
export async function notify(
  title: string,
  body: string,
  onClick?: NotificationClickHandler
): Promise<void> {
  // 浏览器兼容性检查
  if (!('Notification' in window)) return;

  // 仅在页面不在焦点时发送通知，避免重复打扰
  if (!document.hidden) return;

  // 权限处理：首次使用时自动请求权限
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await requestNotificationPermission();
  }
  if (permission !== 'granted') return; // 权限被拒绝，静默降级

  try {
    const notification = new Notification(title, {
      body,
      icon: '/logo.svg',
      badge: '/favicon.ico',
      tag: 'novel-assistant-task', // 相同 tag 会替换旧通知，避免堆积
      requireInteraction: false, // 允许自动关闭
    });

    // 点击通知：聚焦窗口 + 执行额外回调
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      try {
        onClick?.();
      } catch {
        // ignore
      }
      try {
        notification.close();
      } catch {
        // ignore
      }
    };

    // 5 秒后自动关闭
    setTimeout(() => {
      try {
        notification.close();
      } catch {
        // ignore
      }
    }, 5000);
  } catch {
    // 通知创建失败，静默降级
  }
}
