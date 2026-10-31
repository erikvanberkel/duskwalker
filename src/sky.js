import * as THREE from 'three';
import { mulberry32, rand, fbm1, glowTexture } from './util.js';

export const PALETTE = {
  skyTop: new THREE.Color('#140a30'),
  skyMid: new THREE.Color('#4e2470'),
  skyLow: new THREE.Color('#d8706a'),
  horizon: new THREE.Color('#f2a26e'),
  fog: new THREE.Color('#b56d78'),
  sun: new THREE.Color('#ffd49a'),
};

const SUN_DIR = new THREE.Vector3(-0.42, 0.075, -1).normalize();

function moonTexture(base, dark, seed) {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed);
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); ctx.closePath();
  const g = ctx.createRadialGradient(s * 0.38, s * 0.36, s * 0.05, s / 2, s / 2, s / 2);
  g.addColorStop(0, base); g.addColorStop(1, dark);
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  for (let i = 0; i < 40; i++) {
    const x = rng() * s, y = rng() * s, r = 3 + rng() * rng() * 26;
    ctx.fillStyle = `rgba(0,0,0,${0.06 + rng() * 0.12})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rng() * 0.06})`;
    ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.8, 0, Math.PI * 2); ctx.fill();
  }
  // terminator shadow
  const sh = ctx.createLinearGradient(0, 0, s, s * 0.3);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.62, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(10,0,30,.75)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, s, s);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudTexture(seed) {
  const w = 512, h = 192, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed);
  for (let i = 0; i < 46; i++) {
    const x = w * (0.12 + rng() * 0.76), y = h * (0.45 + (rng() - 0.5) * 0.35);
    const r = 20 + rng() * 60 * (1 - Math.abs(x / w - 0.5));
    const g = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // darker underside
  const u = ctx.createLinearGradient(0, 0, 0, h);
  u.addColorStop(0, 'rgba(255,255,255,0)'); u.addColorStop(1, 'rgba(60,20,70,0.5)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = u; ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One distant ridge silhouette strip, its own parallax layer. */
function ridgeLayer(z, base, amp, freq, top, bottom, seed, jag = 0.5) {
  const x0 = -1800, x1 = 3000, step = 5;
  const n = Math.ceil((x1 - x0) / step) + 1;
  const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3);
  const idx = [];
  const ct = new THREE.Color(top), cb = new THREE.Color(bottom);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step;
    const ridge = 1 - Math.abs(fbm1(x * freq + seed, 5) * 2 - 1);
    const h = base + amp * (Math.pow(ridge, 1.6) * jag + fbm1(x * freq * 0.37 + seed * 3, 3) * (1 - jag));
    pos.set([x, -80, z, x, h, z], i * 6);
    col.set([cb.r, cb.g, cb.b, ct.r, ct.g, ct.b], i * 6);
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.frustumCulled = false;
  return m;
}

export class Sky {
  constructor(scene) {
    this.follow = new THREE.Group();     // locked to camera (infinitely far)
    this.moons = new THREE.Group();      // near-infinite: drifts very slowly
    scene.add(this.follow, this.moons);

    // gradient dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top: { value: PALETTE.skyTop }, mid: { value: PALETTE.skyMid }, low: { value: PALETTE.skyLow },
          hor: { value: PALETTE.horizon }, sunDir: { value: SUN_DIR }, sunCol: { value: PALETTE.sun },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top, mid, low, hor, sunDir, sunCol; varying vec3 vDir;
          void main(){
            float y = vDir.y;
            vec3 c = mix(hor, low, smoothstep(-0.02, 0.10, y));
            c = mix(c, mid, smoothstep(0.08, 0.35, y));
            c = mix(c, top, smoothstep(0.30, 0.85, y));
            float s = max(dot(normalize(vDir), sunDir), 0.0);
            c += sunCol * (pow(s, 8.0) * 0.45 + pow(s, 64.0) * 0.8);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      })
    );
    dome.renderOrder = -10;
    this.follow.add(dome);

    // stars
    const rng = mulberry32(42);
    const sp = [], sc = [];
    for (let i = 0; i < 1800; i++) {
      const th = rng() * Math.PI * 2, y = 0.12 + rng() * 0.88;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(th) * r * 2400, y * 2400, Math.sin(th) * r * 2400);
      const b = (0.3 + rng() * 0.7) * Math.min(1, (y - 0.12) * 3);
      sc.push(b, b * 0.92, b * 1.1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
    this.follow.add(this.stars);

    // sun
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,236,190,1)', 'rgba(255,140,60,0)'), fog: false, depthWrite: false, toneMapped: false, color: new THREE.Color(3, 2.4, 1.6) }));
    sun.position.copy(SUN_DIR).multiplyScalar(2200);
    sun.scale.setScalar(320);
    this.follow.add(sun);

    // moons (slight parallax)
    const moonA = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: moonTexture('#f3e7ff', '#8a77b8', 7), transparent: true, fog: false, depthWrite: false }));
    moonA.position.set(260, 420, -1900); moonA.scale.setScalar(170);
    const moonB = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: moonTexture('#ffd2a1', '#b0523a', 3), transparent: true, fog: false, depthWrite: false }));
    moonB.position.set(-120, 560, -1900); moonB.scale.setScalar(58);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(220,200,255,.45)', 'rgba(160,120,255,0)'), fog: false, depthWrite: false, transparent: true }));
    halo.position.copy(moonA.position).add(new THREE.Vector3(0, 0, -5)); halo.scale.setScalar(620);
    this.moons.add(halo, moonA, moonB);

    // mountain parallax layers (far -> near)
    this.ridges = [
      ridgeLayer(-1500, 70, 260, 0.0030, '#9a5a86', '#e39a82', 11, 0.7),
      ridgeLayer(-1100, 35, 170, 0.0050, '#7a3f72', '#cf7a80', 23, 0.6),
      ridgeLayer(-780, 18, 105, 0.0085, '#5b2c63', '#b0637a', 37, 0.55),
      ridgeLayer(-540, 6, 62, 0.0140, '#43204f', '#93506c', 51, 0.4),
    ];
    for (const r of this.ridges) scene.add(r);

    // clouds: banks at different depths drifting across the dusk
    this.clouds = [];
    const crng = mulberry32(99);
    const texes = [0, 1, 2, 3].map((i) => cloudTexture(200 + i));
    for (let i = 0; i < 46; i++) {
      const z = rand(crng, -1300, -420);
      const depthT = (z + 1300) / 880;
      const mat = new THREE.MeshBasicMaterial({
        map: texes[i % 4], transparent: true, depthWrite: false, fog: false,
        color: new THREE.Color().lerpColors(new THREE.Color('#f5b39a'), new THREE.Color('#c27aa8'), crng()).multiplyScalar(0.8 + depthT * 0.3),
        opacity: 0.55 + crng() * 0.35,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.375), mat);
      const w = rand(crng, 160, 420) * (1 - depthT * 0.4);
      m.scale.set(w, w, 1);
      m.position.set(rand(crng, -900, 2200), rand(crng, 70, 330) * (1.2 - depthT * 0.5), z);
      m.userData.speed = rand(crng, 1.5, 4) * (0.6 + depthT);
      this.clouds.push(m);
      scene.add(m);
    }
  }

  update(camera, dt) {
    this.follow.position.set(camera.position.x, 0, camera.position.z);
    this.moons.position.set(camera.position.x * 0.97, 0, camera.position.z);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 2400) c.position.x -= 3400;
    }
  }
}
