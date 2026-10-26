import type { AppConfig } from '../config';
import { detectBrowser } from '../env';
import { audioExtension } from '../media/audioLevel';
import type { Captures } from '../screens/captureControls';
import type { NetworkState } from '../network/speedTest';
import { checkLabels } from '../texts';

export interface SubmitFormValues {
  name: string;
  stream: string;
  agreed: boolean;
}

export type SubmitFormErrors = Partial<Record<keyof SubmitFormValues, string>>;

export const formErrors = {
  nameEmpty: 'Вкажіть ім’я та прізвище.',
  nameOneWord: 'Вкажіть і ім’я, і прізвище.',
  stream: 'Вкажіть пакет/потік навчання.',
  agreed: 'Підтвердьте, що ознайомилися з вимогами.',
} as const;

/** Перевірка форми: ім'я та прізвище (щонайменше два слова), потік, згода з вимогами. */
export function validateSubmitForm(v: SubmitFormValues): SubmitFormErrors {
  const errors: SubmitFormErrors = {};
  const words = v.name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) errors.name = formErrors.nameEmpty;
  else if (words.length < 2) errors.name = formErrors.nameOneWord;
  if (!v.stream.trim()) errors.stream = formErrors.stream;
  if (!v.agreed) errors.agreed = formErrors.agreed;
  return errors;
}

/** Усе, що піде техпідтримці: дані форми, фото, аудіо й результати перевірок. */
export interface Submission {
  name: string;
  stream: string;
  captures: Captures;
  network: NetworkState | null;
  devices: { camera: string; microphone: string };
  userAgent: string;
  submittedAt: string;
}

const BROWSER_NAMES = { chrome: 'Chrome', edge: 'Edge', opera: 'Opera', firefox: 'Firefox', safari: 'Safari', other: 'інший' };

function osName(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'інша ОС';
}

/**
 * Короткий підсумок для техпідтримки (піде в підпис до фото в Telegram):
 * що не пройшло на момент фото, інтернет, пристрої, браузер, тривалість запису.
 */
export function buildSummary(s: Omit<Submission, 'name' | 'stream' | 'submittedAt'>): string {
  const lines: string[] = [];
  const setup = s.captures.screenshot?.setup;
  if (setup) {
    const failed = setup.checks.filter((c) => c.status === 'fail');
    const hard = failed.filter((c) => c.severity === 'hard').map((c) => checkLabels[c.id]);
    const soft = failed.filter((c) => c.severity === 'soft').map((c) => checkLabels[c.id]);
    lines.push(hard.length === 0 ? 'Перевірки на момент фото: усі обов’язкові виконано' : `Не виконано на момент фото: ${hard.join(', ')}`);
    if (soft.length > 0) lines.push(`Поради: ${soft.join(', ')}`);
  }
  const n = s.network;
  if (n?.status === 'done') {
    const r = n.result;
    const kind =
      r.network.kind === 'mobile'
        ? `мобільний${r.network.operator ? ` (${r.network.operator})` : ''}`
        : r.network.kind === 'other'
          ? 'не мобільний'
          : 'тип не визначено';
    const speed =
      r.downloadMbps !== null && r.uploadMbps !== null
        ? `${r.downloadMbps.toFixed(1)} / ${r.uploadMbps.toFixed(1)} Мбіт/с`
        : 'швидкість не міряли';
    lines.push(`Інтернет: ${speed}, ${kind}`);
  } else {
    lines.push('Інтернет: не перевірено');
  }
  lines.push(`Камера: ${s.devices.camera || '—'}`);
  lines.push(`Мікрофон: ${s.devices.microphone || '—'}`);
  if (s.captures.audio) lines.push(`Запис голосу: ${Math.round(s.captures.audio.durationMs / 1000)} с`);
  lines.push(`Браузер: ${BROWSER_NAMES[detectBrowser(s.userAgent)]}, ${osName(s.userAgent)}`);
  return lines.join('\n');
}

/**
 * Відправка результатів: форма з фото й аудіо йде на нашу функцію (api/submit.js),
 * а вона пересилає все в Telegram. Токен бота на сторінку не потрапляє.
 * У тестовому режимі (config.submit.testMode) нічого не надсилається.
 */
export async function submitResults(s: Submission, c: AppConfig['submit']): Promise<void> {
  const shot = s.captures.screenshot;
  const audio = s.captures.audio;
  if (!shot || !audio) throw new Error('Немає фото або аудіо');

  if (c.testMode) {
    console.info('[Тестовий режим] Результати не надсилаються:', { name: s.name, stream: s.stream, summary: buildSummary(s) });
    await new Promise((r) => setTimeout(r, 600));
    return;
  }

  const body = new FormData();
  body.append('name', s.name);
  body.append('stream', s.stream);
  body.append('summary', buildSummary(s));
  body.append('submittedAt', s.submittedAt);
  body.append('photo', shot.blob, 'photo.jpg');
  body.append('audio', audio.blob, `audio.${audioExtension(audio.mime)}`);
  const res = await fetch(c.endpoint, { method: 'POST', body });
  if (!res.ok) throw new Error(`submit HTTP ${res.status}`);
}
