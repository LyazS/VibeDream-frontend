import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { AI_TASK_TYPES } from './src/core/ai-tasks/types'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    'import.meta.env.VITE_TRANSITION_ASSET_BASE_URL': JSON.stringify('https://assets.example.test'),
    'import.meta.env.VITE_API_CAPABILITIES': JSON.stringify(
      ['ai-tasks', ...AI_TASK_TYPES].join(','),
    ),
  },
  test: {
    include: [
      'test/transition-catalog.test.ts',
      'test/transition-search.test.ts',
      'test/timeline-frame-capture.test.ts',
    ],
  },
})
