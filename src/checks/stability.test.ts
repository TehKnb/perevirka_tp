import { describe, expect, it } from 'vitest';
import { hints } from '../texts';
import type { CheckId, RawCheck, RawStatus, Severity } from './criteria';
import { contourStateFor, initialSetupState, stepSetup, type SetupState } from './stability';

const cfg = { failFrames: 3, passFrames: 6, hintMinIntervalMs: 1500 };

function raw(id: CheckId, status: RawStatus, hint: string | null = null, severity: Severity = 'hard'): RawCheck {
  return { id, severity, status, value: null, hint: status === 'pass' ? null : hint };
}

/** Проганяє послідовність кадрів (по 100 мс) і повертає останній результат. */
function runFrames(frames: RawCheck[][], start: SetupState = initialSetupState(), t0 = 0) {
  let state = start;
  let result = stepSetup(state, frames[0]!, t0, cfg).result;
  frames.forEach((f, i) => {
    const step = stepSetup(state, f, t0 + i * 100, cfg);
    state = step.state;
    result = step.result;
  });
  return { state, result };
}

const repeat = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

describe('stepSetup — гістерезис', () => {
  it('спершу «перевіряємо»', () => {
    const { result } = runFrames([[raw('face', 'pass')]]);
    expect(result.checks[0]!.status).toBe('checking');
    expect(result.ok).toBe(false);
    expect(result.mainHint).toBe(hints.checking);
  });

  it('виконано лише після passFrames кадрів поспіль', () => {
    expect(runFrames(repeat(5, [raw('face', 'pass')])).result.checks[0]!.status).toBe('checking');
    expect(runFrames(repeat(6, [raw('face', 'pass')])).result.checks[0]!.status).toBe('pass');
  });

  it('провалено після failFrames кадрів поспіль', () => {
    expect(runFrames(repeat(2, [raw('face', 'fail', hints.noFace)])).result.checks[0]!.status).toBe('checking');
    expect(runFrames(repeat(3, [raw('face', 'fail', hints.noFace)])).result.checks[0]!.status).toBe('fail');
  });

  it('поодинокий провальний кадр не скидає виконаний критерій', () => {
    const frames = [
      ...repeat(6, [raw('face', 'pass')]),
      [raw('face', 'fail', hints.noFace)],
      [raw('face', 'fail', hints.noFace)],
      [raw('face', 'pass')],
    ];
    expect(runFrames(frames).result.checks[0]!.status).toBe('pass');
  });

  it("невідомий жорсткий = провал, невідомий м'який не змінює стану", () => {
    expect(runFrames(repeat(3, [raw('fit', 'unknown', hints.fit)])).result.checks[0]!.status).toBe('fail');
    expect(runFrames(repeat(5, [raw('bgObjects', 'unknown', null, 'soft')])).result.checks[0]!.status).toBe('checking');
  });
});

describe('stepSetup — перевірка, що триває (pending)', () => {
  it('не провал і не виконано; блокує ok; її підказка — коли інших проблем немає', () => {
    const frame = [raw('face', 'pass'), { ...raw('internet', 'pending'), hint: hints.internetChecking }];
    const { result } = runFrames(repeat(10, frame));
    expect(result.checks.find((c) => c.id === 'internet')!.status).toBe('checking');
    expect(result.ok).toBe(false);
    expect(result.mainHint).toBe(hints.internetChecking);
  });

  it('провалений критерій важливіший за підказку «перевіряємо інтернет»', () => {
    const frame = [raw('face', 'fail', hints.noFace), { ...raw('internet', 'pending'), hint: hints.internetChecking }];
    expect(runFrames(repeat(4, frame)).result.mainHint).toBe(hints.noFace);
  });
});

describe('stepSetup — ok і stableMs', () => {
  it('ok, коли всі жорсткі виконані; м\'які не заважають', () => {
    const frame = [raw('face', 'pass'), raw('bgObjects', 'fail', hints.bgObjects, 'soft')];
    const { result } = runFrames(repeat(10, frame));
    expect(result.ok).toBe(true);
    // ok з 6-го кадру (індекс 5, t=500) до останнього (t=900)
    expect(result.stableMs).toBe(400);
  });

  it('stableMs скидається, щойно жорсткий критерій провалено', () => {
    const frames = [...repeat(10, [raw('face', 'pass')]), ...repeat(3, [raw('face', 'fail', hints.noFace)])];
    const { result } = runFrames(frames);
    expect(result.ok).toBe(false);
    expect(result.stableMs).toBe(0);
  });
});

describe('stepSetup — головна підказка', () => {
  it('за пріоритетом: обличчя важливіше за фон', () => {
    const frame = [raw('bgBright', 'fail', hints.bgDark), raw('face', 'fail', hints.noFace)];
    expect(runFrames(repeat(3, frame)).result.mainHint).toBe(hints.noFace);
  });

  it("м'яка підказка — коли жорсткі виконані", () => {
    const frame = [raw('face', 'pass'), raw('bgObjects', 'fail', hints.bgObjects, 'soft')];
    expect(runFrames(repeat(10, frame)).result.mainHint).toBe(hints.bgObjects);
  });

  it('усе гаразд → «Чудово»', () => {
    expect(runFrames(repeat(6, [raw('face', 'pass')])).result.mainHint).toBe(hints.allGood);
  });

  it('не змінюється частіше ніж раз на 1.5 с', () => {
    // Кадри по 100 мс: підказка «немає обличчя» з'являється на 3-му кадрі (t=200).
    let { state, result } = runFrames(repeat(3, [raw('face', 'fail', hints.noFace)]));
    expect(result.mainHint).toBe(hints.noFace);
    // Обличчя з'явилося, але далеко: distance провалено з t=300.
    const frame = [raw('face', 'pass'), raw('distance', 'fail', hints.closer)];
    for (let t = 300; t <= 1600; t += 100) {
      const step = stepSetup(state, frame, t, cfg);
      state = step.state;
      result = step.result;
    }
    // t=1600: ще не минуло 1.5 с від t=200
    expect(result.mainHint).toBe(hints.noFace);
    const step = stepSetup(state, frame, 1700, cfg);
    expect(step.result.mainHint).toBe(hints.closer);
  });

  it('формат результату як у специфікації', () => {
    const { result } = runFrames(repeat(3, [raw('headPose', 'fail', hints.raiseCamera)]));
    expect(result).toEqual({
      ok: false,
      stableMs: 0,
      checks: [{ id: 'headPose', status: 'fail', severity: 'hard', value: null, hint: hints.raiseCamera }],
      mainHint: hints.raiseCamera,
    });
  });
});

describe('contourStateFor', () => {
  const base = { stableMs: 0, mainHint: '' };
  const faceOk = { id: 'face' as const, status: 'pass' as const, severity: 'hard' as const, value: 1, hint: null };
  it('усе гаразд → зелений', () => {
    expect(contourStateFor({ ...base, ok: true, checks: [faceOk] }, 0.8, 0.7, 0.15)).toBe('ok');
  });
  it('обличчя є й майже в контурі → оранжевий', () => {
    expect(contourStateFor({ ...base, ok: false, checks: [faceOk] }, 0.6, 0.7, 0.15)).toBe('almost');
  });
  it('далеко від контуру → нейтральний', () => {
    expect(contourStateFor({ ...base, ok: false, checks: [faceOk] }, 0.3, 0.7, 0.15)).toBe('neutral');
    expect(contourStateFor({ ...base, ok: false, checks: [] }, 0.9, 0.7, 0.15)).toBe('neutral');
  });
});
