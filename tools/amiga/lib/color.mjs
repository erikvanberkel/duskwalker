// Colour helpers (sRGB hex <-> linear, mixing) and a k-means palette quantiser.
export const hex = (h) => parseInt(h.replace('#', ''), 16);
export const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export const pack = (r, g, b) => (Math.max(0, Math.min(255, Math.round(r))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(b)));
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
export const lin = (c) => rgb(c).map(toLin);
export const fromLin = (l) => pack(toSrgb(l[0]), toSrgb(l[1]), toSrgb(l[2]));
// mix in linear light (like three.js)
export const mixL = (a, b, t) => { const A = lin(a), B = lin(b); return fromLin([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t)); };
// mix in sRGB (like CSS gradients)
export const mixS = (a, b, t) => { const A = rgb(a), B = rgb(b); return pack(...[0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t)); };
export const scale = (c, k) => pack(...rgb(c).map((v) => v * k));
export const lum = (c) => { const [r, g, b] = rgb(c); return 0.299 * r + 0.587 * g + 0.114 * b; };

// perceptual-ish distance
export function dist2(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2], rm = (a[0] + b[0]) / 2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

// k-means over [r,g,b,weight] samples; `fixed` colours are kept as centres but never move.
export function kmeans(samples, k, fixed = [], iters = 24, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const centres = fixed.map((c) => [...rgb(c)]);
  const free = k - centres.length;
  if (samples.length === 0) return centres.map((c) => pack(...c));
  // k-means++ style seeding for the free centres
  for (let i = 0; i < free; i++) {
    if (centres.length === 0) { centres.push([...samples[Math.floor(rnd() * samples.length)]].slice(0, 3)); continue; }
    let best = null, bestD = -1;
    for (let t = 0; t < 40; t++) {
      const cand = samples[Math.floor(rnd() * samples.length)];
      let d = Infinity;
      for (const c of centres) d = Math.min(d, dist2(cand, c));
      d *= cand[3];
      if (d > bestD) { bestD = d; best = cand; }
    }
    centres.push(best.slice(0, 3));
  }
  for (let it = 0; it < iters; it++) {
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (const p of samples) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < centres.length; j++) { const d = dist2(p, centres[j]); if (d < bd) { bd = d; bi = j; } }
      const a = acc[bi]; a[0] += p[0] * p[3]; a[1] += p[1] * p[3]; a[2] += p[2] * p[3]; a[3] += p[3];
    }
    for (let j = fixed.length; j < centres.length; j++) if (acc[j][3] > 0) centres[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
  }
  return centres.map((c) => pack(...c));
}

export function nearest(c, palette, allowed) {
  let bi = allowed ? allowed[0] : 0, bd = Infinity;
  const p = Array.isArray(c) ? c : rgb(c);
  for (const i of allowed ?? palette.keys()) {
    if (palette[i] === undefined || palette[i] === null) continue;
    const d = dist2(p, rgb(palette[i]));
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
