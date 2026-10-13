import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_API_CAPABILITIES': JSON.stringify('agent'),
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'agent-runtime',
          include: ['test/agent-*.test.ts'],
          exclude: ['test/agent-input.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'agent-input',
          environment: './test/vue-host.environment.ts',
          include: ['test/agent-input.test.ts'],
        },
      },
    ],
  },
})
