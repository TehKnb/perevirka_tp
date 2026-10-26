import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { loadEnv, type Connect, type Plugin } from 'vite';
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

/**
 * Локальний запуск функції Vercel api/submit.js (відправка в Telegram) у `npm run dev` і `npm run preview`.
 * Токен і чат беруться з .env.local (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_THREAD_ID).
 */
function localSubmitApi(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/submit')) return next();
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const mod = await import(`${pathToFileURL(resolve('api/submit.js')).href}?t=${Date.now()}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: 'POST',
        headers,
        body: Readable.toWeb(req) as ReadableStream,
        duplex: 'half',
      } as RequestInit);
      const response: Response = await mod.POST(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      next(err);
    }
  };
  return {
    name: 'local-submit-api',
    configResolved(config) {
      Object.assign(process.env, loadEnv(config.mode, process.cwd(), 'TELEGRAM_'));
    },
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [speedtestUpload(), localSubmitApi()],
  server: {
    // Решта /api у розробці проксіюється на тестовий Node-сервер (етап 5).
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.js'],
    environment: 'node',
  },
});
