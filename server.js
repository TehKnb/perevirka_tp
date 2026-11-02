// Сервер сайту для Railway (`npm start`): роздає зібраний сайт із dist і запускає функції з api/.
// Railway сам ці функції не запускає: без сервера відправка результатів відповідає 405.
// Токен бота береться зі змінних оточення (Railway → Variables), локально:
//   node --env-file=.env.local server.js

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { POST as submit } from './api/submit.js';

const gzipAsync = promisify(gzip);

// Два файли по 4 МБ (ліміт у api/submit.js) плюс текстові поля форми.
const MAX_SUBMIT_BYTES = 9 * 1024 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', // без цього типу браузер не компілює wasm потоково
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.wasm']);

const SECURITY_HEADERS = {
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};

function cacheControl(pathname) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/models/') || pathname.startsWith('/mediapipe/')) return 'public, max-age=604800';
  if (pathname.startsWith('/speedtest/')) return 'public, max-age=0, must-revalidate, no-transform';
  return 'no-cache';
}

/** Шлях до файлу всередині root або null, якщо запит веде за його межі. */
function resolveFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  return file.startsWith(root + sep) ? file : null;
}

/** Тіло запиту або null, якщо воно більше за ліміт (зайве дочитуємо й відкидаємо, щоб встигнути відповісти). */
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  return size <= limit ? Buffer.concat(chunks) : null;
}

/** Запит для функцій з api/: адресу сайту беремо з заголовків, бо за нею api/submit.js звіряє Origin. */
function toWebRequest(req, body) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  const forwarded = req.headers['x-forwarded-host'];
  const host = (typeof forwarded === 'string' && forwarded.split(',')[0]?.trim()) || req.headers.host || 'localhost';
  return new Request(`http://${host}${req.url}`, { method: 'POST', headers, body });
}

async function handleSubmit(req, res) {
  const body = await readBody(req, MAX_SUBMIT_BYTES);
  if (body === null) {
    res.writeHead(413).end();
    return;
  }
  const response = await submit(toWebRequest(req, body));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Замір віддачі (api/speedtest-upload.js): дані дочитуємо й відкидаємо, нічого не зберігаємо. */
async function handleSpeedtestUpload(req, res) {
  for await (const _ of req);
  res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
}

async function serveStatic(root, gzipCache, req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = resolveFile(root, pathname);
  const info = file && (await stat(file).catch(() => null));
  if (!file || !info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  const ext = extname(file);
  const compress = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const etag = `"${info.mtimeMs.toString(36)}-${info.size.toString(36)}${compress ? '-gzip' : ''}"`;
  const headers = {
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
  };
  if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }

  if (compress) {
    // Стискаємо один раз на файл: wasm важить 13 МБ, стискати його на кожен запит надто дорого.
    const key = `${file}:${etag}`;
    if (!gzipCache.has(key)) gzipCache.set(key, await gzipAsync(await readFile(file)));
    const data = gzipCache.get(key);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(createReadStream(file), res);
}

/** Сервер без запуску: окремо від listen, щоб його могли піднімати тести. */
export function createAppServer({ root = fileURLToPath(new URL('./dist', import.meta.url)) } = {}) {
  const dir = resolve(root);
  const gzipCache = new Map();

  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/submit' || pathname === '/api/speedtest-upload') {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' }).end();
        } else if (pathname === '/api/submit') {
          await handleSubmit(req, res);
        } else {
          await handleSpeedtestUpload(req, res);
        }
        return;
      }
      await serveStatic(dir, gzipCache, req, res, pathname);
    } catch (err) {
      console.error(`server: ${req.method} ${pathname} —`, err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createAppServer().listen(port, () => console.log(`Сервер працює на порту ${port}`));
}
