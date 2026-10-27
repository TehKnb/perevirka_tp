import { evaluateChecks, type CheckId } from '../checks/criteria';
import { CHECK_GROUPS, groupStatus, type GroupId } from '../checks/groups';
import type { HeadsetVisualResult } from '../checks/headsetVisual';
import { contourStateFor, initialSetupState, stepSetup, type SetupResult, type SetupState } from '../checks/stability';
import { config } from '../config';
import { buildContour } from '../contour/contour';
import { ContourView } from '../contour/contourView';
import { DEBUG, DebugPanel } from '../debug/debugPanel';
import { classifyMicLabel } from '../media/micClassify';
import type { MediaManager } from '../media/mediaManager';
import { runSpeedTest } from '../network/runSpeedTest';
import type { NetworkState } from '../network/speedTest';
import { checkLabels, groupLabels, groupStatusLabels, hints, t } from '../texts';
import { createCaptureControls } from './captureControls';
import { createNetworkPanel } from './networkPanel';
import { byId } from '../ui/dom';
import { Analyzer, type AnalysisTick } from '../vision/analyzer';
import type { VisionModels } from '../vision/models';

/**
 * Екран 3: дзеркальне відео, контур, безперервна перевірка критеріїв і одна головна підказка.
 * Під відео — кнопки «Зробити скріншот» і «Записати звук» (див. captureControls.ts).
 */
export function createSetupScreen(media: MediaManager, getModels: () => Promise<VisionModels>) {
  const stage = byId('setup-stage');
  const video = byId<HTMLVideoElement>('setup-video');
  const loading = byId('setup-loading');
  const mainHint = byId('main-hint');
  // Кадрування й Освітлення — ліворуч від відео, Фон і Гарнітура — праворуч (над блоком інтернету).
  const groupColumns: Record<GroupId, HTMLElement> = {
    framing: byId('groups-left'),
    light: byId('groups-left'),
    background: byId('groups-right'),
    headset: byId('groups-right'),
  };
  const netPanel = createNetworkPanel();
  const capture = createCaptureControls(media, video);
  const view = new ContourView(byId('contour-svg') as unknown as SVGSVGElement);
  const debug = DEBUG ? new DebugPanel(byId('debug-panel'), view) : null;
  debug?.setContext({
    camera: () => media.videoLabel || '—',
    microphone: () => `${media.audioLabel || '—'} (${classifyMicLabel(media.audioLabel)})`,
  });

  // Групи й пункти чекліста створюємо один раз, далі лише оновлюємо стан (значок малює CSS за data-status).
  // Інтернет показуємо окремим блоком із виміряними числами, тому в групах його немає.
  const items = new Map<CheckId, HTMLLIElement>();
  const groupPills = new Map<GroupId, HTMLElement>();
  CHECK_GROUPS.forEach((group, index) => {
    const section = document.createElement('section');
    section.className = 'check-group';
    section.setAttribute('aria-label', groupLabels[group.id]);
    const head = document.createElement('div');
    head.className = 'group-head';
    // Номер групи (01, 02…) у фіолетовій плашці, як на концепті; інтернет — останній, 05.
    const num = document.createElement('span');
    num.className = 'group-num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('h3');
    title.className = 'group-title';
    title.textContent = groupLabels[group.id];
    const pill = document.createElement('span');
    pill.className = 'group-pill';
    pill.dataset.status = 'none';
    pill.textContent = groupStatusLabels.none;
    groupPills.set(group.id, pill);
    head.append(num, title, pill);
    const list = document.createElement('ul');
    list.className = 'checklist';
    for (const id of group.checks) {
      const li = document.createElement('li');
      li.dataset.status = 'checking';
      const mark = document.createElement('span');
      mark.className = 'check-icon';
      mark.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = checkLabels[id];
      li.append(mark, label);
      items.set(id, li);
      list.append(li);
    }
    section.append(head, list);
    groupColumns[group.id].append(section);
  });

  let analyzer: Analyzer | null = null;
  let active = false;
  let state: SetupState = initialSetupState();
  // Візуальна перевірка гарнітури поки заглушка (див. headsetVisual.ts). Справжню реалізацію
  // варто викликати на скріншоті (етап 4), а не на кожному кадрі; результат записати сюди.
  const headsetVisualResult: HeadsetVisualResult = 'unknown';
  // Інтернет перевіряємо один раз за відвідування (і повторно — кнопкою).
  let network: NetworkState | null = null;

  async function testNetwork() {
    network = { status: 'checking' };
    try {
      network = { status: 'done', result: await runSpeedTest((p) => netPanel.progress(p)) };
    } catch (err) {
      console.error('Не вдалося перевірити інтернет', err);
      network = { status: 'error' };
    }
    netPanel.show(network);
  }
  netPanel.onRetest(() => void testNetwork());

  /** Підганяємо рамку під співвідношення сторін камери, щоб екран і кадр збігалися піксель у піксель. */
  function fitStage() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    stage.style.aspectRatio = `${vw} / ${vh}`;
    stage.style.width = `min(100%, calc(60vh * ${vw / vh}))`;
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
    }
    const byId = new Map(result.checks.map((c) => [c.id, c]));
    for (const group of CHECK_GROUPS) {
      const status = groupStatus(group.checks.flatMap((id) => byId.get(id) ?? []));
      const pill = groupPills.get(group.id)!;
      if (pill.dataset.status === status) continue;
      pill.dataset.status = status;
      pill.textContent = groupStatusLabels[status];
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
        network: network ?? { status: 'checking' },
      },
      config.criteria,
      config.camera,
      config.network,
    );
    const step = stepSetup(state, raw, performance.now(), config.stability);
    state = step.state;
    render(step.result, tick.metrics.mask?.iou ?? null);
    debug?.update(tick, step.result);
    capture.update(step.result);
  }

  return {
    async enter() {
      active = true;
      state = initialSetupState();
      mainHint.textContent = t.setup.intro;
      if (media.videoTrack) video.srcObject = new MediaStream([media.videoTrack]);
      capture.refresh();
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

      // Тест інтернету — після завантаження моделей, щоб вони не заважали заміру.
      if (!network || network.status === 'error') void testNetwork();

      analyzer ??= new Analyzer(models, video);
      analyzer.onTick = onTick;
      analyzer.start();
    },

    leave() {
      active = false;
      capture.cancel();
      analyzer?.stop();
      video.srcObject = null;
    },

    /** Фото й запис для відправки експертам. */
    getCaptures: () => capture.getCaptures(),

    /** Результат тесту інтернету (для відправки). */
    getNetwork: () => network,

    /** Натиснуто «Надіслати на перевірку» (фото й звук готові). */
    onSend(handler: () => void) {
      capture.onSend = handler;
    },
  };
}
