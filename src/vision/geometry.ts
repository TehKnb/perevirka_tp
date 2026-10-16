import type { Rect } from '../image/pixelStats';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface HeadAngles {
  /** Нахил уперед/назад, градуси. Знак уточнюється в режимі debug (див. DECISIONS.md). */
  pitch: number;
  /** Поворот ліворуч/праворуч, градуси. */
  yaw: number;
  /** Нахил голови до плеча, градуси. */
  roll: number;
}

const DEG = 180 / Math.PI;

/**
 * Кути голови з facialTransformationMatrixes Face Landmarker.
 * Матриця 4×4 зберігається по стовпцях (column-major): елемент (рядок r, стовпець c) = data[c*4 + r].
 * Розклад R = Rz(roll)·Ry(yaw)·Rx(pitch). Стовпці нормалізуємо, щоб прибрати масштаб.
 */
export function headAnglesFromMatrix(data: ArrayLike<number>): HeadAngles {
  const m = (r: number, c: number) => data[c * 4 + r]!;
  const cols = [0, 1, 2].map((c) => Math.hypot(m(0, c), m(1, c), m(2, c)) || 1);
  const R = (r: number, c: number) => m(r, c) / cols[c]!;
  const yaw = Math.asin(Math.max(-1, Math.min(1, -R(2, 0))));
  const pitch = Math.atan2(R(2, 1), R(2, 2));
  const roll = Math.atan2(R(1, 0), R(0, 0));
  return { pitch: pitch * DEG, yaw: yaw * DEG, roll: roll * DEG };
}

/** Рамка навколо точок (координати 0..1). */
export function boundingBox(points: ArrayLike<Landmark>): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Індекси точок Face Landmarker (сітка з 478 точок). */
export const FACE = {
  /** Зовнішні кутики очей. */
  rightEyeOuter: 33,
  leftEyeOuter: 263,
} as const;

/** Індекси точок Pose Landmarker (33 точки). */
export const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
} as const;

export interface ShoulderMetrics {
  /** Найменша видимість із двох плечей (0..1). */
  minVisibility: number;
  /** Обидва плечі всередині кадру з відступом margin від країв. */
  insideFrame: boolean;
  /** Запас кадру під нижчим плечем (частка висоти). */
  marginBelow: number;
  /** Нахил лінії плечей, градуси. */
  tilt: number;
}

export function shoulderMetrics(pose: ArrayLike<Landmark>, edgeMargin: number): ShoulderMetrics | null {
  const l = pose[POSE.leftShoulder];
  const r = pose[POSE.rightShoulder];
  if (!l || !r) return null;
  const inside = (p: Landmark) =>
    p.x >= edgeMargin && p.x <= 1 - edgeMargin && p.y >= edgeMargin && p.y <= 1 - edgeMargin;
  return {
    minVisibility: Math.min(l.visibility ?? 0, r.visibility ?? 0),
    insideFrame: inside(l) && inside(r),
    marginBelow: 1 - Math.max(l.y, r.y),
    tilt: Math.atan2(l.y - r.y, l.x - r.x) * DEG,
  };
}

/**
 * Модель селфі-сегментації має один вихід (впевненість «людина»), але про всяк випадок
 * шукаємо мітку з «person», а якщо масок кілька й міток немає — беремо останню.
 */
export function pickPersonMaskIndex(labels: string[]): number {
  const idx = labels.findIndex((l) => /person|selfie|human|foreground/i.test(l));
  if (idx >= 0) return idx;
  return Math.max(0, labels.length - 1);
}
