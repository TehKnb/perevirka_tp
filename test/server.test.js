import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppServer } from '../server.js';

// Справжній сервер на вільному порту й тимчасова папка замість dist. До Telegram запити не доходять.
let root;
let outside;
let server;
let base;
let port;

beforeAll(async () => {
  outside = await mkdtemp(join(tmpdir(), 'server-test-'));
  root = join(outside, 'dist');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Сайт</title>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log(1);'.repeat(100));
  await writeFile(join(root, 'app.wasm'), Buffer.alloc(1000));
  await writeFile(join(root, 'photo.jpg'), Buffer.alloc(1000));
  await writeFile(join(outside, 'secret.txt'), 'секрет');
  server = createAppServer({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(outside, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** Запит без нормалізації шляху: fetch сам прибрав би «..». */
const rawGet = (path) =>
  new Promise((done, fail) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      done(res.statusCode);
    }).on('error', fail);
  });

function formRequest(headers = {}) {
  const body = new FormData();
  body.append('name', 'Іван');
  return { method: 'POST', body, headers };
}

describe('server: відправка', () => {
  it('POST /api/submit доходить до функції: без змінних оточення — not_configured, а не 405', async () => {
    const res = await fetch(`${base}/api/submit`, formRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'not_configured' });
  });

  it('GET /api/submit — 405, а не сторінка сайту', async () => {
    const res = await fetch(`${base}/api/submit`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  describe('зі змінними оточення', () => {
    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
      process.env.TELEGRAM_CHAT_ID = '-100123';
    });

    it('запит із чужого сайту — 403', async () => {
      const res = await fetch(`${base}/api/submit`, formRequest({ origin: 'https://evil.example' }));
      expect(res.status).toBe(403);
    });

    it('за проксі свій сайт упізнається за x-forwarded-host', async () => {
      const headers = { origin: 'https://check.example', 'x-forwarded-host': 'check.example' };
      const res = await fetch(`${base}/api/submit`, formRequest(headers));
      // Перевірку Origin пройдено; неповна форма зупиняється до звернення в Telegram.
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'missing_fields' });
    });

    it('завеликий запит — 413', async () => {
      const res = await fetch(`${base}/api/submit`, { method: 'POST', body: Buffer.alloc(9 * 1024 * 1024 + 1) });
      expect(res.status).toBe(413);
    });
  });

  it('POST /api/speedtest-upload дочитує дані й відповідає 204', async () => {
    const res = await fetch(`${base}/api/speedtest-upload`, { method: 'POST', body: Buffer.alloc(100_000) });
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('server: файли сайту', () => {
  it('/ віддає index.html із заголовками безпеки', async () => {
    const res = await fetch(`${base}/?debug=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('permissions-policy')).toContain('camera=(self)');
    expect(await res.text()).toContain('Сайт');
  });

  it('файли збірки кешуються надовго, wasm має правильний тип', async () => {
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    const wasm = await fetch(`${base}/app.wasm`);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
  });

  it('стискає текст gzip, а зображення ні', async () => {
    const js = await new Promise((done, fail) => {
      get({ host: '127.0.0.1', port, path: '/assets/app.js', headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done({ encoding: res.headers['content-encoding'], body: Buffer.concat(chunks) }));
      }).on('error', fail);
    });
    expect(js.encoding).toBe('gzip');
    expect(gunzipSync(js.body).toString()).toContain('console.log(1);');
    const jpg = await fetch(`${base}/photo.jpg`, { headers: { 'accept-encoding': 'gzip' } });
    expect(jpg.headers.get('content-encoding')).toBeNull();
  });

  it('повторний запит із ETag — 304', async () => {
    const first = await fetch(`${base}/photo.jpg`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await fetch(`${base}/photo.jpg`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  it('невідомий файл — 404, POST на файл — 405', async () => {
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/index.html`, { method: 'POST' })).status).toBe(405);
  });

  it('не віддає файли поза папкою сайту', async () => {
    expect(await rawGet('/../secret.txt')).toBe(404);
    expect(await rawGet('/%2e%2e/secret.txt')).toBe(404);
    expect(await rawGet('/..%5csecret.txt')).toBe(404);
    expect(await rawGet('/%E0%A4%A')).toBe(404);
  });
});
