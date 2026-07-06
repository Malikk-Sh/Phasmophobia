// Ввод: виртуальные джойстики (тач) + клавиатура/мышь для десктопа.
// Левая половина экрана — джойстик движения (появляется в точке касания),
// правая половина — джойстик направления взгляда/фонарика.
// Кнопки HUD — DOM-элементы, регистрируются через bindButton().

const state = {
  moveX: 0, moveY: 0,          // -1..1
  aimActive: false,
  aimAngle: 0,                 // куда смотрит игрок
  hasAim: false,
  // одноразовые нажатия (снимаются через consume)
  pressed: new Set(),
  // удержания
  held: new Set(),
  // визуализация джойстиков
  sticks: { move: null, aim: null },
};

const touches = new Map(); // pointerId -> {kind:'move'|'aim', ox, oy, x, y}
const keys = new Set();
let canvasEl = null;
let mouseAim = { active: false, x: 0, y: 0 };

const STICK_R = 52; // радиус джойстика в CSS px

function isOverHud(target) {
  return target && target.closest && target.closest('#hud button, .overlay, #btn-ask');
}

function onDown(e) {
  if (isOverHud(e.target)) return;
  const x = e.clientX, y = e.clientY;
  const half = window.innerWidth / 2;
  const kind = x < half ? 'move' : 'aim';
  // не более одного джойстика каждого типа
  for (const t of touches.values()) if (t.kind === kind) return;
  touches.set(e.pointerId, { kind, ox: x, oy: y, x, y });
  updateStick(kind);
  if (canvasEl) canvasEl.setPointerCapture?.(e.pointerId);
}

function onMove(e) {
  const t = touches.get(e.pointerId);
  if (t) {
    t.x = e.clientX; t.y = e.clientY;
    updateStick(t.kind);
    return;
  }
  if (e.pointerType === 'mouse') {
    mouseAim.active = true;
    mouseAim.x = e.clientX; mouseAim.y = e.clientY;
  }
}

function onUp(e) {
  const t = touches.get(e.pointerId);
  if (t) {
    touches.delete(e.pointerId);
    updateStick(t.kind);
  }
}

function updateStick(kind) {
  let t = null;
  for (const v of touches.values()) if (v.kind === kind) t = v;
  if (!t) {
    if (kind === 'move') { state.moveX = 0; state.moveY = 0; state.sticks.move = null; }
    else { state.aimActive = false; state.sticks.aim = null; }
    return;
  }
  let dx = t.x - t.ox, dy = t.y - t.oy;
  const len = Math.hypot(dx, dy);
  const norm = Math.min(1, len / STICK_R);
  if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len; }
  if (kind === 'move') {
    if (len > 6) {
      state.moveX = (dx / STICK_R);
      state.moveY = (dy / STICK_R);
    } else { state.moveX = 0; state.moveY = 0; }
    state.sticks.move = { ox: t.ox, oy: t.oy, dx, dy, norm };
  } else {
    if (len > 10) {
      state.aimAngle = Math.atan2(dy, dx);
      state.hasAim = true;
      state.aimActive = true;
    }
    state.sticks.aim = { ox: t.ox, oy: t.oy, dx, dy, norm };
  }
}

// --- Клавиатура ---
const KEYMAP = {
  KeyE: 'interact', KeyF: 'flashlight', KeyQ: 'cycle', KeyR: 'use',
  KeyJ: 'journal', Tab: 'journal', KeyT: 'ask', Escape: 'back',
};

function onKeyDown(e) {
  if (e.repeat) return;
  keys.add(e.code);
  const act = KEYMAP[e.code];
  if (act) { state.pressed.add(act); e.preventDefault(); }
}
function onKeyUp(e) { keys.delete(e.code); }

export const input = {
  init(canvas) {
    canvasEl = canvas;
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  // связать DOM-кнопку с действием
  bindButton(el, action, { hold = false } = {}) {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      el.classList.add('pressed');
      state.pressed.add(action);
      if (hold) state.held.add(action);
    });
    const release = (e) => {
      el.classList.remove('pressed');
      if (hold) state.held.delete(action);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
  },

  update() {
    // клавиатурное движение
    let kx = 0, ky = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) ky -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) ky += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      state.moveX = kx / l; state.moveY = ky / l;
    } else if (!this.stickMoveActive()) {
      state.moveX = 0; state.moveY = 0;
    }
    // прицел мышью (если нет тач-прицела)
    if (!state.aimActive && mouseAim.active && canvasEl) {
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const dx = mouseAim.x - cx, dy = mouseAim.y - cy;
      if (Math.hypot(dx, dy) > 20) {
        state.aimAngle = Math.atan2(dy, dx);
        state.hasAim = true;
      }
    }
  },

  stickMoveActive() {
    for (const t of touches.values()) if (t.kind === 'move') return true;
    return false;
  },

  get moveX() { return state.moveX; },
  get moveY() { return state.moveY; },
  get moving() { return state.moveX !== 0 || state.moveY !== 0; },
  get aimAngle() { return state.aimAngle; },
  get hasAim() { return state.hasAim; },
  get aimActive() { return state.aimActive; },
  get sticks() { return state.sticks; },

  consume(action) {
    if (state.pressed.has(action)) { state.pressed.delete(action); return true; }
    return false;
  },
  isHeld(action) { return state.held.has(action); },
  clear() { state.pressed.clear(); },
};
