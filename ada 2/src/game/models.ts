import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { T } from './textures';
import { rng } from './terrain';

const rb = (w: number, h: number, l: number, r = 0.05) => new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, l / 2 - 0.001));
const mcache = new Map<string, THREE.Material>();
export function mat(key: string, f: () => THREE.Material): THREE.Material {
  let m = mcache.get(key);
  if (!m) { m = f(); mcache.set(key, m); }
  return m;
}
const std = (key: string, p: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial(p));
const gcache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, f: () => THREE.BufferGeometry) { let g = gcache.get(key); if (!g) { g = f(); gcache.set(key, g); } return g; }

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D, shadow = true) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent?.add(o); return o;
}

export interface Rider { group: THREE.Group; arm: THREE.Group; scarf: THREE.Group; head: THREE.Object3D }
export function createRider(accent: number, scale = 1, seated = true): Rider {
  const g = new THREE.Group();
  const cloth = std('ninja', { color: 0x16181d, roughness: 0.95 });
  const acc = std('acc' + accent, { color: accent, roughness: 0.8 });
  const skin = std('skin', { color: 0x1a1a1a, roughness: 0.9 });
  const torso = mesh(geo('capsule1', () => new THREE.CapsuleGeometry(0.17, 0.4, 4, 8)), cloth, 0, 0.55, 0, g);
  torso.rotation.x = seated ? 0.45 : 0.05;
  const belt = mesh(geo('belt', () => new THREE.CylinderGeometry(0.19, 0.19, 0.08, 10)), acc, 0, 0.36, 0.06, g); belt.rotation.x = 0.45;
  const head = new THREE.Group(); head.position.set(0, 0.98, seated ? 0.17 : 0.03); g.add(head);
  mesh(geo('head', () => new THREE.SphereGeometry(0.135, 10, 8)), cloth, 0, 0, 0, head);
  const band = mesh(geo('mask', () => new THREE.BoxGeometry(0.27, 0.07, 0.2)), std('maskband', { color: 0x8a7a66, roughness: 1 }), 0, 0.01, 0.07, head, false);
  void band;
  for (const sx of [-1, 1]) mesh(geo('eye', () => new THREE.BoxGeometry(0.05, 0.02, 0.02)), mat('eyeM', () => new THREE.MeshBasicMaterial({ color: 0xffe8c0 })), sx * 0.05, 0.015, 0.14, head, false);
  mesh(geo('hoodcap', () => new THREE.ConeGeometry(0.12, 0.2, 8)), cloth, 0, 0.14, -0.04, head).rotation.x = -0.5;
  const scarf = new THREE.Group(); scarf.position.set(0, 0.92, -0.04); g.add(scarf);
  for (let i = 0; i < 3; i++) { const s = mesh(geo('scarf', () => new THREE.BoxGeometry(0.1, 0.03, 0.28)), acc, 0, -i * 0.01, -0.14 - i * 0.26, scarf, false); s.rotation.x = i * 0.12; }
  const arm = new THREE.Group(); arm.position.set(-0.22, 0.78, 0.08); g.add(arm);
  mesh(geo('arm', () => new THREE.CapsuleGeometry(0.055, 0.34, 3, 6)), cloth, 0, 0, 0.18, arm).rotation.x = Math.PI / 2 - 0.2;
  const arm2 = new THREE.Group(); arm2.position.set(0.22, 0.78, 0.08); g.add(arm2);
  mesh(geo('arm', () => new THREE.CapsuleGeometry(0.055, 0.34, 3, 6)), cloth, 0, 0, 0.18, arm2).rotation.x = Math.PI / 2 - 0.2;
  for (const sx of [-1, 1]) { const l = mesh(geo('leg', () => new THREE.CapsuleGeometry(0.07, 0.4, 3, 6)), cloth, sx * 0.17, 0.2, 0.0, g); l.rotation.x = seated ? 1.0 : 0; }
  void skin;
  g.scale.setScalar(scale);
  return { group: g, arm, scarf, head };
}

function wheelMesh(r: number, w: number, dark = 0x101010, rim = 0x9a9a8a) {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [[0.12, -w / 2], [r * 0.82, -w / 2], [r * 0.98, -w * 0.3], [r, 0], [r * 0.98, w * 0.3], [r * 0.82, w / 2], [0.12, w / 2]].map((p) => new THREE.Vector2(p[0], p[1]));
  const tire = mesh(new THREE.LatheGeometry(pts, 14), std('tire' + dark, { map: T.tread(), color: 0x888888, roughness: 0.95 }), 0, 0, 0, g); tire.rotation.z = Math.PI / 2;
  const hub = mesh(geo('hub' + r, () => new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 0.9, 10)), std('rim' + rim, { color: rim, roughness: 0.6, metalness: 0.7 }), 0, 0, 0, g); hub.rotation.z = Math.PI / 2;
  return g;
}

export interface BikeRig { group: THREE.Group; lean: THREE.Group; wheels: THREE.Object3D[]; fork: THREE.Group; rider: Rider; flame: THREE.Mesh; hookGun: THREE.Object3D }
export function createBike(accent: number, seed = 1): BikeRig {
  const g = new THREE.Group();
  const lean = new THREE.Group(); g.add(lean);
  const r = rng(seed * 17);
  const bodyCols = [0x6a3b2a, 0x3d4a3a, 0x555a60, 0x7a6a3a, 0x4a3a2a];
  const paint = mat('bikepaint' + seed % 5, () => new THREE.MeshStandardMaterial({ map: T.paint(bodyCols[seed % 5], 20 + (seed % 5), 0.8), roughness: 0.7, metalness: 0.4 }));
  const steel = std('bikesteel', { color: 0x2a2a2d, roughness: 0.5, metalness: 0.8 });
  const rust = std('bikerust', { map: T.rust(), roughness: 0.9, metalness: 0.5 });
  mesh(geo('bframe', () => rb(0.18, 0.2, 1.1, 0.03)), steel, 0, 0.55, 0, lean);
  mesh(geo('btank', () => rb(0.32, 0.26, 0.5, 0.1)), paint, 0, 0.8, 0.22, lean);
  mesh(geo('bseat', () => rb(0.26, 0.1, 0.62, 0.04)), std('bseatm', { color: 0x1c1816, roughness: 0.9 }), 0, 0.72, -0.28, lean);
  mesh(geo('beng', () => rb(0.3, 0.3, 0.36, 0.05)), rust, 0, 0.42, 0.05, lean);
  mesh(geo('bexh', () => new THREE.CylinderGeometry(0.04, 0.05, 0.9, 8)), rust, 0.17, 0.35, -0.25, lean).rotation.x = Math.PI / 2 - 0.1;
  mesh(geo('bfender', () => rb(0.16, 0.04, 0.5, 0.02)), paint, 0, 0.82 - 0.4 + 0.0, -0.86, lean).position.y = 0.58;
  const fork = new THREE.Group(); fork.position.set(0, 0.85, 0.62); lean.add(fork);
  mesh(geo('bfork', () => new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6)), steel, 0, -0.35, 0.08, fork).rotation.x = -0.28;
  mesh(geo('bbar', () => new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6)), steel, 0, 0.0, 0, fork).rotation.z = Math.PI / 2;
  const lamp = mesh(geo('blamp', () => new THREE.SphereGeometry(0.1, 8, 6)), std('blampm', { color: 0xfff1cc, emissive: 0xffe0a0, emissiveIntensity: 1.2 }), 0, -0.06, 0.18, fork, false);
  void lamp;
  const wF = wheelMesh(0.34, 0.14); wF.position.set(0, -0.5, 0.2); fork.add(wF);
  const wR = wheelMesh(0.35, 0.18); wR.position.set(0, 0.35, -0.65); lean.add(wR);
  const rider = createRider(accent, 1);
  rider.group.position.set(0, 0.7, -0.22); lean.add(rider.group);
  const hookGun = new THREE.Group(); hookGun.position.set(0.25, 0.95, 0.1); lean.add(hookGun);
  mesh(geo('hg', () => rb(0.08, 0.1, 0.4, 0.02)), steel, 0, 0, 0.1, hookGun);
  mesh(geo('hgh', () => new THREE.ConeGeometry(0.05, 0.14, 6)), rust, 0, 0, 0.36, hookGun).rotation.x = Math.PI / 2;
  hookGun.visible = false;
  const flame = mesh(geo('flame', () => new THREE.ConeGeometry(0.06, 0.4, 6)), mat('flameM', () => new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })), 0.17, 0.3, -0.8, lean, false);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  void r;
  return { group: g, lean, wheels: [wF, wR], fork, rider, flame, hookGun };
}

export interface CarRig { group: THREE.Group; wheels: THREE.Object3D[]; fronts: THREE.Group[]; riders: Rider[]; hookGun: THREE.Object3D; turret: THREE.Group | null; flame: THREE.Mesh }
export function createRaiderCar(accent: number, seed = 1, boss = false): CarRig {
  const g = new THREE.Group();
  const cols = [0x6e2d22, 0x2f4a55, 0x555a46, 0x7c7468, 0x403a50];
  const base = boss ? 0x2b2d30 : cols[seed % 5];
  const paint = mat('carpaint' + base + (seed % 3), () => new THREE.MeshStandardMaterial({ map: T.paint(base, 30 + (seed % 3), boss ? 0.5 : 0.85), bumpMap: T.paintBump(), bumpScale: 1.5, roughness: 0.65, metalness: 0.45 }));
  const alt = mat('caralt' + (seed % 4), () => new THREE.MeshStandardMaterial({ map: T.paint([0x8a8a70, 0xa4412b, 0x4a6a8a, 0x777777][seed % 4], 40 + (seed % 4), 0.8), roughness: 0.7, metalness: 0.4 }));
  const steel = std('carsteel', { map: T.darkMetal(), color: 0xb0b0b0, roughness: 0.55, metalness: 0.85 });
  const glass = std('carglass', { color: 0x0e1618, roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.85 });
  const L = boss ? 6.2 : 4.3, W = boss ? 2.5 : 1.85, H = boss ? 1.2 : 0.62;
  const wr = boss ? 0.6 : 0.37;
  mesh(geo(`cb${boss}`, () => rb(W, H, L, 0.12)), paint, 0, wr + H / 2 + 0.12, 0, g);
  mesh(geo(`cc${boss}`, () => rb(W * 0.82, boss ? 0.9 : 0.55, L * 0.42, 0.12)), boss ? paint : alt, 0, wr + H + (boss ? 0.55 : 0.4), -L * 0.08, g);
  mesh(geo(`ch${boss}`, () => rb(W * 0.95, 0.12, L * 0.3, 0.04)), alt, 0, wr + H + 0.1, L * 0.3, g).scale.y = 1.2;
  for (const sx of [-1, 1]) {
    mesh(geo(`cw${boss}`, () => new THREE.PlaneGeometry(L * 0.3, boss ? 0.5 : 0.36)), glass, sx * (W * 0.41 + 0.01), wr + H + (boss ? 0.55 : 0.4), -L * 0.08, g, false).rotation.y = sx * Math.PI / 2;
  }
  mesh(geo(`cwf${boss}`, () => new THREE.PlaneGeometry(W * 0.7, boss ? 0.5 : 0.36)), glass, 0, wr + H + (boss ? 0.55 : 0.4), -L * 0.08 + L * 0.21 + 0.01, g, false);
  // tampon ve dikenler
  mesh(geo(`cbm${boss}`, () => rb(W + 0.1, 0.22, 0.28, 0.05)), steel, 0, wr + 0.05, L / 2 + 0.05, g);
  const spikes = boss ? 9 : 5;
  for (let i = 0; i < spikes; i++) mesh(geo('csp', () => new THREE.ConeGeometry(0.05, 0.3, 5)), steel, (i / (spikes - 1) - 0.5) * W, wr + 0.2, L / 2 + 0.28, g).rotation.x = Math.PI / 2;
  if (boss) {
    const plow = mesh(geo('plow', () => rb(W + 0.8, 1.0, 0.25, 0.05)), steel, 0, wr + 0.5, L / 2 + 0.35, g); plow.rotation.x = -0.45;
    for (let i = -2; i <= 2; i++) mesh(geo('bsp2', () => new THREE.ConeGeometry(0.1, 0.8, 6)), steel, i * 0.55, wr + 1.55, 0.6, g);
  }
  // far
  const lamp = std('carlamp', { color: 0xfff1cc, emissive: 0xffe0a0, emissiveIntensity: 1.5 });
  for (const sx of [-1, 1]) mesh(geo('clamp', () => new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10)), lamp, sx * W * 0.34, wr + H * 0.6 + 0.1, L / 2 - 0.02, g, false).rotation.x = Math.PI / 2;
  // tekerlekler
  const wheels: THREE.Object3D[] = [], fronts: THREE.Group[] = [];
  const axles = boss ? [L * 0.33, -L * 0.18, -L * 0.36] : [L * 0.32, -L * 0.32];
  axles.forEach((z, ai) => {
    for (const sx of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(sx * (W / 2 + 0.02), wr, z); g.add(p);
      const w = wheelMesh(wr, boss ? 0.5 : 0.24); p.add(w); wheels.push(w);
      if (ai === 0) fronts.push(p);
    }
  });
  // sürücüler
  const riders: Rider[] = [];
  const dr = createRider(accent, boss ? 1.4 : 1.0, false); dr.group.position.set(-W * 0.2, wr + H - 0.05 + (boss ? 0.2 : 0), -L * 0.08); dr.group.scale.multiplyScalar(0.9);
  g.add(dr.group); riders.push(dr);
  let turret: THREE.Group | null = null;
  if (boss || seed % 2 === 0) {
    const tr = createRider(boss ? 0xc0201a : accent, boss ? 1.5 : 1.05, false);
    tr.group.position.set(W * 0.15, wr + H + (boss ? 0.9 : 0.62), -L * 0.28); g.add(tr.group); riders.push(tr);
    turret = new THREE.Group(); turret.position.copy(tr.group.position); g.add(turret);
  }
  const hookGun = new THREE.Group(); hookGun.position.set(0, wr + H + 0.9, -L * 0.1); g.add(hookGun);
  mesh(geo('hgc', () => rb(0.2, 0.2, 0.6, 0.03)), steel, 0, 0, 0.2, hookGun);
  mesh(geo('hgcc', () => new THREE.ConeGeometry(0.08, 0.2, 6)), std('hrust', { map: T.rust() }), 0, 0, 0.6, hookGun).rotation.x = Math.PI / 2;
  hookGun.visible = false;
  // çatı bagajı / hurda
  if (!boss) mesh(geo('roofrack', () => rb(W * 0.7, 0.08, L * 0.3, 0.02)), steel, 0, wr + H + 0.7, -L * 0.1, g);
  // egzoz alevi (yanıyorsa)
  const flame = mesh(geo('cflame', () => new THREE.ConeGeometry(0.1, 0.8, 6)), mat('flameM', () => new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })), 0.5, wr, -L / 2 - 0.3, g, false);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  if (boss) { // bayrak
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d')!;
    x.fillStyle = '#7a1612'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#e8e0cc'; x.font = '78px serif'; x.textAlign = 'center'; x.fillText('☠', 64, 92);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const fl = mesh(new THREE.PlaneGeometry(1.0, 0.9), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 1 }), 0, wr + H + 2.4, -L * 0.4, g);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), steel, -0.5, wr + H + 1.5, -L * 0.4, g);
    fl.position.x = 0;
  }
  return { group: g, wheels, fronts, riders, hookGun, turret, flame };
}

// ---------------------------------------------------------------- toplanabilirler
export function createPickup(kind: 'scrap' | 'part' | 'fuel' | 'ammo'): THREE.Group {
  const g = new THREE.Group();
  const col = kind === 'scrap' ? 0xffc93a : kind === 'part' ? 0x57b8ff : kind === 'fuel' ? 0xff5a3a : 0x9aff6a;
  const metal = std('pk' + kind, { color: kind === 'scrap' ? 0x8a7a60 : kind === 'part' ? 0x6a7a8a : kind === 'fuel' ? 0xb8281c : 0x4a5a36, roughness: 0.5, metalness: 0.8 });
  const inner = new THREE.Group(); inner.name = 'spin'; g.add(inner);
  if (kind === 'scrap') {
    mesh(geo('gear', () => new THREE.CylinderGeometry(0.28, 0.28, 0.12, 14)), metal, 0, 0, 0, inner).rotation.x = Math.PI / 2;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const t = mesh(geo('gt', () => new THREE.BoxGeometry(0.1, 0.14, 0.12)), metal, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0, inner); t.rotation.z = a; }
    mesh(geo('gh', () => new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8)), std('gh', { color: 0x222 }), 0, 0, 0, inner).rotation.x = Math.PI / 2;
  } else if (kind === 'part') {
    mesh(geo('pbox', () => rb(0.55, 0.4, 0.4, 0.05)), metal, 0, 0, 0, inner);
    mesh(geo('pcyl', () => new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10)), std('pcy', { color: 0xc9c9c9, metalness: 0.9, roughness: 0.3 }), 0, 0.3, 0, inner);
  } else if (kind === 'fuel') {
    mesh(geo('can', () => rb(0.42, 0.55, 0.2, 0.05)), metal, 0, 0, 0, inner);
    mesh(geo('canh', () => new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8)), std('canc', { color: 0x222 }), 0.1, 0.32, 0, inner);
  } else {
    mesh(geo('abox', () => rb(0.5, 0.3, 0.32, 0.03)), metal, 0, 0, 0, inner);
    for (let i = 0; i < 5; i++) mesh(geo('bul', () => new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6)), std('bulm', { color: 0xc9a23a, metalness: 0.9, roughness: 0.3 }), -0.16 + i * 0.08, 0.2, 0, inner);
  }
  const glow = mesh(geo('pring', () => new THREE.RingGeometry(0.55, 0.75, 24)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, -0.55, 0, g, false);
  glow.rotation.x = -Math.PI / 2;
  const beam = mesh(geo('pbeam', () => new THREE.CylinderGeometry(0.05, 0.3, 3.5, 8, 1, true)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, 1.1, 0, g, false);
  void beam;
  return g;
}

// ---------------------------------------------------------------- yapılar
export function createHouse(seed: number): THREE.Group {
  const r = rng(seed * 13 + 5);
  const g = new THREE.Group();
  const w = 5 + r() * 3, d = 5 + r() * 3, h = 2.7 + r() * 0.5;
  const cols = [0xd8ccb0, 0xc9b79c, 0xb8c0b0, 0xc8a898, 0xa8b8c0];
  const wall = mat(`wall${seed % 5}`, () => new THREE.MeshStandardMaterial({ map: T.plaster(cols[seed % 5], seed % 5 + 1), roughness: 0.95 }));
  const roof = std('roof', { map: T.roofTile(), roughness: 0.85 });
  const dark = std('housedark', { color: 0x1b1a18, roughness: 0.8 });
  mesh(new THREE.BoxGeometry(w, h, d), wall, 0, h / 2, 0, g);
  // beşik çatı
  const rg = new THREE.BufferGeometry();
  const hw = w / 2 + 0.5, hd = d / 2 + 0.5, rh = 1.6;
  const v = [-hw, h, -hd, hw, h, -hd, 0, h + rh, -hd, -hw, h, hd, hw, h, hd, 0, h + rh, hd];
  const idx = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  rg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const uv = [0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1];
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rg.setIndex(idx); rg.computeVertexNormals();
  const roofM = mesh(rg, roof, 0, 0, 0, g); roofM.material = roof;
  (roof as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), wall, w * 0.25, h + 1.3, 0, g);
  // kapı pencere
  mesh(new THREE.BoxGeometry(1.0, 1.9, 0.12), std('door' + seed % 3, { color: [0x5a3a22, 0x2f4a5a, 0x6a2a22][seed % 3], roughness: 0.9 }), -w * 0.2, 0.95, d / 2 + 0.01, g);
  for (const sx of [0.22, -0.4]) {
    mesh(new THREE.BoxGeometry(0.9, 0.9, 0.12), mat('winlit', () => new THREE.MeshStandardMaterial({ color: 0x20262a, emissive: 0xffb050, emissiveIntensity: 0.0, roughness: 0.2, metalness: 0.5 })), sx * w + (sx > 0 ? 0.2 : 0.7) * 0, 1.6, d / 2 + 0.01, g, false);
  }
  mesh(new THREE.BoxGeometry(0.6, 0.6, 0.12), dark, w / 2 + 0.01, 1.6, 0.4, g).rotation.y = Math.PI / 2;
  // baraka eki
  if (r() > 0.4) mesh(new THREE.BoxGeometry(2.2, 1.9, 2.4), std('lean' + (seed % 3), { map: T.corrugated([0x6a7a6a, 0x7a5a4a, 0x5a6a7a][seed % 3]), roughness: 0.8, metalness: 0.4 }), w / 2 + 1.2, 0.95, -d * 0.2, g);
  return g;
}

export function createWreckCar(seed: number): THREE.Group {
  const r = rng(seed * 31 + 7);
  const g = new THREE.Group();
  const cols = [0x6e3a2a, 0x3a4a5a, 0x66665a, 0x7a6038, 0x2f3a2f];
  const burnt = r() > 0.6;
  const paint = mat(`wreck${seed % 5}${burnt}`, () => new THREE.MeshStandardMaterial({ map: T.paint(burnt ? 0x2a2420 : cols[seed % 5], 50 + seed % 5, 1), roughness: 0.85, metalness: 0.4 }));
  const rustM = std('wr', { map: T.rust(), roughness: 0.95, metalness: 0.4 });
  const glass = std('wglass', { color: 0x182024, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.7 });
  const bus = r() > 0.75;
  const L = bus ? 7 : 4.2, H = bus ? 1.9 : 0.65;
  mesh(rb(1.9, H, L, 0.1), paint, 0, 0.55 + H / 2, 0, g);
  if (!bus) mesh(rb(1.6, 0.52, 2.0, 0.1), paint, 0, 0.55 + H + 0.22, -0.3, g);
  if (!bus) mesh(new THREE.PlaneGeometry(1.5, 0.35), glass, 0, 0.55 + H + 0.25, 0.71, g, false);
  mesh(rb(1.5, 0.05, 1.7, 0.02), rustM, 0, 0.55 + H + (bus ? 0.0 : 0.5), 1.0, g).rotation.x = 0.1;
  for (const sx of [-1, 1]) for (const z of [L * 0.32, -L * 0.32]) {
    if (r() > 0.3) { const w = wheelMesh(0.36, 0.24); w.position.set(sx * 0.95, 0.36, z); w.rotation.z = r() * 0.1; g.add(w); } else mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), rustM, sx * 0.95, 0.15, z, g).rotation.z = Math.PI / 2;
  }
  g.rotation.z = (r() - 0.5) * 0.12; g.rotation.x = (r() - 0.5) * 0.06;
  return g;
}

export function createBarricade(): THREE.Group {
  const g = new THREE.Group();
  const wood = std('bwood', { map: T.wood(0x7a5a38), roughness: 0.9 });
  const rust = std('brust', { map: T.rust(), roughness: 0.9, metalness: 0.5 });
  for (let i = 0; i < 3; i++) mesh(rb(7.4, 0.28, 0.14, 0.03), wood, 0, 0.5 + i * 0.4, 0, g).rotation.z = (i - 1) * 0.04;
  for (const x of [-3.2, -1.1, 1.1, 3.2]) mesh(new THREE.BoxGeometry(0.2, 1.7, 0.2), wood, x, 0.85, 0, g).rotation.z = x * 0.01;
  for (const x of [-2.2, 2.2]) mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.95, 12), rust, x, 0.475, 0.6, g);
  for (let i = 0; i < 7; i++) { const s = mesh(new THREE.ConeGeometry(0.06, 0.5, 5), rust, -3 + i, 1.3, 0.12, g); s.rotation.x = Math.PI / 2 - 0.2; }
  return g;
}

export function signMesh(text: string, bg: string, fg: string, sub = ''): THREE.Group {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), std('signpole', { map: T.rust(), roughness: 0.9, metalness: 0.5 }), 0, 1.5, 0, g);
  const m = mesh(new THREE.BoxGeometry(1.8, 0.9, 0.06), new THREE.MeshStandardMaterial({ map: T.sign(text, bg, fg, sub), roughness: 0.6, metalness: 0.3 }), 0, 2.8, 0.05, g);
  m.rotation.z = (Math.random() - 0.5) * 0.08;
  return g;
}
