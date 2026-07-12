// Рендерер: пререндер статики этажей + покадровая сцена + ночной монитор.

import { TILE, makeCanvas, makeRng, clamp } from '../core/utils.js';
import { FLOOR_BASEMENT, OUTSIDE } from '../world/house.js';
import { drawFurnitureItem, drawProp } from '../world/furniture.js';
import { drawPlaced } from '../systems/equipment.js';

const YARD_KINDS = new Set([
  'shed', 'well', 'woodpile', 'clothesline', 'swing', 'scarecrow',
  'doghouse', 'gravestone', 'deadtree', 'puddle', 'birdbath',
]);

const FLOOR_STYLE = {
  garage: { base: '#303338', kind: 'concrete' },
  utility: { base: '#383e43', kind: 'tile' },
  kitchen: { base: '#3b4144', kind: 'checker' },
  dining: { base: '#463724', kind: 'wood' },
  hall: { base: '#413320', kind: 'wood' },
  master: { base: '#3a3844', kind: 'carpet' },
  bath: { base: '#374149', kind: 'tile' },
  living: { base: '#443521', kind: 'wood' },
  kids: { base: '#3d4237', kind: 'carpet' },
  cellar: { base: '#2a2c31', kind: 'concrete' },
  workshop: { base: '#2c2e32', kind: 'concrete' },
  boiler: { base: '#282a2f', kind: 'concrete' },
};

export class Renderer {
  constructor(world) {
    this.world = world;
    this.static = {};
    this.static[0] = this.buildGround();
    this.static[FLOOR_BASEMENT] = this.buildBasement();
    this.monitor = makeCanvas(340, 190);
    this.monitorNoise = 0;
  }

  // ---------- СТАТИКА: ПЕРВЫЙ ЭТАЖ ----------
  buildGround() {
    const g = this.world.floors[0];
    const cv = makeCanvas(g.W * TILE, g.H * TILE);
    const c = cv.getContext('2d');
    const rng = makeRng(1337);

    // ночная трава
    c.fillStyle = '#1c241a';
    c.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * cv.width, y = rng() * cv.height;
      c.fillStyle = `rgba(${30 + rng() * 25 | 0},${45 + rng() * 25 | 0},${28 + rng() * 15 | 0},${0.25 + rng() * 0.3})`;
      c.fillRect(x, y, 2 + rng() * 3, 2 + rng() * 2);
    }
    // тёмные проплешины
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(10,14,10,${0.12 + rng() * 0.12})`;
      c.beginPath();
      c.ellipse(rng() * cv.width, rng() * cv.height, 20 + rng() * 60, 14 + rng() * 40, rng() * 3, 0, 7);
      c.fill();
    }

    // фоновые дорожки (под полами комнат) — из чертежа
    this.paintGroundDecor(c, rng);

    // крыльцо
    const P = this.world.porch;
    c.fillStyle = '#3d3220';
    c.fillRect(P.x * TILE, P.y * TILE, P.w * TILE, P.h * TILE);
    c.strokeStyle = 'rgba(0,0,0,.4)';
    for (let i = 0; i <= P.h * 4; i++) {
      c.beginPath();
      c.moveTo(P.x * TILE, (P.y + i / 4) * TILE);
      c.lineTo((P.x + P.w) * TILE, (P.y + i / 4) * TILE);
      c.stroke();
    }

    // забор
    c.fillStyle = '#26221c';
    for (const r of this.world.exterior.fence) c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#332d24';
    for (let x = 1 * TILE; x < 46.5 * TILE; x += 26) {
      c.fillRect(x, 1 * TILE - 3, 6, 14); c.fillRect(x, 32.6 * TILE - 3, 6, 14);
    }
    for (let y = 1 * TILE; y < 32.8 * TILE; y += 26) {
      c.fillRect(1 * TILE - 3, y, 14, 6); c.fillRect(46.3 * TILE - 3, y, 14, 6);
    }

    // полы комнат
    this.paintRoomFloors(c, 0, rng);

    // стены
    this.paintWalls(c, g);

    // окна
    for (const w of this.world.windows) {
      const x = w.tx * TILE, y = w.ty * TILE;
      c.fillStyle = '#11161d';
      if (w.orient === 'h') { c.fillRect(x + 5, y + TILE / 2 - 3, TILE - 10, 6); }
      else { c.fillRect(x + TILE / 2 - 3, y + 5, 6, TILE - 10); }
      c.fillStyle = 'rgba(130,160,200,.18)';
      if (w.orient === 'h') { c.fillRect(x + 7, y + TILE / 2 - 1.5, TILE - 14, 3); }
      else { c.fillRect(x + TILE / 2 - 1.5, y + 7, 3, TILE - 14); }
    }

    // ворота гаража (декор)
    const gd = this.world.garageDoorDecor;
    c.fillStyle = '#2b3138';
    c.fillRect(gd.tx * TILE + 4, gd.ty * TILE + 4, TILE - 8, gd.h * TILE - 8);
    c.strokeStyle = 'rgba(0,0,0,.5)';
    for (let i = 1; i < gd.h * 2; i++) {
      c.beginPath();
      c.moveTo(gd.tx * TILE + 5, (gd.ty + i / 2) * TILE);
      c.lineTo(gd.tx * TILE + TILE - 5, (gd.ty + i / 2) * TILE);
      c.stroke();
    }

    // пороги, плинтусы и детали интерьера
    this.paintThresholds(c, 0);
    this.paintDetails(c, 0, rng);
    this.paintStairs(c, 0);

    // кусты
    for (const b of this.world.exterior.bushes) {
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.beginPath(); c.ellipse(b.x + 3, b.y + 4, b.r, b.r * 0.8, 0, 0, 7); c.fill();
      const grd = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      grd.addColorStop(0, '#2c3d26'); grd.addColorStop(1, '#172114');
      c.fillStyle = grd;
      c.beginPath(); c.ellipse(b.x, b.y, b.r, b.r * 0.85, 0, 0, 7); c.fill();
    }

    // дворовые объекты (сарай, колодец, могилы…) — из чертежа, до мебели
    this.paintYardDecor(c, rng);

    // мебель первого этажа (подвижная рисуется покадрово в drawScene)
    for (const f of this.world.furniture[0]) if (!f.movable) drawFurnitureItem(c, f);

    // фургон
    this.paintVan(c);

    return cv;
  }

  // ---------- СТАТИКА: ПОДВАЛ ----------
  buildBasement() {
    const g = this.world.floors[FLOOR_BASEMENT];
    const cv = makeCanvas(g.W * TILE, g.H * TILE);
    const c = cv.getContext('2d');
    const rng = makeRng(4242);
    c.fillStyle = '#0a0b0d';
    c.fillRect(0, 0, cv.width, cv.height);
    this.paintRoomFloors(c, FLOOR_BASEMENT, rng);
    // трещины и пятна
    for (let i = 0; i < 50; i++) {
      const x = rng() * cv.width, y = rng() * cv.height;
      if (g.isSolid(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      c.strokeStyle = `rgba(8,9,11,${0.3 + rng() * 0.3})`;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y);
      let cx = x, cy = y;
      for (let s = 0; s < 4; s++) { cx += rng.range(-14, 14); cy += rng.range(-10, 10); c.lineTo(cx, cy); }
      c.stroke();
    }
    this.paintWalls(c, g);
    this.paintThresholds(c, FLOOR_BASEMENT);
    this.paintDetails(c, FLOOR_BASEMENT, rng);
    this.paintStairs(c, FLOOR_BASEMENT);
    for (const f of this.world.furniture[FLOOR_BASEMENT]) if (!f.movable) drawFurnitureItem(c, f);
    return cv;
  }

  // Лестница между этажами: читаемый top-down пролёт со ступенями,
  // косоурами, указателем направления и предупредительной кромкой у входа.
  paintStairs(c, floor) {
    for (const st of this.world.stairs) {
      if (st.floor !== floor) continue;
      const t = st.tiles;
      const x = t.x * TILE, y = t.y * TILE, w = t.w * TILE, h = t.h * TILE;
      const down = st.dir === 'down';
      // люк со стремянкой в подвал по центру плитки лестницы
      const hw = Math.min(w - 6, TILE * 1.45);   // ширина люка
      const hx = x + (w - hw) / 2;
      const hy = y + 3, hh = h - 6;
      c.save();

      // обрамление люка в полу (рамка-порог)
      c.fillStyle = '#332b1e';
      c.fillRect(hx - 6, hy - 6, hw + 12, hh + 12);
      c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1.5;
      c.strokeRect(hx - 6 + 1, hy - 6 + 1, hw + 10, hh + 10);
      c.fillStyle = '#1b160f';
      c.fillRect(hx - 3, hy - 3, hw + 6, hh + 6);

      // тёмная шахта: у спуска чернеет книзу, у подъёма — прохладный свет сверху
      const shaft = c.createLinearGradient(0, hy, 0, hy + hh);
      if (down) { shaft.addColorStop(0, '#0d0d11'); shaft.addColorStop(1, '#000'); }
      else { shaft.addColorStop(0, '#1a2027'); shaft.addColorStop(1, '#050506'); }
      c.fillStyle = shaft;
      c.fillRect(hx, hy, hw, hh);
      // у подъёма — блик света из проёма верхнего этажа
      if (!down) {
        const gl = c.createLinearGradient(0, hy, 0, hy + hh * 0.5);
        gl.addColorStop(0, 'rgba(150,175,205,.25)');
        gl.addColorStop(1, 'rgba(150,175,205,0)');
        c.fillStyle = gl;
        c.fillRect(hx, hy, hw, hh * 0.5);
      }

      // две вертикальные тетивы стремянки
      const railW = 3.6;
      const railL = hx + 5, railR = hx + hw - 5 - railW;
      for (const rx of [railL, railR]) {
        c.fillStyle = '#7f858b';
        c.fillRect(rx, hy + 2, railW, hh - 4);
        c.fillStyle = 'rgba(255,255,255,.20)';   // блик слева на тетиве
        c.fillRect(rx, hy + 2, 1, hh - 4);
        c.fillStyle = 'rgba(0,0,0,.35)';         // тень справа
        c.fillRect(rx + railW - 1, hy + 2, 1, hh - 4);
      }

      // горизонтальные перекладины (ступени стремянки)
      const rungs = Math.max(5, Math.round(hh / 12));
      const rx0 = railL + railW - 0.5, rx1 = railR + 0.5;
      for (let i = 1; i < rungs; i++) {
        const ry = hy + hh * (i / rungs);
        c.fillStyle = 'rgba(0,0,0,.55)';         // тень под перекладиной
        c.fillRect(rx0, ry + 1.6, rx1 - rx0, 2.6);
        c.fillStyle = '#9aa0a6';                 // металл перекладины
        c.fillRect(rx0, ry, rx1 - rx0, 2.6);
        c.fillStyle = 'rgba(255,255,255,.22)';   // блик сверху
        c.fillRect(rx0, ry, rx1 - rx0, 0.9);
      }
      c.restore();
    }
  }

  // деревянные пороги в дверных проёмах
  paintThresholds(c, floor) {
    for (const d of this.world.doors) {
      if (d.floor !== floor) continue;
      const x = d.tx * TILE, y = d.ty * TILE;
      c.fillStyle = '#33281a';
      c.fillRect(x, y, TILE, TILE);
      c.strokeStyle = 'rgba(0,0,0,.35)';
      c.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        c.beginPath();
        if (d.orient === 'h') { c.moveTo(x, y + i * 8); c.lineTo(x + TILE, y + i * 8); }
        else { c.moveTo(x + i * 8, y); c.lineTo(x + i * 8, y + TILE); }
        c.stroke();
      }
      c.fillStyle = 'rgba(255,235,190,.05)';
      c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    }
  }

  // детали: плинтусы, светильники, паутина, ковры-мелочи, картины…
  paintDetails(c, floor, rng) {
    // плинтусы по периметру комнат
    for (const room of this.world.rooms) {
      if (room.floor !== floor) continue;
      for (const r of room.rects) {
        c.strokeStyle = 'rgba(12,10,8,.4)';
        c.lineWidth = 2.5;
        c.strokeRect(r.x * TILE + 1.5, r.y * TILE + 1.5, r.w * TILE - 3, r.h * TILE - 3);
      }
      // потолочные светильники (плафон виден всегда)
      for (const l of room.lamps) {
        c.fillStyle = 'rgba(0,0,0,.3)';
        c.beginPath(); c.arc(l.x + 1.5, l.y + 2, 5.5, 0, 7); c.fill();
        c.fillStyle = floor === FLOOR_BASEMENT ? '#3a352c' : '#57504a';
        c.beginPath(); c.arc(l.x, l.y, 5, 0, 7); c.fill();
        c.fillStyle = '#c9bd96';
        c.beginPath(); c.arc(l.x, l.y, 2.4, 0, 7); c.fill();
      }
    }

    // шторы у окон (короткие тканевые «язычки» с внутренней стороны)
    if (floor === 0) {
      c.fillStyle = '#3f3a4e';
      const g = this.world.floors[0];
      for (const w of this.world.windows) {
        const x = w.tx * TILE, y = w.ty * TILE;
        if (w.orient === 'h') {
          // интерьер — со стороны, где комната (roomAt != OUTSIDE)
          const iy = g.roomAt(w.tx, w.ty + 1) !== OUTSIDE ? y + TILE : y - 6;
          c.fillRect(x + 2, iy, 8, 6);
          c.fillRect(x + TILE - 10, iy, 8, 6);
        } else {
          const ix = g.roomAt(w.tx + 1, w.ty) !== OUTSIDE ? x + TILE : x - 6;
          c.fillRect(ix, y + 2, 6, 8);
          c.fillRect(ix, y + TILE - 10, 6, 8);
        }
      }
    }
    // авторский декор карты (картины, шкафы, клумбы, трубы, паутина…) из чертежа
    this.paintDecor(c, floor, rng);
  }

  // Фоновые дорожки под полами комнат (kind: driveway|vanPath), только этаж 0.
  paintGroundDecor(c, rng) {
    for (const e of this.world.decor) {
      if (e.floor !== 0) continue;
      if (e.kind === 'driveway') {
        c.fillStyle = '#2e3034';
        c.fillRect(e.x * TILE, e.y * TILE, e.w * TILE, e.h * TILE);
        for (let i = 0; i < 130; i++) {
          c.fillStyle = `rgba(${70 + rng() * 40 | 0},${72 + rng() * 40 | 0},${78 + rng() * 40 | 0},.25)`;
          c.fillRect((e.x + rng() * e.w) * TILE, (e.y + rng() * e.h) * TILE, 2, 2);
        }
      } else if (e.kind === 'vanPath') {
        for (let i = 0; i < e.n; i++) {
          const x = (e.x + i * e.step) * TILE, y = e.y * TILE + Math.sin(i * 1.7) * 5;
          c.fillStyle = '#33373d';
          c.beginPath(); c.ellipse(x, y, 12, 9, rng() * 0.6, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,.05)';
          c.beginPath(); c.ellipse(x - 2, y - 2, 8, 5, 0, 0, 7); c.fill();
        }
      }
    }
  }

  // Дворовые объекты (этаж 0, снаружи): сарай, колодец, поленница, качели,
  // пугало, будка, могилы, сухое дерево, лужи, бельевая верёвка. Запекаются
  // в статику. Координаты/размеры — из world.decor (kind + x,y,w,h в тайлах).
  paintYardDecor(c, rng) {
    for (const e of this.world.decor) {
      if (e.floor !== 0 || !YARD_KINDS.has(e.kind)) continue;
      const x = e.x * TILE, y = e.y * TILE;
      c.save();
      switch (e.kind) {
        case 'shed': {
          const w = (e.w || 3) * TILE, h = (e.h || 2.4) * TILE;
          c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x + 4, y + 6, w, h);
          const g = c.createLinearGradient(x, y, x + w, y);
          g.addColorStop(0, '#3a3126'); g.addColorStop(0.5, '#4a3f30'); g.addColorStop(1, '#2e2820');
          c.fillStyle = g; c.fillRect(x, y, w, h);
          c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1;             // доски
          for (let i = 1; i < w / 10; i++) { c.beginPath(); c.moveTo(x + i * 10, y); c.lineTo(x + i * 10, y + h); c.stroke(); }
          c.fillStyle = '#1a1712'; c.fillRect(x + w * 0.36, y + h * 0.4, w * 0.28, h * 0.6); // дверь-провал
          c.fillStyle = '#12222a'; c.fillRect(x + w * 0.12, y + h * 0.2, w * 0.16, h * 0.24); // окошко
          c.fillStyle = 'rgba(120,150,180,.15)'; c.fillRect(x + w * 0.12, y + h * 0.2, w * 0.16, h * 0.12);
          c.fillStyle = '#241d16'; c.beginPath();                        // скат крыши
          c.moveTo(x - 4, y + 4); c.lineTo(x + w / 2, y - h * 0.28); c.lineTo(x + w + 4, y + 4); c.closePath(); c.fill();
          break;
        }
        case 'well': {
          const r = (e.w || 1.2) * TILE * 0.5;
          c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(x + 3, y + 4, r + 3, r + 1, 0, 0, 7); c.fill();
          c.fillStyle = '#4a4640'; c.beginPath(); c.arc(x, y, r + 3, 0, 7); c.fill(); // каменный бортик
          c.strokeStyle = '#2a2620'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 3, 0, 7); c.stroke();
          c.fillStyle = '#050607'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); // чёрный провал
          c.strokeStyle = '#3a352c'; c.lineWidth = 2;                    // стойки навеса
          c.beginPath(); c.moveTo(x - r - 2, y); c.lineTo(x - r - 2, y - r * 2.4);
          c.moveTo(x + r + 2, y); c.lineTo(x + r + 2, y - r * 2.4); c.stroke();
          c.fillStyle = '#241d14'; c.beginPath();                        // навес
          c.moveTo(x - r - 6, y - r * 2.2); c.lineTo(x, y - r * 3); c.lineTo(x + r + 6, y - r * 2.2); c.closePath(); c.fill();
          c.strokeStyle = '#1a1510'; c.lineWidth = 3;                    // ворот
          c.beginPath(); c.moveTo(x - r, y - r * 1.4); c.lineTo(x + r, y - r * 1.4); c.stroke();
          break;
        }
        case 'woodpile': {
          const w = (e.w || 2) * TILE;
          c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - 2, y + 2, w + 4, TILE * 0.9);
          for (let row = 0; row < 3; row++) for (let i = 0; i < w / 9; i++) {
            const lx = x + i * 9 + (row % 2) * 4.5, ly = y + row * 6;
            c.fillStyle = ['#5a4530', '#6a5238', '#4c3a26'][i % 3];
            c.beginPath(); c.arc(lx, ly, 4.2, 0, 7); c.fill();
            c.fillStyle = '#c9b48a'; c.beginPath(); c.arc(lx, ly, 2.2, 0, 7); c.fill(); // торец
            c.strokeStyle = 'rgba(90,70,40,.6)'; c.lineWidth = 0.5; c.beginPath(); c.arc(lx, ly, 1.2, 0, 7); c.stroke();
          }
          break;
        }
        case 'clothesline': {
          const w = (e.w || 4) * TILE;
          c.strokeStyle = '#2a251c'; c.lineWidth = 2.5;                  // столбы
          c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - TILE * 1.6);
          c.moveTo(x + w, y); c.lineTo(x + w, y - TILE * 1.6);
          c.moveTo(x - 6, y - TILE * 1.5); c.lineTo(x + 6, y - TILE * 1.5);
          c.moveTo(x + w - 6, y - TILE * 1.5); c.lineTo(x + w + 6, y - TILE * 1.5); c.stroke();
          c.strokeStyle = 'rgba(20,18,14,.8)'; c.lineWidth = 1;          // провисшая верёвка
          c.beginPath(); c.moveTo(x, y - TILE * 1.5); c.quadraticCurveTo(x + w / 2, y - TILE * 1.5 + 10, x + w, y - TILE * 1.5); c.stroke();
          for (const fx2 of [0.28, 0.55, 0.78]) {                        // простыни
            const sx = x + w * fx2, sy = y - TILE * 1.5 + 6;
            c.fillStyle = 'rgba(200,205,210,.5)';
            c.beginPath(); c.moveTo(sx - 6, sy); c.lineTo(sx + 6, sy);
            c.quadraticCurveTo(sx + 5, sy + 16, sx + 2, sy + 22);
            c.quadraticCurveTo(sx, sy + 16, sx - 2, sy + 22);
            c.quadraticCurveTo(sx - 5, sy + 16, sx - 6, sy); c.closePath(); c.fill();
          }
          break;
        }
        case 'swing': {
          c.strokeStyle = '#2c261c'; c.lineWidth = 2.5;                  // рама-А
          c.beginPath();
          c.moveTo(x - TILE * 0.7, y + TILE * 0.5); c.lineTo(x, y - TILE * 1.2); c.lineTo(x + TILE * 0.7, y + TILE * 0.5);
          c.moveTo(x, y - TILE * 1.2); c.lineTo(x + TILE * 1.4, y - TILE * 1.2); c.lineTo(x + TILE * 2.1, y + TILE * 0.5);
          c.moveTo(x + TILE * 0.7, y - TILE * 1.2); c.lineTo(x + TILE * 0.7, y + TILE * 0.5); c.stroke();
          c.strokeStyle = 'rgba(20,18,14,.85)'; c.lineWidth = 1;         // цепи
          c.beginPath(); c.moveTo(x + TILE * 0.4, y - TILE * 1.15); c.lineTo(x + TILE * 0.35, y + TILE * 0.1);
          c.moveTo(x + TILE * 1.0, y - TILE * 1.15); c.lineTo(x + TILE * 1.05, y + TILE * 0.1); c.stroke();
          c.fillStyle = '#3a2e1e'; c.fillRect(x + TILE * 0.3, y + TILE * 0.1, TILE * 0.8, 4); // сиденье
          break;
        }
        case 'scarecrow': {
          c.strokeStyle = '#3a2e1c'; c.lineWidth = 3;                    // крест
          c.beginPath(); c.moveTo(x, y + TILE); c.lineTo(x, y - TILE * 1.1);
          c.moveTo(x - TILE * 0.7, y - TILE * 0.4); c.lineTo(x + TILE * 0.7, y - TILE * 0.4); c.stroke();
          c.fillStyle = '#5a4a2e';                                       // одежда
          c.beginPath(); c.moveTo(x - 8, y - TILE * 0.5); c.lineTo(x + 8, y - TILE * 0.5); c.lineTo(x + 5, y + TILE * 0.4); c.lineTo(x - 5, y + TILE * 0.4); c.closePath(); c.fill();
          c.fillStyle = '#8a7448'; c.beginPath(); c.arc(x, y - TILE * 0.95, 6, 0, 7); c.fill(); // мешок-голова
          c.fillStyle = '#1a140c'; c.fillRect(x - 2.6, y - TILE * 0.98, 1.6, 1.6); c.fillRect(x + 1, y - TILE * 0.98, 1.6, 1.6); // глаза-стежки
          c.strokeStyle = '#1a140c'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(x - 2, y - TILE * 0.9); c.lineTo(x + 2, y - TILE * 0.9); c.stroke();
          c.fillStyle = '#8a7448'; c.beginPath(); c.moveTo(x - 8, y - TILE * 1.15); c.lineTo(x + 8, y - TILE * 1.15); c.lineTo(x, y - TILE * 1.35); c.closePath(); c.fill(); // шляпа
          break;
        }
        case 'doghouse': {
          const w = TILE * 1.3, h = TILE * 1.0;
          c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - w / 2 + 3, y - h / 2 + 4, w, h);
          c.fillStyle = '#4a3826'; c.fillRect(x - w / 2, y - h / 2, w, h);
          c.fillStyle = '#050505'; c.beginPath(); c.arc(x, y + h * 0.12, w * 0.28, 0, 7); c.fill(); // чёрный лаз
          c.fillStyle = '#33261a'; c.beginPath();
          c.moveTo(x - w / 2 - 3, y - h / 2 + 2); c.lineTo(x, y - h * 0.95); c.lineTo(x + w / 2 + 3, y - h / 2 + 2); c.closePath(); c.fill();
          c.strokeStyle = '#6a5a3a'; c.lineWidth = 1; c.beginPath();     // цепь у входа
          c.moveTo(x + 3, y + h * 0.2); c.lineTo(x + 10, y + h * 0.5); c.stroke();
          break;
        }
        case 'gravestone': {
          const w = TILE * 0.7, h = TILE * 0.9;
          c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(x + 2, y + h * 0.5, w * 0.7, 4, 0, 0, 7); c.fill();
          const g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
          g.addColorStop(0, '#3e4247'); g.addColorStop(0.5, '#565b61'); g.addColorStop(1, '#33373b');
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(x - w / 2, y + h / 2); c.lineTo(x - w / 2, y - h * 0.15);
          c.arc(x, y - h * 0.15, w / 2, Math.PI, 0); c.lineTo(x + w / 2, y + h / 2); c.closePath(); c.fill();
          c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 0.8;
          c.beginPath(); c.moveTo(x, y - h * 0.1); c.lineTo(x, y + h * 0.12);
          c.moveTo(x - w * 0.22, y + 1); c.lineTo(x + w * 0.22, y + 1); c.stroke(); // крест-гравировка
          c.fillStyle = 'rgba(40,60,45,.4)'; c.fillRect(x - w / 2, y + h * 0.3, w, h * 0.2); // мох
          break;
        }
        case 'deadtree': {
          const r = (e.w || 1.3) * TILE;
          c.strokeStyle = '#1e1811'; c.lineWidth = 5;
          c.beginPath(); c.moveTo(x, y + r * 0.4); c.lineTo(x, y - r * 0.4); c.stroke();
          const branch = (ang, len, wdt) => {
            c.lineWidth = wdt; c.beginPath(); c.moveTo(x, y - r * 0.2);
            const mx = x + Math.cos(ang) * len * 0.6, my = y - r * 0.2 + Math.sin(ang) * len * 0.6;
            c.lineTo(mx, my);
            c.lineTo(mx + Math.cos(ang - 0.5) * len * 0.4, my + Math.sin(ang - 0.5) * len * 0.4); c.stroke();
          };
          c.strokeStyle = '#241c13';
          branch(-2.4, r, 3); branch(-0.7, r * 0.9, 3); branch(-1.5, r * 1.1, 2.5);
          branch(-2.9, r * 0.7, 2); branch(-0.2, r * 0.6, 2);
          break;
        }
        case 'puddle': {
          const w = (e.w || 1.6) * TILE, h = (e.h || 1) * TILE;
          const g = c.createRadialGradient(x, y, 1, x, y, w / 2);
          g.addColorStop(0, 'rgba(30,40,52,.55)'); g.addColorStop(0.7, 'rgba(20,28,38,.4)'); g.addColorStop(1, 'rgba(20,28,38,0)');
          c.fillStyle = g; c.beginPath(); c.ellipse(x, y, w / 2, h / 2, 0, 0, 7); c.fill();
          c.strokeStyle = 'rgba(120,150,180,.18)'; c.lineWidth = 1;      // холодный блик-контур
          c.beginPath(); c.ellipse(x - w * 0.08, y - h * 0.08, w * 0.32, h * 0.28, 0.3, 0, 7); c.stroke();
          break;
        }
        case 'birdbath': {
          const r = TILE * 0.55;
          c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x + 2, y + 3, r, r * 0.5, 0, 0, 7); c.fill();
          c.fillStyle = '#4a4640'; c.fillRect(x - 3, y - r, 6, r * 1.6);  // ножка
          c.fillStyle = '#565b61'; c.beginPath(); c.ellipse(x, y - r, r, r * 0.55, 0, 0, 7); c.fill(); // чаша
          c.fillStyle = '#1e2830'; c.beginPath(); c.ellipse(x, y - r, r * 0.7, r * 0.38, 0, 0, 7); c.fill(); // тёмная вода
          break;
        }
      }
      c.restore();
    }
  }

  // Авторские декали поверх стен (картины, коврики, шкафы, клумбы, трубы,
  // паутина, бумаги, перфопанель). Координаты — из чертежа (world.decor).
  paintDecor(c, floor, rng) {
    for (const e of this.world.decor) {
      if (e.floor !== floor) continue;
      switch (e.kind) {
        case 'painting': {
          const x = e.x * TILE, y = e.y * TILE + TILE / 2 - 5;
          c.fillStyle = '#5c4a28'; c.fillRect(x, y, 14, 10);
          c.fillStyle = e.color; c.fillRect(x + 1.5, y + 1.5, 11, 7);
          c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x + 2, y + 2, 4, 2.5);
          break;
        }
        case 'mat': {
          c.fillStyle = e.color;
          c.fillRect(e.x * TILE, e.y * TILE, e.w * TILE, e.h * TILE);
          if (e.stroke) {
            c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.5;
            c.strokeRect((e.x + 0.08) * TILE, (e.y + 0.08) * TILE, (e.w - 0.16) * TILE, (e.h - 0.16) * TILE);
          }
          break;
        }
        case 'bathMat':
          c.fillStyle = '#8ea0a8';
          c.beginPath(); c.ellipse(e.x * TILE, e.y * TILE, 13, 8, 0, 0, 7); c.fill();
          break;
        case 'oil':
          c.fillStyle = 'rgba(10,10,12,.5)';
          c.beginPath(); c.ellipse(e.x * TILE, e.y * TILE, 20, 12, 0.3, 0, 7); c.fill();
          break;
        case 'cobweb':
          this.cobweb(c, e.x * TILE, e.y * TILE, e.dir);
          break;
        case 'cabinets': {
          const y = e.y * TILE;
          c.fillStyle = 'rgba(30,24,16,.55)';
          for (const [bx, bw] of e.blocks) c.fillRect(bx * TILE, y, bw * TILE, 9);
          c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1;
          for (const bx of e.doorX) {
            c.beginPath(); c.moveTo(bx * TILE, y + 1); c.lineTo(bx * TILE, y + 8); c.stroke();
          }
          break;
        }
        case 'flowerbed': {
          const y = (e.y ?? 25.15) * TILE;
          c.fillStyle = '#241d14';
          c.beginPath();
          c.roundRect ? c.roundRect(e.x * TILE, y, e.w * TILE, 14, 6) : c.rect(e.x * TILE, y, e.w * TILE, 14);
          c.fill();
          for (let i = 0; i < e.w * 3; i++) {
            c.fillStyle = ['#5a6a7a', '#6a5a72', '#7a7060'][i % 3];
            c.beginPath();
            c.arc((e.x + 0.25 + i * 0.32) * TILE, y + 5 + (i % 2) * 5, 2.2, 0, 7);
            c.fill();
          }
          break;
        }
        case 'pipes':
          c.strokeStyle = '#3a3430'; c.lineWidth = 5;
          c.beginPath(); c.moveTo(e.x1 * TILE, e.y * TILE); c.lineTo(e.x2 * TILE, e.y * TILE); c.stroke();
          c.strokeStyle = '#443c34'; c.lineWidth = 3;
          c.beginPath(); c.moveTo(e.x1 * TILE, (e.y + 0.3) * TILE); c.lineTo(e.x2 * TILE, (e.y + 0.3) * TILE); c.stroke();
          break;
        case 'papers':
          c.fillStyle = 'rgba(180,175,160,.14)';
          for (let i = 0; i < e.n; i++) {
            c.save();
            c.translate((e.x + rng() * e.w) * TILE, (e.y + rng() * e.h) * TILE);
            c.rotate(rng() * 3);
            c.fillRect(-4, -3, 8, 6);
            c.restore();
          }
          break;
        case 'pegboard':
          c.fillStyle = '#3a2f22'; c.fillRect(e.x * TILE, e.y * TILE, 2.5 * TILE, 0.65 * TILE);
          c.fillStyle = '#8a8f94';
          c.fillRect((e.x + 0.2) * TILE, (e.y + 0.15) * TILE, 3, 10);
          c.fillRect((e.x + 0.7) * TILE, (e.y + 0.2) * TILE, 8, 3);
          c.fillStyle = '#6b4226'; c.fillRect((e.x + 1.4) * TILE, (e.y + 0.13) * TILE, 3, 11);
          c.fillStyle = '#5a5f64';
          c.beginPath(); c.arc((e.x + 2.1) * TILE, (e.y + 0.3) * TILE, 4, 0, 7); c.stroke();
          break;
      }
    }
  }

  cobweb(c, x, y, dir) {
    c.strokeStyle = 'rgba(210,215,225,.10)';
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const a = (dir > 0 ? 0 : Math.PI / 2) + (i / 4) * Math.PI / 2;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * 22 * dir, y + Math.sin(a) * 22);
      c.stroke();
    }
    for (const r of [9, 16]) {
      c.beginPath();
      c.arc(x, y, r, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI);
      c.stroke();
    }
  }

  paintRoomFloors(c, floor, rng) {
    for (const room of this.world.rooms) {
      if (room.floor !== floor) continue;
      const st = FLOOR_STYLE[room.key] || FLOOR_STYLE.cellar;
      for (const r of room.rects) {
        const x = r.x * TILE, y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
        c.fillStyle = st.base;
        c.fillRect(x, y, w, h);
        if (st.kind === 'wood') {
          c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 1;
          for (let py = y; py <= y + h; py += 8) {
            c.beginPath(); c.moveTo(x, py); c.lineTo(x + w, py); c.stroke();
          }
          c.strokeStyle = 'rgba(90,70,40,.12)';
          for (let i = 0; i < w * h / 500; i++) {
            const px = x + rng() * w, py = y + Math.floor(rng() * (h / 8)) * 8;
            c.beginPath(); c.moveTo(px, py); c.lineTo(Math.min(px + 14 + rng() * 20, x + w), py + 4); c.stroke();
          }
        } else if (st.kind === 'tile') {
          c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1;
          for (let py = y; py <= y + h; py += 16) { c.beginPath(); c.moveTo(x, py); c.lineTo(x + w, py); c.stroke(); }
          for (let px = x; px <= x + w; px += 16) { c.beginPath(); c.moveTo(px, y); c.lineTo(px, y + h); c.stroke(); }
        } else if (st.kind === 'checker') {
          for (let py = 0; py < r.h * 2; py++) for (let px = 0; px < r.w * 2; px++) {
            if ((px + py) % 2) continue;
            c.fillStyle = 'rgba(0,0,0,.13)';
            c.fillRect(x + px * 16, y + py * 16, 16, 16);
          }
        } else if (st.kind === 'carpet') {
          for (let i = 0; i < w * h / 60; i++) {
            c.fillStyle = `rgba(255,255,255,${rng() * 0.03})`;
            c.fillRect(x + rng() * w, y + rng() * h, 2, 2);
          }
          c.strokeStyle = 'rgba(0,0,0,.2)'; c.lineWidth = 2;
          c.strokeRect(x + 3, y + 3, w - 6, h - 6);
        } else { // concrete
          for (let i = 0; i < w * h / 220; i++) {
            c.fillStyle = `rgba(${rng() < .5 ? '0,0,0' : '255,255,255'},${0.04 + rng() * 0.05})`;
            c.fillRect(x + rng() * w, y + rng() * h, 3 + rng() * 4, 2 + rng() * 3);
          }
        }
        // лёгкая внутренняя тень комнаты
        const gr = c.createLinearGradient(x, y, x, y + h);
        gr.addColorStop(0, 'rgba(0,0,0,.22)'); gr.addColorStop(.12, 'rgba(0,0,0,0)');
        gr.addColorStop(.88, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.22)');
        c.fillStyle = gr; c.fillRect(x, y, w, h);
      }
    }
  }

  paintWalls(c, grid) {
    for (const r of grid.wallRects) {
      const x = r.x * TILE, y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
      c.fillStyle = '#23272e';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#2e3440';
      c.fillRect(x + 2, y + 2, w - 4, Math.min(5, h - 4));
      c.strokeStyle = '#0c0e12';
      c.lineWidth = 2;
      c.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
  }

  paintVan(c) {
    const v = this.world.van;
    c.save();
    // тень
    c.fillStyle = 'rgba(0,0,0,.4)';
    c.beginPath(); c.ellipse(v.x + v.w / 2 + 5, v.y + v.h / 2 + 7, v.w * 0.62, v.h * 0.54, 0, 0, 7); c.fill();
    // колёса
    c.fillStyle = '#0e1114';
    for (const wy of [v.y + 14, v.y + v.h - 40]) {
      c.fillRect(v.x - 4, wy, 8, 26); c.fillRect(v.x + v.w - 4, wy, 8, 26);
    }
    // кузов
    const g = c.createLinearGradient(v.x, 0, v.x + v.w, 0);
    g.addColorStop(0, '#2c363d'); g.addColorStop(.5, '#465661'); g.addColorStop(1, '#242d33');
    c.fillStyle = g;
    const rr = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    rr(v.x, v.y, v.w, v.h, 12); c.fill();
    // кабина (север)
    c.fillStyle = '#12181d';
    rr(v.x + 6, v.y + 6, v.w - 12, 22, 6); c.fill();
    c.fillStyle = 'rgba(120,160,190,.15)';
    rr(v.x + 8, v.y + 8, v.w - 16, 12, 4); c.fill();
    // открытые задние двери + тёплый свет
    c.fillStyle = '#39464f';
    c.fillRect(v.x - 16, v.y + v.h - 30, 16, 28);
    c.fillRect(v.x + v.w, v.y + v.h - 30, 16, 28);
    const lg = c.createRadialGradient(v.x + v.w / 2, v.y + v.h - 8, 4, v.x + v.w / 2, v.y + v.h - 8, 60);
    lg.addColorStop(0, 'rgba(255,200,120,.35)'); lg.addColorStop(1, 'rgba(255,200,120,0)');
    c.fillStyle = lg;
    c.fillRect(v.x - 30, v.y + v.h - 40, v.w + 60, 90);
    // интерьер: стойка оборудования
    c.fillStyle = '#1a222a';
    c.fillRect(v.x + 6, v.y + v.h - 34, v.w - 12, 30);
    c.fillStyle = '#0f3f2c';
    c.fillRect(v.x + 10, v.y + v.h - 30, 18, 12); // монитор
    c.fillStyle = '#c8842e';
    c.fillRect(v.x + 34, v.y + v.h - 28, 8, 8);
    c.fillStyle = '#8a4436';
    c.fillRect(v.x + 48, v.y + v.h - 30, 10, 12);
    // логотип
    c.save();
    c.translate(v.x + v.w / 2, v.y + v.h * 0.55);
    c.rotate(-Math.PI / 2);
    c.fillStyle = 'rgba(180,200,215,.5)';
    c.font = 'bold 11px monospace';
    c.textAlign = 'center';
    c.fillText('П А Р А Н О Р М', 0, 4);
    c.restore();
    c.restore();
  }

  // ---------- КАДР ----------
  drawScene(ctx, game, cam, t) {
    const { world, player } = game;
    const floor = player.floor;

    ctx.fillStyle = '#000';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    cam.apply(ctx);

    // статика
    ctx.drawImage(this.static[floor], 0, 0);

    // подвижная мебель: не запечена в статику; трясётся, когда призрак её дёргает
    this.drawMovableFurniture(ctx, world, floor, t);

    // тёплое свечение включённых ламп (под слоем тьмы)
    if (world.breaker.on) {
      for (const room of world.rooms) {
        if (room.floor !== floor || !room.lightOn || room.lightBroken) continue;
        for (const l of room.lamps) {
          const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, TILE * 2.4);
          g.addColorStop(0, 'rgba(255,214,140,.18)');
          g.addColorStop(1, 'rgba(255,214,140,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(l.x, l.y, TILE * 2.4, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,240,200,.85)';
          ctx.beginPath(); ctx.arc(l.x, l.y, 2.6, 0, 7); ctx.fill();
        }
      }
    }

    // соль и отпечатки
    for (const s of world.saltPiles) {
      if (s.floor !== floor) continue;
      ctx.fillStyle = 'rgba(225,228,232,.85)';
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 9, 6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.beginPath(); ctx.ellipse(s.x - 1, s.y - 1, 5, 3, 0, 0, 7); ctx.fill();
      if (s.disturbed) {
        ctx.fillStyle = 'rgba(200,205,212,.5)';
        for (const st of s.steps) {
          ctx.beginPath(); ctx.ellipse(st.x, st.y, 4, 6, st.a, 0, 7); ctx.fill();
        }
      }
    }
    // УФ-отпечатки: видны только под УФ-фонарём
    const uvOn = player.currentItem() === 'uv' && player.flashlightOn && !player.hidden;
    if (uvOn) {
      for (const pr of world.prints) {
        if (pr.floor !== floor) continue;
        const d = Math.hypot(pr.x - player.x, pr.y - player.y);
        if (d > TILE * 5) continue;
        const da = Math.abs(((Math.atan2(pr.y - player.y, pr.x - player.x) - player.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d > TILE * 0.9 && da > 0.5) continue;
        const a = clamp(1.6 - d / (TILE * 3.4), 0, 1);
        ctx.fillStyle = `rgba(150,255,180,${a * 0.8})`;
        // пятерня
        ctx.save();
        ctx.translate(pr.x, pr.y); ctx.rotate(pr.rot || 0);
        ctx.beginPath(); ctx.ellipse(0, 1, 4, 5, 0, 0, 7); ctx.fill();
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.ellipse(i * 2.3, -5.5, 1.1, 2.8, i * 0.16, 0, 7); ctx.fill();
        }
        ctx.restore();
        if (!pr.seen) { pr.seen = true; game.onEvidenceSeen?.('uv'); }
      }
    }

    // размещённое снаряжение
    for (const it of world.placed) {
      if (it.floor !== floor) continue;
      drawPlaced(ctx, it, t, game);
    }

    // проклятый предмет
    if (world.cursed && world.cursed.floor === floor) this.drawCursed(ctx, world.cursed, t);

    // телевизор ожил помехами (микрособытие гостиной)
    if (world.tv && world.tv.floor === floor && game.tvStaticT > 0) {
      const tx = world.tv.x, ty = world.tv.y;
      const fl = 0.5 + Math.random() * 0.5;
      ctx.fillStyle = `rgba(160,190,220,${0.5 * fl})`;
      ctx.fillRect(tx - 34, ty - 5, 68, 9);
      const g = ctx.createRadialGradient(tx, ty, 4, tx, ty, TILE * 2.2);
      g.addColorStop(0, `rgba(140,180,220,${0.22 * fl})`);
      g.addColorStop(1, 'rgba(140,180,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(tx, ty, TILE * 2.2, 0, 7); ctx.fill();
    }

    // предметы-пропсы
    for (const p of world.props) {
      if (p.floor !== floor) continue;
      drawProp(ctx, p);
    }

    // двери
    for (const d of world.doors) {
      if (d.floor !== floor) continue;
      this.drawDoor(ctx, d);
    }

    // призрак под игроком по y? просто: призрак, затем игрок
    if (game.ghost && game.ghost.floor === floor) game.ghost.draw(ctx, t, game);

    // галлюцинация: тень на краю зрения, тает за долю секунды
    const hal = game.hallucination;
    if (hal && hal.floor === floor) {
      const a = Math.max(0, hal.t / hal.max);
      if (hal.eyes) {
        // пара тусклых глаз во тьме; гаснут, если игрок посветил на них фонарём
        const inBeam = player.flashlightOn &&
          Math.hypot(hal.x - player.x, hal.y - player.y) < TILE * 6 &&
          Math.abs(((Math.atan2(hal.y - player.y, hal.x - player.x) - player.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.4;
        if (inBeam) { game.hallucination = null; }
        else {
          const glow = a * (0.55 + Math.sin(t * 5) * 0.25);
          ctx.fillStyle = `rgba(150,20,20,${glow})`;
          for (const sx of [-3, 3]) {
            ctx.beginPath(); ctx.ellipse(hal.x + sx, hal.y, 1.8, 1.1, 0, 0, 7); ctx.fill();
          }
          ctx.fillStyle = `rgba(255,90,80,${glow})`;
          for (const sx of [-3, 3]) { ctx.beginPath(); ctx.arc(hal.x + sx, hal.y, 0.7, 0, 7); ctx.fill(); }
        }
      } else {
        const ea = a * 0.38;
        const g = ctx.createRadialGradient(hal.x, hal.y - 6, 2, hal.x, hal.y - 4, 20);
        g.addColorStop(0, `rgba(4,4,9,${ea})`);
        g.addColorStop(1, 'rgba(4,4,9,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(hal.x, hal.y - 4, 11, 19, 0, 0, 7); ctx.fill();
      }
    }

    player.draw(ctx, t, game);

    // частицы мира
    game.fx.drawWorld(ctx, floor);

    // двор: приземный туман и светлячки (под кронами)
    game.fx.drawYard(ctx, game);

    // кроны деревьев поверх — покачиваются на ветру
    if (floor === 0) {
      for (const tr of world.exterior.trees) {
        // ветер: крона качается и «дышит» от времени (у каждого дерева своя фаза)
        const swayX = Math.sin(t * 0.9 + tr.x * 0.05) * tr.r * 0.05;
        const swayY = Math.cos(t * 0.7 + tr.y * 0.05) * tr.r * 0.03;
        const cx = tr.x + swayX, cy = tr.y + swayY;
        const grd = ctx.createRadialGradient(cx - tr.r * 0.25, cy - tr.r * 0.25, tr.r * 0.15, cx, cy, tr.r);
        grd.addColorStop(0, 'rgba(34,48,30,.96)');
        grd.addColorStop(0.75, 'rgba(22,32,20,.95)');
        grd.addColorStop(1, 'rgba(12,18,12,.85)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        // неровная крона, листва шевелится
        for (let i = 0; i <= 10; i++) {
          const a = i / 10 * Math.PI * 2;
          const rr = tr.r * (1 + 0.14 * Math.sin(a * 3 + tr.x) + 0.04 * Math.sin(a * 5 + t * 1.6 + tr.x));
          const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
    }
  }

  drawMovableFurniture(ctx, world, floor, t) {
    for (const f of world.furniture[floor] || []) {
      if (!f.movable) continue;
      if (f.shakeT > 0) {
        const amp = (f.shakeAmp || 1.4) * (f.shakeT / (f.shakeDur || 1));
        ctx.save();
        ctx.translate(
          Math.sin(t * 43 + f.id * 2.7) * amp,
          Math.cos(t * 51 + f.id * 1.9) * amp * 0.6);
        drawFurnitureItem(ctx, f);
        ctx.restore();
      } else drawFurnitureItem(ctx, f);
    }
  }

  // ---------- Периферийное наблюдение освещённых комнат ----------
  // Отдельный визуальный слой (НЕ участвует в computeVisibility/hasLOS,
  // не помогает фото и не засчитывает улики). Через открытую дверь игрок
  // ловит слабый мутный силуэт освещённой смежной комнаты: свет, крупные
  // контуры, движение предметов, помехи, изредка — силуэт призрака.
  drawPeripheralLitRooms(ctx, game, cam) {
    const { world, player } = game;
    if (!world.breaker.on) return;
    const floor = player.floor;
    const grid = world.floors[floor];
    if (!grid) return;
    const playerRoom = grid.roomAt(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
    const amateur = game.difficulty !== 'pro';
    const baseAlpha = amateur ? 0.28 : 0.15;   // 25–30% / 10–18%
    const RANGE = TILE * 10;                    // не длиннее ~8–10 тайлов

    const seen = new Set();
    cam.apply(ctx);
    for (const d of world.doors) {
      if (d.floor !== floor || d.isFront) continue;
      if (d.swing < 0.6) continue;              // закрытая дверь полностью блокирует обзор
      const dcx = (d.tx + 0.5) * TILE, dcy = (d.ty + 0.5) * TILE;
      const distToDoor = Math.hypot(dcx - player.x, dcy - player.y);
      if (distToDoor > RANGE) continue;
      // комнаты по обе стороны двери (только прямая смежность — не цепочка)
      let aId, bId;
      if (d.orient === 'h') { aId = grid.roomAt(d.tx, d.ty - 1); bId = grid.roomAt(d.tx, d.ty + 1); }
      else { aId = grid.roomAt(d.tx - 1, d.ty); bId = grid.roomAt(d.tx + 1, d.ty); }
      for (const rid of [aId, bId]) {
        if (rid < 0 || rid === playerRoom || seen.has(rid)) continue;
        const room = world.roomById(rid);
        if (!room || !room.lightOn || room.lightBroken) continue;
        seen.add(rid);
        const a = baseAlpha * clamp(1 - distToDoor / RANGE, 0.2, 1);
        this.paintPeripheralRoom(ctx, game, room, a);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  paintPeripheralRoom(ctx, game, room, alpha) {
    const t = game.time;
    const { world, player } = game;
    // мерцание: свет комнаты «дышит», иногда проседает как при активности
    const flick = 0.7 + Math.sin(t * 8 + room.id) * 0.12 + (Math.random() < 0.04 ? -0.45 : 0);
    ctx.save();
    ctx.beginPath();
    for (const r of room.rects) ctx.rect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    ctx.clip();

    // общий мутный тёплый свет комнаты
    ctx.fillStyle = `rgba(150,138,110,${clamp(alpha * flick, 0, 1)})`;
    for (const r of room.rects) ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);

    // крупные тёмные контуры мебели
    ctx.fillStyle = `rgba(10,10,14,${alpha * 1.3})`;
    for (const c of world.colliders[room.floor] || []) {
      if (world.roomAt(room.floor, c.x + c.w / 2, c.y + c.h / 2) !== room.id) continue;
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }

    // движущиеся предметы — заметны как светлые мазки
    for (const p of world.props) {
      if (p.floor !== room.floor) continue;
      if (world.roomAt(p.floor, p.x, p.y) !== room.id) continue;
      const moving = (game.time - (p.thrownAt || -9)) < 1.6 || p.z > 3 || Math.abs(p.vx) + Math.abs(p.vy) > 8;
      if (!moving) continue;
      ctx.fillStyle = `rgba(210,205,190,${alpha * 1.8})`;
      ctx.beginPath(); ctx.arc(p.x, p.y - p.z, 3.5, 0, 7); ctx.fill();
    }

    // помехи телевизора в освещённой гостиной
    if (world.tv && world.tv.floor === room.floor && game.tvStaticT > 0 &&
      world.roomAt(world.tv.floor, world.tv.x, world.tv.y) === room.id) {
      ctx.fillStyle = `rgba(160,190,220,${alpha * 2 * Math.random()})`;
      ctx.fillRect(world.tv.x - 30, world.tv.y - 6, 60, 10);
    }

    // страницы книги шевельнулись (сам факт записи засчитывается только вблизи)
    for (const pl of world.placed) {
      if (pl.type !== 'book' || pl.floor !== room.floor || !(pl.stir > 0)) continue;
      ctx.fillStyle = `rgba(220,214,196,${alpha * 1.4 * (0.5 + Math.random() * 0.5)})`;
      ctx.fillRect(pl.x - 6, pl.y - 4, 12, 8);
    }

    // силуэт призрака — редко и мутно
    const gh = game.ghost;
    if (gh && gh.floor === room.floor && world.roomAt(gh.floor, gh.x, gh.y) === room.id) {
      if (gh.state === 'hunt' || gh.visibleAlpha > 0.1 || Math.random() < 0.03) {
        ctx.fillStyle = `rgba(6,6,12,${alpha * 2})`;
        ctx.beginPath(); ctx.ellipse(gh.x, gh.y - 6, 8, 16, 0, 0, 7); ctx.fill();
      }
    }

    // при низком рассудке — ложное движение/тень: игрок не уверен, реально ли
    if (player.sanity < 35 && Math.random() < 0.02) {
      const r = room.rects[0];
      const fx = (r.x + 0.5 + Math.random() * (r.w - 1)) * TILE;
      const fy = (r.y + 0.5 + Math.random() * (r.h - 1)) * TILE;
      ctx.fillStyle = `rgba(4,4,9,${alpha * 1.6})`;
      ctx.beginPath(); ctx.ellipse(fx, fy - 4, 6, 13, 0, 0, 7); ctx.fill();
    }

    // тревожное затемнение/зерно поверх слоя
    ctx.fillStyle = `rgba(0,0,10,${alpha * 0.6})`;
    for (const r of room.rects) ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    ctx.restore();
  }

  drawCursed(ctx, cu, t) {
    ctx.save();
    ctx.translate(cu.x, cu.y);
    // зловещее красное свечение, пока предмет не использован
    if (!cu.used) {
      const p = 0.5 + Math.sin(t * 2.2) * 0.25;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
      g.addColorStop(0, `rgba(160,30,30,${0.25 * p})`);
      g.addColorStop(1, 'rgba(160,30,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(1, 2, 8, 5, 0, 0, 7); ctx.fill();
    if (cu.type === 'musicbox') {
      ctx.fillStyle = '#4a3320';
      ctx.fillRect(-7, -5, 14, 10);
      ctx.fillStyle = '#5f452b';
      ctx.fillRect(-6, -4, 12, 8);
      ctx.fillStyle = '#c8b060';
      ctx.fillRect(6.5, -1.2, 3, 2.4); // ручка
      if (cu.activeT > 0) { // открытая крышка + балерина
        ctx.fillStyle = '#3a2818';
        ctx.fillRect(-7, -9, 14, 4);
        ctx.fillStyle = '#d8ccb8';
        ctx.beginPath(); ctx.arc(0, -3, 1.6, 0, 7); ctx.fill();
      }
    } else if (cu.type === 'mirror') {
      ctx.strokeStyle = '#6a5a34';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -3, 6, 8.5, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = cu.used ? '#20262c' : '#39434e';
      ctx.beginPath(); ctx.ellipse(0, -3, 5, 7.5, 0, 0, 7); ctx.fill();
      if (cu.used) { // трещины
        ctx.strokeStyle = 'rgba(200,210,220,.5)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-3, -7); ctx.lineTo(1, -2); ctx.lineTo(-2, 2);
        ctx.moveTo(3, -6); ctx.lineTo(0, -2); ctx.lineTo(3, 1);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(220,230,240,.25)';
        ctx.beginPath(); ctx.ellipse(-1.5, -5.5, 1.4, 3, 0.5, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = '#4a3d24';
      ctx.beginPath(); ctx.moveTo(0, 5.5); ctx.lineTo(0, 8); ctx.moveTo(-3.5, 8.5); ctx.lineTo(3.5, 8.5); ctx.stroke();
    } else { // кукла
      ctx.fillStyle = '#d3c3ac';
      ctx.beginPath(); ctx.arc(0, -4.5, 3.1, 0, 7); ctx.fill(); // голова
      ctx.fillStyle = '#6a3a3a';
      ctx.beginPath(); ctx.moveTo(-3, -2); ctx.lineTo(3, -2); ctx.lineTo(4.4, 5); ctx.lineTo(-4.4, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d3c3ac';
      ctx.fillRect(-5, -1.5, 1.8, 4.5); ctx.fillRect(3.2, -1.5, 1.8, 4.5);
      ctx.fillStyle = '#1a1216';
      ctx.fillRect(-1.6, -5.4, 1, 1); ctx.fillRect(0.7, -5.4, 1, 1); // глаза-бусины
      ctx.fillStyle = '#3a2c1c';
      ctx.beginPath(); ctx.arc(0, -6.8, 2.6, Math.PI, 0); ctx.fill(); // волосы
    }
    ctx.restore();
  }

  drawDoor(ctx, d) {
    const x = d.tx * TILE, y = d.ty * TILE;
    const th = d.isFront ? 7 : 5;
    ctx.save();
    if (d.orient === 'h') {
      // петля слева, закрытая — горизонтально
      ctx.translate(x, y + TILE / 2);
      ctx.rotate(-d.swing * Math.PI * 0.45);
      ctx.translate(0, -th / 2);
    } else {
      ctx.translate(x + TILE / 2, y);
      ctx.rotate(Math.PI / 2 + d.swing * Math.PI * 0.45);
      ctx.translate(0, -th / 2);
    }
    const g = ctx.createLinearGradient(0, 0, TILE, 0);
    if (d.isFront) { g.addColorStop(0, '#4a2e1a'); g.addColorStop(1, '#33200f'); }
    else { g.addColorStop(0, '#584225'); g.addColorStop(1, '#3d2d17'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TILE, th);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, TILE, 1.5);
    ctx.fillStyle = '#c8b98a';
    ctx.beginPath(); ctx.arc(TILE - 6, th / 2, 1.8, 0, 7); ctx.fill();
    ctx.restore();
  }

  // ---------- Ночной монитор фургона ----------
  renderMonitor(game) {
    const cv = this.monitor;
    const c = cv.getContext('2d');
    const cams = game.world.placed.filter(p => p.type === 'camera');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#020604';
    c.fillRect(0, 0, cv.width, cv.height);
    if (!cams.length) {
      c.fillStyle = '#1c5a34';
      c.font = '14px monospace';
      c.textAlign = 'center';
      c.fillText('НЕТ СИГНАЛА — установите камеру', cv.width / 2, cv.height / 2);
      this.monitorNoiseFrame(c, cv, 0.25);
      return cv;
    }
    const cam = cams[game.vanCamIndex % cams.length];
    const viewW = TILE * 10, viewH = viewW * cv.height / cv.width;
    const sx = clamp(cam.x - viewW / 2, 0, this.static[cam.floor].width - viewW);
    const sy = clamp(cam.y - viewH / 2, 0, this.static[cam.floor].height - viewH);
    c.drawImage(this.static[cam.floor], sx, sy, viewW, viewH, 0, 0, cv.width, cv.height);
    const k = cv.width / viewW;
    c.save();
    c.setTransform(k, 0, 0, k, -sx * k, -sy * k);
    // мебель (подвижная), двери и пропсы в кадре
    this.drawMovableFurniture(c, game.world, cam.floor, game.time);
    for (const d of game.world.doors) if (d.floor === cam.floor) this.drawDoor(c, d);
    for (const p of game.world.props) if (p.floor === cam.floor) drawProp(c, p);
    // огоньки-орбы (только через камеру!)
    for (const o of game.world.orbs || []) {
      if (o.floor !== cam.floor) continue;
      const a = 0.35 + 0.3 * Math.sin(game.time * 2 + o.phase);
      c.fillStyle = `rgba(210,255,225,${a})`;
      c.beginPath(); c.arc(o.x, o.y, 2.2, 0, 7); c.fill();
      c.fillStyle = `rgba(210,255,225,${a * 0.3})`;
      c.beginPath(); c.arc(o.x, o.y, 5, 0, 7); c.fill();
    }
    // призрак в кадре
    const gh = game.ghost;
    if (gh && gh.floor === cam.floor && gh.visibleAlpha > 0.03) gh.draw(c, game.time, game);
    // игрок в кадре
    if (game.player.floor === cam.floor) game.player.draw(c, game.time, game);
    c.restore();

    // ночное зрение: зелёный градинг
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = '#2a5a38';
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'screen';
    c.fillStyle = 'rgba(30,90,50,.25)';
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'source-over';
    this.monitorNoiseFrame(c, cv, 0.1);
    // виньетка + инфо
    const vg = c.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.3, cv.width / 2, cv.height / 2, cv.height * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = vg; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#9fd8a0';
    c.font = '10px monospace';
    c.textAlign = 'left';
    const room = game.world.roomById(game.world.roomAt(cam.floor, cam.x, cam.y));
    c.fillText(`CAM ${game.vanCamIndex % cams.length + 1}/${cams.length} · ${room ? room.name : '—'}`, 6, 12);
    c.fillText('● REC', cv.width - 44, 12);
    return cv;
  }

  monitorNoiseFrame(c, cv, amt) {
    for (let i = 0; i < cv.width * cv.height * amt / 60; i++) {
      const v = Math.random() * 120 | 0;
      c.fillStyle = `rgba(${v},${v + 30},${v},${Math.random() * 0.5})`;
      c.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2, 1);
    }
    // строчные помехи
    c.fillStyle = 'rgba(120,200,140,.05)';
    for (let y = (performance.now() / 40) % 4; y < cv.height; y += 4) c.fillRect(0, y, cv.width, 1);
  }

  // джойстики (экранные координаты)
  drawSticks(ctx, input) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1;
    for (const key of ['move', 'aim']) {
      const s = input.sticks[key];
      if (!s) continue;
      const ox = s.ox * dpr, oy = s.oy * dpr, r = 52 * dpr;
      ctx.strokeStyle = 'rgba(180,200,215,.22)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(180,200,215,.3)';
      ctx.beginPath(); ctx.arc(ox + s.dx * dpr, oy + s.dy * dpr, 18 * dpr, 0, 7); ctx.fill();
    }
  }
}
