import { describe, expect, it } from 'vitest';
import { CHECK_ORDER } from './criteria';
import { CHECK_GROUPS, groupStatus } from './groups';

describe('CHECK_GROUPS', () => {
  it('кожен пункт, крім інтернету, рівно в одній групі', () => {
    const grouped = CHECK_GROUPS.flatMap((g) => g.checks);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(CHECK_ORDER.filter((id) => id !== 'internet').sort());
  });
});

describe('groupStatus', () => {
  const pass = { status: 'pass' as const, severity: 'hard' as const };
  const hardFail = { status: 'fail' as const, severity: 'hard' as const };
  const softFail = { status: 'fail' as const, severity: 'soft' as const };
  const checking = { status: 'checking' as const, severity: 'hard' as const };

  it('нічого не перевірено', () => expect(groupStatus([checking, checking])).toBe('none'));
  it('усе виконано', () => expect(groupStatus([pass, pass])).toBe('ok'));
  it('частина виконана, частина ні', () => expect(groupStatus([pass, hardFail, softFail])).toBe('partial'));
  it('обов’язкове не виконано зовсім', () => expect(groupStatus([hardFail, softFail])).toBe('attention'));
  it('лишилися тільки поради', () => expect(groupStatus([pass, softFail])).toBe('advice'));
  it('виконане разом з ще не перевіреним — частково', () => expect(groupStatus([pass, checking])).toBe('partial'));
});
