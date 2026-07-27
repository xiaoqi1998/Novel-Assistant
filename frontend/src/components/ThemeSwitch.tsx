import { Segmented, Tooltip, Switch } from 'antd';
import { BulbOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons';
import { useThemeMode } from '../theme/useThemeMode';
import type { ThemeMode } from '../theme/themeStorage';
import type { ReactNode } from 'react';

interface ThemeSwitchProps {
  size?: 'small' | 'middle' | 'large';
  block?: boolean;
}

const options: Array<{ value: ThemeMode; label: ReactNode }> = [
  {
    value: 'light',
    label: (
      <Tooltip title="浅色模式">
        <BulbOutlined />
      </Tooltip>
    ),
  },
  {
    value: 'dark',
    label: (
      <Tooltip title="深色模式">
        <MoonOutlined />
      </Tooltip>
    ),
  },
];

export default function ThemeSwitch({ size = 'middle', block = false }: ThemeSwitchProps) {
  const { mode, resolvedMode, setMode } = useThemeMode();

  const isSystemMode = mode === 'system';
  // system 模式下 Segmented 显示当前解析出的 light/dark（只读高亮）
  const segmentedValue: ThemeMode = isSystemMode ? resolvedMode : mode;

  const handleSegmentedChange = (value: ThemeMode) => {
    // 直接选择 light/dark 会退出 system 模式
    setMode(value);
  };

  const handleSystemToggle = (checked: boolean) => {
    setMode(checked ? 'system' : resolvedMode);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <Segmented
        size={size}
        value={segmentedValue}
        onChange={(value) => handleSegmentedChange(value as ThemeMode)}
        options={options}
        block={block}
        style={block ? { flex: 1 } : undefined}
      />
      <Tooltip title={isSystemMode ? '跟随系统（点击退出）' : '跟随系统（点击启用）'}>
        <Switch
          size="small"
          checked={isSystemMode}
          onChange={handleSystemToggle}
          checkedChildren={<DesktopOutlined />}
          unCheckedChildren={<DesktopOutlined />}
        />
      </Tooltip>
    </div>
  );
}
