export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_MODE_STORAGE_KEY = 'mobinovel_theme_mode';

// 一次性迁移旧键
try {
  const legacy = localStorage.getItem('mumu_theme_mode');
  if (legacy !== null && localStorage.getItem(THEME_MODE_STORAGE_KEY) === null) {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, legacy);
  }
  localStorage.removeItem('mumu_theme_mode');
} catch (e) {
  // localStorage 不可用时忽略
}

const isThemeMode = (value: string | null): value is ThemeMode => {
  return value === 'light' || value === 'dark' || value === 'system';
};

export const getStoredThemeMode = (): ThemeMode => {
  try {
    const value = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (isThemeMode(value)) {
      return value;
    }
  } catch (error) {
    console.warn('读取主题模式失败:', error);
  }

  return 'dark';
};

export const setStoredThemeMode = (mode: ThemeMode): void => {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('保存主题模式失败:', error);
  }
};

export const getThemeModeStorageKey = (): string => THEME_MODE_STORAGE_KEY;
