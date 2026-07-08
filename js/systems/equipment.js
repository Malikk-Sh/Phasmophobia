// Снаряжение: описание предметов, использование, показания, отрисовка размещённых.

import { TILE, clamp, rndPick, hasLOS } from '../core/utils.js';
import { audio } from '../core/audio.js';

export const ITEMS = {
  emf: {
    name: 'ЭМП-детектор', icon: 'emf', held: true,
    desc: 'Ловит электромагнитные всплески от активности призрака. Пять делений — улика «ЭМП 5 уровня».',
  },
  spirit: {
    name: 'Спиритбокс', icon: 'spirit', held: true,
    desc: 'Радиосвязь с духами. Задавайте вопросы в тёмной комнате рядом с призраком — некоторые отвечают.',
  },
  thermo: {
    name: 'Термометр', icon: 'thermo', held: true,
    desc: 'Показывает температуру комнаты. Призрак выстуживает своё логово; ниже 0°C — улика.',
  },
  uv: {
    name: 'УФ-фонарь', icon: 'uv', held: true,
    desc: 'Ультрафиолет проявляет отпечатки рук на дверях и выключателях, которые трогал призрак.',
  },
  photo: {
    name: 'Фотокамера', icon: 'photo', held: true,
    desc: 'Плёночная камера, 5 кадров. Снимки паранормального оплачиваются по качеству: дистанция, центр кадра, риск.',
  },
  camera: {
    name: 'Видеокамера', icon: 'camera', place: true,
    desc: 'Ставится на пол. Через ночной монитор в фургоне видны призрачные огни — улика.',
  },
  book: {
    name: 'Книга призрака', icon: 'book', place: true,
    desc: 'Положите в комнате призрака: некоторые сущности оставляют в ней жуткие записи.',
  },
  dots: {
    name: 'DOTS-проектор', icon: 'dots', place: true,
    desc: 'Проецирует лазерную сетку. Часть призраков проявляется в ней зелёным силуэтом.',
  },
  ward: {
    name: 'Оберег', icon: 'ward', place: true,
    desc: 'Старинный защитный амулет. Не даёт призраку начать охоту рядом с собой. Два заряда, затем гаснет.',
  },
  smudge: {
    name: 'Благовония', icon: 'smudge', consumable: 2,
    desc: 'Подожгите рядом с призраком: отгоняет его и срывает охоту. Держите на случай беды.',
  },
  salt: {
    name: 'Соль', icon: 'salt', consumable: 3,
    desc: 'Насыпьте на пол. Прошедший призрак потревожит кучку и оставит следы.',
  },
  pills: {
    name: 'Таблетки', icon: 'pills', consumable: 1,
    desc: 'Успокоительное: мгновенно восстанавливает 40% рассудка.',
  },
};

const RESPONSES = ['УХОДИ', 'СМЕРТЬ', 'ОНО ЗДЕСЬ', 'ХОЛОДНО', 'ПОЗАДИ ТЕБЯ', 'МОЙ ДОМ', 'УМРИ', 'РЯДОМ'];

export const equipment = {
  spiritCooldown: 0,
  emfLevel: 0,
  fakeEmfT: 0, // галлюцинаторный всплеск ЭМП

  resetContract(game) {
    this.spiritCooldown = 0;
    this.emfLevel = 0;
    this.fakeEmfT = 0;
    game.itemUses = { smudge: 2, salt: 3, pills: 1, photo: 5 };
    game.photos = [];
  },

  // ---------- Фотокамера ----------
  takePhoto(game) {
    const pl = game.player;
    const world = game.world;
    if ((game.itemUses.photo ?? 0) <= 0) { game.log('Плёнка закончилась'); return; }
    game.itemUses.photo--;
    audio.shutter();
    game.fx.flash = Math.max(game.fx.flash, 0.22);

    const MAXD = TILE * 6.5;
    const occl = world.getOccluders(pl.floor);
    // кандидат в кадре: дистанция, угол от центра кадра, прямая видимость
    const inFrame = (x, y, floor) => {
      if (floor !== pl.floor) return null;
      const d = Math.hypot(x - pl.x, y - pl.y);
      if (d > MAXD || d < 4) return null;
      const da = Math.abs(((Math.atan2(y - pl.y, x - pl.x) - pl.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > 0.6) return null;
      if (!hasLOS(pl.x, pl.y, x, y, occl)) return null; // сквозь стену не снять
      return { d, da };
    };
    const quality = (f) => Math.max(0.3, (1 - f.d / (MAXD * 1.15))) * (1 - (f.da / 0.6) * 0.45);

    const shots = [];
    const gh = game.ghost;
    if (gh && (gh.visibleAlpha > 0.15 || gh.dotsFlash > 0)) {
      const f = inFrame(gh.x, gh.y, gh.floor);
      if (f) shots.push({ label: 'Призрак', base: 25, q: quality(f), risk: gh.state === 'hunt' ? 1.6 : 1, key: 'ghost' });
    }
    for (const pr of world.prints) {
      if (pr.photoDone) continue;
      const f = inFrame(pr.x, pr.y, pr.floor);
      if (f) shots.push({ label: 'УФ-отпечаток', base: 6, q: quality(f), risk: 1, mark: pr });
    }
    for (const s of world.saltPiles) {
      if (!s.disturbed || s.photoDone) continue;
      const f = inFrame(s.x, s.y, s.floor);
      if (f) shots.push({ label: 'Следы в соли', base: 6, q: quality(f), risk: 1, mark: s });
    }
    for (const p of world.placed) {
      if (p.photoDone) continue;
      if (p.type === 'ward' && p.charges <= 0) {
        const f = inFrame(p.x, p.y, p.floor);
        if (f) shots.push({ label: 'Погасший оберег', base: 8, q: quality(f), risk: 1, mark: p });
      }
      if (p.type === 'book' && p.written) {
        const f = inFrame(p.x, p.y, p.floor);
        if (f) shots.push({ label: 'Призрачная запись', base: 6, q: quality(f), risk: 1, mark: p });
      }
    }
    for (const p of world.props) {
      if (p.photoDone) continue;
      if (game.time - p.thrownAt < 1.6 || p.z > 3) {
        const f = inFrame(p.x, p.y, p.floor);
        if (f) shots.push({ label: 'Летящий предмет', base: 12, q: quality(f), risk: 1, mark: p });
      }
    }
    if (world.cursed && !world.cursed.photoDone) {
      const f = inFrame(world.cursed.x, world.cursed.y, world.cursed.floor);
      if (f) shots.push({ label: 'Проклятый предмет', base: 10, q: quality(f), risk: 1, mark: world.cursed });
    }

    if (!shots.length) {
      game.photos.push({ label: 'Пустой кадр', rating: '—', reward: 0 });
      game.log('В кадре ничего нет');
      return;
    }
    shots.sort((a, b) => b.base * b.q * b.risk - a.base * a.q * a.risk);
    const best = shots[0];
    if (best.mark) best.mark.photoDone = true;
    const reward = Math.round(best.base * best.q * best.risk);
    const rating = best.q > 0.75 ? 'отличный кадр' : best.q > 0.5 ? 'хороший кадр' : 'смазанный кадр';
    game.photos.push({ label: best.label, rating, reward });
    game.log(`Фото: ${best.label} — ${rating}, +$${reward}`, 'evidence');
    if (best.key === 'ghost') game.checkObjective('photoGhost');
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
    // ложный сигнал (галлюцинация): максимум 3 деления, улику не даёт
    this.fakeEmfT = Math.max(0, this.fakeEmfT - dt);
    if (this.fakeEmfT > 0 && item === 'emf' && emf < 3) emf = 2 + (Math.random() < 0.3 ? 1 : 0);
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
    // во время охоты (и её обманки) электроника захлёбывается помехами —
    // это и есть главный сигнал опасности
    const gh = game.ghost;
    const garble = gh && (gh.state === 'hunt' || gh.fakeHuntT > 0) &&
      gh.floor === pl.floor &&
      Math.hypot(gh.x - pl.x, gh.y - pl.y) < TILE * 13;
    if (garble) {
      if (item === 'emf') return { name: ITEMS.emf.name, bars: (Math.random() * 6) | 0 };
      const junk = ['▓▒░', '#ERR', '––.–', '▒▒▒', '?…?'][(Math.random() * 5) | 0];
      return { name: ITEMS[item].name, value: junk, danger: true };
    }
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
    if (item === 'photo') {
      return { name: ITEMS.photo.name, value: `КАДРОВ: ${game.itemUses.photo ?? 0}`, danger: (game.itemUses.photo ?? 0) === 0 };
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
      // размещение перед собой (если там стена — под собой)
      let px = pl.x + Math.cos(pl.angle) * TILE * 0.8;
      let py = pl.y + Math.sin(pl.angle) * TILE * 0.8;
      if (world.isBlocked(pl.floor, Math.floor(px / TILE), Math.floor(py / TILE))) {
        px = pl.x; py = pl.y;
      }
      world.placed.push({
        type: item, x: px, y: py, floor: pl.floor,
        angle: pl.angle, written: false, seen: false,
        charges: item === 'ward' ? 2 : 0, burnT: 0, phase: Math.random() * 6.28,
      });
      pl.inventory[pl.activeSlot] = null;
      audio.cameraPlace();
      // цель «камера в комнате призрака» проверяется в основном цикле по комнате
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

    if (item === 'photo') { this.takePhoto(game); return; }
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
  } else if (it.type === 'ward') {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(1, 2, 5, 4, 0, 0, 7); ctx.fill();
    const dead = it.charges <= 0;
    // ровное холодное свечение живого оберега
    if (!dead) {
      const p = 0.5 + Math.sin(t * 2.4) * 0.3;
      const gl = ctx.createRadialGradient(0, 0, 1, 0, 0, 12);
      gl.addColorStop(0, `rgba(150,190,220,${0.3 * p})`);
      gl.addColorStop(1, 'rgba(150,190,220,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
    }
    // амулет-ромб с камнем в центре и подвесами
    ctx.strokeStyle = dead ? '#3a3630' : '#b9a56a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -7.5); ctx.lineTo(4.5, -1); ctx.lineTo(0, 8); ctx.lineTo(-4.5, -1); ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(0, -9.5); ctx.stroke(); // шнур
    ctx.fillStyle = dead ? '#2c3238' : '#5f86a0';
    ctx.beginPath(); ctx.arc(0, -1, 2, 0, 7); ctx.fill(); // камень
    ctx.strokeStyle = dead ? '#2c2822' : '#8a7a4a';
    ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(-4.5, 6.5); ctx.moveTo(3, 3); ctx.lineTo(4.5, 6.5); ctx.stroke(); // подвесы
    // вспышка защиты при отражении охоты
    if (it.burnT > 0) {
      it.burnT -= 0.016;
      const a = Math.max(0, it.burnT / 1.5);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, TILE * 3.4);
      g.addColorStop(0, `rgba(150,200,235,${a * 0.55})`);
      g.addColorStop(0.5, `rgba(120,170,220,${a * 0.25})`);
      g.addColorStop(1, 'rgba(120,170,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, TILE * 3.4, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}
