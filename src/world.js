import * as THREE from 'three';
import { mulberry32, rand, fbm2, noise2, smooth, clamp, addSway, paint, merge, glowTexture } from './util.js';
import { TreeField } from './trees.js';
import { buildAirship } from './airship.js';

export const LEVEL = { start: 4, end: 905, arena: 838 };
export const ZONES = [
  { name: 'The Amber Plains', from: 0 },
  { name: 'The Whispering Grove', from: 330 },
  { name: 'The Sunken Causeway', from: 650 },
];

/** 0 = plains, 1 = grove, 2 = causeway (blended). */
function zoneWeights(x) {
  const g = smooth(clamp((x - 300) / 60, 0, 1)) * (1 - smooth(clamp((x - 620) / 60, 0, 1)));
  const c = smooth(clamp((x - 620) / 60, 0, 1));
  return [1 - g - c, g, c];
}

export function groundHeight(x, z) {
  if (z > -6 && z < 4) return 0;
  const back = smooth(clamp((-z - 6) / 120, 0, 1));
  const front = smooth(clamp((z - 4) / 20, 0, 1));
  const n = fbm2(x * 0.012, z * 0.012, 4);
  const far = smooth(clamp((-z - 140) / 300, 0, 1));
  return back * (n * 18 + far * 30) + front * n * 2.5 + noise2(x * 0.2, z * 0.2) * 0.25 * (back + front);
}

function buildGround() {
  const g = new THREE.PlaneGeometry(2600, 760, 520, 150);
  g.rotateX(-Math.PI / 2);
  g.translate(500, 0, -330);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const grassP = new THREE.Color('#857b36'), grassP2 = new THREE.Color('#566a2a');
  const grassG = new THREE.Color('#2a4733'), grassG2 = new THREE.Color('#38593a');
  const grassC = new THREE.Color('#6d5548'), grassC2 = new THREE.Color('#4f3d3a');
  const dirt = new THREE.Color('#6a4630'), stone = new THREE.Color('#857a72');
  const c = new THREE.Color(), a = new THREE.Color(), b = new THREE.Color(), k = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = groundHeight(x, z);
    pos.setY(i, y);
    const [wp, wg, wc] = zoneWeights(x);
    const n = fbm2(x * 0.05, z * 0.05, 3);
    a.copy(grassP).lerp(grassP2, n); b.copy(grassG).lerp(grassG2, n); k.copy(grassC).lerp(grassC2, n);
    c.setRGB(a.r * wp + b.r * wg + k.r * wc, a.g * wp + b.g * wg + k.g * wc, a.b * wp + b.b * wg + k.b * wc);
    // trodden path
    const path = 1 - smooth(clamp((Math.abs(z + 0.3) - 1.6 - noise2(x * 0.3, 1) * 1.2) / 1.4, 0, 1));
    c.lerp(wc > 0.5 ? stone : dirt, path * 0.85);
    c.multiplyScalar(0.85 + noise2(x * 0.7, z * 0.7) * 0.3);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

function buildGrass(rng) {
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.07, 0, 0, 0.07, 0, 0, -0.04, 0.45, 0.02, 0.04, 0.45, 0.02, 0, 0.9, 0.08], 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  blade.computeVertexNormals();
  const count = 22000;
  const mat = addSway(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), 0.22, 0.9);
  const mesh = new THREE.InstancedMesh(blade, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  const palette = [[new THREE.Color('#a8963f'), new THREE.Color('#6f7f2f')], [new THREE.Color('#3d6a48'), new THREE.Color('#25463a')], [new THREE.Color('#7b6a52'), new THREE.Color('#4d4a36')]];
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const x = rand(rng, -60, 980);
    let z = rand(rng, -34, 5.5);
    if (Math.abs(z) < 2.4 && rng() < 0.85) z = (z < 0 ? -1 : 1) * rand(rng, 2.4, 6);
    const [wp, wg, wc] = zoneWeights(x);
    const zone = wp > wg && wp > wc ? 0 : wg > wc ? 1 : 2;
    if (zone === 2 && rng() < 0.6) continue;
    const j = placed++;
    p.set(x, groundHeight(x, z) - 0.02, z);
    e.set((rng() - 0.5) * 0.4, rng() * Math.PI, (rng() - 0.5) * 0.4);
    q.setFromEuler(e);
    const h = rand(rng, 0.6, 1.6) * (zone === 1 ? 1.3 : 1);
    s.set(1 + rng(), h, 1);
    mesh.setMatrixAt(j, m.compose(p, q, s));
    c.copy(palette[zone][0]).lerp(palette[zone][1], rng());
    mesh.setColorAt(j, c);
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  return mesh;
}

function rockGeometry(rng, sx, sy, sz) {
  const g = new THREE.DodecahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const seed = rng() * 50;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + noise2(x * 1.3 + seed, y * 1.3 + z) * 0.45;
    pos.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

function buildStones(rng) {
  const parts = [];
  const stoneCol = new THREE.Color('#7d7470'), mossCol = new THREE.Color('#5d6a33');
  const tint = (g, base) => paint(g, base, (c, p) => {
    c.multiplyScalar(0.75 + noise2(p.x * 2, p.y * 2 + p.z) * 0.4);
    if (p.y > 0.4 && noise2(p.x * 0.9 + 3, p.z * 0.9) > 0.6) c.lerp(mossCol, 0.55);
  });
  const place = (g, x, z, rotY = 0, yOff = 0) => {
    g.rotateY(rotY);
    g.translate(x, groundHeight(x, z) + yOff, z);
    parts.push(tint(g, stoneCol));
  };
  // scattered boulders along the whole route
  for (let i = 0; i < 140; i++) {
    const x = rand(rng, -40, 960), z = rng() < 0.5 ? rand(rng, -40, -4) : rand(rng, 4, 12);
    const s = rand(rng, 0.3, 1.4) * (z > 0 ? 0.6 : 1);
    place(rockGeometry(rng, s * rand(rng, 1, 1.8), s, s * rand(rng, 0.8, 1.4)), x, z, rng() * 3, s * 0.2);
  }
  // standing stones of the plains (rings of monoliths in the middle distance)
  for (const [cx, cz, r] of [[70, -60, 9], [205, -38, 6], [280, -95, 12]]) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      if (rng() < 0.18) continue;
      const a = (i / n) * Math.PI * 2;
      const h = rand(rng, 4, 7.5);
      const g = new THREE.BoxGeometry(rand(rng, 1.3, 2), h, rand(rng, 0.9, 1.3), 2, 4, 2);
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) pos.setX(k, pos.getX(k) * (1 - (pos.getY(k) / h + 0.5) * 0.25) + (noise2(k, h) - 0.5) * 0.25);
      g.computeVertexNormals();
      g.translate(0, h / 2 - 0.3, 0);
      g.rotateZ((rng() - 0.5) * 0.18);
      place(g, cx + Math.cos(a) * r, cz + Math.sin(a) * r, -a);
    }
  }
  // causeway ruins: broken columns, fallen drums, arches
  for (let x = 650; x < 960; x += rand(rng, 9, 16)) {
    for (const z of [-7.5, 7]) {
      if (z > 0 && rng() < 0.5) continue;
      const h = rng() < 0.3 ? rand(rng, 8, 11) : rand(rng, 1.5, 6);
      const g = new THREE.CylinderGeometry(0.85, 1, h, 10, 3);
      g.translate(0, h / 2, 0);
      place(g, x + rand(rng, -1, 1), z + rand(rng, -1, 1), rng());
      const cap = new THREE.BoxGeometry(2.4, 0.6, 2.4); cap.translate(0, 0.3, 0);
      place(cap, x, z, rng(), 0);
      if (rng() < 0.5) {
        const d = new THREE.CylinderGeometry(0.85, 0.85, 1.6, 10);
        d.rotateZ(Math.PI / 2); d.rotateY(rng() * 3);
        place(d, x + rand(rng, 2, 4), z + rand(rng, -2, 2), 0, 0.7);
      }
    }
  }
  // arena: ring of tall pillars with lintels behind the boss
  for (let i = 0; i < 6; i++) {
    const x = LEVEL.arena + 6 + i * 11, z = -16 - (i % 2) * 6;
    const g = new THREE.CylinderGeometry(1.2, 1.4, 14, 12); g.translate(0, 7, 0); place(g, x, z, 0);
    if (i % 2 === 0) { const l = new THREE.BoxGeometry(14, 1.4, 2.2); l.translate(5.5, 14.7, 0); place(l, x, z, 0); }
  }
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function populateTrees(rng) {
  const f = new TreeField();
  const onGround = (x, z) => groundHeight(x, z) - 0.3;
  // --- the Amber Plains: huge hero trees right behind the path ---
  for (let x = -30; x < 340; x += rand(rng, 34, 52)) {
    const z = rand(rng, -26, -14);
    f.add('giant', x, z, rand(rng, 1.0, 1.3), { y: onGround(x, z), shadow: true });
  }
  for (let x = -60; x < 360; x += rand(rng, 18, 30)) {
    const z = rand(rng, -95, -42);
    f.add(rng() < 0.6 ? 'giant' : 'broad', x, z, rand(rng, 0.8, 1.15), { y: onGround(x, z) });
  }
  // foreground trunks sweeping past the camera (fast parallax)
  for (const x of [52, 168, 262]) f.add('giant', x, rand(rng, 9.5, 10.5), 0.85, { y: -0.3 });
  // --- the Whispering Grove: dense canopy, lantern trees, spires ---
  for (let x = 320; x < 660; x += rand(rng, 20, 30)) {
    const z = rand(rng, -24, -12);
    f.add('giant', x, z, rand(rng, 1.05, 1.4), { y: onGround(x, z), shadow: true });
  }
  for (let x = 330; x < 650; x += rand(rng, 14, 22)) {
    const z = rng() < 0.75 ? rand(rng, -10, -6.5) : rand(rng, 6, 9);
    f.add('lantern', x, z, rand(rng, 0.8, 1.1), { y: onGround(x, z), shadow: true });
  }
  for (let x = 320; x < 680; x += rand(rng, 9, 16)) {
    const z = rand(rng, -110, -35);
    f.add(rng() < 0.45 ? 'spire' : 'giant', x, z, rand(rng, 0.9, 1.3), { y: onGround(x, z) });
  }
  // --- the Sunken Causeway: dead trees and lone spires ---
  for (let x = 640; x < 980; x += rand(rng, 12, 22)) {
    const z = rand(rng, -40, -10);
    f.add('dead', x, z, rand(rng, 1.1, 1.8), { y: onGround(x, z), shadow: z > -20 });
  }
  for (let x = 640; x < 1000; x += rand(rng, 18, 30)) {
    const z = rand(rng, -130, -50);
    f.add(rng() < 0.5 ? 'spire' : 'dead', x, z, rand(rng, 1, 1.6), { y: onGround(x, z) });
  }
  // --- far tree lines on the hills (become fogged silhouettes) ---
  for (let x = -350; x < 1400; x += rand(rng, 7, 13)) {
    const z = rand(rng, -330, -140);
    const [wp, wg] = zoneWeights(x);
    const type = wp > 0.5 ? (rng() < 0.4 ? 'giant' : 'broad') : wg > 0.5 ? (rng() < 0.5 ? 'spire' : 'giant') : (rng() < 0.5 ? 'dead' : 'spire');
    f.add(type, x, z, rand(rng, 1.3, 2.4), { y: onGround(x, z) });
  }
  return f;
}

function buildFireflies(rng) {
  const n = 700;
  const pos = new Float32Array(n * 3), base = new Float32Array(n * 3), phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = rand(rng, 300, 680), y = rand(rng, 0.5, 9), z = rand(rng, -30, 10);
    base.set([x, y, z], i * 3); pos.set([x, y, z], i * 3); phase[i] = rng() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.45, map: glowTexture('rgba(255,240,170,1)', 'rgba(255,200,80,0)', 64), color: new THREE.Color(2.2, 1.9, 0.9),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  pts.userData.update = (t) => {
    for (let i = 0; i < n; i++) {
      const ph = phase[i];
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.4 + ph) * 1.6;
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.7 + ph * 1.3) * 0.8;
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.3 + ph) * 1.2;
    }
    g.attributes.position.needsUpdate = true;
  };
  return pts;
}

function buildGodRays(rng) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,220,150,0.9)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 256);
  const side = ctx.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = side; ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(c);
  const group = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: rand(rng, 0.05, 0.13), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.scale.set(rand(rng, 3, 8), rand(rng, 26, 36), 1);
    m.position.set(rand(rng, 320, 660), 13, rand(rng, -22, -4));
    m.rotation.z = -0.38;
    group.add(m);
  }
  return group;
}

export class World {
  constructor(scene) {
    const rng = mulberry32(1337);
    this.scene = scene;
    scene.add(buildGround());
    scene.add(buildGrass(rng));
    scene.add(buildStones(rng));
    populateTrees(rng).build(scene);
    this.fireflies = buildFireflies(rng);
    scene.add(this.fireflies);
    scene.add(buildGodRays(rng));

    this.airship = buildAirship();
    this.airship.position.set(-40, 46, -170);
    this.airship.rotation.y = -0.12;
    scene.add(this.airship);
    this.airship2 = buildAirship();
    this.airship2.scale.setScalar(0.55);
    this.airship2.position.set(900, 150, -680);
    this.airship2.rotation.y = Math.PI + 0.2;
    scene.add(this.airship2);
    this.time = 0;
  }

  zoneAt(x) {
    let z = 0;
    for (let i = 0; i < ZONES.length; i++) if (x >= ZONES[i].from) z = i;
    return z;
  }

  update(dt, camX) {
    this.time += dt;
    this.airship.userData.update(dt);
    this.airship2.userData.update(dt);
    // the airship cruises along with the traveller, slowly falling behind and wrapping round
    this.airship.position.x += dt * 4.2;
    if (this.airship.position.x < camX - 260) this.airship.position.x = camX + 200;
    if (this.airship.position.x > camX + 260) this.airship.position.x = camX - 200;
    this.airship2.position.x -= dt * 2.5;
    if (this.airship2.position.x < camX - 900) this.airship2.position.x = camX + 900;
    if (Math.abs(camX - 490) < 280) this.fireflies.userData.update(this.time);
  }
}
