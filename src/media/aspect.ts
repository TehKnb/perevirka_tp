/** Співвідношення сторін кадру (ширина / висота) близьке до потрібного, напр. 16:9. */
export function isAspect(width: number, height: number, target: number, tolerance = 0.02): boolean {
  return width > 0 && height > 0 && Math.abs(width / height - target) <= tolerance * target;
}
