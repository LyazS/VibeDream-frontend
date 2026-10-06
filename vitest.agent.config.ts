import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') },
  test: {
    include: ['test/agent-client.test.ts', 'test/agent-module.test.ts', 'test/agent-tools.test.ts'],
  },
})
