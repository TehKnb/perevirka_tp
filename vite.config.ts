import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Локальний аналог функції Vercel api/speedtest-upload.js: приймає дані для заміру віддачі
 * й відкидає їх. Потрібен, щоб перевірка інтернету працювала в `npm run dev` і `npm run preview`.
 */
function speedtestUpload(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/api/speedtest-upload')) return next();
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    req.on('data', () => {});
    req.on('end', () => {
      res.statusCode = 204;
      res.setHeader('Cache-Control', 'no-store');
      res.end();
    });
  };
  return {
    name: 'speedtest-upload',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [speedtestUpload()],
  server: {
    // Решта /api у розробці проксіюється на тестовий Node-сервер (етап 5).
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
