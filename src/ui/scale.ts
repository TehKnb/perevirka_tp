import { config } from '../config';

/**
 * Масштаб усієї сторінки: якомога більший, але не більше config.ui.maxScale, і такий,
 * щоб картка на всю ширину вміщалася в екран, а екран налаштування — ще й по висоті
 * (усі пункти видно без прокрутки). Менше за 1 не зменшуємо, збільшення до 5% не робимо.
 */
export function computeScale(
  viewWidth: number,
  viewHeight: number,
  design: { width: number; height: number },
  maxScale: number,
): number {
  const fit = Math.floor(Math.min(maxScale, viewWidth / design.width, viewHeight / design.height) * 100) / 100;
  // Збільшення менше ніж на 5% непомітне — лишаємо 1.
  return fit < 1.05 ? 1 : fit;
}

/** Застосовує масштаб через CSS zoom (змінна --zoom) і оновлює його при зміні розміру вікна. */
export function initScale() {
  const root = document.documentElement;
  const apply = () => {
    const z = computeScale(window.innerWidth, window.innerHeight, config.ui.designSize, config.ui.maxScale);
    root.style.setProperty('--zoom', String(z));
  };
  apply();
  window.addEventListener('resize', apply);
}
