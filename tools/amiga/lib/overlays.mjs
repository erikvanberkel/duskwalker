// HUD, pause strip and boss panel (PF1 bands drawn in front of PF2).
import { hex, mixS } from './color.mjs';
import { OVERLAYS, STACK } from './layout.mjs';
import { renderText } from './font.mjs';

const band = (def, width = 384) => ({
  ...def, factor: 0, maxScroll: 0, width, px: new Uint8Array(width * def.rows), statics: [], grads: [],
  set(x, y, c) { if (x >= 0 && x < width && y >= 0 && y < def.rows) this.px[y * width + x] = c; },
});

// text with letter spacing, scaled, drawn at band coords (x is screen x; band memory x = screen x + 64)
function stamp(b, font, s, sx, y, scale, color, spacing = 0, glow = 0) {
  const chars = [...s];
  const imgs = chars.map((c) => renderText(font, c, scale));
  const total = imgs.reduce((w, im) => w + im.w + spacing, -spacing);
  let x = sx === 'center' ? 160 - Math.floor(total / 2) : sx;
  for (const im of imgs) {
    for (let yy = 0; yy < im.h; yy++)
      for (let xx = 0; xx < im.w; xx++)
        if (im.px[yy * im.w + xx]) {
          if (glow) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) {
            const bx = x + xx + dx + 64, by = y + yy + dy;
            if (by >= 0 && by < b.rows && bx >= 0 && bx < b.width && !b.px[by * b.width + bx]) b.px[by * b.width + bx] = glow;
          }
          b.set(x + xx + 64, y + yy, color);
        }
    x += im.w + spacing;
  }
  return total;
}

export const ZONE_NAMES = ['THE AMBER PLAINS', 'THE WHISPERING GROVE', 'THE SUNKEN CAUSEWAY'];

export function buildOverlays(P, font) {
  const out = {};
  // HUD: 1 cream text, 2 shadow, 3 pip (per-line gradient), 4 pip dark edge, 5 pip off, 6 ember bar, 7 bar track, 8 frame
  const hud = band(STACK[0]);
  hud.statics.push([1, P.alloc([hex('#f6e7c8')])], [2, P.alloc([hex('#140a20')])], [4, P.alloc([hex('#6a1410')])],
    [5, P.alloc([hex('#3a2a3a')])], [6, P.alloc([hex('#ffb35c')])], [7, P.alloc([hex('#2a1a2e')])], [8, P.alloc([hex('#ff6a3d')])]);
  for (let y = 0; y < hud.rows; y++) hud.grads.push([y, 3, P.alloc([mixS(hex('#ff8a6a'), hex('#a3201a'), Math.max(0, Math.min(1, (y - 3) / 10)))])]);
  out.HUD = hud;

  // pause strip
  const pause = band(OVERLAYS[0]);
  for (let i = 0; i < pause.px.length; i++) pause.px[i] = 3;
  for (let x = 0; x < pause.width; x++) { pause.set(x, 0, 4); pause.set(x, pause.rows - 1, 4); }
  stamp(pause, font, 'PAUSED', 'center', 4, 3, 1, 6, 2);
  stamp(pause, font, 'PRESS P TO CONTINUE', 'center', 26, 1, 5, 1);
  pause.statics.push([1, P.alloc([hex('#ffd9a0')])], [2, P.alloc([hex('#a3401a')])], [3, P.alloc([hex('#0b0614')])], [4, P.alloc([hex('#5a2a2a')])], [5, P.alloc([hex('#bfa890')])]);
  out.PAUSE = pause;

  // boss panel: name + bar (the fill is drawn at run time)
  const boss = band(OVERLAYS[1]);
  for (let i = 0; i < boss.px.length; i++) boss.px[i] = 7;
  for (let x = 0; x < boss.width; x++) boss.set(x, 0, 8);
  stamp(boss, font, 'THE BRAMBLE TITAN', 'center', 3, 1, 1, 2);
  for (let x = 52; x < 268; x++) { boss.set(x + 64, 12, 2); boss.set(x + 64, 19, 2); }
  for (let y = 12; y < 20; y++) { boss.set(52 + 64, y, 2); boss.set(267 + 64, y, 2); }
  boss.statics.push([1, P.alloc([hex('#f6e7c8')])], [2, P.alloc([hex('#7a4a3a')])], [3, P.alloc([hex('#7b1a3a')])], [4, P.alloc([hex('#e0443a')])],
    [5, P.alloc([hex('#ffb35c')])], [6, P.alloc([hex('#25141e')])], [7, P.alloc([hex('#0b0614')])], [8, P.alloc([hex('#5a2a2a')])]);
  out.BOSS = boss;
  // the copper loads an overlay's colours from its first line on, 5 per line: load them in the order the
  // rows need them so none shows up late
  for (const b of [pause, boss]) {
    const first = (hw) => { const i = b.px.indexOf(hw); return i < 0 ? b.rows : Math.floor(i / b.width); };
    b.statics.sort((a, c) => first(a[0]) - first(c[0]));
  }
  return out;
}
