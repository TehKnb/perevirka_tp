import { config } from '../config';
import { runSpeedTestOn, speedServers, type SpeedProgress, type SpeedResult } from './speedTest';
import type { SpeedWorkerRequest } from './speedTest.worker';

/**
 * Запускає тест інтернету в Web Worker (щоб аналіз камери не занижував заміри).
 * Якщо Worker недоступний — у основному потоці.
 */
export function runSpeedTest(onProgress?: (progress: SpeedProgress) => void): Promise<SpeedResult> {
  const servers = speedServers(config.network, new URL(import.meta.env.BASE_URL, location.href).href);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./speedTest.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return runSpeedTestOn(servers, config.network, onProgress);
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'progress'; progress: SpeedProgress }
        | { type: 'done'; result: SpeedResult }
        | { type: 'error'; message: string };
      if (msg.type === 'progress') onProgress?.(msg.progress);
      else {
        worker.terminate();
        if (msg.type === 'done') resolve(msg.result);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'speed test worker failed'));
    };
    const request: SpeedWorkerRequest = { config: config.network, servers };
    worker.postMessage(request);
  });
}
