import { BUILTIN, HEADSET_STRONG, HEADSET_WEAK, WEBCAM } from './micKeywords';

export type MicKind = 'headset' | 'builtin' | 'unknown';

function hasAny(label: string, words: readonly string[]): boolean {
  return words.some((w) => label.includes(w));
}

/**
 * Грубо визначає тип мікрофона за назвою пристрою (MediaDeviceInfo.label).
 * Це лише підказка: назва не доводить, що гарнітура на голові.
 */
export function classifyMicLabel(label: string): MicKind {
  const l = label.toLowerCase();
  if (!l.trim()) return 'unknown';
  if (hasAny(l, HEADSET_STRONG)) return 'headset';
  if (hasAny(l, WEBCAM)) return 'builtin';
  if (hasAny(l, BUILTIN)) return 'builtin';
  if (hasAny(l, HEADSET_WEAK)) return 'headset';
  return 'unknown';
}
