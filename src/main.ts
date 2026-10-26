// Шрифти бренд-буку з npm: файли лежать разом із сайтом, без звернень до Google Fonts.
import '@fontsource-variable/commissioner';
import '@fontsource-variable/roboto-condensed';
import './styles.css';
import { config } from './config';
import { isMobileDevice, readDeviceEnv } from './env';
import { MediaManager } from './media/mediaManager';
import { createDevicesScreen } from './screens/devicesScreen';
import { createSetupScreen } from './screens/setupScreen';
import { createSubmitScreen } from './screens/submitScreen';
import { applyTexts, byId, showScreen } from './ui/dom';
import { applyIcons } from './ui/icons';
import { loadVisionModels, type VisionModels } from './vision/models';

function boot() {
  applyTexts();
  applyIcons();

  byId('consent-notice').hidden = !config.ui.showConsentNotice;

  // Телефон чи планшет: лише приклади правильного налаштування й пояснення, що пройти
  // можна з комп'ютера. Кнопки «Почати» немає, тож камеру, мікрофон і моделі не запитуємо.
  if (config.ui.blockMobile && isMobileDevice(readDeviceEnv())) {
    byId('phone-note').hidden = false;
    byId('screen-start').classList.add('phone-view');
    byId('btn-start').remove();
    showScreen('start');
    return;
  }

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

  // Фото й звук готові → форма відправки. Камеру не вимикаємо: людина може повернутися й перезняти.
  const submit = createSubmitScreen({
    collect: () => ({
      captures: setup.getCaptures(),
      network: setup.getNetwork(),
      devices: { camera: media.videoLabel, microphone: media.audioLabel },
      userAgent: navigator.userAgent,
    }),
    onBack: () => {
      showScreen('setup');
      void setup.enter();
    },
    onDone: () => {
      media.stop();
      showScreen('done');
    },
  });

  setup.onSend(() => {
    setup.leave();
    showScreen('submit');
    submit.enter();
  });

  // Рядок «Тестовий режим…» — лише коли відправку вимкнено в налаштуваннях.
  byId('submit-test-mode').hidden = byId('done-test-mode').hidden = !config.submit.testMode;

  const discord = byId<HTMLAnchorElement>('done-discord');
  if (config.ui.discordUrl) {
    discord.href = config.ui.discordUrl;
    discord.hidden = false;
  }

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
