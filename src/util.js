import * as THREE from 'three';

// ---------- deterministic randomness ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (rng, a, b) => a + (b - a) * rng();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

// ---------- 1D / 2D value noise ----------
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  return lerp(hash(i), hash(i + 1), smooth(f));
}
export function fbm1(x, oct = 5) {
  let v = 0, amp = 0.5, f = 1, sum = 0;
  for (let o = 0; o < oct; o++) { v += amp * noise1(x * f + o * 17.3); sum += amp; amp *= 0.5; f *= 2.03; }
  return v / sum;
}
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  const ux = smooth(fx), uy = smooth(fy);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function fbm2(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1, sum = 0;
  for (let o = 0; o < oct; o++) { v += amp * noise2(x * f + o * 5.1, y * f - o * 3.7); sum += amp; amp *= 0.5; f *= 2.01; }
  return v / sum;
}

// ---------- geometry helpers ----------
/** Bake a solid vertex colour (optionally per-vertex via fn) into a non-indexed geometry. */
export function paint(geo, color, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    c.copy(color);
    if (fn) { p.fromBufferAttribute(pos, i); fn(c, p, i); }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Merge non-indexed geometries that all carry position/normal/color. */
export function merge(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Cylinder spanning a -> b. */
export function segment(a, b, rA, rB, radial = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rB, rA, len, radial, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

// ---------- wind sway (shared uniform) ----------
export const windUniform = { value: 0 };

/**
 * Patch a built-in material so vertices sway with height. `strength` scales the bend,
 * `heightRef` is the height at which the sway reaches full strength.
 */
export function addSway(material, strength = 0.4, heightRef = 10) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float swayPhase = 0.0;
        #ifdef USE_INSTANCING
          swayPhase = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
        #endif
        float h = max(transformed.y, 0.0) / ${heightRef.toFixed(2)};
        float bend = h * h * ${strength.toFixed(3)};
        transformed.x += sin(uWind * 1.1 + swayPhase) * bend + sin(uWind * 2.7 + swayPhase * 3.0 + transformed.y) * bend * 0.25;
        transformed.z += cos(uWind * 0.9 + swayPhase) * bend * 0.5;`);
  };
  material.customProgramCacheKey = () => `sway-${strength}-${heightRef}`;
  return material;
}

/** Soft radial gradient sprite texture. */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
