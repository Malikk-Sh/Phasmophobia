// Звук: реалистичные аудио-ассеты через WebAudio + процедурный fallback.
// Если assets/audio/manifest.json содержит файлы, игра использует их; иначе синтезирует звук на лету.

let ctx = null;
let master, comp;
let noiseBuf = null;
let started = false;
const SAMPLE_MANIFEST_URL = 'assets/audio/manifest.json';
const samples = new Map();
let assetsLoading = false;
let assetsLoaded = false;
let assetsAvailable = false;
let sampleAmbience = null;

// постоянные узлы
let droneOsc1, droneOsc2, droneGain;
let windSrc, windGain, windFilter;
let spiritSrc, spiritGain;
let rainGain = null;

// шины: эмбиент (приглушается под охотой) и одноразовые звуки с реверб-посылом
let ambientBus = null, busInput = null, convolver = null, reverbSend = null;
const PAN_SPREAD = 320; // ~10 тайлов: на этой дистанции звук уходит в край стерео

// таймеры
const T = { heart: 0, emf: 0, ghostStep: 0, creak: 8, crackle: 0, whis: 20 };

function now() { return ctx.currentTime; }


function chooseSample(key) {
  const list = samples.get(key);
  if (!list || !list.length) return null;
  return list[(Math.random() * list.length) | 0];
}

function sampleGain(base = 1, variance = 0) {
  return base * (1 + (Math.random() * 2 - 1) * variance);
}

function playSample(key, { gain = 1, pan = 0, rate = 1, loop = false } = {}) {
  if (!ctx) return null;
  const buffer = chooseSample(key);
  if (!buffer) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  src.connect(g).connect(p).connect(loop ? (ambientBus || master) : (busInput || master));
  src.start();
  return { src, gain: g, pan: p };
}

function playAny(keys, opts) {
  for (const key of keys) {
    const node = playSample(key, opts);
    if (node) return node;
  }
  return null;
}

async function loadAudioAssets() {
  if (assetsLoading || assetsLoaded || !ctx) return;
  assetsLoading = true;
  try {
    const res = await fetch(SAMPLE_MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const manifest = await res.json();
    const entries = Object.entries(manifest.samples || {});
    await Promise.all(entries.map(async ([key, urls]) => {
      const decoded = [];
      await Promise.all((urls || []).map(async (url) => {
        const audioRes = await fetch(url);
        if (!audioRes.ok) return;
        const arrayBuffer = await audioRes.arrayBuffer();
        decoded.push(await ctx.decodeAudioData(arrayBuffer));
      }));
      if (decoded.length) {
        samples.set(key, decoded);
        assetsAvailable = true;
      }
    }));
  } catch (err) {
    console.warn('Audio assets are unavailable; procedural fallback is active.', err);
  } finally {
    assetsLoaded = true;
    assetsLoading = false;
  }
}

// импульсный отклик для реверба: затухающий стереошум
function makeImpulse(seconds = 2.2, decay = 2.6) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * rate));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function makeNoiseBuffer() {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02; // коричневатый
    d[i] = w * 0.5 + last * 2;
  }
  return buf;
}

function noise({ dur = 0.2, type = 'lowpass', freq = 800, q = 1, gain = 0.3, pan = 0, attack = 0.005, rate = 1, freqEnd = null }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now() + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now());
  g.gain.linearRampToValueAtTime(gain, now() + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  src.connect(f).connect(g).connect(p).connect(busInput || master);
  src.start();
  src.stop(now() + dur + 0.05);
}

function tone({ type = 'sine', freq = 440, dur = 0.2, gain = 0.2, slide = null, pan = 0, attack = 0.004, vib = 0, vibRate = 6 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, now());
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), now() + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now());
  g.gain.linearRampToValueAtTime(gain, now() + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  if (vib) {
    const l = ctx.createOscillator();
    l.frequency.value = vibRate;
    const lg = ctx.createGain(); lg.gain.value = vib;
    l.connect(lg).connect(o.frequency);
    l.start(); l.stop(now() + dur);
  }
  o.connect(g).connect(p).connect(busInput || master);
  o.start();
  o.stop(now() + dur + 0.05);
}

export const audio = {
  ready: false,

  init() {
    if (started) return;
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = makeNoiseBuffer();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
    // шина эмбиента: беды дрона/ветра/дождя (приглушается под охотой)
    ambientBus = ctx.createGain(); ambientBus.gain.value = 1; ambientBus.connect(master);
    // шина одноразовых звуков с параллельным реверб-посылом (пространство дома)
    busInput = ctx.createGain(); busInput.connect(master);
    convolver = ctx.createConvolver(); convolver.buffer = makeImpulse();
    reverbSend = ctx.createGain(); reverbSend.gain.value = 0.12;
    busInput.connect(reverbSend); reverbSend.connect(convolver); convolver.connect(master);
    this.ready = true;
    loadAudioAssets().then(() => { if (this.ready) this.startSampleAmbience(); });
    this.startAmbient();
  },

  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },

  // ---------- Эмбиент ----------
  startAmbient() {
    // низкий дрон
    droneOsc1 = ctx.createOscillator(); droneOsc1.type = 'sine'; droneOsc1.frequency.value = 46;
    droneOsc2 = ctx.createOscillator(); droneOsc2.type = 'sine'; droneOsc2.frequency.value = 46.7;
    droneGain = ctx.createGain(); droneGain.gain.value = 0.0;
    droneOsc1.connect(droneGain); droneOsc2.connect(droneGain);
    droneGain.connect(ambientBus);
    droneOsc1.start(); droneOsc2.start();
    // ветер
    windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass';
    windFilter.frequency.value = 320; windFilter.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0.0;
    windSrc.connect(windFilter).connect(windGain).connect(ambientBus);
    windSrc.start();
    // LFO порывов
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 90;
    lfo.connect(lg).connect(windFilter.frequency);
    lfo.start();
    // спиритбокс (заготовка, включается gain'ом)
    spiritSrc = ctx.createBufferSource(); spiritSrc.buffer = noiseBuf; spiritSrc.loop = true;
    spiritSrc.playbackRate.value = 1.7;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1400; sf.Q.value = 0.8;
    spiritGain = ctx.createGain(); spiritGain.gain.value = 0;
    spiritSrc.connect(sf).connect(spiritGain).connect(ambientBus);
    spiritSrc.start();
    // дождь: мягкий широкополосный шум
    const rainSrc = ctx.createBufferSource(); rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    rainSrc.playbackRate.value = 1.35;
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1500;
    const rf2 = ctx.createBiquadFilter(); rf2.type = 'lowpass'; rf2.frequency.value = 6500;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(rf).connect(rf2).connect(rainGain).connect(ambientBus);
    rainSrc.start();
  },

  startSampleAmbience() {
    if (!assetsAvailable || sampleAmbience) return;
    sampleAmbience = {
      roomtone: playSample('ambience.indoor', { gain: 0, loop: true }),
      basement: playSample('ambience.basement', { gain: 0, loop: true }),
      rain: playSample('ambience.rain', { gain: 0, loop: true }),
      wind: playSample('ambience.wind', { gain: 0, loop: true }),
    };
  },

  setAmbience(indoors, basement) {
    if (!this.ready) return;
    const t = now();
    const synthScale = assetsAvailable ? 0.35 : 1;
    droneGain.gain.linearRampToValueAtTime((indoors ? (basement ? 0.05 : 0.035) : 0.015) * synthScale, t + 1.2);
    windGain.gain.linearRampToValueAtTime((indoors ? 0.006 : 0.03) * synthScale, t + 1.2);
    // дождь: снаружи в полную силу, в доме — приглушённо по крыше, в подвале — нет.
    // Общая громкость дождя снижена на 30% (RAIN_VOL).
    const RAIN_VOL = 0.7;
    rainGain.gain.linearRampToValueAtTime((indoors ? (basement ? 0 : 0.008) : 0.035) * synthScale * RAIN_VOL, t + 1.2);
    if (sampleAmbience) {
      sampleAmbience.roomtone?.gain.gain.linearRampToValueAtTime(indoors && !basement ? 0.22 : 0, t + 1.2);
      sampleAmbience.basement?.gain.gain.linearRampToValueAtTime(indoors && basement ? 0.28 : 0, t + 1.2);
      sampleAmbience.rain?.gain.gain.linearRampToValueAtTime((indoors ? (basement ? 0 : 0.08) : 0.32) * RAIN_VOL, t + 1.2);
      sampleAmbience.wind?.gain.gain.linearRampToValueAtTime(indoors ? 0.04 : 0.22, t + 1.2);
    }
    // реверб: гулкий подвал > комнаты дома > почти сухо на улице
    reverbSend?.gain.setTargetAtTime(indoors ? (basement ? 0.26 : 0.14) : 0.04, t, 0.6);
  },

  // позиция слушателя (игрока) — для панорамы позиционных звуков
  listener: { x: 0, y: 0, floor: 0 },
  setListener(x, y, floor) { this.listener.x = x; this.listener.y = y; this.listener.floor = floor; },
  // панорама источника по горизонтальному смещению от слушателя (мир=экран, север сверху)
  panFor(x) { return Math.max(-0.85, Math.min(0.85, (x - this.listener.x) / PAN_SPREAD)); },

  // ---------- Кадровое обновление ----------
  update(dt, s) {
    if (!this.ready) return;
    // ducking: под охотой приглушаем фоновый бед, чтобы кульминация «пробивала»
    if (ambientBus) ambientBus.gain.setTargetAtTime(s.hunt ? 0.42 : 1, now(), 0.35);
    // сердцебиение
    if (s.heartbeat > 0.02) {
      T.heart -= dt;
      if (T.heart <= 0) {
        T.heart = 1.15 - s.heartbeat * 0.65;
        const g = 0.1 + s.heartbeat * 0.2;
        if (!playSample('player.heartbeat', { gain: g * 1.4, rate: sampleGain(1, 0.03) })) {
          tone({ type: 'sine', freq: 58, dur: 0.11, gain: g, slide: 40 });
          setTimeout(() => started && tone({ type: 'sine', freq: 52, dur: 0.1, gain: g * 0.7, slide: 38 }), 160);
        }
      }
    }
    // писк ЭМП: приборный, мягкий (короткий синус + слабая гармоника)
    if (s.emfLevel > 0) {
      T.emf -= dt;
      if (T.emf <= 0) {
        T.emf = s.emfLevel >= 5 ? 0.11 : 0.7 / s.emfLevel;
        const f = 780 + s.emfLevel * 70;
        tone({ type: 'sine', freq: f, dur: 0.05, gain: 0.045 + s.emfLevel * 0.008, attack: 0.002 });
        tone({ type: 'sine', freq: f * 2, dur: 0.04, gain: 0.012, attack: 0.002 });
      }
    }
    // спиритбокс: эфир + случайные трески перестройки частоты
    spiritGain.gain.setTargetAtTime(s.spiritOn ? 0.04 : 0, now(), 0.1);
    if (s.spiritOn) {
      T.crackle -= dt;
      if (T.crackle <= 0) {
        T.crackle = 0.15 + Math.random() * 0.5;
        if (!playSample('radio.crackle', { gain: 0.35, rate: sampleGain(1, 0.12) })) noise({
          dur: 0.05 + Math.random() * 0.1, type: 'bandpass',
          freq: 600 + Math.random() * 2600, q: 8, gain: 0.05 + Math.random() * 0.05,
          rate: 1.5 + Math.random(),
        });
      }
    }
    // шёпот на грани безумия
    if (s.lowSanity) {
      T.whis -= dt;
      if (T.whis <= 0) {
        T.whis = 12 + Math.random() * 22;
        this.whisper();
      }
    }
    // шаги призрака при охоте (темп зависит от фазы: погоня — чаще)
    if (s.huntNear > 0.02) {
      T.ghostStep -= dt;
      if (T.ghostStep <= 0) {
        T.ghostStep = s.ghostStepInt || 0.55;
        // шаги идут из реальной стороны, где призрак
        const gp = (s.ghostX != null && s.ghostFloor === this.listener.floor) ? this.panFor(s.ghostX) : 0;
        if (!playSample('ghost.step', { gain: 0.45 * s.huntNear, pan: gp, rate: sampleGain(1, 0.08) })) {
          noise({ dur: 0.16, type: 'lowpass', freq: 130, gain: 0.16 * s.huntNear, rate: 0.5, pan: gp });
          tone({ type: 'sine', freq: 40, dur: 0.15, gain: 0.22 * s.huntNear, slide: 28, pan: gp });
        }
      }
    }
    // случайные скрипы дома
    T.creak -= dt;
    if (T.creak <= 0) {
      T.creak = 14 + Math.random() * 26;
      if (Math.random() < 0.6) {
        const pan = Math.random() * 1.6 - 0.8;
        if (!playSample('house.creak', { gain: 0.45, pan, rate: sampleGain(1, 0.08) })) {
          if (Math.random() < 0.5) tone({ type: 'sawtooth', freq: 140 + Math.random() * 120, slide: 90, dur: 0.9, gain: 0.012, pan, vib: 14, vibRate: 3 });
          else noise({ dur: 0.5, freq: 300, gain: 0.02, pan, type: 'bandpass', q: 3 });
        }
      }
    }
  },

  // ---------- Одноразовые ----------
  footstep(outdoors) {
    if (!this.ready) return;
    const v = 0.05 + Math.random() * 0.02;
    if (playSample(outdoors ? 'player.step.outdoor' : 'player.step.indoor', { gain: 0.35, rate: sampleGain(1, 0.06), pan: Math.random() * 0.2 - 0.1 })) return;
    if (outdoors) noise({ dur: 0.09, type: 'highpass', freq: 500, gain: v * 0.9, rate: 1.6 });
    else {
      noise({ dur: 0.07, type: 'lowpass', freq: 300, gain: v, rate: 0.8 });
      if (Math.random() < 0.12) tone({ type: 'sawtooth', freq: 90, slide: 60, dur: 0.28, gain: 0.014 }); // скрип половицы
    }
  },

  doorCreak(slam = false) {
    if (!this.ready) return;
    if (playSample(slam ? 'door.slam' : 'door.creak', { gain: slam ? 0.75 : 0.5, rate: sampleGain(1, 0.05) })) return;
    if (slam) {
      noise({ dur: 0.18, freq: 200, gain: 0.3, type: 'lowpass' });
      tone({ type: 'sine', freq: 70, slide: 40, dur: 0.22, gain: 0.3 });
    } else {
      tone({ type: 'sawtooth', freq: 160 + Math.random() * 80, slide: 220, dur: 1.1, gain: 0.03, vib: 30, vibRate: 4.5 });
      noise({ dur: 0.3, freq: 700, gain: 0.02, type: 'bandpass', q: 4 });
    }
  },

  doorOpen() {
    if (!this.ready) return;
    if (playSample('door.open', { gain: 0.5, rate: sampleGain(1, 0.05) })) return;
    // щёлк ручки → протяжный скрип петель с неровным ходом
    noise({ dur: 0.035, type: 'highpass', freq: 2600, gain: 0.09, attack: 0.002 });
    setTimeout(() => {
      if (!started) return;
      const f = 130 + Math.random() * 60;
      tone({ type: 'sawtooth', freq: f, slide: f * 2.1, dur: 0.75, gain: 0.022, vib: 26, vibRate: 3.2, attack: 0.06 });
      tone({ type: 'sawtooth', freq: f * 1.5, slide: f * 2.6, dur: 0.55, gain: 0.009, vib: 40, vibRate: 5.1, attack: 0.1 });
      noise({ dur: 0.6, type: 'bandpass', freq: 480, q: 2.5, gain: 0.014, attack: 0.08, rate: 0.7 });
    }, 70);
  },

  doorClose() {
    if (!this.ready) return;
    if (playSample('door.close', { gain: 0.55, rate: sampleGain(1, 0.05) })) return;
    // короткий скрип → глухой деревянный удар о косяк → щелчок защёлки
    const f = 190 + Math.random() * 50;
    tone({ type: 'sawtooth', freq: f * 1.8, slide: f, dur: 0.28, gain: 0.016, vib: 24, vibRate: 4, attack: 0.03 });
    noise({ dur: 0.22, type: 'bandpass', freq: 420, q: 2, gain: 0.012, attack: 0.03, rate: 0.7 });
    setTimeout(() => {
      if (!started) return;
      noise({ dur: 0.09, type: 'lowpass', freq: 220, gain: 0.2, attack: 0.003 });
      tone({ type: 'sine', freq: 95, slide: 52, dur: 0.11, gain: 0.16, attack: 0.003 });
    }, 240);
    setTimeout(() => started && noise({ dur: 0.03, type: 'highpass', freq: 3000, gain: 0.07, attack: 0.002 }), 360);
  },

  closetKnock() {
    if (!this.ready) return;
    if (playSample('ghost.knock', { gain: 0.6, rate: sampleGain(1, 0.08) })) return;
    // два приглушённых удара по дверце укрытия — совсем рядом
    for (const [t, g] of [[0, 0.16], [220, 0.2]]) {
      setTimeout(() => {
        if (!started) return;
        noise({ dur: 0.07, type: 'lowpass', freq: 320, gain: g, attack: 0.002 });
        tone({ type: 'sine', freq: 140, slide: 70, dur: 0.09, gain: g * 0.7, attack: 0.002 });
      }, t);
    }
  },

  knockRaps(pan = 0) {
    if (!this.ready) return;
    if (playSample('ghost.knock', { gain: 0.4, pan, rate: sampleGain(0.9, 0.08) })) return;
    // три медленных стука из другой комнаты
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!started) return;
        noise({ dur: 0.06, type: 'lowpass', freq: 260, gain: 0.12, attack: 0.003, pan });
        tone({ type: 'sine', freq: 110, slide: 60, dur: 0.1, gain: 0.09, attack: 0.003, pan });
      }, i * 480 + Math.random() * 90);
    }
  },

  phantomSteps() {
    if (!this.ready) return;
    if (playSample('ghost.step', { gain: 0.2, pan: Math.random() * 1.2 - 0.6, rate: sampleGain(0.9, 0.1) })) return;
    // шаги, которых нет: 3-4 глухих шага со сменой панорамы
    const pan = Math.random() * 1.2 - 0.6;
    const n = 3 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) {
      setTimeout(() => started && noise({
        dur: 0.08, type: 'lowpass', freq: 240, gain: 0.05,
        rate: 0.7, pan: pan + i * 0.12,
      }), i * 420);
    }
  },

  shutter() {
    if (!this.ready) return;
    if (playSample('item.shutter', { gain: 0.5 })) return;
    noise({ dur: 0.03, type: 'highpass', freq: 2600, gain: 0.14, attack: 0.001 });
    setTimeout(() => started && noise({ dur: 0.05, type: 'bandpass', freq: 1200, q: 2, gain: 0.08, attack: 0.002 }), 60);
    setTimeout(() => started && noise({ dur: 0.25, type: 'highpass', freq: 3200, gain: 0.03, attack: 0.02 }), 140); // перемотка
  },

  musicBox() {
    if (!this.ready) return;
    if (playSample('cursed.musicbox', { gain: 0.6 })) return;
    // расстроенная колыбельная: чистые колокольчиковые ноты, последняя фальшивит
    const seq = [660, 587, 660, 784, 660, 587, 523, 494, 523, 660, 622];
    seq.forEach((f, i) => setTimeout(() => {
      if (!started) return;
      const detune = i >= seq.length - 2 ? 0.97 : 1;
      tone({ type: 'sine', freq: f * detune, dur: 0.9, gain: 0.055, attack: 0.002 });
      tone({ type: 'sine', freq: f * detune * 3, dur: 0.5, gain: 0.012, attack: 0.002 });
    }, i * 640));
  },

  // комнатные микрозвуки
  roomTone(kind, pan = 0) {
    if (!this.ready) return;
    if (playSample(`room.${kind}`, { gain: 0.45, pan })) return;
    switch (kind) {
      case 'drip': // капля
        tone({ type: 'sine', freq: 1200, slide: 500, dur: 0.06, gain: 0.07, pan, attack: 0.002 });
        setTimeout(() => started && tone({ type: 'sine', freq: 800, slide: 300, dur: 0.09, gain: 0.04, pan }), 90);
        break;
      case 'pipe': // стон трубы
        tone({ type: 'sawtooth', freq: 90, slide: 140, dur: 1.8, gain: 0.03, vib: 12, vibRate: 2.2, pan, attack: 0.4 });
        break;
      case 'bed': // скрип кровати
        tone({ type: 'sawtooth', freq: 180, slide: 120, dur: 0.5, gain: 0.02, vib: 30, vibRate: 6, pan, attack: 0.05 });
        break;
      case 'dish': // звякнула посуда
        tone({ type: 'triangle', freq: 2200, slide: 1900, dur: 0.12, gain: 0.05, pan, attack: 0.002 });
        setTimeout(() => started && tone({ type: 'triangle', freq: 2600, slide: 2300, dur: 0.1, gain: 0.03, pan }), 110);
        break;
      case 'toy': // писк игрушки
        tone({ type: 'square', freq: 900, slide: 1300, dur: 0.18, gain: 0.025, pan, attack: 0.01 });
        break;
      case 'metal': // звон металла
        noise({ dur: 0.4, type: 'bandpass', freq: 3400, q: 14, gain: 0.06, pan, attack: 0.002 });
        break;
      case 'tv': // телевизор ожил помехами
        noise({ dur: 1.1, type: 'highpass', freq: 1800, gain: 0.06, pan, attack: 0.02 });
        tone({ type: 'sine', freq: 940, dur: 1.0, gain: 0.008, pan }); // писк кинескопа
        break;
      case 'fridge': // холодильник дрогнул
        tone({ type: 'sawtooth', freq: 52, dur: 1.4, gain: 0.03, vib: 4, vibRate: 12, pan, attack: 0.2 });
        break;
    }
  },

  // приглушить всё (кинематографичная смерть)
  duck(level = 0.12, sec = 0.3) {
    if (!this.ready) return;
    master.gain.cancelScheduledValues(now());
    master.gain.setTargetAtTime(level, now(), sec);
  },
  unduck(sec = 0.2) {
    if (!this.ready) return;
    master.gain.setTargetAtTime(0.9, now(), sec);
  },

  falseHuntCue() {
    if (!this.ready) return;
    if (playSample('hunt.false', { gain: 0.5 })) return;
    // обманка: короткий провал гула + помехи, будто начинается охота
    tone({ type: 'sine', freq: 74, slide: 38, dur: 1.2, gain: 0.1 });
    noise({ dur: 1.1, freq: 120, type: 'lowpass', gain: 0.07, freqEnd: 260, attack: 0.3 });
    setTimeout(() => started && noise({ dur: 0.5, type: 'bandpass', freq: 1400, q: 2, gain: 0.04 }), 500);
  },

  sensorPing(pan = 0) {
    if (!this.ready) return;
    if (playSample('sensor.ping', { gain: 0.4, pan })) return;
    tone({ type: 'square', freq: 1650, dur: 0.05, gain: 0.05, pan, attack: 0.002 });
    tone({ type: 'sine', freq: 2500, dur: 0.04, gain: 0.02, pan, attack: 0.002 });
  },

  switchClick() { if (this.ready && !playSample('switch.click', { gain: 0.45 })) noise({ dur: 0.04, type: 'highpass', freq: 1800, gain: 0.12 }); },
  uiClick() { if (this.ready && !playSample('ui.click', { gain: 0.35 })) tone({ type: 'sine', freq: 660, dur: 0.05, gain: 0.05 }); },

  breakerOff() {
    if (!this.ready) return;
    if (playSample('breaker.off', { gain: 0.7 })) return;
    tone({ type: 'square', freq: 120, slide: 45, dur: 0.5, gain: 0.15 });
    noise({ dur: 0.4, freq: 150, gain: 0.2, freqEnd: 60 });
  },
  breakerOn() {
    if (!this.ready) return;
    if (playSample('breaker.on', { gain: 0.65 })) return;
    tone({ type: 'square', freq: 60, slide: 130, dur: 0.3, gain: 0.12 });
    noise({ dur: 0.15, freq: 2000, gain: 0.06, type: 'highpass' });
  },

  propWhoosh() {
    if (!this.ready) return;
    if (playSample('prop.whoosh', { gain: 0.45, rate: sampleGain(1, 0.1) })) return;
    noise({ dur: 0.25, type: 'bandpass', freq: 900, freqEnd: 300, q: 1.5, gain: 0.1 });
  },
  propImpact(hard = true, pan = 0) {
    if (!this.ready) return;
    if (playSample(hard ? 'prop.impact.hard' : 'prop.impact.soft', { gain: hard ? 0.55 : 0.45, pan, rate: sampleGain(1, 0.12) })) return;
    noise({ dur: 0.12, freq: hard ? 2400 : 500, type: hard ? 'highpass' : 'lowpass', gain: 0.18, pan });
    tone({ type: 'triangle', freq: hard ? 320 : 120, slide: 60, dur: 0.12, gain: 0.1, pan });
  },

  writing() {
    if (!this.ready) return;
    if (playSample('ghost.writing', { gain: 0.45, rate: sampleGain(1, 0.05) })) return;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => started && noise({ dur: 0.08, type: 'bandpass', freq: 2600, q: 4, gain: 0.05 }), i * 130);
    }
  },

  whisper() {
    if (!this.ready) return;
    if (playSample('ghost.whisper', { gain: 0.45, pan: Math.random() * 1.4 - 0.7, rate: sampleGain(1, 0.05) })) return;
    // дыхание-шёпот: медленные выдохи с формантой, гуляющей как речь
    const pan = Math.random() * 1.4 - 0.7;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!started) return;
        noise({
          dur: 0.5 + Math.random() * 0.3, type: 'bandpass',
          freq: 900 + Math.random() * 900, q: 3.5,
          gain: 0.028, pan, attack: 0.12, rate: 0.8,
        });
        noise({
          dur: 0.4, type: 'bandpass', freq: 2400 + Math.random() * 1200, q: 7,
          gain: 0.012, pan, attack: 0.1,
        });
      }, i * 420 + Math.random() * 150);
    }
  },

  spiritResponse() {
    if (!this.ready) return;
    if (playSample('ghost.spiritResponse', { gain: 0.55, rate: sampleGain(1, 0.04) })) return;
    // «голос» из эфира: шёпот в двух формантных полосах + низкий гул под ним
    const syll = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < syll; i++) {
      setTimeout(() => {
        if (!started) return;
        const f1 = 380 + Math.random() * 320;
        noise({ dur: 0.26, type: 'bandpass', freq: f1, q: 6, gain: 0.11, attack: 0.03, rate: 0.7 });
        noise({ dur: 0.24, type: 'bandpass', freq: f1 * 3.4, q: 8, gain: 0.05, attack: 0.03 });
        tone({ type: 'sine', freq: 95 + Math.random() * 40, dur: 0.28, gain: 0.035, vib: 12, vibRate: 7 });
      }, i * 300 + Math.random() * 90);
    }
    // всплеск помех после «слов»
    setTimeout(() => started && noise({ dur: 0.35, type: 'bandpass', freq: 1800, q: 2, gain: 0.05 }), syll * 300 + 150);
  },

  ghostEvent(form) {
    if (!this.ready) return;
    if (playAny([`ghost.event.${form}`, 'ghost.event'], { gain: 0.65, rate: sampleGain(1, 0.04) })) return;
    if (form === 'lady') {
      // далёкий женский напев с дыханием
      const seq = [262, 247, 220, 196, 220];
      seq.forEach((f, i) => setTimeout(() => {
        if (!started) return;
        tone({ type: 'sine', freq: f, dur: 1.0, gain: 0.035, vib: 4, vibRate: 5, attack: 0.25 });
        tone({ type: 'sine', freq: f * 2.01, dur: 0.9, gain: 0.008, attack: 0.25 });
        noise({ dur: 0.9, type: 'bandpass', freq: f * 4, q: 4, gain: 0.006, attack: 0.3 });
      }, i * 640));
    } else if (form === 'hangman') {
      // скрип верёвки + тяжёлый стон
      for (let i = 0; i < 3; i++) {
        setTimeout(() => started && tone({
          type: 'sawtooth', freq: 130 + Math.random() * 50, slide: 80,
          dur: 0.7, gain: 0.02, vib: 20, vibRate: 3,
        }), i * 800);
      }
      tone({ type: 'sine', freq: 68, slide: 46, dur: 2.8, gain: 0.06, vib: 5, vibRate: 1.6, attack: 0.4 });
    } else {
      // тень: втягивающий воздух гул + шелест
      noise({ dur: 2.6, freq: 120, type: 'lowpass', gain: 0.09, freqEnd: 40, attack: 0.5 });
      tone({ type: 'sine', freq: 44, dur: 2.6, gain: 0.07, vib: 4, vibRate: 1.2, attack: 0.4 });
      noise({ dur: 1.8, type: 'bandpass', freq: 3200, q: 2, gain: 0.012, attack: 0.6 });
    }
  },

  bansheeWail() {
    if (!this.ready) return;
    if (playSample('ghost.bansheeWail', { gain: 0.65 })) return;
    tone({ type: 'sine', freq: 880, slide: 420, dur: 2.6, gain: 0.045, vib: 30, vibRate: 5 });
    tone({ type: 'sine', freq: 1320, slide: 660, dur: 2.2, gain: 0.02, vib: 40, vibRate: 6 });
  },

  wardPulse() {
    if (!this.ready) return;
    if (playSample('item.wardPulse', { gain: 0.65 })) return;
    // холодный защитный звон-«отражение»: чистый резонанс + гаснущий призвук
    tone({ type: 'sine', freq: 528, dur: 1.4, gain: 0.07, attack: 0.004 });
    tone({ type: 'sine', freq: 792, dur: 1.2, gain: 0.035, attack: 0.004 });
    tone({ type: 'sine', freq: 1584, dur: 0.9, gain: 0.014, attack: 0.004 });
    noise({ dur: 0.5, type: 'bandpass', freq: 4200, q: 10, gain: 0.04, attack: 0.002 });
  },

  smudgeUse() {
    if (!this.ready) return;
    if (playSample('item.smudge', { gain: 0.5 })) return;
    noise({ dur: 1.4, type: 'highpass', freq: 3400, gain: 0.05 });
    noise({ dur: 1.2, type: 'bandpass', freq: 500, q: 1, gain: 0.04 });
  },
  saltPour() { if (this.ready && !playSample('item.saltPour', { gain: 0.45 })) noise({ dur: 0.4, type: 'highpass', freq: 4200, gain: 0.07 }); },
  pills() { if (this.ready) { if (playSample('item.pills', { gain: 0.45 })) return; noise({ dur: 0.1, type: 'highpass', freq: 2500, gain: 0.06 }); setTimeout(() => started && noise({ dur: 0.08, type: 'highpass', freq: 2000, gain: 0.05 }), 150); } },
  cameraPlace() { if (this.ready) { if (playSample('item.cameraPlace', { gain: 0.5 })) return; tone({ type: 'square', freq: 900, dur: 0.05, gain: 0.05 }); setTimeout(() => started && tone({ type: 'square', freq: 1200, dur: 0.05, gain: 0.045 }), 90); } },

  huntStart() {
    if (!this.ready) return;
    if (playSample('hunt.start', { gain: 0.8 })) return;
    // обрыв света: глубокий саб-провал + нарастающий шумовой райзер
    tone({ type: 'sine', freq: 82, slide: 26, dur: 2.2, gain: 0.22 });
    noise({ dur: 2.0, freq: 90, type: 'lowpass', gain: 0.16, freqEnd: 320, attack: 0.5 });
    setTimeout(() => started && tone({ type: 'sine', freq: 180, slide: 34, dur: 1.1, gain: 0.18 }), 350);
    // далёкий нечеловеческий вой
    setTimeout(() => {
      if (!started) return;
      tone({ type: 'sawtooth', freq: 240, slide: 90, dur: 2.2, gain: 0.03, vib: 30, vibRate: 5.5, attack: 0.3 });
      noise({ dur: 2.0, type: 'bandpass', freq: 700, q: 3, gain: 0.04, freqEnd: 250, attack: 0.3 });
    }, 550);
  },

  huntEnd() {
    if (!this.ready) return;
    if (playSample('hunt.end', { gain: 0.55 })) return;
    tone({ type: 'sine', freq: 90, slide: 30, dur: 2.2, gain: 0.1 });
  },

  huntChase() {
    if (!this.ready) return;
    if (playSample('hunt.chase', { gain: 0.75 })) return;
    // жертва замечена: рык + резкий шумовой подъём
    tone({ type: 'sawtooth', freq: 92, slide: 55, dur: 0.9, gain: 0.13, vib: 24, vibRate: 9, attack: 0.005 });
    noise({ dur: 0.7, type: 'bandpass', freq: 480, q: 1.4, gain: 0.15, freqEnd: 950, attack: 0.01 });
    tone({ type: 'sine', freq: 46, dur: 0.8, gain: 0.2, attack: 0.004 });
  },

  jumpscare() {
    if (!this.ready) return;
    if (playSample('player.jumpscare', { gain: 0.9 })) return;
    // мгновенный удар + рваный крик из формант (менее «пищит», более глотка)
    noise({ dur: 0.14, type: 'lowpass', freq: 500, gain: 0.4, attack: 0.001 });
    tone({ type: 'sine', freq: 60, slide: 28, dur: 1.3, gain: 0.32, attack: 0.001 });
    for (const [f, g] of [[520, 0.12], [830, 0.09], [1350, 0.05]]) {
      tone({ type: 'sawtooth', freq: f * 1.15, slide: f * 0.55, dur: 0.9, gain: g, vib: 90, vibRate: 16, attack: 0.005 });
    }
    noise({ dur: 1.0, type: 'bandpass', freq: 1100, q: 1.2, gain: 0.22, freqEnd: 350, attack: 0.004 });
  },

  thunder(closeness = 0.5) {
    if (!this.ready) return;
    if (playSample('weather.thunder', { gain: 0.35 + closeness * 0.45, rate: sampleGain(1, 0.08) })) return;
    // раскат: длинный низкий рокот, при близком ударе — треск в начале
    if (closeness > 0.7) {
      noise({ dur: 0.4, type: 'highpass', freq: 900, gain: 0.14, attack: 0.005 });
    }
    noise({
      dur: 3.5 + Math.random() * 2, type: 'lowpass',
      freq: 160 + closeness * 120, freqEnd: 45,
      gain: 0.1 + closeness * 0.14, attack: 0.15, rate: 0.5,
    });
    tone({ type: 'sine', freq: 55, slide: 30, dur: 3.2, gain: 0.06 + closeness * 0.08, attack: 0.1 });
  },

  death() {
    if (!this.ready) return;
    if (playSample('player.death', { gain: 0.7 })) return;
    tone({ type: 'sine', freq: 220, slide: 40, dur: 3.2, gain: 0.12 });
    noise({ dur: 3, freq: 100, type: 'lowpass', gain: 0.1, freqEnd: 40 });
  },

  win() {
    if (!this.ready) return;
    [262, 330, 392, 523].forEach((f, i) =>
      setTimeout(() => started && tone({ type: 'triangle', freq: f, dur: 0.5, gain: 0.06 }), i * 170));
  },
};
