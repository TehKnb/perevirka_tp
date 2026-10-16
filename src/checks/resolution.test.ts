import { describe, expect, it } from 'vitest';
import { checkResolution } from './resolution';

const min = { minWidth: 1280, minHeight: 720 };

describe('checkResolution', () => {
  it('Full HD проходить', () => {
    expect(checkResolution({ width: 1920, height: 1080 }, min)).toEqual({ ok: true, width: 1920, height: 1080 });
  });
  it('рівно 720p проходить', () => {
    expect(checkResolution({ width: 1280, height: 720 }, min).ok).toBe(true);
  });
  it('640×480 не проходить', () => {
    expect(checkResolution({ width: 640, height: 480 }, min).ok).toBe(false);
  });
  it('1280×960 (4:3) проходить', () => {
    expect(checkResolution({ width: 1280, height: 960 }, min).ok).toBe(true);
  });
  it('портретний 720×1280 проходить', () => {
    expect(checkResolution({ width: 720, height: 1280 }, min).ok).toBe(true);
  });
  it('невідома роздільність не проходить', () => {
    expect(checkResolution({}, min)).toEqual({ ok: false, width: 0, height: 0 });
  });
});
