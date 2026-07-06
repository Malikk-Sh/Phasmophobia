// Рендерер: пререндер статики этажей + покадровая сцена + ночной монитор.

import { TILE, makeCanvas, makeRng, clamp } from '../core/utils.js';
import { FLOOR_BASEMENT, OUTSIDE } from '../world/house.js';
import { drawFurnitureItem, drawProp } from '../world/furniture.js';
import { drawPlaced } from '../systems/equipment.js';

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

    // подъездная дорожка к гаражу (запад)
    c.fillStyle = '#2e3034';
    c.fillRect(1.4 * TILE, 7.6 * TILE, 8.6 * TILE, 3.8 * TILE);
    for (let i = 0; i < 130; i++) {
      c.fillStyle = `rgba(${70 + rng() * 40 | 0},${72 + rng() * 40 | 0},${78 + rng() * 40 | 0},.25)`;
      c.fillRect(1.4 * TILE + rng() * 8.6 * TILE, 7.6 * TILE + rng() * 3.8 * TILE, 2, 2);
    }

    // дорожка от фургона к крыльцу
    for (let i = 0; i < 9; i++) {
      const x = (4.9 + i * 0.62) * TILE, y = 15.5 * TILE + Math.sin(i * 1.7) * 5;
      c.fillStyle = '#33373d';
      c.beginPath(); c.ellipse(x, y, 12, 9, rng() * 0.6, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.05)';
      c.beginPath(); c.ellipse(x - 2, y - 2, 8, 5, 0, 0, 7); c.fill();
    }

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

    // кусты
    for (const b of this.world.exterior.bushes) {
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.beginPath(); c.ellipse(b.x + 3, b.y + 4, b.r, b.r * 0.8, 0, 0, 7); c.fill();
      const grd = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      grd.addColorStop(0, '#2c3d26'); grd.addColorStop(1, '#172114');
      c.fillStyle = grd;
      c.beginPath(); c.ellipse(b.x, b.y, b.r, b.r * 0.85, 0, 0, 7); c.fill();
    }

    // мебель первого этажа
    for (const f of this.world.furniture[0]) drawFurnitureItem(c, f);

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
    // трубы вдоль стен котельной
    c.strokeStyle = '#3a3430'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(16.2 * TILE, 3.4 * TILE); c.lineTo(26.6 * TILE, 3.4 * TILE); c.stroke();
    c.strokeStyle = '#443c34'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(16.2 * TILE, 3.7 * TILE); c.lineTo(26.6 * TILE, 3.7 * TILE); c.stroke();
    for (const f of this.world.furniture[FLOOR_BASEMENT]) drawFurnitureItem(c, f);
    return cv;
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
    player.draw(ctx, t, game);

    // частицы мира
    game.fx.drawWorld(ctx, floor);

    // кроны деревьев поверх
    if (floor === 0) {
      for (const tr of world.exterior.trees) {
        const grd = ctx.createRadialGradient(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.15, tr.x, tr.y, tr.r);
        grd.addColorStop(0, 'rgba(34,48,30,.96)');
        grd.addColorStop(0.75, 'rgba(22,32,20,.95)');
        grd.addColorStop(1, 'rgba(12,18,12,.85)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        // неровная крона
        for (let i = 0; i <= 10; i++) {
          const a = i / 10 * Math.PI * 2;
          const rr = tr.r * (1 + 0.14 * Math.sin(a * 3 + tr.x));
          const px = tr.x + Math.cos(a) * rr, py = tr.y + Math.sin(a) * rr;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
    }
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
    // двери и пропсы в кадре
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
