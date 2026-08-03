import { useState, useEffect, useCallback } from 'react';
import {
  Collapse, Tag, Empty, Spin, Timeline, List, Typography, Space, Button, theme
} from 'antd';
import {
  EnvironmentOutlined, GiftOutlined, KeyOutlined, LockOutlined, ReloadOutlined
} from '@ant-design/icons';
import { tianmingApi } from '../services/api';
import type {
  TianmingCharacterStateResponse,
  TianmingItem, TianmingSecret, TianmingVow, TianmingCharacterLocation,
} from '../types';

const { Text, Paragraph } = Typography;

// 状态配置（与 Tianming 页面保持一致）
const ITEM_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: '使用中', color: 'green' },
  destroyed: { label: '已摧毁', color: 'red' },
  lost: { label: '已遗失', color: 'orange' },
  sealed: { label: '已封印', color: 'purple' },
  consumed: { label: '已消耗', color: 'default' },
  transferred: { label: '已转交', color: 'blue' },
};

const SECRET_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  hidden: { label: '完全隐藏', color: 'default' },
  partially_revealed: { label: '部分揭露', color: 'orange' },
  revealed: { label: '已揭露', color: 'blue' },
  public: { label: '公开知晓', color: 'green' },
};

const VOW_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: '生效中', color: 'green' },
  broken: { label: '已违约', color: 'red' },
  fulfilled: { label: '已履行', color: 'blue' },
  expired: { label: '已过期', color: 'default' },
  suspended: { label: '已暂停', color: 'orange' },
};

interface CharacterTianmingPanelProps {
  characterId: string;
  projectId: string;
}

export function CharacterTianmingPanel({ characterId, projectId }: CharacterTianmingPanelProps) {
  const { token } = theme.useToken();
  const [state, setState] = useState<TianmingCharacterStateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!characterId || !projectId) return;
    setLoading(true);
    try {
      const data = await tianmingApi.getCharacterState(projectId, characterId);
      setState(data);
    } catch (e) {
      console.error('加载角色天命状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, [characterId, projectId]);

  useEffect(() => { load(); }, [load]);

  const items = state?.items || [];
  const secrets = state?.secrets || [];
  const vows = state?.vows || [];
  const locations = state?.locations || [];

  const collapseItems = [
    {
      key: 'locations',
      label: (
        <Space>
          <EnvironmentOutlined style={{ color: token.colorPrimary }} />
          <span>位置历史</span>
          <Tag>{locations.length}</Tag>
        </Space>
      ),
      children: (
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {locations.length === 0 ? (
            <Empty description="暂无位置记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Timeline
              items={locations.map((loc: TianmingCharacterLocation) => ({
                color: loc.is_current ? 'green' : 'gray',
                children: (
                  <div>
                    <Space>
                      <Text strong>{loc.location}</Text>
                      {loc.is_current && <Tag color="green">当前位置</Tag>}
                    </Space>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                      {loc.arrival_chapter_number ? `第${loc.arrival_chapter_number}章到达` : ''}
                      {loc.previous_location ? ` · 来自：${loc.previous_location}` : ''}
                      {loc.reason ? ` · ${loc.reason}` : ''}
                    </div>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      ),
    },
    {
      key: 'items',
      label: (
        <Space>
          <GiftOutlined style={{ color: token.colorSuccess }} />
          <span>持有物品</span>
          <Tag>{items.length}</Tag>
        </Space>
      ),
      children: (
        <List
          size="small"
          dataSource={items}
          locale={{ emptyText: <Empty description="暂无持有物品" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(item: TianmingItem) => (
            <List.Item>
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Space>
                  <Text strong>{item.name}</Text>
                  {item.status && ITEM_STATUS_CONFIG[item.status] && (
                    <Tag color={ITEM_STATUS_CONFIG[item.status].color}>
                      {ITEM_STATUS_CONFIG[item.status].label}
                    </Tag>
                  )}
                </Space>
                {item.description && (
                  <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12 }}>
                    {item.description}
                  </Paragraph>
                )}
              </Space>
            </List.Item>
          )}
        />
      ),
    },
    {
      key: 'secrets',
      label: (
        <Space>
          <KeyOutlined style={{ color: token.colorWarning }} />
          <span>知情秘密</span>
          <Tag>{secrets.length}</Tag>
        </Space>
      ),
      children: (
        <List
          size="small"
          dataSource={secrets}
          locale={{ emptyText: <Empty description="暂无知情秘密" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(secret: TianmingSecret) => (
            <List.Item>
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Space>
                  <Text strong>{secret.title}</Text>
                  {secret.status && SECRET_STATUS_CONFIG[secret.status] && (
                    <Tag color={SECRET_STATUS_CONFIG[secret.status].color}>
                      {SECRET_STATUS_CONFIG[secret.status].label}
                    </Tag>
                  )}
                </Space>
                <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12 }}>
                  {secret.content}
                </Paragraph>
              </Space>
            </List.Item>
          )}
        />
      ),
    },
    {
      key: 'vows',
      label: (
        <Space>
          <LockOutlined style={{ color: token.colorError }} />
          <span>参与誓约</span>
          <Tag>{vows.length}</Tag>
        </Space>
      ),
      children: (
        <List
          size="small"
          dataSource={vows}
          locale={{ emptyText: <Empty description="暂无参与誓约" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(vow: TianmingVow) => (
            <List.Item>
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Space>
                  <Text strong>{vow.title}</Text>
                  {vow.status && VOW_STATUS_CONFIG[vow.status] && (
                    <Tag color={VOW_STATUS_CONFIG[vow.status].color}>
                      {VOW_STATUS_CONFIG[vow.status].label}
                    </Tag>
                  )}
                </Space>
                {vow.content && (
                  <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12 }}>
                    {vow.content}
                  </Paragraph>
                )}
                {vow.deadline_chapter && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    截止：第{vow.deadline_chapter}章
                  </Text>
                )}
              </Space>
            </List.Item>
          )}
        />
      ),
    },
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          天命状态：由章节生成/分析的 CHANGES 自动维护
        </Text>
        <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={load} type="text">
          刷新
        </Button>
      </div>
      {loading && !state ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : (
        <Collapse items={collapseItems} defaultActiveKey={[]} size="small" />
      )}
    </div>
  );
}
