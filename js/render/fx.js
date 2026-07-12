// Пост-эффекты и частицы: виньетка, киношное зерно, пыль, пар дыхания,
// шлейф призрака, вспышки.

import { TILE, makeCanvas, rndRange, clamp } from '../core/utils.js';

export class FX {
  constructor() {
    this.vignette = null;
    this.grainTiles = [];
    this.particles = [];
    this.makeGrain();
    this.flash = 0;     // белая вспышка (скример)
    this.lightning = 0; // вспышка молнии 0..1
    this.fireflies = null; // светлячки во дворе (ленивая инициализация)
    this.fog = null;       // клочья приземного тумана
    this.nightDim = 1;     // 1 — светлячки горят, 0 — погасли (охота/гром)
  }

  resize(w, h) {
    this.vignette = makeCanvas(w, h);
    const c = this.vignette.getContext('2d');
    const r = Math.hypot(w, h) / 2;
    const g = c.createRadialGradient(w / 2, h / 2, r * 0.32, w / 2, h / 2, r * 1.02);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0.92)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  makeGrain() {
    for (let i = 0; i < 4; i++) {
      const t = makeCanvas(160, 160);
      const c = t.getContext('2d');
      const img = c.createImageData(160, 160);
      for (let p = 0; p < img.data.length; p += 4) {
        const v = Math.random() * 255 | 0;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
        img.data[p + 3] = 22;
      }
      c.putImageData(img, 0, 0);
      this.grainTiles.push(t);
    }
  }

  // ---- частицы ----
  spawn(type, x, y, floor, opts = {}) {
    this.particles.push({
      type, x, y, floor,
      vx: opts.vx ?? rndRange(-6, 6), vy: opts.vy ?? rndRange(-6, 6),
      life: opts.life ?? 1, maxLife: opts.life ?? 1,
      size: opts.size ?? rndRange(1.5, 3.5),
    });
  }

  breath(x, y, angle, floor) {
    for (let i = 0; i < 5; i++) {
      this.spawn('breath', x + Math.cos(angle) * 8, y + Math.sin(angle) * 8, floor, {
        vx: Math.cos(angle) * rndRange(6, 14) + rndRange(-3, 3),
        vy: Math.sin(angle) * rndRange(6, 14) + rndRange(-3, 3),
        life: rndRange(0.8, 1.4), size: rndRange(2, 4),
      });
    }
  }

  ghostTrail(x, y, floor) {
    this.spawn('ghost', x + rndRange(-8, 8), y + rndRange(-10, 4), floor, {
      vx: rndRange(-4, 4), vy: rndRange(-14, -4), life: rndRange(0.6, 1.3), size: rndRange(2, 5),
    });
  }

  dustBurst(x, y, floor) {
    for (let i = 0; i < 8; i++) this.spawn('dust', x, y, floor, {
      vx: rndRange(-26, 26), vy: rndRange(-26, 26), life: rndRange(0.3, 0.7), size: rndRange(1, 2.5),
    });
  }

  update(dt, game) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'breath') { p.vx *= 0.96; p.vy *= 0.96; p.size += dt * 3; }
      if (p.type === 'ghost') p.vy -= dt * 6;
    }
    // фоновая пыль в конусе фонарика
    const pl = game.player;
    if (pl.flashlightOn && !pl.hidden && Math.random() < dt * 14) {
      const d = rndRange(TILE, TILE * 5);
      const a = pl.angle + rndRange(-0.35, 0.35);
      this.spawn('dust', pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, pl.floor, {
        vx: rndRange(-4, 4), vy: rndRange(-4, 4), life: rndRange(1.2, 2.4), size: rndRange(0.7, 1.6),
      });
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.lightning > 0) {
      // молния гаснет рвано, с повторным подмигиванием
      this.lightning -= dt * (Math.random() < 0.2 ? 6 : 2.2);
      if (this.lightning < 0) this.lightning = 0;
    }
    this.updateYard(dt, game);
  }

  // Светлячки и приземный туман во дворе (только этаж 0). Светлячки гаснут все
  // разом во время охоты и на раскате молнии — двор замирает, и это жутко.
  updateYard(dt, game) {
    const world = game.world;
    if (!world || !world.exterior) return;
    // ленивая инициализация из позиций кустов/деревьев
    if (!this.fireflies) {
      this.fireflies = [];
      const anchors = [...world.exterior.bushes, ...world.exterior.trees].slice(0, 14);
      for (const b of anchors) {
        this.fireflies.push({
          hx: b.x, hy: b.y, x: b.x, y: b.y,
          phase: Math.random() * 6.28, hue: 60 + Math.random() * 40,
          rad: 14 + Math.random() * 22, sp: 0.4 + Math.random() * 0.5,
        });
      }
      this.fog = [];
      for (let i = 0; i < 8; i++) {
        this.fog.push({
          x: rndRange(2, 46) * TILE, y: rndRange(2, 32) * TILE,
          r: rndRange(TILE * 2.4, TILE * 4.2), vx: rndRange(-4, 4), vy: rndRange(-2, 2),
          a: rndRange(0.05, 0.12),
        });
      }
    }
    // цель яркости: гаснут при охоте/недавней молнии
    const hunt = game.ghost && game.ghost.state === 'hunt';
    const target = (hunt || this.lightning > 0.3) ? 0 : 1;
    this.nightDim += (target - this.nightDim) * Math.min(1, dt * (target < this.nightDim ? 4 : 0.6));
    const t = game.time;
    for (const f of this.fireflies) {
      f.x = f.hx + Math.cos(t * f.sp + f.phase) * f.rad;
      f.y = f.hy + Math.sin(t * f.sp * 1.3 + f.phase) * f.rad * 0.7;
    }
    for (const g of this.fog) {
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (g.x < 0 || g.x > 48 * TILE) g.vx *= -1;
      if (g.y < 0 || g.y > 34 * TILE) g.vy *= -1;
    }
  }

  // двор: туман и светлячки (в мировой трансформации, только этаж 0, снаружи)
  drawYard(ctx, game) {
    if (game.player.floor !== 0 || !this.fog) return;
    const t = game.time;
    // приземный туман — мягкие дрейфующие клочья
    for (const g of this.fog) {
      const grd = ctx.createRadialGradient(g.x, g.y, 1, g.x, g.y, g.r);
      grd.addColorStop(0, `rgba(150,160,170,${g.a})`);
      grd.addColorStop(1, 'rgba(150,160,170,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, g.r, g.r * 0.55, 0, 0, 7); ctx.fill();
    }
    // светлячки — мерцающие тёплые точки с ореолом
    for (const f of this.fireflies) {
      const pulse = (0.5 + Math.sin(t * 3 + f.phase) * 0.5) * this.nightDim;
      if (pulse < 0.03) continue;
      const grd = ctx.createRadialGradient(f.x, f.y, 0.5, f.x, f.y, 5);
      grd.addColorStop(0, `hsla(${f.hue},90%,70%,${0.5 * pulse})`);
      grd.addColorStop(1, `hsla(${f.hue},90%,60%,0)`);
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = `hsla(${f.hue},95%,82%,${0.9 * pulse})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, 1, 0, 7); ctx.fill();
    }
  }

  // мировые частицы (вызывается в трансформации камеры)
  drawWorld(ctx, floor) {
    for (const p of this.particles) {
      if (p.floor !== floor) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      if (p.type === 'breath') ctx.fillStyle = `rgba(190,210,225,${a * 0.16})`;
      else if (p.type === 'ghost') ctx.fillStyle = `rgba(160,190,220,${a * 0.3})`;
      else ctx.fillStyle = `rgba(200,200,190,${a * 0.25})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
  }

  // экранные эффекты (после света)
  drawScreen(ctx, w, h, game) {
    const pl = game.player;
    const outdoors = !game.world.isIndoors(pl.floor, pl.x, pl.y);

    // дождь (только под открытым небом)
    if (outdoors) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = 'rgba(170,195,220,0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 64; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const len = 9 + Math.random() * 13;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.25, y + len);
      }
      ctx.stroke();
      // редкие «отскоки» капель
      ctx.fillStyle = 'rgba(170,195,220,0.10)';
      for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.random() * w, Math.random() * h, 2.5, 1, 0, 0, 7);
        ctx.fill();
      }
    }
    // виньетка: сильнее при низком рассудке и охоте
    let vig = 0.55 + (1 - pl.sanity / 100) * 0.4;
    if (game.ghost && game.ghost.state === 'hunt') {
      vig += 0.18 + Math.sin(game.time * 6.2) * 0.1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp(vig, 0, 1.4) > 1 ? 1 : clamp(vig, 0, 1);
    ctx.drawImage(this.vignette, 0, 0, w, h);
    // второй проход виньетки при паническом состоянии
    if (vig > 1) {
      ctx.globalAlpha = clamp(vig - 1, 0, 0.6);
      ctx.drawImage(this.vignette, 0, 0, w, h);
    }
    ctx.globalAlpha = 1;

    // зерно
    const tile = this.grainTiles[(Math.random() * 4) | 0];
    const ox = Math.random() * 160, oy = Math.random() * 160;
    ctx.globalAlpha = 0.5;
    for (let y = -oy; y < h; y += 160)
      for (let x = -ox; x < w; x += 160)
        ctx.drawImage(tile, x, y);
    ctx.globalAlpha = 1;

    // холодный градинг
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(40,60,90,0.14)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // красный пульс охоты: цветной свет-акцент, тем сильнее, чем ближе призрак
    const gh = game.ghost;
    if (gh && gh.state === 'hunt' && gh.floor === pl.floor) {
      const d = Math.hypot(gh.x - pl.x, gh.y - pl.y);
      const near = clamp(1 - d / 420, 0, 1); // ~13 тайлов
      if (near > 0.01) {
        const pulse = 0.7 + Math.sin(game.time * 8) * 0.3;
        ctx.fillStyle = `rgba(120,6,6,${(0.05 + near * 0.16) * pulse})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // молния: холодная заливка экрана (в доме — слабее, сквозь окна)
    if (this.lightning > 0.02) {
      const k = outdoors ? 0.3 : 0.08;
      ctx.fillStyle = `rgba(190,205,235,${this.lightning * k})`;
      ctx.fillRect(0, 0, w, h);
    }

    // вспышка скримера
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(200,210,220,${this.flash})`;
      ctx.fillRect(0, 0, w, h);
    }

    // кинематографичная смерть: затемнение → лицо сущности → тьма
    if (game.state === 'death-anim') {
      const t = 3.4 - game.deathT;
      ctx.fillStyle = `rgba(0,0,0,${clamp(t * 1.5, 0, t > 2.55 ? 1 : 0.88)})`;
      ctx.fillRect(0, 0, w, h);
      if (game.deathFace > 0 && t < 2.55) this.drawDeathFace(ctx, w, h, clamp((t - 1.15) / 1.3, 0, 1));
    } else if (game.state === 'dead') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawDeathFace(ctx, w, h, k) {
    const scale = 0.72 + k * 1.0;
    const a = Math.min(1, k * 8);
    const jx = (Math.random() - 0.5) * 10, jy = (Math.random() - 0.5) * 10;
    ctx.save();
    ctx.translate(w / 2 + jx, h / 2 + jy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = a;
    const R = h * 0.34;
    // мертвенно-бледное лицо
    const fg = ctx.createRadialGradient(0, -R * 0.1, R * 0.18, 0, 0, R);
    fg.addColorStop(0, 'rgba(208,212,216,.96)');
    fg.addColorStop(0.7, 'rgba(150,158,165,.85)');
    fg.addColorStop(1, 'rgba(60,66,72,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.62, R * 0.88, 0, 0, 7); ctx.fill();
    // провалы глазниц
    for (const sx of [-1, 1]) {
      const eg = ctx.createRadialGradient(sx * R * 0.25, -R * 0.2, 1, sx * R * 0.25, -R * 0.2, R * 0.24);
      eg.addColorStop(0, 'rgba(2,2,4,1)');
      eg.addColorStop(0.7, 'rgba(4,4,8,.95)');
      eg.addColorStop(1, 'rgba(10,10,14,0)');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(sx * R * 0.25, -R * 0.2, R * 0.16, R * 0.21, sx * 0.2, 0, 7);
      ctx.fill();
    }
    // разинутый рот
    const mg = ctx.createRadialGradient(0, R * 0.38, 2, 0, R * 0.38, R * 0.32);
    mg.addColorStop(0, 'rgba(1,1,2,1)');
    mg.addColorStop(0.75, 'rgba(3,3,6,.95)');
    mg.addColorStop(1, 'rgba(8,8,12,0)');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.ellipse(0, R * 0.38, R * 0.17, R * 0.36 * (0.6 + k * 0.5), 0, 0, 7);
    ctx.fill();
    // тёмные потёки от глаз
    ctx.strokeStyle = 'rgba(20,22,28,.55)';
    ctx.lineWidth = R * 0.02;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * R * 0.25, -R * 0.02);
      ctx.quadraticCurveTo(sx * R * 0.28, R * 0.3, sx * R * 0.22, R * 0.55);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  clear() { this.particles.length = 0; this.flash = 0; this.lightning = 0; }
}
