/**
 * Візуальна перевірка «гарнітура на голові».
 * Простим кодом це надійно не визначити, тому тут лише інтерфейс і заглушка.
 * Якщо вирішите підключати модель (наприклад, на сервері), реалізуйте HeadsetVisualCheck
 * і передайте її в екран налаштування замість headsetVisualStub.
 */
export type HeadsetVisualResult = 'present' | 'absent' | 'unknown';

export interface HeadsetVisualCheck {
  /** Перевіряє кадр (повнорозмірний, не дзеркальний). */
  check(frame: ImageBitmap | HTMLCanvasElement): Promise<HeadsetVisualResult>;
}

export const headsetVisualStub: HeadsetVisualCheck = {
  async check() {
    return 'unknown';
  },
};
