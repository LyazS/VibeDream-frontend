import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { 'import.meta.env.VITE_API_CAPABILITIES': JSON.stringify('chat-demo') },
  test: { include: ['test/cloud-chat-demo.test.ts'] },
})
