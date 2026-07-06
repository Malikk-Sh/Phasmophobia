// ФАЗМОФОБИЯ — точка входа: игровой цикл, стейт-машина, взаимодействия.

import { TILE, clamp, rndPick, dist, hasLOS, rndRange } from './core/utils.js';
import { input } from './core/input.js';
import { Camera } from './core/camera.js';
import { audio } from './core/audio.js';
import { buildWorld, FLOOR_BASEMENT, OUTSIDE } from './world/house.js';
import { furnish } from './world/furniture.js';
import { computeVisibility } from './render/visibility.js';
import { Lighting } from './render/lighting.js';
import { FX } from './render/fx.js';
import { Renderer } from './render/renderer.js';
import { Player } from './entities/player.js';
import { Ghost } from './entities/ghost.js';
import { GHOSTS } from './systems/ghostData.js';
import { equipment, ITEMS } from './systems/equipment.js';
import { worldSim } from './systems/evidence.js';
import { hud } from './ui/hud.js';
import { journal } from './ui/journal.js';
import { van } from './ui/van.js';
import { menus } from './ui/menus.js';

const OBJECTIVE_POOL = [
  { key: 'event', name: 'Стать свидетелем паранормального события' },
  { key: 'emfAny', name: 'Зафиксировать всплеск ЭМП детектором' },
  { key: 'freezeRead', name: 'Замерить температуру ниже 5°C' },
  { key: 'spirit', name: 'Получить ответ через спиритбокс' },
  { key: 'camera', name: 'Установить видеокамеру в комнате призрака' },
  { key: 'smudgeHunt', name: 'Сорвать охоту благовониями' },
  { key: 'salt', name: 'Заставить призрака потревожить соль' },
];

const game = {
  state: 'menu',
  time: 0,
  world: null,
  player: null,
  ghost: null,
  camera: new Camera(),
  lighting: new Lighting(),
  fx: new FX(),
  renderer: null,
  vanCamIndex: 0,
  setupPhase: false,
  setupTimer: 0,
  difficulty: 'amateur',
  evidenceFound: new Set(),
  journalMarks: {},
  journalPick: null,
  objectives: [],
  itemUses: {},
  currentInteraction: null,
  aggression: 0,
  deathT: 0,
  lightningT: 12,
  stats: { crucifixSaves: 0, smudgeSaves: 0 },
  progress: loadProgress(),

  log(msg, cls = '') { hud.toast(msg, cls); },

  // ---------- Контракт ----------
  prepareContract(difficulty) {
    this.difficulty = difficulty;
    this.world = buildWorld();
    furnish(this.world);
    this.renderer = new Renderer(this.world);
    this.player = new Player(this.world);

    // призрак: случайный тип и комната (не коридор)
    const type = rndPick(GHOSTS);
    const candidates = this.world.rooms.filter(r => r.key !== 'hall');
    const room = rndPick(candidates);
    this.ghost = new Ghost(this.world, type, room.id);

    this.evidenceFound = new Set();
    this.journalMarks = {};
    this.journalPick = null;
    this.vanCamIndex = 0;
    this.stats = { crucifixSaves: 0, smudgeSaves: 0 };
    this.deathT = 0;
    this.fx.clear();

    // задачи: 3 случайных
    const pool = OBJECTIVE_POOL.slice();
    this.objectives = [];
    for (let i = 0; i < 3; i++) {
      const o = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      this.objectives.push({ ...o, done: false });
    }

    this.setupPhase = true;
    this.setupTimer = difficulty === 'pro' ? 0 : 120;
    if (difficulty === 'pro') this.setupPhase = false;

    // процедурное досье жертвы — атмосфера контракта
    const first = rndPick(['Анна', 'Виктор', 'Ольга', 'Павел', 'Мария', 'Григорий', 'Тамара', 'Аркадий', 'Лидия', 'Семён']);
    const last = rndPick(['Волкова', 'Черных', 'Мельников', 'Соколова', 'Громов', 'Зимина', 'Крылов', 'Одинцова'])
      .replace(/а$/, first.endsWith('а') || first.endsWith('я') ? 'а' : '');
    this.dossier = {
      name: `${first} ${last}`,
      years: `${1921 + Math.floor(Math.random() * 40)}–${1978 + Math.floor(Math.random() * 30)}`,
      death: rndPick([
        'найдена без признаков жизни у лестницы в подвал',
        'пропал(а) без вести; тело так и не нашли',
        'по заключению — остановка сердца во сне. Соседи сомневаются',
        'несчастный случай при пожаре, который не оставил следов на доме',
        'утонул(а) в собственной ванне при запертой изнутри двери',
      ]),
      rumor: rndPick([
        'По ночам соседи слышат, как кто-то передвигает мебель.',
        'Почтальон утверждает, что занавески шевелятся, хотя дом обесточен.',
        'Дети говорят, что из подвала «поёт женщина».',
        'Прошлый смотритель уволился через два дня и не забрал вещи.',
        'В окнах второй раз за месяц видели силуэт со свечой.',
      ]),
    };

    equipment.resetContract(this);
    worldSim.initContract(this);
  },

  startContract() {
    this.state = 'playing';
    this.time = 0;
    hud.show();
    this.camera.snapTo(this.player.x, this.player.y);
    audio.setAmbience(false, false);
    this.log('Снаряжение — в фургоне. Удачи.');
  },

  checkObjective(key) {
    const o = this.objectives.find(x => x.key === key && !x.done);
    if (o) {
      o.done = true;
      this.log(`Задача выполнена: ${o.name}`, 'evidence');
    }
  },

  onEvidenceSeen(key) {
    if (this.evidenceFound.has(key)) return;
    this.evidenceFound.add(key);
    this.journalMarks[key] = 1;
    const names = {
      emf: 'ЭМП 5 уровня', spirit: 'Ответ спиритбокса', uv: 'УФ-отпечатки',
      orbs: 'Призрачные огни', writing: 'Запись в книге',
      freezing: 'Минусовая температура', dots: 'DOTS-силуэт',
    };
    this.log(`УЛИКА: ${names[key]}`, 'evidence');
    audio.uiClick();
    if (key === 'spirit') this.checkObjective('spirit');
  },

  canHunt() {
    return this.state === 'playing' && !this.setupPhase &&
      this.player.alive && this.ghost.state !== 'hunt' && this.ghost.state !== 'event';
  },

  onHuntStart() {
    audio.huntStart();
    this.huntTime = 0;
    try { navigator.vibrate?.([70, 50, 120]); } catch { /* нет поддержки */ }
    this.camera.shake(2.5, 1.2);
    const front = this.world.doors.find(d => d.id === this.world.frontDoorId);
    if (front) { front.locked = true; front.open = false; front.targetSwing = 0; }
    if (journal.isOpen) journal.close();
    if (van.isOpen) van.close();
  },

  onHuntEnd() {
    audio.huntEnd();
    const front = this.world.doors.find(d => d.id === this.world.frontDoorId);
    if (front) front.locked = false;
  },

  killPlayer() {
    if (!this.player.alive) return;
    this.player.alive = false;
    this.fx.flash = 1;
    audio.jumpscare();
    audio.death();
    this.camera.shake(8, 1.6);
    this.state = 'death-anim';
    this.deathT = 2.4;
    this.ghost.endHunt(this);
    this.progress.deaths++;
    saveProgress(this.progress);
  },

  finishContract(died = false) {
    if (this.state === 'results') return;
    van.close(); journal.close(); hud.hide();
    const correct = !died && this.journalPick === this.ghost.data.key;
    const mult = this.difficulty === 'pro' ? 2 : 1;
    const objDone = this.objectives.filter(o => o.done).length;
    const res = {
      correct, died,
      actual: this.ghost.data.key,
      picked: this.journalPick,
      base: died ? 5 : 25 * mult,
      bonus: correct ? 60 * mult : 0,
      objDone,
      objReward: objDone * 15 * mult,
      aliveBonus: died ? 0 : 20,
    };
    res.total = res.base + res.bonus + res.objReward + res.aliveBonus;
    this.progress.money += res.total;
    this.progress.contracts++;
    if (correct) { this.progress.correct++; audio.win(); }
    saveProgress(this.progress);
    this.state = 'results';
    menus.showResults(res);
  },

  changeFloor(entity, target) {
    entity.floor = target.floor;
    entity.x = target.x;
    entity.y = target.y;
    if (entity === this.player) {
      this.camera.snapTo(entity.x, entity.y);
      audio.setAmbience(true, entity.floor === FLOOR_BASEMENT);
    }
  },

  // ---------- Взаимодействия ----------
  findInteraction() {
    const pl = this.player;
    if (!pl.alive) return null;
    const R = TILE * 1.35;
    let best = null;
    const consider = (d2, obj) => { if (!best || d2 < best.d2) best = { ...obj, d2 }; };

    // фургон (задняя часть)
    const v = this.world.van;
    if (pl.floor === 0) {
      const d2 = (pl.x - (v.x + v.w / 2)) ** 2 + (pl.y - (v.y + v.h + 6)) ** 2;
      if (d2 < (TILE * 2.2) ** 2) consider(d2, { kind: 'van', label: 'ФУРГОН' });
    }
    // двери (приоритетнее прочих целей — умножаем дистанцию на 0.55)
    for (const d of this.world.doors) {
      if (d.floor !== pl.floor) continue;
      const dx = (d.tx + 0.5) * TILE - pl.x, dy = (d.ty + 0.5) * TILE - pl.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R) consider(d2 * 0.55, { kind: 'door', door: d, label: d.locked ? 'ЗАПЕРТО' : d.open ? 'ЗАКРЫТЬ' : 'ОТКРЫТЬ' });
    }
    // выключатели
    for (const room of this.world.rooms) {
      const sw = room.switch;
      if (!sw || room.floor !== pl.floor) continue;
      const d2 = (sw.x - pl.x) ** 2 + (sw.y - pl.y) ** 2;
      if (d2 < R * R) consider(d2, { kind: 'switch', room, label: room.lightOn ? 'СВЕТ ВЫКЛ' : 'СВЕТ ВКЛ' });
    }
    // щиток
    const br = this.world.breaker;
    if (br.floor === pl.floor) {
      const d2 = (br.x - pl.x) ** 2 + (br.y - pl.y) ** 2;
      if (d2 < R * R) consider(d2, { kind: 'breaker', label: br.on ? 'ЩИТОК ВЫКЛ' : 'ЩИТОК ВКЛ' });
    }
    // укрытия
    for (const h of this.world.hidingSpots) {
      if (h.floor !== pl.floor) continue;
      const d2 = (h.x - pl.x) ** 2 + (h.y - pl.y) ** 2;
      if (d2 < (TILE * 1.5) ** 2) consider(d2, { kind: 'hide', spot: h, label: 'СПРЯТАТЬСЯ' });
    }
    // подобрать размещённое
    for (let i = 0; i < this.world.placed.length; i++) {
      const p = this.world.placed[i];
      if (p.floor !== pl.floor) continue;
      const d2 = (p.x - pl.x) ** 2 + (p.y - pl.y) ** 2;
      if (d2 < (TILE * 0.9) ** 2 && pl.inventory.includes(null)) {
        consider(d2 + 200 /* низкий приоритет */, { kind: 'pickup', index: i, label: 'ПОДОБРАТЬ' });
      }
    }
    return best;
  },

  doInteract() {
    const pl = this.player;
    if (pl.hidden) {
      pl.hidden = null;
      pl.hiddenSeen = false;
      return;
    }
    const act = this.currentInteraction;
    if (!act) return;
    switch (act.kind) {
      case 'van': van.open(); break;
      case 'door': {
        const d = act.door;
        if (d.locked) { this.log('Дверь заперта!', 'danger'); return; }
        d.open = !d.open;
        d.targetSwing = d.open ? 1 : 0;
        d.open ? audio.doorOpen() : audio.doorClose();
        pl.noise = Math.max(pl.noise, 0.5); // двери шумят
        // закрываем дверь, стоя в проёме — мягко выйти из него
        if (!d.open) {
          const cx = (d.tx + 0.5) * TILE, cy = (d.ty + 0.5) * TILE;
          if (Math.abs(pl.x - cx) < TILE * 0.65 && Math.abs(pl.y - cy) < TILE * 0.65) {
            if (d.orient === 'h') pl.y = pl.y < cy ? d.ty * TILE - 10 : (d.ty + 1) * TILE + 10;
            else pl.x = pl.x < cx ? d.tx * TILE - 10 : (d.tx + 1) * TILE + 10;
          }
        }
        break;
      }
      case 'switch': {
        const room = act.room;
        if (!this.world.breaker.on) { this.log('Нет электричества'); audio.switchClick(); return; }
        room.lightOn = !room.lightOn;
        audio.switchClick();
        break;
      }
      case 'breaker': {
        const br = this.world.breaker;
        br.on = !br.on;
        br.on ? audio.breakerOn() : audio.breakerOff();
        break;
      }
      case 'hide': {
        pl.hidden = act.spot;
        // видел ли призрак, как игрок прятался (нужна прямая видимость!)
        pl.hiddenSeen = this.ghost.state === 'hunt' &&
          this.ghost.floor === pl.floor &&
          dist(this.ghost.x, this.ghost.y, pl.x, pl.y) < TILE * 6 &&
          hasLOS(this.ghost.x, this.ghost.y, pl.x, pl.y, this.world.getOccluders(pl.floor));
        audio.doorClose();
        break;
      }
      case 'pickup': {
        const p = this.world.placed[act.index];
        const free = pl.inventory.indexOf(null);
        if (free >= 0) {
          pl.inventory[free] = p.type;
          this.world.placed.splice(act.index, 1);
          audio.uiClick();
        }
        break;
      }
    }
  },

  // ---------- Обновление ----------
  update(dt) {
    this.time += dt;
    input.update();

    if (this.state === 'menu' || this.state === 'results') return;

    if (this.state === 'death-anim') {
      this.deathT -= dt;
      this.camera.update(dt);
      this.fx.update(dt, this);
      if (this.deathT <= 0) {
        this.state = 'dead';
        menus.showDeath();
      }
      return;
    }
    if (this.state === 'dead') return;

    const pl = this.player;

    // страховка: входная дверь заперта только во время охоты
    if (this.ghost && this.ghost.state !== 'hunt') {
      const fd = this.world.doors.find(d => d.id === this.world.frontDoorId);
      if (fd && fd.locked) fd.locked = false;
    }

    // подготовительная фаза
    if (this.setupPhase) {
      this.setupTimer -= dt;
      if (this.setupTimer <= 0) {
        this.setupPhase = false;
        this.log('Призрак пробудился…', 'danger');
      }
    }

    // ввод: одноразовые действия
    if (input.consume('journal')) journal.toggle();
    if (input.consume('back')) { journal.close(); van.close(); }
    if (!journal.isOpen && !van.isOpen) {
      this.currentInteraction = this.findInteraction();
      if (input.consume('interact')) this.doInteract();
      if (input.consume('use')) equipment.use(this);
      if (input.consume('ask') && pl.currentItem() === 'spirit') equipment.askSpirit(this);
      if (input.consume('cycle')) {
        pl.activeSlot = (pl.activeSlot + 1) % 3;
        audio.uiClick();
      }
      if (input.consume('flashlight')) {
        pl.flashlightOn = !pl.flashlightOn;
        audio.switchClick();
      }
    } else {
      input.clear();
    }

    // симуляция
    pl.update(dt, this);
    this.aggression = clamp((100 - pl.sanity) / 100, 0, 1);
    this.ghost.update(dt, this);
    worldSim.update(dt, this);
    equipment.update(dt, this);
    van.update(dt);

    // рассудок: дренаж в темноте
    if (pl.alive && this.world.isIndoors(pl.floor, pl.x, pl.y)) {
      const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
      const lit = room && room.lightOn && this.world.breaker.on;
      const mult = this.difficulty === 'pro' ? 1.7 : 1;
      pl.drainSanity(dt * (lit ? 0.10 : 0.33) * mult);
    }

    // эмбиент по локации
    if (this._wasIndoors === undefined) this._wasIndoors = null;
    const indoors = this.world.isIndoors(pl.floor, pl.x, pl.y);
    if (indoors !== this._wasIndoors) {
      this._wasIndoors = indoors;
      audio.setAmbience(indoors, pl.floor === FLOOR_BASEMENT);
    }

    // объективка: замер холода
    if (pl.currentItem() === 'thermo') {
      const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
      if (room && room.temp < 5) this.checkObjective('freezeRead');
    }
    if (equipment.emfLevel >= 2) this.checkObjective('emfAny');
    // событие засчитывается, только если игрок его реально видел или слышал вплотную
    if (this.ghost.state === 'event' &&
      (this.ghost.seenByPlayer(pl) ||
        (this.ghost.floor === pl.floor && dist(this.ghost.x, this.ghost.y, pl.x, pl.y) < TILE * 3.5))) {
      this.checkObjective('event');
    }
    // соль как задача
    if (this.world.saltPiles.some(s => s.disturbed && s.steps.length)) this.checkObjective('salt');
    // камера в комнате призрака
    for (const p of this.world.placed) {
      if (p.type === 'camera' &&
        this.world.roomAt(p.floor, p.x, p.y) === this.ghost.roomId) this.checkObjective('camera');
    }

    // длительность текущей охоты (для поздней подсказки на «Любителе»)
    if (this.ghost.state === 'hunt') this.huntTime = (this.huntTime || 0) + dt;

    // галлюцинации при низком рассудке: тень на краю зрения, шаги, ложный ЭМП
    if (this.hallucination) {
      this.hallucination.t -= dt;
      if (this.hallucination.t <= 0) this.hallucination = null;
    }
    this.hallucT = (this.hallucT ?? rndRange(15, 30)) - dt;
    if (this.hallucT <= 0) {
      this.hallucT = rndRange(16, 34);
      if (pl.sanity < 35 && pl.alive && this.world.isIndoors(pl.floor, pl.x, pl.y)) {
        const r = Math.random();
        if (r < 0.4) {
          // тень мелькает на границе видимости
          const a = pl.angle + rndRange(-1.1, 1.1);
          this.hallucination = {
            x: pl.x + Math.cos(a) * TILE * 5.5,
            y: pl.y + Math.sin(a) * TILE * 5.5,
            floor: pl.floor, t: 0.7, max: 0.7,
          };
        } else if (r < 0.7) audio.phantomSteps();
        else equipment.fakeEmfT = 1.2; // ложный всплеск на приборе
      }
    }

    // гроза: случайные молнии с громом
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightningT = 18 + Math.random() * 34;
      this.fx.lightning = 0.7 + Math.random() * 0.3;
      const closeness = Math.random();
      setTimeout(() => audio.thunder(closeness), 600 + (1 - closeness) * 2600);
    }

    // аудио-состояние
    const gh = this.ghost;
    let heartbeat = 0, huntNear = 0;
    if (gh.state === 'hunt' && gh.floor === pl.floor) {
      const d = dist(gh.x, gh.y, pl.x, pl.y);
      huntNear = clamp(1 - d / (TILE * 12), 0, 1);
      heartbeat = clamp(1 - d / (TILE * 14), 0.3, 1);
    } else if (pl.sanity < 25) heartbeat = 0.25;
    audio.update(dt, {
      heartbeat,
      huntNear,
      emfLevel: pl.currentItem() === 'emf' ? equipment.emfLevel : 0,
      spiritOn: pl.currentItem() === 'spirit' && !pl.hidden,
      lowSanity: pl.sanity < 40 && this.world.isIndoors(pl.floor, pl.x, pl.y),
    });

    // камера
    this.camera.follow(pl.x, pl.y, dt);
    this.camera.update(dt);
    this.lighting.update(dt, this);
    this.fx.update(dt, this);

    hud.update(this);
  },

  // ---------- Рендер ----------
  render() {
    if (this.state === 'menu' || this.state === 'results' || !this.renderer) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const pl = this.player;

    this.renderer.drawScene(ctx, this, cam, this.time);

    // видимость + свет (без мебели — шкафы не должны глотать свет)
    const occl = this.world.getOccluders(pl.floor, false);
    const maxR = pl.hidden ? TILE * 2.4 : Math.hypot(cam.viewW, cam.viewH) / 2 / cam.scale + TILE;
    const visPoly = computeVisibility(pl.x, pl.y, occl, maxR);
    this.lighting.render(this, cam, visPoly);
    this.lighting.compose(ctx, cam.viewW, cam.viewH);

    // пост-эффекты
    this.fx.drawScreen(ctx, cam.viewW, cam.viewH, this);

    // джойстики
    this.renderer.drawSticks(ctx, input);
  },
};

// ---------- Прогресс ----------
function loadProgress() {
  try {
    return Object.assign(
      { money: 0, contracts: 0, correct: 0, deaths: 0 },
      JSON.parse(localStorage.getItem('phasmo-progress') || '{}'));
  } catch { return { money: 0, contracts: 0, correct: 0, deaths: 0 }; }
}
function saveProgress(p) {
  try { localStorage.setItem('phasmo-progress', JSON.stringify(p)); } catch { /* приватный режим */ }
}

// ---------- Запуск ----------
function boot() {
  const canvas = document.getElementById('game');
  game.canvas = canvas;
  game.ctx = canvas.getContext('2d');

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    game.camera.resize(canvas.width, canvas.height);
    game.lighting.resize(canvas.width, canvas.height);
    game.fx.resize(canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));
  resize();

  input.init(canvas);
  hud.build();
  journal.build(game);
  van.build(game);
  menus.build(game);

  // разблокировка аудио первым жестом
  const unlock = () => { audio.init(); audio.resume(); };
  document.addEventListener('pointerdown', unlock, { once: true });

  // цикл: fixed timestep 60 Гц
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;
  function frame(t) {
    requestAnimationFrame(frame);
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 5) {
      game.update(STEP);
      acc -= STEP;
    }
    if (guard >= 5) acc = 0;
    game.render();
  }
  requestAnimationFrame(frame);
}

window.game = game; // для отладки и авто-тестов
boot();
