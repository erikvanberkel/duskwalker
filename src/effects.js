import * as THREE from 'three';

/** Pooled point particles with per-particle colour, alpha and size. */
export class Particles {
  constructor(scene, capacity = 1500, additive = true) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float alpha; attribute float size; attribute vec3 color; varying float vA; varying vec3 vC;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (420.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
          float s = 1.0 - r * 4.0; gl_FragColor = vec4(vC, vA * s * s); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, life, size, grav = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.alpha[i] = 1;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-2.2 * dt);
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) { this.pos[k + 1] = 0.02; this.vel[k + 1] *= -0.3; }
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
