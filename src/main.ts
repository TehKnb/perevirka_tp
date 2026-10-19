// Шрифти бренд-буку з npm: файли лежать разом із сайтом, без звернень до Google Fonts.
import '@fontsource-variable/commissioner';
import '@fontsource-variable/roboto-condensed';
import './styles.css';
import { config } from './config';
import { isMobileDevice, readDeviceEnv } from './env';
import { MediaManager } from './media/mediaManager';
import { createDevicesScreen } from './screens/devicesScreen';
import { createSetupScreen } from './screens/setupScreen';
import { applyTexts, byId, showScreen } from './ui/dom';
import { loadVisionModels, type VisionModels } from './vision/models';

function boot() {
  applyTexts();

  if (config.ui.blockMobile && isMobileDevice(readDeviceEnv())) {
    showScreen('mobile');
    return;
  }

  byId('consent-notice').hidden = !config.ui.showConsentNotice;

  const media = new MediaManager();

  // Моделі (~10 МБ + wasm) починаємо вантажити одразу після «Почати»,
  // поки людина дає дозвіл і обирає пристрої. Після помилки дозволяємо повторити.
  let modelsPromise: Promise<VisionModels> | null = null;
  const getModels = () => {
    modelsPromise ??= loadVisionModels().catch((err) => {
      modelsPromise = null;
      throw err;
    });
    return modelsPromise;
  };

  const setup = createSetupScreen(media, getModels);
  const devices = createDevicesScreen(media, () => {
    showScreen('setup');
    void setup.enter();
  });

  byId('btn-start').addEventListener('click', () => {
    getModels().catch(() => {
      /* помилку покаже екран налаштування */
    });
    showScreen('devices');
    void devices.enter();
  });

  byId('btn-change-devices').addEventListener('click', () => {
    setup.leave();
    showScreen('devices');
    void devices.enter();
  });

  // Звільняємо камеру й мікрофон, коли людина закриває вкладку.
  window.addEventListener('pagehide', () => media.stop());

  showScreen('start');
}

boot();
