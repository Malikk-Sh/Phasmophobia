// Процедурный звук на WebAudio: эмбиент, шаги, приборы, призрак, охота.
// Ни одного аудиофайла — всё синтезируется.

let ctx = null;
let master, comp;
let noiseBuf = null;
let started = false;

// постоянные узлы
let droneOsc1, droneOsc2, droneGain;
let windSrc, windGain, windFilter;
let spiritSrc, spiritGain;
let huntGainNode = null;

// таймеры
const T = { heart: 0, emf: 0, ghostStep: 0, creak: 8 };

function now() { return ctx.currentTime; }

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
  src.connect(f).connect(g).connect(p).connect(master);
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
  o.connect(g).connect(p).connect(master);
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
    this.ready = true;
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
    droneGain.connect(master);
    droneOsc1.start(); droneOsc2.start();
    // ветер
    windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass';
    windFilter.frequency.value = 320; windFilter.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0.0;
    windSrc.connect(windFilter).connect(windGain).connect(master);
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
    spiritSrc.connect(sf).connect(spiritGain).connect(master);
    spiritSrc.start();
  },

  setAmbience(indoors, basement) {
    if (!this.ready) return;
    const t = now();
    droneGain.gain.linearRampToValueAtTime(indoors ? (basement ? 0.05 : 0.035) : 0.015, t + 1.2);
    windGain.gain.linearRampToValueAtTime(indoors ? 0.006 : 0.035, t + 1.2);
  },

  // ---------- Кадровое обновление ----------
  update(dt, s) {
    if (!this.ready) return;
    // сердцебиение
    if (s.heartbeat > 0.02) {
      T.heart -= dt;
      if (T.heart <= 0) {
        T.heart = 1.15 - s.heartbeat * 0.65;
        const g = 0.1 + s.heartbeat * 0.2;
        tone({ type: 'sine', freq: 58, dur: 0.11, gain: g, slide: 40 });
        setTimeout(() => started && tone({ type: 'sine', freq: 52, dur: 0.1, gain: g * 0.7, slide: 38 }), 160);
      }
    }
    // писк ЭМП
    if (s.emfLevel > 0) {
      T.emf -= dt;
      if (T.emf <= 0) {
        T.emf = s.emfLevel >= 5 ? 0.09 : 0.65 / s.emfLevel;
        tone({ type: 'square', freq: 520 + s.emfLevel * 130, dur: 0.05, gain: 0.05 + s.emfLevel * 0.012 });
      }
    }
    // спиритбокс: шум эфира
    spiritGain.gain.setTargetAtTime(s.spiritOn ? 0.05 : 0, now(), 0.1);
    // шаги призрака при охоте
    if (s.huntNear > 0.02) {
      T.ghostStep -= dt;
      if (T.ghostStep <= 0) {
        T.ghostStep = 0.55;
        noise({ dur: 0.16, type: 'lowpass', freq: 130, gain: 0.16 * s.huntNear, rate: 0.5 });
        tone({ type: 'sine', freq: 40, dur: 0.15, gain: 0.22 * s.huntNear, slide: 28 });
      }
    }
    // случайные скрипы дома
    T.creak -= dt;
    if (T.creak <= 0) {
      T.creak = 14 + Math.random() * 26;
      if (Math.random() < 0.6) {
        const pan = Math.random() * 1.6 - 0.8;
        if (Math.random() < 0.5) tone({ type: 'sawtooth', freq: 140 + Math.random() * 120, slide: 90, dur: 0.9, gain: 0.012, pan, vib: 14, vibRate: 3 });
        else noise({ dur: 0.5, freq: 300, gain: 0.02, pan, type: 'bandpass', q: 3 });
      }
    }
  },

  // ---------- Одноразовые ----------
  footstep(outdoors) {
    if (!this.ready) return;
    const v = 0.05 + Math.random() * 0.02;
    if (outdoors) noise({ dur: 0.09, type: 'highpass', freq: 500, gain: v * 0.9, rate: 1.6 });
    else {
      noise({ dur: 0.07, type: 'lowpass', freq: 300, gain: v, rate: 0.8 });
      if (Math.random() < 0.12) tone({ type: 'sawtooth', freq: 90, slide: 60, dur: 0.28, gain: 0.014 }); // скрип половицы
    }
  },

  doorCreak(slam = false) {
    if (!this.ready) return;
    if (slam) {
      noise({ dur: 0.18, freq: 200, gain: 0.3, type: 'lowpass' });
      tone({ type: 'sine', freq: 70, slide: 40, dur: 0.22, gain: 0.3 });
    } else {
      tone({ type: 'sawtooth', freq: 160 + Math.random() * 80, slide: 220, dur: 1.1, gain: 0.03, vib: 30, vibRate: 4.5 });
      noise({ dur: 0.3, freq: 700, gain: 0.02, type: 'bandpass', q: 4 });
    }
  },

  switchClick() { if (this.ready) noise({ dur: 0.04, type: 'highpass', freq: 1800, gain: 0.12 }); },
  uiClick() { if (this.ready) tone({ type: 'sine', freq: 660, dur: 0.05, gain: 0.05 }); },

  breakerOff() {
    if (!this.ready) return;
    tone({ type: 'square', freq: 120, slide: 45, dur: 0.5, gain: 0.15 });
    noise({ dur: 0.4, freq: 150, gain: 0.2, freqEnd: 60 });
  },
  breakerOn() {
    if (!this.ready) return;
    tone({ type: 'square', freq: 60, slide: 130, dur: 0.3, gain: 0.12 });
    noise({ dur: 0.15, freq: 2000, gain: 0.06, type: 'highpass' });
  },

  propWhoosh() {
    if (!this.ready) return;
    noise({ dur: 0.25, type: 'bandpass', freq: 900, freqEnd: 300, q: 1.5, gain: 0.1 });
  },
  propImpact(hard = true) {
    if (!this.ready) return;
    noise({ dur: 0.12, freq: hard ? 2400 : 500, type: hard ? 'highpass' : 'lowpass', gain: 0.18 });
    tone({ type: 'triangle', freq: hard ? 320 : 120, slide: 60, dur: 0.12, gain: 0.1 });
  },

  writing() {
    if (!this.ready) return;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => started && noise({ dur: 0.08, type: 'bandpass', freq: 2600, q: 4, gain: 0.05 }), i * 130);
    }
  },

  whisper() {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => started && noise({
        dur: 0.22, type: 'bandpass', freq: 1300 + Math.random() * 1400, q: 6,
        gain: 0.05, pan: Math.random() * 1.4 - 0.7,
      }), i * 180 + Math.random() * 80);
    }
  },

  spiritResponse() {
    if (!this.ready) return;
    // «голос» сквозь помехи
    const base = 110 + Math.random() * 60;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!started) return;
        tone({ type: 'sawtooth', freq: base * (1 + i * 0.12), slide: base * 0.7, dur: 0.3, gain: 0.06, vib: 25, vibRate: 9 });
        noise({ dur: 0.28, type: 'bandpass', freq: 1600, q: 5, gain: 0.08 });
      }, i * 260);
    }
  },

  ghostEvent(form) {
    if (!this.ready) return;
    if (form === 'lady') {
      // женский напев
      const seq = [523, 494, 440, 392];
      seq.forEach((f, i) => setTimeout(() => started &&
        tone({ type: 'sine', freq: f * 0.5, dur: 0.8, gain: 0.045, vib: 6, vibRate: 5.5 }), i * 620));
    } else if (form === 'hangman') {
      tone({ type: 'sawtooth', freq: 60, slide: 35, dur: 2.4, gain: 0.06, vib: 8, vibRate: 2 });
      noise({ dur: 2, freq: 240, type: 'bandpass', q: 3, gain: 0.03 });
    } else {
      noise({ dur: 2.4, freq: 90, type: 'lowpass', gain: 0.1, freqEnd: 45 });
      tone({ type: 'triangle', freq: 38, dur: 2.4, gain: 0.08, vib: 5, vibRate: 1.5 });
    }
  },

  bansheeWail() {
    if (!this.ready) return;
    tone({ type: 'sine', freq: 880, slide: 420, dur: 2.6, gain: 0.045, vib: 30, vibRate: 5 });
    tone({ type: 'sine', freq: 1320, slide: 660, dur: 2.2, gain: 0.02, vib: 40, vibRate: 6 });
  },

  crucifixBurn() {
    if (!this.ready) return;
    noise({ dur: 0.8, type: 'highpass', freq: 2200, gain: 0.12 });
    tone({ type: 'sine', freq: 660, slide: 1200, dur: 0.5, gain: 0.06 });
  },

  smudgeUse() {
    if (!this.ready) return;
    noise({ dur: 1.4, type: 'highpass', freq: 3400, gain: 0.05 });
    noise({ dur: 1.2, type: 'bandpass', freq: 500, q: 1, gain: 0.04 });
  },
  saltPour() { if (this.ready) noise({ dur: 0.4, type: 'highpass', freq: 4200, gain: 0.07 }); },
  pills() { if (this.ready) { noise({ dur: 0.1, type: 'highpass', freq: 2500, gain: 0.06 }); setTimeout(() => started && noise({ dur: 0.08, type: 'highpass', freq: 2000, gain: 0.05 }), 150); } },
  cameraPlace() { if (this.ready) { tone({ type: 'square', freq: 900, dur: 0.05, gain: 0.05 }); setTimeout(() => started && tone({ type: 'square', freq: 1200, dur: 0.05, gain: 0.045 }), 90); } },

  huntStart() {
    if (!this.ready) return;
    // нарастающий гул + удар
    tone({ type: 'sawtooth', freq: 30, slide: 55, dur: 1.6, gain: 0.16 });
    noise({ dur: 1.8, freq: 60, type: 'lowpass', gain: 0.22, freqEnd: 200 });
    setTimeout(() => started && tone({ type: 'sine', freq: 200, slide: 40, dur: 0.9, gain: 0.22 }), 300);
    // вой
    setTimeout(() => started && tone({ type: 'sawtooth', freq: 320, slide: 110, dur: 1.8, gain: 0.05, vib: 45, vibRate: 7 }), 500);
  },

  huntEnd() {
    if (!this.ready) return;
    tone({ type: 'sine', freq: 90, slide: 30, dur: 2.2, gain: 0.1 });
  },

  jumpscare() {
    if (!this.ready) return;
    // крик — резкий, но с ограниченной громкостью
    for (const f of [720, 940, 1180]) {
      tone({ type: 'sawtooth', freq: f, slide: f * 0.45, dur: 1.1, gain: 0.11, vib: 60, vibRate: 11 });
    }
    noise({ dur: 1.2, type: 'bandpass', freq: 1500, q: 0.7, gain: 0.28, freqEnd: 500 });
    tone({ type: 'sine', freq: 55, slide: 30, dur: 1.4, gain: 0.3 });
  },

  death() {
    if (!this.ready) return;
    tone({ type: 'sine', freq: 220, slide: 40, dur: 3.2, gain: 0.12 });
    noise({ dur: 3, freq: 100, type: 'lowpass', gain: 0.1, freqEnd: 40 });
  },

  win() {
    if (!this.ready) return;
    [262, 330, 392, 523].forEach((f, i) =>
      setTimeout(() => started && tone({ type: 'triangle', freq: f, dur: 0.5, gain: 0.06 }), i * 170));
  },
};
