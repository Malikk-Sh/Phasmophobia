// Полигон видимости: raycast к вершинам окклюдеров (стены, закрытые двери,
// высокая мебель). Всё вне полигона скрыто «туманом войны».

import { raySegment } from '../core/utils.js';

// segs: [{x1,y1,x2,y2}], возвращает [{x,y,a}] по углу
export function computeVisibility(px, py, segs, maxR) {
  const maxR2 = maxR * maxR;
  // собрать окклюдеры в радиусе + уникальные вершины
  const near = [];
  const pts = new Map();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // грубая отбраковка по расстоянию до bbox отрезка
    const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
    const half = (Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1)) / 2;
    const dx = Math.abs(cx - px) - half, dy = Math.abs(cy - py) - half;
    if (Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 > maxR2) continue;
    near.push(s);
    pts.set(s.x1 * 100000 + s.y1, [s.x1, s.y1]);
    pts.set(s.x2 * 100000 + s.y2, [s.x2, s.y2]);
  }

  const angles = [];
  for (const [, [x, y]] of pts) {
    const a = Math.atan2(y - py, x - px);
    angles.push(a - 0.0005, a, a + 0.0005);
  }
  // равномерные лучи, чтобы круг maxR был гладким
  for (let i = 0; i < 24; i++) angles.push(i / 24 * Math.PI * 2 - Math.PI);

  const out = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = maxR;
    for (let j = 0; j < near.length; j++) {
      const s = near[j];
      const ht = raySegment(px, py, dx, dy, s.x1, s.y1, s.x2, s.y2);
      if (ht < t) t = ht;
    }
    out.push({ x: px + dx * t, y: py + dy * t, a });
  }
  out.sort((p, q) => p.a - q.a);
  return out;
}

export function pathPolygon(ctx, poly) {
  if (!poly.length) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}
