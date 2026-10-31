import * as THREE from 'three';
import { damp, clamp, lerp } from './util.js';

const RUN = 8.5, ACCEL = 60, GRAV = 44, JUMP = 15.5;
export const ATTACK_TIME = 0.34;

function capsule(r, len, mat, hang = true) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  if (hang) g.translate(0, -len / 2 - r * 0.4, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    const M = {
      cloth: new THREE.MeshStandardMaterial({ color: '#2a2342', roughness: 0.85 }),
      cloak: new THREE.MeshStandardMaterial({ color: '#3a2d55', roughness: 0.9, side: THREE.DoubleSide }),
      leather: new THREE.MeshStandardMaterial({ color: '#5c3a26', roughness: 0.7 }),
      bronze: new THREE.MeshStandardMaterial({ color: '#b98142', roughness: 0.35, metalness: 0.85, emissive: new THREE.Color('#ff7a2a'), emissiveIntensity: 0 }),
      face: new THREE.MeshStandardMaterial({ color: '#0c0810', roughness: 1 }),
      eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 0.8), toneMapped: false }),
      scarf: new THREE.MeshStandardMaterial({ color: '#b02a2a', roughness: 0.8, side: THREE.DoubleSide }),
    };
    this.M = M;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    scene.add(this.root);

    const pelvis = (this.pelvis = new THREE.Group());
    pelvis.position.y = 1.02;
    this.body.add(pelvis);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.16, 12), M.leather);
    belt.castShadow = true;
    pelvis.add(belt);

    const spine = (this.spine = new THREE.Group());
    spine.position.y = 0.06;
    pelvis.add(spine);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.42, 4, 12), M.cloth);
    torso.position.y = 0.36; torso.scale.set(1.1, 1, 0.8); torso.castShadow = true;
    spine.add(torso);
    const plate = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.bronze);
    plate.position.set(0, 0.5, 0.06); plate.scale.set(1.15, 0.8, 0.85); plate.rotation.x = 0.25;
    spine.add(plate);
    for (const sx of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.bronze);
      pad.position.set(sx * 0.3, 0.67, 0); pad.scale.set(1.2, 0.9, 1.1); pad.castShadow = true;
      spine.add(pad);
    }

    // hooded head with glowing eyes
    const head = (this.head = new THREE.Group());
    head.position.y = 0.84;
    spine.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), M.cloak);
    hood.scale.set(1, 1.08, 1.12); hood.position.z = -0.02; hood.castShadow = true;
    head.add(hood);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 10), M.cloak);
    tip.position.set(0, 0.12, -0.2); tip.rotation.x = -1.9;
    head.add(tip);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), M.face);
    face.position.set(0, -0.02, 0.12); face.scale.set(1, 1.05, 0.7);
    head.add(face);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), M.eye);
      e.position.set(sx * 0.065, 0.0, 0.235); e.scale.set(1.4, 0.7, 0.5);
      head.add(e);
    }
    this.neckAnchor = new THREE.Object3D();
    this.neckAnchor.position.set(0, 0.72, -0.18);
    spine.add(this.neckAnchor);

    // cloak (hangs from shoulders, flutters with speed)
    this.cloak = new THREE.Group();
    this.cloak.position.set(0, 0.7, -0.2);
    spine.add(this.cloak);
    const cg = new THREE.PlaneGeometry(0.62, 1.15, 1, 4);
    cg.translate(0, -0.575, 0);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setX(i, cp.getX(i) * (1 + (-cp.getY(i)) * 0.45));
    cg.computeVertexNormals();
    const cloakMesh = new THREE.Mesh(cg, M.cloak);
    cloakMesh.castShadow = true;
    this.cloak.add(cloakMesh);

    // arms
    this.arms = [-1, 1].map((sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * 0.34, 0.62, 0);
      spine.add(sh);
      sh.add(capsule(0.075, 0.26, M.cloth));
      const el = new THREE.Group();
      el.position.y = -0.36;
      sh.add(el);
      el.add(capsule(0.07, 0.24, M.leather));
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.bronze);
      fist.position.y = -0.38; fist.castShadow = true;
      el.add(fist);
      return { sh, el, fist };
    });
    // legs
    this.legs = [-1, 1].map((sx) => {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.14, -0.04, 0);
      pelvis.add(hip);
      hip.add(capsule(0.1, 0.32, M.cloth));
      const knee = new THREE.Group();
      knee.position.y = -0.47;
      hip.add(knee);
      knee.add(capsule(0.085, 0.3, M.leather));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.3), M.leather);
      foot.position.set(0, -0.48, 0.06); foot.castShadow = true;
      knee.add(foot);
      return { hip, knee };
    });

    // scarf: verlet ribbon
    this.scarfN = 8;
    this.scarfPts = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    this.scarfPrev = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.scarfN * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < this.scarfN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    sg.setIndex(idx);
    this.scarf = new THREE.Mesh(sg, M.scarf);
    this.scarf.frustumCulled = false;
    this.scarf.castShadow = true;
    scene.add(this.scarf);

    this.reset();
  }

  reset(x = 4) {
    this.x = x; this.y = 0; this.vx = 0; this.vy = 0;
    this.facing = 1; this.hp = 10; this.maxHp = 10;
    this.invuln = 0; this.hurtT = 0; this.attackT = -1; this.attackSide = 0; this.combo = 0;
    this.crouch = false; this.onGround = true; this.dead = false; this.deadT = 0;
    this.phase = 0; this.hitThisSwing = new Set();
    this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0);
    this.root.visible = this.scarf.visible = true;
    const a = new THREE.Vector3(x, 1.8, -0.2);
    for (let i = 0; i < this.scarfN; i++) { this.scarfPts[i].copy(a).add(new THREE.Vector3(-i * 0.15, 0, 0)); this.scarfPrev[i].copy(this.scarfPts[i]); }
  }

  get attacking() { return this.attackT >= 0; }

  /** Active strike hitbox, or null. */
  attackBox() {
    if (!this.attacking) return null;
    const p = this.attackT / ATTACK_TIME;
    if (p < 0.2 || p > 0.55) return null;
    const x0 = this.x + this.facing * 0.2, x1 = this.x + this.facing * 1.9;
    const y0 = this.crouch ? 0 : this.y + 0.6, y1 = this.crouch ? 1.1 : this.y + 2.0;
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1 };
  }

  hurtBox() {
    const h = this.crouch ? 1.15 : 1.9;
    return { x0: this.x - 0.32, x1: this.x + 0.32, y0: this.y, y1: this.y + h };
  }

  damage(n, fromX) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - n);
    this.invuln = 1.3;
    this.hurtT = 0.32;
    this.attackT = -1;
    const dir = Math.sign(this.x - fromX) || -this.facing;
    this.vx = dir * 9; this.vy = 7; this.onGround = false;
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; }
    return true;
  }

  update(dt, input, minX, maxX, events) {
    if (this.dead) {
      this.deadT += dt;
      this.vx = damp(this.vx, 0, 4, dt);
    } else if (this.hurtT > 0) {
      this.hurtT -= dt;
    } else {
      this.crouch = input.down && this.onGround;
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (dir !== 0 && !(this.attacking && this.onGround)) this.facing = dir;
      let target = this.crouch ? 0 : dir * RUN;
      if (this.attacking && this.onGround) target *= 0.15;
      const a = this.onGround ? ACCEL : ACCEL * 0.5;
      this.vx += clamp(target - this.vx, -a * dt, a * dt);
      if (input.jump && this.onGround && !this.crouch) {
        this.vy = JUMP; this.onGround = false; events.push('jump');
      }
      if (input.attack && !this.attacking) {
        this.attackT = 0; this.attackSide ^= 1; this.hitThisSwing.clear(); events.push('swing');
      }
    }
    if (this.attacking) { this.attackT += dt; if (this.attackT > ATTACK_TIME) this.attackT = -1; }
    if (this.invuln > 0) this.invuln -= dt;

    this.vy -= GRAV * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) { if (!this.onGround && this.vy < -8) events.push('land'); this.y = 0; this.vy = 0; this.onGround = true; }
    this.x = clamp(this.x, minX, maxX);

    this.animate(dt);
  }

  animate(dt) {
    const L = this.legs, A = this.arms;
    const speed = Math.abs(this.vx);
    const run = this.onGround ? clamp(speed / RUN, 0, 1) : 0;
    this.phase += dt * (3 + speed * 1.15);
    const ph = this.phase;
    const k = 18;
    const set = (obj, prop, v) => { obj.rotation[prop] = damp(obj.rotation[prop], v, k, dt); };

    let pelvisY = 1.02, lean = 0.05 + run * 0.18, twist = 0;
    let legT = [0, 0], kneeT = [0.08, 0.08], shT = [0.1, 0.1], elT = [-0.25, -0.25], shZ = [0, 0];
    const breathe = Math.sin(ph * 0.5) * 0.02;

    if (run > 0.05) {
      for (let i = 0; i < 2; i++) {
        const s = Math.sin(ph + i * Math.PI), c = Math.cos(ph + i * Math.PI);
        legT[i] = -0.8 * s * run;
        kneeT[i] = 0.15 + Math.max(0, c) * 1.25 * run;
        shT[i] = 0.7 * s * run;
        elT[i] = -0.35 - Math.max(0, -s) * 0.55 * run;
      }
      pelvisY -= Math.abs(Math.cos(ph)) * 0.07 * run;
    } else {
      pelvisY += breathe;
    }
    if (!this.onGround && !this.dead) {
      const up = clamp(this.vy / JUMP, -1, 1);
      legT = [-0.9, -0.15]; kneeT = [1.3, 0.5 - up * 0.3];
      shT = [-0.6 - up * 0.4, 0.4]; elT = [-1.0, -0.6]; shZ = [-0.35, 0.35];
      lean = 0.2;
    }
    if (this.crouch) {
      pelvisY = 0.6; legT = [-1.25, -1.0]; kneeT = [2.2, 2.0]; lean = 0.45;
      shT = [-0.5, -0.3]; elT = [-1.3, -1.1];
    }
    if (this.attacking) {
      const p = this.attackT / ATTACK_TIME;
      const ext = p < 0.2 ? -p / 0.2 * 0.25 : p < 0.45 ? (p - 0.2) / 0.25 : Math.max(0, 1 - (p - 0.45) / 0.55);
      const i = this.attackSide, o = 1 - i;
      shT[i] = lerp(-0.3, -1.6, ext); elT[i] = lerp(-1.9, -0.05, ext); shZ[i] = 0;
      shT[o] = -0.6; elT[o] = -1.7;
      twist = (i === 1 ? -1 : 1) * 0.45 * ext;
      lean += 0.18 * ext;
      if (this.onGround && !this.crouch && run < 0.3) { legT = [-0.45, 0.35]; kneeT = [0.5, 0.25]; pelvisY = 0.94; }
      this.M.bronze.emissiveIntensity = ext > 0.5 ? 1.6 * ext : 0;
    } else this.M.bronze.emissiveIntensity = damp(this.M.bronze.emissiveIntensity, 0, 10, dt);
    if (this.hurtT > 0) { lean = -0.45; shT = [0.6, 0.6]; elT = [-0.4, -0.4]; shZ = [-0.6, 0.6]; }

    for (let i = 0; i < 2; i++) {
      set(L[i].hip, 'x', legT[i]); set(L[i].knee, 'x', kneeT[i]);
      set(A[i].sh, 'x', shT[i]); set(A[i].el, 'x', elT[i]); set(A[i].sh, 'z', shZ[i] * (i === 0 ? 1 : -1) + (i === 0 ? 0.08 : -0.08));
    }
    set(this.spine, 'x', lean); set(this.spine, 'y', twist);
    set(this.head, 'x', -lean * 0.6);
    this.pelvis.position.y = damp(this.pelvis.position.y, pelvisY, 20, dt);
    set(this.cloak, 'x', -0.12 - clamp(speed / RUN, 0, 1) * 0.75 - (this.onGround ? 0 : clamp(-this.vy * 0.04, -0.5, 0.7)) + Math.sin(ph * 2) * 0.05 * run);

    // death: topple backward
    if (this.dead) {
      const t = clamp(this.deadT / 0.6, 0, 1);
      this.body.rotation.x = -t * t * Math.PI / 2;
      this.body.position.y = t * 0.25;
    }

    // root placement & facing (3/4 turn toward camera)
    this.root.position.set(this.x, this.y, 0);
    const targetYaw = this.facing > 0 ? Math.PI / 2 - 0.42 : -Math.PI / 2 + 0.42;
    let dy = targetYaw - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * (1 - Math.exp(-16 * dt));

    const blink = this.invuln > 0 && !this.dead && Math.floor(this.invuln * 14) % 2 === 0;
    this.root.visible = !blink;

    this.updateScarf(dt);
  }

  updateScarf(dt) {
    const P = this.scarfPts, Q = this.scarfPrev, n = this.scarfN;
    this.root.updateMatrixWorld(true);
    this.neckAnchor.getWorldPosition(P[0]);
    Q[0].copy(P[0]);
    const step = Math.min(dt, 1 / 30);
    const wind = -this.vx * 0.6 - 2.5;
    for (let i = 1; i < n; i++) {
      const p = P[i], q = Q[i];
      const vx = (p.x - q.x) * 0.96, vy = (p.y - q.y) * 0.96, vz = (p.z - q.z) * 0.96;
      q.copy(p);
      p.x += vx + wind * step * step * 6;
      p.y += vy - 9 * step * step + Math.sin(this.phase * 1.7 + i) * 0.004;
      p.z += vz + Math.sin(this.phase + i * 0.7) * 0.002;
      if (p.y < 0.05) p.y = 0.05;
    }
    const seg = 0.16;
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        const a = P[i - 1], b = P[i];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-5;
        const f = (d - seg) / d;
        if (i === 1) { b.x -= dx * f; b.y -= dy * f; b.z -= dz * f; }
        else { b.x -= dx * f * 0.5; b.y -= dy * f * 0.5; b.z -= dz * f * 0.5; a.x += dx * f * 0.5; a.y += dy * f * 0.5; a.z += dz * f * 0.5; }
      }
    }
    const arr = this.scarf.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const w = 0.075 * (1 - i / n * 0.5);
      arr.set([P[i].x, P[i].y + w, P[i].z, P[i].x, P[i].y - w, P[i].z], i * 6);
    }
    this.scarf.geometry.attributes.position.needsUpdate = true;
    this.scarf.geometry.computeVertexNormals();
    this.scarf.visible = this.root.visible;
  }
}
