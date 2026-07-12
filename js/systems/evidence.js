// Динамика мира и улики: температура, орбы, физика пропсов,
// анимация дверей, ЭМП-очистка, соль под призраком.

import { TILE, clamp, damp, rndRange, rndPick } from '../core/utils.js';
import { audio } from '../core/audio.js';

export const worldSim = {
  initContract(game) {
    const world = game.world;
    const gh = game.ghost;
    // орбы в комнате призрака
    world.orbs = [];
    if (gh.data.ev.includes('orbs')) {
      const r = gh.room.rects[0];
      for (let i = 0; i < 4; i++) {
        world.orbs.push({
          x: (r.x + 0.8 + Math.random() * (r.w - 1.6)) * TILE,
          y: (r.y + 0.8 + Math.random() * (r.h - 1.6)) * TILE,
          floor: gh.room.floor,
          phase: Math.random() * 6.28,
          home: r,
        });
      }
    }

    // проклятый предмет: один случайный на контракт, в случайной комнате
    const type = rndPick(['musicbox', 'mirror', 'doll']);
    const rooms = world.rooms.filter(r => r.key !== 'hall');
    let placed = null;
    for (let attempt = 0; attempt < 24 && !placed; attempt++) {
      const room = rndPick(rooms);
      const rect = room.rects[0];
      const x = (rect.x + 0.7 + Math.random() * (rect.w - 1.4)) * TILE;
      const y = (rect.y + 0.7 + Math.random() * (rect.h - 1.4)) * TILE;
      if (world.isBlocked(room.floor, Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      const hit = (world.colliders[room.floor] || []).some(c =>
        x > c.x - 8 && x < c.x + c.w + 8 && y > c.y - 8 && y < c.y + c.h + 8);
      if (hit) continue;
      placed = { type, x, y, floor: room.floor, used: false, activeT: 0, photoDone: false };
    }
    world.cursed = placed;
  },

  update(dt, game) {
    const world = game.world;
    const gh = game.ghost;
    const tNow = performance.now() / 1000;

    // ЭМП-события устаревают
    world.emfEvents = world.emfEvents.filter(e => e.until > tNow);
    // отпечатки исчезают через 60 c
    world.prints = world.prints.filter(p => performance.now() - p.t < 60000);

    // температура комнат
    for (const room of world.rooms) {
      let target = room.baseTemp;
      let rate = 0.04;
      if (gh && room.id === gh.roomId) {
        target = gh.data.ev.includes('freezing') ? -6 : 3;
        // логово с уликой «мороз» надёжно уходит ниже нуля; на «Любителе» —
        // заметно быстрее, чтобы игрок не сомневался, настоящая ли это комната
        if (gh.data.ev.includes('freezing')) rate = game.difficulty === 'pro' ? 0.05 : 0.09;
      } else if (gh && world.roomAt(gh.floor, gh.x, gh.y) === room.id) {
        target = Math.min(target, 6);
      }
      if (room.lightOn && world.breaker.on) target += 2;
      // после миграции новая комната остывает ускоренно (сигнал смены зоны)
      if (room.coolBoost > 0) { rate = Math.max(rate, 0.13); room.coolBoost -= dt; }
      // старая комната после миграции резко «затихает» и прогревается быстрее
      if (room.hush > 0) { rate = Math.max(rate, 0.1); room.hush -= dt; }
      room.temp = damp(room.temp, target, rate, dt);
    }

    // орбы дрейфуют
    for (const o of world.orbs || []) {
      o.phase += dt;
      o.x += Math.sin(o.phase * 0.7) * 6 * dt;
      o.y += Math.cos(o.phase * 0.53) * 5 * dt;
      const r = o.home;
      o.x = clamp(o.x, (r.x + 0.5) * TILE, (r.x + r.w - 0.5) * TILE);
      o.y = clamp(o.y, (r.y + 0.5) * TILE, (r.y + r.h - 0.5) * TILE);
    }

    // физика пропсов
    for (const p of world.props) {
      if (p.vx || p.vy || p.z > 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vz -= 260 * dt;
        p.vx *= (1 - dt * 1.4);
        p.vy *= (1 - dt * 1.4);
        p.rot += dt * 6;
        // столкновение со стеной — отскок
        const f = world.floors[p.floor];
        if (f.isSolid(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) {
          p.vx *= -0.4; p.vy *= -0.4;
          p.x += p.vx * dt * 2; p.y += p.vy * dt * 2;
        }
        if (p.z <= 0 && p.vz < 0) {
          p.z = 0;
          const impactV = Math.abs(p.vz);
          const nearPlayer = (r) => game.player.floor === p.floor &&
            Math.hypot(p.x - game.player.x, p.y - game.player.y) < TILE * r;
          if (impactV > 60) {
            p.vz = impactV * 0.3;
            if (nearPlayer(12)) {
              audio.propImpact(p.material || 'wood', audio.panFor(p.x), Math.min(1.4, impactV / 130));
            }
            // хрупкое бьётся от сильного удара (порог скорости падения — по предмету)
            const BREAK_V = { plate: 130, vase: 112, frame: 150 };
            if (!p.broken && impactV > (BREAK_V[p.type] ?? Infinity)) p.broken = true;
            game.fx.dustBurst(p.x, p.y, p.floor);
          } else {
            // тихий «клик оседания» после последнего отскока
            if (impactV > 18 && nearPlayer(10)) {
              audio.propImpact(p.material || 'wood', audio.panFor(p.x), 0.25);
            }
            p.vz = 0; p.vx = 0; p.vy = 0;
          }
        }
      }
    }

    // двери: плавный поворот
    for (const d of world.doors) {
      const target = d.targetSwing ?? (d.open ? 1 : 0);
      d.swing = damp(d.swing, d.locked ? 0 : target, 8, dt);
    }

    // соль: призрак наступает
    if (gh) {
      for (const s of world.saltPiles) {
        if (s.floor !== gh.floor || s.disturbed) continue;
        if (Math.hypot(s.x - gh.x, s.y - gh.y) < 13) {
          if (gh.tr.noSalt) continue; // Мираж не тревожит соль
          s.disturbed = true;
          s.steps = [];
          const a = Math.atan2(gh.y - s.y, gh.x - s.x) + Math.PI;
          for (let i = 1; i <= 3; i++) {
            s.steps.push({
              x: s.x + Math.cos(a) * i * 12 + rndRange(-3, 3),
              y: s.y + Math.sin(a) * i * 12 + rndRange(-3, 3),
              a: a + Math.PI / 2 + rndRange(-0.2, 0.2),
            });
          }
          gh.activity = Math.min(10, gh.activity + 2);
          game.log('Соль потревожена!');
        }
      }
    }
  },
};
