// Базовые утилиты: математика, геометрия, ГСЧ, поиск пути

export const TILE = 32;

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const dist2 = (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2;
export const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Экспоненциальное сглаживание, независимое от fps
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

// --- Сидированный ГСЧ (mulberry32) ---
export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + rng() * (b - a);
  rng.int = (a, b) => Math.floor(a + rng() * (b - a + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}
// Активный источник случайности для игровой логики. По умолчанию Math.random,
// но на время контракта подменяется сидированным ГСЧ (см. setRng) — так
// неудачную партию можно воспроизвести для отладки таймингов улик.
// Внимание: рендер и аудио намеренно продолжают использовать Math.random,
// чтобы кадровая случайность не рассинхронизировала симуляцию.
let _rng = Math.random;
export function setRng(fn) { _rng = fn || Math.random; }
export const rnd = () => _rng();
export const rndRange = (a, b) => a + _rng() * (b - a);
export const rndPick = (arr) => arr[Math.floor(_rng() * arr.length)];

// --- Пересечение луча с отрезком ---
// Луч (px,py)+(dx,dy)*t, отрезок (x1,y1)-(x2,y2). Возвращает t или Infinity.
export function raySegment(px, py, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return Infinity;
  const t = ((x1 - px) * sy - (y1 - py) * sx) / denom;
  const u = ((x1 - px) * dy - (y1 - py) * dx) / denom;
  if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return t;
  return Infinity;
}

// Пересекается ли отрезок AB с отрезком CD
export function segSegHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const rpx = bx - ax, rpy = by - ay;
  const t = raySegment(ax, ay, rpx, rpy, cx, cy, dx, dy);
  return t <= 1;
}

// Прямая видимость между точками с учётом списка отрезков-окклюдеров
export function hasLOS(x1, y1, x2, y2, segs) {
  const dx = x2 - x1, dy = y2 - y1;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const t = raySegment(x1, y1, dx, dy, s.x1, s.y1, s.x2, s.y2);
    if (t < 1) return false;
  }
  return true;
}

// Точка в прямоугольнике
export const inRect = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

// --- A* по тайловой сетке ---
// walkable(tx,ty) => bool. Возвращает массив [{x,y},...] в тайлах или null.
export function astar(sx, sy, ex, ey, walkable, maxIter = 4000) {
  sx |= 0; sy |= 0; ex |= 0; ey |= 0;
  if (sx === ex && sy === ey) return [{ x: ex, y: ey }];
  if (!walkable(ex, ey)) return null;
  const key = (x, y) => x * 1000 + y;
  const open = [{ x: sx, y: sy, g: 0, f: 0, parent: null }];
  const seen = new Map();
  seen.set(key(sx, sy), 0);
  let iter = 0;
  while (open.length && iter++ < maxIter) {
    // мини-куча не нужна: карта маленькая
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === ex && cur.y === ey) {
      const path = [];
      let n = cur;
      while (n) { path.push({ x: n.x, y: n.y }); n = n.parent; }
      return path.reverse();
    }
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + [1, -1, 0, 0][d];
      const ny = cur.y + [0, 0, 1, -1][d];
      if (!walkable(nx, ny)) continue;
      const g = cur.g + 1;
      const k = key(nx, ny);
      if (seen.has(k) && seen.get(k) <= g) continue;
      seen.set(k, g);
      open.push({ x: nx, y: ny, g, f: g + Math.abs(ex - nx) + Math.abs(ey - ny), parent: cur });
    }
  }
  return null;
}

// Форматирование мм:сс
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Создание offscreen-канваса
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
