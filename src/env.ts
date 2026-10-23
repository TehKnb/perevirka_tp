/** Дані про пристрій, які потрібні для визначення телефона/планшета. */
export interface DeviceEnv {
  userAgent: string;
  /** navigator.userAgentData?.mobile (є лише в Chromium). */
  uaDataMobile?: boolean;
  maxTouchPoints: number;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|Silk|Kindle/i;

/** Телефон або планшет. Сенсорні ноутбуки з Windows сюди не потрапляють. */
export function isMobileDevice(env: DeviceEnv): boolean {
  if (env.uaDataMobile === true) return true;
  if (MOBILE_UA.test(env.userAgent)) return true;
  // iPadOS 13+ видає себе за Mac; відрізняємо за сенсорним екраном.
  if (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1) return true;
  return false;
}

/** Браузер — лише щоб показати, де саме в ньому вмикається доступ до камери. */
export type BrowserId = 'chrome' | 'edge' | 'opera' | 'firefox' | 'safari' | 'other';

export function detectBrowser(userAgent: string): BrowserId {
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/OPR\/|Opera/.test(userAgent)) return 'opera';
  if (/Firefox\/|FxiOS/.test(userAgent)) return 'firefox';
  // Yandex, Brave, Vivaldi тощо на Chromium мають той самий значок біля адреси, що й Chrome.
  if (/Chrome\/|CriOS/.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

export type SupportProblem = 'insecure' | 'unsupported';

/** Чи може сторінка взагалі запитати камеру й мікрофон. */
export function getSupportProblem(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
}): SupportProblem | null {
  // Поза HTTPS (крім localhost) navigator.mediaDevices просто відсутній,
  // тому спершу перевіряємо захищений контекст.
  if (!env.isSecureContext) return 'insecure';
  if (!env.hasGetUserMedia) return 'unsupported';
  return null;
}

/** Зчитує середовище з реального браузера. */
export function readDeviceEnv(): DeviceEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    userAgent: nav.userAgent,
    uaDataMobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  };
}

export function readSupportEnv() {
  return {
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
  };
}
