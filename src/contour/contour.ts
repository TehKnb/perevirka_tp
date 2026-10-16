import type { AppConfig } from '../config';

/** Точка в нормалізованих координатах кадру: 0..1 по ширині й висоті. */
export interface Point {
  x: number;
  y: number;
}

export type ContourParams = AppConfig['contour'];

export interface Contour {
  /** Полігон у координатах ЕКРАНА (дзеркальне відео), 0..1. */
  display: Point[];
  /** Той самий полігон у координатах КАДРУ камери (не дзеркальний), 0..1 — для IoU. */
  frame: Point[];
  /** Овал голови в координатах кадру (симетричний, тож дзеркалення не впливає). */
  head: { cx: number; cy: number; rx: number; ry: number };
}

/**
 * Будує контур голови й плечей для кадру з заданим співвідношенням сторін (ширина / висота).
 * Ліву половину будуємо явно, праву отримуємо дзеркально.
 */
export function buildContour(aspect: number, p: ContourParams): Contour {
  // Ліва половина в «частках висоти», x < 0 — ліворуч від центру.
  const left: Point[] = [];
  left.push({ x: -p.bottomHalfWidth, y: 1 });
  left.push({ x: -p.shoulderHalfWidth, y: p.shoulderY });

  // Плече: квадратична крива від зовнішньої точки плеча до основи шиї.
  const shoulder = { x: -p.shoulderHalfWidth, y: p.shoulderY };
  const neckBase = { x: -p.neckHalfWidth, y: p.neckBaseY };
  const control = { x: -p.shoulderHalfWidth * 0.55, y: p.neckBaseY + (p.shoulderY - p.neckBaseY) * 0.15 };
  for (let i = 1; i <= p.arcSegments; i++) {
    const t = i / p.arcSegments;
    const u = 1 - t;
    left.push({
      x: u * u * shoulder.x + 2 * u * t * control.x + t * t * neckBase.x,
      y: u * u * shoulder.y + 2 * u * t * control.y + t * t * neckBase.y,
    });
  }

  // Шия вгору до овалу голови, далі дуга овалу до маківки.
  // Кут θ відраховуємо від маківки: x = rx·sinθ, y = cy − ry·cosθ.
  const neckRatio = Math.min(p.neckHalfWidth / p.headRx, 0.999);
  const thetaStart = -(Math.PI - Math.asin(neckRatio));
  for (let i = 0; i <= p.arcSegments * 2; i++) {
    const theta = thetaStart * (1 - i / (p.arcSegments * 2));
    left.push({ x: p.headRx * Math.sin(theta), y: p.headCenterY - p.headRy * Math.cos(theta) });
  }

  // Права половина — дзеркально, у зворотному порядку, без повтору маківки.
  const right = left
    .slice(0, -1)
    .reverse()
    .map((pt) => ({ x: -pt.x, y: pt.y }));
  const halfUnits = [...left, ...right];

  const toNorm = (pt: Point): Point => ({ x: 0.5 + pt.x / aspect, y: pt.y });
  const display = halfUnits.map(toNorm);
  const frame = display.map((pt) => ({ x: 1 - pt.x, y: pt.y }));

  return {
    display,
    frame,
    head: { cx: 0.5, cy: p.headCenterY, rx: p.headRx / aspect, ry: p.headRy },
  };
}
