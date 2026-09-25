import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    'import.meta.env.VITE_TRANSITION_ASSET_BASE_URL': JSON.stringify('https://assets.example.test'),
  },
  test: { include: ['test/transition-catalog.test.ts'] },
})
