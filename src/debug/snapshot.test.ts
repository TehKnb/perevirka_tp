import { describe, expect, it } from 'vitest';
import type { SetupResult } from '../checks/stability';
import type { FrameMetrics } from '../vision/metrics';
import { aggregate, checkSummary, flattenMetrics, formatSnapshot } from './snapshot';

const perf = { fps: 10, processMs: 50, timings: { face: 20, pose: 15, segment: 10, metrics: 5 } };

function metrics(iou: number | null): FrameMetrics {
  return {
    faces: 1,
    poses: 1,
    face: null,
    shoulders: { minVisibility: 0.9, insideFrame: true, marginBelow: 0.1, tilt: 0 },
    mask: iou === null ? null : { iou, personArea: 0.3 },
    light: null,
    cameraFps: null,
  };
}

const result = (status: 'pass' | 'fail', hint = 'h'): SetupResult => ({
  ok: false,
  stableMs: 0,
  checks: [
    { id: 'face', status: 'pass', severity: 'hard', value: 1, hint: null },
    { id: 'bgBright', status, severity: 'hard', value: 0.4, hint: status === 'fail' ? hint : null },
  ],
  mainHint: hint,
});

describe('flattenMetrics', () => {
  it('відсутні дані → null, булеве → 1/0', () => {
    const s = flattenMetrics(metrics(0.8), perf);
    expect(s.iou).toBe(0.8);
    expect(s.pitch).toBeNull();
    expect(s.bgLuma).toBeNull();
    expect(s.shInside).toBe(1);
    expect(s.tFace).toBe(20);
  });
});

describe('aggregate', () => {
  it('середнє, мінімум, максимум, пропуски не враховуються', () => {
    const samples = [0.7, null, 0.9].map((v) => flattenMetrics(metrics(v), perf));
    expect(aggregate(samples, 'iou')).toEqual({ mean: 0.8, min: 0.7, max: 0.9, n: 2 });
  });
  it('жодного значення → null', () => {
    expect(aggregate([flattenMetrics(metrics(null), perf)], 'iou')).toBeNull();
  });
});

describe('checkSummary', () => {
  it('частка провальних кадрів і останній статус', () => {
    const s = checkSummary([result('fail'), result('fail'), result('pass'), result('fail')]);
    expect(s.find((c) => c.id === 'bgBright')).toEqual({ id: 'bgBright', last: 'fail', failShare: 0.75 });
    expect(s.find((c) => c.id === 'face')!.failShare).toBe(0);
  });
  it('без результатів → порожньо', () => {
    expect(checkSummary([])).toEqual([]);
  });
});

describe('formatSnapshot', () => {
  const info = {
    scenario: '2а. Камера знизу',
    note: 'ноутбук на колінах',
    durationMs: 3060,
    camera: 'Integrated Webcam, кадр 1280×720',
    microphone: 'Jabra (headset)',
    delegate: 'GPU',
    browser: 'Chrome',
  };

  it('містить сценарій, діапазони, пропуски й підсумок перевірок', () => {
    const samples = [0.7, null, 0.9].map((v) => flattenMetrics(metrics(v), perf));
    const text = formatSnapshot(info, samples, [result('fail', 'Темно'), result('fail', 'Темно')]);
    expect(text).toContain('Сценарій: 2а. Камера знизу — ноутбук на колінах');
    expect(text).toContain('Кадрів: 3 за 3.1 с');
    expect(text).toContain('iou (IoU з контуром): 0.80 (0.70…0.90) [є в 2/3]');
    expect(text).toContain('pitch (pitch °): —');
    expect(text).toContain('faces (облич): 1\n');
    expect(text).toContain('Пройдено: face');
    expect(text).toContain('Провалено: bgBright');
    expect(text).toContain('Підказка: Темно');
  });

  it('без примітки — без тире', () => {
    const text = formatSnapshot({ ...info, note: '' }, [flattenMetrics(metrics(0.8), perf)], []);
    expect(text.split('\n')[0]).toBe('Сценарій: 2а. Камера знизу');
    expect(text).not.toContain('Пройдено');
  });
});
