import type { AppConfig } from '../config';
import { hints } from '../texts';
import { CHECK_ORDER, type CheckId, type RawCheck, type Severity } from './criteria';

/** Згладжений стан критерію. 'checking' — ще недостатньо кадрів для рішення. */
export type CheckStatus = 'pass' | 'fail' | 'checking';

export interface CheckOutput {
  id: CheckId;
  status: CheckStatus;
  severity: Severity;
  value: number | string | null;
  hint: string | null;
}

/** Результат перевірки на поточний момент — те, що бачить інтерфейс і що піде в метадані. */
export interface SetupResult {
  ok: boolean;
  stableMs: number;
  checks: CheckOutput[];
  mainHint: string;
}

interface CheckState {
  status: CheckStatus;
  passStreak: number;
  failStreak: number;
  hint: string | null;
  value: RawCheck['value'];
  severity: Severity;
  /** Останній сирий статус — 'pending' (перевірка ще триває). */
  pending: boolean;
}

export interface SetupState {
  checks: Partial<Record<CheckId, CheckState>>;
  okSince: number | null;
  /** placeholder — проміжна підказка («Перевіряємо…»), яку можна змінити будь-коли. */
  hint: { text: string; since: number; placeholder: boolean } | null;
}

type Stability = AppConfig['stability'];

export function initialSetupState(): SetupState {
  return { checks: {}, okSince: null, hint: null };
}

/**
 * Один крок перевірки: згладжує сирі результати кадру (гістерезис) і обирає головну підказку.
 * Чиста функція: новий стан і результат залежать лише від аргументів.
 *
 * Гістерезис: критерій стає проваленим після failFrames провальних кадрів поспіль
 * і виконаним — після більшої серії passFrames. 'unknown' жорсткого критерію рахується як провал;
 * 'unknown' м'якого не змінює його стан.
 */
export function stepSetup(
  prev: SetupState,
  raw: RawCheck[],
  now: number,
  cfg: Stability,
): { state: SetupState; result: SetupResult } {
  const checks: SetupState['checks'] = {};
  for (const r of raw) {
    const p: CheckState = prev.checks[r.id] ?? {
      status: 'checking',
      passStreak: 0,
      failStreak: 0,
      hint: null,
      value: null,
      severity: r.severity,
      pending: false,
    };
    const next: CheckState = { ...p, value: r.value, severity: r.severity, pending: r.status === 'pending' };
    if (r.status === 'pending') {
      // Перевірка ще триває: не виконано, але й не провалено.
      next.status = 'checking';
      next.passStreak = 0;
      next.failStreak = 0;
      next.hint = r.hint;
    } else if (r.status === 'pass') {
      next.passStreak = p.passStreak + 1;
      next.failStreak = 0;
      if (next.passStreak >= cfg.passFrames) next.status = 'pass';
    } else if (r.status === 'fail' || r.severity === 'hard') {
      next.failStreak = p.failStreak + 1;
      next.passStreak = 0;
      if (r.hint) next.hint = r.hint;
      if (next.failStreak >= cfg.failFrames) next.status = 'fail';
    }
    checks[r.id] = next;
  }

  const ordered = CHECK_ORDER.filter((id) => checks[id]).map((id) => ({ id, s: checks[id]! }));
  const hard = ordered.filter((c) => c.s.severity === 'hard');
  const ok = hard.length > 0 && hard.every((c) => c.s.status === 'pass');
  const okSince = ok ? (prev.okSince ?? now) : null;

  // Кандидат — перший за пріоритетом проваленим критерій із підказкою.
  const failing = ordered.find((c) => c.s.status === 'fail' && c.s.hint);
  let candidate: string;
  let placeholder = false;
  // Якщо провалених немає — підказка першої перевірки, що ще триває (наприклад, інтернет).
  const pending = ordered.find((c) => c.s.pending && c.s.hint);
  if (failing) candidate = failing.s.hint!;
  else if (ok) candidate = hints.allGood;
  else if (pending) {
    candidate = pending.s.hint!;
    placeholder = true;
  } else {
    candidate = hints.checking;
    placeholder = true;
  }

  // Антимиготіння: підказка змінюється не частіше ніж раз на hintMinIntervalMs.
  // Проміжну підказку («Перевіряємо…», «Перевіряємо інтернет…») замінюємо одразу.
  let hint = prev.hint;
  const throttled = hint !== null && !hint.placeholder && now - hint.since < cfg.hintMinIntervalMs;
  if (!hint || (hint.text !== candidate && !throttled)) {
    hint = { text: candidate, since: now, placeholder };
  }

  return {
    state: { checks, okSince, hint },
    result: {
      ok,
      stableMs: okSince === null ? 0 : now - okSince,
      checks: ordered.map(({ id, s }) => ({
        id,
        status: s.status,
        severity: s.severity,
        value: s.value,
        hint: s.status === 'fail' ? s.hint : null,
      })),
      mainHint: hint.text,
    },
  };
}

export type ContourState = 'neutral' | 'almost' | 'ok';

/**
 * Колір контуру: зелений — усі жорсткі критерії виконано; оранжевий — обличчя є
 * й людина майже в контурі (IoU не нижче порогу мінус запас); інакше нейтральний.
 */
export function contourStateFor(result: SetupResult, iou: number | null, minIou: number, margin: number): ContourState {
  if (result.ok) return 'ok';
  const face = result.checks.find((c) => c.id === 'face');
  if (face?.status === 'pass' && iou !== null && iou >= minIou - margin) return 'almost';
  return 'neutral';
}
