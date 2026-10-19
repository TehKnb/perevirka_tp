import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { mbps, median, speedProblems, speedServers, steadyMbps, withBust, type SpeedResult } from './speedTest';

const result = (downloadMbps: number, uploadMbps: number, pingMs = 200): SpeedResult => ({
  downloadMbps,
  uploadMbps,
  pingMs,
  server: 'cloudflare',
  connection: null,
});

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
