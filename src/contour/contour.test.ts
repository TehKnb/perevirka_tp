import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { buildContour } from './contour';
import { iou, rasterizePolygon, threshold } from './raster';

describe('buildContour', () => {
  const c = buildContour(16 / 9, config.contour);

  it('усі точки в межах кадру', () => {
    for (const p of c.display) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('симетричний відносно центру', () => {
    const n = c.display.length;
    for (let i = 0; i < n; i++) {
      const a = c.display[i]!;
      const b = c.display[n - 1 - i]!;
      expect(a.x + b.x).toBeCloseTo(1, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it('кадрові координати — дзеркальні до екранних', () => {
    c.display.forEach((p, i) => {
      expect(c.frame[i]!.x).toBeCloseTo(1 - p.x, 9);
      expect(c.frame[i]!.y).toBe(p.y);
    });
  });

  it('маківка на висоті headCenterY − headRy', () => {
    const top = Math.min(...c.display.map((p) => p.y));
    expect(top).toBeCloseTo(config.contour.headCenterY - config.contour.headRy, 6);
  });

  it('форма не сплющується: на 4:3 овал голови ширший у частках ширини', () => {
    const wide = buildContour(16 / 9, config.contour).head.rx;
    const narrow = buildContour(4 / 3, config.contour).head.rx;
    expect(narrow / wide).toBeCloseTo(16 / 9 / (4 / 3), 6);
  });
});

describe('rasterizePolygon', () => {
  const square = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 },
  ];

  it('квадрат на половину сторони займає чверть пікселів', () => {
    const m = rasterizePolygon(square, 100, 100);
    expect(m.reduce((s, v) => s + v, 0)).toBe(2500);
  });

  it('менше трьох точок — порожня маска', () => {
    expect(rasterizePolygon(square.slice(0, 2), 10, 10).every((v) => v === 0)).toBe(true);
  });

  it('контур займає розумну частку кадру', () => {
    const c = buildContour(16 / 9, config.contour);
    const m = rasterizePolygon(c.frame, 320, 180);
    const area = m.reduce((s, v) => s + v, 0) / m.length;
    expect(area).toBeGreaterThan(0.15);
    expect(area).toBeLessThan(0.45);
  });
});

describe('iou', () => {
  it('однакові маски → 1', () => {
    expect(iou([1, 1, 0, 0], [1, 1, 0, 0])).toBe(1);
  });
  it('без перетину → 0', () => {
    expect(iou([1, 0], [0, 1])).toBe(0);
  });
  it('половинний перетин', () => {
    // перетин 1, об'єднання 3
    expect(iou([1, 1, 0], [0, 1, 1])).toBeCloseTo(1 / 3, 9);
  });
  it('дві порожні → 0', () => {
    expect(iou([0, 0], [0, 0])).toBe(0);
  });
  it('threshold бінаризує', () => {
    expect(Array.from(threshold([0.1, 0.5, 0.51, 0.9], 0.5))).toEqual([0, 0, 1, 1]);
  });
});
