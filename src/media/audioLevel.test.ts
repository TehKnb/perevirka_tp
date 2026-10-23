import { describe, expect, it } from 'vitest';
import { audioExtension, formatTimer, isTooQuiet, levelFraction, pickAudioMime, rmsDb, secondsUntilMin } from './audioLevel';

describe('rmsDb', () => {
  it('тиша → −100', () => {
    expect(rmsDb(new Float32Array(128))).toBe(-100);
    expect(rmsDb([])).toBe(-100);
  });
  it('повна амплітуда ±1 → 0 дБ', () => {
    expect(rmsDb([1, -1, 1, -1])).toBeCloseTo(0, 6);
  });
  it('амплітуда 0.1 → −20 дБ', () => {
    expect(rmsDb([0.1, -0.1, 0.1, -0.1])).toBeCloseTo(-20, 6);
  });
});

describe('levelFraction', () => {
  it('межі індикатора', () => {
    expect(levelFraction(-80)).toBe(0);
    expect(levelFraction(-30)).toBeCloseTo(0.5);
    expect(levelFraction(5)).toBe(1);
  });
});

describe('pickAudioMime', () => {
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  it('Chrome/Firefox → webm opus', () => {
    expect(pickAudioMime(list, () => true)).toBe('audio/webm;codecs=opus');
  });
  it('Safari → mp4', () => {
    expect(pickAudioMime(list, (t) => t === 'audio/mp4')).toBe('audio/mp4');
  });
  it('нічого не підтримується → null', () => {
    expect(pickAudioMime(list, () => false)).toBeNull();
  });
});

describe('audioExtension', () => {
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/ogg', 'ogg'],
    ['', 'bin'],
  ])('%s → %s', (mime, ext) => expect(audioExtension(mime)).toBe(ext));
});

describe('isTooQuiet', () => {
  const cfg = { minSpeechDb: -42, quietHintAfterMs: 2500, levelWindowMs: 2000 };
  const hist = (dbs: [number, number][]) => dbs.map(([t, db]) => ({ t, db }));
  it('на початку запису не підказуємо', () => {
    expect(isTooQuiet(hist([[1000, -70]]), 0, 1000, cfg)).toBe(false);
  });
  it('тихо всі останні 2 с → підказка', () => {
    expect(isTooQuiet(hist([[2000, -55], [3000, -50], [3900, -60]]), 0, 4000, cfg)).toBe(true);
  });
  it('хоч раз голосно за вікно → не підказуємо', () => {
    expect(isTooQuiet(hist([[2500, -55], [3500, -25], [3900, -60]]), 0, 4000, cfg)).toBe(false);
  });
  it('голосно було давно, зараз тихо → підказка', () => {
    expect(isTooQuiet(hist([[500, -20], [3500, -60], [5900, -58]]), 0, 6000, cfg)).toBe(true);
  });
});

describe('secondsUntilMin', () => {
  it('рахує цілі секунди до мінімуму вгору', () => {
    expect(secondsUntilMin(0, 10)).toBe(10);
    expect(secondsUntilMin(100, 10)).toBe(10);
    expect(secondsUntilMin(9001, 10)).toBe(1);
  });
  it('після мінімуму — 0', () => {
    expect(secondsUntilMin(10000, 10)).toBe(0);
    expect(secondsUntilMin(25000, 10)).toBe(0);
  });
});

describe('formatTimer', () => {
  it('формат хв:сек', () => {
    expect(formatTimer(7400, 30)).toBe('0:07 / 0:30');
    expect(formatTimer(65000, 90)).toBe('1:05 / 1:30');
  });
  it('не більше максимуму', () => {
    expect(formatTimer(45000, 30)).toBe('0:30 / 0:30');
  });
});
