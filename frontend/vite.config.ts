import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

// 读取 package.json 获取版本号
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
)

// 获取 Git 短 hash（优先使用外部注入的 VITE_GIT_HASH 环境变量，如 Docker 构建；
// 否则本地执行 git rev-parse，非 Git 环境降级为 unknown）
function getGitHash(): string {
  let hash = ''
  if (process.env.VITE_GIT_HASH) {
    hash = process.env.VITE_GIT_HASH
  } else {
    try {
      hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return 'unknown'
    }
  }
  // 统一截断为 7 位短 hash（兼容 CI 传入的完整 SHA）
  return hash ? hash.slice(0, 7) : 'unknown'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // esbuild 配置：生产构建时移除 console 与 debugger
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  // 定义全局常量，在构建时注入
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.VITE_GIT_HASH': JSON.stringify(getGitHash()),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(
      new Date().toISOString().split('T')[0]
    ),
  },
  build: {
    outDir: '../backend/static',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 手动分割代码块,将大型依赖库分离
        manualChunks: {
          // React 核心库
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Ant Design UI库（最大的依赖）
          'vendor-antd': ['antd', '@ant-design/icons'],
          // 其他工具库
          'vendor-utils': ['axios', 'dayjs', 'zustand'],
          // Diff查看器（较大的组件）
          'vendor-diff': ['react-diff-viewer-continued'],
          // 拖拽库
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/generated-assets': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
}))
