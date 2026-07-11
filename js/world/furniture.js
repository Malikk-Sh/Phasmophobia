// Мебель, интерьер и экстерьер: расстановка, коллайдеры, укрытия,
// бросаемые предметы и процедурная отрисовка (top-down).

import { TILE } from '../core/utils.js';
import { FLOOR_BASEMENT } from './house.js';

// ---------- Расстановка ----------
export function furnish(world, blueprint) {
  const bp = blueprint;
  const F = { 0: [], [FLOOR_BASEMENT]: [] };
  const colliders = { 0: [], [FLOOR_BASEMENT]: [] };
  const tallOccluders = { 0: [], [FLOOR_BASEMENT]: [] };
  const hidingSpots = [];
  const props = [];
  let fid = 0, pid = 0, hid = 0;

  function place(type, floor, tx, ty, tw, th, opts = {}) {
    const f = {
      id: fid++, type, floor,
      x: tx * TILE, y: ty * TILE, w: tw * TILE, h: th * TILE,
      rot: opts.rot || 0, tall: !!opts.tall, hide: !!opts.hide,
      solid: opts.solid !== false,
      name: opts.name || '',
    };
    F[floor].push(f);
    if (f.solid) colliders[floor].push({ x: f.x, y: f.y, w: f.w, h: f.h });
    if (f.tall) {
      tallOccluders[floor].push(
        { x1: f.x, y1: f.y, x2: f.x + f.w, y2: f.y },
        { x1: f.x, y1: f.y + f.h, x2: f.x + f.w, y2: f.y + f.h },
        { x1: f.x, y1: f.y, x2: f.x, y2: f.y + f.h },
        { x1: f.x + f.w, y1: f.y, x2: f.x + f.w, y2: f.y + f.h },
      );
    }
    if (f.hide) {
      hidingSpots.push({
        id: hid++, x: f.x + f.w / 2, y: f.y + f.h / 2, floor,
        name: opts.name || 'Шкаф', fRef: f,
      });
    }
    return f;
  }
  function prop(type, floor, tx, ty) {
    props.push({
      id: pid++, type, floor, x: tx * TILE, y: ty * TILE,
      vx: 0, vy: 0, z: 0, vz: 0, rot: Math.random() * 6.28,
      thrownAt: -99, broken: false,
    });
  }

  // ===== Мебель и пропсы из чертежа =====
  for (const [type, floor, tx, ty, tw, th, opts] of bp.furniture) {
    place(type, floor, tx, ty, tw, th, opts || {});
  }
  for (const [type, floor, tx, ty] of bp.props) prop(type, floor, tx, ty);

  // ===== Экстерьер из чертежа =====
  const trees = bp.exterior.trees.map(([x, y, r]) => ({ x: x * TILE, y: y * TILE, r: r * TILE }));
  for (const t of trees) {
    colliders[0].push({ x: t.x - 6, y: t.y - 6, w: 12, h: 12 }); // ствол
  }
  const bushes = bp.exterior.bushes.map(([x, y]) => ({
    x: x * TILE, y: y * TILE, r: (0.5 + Math.random() * 0.25) * TILE,
  }));
  // Забор по периметру участка ([x,y,w,h] в тайлах → пиксели)
  const fence = bp.exterior.fence.map(([x, y, w, h]) => ({
    x: x * TILE, y: y * TILE, w: w * TILE, h: h * TILE,
  }));
  for (const r of fence) colliders[0].push(r);

  // Фургон (кузов — коллайдер)
  const van = world.van;
  colliders[0].push({ x: van.x, y: van.y, w: van.w, h: van.h - TILE * 0.9 }); // зад открыт

  world.furniture = F;
  world.colliders = colliders;
  world.tallOccluders = tallOccluders;
  world.hidingSpots = hidingSpots;
  world.props = props;
  world.exterior = { trees, bushes, fence };
}

// ---------- Отрисовка ----------
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(ctx, w, h) { // мягкая тень под мебелью
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  rr(ctx, -w / 2 + 2, -h / 2 + 3, w, h, 6);
  ctx.fill();
}

// Все функции рисуют в локальных координатах: центр (0,0), размеры w×h.
const DRAW = {
  car(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#232c33'); g.addColorStop(.5, '#39464f'); g.addColorStop(1, '#1e262c');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, 12); ctx.fill();
    ctx.fillStyle = '#141a1f';
    rr(ctx, -w / 2 + 6, -h / 2 + h * .22, w - 12, h * .28, 8); ctx.fill(); // лобовое+крыша
    ctx.fillStyle = '#2c363e';
    rr(ctx, -w / 2 + 8, -h / 2 + h * .3, w - 16, h * .14, 6); ctx.fill();
    ctx.fillStyle = '#10151a';
    for (const sy of [-h / 2 + 4, h / 2 - 10]) { // колёса-намёки
      ctx.fillRect(-w / 2 - 2, sy, 5, 8); ctx.fillRect(w / 2 - 3, sy, 5, 8);
    }
  },
  workbench(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#4a3b28'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#5c4a33'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-w / 2 + i * w / 4, -h / 2 + 2); ctx.lineTo(-w / 2 + i * w / 4, h / 2 - 2); ctx.stroke(); }
    ctx.fillStyle = '#8a8f94'; ctx.fillRect(-w / 2 + 6, -4, 10, 3); // инструмент
    ctx.fillStyle = '#6b4226'; ctx.fillRect(w / 2 - 18, -6, 4, 12);
  },
  shelfTall(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#3a3128'; rr(ctx, -w / 2, -h / 2, w, h, 2); ctx.fill();
    ctx.fillStyle = '#2a231c'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    // коробки на полках
    ctx.fillStyle = '#6b5a3e';
    if (w > h) { ctx.fillRect(-w / 2 + 5, -h / 4, 9, 7); ctx.fillRect(0, -h / 4 + 1, 8, 6); ctx.fillRect(w / 4, -2, 10, 6); }
    else { ctx.fillRect(-4, -h / 2 + 6, 8, 9); ctx.fillRect(-3, 0, 7, 8); ctx.fillRect(-4, h / 2 - 14, 8, 8); }
  },
  locker(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#37444d'); g.addColorStop(.5, '#485862'); g.addColorStop(1, '#2c363e');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.stroke();
    ctx.fillStyle = '#1c2429'; ctx.fillRect(-w / 4 - 1, -h / 6, 2, 6); ctx.fillRect(w / 4 - 1, -h / 6, 2, 6);
  },
  tires(ctx, w) {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(2, 3, w * .45, 0, 7); ctx.fill();
    ctx.fillStyle = '#191d20'; ctx.beginPath(); ctx.arc(0, 0, w * .45, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a3136'; ctx.beginPath(); ctx.arc(0, 0, w * .28, 0, 7); ctx.fill();
    ctx.fillStyle = '#111417'; ctx.beginPath(); ctx.arc(0, 0, w * .13, 0, 7); ctx.fill();
  },
  washer(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#b9c2c7'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.fillStyle = '#87939a'; ctx.beginPath(); ctx.arc(0, 1, w * .3, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a565e'; ctx.beginPath(); ctx.arc(0, 1, w * .21, 0, 7); ctx.fill();
    ctx.fillStyle = '#6f7d85'; ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, 5);
  },
  dryer(ctx, w, h) { DRAW.washer(ctx, w, h); },
  waterheater(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#7d8489'); g.addColorStop(.5, '#a9b1b6'); g.addColorStop(1, '#6a7176');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, w / 2.2); ctx.fill();
    ctx.strokeStyle = '#586066'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h / 6); ctx.lineTo(w / 2 - 3, -h / 6); ctx.stroke();
  },
  basket(ctx, w, h) {
    ctx.fillStyle = '#7a6a4a'; rr(ctx, -w / 2, -h / 2, w, h, 6); ctx.fill();
    ctx.fillStyle = '#8d7c58'; rr(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 5); ctx.fill();
    ctx.fillStyle = '#c9c2b4'; ctx.beginPath(); ctx.arc(-3, 0, 5, 0, 7); ctx.arc(4, 2, 5, 0, 7); ctx.fill();
  },
  counter(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#5c5148'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#756a5e'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
  },
  counterSink(ctx, w, h) {
    DRAW.counter(ctx, w, h);
    ctx.fillStyle = '#9aa4aa'; rr(ctx, -w * .25, -h * .3, w * .5, h * .6, 4); ctx.fill();
    ctx.fillStyle = '#5f6a70'; rr(ctx, -w * .19, -h * .2, w * .38, h * .4, 3); ctx.fill();
    ctx.fillStyle = '#c0c8cc'; ctx.fillRect(-1, -h * .38, 2, h * .16);
  },
  stove(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#2e3338'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#41474d'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    ctx.fillStyle = '#14171a';
    for (const [cx, cy] of [[-w / 4, -h / 5], [w / 4, -h / 5], [-w / 4, h / 4], [w / 4, h / 4]]) {
      ctx.beginPath(); ctx.arc(cx, cy, w * .13, 0, 7); ctx.fill();
    }
  },
  fridge(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#c3cbd0'); g.addColorStop(.5, '#e0e6ea'); g.addColorStop(1, '#a9b3b9');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h / 8); ctx.lineTo(w / 2 - 3, -h / 8); ctx.stroke();
    ctx.fillStyle = '#7d888e'; ctx.fillRect(w / 2 - 7, -h / 2 + 6, 3, 8);
  },
  island(ctx, w, h) { DRAW.counter(ctx, w, h); ctx.fillStyle = '#4c4239'; rr(ctx, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 2); ctx.fill(); },
  chair(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,.28)'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w, h, 4); ctx.fill();
    ctx.fillStyle = '#4f3d29'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.fillStyle = '#63513a'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 3); ctx.fill();
  },
  diningTable(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#5d4a30'); g.addColorStop(.5, '#6e5a3c'); g.addColorStop(1, '#54432b');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,200,.08)'; ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-w / 2 + i * w / 5, -h / 2 + 3); ctx.lineTo(-w / 2 + i * w / 5, h / 2 - 3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.05)'; rr(ctx, -w / 4, -h / 4, w / 2, h / 2, 4); ctx.fill();
  },
  sideboard(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#4a3826'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#5d4930'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.moveTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.stroke();
  },
  plant(ctx, w) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.arc(2, 3, w * .42, 0, 7); ctx.fill();
    ctx.fillStyle = '#5a4632'; ctx.beginPath(); ctx.arc(0, 0, w * .3, 0, 7); ctx.fill();
    ctx.fillStyle = '#25382a';
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * w * .22, Math.sin(a) * w * .22, w * .2, w * .09, a, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#31493a'; ctx.beginPath(); ctx.arc(0, 0, w * .14, 0, 7); ctx.fill();
  },
  rugRect(ctx, w, h) {
    ctx.fillStyle = '#3d3438'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.strokeStyle = '#57484e'; ctx.lineWidth = 2; rr(ctx, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 3); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,100,110,.25)'; ctx.lineWidth = 1; rr(ctx, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 2); ctx.stroke();
  },
  rugRound(ctx, w, h) {
    ctx.fillStyle = '#3a3d32'; ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#565a47'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, w / 2 - 5, h / 2 - 5, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(140,145,110,.2)';
    ctx.beginPath(); ctx.ellipse(0, 0, w / 2 - 11, h / 2 - 11, 0, 0, 7); ctx.stroke();
  },
  runner(ctx, w, h) {
    ctx.fillStyle = '#402f2c'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.strokeStyle = '#5c4440'; ctx.lineWidth = 1.5; rr(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 2); ctx.stroke();
    ctx.fillStyle = 'rgba(150,110,100,.12)';
    for (let i = 0; i < Math.floor(w / 40); i++) {
      ctx.beginPath(); ctx.arc(-w / 2 + 24 + i * 40, 0, 5, 0, 7); ctx.fill();
    }
  },
  console(ctx, w, h) { DRAW.sideboard(ctx, w, h); ctx.fillStyle = '#c8bd9d'; ctx.beginPath(); ctx.arc(-w / 4, 0, 4, 0, 7); ctx.fill(); },
  closet(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#4c3a26'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#5f4a31'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.stroke();
    ctx.fillStyle = '#2e2417'; ctx.fillRect(-6, -2, 3, 5); ctx.fillRect(3, -2, 3, 5);
  },
  coatrack(ctx, w) {
    ctx.fillStyle = '#332818'; ctx.beginPath(); ctx.arc(0, 0, w * .35, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a3a24';
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + .5;
      ctx.beginPath(); ctx.arc(Math.cos(a) * w * .3, Math.sin(a) * w * .3, 3, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#3d4a52'; ctx.beginPath(); ctx.ellipse(w * .15, w * .1, 6, 4, .5, 0, 7); ctx.fill(); // куртка
  },
  bedDouble(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#3f2f1e'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill(); // рама
    ctx.fillStyle = '#8b8272'; rr(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 4); ctx.fill(); // матрас
    ctx.fillStyle = '#4d5c66'; rr(ctx, -w / 2 + 3, -h / 2 + h * .3, w - 6, h * .68, 4); ctx.fill(); // одеяло
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 5, -h / 2 + h * .42); ctx.lineTo(w / 2 - 5, -h / 2 + h * .42); ctx.stroke();
    ctx.fillStyle = '#d8d2c2'; // подушки
    rr(ctx, -w / 2 + 6, -h / 2 + 6, w / 2 - 10, h * .17, 4); ctx.fill();
    rr(ctx, 4, -h / 2 + 6, w / 2 - 10, h * .17, 4); ctx.fill();
  },
  bedSingle(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#3f2f1e'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.fillStyle = '#8b8272'; rr(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 4); ctx.fill();
    ctx.fillStyle = '#6b4a56'; rr(ctx, -w / 2 + 3, -h / 2 + h * .3, w - 6, h * .68, 4); ctx.fill();
    ctx.fillStyle = '#d8d2c2'; rr(ctx, -w / 2 + 5, -h / 2 + 5, w - 10, h * .18, 4); ctx.fill();
  },
  nightstand(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#463520';
    rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#594732'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    ctx.fillStyle = '#c8b98a'; ctx.beginPath(); ctx.arc(0, 0, w * .18, 0, 7); ctx.fill(); // лампа
  },
  wardrobe(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#54402a'); g.addColorStop(.5, '#66502f'); g.addColorStop(1, '#48371f');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
    if (h >= w) { ctx.beginPath(); ctx.moveTo(0, -h / 2 + 3); ctx.lineTo(0, h / 2 - 3); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(-w / 6, -h / 2 + 3); ctx.lineTo(-w / 6, h / 2 - 3); ctx.moveTo(w / 6, -h / 2 + 3); ctx.lineTo(w / 6, h / 2 - 3); ctx.stroke(); }
    ctx.fillStyle = '#c8b98a';
    if (h >= w) { ctx.fillRect(-4, -3, 2, 6); ctx.fillRect(2, -3, 2, 6); }
    else { ctx.fillRect(-w / 6 - 5, -2, 4, 4); ctx.fillRect(w / 6 + 2, -2, 4, 4); }
  },
  dresser(ctx, w, h) { DRAW.sideboard(ctx, w, h); },
  tub(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#c9ced2'; rr(ctx, -w / 2, -h / 2, w, h, h / 2.4); ctx.fill();
    ctx.fillStyle = '#a5adb3'; rr(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, h / 2.8); ctx.fill();
    ctx.fillStyle = '#8b959c'; rr(ctx, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, h / 3.2); ctx.fill();
    ctx.fillStyle = '#d5dade'; ctx.beginPath(); ctx.arc(w / 2 - 10, 0, 3, 0, 7); ctx.fill();
  },
  toilet(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#d9dde0'; rr(ctx, -w / 2, -h / 2, w, h * .4, 3); ctx.fill(); // бачок
    ctx.beginPath(); ctx.ellipse(0, h * .12, w * .42, h * .34, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#b3bac0'; ctx.beginPath(); ctx.ellipse(0, h * .12, w * .3, h * .24, 0, 0, 7); ctx.fill();
  },
  sinkCab(ctx, w, h) {
    DRAW.counter(ctx, w, h);
    ctx.fillStyle = '#d5dade'; ctx.beginPath(); ctx.ellipse(0, 0, w * .26, h * .3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#96a0a6'; ctx.beginPath(); ctx.ellipse(0, 0, w * .17, h * .2, 0, 0, 7); ctx.fill();
  },
  sofa(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#39424e'; rr(ctx, -w / 2, -h / 2, w, h, 8); ctx.fill();
    ctx.fillStyle = '#485465'; rr(ctx, -w / 2 + 5, -h / 2 + 3, w - 10, h - 12, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-w / 2 + i * w / 3, -h / 2 + 4); ctx.lineTo(-w / 2 + i * w / 3, h / 2 - 10); ctx.stroke(); }
    ctx.fillStyle = '#5a2e33'; rr(ctx, -w / 2 + 9, -h / 2 + 6, 13, 11, 3); ctx.fill(); // подушка
    ctx.fillStyle = '#2e4a42'; rr(ctx, w / 2 - 24, -h / 2 + 7, 13, 11, 3); ctx.fill();
  },
  armchair(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#4a3b45'; rr(ctx, -w / 2, -h / 2, w, h, 7); ctx.fill();
    ctx.fillStyle = '#5c4a56'; rr(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 5); ctx.fill();
    ctx.fillStyle = '#3c2f38'; rr(ctx, -w / 2 + 2, -h / 2 + 2, 5, h - 4, 3); ctx.fill();
    rr(ctx, w / 2 - 7, -h / 2 + 2, 5, h - 4, 3); ctx.fill();
  },
  coffeeTable(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#4c3a26'; rr(ctx, -w / 2, -h / 2, w, h, 5); ctx.fill();
    ctx.fillStyle = '#5f4a31'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.05)'; rr(ctx, -w / 4, -h / 4, w / 2, h / 2, 3); ctx.fill();
  },
  tvstand(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#33281a'; rr(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.fillStyle = '#0a0d10'; rr(ctx, -w / 2 + 6, -h / 2 - 2, w - 12, h * .5, 2); ctx.fill(); // ТВ
    ctx.fillStyle = 'rgba(90,120,140,.14)'; rr(ctx, -w / 2 + 8, -h / 2 - 1, w - 16, h * .4, 2); ctx.fill();
  },
  bookshelf(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#3d2f1d'; rr(ctx, -w / 2, -h / 2, w, h, 2); ctx.fill();
    ctx.fillStyle = '#2a2014'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2); ctx.fill();
    const cols = ['#6b3a35', '#3a5a52', '#7a6a3a', '#4a3a6a', '#5a5a5a'];
    const vert = h >= w;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = cols[i % 5];
      if (vert) ctx.fillRect(-w / 2 + 4, -h / 2 + 6 + i * (h - 12) / 6, w - 8, (h - 12) / 6 - 2);
      else ctx.fillRect(-w / 2 + 6 + i * (w - 12) / 6, -h / 2 + 4, (w - 12) / 6 - 2, h - 8);
    }
  },
  toychest(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#7a4a3a'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.fillStyle = '#8d5a45'; rr(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 3); ctx.fill();
    ctx.fillStyle = '#c8b23a'; ctx.beginPath(); ctx.arc(-w / 4, 0, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a6ac8'; ctx.beginPath(); ctx.arc(w / 5, -2, 4, 0, 7); ctx.fill();
  },
  desk(ctx, w, h) { DRAW.workbench(ctx, w, h); },
  boilerTank(ctx, w, h) {
    shade(ctx, w, h);
    const g = ctx.createRadialGradient(-w / 6, -h / 6, 4, 0, 0, w * .8);
    g.addColorStop(0, '#8a6a4a'); g.addColorStop(.6, '#5c4632'); g.addColorStop(1, '#3a2c1e');
    ctx.fillStyle = g; rr(ctx, -w / 2, -h / 2, w, h, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h / 5); ctx.lineTo(w / 2 - 3, -h / 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w / 2 + 3, h / 5); ctx.lineTo(w / 2 - 3, h / 5); ctx.stroke();
    ctx.fillStyle = '#c8842e'; ctx.beginPath(); ctx.arc(0, -h / 2 + 8, 4, 0, 7); ctx.fill(); // вентиль
  },
  crate(ctx, w, h) {
    shade(ctx, w, h);
    ctx.fillStyle = '#5c4a30'; rr(ctx, -w / 2, -h / 2, w, h, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
    ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h / 2 + 3); ctx.lineTo(w / 2 - 3, h / 2 - 3);
    ctx.moveTo(w / 2 - 3, -h / 2 + 3); ctx.lineTo(-w / 2 + 3, h / 2 - 3); ctx.stroke();
  },
  barrel(ctx, w) {
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(2, 3, w * .48, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(-3, -3, 2, 0, 0, w * .5);
    g.addColorStop(0, '#6a563a'); g.addColorStop(1, '#423320');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w * .48, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2c2214'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, w * .34, 0, 7); ctx.stroke();
  },
  oldchair(ctx, w, h) { DRAW.chair(ctx, w, h); ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(ctx, -w / 4, -h / 4, w / 2, h / 2, 2); ctx.fill(); },
};

export function drawFurnitureItem(ctx, f) {
  ctx.save();
  ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
  if (f.rot) ctx.rotate(f.rot);
  (DRAW[f.type] || DRAW.crate)(ctx, f.w, f.h);
  ctx.restore();
}

// ---------- Бросаемые предметы ----------
const PROP_DRAW = {
  plate(ctx) {
    ctx.fillStyle = '#d8dade'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#b8bcc2'; ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, 7); ctx.fill();
  },
  plateBroken(ctx) {
    ctx.fillStyle = '#c9ccd2';
    ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-1, -5); ctx.lineTo(1, -1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 1); ctx.lineTo(6, -1); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(0, 3); ctx.lineTo(-2, 6); ctx.closePath(); ctx.fill();
  },
  cup(ctx) {
    ctx.fillStyle = '#a8443a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#7c2c24'; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#a8443a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(4.5, 0, 2, -1.2, 1.2); ctx.stroke();
  },
  book(ctx) {
    ctx.fillStyle = '#5a3a6a'; ctx.fillRect(-5, -3.5, 10, 7);
    ctx.fillStyle = '#d8d2be'; ctx.fillRect(4, -3, 1.4, 6);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(-3, -1.5); ctx.lineTo(2, -1.5); ctx.stroke();
  },
  bottle(ctx) {
    ctx.fillStyle = '#2e4a38'; ctx.beginPath(); ctx.arc(0, 1, 3.4, 0, 7); ctx.fill();
    ctx.fillRect(-1.2, -5, 2.4, 5);
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.arc(-1, 0, 1.2, 0, 7); ctx.fill();
  },
  toy(ctx) {
    ctx.fillStyle = '#b05a4a'; ctx.beginPath(); ctx.arc(-2, 0, 3.2, 0, 7); ctx.fill(); // мишка
    ctx.fillStyle = '#8a4436'; ctx.beginPath(); ctx.arc(2.6, -1.4, 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillRect(2, -2, 1, 1);
  },
  can(ctx) {
    ctx.fillStyle = '#8a9298'; ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#6a7278'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, 7); ctx.fill();
  },
  tool(ctx) {
    ctx.fillStyle = '#7d848a'; ctx.fillRect(-6, -1.2, 9, 2.4);
    ctx.fillStyle = '#9aa2a8'; ctx.beginPath(); ctx.arc(4.5, 0, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#42474c'; ctx.beginPath(); ctx.arc(4.5, 0, 1.4, 0, 7); ctx.fill();
  },
};

export function drawProp(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y - p.z);
  ctx.rotate(p.rot);
  if (p.z > 1) { // тень при полёте
    ctx.save(); ctx.rotate(-p.rot); ctx.translate(0, p.z);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.4, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  const key = p.broken && p.type === 'plate' ? 'plateBroken' : p.type;
  (PROP_DRAW[key] || PROP_DRAW.can)(ctx);
  ctx.restore();
}
