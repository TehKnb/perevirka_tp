import type { AppConfig } from '../config';

/** Результат вимірювання інтернету. */
export interface SpeedResult {
  downloadMbps: number;
  uploadMbps: number;
  /** Лише для метаданих: на проходження не впливає. */
  pingMs: number;
  /** Звідки міряли. */
  server: SpeedServer['name'];
  /** navigator.connection (лише Chromium): грубі оцінки браузера, для метаданих. */
  connection: { effectiveType?: string; downlink?: number; rtt?: number; type?: string } | null;
}

export type NetworkState =
  | { status: 'checking' }
  | { status: 'done'; result: SpeedResult }
  | { status: 'error' };

type NetworkConfig = AppConfig['network'];

/** Сервер для тесту: адреси повні (абсолютні), щоб працювали й у Web Worker. */
export interface SpeedServer {
  name: 'cloudflare' | 'own';
  downloadUrl: string;
  uploadUrl: string;
  pingUrl: string;
}

/** Сервери в порядку спроб: спершу Cloudflare, потім наш (запасний). */
export function speedServers(c: NetworkConfig, siteBase: string): SpeedServer[] {
  const own = (path: string) => new URL(path, siteBase).href;
  return [
    { name: 'cloudflare', ...c.cloudflare },
    {
      name: 'own',
      downloadUrl: own(c.downloadPath),
      uploadUrl: own(c.uploadEndpoint),
      pingUrl: own(c.pingPath),
    },
  ];
}

/** Мбіт/с з байтів і мілісекунд. */
export function mbps(bytes: number, ms: number): number {
  return ms <= 0 ? 0 : (bytes * 8) / (ms * 1000);
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export type SpeedProblem = 'download' | 'upload';

/** Які показники не дотягують до формату (пінг не перевіряється). */
export function speedProblems(r: SpeedResult, c: NetworkConfig): SpeedProblem[] {
  const out: SpeedProblem[] = [];
  if (!(r.downloadMbps >= c.minDownloadMbps)) out.push('download');
  if (!(r.uploadMbps >= c.minUploadMbps)) out.push('upload');
  return out;
}

/**
 * Пропускна здатність без «розгону»: перші graceMs з'єднання TCP ще розганяються,
 * тому рахуємо байти лише після цього моменту.
 */
export function steadyMbps(bytesAtGrace: number, bytesTotal: number, graceMs: number, elapsedMs: number): number {
  if (elapsedMs <= graceMs) return mbps(bytesTotal, elapsedMs);
  return mbps(bytesTotal - bytesAtGrace, elapsedMs - graceMs);
}

/** Додає до адреси випадковий параметр, щоб обійти кеш. */
export function withBust(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}r=${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Вимірювання (працює і в основному потоці, і в Web Worker)
// ---------------------------------------------------------------------------

const GRACE_MS = 600;

/** Пінг: медіана часу від запиту до першого байта відповіді (перший запит — прогрів, не рахуємо). */
async function measurePing(s: SpeedServer, c: NetworkConfig): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i <= c.pingSamples; i++) {
    const url = withBust(s.pingUrl);
    const t0 = performance.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`ping HTTP ${res.status}`);
    await res.arrayBuffer();
    const total = performance.now() - t0;
    // Для чужого домену браузер без Timing-Allow-Origin дає нулі — тоді беремо повний час запиту.
    const entry = performance.getEntriesByName(url).at(-1) as PerformanceResourceTiming | undefined;
    const rtt = entry && entry.responseStart > 0 && entry.requestStart > 0 ? entry.responseStart - entry.requestStart : total;
    if (i > 0) samples.push(rtt);
  }
  return median(samples);
}

/** Завантаження: кілька паралельних потоків читають файл до дедлайну. */
async function measureDownload(s: SpeedServer, c: NetworkConfig): Promise<number> {
  const controller = new AbortController();
  let bytes = 0;
  let bytesAtGrace = 0;
  const started = performance.now();
  const deadline = started + c.testSeconds * 1000;
  const graceTimer = setTimeout(() => (bytesAtGrace = bytes), GRACE_MS);
  const stopTimer = setTimeout(() => controller.abort(), c.testSeconds * 1000);

  const worker = async () => {
    while (performance.now() < deadline) {
      const res = await fetch(withBust(s.downloadUrl), { cache: 'no-store', signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: c.parallel }, worker));
  clearTimeout(graceTimer);
  clearTimeout(stopTimer);
  // Обрив за дедлайном — норма; будь-яка інша помилка без жодного байта — тест не вдався.
  const failure = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected' && (r.reason as Error)?.name !== 'AbortError',
  );
  if (failure && bytes === 0) throw failure.reason;
  return steadyMbps(bytesAtGrace, bytes, GRACE_MS, Math.min(performance.now(), deadline) - started);
}

function randomPayload(size: number): Blob {
  const data = new Uint8Array(size);
  // getRandomValues приймає не більше 65 536 байтів за раз; дані випадкові, щоб їх не стиснули.
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(data.subarray(i, Math.min(size, i + 65536)));
  return new Blob([data]);
}

/** Віддача: XHR дає прогрес по байтах, тож рахуємо й недовантажені шматки. */
async function measureUpload(s: SpeedServer, c: NetworkConfig): Promise<number> {
  const payload = randomPayload(c.uploadChunkBytes);
  const started = performance.now();
  const deadline = started + c.testSeconds * 1000;
  const loaded = new Array<number>(c.parallel).fill(0);
  const done = new Array<number>(c.parallel).fill(0);
  const total = () => loaded.reduce((sum, v, i) => sum + v + done[i]!, 0);
  let bytesAtGrace = 0;
  const graceTimer = setTimeout(() => (bytesAtGrace = total()), GRACE_MS);
  const active = new Set<XMLHttpRequest>();
  const stopTimer = setTimeout(() => active.forEach((x) => x.abort()), c.testSeconds * 1000);

  const sendOne = (i: number) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      active.add(xhr);
      xhr.open('POST', withBust(s.uploadUrl));
      xhr.upload.onprogress = (e) => (loaded[i] = e.loaded);
      const finish = (ok: boolean) => {
        active.delete(xhr);
        if (ok) done[i]! += payload.size;
        else done[i]! += loaded[i]!;
        loaded[i] = 0;
        resolve();
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) finish(true);
        else {
          active.delete(xhr);
          reject(new Error(`upload HTTP ${xhr.status}`));
        }
      };
      // Помилка мережі до першого байта — сервер недоступний; інакше рахуємо відправлене.
      xhr.onerror = () => {
        if (total() === 0) {
          active.delete(xhr);
          reject(new Error('upload network error'));
        } else finish(false);
      };
      xhr.onabort = () => finish(false);
      xhr.send(payload);
    });

  const worker = async (i: number) => {
    while (performance.now() < deadline) await sendOne(i);
  };
  try {
    await Promise.all(Array.from({ length: c.parallel }, (_, i) => worker(i)));
  } finally {
    clearTimeout(graceTimer);
    clearTimeout(stopTimer);
    active.forEach((x) => x.abort());
  }
  return steadyMbps(bytesAtGrace, total(), GRACE_MS, Math.min(performance.now(), deadline) - started);
}

function connectionInfo(): SpeedResult['connection'] {
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; type?: string };
  }).connection;
  if (!conn) return null;
  return { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt, type: conn.type };
}

export type SpeedPhase = 'ping' | 'download' | 'upload';

/** Проміжний стан тесту: яка фаза йде і які числа вже виміряно. */
export interface SpeedProgress {
  phase: SpeedPhase;
  downloadMbps?: number;
}

async function runOn(
  s: SpeedServer,
  c: NetworkConfig,
  onProgress?: (progress: SpeedProgress) => void,
): Promise<SpeedResult> {
  onProgress?.({ phase: 'ping' });
  const pingMs = await measurePing(s, c);
  onProgress?.({ phase: 'download' });
  const downloadMbps = await measureDownload(s, c);
  onProgress?.({ phase: 'upload', downloadMbps });
  const uploadMbps = await measureUpload(s, c);
  return { downloadMbps, uploadMbps, pingMs, server: s.name, connection: connectionInfo() };
}

/**
 * Повний тест: пінг, завантаження, віддача (послідовно, щоб не заважали одне одному).
 * Якщо перший сервер недоступний (помилка мережі чи HTTP) — пробуємо наступний.
 */
export async function runSpeedTestOn(
  servers: SpeedServer[],
  c: NetworkConfig,
  onProgress?: (progress: SpeedProgress) => void,
): Promise<SpeedResult> {
  let lastError: unknown = new Error('no servers');
  for (const s of servers) {
    try {
      return await runOn(s, c, onProgress);
    } catch (err) {
      console.warn(`Тест інтернету через ${s.name} не вдався`, err);
      lastError = err;
    }
  }
  throw lastError;
}
