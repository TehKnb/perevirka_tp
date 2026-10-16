import { describe, expect, it } from 'vitest';
import { boundingBox, headAnglesFromMatrix, pickPersonMaskIndex, shoulderMetrics } from './geometry';

/** 4×4 у порядку column-major з 3×3 обертання (рядки). */
function toColumnMajor(R: number[][], scale = 1): number[] {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = R[r]![c]! * scale;
  out[15] = 1;
  return out;
}

const rad = (d: number) => (d * Math.PI) / 180;
const rotX = (d: number) => {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const rotY = (d: number) => {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const rotZ = (d: number) => {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const mul = (A: number[][], B: number[][]) =>
  A.map((row) => [0, 1, 2].map((c) => row.reduce((s, v, k) => s + v * B[k]![c]!, 0)));

describe('headAnglesFromMatrix', () => {
  it('одинична матриця → усі кути 0', () => {
    const a = headAnglesFromMatrix(toColumnMajor([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
    expect(a.pitch).toBeCloseTo(0);
    expect(a.yaw).toBeCloseTo(0);
    expect(a.roll).toBeCloseTo(0);
  });
  it('обертання навколо X → pitch', () => {
    expect(headAnglesFromMatrix(toColumnMajor(rotX(20))).pitch).toBeCloseTo(20, 6);
  });
  it('обертання навколо Y → yaw', () => {
    expect(headAnglesFromMatrix(toColumnMajor(rotY(-15))).yaw).toBeCloseTo(-15, 6);
  });
  it('обертання навколо Z → roll', () => {
    expect(headAnglesFromMatrix(toColumnMajor(rotZ(10))).roll).toBeCloseTo(10, 6);
  });
  it('комбінація Rz·Ry·Rx розкладається назад, масштаб не заважає', () => {
    const R = mul(rotZ(5), mul(rotY(12), rotX(-18)));
    const a = headAnglesFromMatrix(toColumnMajor(R, 3.5));
    expect(a.pitch).toBeCloseTo(-18, 6);
    expect(a.yaw).toBeCloseTo(12, 6);
    expect(a.roll).toBeCloseTo(5, 6);
  });
});

describe('boundingBox', () => {
  it('рамка навколо точок', () => {
    const b = boundingBox([{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }]);
    expect(b.x).toBeCloseTo(0.2);
    expect(b.y).toBeCloseTo(0.1);
    expect(b.w).toBeCloseTo(0.4);
    expect(b.h).toBeCloseTo(0.4);
  });
  it('порожньо → нульова рамка', () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('shoulderMetrics', () => {
  const pose = (l: { x: number; y: number }, r: { x: number; y: number }, visibility = 0.9) => {
    const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
    arr[11] = { ...l, visibility };
    arr[12] = { ...r, visibility };
    return arr;
  };
  it('рівні плечі в кадрі', () => {
    const m = shoulderMetrics(pose({ x: 0.7, y: 0.75 }, { x: 0.3, y: 0.75 }), 0.02)!;
    expect(m.insideFrame).toBe(true);
    expect(m.marginBelow).toBeCloseTo(0.25);
    expect(m.tilt).toBeCloseTo(0);
    expect(m.minVisibility).toBe(0.9);
  });
  it('плече за краєм кадру', () => {
    expect(shoulderMetrics(pose({ x: 1.05, y: 0.8 }, { x: 0.3, y: 0.8 }), 0.02)!.insideFrame).toBe(false);
  });
  it('немає точок → null', () => {
    expect(shoulderMetrics([], 0.02)).toBeNull();
  });
});

describe('pickPersonMaskIndex', () => {
  it('шукає мітку person', () => expect(pickPersonMaskIndex(['background', 'person'])).toBe(1));
  it('без міток → 0', () => expect(pickPersonMaskIndex([])).toBe(0));
  it('невідомі мітки → остання', () => expect(pickPersonMaskIndex(['a', 'b', 'c'])).toBe(2));
});
