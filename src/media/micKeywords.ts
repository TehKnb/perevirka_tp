/**
 * Ключові слова для розпізнавання типу мікрофона за назвою пристрою.
 * Порівняння без урахування регістру, за входженням підрядка.
 * Доповнюйте списки, коли зустрінете нові назви на реальних комп'ютерах.
 *
 * Порядок перевірки (див. classifyMicLabel):
 *   1. HEADSET_STRONG  → 'headset'  (явно гарнітура/навушники)
 *   2. WEBCAM          → 'builtin'  (мікрофон у вебкамері — це не гарнітура, навіть якщо бренд Logitech)
 *   3. BUILTIN         → 'builtin'  (вбудований у ноутбук/монітор)
 *   4. HEADSET_WEAK    → 'headset'  (бренди гарнітур, USB, Bluetooth)
 *   інакше             → 'unknown'
 */

/** Однозначні ознаки гарнітури чи навушників. */
export const HEADSET_STRONG: readonly string[] = [
  'headset',
  'headphone',
  'earphone',
  'earbud',
  'airpods',
  'earpods',
  'hands-free',
  'handsfree',
  'гарнітур',
  'гарнитур',
  'навушник',
  'наушник',
];

/** Мікрофони, вбудовані у вебкамеру. */
export const WEBCAM: readonly string[] = [
  'webcam',
  'web cam',
  'camera',
  'камера',
  'uvc',
  'c920',
  'c922',
  'c925',
  'c930',
  'c270',
  'c310',
  'c615',
  'brio',
  'streamcam',
  'facecam',
  'kiyo',
];

/** Мікрофони, вбудовані в ноутбук, моноблок чи монітор. */
export const BUILTIN: readonly string[] = [
  'built-in',
  'builtin',
  'internal',
  'integrated',
  'array',
  'realtek',
  'intel',
  'smart sound',
  'conexant',
  'synaptics',
  'macbook',
  'imac',
  'laptop',
  'вбудован',
  'встроен',
  'внутрішн',
  'внутренн',
];

/** Слабші ознаки гарнітури: бренди, USB, Bluetooth. */
export const HEADSET_WEAK: readonly string[] = [
  'jabra',
  'logitech',
  'plantronics',
  'poly',
  'sennheiser',
  'epos',
  'hyperx',
  'hator',
  'razer',
  'steelseries',
  'corsair',
  'audio-technica',
  'shure',
  'jbl',
  'sony',
  'bose',
  'beats',
  'usb',
  'bluetooth',
  // Мікрофон, підключений у роз'єм навушників (так macOS показує дротові EarPods 3.5 мм).
  'external microphone',
  'зовнішній мікрофон',
  'внешний микрофон',
];
