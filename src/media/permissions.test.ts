import { describe, expect, it } from 'vitest';
import { detectBrowser } from '../env';
import { permissionHelp } from '../texts';
import { blockedKind, denialMode, shouldRetry, type MediaPermissions } from './permissions';

const p = (camera: MediaPermissions['camera'], microphone: MediaPermissions['microphone']): MediaPermissions => ({
  camera,
  microphone,
});

describe('denialMode', () => {
  it('заборону запам’ятано — лише вручну', () => {
    expect(denialMode(p('denied', 'denied'))).toBe('blocked');
    expect(denialMode(p('granted', 'denied'))).toBe('blocked');
  });
  it('вікно просто закрили — повтор покаже його знову', () => {
    expect(denialMode(p('prompt', 'prompt'))).toBe('dismissed');
    expect(denialMode(p('granted', 'prompt'))).toBe('dismissed');
  });
  it('браузер не повідомляє — невідомо', () => {
    expect(denialMode(p('unknown', 'unknown'))).toBe('unknown');
    expect(denialMode(p('prompt', 'unknown'))).toBe('unknown');
  });
});

describe('blockedKind', () => {
  it('інструкція згадує лише заблокований пристрій', () => {
    expect(blockedKind(p('denied', 'granted'))).toBe('camera');
    expect(blockedKind(p('prompt', 'denied'))).toBe('microphone');
    expect(blockedKind(p('denied', 'denied'))).toBe('both');
  });
});

describe('shouldRetry', () => {
  it('заборону знято в налаштуваннях — повторюємо самі', () => {
    expect(shouldRetry(p('denied', 'denied'), p('granted', 'granted'))).toBe(true);
    expect(shouldRetry(p('denied', 'denied'), p('prompt', 'prompt'))).toBe(true);
  });
  it('ще щось заборонено або нічого не змінилося — чекаємо', () => {
    expect(shouldRetry(p('denied', 'denied'), p('granted', 'denied'))).toBe(false);
    expect(shouldRetry(p('prompt', 'prompt'), p('prompt', 'prompt'))).toBe(false);
    expect(shouldRetry(p('unknown', 'unknown'), p('unknown', 'unknown'))).toBe(false);
  });
});

describe('detectBrowser', () => {
  const ua = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/126.0.0.0',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  };
  it('розпізнає основні браузери', () => {
    for (const [id, s] of Object.entries(ua)) expect(detectBrowser(s)).toBe(id);
    expect(detectBrowser('curl/8')).toBe('other');
  });
});

describe('permissionHelp', () => {
  it('Chrome, заблоковано: кроки з перемикачами й автопродовження', () => {
    const h = permissionHelp('blocked', 'both', 'chrome', true);
    expect(h.body).toContain('запам’ятав заборону');
    expect(h.steps.join(' ')).toContain('«Камера» і «Мікрофон»');
    expect(h.footer).toContain('продовжить сама');
  });
  it('заблоковано лише мікрофон — про камеру не згадуємо', () => {
    const h = permissionHelp('blocked', 'microphone', 'edge', true);
    expect(h.steps.join(' ')).not.toContain('Камера');
  });
  it('вікно закрили: спершу повтор, кроки — запасний варіант', () => {
    const h = permissionHelp('dismissed', 'both', 'chrome', true);
    expect(h.body).toContain('Спробувати ще раз');
    expect(h.stepsLead).toBeTruthy();
  });
  it('Firefox без Permissions API: повтор уже є в кроках, окремого підсумку немає', () => {
    const h = permissionHelp('unknown', 'both', 'firefox', false);
    expect(h.steps.at(-1)).toContain('Спробувати ще раз');
    expect(h.footer).toBe('');
  });
});
