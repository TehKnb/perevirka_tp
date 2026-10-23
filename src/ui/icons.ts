/**
 * Іконки інтерфейсу — прості лінійні SVG (24×24, колір — currentColor).
 * У розмітці: <span class="icon" data-icon="camera"></span>, заповнює applyIcons().
 */
const PATHS = {
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  discord:
    '<path d="M7 7.5c3.3-1.3 6.7-1.3 10 0 1.6 2.6 2.4 5.4 2.5 8.5-1.3 1.1-2.8 1.9-4.4 2.4l-.9-1.7M7 7.5C5.4 10.1 4.6 12.9 4.5 16c1.3 1.1 2.8 1.9 4.4 2.4l.9-1.7M8.5 16c2.3.9 4.7.9 7 0"/><circle cx="9.5" cy="12.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.2" fill="currentColor"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".9" fill="currentColor"/>',
  bang: '<path d="M12 6v8"/><circle cx="12" cy="18" r="1" fill="currentColor"/>',
  camera: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  send: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4 18-7z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3z"/><path d="m9 12 2 2 4-4"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function iconSvg(name: IconName): string {
  return (
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}

/** Підставляє SVG у всі елементи з атрибутом data-icon. */
export function applyIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon as IconName;
    if (name in PATHS) el.innerHTML = iconSvg(name);
    else console.warn(`Немає іконки "${name}"`);
  });
}
