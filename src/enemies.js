import * as THREE from 'three';
import { clamp, damp, rand, noise2, glowTexture } from './util.js';

const GRAV = 40;
const glowTex = glowTexture();
const overlap = (a, b) => a && b && a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
export { overlap };

function std(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }); }
function glowMat(r, g, b) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false }); }
function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true;
  parent?.add(m);
  return m;
}
function halo(parent, color, size, y = 0) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  s.scale.setScalar(size); s.position.y = y;
  parent.add(s);
  return s;
}
function limbBetween(a, b, r, mat, parent) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  const m = mesh(g, mat, parent);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

class Enemy {
  constructor(game, x, y = 0) {
    this.game = game;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.facing = -1; this.alive = true; this.dying = 0; this.flash = 0; this.t = Math.random() * 10;
    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.mats = [];
    game.scene.add(this.root);
  }
  m(color, opts) { const mt = std(color, opts); this.mats.push(mt); return mt; }
  hurtBox() { return null; }
  attackBox() { return null; }
  hit(dmg, dir) {
    this.hp -= dmg; this.flash = 0.12;
    this.vx = dir * this.knock; if (this.y <= 0.01 && this.knockUp) this.vy = this.knockUp;
    if (this.hp <= 0) { this.dying = 0.001; this.game.onEnemyKilled(this); }
    return true;
  }
  baseUpdate(dt) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    for (const mt of this.mats) { mt.emissive.setRGB(this.flash > 0 ? 1 : 0, this.flash > 0 ? 0.9 : 0, this.flash > 0 ? 0.8 : 0); }
    if (this.dying > 0) {
      this.dying += dt;
      const k = clamp(this.dying / 0.55, 0, 1);
      this.model.rotation.z = (this.facing > 0 ? -1 : 1) * k * 1.4;
      this.model.scale.setScalar(1 - k * 0.9);
      if (k >= 1) this.remove();
    }
    this.root.position.set(this.x, this.y, 0);
    this.root.rotation.y = this.facing > 0 ? -0.35 : Math.PI + 0.35;
  }
  remove() { this.alive = false; this.game.scene.remove(this.root); }
}

/** Spiny crawler: rushes in and hops. */
class Skitter extends Enemy {
  constructor(game, x) {
    super(game, x);
    this.hp = 1; this.knock = 9; this.knockUp = 6; this.contact = 1; this.score = 100;
    const shell = this.m('#4c1f45', { roughness: 0.4, metalness: 0.2 }), belly = this.m('#2a1220'), spike = this.m('#d9a66b');
    const body = (this.bodyMesh = mesh(new THREE.SphereGeometry(0.5, 16, 12), shell, this.model, 0, 0.55, 0));
    body.scale.set(1.25, 0.72, 1);
    mesh(new THREE.SphereGeometry(0.42, 12, 8), belly, this.model, 0.05, 0.42, 0).scale.set(1.2, 0.5, 0.9);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI - Math.PI / 2;
      const c = mesh(new THREE.ConeGeometry(0.09, 0.42, 6), spike, body, Math.sin(a) * 0.35, 0.42, Math.cos(a) * 0.15 * (i % 2 ? 1 : -1));
      c.rotation.z = -Math.sin(a) * 0.9;
    }
    const eye = glowMat(4, 0.5, 0.2);
    for (const z of [-0.14, 0.14]) mesh(new THREE.SphereGeometry(0.06, 8, 6), eye, this.model, 0.6, 0.62, z);
    halo(this.model, new THREE.Color(1, 0.2, 0.1), 0.6, 0.62).position.x = 0.62;
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const piv = new THREE.Group();
      piv.position.set(-0.3 + (i % 3) * 0.3, 0.42, i < 3 ? 0.32 : -0.32);
      const leg = mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.6, 5), belly, piv, 0, -0.18, (i < 3 ? 1 : -1) * 0.18);
      leg.rotation.x = (i < 3 ? 1 : -1) * 0.9;
      this.model.add(piv);
      this.legs.push(piv);
    }
    this.hopT = rand(Math.random, 0.8, 2);
  }
  hurtBox() { return this.dying ? null : { x0: this.x - 0.6, x1: this.x + 0.6, y0: this.y, y1: this.y + 1.0 }; }
  update(dt, player) {
    if (!this.dying) {
      const dx = player.x - this.x;
      if (Math.abs(dx) > 0.4) this.facing = Math.sign(dx);
      const onGround = this.y <= 0.001;
      if (onGround) {
        this.vx = damp(this.vx, this.facing * 5.6, 4, dt);
        this.hopT -= dt;
        if (this.hopT <= 0 && Math.abs(dx) < 7) { this.vy = rand(Math.random, 7, 11); this.hopT = rand(Math.random, 1.2, 2.6); }
      }
    } else this.vx = damp(this.vx, 0, 5, dt);
    this.vy -= GRAV * dt; this.x += this.vx * dt; this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0) this.vy = 0;
    const s = this.t * 22;
    this.legs.forEach((l, i) => { l.rotation.z = Math.sin(s + i * 2.1) * 0.5; });
    this.bodyMesh.position.y = 0.55 + Math.abs(Math.sin(s)) * 0.04;
    this.baseUpdate(dt);
  }
}

/** Stilt-legged stalker with a bone scythe. */
class Stalker extends Enemy {
  constructor(game, x) {
    super(game, x);
    this.hp = 3; this.knock = 4; this.knockUp = 0; this.contact = 1; this.score = 300;
    this.state = 'walk'; this.stateT = 0;
    const hide = this.m('#2e2b3c', { roughness: 0.8 }), bone = this.m('#e6dac0', { roughness: 0.5 }), dark = this.m('#1a1622');
    this.hips = new THREE.Group(); this.hips.position.y = 2.25; this.model.add(this.hips);
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group(); hip.position.z = side * 0.22; this.hips.add(hip);
      limbBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.45, -1.05, 0), 0.11, hide, hip);
      const knee = new THREE.Group(); knee.position.set(0.45, -1.05, 0); hip.add(knee);
      limbBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.38, -1.12, 0), 0.07, dark, knee);
      mesh(new THREE.ConeGeometry(0.12, 0.35, 6), bone, knee, -0.32, -1.18, 0).rotation.z = 1.4;
      return { hip, knee };
    });
    const torso = new THREE.Group(); torso.position.y = 0.2; this.hips.add(torso); this.torso = torso;
    const tb = mesh(new THREE.CapsuleGeometry(0.34, 0.7, 4, 10), hide, torso, 0.15, 0.4, 0); tb.rotation.z = -0.7;
    for (let i = 0; i < 5; i++) mesh(new THREE.ConeGeometry(0.07, 0.4, 5), bone, torso, -0.1 + i * 0.12, 0.75 + i * 0.05, 0).rotation.z = 0.5;
    const head = new THREE.Group(); head.position.set(0.65, 0.95, 0); torso.add(head);
    mesh(new THREE.SphereGeometry(0.26, 12, 10), bone, head).scale.set(1.3, 0.9, 0.8);
    mesh(new THREE.ConeGeometry(0.12, 0.5, 6), bone, head, 0.35, -0.08, 0).rotation.z = -1.7;
    const eye = glowMat(2.4, 3.2, 0.6);
    for (const z of [-0.1, 0.1]) mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), eye, head, 0.27, 0.05, z);
    this.shoulder = new THREE.Group(); this.shoulder.position.set(0.45, 0.75, 0.32); torso.add(this.shoulder);
    limbBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.85, 0), 0.07, hide, this.shoulder);
    const fore = new THREE.Group(); fore.position.y = -0.85; this.shoulder.add(fore); this.fore = fore;
    limbBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, -0.75, 0), 0.06, dark, fore);
    const blade = mesh(new THREE.ConeGeometry(0.1, 1.5, 4), bone, fore, 0.65, -0.95, 0);
    blade.rotation.z = -2.1; blade.scale.set(1, 1, 0.3);
    this.trail = halo(fore, new THREE.Color(1.5, 1.5, 1.1), 1.6, -1); this.trail.position.x = 0.6; this.trail.material.opacity = 0;
  }
  hurtBox() { return this.dying ? null : { x0: this.x - 0.6, x1: this.x + 0.8, y0: 0.4, y1: 3.4 }; }
  attackBox() {
    if (this.state !== 'strike' || this.dying) return null;
    const x0 = this.x + this.facing * 0.3, x1 = this.x + this.facing * 2.6;
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: 0.2, y1: 2.6 };
  }
  hit(dmg, dir) { if (this.state === 'windup' && this.hp > dmg) { this.state = 'recover'; this.stateT = 0; } return super.hit(dmg, dir); }
  update(dt, player) {
    this.stateT += dt;
    const dx = player.x - this.x;
    let walk = 0;
    if (!this.dying) {
      if (this.state === 'walk') {
        if (Math.abs(dx) > 0.3) this.facing = Math.sign(dx);
        walk = 1;
        this.vx = damp(this.vx, this.facing * 2.7, 3, dt);
        if (Math.abs(dx) < 2.5 && !player.dead) { this.state = 'windup'; this.stateT = 0; this.game.sfx('windup'); }
      } else {
        this.vx = damp(this.vx, 0, 6, dt);
        if (this.state === 'windup' && this.stateT > 0.5) { this.state = 'strike'; this.stateT = 0; this.game.sfx('slash'); }
        else if (this.state === 'strike' && this.stateT > 0.2) { this.state = 'recover'; this.stateT = 0; }
        else if (this.state === 'recover' && this.stateT > 0.75) { this.state = 'walk'; this.stateT = 0; }
      }
    } else this.vx = damp(this.vx, 0, 5, dt);
    this.x += this.vx * dt;
    const s = this.t * 5.2;
    this.legs.forEach((l, i) => {
      const ph = s + i * Math.PI;
      l.hip.rotation.z = Math.sin(ph) * 0.45 * walk;
      l.knee.rotation.z = (Math.max(0, Math.cos(ph)) * 0.6) * walk;
    });
    this.hips.position.y = 2.25 - Math.abs(Math.cos(s)) * 0.12 * walk;
    let sh = -0.3 + Math.sin(s) * 0.2 * walk, fo = 0.4, lean = 0;
    if (this.state === 'windup') { const k = clamp(this.stateT / 0.5, 0, 1); sh = -2.7 * k; fo = 1.2 * k; lean = -0.25 * k; }
    if (this.state === 'strike') { const k = clamp(this.stateT / 0.12, 0, 1); sh = -2.7 + 4.1 * k; fo = 1.2 - 1.1 * k; lean = 0.35; }
    if (this.state === 'recover') { const k = clamp(this.stateT / 0.75, 0, 1); sh = 1.4 - 1.7 * k; fo = 0.1 + 0.3 * k; lean = 0.35 * (1 - k); }
    this.shoulder.rotation.z = damp(this.shoulder.rotation.z, sh, 30, dt);
    this.fore.rotation.z = damp(this.fore.rotation.z, fo, 30, dt);
    this.torso.rotation.z = damp(this.torso.rotation.z, -lean, 12, dt);
    this.trail.material.opacity = this.state === 'strike' ? 0.9 : 0;
    this.baseUpdate(dt);
  }
}

/** Floating wisp: hovers, then dives in an arc. */
class Wisp extends Enemy {
  constructor(game, x) {
    super(game, x, 4);
    this.hp = 1; this.knock = 6; this.knockUp = 0; this.contact = 1; this.score = 150;
    this.state = 'hover'; this.stateT = rand(Math.random, 0.5, 1.5); this.baseY = rand(Math.random, 3.6, 4.6);
    const shellMat = this.m('#5fd7e8', { transparent: true, opacity: 0.45, roughness: 0.1 });
    mesh(new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), shellMat, this.model).scale.set(1, 0.9, 1);
    mesh(new THREE.SphereGeometry(0.2, 12, 10), glowMat(0.6, 2.8, 3.2), this.model, 0, 0.05, 0);
    this.glow = halo(this.model, new THREE.Color(0.3, 1.2, 1.4), 2.4, 0.05);
    this.tendrils = [];
    const tm = this.m('#3aa7bd', { transparent: true, opacity: 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const g = new THREE.Group(); g.position.set(Math.cos(a) * 0.25, -0.1, Math.sin(a) * 0.25);
      const segs = [];
      let parent = g;
      for (let k = 0; k < 3; k++) {
        const sg = new THREE.Group(); sg.position.y = k ? -0.28 : 0; parent.add(sg);
        mesh(new THREE.CylinderGeometry(0.035 - k * 0.008, 0.025 - k * 0.006, 0.3, 4), tm, sg, 0, -0.14, 0);
        segs.push(sg); parent = sg;
      }
      this.model.add(g); this.tendrils.push(segs);
    }
  }
  hurtBox() { return this.dying ? null : { x0: this.x - 0.55, x1: this.x + 0.55, y0: this.y - 0.6, y1: this.y + 0.5 }; }
  update(dt, player) {
    this.stateT -= dt;
    const dx = player.x - this.x;
    if (!this.dying) {
      this.facing = Math.sign(dx) || 1;
      if (this.state === 'hover') {
        const want = player.x - this.facing * 5.5;
        this.vx = damp(this.vx, clamp(want - this.x, -6, 6), 2, dt);
        this.y = damp(this.y, this.baseY + Math.sin(this.t * 2) * 0.4, 3, dt);
        if (this.stateT <= 0 && Math.abs(dx) < 8) {
          this.state = 'dive'; this.stateT = 1.1; this.diveFrom = { x: this.x, y: this.y }; this.diveTo = player.x + this.facing * 4; this.game.sfx('wisp');
        }
      } else if (this.state === 'dive') {
        const k = 1 - this.stateT / 1.1;
        this.x = this.diveFrom.x + (this.diveTo - this.diveFrom.x) * k;
        this.y = this.diveFrom.y - Math.sin(k * Math.PI) * (this.diveFrom.y - 0.9);
        this.vx = 0;
        if (this.stateT <= 0) { this.state = 'hover'; this.stateT = rand(Math.random, 1.4, 2.6); }
      }
    } else { this.y -= dt * 3; }
    this.x += this.vx * dt;
    this.glow.material.opacity = 0.7 + Math.sin(this.t * 6) * 0.3;
    this.tendrils.forEach((segs, i) => segs.forEach((s, k) => { s.rotation.z = Math.sin(this.t * 4 + i + k * 0.8) * 0.35 + (this.state === 'dive' ? -this.facing * 0.4 : 0); }));
    this.baseUpdate(dt);
  }
}

/** Arcing thorn seed fired by the Titan. */
class Seed extends Enemy {
  constructor(game, x, y, tx, ty) {
    super(game, x, y);
    this.hp = 1; this.knock = 0; this.contact = 1; this.score = 50;
    const T = 1.15;
    this.vx = (tx - x) / T; this.vy = (ty - y + 0.5 * GRAV * 0.5 * T * T) / T;
    const mt = this.m('#6b3b1f');
    const core = mesh(new THREE.IcosahedronGeometry(0.32, 0), mt, this.model);
    for (let i = 0; i < 8; i++) {
      const c = mesh(new THREE.ConeGeometry(0.06, 0.4, 4), this.m('#e0b070'), core);
      c.position.set(Math.cos(i) * 0.3, Math.sin(i * 1.7) * 0.3, Math.sin(i) * 0.3);
      c.lookAt(c.position.clone().multiplyScalar(3)); c.rotateX(Math.PI / 2);
    }
    this.core = core;
    halo(this.model, new THREE.Color(1.6, 0.6, 0.15), 1.6);
  }
  hurtBox() { return this.dying ? null : { x0: this.x - 0.45, x1: this.x + 0.45, y0: this.y - 0.45, y1: this.y + 0.45 }; }
  hit() { this.dying = 0.3; this.game.burst(this.x, this.y, 0, 14, new THREE.Color(1.6, 0.7, 0.2)); this.game.addScore(this.score); this.remove(); return true; }
  update(dt) {
    this.vy -= GRAV * 0.5 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
    this.core.rotation.x += dt * 8; this.core.rotation.z += dt * 5;
    if (this.y < 0.2) { this.game.burst(this.x, 0.2, 0, 18, new THREE.Color(1.6, 0.6, 0.2)); this.game.sfx('thud'); this.remove(); return; }
    this.root.position.set(this.x, this.y, 0);
  }
}

/** Ground shockwave from the Titan's slam: jump over it. */
class Shockwave extends Enemy {
  constructor(game, x, dir) {
    super(game, x);
    this.dir = dir; this.contact = 2; this.hp = 99; this.life = 2.2;
    const g = new THREE.CylinderGeometry(1, 1, 1.1, 24, 1, true, -0.9, 1.8);
    const mt = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    this.wave = new THREE.Mesh(g, mt);
    this.wave.position.y = 0.55;
    this.wave.rotation.y = dir < 0 ? Math.PI : 0;
    this.wave.scale.set(0.6, 1, 1.4);
    this.model.add(this.wave);
  }
  hurtBox() { return null; }
  hit() { return false; }
  attackBox() { return { x0: this.x - 0.45, x1: this.x + 0.45, y0: 0, y1: 0.95 }; }
  update(dt) {
    this.life -= dt; this.x += this.dir * 13 * dt;
    this.wave.material.opacity = Math.min(0.85, this.life);
    if (Math.random() < 0.6) this.game.dust(this.x, 0.1, 1);
    if (this.life <= 0) this.remove();
    this.root.position.set(this.x, 0, 0);
  }
}

/** The Bramble Titan: end-of-journey guardian. */
export class Titan extends Enemy {
  constructor(game, x) {
    super(game, x);
    this.maxHp = this.hp = 26; this.knock = 0; this.contact = 1; this.score = 5000;
    this.state = 'dormant'; this.stateT = 0; this.cycle = 0; this.facing = -1;
    const bark = this.m('#4a3527', { roughness: 0.95, flatShading: true }), thorn = this.m('#c9a26e'), moss = this.m('#4e5d2c', { flatShading: true });
    // root legs
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      limbBetween(new THREE.Vector3(0, 2.6, 0), new THREE.Vector3(Math.cos(a) * 2.6, 0, Math.sin(a) * 1.6), 0.45, bark, this.model);
    }
    // gnarled torso
    const tg = new THREE.IcosahedronGeometry(2.4, 2);
    const p = tg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.8 + noise2(x * 0.9 + z * 0.7, y * 0.9) * 0.45;
      p.setXYZ(i, x * k, y * k * 1.25, z * k * 0.85);
    }
    tg.computeVertexNormals();
    this.torso = mesh(tg, bark, this.model, 0, 4.7, 0);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI;
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b) * 0.8);
      const c = mesh(new THREE.ConeGeometry(0.16, rand(Math.random, 0.6, 1.4), 5), thorn, this.torso);
      c.position.copy(dir).multiplyScalar(2.2);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
    mesh(new THREE.IcosahedronGeometry(1.4, 1), moss, this.torso, -0.6, 1.8, 0).scale.set(1.4, 0.5, 1);
    // glowing heart (weak point)
    this.coreMat = glowMat(3, 0.9, 0.25);
    this.core = mesh(new THREE.IcosahedronGeometry(0.6, 1), this.coreMat, this.torso, 1.9, 0.2, 0);
    this.coreGlow = halo(this.torso, new THREE.Color(1.6, 0.5, 0.15), 4.5, 0.2); this.coreGlow.position.x = 2.0;
    // antlered head
    const head = (this.head = new THREE.Group()); head.position.set(1.4, 7.4, 0); this.model.add(head);
    mesh(new THREE.IcosahedronGeometry(0.9, 1), bark, head).scale.set(1.3, 1, 0.9);
    for (const z of [-0.35, 0.35]) mesh(new THREE.SphereGeometry(0.13, 8, 6), glowMat(4, 1.4, 0.3), head, 0.95, 0.15, z);
    for (const side of [-1, 1]) {
      let a = new THREE.Vector3(-0.2, 0.6, side * 0.5);
      let d = new THREE.Vector3(-0.3, 1, side * 0.5).normalize();
      for (let k = 0; k < 4; k++) {
        const b = a.clone().addScaledVector(d, 1.1 - k * 0.15);
        limbBetween(a, b, 0.14 - k * 0.025, bark, head);
        if (k === 1) limbBetween(b, b.clone().add(new THREE.Vector3(0.6, 0.5, side * 0.3)), 0.07, bark, head);
        d.x -= 0.25; d.normalize(); a = b;
      }
    }
    // arms
    this.arms = [-1, 1].map((side) => {
      const sh = new THREE.Group(); sh.position.set(0.4, 6.0, side * 2.0); this.model.add(sh);
      limbBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, -2.2, side * 0.3), 0.42, bark, sh);
      const el = new THREE.Group(); el.position.set(0.5, -2.2, side * 0.3); sh.add(el);
      limbBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.2, -2.0, 0), 0.35, bark, el);
      for (let k = 0; k < 3; k++) {
        const c = mesh(new THREE.ConeGeometry(0.16, 1.0, 5), thorn, el, 1.3 + k * 0.1, -2.3, (k - 1) * 0.3);
        c.rotation.z = Math.PI - 0.3;
      }
      return { sh, el };
    });
    this.baseUpdate(0);
  }
  hurtBox() { return this.dying || this.state === 'dormant' ? null : { x0: this.x - 2.6, x1: this.x + 2.4, y0: 0, y1: 8.5 }; }
  hit(dmg) {
    if (this.state === 'dormant') return false;
    this.hp -= dmg; this.flash = 0.12;
    this.game.burst(this.x - 2.2, 4.5, 1.5, 10, new THREE.Color(1.4, 0.8, 0.3));
    if (this.hp <= 0) { this.dying = 0.001; this.game.onEnemyKilled(this); }
    return true;
  }
  wake() { if (this.state === 'dormant') { this.state = 'idle'; this.stateT = 0; this.game.sfx('roar'); this.game.shake(0.8); } }
  update(dt, player) {
    this.t += dt; this.stateT += dt;
    if (this.flash > 0) this.flash -= dt;
    for (const mt of this.mats) mt.emissive.setRGB(this.flash > 0 ? 0.8 : 0, this.flash > 0 ? 0.5 : 0, this.flash > 0 ? 0.3 : 0);
    const enraged = this.hp < this.maxHp * 0.5;
    const speed = enraged ? 1.45 : 1;
    let shL = 0.2, shR = 0.2, elL = 0.3, elR = 0.3, lean = 0;
    const breath = Math.sin(this.t * 1.5);
    if (this.dying > 0) {
      this.dying += dt;
      const k = clamp(this.dying / 2.4, 0, 1);
      this.model.rotation.z = k * k * 1.2;
      this.model.position.y = -k * k * 3;
      if (Math.random() < 0.5) this.game.burst(this.x + rand(Math.random, -2, 2), rand(Math.random, 1, 7), 1, 4, new THREE.Color(1.6, 0.6, 0.2));
      if (k >= 1) this.remove();
    } else if (this.state === 'dormant') {
      lean = 0.25; shL = shR = 0.5;
    } else if (this.state === 'idle') {
      if (this.stateT > 1.4 / speed) {
        this.state = ['seeds', 'slam', 'seeds', 'summon', 'slam'][this.cycle++ % 5]; this.stateT = 0; this.fired = 0;
      }
    } else if (this.state === 'seeds') {
      const k = this.stateT * speed;
      shR = -2.2 * Math.min(1, k * 2); elR = 0.8;
      const shots = enraged ? 5 : 3;
      if (k > 0.5 && this.fired < shots && k > 0.5 + this.fired * 0.28) {
        this.fired++;
        const tx = player.x + rand(Math.random, -2.5, 1.5);
        this.game.addEnemy(new Seed(this.game, this.x - 1.5, 8.2, tx, 0.6));
        this.game.sfx('spit');
      }
      if (k > 0.6 + shots * 0.28 + 0.4) { this.state = 'idle'; this.stateT = 0; }
    } else if (this.state === 'slam') {
      const k = this.stateT * speed;
      if (k < 0.8) { shL = shR = -2.6 * (k / 0.8); elL = elR = 1.0; lean = -0.15; }
      else if (k < 1.0) { shL = shR = 1.3; elL = elR = 0.1; lean = 0.3; }
      else { shL = shR = 1.1; elL = elR = 0.2; lean = 0.25; }
      if (k >= 0.92 && !this.fired) {
        this.fired = 1;
        this.game.addEnemy(new Shockwave(this.game, this.x - 3.2, -1));
        if (enraged) setTimeout(() => this.alive && this.game.addEnemy(new Shockwave(this.game, this.x - 3.2, -1)), 650);
        this.game.sfx('slam'); this.game.shake(0.6);
        this.game.dust(this.x - 3.5, 0.2, 30);
      }
      if (k > 1.7) { this.state = 'idle'; this.stateT = 0; }
    } else if (this.state === 'summon') {
      const k = this.stateT * speed;
      lean = -0.3 * Math.min(1, k); shL = shR = -1.2; elL = elR = 1.4;
      if (k > 0.7 && !this.fired) {
        this.fired = 1; this.game.sfx('roar');
        this.game.spawn('skitter', player.x - 14);
        this.game.spawn(enraged ? 'wisp' : 'skitter', this.x - 4);
      }
      if (k > 1.6) { this.state = 'idle'; this.stateT = 0; }
    }
    const [L, R] = this.arms;
    const d = (o, v) => { o.rotation.z = damp(o.rotation.z, v, 9, dt); };
    d(L.sh, shL + breath * 0.05); d(R.sh, shR - breath * 0.05); d(L.el, elL); d(R.el, elR);
    this.model.rotation.z = this.dying ? this.model.rotation.z : damp(this.model.rotation.z, -lean, 6, dt);
    this.torso.scale.setScalar(1 + breath * 0.02);
    this.coreMat.color.setRGB(3 + Math.sin(this.t * (enraged ? 10 : 4)) * 1.2, 0.9, 0.25);
    this.head.rotation.z = Math.sin(this.t * 0.7) * 0.08;
    this.root.position.set(this.x, 0, 0);
    this.root.rotation.y = Math.PI + 0.3;
  }
}

/** Health relic: glowing ember heart. */
export class Relic {
  constructor(scene, x, y = 1.2) {
    this.x = x; this.y = y; this.t = Math.random() * 6; this.alive = true; this.scene = scene;
    this.root = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: '#ff5a3c', emissive: new THREE.Color('#ff3020'), emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3 }));
    gem.scale.set(1, 1.35, 1);
    this.gem = gem; this.root.add(gem);
    halo(this.root, new THREE.Color(1.5, 0.35, 0.2), 2.2);
    this.root.position.set(x, y, 0);
    scene.add(this.root);
  }
  update(dt) { this.t += dt; this.gem.rotation.y += dt * 2; this.root.position.y = this.y + Math.sin(this.t * 2.5) * 0.18; }
  box() { return { x0: this.x - 0.5, x1: this.x + 0.5, y0: this.y - 1.2, y1: this.y + 0.8 }; }
  remove() { this.alive = false; this.scene.remove(this.root); }
}

export const ENEMY_TYPES = { skitter: Skitter, stalker: Stalker, wisp: Wisp };
