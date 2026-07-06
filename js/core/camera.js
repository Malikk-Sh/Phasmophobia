// Камера: плавное слежение, тряска, преобразования координат
import { damp, rndRange } from './utils.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.scale = 2;         // world px -> device px
    this.viewW = 0; this.viewH = 0; // device px
    this.shakeT = 0; this.shakeAmp = 0;
    this.sx = 0; this.sy = 0; // текущий сдвиг тряски
  }

  resize(w, h) {
    this.viewW = w; this.viewH = h;
    // видим ~340 world px по вертикали (≈10.5 тайлов)
    this.scale = h / 340;
  }

  snapTo(x, y) { this.x = x; this.y = y; }

  follow(tx, ty, dt) {
    this.x = damp(this.x, tx, 6, dt);
    this.y = damp(this.y, ty, 6, dt);
  }

  shake(amp, time) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  update(dt) {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.min(1, this.shakeT * 3);
      this.sx = rndRange(-a, a);
      this.sy = rndRange(-a, a);
      if (this.shakeT <= 0) { this.shakeAmp = 0; this.sx = 0; this.sy = 0; }
    } else { this.sx = 0; this.sy = 0; }
  }

  // применить трансформацию к контексту
  apply(ctx) {
    ctx.setTransform(this.scale, 0, 0, this.scale,
      this.viewW / 2 - (this.x + this.sx) * this.scale,
      this.viewH / 2 - (this.y + this.sy) * this.scale);
  }

  worldToScreen(wx, wy) {
    return {
      x: this.viewW / 2 + (wx - this.x - this.sx) * this.scale,
      y: this.viewH / 2 + (wy - this.y - this.sy) * this.scale,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: this.x + this.sx + (sx - this.viewW / 2) / this.scale,
      y: this.y + this.sy + (sy - this.viewH / 2) / this.scale,
    };
  }

  // мировые границы экрана с запасом
  bounds(pad = 64) {
    const hw = this.viewW / 2 / this.scale + pad;
    const hh = this.viewH / 2 / this.scale + pad;
    return { x: this.x - hw, y: this.y - hh, w: hw * 2, h: hh * 2 };
  }
}
