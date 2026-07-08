// Типы призраков: уникальные тройки улик + поведенческие черты.

export const EVIDENCE = [
  { key: 'emf', name: 'ЭМП 5 уровня', icon: 'emf' },
  { key: 'spirit', name: 'Спиритбокс', icon: 'spirit' },
  { key: 'uv', name: 'УФ-отпечатки', icon: 'hand' },
  { key: 'orbs', name: 'Призрачные огни', icon: 'orb' },
  { key: 'writing', name: 'Запись в книге', icon: 'book' },
  { key: 'freezing', name: 'Минусовая температура', icon: 'snow' },
  { key: 'dots', name: 'DOTS-проектор', icon: 'dots' },
];

// Скорости в px/s (игрок: 92)
export const GHOSTS = [
  {
    key: 'spirit', name: 'Дух',
    ev: ['emf', 'spirit', 'writing'],
    desc: 'Самый частый гость. Ничем не выделяется, но благовония отгоняют его вдвое дольше обычного.',
    traits: { smudgeMult: 2.0 },
  },
  {
    key: 'wraith', name: 'Мираж',
    ev: ['emf', 'spirit', 'dots'],
    desc: 'Летает над полом: никогда не тревожит соль. Иногда мгновенно переносится к жертве, оставляя всплеск ЭМП.',
    traits: { noSalt: true, teleport: true },
  },
  {
    key: 'phantom', name: 'Фантом',
    ev: ['spirit', 'uv', 'dots'],
    desc: 'Взгляд на него стремительно высасывает рассудок. Во время охоты мерцает реже и почти невидим.',
    traits: { gazeDrain: 3.0, dimHunt: true, warnTime: 2.8 },
  },
  {
    key: 'poltergeist', name: 'Полтергейст',
    ev: ['spirit', 'uv', 'writing'],
    desc: 'Швыряет предметы с чудовищной силой, может разбросать всё в комнате разом.',
    traits: { throwMult: 2.2, multiThrow: true },
  },
  {
    key: 'banshee', name: 'Банши',
    ev: ['uv', 'orbs', 'dots'],
    desc: 'Охотница-одиночка. Издаёт характерный вой, а на охоте идёт к жертве, где бы та ни пряталась.',
    traits: { stalker: true, wail: true, warnTime: 1.3 },
  },
  {
    key: 'jinn', name: 'Джинн',
    ev: ['emf', 'uv', 'freezing'],
    desc: 'Пока электрощиток включён — стремительно настигает жертву издалека. Любит вырубать щиток.',
    traits: { jinnSpeed: true, breakerOff: true },
  },
  {
    key: 'mare', name: 'Мара',
    ev: ['spirit', 'orbs', 'writing'],
    desc: 'Сильна в темноте: гасит свет и охотится при высоком рассудке, если жертва стоит во мраке.',
    traits: { darkHunt: 60, lightHunt: 40, lightsOff: true },
  },
  {
    key: 'revenant', name: 'Ревенант',
    ev: ['orbs', 'writing', 'freezing'],
    desc: 'Медленно бродит вслепую, но увидев жертву — несётся с ужасающей скоростью.',
    traits: { slowSpeed: 34, fastSpeed: 138 },
  },
  {
    key: 'shade', name: 'Тень',
    ev: ['emf', 'writing', 'freezing'],
    desc: 'Застенчива: почти не проявляет активности рядом с людьми и охотится лишь при почти сломленном рассудке. Тень редко действует под прямым наблюдением. Оставьте оборудование в комнате и отойдите.',
    traits: { shy: true, huntThreshold: 30, warnTime: 3.6 },
  },
  {
    key: 'demon', name: 'Демон',
    ev: ['uv', 'writing', 'freezing'],
    desc: 'Самая агрессивная сущность. Может начать охоту в любой момент, даже при полном рассудке.',
    traits: { huntThreshold: 70, randomHunt: true, huntCooldown: 14, warnTime: 0.9 },
  },
  {
    key: 'yurei', name: 'Юрэй',
    ev: ['orbs', 'freezing', 'dots'],
    desc: 'Его манифестации особенно тяжелы для психики. Любит хлопать дверями.',
    traits: { eventDrain: 2.0, doorSlam: true },
  },
  {
    key: 'onryo', name: 'Онрё',
    ev: ['spirit', 'orbs', 'freezing'],
    desc: 'Мстительный дух: каждое третье проявление перерастает в охоту. Боится огня благовоний.',
    traits: { eventHunt: 3, smudgeInstant: true },
  },
];

export const GHOST_FORMS = ['lady', 'shadow', 'hangman'];

export function ghostByKey(k) { return GHOSTS.find(g => g.key === k); }
