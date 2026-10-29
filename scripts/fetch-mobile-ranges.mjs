// Збирає з бази RIPE діапазони IP-адрес, які українські мобільні оператори видають
// абонентам мобільного інтернету (зокрема коли ноутбук роздає інтернет з телефона).
// Результат — src/network/mobileRanges.json; файл комітиться, скрипт запускають вручну
// раз на кілька місяців: npm run fetch-mobile-ranges
//
// Як класифікуємо: беремо анонсовані префікси оператора (RIPEstat announced-prefixes),
// для кожного — запис inetnum/inet6num і його безпосередні підблоки (address-space-hierarchy).
// Блок мобільний, якщо в назві чи описі є ознаки мобільної мережі (GSM, APN, mobile…),
// і не мобільний, якщо є ознаки домашнього/офісного підключення (FTTB, DSL…).
//
// Описи в RIPE бувають неточні: Київстар підписує «Kyivstar GSM» і блоки, які насправді
// видає домашньому інтернету. Тому кожну мережу /24 ще перевіряємо за зворотним DNS-іменем (PTR),
// яке дає адресам сам оператор: …mobile.kyivstar.net, …gprs.kyivstar.net, …mobile.vf-ua.net —
// мобільні; …broadband.kyivstar.net, …ip.kyivstar.net, …staticip.vf-ua.net — домашні/офісні.
// Ім'я, якщо воно є, важливіше за опис у RIPE; без імені (або з загальним іменем) вирішує
// запис inetnum саме цієї мережі в базі RIPE (rest.db.ripe.net).

import { lookupService } from 'node:dns';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const OPERATORS = [
  // Київстар підписує в RIPE «Kyivstar GSM» навіть мережі домашнього інтернету (…broadband.kyivstar.net),
  // тож для нього мобільна мережа — лише та, чиї адреси названо …mobile / …gprs.kyivstar.net.
  { asn: 15895, name: 'Київстар', requirePtr: true },
  { asn: 21497, name: 'Vodafone' },
  // lifecell — лише мобільний оператор (домашній інтернет групи — окремі мережі Datagroup-Volia),
  // тож його блоки без явних ознак вважаємо мобільними.
  { asn: 34058, name: 'lifecell', mobileOnly: true },
];

const FIXED = /fttb|ftth|fttx|xdsl|adsl|\bdsl|gpon|xpon|docsis|cable|golden telecom|\bgtua\b|volia|datagroup|broadband|home|wifi|wi-fi|static|corporate|business|infra|server|hosting|dedicated|colo|b2b|customer|peering|self_|internal|\biot\b/i;
const MOBILE = /gsm|mobile|\bapn\b|-apn|gprs|umts|\blte\b|\b[345]g\b|dynpool|cgnat|nat-?pool|subscriber|\bmbb\b/i;

const STAT = 'https://stat.ripe.net/data';

// --- зворотні DNS-імена (PTR) -----------------------------------------------------

// «dialup» мобільний лише в UMC/Vodafone (dialup.umc.net.ua); SOL-dialup (sovam) і dialup.alkar — дротовий доступ.
const MOBILE_PTR = /(^|[.-])(mobile|gprs|mbb|lte|apn)([.-]|$)|dialup\.umc\./i;
const FIXED_PTR = /broadband|staticip|static|fttb|ftth|xdsl|adsl|pppoe|sovam|alkar|vega|\.ip\.kyivstar\.|cable|home|mdu-/i;
// Системний резолвер (getnameinfo): вбудований DNS-клієнт Node на Windows може дивитися не на ті сервери.
const nameOf = promisify(lookupService);
// getnameinfo іде через пул потоків libuv (за замовчуванням 4) — розширюємо, щоб перевіряти паралельно.
process.env.UV_THREADPOOL_SIZE ??= '64';

/** 'mobile' | 'fixed' | null — за іменем адреси. */
async function ptrKind(ip) {
  try {
    const { hostname: names } = await nameOf(ip, 0);
    if (names === ip) return null; // імені немає — getnameinfo повертає саму адресу
    // Спершу ознаки домашнього/офісного — вони точніші (напр., SOL-dialup — дротовий).
    if (FIXED_PTR.test(names)) return 'fixed';
    if (MOBILE_PTR.test(names)) return 'mobile';
  } catch {
    // немає імені
  }
  return null;
}

/** Для мережі /24 перевіряємо дві адреси; якщо хоч одна домашня — уся мережа не мобільна. */
async function subnetKind(base) {
  const kinds = await Promise.all([77n, 177n].map((x) => ptrKind(bigToV4(base + x))));
  if (kinds.includes('fixed')) return 'fixed';
  if (kinds.includes('mobile')) return 'mobile';
  return null;
}

/** Запис inetnum із бази RIPE, що покриває адресу (кеш за діапазонами — мережі /24 часто в одному записі). */
const inetnumCache = [];
async function ripeInetnum(ip) {
  const n = v4ToBig(ip);
  const hit = inetnumCache.find((r) => n >= r.start && n <= r.end);
  if (hit) return hit.obj;
  const data = await getJson(`https://rest.db.ripe.net/search.json?query-string=${ip}&type-filter=inetnum&flags=no-referenced`);
  const attrs = data.objects?.object?.[0]?.attributes?.attribute ?? [];
  const obj = { inetnum: '', netname: '', descr: [], remarks: [] };
  for (const a of attrs) {
    if (a.name === 'inetnum') obj.inetnum = a.value;
    else if (a.name === 'netname') obj.netname = a.value;
    else if (a.name === 'descr') obj.descr.push(a.value);
  }
  if (obj.inetnum) {
    const r = blockRange(obj);
    inetnumCache.push({ start: r.start, end: r.end, obj });
  }
  return obj;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

// --- адреси як BigInt, щоб однаково працювати з IPv4 та IPv6 ---------------------------

function v4ToBig(ip) {
  return ip.split('.').reduce((acc, p) => (acc << 8n) + BigInt(Number(p)), 0n);
}

function v6ToBig(ip) {
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const parts = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return parts.reduce((acc, p) => (acc << 16n) + BigInt(parseInt(p || '0', 16)), 0n);
}

function cidrRange(cidr) {
  const [ip, len] = cidr.split('/');
  const v6 = ip.includes(':');
  const bits = v6 ? 128n : 32n;
  const start = v6 ? v6ToBig(ip) : v4ToBig(ip);
  const size = 1n << (bits - BigInt(Number(len)));
  return { v6, start, end: start + size - 1n };
}

/** "1.2.3.0 - 1.2.3.255" (inetnum) або "2a00::/32" (inet6num). */
function blockRange(obj) {
  if (obj.inetnum) {
    const [a, b] = obj.inetnum.split('-').map((s) => s.trim());
    return { v6: false, start: v4ToBig(a), end: v4ToBig(b) };
  }
  return cidrRange(obj.inet6num);
}

function bigToV4(n) {
  return [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 255n)).join('.');
}

function bigToV6(n) {
  const parts = [];
  for (let s = 112n; s >= 0n; s -= 16n) parts.push(((n >> s) & 0xffffn).toString(16));
  return parts.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
}

// --- класифікація ---------------------------------------------------------------

function describe(obj) {
  return [obj.netname, obj.descr, obj.remarks].flat().filter(Boolean).join(' | ');
}

/** 'mobile' | 'fixed' | null (невідомо) */
function classify(obj, op) {
  const text = describe(obj);
  if (FIXED.test(text)) return 'fixed';
  if (MOBILE.test(text) || op.mobileOnly) return 'mobile';
  return null;
}

/** Інтервали [start, end] без перетинів; mobile мінус fixed. */
function subtract(ranges, holes) {
  let out = ranges;
  for (const h of holes) {
    out = out.flatMap((r) => {
      if (h.end < r.start || h.start > r.end) return [r];
      const parts = [];
      if (h.start > r.start) parts.push({ start: r.start, end: h.start - 1n });
      if (h.end < r.end) parts.push({ start: h.end + 1n, end: r.end });
      return parts;
    });
  }
  return out;
}

function merge(ranges) {
  const s = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out = [];
  for (const r of s) {
    const last = out.at(-1);
    if (last && r.start <= last.end + 1n) {
      if (r.end > last.end) last.end = r.end;
    } else out.push({ ...r });
  }
  return out;
}

/** Відкидає префікси, що лежать усередині інших префіксів того ж оператора. */
function topLevel(prefixes) {
  const ranges = prefixes.map((p) => ({ prefix: p, ...cidrRange(p) }));
  return ranges.filter(
    (r) => !ranges.some((o) => o !== r && o.v6 === r.v6 && o.start <= r.start && o.end >= r.end && (o.start < r.start || o.end > r.end)),
  );
}

const report = { mobile: new Map(), fixed: new Map(), unknown: new Map() };
const note = (kind, obj) => {
  const key = describe(obj).replace(/\d+/g, '#');
  report[kind].set(key, (report[kind].get(key) ?? 0) + 1);
};

async function operatorRanges(op) {
  const announced = await getJson(`${STAT}/announced-prefixes/data.json?resource=AS${op.asn}`);
  const prefixes = topLevel(announced.data.prefixes.map((p) => p.prefix));
  const mobile = [];
  const fixed = [];
  for (const p of prefixes) {
    const h = await getJson(`${STAT}/address-space-hierarchy/data.json?resource=${encodeURIComponent(p.prefix)}`);
    const parents = [...(h.data.exact ?? []), ...(h.data.less_specific ?? [])].filter((o) => {
      const r = blockRange(o);
      // Батьківський блок самого RIR (IANA-BLK, ::/0 тощо) нічого не каже про оператора.
      return r.end - r.start < (p.v6 ? 1n << 112n : 1n << 26n);
    });
    const children = h.data.more_specific ?? [];
    // Спершу батьківські блоки (покривають увесь префікс), потім підблоки уточнюють.
    for (const o of parents) {
      const kind = classify(o, op);
      note(kind ?? 'unknown', o);
      const r = blockRange(o);
      const clipped = { start: r.start > p.start ? r.start : p.start, end: r.end < p.end ? r.end : p.end };
      if (kind === 'mobile') mobile.push({ v6: p.v6, ...clipped });
    }
    for (const o of children) {
      const kind = classify(o, op);
      note(kind ?? 'unknown', o);
      const r = blockRange(o);
      if (kind === 'mobile') mobile.push(r);
      // Невідомий підблок усередині мобільного — теж виключаємо: краще пропустити, ніж помилково заблокувати.
      else fixed.push(r);
    }
  }
  const result = {};
  for (const v6 of [false, true]) {
    const m = merge(subtract(merge(mobile.filter((r) => r.v6 === v6)), merge(fixed.filter((r) => r.v6 === v6))));
    result[v6 ? 'v6' : 'v4'] = m;
  }

  // IPv4 — по кожній мережі /24 усіх анонсованих префіксів оператора:
  // спершу ім'я адрес (PTR), а якщо його немає чи воно загальне — запис inetnum цієї мережі в RIPE.
  const subnets = [];
  for (const p of prefixes.filter((x) => !x.v6)) {
    for (let base = p.start; base <= p.end; base += 256n) subnets.push(base);
  }
  const kinds = await pool(subnets, 64, subnetKind);
  // Частина запитів імен при великій кількості паралельних може не отримати відповіді —
  // мережі без імені перевіряємо ще двічі, повільніше.
  for (const limit of [16, 4]) {
    const retry = subnets.map((_, i) => i).filter((i) => kinds[i] === null);
    const again = await pool(retry, limit, (i) => subnetKind(subnets[i]));
    retry.forEach((i, k) => (kinds[i] = again[k]));
  }
  const stats = { mobile: 0, fixed: 0, none: 0, ripeMobile: 0 };
  const v4 = [];
  for (let i = 0; i < subnets.length; i++) {
    const base = subnets[i];
    let kind = kinds[i];
    stats[kind ?? 'none']++;
    if (kind === null && !op.requirePtr) {
      const obj = await ripeInetnum(bigToV4(base + 77n));
      kind = classify(obj, op);
      note(kind ?? 'unknown', obj);
      if (kind === 'mobile') stats.ripeMobile++;
    }
    if (kind === 'mobile') v4.push({ start: base, end: base + 255n });
  }
  result.v4 = merge(v4);
  result.ptrStats = stats;
  return result;
}

const out = { source: 'RIPE NCC (stat.ripe.net) + зворотні DNS-імена (PTR)', generated: new Date().toISOString().slice(0, 10), operators: [] };
for (const op of OPERATORS) {
  process.stdout.write(`AS${op.asn} ${op.name}… `);
  const r = await operatorRanges(op);
  const count = (list, bits) => list.reduce((s, x) => s + (x.end - x.start + 1n), 0n) >> bits;
  console.log(`IPv4: ${r.v4.length} діапазонів, ${count(r.v4, 0n)} адрес; IPv6: ${r.v6.length} діапазонів, ${count(r.v6, 64n)} мереж /64`);
  const st = r.ptrStats;
  console.log(`   мережі /24 за іменами: мобільні ${st.mobile}, домашні/офісні ${st.fixed}, без імені ${st.none} (з них мобільні за RIPE: ${st.ripeMobile})`);
  out.operators.push({
    asn: op.asn,
    name: op.name,
    v4: r.v4.map((x) => [bigToV4(x.start), bigToV4(x.end)]),
    v6: r.v6.map((x) => [bigToV6(x.start), bigToV6(x.end)]),
  });
}

if (process.argv.includes('--report')) {
  for (const kind of ['mobile', 'fixed', 'unknown']) {
    console.log(`\n=== ${kind}`);
    [...report[kind]].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(String(n).padStart(5), k));
  }
}

const file = new URL('../src/network/mobileRanges.json', import.meta.url);
await writeFile(file, JSON.stringify(out, null, 0).replace(/\],\[/g, '],\n[') + '\n');
console.log(`Записано ${file.pathname}`);
