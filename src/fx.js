import * as THREE from 'three';

const dummy = new THREE.Object3D();
const black = new THREE.Color(0, 0, 0);

/** Fixed-size ring buffer of instanced particles with simple ballistic motion. */
class Pool {
  constructor(scene, geo, mat, max) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.r = new Float32Array(max * 3);
    this.w = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.size = new Float32Array(max);
    this.g = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    this.alive = 0;
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, dummy.matrix); this.mesh.setColorAt(i, black); }
    scene.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, ttl, size, color, g, drag) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.w.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
    this.life[i] = this.ttl[i] = ttl;
    this.size[i] = size;
    this.g[i] = g;
    this.drag[i] = drag;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (this.alive <= 0) return;
    const { p, v, r, w, life, ttl, size, g, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const k = i * 3;
      if (life[i] <= 0) {
        this.alive--;
        dummy.scale.setScalar(0);
      } else {
        const d = Math.max(0, 1 - drag[i] * dt);
        v[k + 1] -= g[i] * dt;
        v[k] *= d; v[k + 1] *= d; v[k + 2] *= d;
        p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
        if (p[k + 1] < 0.04 && g[i] > 0) { p[k + 1] = 0.04; v[k + 1] *= -0.3; v[k] *= 0.5; v[k + 2] *= 0.5; w[k] *= 0.5; }
        r[k] += w[k] * dt; r[k + 1] += w[k + 1] * dt; r[k + 2] += w[k + 2] * dt;
        const t = life[i] / ttl[i];
        dummy.position.set(p[k], p[k + 1], p[k + 2]);
        dummy.rotation.set(r[k], r[k + 1], r[k + 2]);
        dummy.scale.setScalar(size[i] * Math.min(1, t * 3));
      }
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alive = 0;
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    // lit chunks (bark, stone, thorns)
    this.debris = new Pool(scene, new THREE.TetrahedronGeometry(1), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), 500);
    // unlit glowing embers; HDR instance colours feed the bloom pass
    this.sparks = new Pool(scene, new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ toneMapped: false }), 700);
    this.sparks.mesh.renderOrder = 2;

    this.rings = [];
    const rg = new THREE.RingGeometry(0.82, 1, 48);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.userData = { t: 0, ttl: 1, size: 1, op: 1 };
      scene.add(m);
      this.rings.push(m);
    }
    this.ringNext = 0;
  }

  /**
   * Spray particles from a point.
   * kind 'debris' = lit chunks that fall and bounce; 'spark' = glowing embers.
   */
  burst(x, y, z, { n = 12, color = new THREE.Color(1, 1, 1), speed = 4, size = 0.1, ttl = 0.8, g = 18, up = 2, kind = 'debris', drag = 0.6, dir = 0, spread = 1, zSpread = 1 } = {}) {
    const pool = kind === 'spark' ? this.sparks : this.debris;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      let vx = Math.cos(a) * s * spread, vy = Math.sin(a) * s + up;
      if (dir) vx = Math.abs(vx) * dir + dir * speed * 0.3;
      const vz = (Math.random() - 0.5) * s * zSpread;
      pool.emit(x, y, z, vx, vy, vz, ttl * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, g, drag);
    }
  }

  /** Expanding ground shockwave ring. */
  ring(x, z, color, { size = 3, ttl = 0.5, y = 0.06, opacity = 0.9 } = {}) {
    const m = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % this.rings.length;
    m.position.set(x, y, z);
    m.material.color.copy(color);
    m.userData.t = 0; m.userData.ttl = ttl; m.userData.size = size; m.userData.op = opacity;
    m.visible = true;
  }

  update(dt) {
    this.debris.update(dt);
    this.sparks.update(dt);
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData;
      u.t += dt;
      const k = u.t / u.ttl;
      if (k >= 1) { m.visible = false; continue; }
      m.scale.setScalar(0.2 + u.size * (1 - (1 - k) * (1 - k)));
      m.material.opacity = u.op * (1 - k);
    }
  }

  clear() {
    this.debris.clear();
    this.sparks.clear();
    for (const m of this.rings) m.visible = false;
  }
}
