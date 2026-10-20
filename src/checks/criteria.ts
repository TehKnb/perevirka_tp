import type { AppConfig } from '../config';
import type { MicKind } from '../media/micClassify';
import type { NetworkState } from '../network/speedTest';
import { speedProblems } from '../network/speedTest';
import { hints, internetMobileHint, internetSlowHint } from '../texts';
import type { FrameMetrics } from '../vision/metrics';
import type { HeadsetVisualResult } from './headsetVisual';
import { checkResolution } from './resolution';

export type CheckId =
  | 'resolution'
  | 'face'
  | 'singlePerson'
  | 'distance'
  | 'center'
  | 'headPose'
  | 'shoulders'
  | 'fit'
  | 'faceBrightness'
  | 'lowLight'
  | 'lightEven'
  | 'backlight'
  | 'bgBright'
  | 'bgNeutral'
  | 'bgPlain'
  | 'internet'
  | 'bgObjects'
  | 'coldLight'
  | 'headset';

export type Severity = 'hard' | 'soft';

/**
 * Результат критерію на одному кадрі, до згладжування.
 * 'unknown' — немає даних (жорсткий рахується як провал);
 * 'pending' — перевірка ще триває (наприклад, тест інтернету): не провал, але й не виконано.
 */
export type RawStatus = 'pass' | 'fail' | 'unknown' | 'pending';

export interface RawCheck {
  id: CheckId;
  severity: Severity;
  status: RawStatus;
  /** Головне число критерію (для debug і метаданих експертам). */
  value: number | string | null;
  hint: string | null;
}

export interface CheckContext {
  metrics: FrameMetrics;
  /** track.getSettings() камери. */
  camera: { width?: number; height?: number; frameRate?: number };
  micKind: MicKind;
  headsetVisual: HeadsetVisualResult;
  network: NetworkState;
}

type Criteria = AppConfig['criteria'];
type CameraLimits = AppConfig['camera'];
type NetworkLimits = AppConfig['network'];

/**
 * Порядок пріоритету підказок: немає обличчя → відстань → по центру → висота камери й нахил →
 * плечі → світло → фон → інтернет → м'які. Роздільність камери й «одна людина» — на самому початку,
 * бо без них решта підказок не має сенсу. Інтернет — після всього, що людина виправляє перед камерою.
 */
export const CHECK_ORDER: readonly CheckId[] = [
  'resolution',
  'face',
  'singlePerson',
  'distance',
  'center',
  'headPose',
  'shoulders',
  'fit',
  'faceBrightness',
  'lowLight',
  'lightEven',
  'backlight',
  'bgBright',
  'bgNeutral',
  'bgPlain',
  'internet',
  'bgObjects',
  'coldLight',
  'headset',
];

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Відхилення pitch від рівня очей (0 — камера на рівні очей). */
export function pitchDeviation(pitch: number, c: Criteria): number {
  return pitch - c.pitchOffsetDeg;
}

/** Обчислює всі критерії на одному кадрі. Чиста функція. */
export function evaluateChecks(ctx: CheckContext, c: Criteria, cam: CameraLimits, net: NetworkLimits): RawCheck[] {
  const m = ctx.metrics;
  const face = m.face;
  const light = m.light;
  const out: RawCheck[] = [];
  const add = (id: CheckId, severity: Severity, status: RawStatus, value: RawCheck['value'], hint: string | null) =>
    out.push({ id, severity, status, value, hint: status === 'pass' ? null : hint });

  // Камера HD
  const res = checkResolution(ctx.camera, cam);
  add('resolution', 'hard', res.ok ? 'pass' : 'fail', `${res.width}x${res.height}`, hints.resolution);

  // Обличчя й одна людина
  add('face', 'hard', m.faces > 0 ? 'pass' : 'fail', m.faces, hints.noFace);
  add('singlePerson', 'hard', m.faces <= 1 && m.poses <= 1 ? 'pass' : 'fail', Math.max(m.faces, m.poses), hints.singlePerson);

  // Відстань
  if (!face) add('distance', 'hard', 'unknown', null, hints.noFace);
  else if (face.sizeRatio < c.faceSizeMin) add('distance', 'hard', 'fail', round(face.sizeRatio), hints.closer);
  else if (face.sizeRatio > c.faceSizeMax) add('distance', 'hard', 'fail', round(face.sizeRatio), hints.farther);
  else add('distance', 'hard', 'pass', round(face.sizeRatio), null);

  // По центру. offsetX — на екрані (дзеркально): обличчя праворуч → людині треба лівіше.
  if (!face) add('center', 'hard', 'unknown', null, hints.noFace);
  else if (face.offsetX > c.maxOffsetX) add('center', 'hard', 'fail', round(face.offsetX), hints.moveLeft);
  else if (face.offsetX < -c.maxOffsetX) add('center', 'hard', 'fail', round(face.offsetX), hints.moveRight);
  else if (face.offsetY < c.minOffsetY) add('center', 'hard', 'fail', round(face.offsetY), hints.moveDown);
  else if (face.offsetY > c.maxOffsetY) add('center', 'hard', 'fail', round(face.offsetY), hints.moveUp);
  else add('center', 'hard', 'pass', round(face.offsetX), null);

  // Висота камери й нахил голови
  if (!face || !face.angles) {
    add('headPose', 'hard', 'unknown', null, hints.noFace);
  } else {
    const dev = pitchDeviation(face.angles.pitch, c);
    const value = round(dev, 1);
    if (Math.abs(dev) > c.maxPitchDeg) {
      const cameraAbove = (dev > 0) === (c.pitchPositiveMeans === 'cameraAbove');
      add('headPose', 'hard', 'fail', value, cameraAbove ? hints.lowerCamera : hints.raiseCamera);
    } else if (Math.abs(face.angles.yaw) > c.maxYawDeg) {
      add('headPose', 'hard', 'fail', value, hints.faceCamera);
    } else if (Math.abs(face.angles.roll) > c.maxRollDeg) {
      add('headPose', 'hard', 'fail', value, hints.headStraight);
    } else {
      add('headPose', 'hard', 'pass', value, null);
    }
  }

  // Плечі й груди
  const s = m.shoulders;
  const shouldersOk =
    !!s && s.minVisibility >= c.minShoulderVisibility && s.insideFrame && s.marginBelow >= c.minMarginBelowShoulders;
  add('shoulders', 'hard', shouldersOk ? 'pass' : 'fail', s ? round(s.marginBelow) : null, hints.shoulders);

  // Вписаність у контур
  if (!m.mask) add('fit', 'hard', 'unknown', null, hints.fit);
  else add('fit', 'hard', m.mask.iou >= c.minIou ? 'pass' : 'fail', round(m.mask.iou), hints.fit);

  // Світло
  if (!face || !light) {
    add('faceBrightness', 'hard', 'unknown', null, hints.noFace);
    add('lowLight', 'hard', 'unknown', null, hints.noFace);
    add('lightEven', 'hard', 'unknown', null, hints.noFace);
    add('backlight', 'hard', 'unknown', null, hints.noFace);
  } else {
    const fl = round(light.faceLuma);
    if (light.faceLuma < c.faceLumaMin) add('faceBrightness', 'hard', 'fail', fl, hints.faceDark);
    else if (light.faceLuma > c.faceLumaMax) add('faceBrightness', 'hard', 'fail', fl, hints.faceBright);
    else add('faceBrightness', 'hard', 'pass', fl, null);
    // Мало світла: зерно на фоні або камера сама знизила частоту кадрів.
    const noisy = light.bgNoise > c.maxBgNoise;
    // Якщо камера й так налаштована на низьку частоту (frameRate у getSettings), ця ознака нічого не каже.
    const nominalOk = ctx.camera.frameRate === undefined || ctx.camera.frameRate >= c.minCameraFps;
    const slowCamera = nominalOk && m.cameraFps !== null && m.cameraFps < c.minCameraFps;
    add('lowLight', 'hard', noisy || slowCamera ? 'fail' : 'pass', round(light.bgNoise, 4), hints.lowLight);
    add('lightEven', 'hard', light.faceSideDiff <= c.maxFaceSideDiff ? 'pass' : 'fail', round(light.faceSideDiff), hints.lightSide);
    add('backlight', 'hard', light.bgToFace <= c.maxBgToFace ? 'pass' : 'fail', round(light.bgToFace), hints.backlight);
  }

  // Фон
  if (!light || light.bgArea < c.minBgArea) {
    add('bgBright', 'hard', 'unknown', null, hints.fit);
    add('bgNeutral', 'hard', 'unknown', null, hints.fit);
    add('bgPlain', 'hard', 'unknown', null, hints.fit);
    add('bgObjects', 'soft', 'unknown', null, null);
    add('coldLight', 'soft', 'unknown', null, null);
  } else {
    add('bgBright', 'hard', light.bgLuma >= c.minBgLuma ? 'pass' : 'fail', round(light.bgLuma), hints.bgDark);
    add('bgNeutral', 'hard', light.bgChroma <= c.maxBgChroma ? 'pass' : 'fail', round(light.bgChroma), hints.bgTint);
    const plain = light.bgStd <= c.maxBgStd && light.bgEdgeDensity <= c.maxBgEdgeDensity;
    add('bgPlain', 'hard', plain ? 'pass' : 'fail', round(light.bgStd), hints.bgPlain);
    add('bgObjects', 'soft', light.bgBusyBlocks <= c.maxBusyBlocks ? 'pass' : 'fail', round(light.bgBusyBlocks), hints.bgObjects);
    add('coldLight', 'soft', light.bgRedBlue <= c.maxBgRedBlue ? 'pass' : 'fail', round(light.bgRedBlue), hints.coldLight);
  }

  // Інтернет
  const n = ctx.network;
  if (n.status === 'checking') add('internet', 'hard', 'pending', null, hints.internetChecking);
  else if (n.status === 'error') add('internet', 'hard', 'fail', null, hints.internetFailed);
  else {
    const r = n.result;
    const problems = speedProblems(r, net);
    if (problems.includes('mobile') && r.network.kind === 'mobile') {
      const value = `мобільний (${r.network.operator ?? r.network.source})`;
      add('internet', 'hard', 'fail', value, internetMobileHint(r.network.operator));
    } else {
      const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1));
      const value = `${fmt(r.downloadMbps)}/${fmt(r.uploadMbps)} Мбіт/с (пінг ${r.pingMs.toFixed(0)} мс, ${r.server}, ${r.network.kind})`;
      add('internet', 'hard', problems.length === 0 ? 'pass' : 'fail', value, internetSlowHint(r));
    }
  }

  // Гарнітура: лише за назвою мікрофона; 'unknown' не блокує й не підказує.
  add(
    'headset',
    'soft',
    ctx.micKind === 'builtin' ? 'fail' : 'pass',
    `${ctx.micKind}/${ctx.headsetVisual}`,
    hints.headset,
  );

  return out;
}
