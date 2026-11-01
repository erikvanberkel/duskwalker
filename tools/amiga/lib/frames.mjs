// Baked RGBA frames -> palette-indexed images -> interleaved 4-plane blitter objects with a mask plane.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePNG } from './png.mjs';
import { rgb, dist2 } from './color.mjs';

export function loadBake(dir) {
  const metaFile = join(dir, 'bake.json');
  if (!existsSync(metaFile)) throw new Error(`No baked frames in ${dir}. Run "npm run amiga:bake" first.`);
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const get = (name) => {
    const m = meta[name];
    if (!m) throw new Error('missing baked frame ' + name);
    const png = decodePNG(readFileSync(join(dir, name + '.png')));
    return { ...m, ...downsample(png, m.ss) };
  };
  return { meta, get };
}

// Box-filter supersampled RGBA down by `ss`: colour averaged over covered samples, alpha = coverage.
export function downsample(png, ss) {
  const w = Math.floor(png.w / ss), h = Math.floor(png.h / ss);
  const rgba = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const o = ((y * ss + sy) * png.w + x * ss + sx) * 4, al = png.rgba[o + 3] / 255;
          r += png.rgba[o] * al; g += png.rgba[o + 1] * al; b += png.rgba[o + 2] * al; a += al;
        }
      const o = (y * w + x) * 4;
      if (a > 0) { rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a; }
      rgba[o + 3] = a / (ss * ss);
    }
  return { w, h, rgba };
}

export function samplesOf(img, weight = 1, minAlpha = 0.5) {
  const out = [];
  for (let i = 0; i < img.w * img.h; i++) if (img.rgba[i * 4 + 3] >= minAlpha) out.push([img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2], weight]);
  return out;
}

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// -> Uint8Array of palette indices (0 = transparent)
export function quantize(img, palette, allowed, { alpha = 0.45, dither = 0, gain = 1 } = {}) {
  const idx = new Uint8Array(img.w * img.h);
  const pal = allowed.map((i) => [i, rgb(palette[i])]);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const o = (y * img.w + x) * 4;
      if (img.rgba[o + 3] < alpha) continue;
      const d = dither ? (BAYER[y & 3][x & 3] / 16 - 0.47) * dither : 0;
      const p = [img.rgba[o] * gain + d, img.rgba[o + 1] * gain + d, img.rgba[o + 2] * gain + d];
      let bi = pal[0][0], bd = Infinity;
      for (const [i, c] of pal) { const dd = dist2(p, c); if (dd < bd) { bd = dd; bi = i; } }
      idx[y * img.w + x] = bi;
    }
  return idx;
}

// Pack an index image (w x h) into interleaved planes + mask, padded to whole words.
export function packBob(idx, w, h, padLeft = 0) {
  const W = Math.ceil((w + padLeft) / 16) * 16, ww = W / 16, rb = ww * 2;
  const data = new Uint8Array(rb * h * 5);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = idx[y * w + x];
      if (!c) continue;
      const X = x + padLeft, bit = 0x80 >> (X & 7), byte = X >> 3;
      for (let k = 0; k < 4; k++) if (c & (1 << k)) data[y * rb * 4 + k * rb + byte] |= bit;
      data[rb * h * 4 + y * rb + byte] |= bit;
    }
  return { ww, h, data, W };
}

// Crop transparent borders, returning the image and its new origin.
export function cropIdx(idx, w, h) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (idx[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return { idx: new Uint8Array(16), w: 16, h: 1, x0: 0, y0: 0 };
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1, out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) out.set(idx.subarray((y + y0) * w + x0, (y + y0) * w + x0 + nw), y * nw);
  return { idx: out, w: nw, h: nh, x0, y0 };
}
