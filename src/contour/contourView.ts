import type { Contour, Point } from './contour';

export type ContourState = 'neutral' | 'almost' | 'ok';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Висота системи координат SVG; ширина = висота × співвідношення сторін кадру. */
const UNITS = 1000;

/** Малює контур поверх відео. Полігон береться з того самого Contour, що й для IoU. */
export class ContourView {
  private shade = document.createElementNS(SVG_NS, 'path');
  private line = document.createElementNS(SVG_NS, 'path');
  private halo = document.createElementNS(SVG_NS, 'path');
  /** Шар для debug-позначок (точки, рамки). */
  readonly debugLayer = document.createElementNS(SVG_NS, 'g');
  private aspect = 16 / 9;

  constructor(private readonly svg: SVGSVGElement) {
    this.shade.setAttribute('class', 'contour-shade');
    this.shade.setAttribute('fill-rule', 'evenodd');
    this.halo.setAttribute('class', 'contour-halo');
    this.line.setAttribute('class', 'contour-line');
    this.debugLayer.setAttribute('class', 'contour-debug');
    svg.replaceChildren(this.shade, this.halo, this.line, this.debugLayer);
    this.setState('neutral');
  }

  render(contour: Contour, aspect: number) {
    this.aspect = aspect;
    const W = UNITS * aspect;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${UNITS}`);
    const d = this.pathOf(contour.display);
    this.line.setAttribute('d', d);
    this.halo.setAttribute('d', d);
    this.shade.setAttribute('d', `M0 0H${W}V${UNITS}H0Z ${d}`);
  }

  setState(state: ContourState) {
    this.svg.dataset.state = state;
  }

  /** Перетворює точку кадру (не дзеркальну, 0..1) у координати SVG на екрані. */
  toSvg(framePoint: Point): Point {
    return { x: (1 - framePoint.x) * UNITS * this.aspect, y: framePoint.y * UNITS };
  }

  private pathOf(points: Point[]): string {
    const W = UNITS * this.aspect;
    return (
      points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * W).toFixed(1)} ${(p.y * UNITS).toFixed(1)}`)
        .join('') + 'Z'
    );
  }
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
