import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    'import.meta.env.VITE_API_CAPABILITIES': JSON.stringify('media.indexing'),
  },
  test: {
    environment: 'node',
    globals: true,
    include: [
      'test/media-analysis.test.ts',
      'test/preview-playback.test.ts',
      'test/source-texture-uploader.test.ts',
    ],
  },
})
