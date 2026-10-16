import { describe, expect, it } from 'vitest';
import { MediaAccessError, classifyMediaError, missingKind } from './mediaErrors';

const domErr = (name: string, message = '') => ({ name, message });

describe('classifyMediaError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'notFound'],
    ['DevicesNotFoundError', 'notFound'],
    ['OverconstrainedError', 'notFound'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'unsupported'],
    ['SomethingElse', 'unknown'],
  ])('%s → %s', (name, code) => {
    expect(classifyMediaError(domErr(name)).code).toBe(code);
  });

  it('розпізнає блокування налаштуваннями ОС', () => {
    expect(classifyMediaError(domErr('NotAllowedError', 'Permission denied by system')).code).toBe(
      'deniedBySystem',
    );
  });

  it('передає вид пристрою', () => {
    expect(classifyMediaError(domErr('NotReadableError'), 'camera')).toEqual({
      code: 'busy',
      kind: 'camera',
    });
  });

  it('не чіпає вже розпізнану помилку', () => {
    const err = new MediaAccessError({ code: 'insecure', kind: 'both' });
    expect(classifyMediaError(err, 'camera')).toEqual({ code: 'insecure', kind: 'both' });
  });

  it('витримує не-об’єкти', () => {
    expect(classifyMediaError(null).code).toBe('unknown');
    expect(classifyMediaError('oops').code).toBe('unknown');
  });
});

describe('missingKind', () => {
  const cam = { kind: 'videoinput' as const };
  const mic = { kind: 'audioinput' as const };
  const out = { kind: 'audiooutput' as const };

  it('бракує мікрофона', () => expect(missingKind([cam, out])).toBe('microphone'));
  it('бракує камери', () => expect(missingKind([mic, out])).toBe('camera'));
  it('бракує обох', () => expect(missingKind([out])).toBe('both'));
  it('обидва є — не знаємо, кажемо обидва', () => expect(missingKind([cam, mic])).toBe('both'));
});
