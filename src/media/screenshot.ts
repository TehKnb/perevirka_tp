import { config } from '../config';

export interface Screenshot {
  blob: Blob;
  width: number;
  height: number;
  takenAt: string;
}

/**
 * Повнорозмірний кадр з відео камери — НЕ дзеркальний (дзеркалиться лише показ на екрані),
 * JPEG через canvas.toBlob.
 */
export function captureFrame(video: HTMLVideoElement): Promise<Screenshot> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !width || !height) return Promise.reject(new Error('Кадр недоступний'));
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve({ blob, width, height, takenAt: new Date().toISOString() });
        else reject(new Error('Не вдалося створити JPEG'));
      },
      'image/jpeg',
      config.screenshot.jpegQuality,
    );
  });
}
