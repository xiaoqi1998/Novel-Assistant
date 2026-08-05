/**
 * 应用版本信息配置
 * 版本号遵循语义化版本规范 (Semantic Versioning)
 *
 * 注意：版本号从 package.json 自动读取，无需手动维护
 */

export const VERSION_INFO = {
  // 应用版本号（从 package.json 读取，构建时注入）
  version: import.meta.env.VITE_APP_VERSION || '1.0.0',

  // Git 短 hash（构建时由 Vite 注入，用于精确定位代码版本）
  gitHash: import.meta.env.VITE_GIT_HASH || 'unknown',

  // 构建时间（将在构建时由 Vite 注入）
  buildTime: import.meta.env.VITE_BUILD_TIME || new Date().toISOString().split('T')[0],
  
  // 项目信息
  projectName: '墨笔',
  projectFullName: '墨笔 AI 小说创作助手',
  
  // 链接信息（留空则不展示外部链接）
  githubUrl: '',
  linuxDoUrl: '',

  // 许可证
  license: '',
  licenseUrl: '',

  // 作者信息
  author: '墨笔',
};

/**
 * 获取格式化的版本信息（如 v2.0.0 (abc1234)）
 */
export const getVersionString = () => {
  return `v${VERSION_INFO.version}`;
};

/**
 * 获取带 Git hash 的版本标识（如 v2.0.0 (abc1234)）
 */
export const getVersionWithHash = () => {
  if (VERSION_INFO.gitHash && VERSION_INFO.gitHash !== 'unknown') {
    return `v${VERSION_INFO.version} (${VERSION_INFO.gitHash})`;
  }
  return getVersionString();
};

/**
 * 获取完整的版本描述
 */
export const getFullVersionInfo = () => {
  return `${VERSION_INFO.projectName} ${getVersionWithHash()} - Build ${VERSION_INFO.buildTime}`;
};