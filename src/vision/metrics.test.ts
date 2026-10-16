import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { buildContour } from '../contour/contour';
import { rasterizePolygon } from '../contour/raster';
import { computeFrameMetrics, type FrameInputs } from './metrics';

const W = 160;
const H = 90;
const contour = buildContour(W / H, config.contour);
const contourMask = rasterizePolygon(contour.frame, W, H);

/** Синтетичний кадр: світлий однотонний фон, «людина» точно за контуром, обличчя сірувате. */
function syntheticInputs(overrides: Partial<FrameInputs> = {}): FrameInputs {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const conf = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const person = contourMask[i] === 1;
    conf[i] = person ? 0.95 : 0.02;
    const v = person ? 150 : 230;
    rgba.set([v, v, v, 255], i * 4);
  }
  // Обличчя — рамка навколо овалу голови.
  const head = contour.head;
  const face = [
    { x: head.cx - head.rx * 0.7, y: head.cy - head.ry * 0.5 },
    { x: head.cx + head.rx * 0.7, y: head.cy + head.ry * 0.9 },
  ];
  return {
    rgba,
    width: W,
    height: H,
    personConfidence: conf,
    faces: [face],
    faceMatrices: [],
    poses: [],
    contour,
    contourMask,
    ...overrides,
  };
}

describe('computeFrameMetrics', () => {
  it('людина точно в контурі → IoU 1, фон світлий і однотонний', () => {
    const { metrics } = computeFrameMetrics(syntheticInputs(), config.analysis);
    expect(metrics.mask!.iou).toBeCloseTo(1, 6);
    expect(metrics.light!.bgLuma).toBeCloseTo(230 / 255, 3);
    expect(metrics.light!.bgStd).toBeCloseTo(0, 6);
    expect(metrics.light!.bgEdgeDensity).toBe(0);
    expect(metrics.light!.bgBusyBlocks).toBe(0);
    expect(metrics.light!.faceLuma).toBeCloseTo(150 / 255, 3);
    expect(metrics.light!.bgToFace).toBeCloseTo(230 / 150, 3);
  });

  it('обличчя по центру контуру → горизонтальний зсув ~0', () => {
    const { metrics } = computeFrameMetrics(syntheticInputs(), config.analysis);
    expect(metrics.faces).toBe(1);
    expect(Math.abs(metrics.face!.offsetX)).toBeLessThan(1e-9);
    expect(metrics.face!.sizeRatio).toBeCloseTo(0.7, 6);
  });

  it('обличчя праворуч у кадрі → на екрані (дзеркально) ліворуч, offsetX < 0', () => {
    const face = [
      { x: 0.7, y: 0.3 },
      { x: 0.8, y: 0.5 },
    ];
    const { metrics } = computeFrameMetrics(syntheticInputs({ faces: [face] }), config.analysis);
    expect(metrics.face!.offsetX).toBeLessThan(0);
  });

  it('обирає найбільше обличчя і рахує обидва', () => {
    const small = [
      { x: 0.05, y: 0.05 },
      { x: 0.1, y: 0.1 },
    ];
    const base = syntheticInputs();
    const { metrics } = computeFrameMetrics({ ...base, faces: [small, base.faces[0]!] }, config.analysis);
    expect(metrics.faces).toBe(2);
    expect(metrics.face!.box.w).toBeGreaterThan(0.06);
  });

  it('без сегментації — немає маски й світла, але обличчя є', () => {
    const { metrics } = computeFrameMetrics(syntheticInputs({ personConfidence: null }), config.analysis);
    expect(metrics.mask).toBeNull();
    expect(metrics.light).toBeNull();
    expect(metrics.face).not.toBeNull();
  });

  it('без облич — face null', () => {
    const { metrics } = computeFrameMetrics(syntheticInputs({ faces: [] }), config.analysis);
    expect(metrics.face).toBeNull();
    expect(metrics.faces).toBe(0);
  });
});
