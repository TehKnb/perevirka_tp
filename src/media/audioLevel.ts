/** Рівень сигналу в дБ відносно максимуму (RMS). Тиша → −100. */
export function rmsDb(samples: ArrayLike<number>): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/** Рівень для індикатора: −60 дБ і тихіше → 0, 0 дБ → 1. */
export function levelFraction(db: number, floorDb = -60): number {
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

/** Перший формат зі списку, який підтримує браузер; null — жодного (тоді MediaRecorder обере сам). */
export function pickAudioMime(candidates: readonly string[], isSupported: (type: string) => boolean): string | null {
  return candidates.find((type) => isSupported(type)) ?? null;
}

/** Розширення файлу за MIME-типом запису. */
export function audioExtension(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'bin';
}

export interface LevelSample {
  t: number;
  db: number;
}

/**
 * Чи надто тихо говорить людина: з моменту quietHintAfterMs від початку
 * найгучніший рівень за останні levelWindowMs нижчий за minSpeechDb.
 */
export function isTooQuiet(
  history: LevelSample[],
  startedAt: number,
  now: number,
  cfg: { minSpeechDb: number; quietHintAfterMs: number; levelWindowMs: number },
): boolean {
  if (now - startedAt < cfg.quietHintAfterMs) return false;
  let max = -Infinity;
  for (const s of history) if (s.t >= now - cfg.levelWindowMs && s.db > max) max = s.db;
  return max < cfg.minSpeechDb;
}

/** Скільки цілих секунд лишилося до мінімальної тривалості запису (0 — можна зупиняти). */
export function secondsUntilMin(elapsedMs: number, minSec: number): number {
  return Math.max(0, Math.ceil(minSec - elapsedMs / 1000));
}

/** «0:07 / 0:30» */
export function formatTimer(elapsedMs: number, maxSec: number): string {
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  return `${mmss(Math.min(elapsedMs / 1000, maxSec))} / ${mmss(maxSec)}`;
}
