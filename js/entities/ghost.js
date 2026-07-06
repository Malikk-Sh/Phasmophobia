// Призрак: ИИ (блуждание → взаимодействия → манифестации → охота),
// эмиссия улик, преследование, отрисовка обликов.

import { TILE, clamp, astar, hasLOS, rndRange, rndPick, angleTo } from '../core/utils.js';
import { audio } from '../core/audio.js';
import { GHOST_FORMS } from '../systems/ghostData.js';

const HUNT_KILL_DIST = 15;

export class Ghost {
  constructor(world, typeData, roomId) {
    this.world = world;
    this.data = typeData;
    this.tr = typeData.traits || {};
    this.roomId = roomId;                 // любимая комната
    const room = world.roomById(roomId);
    const r = room.rects[0];
    this.x = (r.x + r.w / 2) * TILE;
    this.y = (r.y + r.h / 2) * TILE;
    this.floor = room.floor;
    this.form = rndPick(GHOST_FORMS);

    this.state = 'idle';
    this.stateT = rndRange(4, 8);
    this.actionT = rndRange(5, 10);
    this.visibleAlpha = 0;
    this.targetAlpha = 0;

    this.path = null;
    this.pathI = 0;
    this.repathT = 0;
    this.moveTarget = null;

    this.huntCooldown = 12;
    this.huntT = 0;
    this.graceT = 0;
    this.lastKnown = null;
    this.losTime = 0;
    this.smudgedT = 0;
    this.dotsFlash = 0;
    this.eventCount = 0;
    this.activity = 0;      // 0..10 для датчика в фургоне
    this.sway = Math.random() * 10;
    this.speed = 40;
    this.huntBaseSpeed = 76;
  }

  get room() { return this.world.roomById(this.roomId); }

  // ---------- Обновление ----------
  update(dt, game) {
    this.stateT -= dt;
    this.actionT -= dt;
    this.huntCooldown -= dt;
    this.smudgedT = Math.max(0, this.smudgedT - dt);
    this.dotsFlash = Math.max(0, this.dotsFlash - dt);
    this.activity = Math.max(0, this.activity - dt * 0.35);
    this.sway += dt;

    // плавная видимость
    this.visibleAlpha += (this.targetAlpha - this.visibleAlpha) * Math.min(1, dt * 6);

    const pl = game.player;

    switch (this.state) {
      case 'idle':
        this.targetAlpha = 0;
        if (this.stateT <= 0) this.enterRoam(game);
        break;

      case 'roam':
        this.targetAlpha = 0;
        this.followPath(dt, 34 + game.aggression * 14);
        if (!this.path || this.pathI >= this.path.length) {
          this.state = 'idle';
          this.stateT = rndRange(2, 6 - game.aggression * 3);
        }
        break;

      case 'event': {
        this.targetAlpha = this.form === 'shadow' ? 0.55 : 0.8;
        // медленно плывёт к игроку
        if (pl.floor === this.floor && !pl.hidden) {
          const a = angleTo(this.x, this.y, pl.x, pl.y);
          this.x += Math.cos(a) * 14 * dt;
          this.y += Math.sin(a) * 14 * dt;
        }
        if (Math.random() < dt * 2) game.fx.ghostTrail(this.x, this.y, this.floor);
        // дренаж рассудка при взгляде
        if (this.seenByPlayer(pl)) {
          const mult = this.tr.gazeDrain || 1;
          pl.drainSanity(dt * 2.2 * mult * (this.tr.eventDrain || 1));
        }
        if (this.stateT <= 0) this.endEvent(game);
        break;
      }

      case 'hunt':
        this.updateHunt(dt, game);
        break;
    }

    // решение о действиях (кроме охоты/события)
    if ((this.state === 'idle' || this.state === 'roam') && this.actionT <= 0) {
      this.decideAction(game);
    }

    // тлеющий след манифестации
    if (this.state === 'hunt' && Math.random() < dt * 6) {
      game.fx.ghostTrail(this.x, this.y, this.floor);
    }
  }

  seenByPlayer(pl) {
    if (pl.floor !== this.floor || pl.hidden || this.visibleAlpha < 0.15) return false;
    const d = Math.hypot(pl.x - this.x, pl.y - this.y);
    if (d > TILE * 9) return false;
    return hasLOS(pl.x, pl.y, this.x, this.y, this.world.getOccluders(this.floor));
  }

  // ---------- Решения ----------
  decideAction(game) {
    const aggr = game.aggression; // 0..1 (растёт при падении рассудка)
    const shy = this.tr.shy;
    const pl = game.player;
    const playerNear = pl.floor === this.floor &&
      Math.hypot(pl.x - this.x, pl.y - this.y) < TILE * 7;

    this.actionT = rndRange(3.5, 9) * (shy ? 1.8 : 1) * (1 - aggr * 0.5);

    // Тень избегает активности рядом с игроком
    if (shy && playerNear && Math.random() < 0.7) return;

    const roll = Math.random();

    // попытка охоты (проверяется и здесь)
    if (game.canHunt() && this.tryStartHunt(game)) return;

    if (roll < 0.32) this.interactProp(game);
    else if (roll < 0.48) this.interactDoor(game);
    else if (roll < 0.58) this.interactSwitch(game);
    else if (roll < 0.62 && this.tr.breakerOff && this.world.breaker.on) this.turnOffBreaker(game);
    else if (roll < 0.72) this.tryWrite(game);
    else if (roll < 0.72 + 0.1 + aggr * 0.2) {
      if (!game.setupPhase && playerNear !== null) this.startEvent(game);
    } else if (this.tr.teleport && Math.random() < 0.25 && !game.setupPhase) {
      this.teleportNearPlayer(game);
    }
  }

  emitEMF(level, x = this.x, y = this.y) {
    // шанс ЭМП-5 как улика
    if (this.data.ev.includes('emf') && Math.random() < 0.3) level = 5;
    this.world.emfEvents.push({ x, y, floor: this.floor, level, until: performance.now() / 1000 + 22 });
    this.activity = Math.min(10, this.activity + level * 0.7);
  }

  leavePrint(x, y) {
    if (!this.data.ev.includes('uv')) return;
    if (Math.random() < 0.75) {
      this.world.prints.push({ x, y, floor: this.floor, rot: rndRange(0, 6.28), t: performance.now(), seen: false });
    }
  }

  interactProp(game) {
    const props = this.world.props.filter(p =>
      p.floor === this.floor && !p.held &&
      Math.hypot(p.x - this.x, p.y - this.y) < TILE * 6);
    if (!props.length) return;
    const throwOne = (p) => {
      const power = (this.tr.throwMult || 1) * rndRange(60, 140);
      const a = rndRange(0, 6.28);
      p.vx = Math.cos(a) * power;
      p.vy = Math.sin(a) * power;
      p.vz = rndRange(40, 90) * (this.tr.throwMult ? 1.4 : 1);
      p.z = Math.max(p.z, 2);
      p.thrownAt = game.time;
      audio.propWhoosh();
    };
    if (this.tr.multiThrow && Math.random() < 0.35) {
      for (const p of props.slice(0, 4)) throwOne(p);
      this.emitEMF(3);
      game.log('Полтергейст-всплеск!');
    } else {
      throwOne(rndPick(props));
      this.emitEMF(Math.random() < 0.5 ? 2 : 3);
    }
  }

  interactDoor(game) {
    const doors = this.world.doors.filter(d =>
      d.floor === this.floor && !d.isFront &&
      Math.hypot((d.tx + 0.5) * TILE - this.x, (d.ty + 0.5) * TILE - this.y) < TILE * 7);
    if (!doors.length) return;
    const d = rndPick(doors);
    const slam = this.tr.doorSlam && Math.random() < 0.6;
    d.open = slam ? false : !d.open;
    d.targetSwing = d.open ? 1 : 0;
    audio.doorCreak(slam);
    this.emitEMF(2, (d.tx + 0.5) * TILE, (d.ty + 0.5) * TILE);
    this.leavePrint((d.tx + 0.5) * TILE, (d.ty + 0.5) * TILE);
    if (slam) this.activity = Math.min(10, this.activity + 2);
  }

  interactSwitch(game) {
    const rooms = this.world.rooms.filter(r =>
      r.floor === this.floor && r.switch &&
      Math.hypot(r.switch.x - this.x, r.switch.y - this.y) < TILE * 8);
    if (!rooms.length) return;
    const r = rndPick(rooms);
    if (this.tr.lightsOff) r.lightOn = false;
    else r.lightOn = !r.lightOn;
    audio.switchClick();
    this.emitEMF(2, r.switch.x, r.switch.y);
    this.leavePrint(r.switch.x, r.switch.y);
  }

  turnOffBreaker(game) {
    this.world.breaker.on = false;
    audio.breakerOff();
    game.log('Электричество отключилось…');
    this.emitEMF(2, this.world.breaker.x, this.world.breaker.y);
    this.activity = Math.min(10, this.activity + 2);
  }

  tryWrite(game) {
    if (!this.data.ev.includes('writing')) return;
    const book = this.world.placed.find(p =>
      p.type === 'book' && !p.written && p.floor === this.floor &&
      Math.hypot(p.x - this.x, p.y - this.y) < TILE * 6);
    if (!book || Math.random() < 0.35) return;
    book.written = true;
    audio.writing();
    this.emitEMF(2, book.x, book.y);
    this.activity = Math.min(10, this.activity + 3);
  }

  teleportNearPlayer(game) {
    const pl = game.player;
    if (!this.world.isIndoors(pl.floor, pl.x, pl.y)) return;
    this.floor = pl.floor;
    const a = rndRange(0, 6.28);
    const nx = pl.x + Math.cos(a) * TILE * 3, ny = pl.y + Math.sin(a) * TILE * 3;
    if (this.world.isWalkableAI(this.floor, Math.floor(nx / TILE), Math.floor(ny / TILE))) {
      this.x = nx; this.y = ny;
      this.emitEMF(2);
      audio.whisper();
    }
  }

  startEvent(game) {
    this.state = 'event';
    this.stateT = rndRange(3, 6);
    this.eventCount++;
    this.path = null;
    audio.ghostEvent(this.form);
    game.player.drainSanity(rndRange(4, 8) * (this.tr.eventDrain || 1));
    this.activity = Math.min(10, this.activity + 4);
    if (this.tr.wail && Math.random() < 0.5) audio.bansheeWail();
  }

  endEvent(game) {
    this.targetAlpha = 0;
    // Онрё: каждое N-е событие — охота
    if (this.tr.eventHunt && this.eventCount % this.tr.eventHunt === 0 &&
      game.canHunt() && this.tryStartHunt(game, true)) return;
    this.state = 'idle';
    this.stateT = rndRange(3, 7);
  }

  // ---------- Охота ----------
  huntThreshold(game) {
    if (this.tr.darkHunt) {
      const room = this.world.roomById(this.world.roomAt(game.player.floor, game.player.x, game.player.y));
      const lit = room && room.lightOn && this.world.breaker.on;
      return lit ? this.tr.lightHunt : this.tr.darkHunt;
    }
    return this.tr.huntThreshold ?? 50;
  }

  tryStartHunt(game, force = false) {
    if ((this.huntCooldown > 0 && !force) || game.setupPhase) return false;
    const pl = game.player;
    if (!this.world.isIndoors(pl.floor, pl.x, pl.y)) return false; // на улице не охотится
    const th = this.huntThreshold(game);
    let ok = pl.sanity <= th;
    if (this.tr.randomHunt && Math.random() < 0.12) ok = true;
    if (force) ok = true;
    if (!ok) return false;
    if (Math.random() > 0.55 && !force) return false;

    // распятие
    for (const cr of this.world.placed) {
      if (cr.type !== 'crucifix' || cr.floor !== this.floor || cr.charges <= 0) continue;
      if (Math.hypot(cr.x - this.x, cr.y - this.y) < TILE * 3.2) {
        cr.charges--;
        cr.burnT = 1.5;
        audio.crucifixBurn();
        game.log('Распятие предотвратило охоту!');
        this.huntCooldown = 12;
        game.stats.crucifixSaves++;
        return false;
      }
    }

    this.state = 'hunt';
    this.huntT = rndRange(22, 32);
    this.graceT = 2.6;
    this.lastKnown = null;
    this.losTime = 0;
    this.path = null;
    this.flickerSeed = Math.random() * 100;
    game.onHuntStart();
    return true;
  }

  updateHunt(dt, game) {
    const pl = game.player;
    this.huntT -= dt;
    this.graceT -= dt;

    // мерцающая видимость
    const rate = this.tr.dimHunt ? 0.35 : 1;
    const fl = Math.sin(game.time * 13 + this.flickerSeed) + Math.sin(game.time * 7.7);
    this.targetAlpha = (fl > 0.4 ? 0.85 : 0.12) * rate;

    if (this.huntT <= 0) { this.endHunt(game); return; }
    if (this.smudgedT > 0) { // ослеплён благовониями
      this.followPath(dt, 30);
      return;
    }

    const sameFloor = pl.floor === this.floor;
    const occ = this.world.getOccluders(this.floor);
    let sees = false;
    if (sameFloor && !pl.hidden && pl.alive) {
      const d = Math.hypot(pl.x - this.x, pl.y - this.y);
      if (d < TILE * 11 && hasLOS(this.x, this.y, pl.x, pl.y, occ)) sees = true;
      // слух
      if (pl.noise > 0.4 && d < TILE * 9) this.lastKnown = { x: pl.x, y: pl.y };
    }
    // Банши идёт к жертве всегда
    if (this.tr.stalker && sameFloor && !pl.hidden) this.lastKnown = { x: pl.x, y: pl.y };

    let speed;
    if (this.tr.slowSpeed !== undefined) {
      speed = sees ? this.tr.fastSpeed : this.tr.slowSpeed;
    } else {
      speed = this.huntBaseSpeed;
      if (sees) {
        this.losTime += dt;
        speed += Math.min(30, this.losTime * 6);
        if (this.tr.jinnSpeed && this.world.breaker.on &&
          Math.hypot(pl.x - this.x, pl.y - this.y) > TILE * 3) speed = 120;
      } else this.losTime = Math.max(0, this.losTime - dt * 2);
    }

    if (sees) {
      this.lastKnown = { x: pl.x, y: pl.y };
      // прямое преследование
      const a = angleTo(this.x, this.y, pl.x, pl.y);
      const nx = this.x + Math.cos(a) * speed * dt;
      const ny = this.y + Math.sin(a) * speed * dt;
      this.moveWithCollision(nx, ny);
      this.path = null;
    } else if (this.lastKnown) {
      this.ensurePath(this.lastKnown.x, this.lastKnown.y, dt);
      this.followPath(dt, speed * 0.85);
      if (Math.hypot(this.lastKnown.x - this.x, this.lastKnown.y - this.y) < TILE * 0.7) this.lastKnown = null;
    } else {
      // случайное блуждание
      if (!this.path || this.pathI >= this.path.length) this.pickWanderTarget(true);
      this.followPath(dt, speed * 0.7);
    }

    // убийство
    if (sameFloor && pl.alive && !pl.hidden && this.graceT <= 0 &&
      Math.hypot(pl.x - this.x, pl.y - this.y) < HUNT_KILL_DIST) {
      game.killPlayer();
    }
    // обнаружение в укрытии в упор (если видел, как игрок прятался)
    if (sameFloor && pl.hidden && pl.hiddenSeen && this.graceT <= 0 &&
      Math.hypot(pl.hidden.x - this.x, pl.hidden.y - this.y) < TILE * 0.9) {
      pl.hidden = null;
    }
  }

  endHunt(game) {
    this.state = 'idle';
    this.stateT = rndRange(4, 8);
    this.targetAlpha = 0;
    this.huntCooldown = this.tr.huntCooldown ?? rndRange(22, 32);
    game.onHuntEnd();
  }

  smudge(game) {
    const mult = this.tr.smudgeMult || 1;
    this.smudgedT = 6 * mult;
    if (this.state === 'hunt') {
      if (this.tr.smudgeInstant || true) this.endHunt(game);
      this.huntCooldown = Math.max(this.huntCooldown, 8 * mult);
      game.stats.smudgeSaves++;
    }
    this.activity = Math.min(10, this.activity + 2);
  }

  // ---------- Навигация ----------
  pickWanderTarget(anyRoom = false) {
    const w = this.world;
    let room;
    if (!anyRoom && Math.random() < 0.6) room = this.room;
    else {
      const sameFloor = w.rooms.filter(r => r.floor === this.floor);
      room = rndPick(sameFloor);
    }
    const r = rndPick(room.rects);
    const tx = r.x + Math.floor(Math.random() * r.w);
    const ty = r.y + Math.floor(Math.random() * r.h);
    this.setPathTo(tx, ty);
  }

  enterRoam(game) {
    this.state = 'roam';
    // изредка меняет этаж (идёт к лестнице)
    if (Math.random() < 0.16) {
      const st = this.world.stairs.find(s => s.floor === this.floor);
      if (st) {
        this.setPathTo(st.trigger.x, st.trigger.y);
        this.pendingStairs = st;
        return;
      }
    }
    this.pendingStairs = null;
    this.pickWanderTarget();
  }

  setPathTo(tx, ty) {
    const w = this.world;
    const sx = Math.floor(this.x / TILE), sy = Math.floor(this.y / TILE);
    this.path = astar(sx, sy, tx, ty, (x, y) => w.isWalkableAI(this.floor, x, y));
    this.pathI = 1;
  }

  ensurePath(wx, wy, dt) {
    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path) {
      this.repathT = 0.5;
      this.setPathTo(Math.floor(wx / TILE), Math.floor(wy / TILE));
    }
  }

  followPath(dt, speed) {
    if (!this.path || this.pathI >= this.path.length) return;
    const n = this.path[this.pathI];
    const tx = (n.x + 0.5) * TILE, ty = (n.y + 0.5) * TILE;
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 4) {
      this.pathI++;
      // лестница
      if (this.pendingStairs && this.pathI >= this.path.length) {
        const st = this.pendingStairs;
        this.floor = st.target.floor;
        this.x = st.target.x; this.y = st.target.y;
        this.pendingStairs = null;
        this.path = null;
        this.pickWanderTarget();
      }
      return;
    }
    const a = angleTo(this.x, this.y, tx, ty);
    this.x += Math.cos(a) * Math.min(speed * dt, d);
    this.y += Math.sin(a) * Math.min(speed * dt, d);
  }

  moveWithCollision(nx, ny) {
    const w = this.world;
    // призрак не проходит сквозь стены (но игнорирует двери и мебель)
    const f = w.floors[this.floor];
    if (!f.isSolid(Math.floor(nx / TILE), Math.floor(this.y / TILE))) this.x = nx;
    if (!f.isSolid(Math.floor(this.x / TILE), Math.floor(ny / TILE))) this.y = ny;
  }

  // ---------- DOTS ----------
  checkDots(game) {
    if (!this.data.ev.includes('dots')) return;
    for (const d of this.world.placed) {
      if (d.type !== 'dots' || d.floor !== this.floor) continue;
      if (Math.hypot(d.x - this.x, d.y - this.y) < TILE * 2.6 && Math.random() < 0.006) {
        this.dotsFlash = 1.6;
        this.dotsFrom = { x: this.x, y: this.y };
        this.dotsVel = { x: rndRange(-40, 40), y: rndRange(-30, 30) };
      }
    }
  }

  // ---------- Отрисовка ----------
  draw(ctx, t, game) {
    // DOTS-силуэт
    if (this.dotsFlash > 0) {
      const a = Math.min(1, this.dotsFlash) * 0.8;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = `rgba(90,255,140,${a})`;
      for (let i = 0; i < 26; i++) {
        const px = Math.sin(i * 2.4 + t * 3) * 8;
        const py = -14 + i * 1.2 + Math.sin(i + t * 6) * 2;
        ctx.fillRect(px, py, 1.6, 1.6);
      }
      ctx.restore();
      if (game.player.floor === this.floor &&
        Math.hypot(game.player.x - this.x, game.player.y - this.y) < TILE * 5.5) {
        game.onEvidenceSeen?.('dots');
      }
    }

    const alpha = this.visibleAlpha;
    if (alpha < 0.02) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = alpha;
    const sway = Math.sin(this.sway * 1.7) * 2.4;

    if (this.form === 'shadow') {
      const g = ctx.createRadialGradient(0, -6, 2, 0, -4, 22);
      g.addColorStop(0, 'rgba(5,5,10,.95)');
      g.addColorStop(0.7, 'rgba(5,5,12,.75)');
      g.addColorStop(1, 'rgba(5,5,12,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(sway * 0.4, -4, 12, 20, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(2,2,6,.9)';
      ctx.beginPath(); ctx.arc(sway * 0.6, -14, 5.5, 0, 7); ctx.fill();
    } else if (this.form === 'lady') {
      // платье
      const g = ctx.createLinearGradient(0, -18, 0, 12);
      g.addColorStop(0, 'rgba(210,225,240,.85)');
      g.addColorStop(1, 'rgba(160,180,205,.05)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sway - 4, -14);
      ctx.quadraticCurveTo(-13 + sway, 2, -9, 12);
      ctx.quadraticCurveTo(0, 8, 9, 12);
      ctx.quadraticCurveTo(13 + sway, 2, sway + 4, -14);
      ctx.closePath(); ctx.fill();
      // голова и волосы
      ctx.fillStyle = 'rgba(225,235,245,.9)';
      ctx.beginPath(); ctx.arc(sway, -17, 5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(30,35,45,.85)';
      ctx.beginPath();
      ctx.ellipse(sway, -19, 6, 4.5, 0, Math.PI, 0);
      ctx.quadraticCurveTo(sway + 7, -10, sway + 4, -6);
      ctx.lineTo(sway - 4, -6);
      ctx.quadraticCurveTo(sway - 7, -10, sway - 6, -19);
      ctx.fill();
      // глаза-провалы
      ctx.fillStyle = 'rgba(10,10,16,.95)';
      ctx.beginPath(); ctx.arc(sway - 1.8, -17, 1, 0, 7); ctx.arc(sway + 1.8, -17, 1, 0, 7); ctx.fill();
    } else { // hangman
      ctx.strokeStyle = 'rgba(120,130,145,.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, -22); ctx.stroke(); // верёвка
      const g = ctx.createLinearGradient(0, -20, 0, 10);
      g.addColorStop(0, 'rgba(150,160,175,.8)');
      g.addColorStop(1, 'rgba(110,120,140,.05)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(sway * 0.4, -6, 8, 15, sway * 0.02, 0, 7); ctx.fill();
      // склонённая голова
      ctx.fillStyle = 'rgba(170,180,190,.85)';
      ctx.save();
      ctx.translate(sway * 0.5 + 2, -18);
      ctx.rotate(0.55 + sway * 0.01);
      ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 5.2, 0, 0, 7); ctx.fill();
      ctx.restore();
      // болтающиеся ноги
      ctx.strokeStyle = 'rgba(120,130,150,.5)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(-3 + sway * 0.5, 14);
      ctx.moveTo(3, 6); ctx.lineTo(3 + sway * 0.4, 14); ctx.stroke();
    }
    ctx.restore();
  }
}
