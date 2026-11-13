import { describe, expect, it } from 'vitest';
import { config } from '../config';
import {
  cloudflareRttMs,
  mbps,
  median,
  serverProcessingMs,
  speedProblems,
  speedServers,
  steadyMbps,
  withBust,
  type SpeedResult,
} from './speedTest';

const result = (
  downloadMbps: number | null,
  uploadMbps: number | null,
  pingMs = 200,
  network: SpeedResult['network'] = { kind: 'other' },
): SpeedResult => ({
  downloadMbps,
  uploadMbps,
  pingMs,
  server: 'cloudflare',
  connection: null,
  network,
});
const mobile: SpeedResult['network'] = { kind: 'mobile', operator: 'Київстар', source: 'ip' };

describe('speedProblems', () => {
  it('пінг не перевіряється навіть дуже великий', () => {
    expect(speedProblems(result(50, 20, 500), config.network)).toEqual([]);
  });
  it('повільне завантаження й віддача', () => {
    expect(speedProblems(result(10, 5), config.network)).toEqual(['download', 'upload']);
  });
  it('рівно на порогах — проходить', () => {
    expect(speedProblems(result(20, 10), config.network)).toEqual([]);
  });
  it('мобільний інтернет: швидкість не міряли — лише одна проблема', () => {
    expect(speedProblems(result(null, null, 30, mobile), config.network)).toEqual(['mobile']);
  });
  it('мобільний інтернет не блокує, якщо rejectMobile вимкнено', () => {
    const c = { ...config.network, rejectMobile: false };
    expect(speedProblems(result(50, 20, 30, mobile), c)).toEqual([]);
  });
  it('тип підключення невідомий — вирішує швидкість', () => {
    expect(speedProblems(result(50, 20, 30, { kind: 'unknown' }), config.network)).toEqual([]);
  });
});

describe('speedServers', () => {
  it('спершу Cloudflare, потім наш сервер з абсолютними адресами', () => {
    const s = speedServers(config.network, 'https://example.vercel.app/');
    expect(s.map((x) => x.name)).toEqual(['cloudflare', 'own']);
    expect(s[0]!.downloadUrl).toContain('speed.cloudflare.com');
    expect(s[1]!.downloadUrl).toBe('https://example.vercel.app/speedtest/download.jpg');
    expect(s[1]!.uploadUrl).toBe('https://example.vercel.app/api/speedtest-upload');
  });
});

describe('withBust', () => {
  it('додає параметр правильним роздільником', () => {
    expect(withBust('https://a.b/x')).toMatch(/^https:\/\/a\.b\/x\?r=\w+$/);
    expect(withBust('https://a.b/x?bytes=1')).toMatch(/^https:\/\/a\.b\/x\?bytes=1&r=\w+$/);
  });
});

describe('mbps / steadyMbps / median', () => {
  it('1 МБ за 1 с = 8 Мбіт/с', () => expect(mbps(1_000_000, 1000)).toBe(8));
  it('steadyMbps не рахує «розгін»', () => {
    // 0.5 МБ за перші 0.6 с, далі 3 МБ за 3.4 с
    expect(steadyMbps(500_000, 3_500_000, 600, 4000)).toBeCloseTo(mbps(3_000_000, 3400), 9);
  });
  it('median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe('пінг із Server-Timing Cloudflare', () => {
  // Справжній заголовок speed.cloudflare.com (два записи Server-Timing, як їх склеює браузер).
  const header =
    'cfSpeedEdge;dur=3, cfSpeedWorker;dur=24, cfL4;desc="?proto=TCP&rtt=55013&min_rtt=54779&rtt_var=21011&sent=4&recv=6"';

  it('затримка зʼєднання з cfL4 (мікросекунди → мс), а не min_rtt', () => {
    expect(cloudflareRttMs(header)).toBeCloseTo(55.013, 3);
  });

  it('без cfL4 — null (запасний сервер)', () => {
    expect(cloudflareRttMs(null)).toBeNull();
    expect(cloudflareRttMs('cfSpeedEdge;dur=3')).toBeNull();
  });

  it('час обробки на сервері — сума dur', () => {
    expect(serverProcessingMs(header)).toBe(27);
    expect(serverProcessingMs(null)).toBe(0);
  });
});
