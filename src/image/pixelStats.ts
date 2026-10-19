/**
 * Піксельна математика на зменшеному кадрі. Усі функції чисті:
 * на вході масиви пікселів і маски, на виході числа.
 * Яскравість — 0..1 (відносна яскравість за коефіцієнтами Rec. 709 по значеннях sRGB, без лінеаризації).
 */

/** Площина яскравості з RGBA-пікселів. */
export function lumaPlane(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!) / 255;
  }
  return out;
}

export interface MeanStd {
  mean: number;
  std: number;
  /** Скільки пікселів увійшло. */
  count: number;
}

/** Середнє та стандартне відхилення по пікселях, де mask[i] > 0. */
export function meanStd(values: ArrayLike<number>, mask: ArrayLike<number>): MeanStd {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask[i]! > 0) {
      const v = values[i]!;
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0) return { mean: 0, std: 0, count: 0 };
  const mean = sum / count;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / count - mean * mean)), count };
}

/** Звужує бінарну маску на r пікселів (квадратне вікно). Пікселі біля краю кадру зберігаються. */
export function erode(mask: ArrayLike<number>, w: number, h: number, r: number): Uint8Array {
  const src = Uint8Array.from(mask, (v) => (v > 0 ? 1 : 0));
  if (r <= 0) return src;
  // Два проходи (по рядках і по стовпцях) — те саме, що квадратне вікно, але швидше.
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dx = -r; dx <= r && ok; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && !src[y * w + xx]) ok = 0;
      }
      tmp[y * w + x] = ok;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && !tmp[yy * w + x]) ok = 0;
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}

/**
 * Карта країв за оператором Собеля: 1, якщо модуль градієнта яскравості вищий за поріг.
 * Крайні пікселі кадру — 0.
 */
export function sobelEdges(luma: ArrayLike<number>, w: number, h: number, thr: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = luma[i - w - 1]!, t = luma[i - w]!, tr = luma[i - w + 1]!;
      const l = luma[i - 1]!, r = luma[i + 1]!;
      const bl = luma[i + w - 1]!, b = luma[i + w]!, br = luma[i + w + 1]!;
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      // Ділимо на 4, щоб різкий перепад 0→1 давав градієнт ~1.
      if (Math.hypot(gx, gy) / 4 > thr) out[i] = 1;
    }
  }
  return out;
}

/** Частка пікселів маски, які є краями. */
export function edgeDensity(edges: ArrayLike<number>, mask: ArrayLike<number>): number {
  let n = 0;
  let e = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]! > 0) {
      n++;
      if (edges[i]! > 0) e++;
    }
  }
  return n === 0 ? 0 : e / n;
}

/** Частка пікселів маски з яскравістю вище level. */
export function fractionAbove(values: ArrayLike<number>, mask: ArrayLike<number>, level: number): number {
  let n = 0;
  let k = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]! > 0) {
      n++;
      if (values[i]! > level) k++;
    }
  }
  return n === 0 ? 0 : k / n;
}

/** Відношення середнього червоного до середнього синього по масці (>1 — тепліше, <1 — холодніше). */
export function redBlueRatio(rgba: ArrayLike<number>, mask: ArrayLike<number>): number {
  let r = 0;
  let b = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i]! > 0) {
      r += rgba[p]!;
      b += rgba[p + 2]!;
    }
  }
  return b === 0 ? (r === 0 ? 1 : Infinity) : r / b;
}

/**
 * Середня кольоровість по масці: (max(R,G,B) − min(R,G,B)) / 255.
 * 0 — нейтральний білий чи сірий; бежевий, блакитний, рожевий фон дають більше.
 */
export function meanChroma(rgba: ArrayLike<number>, mask: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i]! > 0) {
      const r = rgba[p]!, g = rgba[p + 1]!, b = rgba[p + 2]!;
      sum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Рівень шуму: середнє |L − середнє чотирьох сусідів| по пікселях маски,
 * у яких усі сусіди теж у масці. На рівній стіні це переважно зерно камери,
 * яке зростає, коли світла мало й камера підсилює сигнал.
 */
export function noiseLevel(luma: ArrayLike<number>, mask: ArrayLike<number>, w: number, h: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!(mask[i]! > 0 && mask[i - 1]! > 0 && mask[i + 1]! > 0 && mask[i - w]! > 0 && mask[i + w]! > 0)) continue;
      const avg = (luma[i - 1]! + luma[i + 1]! + luma[i - w]! + luma[i + w]!) / 4;
      sum += Math.abs(luma[i]! - avg);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Маска прямокутника (координати 0..1) розміром w×h. */
export function rectMask(rect: Rect, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.round(rect.x * w));
  const x1 = Math.min(w, Math.round((rect.x + rect.w) * w));
  const y0 = Math.max(0, Math.round(rect.y * h));
  const y1 = Math.min(h, Math.round((rect.y + rect.h) * h));
  for (let y = y0; y < y1; y++) out.fill(1, y * w + x0, y * w + x1);
  return out;
}

/** Стискає прямокутник на частку inset з кожного боку. */
export function insetRect(rect: Rect, inset: number): Rect {
  return {
    x: rect.x + rect.w * inset,
    y: rect.y + rect.h * inset,
    w: rect.w * (1 - 2 * inset),
    h: rect.h * (1 - 2 * inset),
  };
}

/**
 * Частка «строкатих» блоків фону: ділимо кадр на сітку, у кожному блоці,
 * де достатньо фону, рахуємо щільність країв. Ознака картин, полиць, вікон, предметів.
 */
export function busyBlockFraction(
  edges: ArrayLike<number>,
  background: ArrayLike<number>,
  w: number,
  h: number,
  opts: { cols: number; rows: number; edgeDensity: number; minBackground: number },
): number {
  let considered = 0;
  let busy = 0;
  for (let gy = 0; gy < opts.rows; gy++) {
    for (let gx = 0; gx < opts.cols; gx++) {
      const x0 = Math.floor((gx * w) / opts.cols);
      const x1 = Math.floor(((gx + 1) * w) / opts.cols);
      const y0 = Math.floor((gy * h) / opts.rows);
      const y1 = Math.floor(((gy + 1) * h) / opts.rows);
      let total = 0;
      let bg = 0;
      let e = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          total++;
          if (background[i]! > 0) {
            bg++;
            if (edges[i]! > 0) e++;
          }
        }
      }
      if (total === 0 || bg / total < opts.minBackground) continue;
      considered++;
      if (e / bg > opts.edgeDensity) busy++;
    }
  }
  return considered === 0 ? 0 : busy / considered;
}
