import type { DeviceKind } from './mediaErrors';

/** Стан дозволу з Permissions API; 'unknown' — браузер не повідомляє (наприклад, Firefox для камери). */
export type PermState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface MediaPermissions {
  camera: PermState;
  microphone: PermState;
}

/**
 * Що сталося, коли браузер відмовив у доступі:
 * - blocked — заборону запам'ятано: вікно із запитом більше не з'явиться, доступ вмикають лише вручну;
 * - dismissed — людина закрила вікно, не обравши нічого: «Спробувати ще раз» покаже його знову;
 * - unknown — браузер не каже, тож показуємо й повтор, і ручний спосіб.
 */
export type DenialMode = 'blocked' | 'dismissed' | 'unknown';

export function denialMode(p: MediaPermissions): DenialMode {
  if (p.camera === 'denied' || p.microphone === 'denied') return 'blocked';
  if (p.camera === 'prompt' && p.microphone === 'prompt') return 'dismissed';
  // Один пристрій уже дозволено, а другий ще не питали — теж просто закрите вікно.
  if ((p.camera === 'prompt' || p.camera === 'granted') && (p.microphone === 'prompt' || p.microphone === 'granted'))
    return 'dismissed';
  return 'unknown';
}

/** Який саме пристрій заблоковано (щоб інструкція згадувала лише його). */
export function blockedKind(p: MediaPermissions): DeviceKind {
  if (p.camera === 'denied' && p.microphone !== 'denied') return 'camera';
  if (p.microphone === 'denied' && p.camera !== 'denied') return 'microphone';
  return 'both';
}

/**
 * Чи варто самим повторити запит: заборону знято (або все дозволено) порівняно з тим, що було.
 * Повторюємо, лише коли нічого не заборонено і стан справді змінився.
 */
export function shouldRetry(before: MediaPermissions, now: MediaPermissions): boolean {
  if (now.camera === 'denied' || now.microphone === 'denied') return false;
  if (now.camera === 'unknown' && now.microphone === 'unknown') return false;
  return now.camera !== before.camera || now.microphone !== before.microphone;
}

type StatusPair = { camera: PermissionStatus | null; microphone: PermissionStatus | null };

async function queryStatus(name: 'camera' | 'microphone'): Promise<PermissionStatus | null> {
  try {
    return (await navigator.permissions?.query({ name: name as PermissionName })) ?? null;
  } catch {
    // Firefox і старі браузери не знають назв 'camera'/'microphone'.
    return null;
  }
}

async function queryStatuses(): Promise<StatusPair> {
  const [camera, microphone] = await Promise.all([queryStatus('camera'), queryStatus('microphone')]);
  return { camera, microphone };
}

const stateOf = (s: PermissionStatus | null): PermState => (s ? (s.state as PermState) : 'unknown');

export async function queryMediaPermissions(): Promise<MediaPermissions> {
  const s = await queryStatuses();
  return { camera: stateOf(s.camera), microphone: stateOf(s.microphone) };
}

/**
 * Стежить за дозволами: щойно людина ввімкне камеру й мікрофон у налаштуваннях сайту,
 * викликає onChange з новим станом. Подія change є в Chrome та Edge; на повернення фокусу
 * у вікно перевіряємо ще раз (про всяк випадок для інших браузерів).
 * Повертає функцію, що припиняє стеження.
 */
export function watchMediaPermissions(onChange: (now: MediaPermissions) => void): () => void {
  let stopped = false;
  let statuses: StatusPair = { camera: null, microphone: null };
  const emit = async () => {
    if (stopped) return;
    const now = await queryMediaPermissions();
    if (!stopped) onChange(now);
  };
  const onStatusChange = () => void emit();
  const onFocus = () => void emit();

  void queryStatuses().then((s) => {
    if (stopped) return;
    statuses = s;
    s.camera?.addEventListener('change', onStatusChange);
    s.microphone?.addEventListener('change', onStatusChange);
  });
  window.addEventListener('focus', onFocus);

  return () => {
    stopped = true;
    statuses.camera?.removeEventListener('change', onStatusChange);
    statuses.microphone?.removeEventListener('change', onStatusChange);
    window.removeEventListener('focus', onFocus);
  };
}
