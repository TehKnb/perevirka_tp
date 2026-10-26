import { describe, expect, it } from 'vitest';
import { computeScale } from './scale';

const design = { width: 1192, height: 772 };

describe('computeScale', () => {
  it('великий монітор — повні 1.5', () => expect(computeScale(2560, 1440, design, 1.5)).toBe(1.5));
  it('Full HD — стільки, скільки вміщається по висоті', () => expect(computeScale(1920, 1080, design, 1.5)).toBe(1.39));
  it('ноутбук — без змін, менше за 1 не зменшуємо', () => {
    expect(computeScale(1366, 768, design, 1.5)).toBe(1);
    expect(computeScale(375, 812, design, 1.5)).toBe(1);
  });
});
