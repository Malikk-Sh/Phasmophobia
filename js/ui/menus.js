// Меню, брифинг, результаты, смерть, «как играть».

import { audio } from '../core/audio.js';
import { GHOSTS } from '../systems/ghostData.js';

const $ = (s) => document.querySelector(s);

export const menus = {
  difficulty: 'amateur',

  build(game) {
    this.game = game;
    this.renderMain();
  },

  renderMain() {
    const p = this.game.progress;
    $('#menu').innerHTML = `
      <div class="panel">
        <div class="game-title">ФАЗМОФОБИЯ</div>
        <div class="subtitle">ПАРАНОРМАЛЬНОЕ РАССЛЕДОВАНИЕ · WEB</div>
        <div class="diff-row">
          <button class="diff-btn ${this.difficulty === 'amateur' ? 'sel' : ''}" data-d="amateur">ЛЮБИТЕЛЬ</button>
          <button class="diff-btn ${this.difficulty === 'pro' ? 'sel' : ''}" data-d="pro">ПРОФЕССИОНАЛ</button>
        </div>
        <button class="menu-btn" id="m-play">НАЧАТЬ РАССЛЕДОВАНИЕ</button>
        <button class="menu-btn secondary" id="m-how">КАК ИГРАТЬ</button>
        <div class="stats-line">
          КОНТРАКТЫ: ${p.contracts} · ВЕРНО: ${p.correct} · $${p.money} · СМЕРТЕЙ: ${p.deaths}
        </div>
      </div>`;
    $('#menu').querySelectorAll('.diff-btn').forEach(b =>
      b.addEventListener('click', () => {
        this.difficulty = b.dataset.d;
        audio.init(); audio.uiClick();
        this.renderMain();
      }));
    $('#m-play').addEventListener('click', () => {
      audio.init(); audio.resume(); audio.uiClick();
      this.showBriefing();
    });
    $('#m-how').addEventListener('click', () => { audio.init(); audio.uiClick(); this.showHow(); });
  },

  showHow() {
    $('#menu').innerHTML = `
      <div class="panel">
        <h2 style="text-align:center; letter-spacing:3px; margin-bottom:14px">КАК ИГРАТЬ</h2>
        <div style="font-size:14px; line-height:1.75; color:#a8b8c2">
          <b>Цель:</b> определить тип призрака по трём уликам и выжить.<br><br>
          <b>Управление:</b> левая половина экрана — джойстик движения, правая — направление
          взгляда и фонарика. На ПК: WASD + мышь, E — действие, R — использовать, Q — смена
          предмета, F — фонарик, J — журнал.<br><br>
          <b>Ход игры:</b> возьмите снаряжение в фургоне (3 слота), войдите в дом,
          найдите комнату призрака (холод, активность). Собирайте улики: ЭМП-5,
          ответ спиритбокса (в темноте!), УФ-отпечатки на дверях, огоньки через
          видеокамеру на мониторе фургона, запись в размещённой книге, минусовую
          температуру, силуэт у DOTS-проектора.<br><br>
          <b>Рассудок</b> тает в темноте и от встреч с призраком. Чем он ниже, тем
          вероятнее <b style="color:#d86a5a">охота</b>: прячьтесь в шкафы, разрывайте
          линию взгляда, жгите благовония. Распятие предотвращает охоту.<br><br>
          Отметьте улики в журнале, выберите призрака и завершите контракт у фургона.
        </div>
        <button class="menu-btn" id="m-back">НАЗАД</button>
      </div>`;
    $('#m-back').addEventListener('click', () => { audio.uiClick(); this.renderMain(); });
  },

  showBriefing() {
    const g = this.game;
    g.prepareContract(this.difficulty);
    $('#menu').classList.add('hidden');
    $('#briefing').classList.remove('hidden');
    $('#briefing').innerHTML = `
      <div class="panel">
        <h2 style="letter-spacing:3px; text-align:center">КОНТРАКТ</h2>
        <p style="text-align:center; color:#5f7480; margin:4px 0 16px">ул. Уиллоу-Крик, д. 13 — одиночная смена</p>
        <div style="font-size:14px; line-height:1.8; color:#a8b8c2; max-width:440px; margin:0 auto">
          Соседи сообщают о шуме и свете в окнах пустующего дома. Последний жилец
          пропал без вести. Определите, что за сущность поселилась внутри.<br><br>
          <b>Сложность:</b> ${this.difficulty === 'pro' ? 'Профессионал (без подготовки, быстрый дренаж, ×2 награда)' : 'Любитель (2 мин подготовки)'}<br>
          <b>Задачи:</b><br>
          ${g.objectives.map(o => `— ${o.name}`).join('<br>')}
        </div>
        <button class="menu-btn" id="b-go">ВЫЙТИ ИЗ ФУРГОНА</button>
      </div>`;
    $('#b-go').addEventListener('click', () => {
      audio.uiClick();
      $('#briefing').classList.add('hidden');
      g.startContract();
    });
  },

  showResults(res) {
    const g = this.game;
    $('#results').classList.remove('hidden');
    const ghostName = GHOSTS.find(x => x.key === res.actual).name;
    const pickName = res.picked ? GHOSTS.find(x => x.key === res.picked).name : '—';
    $('#results').innerHTML = `
      <div class="panel">
        <div class="result-verdict ${res.correct ? 'win' : 'lose'}">
          ${res.correct ? 'ПРИЗРАК ОПОЗНАН' : res.died ? 'ВЫ ПОГИБЛИ' : 'НЕВЕРНЫЙ ОТВЕТ'}
        </div>
        <p style="text-align:center; margin-top:10px; color:#8fa4b0">
          Это был: <b style="color:#cfdde5">${ghostName}</b> · Ваш ответ: ${pickName}
        </p>
        <div class="result-lines">
          <div>Базовая ставка <span class="rw">$${res.base}</span></div>
          <div>Верное опознание <span class="rw">$${res.bonus}</span></div>
          <div>Задачи (${res.objDone}/3) <span class="rw">$${res.objReward}</span></div>
          <div>Выжил <span class="rw">$${res.aliveBonus}</span></div>
          <div style="border-top:1px solid #2a3a44; margin-top:6px; padding-top:6px">
            ИТОГО <span class="rw">$${res.total}</span></div>
        </div>
        <button class="menu-btn" id="r-menu">В МЕНЮ</button>
      </div>`;
    $('#r-menu').addEventListener('click', () => {
      audio.uiClick();
      $('#results').classList.add('hidden');
      $('#menu').classList.remove('hidden');
      this.renderMain();
      g.state = 'menu';
    });
  },

  showDeath() {
    $('#death').classList.remove('hidden');
    $('#death').innerHTML = `
      <div class="panel">
        <div class="death-title">ВЫ МЕРТВЫ</div>
        <p style="text-align:center; color:#7a5a55; margin-top:14px; letter-spacing:1px">
          Призрак нашёл вас. Тело обнаружат утром…</p>
        <button class="menu-btn" id="d-next" style="border-color:rgba(180,80,60,.4)">ДАЛЕЕ</button>
      </div>`;
    $('#d-next').addEventListener('click', () => {
      $('#death').classList.add('hidden');
      this.game.finishContract(true);
    });
  },
};
