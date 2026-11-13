import { describe, expect, it } from 'vitest';
import { isAspect } from './aspect';

describe('isAspect', () => {
  it('16:9 — широкоформатний кадр', () => {
    expect(isAspect(1920, 1080, 16 / 9)).toBe(true);
    expect(isAspect(1280, 720, 16 / 9)).toBe(true);
    // 1366×768 — майже 16:9
    expect(isAspect(1366, 768, 16 / 9)).toBe(true);
  });

  it('4:3 і квадрат — ні', () => {
    expect(isAspect(640, 480, 16 / 9)).toBe(false);
    expect(isAspect(1280, 960, 16 / 9)).toBe(false);
    expect(isAspect(1080, 1080, 16 / 9)).toBe(false);
  });

  it('невідомий розмір — ні', () => {
    expect(isAspect(0, 0, 16 / 9)).toBe(false);
  });
});
