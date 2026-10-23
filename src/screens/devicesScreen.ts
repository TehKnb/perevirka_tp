import { checkResolution } from '../checks/resolution';
import { config } from '../config';
import { detectBrowser } from '../env';
import { classifyMicLabel } from '../media/micClassify';
import { MediaAccessError, classifyMediaError, type MediaErrorInfo } from '../media/mediaErrors';
import type { DeviceOption, MediaManager } from '../media/mediaManager';
import {
  blockedKind,
  denialMode,
  queryMediaPermissions,
  shouldRetry,
  watchMediaPermissions,
} from '../media/permissions';
import { mediaErrorText, permissionHelp, t } from '../texts';
import { byId } from '../ui/dom';

/** Екран 2: запит доступу, вибір камери й мікрофона, зрозумілі помилки. */
export function createDevicesScreen(media: MediaManager, onNext: () => void) {
  const pending = byId('devices-pending');
  const errorBox = byId('devices-error');
  const errorTitle = byId('devices-error-title');
  const errorBody = byId('devices-error-body');
  const errorStepsLead = byId('devices-error-steps-lead');
  const errorSteps = byId('devices-error-steps');
  const errorFooter = byId('devices-error-footer');
  const ready = byId('devices-ready');
  const video = byId<HTMLVideoElement>('devices-video');
  const selectCamera = byId<HTMLSelectElement>('select-camera');
  const selectMic = byId<HTMLSelectElement>('select-mic');
  const cameraStatus = byId('camera-status');
  const micStatus = byId('mic-status');
  const switchError = byId('switch-error');
  const btnNext = byId<HTMLButtonElement>('btn-devices-next');

  byId('btn-devices-retry').addEventListener('click', () => void requestAccess());
  btnNext.addEventListener('click', onNext);

  selectCamera.addEventListener('change', () =>
    void switchDevice(() => media.switchCamera(selectCamera.value)),
  );
  selectMic.addEventListener('change', () =>
    void switchDevice(() => media.switchMicrophone(selectMic.value)),
  );

  media.onDevicesChanged = () => {
    if (!ready.hidden) void renderDeviceLists();
  };
  media.onTrackEnded = (kind) => {
    showError({ code: 'notFound', kind });
  };

  /** Стеження за дозволами, поки на екрані пояснення про відмову. */
  let stopWatching: (() => void) | null = null;
  /** Номер показаної помилки: відповідь Permissions API для старої помилки ігноруємо. */
  let errorSeq = 0;

  function setState(state: 'pending' | 'error' | 'ready') {
    if (state !== 'error') {
      stopWatching?.();
      stopWatching = null;
    }
    pending.hidden = state !== 'pending';
    errorBox.hidden = state !== 'error';
    ready.hidden = state !== 'ready';
  }

  function showError(info: MediaErrorInfo) {
    media.stop();
    video.srcObject = null;
    const text = mediaErrorText(info);
    errorTitle.textContent = text.title;
    errorBody.textContent = text.body;
    errorStepsLead.hidden = errorSteps.hidden = errorFooter.hidden = true;
    setState('error');
    byId('btn-devices-retry').focus();
    if (info.code === 'denied') void explainDenial(++errorSeq);
    else errorSeq++;
  }

  /**
   * Браузер не дав доступу: дізнаємося, чи запам'ятав він заборону, показуємо інструкцію
   * саме для цього браузера й стежимо — щойно доступ дозволять, продовжуємо самі.
   */
  async function explainDenial(seq: number) {
    const perms = await queryMediaPermissions();
    if (seq !== errorSeq || errorBox.hidden) return;
    const autoContinue = perms.camera !== 'unknown' || perms.microphone !== 'unknown';
    const mode = denialMode(perms);
    const help = permissionHelp(mode, mode === 'blocked' ? blockedKind(perms) : 'both', detectBrowser(navigator.userAgent), autoContinue);
    errorTitle.textContent = help.title;
    errorBody.textContent = help.body;
    errorStepsLead.textContent = help.stepsLead;
    errorStepsLead.hidden = !help.stepsLead;
    errorSteps.replaceChildren(
      ...help.steps.map((step) => {
        const li = document.createElement('li');
        li.textContent = step;
        return li;
      }),
    );
    errorSteps.hidden = help.steps.length === 0;
    errorFooter.textContent = help.footer;
    errorFooter.hidden = !help.footer;

    if (!autoContinue) return;
    stopWatching?.();
    stopWatching = watchMediaPermissions((now) => {
      if (seq === errorSeq && !errorBox.hidden && shouldRetry(perms, now)) void requestAccess();
    });
  }

  async function requestAccess() {
    setState('pending');
    try {
      await media.start();
    } catch (err) {
      showError(err instanceof MediaAccessError ? err.info : classifyMediaError(err));
      return;
    }
    setState('ready');
    switchError.hidden = true;
    await renderAll();
  }

  async function switchDevice(action: () => Promise<void>) {
    selectCamera.disabled = selectMic.disabled = btnNext.disabled = true;
    switchError.hidden = true;
    try {
      await action();
    } catch (err) {
      const info = err instanceof MediaAccessError ? err.info : classifyMediaError(err);
      const text = mediaErrorText(info);
      switchError.textContent = `${text.title}. ${text.body}`;
      switchError.hidden = false;
    } finally {
      selectCamera.disabled = selectMic.disabled = btnNext.disabled = false;
      await renderAll();
    }
  }

  async function renderAll() {
    if (media.videoTrack) video.srcObject = new MediaStream([media.videoTrack]);
    await renderDeviceLists();
    renderStatuses();
  }

  async function renderDeviceLists() {
    const { cameras, microphones } = await media.listDevices();
    fillSelect(selectCamera, cameras, media.videoDeviceId, t.devices.unnamedCamera);
    fillSelect(selectMic, microphones, media.audioDeviceId, t.devices.unnamedMic);
  }

  function renderStatuses() {
    const settings = media.videoTrack?.getSettings() ?? {};
    const res = checkResolution(settings, config.camera);
    cameraStatus.textContent = res.ok
      ? t.devices.resolutionOk(res.width, res.height)
      : t.devices.resolutionLow(res.width, res.height, config.camera.minWidth, config.camera.minHeight);
    cameraStatus.classList.toggle('status-warn', !res.ok);

    const micKind = classifyMicLabel(media.audioLabel);
    micStatus.textContent = micKind === 'builtin' ? t.devices.micBuiltin : '';
    micStatus.classList.toggle('status-warn', micKind === 'builtin');
  }

  return {
    /** Вхід на екран: запитуємо доступ, якщо його ще немає. */
    async enter() {
      if (media.videoTrack && media.audioTrack) {
        setState('ready');
        await renderAll();
      } else {
        await requestAccess();
      }
    },
  };
}

function fillSelect(
  select: HTMLSelectElement,
  options: DeviceOption[],
  currentId: string | undefined,
  unnamed: (n: number) => string,
) {
  select.replaceChildren(
    ...options.map((o, i) => {
      const option = document.createElement('option');
      option.value = o.deviceId;
      option.textContent = o.label || unnamed(i + 1);
      option.selected = o.deviceId === currentId;
      return option;
    }),
  );
}
