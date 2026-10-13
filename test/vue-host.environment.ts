import type { Environment } from 'vitest/environments'

export default {
  name: 'vue-host',
  viteEnvironment: 'client',
  setup: () => ({ teardown() {} }),
} satisfies Environment
