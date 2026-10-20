import mobileRanges from './mobileRanges.json';

/**
 * Тип підключення:
 * - mobile — мобільний інтернет (зокрема ноутбук через точку доступу на телефоні);
 * - other — ознак мобільного інтернету немає;
 * - unknown — не вдалося дізнатися IP (тоді не блокуємо).
 */
export type ConnectionKind =
  | { kind: 'mobile'; operator: string | null; source: 'ip' | 'browser' }
  | { kind: 'other' }
  | { kind: 'unknown' };

/** Формат src/network/mobileRanges.json (генерує scripts/fetch-mobile-ranges.mjs). */
export interface MobileRangesData {
  operators: { name: string; v4: string[][]; v6: string[][] }[];
}

interface ParsedIp {
  v6: boolean;
  value: bigint;
}

/** IPv4 чи IPv6 у BigInt; null — якщо рядок не схожий на адресу. */
export function parseIp(raw: string): ParsedIp | null {
  const ip = raw.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return parseIp(mapped[1]!);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v6: false, value: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
  }
  if (!/^[0-9a-f:]+$/.test(ip) || !ip.includes(':')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || head.length + tail.length + fill !== 8) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.some((g) => g.length === 0 || g.length > 4)) return null;
  return { v6: true, value: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

interface CompiledRange {
  operator: string;
  v6: boolean;
  start: bigint;
  end: bigint;
}

function compile(data: MobileRangesData): CompiledRange[] {
  const out: CompiledRange[] = [];
  for (const op of data.operators) {
    for (const [v6, list] of [[false, op.v4], [true, op.v6]] as const) {
      for (const [a, b] of list) {
        const start = parseIp(a!);
        const end = parseIp(b!);
        if (start && end) out.push({ operator: op.name, v6, start: start.value, end: end.value });
      }
    }
  }
  return out;
}

let defaultRanges: CompiledRange[] | null = null;
const compiledCache = new WeakMap<MobileRangesData, CompiledRange[]>();

function rangesFor(data?: MobileRangesData): CompiledRange[] {
  if (!data) return (defaultRanges ??= compile(mobileRanges as MobileRangesData));
  let r = compiledCache.get(data);
  if (!r) compiledCache.set(data, (r = compile(data)));
  return r;
}

/** Назва мобільного оператора, якщо IP з його мобільних діапазонів; інакше null. */
export function mobileOperatorFor(ip: string, data?: MobileRangesData): string | null {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  const hit = rangesFor(data).find((r) => r.v6 === parsed.v6 && parsed.value >= r.start && parsed.value <= r.end);
  return hit?.operator ?? null;
}

/**
 * Висновок про тип підключення.
 * ips — адреси, якими нас бачать сервери (IPv6 і окремо IPv4); null — не вдалося дізнатися.
 * connectionType — navigator.connection.type: на комп'ютерах зазвичай порожнє,
 * тож головна ознака — IP-адреса з мобільних діапазонів операторів.
 */
export function detectConnectionKind(
  ips: (string | null)[],
  connectionType?: string,
  data?: MobileRangesData,
): ConnectionKind {
  const valid = ips.filter((ip): ip is string => ip !== null && parseIp(ip) !== null);
  for (const ip of valid) {
    const operator = mobileOperatorFor(ip, data);
    if (operator) return { kind: 'mobile', operator, source: 'ip' };
  }
  if (connectionType === 'cellular') return { kind: 'mobile', operator: null, source: 'browser' };
  return valid.length > 0 ? { kind: 'other' } : { kind: 'unknown' };
}
