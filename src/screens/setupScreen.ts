import { config } from '../config';
import { buildContour } from '../contour/contour';
import { ContourView } from '../contour/contourView';
import { DEBUG, DebugPanel } from '../debug/debugPanel';
import type { MediaManager } from '../media/mediaManager';
import { t } from '../texts';
import { byId } from '../ui/dom';
import { Analyzer, type AnalysisTick } from '../vision/analyzer';
import type { VisionModels } from '../vision/models';

/** Екран 3: дзеркальне відео, контур, аналіз кадрів (критерії й підказки — етап 3). */
export function createSetupScreen(media: MediaManager, getModels: () => Promise<VisionModels>) {
  const stage = byId('setup-stage');
  const video = byId<HTMLVideoElement>('setup-video');
  const loading = byId('setup-loading');
  const view = new ContourView(byId('contour-svg') as unknown as SVGSVGElement);
  const debug = DEBUG ? new DebugPanel(byId('debug-panel'), view) : null;

  let analyzer: Analyzer | null = null;
  let active = false;

  /** Підганяємо рамку під співвідношення сторін камери, щоб екран і кадр збігалися піксель у піксель. */
  function fitStage() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    stage.style.aspectRatio = `${vw} / ${vh}`;
    stage.style.width = `min(100%, calc(70vh * ${vw / vh}))`;
    // Той самий buildContour використовує аналізатор для IoU.
    view.render(buildContour(vw / vh, config.contour), vw / vh);
  }
  video.addEventListener('loadedmetadata', fitStage);
  video.addEventListener('resize', fitStage);

  function onTick(tick: AnalysisTick) {
    debug?.update(tick);
  }

  return {
    async enter() {
      active = true;
      if (media.videoTrack) video.srcObject = new MediaStream([media.videoTrack]);
      loading.textContent = t.setup.loading;
      loading.hidden = false;

      let models: VisionModels;
      try {
        models = await getModels();
      } catch (err) {
        console.error('Не вдалося завантажити моделі', err);
        loading.textContent = t.setup.loadError;
        return;
      }
      if (!active) return;
      loading.hidden = true;
      debug?.setModels(models);

      analyzer ??= new Analyzer(models, video);
      analyzer.onTick = onTick;
      analyzer.start();
    },

    leave() {
      active = false;
      analyzer?.stop();
      video.srcObject = null;
    },
  };
}
