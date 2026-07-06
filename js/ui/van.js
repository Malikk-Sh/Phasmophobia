// Фургон: выбор снаряжения, монитор камер, датчики.

import { ITEMS } from '../systems/equipment.js';
import { audio } from '../core/audio.js';
import { TILE } from '../core/utils.js';

const $ = (s) => document.querySelector(s);

export const van = {
  isOpen: false,
  orbWatch: 0,

  build(game) {
    this.game = game;
    const el = $('#van');
    el.innerHTML = `
      <div class="panel" style="position:relative">
        <button class="jclose">✕</button>
        <div class="van-title">▙ ФУРГОН — ШТАБ ▟</div>
        <div class="van-cols">
          <div class="van-col">
            <div class="van-h">Монитор наблюдения</div>
            <canvas id="van-monitor" width="340" height="190"></canvas>
            <button class="menu-btn secondary" id="van-cam-next" style="margin-top:6px">Следующая камера ⏭</button>
            <div class="van-h">Датчики</div>
            <div class="van-meters" id="van-meters"></div>
          </div>
          <div class="van-col">
            <div class="van-h">Снаряжение (нажмите, чтобы взять в слот)</div>
            <div class="gear-grid" id="gear-grid"></div>
            <div id="gear-desc">Коснитесь предмета, чтобы прочитать описание.</div>
            <div class="van-h">Действия</div>
            <button class="menu-btn" id="van-close">ИДТИ РАССЛЕДОВАТЬ</button>
            <button class="menu-btn secondary" id="van-finish">ЗАВЕРШИТЬ КОНТРАКТ И УЕХАТЬ</button>
          </div>
        </div>
      </div>`;
    el.querySelector('.jclose').addEventListener('click', () => this.close());
    $('#van-close').addEventListener('click', () => this.close());
    $('#van-cam-next').addEventListener('click', () => { this.game.vanCamIndex++; audio.uiClick(); });
    $('#van-finish').addEventListener('click', () => this.game.finishContract());
  },

  open() {
    this.isOpen = true;
    this.orbWatch = 0;
    $('#van').classList.remove('hidden');
    this.renderGear();
  },
  close() {
    this.isOpen = false;
    $('#van').classList.add('hidden');
  },

  renderGear() {
    const g = this.game;
    const grid = $('#gear-grid');
    grid.innerHTML = Object.entries(ITEMS).map(([key, it]) => {
      const inSlot = g.player.inventory.includes(key);
      const uses = it.consumable ? ` ×${g.itemUses[key] ?? it.consumable}` : '';
      return `<button class="gear-item ${inSlot ? 'inslot' : ''}" data-k="${key}">
        <span class="gi">${it.icon}</span>${it.name}${uses}</button>`;
    }).join('');
    grid.querySelectorAll('.gear-item').forEach(b => {
      b.addEventListener('click', () => {
        const key = b.dataset.k;
        const it = ITEMS[key];
        const inv = g.player.inventory;
        const idx = inv.indexOf(key);
        if (idx >= 0) { inv[idx] = null; } // убрать из слота
        else {
          const free = inv.indexOf(null);
          if (free >= 0) inv[free] = key;
          else inv[g.player.activeSlot] = key;
        }
        audio.uiClick();
        this.renderGear();
        const d = $('#gear-desc');
        if (d) d.innerHTML = `<b>${it.icon} ${it.name}.</b> ${it.desc}`;
      });
    });
  },

  // вызывается каждый кадр, когда открыт
  update(dt) {
    const g = this.game;
    if (!this.isOpen) return;
    // монитор
    const src = g.renderer.renderMonitor(g);
    const cv = $('#van-monitor');
    const c = cv.getContext('2d');
    c.drawImage(src, 0, 0);

    // орбы как улика: смотреть на камеру в комнате с орбами
    const cams = g.world.placed.filter(p => p.type === 'camera');
    if (cams.length && (g.world.orbs || []).length) {
      const cam = cams[g.vanCamIndex % cams.length];
      const seen = g.world.orbs.some(o =>
        o.floor === cam.floor && Math.hypot(o.x - cam.x, o.y - cam.y) < TILE * 5);
      if (seen) {
        this.orbWatch += dt;
        if (this.orbWatch > 1.6) g.onEvidenceSeen('orbs');
      }
    }

    // датчики
    const gh = g.ghost;
    const meters = $('#van-meters');
    const sanity = Math.round(g.player.sanity);
    const activity = gh ? gh.activity : 0;
    const actBar = '█'.repeat(Math.round(activity)) + '░'.repeat(10 - Math.round(activity));
    meters.innerHTML =
      `РАССУДОК: <b>${sanity}%</b><br>` +
      `АКТИВНОСТЬ: <b>${actBar}</b> ${activity.toFixed(0)}<br>` +
      `ЭЛЕКТРОЩИТОК: <b>${g.world.breaker.on ? 'ВКЛ' : '<span style="color:#d86a5a">ВЫКЛ</span>'}</b><br>` +
      `КАМЕРЫ: <b>${cams.length}</b>`;
  },
};
