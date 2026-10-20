import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  testMatch: 'opfs.spec.ts',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: 'http://127.0.0.1:5183',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_FILE_SYSTEM_ADAPTER: 'opfs',
      VITE_OPFS_WORKSPACE_ID: 'automation',
      VITE_API_CAPABILITIES: '',
    },
  },
})
