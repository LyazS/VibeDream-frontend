import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import removeConsole from 'vite-plugin-remove-console'

function getNodeModulePackageName(id: string): string | null {
  const normalizedId = id.replaceAll('\\', '/')
  const nodeModulesMarker = '/node_modules/'
  const markerIndex = normalizedId.lastIndexOf(nodeModulesMarker)
  if (markerIndex === -1) return null

  const packagePath = normalizedId.slice(markerIndex + nodeModulesMarker.length)
  const [firstSegment, secondSegment] = packagePath.split('/')
  if (!firstSegment) return null
  if (firstSegment.startsWith('@')) {
    return secondSegment ? `${firstSegment}/${secondSegment}` : null
  }
  return firstSegment
}

function isPackage(packageName: string, names: readonly string[]): boolean {
  return names.some((name) => packageName === name || packageName.startsWith(`${name}/`))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    removeConsole(), // 移除所有console打印
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    minify: 'terser', // 使用terser进行代码压缩
    terserOptions: {
      compress: {
        drop_console: true, // 移除console
        drop_debugger: true, // 移除debugger
      },
    },
    chunkSizeWarningLimit: 1000, // 提高chunk大小警告限制到1000KB
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          const packageName = getNodeModulePackageName(id)
          if (!packageName) return

          if (isPackage(packageName, ['vue', '@vue', 'pinia', 'vue-router'])) {
            return 'vue-vendor'
          }
          if (
            isPackage(packageName, [
              'naive-ui',
              '@css-render',
              'async-validator',
              'css-render',
              'evtd',
              'seemly',
              'treemate',
              'vdirs',
              'vooks',
              'vueuc',
            ])
          ) {
            return 'ui-vendor'
          }
          if (isPackage(packageName, ['mediabunny', '@mediabunny'])) {
            return 'media-vendor'
          }
          if (isPackage(packageName, ['ali-oss', 'aliyun-sdk'])) {
            return 'oss-vendor'
          }
          if (isPackage(packageName, ['markdown-it', 'github-markdown-css'])) {
            return 'markdown-vendor'
          }
          if (isPackage(packageName, ['lodash', 'lodash-es', 'axios', 'dexie'])) {
            return 'utils-vendor'
          }
          if (isPackage(packageName, ['vue-i18n'])) {
            return 'i18n-vendor'
          }
          if (isPackage(packageName, ['remixicon', '@remixicon'])) {
            return 'icon-vendor'
          }
          if (isPackage(packageName, ['@imengyu'])) {
            return 'context-vendor'
          }
          if (isPackage(packageName, ['nanoid', 'p-limit'])) {
            return 'misc-vendor'
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['worker_threads'], // 排除Node.js模块
  },
})
