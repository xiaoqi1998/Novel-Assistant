import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeMode } from './themeStorage';

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

// 主色：紫色作为强调（按钮/选中/链接），不主导整体观感
const sharedToken: ThemeConfig['token'] = {
  colorPrimary: '#7C3AED',
  borderRadius: 10,
  wireframe: false,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fontSize: 14,
  controlHeight: 36,
};

const sharedComponents: ThemeConfig['components'] = {
  Button: {
    borderRadius: 10,
    controlHeight: 36,
    primaryShadow: '0 4px 12px rgba(124, 58, 237, 0.25)',
  },
  Card: {
    borderRadiusLG: 14,
    paddingLG: 20,
  },
  Tooltip: {
    colorBgSpotlight: sharedToken.colorPrimary,
    borderRadius: 8,
  },
  Input: {
    borderRadius: 10,
    controlHeight: 38,
  },
  Select: {
    borderRadius: 10,
  },
  Modal: {
    borderRadiusLG: 14,
  },
  Tag: {
    borderRadiusSM: 6,
  },
};

const lightThemeConfig: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorBgBase: '#F5F3FF',
    colorTextBase: '#1E1B2E',
    colorBgLayout: '#F5F3FF',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorderSecondary: '#E9D5FF',
  },
  components: {
    ...sharedComponents,
    Layout: {
      bodyBg: '#F5F3FF',
      headerBg: 'rgba(255,255,255,0.65)',
      siderBg: 'rgba(255,255,255,0.55)',
    },
    Menu: {
      itemSelectedBg: 'rgba(124,58,237,0.08)',
      itemSelectedColor: '#7C3AED',
      itemHoverBg: 'rgba(124,58,237,0.04)',
      itemBorderRadius: 8,
    },
  },
};

// 暗黑主题：纯黑系背景 + 深灰卡片 + 紫色仅作强调
const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...sharedToken,
    colorBgBase: '#0a0a0a', // 纯黑底
    colorTextBase: '#f0f0f0', // 高对比白字
    colorBgLayout: '#0a0a0a',
    colorBgContainer: '#141414', // 卡片深灰
    colorBgElevated: '#1a1a1a', // 弹出层
    colorBorderSecondary: '#262626', // 低明度边框
    colorBorder: '#333333',
  },
  components: {
    ...sharedComponents,
    Layout: {
      bodyBg: '#0a0a0a',
      headerBg: 'rgba(20,20,20,0.85)', // 深灰玻璃态
      siderBg: 'rgba(18,18,18,0.9)',
    },
    Menu: {
      itemSelectedBg: 'rgba(124,58,237,0.18)',
      itemSelectedColor: '#A78BFA',
      itemHoverBg: 'rgba(124,58,237,0.08)',
      itemBorderRadius: 8,
    },
    Card: {
      borderRadiusLG: 14,
      paddingLG: 20,
      colorBgContainer: '#141414',
    },
  },
};

export const getThemeConfig = (mode: ResolvedThemeMode): ThemeConfig => {
  return mode === 'dark' ? darkThemeConfig : lightThemeConfig;
};
