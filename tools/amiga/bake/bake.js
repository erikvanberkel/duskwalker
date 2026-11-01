// Runs inside Electron: poses the game's models and renders them to transparent PNGs.
import * as THREE from 'three';
import { Player, ATTACK_TIME } from '/src/player.js';
import { ENEMY_TYPES, Titan, Relic } from '/src/enemies.js';
import { treeVariant, TreeField } from '/src/trees.js';
import { paint, noise2 } from '/src/util.js';

const SS = 4;                 // supersampling factor; the generator box-filters it down
const PPU = 18;               // pixels per world unit on the walking plane
const images = {}, meta = {};
window.__bakeImages = images;
window.__bakeMeta = meta;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

function makeScene() {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight('#9a82e0', '#3b2a22', 1.0);
  const key = new THREE.DirectionalLight('#ffc28a', 2.6);
  key.position.set(-34, 46, 38);
  const rim = new THREE.DirectionalLight('#ff8fae', 1.3);
  rim.position.set(-50, 18, -70);
  scene.add(hemi, key, rim);
  return scene;
}

// Render `scene` over the world-space box [x0,x1] x [y0,y1] at `ppu` pixels per unit.
function shoot(name, scene, x0, x1, y0, y1, ppu, anchor = [0, 0], extra = {}) {
  const w = Math.round((x1 - x0) * ppu), h = Math.round((y1 - y0) * ppu);
  renderer.setSize(w * SS, h * SS, false);
  const cam = new THREE.OrthographicCamera(x0, x1, y1, y0, -200, 200);
  cam.position.set(0, 0, 50);
  cam.lookAt(0, 0, 0);
  renderer.render(scene, cam);
  images[name] = renderer.domElement.toDataURL('image/png');
  meta[name] = { w, h, ss: SS, ax: Math.round((anchor[0] - x0) * ppu), ay: Math.round((y1 - anchor[1]) * ppu), ppu, ...extra };
}

// Same as shoot(), but the box is the posed object's bounds (snapped to whole pixels).
function shootAuto(name, scene, obj, ppu, extra = {}, margin = 0.08) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => { if (o.isMesh && o.visible && o.geometry) { let v = true; for (let p = o; p; p = p.parent) if (!p.visible) v = false; if (v) box.expandByObject(o); } });
  const sn = (v, f) => f(v * ppu) / ppu;
  shoot(name, scene, sn(box.min.x - margin, Math.floor), sn(box.max.x + margin, Math.ceil), sn(Math.max(box.min.y - margin, -0.3), Math.floor), sn(box.max.y + margin, Math.ceil), ppu, [0, 0], extra);
}

const hideSprites = (obj) => obj.traverse((o) => { if (o.isSprite) o.visible = false; });

// ---------------------------------------------------------------- the wanderer
function bakePlayer() {
  const scene = makeScene();
  const p = new Player(scene);
  p.scarf.visible = false;
  const pose = (name, setup, phase = 0) => {
    p.reset(0);
    p.scarf.visible = false;
    setup(p);
    for (let i = 0; i < 40; i++) {
      const dt = 0.05;
      const speed = Math.abs(p.vx);
      p.phase = phase - dt * (3 + speed * 1.15);
      p.invuln = 0;
      p.animate(dt);
    }
    p.root.position.set(0, p.y, 0);
    p.scarf.visible = false;
    shootAuto(name, scene, p.root, PPU);
  };
  pose('player_idle0', () => {}, 0);
  pose('player_idle1', () => {}, Math.PI * 2);
  for (let i = 0; i < 8; i++) pose('player_run' + i, (q) => { q.vx = 8.5; }, (i / 8) * Math.PI * 2);
  pose('player_jump', (q) => { q.onGround = false; q.vy = 10; q.y = 0; });
  pose('player_fall', (q) => { q.onGround = false; q.vy = -10; q.y = 0; });
  pose('player_crouch', (q) => { q.crouch = true; });
  const atk = [0.12, 0.3, 0.42, 0.7];
  for (let side = 0; side < 2; side++)
    atk.forEach((f, i) => pose(`player_atk${side}_${i}`, (q) => { q.attackT = f * ATTACK_TIME; q.attackSide = side; }));
  for (let side = 0; side < 2; side++)
    [0.3, 0.42].forEach((f, i) => pose(`player_catk${side}_${i}`, (q) => { q.crouch = true; q.attackT = f * ATTACK_TIME; q.attackSide = side; }));
  pose('player_hurt', (q) => { q.hurtT = 0.2; });
  [0.12, 0.3, 0.45, 0.6].forEach((t, i) => pose('player_die' + i, (q) => { q.dead = true; q.deadT = t; }));
}

// ---------------------------------------------------------------- foes
function stubGame(scene) {
  const g = { scene, enemies: [], sfx() {}, shake() {}, addScore() {}, burst() {}, dust() {}, onEnemyKilled() {} };
  g.addEnemy = (e) => g.enemies.push(e);
  g.spawn = () => ({});
  return g;
}

function bakeFoes() {
  // skitter: 4 scuttle frames
  {
    const scene = makeScene(), g = stubGame(scene);
    const e = new ENEMY_TYPES.skitter(g, 0);
    hideSprites(e.root);
    for (let i = 0; i < 4; i++) {
      e.t = (i / 4) * (Math.PI * 2 / 22);
      const s = e.t * 22;
      e.legs.forEach((l, k) => { l.rotation.z = Math.sin(s + k * 2.1) * 0.5; });
      e.bodyMesh.position.y = 0.55 + Math.abs(Math.sin(s)) * 0.04;
      e.facing = 1; e.x = 0; e.y = 0; e.baseUpdate(0);
      shootAuto('skitter' + i, scene, e.root, PPU);
    }
  }
  // stalker: walk 6, windup, strike, recover
  {
    const scene = makeScene(), g = stubGame(scene);
    const e = new ENEMY_TYPES.stalker(g, 0);
    hideSprites(e.root);
    const set = (walk, s, sh, fo, lean) => {
      e.legs.forEach((l, i) => { const ph = s + i * Math.PI; l.hip.rotation.z = Math.sin(ph) * 0.45 * walk; l.knee.rotation.z = Math.max(0, Math.cos(ph)) * 0.6 * walk; });
      e.hips.position.y = 2.25 - Math.abs(Math.cos(s)) * 0.12 * walk;
      e.shoulder.rotation.z = sh; e.fore.rotation.z = fo; e.torso.rotation.z = -lean;
      e.facing = 1; e.x = 0; e.y = 0; e.baseUpdate(0);
    };
    const box = (n) => shootAuto(n, scene, e.root, PPU);
    for (let i = 0; i < 6; i++) { const s = (i / 6) * Math.PI * 2; set(1, s, -0.3 + Math.sin(s) * 0.2, 0.4, 0); box('stalker_walk' + i); }
    set(0, 0, -1.4, 0.6, -0.12); box('stalker_windup0');
    set(0, 0, -2.7, 1.2, -0.25); box('stalker_windup1');
    set(0, 0, 1.4, 0.1, 0.35); box('stalker_strike');
    set(0, 0, 0.6, 0.25, 0.2); box('stalker_recover');
  }
  // wisp: 4 hover frames + dive
  {
    const scene = makeScene(), g = stubGame(scene);
    const e = new ENEMY_TYPES.wisp(g, 0);
    hideSprites(e.root);
    const set = (t, dive) => {
      e.t = t;
      e.tendrils.forEach((segs, i) => segs.forEach((s, k) => { s.rotation.z = Math.sin(t * 4 + i + k * 0.8) * 0.35 + (dive ? -0.4 : 0); }));
      e.facing = 1; e.x = 0; e.y = 0; e.baseUpdate(0);
    };
    for (let i = 0; i < 4; i++) { set((i / 4) * (Math.PI * 2 / 4), false); shootAuto('wisp' + i, scene, e.root, PPU); }
    set(0.3, true); shootAuto('wisp_dive', scene, e.root, PPU);
  }
  // titan + its seeds
  {
    const scene = makeScene(), g = stubGame(scene);
    const t = new Titan(g, 0);
    hideSprites(t.root);
    const set = (name, { shL = 0.2, shR = 0.2, elL = 0.3, elR = 0.3, lean = 0, breath = 0, core = 3 }) => {
      const [L, R] = t.arms;
      L.sh.rotation.z = shL + breath * 0.05; R.sh.rotation.z = shR - breath * 0.05; L.el.rotation.z = elL; R.el.rotation.z = elR;
      t.model.rotation.z = -lean;
      t.torso.scale.setScalar(1 + breath * 0.02);
      t.coreMat.color.setRGB(core, 0.9, 0.25);
      t.root.position.set(0, 0, 0);
      t.root.rotation.y = Math.PI + 0.3;
      shootAuto(name, scene, t.root, PPU);
    };
    set('titan_dormant', { lean: 0.25, shL: 0.5, shR: 0.5, core: 2 });
    set('titan_idle0', { breath: 1 });
    set('titan_idle1', { breath: -1, core: 4 });
    set('titan_seeds', { shR: -2.2, elR: 0.8 });
    set('titan_slam0', { shL: -2.6, shR: -2.6, elL: 1.0, elR: 1.0, lean: -0.15 });
    set('titan_slam1', { shL: 1.3, shR: 1.3, elL: 0.1, elR: 0.1, lean: 0.3 });
    set('titan_summon', { shL: -1.2, shR: -1.2, elL: 1.4, elR: 1.4, lean: -0.3 });
    // seed
    t.state = 'seeds'; t.stateT = 0.6; t.fired = 0; t.cycle = 0;
    t.update(0.001, { x: -5, dead: false });
    const seed = g.enemies.find((e) => e.core);
    if (seed) {
      t.root.visible = false;
      hideSprites(seed.root);
      for (let i = 0; i < 4; i++) {
        seed.core.rotation.set(i * 0.8, 0, i * 0.5);
        seed.root.position.set(0, 0, 0);
        shootAuto('seed' + i, scene, seed.root, PPU);
      }
    }
  }
  // health relic
  {
    const scene = makeScene();
    const r = new Relic(scene, 0, 0);
    hideSprites(r.root);
    for (let i = 0; i < 4; i++) { r.gem.rotation.y = (i / 4) * Math.PI / 2; r.root.position.set(0, 0, 0); shootAuto('relic' + i, scene, r.root, PPU); }
  }
}

// ---------------------------------------------------------------- trees and ruins of the near ribbon
function bakeTrees() {
  const variants = [['giant', 4, 8.4], ['lantern', 3, 10.5], ['dead', 3, 9.6]];
  for (const [type, n, ppu] of variants)
    for (let i = 0; i < n; i++) {
      const scene = makeScene();
      const geo = treeVariant(type, i);
      const grp = new THREE.Group();
      const wood = new THREE.Mesh(geo.wood, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
      grp.add(wood);
      if (geo.leaves) grp.add(new THREE.Mesh(geo.leaves, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide })));
      if (geo.glow) { const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); m.color.setScalar(2.2); grp.add(new THREE.Mesh(geo.glow, m)); }
      grp.rotation.y = 0.6 + i * 1.3;
      scene.add(grp);
      const box = new THREE.Box3().setFromObject(grp);
      shoot(`tree_${type}${i}`, scene, Math.floor(box.min.x - 0.3), Math.ceil(box.max.x + 0.3), Math.max(-1, box.min.y), box.max.y + 0.2, ppu, [0, 0], { kind: type });
    }
  // causeway ruins: broken columns (stone, moss)
  const stone = new THREE.Color('#7d7470'), moss = new THREE.Color('#5d6a33');
  const tint = (g) => paint(g, stone, (c, p) => { c.multiplyScalar(0.75 + noise2(p.x * 2, p.y * 2 + p.z) * 0.4); if (p.y > 0.4 && noise2(p.x * 0.9 + 3, p.z * 0.9) > 0.6) c.lerp(moss, 0.55); });
  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  const column = (name, h, ppu) => {
    const scene = makeScene();
    const g = new THREE.CylinderGeometry(0.85, 1, h, 10, 3); g.translate(0, h / 2, 0);
    const cap = new THREE.BoxGeometry(2.4, 0.6, 2.4); cap.translate(0, 0.3, 0);
    scene.add(new THREE.Mesh(tint(g), stoneMat), new THREE.Mesh(tint(cap), stoneMat));
    shoot(name, scene, -1.8, 1.8, -0.2, h + 0.2, ppu, [0, 0], { kind: 'ruin' });
  };
  column('ruin_col0', 9.5, 11.5);
  column('ruin_col1', 4.5, 11.5);
  column('ruin_col2', 2.2, 11.5);
  // arena pillar with lintel
  {
    const scene = makeScene();
    const p = new THREE.CylinderGeometry(1.2, 1.4, 14, 12); p.translate(0, 7, 0);
    const l = new THREE.BoxGeometry(14, 1.4, 2.2); l.translate(5.5, 14.7, 0);
    scene.add(new THREE.Mesh(tint(p), stoneMat), new THREE.Mesh(tint(l), stoneMat));
    shoot('ruin_arch', scene, -1.8, 12.8, -0.2, 15.6, 7.6, [0, 0], { kind: 'ruin' });
    const scene2 = makeScene();
    const p2 = new THREE.CylinderGeometry(1.2, 1.4, 14, 12); p2.translate(0, 7, 0);
    scene2.add(new THREE.Mesh(tint(p2), stoneMat));
    shoot('ruin_pillar', scene2, -1.8, 1.8, -0.2, 14.2, 7.6, [0, 0], { kind: 'ruin' });
  }
}

// ---------------------------------------------------------------- tree placements from the real level
async function bakePlacements() {
  const items = [];
  const add = TreeField.prototype.add;
  TreeField.prototype.add = function (type, x, z, scale, opts) { items.push({ type, x, z, scale, y: opts?.y ?? 0 }); return add.call(this, type, x, z, scale, opts); };
  const { World } = await import('/src/world.js');
  new World(new THREE.Scene());
  TreeField.prototype.add = add;
  meta.placements = items;
}

// ---------------------------------------------------------------- lettering
function bakeText() {
  const text = (name, s, font, px, spacing, pad = 6) => {
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    ctx.font = `${px}px ${font}`;
    ctx.letterSpacing = spacing + 'px';
    const w = Math.ceil(ctx.measureText(s).width) + pad * 2, h = Math.ceil(px * 1.25) + pad * 2;
    c.width = w; c.height = h;
    ctx.font = `${px}px ${font}`;
    ctx.letterSpacing = spacing + 'px';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(s, pad, h / 2);
    images[name] = c.toDataURL('image/png');
    meta[name] = { w, h, ss: 1, ax: 0, ay: 0, text: true };
  };
  const serif = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  text('txt_title', 'DUSKWALKER', serif, 36, 4);
  text('txt_fallen', 'FALLEN', serif, 38, 6);
  text('txt_victory', 'VICTORY', serif, 38, 6);
  text('txt_mirage', 'MIRAGE', 'Impact, "Arial Black", sans-serif', 54, 6);
}

(async () => {
  try {
    bakePlayer();
    bakeFoes();
    bakeTrees();
    bakeText();
    await bakePlacements();
    window.__bakeStatus = 'done';
  } catch (e) {
    console.error(e.stack || e);
    window.__bakeStatus = 'error: ' + e.message;
  }
})();
