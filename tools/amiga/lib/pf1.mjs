// Playfield 1 art: sky (stars, moons, sun, clouds, far ridge), three hill ridges, the far tree line and the
// perspective floor, all drawn procedurally from the same palettes and noise as the 3D game.
import { mulberry32, fbm1, noise2, smooth, clamp } from '../../../src/util.js';
import { hex, mixL, mixS, scale, pack, rgb } from './color.mjs';
import { STACK, HORIZON_Y, PATH_Y, MAX_CAM_PX, groundFactor, PX_PER_UNIT } from './layout.mjs';

const C = {
  skyTop: hex('#140a30'), skyMid: hex('#4e2470'), skyLow: hex('#d8706a'), horizon: hex('#f2a26e'), fog: hex('#b56d78'), sun: hex('#ffd49a'),
};
const RIDGES = [
  { z: -1500, base: 70, amp: 260, freq: 0.003, top: hex('#9a5a86'), bottom: hex('#e39a82'), seed: 11, jag: 0.7 },
  { z: -1100, base: 35, amp: 170, freq: 0.005, top: hex('#7a3f72'), bottom: hex('#cf7a80'), seed: 23, jag: 0.6 },
  { z: -780, base: 18, amp: 105, freq: 0.0085, top: hex('#5b2c63'), bottom: hex('#b0637a'), seed: 37, jag: 0.55 },
  { z: -540, base: 6, amp: 62, freq: 0.014, top: hex('#43204f'), bottom: hex('#93506c'), seed: 51, jag: 0.4 },
];

// Sky colour for a screen row, following the dome shader (mixing in linear light).
export function skyColor(y) {
  const e = Math.max(-0.05, (HORIZON_Y - y) / 261) * 1.55;
  const ss = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
  let c = mixL(C.horizon, C.skyLow, ss(-0.02, 0.1, e));
  c = mixL(c, C.skyMid, ss(0.08, 0.35, e));
  c = mixL(c, C.skyTop, ss(0.3, 0.85, e));
  return c;
}

const bandWidth = (maxScroll) => (Math.floor((maxScroll + 127) / 64) - 1) * 64 + 384;

function makeBand(def, P) {
  const maxScroll = def.period ? def.period - 1 : Math.ceil(def.factor * MAX_CAM_PX) + 8;
  const width = Math.ceil(bandWidth(maxScroll) / 64) * 64;
  return {
    ...def, maxScroll: def.period ? 0 : maxScroll, width, px: new Uint8Array(width * def.rows), statics: [], grads: [],
    set(x, y, c) { if (x >= 0 && x < width && y >= 0 && y < def.rows) this.px[y * width + x] = c; },
    get(x, y) { return this.px[y * width + x]; },
    // world x (units) at the middle of the screen when this band's pixel column bx is there
    toWorld(bx) { return ((bx - 64 - 160) / (def.factor || 1) + 160) / PX_PER_UNIT; },
  };
}

// periodic copy: content for memory x is pattern((x - 64) mod period)
function wrapPeriodic(b, gen) {
  for (let y = 0; y < b.rows; y++) for (let x = 0; x < b.width; x++) b.px[y * b.width + x] = gen(((x - 64) % b.period + b.period) % b.period, y);
}

function ridgeHeight(r, wx) {
  const ridge = 1 - Math.abs(fbm1(wx * r.freq + r.seed, 5) * 2 - 1);
  return r.base + r.amp * (Math.pow(ridge, 1.6) * r.jag + fbm1(wx * r.freq * 0.37 + r.seed * 3, 3) * (1 - r.jag));
}

export function buildPF1(P) {
  const bands = Object.fromEntries(STACK.map((d) => [d.name, makeBand(d, P)]));
  const rng = mulberry32(4242);
  const sky = bands.SKY;
  const skyRow = (y) => skyColor(sky.y0 + y);

  // ---- colour 0: one entry per screen line (sky gradient), constant below the horizon ----
  const c0Pal = [];
  for (let y = 0; y < 256; y++) c0Pal.push(P.alloc([skyColor(Math.min(y, sky.y0 + sky.rows))]));

  // ---- sky band ----
  const SX = (sx) => sx + 64;  // band x for a screen x at the start of the level
  // stars: dim (6) and bright (13), thinning toward the horizon
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rng() * sky.width), y = Math.floor(Math.pow(rng(), 1.6) * 64);
    sky.set(x, y, rng() < 0.18 ? 13 : 6);
  }
  // clouds (alpha 7 thin, 8 dense, 5 lit tops), soft blobs like the cloud texture
  const cloudA = new Float32Array(sky.width * sky.rows);
  const banks = [[30, 30, 70], [150, 18, 60], [275, 36, 80], [395, 24, 64], [470, 40, 50]];
  for (const [cx, cy, w] of banks) {
    for (let i = 0; i < 22; i++) {
      const bx = cx + (rng() - 0.5) * w, by = cy + (rng() - 0.5) * 8, r = 4 + rng() * 9 * (1 - Math.abs(bx - cx) / w);
      for (let y = Math.floor(by - r); y <= by + r; y++)
        for (let x = Math.floor(bx - r * 1.8); x <= bx + r * 1.8; x++) {
          if (x < 0 || x >= sky.width || y < 0 || y >= sky.rows) continue;
          const d = Math.hypot((x - bx) / 1.8, y - by) / r;
          if (d < 1) cloudA[y * sky.width + x] += (1 - d * d) * 0.55;
        }
    }
  }
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const dith = (x, y) => (bayer[y & 3][x & 3] + 0.5) / 16;
  for (let y = 0; y < sky.rows; y++)
    for (let x = 0; x < sky.width; x++) {
      const a = cloudA[y * sky.width + x];
      if (a > 0.2 + dith(x, y) * 0.3) sky.set(x, y, a > 0.75 + dith(x, y) * 0.2 ? 8 : 7);
    }
  // moon B (small, amber) and moon A (big, lavender) with halo (9)
  const moon = (cx, cy, r, light, mid, dark, haloR) => {
    for (let y = Math.floor(cy - haloR); y <= cy + haloR; y++)
      for (let x = Math.floor(cx - haloR); x <= cx + haloR; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) {
          const lx = (x - cx) / r, ly = (y - cy) / r;
          let l = 0.75 - (lx * 0.45 + ly * 0.55) * 0.6 + (noise2(x * 0.45 + cx, y * 0.45) - 0.5) * 0.5;
          if (lx * 0.9 + ly * 0.35 > 0.45) l -= 0.5;   // terminator shadow
          sky.set(x, y, l > 0.62 ? light : l > 0.3 ? mid : dark);
        } else if (haloR > r && d <= haloR && (d < r + (haloR - r) * 0.55 || dith(x, y) < 0.45 * (haloR - d) / (haloR - r) + 0.1)) {
          if (!sky.get(x, y) || sky.get(x, y) >= 6) sky.set(x, y, 9);
        }
      }
  };
  moon(SX(224), 32, 19, 14, 15, 2, 32);
  moon(SX(150), 20, 6, 3, 4, 4, 6);
  // far ridge (1) across the lower sky band
  const r1 = RIDGES[0];
  const r1Top = 52, r1Base = 86;
  const ridgeTop = new Int16Array(sky.width);
  for (let x = 0; x < sky.width; x++) {
    const wx = (x - 64) * 5.8 - 400;   // ~0.17 px per world unit at z = -1500
    ridgeTop[x] = Math.round(r1Base - (ridgeHeight(r1, wx) - r1.base) / r1.amp * (r1Base - r1Top));
  }
  // the setting sun: core (12), inner glow (10), outer glow (11, dithered), sitting on the far ridge
  // place it in the deepest dip of the ridge between screen x 40 and 110 so no peak cuts the disc
  const ridgeAt = (cx) => { let m = 0; for (let x = cx - 9; x <= cx + 9; x++) m = Math.min(m || 999, ridgeTop[x]); return m; };
  let sunX = SX(72);
  for (let x = SX(40); x <= SX(110); x++) if (ridgeAt(x) > ridgeAt(sunX)) sunX = x;
  const sunY = ridgeAt(sunX) - 2;
  for (let y = sunY - 34; y <= sunY + 34; y++)
    for (let x = sunX - 34; x <= sunX + 34; x++) {
      const d = Math.hypot(x - sunX, (y - sunY) * 1.1);
      if (y < 0 || y >= sky.rows) continue;
      if (d < 10.5) sky.set(x, y, 12);
      else if (d < 16) sky.set(x, y, 10);
      else if (d < 33 && dith(x, y) < 1.15 - d / 30) sky.set(x, y, 11);
    }
  for (let x = 0; x < sky.width; x++) for (let y = ridgeTop[x]; y < sky.rows; y++) sky.set(x, y, 1);
  // per-line translucent colours in the sky band
  const cloudTint = (y) => mixS(hex('#f5b39a'), hex('#c27aa8'), clamp(y / 60, 0, 1));
  const present = (hw) => { const rows = new Set(); for (let y = 0; y < sky.rows; y++) for (let x = 0; x < sky.width; x++) if (sky.px[y * sky.width + x] === hw) { rows.add(y); break; } return rows; };
  const perLine = (hw, fn) => { for (const y of present(hw)) sky.grads.push([y, hw, P.alloc([fn(y)])]); };
  perLine(7, (y) => mixL(skyRow(y), cloudTint(y), 0.38));
  perLine(8, (y) => mixL(skyRow(y), scale(cloudTint(y), 0.92), 0.72));
  perLine(9, (y) => mixL(skyRow(y), hex('#dcc8ff'), 0.22));
  perLine(10, (y) => mixL(skyRow(y), hex('#ffe6b0'), 0.62));
  perLine(11, (y) => mixL(skyRow(y), hex('#ffc890'), 0.3));
  sky.statics.push([6, P.alloc([hex('#a99bc8')])], [13, P.alloc([hex('#fff4ff')])], [12, P.alloc([hex('#fff2c4')])],
    [14, P.alloc([hex('#f3e7ff')])], [15, P.alloc([hex('#bfaee0')])], [2, P.alloc([hex('#7d6aa8')])],
    [3, P.alloc([hex('#ffd2a1')])], [4, P.alloc([hex('#c06a48')])]);

  // ---- ridge gradients (hw 1..4), one entry per screen line over the rows where each is visible ----
  // screen rows of hills 2..4 (drawn inside the tree band as its backdrop)
  const R2Y = 112, R3Y = 122, R4Y = 131, R4END = 139;
  const ridgeRows = [[sky.y0 + r1Top, R3Y], [R2Y, R4Y], [R3Y, R4END], [R4Y, bands.TREES.y0 + bands.TREES.rows]];
  const ridgeColor = (k, y) => { const [a] = ridgeRows[k]; return mixL(RIDGES[k].top, RIDGES[k].bottom, clamp((y - a) / (HORIZON_Y + 6 - a), 0, 1) * 0.85); };
  for (let k = 0; k < 4; k++) {
    const [a, b] = ridgeRows[k];
    for (let y = a; y < b; y++) {
      const band = STACK.find((d) => y >= d.y0 && y < d.y0 + d.rows);
      bands[band.name].grads.push([y - band.y0, k + 1, P.alloc([ridgeColor(k, y)])]);
    }
  }

  // ---- hill ridge silhouettes (top row per column) ----
  const ridgeTops = (r, n, per, rows) => {
    // top row of a ridge for each column, scaled into `rows` rows like the old ridge bands
    const pxPerUnit = 18 * 14.5 / (14.5 - r.z) * 2.2, h = new Float32Array(n);
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < n; x++) {
      const wx = x / pxPerUnit;
      h[x] = per ? ridgeHeight(r, wx) * (1 - x / per) + ridgeHeight(r, wx - per / pxPerUnit) * (x / per) : ridgeHeight(r, wx);
      lo = Math.min(lo, h[x]); hi = Math.max(hi, h[x]);
    }
    const solidFrom = rows - 2;
    return Array.from(h, (v) => Math.round(solidFrom - (v - lo) / (hi - lo) * (solidFrom - 1)));
  };

  // ---- the middle tree layer ----
  // Backdrop: hills 2..4 (colours 1..4 with their per-line gradients). In front of them a hazy back row
  // of small trees (10), then the forest of the middle distance: hazy mauve canopies (5, per-line, paler
  // towards the horizon), lit tops (6), trunks (7), shaded undersides (8) and lantern lights (9) in the grove.
  // Shapes follow the zone: umbrella giants and round trees on the plains, round lantern trees and pines in
  // the grove, dead trees and pines on the causeway. The bottom two rows stay colour 5: the ground's first
  // colours are loaded on the last one.
  const tl = bands.TREES;
  {
    const t2 = ridgeTops(RIDGES[1], tl.width, 0, R3Y - R2Y), t3 = ridgeTops(RIDGES[2], tl.width, 0, R4Y - R3Y), t4 = ridgeTops(RIDGES[3], tl.width, 0, R4END - R4Y);
    for (let y = 0; y < tl.rows; y++) {
      const sy = tl.y0 + y;
      for (let x = 0; x < tl.width; x++)
        tl.px[y * tl.width + x] = sy >= R4Y ? (sy - R4Y >= t4[x] || sy >= R4END ? 4 : 3) : sy >= R3Y ? (sy - R3Y >= t3[x] ? 3 : 2) : (sy - R2Y >= t2[x] ? 2 : 1);
    }
  }
  const trng = mulberry32(777);
  const base = tl.rows - 3;                      // trunks end above the two solid ground rows
  const put = (x, y, c, over = true) => { if (y >= 0 && y < tl.rows - 2 && x >= 0 && x < tl.width && (over || tl.get(x, y) < 5)) tl.set(x, y, c); };
  const blob = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(x, y, c);
  };
  const zoneAt = (x) => { const wx = tl.toWorld(x); return wx < 330 ? 0 : wx < 650 ? 1 : 2; };
  // back row: small hazy silhouettes, dense
  for (let x = 0; x < tl.width;) {
    const z = zoneAt(x), h = 3 + Math.floor(trng() * 6), w = 3 + Math.floor(trng() * 5), spire = z === 2 && trng() < 0.5;
    for (let dy = 0; dy <= h; dy++) {
      const t = dy / h, half = spire ? (1 - t) * w / 2 : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.5) ** 2)) * w / 2;
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) if (Math.abs(dx) <= half + 0.2) put(x + dx, base + 1 - dy, 10, false);
    }
    x += 2 + Math.floor(trng() * w);
  }
  // middle row: individual trees
  const trees = [];
  for (let x = 6; x < tl.width - 6;) {
    const z = zoneAt(x), r = trng();
    const kind = z === 0 ? (r < 0.45 ? 'umbrella' : 'round') : z === 1 ? (r < 0.5 ? 'lantern' : r < 0.85 ? 'pine' : 'round') : (r < 0.55 ? 'dead' : 'pine');
    // mostly middle-sized, now and then a tall one reaching up past the hills
    const tall = trng() < 0.3 ? 1.45 : 1;
    const h = Math.round(((kind === 'pine' ? 15 : kind === 'umbrella' ? 16 : kind === 'dead' ? 14 : 12) + trng() * 8) * tall);
    trees.push({ x, kind, h: Math.min(h, base - 1), s: tall });
    x += Math.round((kind === 'umbrella' ? 16 + Math.floor(trng() * 16) : 9 + Math.floor(trng() * 14)) * (0.8 + tall * 0.25));
  }
  for (const t of trees) {
    const { x, kind, h, s } = t, top = base - h;
    if (kind === 'pine') {
      for (let y = top; y <= base; y++) {
        if (y > base - 2) { put(x, y, 7); continue; }
        const k = (y - top) / h, tier = ((y - top) % 4) / 4, half = 0.5 + k * 4.2 * s * (0.55 + tier * 0.45);
        for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) if (Math.abs(dx) <= half) put(x + dx, y, 5);
      }
    } else if (kind === 'dead') {
      for (let y = top + 2; y <= base; y++) put(x, y, 7);
      const branches = 3 + Math.floor(trng() * 3);
      for (let b = 0; b < branches; b++) {
        const y0 = top + 2 + Math.floor(trng() * (h * 0.45)), dir = b % 2 ? 1 : -1, len = Math.round((3 + Math.floor(trng() * 5)) * s);
        for (let i = 1; i <= len; i++) put(x + dir * i, y0 - Math.round(i * 0.7), 7);
      }
    } else {
      const trunkTop = kind === 'umbrella' ? top + 4 : top + Math.round(h * 0.55);
      for (let y = trunkTop; y <= base; y++) { put(x, y, 7); if (kind === 'umbrella' && y > base - 3) put(x + 1, y, 7); }
      if (kind === 'umbrella') {
        const w = (7 + trng() * 5) * s;
        blob(x, top + 2.2, w, 2.4, 5); blob(x - w * 0.45, top + 3.6, w * 0.55, 1.8, 5); blob(x + w * 0.5, top + 3.4, w * 0.5, 1.8, 5);
        put(x - 1, top + 5, 7); put(x + 1, top + 5, 7);           // the fork under the canopy
      } else {
        const rr = (3 + trng() * 2.5) * s;
        blob(x, top + rr, rr * 1.15, rr, 5); blob(x + rr * 0.6, top + rr * 1.3, rr * 0.7, rr * 0.7, 5);
      }
    }
  }
  {
    // light from the upper left: lit pixels on top and left edges of the canopies, shade along the undersides
    const out = new Uint8Array(tl.px);
    for (let y = 0; y < tl.rows - 2; y++) for (let x = 1; x < tl.width - 1; x++) {
      if (tl.get(x, y) !== 5) continue;
      const up = y > 0 ? tl.get(x, y - 1) : 0, left = tl.get(x - 1, y), down = tl.get(x, y + 1);
      if ((up !== 5 && up !== 7) || (left !== 5 && left !== 7 && trng() < 0.5)) out[y * tl.width + x] = 6;
      else if (down !== 5 && down !== 6 && down !== 7) out[y * tl.width + x] = 8;
    }
    tl.px.set(out);
  }
  // lantern lights hang under the grove canopies
  for (const t of trees) if (t.kind === 'lantern') {
    const top = base - t.h, n = 2 + Math.floor(trng() * 3);
    for (let i = 0; i < n; i++) put(t.x - 5 + Math.floor(trng() * 11), top + 7 + Math.floor(trng() * 3), 9);
  }
  for (let y = tl.rows - 2; y < tl.rows; y++) for (let x = 0; x < tl.width; x++) tl.set(x, y, 5);
  for (let y = 0; y < tl.rows; y++) {
    const f = clamp(y / tl.rows, 0, 1);
    tl.grads.push([y, 5, P.alloc([mixL(hex('#6a3e58'), mixL(C.fog, hex('#8a5a6a'), 0.5), f * f)])]);
  }
  tl.statics.push([6, P.alloc([hex('#a87478')])], [7, P.alloc([hex('#4a2a38')])], [8, P.alloc([hex('#4e2c48')])],
    [9, P.alloc([hex('#ffd890')])], [10, P.alloc([hex('#7c4c6e')])]);

  // ---- floor: zone-blended 15-colour palette, per-line parallax ----
  const g = bands.GROUND;
  const W = g.period;
  const pathTop = Math.round(HORIZON_Y + 14.5 / (14.5 + 1.9) * (PATH_Y - HORIZON_Y)) - g.y0;
  const pathBot = Math.round(HORIZON_Y + 14.5 / (14.5 - 1.3) * (PATH_Y - HORIZON_Y)) - g.y0;
  const hashi = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const pnoise = (x, y, cells, seed) => {  // periodic value noise across W pixels with `cells` cells
    const fx = x / W * cells, ix = Math.floor(fx), tx = smooth(fx - ix);
    const iy = Math.floor(y), ty = smooth(y - iy);
    const v = (i, j) => hashi(((i % cells) + cells) % cells, j, seed);
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx, b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
  const grng = mulberry32(99);
  for (let y = 0; y < g.rows; y++) {
    const k = groundFactor(y);                  // depth scale of this row
    const cells = Math.max(6, Math.round(W / (14 * k)));
    for (let x = 0; x < W; x++) {
      const n = pnoise(x, y * 0.35 / Math.max(k, 0.3), cells, 1) * 0.78 + pnoise(x, y * 0.9 / Math.max(k, 0.3), cells * 3, 2) * 0.22;
      let c;
      if (k < 0.24) c = n > 0.55 ? 1 : 2;                                  // misty distance
      else if (y < pathTop - 1 || y > pathBot + 1) {
        const near = k > 1.25;
        if (near) c = n > 0.62 ? 7 : n > 0.4 ? 8 : n > 0.25 ? 14 : 15;
        else c = n > 0.7 ? 6 : n > 0.52 ? 5 : n > 0.34 ? 4 : 3;
      } else {
        const edge = y < pathTop + 1 || y > pathBot - 1;
        const pn = pnoise(x, y * 0.5, cells * 2, 3);
        c = edge && n > 0.5 ? 4 : pn > 0.68 ? 11 : pn > 0.36 ? 10 : 9;
        if (hashi(x, y, 5) < 0.012) c = 12;            // pebbles
      }
      g.px[y * g.width + x] = c;
    }
    // grass tufts: little vertical strokes that lean with the parallax shear
    if (k >= 0.3 && (y < pathTop - 2 || y > pathBot + 2)) {
      const tufts = Math.round(W / (14 * k));
      for (let i = 0; i < tufts; i++) {
        const x = Math.floor(grng() * W), h = Math.max(1, Math.round(k * (1 + grng() * 2.5)));
        for (let d = 0; d < h && y - d >= 0; d++) g.px[(y - d) * g.width + ((x + Math.round(d * 0.3)) % W)] = d === h - 1 ? (k > 1.25 ? 7 : 6) : (k > 1.25 ? 14 : 3);
      }
    }
  }
  // replicate the period across the band width
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.width; x++) g.px[y * g.width + x] = g.px[y * g.width + (((x - 64) % W) + W) % W];

  const zoneGround = [
    // the original's ground colours as its dusk lighting renders them (sampled from its screenshots)
    { grass: hex('#7a5a2e'), grass2: hex('#583e20'), path: hex('#603822'), fog: C.fog },
    { grass: hex('#4c4a2c'), grass2: hex('#34301e'), path: hex('#4c2c1e'), fog: hex('#8e6a7c') },
    { grass: hex('#6c4438'), grass2: hex('#4e3028'), path: hex('#744c46'), fog: hex('#a8707e') },
  ].map((z) => [
    0, mixL(z.grass, z.fog, 0.62), mixL(z.grass2, z.fog, 0.55),
    scale(z.grass2, 0.78), z.grass2, mixL(z.grass2, z.grass, 0.55), scale(z.grass, 1.12),
    scale(z.grass, 0.95), scale(z.grass2, 0.62),
    scale(z.path, 0.72), z.path, scale(z.path, 1.22), scale(mixL(z.path, hex('#b0a49a'), 0.5), 1.15),
    scale(z.grass2, 0.42), scale(z.grass2, 0.4), scale(z.grass2, 0.25),
  ]);
  const groundPal = P.alloc(zoneGround[0].slice(1));
  // reload order matters: the first five land on the tree line's last (solid colour 5) row, the next
  // five on the misty first floor rows, which only use colours 1 and 2
  for (const i of [1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 4, 5, 6]) g.statics.push([i, groundPal + i - 1]);

  return { bands, c0Pal, zoneGround, groundPal };
}
