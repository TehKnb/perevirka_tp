import './styles.css';
import { config } from './config';
import { isMobileDevice, readDeviceEnv } from './env';
import { MediaManager } from './media/mediaManager';
import { createDevicesScreen } from './screens/devicesScreen';
import { applyTexts, byId, showScreen } from './ui/dom';

function boot() {
  applyTexts();

  if (config.ui.blockMobile && isMobileDevice(readDeviceEnv())) {
    showScreen('mobile');
    return;
  }

  byId('consent-notice').hidden = !config.ui.showConsentNotice;

  const media = new MediaManager();
  const setupVideo = byId<HTMLVideoElement>('setup-video');

  const devices = createDevicesScreen(media, () => {
    if (media.videoTrack) setupVideo.srcObject = new MediaStream([media.videoTrack]);
    showScreen('setup');
  });

  byId('btn-start').addEventListener('click', () => {
    showScreen('devices');
    void devices.enter();
  });

  byId('btn-change-devices').addEventListener('click', () => {
    setupVideo.srcObject = null;
    showScreen('devices');
    void devices.enter();
  });

  // Звільняємо камеру й мікрофон, коли людина закриває вкладку.
  window.addEventListener('pagehide', () => media.stop());

  showScreen('start');
}

boot();
