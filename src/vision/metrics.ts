import type { AppConfig } from '../config';
import type { Contour } from '../contour/contour';
import { iou } from '../contour/raster';
import {
  busyBlockFraction,
  edgeDensity,
  erode,
  fractionAbove,
  insetRect,
  lumaPlane,
  meanChroma,
  meanStd,
  noiseLevel,
  rectMask,
  redBlueRatio,
  sobelEdges,
  type Rect,
} from '../image/pixelStats';
import {
  FACE,
  boundingBox,
  headAnglesFromMatrix,
  shoulderMetrics,
  type HeadAngles,
  type Landmark,
  type ShoulderMetrics,
} from './geometry';

/** Сирі результати моделей і зменшений кадр за один тік аналізу. */
export interface FrameInputs {
  /** RGBA зменшеного кадру. */
  rgba: ArrayLike<number>;
  width: number;
  height: number;
  /** Впевненість «це людина» для кожного пікселя зменшеного кадру, або null, якщо сегментації немає. */
  personConfidence: ArrayLike<number> | null;
  /** Точки облич (координати кадру 0..1). */
  faces: ArrayLike<Landmark>[];
  /** facialTransformationMatrixes[i].data для кожного обличчя. */
  faceMatrices: ArrayLike<number>[];
  /** Точки поз. */
  poses: ArrayLike<Landmark>[];
  contour: Contour;
  /** Маска контуру, растеризована в розмірі зменшеного кадру (координати кадру). */
  contourMask: Uint8Array;
}

export interface FaceMetrics {
  /** Рамка обличчя в координатах кадру. */
  box: Rect;
  angles: HeadAngles | null;
  /** Висота лінії очей (частка висоти кадру) — запасна оцінка висоти камери. */
  eyeLineY: number;
  /** Нахил лінії очей, градуси. */
  eyeRoll: number;
  /** Висота обличчя / висота овалу голови контуру. */
  sizeRatio: number;
  /** Зсув центру обличчя від центру овалу НА ЕКРАНІ, у ширинах овалу: + праворуч. */
  offsetX: number;
  /** Зсув по вертикалі, у висотах овалу: + нижче. */
  offsetY: number;
}

export interface LightMetrics {
  /** Середня яскравість обличчя (0..1). */
  faceLuma: number;
  /** Різниця яскравості лівої й правої половин обличчя (0..1). */
  faceSideDiff: number;
  /** Фон: середня яскравість, розкид, щільність країв. */
  bgLuma: number;
  bgStd: number;
  bgEdgeDensity: number;
  /** Частка кадру, що є надійним фоном. */
  bgArea: number;
  /** Яскравість фону / яскравість обличчя (контражур — фон набагато яскравіший). */
  bgToFace: number;
  /** Частка пересвічених пікселів фону. */
  bgOverexposed: number;
  /** Частка строкатих блоків фону. */
  bgBusyBlocks: number;
  /** R/B на обличчі й на фоні (>1 тепле, <1 холодне світло). */
  faceRedBlue: number;
  bgRedBlue: number;
  /** Кольоровість фону (0 — нейтральний білий/сірий; більше — відтінок: беж, блакить тощо). */
  bgChroma: number;
  /** Шум на фоні: при поганому світлі камера підсилює сигнал і зерно зростає. */
  bgNoise: number;
}

export interface FrameMetrics {
  faces: number;
  poses: number;
  /** Перше (найбільше) обличчя. */
  face: FaceMetrics | null;
  shoulders: ShoulderMetrics | null;
  /** IoU маски людини з контуром і частка кадру, яку займає людина. */
  mask: { iou: number; personArea: number } | null;
  light: LightMetrics | null;
  /**
   * Фактична частота кадрів камери. У поганому світлі вебкамери подовжують витримку
   * й частота падає. null — невідомо (рахує аналізатор, не computeFrameMetrics).
   */
  cameraFps: number | null;
}

export interface FrameAnalysis {
  metrics: FrameMetrics;
  /** Бінарні маски для debug-перегляду. */
  personMask: Uint8Array | null;
  backgroundMask: Uint8Array | null;
}

type AnalysisParams = AppConfig['analysis'];

export function computeFrameMetrics(input: FrameInputs, p: AnalysisParams): FrameAnalysis {
  const { width: w, height: h, contour } = input;

  // Найбільше обличчя вважаємо головним.
  let mainFace = -1;
  let mainBox: Rect | null = null;
  input.faces.forEach((lm, i) => {
    const box = boundingBox(lm);
    if (!mainBox || box.w * box.h > mainBox.w * mainBox.h) {
      mainBox = box;
      mainFace = i;
    }
  });

  let face: FaceMetrics | null = null;
  if (mainBox && mainFace >= 0) {
    const box: Rect = mainBox;
    const lm = input.faces[mainFace]!;
    const eyeR = lm[FACE.rightEyeOuter];
    const eyeL = lm[FACE.leftEyeOuter];
    const matrix = input.faceMatrices[mainFace];
    const head = contour.head;
    const displayCx = 1 - (box.x + box.w / 2);
    const cy = box.y + box.h / 2;
    face = {
      box,
      angles: matrix && matrix.length >= 16 ? headAnglesFromMatrix(matrix) : null,
      eyeLineY: eyeR && eyeL ? (eyeR.y + eyeL.y) / 2 : cy,
      eyeRoll: eyeR && eyeL ? (Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x) * 180) / Math.PI : 0,
      sizeRatio: box.h / (2 * head.ry),
      offsetX: (displayCx - head.cx) / (2 * head.rx),
      offsetY: (cy - head.cy) / (2 * head.ry),
    };
  }

  const firstPose = input.poses[0];
  const shoulders = firstPose ? shoulderMetrics(firstPose, p.shoulderEdgeMargin) : null;

  let mask: FrameMetrics['mask'] = null;
  let light: LightMetrics | null = null;
  let personMask: Uint8Array | null = null;
  let backgroundMask: Uint8Array | null = null;

  if (input.personConfidence) {
    const conf = input.personConfidence;
    personMask = new Uint8Array(w * h);
    const bgRaw = new Uint8Array(w * h);
    let personPx = 0;
    for (let i = 0; i < w * h; i++) {
      const c = conf[i]!;
      if (c > p.personThreshold) {
        personMask[i] = 1;
        personPx++;
      } else if (c < p.backgroundThreshold) {
        bgRaw[i] = 1;
      }
    }
    mask = { iou: iou(personMask, input.contourMask), personArea: personPx / (w * h) };
    backgroundMask = erode(bgRaw, w, h, p.backgroundErodePx);

    const luma = lumaPlane(input.rgba, w, h);
    const edges = sobelEdges(luma, w, h, p.edgeThreshold);
    const bg = meanStd(luma, backgroundMask);

    let faceLuma = 0;
    let faceSideDiff = 0;
    let faceRedBlue = 1;
    if (face) {
      const r = insetRect(face.box, p.faceInsetRatio);
      const half = { ...r, w: r.w / 2 };
      const left = meanStd(luma, rectMask(half, w, h));
      const right = meanStd(luma, rectMask({ ...half, x: r.x + r.w / 2 }, w, h));
      const faceRect = rectMask(r, w, h);
      faceLuma = meanStd(luma, faceRect).mean;
      faceSideDiff = Math.abs(left.mean - right.mean);
      faceRedBlue = redBlueRatio(input.rgba, faceRect);
    }

    light = {
      faceLuma,
      faceSideDiff,
      bgLuma: bg.mean,
      bgStd: bg.std,
      bgEdgeDensity: edgeDensity(edges, backgroundMask),
      bgArea: bg.count / (w * h),
      bgToFace: face && faceLuma > 0 ? bg.mean / faceLuma : 0,
      bgOverexposed: fractionAbove(luma, backgroundMask, p.overexposedLevel),
      bgBusyBlocks: busyBlockFraction(edges, backgroundMask, w, h, {
        cols: p.busyGridCols,
        rows: p.busyGridRows,
        edgeDensity: p.busyBlockEdgeDensity,
        minBackground: p.busyBlockMinBackground,
      }),
      faceRedBlue,
      bgRedBlue: redBlueRatio(input.rgba, backgroundMask),
      bgChroma: meanChroma(input.rgba, backgroundMask),
      bgNoise: noiseLevel(luma, backgroundMask, w, h),
    };
  }

  return {
    metrics: {
      faces: input.faces.length,
      poses: input.poses.length,
      face,
      shoulders,
      mask,
      light,
      cameraFps: null,
    },
    personMask,
    backgroundMask,
  };
}
