import { describe, expect, it } from 'vitest';
import {
  busyBlockFraction,
  edgeDensity,
  erode,
  fractionAbove,
  insetRect,
  lumaPlane,
  meanStd,
  rectMask,
  redBlueRatio,
  sobelEdges,
} from './pixelStats';

/** RGBA-зображення w×h, колір кожного пікселя задає функція. */
function image(w: number, h: number, color: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = color(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return data;
}

const all = (n: number) => new Uint8Array(n).fill(1);

describe('lumaPlane', () => {
  it('білий → 1, чорний → 0, сірий → 0.5', () => {
    const l = lumaPlane(image(3, 1, (x) => (x === 0 ? [255, 255, 255] : x === 1 ? [0, 0, 0] : [128, 128, 128])), 3, 1);
    expect(l[0]).toBeCloseTo(1, 5);
    expect(l[1]).toBe(0);
    expect(l[2]).toBeCloseTo(128 / 255, 5);
  });
});

describe('meanStd', () => {
  it('однотонне → розкид 0', () => {
    const r = meanStd([0.8, 0.8, 0.8, 0.8], all(4));
    expect(r.mean).toBeCloseTo(0.8, 9);
    expect(r.std).toBeCloseTo(0, 9);
    expect(r.count).toBe(4);
  });
  it('враховує лише маску', () => {
    const r = meanStd([0, 1, 0, 1], [0, 1, 0, 1]);
    expect(r).toEqual({ mean: 1, std: 0, count: 2 });
  });
  it('0 і 1 порівну → std 0.5', () => {
    expect(meanStd([0, 1, 0, 1], all(4)).std).toBeCloseTo(0.5, 9);
  });
  it('порожня маска', () => {
    expect(meanStd([1, 2], [0, 0])).toEqual({ mean: 0, std: 0, count: 0 });
  });
});

describe('erode', () => {
  it('звужує квадрат на 1 піксель з кожного боку', () => {
    const w = 7;
    const m = rectMask({ x: 1 / 7, y: 1 / 7, w: 5 / 7, h: 5 / 7 }, w, w);
    const e = erode(m, w, w, 1);
    expect(e.reduce((s, v) => s + v, 0)).toBe(9);
  });
  it('r = 0 нічого не змінює', () => {
    expect(Array.from(erode([1, 0, 1], 3, 1, 0))).toEqual([1, 0, 1]);
  });
});

describe('sobelEdges / edgeDensity', () => {
  it('однотонне зображення без країв', () => {
    const w = 10, h = 10;
    const l = lumaPlane(image(w, h, () => [200, 200, 200]), w, h);
    expect(edgeDensity(sobelEdges(l, w, h, 0.1), all(w * h))).toBe(0);
  });
  it('вертикальна межа чорне/біле дає краї', () => {
    const w = 10, h = 10;
    const l = lumaPlane(image(w, h, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255])), w, h);
    const edges = sobelEdges(l, w, h, 0.25);
    // Краї у стовпцях 4 і 5, без крайніх рядків: 2 × 8 = 16
    expect(edges.reduce((s, v) => s + v, 0)).toBe(16);
  });
  it('смуги дають більшу щільність країв, ніж одна межа', () => {
    const w = 20, h = 10;
    const stripes = lumaPlane(image(w, h, (x) => (x % 4 < 2 ? [0, 0, 0] : [255, 255, 255])), w, h);
    const single = lumaPlane(image(w, h, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255])), w, h);
    const d1 = edgeDensity(sobelEdges(stripes, w, h, 0.25), all(w * h));
    const d2 = edgeDensity(sobelEdges(single, w, h, 0.25), all(w * h));
    expect(d1).toBeGreaterThan(d2 * 3);
  });
});

describe('fractionAbove', () => {
  it('частка пересвічених', () => {
    expect(fractionAbove([0.99, 0.5, 0.98, 0.1], all(4), 0.97)).toBe(0.5);
  });
});

describe('redBlueRatio', () => {
  it('тепле світло > 1, холодне < 1', () => {
    expect(redBlueRatio(image(2, 1, () => [200, 150, 100]), all(2))).toBe(2);
    expect(redBlueRatio(image(2, 1, () => [100, 150, 200]), all(2))).toBe(0.5);
  });
});

describe('rectMask / insetRect', () => {
  it('прямокутник на всю площу', () => {
    expect(rectMask({ x: 0, y: 0, w: 1, h: 1 }, 4, 3).reduce((s, v) => s + v, 0)).toBe(12);
  });
  it('обрізає по межах кадру', () => {
    expect(rectMask({ x: 0.5, y: 0.5, w: 1, h: 1 }, 4, 4).reduce((s, v) => s + v, 0)).toBe(4);
  });
  it('insetRect стискає з кожного боку', () => {
    const r = insetRect({ x: 0, y: 0, w: 1, h: 1 }, 0.1);
    expect(r.x).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.8);
  });
});

describe('busyBlockFraction', () => {
  const opts = { cols: 2, rows: 1, edgeDensity: 0.1, minBackground: 0.5 };
  it('строкатий лише лівий блок → 0.5', () => {
    const w = 20, h = 10;
    const l = lumaPlane(image(w, h, (x) => (x < 10 && x % 4 < 2 ? [0, 0, 0] : [255, 255, 255])), w, h);
    const edges = sobelEdges(l, w, h, 0.25);
    expect(busyBlockFraction(edges, all(w * h), w, h, opts)).toBe(0.5);
  });
  it('блоки без фону не рахуються', () => {
    expect(busyBlockFraction(new Uint8Array(4), new Uint8Array(4), 2, 2, opts)).toBe(0);
  });
});
