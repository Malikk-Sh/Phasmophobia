// Мир: планировка дома (1 этаж + подвал), комнаты, двери, окна, лестницы.
// Подход: оболочка дома заливается стеной, комнаты «вырезаются» изнутри —
// так стены, коллизии и окклюдеры света всегда согласованы.

import { TILE } from '../core/utils.js';

export const FLOOR_GROUND = 0;
export const FLOOR_BASEMENT = -1;
export const OUTSIDE = -1; // roomId улицы

class FloorGrid {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.solid = new Uint8Array(W * H);   // 1 = стена
    this.roomId = new Int16Array(W * H).fill(OUTSIDE);
    this.outdoor = new Uint8Array(W * H); // 1 = под открытым небом
    this.segs = []; // статические сегменты стен (для света/LOS)
  }
  idx(x, y) { return y * this.W + x; }
  inB(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  isSolid(x, y) { return !this.inB(x, y) ? 1 : this.solid[this.idx(x, y)]; }
  roomAt(x, y) { return !this.inB(x, y) ? OUTSIDE : this.roomId[this.idx(x, y)]; }

  fillSolid(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.solid[this.idx(i, j)] = 1;
  }
  carve(x, y, w, h, room) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const k = this.idx(i, j);
      this.solid[k] = 0; this.roomId[k] = room; this.outdoor[k] = 0;
    }
  }
  setOutdoor(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.outdoor[this.idx(i, j)] = 1;
  }

  // Жадное объединение стен в прямоугольники → сегменты рёбер
  buildSegments() {
    const { W, H } = this;
    const used = new Uint8Array(W * H);
    const rects = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!this.solid[this.idx(x, y)] || used[this.idx(x, y)]) continue;
        let w = 1;
        while (x + w < W && this.solid[this.idx(x + w, y)] && !used[this.idx(x + w, y)]) w++;
        let h = 1;
        outer: while (y + h < H) {
          for (let i = 0; i < w; i++) if (!this.solid[this.idx(x + i, y + h)] || used[this.idx(x + i, y + h)]) break outer;
          h++;
        }
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[this.idx(x + i, y + j)] = 1;
        rects.push({ x, y, w, h });
      }
    }
    this.wallRects = rects;
    this.segs = [];
    for (const r of rects) {
      const x1 = r.x * TILE, y1 = r.y * TILE, x2 = (r.x + r.w) * TILE, y2 = (r.y + r.h) * TILE;
      this.segs.push({ x1, y1, x2, y2: y1 });       // верх
      this.segs.push({ x1, y1: y2, x2, y2 });       // низ
      this.segs.push({ x1, y1, x2: x1, y2 });       // лево
      this.segs.push({ x1: x2, y1, x2, y2 });       // право
    }
  }
}

export function buildWorld() {
  const rooms = [];
  const doors = [];
  const windows = [];
  const stairs = [];

  let nextRoom = 0;
  function addRoom(key, name, floor, opts = {}) {
    const r = {
      id: nextRoom++, key, name, floor,
      rects: [], lamps: [], switch: null,
      lightOn: false, lightBroken: false,
      temp: floor === FLOOR_BASEMENT ? 11 : 15,
      baseTemp: floor === FLOOR_BASEMENT ? 11 : 15,
      ...opts,
    };
    rooms.push(r);
    return r;
  }

  // ================= ПЕРВЫЙ ЭТАЖ (48 x 34) =================
  const g = new FloorGrid(48, 34);
  g.setOutdoor(0, 0, 48, 34);

  // Оболочка дома: cols 10..40, rows 5..24
  g.fillSolid(10, 5, 31, 20);

  function carveRoom(room, grid, x, y, w, h) {
    grid.carve(x, y, w, h, room.id);
    room.rects.push({ x, y, w, h });
  }

  const garage = addRoom('garage', 'Гараж', 0);
  const utility = addRoom('utility', 'Прачечная', 0);
  const kitchen = addRoom('kitchen', 'Кухня', 0);
  const dining = addRoom('dining', 'Столовая', 0);
  const hall = addRoom('hall', 'Коридор', 0);
  const master = addRoom('master', 'Спальня', 0);
  const bath = addRoom('bath', 'Ванная', 0);
  const living = addRoom('living', 'Гостиная', 0);
  const kids = addRoom('kids', 'Детская', 0);

  carveRoom(garage, g, 11, 6, 8, 7);
  carveRoom(utility, g, 20, 6, 4, 7);
  carveRoom(kitchen, g, 25, 6, 7, 7);
  carveRoom(dining, g, 33, 6, 7, 7);
  carveRoom(hall, g, 11, 14, 29, 3);
  carveRoom(master, g, 11, 18, 7, 6);
  carveRoom(bath, g, 19, 18, 4, 6);
  carveRoom(living, g, 24, 18, 10, 6);
  carveRoom(kids, g, 35, 18, 5, 6);

  // Двери (tx, ty — тайл в стене; carve + объект двери)
  let nextDoor = 0;
  function addDoor(grid, floor, tx, ty, orient, opts = {}) {
    grid.carve(tx, ty, 1, 1, opts.roomId ?? OUTSIDE);
    // тайл двери принадлежит комнате рядом (для карты) — не критично
    const d = {
      id: nextDoor++, floor, tx, ty, orient,
      open: opts.open ?? false, swing: opts.open ? 1 : 0, // 0 закрыта, 1 открыта (анимация)
      locked: false, isFront: !!opts.isFront,
      touchedUV: 0, // время появления УФ-отпечатка
    };
    doors.push(d);
    return d;
  }
  // проёмы без двери (арки)
  function carveArch(grid, tx, ty, w, h) { grid.carve(tx, ty, w, h, hall.id); }

  addDoor(g, 0, 14, 13, 'h'); // гараж
  addDoor(g, 0, 21, 13, 'h'); // прачечная
  addDoor(g, 0, 36, 13, 'h'); // столовая
  addDoor(g, 0, 14, 17, 'h'); // спальня
  addDoor(g, 0, 20, 17, 'h'); // ванная
  addDoor(g, 0, 37, 17, 'h'); // детская
  carveArch(g, 27, 13, 2, 1); // кухня — арка
  carveArch(g, 27, 17, 3, 1); // гостиная — широкая арка
  const frontDoor = addDoor(g, 0, 10, 15, 'v', { isFront: true });

  // Крыльцо (снаружи, деревянный настил)
  const PORCH = { x: 7, y: 14, w: 3, h: 3 };

  // Окна (декор + лунный свет внутрь): по внешним стенам
  const winList = [
    [13, 5, 'h'], [16, 5, 'h'], [27, 5, 'h'], [30, 5, 'h'], [35, 5, 'h'], [38, 5, 'h'],
    [13, 24, 'h'], [16, 24, 'h'], [27, 24, 'h'], [31, 24, 'h'], [36, 24, 'h'], [38, 24, 'h'],
    [40, 8, 'v'], [40, 10, 'v'], [40, 20, 'v'], [40, 22, 'v'],
    [10, 19, 'v'], [10, 21, 'v'],
  ];
  for (const [tx, ty, o] of winList) windows.push({ floor: 0, tx, ty, orient: o });
  // Ворота гаража (декор на западной стене)
  const garageDoorDecor = { floor: 0, tx: 10, ty: 7, h: 5 };

  // Лестница в подвал: в прачечной, тайлы (22..23, 6..8), триггер на row 6
  const stairsDown = {
    floor: 0, tiles: { x: 22, y: 6, w: 2, h: 3 },
    trigger: { x: 22, y: 6, w: 2, h: 1 },
    target: { floor: FLOOR_BASEMENT, x: 4 * TILE, y: 5.5 * TILE },
    dir: 'down',
  };
  stairs.push(stairsDown);

  // ================= ПОДВАЛ (30 x 18) =================
  const b = new FloorGrid(30, 18);
  // подвал не под открытым небом
  b.outdoor.fill(0);
  b.fillSolid(0, 0, 30, 18); // всё камень

  const cellar = addRoom('cellar', 'Кладовая', FLOOR_BASEMENT);
  const workshop = addRoom('workshop', 'Мастерская', FLOOR_BASEMENT);
  const boiler = addRoom('boiler', 'Котельная', FLOOR_BASEMENT);

  carveRoom(cellar, b, 3, 3, 12, 6);    // rows 3..8
  carveRoom(workshop, b, 3, 10, 12, 5); // rows 10..14
  carveRoom(boiler, b, 16, 3, 11, 12);  // cols 16..26
  addDoor(b, FLOOR_BASEMENT, 8, 9, 'h');   // кладовая-мастерская
  addDoor(b, FLOOR_BASEMENT, 15, 5, 'v');  // кладовая-котельная
  addDoor(b, FLOOR_BASEMENT, 15, 12, 'v'); // мастерская-котельная

  // Лестница вверх: в кладовой, тайлы (3..4, 3..5), триггер row 3
  const stairsUp = {
    floor: FLOOR_BASEMENT, tiles: { x: 3, y: 3, w: 2, h: 3 },
    trigger: { x: 3, y: 3, w: 2, h: 1 },
    target: { floor: 0, x: 22.9 * TILE, y: 8.4 * TILE },
    dir: 'up',
  };
  stairs.push(stairsUp);
  // стыковка: триггер вниз ведёт на низ лестницы подвала
  stairsDown.target = { floor: FLOOR_BASEMENT, x: 3.9 * TILE, y: 6.4 * TILE };
  stairsUp.target = { floor: 0, x: 22.9 * TILE, y: 8.6 * TILE };

  // Лампы и выключатели
  function lampAt(room, tx, ty) { room.lamps.push({ x: tx * TILE, y: ty * TILE }); }
  function switchAt(room, tx, ty) { room.switch = { x: tx * TILE, y: ty * TILE, room: room.id, touchedUV: 0 }; }

  lampAt(garage, 15, 9.5); switchAt(garage, 15.4, 12.4);
  lampAt(utility, 21, 10); switchAt(utility, 22.3, 12.4);
  lampAt(kitchen, 28.5, 9.5); switchAt(kitchen, 26.3, 12.4);
  lampAt(dining, 36.5, 9.5); switchAt(dining, 37.3, 12.4);
  lampAt(hall, 16, 15.5); lampAt(hall, 25.5, 15.5); lampAt(hall, 34, 15.5);
  switchAt(hall, 11.7, 15.5);
  lampAt(master, 14.5, 21); switchAt(master, 15.3, 17.6);
  lampAt(bath, 21, 21); switchAt(bath, 21.3, 17.6);
  lampAt(living, 29, 20.5); switchAt(living, 30.6, 17.6);
  lampAt(kids, 37.5, 21); switchAt(kids, 38.2, 17.6);
  lampAt(cellar, 9, 6); switchAt(cellar, 5.6, 3.7);
  lampAt(workshop, 9, 12.5); switchAt(workshop, 9.3, 9.7);
  lampAt(boiler, 21.5, 9); switchAt(boiler, 16.4, 5.8);

  // Щиток (в гараже, у западной стены)
  const breaker = { floor: 0, x: 11.5 * TILE, y: 7.4 * TILE, on: true, touchedUV: 0 };

  // Сегменты стен
  g.buildSegments();
  b.buildSegments();

  const floors = { [FLOOR_GROUND]: g, [FLOOR_BASEMENT]: b };

  // Фургон и спавн (мир в пикселях)
  const van = { x: 1.8 * TILE, y: 9 * TILE, w: 3 * TILE, h: 6 * TILE }; // прямоугольник кузова
  const spawn = { x: 5.7 * TILE, y: 15.6 * TILE };

  const world = {
    floors, rooms, doors, windows, stairs, breaker,
    frontDoorId: frontDoor.id,
    porch: PORCH, garageDoorDecor,
    van, spawn,
    emfEvents: [],   // {x,y,floor,level,t}
    prints: [],      // УФ-отпечатки {x,y,floor,t,kind}
    saltPiles: [],   // {x,y,floor,disturbed,step:[]}
    placed: [],      // размещённое снаряжение
    props: [],       // бросаемые предметы (заполняет furniture.js)
    hidingSpots: [], // {x,y,floor,w,h,name} (заполняет furniture.js)

    roomAt(floor, wx, wy) {
      const f = floors[floor];
      if (!f) return OUTSIDE;
      return f.roomAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
    },
    roomById(id) { return id >= 0 ? rooms[id] : null; },
    isIndoors(floor, wx, wy) {
      if (floor === FLOOR_BASEMENT) return true;
      const f = floors[floor];
      const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
      if (!f.inB(tx, ty)) return false;
      return !f.outdoor[f.idx(tx, ty)] || f.roomAt(tx, ty) !== OUTSIDE;
    },
    doorAt(floor, tx, ty) {
      return doors.find(d => d.floor === floor && d.tx === tx && d.ty === ty);
    },
    // твёрдость для движения (стены + закрытые двери)
    isBlocked(floor, tx, ty) {
      const f = floors[floor];
      if (!f) return true;
      if (f.isSolid(tx, ty)) return true;
      const d = this.doorAt(floor, tx, ty);
      if (d && d.swing < 0.35) return true;
      return false;
    },
    // проходимость для ИИ (двери призрак игнорирует)
    isWalkableAI(floor, tx, ty) {
      const f = floors[floor];
      if (!f) return false;
      if (!f.inB(tx, ty)) return false;
      if (f.isSolid(tx, ty)) return false;
      // призрак ходит только по дому
      if (floor === 0 && f.roomAt(tx, ty) === OUTSIDE && !this.doorAt(floor, tx, ty)) return false;
      return true;
    },
    // сегменты-окклюдеры для этажа.
    // includeFurniture=true — для ИИ (LOS призрака); false — для визуального
    // тумана войны, чтобы шкафы не превращались в чёрные дыры.
    getOccluders(floor, includeFurniture = true) {
      const f = floors[floor];
      const segs = f.segs.slice();
      for (const d of doors) {
        if (d.floor !== floor || d.swing > 0.6) continue;
        const x = d.tx * TILE, y = d.ty * TILE;
        if (d.orient === 'h') segs.push({ x1: x, y1: y + TILE / 2, x2: x + TILE, y2: y + TILE / 2 });
        else segs.push({ x1: x + TILE / 2, y1: y, x2: x + TILE / 2, y2: y + TILE });
      }
      if (includeFurniture) {
        for (const fu of (this.tallOccluders?.[floor] || [])) segs.push(fu);
      }
      return segs;
    },
  };

  return world;
}
