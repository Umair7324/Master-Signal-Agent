import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 15000,
    // Suppress dotenv / env-var warnings during tests
    env: {
      TWELVEDATA_API_KEY_MASTER: 'test-key-123',
      DISCORD_MASTER_WEBHOOK: 'https://discord.com/api/webhooks/test/test',
    },
  },
});
