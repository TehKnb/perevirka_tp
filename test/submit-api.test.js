import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/submit.js';

// Справжній Telegram не викликаємо: fetch підмінено, перевіряємо, що саме функція б надіслала.
let calls;

function mockTelegram(fail = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const method = String(url).split('/').pop();
      const fields = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : { name: v.name, type: v.type, size: v.size }]));
      calls.push({ method, fields });
      if (fail[method]) return new Response(JSON.stringify({ ok: false, description: fail[method] }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }));
    }),
  );
}

function request({ origin = 'https://site.example', omit = [], audioType = 'audio/mp4', name = 'Іван <Петренко>' } = {}) {
  const form = new FormData();
  const fields = {
    name,
    stream: 'Пакет Бізнес, потік 7',
    summary: 'Перевірки на момент фото: усі обов’язкові виконано',
    photo: new File([new Uint8Array(2000)], 'photo.jpg', { type: 'image/jpeg' }),
    audio: new File([new Uint8Array(3000)], 'audio.m4a', { type: audioType }),
  };
  for (const [k, v] of Object.entries(fields)) if (!omit.includes(k)) form.append(k, v);
  const headers = origin ? { origin } : {};
  return new Request('https://site.example/api/submit', { method: 'POST', body: form, headers });
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
  process.env.TELEGRAM_CHAT_ID = '-100123';
  process.env.TELEGRAM_THREAD_ID = '555';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api/submit', () => {
  it('надсилає фото з підписом у гілку, потім аудіо відповіддю на нього', async () => {
    mockTelegram();
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(['sendPhoto', 'sendAudio']);
    const photo = calls[0].fields;
    expect(photo.chat_id).toBe('-100123');
    expect(photo.message_thread_id).toBe('555');
    expect(photo.parse_mode).toBe('HTML');
    expect(photo.caption).toContain('Іван &lt;Петренко&gt;');
    expect(photo.caption).toContain('Пакет Бізнес, потік 7');
    expect(photo.caption).toContain('усі обов’язкові виконано');
    expect(photo.photo.type).toBe('image/jpeg');
    const audio = calls[1].fields;
    expect(audio.message_thread_id).toBe('555');
    expect(JSON.parse(audio.reply_parameters).message_id).toBe(101);
    expect(audio.audio.name).toMatch(/\.m4a$/);
  });

  it('OGG — голосове повідомлення, WebM — файлом', async () => {
    mockTelegram();
    await POST(request({ audioType: 'audio/ogg' }));
    expect(calls[1].method).toBe('sendVoice');
    mockTelegram();
    await POST(request({ audioType: 'audio/webm' }));
    expect(calls[1].method).toBe('sendDocument');
  });

  it('якщо Telegram не прийняв аудіо — надсилає файлом', async () => {
    mockTelegram({ sendAudio: 'Bad Request: wrong file' });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(['sendPhoto', 'sendAudio', 'sendDocument']);
  });

  it('помилка Telegram → 502 без подробиць і токена у відповіді', async () => {
    mockTelegram({ sendPhoto: 'Bad Request: chat not found' });
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('TEST_TOKEN');
  });

  it('без обов’язкових полів — 400, у Telegram нічого не йде', async () => {
    mockTelegram();
    for (const omit of [['name'], ['stream'], ['photo'], ['audio']]) {
      expect((await POST(request({ omit }))).status).toBe(400);
    }
    expect((await POST(request({ name: '   ' }))).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('запит з чужого сайту — 403', async () => {
    mockTelegram();
    expect((await POST(request({ origin: 'https://evil.example' }))).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('не налаштовано — 500', async () => {
    mockTelegram();
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect((await POST(request())).status).toBe(500);
  });
});
