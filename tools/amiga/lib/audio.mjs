// Offline re-creation of the game's Web Audio sounds as 8-bit Paula samples (no sample files needed).
const PAULA = 3546895;   // PAL clock

function biquad(type, sr) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, q) => {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
const expRamp = (a, b, t) => a * Math.pow(b / a, Math.max(0, Math.min(1, t)));
function env(t, a, peak, dec) {
  if (t < 0) return 0;
  if (t < a) return expRamp(0.0001, peak, t / a);
  return expRamp(peak, 0.0001, (t - a) / dec);
}
const wave = (type, ph) => {
  const p = ph - Math.floor(ph);
  if (type === 'sine') return Math.sin(p * 2 * Math.PI);
  if (type === 'square') return p < 0.5 ? 1 : -1;
  if (type === 'sawtooth') return 2 * p - 1;
  return 1 - 4 * Math.abs(p - 0.5);   // triangle
};

class Mix {
  constructor(sr, dur) { this.sr = sr; this.buf = new Float32Array(Math.ceil(sr * dur)); }
  tone(type, f0, f1, dur, vol, when = 0) {
    let ph = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const t = i / this.sr - when;
      if (t < 0 || t > dur + 0.05) continue;
      const f = f1 ? expRamp(f0, f1, t / dur) : f0;
      ph += f / this.sr;
      this.buf[i] += wave(type, ph) * env(t, 0.005, vol, dur);
    }
    return this;
  }
  noise(dur, vol, type = 'bandpass', freq = 1200, q = 1, f1 = 0, seed = 1) {
    const filt = biquad(type, this.sr);
    let s = seed * 9301 + 49297;
    for (let i = 0; i < this.buf.length; i++) {
      const t = i / this.sr;
      if (t > dur + 0.05) break;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = (s / 0x3fffffff) - 1;
      this.buf[i] += filt(n, f1 ? expRamp(freq, f1, t / dur) : freq, q) * env(t, 0.004, vol, dur);
    }
    return this;
  }
}

function to8(buf, peak = 0.95, trim = true) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  let n = buf.length;
  if (trim) while (n > 2 && Math.abs(buf[n - 1]) < m * 0.01) n--;
  n += n & 1;
  const out = new Uint8Array(n);
  const k = m > 0 ? (127 * peak) / m : 0;
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.max(-127, Math.min(127, (buf[i] || 0) * k))) & 255;
  return { data: out, level: m };
}

export function buildAudio() {
  const samples = [];
  const add = (name, data, { rate, loopStart = -1, vol = 64, prio = 1 }) => {
    samples.push({ name, data, rate, loopStart, vol, prio, period: Math.round(PAULA / rate) });
  };
  // ---- sound effects (same recipes as src/audio.js) ----
  const SR = 11025;
  const sfx = {
    jump: (m) => m.tone('sine', 220, 520, 0.16, 0.25),
    land: (m) => m.noise(0.12, 0.25, 'lowpass', 400),
    swing: (m) => m.noise(0.14, 0.3, 'bandpass', 900, 0.8, 2600),
    hit: (m) => m.tone('triangle', 160, 55, 0.18, 0.6).noise(0.08, 0.5, 'highpass', 1800),
    kill: (m) => m.tone('sawtooth', 420, 60, 0.4, 0.22).noise(0.3, 0.3, 'lowpass', 1200, 1, 200),
    hurt: (m) => m.tone('square', 300, 90, 0.3, 0.25).noise(0.2, 0.3, 'lowpass', 900),
    pickup: (m) => [523, 659, 784, 1046].forEach((f, i) => m.tone('sine', f, 0, 0.22, 0.2, i * 0.06)),
    windup: (m) => m.tone('sawtooth', 90, 180, 0.4, 0.08),
    slash: (m) => m.noise(0.18, 0.4, 'bandpass', 3000, 2, 800),
    wisp: (m) => m.tone('sine', 900, 300, 0.6, 0.12).tone('sine', 1350, 450, 0.6, 0.06),
    spit: (m) => m.tone('triangle', 260, 120, 0.15, 0.3).noise(0.1, 0.25, 'bandpass', 700),
    thud: (m) => m.tone('sine', 120, 40, 0.25, 0.4),
    slam: (m) => m.tone('sine', 80, 25, 0.8, 0.9).noise(0.6, 0.6, 'lowpass', 600, 1, 80),
    roar: (m) => m.tone('sawtooth', 70, 40, 1.4, 0.35).tone('sawtooth', 73, 38, 1.4, 0.3).noise(1.2, 0.3, 'bandpass', 300, 2, 120),
    win: (m) => [392, 494, 587, 784, 988].forEach((f, i) => m.tone('triangle', f, 0, 0.8, 0.22, i * 0.18)),
    die: (m) => [330, 262, 196, 131].forEach((f, i) => m.tone('triangle', f, 0, 0.7, 0.25, i * 0.25)),
    // new for the Amiga version: a soft footfall in the grass
    step: (m) => m.noise(0.07, 0.12, 'lowpass', 520, 0.9, 180).tone('sine', 95, 60, 0.05, 0.05),
  };
  const prio = { hit: 4, kill: 4, hurt: 5, die: 6, win: 6, slam: 5, roar: 5, pickup: 3, jump: 1, land: 1, swing: 2, step: 0 };
  const levels = {};
  for (const [name, fn] of Object.entries(sfx)) {
    const m = new Mix(SR, 2.0);
    fn(m);
    const { data, level } = to8(m.buf);
    levels[name] = level;
    add('sfx_' + name, data, { rate: SR, prio: prio[name] ?? 2 });
  }
  const maxLevel = Math.max(...Object.values(levels));
  for (const s of samples) s.vol = Math.max(20, Math.round(64 * Math.pow(levels[s.name.slice(4)] / maxLevel, 0.6)));
  samples.find((s) => s.name === 'sfx_step').vol = 10;   // footfalls stay in the background

  // ---- music ----
  const music = {};
  // Paula timing: a PAL frame is 313 lines of 227 colour clocks; the sequencer steps every 18 frames
  const FRAME_CC = 313 * 227, FRAME_HZ = PAULA / FRAME_CC, STEP = 18 / FRAME_HZ, BEAT = STEP * 2;
  const CHORDS = [[110, 164.8, 220], [87.3, 130.8, 174.6], [98, 146.8, 196], [82.4, 123.5, 164.8]];
  const MR = 8000;
  {
    // the bed: drone, the slow overlapping chord pads (through the original's 0.42 s echo) and the kick,
    // rendered as one seamless loop of the 64-step chord cycle; it plays on its own channel, so the
    // effects never have to wait for the kick and the pads keep their swell
    const BED_PER = 709, rate = PAULA / BED_PER, OS = 8, hi = rate * OS;
    const N = Math.round((64 * 18 * FRAME_CC) / BED_PER) & ~1, T = N / rate;       // loop length in seconds
    const H = N * OS * 2;                                                           // render two cycles
    const bed = new Float32Array(H), pads = new Float32Array(H);
    // drone: two detuned saws on A1 and one on E2 through a low-pass that breathes twice per loop;
    // every frequency is nudged to a whole number of cycles per loop so the loop point is seamless
    const whole = (f) => Math.round(f * T) / T;
    const fs = [55 * 2 ** (-6 / 1200), 55 * 2 ** (7 / 1200), 82.4].map(whole), ph = [0, 0.3, 0.6];
    const lp = biquad('lowpass', hi);
    for (let i = 0; i < H; i++) {
      const t = i / hi;
      let v = 0;
      for (let k = 0; k < 3; k++) { ph[k] += fs[k] / hi; v += wave('sawtooth', ph[k]); }
      bed[i] = lp(v, 380 + 220 * Math.sin((t / T) * 4 * Math.PI), 4) * 0.16;
    }
    // pads: root, fifth and octave an octave up, each 16.5 beats long, a new one every 16 steps
    const detune = [-5, 3, 6, -2, 4, -6, 2, -4, 5, -3, -1, 6];
    for (let c = 0; c < 8; c++) {
      const t0 = c * 16 * STEP, dur = BEAT * 16.5;
      CHORDS[c % 4].forEach((f, j) => {
        const fr = f * 2 * 2 ** (detune[(c % 4) * 3 + j] / 1200);
        let q = 0;
        for (let i = Math.floor(t0 * hi); i < H && i < (t0 + dur + 0.1) * hi; i++) {
          const t = i / hi - t0;
          q += fr / hi;
          const g = t < dur * 0.4 ? expRamp(0.0001, 0.05, t / (dur * 0.4)) : expRamp(0.05, 0.0001, (t - dur * 0.4) / (dur * 0.6));
          pads[i] += Math.sin(q * 2 * Math.PI) * g;
        }
      });
    }
    // the second cycle also holds the tails of the first, so it loops cleanly; pads also feed the echo
    const D = Math.round(0.42 * hi), line = new Float32Array(H), elp = biquad('lowpass', hi);
    for (let i = 0; i < H; i++) {
      const out = i >= D ? elp(line[i - D], 2200, 0.707) : 0;
      line[i] = pads[i] + out * 0.38;
      bed[i] += pads[i] + out;
    }
    // kick on every 8th step
    for (let st = 0; st < 128; st += 8) {
      const i0 = Math.round(st * STEP * hi);
      let q = 0;
      for (let i = i0; i < H && i < i0 + 0.6 * hi; i++) {
        const t = (i - i0) / hi;
        q += expRamp(70, 35, t / 0.5) / hi;
        bed[i] += Math.sin(q * 2 * Math.PI) * env(t, 0.005, 0.25, 0.5);
      }
    }
    // decimate the second cycle (two low-passes against aliasing)
    const a1 = biquad('lowpass', hi), a2 = biquad('lowpass', hi), lo = new Float32Array(N);
    for (let i = 0; i < H; i++) {
      const v = a2(a1(bed[i], rate * 0.42, 0.707), rate * 0.42, 0.707);
      if (i >= N * OS && (i - N * OS) % OS === 0) lo[(i - N * OS) / OS] = v;
    }
    const { data, level } = to8(lo, 0.95, false);
    music.bed = { data, level, rate, per: BED_PER };
    add('mus_bed', data, { rate, loopStart: 0 });
  }
  {
    // pluck: triangle + sine octave through a closing low-pass, recorded at A3 (220 Hz); the echo copy is
    // what comes back through the original's delay line (low-passed at 2.2 kHz)
    const dur = 1.45, buf = new Float32Array(Math.round(MR * dur)), lp = biquad('lowpass', MR);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < buf.length; i++) {
      const t = i / MR;
      p1 += 220 / MR; p2 += (220 * 2.01) / MR;
      const v = wave('triangle', p1) + wave('sine', p2);
      buf[i] = lp(v, expRamp(3200, 500, t / 0.9), 0.9) * env(t, 0.01, 1, 1.39);
    }
    const pl = to8(buf);
    music.pluck = pl;
    add('mus_pluck', pl.data, { rate: MR });
    const elp = biquad('lowpass', MR), eb = buf.map((v) => elp(v, 2200, 0.707));
    const ec = to8(eb);
    music.echo = ec;
    add('mus_echo', ec.data, { rate: MR });
  }
  {
    // war drum for the Titan fight: a pitched-down tom with a soft thump of noise
    const m = new Mix(MR, 0.5);
    let q = 0;
    for (let i = 0; i < m.buf.length; i++) { const t = i / MR; q += expRamp(120, 48, t / 0.4) / MR; m.buf[i] = Math.sin(q * 2 * Math.PI) * env(t, 0.003, 1, 0.42); }
    m.noise(0.16, 0.5, 'lowpass', 260);
    const dr = to8(m.buf);
    music.drum = dr;
    add('mus_drum', dr.data, { rate: MR });
  }
  // a short silent loop for one-shot sounds to fall into
  add('silence', new Uint8Array(4), { rate: MR, vol: 0 });

  // channel volumes: the bed at about half the effects' level (music bus 0.42 against 0.8); the melody gets its
  // own scale (its peaks are short, and Paula's lowest volume steps would make it grainy), its echo and the
  // drum keep the original's proportions to it
  const Km = 26 / (0.16 * music.pluck.level);
  const vols = {
    MUS_BED_VOL: 30, MUS_PLUCK_VOL_STRONG: Km * 0.16 * music.pluck.level, MUS_PLUCK_VOL: Km * 0.1 * music.pluck.level,
    MUS_ECHO_VOL_STRONG: Km * 0.16 * music.echo.level, MUS_ECHO_VOL: Km * 0.1 * music.echo.level,
    MUS_DRUM_VOL: Km * 0.3 * music.drum.level, MUS_DRUM_VOL_ACCENT: Km * 0.42 * music.drum.level,
  };
  for (const k in vols) vols[k] = Math.max(1, Math.min(64, Math.round(vols[k])));
  const ECHO_FRAMES = Math.round(0.42 * FRAME_HZ), DRUM_PATTERN = [0, 3, 6, 8, 10, 11, 13, 14].reduce((m, b) => m | (1 << b), 0);

  const enumLines = samples.map((s, i) => `\t${s.name.toUpperCase()} = ${i},`).join('\n');
  const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3, 784].map((f) => Math.round(PAULA / (MR * f / 220)));
  const header = `enum {\n${enumLines}\n\tNUM_SAMPLES = ${samples.length},\n};\nextern const Sample samples[NUM_SAMPLES];\nextern const UWORD pluckPeriods[10];\n` +
    Object.entries(vols).map(([k, v]) => `#define ${k} ${v}`).join('\n') +
    `\n#define ECHO_FRAMES ${ECHO_FRAMES}          // the original's 0.42 s echo\n#define DRUM_PATTERN 0x${DRUM_PATTERN.toString(16)}   // war drum steps of the 16-step bar (Titan fight)`;

  // ---- a stereo preview of the music exactly as audio.c sequences it (Paula: channels 0+3 left, 1+2 right)
  function preview(seconds, boss) {
    const OUT = 22050, n = Math.round(seconds * OUT), L = new Float32Array(n), R = new Float32Array(n);
    const ch = [0, 1, 2, 3].map(() => ({ d: null, pos: 0, inc: 0, vol: 0, loop: false }));
    const byName = (nm) => samples.find((s) => s.name === nm);
    const start = (c, nm, per, vol) => { const s = byName(nm); Object.assign(ch[c], { d: s.data, pos: 0, inc: PAULA / per / OUT, vol: vol / 64, loop: s.loopStart >= 0 }); };
    let rng = 0x1234567, step = 0, stepT = 0, noteIdx = 4, frame = 0;
    const rand = (k) => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return (rng >>> 16) % k; };
    const echoes = [];
    start(0, 'mus_bed', byName('mus_bed').period, vols.MUS_BED_VOL);
    for (let i = 0; i < n; i++) {
      const fNow = Math.floor((i / OUT) * FRAME_HZ);
      while (frame < fNow) {
        frame++;
        if (++stepT >= 18) {
          stepT = 0;
          const bar = step & 15, strong = [0, 3, 4, 6, 8, 10, 11, 14].includes(bar);
          if (rand(100) < (strong ? (boss ? 95 : 85) : (boss ? 30 : 15))) {
            noteIdx = Math.max(0, Math.min(9, noteIdx + [-2, -1, -1, 0, 1, 1, 2][rand(7)]));
            const s0 = bar === 0;
            start(1, 'mus_pluck', scale[noteIdx], s0 ? vols.MUS_PLUCK_VOL_STRONG : vols.MUS_PLUCK_VOL);
            if (!boss) {
              const v = s0 ? vols.MUS_ECHO_VOL_STRONG : vols.MUS_ECHO_VOL;
              echoes.push([frame + ECHO_FRAMES, scale[noteIdx], v], [frame + 2 * ECHO_FRAMES, scale[noteIdx], Math.round(v * 0.38)]);
            }
          }
          if (boss && (DRUM_PATTERN >> bar) & 1) start(3, 'mus_drum', byName('mus_drum').period, (bar & 7) === 0 ? vols.MUS_DRUM_VOL_ACCENT : vols.MUS_DRUM_VOL);
          step++;
        }
        for (let e = echoes.length - 1; e >= 0; e--) if (echoes[e][0] === frame) { start(3, 'mus_echo', echoes[e][1], echoes[e][2]); echoes.splice(e, 1); }
      }
      for (let c = 0; c < 4; c++) {
        const v = ch[c];
        if (!v.d) continue;
        let p = Math.floor(v.pos);
        if (p >= v.d.length) { if (!v.loop) { v.d = null; continue; } v.pos -= v.d.length; p = Math.floor(v.pos); }
        const x = ((v.d[p] << 24) >> 24) / 128 * v.vol;
        if (c === 0 || c === 3) L[i] += x; else R[i] += x;
        v.pos += v.inc;
      }
    }
    return { L, R, rate: OUT };
  }
  return {
    samples,
    header,
    preview,
    bedSeconds: music.bed.data.length / music.bed.rate,
    get source() {
      return `const Sample samples[NUM_SAMPLES] = {${samples.map((s) => `\n\t{ ${s.off}, ${s.data.length / 2}, ${s.loopStart < 0 ? 0 : s.loopStart / 2}, ${s.loopStart < 0 ? 0 : (s.data.length - s.loopStart) / 2}, ${s.period}, ${s.vol}, ${s.prio} }, // ${s.name}`).join('')}\n};\nconst UWORD pluckPeriods[10] = { ${scale.join(', ')} };`;
    },
  };
}
