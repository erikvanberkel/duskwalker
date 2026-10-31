import * as THREE from 'three';
import { paint, glowTexture } from './util.js';

const C = (h) => new THREE.Color(h);

function finGeometry(len, height, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(len, 0); s.lineTo(len * 1.12, height); s.lineTo(len * 0.45, height * 0.92); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  return g;
}

function propeller(radius, blades, color) {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.18, radius * 0.5, 10), new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 0.8, roughness: 0.35 }));
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const bladeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, radius, radius * 0.16), bladeMat);
    b.geometry.translate(0, radius / 2, 0);
    b.rotation.x = (i / blades) * Math.PI * 2;
    b.rotation.y = 0.35;
    g.add(b);
  }
  // motion blur disc
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshBasicMaterial({ color: '#d8c8b0', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.y = Math.PI / 2;
  g.add(disc);
  return g;
}

/** Builds the airship. Nose points +X. Length ~60 units. */
export function buildAirship() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const L = 60, R = 8.5;

  // --- envelope (lathe) with gores and brass rib bands ---
  const pts = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = R * Math.pow(Math.sin(Math.PI * t), 0.48) * (0.72 + 0.28 * Math.pow(t, 0.6));
    pts.push(new THREE.Vector2(Math.max(r, 0.02), t * L - L / 2));
  }
  let env = new THREE.LatheGeometry(pts, 40);
  env.rotateZ(-Math.PI / 2);
  const fabricA = C('#d9c3a0'), fabricB = C('#8e3b35'), brass = C('#a07a3c');
  env = paint(env, fabricA, (c, p) => {
    const ang = Math.atan2(p.z, p.y);
    const gore = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 16);
    const band = Math.abs(((p.x + L / 2) % 6) - 3) < 0.22;
    if (band) c.copy(brass);
    else if (gore % 2 === 0) c.copy(fabricA).multiplyScalar(0.92);
    else c.copy(fabricB);
    // weathering: darker underside, stain near tail
    const under = THREE.MathUtils.clamp(-p.y / R, 0, 1);
    c.multiplyScalar(1 - under * 0.35);
    c.multiplyScalar(0.9 + 0.1 * Math.sin(p.x * 1.7 + ang * 5));
  });
  env.computeVertexNormals();
  const envMesh = new THREE.Mesh(env, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }));
  body.add(envMesh);

  // dorsal spine rail and nose cap
  const brassMat = new THREE.MeshStandardMaterial({ color: '#b48a44', metalness: 0.85, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2b211d', roughness: 0.6, metalness: 0.4 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 10), brassMat);
  nose.position.set(L / 2 - 0.6, 0, 0); body.add(nose);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, L * 0.7, 6), brassMat);
  spine.rotation.z = Math.PI / 2; spine.position.set(0, R * 0.98, 0); body.add(spine);
  // crow's nest
  const nest = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.3, 12), darkMat);
  nest.position.set(10, R + 0.4, 0); body.add(nest);

  // --- tail fins ---
  const finMat = new THREE.MeshStandardMaterial({ color: '#7a2f2b', roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeometry(9, 7, 0.35), finMat);
    const pivot = new THREE.Group();
    pivot.position.set(-L / 2 + 4, 0, 0);
    pivot.rotation.x = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(-1.5, R * 0.42, 0);
    pivot.add(fin);
    body.add(pivot);
  }
  const tailProp = propeller(3.2, 4, '#3a2c24');
  tailProp.position.set(-L / 2 - 0.8, 0, 0);
  body.add(tailProp);

  // --- gondola ---
  const gondola = new THREE.Group();
  gondola.position.set(4, -R - 2.6, 0);
  body.add(gondola);
  const hullGeo = new THREE.CapsuleGeometry(1.9, 15, 6, 14);
  hullGeo.rotateZ(Math.PI / 2);
  hullGeo.scale(1, 0.8, 0.85);
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.55, metalness: 0.25 }));
  gondola.add(hull);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(17, 0.35, 0.5), brassMat);
  keel.position.y = -1.4; gondola.add(keel);
  // windows (glow -> bloom)
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.7, 0.7), toneMapped: false });
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 9; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.65), winMat);
      w.position.set(-6.4 + i * 1.6, 0.2, side * 1.64);
      w.rotation.y = side > 0 ? 0 : Math.PI;
      gondola.add(w);
    }
  }
  // struts to envelope
  for (let i = -1; i <= 1; i++) {
    for (let side = -1; side <= 1; side += 2) {
      const a = new THREE.Vector3(i * 6, 1.2, side * 1.0), b = new THREE.Vector3(i * 7, 3.4, side * 3.2);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, a.distanceTo(b), 4), darkMat);
      s.position.copy(a).add(b).multiplyScalar(0.5);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      gondola.add(s);
    }
  }

  // --- engine pods ---
  const props = [tailProp];
  for (let side = -1; side <= 1; side += 2) {
    const pod = new THREE.Group();
    pod.position.set(-6, -R * 0.55, side * (R * 0.95));
    const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3.6, 4, 12), darkMat);
    nac.rotation.z = Math.PI / 2; pod.add(nac);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.12, 6, 16), brassMat);
    ring.rotation.y = Math.PI / 2; ring.position.x = 1.2; pod.add(ring);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.2, 6), brassMat);
    arm.position.set(0, 0.9, -side * 1.3); arm.rotation.x = side * 0.9; pod.add(arm);
    const p = propeller(2.1, 3, '#2a1f1a');
    p.position.x = -2.9; pod.add(p);
    props.push(p);
    // exhaust glow
    const ex = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,160,80,.9)', 'rgba(255,80,20,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ex.position.set(-2.4, 0, 0); ex.scale.setScalar(2.2);
    pod.add(ex);
    body.add(pod);
  }

  // --- navigation lights ---
  const navTex = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  const mkLight = (col, x, y, z) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: navTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sp.position.set(x, y, z); sp.scale.setScalar(3.2);
    body.add(sp);
    return sp;
  };
  const lights = [
    mkLight(new THREE.Color(3, 0.3, 0.2), 6, -R * 0.2, R * 0.98),
    mkLight(new THREE.Color(0.3, 3, 0.6), 6, -R * 0.2, -R * 0.98),
    mkLight(new THREE.Color(3, 2.6, 2), -L / 2 + 1, R * 0.55, 0),
  ];

  // --- searchlight beam ---
  const beamGeo = new THREE.ConeGeometry(9, 60, 24, 1, true);
  beamGeo.translate(0, -30, 0);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ffe2b0', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const beamPivot = new THREE.Group();
  beamPivot.position.set(10, -R - 3.5, 0);
  beamPivot.add(beam);
  body.add(beamPivot);

  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });

  let t = Math.random() * 10;
  root.userData.update = (dt) => {
    t += dt;
    for (const p of props) p.rotation.x += dt * 14;
    body.position.y = Math.sin(t * 0.6) * 0.8;
    body.rotation.z = Math.sin(t * 0.4) * 0.025;
    body.rotation.x = Math.sin(t * 0.33) * 0.02;
    lights[0].material.opacity = lights[1].material.opacity = (Math.sin(t * 4) > 0.2 ? 1 : 0.15);
    lights[2].material.opacity = (t % 1.6) < 0.12 ? 1 : 0.1;
    beamPivot.rotation.z = Math.sin(t * 0.35) * 0.55 - 0.15;
    beamPivot.rotation.x = Math.sin(t * 0.21) * 0.25;
  };
  return root;
}
