import type { AppConfig } from '../config';
import type { Rect } from '../image/pixelStats';
import { boundingBox, type Landmark } from './geometry';

type PeopleParams = Pick<
  AppConfig['analysis'],
  'extraFaceMinRatio' | 'extraFaceMaxOverlap' | 'poseMinVisibility' | 'poseMinSeparation' | 'multiPersonTicks'
>;

/** Частка меншого з двох прямокутників, яку займає їхній перетин (0 — не перетинаються, 1 — один у другому). */
function overlapOfSmaller(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? (w * h) / smaller : 0;
}

/**
 * Скільки облич рахуємо як окремих людей. Найбільше обличчя — головне. Інше рахуємо, лише якщо
 * воно не надто дрібне порівняно з головним (дрібні — обличчя на картині, фото, далеко у фоні)
 * і не накладається на головне (модель інколи двічі знаходить те саме обличчя).
 */
export function countFaces(faces: ArrayLike<Landmark>[], p: PeopleParams): number {
  const boxes = faces.map((lm) => boundingBox(lm)).filter((b) => b.w > 0 && b.h > 0);
  if (boxes.length <= 1) return boxes.length;
  const main = boxes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  let count = 1;
  for (const b of boxes) {
    if (b === main) continue;
    if (b.h >= p.extraFaceMinRatio * main.h && overlapOfSmaller(b, main) < p.extraFaceMaxOverlap) count++;
  }
  return count;
}

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const visible = (lm: Landmark | undefined, min: number) => Boolean(lm) && (lm!.visibility ?? 1) >= min;

/**
 * Скільки поз рахуємо як окремих людей. Поза — людина, лише якщо чітко видно ніс і обидва плечі
 * (модель пози часто «бачить» другу людину в меблях чи складках одягу). Дві пози — дві людини,
 * лише якщо їхні центри плечей далеко одна від одної по горизонталі (інакше це та сама людина).
 */
export function countPoses(poses: ArrayLike<Landmark>[], p: PeopleParams): number {
  const centers: number[] = [];
  for (const pose of poses) {
    const l = pose[LEFT_SHOULDER];
    const r = pose[RIGHT_SHOULDER];
    if (!visible(pose[NOSE], p.poseMinVisibility) || !visible(l, p.poseMinVisibility) || !visible(r, p.poseMinVisibility)) continue;
    const cx = (l!.x + r!.x) / 2;
    if (centers.every((c) => Math.abs(c - cx) > p.poseMinSeparation)) centers.push(cx);
  }
  return centers.length;
}

/**
 * «У кадрі не одна людина» — лише якщо друга людина тримається кілька тіків поспіль
 * (одиночні хибні спрацювання моделей не провалюють пункт). Одна людина — одразу.
 */
export class MultiPersonFilter {
  private streak = 0;

  constructor(private readonly ticks: number) {}

  /** Повертає, скільки людей показувати: справжню кількість або 1, поки друга людина ще не підтвердилась. */
  update(count: number): number {
    this.streak = count > 1 ? this.streak + 1 : 0;
    return count > 1 && this.streak < this.ticks ? 1 : count;
  }

  reset() {
    this.streak = 0;
  }
}
