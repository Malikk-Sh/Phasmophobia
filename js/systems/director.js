// «Режиссёр напряжения»: управляет ритмом ужаса вместо равномерного
// генератора случайных событий. Цикл фаз:
//   calm (тишина) → omen (предвестник) → suspicion (возня и слабые показания)
//   → reveal (проявление или охота) → release (разрядка) → calm …
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
  }

  // отметить совершённое действие (сбрасывает тишину)
  note(type, game) {
    this.lastAction[type] = game.time;
    this.silence = 0;
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

    // фазы не тикают, пока идёт подготовка или игрок ещё не заходил в дом
    if (game.setupPhase || this.timeInHouse < 3) return;

    this.phaseT -= dt;
    if (this.phaseT <= 0) this.advance();
  }

  advance() {
    // выше score — короче затишья, быстрее цикл
    const k = clamp(1.7 - this.score, 0.5, 1.7);
    switch (this.phase) {
      case 'calm': this.phase = 'omen'; this.phaseT = rndRange(2, 5); break;
      case 'omen': this.phase = 'suspicion'; this.phaseT = rndRange(8, 15) * k; break;
      case 'suspicion': this.phase = 'reveal'; this.phaseT = rndRange(4, 9); break;
      case 'reveal': this.phase = 'release'; this.phaseT = rndRange(10, 18) * k; break;
      default: this.phase = 'calm'; this.phaseT = rndRange(8, 18) * k; break;
    }
  }

  // после охоты дом замолкает надолго — «послесловие»
  afterHunt() {
    this.phase = 'release';
    this.phaseT = rndRange(22, 38);
    this.silence = 0;
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
