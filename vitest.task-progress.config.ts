import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_API_CAPABILITIES': JSON.stringify('ai-tasks'),
  },
  test: {
    include: [
      'test/task-progress.test.ts',
      'test/media-analysis.test.ts',
      'test/media-indexing-recovery.test.ts',
      'test/project-timeline-recovery.test.ts',
      'test/asr-cache.test.ts',
      'test/asr-history-command.test.ts',
      'test/asr-subtitle-splitter.test.ts',
    ],
  },
})
