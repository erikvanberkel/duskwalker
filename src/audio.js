// Fully procedural audio: Web Audio synthesis, no sample files.
export class Audio {
  constructor() { this.ctx = null; this.musicOn = true; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.42; this.musicBus.connect(this.master);
    // echo for the music
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.delay.connect(lp); lp.connect(fb); fb.connect(this.delay); lp.connect(this.musicBus);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.42 : 0, this.ctx.currentTime, 0.2);
  }

  env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  tone(type, f0, f1, dur, vol, dest = this.sfxBus, when = 0) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol, type = 'bandpass', freq = 1200, q = 1, f1) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump': this.tone('sine', 220, 520, 0.16, 0.25); break;
      case 'land': this.noise(0.12, 0.25, 'lowpass', 400); break;
      case 'swing': this.noise(0.14, 0.3, 'bandpass', 900, 0.8, 2600); break;
      case 'hit': this.tone('triangle', 160, 55, 0.18, 0.6); this.noise(0.08, 0.5, 'highpass', 1800); break;
      case 'kill': this.tone('sawtooth', 420, 60, 0.4, 0.22); this.noise(0.3, 0.3, 'lowpass', 1200, 1, 200); break;
      case 'hurt': this.tone('square', 300, 90, 0.3, 0.25); this.noise(0.2, 0.3, 'lowpass', 900); break;
      case 'pickup': [523, 659, 784, 1046].forEach((f, i) => this.tone('sine', f, 0, 0.22, 0.2, this.sfxBus, i * 0.06)); break;
      case 'windup': this.tone('sawtooth', 90, 180, 0.4, 0.08); break;
      case 'slash': this.noise(0.18, 0.4, 'bandpass', 3000, 2, 800); break;
      case 'wisp': this.tone('sine', 900, 300, 0.6, 0.12); this.tone('sine', 1350, 450, 0.6, 0.06); break;
      case 'spit': this.tone('triangle', 260, 120, 0.15, 0.3); this.noise(0.1, 0.25, 'bandpass', 700); break;
      case 'thud': this.tone('sine', 120, 40, 0.25, 0.4); break;
      case 'slam': this.tone('sine', 80, 25, 0.8, 0.9); this.noise(0.6, 0.6, 'lowpass', 600, 1, 80); break;
      case 'roar': this.tone('sawtooth', 70, 40, 1.4, 0.35); this.tone('sawtooth', 73, 38, 1.4, 0.3); this.noise(1.2, 0.3, 'bandpass', 300, 2, 120); break;
      case 'win': [392, 494, 587, 784, 988].forEach((f, i) => this.tone('triangle', f, 0, 0.8, 0.22, this.sfxBus, i * 0.18)); break;
      case 'die': [330, 262, 196, 131].forEach((f, i) => this.tone('triangle', f, 0, 0.7, 0.25, this.sfxBus, i * 0.25)); break;
    }
  }

  // ---------- generative dusk music ----------
  startMusic() {
    const c = this.ctx;
    // drone: two detuned saws through a slowly breathing low-pass
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 4;
    const dg = c.createGain(); dg.gain.value = 0.16;
    for (const [f, det] of [[55, -6], [55, 7], [82.4, 0]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start();
    }
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 220; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    lp.connect(dg); dg.connect(this.musicBus);

    // A minor pentatonic phrase bank; chords cycle under a plucked melody
    const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3, 784];
    const chords = [[110, 164.8, 220], [87.3, 130.8, 174.6], [98, 146.8, 196], [82.4, 123.5, 164.8]];
    const beat = 60 / 84;
    let step = 0, next = c.currentTime + 0.3, idx = 4;
    const pluck = (f, t, vol) => {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f2 = c.createBiquadFilter();
      o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2.01;
      f2.type = 'lowpass'; f2.frequency.setValueAtTime(3200, t); f2.frequency.exponentialRampToValueAtTime(500, t + 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(f2); o2.connect(f2); f2.connect(g); g.connect(this.musicBus); g.connect(this.delay);
      o.start(t); o2.start(t); o.stop(t + 1.5); o2.stop(t + 1.5);
    };
    const pad = (freqs, t, dur) => {
      for (const f of freqs) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f * 2; o.detune.value = (Math.random() - 0.5) * 12;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.musicBus); g.connect(this.delay); o.start(t); o.stop(t + dur + 0.1);
      }
    };
    const tick = () => {
      while (next < c.currentTime + 0.6) {
        if (step % 16 === 0) pad(chords[(step / 16) % chords.length | 0], next, beat * 16.5);
        const bar = step % 16;
        const playNote = [0, 3, 4, 6, 8, 10, 11, 14].includes(bar) ? Math.random() < 0.85 : Math.random() < 0.15;
        if (playNote) {
          idx = Math.max(0, Math.min(scale.length - 1, idx + [-2, -1, -1, 0, 1, 1, 2][(Math.random() * 7) | 0]));
          pluck(scale[idx], next, bar === 0 ? 0.16 : 0.1);
        }
        if (bar % 8 === 0) { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(70, next); o.frequency.exponentialRampToValueAtTime(35, next + 0.5); this.env(g, next, 0.005, 0.25, 0.5); o.connect(g); g.connect(this.musicBus); o.start(next); o.stop(next + 0.6); }
        next += beat / 2; step++;
      }
    };
    setInterval(tick, 120);
  }
}
