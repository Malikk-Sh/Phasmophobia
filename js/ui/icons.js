// Монохромные line-art пиктограммы (inline SVG) вместо системных emoji:
// единый стиль под хоррор — тонкая линия, грязно-белый цвет через currentColor.

const P = {
  // интерфейс
  journal: '<path d="M6 3h11a1.5 1.5 0 0 1 1.5 1.5V21H7.5A1.5 1.5 0 0 1 6 19.5z"/><path d="M9 3v18"/><path d="M12 8h4M12 11h4"/>',
  hand: '<path d="M8.5 12.5V6.2a1.1 1.1 0 0 1 2.2 0v5M10.7 11V4.8a1.1 1.1 0 0 1 2.2 0V11M12.9 11V5.8a1.1 1.1 0 0 1 2.2 0v6.4"/><path d="M15.1 12.2l1.6-1.8a1.2 1.2 0 0 1 1.9 1.4l-2.9 4.9c-1 1.7-2.4 2.8-4.6 2.8-2.7 0-4.6-1.7-5.4-4.3L4.6 11.7a1.15 1.15 0 0 1 2.2-.7l.9 2.5"/>',
  use: '<circle cx="12" cy="12" r="3.1"/><path d="M12 5V3M12 21v-2M19 12h2M3 12h2M16.9 7.1l1.4-1.4M5.7 18.3l1.4-1.4M16.9 16.9l1.4 1.4M5.7 5.7l1.4 1.4"/>',
  cycle: '<path d="M16.5 4l3 3-3 3"/><path d="M19.5 7H9.5a5 5 0 0 0-5 5"/><path d="M7.5 20l-3-3 3-3"/><path d="M4.5 17h10a5 5 0 0 0 5-5"/>',
  flashlight: '<path d="M7 3.5h5.5v3L11 9v9.5a1.75 1.75 0 0 1-3.5 0V9L6 6.5v-3z"/><path d="M15.5 5.5h3M15.5 8.5h4M15.5 11.5h3"/>',
  mic: '<rect x="9.6" y="3" width="4.8" height="10" rx="2.4"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9 20h6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  // снаряжение
  emf: '<rect x="6" y="6" width="9" height="14" rx="1.5"/><path d="M13 6l5-3.5"/><path d="M8.5 16.5v-1M11 16.5v-2.5M8.5 12.5v-1M11 11.5V10"/><rect x="8" y="8" width="5" height="1.6"/>',
  spirit: '<rect x="4" y="9" width="16" height="10" rx="1.5"/><path d="M6.5 9l4-5"/><circle cx="16.2" cy="14" r="2"/><path d="M7 12.5h5M7 15.5h5"/>',
  thermo: '<path d="M10.6 4.2a1.9 1.9 0 0 1 3.8 0v8.6a3.6 3.6 0 1 1-3.8 0z"/><circle cx="12.5" cy="16.5" r="1.4"/><path d="M12.5 15V7"/>',
  uv: '<circle cx="12" cy="13" r="3.4"/><path d="M12 6.5V4M17 8l1.8-1.8M7 8L5.2 6.2M18.5 13H21M3 13h2.5M16.5 17.5l1.8 1.8M5.7 19.3l1.8-1.8"/>',
  camera: '<rect x="3" y="8" width="12" height="9" rx="1.5"/><path d="M15 11.5l6-3v8l-6-3"/><circle cx="6.5" cy="10.5" r=".9"/>',
  photo: '<path d="M4 8h3.5L9 6h6l1.5 2H20v11H4z"/><circle cx="12" cy="13.2" r="3.2"/><path d="M17.5 10.3h1"/>',
  book: '<path d="M12 6.5C10 5 7 4.9 4 5.8V19c3-.9 6-.8 8 .7 2-1.5 5-1.6 8-.7V5.8c-3-.9-6-.8-8 .7z"/><path d="M12 6.5V19.7"/>',
  dots: '<circle cx="6" cy="6" r="1.1" fill="currentColor"/><circle cx="12" cy="6" r="1.1" fill="currentColor"/><circle cx="18" cy="6" r="1.1" fill="currentColor"/><circle cx="6" cy="12" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="18" cy="12" r="1.1" fill="currentColor"/><circle cx="6" cy="18" r="1.1" fill="currentColor"/><circle cx="12" cy="18" r="1.1" fill="currentColor"/><circle cx="18" cy="18" r="1.1" fill="currentColor"/>',
  ward: '<path d="M12 2.5v3"/><path d="M12 5.5l5 5-5 9-5-9z"/><circle cx="12" cy="10.5" r="2"/><path d="M9 15.5l-1.5 3M15 15.5l1.5 3"/>',
  smudge: '<path d="M10 21c-1.2-3.6-.8-7 2-9.8 2.8 2.8 3.2 6.2 2 9.8-1.3.5-2.7.5-4 0z"/><path d="M12 8.5c-1.2-1.6.8-2.6-.3-4.5M14.5 9.5c-.8-1.2.5-2-.2-3.2"/>',
  salt: '<path d="M9 10h6l1.2 10H7.8z"/><path d="M9.7 10V7a2.3 2.3 0 0 1 4.6 0v3"/><circle cx="11" cy="14" r=".7" fill="currentColor"/><circle cx="13.2" cy="16.5" r=".7" fill="currentColor"/>',
  pills: '<path d="M7.2 12.4l5.2-5.2a3.4 3.4 0 0 1 4.8 4.8l-5.2 5.2a3.4 3.4 0 0 1-4.8-4.8z"/><path d="M9.8 9.8l4.4 4.4"/>',
  motion: '<rect x="7" y="4" width="10" height="7.5" rx="2"/><ellipse cx="12" cy="7.7" rx="2.4" ry="1.9"/><path d="M8.2 15c1.6-1.7 6-1.7 7.6 0M6.4 18.5c2.4-2.6 8.8-2.6 11.2 0"/>',
  // улики
  orb: '<path d="M12 4.5l1.7 5.1 5.3 1.7-5.3 1.7L12 18.1l-1.7-5.1L5 11.3l5.3-1.7z"/><circle cx="18.5" cy="17.5" r="1" fill="currentColor"/>',
  snow: '<path d="M12 4v16M5.1 8l13.8 8M18.9 8L5.1 16"/><path d="M12 4l-1.6 1.6M12 4l1.6 1.6M12 20l-1.6-1.6M12 20l1.6-1.6"/>',
  // прочее
  ghostface: '<path d="M6 20V10a6 6 0 0 1 12 0v10l-2-1.6-2 1.6-2-1.6-2 1.6-2-1.6z"/><circle cx="9.8" cy="10.5" r="1" fill="currentColor"/><circle cx="14.2" cy="10.5" r="1" fill="currentColor"/><path d="M11 14c.6.6 1.4.6 2 0"/>',
  musicbox: '<rect x="5" y="10" width="14" height="8" rx="1"/><path d="M5 10l2-3h10l2 3"/><path d="M19 13h2M21 11.5v3"/><circle cx="12" cy="14" r="1.6"/>',
  mirror: '<ellipse cx="12" cy="10" rx="5.5" ry="7"/><path d="M12 17v4M8.5 21h7"/><path d="M9.5 7.5c.8-1.4 2.2-2.2 3.6-2"/>',
  doll: '<circle cx="12" cy="7.5" r="3.2"/><path d="M9.5 10.5L7 14l2.5 1v4.5h5V15l2.5-1-2.5-3.5"/><circle cx="10.8" cy="7" r=".6" fill="currentColor"/><circle cx="13.2" cy="7" r=".6" fill="currentColor"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.use;
  return `<svg viewBox="0 0 24 24" class="icn ${cls}" aria-hidden="true">${body}</svg>`;
}
