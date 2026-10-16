export interface ResolutionResult {
  ok: boolean;
  width: number;
  height: number;
}

/**
 * Критерій «камера HD (720p) або краще» за track.getSettings().
 * Камера може віддавати кадр у портретній орієнтації, тому порівнюємо більшу й меншу сторони.
 */
export function checkResolution(
  settings: { width?: number; height?: number },
  min: { minWidth: number; minHeight: number },
): ResolutionResult {
  const width = settings.width ?? 0;
  const height = settings.height ?? 0;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return { ok: long >= min.minWidth && short >= min.minHeight, width, height };
}
