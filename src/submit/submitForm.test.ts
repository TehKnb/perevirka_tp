import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupResult } from '../checks/stability';
import { buildSummary, formErrors, submitResults, SubmitServerError, validateSubmitForm, type Submission } from './submitForm';

const ok = { name: 'Іван Петренко', stream: 'Потік 1', agreed: true };

describe('validateSubmitForm', () => {
  it('заповнена форма — без помилок', () => {
    expect(validateSubmitForm(ok)).toEqual({});
    expect(validateSubmitForm({ ...ok, name: "  Мар'яна   Іванова-Петренко " })).toEqual({});
  });
  it('ім’я: порожнє, одне слово, лише символи', () => {
    expect(validateSubmitForm({ ...ok, name: '   ' }).name).toBe(formErrors.nameEmpty);
    expect(validateSubmitForm({ ...ok, name: 'Іван' }).name).toBe(formErrors.nameOneWord);
    expect(validateSubmitForm({ ...ok, name: 'Іван -' }).name).toBe(formErrors.nameOneWord);
  });
  it('потік і згода обов’язкові', () => {
    expect(validateSubmitForm({ ...ok, stream: '   ' }).stream).toBe(formErrors.stream);
    const e = validateSubmitForm({ ...ok, stream: '', agreed: false });
    expect(e.stream).toBe(formErrors.stream);
    expect(e.agreed).toBe(formErrors.agreed);
  });
});

describe('buildSummary', () => {
  const setup = {
    ok: false,
    stableMs: 0,
    mainHint: '',
    checks: [
      { id: 'fit', status: 'fail', severity: 'hard', value: 0.5, hint: null },
      { id: 'coldLight', status: 'fail', severity: 'soft', value: 1.3, hint: null },
      { id: 'face', status: 'pass', severity: 'hard', value: 1, hint: null },
    ],
  } as unknown as SetupResult;
  const base = {
    captures: {
      screenshot: { blob: new Blob(), width: 1, height: 1, takenAt: '', setup },
      audio: { blob: new Blob(), mime: 'audio/mp4', durationMs: 12400, recordedAt: '', setup: null },
    },
    devices: { camera: 'HD Webcam', microphone: 'USB Headset' },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  } as unknown as Parameters<typeof buildSummary>[0];

  it('що не пройшло, поради, інтернет, пристрої, браузер, тривалість', () => {
    const text = buildSummary({
      ...base,
      network: {
        status: 'done',
        result: { downloadMbps: 43.71, uploadMbps: 61.4, pingMs: 20, server: 'cloudflare', connection: null, network: { kind: 'other' } },
      },
    });
    expect(text).toContain('Не виконано на момент фото: Голова й плечі в контурі');
    expect(text).toContain('Поради: Холодне світло');
    expect(text).toContain('Інтернет: 43.7 / 61.4 Мбіт/с, пінг 20 мс, не мобільний');
    expect(text).toContain('Камера: HD Webcam');
    expect(text).toContain('Мікрофон: USB Headset');
    expect(text).toContain('Запис голосу: 12 с');
    expect(text).toContain('Браузер: Chrome, Windows');
  });

  it('мобільний інтернет і не перевірений інтернет', () => {
    const mobile = buildSummary({
      ...base,
      network: {
        status: 'done',
        result: { downloadMbps: null, uploadMbps: null, pingMs: 20, server: 'cloudflare', connection: null, network: { kind: 'mobile', operator: 'lifecell', source: 'ip' } },
      },
    });
    expect(mobile).toContain('Інтернет: швидкість не міряли, пінг 20 мс, мобільний (lifecell)');
    expect(buildSummary({ ...base, network: null })).toContain('Інтернет: не перевірено');
  });
});

describe('submitResults: помилки', () => {
  afterEach(() => vi.unstubAllGlobals());

  const submission = {
    name: 'Іван Петренко',
    stream: 'Потік 7',
    captures: {
      screenshot: { blob: new Blob(['x'], { type: 'image/jpeg' }) },
      audio: { blob: new Blob(['x'], { type: 'audio/mp4' }), mime: 'audio/mp4', durationMs: 10000 },
    },
    network: null,
    devices: { camera: 'cam', microphone: 'mic' },
    userAgent: 'Windows Chrome',
    submittedAt: '2026-11-02T00:00:00.000Z',
  } as unknown as Submission;
  const submit = { endpoint: '/api/submit', testMode: false } as const;

  it('відповідь сервера з помилкою — збій на нашому боці, а не інтернет учасника', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 405 })));
    await expect(submitResults(submission, submit)).rejects.toBeInstanceOf(SubmitServerError);
  });

  it('запит не дійшов до сервера — звичайна помилка мережі', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await submitResults(submission, submit).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(SubmitServerError);
  });
});
