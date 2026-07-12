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
    // виньетка: сильнее при низком рассудке и охоте; в доме «дышит»
    let vig = 0.55 + (1 - pl.sanity / 100) * 0.4;
    if (game.ghost && game.ghost.state === 'hunt') {
      vig += 0.18 + Math.sin(game.time * 6.2) * 0.1;
    }
    if (!outdoors) vig += Math.sin(game.time * 1.25) * 0.05; // медленное «дыхание» дома
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp(vig, 0, 1.4) > 1 ? 1 : clamp(vig, 0, 1);
    ctx.drawImage(this.vignette, 0, 0, w, h);
    // второй проход виньетки при паническом состоянии
    if (vig > 1) {
      ctx.globalAlpha = clamp(vig - 1, 0, 0.6);
      ctx.drawImage(this.vignette, 0, 0, w, h);
    }
    ctx.globalAlpha = 1;

    // зерно (грубее при низком рассудке)
    const tile = this.grainTiles[(Math.random() * 4) | 0];
    const ox = Math.random() * 160, oy = Math.random() * 160;
    ctx.globalAlpha = pl.sanity < 30 ? 0.72 : 0.5;
    for (let y = -oy; y < h; y += 160)
      for (let x = -ox; x < w; x += 160)
        ctx.drawImage(tile, x, y);
    ctx.globalAlpha = 1;

    // пульс сердца по краям экрана при низком рассудке / близкой охоте
    let heart = 0;
    const ghH = game.ghost;
    if (ghH && ghH.state === 'hunt' && ghH.floor === pl.floor) {
      heart = clamp(1 - Math.hypot(ghH.x - pl.x, ghH.y - pl.y) / (TILE * 14), 0.3, 1);
    } else if (pl.sanity < 28) heart = (28 - pl.sanity) / 28 * 0.6;
    if (heart > 0.05) {
      const beat = Math.max(0, Math.sin(game.time * (3.2 + heart * 2.4)));
      const rr = Math.hypot(w, h) / 2;
      const rg = ctx.createRadialGradient(w / 2, h / 2, rr * 0.45, w / 2, h / 2, rr);
      rg.addColorStop(0, 'rgba(120,0,0,0)');
      rg.addColorStop(1, `rgba(120,0,0,${beat * heart * 0.5})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); // красная пульсация краёв в такт сердцу
    }

    // холодный градинг; при рассудке <20 сползает в болезненно-красный
    ctx.globalCompositeOperation = 'overlay';
    if (pl.sanity < 20) {
      const k = (20 - pl.sanity) / 20;
      ctx.fillStyle = `rgba(${40 + 70 * k},${60 - 40 * k},${90 - 60 * k},0.14)`;
    } else {
      ctx.fillStyle = 'rgba(40,60,90,0.14)';
    }
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
      if (game.deathFace > 0 && t < 2.55) {
        this.drawDeathFace(ctx, w, h, clamp((t - 1.15) / 1.3, 0, 1),
          game.deathVariant || 0, game.deathChoreo || 0, t);
      }
    } else if (game.state === 'dead') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Скример: 4 варианта лица × 3 хореографии наезда. variant по форме призрака,
  // choreo — как лицо надвигается (наезд / стробоскоп / вплытие с рывком).
  drawDeathFace(ctx, w, h, k, variant = 0, choreo = 0, t = 0) {
    let cx = w / 2, cy = h / 2, scale = 0.72 + k * 1.0, a = Math.min(1, k * 8);
    if (choreo === 1) {
      // стробоскоп: лицо скачет ступенями ближе, между «кадрами» гаснет
      const step = Math.floor(k * 4);
      scale = 0.6 + step * 0.32;
      const strobe = Math.sin(t * 34);
      a *= strobe > -0.2 ? 1 : 0.15;
    } else if (choreo === 2) {
      // вплывает с края и в конце делает рывок в лицо
      const side = (variant % 2) ? 1 : -1;
      cx = w / 2 + side * (1 - k) * w * 0.42;
      cy = h / 2 + (variant % 3 - 1) * (1 - k) * h * 0.18;
      scale = 0.6 + k * (k > 0.8 ? 1.6 : 0.9);
    }
    const jAmp = (choreo === 1 ? 6 : 10) * (0.5 + k);
    ctx.save();
    ctx.translate(cx + (Math.random() - 0.5) * jAmp, cy + (Math.random() - 0.5) * jAmp);
    ctx.scale(scale, scale);
    ctx.globalAlpha = a;
    const R = h * 0.34;

    if (variant === 2) this.faceShadow(ctx, R, k, t);
    else if (variant === 1) this.faceLady(ctx, R, k, t);
    else if (variant === 3) this.faceHangman(ctx, R, k, t);
    else this.faceGaunt(ctx, R, k, t);
    ctx.restore();
  }

  // базовое мертвенно-бледное лицо (общая заготовка)
  paleOval(ctx, R, tint = '208,212,216') {
    const fg = ctx.createRadialGradient(0, -R * 0.1, R * 0.18, 0, 0, R);
    fg.addColorStop(0, `rgba(${tint},.96)`);
    fg.addColorStop(0.7, 'rgba(150,158,165,.85)');
    fg.addColorStop(1, 'rgba(60,66,72,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.62, R * 0.88, 0, 0, 7); ctx.fill();
  }
  eyePit(ctx, x, y, rx, ry, rot = 0) {
    const eg = ctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry) * 1.5);
    eg.addColorStop(0, 'rgba(2,2,4,1)'); eg.addColorStop(0.7, 'rgba(4,4,8,.95)'); eg.addColorStop(1, 'rgba(10,10,14,0)');
    ctx.fillStyle = eg; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, 7); ctx.fill();
  }
  maw(ctx, x, y, rx, ry) {
    const mg = ctx.createRadialGradient(x, y, 2, x, y, Math.max(rx, ry) * 1.1);
    mg.addColorStop(0, 'rgba(1,1,2,1)'); mg.addColorStop(0.75, 'rgba(3,3,6,.95)'); mg.addColorStop(1, 'rgba(8,8,12,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill();
  }

  // v0 — исхудалое лицо: асимметрия глаз, наклон, зубы, потёки
  faceGaunt(ctx, R, k, t) {
    ctx.save(); ctx.rotate(Math.sin(t * 9) * 0.03);
    this.paleOval(ctx, R);
    this.eyePit(ctx, -R * 0.26, -R * 0.22, R * 0.17, R * 0.22, 0.25);
    this.eyePit(ctx, R * 0.24, -R * 0.18, R * 0.15, R * 0.19, -0.15);
    this.maw(ctx, 0, R * 0.38, R * 0.18, R * 0.36 * (0.6 + k * 0.5));
    ctx.fillStyle = 'rgba(200,205,208,.85)'; // зубы
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * R * 0.06 - R * 0.02, R * 0.22, R * 0.04, R * 0.07);
    ctx.strokeStyle = 'rgba(20,22,28,.55)'; ctx.lineWidth = R * 0.02;
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sx * R * 0.25, -R * 0.02);
      ctx.quadraticCurveTo(sx * R * 0.28, R * 0.3, sx * R * 0.22, R * 0.55); ctx.stroke();
    }
    ctx.restore();
  }

  // v1 — женщина: лицо за занавесом волос, один глаз, рот рвётся шире
  faceLady(ctx, R, k, t) {
    this.paleOval(ctx, R, '218,226,234');
    this.eyePit(ctx, -R * 0.24, -R * 0.16, R * 0.16, R * 0.2);
    this.maw(ctx, R * 0.02, R * 0.34, R * 0.14, R * 0.42 * (0.6 + k * 0.7)); // разрывается вниз
    // занавес мокрых волос поверх лица
    ctx.strokeStyle = 'rgba(18,20,28,.9)'; ctx.lineWidth = R * 0.05;
    for (let i = 0; i <= 12; i++) {
      const x = -R * 0.55 + i * (R * 1.1 / 12);
      ctx.beginPath(); ctx.moveTo(x, -R * 0.9);
      ctx.quadraticCurveTo(x + Math.sin(i + t * 2) * R * 0.05, R * 0.1, x + Math.sin(i * 2) * R * 0.08, R * 0.95);
      ctx.stroke();
    }
    // просвет для одного глаза
    this.eyePit(ctx, R * 0.22, -R * 0.14, R * 0.1, R * 0.13);
  }

  // v2 — тень: почти чёрное лицо, белые точки-глаза, зубчатый рот
  faceShadow(ctx, R, k, t) {
    const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
    g.addColorStop(0, 'rgba(8,8,14,.98)'); g.addColorStop(0.7, 'rgba(4,4,10,.95)'); g.addColorStop(1, 'rgba(4,4,10,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.66, R * 0.9, 0, 0, 7); ctx.fill();
    // белые горящие точки
    const eg = 0.7 + Math.sin(t * 6) * 0.3;
    ctx.fillStyle = `rgba(230,240,255,${eg})`;
    ctx.beginPath(); ctx.arc(-R * 0.24, -R * 0.16, R * 0.05, 0, 7); ctx.arc(R * 0.24, -R * 0.16, R * 0.05, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(230,240,255,${eg * 0.25})`;
    ctx.beginPath(); ctx.arc(-R * 0.24, -R * 0.16, R * 0.11, 0, 7); ctx.arc(R * 0.24, -R * 0.16, R * 0.11, 0, 7); ctx.fill();
    // зубчатый провал рта
    ctx.fillStyle = 'rgba(0,0,0,.95)';
    ctx.beginPath(); ctx.moveTo(-R * 0.22, R * 0.28);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-R * 0.22 + i * (R * 0.44 / 8), R * 0.28 + (i % 2 ? R * 0.16 : 0) + k * R * 0.14);
    ctx.lineTo(R * 0.22, R * 0.28); ctx.closePath(); ctx.fill();
  }

  // v3 — повешенный: запрокинутая голова, петля на шее, выпученные глаза
  faceHangman(ctx, R, k, t) {
    ctx.save(); ctx.rotate(0.18 + Math.sin(t * 4) * 0.03); // запрокинута
    this.paleOval(ctx, R, '196,204,210');
    // выпученные глаза (выпуклые, не провалы)
    ctx.fillStyle = 'rgba(214,216,220,.95)';
    ctx.beginPath(); ctx.ellipse(-R * 0.24, -R * 0.14, R * 0.13, R * 0.15, 0, 0, 7); ctx.ellipse(R * 0.26, -R * 0.12, R * 0.13, R * 0.15, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(80,20,20,.9)';
    ctx.beginPath(); ctx.arc(-R * 0.24, -R * 0.14, R * 0.06, 0, 7); ctx.arc(R * 0.26, -R * 0.12, R * 0.06, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(4,4,6,1)';
    ctx.beginPath(); ctx.arc(-R * 0.24, -R * 0.14, R * 0.028, 0, 7); ctx.arc(R * 0.26, -R * 0.12, R * 0.028, 0, 7); ctx.fill();
    // высунутый язык во рту
    this.maw(ctx, 0, R * 0.4, R * 0.15, R * 0.28 * (0.7 + k * 0.4));
    ctx.fillStyle = 'rgba(120,40,44,.8)';
    ctx.beginPath(); ctx.ellipse(0, R * 0.5, R * 0.07, R * 0.13, 0, 0, 7); ctx.fill();
    ctx.restore();
    // петля-верёвка через шею
    ctx.strokeStyle = 'rgba(60,48,30,.85)'; ctx.lineWidth = R * 0.06;
    ctx.beginPath(); ctx.arc(0, R * 0.78, R * 0.4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  clear() { this.particles.length = 0; this.flash = 0; this.lightning = 0; }
}
