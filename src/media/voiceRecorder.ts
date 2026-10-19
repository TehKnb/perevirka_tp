import { config } from '../config';
import { pickAudioMime, rmsDb } from './audioLevel';

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
  recordedAt: string;
}

/** Чи вміє браузер записувати звук. */
export function canRecordAudio(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

/**
 * Запис голосу з мікрофонної доріжки через MediaRecorder і рівень сигналу через AnalyserNode.
 * Записується лише звук; відео нікуди не пишеться.
 */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private startedAt = 0;
  private stopTimer = 0;
  private result: Promise<VoiceRecording> | null = null;

  /** Викликається, коли запис зупинився сам (через maxDurationSec). */
  onAutoStop: (() => void) | null = null;

  start(track: MediaStreamTrack) {
    const stream = new MediaStream([track]);
    const mime = pickAudioMime(config.recording.mimeTypes, (t) => MediaRecorder.isTypeSupported(t));
    this.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    this.chunks = [];
    const recorder = this.recorder;
    this.result = new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || 'audio/webm';
        resolve({
          blob: new Blob(this.chunks, { type }),
          mime: type,
          durationMs: performance.now() - this.startedAt,
          recordedAt: new Date().toISOString(),
        });
      };
      recorder.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error('MediaRecorder error'));
    });

    // Рівень сигналу — окремо від запису, для індикатора й підказки «голосніше».
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buffer = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);

    this.startedAt = performance.now();
    recorder.start(1000);
    this.stopTimer = window.setTimeout(() => {
      if (this.recorder?.state === 'recording') {
        this.onAutoStop?.();
      }
    }, config.recording.maxDurationSec * 1000);
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get elapsedMs(): number {
    return this.recording ? performance.now() - this.startedAt : 0;
  }

  /** Поточний рівень сигналу, дБ. */
  levelDb(): number {
    if (!this.analyser || !this.buffer) return -100;
    this.analyser.getFloatTimeDomainData(this.buffer);
    return rmsDb(this.buffer);
  }

  /** Зупиняє запис і повертає файл. */
  async stop(): Promise<VoiceRecording> {
    if (!this.recorder || !this.result) throw new Error('Запис не розпочато');
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    try {
      return await this.result;
    } finally {
      this.cleanup();
    }
  }

  /** Скасовує запис без результату (наприклад, людина пішла змінювати мікрофон). */
  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.cleanup();
  }

  private cleanup() {
    clearTimeout(this.stopTimer);
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
    this.recorder = null;
    this.result = null;
  }
}
