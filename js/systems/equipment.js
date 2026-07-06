// Снаряжение: описание предметов, использование, показания, отрисовка размещённых.

import { TILE, clamp, rndPick } from '../core/utils.js';
import { audio } from '../core/audio.js';

export const ITEMS = {
  emf: { name: 'ЭМП-детектор', icon: '📡', held: true },
  spirit: { name: 'Спиритбокс', icon: '📻', held: true },
  thermo: { name: 'Термометр', icon: '🌡', held: true },
  uv: { name: 'УФ-фонарь', icon: '🔦', held: true },
  camera: { name: 'Видеокамера', icon: '📹', place: true },
  book: { name: 'Книга призрака', icon: '📖', place: true },
  dots: { name: 'DOTS-проектор', icon: '🟢', place: true },
  crucifix: { name: 'Распятие', icon: '✝', place: true },
  smudge: { name: 'Благовония', icon: '🌿', consumable: 2 },
  salt: { name: 'Соль', icon: '🧂', consumable: 3 },
  pills: { name: 'Таблетки', icon: '💊', consumable: 1 },
};

const RESPONSES = ['УХОДИ', 'СМЕРТЬ', 'ОНО ЗДЕСЬ', 'ХОЛОДНО', 'ПОЗАДИ ТЕБЯ', 'МОЙ ДОМ', 'УМРИ', 'РЯДОМ'];

export const equipment = {
  spiritCooldown: 0,
  emfLevel: 0,

  resetContract(game) {
    this.spiritCooldown = 0;
    this.emfLevel = 0;
    game.itemUses = { smudge: 2, salt: 3, pills: 1 };
  },

  // показания активного предмета, вызывается каждый кадр
  update(dt, game) {
    this.spiritCooldown = Math.max(0, this.spiritCooldown - dt);
    const pl = game.player;
    const item = pl.currentItem();
    const world = game.world;

    // ЭМП: максимальный уровень событий поблизости
    let emf = 0;
    if (item === 'emf' && !pl.hidden) {
      const tNow = performance.now() / 1000;
      for (const e of world.emfEvents) {
        if (e.floor !== pl.floor || e.until < tNow) continue;
        const d = Math.hypot(e.x - pl.x, e.y - pl.y);
        if (d < TILE * 4.2 && e.level > emf) emf = e.level;
      }
      // близость призрака даёт фон
      const gh = game.ghost;
      if (gh && gh.floor === pl.floor && Math.hypot(gh.x - pl.x, gh.y - pl.y) < TILE * 2.5) {
        emf = Math.max(emf, 2);
      }
      if (emf >= 5) game.onEvidenceSeen('emf');
    }
    this.emfLevel = emf;

    // термометр: улика при <0
    if (item === 'thermo') {
      const room = world.roomById(world.roomAt(pl.floor, pl.x, pl.y));
      const t = room ? room.temp : 6;
      if (t + Math.sin(game.time * 3) * 0.4 < 0) game.onEvidenceSeen('freezing');
    }

    // книга: увидеть запись
    for (const p of world.placed) {
      if (p.type === 'book' && p.written && !p.seen && p.floor === pl.floor &&
        Math.hypot(p.x - pl.x, p.y - pl.y) < TILE * 1.4) {
        p.seen = true;
        game.onEvidenceSeen('writing');
      }
    }
  },

  // данные для HUD-панели показаний
  readout(game) {
    const pl = game.player;
    const item = pl.currentItem();
    const world = game.world;
    if (!item) return null;
    if (item === 'emf') {
      return { name: ITEMS.emf.name, bars: this.emfLevel };
    }
    if (item === 'thermo') {
      const room = world.roomById(world.roomAt(pl.floor, pl.x, pl.y));
      const t = (room ? room.temp : 6) + Math.sin(game.time * 3) * 0.4;
      return {
        name: ITEMS.thermo.name,
        value: `${t.toFixed(1)}°C`,
        danger: t < 1,
      };
    }
    if (item === 'spirit') {
      return {
        name: ITEMS.spirit.name,
        value: this.spiritCooldown > 0 ? '· · ·' : 'ГОТОВ',
        ask: true,
      };
    }
    if (item === 'uv') {
      return { name: ITEMS.uv.name, value: pl.flashlightOn ? 'ВКЛ' : 'ВЫКЛ' };
    }
    const meta = ITEMS[item];
    if (meta.consumable) {
      return { name: meta.name, value: `×${game.itemUses[item] ?? 0}` };
    }
    if (meta.place) {
      return { name: meta.name, value: 'РАЗМЕСТИТЬ [ИСП.]' };
    }
    return { name: meta.name, value: '' };
  },

  // кнопка «использовать»
  use(game) {
    const pl = game.player;
    const world = game.world;
    const item = pl.currentItem();
    if (!item || pl.hidden) return;
    const meta = ITEMS[item];

    if (meta.place) {
      // размещение перед собой
      const px = pl.x + Math.cos(pl.angle) * TILE * 0.8;
      const py = pl.y + Math.sin(pl.angle) * TILE * 0.8;
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      if (world.isBlocked(pl.floor, tx, ty)) { game.log('Здесь не поставить'); return; }
      world.placed.push({
        type: item, x: px, y: py, floor: pl.floor,
        angle: pl.angle, written: false, seen: false,
        charges: item === 'crucifix' ? 2 : 0, burnT: 0, phase: Math.random() * 6.28,
      });
      pl.inventory[pl.activeSlot] = null;
      audio.cameraPlace();
      if (item === 'camera') game.checkObjective('camera');
      return;
    }

    if (item === 'smudge') {
      if ((game.itemUses.smudge ?? 0) <= 0) { game.log('Благовония закончились'); return; }
      game.itemUses.smudge--;
      audio.smudgeUse();
      for (let i = 0; i < 14; i++) game.fx.spawn('breath', pl.x, pl.y, pl.floor, { life: 2 + Math.random(), size: 3 + Math.random() * 3 });
      const gh = game.ghost;
      if (gh && gh.floor === pl.floor && Math.hypot(gh.x - pl.x, gh.y - pl.y) < TILE * 6) {
        const wasHunt = gh.state === 'hunt';
        gh.smudge(game);
        game.log(wasHunt ? 'Охота сорвана благовониями!' : 'Призрак отогнан благовониями');
        if (wasHunt) game.checkObjective('smudgeHunt');
      }
      return;
    }

    if (item === 'salt') {
      if ((game.itemUses.salt ?? 0) <= 0) { game.log('Соль закончилась'); return; }
      game.itemUses.salt--;
      audio.saltPour();
      world.saltPiles.push({
        x: pl.x + Math.cos(pl.angle) * TILE * 0.6,
        y: pl.y + Math.sin(pl.angle) * TILE * 0.6,
        floor: pl.floor, disturbed: false, steps: [],
      });
      return;
    }

    if (item === 'pills') {
      if ((game.itemUses.pills ?? 0) <= 0) { game.log('Таблетки закончились'); return; }
      game.itemUses.pills--;
      audio.pills();
      pl.sanity = clamp(pl.sanity + 40, 0, 100);
      game.log('Рассудок восстановлен (+40%)');
      return;
    }

    if (item === 'spirit') { this.askSpirit(game); return; }
    if (item === 'uv' || item === 'emf' || item === 'thermo') {
      // просто переключить фонарик для удобства
      pl.flashlightOn = !pl.flashlightOn;
      audio.switchClick();
    }
  },

  askSpirit(game) {
    if (this.spiritCooldown > 0) return;
    this.spiritCooldown = 4;
    const pl = game.player;
    const gh = game.ghost;
    audio.whisper(); // шорох эфира на вопрос
    game.log('«Есть здесь кто-нибудь?..»');
    setTimeout(() => {
      if (!gh || !pl.alive) return;
      const room = game.world.roomById(game.world.roomAt(pl.floor, pl.x, pl.y));
      const dark = !room || !room.lightOn || !game.world.breaker.on;
      const near = gh.floor === pl.floor && Math.hypot(gh.x - pl.x, gh.y - pl.y) < TILE * 6;
      if (gh.data.ev.includes('spirit') && dark && near && Math.random() < 0.75) {
        audio.spiritResponse();
        game.log(`Спиритбокс: «${rndPick(RESPONSES)}»`, 'evidence');
        game.onEvidenceSeen('spirit');
        gh.activity = Math.min(10, gh.activity + 2);
      } else {
        game.log('…только помехи…');
      }
    }, 1400);
  },
};

// ---------- Отрисовка размещённого ----------
export function drawPlaced(ctx, it, t, game) {
  ctx.save();
  ctx.translate(it.x, it.y);
  if (it.type === 'camera') {
    ctx.rotate(it.angle || 0);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(1, 2, 7, 5, 0, 0, 7); ctx.fill();
    // штатив
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    for (const a of [2.4, 3.9, 5.4]) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.stroke();
    }
    ctx.fillStyle = '#2c3438';
    ctx.fillRect(-3, -3.5, 9, 7);
    ctx.fillStyle = '#11181c';
    ctx.beginPath(); ctx.arc(6.5, 0, 2.6, 0, 7); ctx.fill();
    // мигающий LED
    if (Math.sin(t * 4) > 0) {
      ctx.fillStyle = '#e33';
      ctx.beginPath(); ctx.arc(-1.5, -2, 1.2, 0, 7); ctx.fill();
    }
  } else if (it.type === 'book') {
    ctx.rotate((it.angle || 0) + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(1, 2, 9, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#d8d0ba';
    ctx.fillRect(-8, -6, 16, 12);
    ctx.fillStyle = '#c4bca6';
    ctx.fillRect(-8, -6, 8, 12);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke();
    if (it.written) {
      ctx.strokeStyle = 'rgba(30,20,25,.85)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      let x = -6.5;
      for (let i = 0; i < 3; i++) {
        const y = -3.5 + i * 3;
        ctx.moveTo(x, y);
        for (let s = 0; s < 5; s++) ctx.lineTo(x + 1 + s * 1.2, y + Math.sin(s * 3 + i * 7) * 1.4);
      }
      ctx.stroke();
    }
  } else if (it.type === 'dots') {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(1, 2, 5, 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#1e2a24';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#43e07a';
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, 7); ctx.fill();
    // поле точек
    const R = TILE * 2.6;
    ctx.fillStyle = 'rgba(80,240,130,.30)';
    for (let i = 0; i < 42; i++) {
      const a = (i * 2.399) + t * 0.22;
      const r = (i % 7 + 2.5) / 9.5 * R;
      ctx.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1.6, 1.6);
    }
  } else if (it.type === 'crucifix') {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(1, 2, 5, 4, 0, 0, 7); ctx.fill();
    const dead = it.charges <= 0;
    ctx.strokeStyle = dead ? '#3a3630' : '#c8a860';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(0, 7);
    ctx.moveTo(-4.5, -2.5); ctx.lineTo(4.5, -2.5);
    ctx.stroke();
    if (it.burnT > 0) {
      it.burnT -= 0.016;
      const a = Math.max(0, it.burnT / 1.5);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, TILE * 3.2);
      g.addColorStop(0, `rgba(255,180,80,${a * 0.5})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, TILE * 3.2, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}
