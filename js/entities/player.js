// Игрок: движение с коллизиями, инвентарь, рассудок, укрытия, отрисовка.

import { TILE, clamp, damp, angleDiff } from '../core/utils.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';

const RADIUS = 8.5;
const SPEED = 92;

export class Player {
  constructor(world) {
    this.world = world;
    this.x = world.spawn.x; this.y = world.spawn.y;
    this.floor = 0;
    this.angle = 0;
    this.vx = 0; this.vy = 0;
    this.sanity = 100;
    this.inventory = ['emf', 'spirit', 'thermo']; // заменяется в фургоне
    this.activeSlot = 0;
    this.flashlightOn = true;
    this.hidden = null;      // ссылка на укрытие
    this.alive = true;
    this.walkPhase = 0;
    this.stepT = 0;
    this.breathT = 2;
    this.noise = 0;          // слышимость для призрака
    this.stairsCooldown = 0;
    this.usedPills = 0;
  }

  currentItem() { return this.inventory[this.activeSlot]; }

  update(dt, game) {
    if (!this.alive) return;
    this.noise = Math.max(0, this.noise - dt * 1.6);
    this.stairsCooldown = Math.max(0, this.stairsCooldown - dt);

    if (this.hidden) { this.vx = 0; this.vy = 0; return; }

    let mx = input.moveX, my = input.moveY;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    const sp = SPEED * (game.ghost?.state === 'hunt' ? 1.0 : 1.0);
    this.vx = mx * sp; this.vy = my * sp;

    // направление взгляда
    let target = this.angle;
    if (input.aimActive || (input.hasAim && !input.moving)) target = input.aimAngle;
    else if (input.moving) target = Math.atan2(my, mx);
    else if (input.hasAim) target = input.aimAngle;
    const diff = angleDiff(this.angle, target);
    this.angle += diff * Math.min(1, dt * 14);

    // движение с коллизиями (по осям)
    if (this.vx) this.tryMove(this.vx * dt, 0);
    if (this.vy) this.tryMove(0, this.vy * dt);

    // шаги
    const moving = mag > 0.15;
    if (moving) {
      this.walkPhase += dt * 9 * mag;
      this.stepT -= dt * mag;
      if (this.stepT <= 0) {
        this.stepT = 0.42;
        const outdoors = !this.world.isIndoors(this.floor, this.x, this.y);
        audio.footstep(outdoors);
        this.noise = 1;
        this.checkSalt(game);
      }
    } else this.walkPhase = 0;

    // лестницы
    if (this.stairsCooldown <= 0) {
      for (const st of this.world.stairs) {
        if (st.floor !== this.floor) continue;
        const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
        const tr = st.trigger;
        if (tx >= tr.x && tx < tr.x + tr.w && ty >= tr.y && ty < tr.y + tr.h) {
          game.changeFloor(this, st.target);
          this.stairsCooldown = 1.2;
          break;
        }
      }
    }

    // дыхание на холоде
    const room = this.world.roomById(this.world.roomAt(this.floor, this.x, this.y));
    if (room && room.temp < 8) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 2.4 + Math.random() * 1.6;
        game.fx.breath(this.x, this.y, this.angle, this.floor);
      }
    }
  }

  tryMove(dx, dy) {
    const nx = this.x + dx, ny = this.y + dy;
    if (!this.collides(nx, ny)) { this.x = nx; this.y = ny; return; }
    // подскальзывание по краям
    if (dx && !this.collides(nx, this.y)) { this.x = nx; return; }
    if (dy && !this.collides(this.x, ny)) { this.y = ny; return; }
  }

  collides(x, y) {
    const w = this.world;
    const minTx = Math.floor((x - RADIUS) / TILE), maxTx = Math.floor((x + RADIUS) / TILE);
    const minTy = Math.floor((y - RADIUS) / TILE), maxTy = Math.floor((y + RADIUS) / TILE);
    for (let ty = minTy; ty <= maxTy; ty++)
      for (let tx = minTx; tx <= maxTx; tx++)
        if (w.isBlocked(this.floor, tx, ty)) {
          // точная проверка круг-тайл
          const cx = clamp(x, tx * TILE, tx * TILE + TILE);
          const cy = clamp(y, ty * TILE, ty * TILE + TILE);
          if ((cx - x) ** 2 + (cy - y) ** 2 < RADIUS * RADIUS) return true;
        }
    for (const r of w.colliders[this.floor] || []) {
      const cx = clamp(x, r.x, r.x + r.w);
      const cy = clamp(y, r.y, r.y + r.h);
      if ((cx - x) ** 2 + (cy - y) ** 2 < RADIUS * RADIUS) return true;
    }
    return false;
  }

  checkSalt(game) {
    for (const s of this.world.saltPiles) {
      if (s.floor !== this.floor || s.disturbed) continue;
      if (Math.hypot(s.x - this.x, s.y - this.y) < 12) {
        s.disturbed = true;
        s.steps = [];
      }
    }
  }

  // дренаж рассудка (вызывается из sanity-системы)
  drainSanity(amount) {
    this.sanity = clamp(this.sanity - amount, 0, 100);
  }

  draw(ctx, t, game) {
    if (this.hidden) return;
    const { x, y, angle } = this;
    ctx.save();
    // тень
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 10, 7, 0, 0, 7); ctx.fill();

    if (!this.alive) {
      // тело
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = '#2a333a';
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a423a';
      ctx.beginPath(); ctx.arc(10, 0, 5, 0, 7); ctx.fill();
      ctx.restore();
      return;
    }

    // ноги (шаг)
    const st = Math.sin(this.walkPhase) * 5;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = '#1e262c';
    ctx.beginPath(); ctx.ellipse(st * 0.6, -4.5, 3.4, 2.6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-st * 0.6, 4.5, 3.4, 2.6, 0, 0, 7); ctx.fill();

    // руки с предметом впереди
    ctx.fillStyle = '#33424c';
    ctx.beginPath(); ctx.ellipse(8, -4, 3, 2.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, 4, 3, 2.4, 0, 0, 7); ctx.fill();
    // предмет в руках
    const item = this.currentItem();
    const ITEM_COLOR = {
      emf: '#c8842e', spirit: '#4a7a9a', thermo: '#b0b8bc', uv: '#6a4a9a',
      camera: '#3a4a3a', book: '#8a7a5a', dots: '#3a8a5a', crucifix: '#b09a5a',
      smudge: '#7a6a4a', salt: '#d8dade', pills: '#d0d4d8',
    };
    if (item && ITEM_COLOR[item]) {
      ctx.fillStyle = ITEM_COLOR[item];
      ctx.fillRect(9, -2.6, 6.5, 5.2);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.fillRect(9, -2.6, 6.5, 1.4);
    }

    // торс (куртка)
    const g = ctx.createLinearGradient(0, -9, 0, 9);
    g.addColorStop(0, '#3e5160'); g.addColorStop(1, '#273540');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 9.5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1;
    ctx.stroke();

    // голова
    ctx.fillStyle = '#2c231a';
    ctx.beginPath(); ctx.arc(1.5, 0, 5.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#8a705c'; // лицо-«полумесяц» в направлении взгляда
    ctx.beginPath(); ctx.arc(3.4, 0, 3.1, -1.2, 1.2); ctx.fill();

    // налобный фонарик
    if (this.flashlightOn) {
      ctx.fillStyle = '#e8e2c8';
      ctx.beginPath(); ctx.arc(6, 0, 1.6, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }
}
