import * as THREE from 'three';
import { mulberry32, rand, paint, merge, segment, addSway, noise2 } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const C = (h) => new THREE.Color(h);

// Colour styles per tree family (dusk-lit palette).
const STYLES = {
  giant:   { bark: C('#4a3b31'), moss: C('#56602c'), mossHeight: 9, leafDark: C('#1b2a1b'), leaf: C('#46692f'), leafLight: C('#d0c45e'), strand: C('#6b7a3a') },
  broad:   { bark: C('#4b3d34'), moss: C('#4f5a2d'), mossHeight: 3, leafDark: C('#22301c'), leaf: C('#5a7a33'), leafLight: C('#dcc462'), strand: C('#6b7a3a') },
  spire:   { bark: C('#3a2f2c'), leafDark: C('#0f2226'), leaf: C('#24474a'), leafLight: C('#7fa58e') },
  dead:    { bark: C('#7d7068'), moss: C('#50573a'), mossHeight: 2, leafDark: C('#000'), leaf: C('#000'), leafLight: C('#000') },
  lantern: { bark: C('#3d302d'), moss: C('#3e5a48'), mossHeight: 5, leafDark: C('#10262a'), leaf: C('#2d5b56'), leafLight: C('#86c0a2'), strand: C('#4f7a68'), fruit: C('#ffcf73') },
};
const VARIANTS = { giant: 4, broad: 4, spire: 3, dead: 3, lantern: 3 };
const SWAY = {
  giant:   { wood: [0.25, 34], leaves: [0.9, 34] },
  broad:   { wood: [0.15, 12], leaves: [0.45, 12] },
  spire:   { wood: [0.25, 20], leaves: [0.5, 20] },
  dead:    { wood: [0.25, 12], leaves: [0.3, 12] },
  lantern: { wood: [0.2, 16], leaves: [0.5, 16] },
};

function basis(dir) {
  const a = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, a).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  return [u, v];
}

class TreeBuilder {
  constructor(seed, style) {
    this.rng = mulberry32(seed);
    this.style = style;
    this.wood = []; this.leaves = []; this.glow = [];
  }

  bark(g) {
    const s = this.style;
    return paint(g, s.bark, (c, p) => {
      const n = noise2(p.x * 1.9 + p.z * 1.3, p.y * 0.45);
      const streak = noise2(p.x * 6 + p.z * 6, p.y * 0.15);
      c.multiplyScalar(0.62 + n * 0.55 + streak * 0.18);
      if (s.moss && p.y < s.mossHeight) {
        const m = noise2(p.x * 0.7 + 11, p.y * 0.9 + p.z * 0.7);
        if (m > 0.55) c.lerp(s.moss, Math.min(1, (m - 0.55) * 2.6) * (1 - p.y / s.mossHeight));
      }
    });
  }

  /** Grow a gnarled limb as a chain of tapered segments. */
  limb(start, dir, length, r0, r1, steps, gnarl, tropism) {
    const rng = this.rng;
    let p = start.clone();
    const d = dir.clone();
    for (let i = 0; i < steps; i++) {
      d.x += (rng() - 0.5) * gnarl;
      d.z += (rng() - 0.5) * gnarl * 0.7;
      d.y += (rng() - 0.5) * gnarl * 0.4 + tropism;
      d.normalize();
      const q = p.clone().addScaledVector(d, length / steps);
      const ra = r0 + (r1 - r0) * (i / steps);
      const rb = r0 + (r1 - r0) * ((i + 1) / steps);
      this.wood.push(this.bark(segment(p, q, ra, rb, ra > 0.6 ? 10 : ra > 0.2 ? 7 : 5)));
      if (rb > 0.22) {
        const j = new THREE.SphereGeometry(rb * 1.04, ra > 0.6 ? 9 : 6, 5);
        j.translate(q.x, q.y, q.z);
        this.wood.push(this.bark(j));
      }
      p = q;
    }
    return { end: p, dir: d };
  }

  /** Lumpy, faceted foliage mass. */
  clump(c, size, flat) {
    const rng = this.rng, s = this.style;
    const g = new THREE.IcosahedronGeometry(size, size > 2 ? 2 : 1);
    const pos = g.attributes.position;
    const seed = rng() * 100;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 0.72 + noise2(x * 0.8 + z * 0.6 + seed, y * 0.8 - seed) * 0.6;
      pos.setXYZ(i, x * k, y * k * flat, z * k);
    }
    g.computeVertexNormals();
    g.translate(c.x, c.y, c.z);
    const tint = rng() - 0.5;
    this.leaves.push(paint(g, s.leaf, (col, p) => {
      const local = THREE.MathUtils.clamp((p.y - c.y) / (size * flat), -1, 1);
      col.lerpColors(s.leafDark, s.leaf, local * 0.5 + 0.5);
      if (local > 0.35) col.lerp(s.leafLight, (local - 0.35) * 0.85);
      col.offsetHSL(tint * 0.05, 0, tint * 0.07);
    }));
  }

  /** Hanging moss / vine strand. */
  strand(p, len) {
    const rng = this.rng;
    let a = p.clone();
    const n = 3;
    for (let i = 0; i < n; i++) {
      const b = a.clone().add(new THREE.Vector3((rng() - 0.5) * 0.3, -len / n, (rng() - 0.5) * 0.3));
      this.leaves.push(paint(segment(a, b, 0.09 - i * 0.02, 0.07 - i * 0.02, 4), this.style.strand));
      a = b;
    }
  }

  fruit(p) {
    const rng = this.rng;
    const hang = p.clone().add(new THREE.Vector3(0, -rand(rng, 0.6, 1.6), 0));
    this.wood.push(paint(segment(p, hang, 0.03, 0.03, 3), C('#222')));
    const g = new THREE.SphereGeometry(rand(rng, 0.22, 0.34), 8, 6);
    g.scale(1, 1.3, 1);
    g.translate(hang.x, hang.y - 0.25, hang.z);
    this.glow.push(paint(g, this.style.fruit));
  }

  branches(p, dir, len, r, depth, cfg) {
    const rng = this.rng;
    const n = cfg.kids[depth] + (rng() < 0.3 ? 1 : 0);
    const [u, v] = basis(dir);
    const az0 = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const az = az0 + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const sp = cfg.spread[depth] * (0.75 + rng() * 0.5);
      const d = dir.clone().multiplyScalar(Math.cos(sp))
        .addScaledVector(u, Math.sin(sp) * Math.cos(az))
        .addScaledVector(v, Math.sin(sp) * Math.sin(az));
      d.y += cfg.tropism;
      d.normalize();
      const L = len * (0.8 + rng() * 0.4);
      const res = this.limb(p, d, L, r, r * cfg.radRatio, depth === 0 ? 4 : 3, cfg.gnarl, cfg.tropism * 0.3);
      if (cfg.strands && depth >= 1 && rng() < cfg.strands) this.strand(res.end, rand(rng, 1.5, 4.5));
      if (depth + 1 < cfg.depth) this.branches(res.end, res.dir, len * cfg.lenRatio, r * cfg.radRatio, depth + 1, cfg);
      else this.tip(res.end, cfg);
    }
  }

  tip(p, cfg) {
    const rng = this.rng;
    for (let k = 0; k < cfg.clumps; k++) {
      const off = new THREE.Vector3(rng() - 0.5, (rng() - 0.3) * 0.6, rng() - 0.5).multiplyScalar(cfg.clumpSize * 1.6);
      if (cfg.clumpSize > 0) this.clump(p.clone().add(off), cfg.clumpSize * (0.7 + rng() * 0.6), cfg.flat);
    }
    if (cfg.fruit && rng() < cfg.fruit) this.fruit(p.clone().add(new THREE.Vector3(0, -cfg.clumpSize * 0.4, 0)));
  }

  roots(R, count, reach) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.5;
      const start = new THREE.Vector3(Math.cos(a) * R * 0.35, R * rand(rng, 1.2, 2.2), Math.sin(a) * R * 0.35);
      const dir = new THREE.Vector3(Math.cos(a), -0.5, Math.sin(a)).normalize();
      this.limb(start, dir, rand(rng, 0.7, 1.2) * reach, R * 0.55, R * 0.08, 4, 0.2, -0.1);
    }
  }

  result() {
    return {
      wood: merge(this.wood),
      leaves: this.leaves.length ? merge(this.leaves) : null,
      glow: this.glow.length ? merge(this.glow) : null,
    };
  }
}

// ---------- tree families ----------
const BUILDERS = {
  /** Towering canopy trees: buttress roots, a massive trunk and a wide umbrella crown. */
  giant(b) {
    const rng = b.rng;
    const H = rand(rng, 13, 17), R = rand(rng, 1.3, 1.8);
    b.roots(R, 6 + ((rng() * 3) | 0), R * 4);
    const t = b.limb(new THREE.Vector3(0, -0.6, 0), UP.clone(), H, R, R * 0.66, 7, 0.16, 0.03);
    // a few low side limbs for silhouette
    for (let i = 0; i < 2; i++) {
      const y = H * rand(rng, 0.45, 0.7), a = rng() * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), 0.5, Math.sin(a)).normalize();
      const s = b.limb(new THREE.Vector3(0, y, 0), d, rand(rng, 4, 6), R * 0.35, R * 0.15, 3, 0.3, 0.05);
      b.tip(s.end, { clumps: 2, clumpSize: 2.4, flat: 0.55 });
    }
    b.branches(t.end, t.dir, H * 0.55, R * 0.62, 0, {
      depth: 3, kids: [4, 3, 2], spread: [0.8, 0.65, 0.55], lenRatio: 0.7, radRatio: 0.58,
      tropism: 0.04, gnarl: 0.35, clumpSize: 2.5, flat: 0.55, clumps: 5, strands: 0.45,
    });
  },
  /** Mid-size broadleaf for the middle distance. */
  broad(b) {
    const rng = b.rng;
    const H = rand(rng, 4.5, 6.5), R = rand(rng, 0.4, 0.55);
    b.roots(R, 4, R * 3.5);
    const t = b.limb(new THREE.Vector3(0, -0.3, 0), UP.clone(), H, R, R * 0.7, 4, 0.22, 0.03);
    b.branches(t.end, t.dir, H * 0.5, R * 0.65, 0, {
      depth: 3, kids: [3, 2, 2], spread: [0.75, 0.6, 0.5], lenRatio: 0.72, radRatio: 0.6,
      tropism: 0.06, gnarl: 0.35, clumpSize: 1.35, flat: 0.62, clumps: 4, strands: 0.15,
    });
  },
  /** Alien conifer: drooping tiers on a needle trunk. */
  spire(b) {
    const rng = b.rng, s = b.style;
    const H = rand(rng, 14, 20), R = rand(rng, 0.35, 0.5);
    b.limb(new THREE.Vector3(0, -0.3, 0), UP.clone(), H, R, R * 0.25, 6, 0.06, 0.02);
    const tiers = 6 + ((rng() * 3) | 0);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const y = H * (0.3 + t * 0.72);
      const rad = (1 - t) * rand(rng, 3.2, 4.2) + 0.6;
      const g = new THREE.ConeGeometry(rad, rad * 0.9, 9, 1, true);
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), z = pos.getZ(k), yy = pos.getY(k);
        const droop = yy < 0 ? -0.35 * rad * (0.6 + noise2(x * 2 + i, z * 2)) : 0;
        pos.setXYZ(k, x, yy + droop, z);
      }
      g.computeVertexNormals();
      g.rotateY(rng() * 3);
      g.translate(0, y, 0);
      b.leaves.push(paint(g.toNonIndexed(), s.leaf, (c, p) => {
        const k = THREE.MathUtils.clamp((p.y - y + rad) / (rad * 1.5), 0, 1);
        c.lerpColors(s.leafDark, s.leaf, k);
        if (k > 0.8) c.lerp(s.leafLight, (k - 0.8) * 2);
      }));
    }
  },
  /** Bleached, twisting dead tree. */
  dead(b) {
    const rng = b.rng;
    const H = rand(rng, 5, 8), R = rand(rng, 0.35, 0.55);
    b.roots(R, 4, R * 4);
    const t = b.limb(new THREE.Vector3(0, -0.3, 0), UP.clone(), H, R, R * 0.6, 5, 0.4, 0.02);
    b.branches(t.end, t.dir, H * 0.45, R * 0.6, 0, {
      depth: 4, kids: [3, 2, 2, 2], spread: [0.8, 0.7, 0.6, 0.6], lenRatio: 0.7, radRatio: 0.55,
      tropism: 0.02, gnarl: 0.6, clumpSize: 0, flat: 1, clumps: 0,
    });
  },
  /** Glowing-fruit tree of the grove. */
  lantern(b) {
    const rng = b.rng;
    const H = rand(rng, 6, 8), R = rand(rng, 0.6, 0.8);
    b.roots(R, 5, R * 4);
    const t = b.limb(new THREE.Vector3(0, -0.4, 0), UP.clone(), H, R, R * 0.65, 5, 0.3, 0.03);
    b.branches(t.end, t.dir, H * 0.55, R * 0.62, 0, {
      depth: 3, kids: [3, 3, 2], spread: [0.9, 0.7, 0.55], lenRatio: 0.72, radRatio: 0.58,
      tropism: -0.02, gnarl: 0.4, clumpSize: 1.9, flat: 0.5, clumps: 2, strands: 0.5, fruit: 0.7,
    });
  },
};

const variantCache = new Map();
export function treeVariant(type, index) {
  const key = `${type}:${index}`;
  if (!variantCache.has(key)) {
    const b = new TreeBuilder(1000 + index * 7919 + type.length * 104729, STYLES[type]);
    BUILDERS[type](b);
    variantCache.set(key, b.result());
  }
  return variantCache.get(key);
}

const materials = {};
function materialsFor(type) {
  if (!materials[type]) {
    const sw = SWAY[type];
    materials[type] = {
      wood: addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), ...sw.wood),
      leaves: addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }), ...sw.leaves),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
    materials[type].glow.color.setScalar(2.2);
  }
  return materials[type];
}

/**
 * Collects tree placements, then emits instanced meshes grouped by
 * (type, variant, x-chunk) so far-off chunks are frustum culled.
 */
export class TreeField {
  constructor() { this.items = []; }

  add(type, x, z, scale = 1, opts = {}) {
    this.items.push({
      type, x, z, scale,
      y: opts.y ?? 0,
      rot: opts.rot ?? ((x * 12.9898 + z * 78.233) % (Math.PI * 2)),
      shadow: opts.shadow ?? false,
      variant: opts.variant,
    });
  }

  build(parent) {
    const groups = new Map();
    for (const it of this.items) {
      const vi = it.variant ?? Math.abs(Math.floor(it.x * 7.31 + it.z * 3.17)) % VARIANTS[it.type];
      const key = `${it.type}|${vi}|${Math.floor(it.x / 120)}|${it.shadow ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, { type: it.type, vi, shadow: it.shadow, list: [] });
      groups.get(key).list.push(it);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const g of groups.values()) {
      const geo = treeVariant(g.type, g.vi);
      const mats = materialsFor(g.type);
      for (const part of ['wood', 'leaves', 'glow']) {
        if (!geo[part]) continue;
        const mesh = new THREE.InstancedMesh(geo[part], mats[part], g.list.length);
        g.list.forEach((it, i) => {
          p.set(it.x, it.y, it.z);
          q.setFromAxisAngle(UP, it.rot);
          s.setScalar(it.scale);
          mesh.setMatrixAt(i, m.compose(p, q, s));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = g.shadow && part !== 'glow';
        mesh.receiveShadow = part !== 'glow';
        parent.add(mesh);
      }
    }
  }
}
