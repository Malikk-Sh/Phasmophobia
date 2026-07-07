// HUD: кнопки, слоты, показания приборов, тосты, таймер подготовки.

import { input } from '../core/input.js';
import { ITEMS, equipment } from '../systems/equipment.js';
import { fmtTime } from '../core/utils.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);

export const hud = {
  el: null,

  build() {
    this.el = $('#hud');
    this.el.innerHTML = `
      <div id="slots">
        <div class="slot" data-i="0"></div>
        <div class="slot" data-i="1"></div>
        <div class="slot" data-i="2"></div>
      </div>
      <div id="setup-timer"></div>
      <button id="btn-journal" class="hud-btn">${icon('journal')}</button>
      <button id="btn-interact" class="hud-btn">${icon('hand')}<span class="lbl">ДЕЙСТВИЕ</span></button>
      <button id="btn-use" class="hud-btn">${icon('use')}<span>ИСП.</span></button>
      <button id="btn-cycle" class="hud-btn">${icon('cycle')}</button>
      <button id="btn-flash" class="hud-btn">${icon('flashlight')}</button>
      <button id="btn-ask" class="hidden">${icon('mic')}Задать вопрос</button>
      <div id="item-readout" class="hidden"></div>
    `;
    input.bindButton($('#btn-interact'), 'interact');
    input.bindButton($('#btn-use'), 'use');
    input.bindButton($('#btn-cycle'), 'cycle');
    input.bindButton($('#btn-flash'), 'flashlight');
    input.bindButton($('#btn-journal'), 'journal');
    input.bindButton($('#btn-ask'), 'ask');
  },

  show() { this.el.classList.remove('hidden'); },
  hide() { this.el.classList.add('hidden'); },

  toast(msg, cls = '') {
    const box = $('#toast');
    const div = document.createElement('div');
    div.className = 'toast-msg ' + cls;
    div.textContent = msg;
    box.appendChild(div);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => div.classList.add('fade'), 2600);
    setTimeout(() => div.remove(), 3400);
  },

  update(game) {
    const pl = game.player;
    // слоты
    const slots = this.el.querySelectorAll('.slot');
    slots.forEach((s, i) => {
      const item = pl.inventory[i];
      s.classList.toggle('active', i === pl.activeSlot);
      s.classList.toggle('empty', !item);
      const want = item ? ITEMS[item].icon : '';
      if (s.dataset.icon !== want) {
        s.dataset.icon = want;
        s.innerHTML = want ? icon(want) : '';
      }
    });

    // показания
    const ro = equipment.readout(game);
    const roEl = $('#item-readout');
    if (ro && !pl.hidden) {
      roEl.classList.remove('hidden');
      let html = `<div class="item-name">${ro.name}</div>`;
      if (ro.bars !== undefined) {
        html += `<div class="emf-bars">${[1, 2, 3, 4, 5].map(l =>
          `<span class="${ro.bars >= l ? 'on' + ro.bars : ''}"></span>`).join('')}</div>`;
      } else {
        html += `<div class="item-value ${ro.danger ? 'danger' : ''}">${ro.value ?? ''}</div>`;
      }
      roEl.innerHTML = html;
    } else roEl.classList.add('hidden');

    // кнопка вопроса (спиритбокс)
    $('#btn-ask').classList.toggle('hidden',
      pl.currentItem() !== 'spirit' || pl.hidden || !pl.alive);

    // контекстное действие
    const btn = $('#btn-interact');
    const act = game.currentInteraction;
    if (pl.hidden) {
      btn.querySelector('.lbl').textContent = 'ВЫЙТИ';
      btn.classList.add('pulse');
    } else if (act) {
      btn.querySelector('.lbl').textContent = act.label;
      btn.classList.add('pulse');
    } else {
      btn.querySelector('.lbl').textContent = '···';
      btn.classList.remove('pulse');
    }

    // фонарик
    $('#btn-flash').classList.toggle('off', !pl.flashlightOn);

    // таймер подготовки. Охота НЕ объявляется текстом — о ней говорят
    // мерцающий фонарик, помехи приборов и сердцебиение.
    // На «Любителе» спустя несколько секунд появляется скромная пиктограмма.
    const st = $('#setup-timer');
    if (game.ghost && game.ghost.state === 'hunt' &&
      game.difficulty === 'amateur' && (game.huntTime || 0) > 5) {
      st.textContent = '⚠';
      st.classList.add('hunt-warn');
    } else if (game.setupPhase) {
      st.textContent = `Подготовка: ${fmtTime(game.setupTimer)}`;
      st.classList.remove('hunt-warn');
    } else {
      st.textContent = '';
      st.classList.remove('hunt-warn');
    }
  },
};
