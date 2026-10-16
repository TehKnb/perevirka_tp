import { config } from '../config';
import { buildContour, type Contour } from '../contour/contour';
import { rasterizePolygon } from '../contour/raster';
import { computeFrameMetrics, type FrameAnalysis } from './metrics';
import type { Landmark } from './geometry';
import type { VisionModels } from './models';

export interface AnalysisTick extends FrameAnalysis {
  contour: Contour;
  /** Маска контуру в розмірі зменшеного кадру (координати кадру). */
  contourMask: Uint8Array;
  /** Розмір зменшеного кадру (для debug-масок). */
  width: number;
  height: number;
  /** Розмір кадру камери. */
  videoWidth: number;
  videoHeight: number;
  /** Точки для debug-малювання (координати кадру). */
  faceLandmarks: Landmark[][];
  poseLandmarks: Landmark[][];
  /** Фактична частота аналізу і час обробки одного тіку. */
  fps: number;
  processMs: number;
}

/**
 * Цикл аналізу: ~config.analysis.fps разів на секунду бере кадр з <video>,
 * проганяє моделі й рахує метрики. Кадри нікуди не зберігаються.
 */
export class Analyzer {
  onTick: ((tick: AnalysisTick) => void) | null = null;

  private running = false;
  private lastRun = 0;
  private lastTs = 0;
  private fps = 0;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  /** Кадр середнього розміру для моделей обличчя й пози (повний 1080p зайвий і повільніший). */
  private landmarkCanvas = document.createElement('canvas');
  private landmarkCtx = this.landmarkCanvas.getContext('2d')!;
  private contour: Contour | null = null;
  private contourMask: Uint8Array | null = null;
  private sizeKey = '';
  private rafId = 0;
  private vfcId = 0;

  constructor(
    private readonly models: VisionModels,
    private readonly video: HTMLVideoElement,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastRun = 0;
    this.schedule();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if ('cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.vfcId);
  }

  private schedule() {
    if (!this.running) return;
    // requestVideoFrameCallback спрацьовує на кожен новий кадр камери; де його немає — rAF.
    if ('requestVideoFrameCallback' in this.video) {
      this.vfcId = this.video.requestVideoFrameCallback((now) => this.frame(now));
    } else {
      this.rafId = requestAnimationFrame((now) => this.frame(now));
    }
  }

  private frame(now: number) {
    if (!this.running) return;
    const interval = 1000 / config.analysis.fps;
    if (now - this.lastRun >= interval * 0.9 && this.video.readyState >= 2 && this.video.videoWidth > 0) {
      if (this.lastRun > 0) {
        const instant = 1000 / (now - this.lastRun);
        this.fps = this.fps ? this.fps * 0.8 + instant * 0.2 : instant;
      }
      this.lastRun = now;
      try {
        this.process();
      } catch (err) {
        console.error('Помилка аналізу кадру', err);
      }
    }
    this.schedule();
  }

  private ensureSize() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const key = `${vw}x${vh}`;
    if (key === this.sizeKey && this.contour && this.contourMask) return;
    this.sizeKey = key;
    const w = config.analysis.width;
    const h = Math.max(1, Math.round((w * vh) / vw));
    this.canvas.width = w;
    this.canvas.height = h;
    const lw = Math.min(vw, config.analysis.landmarkWidth);
    this.landmarkCanvas.width = lw;
    this.landmarkCanvas.height = Math.max(1, Math.round((lw * vh) / vw));
    this.contour = buildContour(vw / vh, config.contour);
    this.contourMask = rasterizePolygon(this.contour.frame, w, h);
  }

  private process() {
    const started = performance.now();
    this.ensureSize();
    const { width: w, height: h } = this.canvas;
    const video = this.video;

    this.ctx.drawImage(video, 0, 0, w, h);
    const image = this.ctx.getImageData(0, 0, w, h);
    const lc = this.landmarkCanvas;
    this.landmarkCtx.drawImage(video, 0, 0, lc.width, lc.height);

    // Часові мітки для режиму VIDEO мають строго зростати.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;

    // Координати точок нормалізовані (0..1), тож розмір вхідного кадру на них не впливає.
    const faceResult = this.models.face.detectForVideo(lc, ts);
    const poseResult = this.models.pose.detectForVideo(lc, ts);

    const seg: { conf: Float32Array | null } = { conf: null };
    this.models.segmenter.segmentForVideo(this.canvas, ts, (result) => {
      const mask = result.confidenceMasks?.[this.models.personMaskIndex];
      if (mask && mask.width === w && mask.height === h) {
        // Маска живе лише всередині колбека, тому копіюємо.
        seg.conf = mask.getAsFloat32Array().slice();
      }
    });

    const analysis = computeFrameMetrics(
      {
        rgba: image.data,
        width: w,
        height: h,
        personConfidence: seg.conf,
        faces: faceResult.faceLandmarks,
        faceMatrices: (faceResult.facialTransformationMatrixes ?? []).map((m) => m.data),
        poses: poseResult.landmarks,
        contour: this.contour!,
        contourMask: this.contourMask!,
      },
      config.analysis,
    );

    this.onTick?.({
      ...analysis,
      contour: this.contour!,
      contourMask: this.contourMask!,
      width: w,
      height: h,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      faceLandmarks: faceResult.faceLandmarks,
      poseLandmarks: poseResult.landmarks,
      fps: this.fps,
      processMs: performance.now() - started,
    });
  }
}
