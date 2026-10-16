import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // У розробці /api проксіюється на тестовий Node-сервер (етап 5).
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
