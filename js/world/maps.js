// Реестр карт («чертежи»). Планировка — чистые данные в тайловых единицах;
// их потребляют buildWorld (house.js), furnish (furniture.js) и Renderer.
// Добавить новую карту = добавить объект в MAPS: движок (A*, туман войны,
// улики, выбор комнаты призрака, монитор) работает поверх данных без правок.
//
// Единицы: всё в тайлах (TILE=32). Потребители домножают на TILE.
// Мебель: [type, floor, tx, ty, tw, th, opts?]. Пропсы: [type, floor, tx, ty].
// Декор: типизированные декали {kind, floor, ...} — «магические координаты»,
// что раньше рисовались руками в renderer (paintDetails/buildGround/buildBasement).

const willow = {
  id: 'willow',
  name: 'Дом на Уиллоу-Крик',
  address: 'Уиллоу-Крик, д. 13',

  ground: {
    W: 48, H: 34,
    shell: { x: 10, y: 5, w: 31, h: 20 },
    rooms: [
      { key: 'garage', name: 'Гараж', rect: { x: 11, y: 6, w: 8, h: 7 } },
      { key: 'utility', name: 'Прачечная', rect: { x: 20, y: 6, w: 4, h: 7 } },
      { key: 'kitchen', name: 'Кухня', rect: { x: 25, y: 6, w: 7, h: 7 } },
      { key: 'dining', name: 'Столовая', rect: { x: 33, y: 6, w: 7, h: 7 } },
      { key: 'hall', name: 'Коридор', rect: { x: 11, y: 14, w: 29, h: 3 } },
      { key: 'master', name: 'Спальня', rect: { x: 11, y: 18, w: 7, h: 6 } },
      { key: 'bath', name: 'Ванная', rect: { x: 19, y: 18, w: 4, h: 6 } },
      { key: 'living', name: 'Гостиная', rect: { x: 24, y: 18, w: 10, h: 6 } },
      { key: 'kids', name: 'Детская', rect: { x: 35, y: 18, w: 5, h: 6 } },
    ],
    doors: [
      { tx: 14, ty: 13, orient: 'h' }, // гараж
      { tx: 21, ty: 13, orient: 'h' }, // прачечная
      { tx: 36, ty: 13, orient: 'h' }, // столовая
      { tx: 14, ty: 17, orient: 'h' }, // спальня
      { tx: 20, ty: 17, orient: 'h' }, // ванная
      { tx: 37, ty: 17, orient: 'h' }, // детская
      { tx: 10, ty: 15, orient: 'v', front: true },
    ],
    arches: [
      { tx: 27, ty: 13, w: 2, h: 1, room: 'hall' }, // кухня — арка
      { tx: 27, ty: 17, w: 3, h: 1, room: 'hall' }, // гостиная — широкая арка
    ],
    windows: [
      [13, 5, 'h'], [16, 5, 'h'], [27, 5, 'h'], [30, 5, 'h'], [35, 5, 'h'], [38, 5, 'h'],
      [13, 24, 'h'], [16, 24, 'h'], [27, 24, 'h'], [31, 24, 'h'], [36, 24, 'h'], [38, 24, 'h'],
      [40, 8, 'v'], [40, 10, 'v'], [40, 20, 'v'], [40, 22, 'v'],
      [10, 19, 'v'], [10, 21, 'v'],
    ],
    garageDoorDecor: { tx: 10, ty: 7, h: 5 },
    lamps: [
      ['garage', 15, 9.5], ['utility', 21, 10], ['kitchen', 28.5, 9.5], ['dining', 36.5, 9.5],
      ['hall', 16, 15.5], ['hall', 25.5, 15.5], ['hall', 34, 15.5],
      ['master', 14.5, 21], ['bath', 21, 21], ['living', 29, 20.5], ['kids', 37.5, 21],
    ],
    switches: [
      ['garage', 15.4, 12.4], ['utility', 22.3, 12.4], ['kitchen', 26.3, 12.4], ['dining', 37.3, 12.4],
      ['hall', 13.2, 14.4], ['master', 15.3, 17.6], ['bath', 21.3, 17.6],
      ['living', 30.6, 17.6], ['kids', 38.2, 17.6],
    ],
    breaker: { x: 11.5, y: 7.4 },
  },

  basement: {
    W: 30, H: 18,
    rooms: [
      { key: 'cellar', name: 'Кладовая', rect: { x: 3, y: 3, w: 12, h: 6 } },
      { key: 'workshop', name: 'Мастерская', rect: { x: 3, y: 10, w: 12, h: 5 } },
      { key: 'boiler', name: 'Котельная', rect: { x: 16, y: 3, w: 11, h: 12 } },
    ],
    doors: [
      { tx: 8, ty: 9, orient: 'h' },  // кладовая-мастерская
      { tx: 15, ty: 5, orient: 'v' }, // кладовая-котельная
      { tx: 15, ty: 12, orient: 'v' },// мастерская-котельная
    ],
    lamps: [['cellar', 9, 6], ['workshop', 9, 12.5], ['boiler', 21.5, 9]],
    switches: [['cellar', 5.6, 3.7], ['workshop', 9.3, 9.7], ['boiler', 16.4, 5.8]],
  },

  stairs: {
    down: {
      floor: 0, tiles: { x: 22, y: 6, w: 2, h: 3 }, trigger: { x: 22, y: 6, w: 2, h: 1 },
      target: { floor: -1, x: 3.9, y: 6.4 }, dir: 'down',
    },
    up: {
      floor: -1, tiles: { x: 3, y: 3, w: 2, h: 3 }, trigger: { x: 3, y: 3, w: 2, h: 1 },
      target: { floor: 0, x: 22.9, y: 8.6 }, dir: 'up',
    },
  },

  van: { x: 1.8, y: 9, w: 3, h: 6 },
  spawn: { x: 5.7, y: 15.6 },
  porch: { x: 7, y: 14, w: 3, h: 3 },
  tv: { x: 25.6, y: 18.35, floor: 0 },

  furniture: [
    // Гараж
    ['car', 0, 11.4, 8.0, 2.5, 3.6],
    ['workbench', 0, 16.4, 6.15, 2.4, 0.85],
    ['shelfTall', 0, 11.15, 10.2, 0.75, 2.4, { tall: true }],
    ['locker', 0, 18.05, 8.3, 0.9, 1.7, { tall: true, hide: true, name: 'Шкафчик' }],
    ['tires', 0, 16.9, 11.8, 1.0, 1.0],
    // Прачечная
    ['washer', 0, 20.15, 6.1, 1.0, 1.05],
    ['dryer', 0, 20.15, 7.3, 1.0, 1.05],
    ['waterheater', 0, 20.1, 11.3, 0.95, 1.3, { tall: true }],
    ['basket', 0, 21.6, 8.6, 0.8, 0.8, { solid: false }],
    // Кухня
    ['counter', 0, 25.1, 6.1, 2.3, 0.9],
    ['stove', 0, 27.5, 6.1, 1.2, 0.95],
    ['counterSink', 0, 28.8, 6.1, 1.9, 0.9],
    ['fridge', 0, 30.8, 6.1, 1.05, 1.15, { tall: true }],
    ['counter', 0, 25.1, 7.1, 0.9, 2.8, { rot: 0 }],
    ['island', 0, 27.4, 9.4, 2.2, 1.25],
    ['chair', 0, 27.9, 10.8, 0.7, 0.7, { solid: false }],
    ['chair', 0, 29.0, 10.8, 0.7, 0.7, { solid: false }],
    // Столовая
    ['rugRound', 0, 34.6, 7.9, 4.0, 3.4, { solid: false }],
    ['diningTable', 0, 34.9, 8.4, 3.4, 1.9],
    ['chair', 0, 35.3, 7.55, 0.7, 0.7, { solid: false }],
    ['chair', 0, 36.6, 7.55, 0.7, 0.7, { solid: false }],
    ['chair', 0, 35.3, 10.45, 0.7, 0.7, { solid: false }],
    ['chair', 0, 36.6, 10.45, 0.7, 0.7, { solid: false }],
    ['sideboard', 0, 33.15, 6.15, 2.1, 0.85],
    ['plant', 0, 39.1, 6.2, 0.85, 0.85],
    // Коридор
    ['runner', 0, 13, 14.95, 15, 1.15, { solid: false }],
    ['console', 0, 23.8, 14.1, 1.9, 0.7],
    ['closet', 0, 31.8, 14.08, 1.7, 0.92, { tall: true, hide: true, name: 'Чулан' }],
    ['coatrack', 0, 11.25, 14.2, 0.6, 0.6],
    // Спальня
    ['rugRect', 0, 11.6, 19.2, 4.2, 3.4, { solid: false }],
    ['bedDouble', 0, 11.9, 18.2, 2.0, 3.0],
    ['nightstand', 0, 11.15, 18.25, 0.7, 0.7],
    ['nightstand', 0, 11.15, 21.5, 0.7, 0.7],
    ['wardrobe', 0, 17.0, 19.6, 0.92, 2.3, { tall: true, hide: true, name: 'Гардероб' }],
    ['dresser', 0, 11.15, 22.9, 1.9, 0.85],
    // Ванная
    ['tub', 0, 19.15, 21.5, 2.7, 1.35],
    ['toilet', 0, 19.15, 18.3, 0.8, 1.15],
    ['sinkCab', 0, 21.4, 18.2, 1.4, 0.8],
    // Гостиная
    ['rugRect', 0, 25.4, 19.5, 5.2, 3.2, { solid: false }],
    ['sofa', 0, 26.1, 21.9, 3.3, 1.15],
    ['armchair', 0, 24.35, 19.9, 1.2, 1.3],
    ['coffeeTable', 0, 27.0, 20.3, 1.9, 1.05],
    ['tvstand', 0, 24.35, 18.12, 2.5, 0.72],
    ['bookshelf', 0, 33.05, 19.2, 0.9, 2.5, { tall: true }],
    ['plant', 0, 24.35, 18.3, 0.85, 0.85],
    // Детская
    ['rugRound', 0, 36.0, 19.8, 2.9, 2.6, { solid: false }],
    ['bedSingle', 0, 35.15, 18.2, 1.45, 2.5],
    ['toychest', 0, 38.2, 18.25, 1.25, 0.9],
    ['desk', 0, 38.15, 20.5, 0.9, 1.9],
    ['wardrobe', 0, 35.6, 22.85, 1.7, 1.0, { tall: true, hide: true, name: 'Шкаф', rot: 0 }],
    // Подвал: кладовая
    ['shelfTall', -1, 6.2, 3.1, 3.0, 0.8, { tall: true }],
    ['crate', -1, 3.2, 7.2, 1.25, 1.25],
    ['crate', -1, 4.7, 7.5, 1.0, 1.0],
    ['barrel', -1, 13.6, 3.3, 0.95, 0.95],
    ['shelfTall', -1, 14.1, 6.5, 0.82, 2.4, { tall: true }],
    // Подвал: мастерская
    ['workbench', -1, 3.15, 10.1, 3.0, 0.9],
    ['shelfTall', -1, 9.0, 10.1, 2.5, 0.8, { tall: true }],
    ['crate', -1, 12.1, 12.6, 1.25, 1.25],
    ['locker', -1, 14.05, 10.15, 0.9, 1.7, { tall: true, hide: true, name: 'Шкафчик' }],
    // Подвал: котельная
    ['boilerTank', -1, 24.4, 3.3, 1.7, 1.9, { tall: true }],
    ['crate', -1, 16.3, 12.9, 1.45, 1.25],
    ['crate', -1, 18.0, 13.3, 1.0, 1.0],
    ['shelfTall', -1, 26.1, 8.0, 0.85, 2.6, { tall: true }],
    ['oldchair', -1, 20.2, 10.1, 0.9, 0.9],
  ],

  props: [
    ['bottle', 0, 17.2, 7.6], ['tool', 0, 12.1, 12.4],       // гараж
    ['bottle', 0, 20.4, 8.9],                                 // прачечная
    ['plate', 0, 28.2, 9.8], ['cup', 0, 29.2, 9.7], ['plate', 0, 26.0, 6.6], // кухня
    ['plate', 0, 35.7, 8.9], ['cup', 0, 37.3, 9.4], ['bottle', 0, 34.0, 6.55], // столовая
    ['book', 0, 24.5, 14.4],                                  // коридор
    ['book', 0, 15.6, 21.6],                                  // спальня
    ['bottle', 0, 21.9, 19.5],                                // ванная
    ['book', 0, 27.8, 20.7], ['cup', 0, 28.6, 20.55], ['bottle', 0, 25.1, 18.4], // гостиная
    ['toy', 0, 36.9, 20.3], ['toy', 0, 37.6, 21.7], ['book', 0, 38.5, 19.4], // детская
    ['can', -1, 8.2, 6.6], ['bottle', -1, 11.5, 7.7],         // кладовая
    ['tool', -1, 7.2, 13.1], ['bottle', -1, 5.1, 12.2],       // мастерская
    ['can', -1, 21.2, 7.2], ['bottle', -1, 17.2, 4.3],        // котельная
  ],

  exterior: {
    trees: [
      [4.2, 4.0, 1.3], [8.5, 2.4, 1.0], [15, 2.2, 1.2], [25, 2.6, 1.0], [34, 2.2, 1.3],
      [43, 4.5, 1.2], [45, 12, 1.0], [44.5, 20, 1.3], [43, 28, 1.1], [35, 30.5, 1.3],
      [25, 31, 1.0], [15, 30.5, 1.2], [6.5, 29.5, 1.3], [2.5, 23, 1.0], [2.2, 5.5, 1.1],
      [44, 31, 0.9], [9, 31.5, 0.9],
    ],
    bushes: [
      [11.5, 4.1], [17, 4.3], [23, 4.1], [31, 4.3], [37, 4.1],
      [41.5, 7], [41.5, 14], [41.5, 22], [12, 25.5], [20, 25.6], [30, 25.4], [38, 25.6],
      [8.5, 20], [8, 10],
    ],
    // забор по периметру участка: [x, y, w, h] в тайлах (толщина 0.25 тайла = 8 px)
    fence: [
      [1, 1, 45.5, 0.25], [1, 32.6, 45.5, 0.25],
      [1, 1, 0.25, 31.8], [46.3, 1, 0.25, 31.8],
    ],
  },

  decor: [
    // --- фон (под полами комнат) ---
    { kind: 'driveway', floor: 0, x: 1.4, y: 7.6, w: 8.6, h: 3.8 },
    { kind: 'vanPath', floor: 0, x: 4.9, y: 15.5, n: 9, step: 0.62 },
    // --- детали (поверх стен) ---
    { kind: 'painting', floor: 0, x: 17.3, y: 13, color: '#31424a' },
    { kind: 'painting', floor: 0, x: 23.2, y: 13, color: '#4a3535' },
    { kind: 'painting', floor: 0, x: 31.4, y: 13, color: '#3c4a35' },
    { kind: 'painting', floor: 0, x: 21.6, y: 17, color: '#42394f' },
    { kind: 'painting', floor: 0, x: 33.2, y: 17, color: '#4a4231' },
    { kind: 'painting', floor: 0, x: 12.4, y: 17, color: '#35404a' },
    { kind: 'mat', floor: 0, x: 9.05, y: 15.08, w: 0.85, h: 0.84, color: '#4c3d26', stroke: true },
    { kind: 'mat', floor: 0, x: 11.1, y: 15.1, w: 0.8, h: 0.8, color: '#57493a' },
    { kind: 'bathMat', floor: 0, x: 20.4, y: 20.8 },
    { kind: 'oil', floor: 0, x: 12.7, y: 10.2 },
    { kind: 'cobweb', floor: 0, x: 11, y: 6, dir: 1 },
    { kind: 'cobweb', floor: 0, x: 19, y: 6, dir: -1 },
    { kind: 'cabinets', floor: 0, y: 6, blocks: [[25.1, 2.2], [28.9, 1.8]], doorX: [25.8, 26.6, 29.5, 30.2] },
    { kind: 'flowerbed', floor: 0, x: 12, w: 3.4 },
    { kind: 'flowerbed', floor: 0, x: 29.5, w: 3.6 },
    // подвал
    { kind: 'pipes', floor: -1, x1: 16.2, x2: 26.6, y: 3.4 },
    { kind: 'cobweb', floor: -1, x: 3, y: 3, dir: 1 },
    { kind: 'cobweb', floor: -1, x: 15, y: 3, dir: -1 },
    { kind: 'cobweb', floor: -1, x: 16, y: 3, dir: 1 },
    { kind: 'cobweb', floor: -1, x: 27, y: 3, dir: -1 },
    { kind: 'cobweb', floor: -1, x: 3, y: 10, dir: 1 },
    { kind: 'papers', floor: -1, n: 8, x: 4, y: 5, w: 20, h: 8 },
    { kind: 'pegboard', floor: -1, x: 3.4, y: 9.2 },
  ],
};

export const MAPS = [willow];

export function mapById(id) { return MAPS.find(m => m.id === id) || MAPS[0]; }
