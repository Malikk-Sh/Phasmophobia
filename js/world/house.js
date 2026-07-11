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

export function buildWorld(blueprint) {
  const bp = blueprint;
  const rooms = [];
  const doors = [];
  const windows = [];
  const stairs = [];
  const roomByKey = {};

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
    roomByKey[key] = r;
    return r;
  }
  function carveRoom(room, grid, x, y, w, h) {
    grid.carve(x, y, w, h, room.id);
    room.rects.push({ x, y, w, h });
  }

  // Двери (tx, ty — тайл в стене; carve + объект двери)
  let nextDoor = 0;
  function addDoor(grid, floor, tx, ty, orient, opts = {}) {
    grid.carve(tx, ty, 1, 1, opts.roomId ?? OUTSIDE);
    const d = {
      id: nextDoor++, floor, tx, ty, orient,
      open: opts.open ?? false, swing: opts.open ? 1 : 0, // 0 закрыта, 1 открыта (анимация)
      locked: false, isFront: !!opts.isFront,
      touchedUV: 0, // время появления УФ-отпечатка
    };
    doors.push(d);
    return d;
  }
  function lampAt(room, tx, ty) { room.lamps.push({ x: tx * TILE, y: ty * TILE }); }
  function switchAt(room, tx, ty) { room.switch = { x: tx * TILE, y: ty * TILE, room: room.id, touchedUV: 0 }; }

  // ================= ПЕРВЫЙ ЭТАЖ =================
  const gc = bp.ground;
  const g = new FloorGrid(gc.W, gc.H);
  g.setOutdoor(0, 0, gc.W, gc.H);
  g.fillSolid(gc.shell.x, gc.shell.y, gc.shell.w, gc.shell.h); // оболочка дома
  for (const rd of gc.rooms) {
    const room = addRoom(rd.key, rd.name, 0);
    carveRoom(room, g, rd.rect.x, rd.rect.y, rd.rect.w, rd.rect.h);
  }
  let frontDoor = null;
  for (const d of gc.doors) {
    const dd = addDoor(g, 0, d.tx, d.ty, d.orient, { isFront: d.front });
    if (d.front) frontDoor = dd;
  }
  // проёмы без двери (арки) — тайл принадлежит указанной комнате
  for (const a of (gc.arches || [])) g.carve(a.tx, a.ty, a.w, a.h, roomByKey[a.room].id);

  const PORCH = { ...bp.porch };
  for (const [tx, ty, o] of gc.windows) windows.push({ floor: 0, tx, ty, orient: o });
  const garageDoorDecor = gc.garageDoorDecor ? { floor: 0, ...gc.garageDoorDecor } : null;

  // ================= ПОДВАЛ =================
  const bc = bp.basement;
  const b = new FloorGrid(bc.W, bc.H);
  b.outdoor.fill(0);         // подвал не под открытым небом
  b.fillSolid(0, 0, bc.W, bc.H); // всё камень
  for (const rd of bc.rooms) {
    const room = addRoom(rd.key, rd.name, FLOOR_BASEMENT);
    carveRoom(room, b, rd.rect.x, rd.rect.y, rd.rect.w, rd.rect.h);
  }
  for (const d of bc.doors) addDoor(b, FLOOR_BASEMENT, d.tx, d.ty, d.orient);

  // Лестницы (цели — в пикселях)
  const mkStair = (s) => ({
    floor: s.floor, tiles: { ...s.tiles }, trigger: { ...s.trigger },
    target: { floor: s.target.floor, x: s.target.x * TILE, y: s.target.y * TILE }, dir: s.dir,
  });
  const stairsDown = mkStair(bp.stairs.down);
  const stairsUp = mkStair(bp.stairs.up);
  stairs.push(stairsDown, stairsUp);

  // Лампы и выключатели
  for (const [key, tx, ty] of gc.lamps) lampAt(roomByKey[key], tx, ty);
  for (const [key, tx, ty] of gc.switches) switchAt(roomByKey[key], tx, ty);
  for (const [key, tx, ty] of bc.lamps) lampAt(roomByKey[key], tx, ty);
  for (const [key, tx, ty] of bc.switches) switchAt(roomByKey[key], tx, ty);

  // Щиток
  const breaker = { floor: 0, x: gc.breaker.x * TILE, y: gc.breaker.y * TILE, on: true, touchedUV: 0 };

  // Сегменты стен
  g.buildSegments();
  b.buildSegments();

  const floors = { [FLOOR_GROUND]: g, [FLOOR_BASEMENT]: b };

  // Фургон, спавн и опорная точка ТВ (мир в пикселях)
  const van = { x: bp.van.x * TILE, y: bp.van.y * TILE, w: bp.van.w * TILE, h: bp.van.h * TILE };
  const spawn = { x: bp.spawn.x * TILE, y: bp.spawn.y * TILE };
  const tv = bp.tv ? { x: bp.tv.x * TILE, y: bp.tv.y * TILE, floor: bp.tv.floor } : null;

  const world = {
    floors, rooms, doors, windows, stairs, breaker,
    frontDoorId: frontDoor.id,
    porch: PORCH, garageDoorDecor,
    van, spawn, tv,
    decor: bp.decor || [],
    blueprint: bp,
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
