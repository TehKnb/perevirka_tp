import type { SetupResult } from '../checks/stability';
import { config } from '../config';
import { formatTimer, isTooQuiet, levelFraction, secondsUntilMin, type LevelSample } from '../media/audioLevel';
import type { MediaManager } from '../media/mediaManager';
import { captureFrame, type Screenshot } from '../media/screenshot';
import { VoiceRecorder, canRecordAudio, type VoiceRecording } from '../media/voiceRecorder';
import { captureTexts, t } from '../texts';
import { byId } from '../ui/dom';

/**
 * Те, що піде експертам: скріншот і запис, кожне — з результатом перевірок на свій момент.
 * Для запису результат може бути null: звук можна записати ще до першого аналізу кадру.
 */
export interface Captures {
  screenshot: (Screenshot & { setup: SetupResult }) | null;
  audio: (VoiceRecording & { setup: SetupResult | null }) | null;
}

/**
 * Кнопки «Зробити скріншот» і «Записати звук» під відео.
 * «Зробити скріншот» активна, коли всі жорсткі критерії виконуються безперервно
 * config.setup.stableMsRequired. «Записати звук» від чекліста не залежить — лише від мікрофона.
 */
export function createCaptureControls(media: MediaManager, video: HTMLVideoElement) {
  const status = byId('capture-status');
  const btnShot = byId<HTMLButtonElement>('btn-screenshot');
  const btnRecord = byId<HTMLButtonElement>('btn-record');
  const btnSend = byId<HTMLButtonElement>('btn-send');
  const label = (btn: HTMLButtonElement) => btn.querySelector<HTMLElement>('.btn-label')!;
  const recordingBox = byId('recording');
  const levelBar = byId('level-bar');
  const timer = byId('rec-timer');
  const louder = byId('rec-louder');
  const btnStop = byId<HTMLButtonElement>('btn-stop');
  const capturesBox = byId('captures');
  const shotResult = byId('shot-result');
  const shotImg = byId<HTMLImageElement>('shot-img');
  const audioResult = byId('audio-result');
  const audioTitle = byId('audio-title');
  const audioPlayer = byId<HTMLAudioElement>('audio-player');

  const captures: Captures = { screenshot: null, audio: null };
  const recorder = new VoiceRecorder();
  let ready = false;
  let lastResult: SetupResult | null = null;
  let levels: LevelSample[] = [];
  let recordStartedAt = 0;
  let rafId = 0;
  let message: string | null = null;

  /** Нова адреса для перегляду; попередню звільняємо, щоб не тримати старий файл у пам'яті. */
  function replaceUrl(el: HTMLImageElement | HTMLAudioElement, blob: Blob) {
    if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src);
    el.src = URL.createObjectURL(blob);
  }

  function renderButtons() {
    const busy = recorder.recording;
    btnShot.disabled = !ready || busy;
    btnRecord.disabled = busy || !canRecordAudio() || !media.audioTrack;
    btnSend.disabled = busy || !captures.screenshot || !captures.audio;
    label(btnShot).textContent = captures.screenshot ? captureTexts.retakeScreenshot : t.capture.screenshot;
    label(btnRecord).textContent = captures.audio ? captureTexts.rerecord : t.capture.record;
  }

  function renderStatus(result: SetupResult | null) {
    let text: string;
    if (message) text = message;
    else if (!canRecordAudio()) text = captureTexts.unsupported;
    else if (ready) text = captures.screenshot && captures.audio ? captureTexts.bothDone : captureTexts.ready;
    else if (result?.ok) {
      const left = Math.max(1, Math.ceil((config.setup.stableMsRequired - result.stableMs) / 1000));
      text = captureTexts.holding(left);
    } else text = captureTexts.waiting;
    if (status.textContent !== text) status.textContent = text;
  }

  function renderCaptures() {
    capturesBox.hidden = !captures.screenshot && !captures.audio;
    shotResult.hidden = !captures.screenshot;
    audioResult.hidden = !captures.audio;
  }

  btnShot.addEventListener('click', async () => {
    if (!ready || !lastResult) return;
    message = null;
    const setup = lastResult;
    try {
      const shot = await captureFrame(video);
      captures.screenshot = { ...shot, setup };
      replaceUrl(shotImg, shot.blob);
    } catch (err) {
      console.error('Скріншот не вдався', err);
      message = captureTexts.screenshotError;
    }
    renderCaptures();
    renderButtons();
    renderStatus(lastResult);
  });

  btnRecord.addEventListener('click', () => {
    if (!media.audioTrack) return;
    message = null;
    try {
      recorder.start(media.audioTrack);
    } catch (err) {
      console.error('Запис не вдався', err);
      message = captureTexts.micError;
      renderStatus(lastResult);
      return;
    }
    levels = [];
    recordStartedAt = performance.now();
    recordingBox.hidden = false;
    louder.hidden = true;
    renderStop(0);
    renderButtons();
    meterLoop();
  });

  /** «Готово» неактивна, доки запис коротший за мінімум; на кнопці — скільки лишилося. */
  function renderStop(elapsedMs: number) {
    const left = secondsUntilMin(elapsedMs, config.recording.minDurationSec);
    const text = left > 0 ? captureTexts.stopIn(left) : t.capture.stop;
    if (btnStop.textContent !== text) btnStop.textContent = text;
    const wasDisabled = btnStop.disabled;
    btnStop.disabled = left > 0;
    // Коли кнопка стала доступна — переводимо на неї фокус (для клавіатури й читачів екрана).
    if (wasDisabled && !btnStop.disabled) btnStop.focus();
  }

  async function finishRecording() {
    if (!recorder.recording) return;
    cancelAnimationFrame(rafId);
    const setup = lastResult;
    try {
      const rec = await recorder.stop();
      captures.audio = { ...rec, setup };
      replaceUrl(audioPlayer, rec.blob);
      audioTitle.textContent = captureTexts.audioDone(Math.round(rec.durationMs / 1000));
    } catch (err) {
      console.error('Запис не вдався', err);
      message = captureTexts.micError;
    }
    recordingBox.hidden = true;
    renderCaptures();
    renderButtons();
    renderStatus(lastResult);
    btnRecord.focus();
  }

  btnSend.addEventListener('click', () => {
    if (!btnSend.disabled) controls.onSend?.();
  });

  btnStop.addEventListener('click', () => {
    if (secondsUntilMin(recorder.elapsedMs, config.recording.minDurationSec) > 0) return;
    void finishRecording();
  });
  recorder.onAutoStop = () => void finishRecording();

  /** Індикатор рівня, таймер і підказка «голосніше» — щокадру під час запису. */
  function meterLoop() {
    if (!recorder.recording) return;
    const now = performance.now();
    const db = recorder.levelDb();
    levels.push({ t: now, db });
    levels = levels.filter((s) => s.t >= now - config.recording.levelWindowMs);
    levelBar.style.transform = `scaleX(${levelFraction(db)})`;
    timer.textContent = formatTimer(recorder.elapsedMs, config.recording.maxDurationSec);
    renderStop(recorder.elapsedMs);
    louder.hidden = !isTooQuiet(levels, recordStartedAt, now, config.recording);
    rafId = requestAnimationFrame(meterLoop);
  }

  renderButtons();
  renderStatus(null);

  const controls = {
    /** «Надіслати на перевірку» — фото й звук готові. */
    onSend: null as (() => void) | null,

    /** Викликається на кожному тіку аналізу з поточним результатом перевірок. */
    update(result: SetupResult) {
      lastResult = result;
      const nowReady = result.ok && result.stableMs >= config.setup.stableMsRequired;
      if (nowReady !== ready) {
        ready = nowReady;
        renderButtons();
      }
      renderStatus(result);
    },

    /** Вхід на екран: мікрофон уже ввімкнено, тож «Записати звук» можна активувати одразу. */
    refresh() {
      renderButtons();
    },

    /** Вихід з екрана: незавершений запис скасовуємо. */
    cancel() {
      if (recorder.recording) {
        cancelAnimationFrame(rafId);
        recorder.cancel();
        recordingBox.hidden = true;
      }
      ready = false;
      renderButtons();
    },

    getCaptures(): Captures {
      return captures;
    },
  };
  return controls;
}
