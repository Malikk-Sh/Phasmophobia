// Журнал: улики (3 состояния), фильтр призраков, выбор ответа, цели.

import { EVIDENCE, GHOSTS } from '../systems/ghostData.js';
import { audio } from '../core/audio.js';

const $ = (s) => document.querySelector(s);
const STATE_LABEL = ['—', 'НАЙДЕНО', 'ИСКЛЮЧЕНО'];

export const journal = {
  tab: 'ev',
  isOpen: false,

  build(game) {
    this.game = game;
    const el = $('#journal');
    el.innerHTML = `
      <div class="panel" style="position:relative; width:min(680px,94vw)">
        <button class="jclose">✕</button>
        <h2 style="letter-spacing:4px; font-size:18px; text-align:center; margin-bottom:12px">ЖУРНАЛ РАССЛЕДОВАНИЯ</h2>
        <div class="journal-tabs">
          <button class="jtab" data-tab="ev">УЛИКИ</button>
          <button class="jtab" data-tab="gh">ПРИЗРАКИ</button>
          <button class="jtab" data-tab="obj">ЦЕЛИ</button>
        </div>
        <div id="journal-body"></div>
      </div>`;
    el.querySelector('.jclose').addEventListener('click', () => this.close());
    el.querySelectorAll('.jtab').forEach(b =>
      b.addEventListener('click', () => { this.tab = b.dataset.tab; audio.uiClick(); this.render(); }));
  },

  open() {
    this.isOpen = true;
    $('#journal').classList.remove('hidden');
    this.render();
  },
  close() {
    this.isOpen = false;
    $('#journal').classList.add('hidden');
  },
  toggle() { this.isOpen ? this.close() : this.open(); },

  render() {
    const g = this.game;
    const body = $('#journal-body');
    document.querySelectorAll('.jtab').forEach(b =>
      b.classList.toggle('sel', b.dataset.tab === this.tab));

    if (this.tab === 'ev') {
      body.innerHTML = EVIDENCE.map(ev => {
        const st = g.journalMarks[ev.key] || 0;
        return `<div class="ev-row ${st === 1 ? 'found' : st === 2 ? 'excluded' : ''}" data-ev="${ev.key}">
          <span>${ev.icon} ${ev.name}</span>
          <button class="ev-state">${STATE_LABEL[st]}</button>
        </div>`;
      }).join('');
      body.querySelectorAll('.ev-row').forEach(row => {
        row.querySelector('.ev-state').addEventListener('click', () => {
          const k = row.dataset.ev;
          g.journalMarks[k] = ((g.journalMarks[k] || 0) + 1) % 3;
          audio.uiClick();
          this.render();
        });
      });
    } else if (this.tab === 'gh') {
      const found = EVIDENCE.filter(e => g.journalMarks[e.key] === 1).map(e => e.key);
      const excl = EVIDENCE.filter(e => g.journalMarks[e.key] === 2).map(e => e.key);
      body.innerHTML = GHOSTS.map(gh => {
        const possible = found.every(f => gh.ev.includes(f)) && !excl.some(x => gh.ev.includes(x));
        const picked = g.journalPick === gh.key;
        const evNames = gh.ev.map(k => EVIDENCE.find(e => e.key === k).name).join(' · ');
        return `<div class="ghost-row ${possible ? '' : 'impossible'} ${picked ? 'picked' : ''}" data-g="${gh.key}">
          <div class="g-name"><span>${gh.name}</span>
            <button class="g-pick">${picked ? '☑ ВАШ ОТВЕТ' : 'ВЫБРАТЬ'}</button></div>
          <div class="g-ev">${evNames}</div>
          <div class="g-desc">${gh.desc}</div>
        </div>`;
      }).join('');
      body.querySelectorAll('.ghost-row').forEach(row => {
        row.querySelector('.g-pick').addEventListener('click', () => {
          g.journalPick = g.journalPick === row.dataset.g ? null : row.dataset.g;
          audio.uiClick();
          this.render();
        });
      });
    } else {
      body.innerHTML = g.objectives.map(o =>
        `<div class="obj-row ${o.done ? 'done' : ''}">${o.done ? '☑' : '☐'} ${o.name}</div>`
      ).join('') +
        `<div class="obj-row" style="opacity:.7">☰ Опознайте призрака и завершите контракт у фургона</div>`;
    }
  },
};
