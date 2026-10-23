import type { IconName } from '../ui/icons';
import type { CheckId, Severity } from './criteria';
import type { CheckStatus } from './stability';

export type GroupId = 'framing' | 'light' | 'background' | 'headset';

/**
 * Групи чекліста на екрані налаштування. Інтернет — окремим блоком з виміряними числами.
 * Кожен пункт (крім internet) має бути рівно в одній групі — це перевіряє тест.
 */
export const CHECK_GROUPS: { id: GroupId; icon: IconName; checks: CheckId[] }[] = [
  {
    id: 'framing',
    icon: 'camera',
    checks: ['resolution', 'face', 'singlePerson', 'distance', 'center', 'headPose', 'shoulders', 'fit'],
  },
  { id: 'light', icon: 'bulb', checks: ['faceBrightness', 'lowLight', 'lightEven', 'backlight', 'coldLight'] },
  { id: 'background', icon: 'image', checks: ['bgBright', 'bgNeutral', 'bgPlain', 'bgObjects'] },
  { id: 'headset', icon: 'headphones', checks: ['headset'] },
];

/**
 * Підсумок групи для плашки праворуч від назви:
 * - none — ще нічого не перевірено;
 * - ok — усе виконано;
 * - partial — щось виконано, але є обов'язкові пункти, що не пройшли (або частина ще не перевірена);
 * - attention — обов'язкові пункти не пройшли, і жоден ще не виконано;
 * - advice — обов'язкове виконано, лишилися поради (пункти з «!»).
 */
export type GroupStatus = 'none' | 'ok' | 'partial' | 'attention' | 'advice';

export function groupStatus(items: { status: CheckStatus; severity?: Severity }[]): GroupStatus {
  const evaluated = items.filter((i) => i.status === 'pass' || i.status === 'fail');
  if (evaluated.length === 0) return 'none';
  const passed = evaluated.filter((i) => i.status === 'pass').length;
  const hardFails = evaluated.filter((i) => i.status === 'fail' && i.severity !== 'soft').length;
  const softFails = evaluated.length - passed - hardFails;
  if (hardFails > 0) return passed > 0 ? 'partial' : 'attention';
  if (softFails > 0) return 'advice';
  return evaluated.length === items.length ? 'ok' : 'partial';
}
