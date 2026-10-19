import { CHECK_ORDER, evaluateChecks, type CheckId } from '../checks/criteria';
import type { HeadsetVisualResult } from '../checks/headsetVisual';
import { contourStateFor, initialSetupState, stepSetup, type SetupResult, type SetupState } from '../checks/stability';
import { config } from '../config';
import { buildContour } from '../contour/contour';
import { ContourView } from '../contour/contourView';
import { DEBUG, DebugPanel } from '../debug/debugPanel';
import { classifyMicLabel } from '../media/micClassify';
import type { MediaManager } from '../media/mediaManager';
import { checkLabels, hints, t } from '../texts';
import { byId } from '../ui/dom';
import { Analyzer, type AnalysisTick } from '../vision/analyzer';
import type { VisionModels } from '../vision/models';

const ICONS = { pass: '✓', fail: '✗', checking: '…' } as const;

/**
 * Екран 3: дзеркальне відео, контур, безперервна перевірка критеріїв і одна головна підказка.
 * onReady викликається, коли всі жорсткі критерії виконуються безперервно stableMsRequired.
 */
export function createSetupScreen(
  media: MediaManager,
  getModels: () => Promise<VisionModels>,
  onReady: (result: SetupResult) => void,
) {
  const stage = byId('setup-stage');
  const video = byId<HTMLVideoElement>('setup-video');
  const loading = byId('setup-loading');
  const mainHint = byId('main-hint');
  const checklist = byId('checklist');
  const view = new ContourView(byId('contour-svg') as unknown as SVGSVGElement);
  const debug = DEBUG ? new DebugPanel(byId('debug-panel'), view) : null;
  debug?.setContext({
    camera: () => media.videoLabel || '—',
    microphone: () => `${media.audioLabel || '—'} (${classifyMicLabel(media.audioLabel)})`,
  });

  // Пункти чекліста створюємо один раз, далі лише оновлюємо стан.
  const items = new Map<CheckId, HTMLLIElement>();
  for (const id of CHECK_ORDER) {
    const li = document.createElement('li');
    li.dataset.status = 'checking';
    const icon = document.createElement('span');
    icon.className = 'check-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICONS.checking;
    const label = document.createElement('span');
    label.textContent = checkLabels[id];
    li.append(icon, label);
    items.set(id, li);
  }
  checklist.replaceChildren(...items.values());

  let analyzer: Analyzer | null = null;
  let active = false;
  let state: SetupState = initialSetupState();
  let readyFired = false;
  // Візуальна перевірка гарнітури поки заглушка (див. headsetVisual.ts). Справжню реалізацію
  // варто викликати на скріншоті (етап 4), а не на кожному кадрі; результат записати сюди.
  const headsetVisualResult: HeadsetVisualResult = 'unknown';

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

  function render(result: SetupResult, iou: number | null) {
    if (mainHint.textContent !== result.mainHint) mainHint.textContent = result.mainHint;
    for (const check of result.checks) {
      const li = items.get(check.id);
      if (!li || (li.dataset.status === check.status && li.dataset.severity === check.severity)) continue;
      li.dataset.status = check.status;
      li.dataset.severity = check.severity;
      const icon = check.status === 'fail' && check.severity === 'soft' ? '!' : ICONS[check.status];
      li.firstElementChild!.textContent = icon;
    }
    view.setState(contourStateFor(result, iou, config.criteria.minIou, config.criteria.almostIouMargin));
  }

  function onTick(tick: AnalysisTick) {
    const raw = evaluateChecks(
      {
        metrics: tick.metrics,
        camera: media.videoTrack?.getSettings() ?? {},
        micKind: classifyMicLabel(media.audioLabel),
        headsetVisual: headsetVisualResult,
      },
      config.criteria,
      config.camera,
    );
    const step = stepSetup(state, raw, performance.now(), config.stability);
    state = step.state;
    render(step.result, tick.metrics.mask?.iou ?? null);
    debug?.update(tick, step.result);

    if (!readyFired && step.result.ok && step.result.stableMs >= config.setup.stableMsRequired) {
      readyFired = true;
      onReady(step.result);
    }
  }

  return {
    async enter() {
      active = true;
      state = initialSetupState();
      readyFired = false;
      mainHint.textContent = t.setup.intro;
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
      mainHint.textContent = hints.checking;
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
