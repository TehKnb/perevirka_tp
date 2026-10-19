import { t } from '../texts';

/** Елемент за id; якщо його немає в розмітці — це помилка розробки. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** Підставляє статичні тексти з texts.ts у елементи з атрибутом data-t. */
export function applyTexts(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    const value = lookup(el.dataset.t ?? '');
    if (typeof value === 'string') el.textContent = value;
    else console.warn(`Немає тексту для ключа "${el.dataset.t}"`);
  });
  // Альтернативний текст зображень — з атрибута data-t-alt.
  root.querySelectorAll<HTMLElement>('[data-t-alt]').forEach((el) => {
    const value = lookup(el.dataset.tAlt ?? '');
    if (typeof value === 'string') el.setAttribute('alt', value);
  });
  document.title = t.app.title;
}

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
  }, t);
}

export type ScreenId = 'mobile' | 'start' | 'devices' | 'setup';

/** Показує один екран, решту ховає, і переводить фокус на його заголовок (для читачів екрана). */
export function showScreen(id: ScreenId) {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach((el) => {
    el.hidden = el.dataset.screen !== id;
  });
  const heading = document.querySelector<HTMLElement>(`[data-screen="${id}"] h1`);
  heading?.focus();
}
