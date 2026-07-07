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
    this.eventType = null;
    this.lastEventType = null;
    this.fakeHuntT = 0;
    this.lingerT = 0;
    this.huntPhase = null;   // warn → search → chase
    this.warnT = 0;
    this.searchTarget = null;
    this.loseLosT = 0;
    this.migrated = false;   // сменил ли любимую комнату (раз за контракт)
    this.memory = { hideSpot: null }; // память о прошлых охотах
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
    this.fakeHuntT = Math.max(0, this.fakeHuntT - dt);
    this.lingerT = Math.max(0, this.lingerT - dt);
    this.activity = Math.max(0, this.activity - dt * 0.35);
    this.sway += dt;

    // плавная видимость
    this.visibleAlpha += (this.targetAlpha - this.visibleAlpha) * Math.min(1, dt * 6);

    const pl = game.player;

    // мелодия проклятой шкатулки манит призрака
    if (this.cursedLure && this.updateCursedLure(dt, game)) return;

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
        const type = this.eventType || 'manifest';
        if (type === 'manifest') {
          this.targetAlpha = this.form === 'shadow' ? 0.55 : 0.8;
          // медленно плывёт к игроку
          if (pl.floor === this.floor && !pl.hidden) {
            const a = angleTo(this.x, this.y, pl.x, pl.y);
            this.x += Math.cos(a) * 14 * dt;
            this.y += Math.sin(a) * 14 * dt;
          }
          if (Math.random() < dt * 2) game.fx.ghostTrail(this.x, this.y, this.floor);
        } else if (type === 'silhouette') {
          // неподвижный силуэт: исчезает, если подойти или посветить в упор
          this.targetAlpha = 0.55;
          const d = Math.hypot(pl.x - this.x, pl.y - this.y);
          let lit = false;
          if (pl.flashlightOn && d < TILE * 3.6) {
            const da = Math.abs(((Math.atan2(this.y - pl.y, this.x - pl.x) - pl.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            lit = da < 0.3;
          }
          if (d < TILE * 1.6 || lit) {
            audio.whisper();
            game.fx.dustBurst(this.x, this.y, this.floor);
            this.endEvent(game);
            break;
          }
        } else if (type === 'propStorm') {
          this.targetAlpha = 0.15;
          this.stormT -= dt;
          if (this.stormT <= 0) {
            this.stormT = 0.35;
            this.interactProp(game);
            game.fx.dustBurst(this.x + rndRange(-30, 30), this.y + rndRange(-30, 30), this.floor);
          }
        } else if (type === 'doorFury') {
          this.targetAlpha = 0;
          this.furyT -= dt;
          if (this.furyT <= 0) {
            this.furyT = 0.8;
            const doors = this.world.doors.filter(d => d.floor === this.floor && !d.isFront);
            if (doors.length) {
              const d = rndPick(doors);
              d.open = !d.open;
              d.targetSwing = d.open ? 1 : 0;
              audio.doorCreak(true);
              this.emitEMF(2, (d.tx + 0.5) * TILE, (d.ty + 0.5) * TILE);
            }
          }
        } else {
          // lightsOut / knock / falseHunt — невидимые, чисто сенсорные
          this.targetAlpha = 0;
        }
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

  // идёт на мелодию шкатулки; дослушал рядом с жертвой — охота
  updateCursedLure(dt, game) {
    const l = this.cursedLure;
    l.t -= dt;
    if (this.state === 'hunt' || this.state === 'event') { this.cursedLure = null; return false; }
    this.state = 'roam';
    this.targetAlpha = 0.25; // полупроявлен, пока слушает зов
    let arrived = false;
    if (this.floor === l.floor) {
      arrived = Math.hypot(l.x - this.x, l.y - this.y) < TILE * 0.9;
      if (!arrived) { this.ensurePath(l.x, l.y, dt); this.followPath(dt, 72); }
    }
    if (l.t <= 0 || (arrived && l.t < 5.5)) {
      this.cursedLure = null;
      const pl = game.player;
      const near = pl.floor === this.floor && Math.hypot(pl.x - l.x, pl.y - l.y) < TILE * 3.5;
      if (near && !game.setupPhase) this.tryStartHunt(game, true);
      else { this.eventType = null; this.startEvent(game); }
      return false;
    }
    if (Math.random() < dt * 3) game.fx.ghostTrail(this.x, this.y, this.floor);
    return true;
  }

  seenByPlayer(pl) {
    if (pl.floor !== this.floor || pl.hidden || this.visibleAlpha < 0.15) return false;
    const d = Math.hypot(pl.x - this.x, pl.y - this.y);
    if (d > TILE * 9) return false;
    return hasLOS(pl.x, pl.y, this.x, this.y, this.world.getOccluders(this.floor));
  }

  // ---------- Решения ----------
  // Что делать — подсказывает режиссёр напряжения: в затишье дом молчит,
  // в предвестии слышны дальние звуки, в подозрении — возня рядом,
  // в проявлении — событие или охота, в разрядке — ничего.
  decideAction(game) {
    const dir = game.director;
    const shy = this.tr.shy;
    const pl = game.player;
    const playerNear = pl.floor === this.floor &&
      Math.hypot(pl.x - this.x, pl.y - this.y) < TILE * 7;

    const phase = (game.setupPhase || !dir) ? 'calm' : dir.phase;
    this.actionT = (phase === 'omen' || phase === 'reveal')
      ? rndRange(1.5, 3)
      : rndRange(3.5, 8) * (shy ? 1.8 : 1);

    // Тень избегает активности рядом с игроком
    if (shy && playerNear && Math.random() < 0.7) return;

    switch (phase) {
      case 'calm':
        // почти ничего: редкий дальний предмет, чтобы дом «дышал»
        if (Math.random() < 0.22 && dir?.allow('prop', 14, game)) {
          this.interactProp(game, { farFromPlayer: true });
          dir?.note('prop', game);
        }
        break;

      case 'omen': {
        // один предвестник — и снова тишина
        if (dir && !dir.allow('omen', 7, game)) break;
        const r = Math.random();
        if (r < 0.3 && dir.allow('door', 20, game)) {
          this.interactDoor(game);
          dir.note('door', game);
        } else if (r < 0.55 && dir.allow('switch', 18, game)) {
          this.interactSwitch(game);
          dir.note('switch', game);
        } else if (r < 0.65 && this.tr.breakerOff && this.world.breaker.on) {
          this.turnOffBreaker(game);
        } else {
          // стук откуда-то из дома
          const pan = Math.max(-0.8, Math.min(0.8, (this.x - pl.x) / (TILE * 10)));
          audio.knockRaps(pan);
          this.emitEMF(2);
        }
        dir.note('omen', game);
        break;
      }

      case 'suspicion': {
        // возня и слабые показания приборов рядом с игроком
        const r = Math.random();
        if (r < 0.4 && dir?.allow('prop', 10, game)) {
          this.interactProp(game);
          dir?.note('prop', game);
        } else if (r < 0.6) this.tryWrite(game);
        else if (r < 0.75 && dir?.allow('switch', 15, game)) {
          this.interactSwitch(game);
          dir?.note('switch', game);
        } else if (this.tr.teleport && Math.random() < 0.4) {
          this.teleportNearPlayer(game);
        } else this.emitEMF(2);
        break;
      }

      case 'reveal':
        // кульминация: охота либо событие
        if (game.canHunt() && this.tryStartHunt(game)) return;
        if (playerNear && dir?.allow('event', 22, game)) {
          this.startEvent(game);
          dir?.note('event', game);
        }
        break;

      default: // release — дом отдыхает
        break;
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

  interactProp(game, { farFromPlayer = false } = {}) {
    const pl = game.player;
    const props = this.world.props.filter(p =>
      p.floor === this.floor && !p.held &&
      Math.hypot(p.x - this.x, p.y - this.y) < TILE * 6 &&
      // в затишье призрак гремит вдали от игрока — звук «из другой части дома»
      (!farFromPlayer || pl.floor !== p.floor ||
        Math.hypot(p.x - pl.x, p.y - pl.y) > TILE * 6));
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
    const pl = game.player;
    // выбор типа события; у каждой сущности — свой почерк
    let type;
    const sig = Math.random();
    if (this.tr.lightsOff && sig < 0.45) type = 'lightsOut';           // Мара душит свет
    else if (this.tr.dimHunt && sig < 0.45) type = 'silhouette';       // Фантом — исчезающий силуэт
    else if (this.tr.multiThrow && sig < 0.5) type = 'propStorm';      // Полтергейст — вихрь вещей
    else if (this.tr.doorSlam && sig < 0.4) type = 'doorFury';         // Юрэй хлопает дверями
    else if (this.tr.wail && sig < 0.4) type = 'manifest';             // Банши выходит показаться
    else {
      const roll = Math.random();
      if (roll < 0.28) type = 'manifest';
      else if (roll < 0.48) type = 'silhouette';
      else if (roll < 0.62) type = 'lightsOut';
      else if (roll < 0.78) type = 'knock';
      else type = 'falseHunt';
    }
    // повторы скучны — не делать одно и то же дважды подряд
    if (type === this.lastEventType) type = 'manifest';
    this.lastEventType = type;
    this.eventType = type;

    this.state = 'event';
    this.eventCount++;
    this.path = null;
    this.activity = Math.min(10, this.activity + 4);

    if (type === 'manifest') {
      this.stateT = rndRange(3, 6);
      audio.ghostEvent(this.form);
      pl.drainSanity(rndRange(4, 8) * (this.tr.eventDrain || 1));
    } else if (type === 'silhouette') {
      // возникнуть в поле зрения на границе света и стоять неподвижно
      this.stateT = rndRange(4, 7);
      const a = pl.angle + rndRange(-0.9, 0.9);
      for (let r = 6; r >= 3; r--) {
        const nx = pl.x + Math.cos(a) * TILE * r, ny = pl.y + Math.sin(a) * TILE * r;
        if (this.world.isWalkableAI(pl.floor, Math.floor(nx / TILE), Math.floor(ny / TILE))) {
          this.floor = pl.floor; this.x = nx; this.y = ny;
          break;
        }
      }
      audio.whisper();
      pl.drainSanity(rndRange(2, 5));
    } else if (type === 'lightsOut') {
      // погасить свет в комнате игрока (и в своей)
      this.stateT = 1.2;
      const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
      if (room) room.lightOn = false;
      this.room.lightOn = false;
      audio.switchClick();
      audio.ghostEvent('shadow');
      pl.drainSanity(rndRange(2, 4));
    } else if (type === 'knock') {
      // стук со стороны призрака — игрок только слышит
      this.stateT = 2.2;
      const pan = Math.max(-0.8, Math.min(0.8, (this.x - pl.x) / (TILE * 10)));
      audio.knockRaps(pan);
      this.emitEMF(2);
    } else if (type === 'propStorm') {
      // вихрь предметов вокруг призрака (почерк Полтергейста)
      this.stateT = rndRange(2.2, 3.2);
      this.stormT = 0;
      audio.ghostEvent('shadow');
      pl.drainSanity(rndRange(3, 6));
    } else if (type === 'doorFury') {
      // яростные хлопки дверями (почерк Юрэя)
      this.stateT = 2.4;
      this.furyT = 0;
      pl.drainSanity(rndRange(2, 5));
    } else { // falseHunt — обманка: электроника сходит с ума, но охоты нет
      this.stateT = rndRange(2.5, 3.5);
      this.fakeHuntT = this.stateT;
      audio.falseHuntCue();
      pl.drainSanity(rndRange(1, 3));
    }
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
    // режиссёр: охота — кульминация, не случайный бросок посреди затишья
    // (Демон со своей случайной охотой — исключение)
    const dir = game.director;
    if (!force && dir && dir.phase !== 'reveal' && dir.score < 0.75 && !this.tr.randomHunt) return false;
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
    // фаза 1 — «предупреждение»: электроника сходит с ума, призрак ещё не идёт.
    // Длится по-разному у разных сущностей (скрытая характеристика).
    this.huntPhase = 'warn';
    this.warnT = this.tr.warnTime ?? rndRange(1.6, 3.2);
    this.huntT += this.warnT;
    this.lastKnown = null;
    this.searchTarget = null;
    this.loseLosT = 0;
    this.losTime = 0;
    this.path = null;
    this.flickerSeed = Math.random() * 100;
    game.onHuntStart();
    return true;
  }

  // фаза 2 — «поиск»: с чего начать? Призрак помнит прошлые охоты:
  // укрытие, где жертва пряталась, и комнату, где она проводит время.
  pickSearchTarget(game) {
    const r = Math.random();
    const mem = this.memory;
    if (mem.hideSpot && mem.hideSpot.floor === this.floor && r < 0.4) {
      return { tx: Math.floor(mem.hideSpot.x / TILE), ty: Math.floor(mem.hideSpot.y / TILE) };
    }
    if (game.director && r < 0.7) {
      const rid = game.director.mostVisitedRoom(this.world, this.floor);
      const room = this.world.roomById(rid);
      if (room) {
        const rect = room.rects[0];
        return { tx: rect.x + (rect.w >> 1), ty: rect.y + (rect.h >> 1) };
      }
    }
    return null; // просто блуждает
  }

  updateHunt(dt, game) {
    const pl = game.player;
    this.huntT -= dt;

    // фаза «предупреждение»: мир кричит об опасности, но призрак неподвижен
    if (this.huntPhase === 'warn') {
      this.warnT -= dt;
      this.targetAlpha = 0;
      if (this.warnT <= 0) {
        this.huntPhase = 'search';
        audio.huntStart();
        const t = this.pickSearchTarget(game);
        if (t) { this.searchTarget = t; this.setPathTo(t.tx, t.ty); }
      }
      return;
    }

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

    // психологическое давление: проходя мимо укрытия с игроком,
    // призрак может замереть рядом и постучать по дверце
    if (sameFloor && pl.hidden) {
      const dh = Math.hypot(pl.hidden.x - this.x, pl.hidden.y - this.y);
      if (dh < TILE * 2.2 && this.lingerT <= 0 && Math.random() < dt * 0.5) {
        this.lingerT = 1.9;
        audio.closetKnock();
        pl.drainSanity(3);
      }
    }

    let sees = false;
    if (sameFloor && !pl.hidden && pl.alive) {
      const d = Math.hypot(pl.x - this.x, pl.y - this.y);
      if (d < TILE * 11 && hasLOS(this.x, this.y, pl.x, pl.y, occ)) sees = true;
      // слух: шаги и двери; электроника тоже выдаёт —
      // шипящий спиритбокс слышно, фонарик заметен чуть дальше прямой видимости
      if (pl.noise > 0.4 && d < TILE * 9) this.lastKnown = { x: pl.x, y: pl.y };
      if (pl.currentItem() === 'spirit' && d < TILE * 7) this.lastKnown = { x: pl.x, y: pl.y };
      if (pl.flashlightOn && d < TILE * 5 && Math.random() < dt * 2) this.lastKnown = { x: pl.x, y: pl.y };
    }
    // Банши идёт к жертве всегда
    if (this.tr.stalker && sameFloor && !pl.hidden) this.lastKnown = { x: pl.x, y: pl.y };

    let speed;
    if (this.tr.slowSpeed !== undefined) {
      speed = sees ? this.tr.fastSpeed : this.tr.slowSpeed;
    } else if (this.lingerT > 0) {
      speed = 12; // замер у укрытия
    } else {
      speed = this.huntBaseSpeed;
      if (sees) {
        this.losTime += dt;
        speed += Math.min(30, this.losTime * 6);
        if (this.tr.jinnSpeed && this.world.breaker.on &&
          Math.hypot(pl.x - this.x, pl.y - this.y) > TILE * 3) speed = 120;
      } else this.losTime = Math.max(0, this.losTime - dt * 2);
    }

    // переходы поиск ↔ погоня
    if (sees) {
      if (this.huntPhase !== 'chase') {
        this.huntPhase = 'chase';
        this.loseLosT = 0;
        audio.huntChase(); // жертва замечена — звук резко меняется
      }
    } else if (this.huntPhase === 'chase') {
      this.loseLosT += dt;
      if (this.loseLosT > 1.8) this.huntPhase = 'search';
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
    } else if (this.searchTarget) {
      // проверка знакомого места (память о прошлых охотах)
      this.followPath(dt, speed * 0.8);
      if (!this.path || this.pathI >= this.path.length) this.searchTarget = null;
    } else {
      // случайное блуждание
      if (!this.path || this.pathI >= this.path.length) this.pickWanderTarget(true);
      this.followPath(dt, speed * 0.7);
    }

    // убийство (в фазе предупреждения мы сюда не доходим)
    if (sameFloor && pl.alive && !pl.hidden &&
      Math.hypot(pl.x - this.x, pl.y - this.y) < HUNT_KILL_DIST) {
      game.killPlayer();
    }
    // обнаружение в укрытии в упор (если видел, как игрок прятался)
    if (sameFloor && pl.hidden && pl.hiddenSeen &&
      Math.hypot(pl.hidden.x - this.x, pl.hidden.y - this.y) < TILE * 0.9) {
      pl.hidden = null;
    }
  }

  endHunt(game) {
    // память: где жертва пряталась — в следующий раз проверит первым делом
    const pl = game.player;
    if (pl.hidden && pl.alive) {
      this.memory.hideSpot = { x: pl.hidden.x, y: pl.hidden.y, floor: pl.hidden.floor };
    }
    this.state = 'idle';
    this.stateT = rndRange(4, 8);
    this.targetAlpha = 0;
    this.huntPhase = null;
    this.searchTarget = null;
    this.huntCooldown = this.tr.huntCooldown ?? rndRange(22, 32);
    game.onHuntEnd();
    this.maybeMigrate(game);
    // «послесловие»: призрак уходит к себе, дом замолкает
    if (this.room.floor === this.floor) {
      this.state = 'roam';
      const r = this.room.rects[0];
      this.setPathTo(r.x + (r.w >> 1), r.y + (r.h >> 1));
      this.pendingStairs = null;
    }
  }

  // миграция любимой комнаты: не чаще раза за контракт, только после охоты.
  // Старая комната медленно прогревается, новая — остывает (через worldSim).
  maybeMigrate(game) {
    if (this.migrated) return;
    const chance = game.difficulty === 'pro' ? 0.4 : 0.15;
    if (Math.random() > chance) return;
    const rooms = this.world.rooms.filter(r => r.key !== 'hall' && r.id !== this.roomId);
    if (!rooms.length) return;
    const room = rndPick(rooms);
    this.roomId = room.id;
    this.migrated = true;
    this.activity = Math.min(10, this.activity + 3);
    // орбы переезжают вместе с призраком
    const rect = room.rects[0];
    for (const o of this.world.orbs || []) {
      o.floor = room.floor;
      o.home = rect;
      o.x = (rect.x + 0.8 + Math.random() * (rect.w - 1.6)) * TILE;
      o.y = (rect.y + 0.8 + Math.random() * (rect.h - 1.6)) * TILE;
    }
  }

  smudge(game) {
    const mult = this.tr.smudgeMult || 1;
    // благовония ослепляют, но НЕ отменяют охоту — призрак теряет след
    this.smudgedT = 5 * mult;
    this.lastKnown = null;
    this.path = null;
    if (this.state === 'hunt') {
      if (this.tr.smudgeInstant) this.endHunt(game); // только Онрё боится огня
      else this.pickWanderTarget(true);
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

    // аура-почерк: у каждой сущности свой холодный оттенок
    const AURA = {
      banshee: '138,42,58', demon: '122,26,26', mare: '20,20,40',
      phantom: '58,74,106', poltergeist: '90,74,26', yurei: '42,74,74',
      wraith: '74,90,106', onryo: '106,42,26',
    };
    const auraCol = AURA[this.data.key] || '58,64,82';
    const ag = ctx.createRadialGradient(0, -6, 3, 0, -4, 26);
    ag.addColorStop(0, `rgba(${auraCol},0.34)`);
    ag.addColorStop(1, `rgba(${auraCol},0)`);
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(0, -4, 26, 0, 7); ctx.fill();

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
