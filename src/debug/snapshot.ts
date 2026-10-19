import type { CheckStatus, SetupResult } from '../checks/stability';
import type { FrameMetrics } from '../vision/metrics';

/** Числові показатели одного кадру під короткими ключами (зручно читати й порівнювати). */
export type Sample = Record<string, number | null>;

const num = (v: number | undefined | null): number | null =>
  v === undefined || v === null || !Number.isFinite(v) ? null : v;

/** Порядок і опис ключів у звіті. */
export const SAMPLE_KEYS: readonly [key: string, label: string, digits: number][] = [
  ['faces', 'облич', 0],
  ['poses', 'поз', 0],
  ['iou', 'IoU з контуром', 2],
  ['personArea', 'частка кадру з людиною', 2],
  ['pitch', 'pitch °', 1],
  ['yaw', 'yaw °', 1],
  ['roll', 'roll °', 1],
  ['eyeLineY', 'лінія очей y', 2],
  ['sizeRatio', 'розмір обличчя / овал', 2],
  ['offsetX', 'зсув x', 2],
  ['offsetY', 'зсув y', 2],
  ['shVis', 'плечі: видимість', 2],
  ['shInside', 'плечі в кадрі (1/0)', 2],
  ['shMargin', 'плечі: запас знизу', 2],
  ['shTilt', 'плечі: нахил °', 1],
  ['faceLuma', 'обличчя: яскравість', 2],
  ['faceSide', 'обличчя: різниця половин', 3],
  ['bgLuma', 'фон: яскравість', 2],
  ['bgStd', 'фон: розкид', 3],
  ['bgEdge', 'фон: краї', 3],
  ['bgArea', 'фон: частка кадру', 2],
  ['bgToFace', 'фон / обличчя', 2],
  ['bgOver', 'фон: пересвічено', 3],
  ['bgBusy', 'фон: строкаті блоки', 2],
  ['faceRB', 'R/B обличчя', 2],
  ['bgRB', 'R/B фону', 2],
  ['bgChroma', 'фон: відтінок', 3],
  ['bgNoise', 'фон: шум', 4],
  ['cameraFps', 'частота кадрів камери', 1],
  ['fps', 'FPS аналізу', 1],
  ['processMs', 'обробка кадру мс', 0],
  ['tFace', 'обличчя мс', 0],
  ['tPose', 'поза мс', 0],
  ['tSeg', 'сегментація мс', 0],
  ['tMetrics', 'метрики мс', 0],
];

export function flattenMetrics(
  m: FrameMetrics,
  perf: { fps: number; processMs: number; timings: { face: number; pose: number; segment: number; metrics: number } },
): Sample {
  const s = m.shoulders;
  const l = m.light;
  return {
    faces: m.faces,
    poses: m.poses,
    iou: num(m.mask?.iou),
    personArea: num(m.mask?.personArea),
    pitch: num(m.face?.angles?.pitch),
    yaw: num(m.face?.angles?.yaw),
    roll: num(m.face?.angles?.roll),
    eyeLineY: num(m.face?.eyeLineY),
    sizeRatio: num(m.face?.sizeRatio),
    offsetX: num(m.face?.offsetX),
    offsetY: num(m.face?.offsetY),
    shVis: num(s?.minVisibility),
    shInside: s ? (s.insideFrame ? 1 : 0) : null,
    shMargin: num(s?.marginBelow),
    shTilt: num(s?.tilt),
    faceLuma: num(l?.faceLuma),
    faceSide: num(l?.faceSideDiff),
    bgLuma: num(l?.bgLuma),
    bgStd: num(l?.bgStd),
    bgEdge: num(l?.bgEdgeDensity),
    bgArea: num(l?.bgArea),
    bgToFace: num(l?.bgToFace),
    bgOver: num(l?.bgOverexposed),
    bgBusy: num(l?.bgBusyBlocks),
    faceRB: num(l?.faceRedBlue),
    bgRB: num(l?.bgRedBlue),
    bgChroma: num(l?.bgChroma),
    bgNoise: num(l?.bgNoise),
    cameraFps: num(m.cameraFps),
    fps: num(perf.fps),
    processMs: num(perf.processMs),
    tFace: num(perf.timings.face),
    tPose: num(perf.timings.pose),
    tSeg: num(perf.timings.segment),
    tMetrics: num(perf.timings.metrics),
  };
}

export interface Stat {
  mean: number;
  min: number;
  max: number;
  /** Скільки кадрів мали значення. */
  n: number;
}

/** Середнє, мінімум і максимум ключа по кадрах; null, якщо значення не було жодного разу. */
export function aggregate(samples: Sample[], key: string): Stat | null {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const s of samples) {
    const v = s[key];
    if (v === null || v === undefined) continue;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    n++;
  }
  return n === 0 ? null : { mean: sum / n, min, max, n };
}

/** Частка кадрів, у яких кожен критерій мав статус fail, плюс останній статус. */
export function checkSummary(results: SetupResult[]): { id: string; last: CheckStatus; failShare: number }[] {
  const last = results.at(-1);
  if (!last) return [];
  return last.checks.map((c) => {
    const fails = results.filter((r) => r.checks.find((x) => x.id === c.id)?.status === 'fail').length;
    return { id: c.id, last: c.status, failShare: fails / results.length };
  });
}

export interface SnapshotInfo {
  scenario: string;
  note: string;
  durationMs: number;
  camera: string;
  microphone: string;
  delegate: string;
  browser: string;
}

/** Текст замірів для вставки в чат: один рядок на показник, «середнє (мін–макс)». */
export function formatSnapshot(info: SnapshotInfo, samples: Sample[], results: SetupResult[]): string {
  const lines: string[] = [];
  lines.push(`Сценарій: ${info.scenario}${info.note ? ` — ${info.note}` : ''}`);
  lines.push(`Кадрів: ${samples.length} за ${(info.durationMs / 1000).toFixed(1)} с`);
  lines.push(`Камера: ${info.camera}`);
  lines.push(`Мікрофон: ${info.microphone}`);
  lines.push(`Делегат: ${info.delegate}; браузер: ${info.browser}`);
  lines.push('');
  for (const [key, label, digits] of SAMPLE_KEYS) {
    const st = aggregate(samples, key);
    if (!st) {
      lines.push(`${key} (${label}): —`);
      continue;
    }
    const range = st.min === st.max ? '' : ` (${st.min.toFixed(digits)}…${st.max.toFixed(digits)})`;
    const missing = st.n < samples.length ? ` [є в ${st.n}/${samples.length}]` : '';
    lines.push(`${key} (${label}): ${st.mean.toFixed(digits)}${range}${missing}`);
  }
  const summary = checkSummary(results);
  if (summary.length) {
    lines.push('');
    const fmt = (c: (typeof summary)[number]) => `${c.id}${c.failShare > 0 && c.failShare < 1 ? ` ${Math.round(c.failShare * 100)}%` : ''}`;
    const by = (status: CheckStatus) => summary.filter((c) => c.last === status).map(fmt).join(', ') || '—';
    lines.push(`Пройдено: ${by('pass')}`);
    lines.push(`Провалено: ${by('fail')}`);
    lines.push(`Перевіряється: ${by('checking')}`);
    lines.push(`Підказка: ${results.at(-1)!.mainHint}`);
  }
  return lines.join('\n');
}
