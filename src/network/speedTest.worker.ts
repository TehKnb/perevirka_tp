/// <reference lib="webworker" />
// Тест інтернету в окремому потоці: аналіз камери займає основний потік, і там заміри
// виходили б заниженими (браузер повільніше читає дані, коли сторінка зайнята).
import type { AppConfig } from '../config';
import { runSpeedTestOn, type SpeedServer } from './speedTest';

export interface SpeedWorkerRequest {
  config: AppConfig['network'];
  servers: SpeedServer[];
}

self.onmessage = async (e: MessageEvent<SpeedWorkerRequest>) => {
  const { config, servers } = e.data;
  try {
    const result = await runSpeedTestOn(servers, config, (progress) => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
