import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { hints } from '../texts';
import type { FrameMetrics } from '../vision/metrics';
import { evaluateChecks, type CheckContext, type CheckId, type RawCheck } from './criteria';

/** Метрики добре налаштованого учасника (числа близькі до виміряних на реальній камері). */
function goodMetrics(): FrameMetrics {
  return {
    faces: 1,
    poses: 1,
    face: {
      box: { x: 0.4, y: 0.15, w: 0.2, h: 0.4 },
      angles: { pitch: 8, yaw: 2, roll: 1 },
      eyeLineY: 0.34,
      eyeRoll: 0,
      sizeRatio: 0.74,
      offsetX: 0,
      offsetY: 0.12,
    },
    shoulders: { minVisibility: 0.99, insideFrame: true, marginBelow: 0.13, tilt: 0 },
    mask: { iou: 0.8, personArea: 0.34 },
    light: {
      faceLuma: 0.55,
      faceSideDiff: 0.04,
      bgLuma: 0.85,
      bgStd: 0.03,
      bgEdgeDensity: 0.01,
      bgArea: 0.6,
      bgToFace: 1.3,
      bgOverexposed: 0,
      bgBusyBlocks: 0,
      faceRedBlue: 1.7,
      bgRedBlue: 0.98,
      bgChroma: 0.02,
      bgNoise: 0.008,
    },
    cameraFps: 30,
  };
}

function ctx(patch: (m: FrameMetrics) => void = () => {}, extra: Partial<CheckContext> = {}): CheckContext {
  const metrics = goodMetrics();
  patch(metrics);
  return {
    metrics,
    camera: { width: 1920, height: 1080 },
    micKind: 'headset',
    headsetVisual: 'unknown',
    network: { status: 'done', result: { downloadMbps: 50, uploadMbps: 20, pingMs: 20, server: 'cloudflare', connection: null } },
    ...extra,
  };
}

const run = (c: CheckContext) => evaluateChecks(c, config.criteria, config.camera, config.network);
const get = (checks: RawCheck[], id: CheckId) => checks.find((c) => c.id === id)!;

describe('evaluateChecks', () => {
  it('добре налаштований учасник проходить усе', () => {
    const checks = run(ctx());
    expect(checks.filter((c) => c.status !== 'pass')).toEqual([]);
    expect(checks.every((c) => c.hint === null)).toBe(true);
  });

  it('повертає всі критерії з правильною важливістю', () => {
    const checks = run(ctx());
    expect(checks).toHaveLength(19);
    expect(get(checks, 'bgObjects').severity).toBe('soft');
    expect(get(checks, 'bgPlain').severity).toBe('hard');
  });

  it('камера нижче 720p', () => {
    const c = get(run(ctx(undefined, { camera: { width: 640, height: 480 } })), 'resolution');
    expect(c.status).toBe('fail');
    expect(c.hint).toBe(hints.resolution);
  });

  it('немає обличчя → кілька критеріїв невідомі, face провалено', () => {
    const checks = run(ctx((m) => {
      m.faces = 0;
      m.face = null;
    }));
    expect(get(checks, 'face').status).toBe('fail');
    expect(get(checks, 'distance').status).toBe('unknown');
    expect(get(checks, 'headPose').status).toBe('unknown');
  });

  it('друга людина в кадрі', () => {
    expect(get(run(ctx((m) => (m.poses = 2))), 'singlePerson').status).toBe('fail');
    expect(get(run(ctx((m) => (m.faces = 2))), 'singlePerson').status).toBe('fail');
  });

  it('відстань: далеко → ближче, близько → відсуньтеся', () => {
    expect(get(run(ctx((m) => (m.face!.sizeRatio = 0.4))), 'distance').hint).toBe(hints.closer);
    expect(get(run(ctx((m) => (m.face!.sizeRatio = 1.1))), 'distance').hint).toBe(hints.farther);
  });

  it('центр: обличчя праворуч на екрані → лівіше, і навпаки', () => {
    expect(get(run(ctx((m) => (m.face!.offsetX = 0.3))), 'center').hint).toBe(hints.moveLeft);
    expect(get(run(ctx((m) => (m.face!.offsetX = -0.3))), 'center').hint).toBe(hints.moveRight);
    expect(get(run(ctx((m) => (m.face!.offsetY = -0.2))), 'center').hint).toBe(hints.moveDown);
    expect(get(run(ctx((m) => (m.face!.offsetY = 0.5))), 'center').hint).toBe(hints.moveUp);
  });

  it('pitch з урахуванням зміщення: 8° — це рівень очей', () => {
    const c = get(run(ctx((m) => (m.face!.angles!.pitch = 8))), 'headPose');
    expect(c.status).toBe('pass');
    expect(c.value).toBe(0);
  });

  it('pitch: напрям підказки залежить від pitchPositiveMeans', () => {
    // За замовчуванням 'cameraAbove': додатне відхилення → камера зверху → опустіть.
    expect(get(run(ctx((m) => (m.face!.angles!.pitch = 8 + 20))), 'headPose').hint).toBe(hints.lowerCamera);
    expect(get(run(ctx((m) => (m.face!.angles!.pitch = 8 - 20))), 'headPose').hint).toBe(hints.raiseCamera);
    const flipped = { ...config.criteria, pitchPositiveMeans: 'cameraBelow' as const };
    const c = evaluateChecks(ctx((m) => (m.face!.angles!.pitch = 30)), flipped, config.camera, config.network);
    expect(get(c, 'headPose').hint).toBe(hints.raiseCamera);
  });

  it('поворот і нахил голови', () => {
    expect(get(run(ctx((m) => (m.face!.angles!.yaw = 30))), 'headPose').hint).toBe(hints.faceCamera);
    expect(get(run(ctx((m) => (m.face!.angles!.roll = 20))), 'headPose').hint).toBe(hints.headStraight);
  });

  it('плечі: немає пози, низька видимість, мало запасу', () => {
    expect(get(run(ctx((m) => (m.shoulders = null))), 'shoulders').status).toBe('fail');
    expect(get(run(ctx((m) => (m.shoulders!.minVisibility = 0.3))), 'shoulders').status).toBe('fail');
    expect(get(run(ctx((m) => (m.shoulders!.marginBelow = 0.01))), 'shoulders').status).toBe('fail');
  });

  it('IoU нижче порогу', () => {
    expect(get(run(ctx((m) => (m.mask!.iou = 0.5))), 'fit').status).toBe('fail');
  });

  it('ваші умови з настільною лампою: світло збоку й темний фон', () => {
    const checks = run(ctx((m) => {
      m.light!.faceSideDiff = 0.21;
      m.light!.bgLuma = 0.36;
      m.light!.bgStd = 0.162;
    }));
    expect(get(checks, 'lightEven').hint).toBe(hints.lightSide);
    expect(get(checks, 'bgBright').hint).toBe(hints.bgDark);
    expect(get(checks, 'bgPlain').status).toBe('fail');
  });

  it('за форматом лише білий фон: світло-сірий не проходить', () => {
    const grey = get(run(ctx((m) => (m.light!.bgLuma = 0.62))), 'bgBright');
    expect(grey.status).toBe('fail');
    expect(grey.hint).toBe(hints.bgDark);
    expect(get(run(ctx((m) => (m.light!.bgLuma = 0.86))), 'bgBright').status).toBe('pass');
  });

  it('білий, але з відтінком (беж, блакить) не проходить', () => {
    const tinted = get(run(ctx((m) => (m.light!.bgChroma = 0.12))), 'bgNeutral');
    expect(tinted.status).toBe('fail');
    expect(tinted.hint).toBe(hints.bgTint);
  });

  it('мало світла: зерно на фоні або камера знизила частоту кадрів', () => {
    expect(get(run(ctx((m) => (m.light!.bgNoise = 0.05))), 'lowLight').hint).toBe(hints.lowLight);
    expect(get(run(ctx((m) => (m.cameraFps = 12))), 'lowLight').status).toBe('fail');
    // Частота кадрів невідома — вирішує лише шум.
    expect(get(run(ctx((m) => (m.cameraFps = null))), 'lowLight').status).toBe('pass');
    // Камера й так працює на 15 к/с — низька частота не ознака поганого світла.
    const native15 = run(ctx((m) => (m.cameraFps = 15), { camera: { width: 1920, height: 1080, frameRate: 15 } }));
    expect(get(native15, 'lowLight').status).toBe('pass');
  });

  it('інтернет: триває, помилка, повільний, добрий', () => {
    expect(get(run(ctx(undefined, { network: { status: 'checking' } })), 'internet').status).toBe('pending');
    expect(get(run(ctx(undefined, { network: { status: 'error' } })), 'internet').hint).toBe(hints.internetFailed);
    const slow = get(
      run(ctx(undefined, { network: { status: 'done', result: { downloadMbps: 50, uploadMbps: 4, pingMs: 30, server: 'cloudflare', connection: null } } })),
      'internet',
    );
    expect(slow.status).toBe('fail');
    expect(slow.hint).toContain('віддача 4');
    expect(get(run(ctx()), 'internet').status).toBe('pass');
  });

  it('обличчя темне / пересвічене, контражур', () => {
    expect(get(run(ctx((m) => (m.light!.faceLuma = 0.1))), 'faceBrightness').hint).toBe(hints.faceDark);
    expect(get(run(ctx((m) => (m.light!.faceLuma = 0.95))), 'faceBrightness').hint).toBe(hints.faceBright);
    expect(get(run(ctx((m) => (m.light!.bgToFace = 2.5))), 'backlight').status).toBe('fail');
  });

  it('замало фону для оцінки → невідомо', () => {
    expect(get(run(ctx((m) => (m.light!.bgArea = 0.05))), 'bgBright').status).toBe('unknown');
  });

  it("м'які: предмети, вікно, тепле світло", () => {
    const checks = run(ctx((m) => {
      m.light!.bgBusyBlocks = 0.5;
      m.light!.bgOverexposed = 0.1;
      m.light!.bgRedBlue = 1.4;
    }));
    expect(get(checks, 'bgObjects').status).toBe('fail');
    expect(get(checks, 'coldLight').status).toBe('fail');
  });

  it('гарнітура: вбудований мікрофон → порада, невідомий → без підказки', () => {
    expect(get(run(ctx(undefined, { micKind: 'builtin' })), 'headset').hint).toBe(hints.headset);
    const unknown = get(run(ctx(undefined, { micKind: 'unknown' })), 'headset');
    expect(unknown.status).toBe('pass');
    expect(unknown.value).toBe('unknown/unknown');
  });
});
