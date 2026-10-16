/** Якого пристрою стосується помилка. */
export type DeviceKind = 'camera' | 'microphone' | 'both';

export type MediaErrorCode =
  | 'insecure' // сторінка відкрита не через HTTPS
  | 'unsupported' // браузер не вміє getUserMedia
  | 'denied' // людина або браузер заборонили доступ
  | 'deniedBySystem' // доступ заблоковано налаштуваннями ОС (macOS/Windows)
  | 'notFound' // пристрій не знайдено
  | 'busy' // пристрій зайнятий іншою програмою
  | 'unknown';

export interface MediaErrorInfo {
  code: MediaErrorCode;
  kind: DeviceKind;
}

/** Помилка доступу до пристроїв, уже переведена в зрозумілий код. */
export class MediaAccessError extends Error {
  constructor(
    readonly info: MediaErrorInfo,
    readonly cause?: unknown,
  ) {
    super(`${info.code}:${info.kind}`);
    this.name = 'MediaAccessError';
  }
}

function errName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
}

function errMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
}

/**
 * Переводить помилку getUserMedia у код за error.name.
 * Старі назви (PermissionDeniedError, DevicesNotFoundError, TrackStartError) — з давніх Chrome.
 */
export function classifyMediaError(err: unknown, kind: DeviceKind = 'both'): MediaErrorInfo {
  if (err instanceof MediaAccessError) return err.info;
  const name = errName(err);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      // Chrome пише "Permission denied by system", коли браузеру заборонено доступ у налаштуваннях ОС.
      return { code: /by system/i.test(errMessage(err)) ? 'deniedBySystem' : 'denied', kind };
    case 'SecurityError':
      // Доступ заборонено політикою сторінки або браузера — для людини це те саме, що «заборонено».
      return { code: 'denied', kind };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { code: 'notFound', kind };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { code: 'busy', kind };
    case 'TypeError':
      return { code: 'unsupported', kind };
    default:
      return { code: 'unknown', kind };
  }
}

/**
 * Визначає, якого пристрою бракує, за списком enumerateDevices().
 * Список типів пристроїв браузер дає навіть до надання дозволу.
 */
export function missingKind(devices: Pick<MediaDeviceInfo, 'kind'>[]): DeviceKind {
  const hasCamera = devices.some((d) => d.kind === 'videoinput');
  const hasMic = devices.some((d) => d.kind === 'audioinput');
  if (hasCamera && !hasMic) return 'microphone';
  if (!hasCamera && hasMic) return 'camera';
  return 'both';
}
