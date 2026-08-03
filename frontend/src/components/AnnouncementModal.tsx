import { useEffect, useState } from 'react';
import { Modal, Button, Tag, theme, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import MarkdownRenderer from './MarkdownRenderer';
import { useAnnouncements } from '../hooks/useAnnouncements';
import useIsMobile from '../utils/useIsMobile';
import type { Announcement, AnnouncementLevel } from '../types';

const { Text, Title } = Typography;

const LEVEL_TAG_COLOR: Record<AnnouncementLevel, string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

const LEVEL_TEXT: Record<AnnouncementLevel, string> = {
  info: '通知',
  success: '成功',
  warning: '警告',
  error: '重要',
};

/**
 * 全局公告弹窗
 * 登录后自动拉取未读公告，逐条弹窗展示；用户关闭后记录已读，下次不再弹出。
 */
export default function AnnouncementModal() {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const { announcements, hasUnread, markAllRead } = useAnnouncements();
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [current, setCurrent] = useState<Announcement | null>(null);

  // 当公告列表更新且有未读时，将未读公告加入弹窗队列
  useEffect(() => {
    if (!hasUnread || announcements.length === 0) return;

    // 读取本地已读 ID，过滤出未读
    const readIdsRaw = localStorage.getItem('mobinovel_announcements_read_ids');
    const readIds: string[] = readIdsRaw ? (JSON.parse(readIdsRaw) as string[]) : [];
    const unread = announcements.filter((a) => !readIds.includes(a.id));

    if (unread.length > 0) {
      setQueue(unread);
      setCurrent(unread[0]);
    }
  }, [announcements, hasUnread]);

  const handleClose = () => {
    if (!current) return;

    // 标记当前公告为已读
    const nextQueue = queue.filter((a) => a.id !== current.id);
    setQueue(nextQueue);

    // 写入 localStorage
    try {
      const readIdsRaw = localStorage.getItem('mobinovel_announcements_read_ids');
      const readIds: string[] = readIdsRaw ? (JSON.parse(readIdsRaw) as string[]) : [];
      if (!readIds.includes(current.id)) {
        readIds.push(current.id);
        localStorage.setItem('mobinovel_announcements_read_ids', JSON.stringify(readIds));
      }
    } catch {
      // ignore
    }

    if (nextQueue.length > 0) {
      setCurrent(nextQueue[0]);
    } else {
      setCurrent(null);
      markAllRead();
    }
  };

  if (!current) return null;

  const borderColor =
    current.level === 'error'
      ? token.colorError
      : current.level === 'warning'
        ? token.colorWarning
        : current.level === 'success'
          ? token.colorSuccess
          : token.colorPrimary;

  return (
    <Modal
      open={!!current}
      onCancel={handleClose}
      footer={[
        <Button key="close" type="primary" onClick={handleClose} block={isMobile}>
          我知道了
        </Button>,
      ]}
      width={isMobile ? '92vw' : 640}
      centered={!isMobile}
      style={isMobile ? { top: 10, margin: '0 auto' } : undefined}
      destroyOnClose
      styles={{
        body: {
          padding: isMobile ? '16px' : '20px 24px',
          maxHeight: isMobile ? '70vh' : '60vh',
          overflowY: 'auto',
        },
      }}
    >
      {/* 标题区 */}
      <div style={{ marginBottom: isMobile ? 12 : 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: isMobile ? 'flex-start' : 'center',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 6 : 10,
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, width: '100%' }}>
            <BellOutlined style={{ fontSize: isMobile ? 18 : 20, color: borderColor, flexShrink: 0 }} />
            <Title level={isMobile ? 5 : 4} style={{ margin: 0, flex: 1, fontSize: isMobile ? 16 : undefined }}>
              {current.title}
            </Title>
          </div>
          <Tag color={LEVEL_TAG_COLOR[current.level]} style={{ flexShrink: 0 }}>
            {LEVEL_TEXT[current.level]}
          </Tag>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 8 : 12,
            fontSize: 12,
            flexWrap: 'wrap',
            paddingLeft: isMobile ? 26 : 0,
          }}
        >
          {current.author_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {current.author_name}
            </Text>
          )}
          {current.publish_at && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {new Date(current.publish_at).toLocaleString('zh-CN')}
            </Text>
          )}
          {current.pinned && (
            <Tag color="red" style={{ fontSize: 11, margin: 0 }}>
              置顶
            </Tag>
          )}
        </div>
      </div>

      {/* 分割线 */}
      <div
        style={{
          height: 1,
          background: `linear-gradient(90deg, transparent, ${borderColor}40, transparent)`,
          marginBottom: 16,
        }}
      />

      {/* Markdown 正文 */}
      <MarkdownRenderer content={current.content} />
    </Modal>
  );
}
