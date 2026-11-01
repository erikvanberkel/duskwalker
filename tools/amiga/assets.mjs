// Builds all Amiga data from the baked frames and procedural art:
//   amiga/build/gen/assets.h + assets.c   (tables), amiga/build/assets_data.s + assets.lz (compressed chip blob)
//   amiga/build/preview/*.png             (what the playfields will look like, for checking without an emulator)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../../src/util.js';
import { hex, rgb, mixL, mixS, scale, kmeans, lum, pack } from './lib/color.mjs';
import { encodePNG } from './lib/png.mjs';
import { buildFont, renderText } from './lib/font.mjs';
import { buildPF1, skyColor } from './lib/pf1.mjs';
import { buildOverlays, ZONE_NAMES } from './lib/overlays.mjs';
import { loadBake, samplesOf, quantize, packBob, cropIdx } from './lib/frames.mjs';
import { lzPack, lzUnpack } from './lib/lz.mjs';
import { buildAudio } from './lib/audio.mjs';
import * as L from './lib/layout.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = join(root, 'amiga', 'build');
const gen = join(out, 'gen');
const prev = join(out, 'preview');
for (const d of [gen, prev]) mkdirSync(d, { recursive: true });
const CAM_OFS = 400;   // camera pixel origin offset so every scroll value stays positive

// ---------------------------------------------------------------- palette entries
const palInit = [];
const P = { alloc(vals) { const i = palInit.length; palInit.push(...vals); return i; } };
const palDefs = {};

// ---------------------------------------------------------------- PF1
const font = buildFont();
const pf1 = buildPF1(P);
const ov = buildOverlays(P, font);
const allBands = { ...pf1.bands, HUD: ov.HUD, PAUSE: ov.PAUSE, BOSS: ov.BOSS };
const bandOrder = ['HUD', 'SKY', 'TREES', 'GROUND', 'PAUSE', 'BOSS'];
const storeOrder = ['HUD', 'PAUSE', 'SKY', 'TREES', 'BOSS', 'GROUND'];
let planeBytes = 0;
for (const n of storeOrder) { const b = allBands[n]; b.rb = b.width / 8; b.off = planeBytes; planeBytes += b.rb * b.rows; }
planeBytes = Math.ceil(planeBytes / 8) * 8;
const pf1Planes = new Uint8Array(planeBytes * 4);
for (const n of storeOrder) {
  const b = allBands[n];
  for (let y = 0; y < b.rows; y++)
    for (let x = 0; x < b.width; x++) {
      const c = b.px[y * b.width + x];
      if (!c) continue;
      for (let k = 0; k < 4; k++) if (c & (1 << k)) pf1Planes[k * planeBytes + b.off + y * b.rb + (x >> 3)] |= 0x80 >> (x & 7);
    }
}

// ---------------------------------------------------------------- PF2 palette (characters fixed, trees per zone)
const bake = loadBake(join(out, 'bake'));
const M = bake.meta;
const names = Object.keys(M).filter((k) => k !== 'placements');
const charNames = names.filter((n) => /^(player|skitter|stalker|wisp|titan|seed|relic)/.test(n));
const imgs = Object.fromEntries(names.map((n) => [n, bake.get(n)]));
const charSamples = charNames.flatMap((n) => samplesOf(imgs[n], n.startsWith('titan') ? 0.35 : n.startsWith('player') ? 2 : 1));
// a few colours we always want: the scarf red, ember glow, cyan wisp light, bone
const FIXED_N = 9;
const fixedPF2 = kmeans(charSamples, FIXED_N, [hex('#0c0812'), hex('#b02a2a'), hex('#ffb040'), hex('#7fe8f0'), hex('#fff0d8')], 30);
const zoneTrees = [
  names.filter((n) => /^tree_giant/.test(n)),
  names.filter((n) => /^tree_(giant|lantern)/.test(n)),
  names.filter((n) => /^(tree_dead|ruin)/.test(n)),
];
// zone colours: 5 for the trees (darkest first) and, last, the sunlit grass of the foreground blades
const GRASS_LIT = [hex('#8a6a30'), hex('#4e5a2e'), hex('#6e4a3c')];
const zonePF2 = zoneTrees.map((list, z) => {
  const s = list.flatMap((n) => samplesOf(imgs[n], n.includes('lantern') ? 1.5 : 1));
  const all = kmeans(s, FIXED_N + 6, [...fixedPF2, GRASS_LIT[z]], 30, 7 + z);
  return [...all.slice(FIXED_N + 1).sort((a, b) => lum(a) - lum(b)), GRASS_LIT[z]];
});
const pf2Base = P.alloc([0, ...fixedPF2, ...zonePF2[0]]);   // entry 0 unused; PF2 colour i = pal[pf2Base + i]
palDefs.PAL_PF2 = pf2Base;
const FIXED_IDX = Array.from({ length: FIXED_N }, (_, i) => i + 1);
const ALL_IDX = Array.from({ length: 15 }, (_, i) => i + 1);
const pf2Palette = (z) => [0, ...fixedPF2, ...zonePF2[z]];

// ---------------------------------------------------------------- frames
const frames = [];
const frameIndex = {};
const mirrors = [];
function addFrame(name, idx, w, h, ax, ay) {
  const c = cropIdx(idx, w, h);
  const bob = packBob(c.idx, c.w, c.h);
  frameIndex[name] = frames.length;
  frames.push({ name, ww: bob.ww, h: bob.h, ax: ax - c.x0, ay: ay - c.y0, data: bob.data, idx: c.idx, iw: c.w });
  return frames.length - 1;
}
function addMirror(name, src) {
  const f = frames[src];
  frameIndex[name] = frames.length;
  mirrors.push([src, frames.length]);
  frames.push({ name, ww: f.ww, h: f.h, ax: f.ww * 16 - 1 - f.ax, ay: f.ay, data: new Uint8Array(f.data.length), mirror: true });
}
const charFrame = (n) => {
  const im = imgs[n];
  const opts = n.startsWith('titan') ? { alpha: 0.4 } : { alpha: 0.42 };
  return addFrame(n, quantize(im, pf2Palette(0), FIXED_IDX, opts), im.w, im.h, im.ax, im.ay);
};
const groups = {};
function group(key, list, mirror) {
  const first = frames.length;
  list.forEach(charFrame);
  groups[key] = { first, count: list.length };
  if (mirror) {
    const mf = frames.length;
    list.forEach((n, i) => addMirror(n + '_l', first + i));
    groups[key].mirror = mf - first;
  }
}
const P_FRAMES = ['player_idle0', 'player_idle1', ...Array.from({ length: 8 }, (_, i) => 'player_run' + i), 'player_jump', 'player_fall', 'player_crouch',
  ...[0, 1].flatMap((s) => [0, 1, 2, 3].map((i) => `player_atk${s}_${i}`)), ...[0, 1].flatMap((s) => [0, 1].map((i) => `player_catk${s}_${i}`)),
  'player_hurt', ...[0, 1, 2, 3].map((i) => 'player_die' + i)];
group('PLAYER', P_FRAMES, true);
group('SKITTER', [0, 1, 2, 3].map((i) => 'skitter' + i), true);
group('STALKER', [...Array.from({ length: 6 }, (_, i) => 'stalker_walk' + i), 'stalker_windup0', 'stalker_windup1', 'stalker_strike', 'stalker_recover'], true);
group('WISP', ['wisp0', 'wisp1', 'wisp2', 'wisp3', 'wisp_dive'], true);
group('SEED', [0, 1, 2, 3].map((i) => 'seed' + i), false);
group('RELIC', [0, 1, 2, 3].map((i) => 'relic' + i), false);
// the Titan: one frame per pose (drawn with its background in one pass and clipped by DrawFrameOnBg)
const TITAN_POSES = ['titan_dormant', 'titan_idle0', 'titan_idle1', 'titan_seeds', 'titan_slam0', 'titan_slam1', 'titan_summon'];
const titanStrips = [];
for (const n of TITAN_POSES) {
  const im = imgs[n];
  const q = cropIdx(quantize(im, pf2Palette(0), FIXED_IDX, { alpha: 0.4 }), im.w, im.h);
  const strips = [];
  strips.push(addFrame(n, q.idx, q.w, q.h, im.ax - q.x0, im.ay - q.y0));
  titanStrips.push(strips);
}
// shockwave: a short glowing arc (drawn procedurally, two flicker frames)
{
  const first = frames.length;
  for (let f = 0; f < 2; f++) {
    const w = 24, h = 20, idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = y / h, half = (1 - t) * 3 + 2 + Math.sin(t * 9 + f * 2) * 1.2, d = Math.abs(x - 12 + t * 4);
      if (d < half) idx[y * w + x] = d < half * 0.4 ? 3 : 4;
    }
    addFrame('shock' + f, idx.map((c) => (c ? (c === 3 ? 0 : 0) : 0)), w, h, 12, h - 1);
  }
  // recolour with the ember and red entries of the fixed palette
  const ember = 1 + fixedPF2.findIndex((c) => c === hex('#ffb040')), red = 1 + fixedPF2.findIndex((c) => c === hex('#b02a2a'));
  for (let f = 0; f < 2; f++) {
    const w = 24, h = 20, idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = y / h, half = (1 - t * 0.6) * 4 + Math.sin(t * 9 + f * 2) * 1.2, d = Math.abs(x - 12 + t * 5);
      if (d < half) idx[y * w + x] = d < half * 0.45 ? ember : red;
    }
    frames.length = first + f;
    addFrame('shock' + f, idx, w, h, 12, h - 1);
  }
  groups.SHOCK = { first, count: 2 };
}

// ---------------------------------------------------------------- tree ribbon objects
const f2 = L.TREE_FACTOR;
const ribbonX = (wx) => f2 * (wx * L.PX_PER_UNIT - 160 + CAM_OFS) + 160 + 64;
const depthRow = (z) => Math.round(L.HORIZON_Y + 14.5 / (14.5 - z) * (L.PATH_Y - L.HORIZON_Y));
const treeFrame = {};
const zoneOf = (x) => (x < 330 ? 0 : x < 650 ? 1 : 2);
for (const n of names.filter((n) => /^(tree_|ruin_)/.test(n))) {
  const im = imgs[n];
  const z = n.startsWith('tree_giant') ? 0 : n.startsWith('tree_lantern') ? 1 : 2;
  const idx = quantize(im, pf2Palette(z), ALL_IDX, { alpha: 0.5 });
  if (z === 1) {
    // the lanterns bloom in the original: a dithered ember halo around every lit pixel (inner ring 1 in 2,
    // outer ring 1 in 4), only where the tree itself leaves the pixel empty or dark
    const EMBER = 1 + fixedPF2.indexOf(hex('#ffb040')), DARK = 1 + fixedPF2.indexOf(hex('#0c0812'));
    const bright = (c) => c && lum(pf2Palette(1)[c]) > 190;   // the lantern glass (grove yellows)
    const lit = [];
    for (let i = 0; i < idx.length; i++) if (bright(idx[i])) lit.push(i);
    const halo = new Uint8Array(idx.length);
    for (const i of lit) {
      const cx = i % im.w, cy = Math.floor(i / im.w);
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = dx * dx + dy * dy;
        if (x < 0 || y < 0 || x >= im.w || y >= im.h || d > 16) continue;
        const j = y * im.w + x, ring = d <= 5 ? 2 : 1;
        if (ring > halo[j]) halo[j] = ring;
      }
    }
    for (let j = 0; j < idx.length; j++) {
      if (!halo[j] || bright(idx[j]) || (idx[j] && idx[j] !== DARK && lum(pf2Palette(1)[idx[j]]) > 60)) continue;
      const x = j % im.w, y = Math.floor(j / im.w);
      if (halo[j] === 2 ? ((x + y) & 1) === 0 : (x & 1) === 0 && (y & 1) === 0) idx[j] = EMBER;
    }
  }
  // rows more than 182 px above the base can never be on screen
  const keep = Math.min(im.h, im.ay + 4), top = Math.max(0, im.ay - 182);
  const cropped = idx.subarray(top * im.w, (top + keep - top) * im.w);
  treeFrame[n] = addFrame(n, cropped, im.w, keep - top, im.ax, im.ay - top);
}
const objs = [];
const giants = names.filter((n) => n.startsWith('tree_giant')), lanterns = names.filter((n) => n.startsWith('tree_lantern')), deads = names.filter((n) => n.startsWith('tree_dead'));
for (const p of M.placements) {
  if (p.z > -6 || p.z < -30) continue;
  const list = p.type === 'giant' ? giants : p.type === 'lantern' ? lanterns : p.type === 'dead' ? deads : null;
  if (!list) continue;
  const name = list[Math.abs(Math.floor(p.x * 7.31 + p.z * 3.17)) % list.length];
  objs.push({ name, x: p.x, z: p.z });
}
{
  const rng = mulberry32(1234);
  for (let x = 650; x < 960; x += 9 + rng() * 7) {
    const h = rng() < 0.3 ? 9 : 2 + rng() * 4;
    objs.push({ name: h > 6 ? 'ruin_col0' : h > 3.2 ? 'ruin_col1' : 'ruin_col2', x: x + (rng() - 0.5) * 2, z: -7.5 });
  }
  for (let i = 0; i < 6; i += 2) objs.push({ name: 'ruin_arch', x: 838 + 6 + i * 11, z: -16 - (i % 2) * 6 });
  for (let i = 1; i < 6; i += 2) objs.push({ name: 'ruin_pillar', x: 838 + 6 + i * 11, z: -22 });
}
objs.sort((a, b) => a.z - b.z);   // far first, so near trees are stamped over them
const treeObjs = objs.map((o) => {
  const fi = treeFrame[o.name], f = frames[fi];
  const left = Math.round((ribbonX(o.x) - f.ax) / 16) * 16;
  return { x: left, y: depthRow(o.z) - f.ay, frame: fi, z: o.z };
});
// stable order by x, but keep the far-to-near order within overlapping objects: sort by x with z as a tie layer
const treeOrdered = treeObjs.map((o, i) => ({ ...o, layer: i })).sort((a, b) => a.x - b.x || a.layer - b.layer);
const TREE_MAX_W = Math.max(...treeObjs.map((o) => frames[o.frame].ww * 16));
const maxRibbonPx = Math.ceil(f2 * L.MAX_CAM_PX) + 512;
const RIBBON_EXTRA_ROWS = Math.ceil((maxRibbonPx / 64 + 8) / 8) + 1;
// near objects must be drawn after far ones even when they start further left: give the C side a draw order
// by splitting the ribbon renderer's per-block loop over (x-sorted list) and checking z via the original index.

// ---------------------------------------------------------------- lettering (title screens)
const textPal = [0, hex('#ffd9a0'), hex('#5a1a10'), hex('#f6e7c8'), hex('#bfa890'), hex('#ffb35c'), hex('#cfe6ff'), hex('#9fd8ff'), 0, 0, 0, 0, 0, 0, 0, hex('#000000')];
palDefs.PAL_TEXT = P.alloc(textPal);
function textFrame(name) {
  const im = imgs[name];
  const w = im.w + 3, h = im.h + 3, idx = new Uint8Array(w * h);
  const on = (x, y) => x >= 0 && y >= 0 && x < im.w && y < im.h && im.rgba[(y * im.w + x) * 4 + 3] >= 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (on(x, y)) idx[y * w + x] = 1;
    else if (on(x - 2, y - 2) || on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) idx[y * w + x] = 2;
  }
  return addFrame(name, idx, w, h, 0, 0);
}
const TEXTS = ['txt_title', 'txt_fallen', 'txt_victory', 'txt_mirage'];
TEXTS.forEach(textFrame);

// zone banners: PF2 objects in the game palette (cream letters, ember rim, dark drop shadow). Each comes as
// 25 %, 50 % and full coverage so the C side can fade it in and out with ordered dithering.
const BANNER_FIRST = frames.length;
{
  const LIGHT = 1 + fixedPF2.indexOf(hex('#fff0d8')), RIM = 1 + fixedPF2.indexOf(hex('#b02a2a')), DARK = 1 + fixedPF2.indexOf(hex('#0c0812'));
  for (const name of ZONE_NAMES) {
    const glyphs = [...name].map((c) => renderText(font, c, 2));
    const tw = glyphs.reduce((w, g) => w + g.w + 4, -4), th = glyphs[0].h;
    const w = tw + 4, h = th + 5, idx = new Uint8Array(w * h);
    let x0 = 2;
    for (const g of glyphs) {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.px[y * g.w + x]) idx[(y + 1) * w + x0 + x] = LIGHT;
      x0 += g.w + 4;
    }
    const lit = idx.slice(), at = (a, x, y) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (!lit[y * w + x] && [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]].some(([dx, dy]) => at(lit, x + dx, y + dy))) idx[y * w + x] = RIM;
    const rim = idx.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!rim[y * w + x] && at(rim, x - 1, y - 2)) idx[y * w + x] = DARK;
    const keep = [(x, y) => !((x | y) & 1), (x, y) => !((x + y) & 1), () => true];
    keep.forEach((k, level) => {
      const d = idx.map((c, i) => (k(i % w, Math.floor(i / w)) ? c : 0));
      addFrame(`banner_${frames.length - BANNER_FIRST}`, d, w, h, w >> 1, 0);
    });
  }
}
// per-line gradients for text colours 1 and 2 (rewritten by the C code for each screen)
palDefs.PAL_TEXTGRAD = P.alloc(new Array(256).fill(hex('#ffd9a0')));
palDefs.PAL_TEXTGRAD2 = P.alloc(new Array(256).fill(hex('#5a1a10')));
palDefs.PAL_INTRO_C0 = P.alloc(new Array(256).fill(0));
// zone-blended entries: ground 1..15 and PF2 10..15
const zoneIdx = [], zoneVals = [[], [], []];
for (let i = 0; i < 15; i++) { zoneIdx.push(pf1.groundPal + i); for (let z = 0; z < 3; z++) zoneVals[z].push(pf1.zoneGround[z][i + 1]); }
for (let i = 0; i < 6; i++) { zoneIdx.push(pf2Base + FIXED_N + 1 + i); for (let z = 0; z < 3; z++) zoneVals[z].push(zonePF2[z][i]); }

// ---------------------------------------------------------------- audio
const audio = buildAudio();
// WAV previews of every sample (8-bit, at its playback rate) so they can be auditioned on the PC
{
  const dir = join(prev, 'audio');
  mkdirSync(dir, { recursive: true });
  for (const smp of audio.samples) {
    const rate = Math.round(3546895 / smp.period), n = smp.data.length, h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
    writeFileSync(join(dir, smp.name + '.wav'), Buffer.concat([h, Buffer.from(smp.data.map((v) => (v + 128) & 255))]));
  }
  // the music as the Amiga sequences it: two loops of the walk, and the Titan fight
  const wav16 = (file, { L, R, rate }) => {
    const n = L.length, h = Buffer.alloc(44), d = Buffer.alloc(n * 4);
    h.write('RIFF', 0); h.writeUInt32LE(36 + n * 4, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) { d.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 16000))), i * 4); d.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 16000))), i * 4 + 2); }
    writeFileSync(join(dir, file), Buffer.concat([h, d]));
  };
  wav16('music_walk.wav', audio.preview(audio.bedSeconds * 2, false));
  wav16('music_titan.wav', audio.preview(audio.bedSeconds, true));
}

// ---------------------------------------------------------------- ground shadows (solid core, dithered rim)
const SHADOW_FIRST = frames.length;
{
  const DARK = 1 + fixedPF2.indexOf(hex('#0c0812'));
  for (const [w, h] of [[14, 3], [20, 4], [28, 5], [40, 6], [104, 11]]) {
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2), r = dx * dx + dy * dy;
      if (r < 1 && (r < 0.4 || ((x + y) & 1) === 0)) idx[y * w + x] = DARK;
    }
    addFrame(`shadow_${frames.length - SHADOW_FIRST}`, idx, w, h, w >> 1, 2);   // mostly in front of the feet
  }
}

// ---------------------------------------------------------------- foreground grass (PF2 bottom strip)
const FG_ROWS = L.SCREEN_H - L.FG_Y, FG_W = L.FG_PERIOD + 384, FG_RB = FG_W / 8, FG_PLANE = FG_ROWS * FG_RB;
const fgData = new Uint8Array(FG_PLANE * 4);
{
  const FP = L.FG_PERIOD, idx = new Uint8Array(FP * FG_ROWS), rng = mulberry32(777);
  // dark blades and sunlit ones (zone grass colour with a shaded side), like the original's foreground
  const DARK = 1 + fixedPF2.indexOf(hex('#0c0812')), SHADE = FIXED_N + 1, LIT = FIXED_N + 6;
  const blade = (bx, h, w, lean, lit) => {
    for (let yy = 0; yy < h; yy++) {
      const t = yy / h, half = (w / 2) * (1 - t) + 0.35, cx = bx + lean * t * t, row = FG_ROWS - 1 - yy;
      const x0 = Math.round(cx - half), x1 = Math.round(cx + half);
      for (let x = x0; x <= x1; x++) {
        const c = !lit ? DARK : x === x1 && x1 > x0 ? SHADE : LIT;
        idx[row * FP + (((x % FP) + FP) % FP)] = c;
      }
    }
  };
  const blades = [];
  for (let x = 0; x < FP;) {
    const n = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const h = Math.min(FG_ROWS, Math.round(8 + Math.pow(rng(), 1.3) * 30));
      blades.push([x + (rng() - 0.5) * 22, h, 2 + rng() * 4, (rng() - 0.5) * 18, rng() < 0.45]);
    }
    x += 14 + Math.floor(rng() * 40);
  }
  blades.sort((p, q) => p[4] - q[4]).forEach((b) => blade(...b));   // lit blades in front of dark ones
  for (let r = 0; r < FG_ROWS; r++)
    for (let x = 0; x < FG_W; x++) {
      const c = idx[r * FP + (x % FP)];
      for (let k = 0; k < 4; k++) if (c & (1 << k)) fgData[k * FG_PLANE + r * FG_RB + (x >> 3)] |= 0x80 >> (x & 7);
    }
  const png = new Uint8Array(FP * FG_ROWS * 4), pal = pf2Palette(0);
  for (let i = 0; i < idx.length; i++) {
    const c = idx[i] ? pal[idx[i]] : 0x3a2a40;
    png[i * 4] = c >> 16; png[i * 4 + 1] = (c >> 8) & 255; png[i * 4 + 2] = c & 255; png[i * 4 + 3] = 255;
  }
  writeFileSync(join(prev, 'fg_grass.png'), encodePNG(FP, FG_ROWS, png));
}

// ---------------------------------------------------------------- chip blob
const chunks = [];
let blobLen = 0;
const place = (data, align = 8) => { blobLen = Math.ceil(blobLen / align) * align; const off = blobLen; chunks.push([off, data]); blobLen += data.length; return off; };
const PF1_OFFSET = place(pf1Planes);
const FG_OFFSET = place(fgData);
for (const f of frames) f.off = place(f.data);
for (const s of audio.samples) s.off = place(s.data, 2);
const blob = new Uint8Array(Math.ceil(blobLen / 8) * 8);
for (const [off, d] of chunks) blob.set(d, off);
const packed = lzPack(blob);
if (lzUnpack(packed, blob.length).some((v, i) => v !== blob[i])) throw new Error('LZ round trip failed');
writeFileSync(join(out, 'assets.lz'), packed);
writeFileSync(join(out, 'assets_data.s'),
  `\t.data\n\t.balign 4\n\t.globl assetPacked\nassetPacked:\n\t.incbin "${join(out, 'assets.lz').replace(/\\/g, '/')}"\n\t.balign 4\n`);

// ---------------------------------------------------------------- C tables
const enumName = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const bandEnum = bandOrder.map((n, i) => `\tBAND_${n} = ${i},`).join('\n');
const bandColors = [], bandGrads = [];
const bandRows = bandOrder.map((n) => {
  const b = allBands[n];
  const fc = bandColors.length; b.statics.forEach(([hw, pi]) => bandColors.push([hw, pi]));
  const fg = bandGrads.length; b.grads.sort((a, c) => a[0] - c[0]).forEach(([row, hw, pi]) => bandGrads.push([row, hw, pi]));
  return `\t{ ${b.y0}, ${b.rows}, ${b.off}, ${b.rb}, ${Math.round((b.factor || 0) * 65536)}, ${b.period || 0}, ${b.maxScroll || 0}, ${fc}, ${b.statics.length}, ${fg}, ${b.grads.length} }, // ${n}`;
});
const hdr = `// Generated by tools/amiga/assets.mjs - do not edit.
#pragma once
#include <exec/types.h>

extern UBYTE *assetChip;                 // unpacked chip blob
extern const UBYTE assetPacked[];
#define ASSET_CHIP_BYTES ${blob.length}
#define ASSET_PACKED_BYTES ${packed.length}

#define CAM_OFS ${CAM_OFS}
#define HORIZON_Y ${L.HORIZON_Y}
#define PATH_Y ${L.PATH_Y}
#define TREE_FACTOR_16 ${Math.round(f2 * 65536)}
#define MAX_CAM_PX ${L.MAX_CAM_PX}

// ---- foreground grass strip (copied after each PF2 display plane) ----
#define FG_Y ${L.FG_Y}
#define FG_ROWS ${FG_ROWS}
#define FG_RB ${FG_RB}
#define FG_PERIOD ${L.FG_PERIOD}
#define FG_FACTOR_16 ${Math.round(L.FG_FACTOR * 65536)}
#define FG_OFFSET ${FG_OFFSET}
#define FG_PLANE_BYTES ${FG_PLANE}

// ---- playfield 1 bands ----
#define PF1_OFFSET ${PF1_OFFSET}
#define PF1_PLANE_BYTES ${planeBytes}
typedef struct { UWORD y0, rows; ULONG off; UWORD rb; LONG factor; UWORD period, maxScroll; UWORD firstColor, numColors, firstGrad, numGrad; } BandDef;
typedef struct { UBYTE hw, pad; UWORD pal; } BandColor;
typedef struct { UWORD row; UBYTE hw, pad; UWORD pal; } BandGrad;
enum {
${bandEnum}
	NUM_BANDS = ${bandOrder.length},
	NUM_STACK_BANDS = ${L.STACK.length},
};
extern const BandDef bandDefs[NUM_BANDS];
extern const BandColor bandColors[];
extern const BandGrad bandGrads[];
extern const LONG groundFactor[${allBands.GROUND.rows}];
extern const UWORD c0Pal[256];

// ---- palette ----
#define PAL_N ${palInit.length}
${Object.entries(palDefs).map(([k, v]) => `#define ${k} ${v}`).join('\n')}
#define PAL_GROUND ${pf1.groundPal}
#define PF2_FIXED ${FIXED_N}
extern const ULONG palInit[PAL_N];
#define ZONE_K ${zoneIdx.length}
extern const UWORD zonePalIdx[ZONE_K];
extern const ULONG zonePal[3][ZONE_K];
// PF2 colour indices of note (1..15)
#define PF2_RED ${1 + fixedPF2.indexOf(hex('#b02a2a'))}
#define PF2_EMBER ${1 + fixedPF2.indexOf(hex('#ffb040'))}
#define PF2_CYAN ${1 + fixedPF2.indexOf(hex('#7fe8f0'))}
#define PF2_DARK ${1 + fixedPF2.indexOf(hex('#0c0812'))}
#define PF2_LIGHT ${1 + fixedPF2.indexOf(hex('#fff0d8'))}
#define PF2_DUST ${1 + FIXED_N + 3}

// ---- blitter objects ----
typedef struct { ULONG off; UBYTE ww, pad; UWORD h; WORD ax, ay; } Frame;
extern const Frame frames[];
#define NUM_FRAMES ${frames.length}
${Object.entries(groups).map(([k, g]) => `#define FR_${k} ${g.first}\n#define FR_${k}_N ${g.count}${g.mirror !== undefined ? `\n#define FR_${k}_MIRROR ${g.mirror}` : ''}`).join('\n')}
${TEXTS.map((n) => `#define FR_${enumName(n)} ${frameIndex[n]}`).join('\n')}
#define FR_SHADOW ${SHADOW_FIRST}            // 5 sizes: 14, 20, 28, 40 and 104 px wide
#define FR_BANNER ${BANNER_FIRST}            // + zone * 3 + level (0 = 25 %, 1 = 50 %, 2 = full)
#define TITAN_POSES ${TITAN_POSES.length}
#define TITAN_STRIPS 4
extern const WORD titanStrips[TITAN_POSES][TITAN_STRIPS];   // frame per strip, -1 = none
#define NUM_MIRRORS ${mirrors.length}
extern const UWORD mirrorPairs[NUM_MIRRORS][2];

// ---- tree ribbon ----
typedef struct { WORD x, y; UWORD frame, layer; } TreeObj;   // layer: draw order, far first (x can be < 0)
#define NUM_TREE_OBJS ${treeOrdered.length}
#define TREE_MAX_W ${TREE_MAX_W}
#define RIBBON_EXTRA_ROWS ${RIBBON_EXTRA_ROWS}
extern const TreeObj treeObjs[NUM_TREE_OBJS];

// ---- font ----
extern const UBYTE fontBits[96 * 8];
extern const UBYTE fontAdvance[96];

// ---- audio ----
typedef struct { ULONG off; UWORD words; UWORD loopStart, loopWords; UWORD period; UBYTE vol, prio; } Sample;
${audio.header}
`;
const arr = (a, per = 16) => a.map((v, i) => (i % per === 0 ? '\n\t' : '') + v + ',').join('');
const src = `// Generated by tools/amiga/assets.mjs - do not edit.
#include "assets.h"

UBYTE *assetChip;
const BandDef bandDefs[NUM_BANDS] = {
${bandRows.join('\n')}
};
const BandColor bandColors[] = {${arr(bandColors.map(([h, p]) => `{${h},0,${p}}`), 8)}
	{0,0,0} };
const BandGrad bandGrads[] = {${arr(bandGrads.map(([r, h, p]) => `{${r},${h},0,${p}}`), 8)}
	{0,0,0,0} };
const LONG groundFactor[${allBands.GROUND.rows}] = {${arr(Array.from({ length: allBands.GROUND.rows }, (_, r) => Math.round(L.groundFactor(r) * 65536)))}
};
const UWORD c0Pal[256] = {${arr(pf1.c0Pal)}
};
const ULONG palInit[PAL_N] = {${arr(palInit.map((c) => '0x' + (c >>> 0).toString(16).padStart(6, '0')), 10)}
};
const UWORD zonePalIdx[ZONE_K] = {${arr(zoneIdx)}
};
const ULONG zonePal[3][ZONE_K] = {${zoneVals.map((z) => `\n\t{${arr(z.map((c) => '0x' + c.toString(16).padStart(6, '0')), 8)}\n\t}`).join(',')}
};
const Frame frames[] = {${frames.map((f) => `\n\t{ ${f.off}, ${f.ww}, 0, ${f.h}, ${f.ax}, ${f.ay} }, // ${f.name}`).join('')}
};
const WORD titanStrips[TITAN_POSES][TITAN_STRIPS] = {${titanStrips.map((s) => `\n\t{ ${[0, 1, 2, 3].map((i) => s[i] ?? -1).join(', ')} }`).join(',')}
};
const UWORD mirrorPairs[NUM_MIRRORS][2] = {${arr(mirrors.map(([a, b]) => `{${a},${b}}`), 8)}
};
const TreeObj treeObjs[NUM_TREE_OBJS] = {${arr(treeOrdered.map((o) => `{${o.x},${o.y},${o.frame},${o.layer}}`), 6)}
};
const WORD sinTab[1024] = {${arr(Array.from({ length: 1024 }, (_, i) => Math.round(Math.sin((i / 1024) * 2 * Math.PI) * 4096)))}
};
const UBYTE fontBits[96 * 8] = {${arr([...font.bits])}
};
const UBYTE fontAdvance[96] = {${arr([...font.advance])}
};
${audio.source}
`;
writeFileSync(join(gen, 'assets.h'), hdr);
writeFileSync(join(gen, 'assets.c'), src);

// ---------------------------------------------------------------- previews
function previewScreen(file, camWorldX) {
  const W = 320, H = 256, img = new Uint8Array(W * H * 4);
  const camPx = Math.round(camWorldX * L.PX_PER_UNIT - 160 + CAM_OFS);
  const zoneT = Math.max(0, Math.min(2, (camWorldX - 300) / 350));
  const z = Math.round(zoneT);
  const palAt = (i) => palInit[i];
  // colour per (line, hw) as the copper sets it
  const hwCol = new Array(32).fill(0);
  for (let y = 0; y < H; y++) {
    const band = L.STACK.find((d) => y >= d.y0 && y < d.y0 + d.rows);
    const b = allBands[band.name];
    if (y === band.y0) for (const [hw, pi] of b.statics) hwCol[hw] = palAt(pi);
    for (const [row, hw, pi] of b.grads) if (band.y0 + row === y) hwCol[hw] = palAt(pi);
    hwCol[0] = palAt(pf1.c0Pal[y]);
    if (band.name === 'GROUND') for (let i = 1; i < 16; i++) hwCol[i] = pf1.zoneGround[z][i];
    const r = y - band.y0;
    let s = band.name === 'GROUND' ? camPx * L.groundFactor(r) : camPx * (band.factor || 0);
    s = Math.floor(s);
    if (b.period) s = ((s % b.period) + b.period) % b.period; else s = Math.max(0, Math.min(b.maxScroll || 0, s));
    for (let x = 0; x < W; x++) {
      const c = b.px[r * b.width + x + s + 64] | 0;
      const o = (y * W + x) * 4, col = hwCol[c];
      img[o] = col >> 16; img[o + 1] = (col >> 8) & 255; img[o + 2] = col & 255; img[o + 3] = 255;
    }
  }
  // PF2: trees
  const s2 = Math.floor(f2 * camPx), pal2 = pf2Palette(z);
  for (const o of treeObjs) {
    const f = frames[o.frame], sx0 = o.x - 64 - s2;
    if (sx0 > W || sx0 + f.iw < 0) continue;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.iw; x++) {
      const c = f.idx[y * f.iw + x], sx = sx0 + x, sy = o.y + y;
      if (!c || sx < 0 || sx >= W || sy < 0 || sy >= H || (sy < 18)) continue;
      const q = (sy * W + sx) * 4; [img[q], img[q + 1], img[q + 2]] = rgb(pal2[c]);
    }
  }
  // a few characters on the walking plane
  const put = (name, sx, sy) => {
    const f = frames[frameIndex[name]];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.iw; x++) {
      const c = f.idx[y * f.iw + x], px = sx - f.ax + x, py = sy - f.ay + y;
      if (!c || px < 0 || px >= W || py < 0 || py >= H) continue;
      const q = (py * W + px) * 4; [img[q], img[q + 1], img[q + 2]] = rgb(pal2[c]);
    }
  };
  put('player_run2', 140, L.PATH_Y);
  put('skitter1', 220, L.PATH_Y);
  put('stalker_walk1', 270, L.PATH_Y);
  put('wisp0', 200, L.PATH_Y - 72);
  // 2x for viewing
  const big = new Uint8Array(W * 2 * H * 2 * 4);
  for (let y = 0; y < H * 2; y++) for (let x = 0; x < W * 2; x++) big.set(img.subarray(((y >> 1) * W + (x >> 1)) * 4, ((y >> 1) * W + (x >> 1)) * 4 + 4), (y * W * 2 + x) * 4);
  writeFileSync(join(prev, file), encodePNG(W * 2, H * 2, big));
}
previewScreen('plains.png', 60);
previewScreen('grove.png', 470);
previewScreen('causeway.png', 760);
previewScreen('arena.png', 880);
{
  // all characters on one sheet
  const list = frames.filter((f) => !f.mirror && f.idx && !f.name.startsWith('tree') && !f.name.startsWith('ruin') && !f.name.startsWith('txt'));
  const W = 640, H = 420, img = new Uint8Array(W * H * 4).fill(40);
  let x = 4, y = 4, rowH = 0;
  for (const f of list) {
    if (x + f.iw > W - 4) { x = 4; y += rowH + 4; rowH = 0; }
    if (y + f.h > H) break;
    for (let yy = 0; yy < f.h; yy++) for (let xx = 0; xx < f.iw; xx++) { const c = f.idx[yy * f.iw + xx]; if (c) { const q = ((y + yy) * W + x + xx) * 4; [img[q], img[q + 1], img[q + 2]] = rgb(pf2Palette(0)[c]); img[q + 3] = 255; } }
    x += f.iw + 4; rowH = Math.max(rowH, f.h);
  }
  for (let i = 3; i < img.length; i += 4) img[i] = 255;
  writeFileSync(join(prev, 'sprites.png'), encodePNG(W, H, img));
}
console.log(`assets: ${frames.length} frames, ${treeOrdered.length} ribbon objects, PF1 ${planeBytes * 4} bytes, chip blob ${blob.length} -> ${packed.length} packed, ${palInit.length} palette entries`);
