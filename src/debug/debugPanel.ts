import { svgEl, type ContourView } from '../contour/contourView';
import type { SetupResult } from '../checks/stability';
import type { AnalysisTick } from '../vision/analyzer';
import { FACE, POSE } from '../vision/geometry';
import type { VisionModels } from '../vision/models';
import { flattenMetrics, formatSnapshot, type Sample } from './snapshot';

/** Режим підбору порогів: сторінку відкрито з ?debug=1. */
export const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

const f = (v: number | undefined | null, digits = 2) =>
  v === undefined || v === null || !Number.isFinite(v) ? '—' : v.toFixed(digits);
const yesNo = (v: boolean | undefined) => (v === undefined ? '—' : v ? 'так' : 'ні');

/** Скільки мілісекунд збирати кадри для одного заміру. */
const SNAPSHOT_MS = 3000;

/** Сценарії калібрування: змінюйте одну умову за раз. */
const SCENARIOS = [
  '1. Еталон: усе налаштовано правильно',
  '2а. Камера знизу',
  '2б. Камера зверху',
  '3а. Задто близько',
  '3б. Задто далеко',
  '4а. Зсув ліворуч',
  '4б. Зсув праворуч',
  '5. Лише настільна лампа збоку',
  '6. Яскраве світло позаду',
  '7. Фон із предметами',
  '8а. Тепле (жовте) світло',
  '8б. Холодне (біле) світло',
  '9. Друга людина в кадрі',
  'Інше',
];

/** Звідки брати назви пристроїв для заміру. */
export interface SnapshotContext {
  camera(): string;
  microphone(): string;
}

interface Collecting {
  started: number;
  samples: Sample[];
  results: SetupResult[];
}

/**
 * Панель метрик для підбору порогів: числа, маска людини проти контуру
 * та позначки облич і плечей поверх відео.
 */
export class DebugPanel {
  private table = document.createElement('table');
  private maskCanvas = document.createElement('canvas');
  private maskCtx = this.maskCanvas.getContext('2d')!;
  private json = document.createElement('pre');
  private models: VisionModels | null = null;
  private context: SnapshotContext | null = null;
  private collecting: Collecting | null = null;
  private scenario = document.createElement('select');
  private note = document.createElement('input');
  private copyButton = document.createElement('button');
  private copyStatus = document.createElement('span');
  private output = document.createElement('textarea');

  constructor(
    root: HTMLElement,
    private readonly view: ContourView,
  ) {
    root.hidden = false;
    const legend = document.createElement('p');
    legend.className = 'debug-legend';
    legend.textContent =
      'Маска: зелений — людина в контурі, червоний — людина поза контуром, синій — порожній контур, сірий — фон для оцінки.';
    this.maskCanvas.className = 'debug-mask';
    this.json.className = 'debug-json';
    root.replaceChildren(this.buildSnapshotControls(), this.table, this.maskCanvas, legend, this.json);
  }

  setModels(models: VisionModels) {
    this.models = models;
  }

  setContext(context: SnapshotContext) {
    this.context = context;
  }

  /** Блок «Скопіювати замір»: сценарій, примітка, кнопка, текст для ручного копіювання. */
  private buildSnapshotControls(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'debug-snapshot';
    const label = (text: string, control: HTMLElement) => {
      const el = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = text;
      el.append(span, control);
      return el;
    };
    this.scenario.replaceChildren(
      ...SCENARIOS.map((name) => {
        const option = document.createElement('option');
        option.value = option.textContent = name;
        return option;
      }),
    );
    this.note.type = 'text';
    this.note.placeholder = 'що саме зробили (необов’язково)';
    this.copyButton.type = 'button';
    this.copyButton.className = 'btn btn-primary';
    this.copyButton.textContent = 'Скопіювати замір (3 с)';
    this.copyButton.addEventListener('click', () => this.startSnapshot());
    this.copyStatus.className = 'debug-snapshot-status';
    this.copyStatus.setAttribute('role', 'status');
    this.output.readOnly = true;
    this.output.rows = 8;
    this.output.hidden = true;
    this.output.setAttribute('aria-label', 'Текст заміру');
    const row = document.createElement('div');
    row.className = 'debug-snapshot-row';
    row.append(label('Сценарій', this.scenario), label('Примітка', this.note), this.copyButton, this.copyStatus);
    box.append(row, this.output);
    return box;
  }

  private startSnapshot() {
    if (this.collecting) return;
    this.collecting = { started: performance.now(), samples: [], results: [] };
    this.copyButton.disabled = true;
    this.copyStatus.textContent = 'Не рухайтеся, збираю показники…';
  }

  private collect(tick: AnalysisTick, result: SetupResult | undefined) {
    const c = this.collecting;
    if (!c) return;
    c.samples.push(flattenMetrics(tick.metrics, tick));
    if (result) c.results.push(result);
    const elapsed = performance.now() - c.started;
    if (elapsed < SNAPSHOT_MS) {
      this.copyStatus.textContent = `Не рухайтеся, збираю показники… ${Math.ceil((SNAPSHOT_MS - elapsed) / 1000)} с`;
      return;
    }
    this.collecting = null;
    const text = formatSnapshot(
      {
        scenario: this.scenario.value,
        note: this.note.value.trim(),
        durationMs: elapsed,
        camera: `${this.context?.camera() ?? '—'}, кадр ${tick.videoWidth}×${tick.videoHeight}`,
        microphone: this.context?.microphone() ?? '—',
        delegate: this.models?.delegate ?? '—',
        browser: navigator.userAgent,
      },
      c.samples,
      c.results,
    );
    void this.deliver(text);
  }

  /** Копіює в буфер обміну; якщо браузер не дозволив — показує текст для ручного копіювання. */
  private async deliver(text: string) {
    this.output.value = text;
    this.output.hidden = false;
    this.copyButton.disabled = false;
    try {
      await navigator.clipboard.writeText(text);
      this.copyStatus.textContent = 'Скопійовано ✓ Вставте в чат (Ctrl+V).';
    } catch {
      this.output.focus();
      this.output.select();
      this.copyStatus.textContent = 'Не вдалося скопіювати автоматично: текст виділено, натисніть Ctrl+C.';
    }
  }

  update(tick: AnalysisTick, result?: SetupResult) {
    const m = tick.metrics;
    const a = m.face?.angles;
    const s = m.shoulders;
    const l = m.light;
    const rows: [string, string][] = [
      ['FPS аналізу', f(tick.fps, 1)],
      ['Обробка кадру, мс', f(tick.processMs, 1)],
      [
        'Обличчя / поза / сегм. / метрики, мс',
        `${f(tick.timings.face, 1)} / ${f(tick.timings.pose, 1)} / ${f(tick.timings.segment, 1)} / ${f(tick.timings.metrics, 1)}`,
      ],
      ['Делегат / завантаження, мс', `${this.models?.delegate ?? '—'} / ${f(this.models?.loadMs, 0)}`],
      ['Кадр камери', `${tick.videoWidth}×${tick.videoHeight}`],
      ['Облич / поз', `${m.faces} / ${m.poses}`],
      ['IoU з контуром', f(m.mask?.iou)],
      ['Частка кадру з людиною', f(m.mask?.personArea)],
      ['Pitch / yaw / roll, °', `${f(a?.pitch, 1)} / ${f(a?.yaw, 1)} / ${f(a?.roll, 1)}`],
      ['Лінія очей (y), нахил очей °', `${f(m.face?.eyeLineY)} / ${f(m.face?.eyeRoll, 1)}`],
      ['Розмір обличчя / овал', f(m.face?.sizeRatio)],
      ['Зсув обличчя x / y (овали)', `${f(m.face?.offsetX)} / ${f(m.face?.offsetY)}`],
      ['Плечі: видимість', f(s?.minVisibility)],
      ['Плечі: в кадрі / запас знизу', `${yesNo(s?.insideFrame)} / ${f(s?.marginBelow)}`],
      ['Плечі: нахил °', f(s?.tilt, 1)],
      ['Обличчя: яскравість', f(l?.faceLuma)],
      ['Обличчя: різниця половин', f(l?.faceSideDiff, 3)],
      ['Фон: яскравість', f(l?.bgLuma)],
      ['Фон: розкид (std)', f(l?.bgStd, 3)],
      ['Фон: щільність країв', f(l?.bgEdgeDensity, 3)],
      ['Фон: частка кадру', f(l?.bgArea)],
      ['Фон / обличчя', f(l?.bgToFace)],
      ['Фон: пересвічено', f(l?.bgOverexposed, 3)],
      ['Фон: строкаті блоки', f(l?.bgBusyBlocks)],
      ['R/B обличчя / фон', `${f(l?.faceRedBlue)} / ${f(l?.bgRedBlue)}`],
    ];
    this.table.replaceChildren(
      ...rows.map(([k, v]) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        const td = document.createElement('td');
        th.textContent = k;
        td.textContent = v;
        tr.append(th, td);
        return tr;
      }),
    );
    this.drawMask(tick);
    this.drawMarks(tick);
    if (result) this.json.textContent = JSON.stringify(result, null, 1);
    this.collect(tick, result);
  }

  /** Маска людини проти контуру, у дзеркальному вигляді, як на екрані. */
  private drawMask(tick: AnalysisTick) {
    const { width: w, height: h, personMask, backgroundMask, contourMask } = tick;
    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      this.maskCanvas.width = w;
      this.maskCanvas.height = h;
    }
    const img = this.maskCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = y * w + x;
        const dst = (y * w + (w - 1 - x)) * 4;
        const person = personMask?.[src] ?? 0;
        const inContour = contourMask[src];
        const bg = backgroundMask?.[src] ?? 0;
        let r = 0, g = 0, b = 0;
        if (person && inContour) g = 200;
        else if (person) r = 220;
        else if (inContour) b = 220;
        else if (bg) r = g = b = 90;
        img.data[dst] = r;
        img.data[dst + 1] = g;
        img.data[dst + 2] = b;
        img.data[dst + 3] = 255;
      }
    }
    this.maskCtx.putImageData(img, 0, 0);
  }

  /** Рамка обличчя, кутики очей і плечі поверх відео. */
  private drawMarks(tick: AnalysisTick) {
    const layer = this.view.debugLayer;
    const marks: SVGElement[] = [];
    const face = tick.metrics.face;
    if (face) {
      const a = this.view.toSvg({ x: face.box.x, y: face.box.y });
      const b = this.view.toSvg({ x: face.box.x + face.box.w, y: face.box.y + face.box.h });
      marks.push(
        svgEl('rect', {
          x: Math.min(a.x, b.x),
          y: a.y,
          width: Math.abs(b.x - a.x),
          height: b.y - a.y,
          class: 'dbg-box',
        }),
      );
    }
    const lm = tick.faceLandmarks[0];
    if (lm) {
      for (const idx of [FACE.rightEyeOuter, FACE.leftEyeOuter]) {
        const p = lm[idx];
        if (p) {
          const q = this.view.toSvg(p);
          marks.push(svgEl('circle', { cx: q.x, cy: q.y, r: 6, class: 'dbg-eye' }));
        }
      }
    }
    tick.poseLandmarks.forEach((pose, i) => {
      for (const idx of [POSE.leftShoulder, POSE.rightShoulder]) {
        const p = pose[idx];
        if (p) {
          const q = this.view.toSvg(p);
          marks.push(svgEl('circle', { cx: q.x, cy: q.y, r: 10, class: i === 0 ? 'dbg-shoulder' : 'dbg-extra' }));
        }
      }
    });
    layer.replaceChildren(...marks);
  }
}
