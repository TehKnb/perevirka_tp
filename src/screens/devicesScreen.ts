import { checkResolution } from '../checks/resolution';
import { config } from '../config';
import { classifyMicLabel } from '../media/micClassify';
import { MediaAccessError, classifyMediaError, type MediaErrorInfo } from '../media/mediaErrors';
import type { DeviceOption, MediaManager } from '../media/mediaManager';
import { mediaErrorText, t } from '../texts';
import { byId } from '../ui/dom';

/** Екран 2: запит доступу, вибір камери й мікрофона, зрозумілі помилки. */
export function createDevicesScreen(media: MediaManager, onNext: () => void) {
  const pending = byId('devices-pending');
  const errorBox = byId('devices-error');
  const errorTitle = byId('devices-error-title');
  const errorBody = byId('devices-error-body');
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

  function setState(state: 'pending' | 'error' | 'ready') {
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
    setState('error');
    byId('btn-devices-retry').focus();
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
