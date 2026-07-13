// ФАЗМОФОБИЯ — точка входа: игровой цикл, стейт-машина, взаимодействия.

import { TILE, clamp, rndPick, dist, hasLOS, rndRange, makeRng, setRng } from './core/utils.js';
import { input } from './core/input.js';
import { Camera } from './core/camera.js';
import { audio } from './core/audio.js';
import { buildWorld, FLOOR_BASEMENT, OUTSIDE } from './world/house.js';
import { furnish } from './world/furniture.js';
import { MAPS, composeBlueprint } from './world/maps.js';
import { computeVisibility } from './render/visibility.js';
import { Lighting } from './render/lighting.js';
import { FX } from './render/fx.js';
import { Renderer } from './render/renderer.js';
import { Player } from './entities/player.js';
import { Ghost } from './entities/ghost.js';
import { GHOSTS } from './systems/ghostData.js';
import { equipment, ITEMS } from './systems/equipment.js';
import { worldSim } from './systems/evidence.js';
import { Director } from './systems/director.js';
import { hud } from './ui/hud.js';
import { journal } from './ui/journal.js';
import { van } from './ui/van.js';
import { menus } from './ui/menus.js';

// комнатные микрособытия: у каждой комнаты — свой «голос»
const ROOM_FX = {
  bath: ['drip'], kitchen: ['dish', 'fridge'], dining: ['dish'], living: ['tv'],
  master: ['bed'], kids: ['toy'], garage: ['metal'], utility: ['metal', 'drip'],
  cellar: ['drip', 'pipe'], workshop: ['metal', 'pipe'], boiler: ['pipe', 'drip'],
  crypt: ['drip', 'pipe'], // погреб в катакомбах
};

const OBJECTIVE_POOL = [
  { key: 'photoGhost', name: 'Сфотографировать призрака' },
  { key: 'event', name: 'Стать свидетелем паранормального события' },
  { key: 'emfAny', name: 'Зафиксировать всплеск ЭМП детектором' },
  { key: 'freezeRead', name: 'Замерить температуру ниже 5°C' },
  { key: 'spirit', name: 'Получить ответ через спиритбокс' },
  { key: 'camera', name: 'Установить видеокамеру в комнате призрака' },
  { key: 'smudgeHunt', name: 'Отогнать призрака благовониями во время охоты' },
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
  stats: { wardSaves: 0, smudgeSaves: 0 },
  progress: loadProgress(),

  log(msg, cls = '') { hud.toast(msg, cls); },

  // ---------- Контракт ----------
  prepareContract(difficulty) {
    this.difficulty = difficulty;
    // сидированный RNG контракта: неудачную партию можно воспроизвести
    this.contractSeed = (Math.random() * 0x7fffffff) | 0;
    this.rng = makeRng(this.contractSeed);
    setRng(this.rng); // игровая логика контракта — на сидированном ГСЧ
    this.hintCooldown = 0;
    // карта и вариант подвала: выбор по сид-RNG (setRng уже активен) — партия
    // воспроизводима. debug-хуки: localStorage['phasmo-map'] и ['phasmo-basement'].
    let forced = null, forcedB = null;
    try {
      forced = localStorage.getItem('phasmo-map');
      forcedB = localStorage.getItem('phasmo-basement');
    } catch { /* приватный режим */ }
    const baseBp = (forced && MAPS.find(m => m.id === forced)) || rndPick(MAPS);
    const basementId = (forcedB === 'native' || forcedB === 'catacombs')
      ? forcedB : rndPick(['native', 'catacombs']);
    const blueprint = composeBlueprint(baseBp, basementId);
    this.blueprint = blueprint;
    this.world = buildWorld(blueprint);
    furnish(this.world, blueprint);
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
    this.stats = { wardSaves: 0, smudgeSaves: 0 };
    this.deathT = 0;
    this.fx.clear();

    // задачи: 3 случайных
    const pool = OBJECTIVE_POOL.slice();
    this.objectives = [];
    for (let i = 0; i < 3; i++) {
      const o = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      this.objectives.push({ ...o, done: false });
    }

    // подготовка защищает от смерти, но НЕ отключает хоррор и улики:
    // фоновые события, характерные проявления и улики идут с самого входа,
    // запрещены лишь настоящие охоты и опасные проявления.
    this.setupDuration = difficulty === 'pro' ? 0 : 80;
    this.setupTimer = this.setupDuration;
    this.setupPhase = difficulty !== 'pro';

    // процедурное досье жертвы — атмосфера контракта
    const first = rndPick(['Анна', 'Виктор', 'Ольга', 'Павел', 'Мария', 'Григорий', 'Тамара', 'Аркадий', 'Лидия', 'Семён']);
    const last = rndPick(['Волкова', 'Черных', 'Мельников', 'Соколова', 'Громов', 'Зимина', 'Крылов', 'Одинцова'])
      .replace(/а$/, first.endsWith('а') || first.endsWith('я') ? 'а' : '');
    this.dossier = {
      address: blueprint.address,
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

    this.director = new Director();
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
    // seed контракта для воспроизведения партий (debug)
    try { console.info(`[contract] seed=${this.contractSeed} map=${this.blueprint.id} basement=${this.blueprint.basementId} ghost=${this.ghost.data.key}`); } catch { /* нет консоли */ }
    if (localStorage.getItem('phasmo-debug')) this.log(`SEED ${this.contractSeed} · ${this.blueprint.id}/${this.blueprint.basementId} · ${this.ghost.data.key}`, 'evidence');
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

  // опасные проявления и настоящие охоты запрещены до конца подготовки
  canDanger() {
    return this.state === 'playing' && !this.setupPhase && this.player.alive;
  },

  // Засчитать «Стать свидетелем» за реально пережитое событие, а не только
  // за видимость модели призрака. source = {x,y,floor}.
  markEventWitnessed(type, source) {
    const pl = this.player;
    if (!pl.alive) return;
    const gh = this.ghost;
    const near = (r) => source && source.floor === pl.floor &&
      dist(source.x, source.y, pl.x, pl.y) < r;
    let ok = false;
    switch (type) {
      case 'manifest':
      case 'silhouette':
        ok = gh && gh.seenByPlayer(pl);
        break;
      case 'lightsOut': {
        const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
        ok = !!(room && !room.lightOn); // игрок в комнате, где погас свет
        break;
      }
      case 'falseHunt':
        ok = gh && gh.fakeHuntT > 0 && gh.floor === pl.floor &&
          dist(gh.x, gh.y, pl.x, pl.y) < TILE * 13;
        break;
      case 'knock':
        ok = near(TILE * 6);
        break;
      case 'propStorm':
        ok = near(TILE * 6) || (gh && gh.seenByPlayer(pl));
        break;
      case 'doorFury':
        ok = near(TILE * 8);
        break;
      default:
        ok = near(TILE * 6);
    }
    if (ok) this.checkObjective('event');
  },

  // Тихая обратная связь: подтвердить, что оборудование стоит правильно,
  // не выдавая улику бесплатно. Не чаще одного намёка в ~18 c.
  hint(msg) {
    if ((this.hintCooldown || 0) > 0) return;
    this.hintCooldown = 18;
    this.log(msg);
  },

  onHuntStart() {
    // фаза предупреждения: тот же «сбой электроники», что и у ложной охоты —
    // игрок не может отличить обманку от настоящей, пока не станет поздно.
    // Полноценный рёв прозвучит, когда призрак двинется (фаза поиска).
    audio.falseHuntCue();
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
    this.director.afterHunt(); // «послесловие»: дом надолго замолкает
    const front = this.world.doors.find(d => d.id === this.world.frontDoorId);
    if (front) front.locked = false;
  },

  // Кинематографичная смерть: мир глохнет и темнеет → шёпот →
  // лицо сущности в кадре со скримером → тьма и два последних удара сердца.
  killPlayer() {
    if (!this.player.alive) return;
    const pl = this.player, gh = this.ghost;
    pl.alive = false;
    this.state = 'death-anim';
    this.deathT = 3.4;
    this.deathFired = {};
    this.deathFace = 0;
    // вариант скримера (лицо по форме призрака + случайность) и хореография наезда
    const byForm = { lady: 1, shadow: 2, hangman: 3 };
    this.deathVariant = Math.random() < 0.2 ? (Math.random() * 4 | 0) : (byForm[gh.form] ?? 0);
    this.deathChoreo = Math.random() * 3 | 0;
    // призрак замирает вплотную перед жертвой
    gh.state = 'idle'; gh.stateT = 99; gh.huntPhase = null;
    gh.floor = pl.floor;
    gh.x = pl.x + Math.cos(pl.angle) * 18;
    gh.y = pl.y + Math.sin(pl.angle) * 18;
    gh.visibleAlpha = 0; gh.targetAlpha = 0;
    audio.duck(0.06, 0.15); // мир мгновенно глохнет
    const front = this.world.doors.find(d => d.id === this.world.frontDoorId);
    if (front) front.locked = false;
    this.progress.deaths++;
    saveProgress(this.progress);
  },

  finishContract(died = false) {
    if (this.state === 'results') return;
    van.close(); journal.close(); hud.hide();
    const correct = !died && this.journalPick === this.ghost.data.key;
    const mult = this.difficulty === 'pro' ? 2 : 1;
    const objDone = this.objectives.filter(o => o.done).length;
    const photos = (this.photos || []).filter(p => p.reward > 0);
    const res = {
      correct, died,
      actual: this.ghost.data.key,
      picked: this.journalPick,
      base: died ? 5 : 25 * mult,
      bonus: correct ? 60 * mult : 0,
      objDone,
      objReward: objDone * 15 * mult,
      aliveBonus: died ? 0 : 20,
      photoCount: photos.length,
      photoReward: photos.reduce((s, p) => s + p.reward, 0),
    };
    res.total = res.base + res.bonus + res.objReward + res.aliveBonus + res.photoReward;
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
    // лестницы: подняться/спуститься по кнопке действия
    for (const st of this.world.stairs) {
      if (st.floor !== pl.floor) continue;
      const t = st.tiles;
      // ближайшая точка прямоугольника ступеней к игроку
      const cx = clamp(pl.x, t.x * TILE, (t.x + t.w) * TILE);
      const cy = clamp(pl.y, t.y * TILE, (t.y + t.h) * TILE);
      const d2 = (cx - pl.x) ** 2 + (cy - pl.y) ** 2;
      if (d2 < (TILE * 1.1) ** 2) {
        consider(d2, { kind: 'stairs', stairs: st, label: st.dir === 'down' ? 'СПУСТИТЬСЯ' : 'ПОДНЯТЬСЯ' });
      }
    }
    // проклятый предмет
    const cu = this.world.cursed;
    if (cu && !cu.used && cu.floor === pl.floor) {
      const d2 = (cu.x - pl.x) ** 2 + (cu.y - pl.y) ** 2;
      const names = { musicbox: 'ШКАТУЛКА', mirror: 'ЗЕРКАЛО', doll: 'КУКЛА' };
      if (d2 < R * R) consider(d2, { kind: 'cursed', label: names[cu.type] });
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
      case 'stairs': {
        this.changeFloor(pl, act.stairs.target);
        pl.stairsCooldown = 0.6;
        audio.footstep(false);
        setTimeout(() => pl.alive && audio.footstep(false), 220);
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
      case 'cursed': this.useCursed(); break;
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

  // Проклятые предметы: добровольный риск в обмен на информацию или хаос
  useCursed() {
    const cu = this.world.cursed;
    const pl = this.player;
    const gh = this.ghost;
    if (!cu || cu.used) return;
    if (cu.type === 'musicbox') {
      // мелодия манит призрака; если он дослушает рядом — быть беде
      cu.used = true;
      cu.activeT = 8;
      audio.musicBox();
      pl.drainSanity(15);
      this.log('Шкатулка заиграла сама собой…', 'danger');
      gh.cursedLure = { x: cu.x, y: cu.y, floor: cu.floor, t: 8 };
    } else if (cu.type === 'mirror') {
      cu.used = true;
      pl.drainSanity(20);
      this.fx.flash = Math.max(this.fx.flash, 0.15);
      audio.whisper();
      this.log(`В треснувшем зеркале мелькнуло: ${gh.room.name}`, 'danger');
      if (Math.random() < 0.25 && this.canHunt()) gh.tryStartHunt(this, true);
    } else { // кукла
      cu.used = true;
      pl.drainSanity(10);
      gh.teleportNearPlayer(this);
      audio.knockRaps(audio.panFor(gh.x));
      gh.activity = Math.min(10, gh.activity + 5);
      this.log('Кукла повернула голову. Оно рядом.', 'danger');
    }
  },

  // ---------- Обновление ----------
  update(dt) {
    this.time += dt;
    input.update();

    if (this.state === 'menu' || this.state === 'results') return;

    if (this.state === 'death-anim') {
      this.deathT -= dt;
      const t = 3.4 - this.deathT;
      const fire = (k, fn) => { if (t >= k && !this.deathFired[k]) { this.deathFired[k] = 1; fn(); } };
      fire(0.65, () => { audio.whisper(); this.ghost.visibleAlpha = 0.9; });
      fire(1.15, () => {
        audio.unduck(0.04);
        audio.jumpscare(this.deathVariant || 0);
        this.camera.shake(7, 1.0);
        this.deathFace = 1;
        try { navigator.vibrate?.([180, 70, 240]); } catch { /* нет поддержки */ }
      });
      fire(2.55, () => { audio.duck(0.12, 0.5); audio.death(); this.deathFace = 0; });
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
    this.director.update(dt, this);
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

    // тихая обратная связь: «правильно ли стоит оборудование»
    this.hintCooldown = Math.max(0, (this.hintCooldown || 0) - dt);

    // объективка: замер холода
    if (pl.currentItem() === 'thermo') {
      const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
      if (room && room.temp < 5) this.checkObjective('freezeRead');
      // температура падает, но ещё не улика — подсказать, что комната «та самая»
      if (room && room.id === this.ghost.roomId && room.temp > 0 && room.temp < 6 &&
        this.ghost.data.ev.includes('freezing')) {
        this.hint('Температура продолжает падать.');
      }
    }
    if (equipment.emfLevel >= 2) this.checkObjective('emfAny');
    // спиритбокс в верных условиях, но пока без ответа — «помехи стали плотнее»
    if (pl.currentItem() === 'spirit' && !pl.hidden) {
      const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
      const dark = !room || !room.lightOn || !this.world.breaker.on;
      const near = this.ghost.floor === pl.floor && dist(this.ghost.x, this.ghost.y, pl.x, pl.y) < TILE * 6;
      if (dark && near && this.ghost.data.ev.includes('spirit') && equipment.spiritCooldown <= 0) {
        this.hint('Помехи стали плотнее…');
      }
    }
    // событие засчитывается за реальное переживание, а не только видимость модели
    if (this.ghost.state === 'event') {
      this.markEventWitnessed(this.ghost.eventType || 'manifest',
        { x: this.ghost.x, y: this.ghost.y, floor: this.ghost.floor });
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
        const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
        const dark = !room || !room.lightOn || !this.world.breaker.on;
        const r = Math.random();
        if (r < 0.32) {
          // тень мелькает на границе видимости
          const a = pl.angle + rndRange(-1.1, 1.1);
          this.hallucination = {
            x: pl.x + Math.cos(a) * TILE * 5.5,
            y: pl.y + Math.sin(a) * TILE * 5.5,
            floor: pl.floor, t: 0.7, max: 0.7,
          };
        } else if (r < 0.55 && dark) {
          // пара тусклых глаз во тьме на краю зрения (гаснут под лучом фонаря)
          const a = pl.angle + rndRange(-1.3, 1.3);
          this.hallucination = {
            x: pl.x + Math.cos(a) * TILE * 6, y: pl.y + Math.sin(a) * TILE * 6,
            floor: pl.floor, t: 1.6, max: 1.6, eyes: true,
          };
          audio.whisper();
        } else if (r < 0.78) audio.phantomSteps();
        else equipment.fakeEmfT = 1.2; // ложный всплеск на приборе
      }
    }

    // комнатные микрособытия: у каждой комнаты свой «голос»
    this.tvStaticT = Math.max(0, (this.tvStaticT || 0) - dt);
    if (this.world.cursed && this.world.cursed.activeT > 0) this.world.cursed.activeT -= dt;
    this.roomFxT = (this.roomFxT ?? rndRange(10, 18)) - dt;
    if (this.roomFxT <= 0) {
      this.roomFxT = rndRange(14, 30);
      const room = this.world.roomById(this.world.roomAt(pl.floor, pl.x, pl.y));
      const kinds = room && ROOM_FX[room.key];
      if (kinds && pl.alive) {
        const kind = rndPick(kinds);
        // «голос» комнаты звучит из её стороны (панорама по центру комнаты)
        const rc = room.rects[0];
        const pan = audio.panFor((rc.x + rc.w / 2) * TILE);
        if (kind === 'tv') { this.tvStaticT = 1.15; audio.roomTone('tv', pan); }
        else audio.roomTone(kind, pan);
        if (Math.random() < 0.3) pl.drainSanity(0.5);
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
    // дыхание игрока: в укрытии и при низком рассудке; сильнее, если призрак рядом
    let breath = 0;
    if (pl.alive) {
      const ghSameFloor = gh.floor === pl.floor;
      const ghD = ghSameFloor ? dist(gh.x, gh.y, pl.x, pl.y) : 1e9;
      if (pl.hidden) breath = clamp(0.45 + (1 - ghD / (TILE * 8)) * 0.5, 0.4, 1);
      else if (pl.sanity < 25) breath = clamp((25 - pl.sanity) / 25 * 0.6, 0, 0.6);
      if (gh.state === 'hunt' && ghD < TILE * 8) breath = Math.max(breath, 0.85);
    }
    // шаги призрака над головой: игрок в подвале, призрак ходит по первому этажу
    let stepsAbove = 0, aboveX = pl.x;
    if (pl.floor === FLOOR_BASEMENT && gh.floor === 0 && gh.state !== 'hunt') {
      stepsAbove = 0.7; aboveX = gh.x;
    }
    // позиция слушателя для панорамы позиционных звуков
    audio.setListener(pl.x, pl.y, pl.floor);
    audio.update(dt, {
      heartbeat,
      huntNear,
      hunt: gh.state === 'hunt',
      preHunt: gh.state === 'hunt' && gh.huntPhase === 'warn', // мёртвая тишина перед броском
      breath, stepsAbove, aboveX,
      ghostX: gh.x, ghostFloor: gh.floor, // шаги охоты идут из реальной стороны
      // темп шагов призрака: в погоне — частые, у Ревенанта вне погони — редкие тяжёлые
      ghostStepInt: gh.huntPhase === 'chase' ? 0.34
        : (gh.tr.slowSpeed !== undefined ? 1.05 : 0.58),
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

    // периферийное наблюдение освещённых комнат через открытую дверь
    // (отдельный слой поверх тьмы; не влияет на LOS, фото и улики)
    if (!pl.hidden && this.world.isIndoors(pl.floor, pl.x, pl.y)) {
      this.renderer.drawPeripheralLitRooms(ctx, this, cam);
    }

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
