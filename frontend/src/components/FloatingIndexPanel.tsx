import { useState, useMemo, useEffect } from 'react';
import { Drawer, Input, List, Typography, Empty, Tag, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { Chapter } from '../types';
import { eventBus } from '../store/eventBus';
import useIsMobile from '../utils/useIsMobile';

const { Link } = Typography;

interface GroupedChapters {
  outlineId: string | null;
  outlineTitle: string;
  chapters: Chapter[];
}

interface FloatingIndexPanelProps {
  visible: boolean;
  onClose: () => void;
  groupedChapters: GroupedChapters[];
  onChapterSelect: (chapterId: string) => void;
}

export default function FloatingIndexPanel({
  visible,
  onClose,
  groupedChapters,
  onChapterSelect,
}: FloatingIndexPanelProps) {
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const [searchTerm, setSearchTerm] = useState('');

  // 通过事件总线通知 FloatingTaskPanel 等组件 Drawer 的开关状态
  useEffect(() => {
    if (visible) {
      eventBus.emit('drawer:open');
    } else {
      eventBus.emit('drawer:close');
    }
  }, [visible]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm) {
      return groupedChapters;
    }
    return groupedChapters
      .map(group => {
        const filteredChapters = group.chapters.filter(chapter =>
          chapter.title.toLowerCase().includes(searchTerm.toLowerCase())
        );
        return { ...group, chapters: filteredChapters };
      })
      .filter(group => group.chapters.length > 0);
  }, [searchTerm, groupedChapters]);

  const handleChapterClick = (chapterId: string) => {
    onChapterSelect(chapterId);
    onClose();
  };

  return (
    <Drawer
      title="章节目录"
      placement="right"
      onClose={onClose}
      open={visible}
      width={isMobile ? '85%' : 320}
      zIndex={1040}
      styles={{
        body: { padding: 0 },
      }}
    >
      <div style={{ padding: '16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Input
          placeholder="搜索章节标题"
          prefix={<SearchOutlined aria-hidden="true" />}
          aria-label="搜索章节"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          allowClear
        />
      </div>

      <div aria-live="polite">
        {filteredGroups.length > 0 ? (
          <List
            dataSource={filteredGroups}
            renderItem={group => (
              <List.Item style={{ padding: '0 16px', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ padding: '12px 0', fontWeight: 'bold' }}>
                  <Tag color={group.outlineId ? 'blue' : 'default'}>
                    {group.outlineTitle}
                  </Tag>
                </div>
                <List
                  size="small"
                  dataSource={group.chapters}
                  renderItem={chapter => (
                    <List.Item style={{ paddingLeft: 16, borderBlockStart: 'none' }}>
                      <Link onClick={() => handleChapterClick(chapter.id)}>
                        {`第${chapter.chapter_number}章: ${chapter.title}`}
                      </Link>
                    </List.Item>
                  )}
                  split={false}
                />
              </List.Item>
            )}
            style={{ height: 'calc(100vh - 120px)', overflowY: 'auto' }}
          />
        ) : (
          <Empty description="没有找到匹配的章节" style={{ marginTop: 48 }} />
        )}
      </div>
    </Drawer>
  );
}