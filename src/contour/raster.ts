import type { Point } from './contour';

/**
 * Растеризує полігон (координати 0..1) у маску w×h: 1 — всередині, 0 — зовні.
 * Правило парності перетинів, піксель перевіряється за центром.
 */
export function rasterizePolygon(points: Point[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const n = points.length;
  if (n < 3) return mask;
  const xs: number[] = [];
  for (let row = 0; row < h; row++) {
    const y = (row + 0.5) / h;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = points[i]!;
      const b = points[j]!;
      if (a.y > y !== b.y > y) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Піксель col усередині, якщо його центр (col + 0.5) / w лежить між перетинами.
      const from = Math.max(0, Math.ceil(xs[k]! * w - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1]! * w - 0.5));
      for (let col = from; col <= to; col++) mask[row * w + col] = 1;
    }
  }
  return mask;
}

/** Перетин на об'єднання двох бінарних масок однакового розміру. Обидві порожні → 0. */
export function iou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! > 0;
    const y = b[i]! > 0;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/** Бінаризує маску впевненості моделі за порогом. */
export function threshold(conf: ArrayLike<number>, level: number): Uint8Array {
  const out = new Uint8Array(conf.length);
  for (let i = 0; i < conf.length; i++) out[i] = conf[i]! > level ? 1 : 0;
  return out;
}
