import type { AppConfig } from '../config';

/** Результат вимірювання інтернету. */
export interface SpeedResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  /** navigator.connection (лише Chromium): грубі оцінки браузера, для метаданих. */
  connection: { effectiveType?: string; downlink?: number; rtt?: number; type?: string } | null;
}

export type NetworkState =
  | { status: 'checking' }
  | { status: 'done'; result: SpeedResult }
  | { status: 'error' };

type NetworkConfig = AppConfig['network'];

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

export type SpeedProblem = 'download' | 'upload' | 'ping';

/** Які показники не дотягують до формату. */
export function speedProblems(r: SpeedResult, c: NetworkConfig): SpeedProblem[] {
  const out: SpeedProblem[] = [];
  if (!(r.downloadMbps >= c.minDownloadMbps)) out.push('download');
  if (!(r.uploadMbps >= c.minUploadMbps)) out.push('upload');
  if (!(r.pingMs <= c.maxPingMs)) out.push('ping');
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

// ---------------------------------------------------------------------------
// Вимірювання в браузері (не чисті функції)
// ---------------------------------------------------------------------------

const GRACE_MS = 600;
const base = () => import.meta.env.BASE_URL;
const bust = (path: string) => `${base()}${path}?r=${Math.random().toString(36).slice(2)}`;

/** Пінг: медіана часу від запиту до першого байта відповіді (перший запит — прогрів, не рахуємо). */
async function measurePing(c: NetworkConfig): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i <= c.pingSamples; i++) {
    const url = new URL(bust(c.pingPath), location.href).href;
    const t0 = performance.now();
    const res = await fetch(url, { cache: 'no-store' });
    await res.arrayBuffer();
    const total = performance.now() - t0;
    const entry = performance.getEntriesByName(url).at(-1) as PerformanceResourceTiming | undefined;
    const rtt = entry && entry.responseStart > 0 && entry.requestStart > 0 ? entry.responseStart - entry.requestStart : total;
    if (i > 0) samples.push(rtt);
  }
  return median(samples);
}

/** Завантаження: кілька паралельних потоків читають файл до дедлайну. */
async function measureDownload(c: NetworkConfig): Promise<number> {
  const controller = new AbortController();
  let bytes = 0;
  let bytesAtGrace = 0;
  const started = performance.now();
  const deadline = started + c.testSeconds * 1000;
  const graceTimer = setTimeout(() => (bytesAtGrace = bytes), GRACE_MS);
  const stopTimer = setTimeout(() => controller.abort(), c.testSeconds * 1000);

  const worker = async () => {
    while (performance.now() < deadline) {
      const res = await fetch(bust(c.downloadPath), { cache: 'no-store', signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}`);
      const reader = res.body!.getReader();
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
async function measureUpload(c: NetworkConfig): Promise<number> {
  const payload = randomPayload(c.uploadChunkBytes);
  const started = performance.now();
  const deadline = started + c.testSeconds * 1000;
  const loaded = new Array<number>(c.parallel).fill(0);
  const done = new Array<number>(c.parallel).fill(0);
  const total = () => loaded.reduce((s, v, i) => s + v + done[i]!, 0);
  let bytesAtGrace = 0;
  const graceTimer = setTimeout(() => (bytesAtGrace = total()), GRACE_MS);
  const active = new Set<XMLHttpRequest>();
  const stopTimer = setTimeout(() => active.forEach((x) => x.abort()), c.testSeconds * 1000);

  const sendOne = (i: number) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      active.add(xhr);
      xhr.open('POST', `${c.uploadEndpoint}?r=${Math.random().toString(36).slice(2)}`);
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
      xhr.onerror = () => finish(false);
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
  pingMs?: number;
  downloadMbps?: number;
}

/** Повний тест: пінг, завантаження, віддача (послідовно, щоб не заважали одне одному). */
export async function runSpeedTest(
  c: NetworkConfig,
  onProgress?: (progress: SpeedProgress) => void,
): Promise<SpeedResult> {
  onProgress?.({ phase: 'ping' });
  const pingMs = await measurePing(c);
  onProgress?.({ phase: 'download', pingMs });
  const downloadMbps = await measureDownload(c);
  onProgress?.({ phase: 'upload', pingMs, downloadMbps });
  const uploadMbps = await measureUpload(c);
  return { downloadMbps, uploadMbps, pingMs, connection: connectionInfo() };
}
