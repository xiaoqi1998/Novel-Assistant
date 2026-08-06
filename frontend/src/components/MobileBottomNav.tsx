import { useMemo, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { theme, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  FileTextOutlined,
  TeamOutlined,
  BookOutlined,
  EllipsisOutlined,
  GlobalOutlined,
  BankOutlined,
  TrophyOutlined,
  ApartmentOutlined,
  FundOutlined,
  BulbOutlined,
  CompassOutlined,
  EditOutlined,
  CloudOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  AuditOutlined,
} from '@ant-design/icons';

interface MobileBottomNavProps {
  projectId: string;
}

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  path: string;
}

const MORE_ITEMS: MenuProps['items'] = [
  { key: 'world-setting', icon: <GlobalOutlined />, label: '世界设定' },
  { key: 'organizations', icon: <BankOutlined />, label: '组织管理' },
  { key: 'careers', icon: <TrophyOutlined />, label: '职业管理' },
  { key: 'relationships', icon: <ApartmentOutlined />, label: '关系管理' },
  { key: 'chapter-analysis', icon: <FundOutlined />, label: '剧情分析' },
  { key: 'foreshadows', icon: <BulbOutlined />, label: '伏笔管理' },
  { key: 'tianming', icon: <CompassOutlined />, label: '天命状态' },
  { type: 'divider' },
  { key: 'writing-styles', icon: <EditOutlined />, label: '写作风格' },
  { key: 'prompt-workshop', icon: <CloudOutlined />, label: '提示词工坊' },
  { key: 'skill-chat', icon: <ThunderboltOutlined />, label: 'Skill 工具箱' },
  { key: 'skill-manage', icon: <SettingOutlined />, label: 'Skill 管理' },
  { key: 'full-review', icon: <AuditOutlined />, label: '全文审查' },
];

const MobileBottomNav = memo(function MobileBottomNav({ projectId }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const MAIN_ITEMS: NavItem[] = useMemo(
    () => [
      { key: 'outline', icon: <FileTextOutlined />, label: '大纲', path: `/project/${projectId}/outline` },
      { key: 'characters', icon: <TeamOutlined />, label: '角色', path: `/project/${projectId}/characters` },
      { key: 'chapters', icon: <BookOutlined />, label: '章节', path: `/project/${projectId}/chapters` },
    ],
    [projectId]
  );

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    // 先检查主 Tab
    for (const item of MAIN_ITEMS) {
      if (path.includes(`/${item.key}`)) return item.key;
    }
    // 再检查更多中的项目
    if (path.includes('/world-setting')) return 'world-setting';
    if (path.includes('/organizations')) return 'organizations';
    if (path.includes('/careers')) return 'careers';
    if (path.includes('/relationships')) return 'relationships';
    if (path.includes('/chapter-analysis')) return 'chapter-analysis';
    if (path.includes('/foreshadows')) return 'foreshadows';
    if (path.includes('/tianming')) return 'tianming';
    if (path.includes('/writing-styles')) return 'writing-styles';
    if (path.includes('/prompt-workshop')) return 'prompt-workshop';
    if (path.includes('/skill-chat')) return 'skill-chat';
    if (path.includes('/skill-manage')) return 'skill-manage';
    if (path.includes('/full-review')) return 'full-review';
    return 'chapters';
  }, [location.pathname, MAIN_ITEMS]);

  const isMoreActive = !MAIN_ITEMS.some((item) => item.key === selectedKey);

  const handleTabClick = useCallback(
    (key: string) => {
      const item = MAIN_ITEMS.find((i) => i.key === key);
      if (item) {
        navigate(item.path);
      }
    },
    [navigate, MAIN_ITEMS]
  );

  const handleMoreClick: MenuProps['onClick'] = useCallback(
    ({ key }: { key: string }) => {
      navigate(`/project/${projectId}/${key}`);
    },
    [navigate, projectId]
  );

  return (
    <div
      className="mobile-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        background: token.colorBgContainer,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        zIndex: 1000,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: `0 -2px 12px rgba(0, 0, 0, 0.06)`,
      }}
    >
      {MAIN_ITEMS.map((item) => {
        const active = selectedKey === item.key;
        return (
          <button
            key={item.key}
            onClick={() => handleTabClick(item.key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              flex: 1,
              height: '100%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: active ? token.colorPrimary : token.colorTextTertiary,
              fontSize: 20,
              padding: 0,
              WebkitTapHighlightColor: 'transparent',
              transition: 'color 0.2s ease',
            }}
          >
            <span style={{ lineHeight: 1 }}>{item.icon}</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                lineHeight: 1,
                color: active ? token.colorPrimary : token.colorTextTertiary,
              }}
            >
              {item.label}
            </span>
            {active && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 2,
                  width: 20,
                  height: 3,
                  borderRadius: 2,
                  background: token.colorPrimary,
                }}
              />
            )}
          </button>
        );
      })}

      {/* 更多 */}
      <Dropdown menu={{ items: MORE_ITEMS, onClick: handleMoreClick }} placement="top" trigger={['click']}>
        <button
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            flex: 1,
            height: '100%',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: isMoreActive ? token.colorPrimary : token.colorTextTertiary,
            fontSize: 20,
            padding: 0,
            WebkitTapHighlightColor: 'transparent',
            transition: 'color 0.2s ease',
          }}
        >
          <span style={{ lineHeight: 1 }}><EllipsisOutlined /></span>
          <span
            style={{
              fontSize: 10,
              fontWeight: isMoreActive ? 600 : 400,
              lineHeight: 1,
              color: isMoreActive ? token.colorPrimary : token.colorTextTertiary,
            }}
          >
            更多
          </span>
          {isMoreActive && (
            <span
              style={{
                position: 'absolute',
                bottom: 2,
                width: 20,
                height: 3,
                borderRadius: 2,
                background: token.colorPrimary,
              }}
            />
          )}
        </button>
      </Dropdown>
    </div>
  );
});

export default MobileBottomNav;
