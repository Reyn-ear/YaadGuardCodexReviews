import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers':
        '/Users/reyneardouglas/InitToWinit26/src/test/cloudflare-workers.ts',
    },
  },
  test: {
    include: ['**/*.test.ts'],
  },
})
