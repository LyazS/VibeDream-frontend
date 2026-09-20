import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_API_CAPABILITIES': JSON.stringify('auth,account,admin'),
  },
  test: { include: ['test/auth.test.ts'] },
})
