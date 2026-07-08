// «Режиссёр напряжения»: управляет ритмом ужаса вместо равномерного
// генератора случайных событий. Цикл фаз:
//   calm (тишина) → omen (предвестник) → suspicion (возня и слабые показания)
//   → reveal (проявление или охота) → release (разрядка) → calm …
// Переходы теперь вероятностны (иногда omen откатывается в calm, reveal
// оказывается ложной кульминацией) — ритм остаётся, но перестаёт быть
// механическим. «Долг активности» (activityDebt) гарантирует, что долгое
// молчание всегда заканчивается событием: сначала фоновым, затем характерным.
// Скорость цикла зависит от оценки напряжения score. Хранит историю действий
// (чтобы призрак не хлопал одной дверью дважды подряд) и карту посещений
// комнат игроком — это же память призрака о маршрутах жертвы.

import { TILE, clamp, rndRange } from '../core/utils.js';

export class Director {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = 'calm';
    this.phaseT = rndRange(6, 12);
    this.score = 0;
    this.timeInHouse = 0;
    this.silence = 0;          // секунд с последнего значимого проявления
    this.lastAction = {};      // тип действия -> game.time (анти-повторы)
    this.roomTime = new Map(); // roomId -> сколько секунд игрок там провёл

    // «долг активности»: растёт в тишине, гасится событиями
    this.activityDebt = 0;
    this.sinceAny = 0;         // секунд без любого заметного проявления
    this.sinceSignature = 0;   // секунд без характерного действия призрака
    this.ambientDue = false;
    this.signatureDue = false;
    this.huntCount = 0;
    this.postHuntQuiet = 0;    // «послесловие»: тишина после охоты
  }

  // отметить совершённое действие. strength: 'ambient' | 'signature' | 'event'
  // слабое событие лишь частично гасит долг — ожидание сильного сохраняется.
  note(type, game, strength = 'ambient') {
    this.lastAction[type] = game.time;
    this.silence = 0;
    this.sinceAny = 0;
    if (strength === 'ambient') {
      this.activityDebt *= 0.6;
    } else {
      this.activityDebt *= 0.15;
      this.sinceSignature = 0;
    }
    this.ambientDue = false;
    if (strength !== 'ambient') this.signatureDue = false;
  }

  // можно ли повторить действие этого типа (кулдаун в секундах)
  allow(type, cooldown, game) {
    return (game.time - (this.lastAction[type] ?? -999)) > cooldown;
  }

  update(dt, game) {
    const pl = game.player;
    const indoors = game.world.isIndoors(pl.floor, pl.x, pl.y);
    if (indoors) this.timeInHouse += dt;
    this.silence += dt;
    this.sinceAny += dt;
    this.sinceSignature += dt;
    this.activityDebt += dt;
    this.postHuntQuiet = Math.max(0, this.postHuntQuiet - dt);

    // память маршрутов: где игрок проводит время
    const rid = game.world.roomAt(pl.floor, pl.x, pl.y);
    if (rid >= 0) this.roomTime.set(rid, (this.roomTime.get(rid) || 0) + dt);

    // оценка напряжения
    const gh = game.ghost;
    let distFactor = 0;
    if (gh && indoors) {
      const r = gh.room.rects[0];
      const cx = (r.x + r.w / 2) * TILE, cy = (r.y + r.h / 2) * TILE;
      const d = Math.hypot(pl.x - cx, pl.y - cy) / (TILE * 20);
      distFactor = clamp(1 - d, 0, 1) * (pl.floor === gh.room.floor ? 1 : 0.4);
    }
    this.score =
      (1 - pl.sanity / 100) * 0.35 +
      clamp(this.timeInHouse / 240, 0, 1) * 0.2 +
      distFactor * 0.15 +
      clamp(this.silence / 50, 0, 1) * 0.3;

    // «потолки тишины»: не дольше ~20 c без фонового события,
    // не дольше ~75 c без характерного действия. Демон нетерпеливее.
    const tr = gh?.tr || {};
    const demon = !!tr.randomHunt;
    const ambientCap = demon ? 14 : 20;
    const sigCap = demon ? 55 : 78;

    // во время «послесловия» гарантий нет — дом честно молчит
    const quiet = this.postHuntQuiet > 0 || (gh && (gh.state === 'hunt' || gh.state === 'event'));
    this.ambientDue = !quiet && (this.activityDebt > 18 || this.sinceAny > ambientCap);
    this.signatureDue = !quiet && (this.activityDebt > 45 || this.sinceSignature > sigCap);

    // фазы тикают почти всегда; во время подготовки цикл ограничен (см. advance)
    if (this.timeInHouse < 3) return;

    this.phaseT -= dt;
    if (this.phaseT <= 0) this.advance(game);
  }

  advance(game) {
    // выше score — короче затишья, быстрее цикл
    const k = clamp(1.7 - this.score, 0.5, 1.7);
    const gh = game?.ghost;
    const tr = gh?.tr || {};
    const demon = !!tr.randomHunt;   // Демон сокращает спокойные фазы
    const shade = !!tr.shy;          // Тень чаще возвращается к тишине
    const dark = this.isPlayerInDark(game);
    // подготовка блокирует настоящие охоты и кульминации — цикл ходит по кругу
    const setup = game?.setupPhase;

    switch (this.phase) {
      case 'calm':
        this.phase = 'omen';
        this.phaseT = rndRange(2, 5);
        break;

      case 'omen':
        // иногда предвестник ни к чему не ведёт — снова тишина
        if (Math.random() < (shade ? 0.35 : demon ? 0.1 : 0.22)) {
          this.phase = 'calm';
          this.phaseT = rndRange(6, 12) * (demon ? 0.6 : 1);
        } else {
          this.phase = 'suspicion';
          this.phaseT = rndRange(8, 15) * k;
        }
        break;

      case 'suspicion': {
        // Мара в темноте охотнее срывается в кульминацию
        const toReveal = dark && tr.lightsOff ? 0.85 : (demon ? 0.8 : 0.6);
        if (!setup && Math.random() < toReveal) {
          this.phase = 'reveal';
          this.phaseT = rndRange(4, 9);
        } else {
          // подозрение выдохлось без кульминации
          this.phase = 'calm';
          this.phaseT = rndRange(5, 10) * (shade ? 1.3 : 1);
        }
        break;
      }

      case 'reveal':
        this.phase = 'release';
        this.phaseT = rndRange(10, 18) * k;
        break;

      default: // release
        this.phase = 'calm';
        this.phaseT = rndRange(8, 18) * k * (shade ? 1.2 : 1);
        break;
    }
  }

  isPlayerInDark(game) {
    if (!game) return false;
    const pl = game.player;
    const room = game.world.roomById(game.world.roomAt(pl.floor, pl.x, pl.y));
    return !room || !room.lightOn || !game.world.breaker.on;
  }

  // после охоты дом замолкает надолго — «послесловие» 15–25 c
  afterHunt() {
    this.phase = 'release';
    this.phaseT = rndRange(22, 38);
    this.silence = 0;
    this.activityDebt = 0;
    this.sinceAny = 0;
    this.sinceSignature = 0;
    this.postHuntQuiet = rndRange(15, 25);
    this.huntCount++;
  }

  // миграция логова разрешена, только когда игрок уже успел расследовать
  canMigrate(game) {
    const enough = game.evidenceFound.size >= 2;
    const late = this.timeInHouse > 300;
    const proSeries = game.difficulty === 'pro' && this.huntCount >= 2;
    return enough || late || proSeries;
  }

  // комната этажа, где игрок бывал чаще всего (для памяти призрака)
  mostVisitedRoom(world, floor) {
    let best = -1, bt = 0;
    for (const [rid, t] of this.roomTime) {
      const room = world.roomById(rid);
      if (!room || room.floor !== floor) continue;
      if (t > bt) { bt = t; best = rid; }
    }
    return bt > 8 ? best : -1; // осмысленно, только если игрок там реально бывал
  }
}
