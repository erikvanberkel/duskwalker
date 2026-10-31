import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky, PALETTE } from './sky.js';
import { World, LEVEL, ZONES } from './world.js';
import { Player } from './player.js';
import { ENEMY_TYPES, Titan, Relic, overlap } from './enemies.js';
import { Particles } from './effects.js';
import { Audio } from './audio.js';
import { windUniform, damp, clamp, rand } from './util.js';

const $ = (id) => document.getElementById(id);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, 45, 440);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 6000);

const hemi = new THREE.HemisphereLight('#9a82e0', '#3b2a22', 1.0);
const key = new THREE.DirectionalLight('#ffc28a', 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -48, right: 48, top: 42, bottom: -20, near: 1, far: 220 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04;
const rim = new THREE.DirectionalLight('#ff8fae', 1.3);
scene.add(hemi, key, key.target, rim, rim.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.55, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------- world ----------
const sky = new Sky(scene);
const world = new World(scene);
const player = new Player(scene);
const sparks = new Particles(scene, 1600, true);
const dust = new Particles(scene, 1200, false);
const audio = new Audio();

// ---------- input ----------
const keys = new Set(), pressed = new Set();
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'down', KeyS: 'down',
  KeyJ: 'attack', KeyX: 'attack', ControlLeft: 'attack', ControlRight: 'attack', KeyK: 'attack',
};
addEventListener('keydown', (e) => {
  const a = KEYMAP[e.code];
  if (a) { if (!keys.has(a)) pressed.add(a); keys.add(a); e.preventDefault(); }
  onKey(e.code);
});
addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) keys.delete(a); });
addEventListener('pointerdown', () => onKey('Click'));
let padPrev = {};
function readInput() {
  const inp = { left: keys.has('left'), right: keys.has('right'), down: keys.has('down'), jump: pressed.has('jump'), attack: pressed.has('attack') };
  const pad = navigator.getGamepads?.()[0];
  if (pad) {
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0, b = (i) => !!pad.buttons[i]?.pressed;
    inp.left ||= ax < -0.4 || b(14); inp.right ||= ax > 0.4 || b(15); inp.down ||= ay > 0.6 || b(13);
    const j = b(0) || b(12), at = b(2) || b(1);
    if (j && !padPrev.j) inp.jump = true;
    if (at && !padPrev.at) inp.attack = true;
    if (b(9) && !padPrev.st) onKey('Enter');
    padPrev = { j, at, st: b(9) };
  }
  pressed.clear();
  return inp;
}

// ---------- game state ----------
const G = {
  state: 'intro', time: 0, score: 0, enemies: [], relics: [], triggers: [], boss: null,
  camX: 0, shakeAmt: 0, hitstop: 0, zone: -1, trickle: 4, endT: 0, introT: 0, attractT: 0,
  scene,
  sfx: (n) => audio.play(n),
  shake: (a) => { G.shakeAmt = Math.max(G.shakeAmt, a); },
  addScore: (n) => { G.score += n; },
  addEnemy: (e) => G.enemies.push(e),
  spawn: (type, x) => { const e = new ENEMY_TYPES[type](G, x); G.enemies.push(e); return e; },
  burst(x, y, z, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(Math.random, 3, 10);
      sparks.emit(x, y, z + 0.5, Math.cos(a) * s, Math.sin(a) * s + 3, rand(Math.random, -2, 2), color, rand(Math.random, 0.25, 0.6), rand(Math.random, 0.12, 0.28), 14);
    }
  },
  dust(x, y, n) {
    const c = new THREE.Color('#9a7d66');
    for (let i = 0; i < n; i++) dust.emit(x + rand(Math.random, -0.4, 0.4), y, rand(Math.random, -0.5, 0.8), rand(Math.random, -2.5, 2.5), rand(Math.random, 0.5, 2.5), rand(Math.random, -1, 1), c, rand(Math.random, 0.5, 1.1), rand(Math.random, 0.3, 0.7), 1.5);
  },
  onEnemyKilled(e) {
    G.score += e.score;
    audio.play('kill');
    G.burst(e.x, e.y + 0.8, 0, 26, e instanceof Titan ? new THREE.Color(2, 0.8, 0.3) : new THREE.Color(1.6, 0.4, 1.2));
    if (e.constructor.name === 'Stalker' && Math.random() < 0.4) G.relics.push(new Relic(scene, e.x));
    if (e instanceof Titan) { G.state = 'won'; G.endT = 0; G.shake(1.2); }
  },
};
G.player = player;
window.__game = G; // handy for debugging in the dev tools
{
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  console.log('[duskwalker] GPU:', ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

// Waves: [triggerX, [[type, side(+1 ahead / -1 behind), delay]...]]
const WAVES = [
  [22, [['skitter', 1, 0], ['skitter', 1, 1.2]]],
  [58, [['skitter', -1, 0], ['skitter', 1, 0.5]]],
  [92, [['stalker', 1, 0]]],
  [128, [['skitter', 1, 0], ['skitter', 1, 0.8], ['skitter', -1, 1.6]]],
  [168, [['stalker', 1, 0], ['skitter', -1, 1]]],
  [212, [['wisp', 1, 0], ['wisp', 1, 1.5]]],
  [250, [['stalker', 1, 0], ['skitter', 1, 1.5]]],
  [292, [['skitter', 1, 0], ['skitter', -1, 0.4], ['skitter', 1, 1.2], ['stalker', 1, 2.5]]],
  [342, [['wisp', 1, 0], ['wisp', 1, 0.8], ['wisp', -1, 1.6]]],
  [384, [['stalker', 1, 0], ['wisp', 1, 1.5], ['wisp', -1, 2]]],
  [432, [['skitter', 1, 0], ['skitter', 1, 0.5], ['skitter', -1, 1], ['skitter', 1, 1.6]]],
  [472, [['stalker', 1, 0], ['stalker', -1, 1.4]]],
  [520, [['wisp', 1, 0], ['wisp', 1, 0.6], ['wisp', -1, 1.2], ['wisp', 1, 1.8]]],
  [562, [['stalker', 1, 0], ['skitter', 1, 0.5], ['skitter', -1, 1]]],
  [612, [['stalker', 1, 0], ['stalker', 1, 1.6], ['wisp', -1, 2.2]]],
  [662, [['stalker', 1, 0], ['stalker', -1, 1]]],
  [702, [['wisp', 1, 0], ['wisp', 1, 0.8], ['skitter', -1, 0.5], ['skitter', 1, 1.5]]],
  [742, [['stalker', 1, 0], ['stalker', 1, 1.2], ['skitter', -1, 2]]],
  [785, [['stalker', 1, 0], ['wisp', 1, 0.5], ['skitter', -1, 1], ['wisp', -1, 1.5], ['skitter', 1, 2]]],
];
const RELIC_X = [118, 238, 362, 498, 600, 722, 826];

const CAM_Z = 14.5;
function halfWidth() { return Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z * camera.aspect; }

function resetGame() {
  for (const e of G.enemies) if (e.alive) e.remove();
  for (const r of G.relics) if (r.alive) r.remove();
  G.enemies = []; G.relics = RELIC_X.map((x) => new Relic(scene, x));
  G.triggers = WAVES.map(([x, list]) => ({ x, list, fired: false }));
  G.pending = [];
  G.boss = new Titan(G, LEVEL.end - 14);
  G.enemies.push(G.boss);
  G.score = 0; G.time = 0; G.zone = -1; G.trickle = 5; G.endT = 0; G.arena = false;
  player.reset(LEVEL.start);
  G.camX = player.x + 4;
  $('boss').style.display = 'none';
}

function showZone(i) {
  const z = $('zone');
  z.textContent = ZONES[i].name;
  z.classList.add('show');
  clearTimeout(showZone.t);
  showZone.t = setTimeout(() => z.classList.remove('show'), 2800);
}

function onKey(code) {
  if (G.state === 'intro') { audio.start(); endIntro(); return; }
  if (G.state === 'title' && (code === 'Enter' || code === 'Click' || code === 'Space')) {
    audio.start(); $('title').classList.add('hidden'); resetGame(); G.state = 'play'; return;
  }
  if ((G.state === 'over' || G.state === 'wonScreen') && (code === 'Enter' || code === 'Click') && G.endT > 1) {
    $('over').classList.add('hidden'); resetGame(); G.state = 'play'; return;
  }
  if (code === 'KeyP' || code === 'Escape') {
    if (G.state === 'play') { G.state = 'paused'; $('paused').classList.remove('hidden'); }
    else if (G.state === 'paused') { G.state = 'play'; $('paused').classList.add('hidden'); }
  }
  if (code === 'KeyM') audio.toggleMusic();
  if (code === 'KeyB') bloom.enabled = !bloom.enabled;
}

// ---------- Mirage intro (Amiga copper bars) ----------
const intro = $('intro');
const coppers = [];
for (let i = 0; i < 7; i++) {
  const d = document.createElement('div');
  d.className = 'copper';
  const hue = 200 + i * 22;
  d.style.background = `linear-gradient(hsl(${hue},90%,15%), hsl(${hue},100%,70%), hsl(${hue},90%,15%))`;
  intro.appendChild(d); coppers.push(d);
}
const logoImg = $('mirageImg');
logoImg.onload = () => { logoImg.style.display = 'block'; $('mirageWord').style.display = 'none'; };
logoImg.src = 'assets/mirage-logo.png';
function endIntro() {
  if (G.state !== 'intro') return;
  intro.classList.add('hidden');
  G.state = 'title';
  player.reset(LEVEL.start);
}

// ---------- update ----------
function updatePlay(dt) {
  G.time += dt;
  const inp = readInput();
  const events = [];
  const minX = G.arena ? LEVEL.arena - 2 : LEVEL.start - 2;
  player.update(dt, inp, minX, LEVEL.end - 2, events);
  for (const ev of events) {
    audio.play(ev);
    if (ev === 'land' || ev === 'jump') G.dust(player.x, 0.1, 8);
  }
  if (Math.abs(player.vx) > 6 && player.onGround && Math.random() < 0.25) G.dust(player.x - player.facing * 0.3, 0.05, 1);

  // waves
  const hw = halfWidth();
  for (const t of G.triggers) {
    if (!t.fired && player.x > t.x) {
      t.fired = true;
      for (const [type, side, delay] of t.list) G.pending.push({ type, side, at: G.time + delay });
    }
  }
  G.pending = G.pending.filter((p) => {
    if (G.time < p.at) return true;
    G.spawn(p.type, clamp(G.camX + p.side * (hw + 3), minX, LEVEL.arena - 4));
    return false;
  });
  // ambient trickle of foes
  G.trickle -= dt;
  const live = G.enemies.filter((e) => e.alive && !e.dying && !(e instanceof Titan)).length;
  if (!G.arena && G.trickle <= 0 && live < 3) {
    G.trickle = rand(Math.random, 4, 7);
    const z = world.zoneAt(player.x);
    const type = z === 0 ? 'skitter' : z === 1 ? (Math.random() < 0.6 ? 'wisp' : 'skitter') : (Math.random() < 0.5 ? 'stalker' : 'skitter');
    G.spawn(type, G.camX + (Math.random() < 0.75 ? 1 : -1) * (hw + 3));
  }

  // zone banner / arena
  const z = world.zoneAt(player.x);
  if (z !== G.zone) { G.zone = z; showZone(z); }
  if (!G.arena && player.x > LEVEL.arena) { G.arena = true; $('boss').style.display = 'block'; }
  if (G.arena && player.x > LEVEL.arena + 6) G.boss.wake();

  // enemies & combat
  const atk = player.attackBox(), hb = player.hurtBox();
  for (const e of G.enemies) {
    if (!e.alive) continue;
    e.update(dt, player);
    if (!e.alive || e.dying) continue;
    const ehb = e.hurtBox();
    if (atk && ehb && overlap(atk, ehb) && !player.hitThisSwing.has(e)) {
      player.hitThisSwing.add(e);
      if (e.hit(1, player.facing)) {
        audio.play('hit');
        G.burst((Math.max(atk.x0, ehb.x0) + Math.min(atk.x1, ehb.x1)) / 2, (Math.max(atk.y0, ehb.y0) + Math.min(atk.y1, ehb.y1)) / 2, 0, 12, new THREE.Color(2, 1.5, 0.6));
        G.hitstop = 0.06; G.shake(0.18);
      }
      if (!e.alive || e.dying) continue;
    }
    if (player.dead) continue;
    const eab = e.attackBox();
    let dmg = 0, from = e.x;
    if (eab && overlap(eab, hb)) dmg = e.contact > 1 ? e.contact : 2;
    else if (e.contact && ehb && !(e instanceof Titan) && overlap(ehb, hb)) dmg = e.contact;
    if (dmg && player.damage(dmg, from)) {
      audio.play('hurt'); G.shake(0.35);
      $('flash').style.opacity = 0.45; setTimeout(() => ($('flash').style.opacity = 0), 90);
    }
  }
  // the titan's bulk blocks the way
  if (G.boss.alive && !G.boss.dying && player.x > G.boss.x - 2.9) { player.x = G.boss.x - 2.9; if (player.vx > 0) player.vx = -4; }
  G.enemies = G.enemies.filter((e) => e.alive);
  for (const e of G.enemies) {
    if (!(e instanceof Titan) && (e.x < G.camX - hw - 30 || e.x > G.camX + hw + 30)) e.remove();
  }
  G.enemies = G.enemies.filter((e) => e.alive);

  // relics
  for (const r of G.relics) {
    if (!r.alive) continue;
    r.update(dt);
    if (!player.dead && player.hp < player.maxHp && overlap(r.box(), hb)) {
      player.hp = Math.min(player.maxHp, player.hp + 3); r.remove(); audio.play('pickup');
      G.burst(r.x, r.y, 0, 20, new THREE.Color(2, 0.5, 0.3)); G.score += 50;
    }
  }
  G.relics = G.relics.filter((r) => r.alive);

  if (player.dead) { G.endT += dt; if (G.endT > 2.2) gameOver(false); }
}

function gameOver(won) {
  G.state = won ? 'wonScreen' : 'over';
  G.endT = 0;
  audio.play(won ? 'win' : 'die');
  $('overTitle').textContent = won ? 'VICTORY' : 'FALLEN';
  $('overSub').textContent = won ? 'THE TITAN SLEEPS AND THE DUSK IS LIFTED' : 'THE DUSK CLAIMS ANOTHER WANDERER';
  $('overScore').textContent = `SCORE ${G.score.toLocaleString()}`;
  $('overTime').textContent = `TIME ${fmtTime(G.time)}`;
  $('over').classList.remove('hidden');
  $('boss').style.display = 'none';
}

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// HUD
const healthEl = $('health');
for (let i = 0; i < 10; i++) healthEl.appendChild(document.createElement('i'));
function updateHud() {
  [...healthEl.children].forEach((c, i) => c.classList.toggle('off', i >= player.hp));
  $('score').textContent = G.score.toLocaleString();
  $('timer').textContent = fmtTime(G.time);
  $('progress').style.width = `${clamp((player.x - LEVEL.start) / (LEVEL.arena - LEVEL.start), 0, 1) * 100}%`;
  if (G.boss) $('bossbar').style.width = `${clamp(G.boss.hp / G.boss.maxHp, 0, 1) * 100}%`;
  $('hud').style.opacity = G.state === 'play' || G.state === 'paused' || G.state === 'won' ? 1 : 0;
}

// ---------- camera ----------
function updateCamera(dt, targetX, lead) {
  let want = targetX + lead;
  if (G.arena) want = clamp(want, LEVEL.arena + 12, LEVEL.end - 12);
  G.camX = damp(G.camX, want, 3.2, dt);
  G.shakeAmt = Math.max(0, G.shakeAmt - dt * 1.8);
  const s = G.shakeAmt * G.shakeAmt;
  camera.position.set(G.camX + (Math.random() - 0.5) * s, 3.6 + player.y * 0.25 + (Math.random() - 0.5) * s, CAM_Z);
  camera.lookAt(G.camX, 3.3 + player.y * 0.2, -4);
  const px = G.camX;
  key.position.set(px - 34, 46, 38); key.target.position.set(px, 0, -6);
  rim.position.set(px - 50, 18, -70); rim.target.position.set(px, 2, 0);
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 1 / 30);
  windUniform.value += dt;

  if (G.state === 'intro') {
    G.introT += dt;
    coppers.forEach((c, i) => { c.style.top = `${50 + Math.sin(G.introT * 1.6 + i * 0.45) * 38}%`; });
    if (G.introT > 1.2) $('presents').classList.add('on');
    if (G.introT > 5) endIntro();
  }

  if (G.state === 'play' || G.state === 'won') {
    if (G.hitstop > 0) { G.hitstop -= dt; dt *= 0.08; }
    updatePlay(dt);
    if (G.state === 'won') { G.endT += dt; if (G.endT > 2.8) gameOver(true); }
    updateCamera(dt, player.x, player.facing * 2.5);
  } else if (G.state === 'title' || G.state === 'intro') {
    // attract mode: drift through the plains under the giant trees
    G.attractT += dt;
    const x = 30 + ((G.attractT * 6) % 300);
    if (x < G.camX - 50) G.camX = x;
    readInput();
    player.update(dt, { right: false }, -1e9, 1e9, []);
    updateCamera(dt, x, 0);
  } else if (G.state === 'over' || G.state === 'wonScreen') {
    G.endT += dt;
    for (const e of G.enemies) if (e.alive) e.update(dt, player);
    player.update(dt, {}, -1e9, 1e9, []);
    updateCamera(dt, player.x, 0);
  }
  if (G.state !== 'paused') {
    sky.update(camera, dt);
    world.update(dt, G.camX);
    sparks.update(dt);
    dust.update(dt);
  }
  updateHud();
  composer.render();
}
frame();
