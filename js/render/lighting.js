// Тьма и источники света. Offscreen-канвас в половинном разрешении:
// заливается почти чёрным, затем внутри полигона видимости «выбиваются»
// источники света (destination-out). Стены не пропускают свет.

import { TILE, makeCanvas } from '../core/utils.js';
import { pathPolygon } from './visibility.js';
import { FLOOR_BASEMENT } from '../world/house.js';

const LIGHT_SCALE = 0.5;

export class Lighting {
  constructor() {
    this.canvas = makeCanvas(2, 2);
    this.ctx = this.canvas.getContext('2d');
    this.flicker = 1;      // глобальный фактор мерцания электрики
    this.flickerT = 0;
  }

  resize(w, h) {
    this.canvas.width = Math.ceil(w * LIGHT_SCALE);
    this.canvas.height = Math.ceil(h * LIGHT_SCALE);
  }

  update(dt, game) {
    // мерцание: во время охоты или рядом с призраком при событии
    this.flickerT -= dt;
    let target = 1;
    const gh = game.ghost;
    if (gh) {
      const near = gh.floor === game.player.floor &&
        Math.hypot(gh.x - game.player.x, gh.y - game.player.y) < TILE * 10;
      if ((gh.state === 'hunt' || gh.state === 'event') && near) {
        if (this.flickerT <= 0) {
          this.flicker = Math.random() < 0.4 ? 0.15 + Math.random() * 0.4 : 1;
          this.flickerT = 0.04 + Math.random() * 0.12;
        }
        return;
      }
    }
    this.flicker = target;
  }

  // punch: радиальный градиент destination-out
  punch(x, y, r, strength) {
    const c = this.ctx;
    const g = c.createRadialGradient(x, y, r * 0.08, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.65, `rgba(0,0,0,${strength * 0.55})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }

  punchCone(x, y, angle, spread, r, strength) {
    const c = this.ctx;
    const g = c.createRadialGradient(x, y, 6, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.7, `rgba(0,0,0,${strength * 0.6})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r, angle - spread, angle + spread);
    c.closePath();
    c.fill();
  }

  render(game, cam, visPoly) {
    const c = this.ctx;
    const { player, world } = game;
    const W = this.canvas.width, H = this.canvas.height;

    c.globalCompositeOperation = 'source-over';
    c.setTransform(1, 0, 0, 1, 0, 0);
    // базовая тьма (в подвале — чернее)
    c.fillStyle = player.floor === FLOOR_BASEMENT ? 'rgba(1,2,4,0.995)' : 'rgba(2,4,8,0.985)';
    c.clearRect(0, 0, W, H);
    c.fillRect(0, 0, W, H);

    // трансформация камеры в масштабе канваса света
    const s = cam.scale * LIGHT_SCALE;
    c.setTransform(s, 0, 0, s,
      W / 2 - (cam.x + cam.sx) * s,
      H / 2 - (cam.y + cam.sy) * s);

    c.globalCompositeOperation = 'destination-out';
    c.save();
    pathPolygon(c, visPoly);
    c.clip();

    const fl = this.flicker;
    const outdoors = !world.isIndoors(player.floor, player.x, player.y);

    // фоновая видимость внутри полигона
    if (outdoors) {
      // лунный свет на улице
      c.fillStyle = 'rgba(0,0,0,0.42)';
      c.fillRect(cam.x - 2000, cam.y - 2000, 4000, 4000);
    } else {
      c.fillStyle = 'rgba(0,0,0,0.09)';
      c.fillRect(cam.x - 2000, cam.y - 2000, 4000, 4000);
    }

    // собственный круг видимости игрока
    this.punch(player.x, player.y, TILE * 2.1, player.hidden ? 0.22 : 0.42);

    // фонарик
    if (player.flashlightOn && !player.hidden) {
      const isUV = player.currentItem() === 'uv';
      const r = isUV ? TILE * 4.6 : TILE * 8;
      const spread = isUV ? 0.34 : 0.42;
      this.punchCone(player.x, player.y, player.angle, spread, r, 0.95 * fl);
    }

    // лампы комнат
    const breakerOn = world.breaker.on;
    for (const room of world.rooms) {
      if (room.floor !== player.floor || !room.lightOn || !breakerOn || room.lightBroken) continue;
      for (const l of room.lamps) this.punch(l.x, l.y, TILE * 5.6, 0.93 * fl);
    }

    // лунный свет из окон (первый этаж)
    if (player.floor === 0) {
      for (const w of world.windows) {
        this.punch((w.tx + 0.5) * TILE, (w.ty + 0.5) * TILE, TILE * 1.9, 0.16);
      }
      // свет крыльца
      this.punch(9.2 * TILE, 14.4 * TILE, TILE * 2.6, (0.45 + Math.sin(game.time * 13) * 0.06) * fl);
      // фургон светится изнутри
      this.punch(world.van.x + world.van.w / 2, world.van.y + world.van.h - TILE * 0.6, TILE * 2.4, 0.5);
    }

    // размещённое снаряжение
    for (const it of world.placed) {
      if (it.floor !== player.floor) continue;
      if (it.type === 'camera') this.punch(it.x, it.y, TILE * 0.8, 0.3);
      if (it.type === 'dots') this.punch(it.x, it.y, TILE * 2.6, 0.28 * fl);
    }

    // призрак чуть виден в темноте при манифестации
    const gh = game.ghost;
    if (gh && gh.floor === player.floor && gh.visibleAlpha > 0.02) {
      this.punch(gh.x, gh.y, TILE * 1.8, 0.4 * gh.visibleAlpha);
    }

    c.restore();
    c.globalCompositeOperation = 'source-over';
  }

  // нарисовать поверх сцены
  compose(ctx, viewW, viewH) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, viewW, viewH);
  }
}
