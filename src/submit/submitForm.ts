import type { Captures } from '../screens/captureControls';
import type { NetworkState } from '../network/speedTest';

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

/**
 * Відправка результатів. Поки ТЕСТОВИЙ РЕЖИМ: нічого нікуди не надсилається,
 * лише коротке зведення в консоль браузера. Куди відправляти — додамо пізніше (етап 5).
 */
export async function submitResults(s: Submission): Promise<{ test: true }> {
  console.info('[Тестовий режим] Результати не надсилаються:', {
    name: s.name,
    stream: s.stream,
    screenshotBytes: s.captures.screenshot?.blob.size ?? 0,
    audioBytes: s.captures.audio?.blob.size ?? 0,
    audioMime: s.captures.audio?.mime,
    network: s.network,
    devices: s.devices,
    submittedAt: s.submittedAt,
  });
  await new Promise((r) => setTimeout(r, 600));
  return { test: true };
}
