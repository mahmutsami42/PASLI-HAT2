import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { T } from './textures';
import { CargoType, Upgrades, derive } from './data';

export interface LooseBit { obj: THREE.Object3D; ang: number; vel: number; axis: 'x' | 'z'; base: number; k: number; gain: number }
export interface TruckRig {
  group: THREE.Group; body: THREE.Group; wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean; x: number; z: number }[];
  gunBase: THREE.Group; gunYaw: THREE.Group; gunPitch: THREE.Group; muzzle: THREE.Object3D; exhaust: THREE.Object3D; exhaust2: THREE.Object3D | null;
  headSpots: THREE.SpotLight[]; headMats: THREE.MeshStandardMaterial[]; tailMats: THREE.MeshStandardMaterial[]; cones: THREE.Mesh[];
  cargoPieces: { m: THREE.Mesh; rx: number; rz: number; y: number; order: number }[]; loose: LooseBit[]; magnet: THREE.Object3D | null;
  wheelR: number; mineDrop: THREE.Object3D; launcher: THREE.Object3D | null;
  setLights(on: boolean, spots: boolean): void; setBrake(b: number): void; setCargo(hp: number): void; updateLoose(dt: number, ax: number, az: number, vy: number): void; dispose(): void;
}

const rb = (w: number, h: number, l: number, r = 0.06) => new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, l / 2 - 0.001));

export function buildTruck(u: Upgrades, cargoType: CargoType | null, withSpots = true): TruckRig {
  const d = derive(u);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => { geos.push(g); return g; };
  const M = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };

  const paint = (hex: number, seed: number, rust: number, rough = 0.62) => M(new THREE.MeshStandardMaterial({ map: T.paint(hex, seed, rust), bumpMap: T.paintBump(), bumpScale: 1.6, roughness: rough, metalness: 0.38 }));
  const mBody = paint(0x4d7566, 1, 0.55);
  const mHood = paint(0xc2b178, 2, 0.6);
  const mDoorL = paint(0x3b6a9c, 3, 0.4);
  const mDoorR = paint(0xa4412b, 4, 0.5);
  const mFender = paint(0x7d776e, 5, 0.7);
  const mRoof = paint(0xcfc9b6, 6, 0.4);
  const mChassis = M(new THREE.MeshStandardMaterial({ map: T.darkMetal(), roughness: 0.8, metalness: 0.5 }));
  const mRust = M(new THREE.MeshStandardMaterial({ map: T.rust(), roughness: 0.85, metalness: 0.55 }));
  const mSteel = M(new THREE.MeshStandardMaterial({ map: T.darkMetal(), color: 0xb8bcc0, roughness: 0.45, metalness: 0.85 }));
  const mBlack = M(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7, metalness: 0.3 }));
  const mWood = M(new THREE.MeshStandardMaterial({ map: T.wood(0x8a6b45), roughness: 0.9 }));
  const mWoodDark = M(new THREE.MeshStandardMaterial({ map: T.wood(0x55402a), roughness: 0.95 }));
  const mGlass = M(new THREE.MeshStandardMaterial({ color: 0x0f1a1c, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.88 }));
  const mCrack = M(new THREE.MeshStandardMaterial({ map: T.glass(), transparent: true, roughness: 0.1, metalness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  const mTire = M(new THREE.MeshStandardMaterial({ map: T.tread(), color: 0x9a9a9a, roughness: 0.95, metalness: 0 }));
  T.tread().repeat.set(2, 1);
  const rimHex = u.tires >= 2 ? 0xc2331e : 0x8e8a7a;
  const mRim = M(new THREE.MeshStandardMaterial({ color: rimHex, roughness: 0.55, metalness: 0.7 }));

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  };

  // ---------------- şasi
  for (const sx of [-1, 1]) add(G(rb(0.16, 0.22, 6.6, 0.03)), mChassis, sx * 0.72, 0.8, -0.45);
  for (const z of [-3.4, -1.0, 0.9, 2.4]) add(G(rb(1.6, 0.14, 0.14, 0.03)), mChassis, 0, 0.8, z);
  const frontAxle = 1.95, rearAxle = -1.95;
  for (const z of [frontAxle, rearAxle]) {
    const ax = add(G(new THREE.CylinderGeometry(0.09, 0.09, 2.1, 10)), mChassis, 0, 0.55, z); ax.rotation.z = Math.PI / 2;
  }
  add(G(new THREE.SphereGeometry(0.28, 12, 10)), mChassis, 0, 0.55, rearAxle);
  for (const z of [frontAxle, rearAxle]) for (const sx of [-0.8, 0.8]) add(G(rb(0.1, 0.07, 1.3, 0.02)), mRust, sx, 0.72, z);
  // yakıt deposu (yardımcı sistem 3 ile büyür)
  const tankR = u.aux >= 3 ? 0.4 : 0.28;
  const tank = add(G(new THREE.CylinderGeometry(tankR, tankR, 1.1, 14)), mRust, 1.0, 0.95 - (u.aux >= 3 ? 0.02 : 0), -0.2);
  tank.rotation.x = Math.PI / 2;
  // egzoz borusu (sağ = -x)
  add(G(new THREE.CylinderGeometry(0.065, 0.065, 1.7, 8)), mRust, -1.2, 1.9, -0.62);
  add(G(new THREE.CylinderGeometry(0.085, 0.07, 0.12, 8)), mBlack, -1.2, 2.78, -0.62);
  const lowPipe = add(G(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8)), mRust, -1.0, 0.82, 0.0); lowPipe.rotation.x = Math.PI / 2;
  const exhaust = new THREE.Object3D(); exhaust.position.set(-1.2, 2.9, -0.62); body.add(exhaust);
  let exhaust2: THREE.Object3D | null = null;
  if (u.engine >= 3) {
    add(G(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8)), mSteel, 1.2, 1.85, -0.62);
    exhaust2 = new THREE.Object3D(); exhaust2.position.set(1.2, 2.62, -0.62); body.add(exhaust2);
  }

  // ---------------- kabin ve kaput
  const cab = add(G(rb(2.2, 1.45, 1.6, 0.14)), mBody, 0, 1.78, 0.3);
  cab.name = 'cab';
  add(G(rb(2.26, 0.1, 1.72, 0.05)), mRoof, 0, 2.52, 0.3);
  add(G(rb(2.0, 0.82, 1.75, 0.12)), mHood, 0, 1.46, 1.9);
  add(G(rb(0.7, 0.1, 1.25, 0.04)), mHood, 0, 1.92, 1.95);
  // çamurluklar
  for (const sx of [-1, 1]) {
    add(G(rb(0.5, 0.16, 1.45, 0.06)), mFender, sx * 1.12, 1.18, frontAxle);
    add(G(rb(0.12, 0.5, 1.4, 0.05)), mFender, sx * 1.34, 0.98, frontAxle);
    const arch = add(G(new THREE.TorusGeometry(0.7, 0.045, 6, 18, Math.PI)), mBlack, sx * 1.36, 0.58, frontAxle); arch.rotation.y = Math.PI / 2;
  }
  // ızgara ve farlar
  add(G(rb(1.55, 0.72, 0.1, 0.03)), mChassis, 0, 1.44, 2.78);
  for (let i = 0; i < 6; i++) add(G(new THREE.BoxGeometry(1.5, 0.045, 0.06)), mSteel, 0, 1.2 + i * 0.1, 2.84);
  const mHead = M(new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe6a0, emissiveIntensity: 0.3, roughness: 0.15, metalness: 0.2 }));
  const headMats = [mHead];
  for (const sx of [-1, 1]) {
    const h = add(G(new THREE.CylinderGeometry(0.17, 0.2, 0.16, 16)), mHead, sx * 0.78, 1.52, 2.82); h.rotation.x = Math.PI / 2;
    const ring = add(G(new THREE.TorusGeometry(0.19, 0.03, 6, 16)), mSteel, sx * 0.78, 1.52, 2.9);
    ring.rotation.x = 0;
  }
  // tampon
  const bumperZ = 3.05;
  if (u.bumper === 0) {
    add(G(rb(2.3, 0.26, 0.28, 0.05)), mRust, 0, 0.9, bumperZ);
    const hook = add(G(new THREE.TorusGeometry(0.06, 0.02, 6, 10)), mBlack, 0.5, 0.82, bumperZ + 0.17); hook.rotation.y = 0.4;
  } else {
    add(G(rb(2.4, 0.34, 0.34, 0.07)), mSteel, 0, 0.9, bumperZ + 0.02);
    add(G(rb(2.1, 0.12, 0.2, 0.04)), mChassis, 0, 0.66, bumperZ - 0.05);
    for (const sx of [-0.9, 0.9]) add(G(new THREE.CylinderGeometry(0.045, 0.045, 0.85, 8)), mSteel, sx, 1.22, bumperZ + 0.12);
    if (u.bumper >= 2) { const bar = add(G(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 8)), mSteel, 0, 1.62, bumperZ + 0.12); bar.rotation.z = Math.PI / 2; add(G(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6)), mSteel, 0, 1.3, bumperZ + 0.12); }
    if (u.bumper >= 3) for (let i = -3; i <= 3; i++) { const sp = add(G(new THREE.ConeGeometry(0.05, 0.28, 6)), mSteel, i * 0.31, 0.9, bumperZ + 0.3); sp.rotation.x = Math.PI / 2; }
    if (u.bumper >= 4) {
      const wedge = add(G(rb(2.5, 0.55, 0.3, 0.06)), mChassis, 0, 1.0, bumperZ + 0.18); wedge.rotation.x = -0.35;
      const winch = add(G(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10)), mBlack, 0, 0.62, bumperZ + 0.12); winch.rotation.z = Math.PI / 2;
    }
    if (u.bumper >= 2) for (const sx of [-0.55, 0.55]) { const l = add(G(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12)), mHead, sx, 1.62, bumperZ + 0.2); l.rotation.x = Math.PI / 2; headMats.push(mHead); }
  }
  // camlar
  const ws = add(G(new THREE.PlaneGeometry(1.95, 0.78)), mGlass, 0, 2.12, 1.112); ws.castShadow = false;
  const wsCrack = add(G(new THREE.PlaneGeometry(1.95, 0.78)), mCrack, 0, 2.12, 1.118); wsCrack.castShadow = false;
  for (const sx of [-1, 1]) {
    const sw = add(G(new THREE.PlaneGeometry(1.0, 0.62)), mGlass, sx * 1.112, 2.12, 0.5); sw.rotation.y = sx * Math.PI / 2; sw.castShadow = false;
    // kapılar (farklı renk)
    const door = add(G(rb(0.07, 1.18, 1.18, 0.03)), sx > 0 ? mDoorL : mDoorR, sx * 1.14, 1.64, 0.52);
    door.castShadow = false;
    add(G(new THREE.BoxGeometry(0.06, 0.05, 0.22)), mBlack, sx * 1.19, 1.78, 0.2);
    add(G(rb(0.4, 0.07, 0.9, 0.02)), mChassis, sx * 1.22, 0.98, 0.45); // basamak
    // ayna
    add(G(new THREE.CylinderGeometry(0.015, 0.015, 0.38, 5)), mBlack, sx * 1.34, 2.15, 1.0).rotation.z = 0.7 * sx;
    if (!(sx < 0 && true)) add(G(rb(0.07, 0.3, 0.18, 0.02)), mBlack, sx * 1.5, 2.34, 1.05);
    // silecek
    // dent / ezik izleri
    const dent = new THREE.Mesh(G(new THREE.CircleGeometry(0.22, 12)), M(new THREE.MeshBasicMaterial({ map: T.soft(), color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })));
    dent.position.set(sx * 1.185, 1.4, 0.78); dent.rotation.y = sx * Math.PI / 2; body.add(dent);
  }
  // sağ kapıyı kırık ayna için sallan
  const brokenMirror = add(G(rb(0.07, 0.3, 0.18, 0.02)), mBlack, -1.5, 2.2, 1.05);
  brokenMirror.rotation.z = 0.5;
  for (const dx of [-0.5, 0.5]) { const wp = add(G(new THREE.BoxGeometry(0.02, 0.02, 0.6)), mBlack, dx, 1.76, 1.15); wp.rotation.x = 0; wp.position.y = 1.78; wp.rotation.z = dx * 0.4; }
  // arka cam
  const rw = add(G(new THREE.PlaneGeometry(1.2, 0.5)), mGlass, 0, 2.12, -0.508); rw.rotation.y = Math.PI; rw.castShadow = false;
  // sürücü silüeti
  add(G(new THREE.SphereGeometry(0.13, 10, 8)), M(new THREE.MeshStandardMaterial({ color: 0xc2967a, roughness: 0.8 })), 0.42, 2.05, 0.45);
  add(G(rb(0.4, 0.4, 0.2, 0.06)), M(new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.9 })), 0.42, 1.78, 0.42);
  add(G(new THREE.CylinderGeometry(0.15, 0.17, 0.08, 10)), M(new THREE.MeshStandardMaterial({ color: 0x8a3b24, roughness: 0.9 })), 0.42, 2.17, 0.45);

  // ---------------- kasa
  const bedZ = -2.2, bedLen = 3.6;
  add(G(rb(2.3, 0.14, bedLen, 0.03)), mWoodDark, 0, 1.08, bedZ);
  const side = u.cargo >= 3 ? 0.62 : 0.5;
  const sideMat = u.cargo >= 3 ? mFender : mWood;
  for (const sx of [-1, 1]) {
    add(G(rb(0.07, side, bedLen, 0.02)), sideMat, sx * 1.14, 1.12 + side / 2, bedZ);
    for (const z of [bedZ + bedLen / 2 - 0.05, bedZ, bedZ - bedLen / 2 + 0.05]) add(G(new THREE.BoxGeometry(0.1, side + 0.3, 0.1)), mChassis, sx * 1.17, 1.12 + side / 2 + 0.1, z);
    // tekerlek davlumbazı
    add(G(rb(0.5, 0.26, 1.2, 0.08)), mFender, sx * 0.92, 1.28, rearAxle);
  }
  add(G(rb(2.3, 0.95, 0.09, 0.03)), mRust, 0, 1.55, -0.52);
  const tail = add(G(rb(2.3, side * 0.85, 0.07, 0.02)), sideMat, 0, 1.15 + side * 0.4, bedZ - bedLen / 2);
  tail.rotation.x = 0.04;
  // arka tekerlekler için dolgu
  for (const sx of [-1, 1]) add(G(rb(0.12, 0.6, 1.5, 0.05)), mFender, sx * 1.33, 0.95, rearAxle);
  if (u.cargo >= 2) { // branda çerçevesi
    for (const z of [bedZ + 1.3, bedZ, bedZ - 1.3]) {
      const arc = add(G(new THREE.TorusGeometry(1.1, 0.025, 6, 16, Math.PI)), mSteel, 0, 1.2 + side, z);
      arc.scale.y = 0.55;
    }
    if (u.cargo >= 2 && u.cargo < 4) {
      const tarp = add(G(rb(2.0, 0.05, 1.5, 0.02)), M(new THREE.MeshStandardMaterial({ color: 0x5d6048, roughness: 1 })), 0, 1.15 + side + 0.52, bedZ + 0.35);
      tarp.rotation.z = 0.0;
    }
  }
  if (u.cargo >= 4) add(G(rb(2.0, 0.08, 3.4, 0.03)), mSteel, 0, 1.2 + side + 0.62, bedZ);
  // kargo
  const cargoPieces: TruckRig['cargoPieces'] = [];
  const slots: [number, number, number][] = [[0.55, -1.2, 0], [-0.55, -1.2, 0], [0.55, -2.25, 0], [-0.55, -2.25, 0], [0, -1.2, 1], [0, -2.25, 1]];
  if (cargoType) {
    const n = d.crates;
    const sz = cargoType === 'fragile' ? 0.8 : 0.92;
    const cm = M(new THREE.MeshStandardMaterial({ map: T.crate(cargoType), roughness: 0.85, metalness: 0.05 }));
    slots.slice(0, n).forEach((s, i) => {
      const m = add(G(cargoType === 'fragile' ? rb(sz, sz * 0.9, sz, 0.06) : new THREE.BoxGeometry(sz, sz, sz)), cm.clone(), s[0], 1.15 + sz / 2 + s[2] * sz + (cargoType === 'fragile' ? -0.03 : 0), s[1]);
      mats.push(m.material as THREE.Material);
      m.rotation.y = (i % 2 ? 1 : -1) * 0.05 * (i + 1);
      cargoPieces.push({ m, rx: 0, rz: 0, y: m.position.y, order: i });
    });
    // halat
    const rope = add(G(new THREE.CylinderGeometry(0.015, 0.015, 2.4, 5)), mBlack, 0, 1.15 + sz + 0.02, -1.7); rope.rotation.z = Math.PI / 2;
  }

  // ---------------- zırh
  const mArmor = M(new THREE.MeshStandardMaterial({ map: T.darkMetal(), color: 0xaaa090, roughness: 0.6, metalness: 0.8 }));
  if (u.armor >= 1) {
    for (const sx of [-1, 1]) { add(G(rb(0.05, 0.5, 0.55, 0.01)), mArmor, sx * 1.2, 1.55, 0.7); add(G(rb(0.05, 0.3, 0.4, 0.01)), mArmor, sx * 1.2, 1.9, 0.15).rotation.x = 0.15; }
  }
  if (u.armor >= 2) {
    add(G(rb(1.6, 0.06, 1.2, 0.02)), mArmor, 0, 1.99, 2.0);
    for (const sx of [-1, 1]) { add(G(rb(0.06, 0.55, 1.4, 0.02)), mArmor, sx * 1.25, 1.1, 1.95); add(G(rb(0.06, 0.4, 1.6, 0.02)), mArmor, sx * 1.2, 1.45, -2.2); }
  }
  if (u.armor >= 3) {
    for (let i = 0; i < 4; i++) add(G(new THREE.BoxGeometry(2.0, 0.045, 0.06)), mArmor, 0, 1.82 + i * 0.17 + 0.0, 1.16);
    for (const sx of [-0.9, 0, 0.9]) add(G(new THREE.BoxGeometry(0.05, 0.75, 0.06)), mArmor, sx, 2.12, 1.16);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) add(G(new THREE.BoxGeometry(0.05, 0.05, 0.95)), mArmor, sx * 1.17, 1.95 + i * 0.17, 0.5);
  }
  if (u.armor >= 4) {
    add(G(rb(2.3, 0.07, 1.75, 0.03)), mArmor, 0, 2.6, 0.3);
    for (const sx of [-1, 1]) add(G(rb(0.07, 0.4, 3.2, 0.02)), mArmor, sx * 1.22, 0.78, -0.4);
    add(G(rb(1.6, 0.8, 0.07, 0.02)), mArmor, 0, 1.75, -0.6);
    for (let i = 0; i < 5; i++) { const sp = add(G(new THREE.ConeGeometry(0.04, 0.2, 5)), mArmor, -1.1 + i * 0.55, 2.7, 1.0); sp.rotation.x = 0.2; }
  }

  // ---------------- motor görselleri
  if (u.engine >= 1) { add(G(rb(0.5, 0.18, 0.6, 0.05)), mChassis, 0, 2.02, 1.7); add(G(rb(0.4, 0.06, 0.15, 0.02)), mBlack, 0, 2.1, 1.95); }
  if (u.engine >= 2) { const t = add(G(new THREE.CylinderGeometry(0.17, 0.12, 0.3, 12)), mSteel, 0.55, 1.98, 2.2); t.rotation.z = 0.1; add(G(new THREE.TorusGeometry(0.17, 0.03, 6, 12)), mRust, 0.55, 2.13, 2.2).rotation.x = Math.PI / 2; }
  if (u.engine >= 4) add(G(rb(0.45, 0.3, 0.6, 0.08)), mSteel, -0.45, 2.1, 2.1);
  const mBlue = M(new THREE.MeshStandardMaterial({ color: 0x2b7fd8, roughness: 0.35, metalness: 0.7, emissive: 0x0b2a55, emissiveIntensity: 0.4 }));
  for (let i = 0; i < Math.min(3, u.engine); i++) {
    const tnk = add(G(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 12)), mBlue, 1.3, 1.5 + i * 0.01, -0.85 - i * 0.28); tnk.rotation.x = Math.PI / 2;
    add(G(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6)), mSteel, 1.3, 1.5, -0.4 - i * 0.28).rotation.x = Math.PI / 2;
  }

  // ---------------- yardımcı sistemler
  let magnet: THREE.Object3D | null = null;
  if (u.aux >= 1) {
    add(G(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6)), mChassis, 0, 2.8, 0.3);
    magnet = new THREE.Group(); magnet.position.set(0, 3.1, 0.3); body.add(magnet);
    const disc = new THREE.Mesh(G(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 20)), M(new THREE.MeshStandardMaterial({ color: 0xd9a21a, roughness: 0.5, metalness: 0.6 })));
    const ring = new THREE.Mesh(G(new THREE.TorusGeometry(0.34, 0.04, 6, 20)), mBlack); ring.rotation.x = Math.PI / 2; ring.position.y = -0.05;
    magnet.add(disc, ring); disc.castShadow = true;
  }
  if (u.aux >= 2) {
    const kit = add(G(rb(0.5, 0.32, 0.3, 0.03)), M(new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 })), -1.2, 1.5, -1.0);
    add(G(new THREE.BoxGeometry(0.05, 0.18, 0.2)), M(new THREE.MeshStandardMaterial({ color: 0xc02a1e })), -1.235, 1.5, -1.0);
    add(G(new THREE.BoxGeometry(0.05, 0.06, 0.4)), M(new THREE.MeshStandardMaterial({ color: 0xc02a1e })), -1.235, 1.5, -1.0).scale.z = 0.01;
    void kit;
  }
  if (u.aux >= 3) { for (const z of [-3.0, -3.3]) add(G(rb(0.4, 0.5, 0.18, 0.04)), M(new THREE.MeshStandardMaterial({ color: 0xa6281d, roughness: 0.55, metalness: 0.4 })), -1.2, 1.4, z); }
  if (u.aux >= 4) {
    for (let i = -1; i <= 1; i++) add(G(rb(0.28, 0.1, 0.12, 0.03)), M(new THREE.MeshStandardMaterial({ color: 0xe2a620, emissive: 0xaa6a00, emissiveIntensity: 0.5 })), i * 0.4, 2.68, 0.9);
    add(G(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 4)), mBlack, 1.05, 3.1, -0.4);
  }

  // ---------------- tekerlekler
  const wheels: TruckRig['wheels'] = [];
  const wr = d.wheelR;
  const tw = 0.34 + u.tires * 0.03;
  const mkWheel = () => {
    const spin = new THREE.Group();
    const pts: THREE.Vector2[] = [];
    const prof: [number, number][] = [[0.3, -tw / 2], [wr * 0.84, -tw / 2 - 0.02], [wr * 0.97, -tw / 2 + 0.04], [wr, -tw * 0.22], [wr, tw * 0.22], [wr * 0.97, tw / 2 - 0.04], [wr * 0.84, tw / 2 + 0.02], [0.3, tw / 2]];
    prof.forEach((p) => pts.push(new THREE.Vector2(p[0], p[1])));
    const tire = new THREE.Mesh(G(new THREE.LatheGeometry(pts, 26)), mTire); tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
    const rim = new THREE.Mesh(G(new THREE.CylinderGeometry(0.31, 0.31, tw * 0.85, 16)), mRim); rim.rotation.z = Math.PI / 2; spin.add(rim);
    for (const s of [-1, 1]) {
      const hub = new THREE.Mesh(G(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10)), mSteel); hub.rotation.z = Math.PI / 2; hub.position.x = s * tw * 0.45; spin.add(hub);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const nut = new THREE.Mesh(G(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 5)), mBlack); nut.rotation.z = Math.PI / 2; nut.position.set(s * tw * 0.47, Math.cos(a) * 0.17, Math.sin(a) * 0.17); spin.add(nut); }
      if (u.tires >= 2) { const bl = new THREE.Mesh(G(new THREE.TorusGeometry(0.31, 0.02, 5, 18)), mSteel); bl.rotation.y = Math.PI / 2; bl.position.x = s * tw * 0.44; spin.add(bl); }
    }
    // jant çamuru
    const mud = new THREE.Mesh(G(new THREE.CylinderGeometry(wr * 1.001, wr * 1.001, tw * 0.5, 20, 1, true, 0, 2.2)), M(new THREE.MeshStandardMaterial({ color: 0x5b4630, roughness: 1, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
    mud.rotation.z = Math.PI / 2; spin.add(mud);
    return spin;
  };
  const wpos: [number, number, boolean][] = [[0.98, frontAxle, true], [-0.98, frontAxle, true], [0.98, rearAxle, false], [-0.98, rearAxle, false]];
  for (const [x, z, front] of wpos) {
    const pivot = new THREE.Group(); pivot.position.set(x, wr, z);
    const spin = mkWheel(); pivot.add(spin); group.add(pivot);
    wheels.push({ pivot, spin, front, x, z });
  }
  // çift arka tekerlek (iç)
  for (const x of [1.0 + tw + 0.02, -1.0 - tw - 0.02]) {
    const pivot = new THREE.Group(); pivot.position.set(x * 0.74 + (x > 0 ? 0.35 : -0.35) * 0, wr, rearAxle);
    pivot.position.x = x > 0 ? 1.0 - tw - 0.01 : -1.0 + tw + 0.01;
    const spin = mkWheel(); pivot.add(spin); group.add(pivot);
    wheels.push({ pivot, spin, front: false, x: pivot.position.x, z: rearAxle });
  }
  // yedek lastik
  const spare = add(G(new THREE.CylinderGeometry(wr * 0.9, wr * 0.9, 0.3, 18)), mTire, 0, 1.05, -4.0 + 0.05); spare.rotation.x = Math.PI / 2; spare.position.set(0, 0.95, -0.0);
  spare.position.set(0, 0.62, -3.78); spare.rotation.x = Math.PI / 2 + 0.1;

  // ---------------- farlar & stop lambaları
  const headSpots: THREE.SpotLight[] = [];
  const cones: THREE.Mesh[] = [];
  const coneMat = M(new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  for (const sx of [-1, 1]) {
    if (withSpots) {
      const s = new THREE.SpotLight(0xfff0cc, 0, 70, 0.5, 0.55, 1.3); s.position.set(sx * 0.78, 1.5, 2.9); s.target.position.set(sx * 0.6, 0.6, 20);
      body.add(s, s.target); s.visible = false; headSpots.push(s);
    }
    const cone = new THREE.Mesh(G(new THREE.ConeGeometry(2.4, 14, 14, 1, true)), coneMat); cone.rotation.x = -Math.PI / 2; cone.position.set(sx * 0.78, 1.4, 3.0 + 7); cone.visible = false; body.add(cone); cones.push(cone);
  }
  const mTail = M(new THREE.MeshStandardMaterial({ color: 0x7a0e0e, emissive: 0xff1010, emissiveIntensity: 0.15, roughness: 0.3 }));
  for (const sx of [-1, 1]) add(G(rb(0.28, 0.16, 0.08, 0.02)), mTail, sx * 0.95, 1.3, bedZ - bedLen / 2 - 0.06);
  add(G(new THREE.BoxGeometry(0.4, 0.15, 0.02)), M(new THREE.MeshStandardMaterial({ map: T.sign('PL 34 AD', '#d8d2b4', '#222'), roughness: 0.7 })), 0.0, 1.0, bedZ - bedLen / 2 - 0.06).rotation.y = Math.PI;
  const mudflapMat = M(new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 }));

  // ---------------- gevşek parçalar
  const loose: LooseBit[] = [];
  for (const sx of [-1, 1]) {
    for (const z of [frontAxle - 0.75, rearAxle - 0.8]) {
      const piv = new THREE.Group(); piv.position.set(sx * 1.3, 0.6, z); body.add(piv);
      const flap = new THREE.Mesh(G(new THREE.BoxGeometry(0.4, 0.4, 0.03)), mudflapMat); flap.position.y = -0.2; flap.castShadow = true; piv.add(flap);
      loose.push({ obj: piv, ang: 0, vel: 0, axis: 'x', base: 0, k: 38, gain: 0.5 });
    }
  }
  { // sarkan zincir / kırık stop kablosu
    const piv = new THREE.Group(); piv.position.set(0.7, 1.2, bedZ - bedLen / 2 - 0.1); body.add(piv);
    const ch = new THREE.Mesh(G(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4)), mBlack); ch.position.y = -0.25; piv.add(ch);
    loose.push({ obj: piv, ang: 0, vel: 0, axis: 'x', base: 0, k: 22, gain: 0.8 });
  }
  { // gevşek kırık ayna
    loose.push({ obj: brokenMirror, ang: 0, vel: 0, axis: 'z', base: 0.5, k: 60, gain: 0.3 });
  }
  { // anten
    const piv = new THREE.Group(); piv.position.set(-1.0, 2.55, -0.3); body.add(piv);
    const a = new THREE.Mesh(G(new THREE.CylinderGeometry(0.008, 0.012, 1.6, 4)), mBlack); a.position.y = 0.8; piv.add(a);
    loose.push({ obj: piv, ang: 0, vel: 0, axis: 'z', base: 0, k: 30, gain: 0.25 });
  }
  { // gevşek ön çamurluk köşesi
    const piv = new THREE.Group(); piv.position.set(1.4, 1.2, 2.5); body.add(piv);
    const f = new THREE.Mesh(G(rb(0.3, 0.05, 0.5, 0.01)), mFender); f.position.set(0, 0, 0.2); f.castShadow = true; piv.add(f);
    loose.push({ obj: piv, ang: 0, vel: 0, axis: 'z', base: 0, k: 70, gain: 0.2 });
  }

  // ---------------- silah düzeneği
  const gunBase = new THREE.Group(); gunBase.position.set(0, 1.62, bedZ - bedLen / 2 + 0.55); gunBase.rotation.y = Math.PI; body.add(gunBase);
  add(G(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 10)), mChassis, 0, 0.0, 0, gunBase);
  add(G(rb(0.9, 0.08, 0.9, 0.03)), mChassis, 0, -0.3, 0, gunBase);
  const gunYaw = new THREE.Group(); gunYaw.position.y = 0.3; gunBase.add(gunYaw);
  const gunPitch = new THREE.Group(); gunYaw.add(gunPitch);
  const mGun = M(new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.4, metalness: 0.85 }));
  const mStock = M(new THREE.MeshStandardMaterial({ map: T.wood(0x6b4a2c), roughness: 0.8 }));
  const wlv = u.weapon;
  const barrelLen = [1.2, 1.1, 1.0, 0.75, 1.15][wlv];
  const br = add(G(new THREE.CylinderGeometry(wlv === 4 ? 0.05 : 0.028, wlv === 4 ? 0.05 : 0.028, barrelLen, 10)), mGun, 0, 0, barrelLen / 2 + 0.1, gunPitch); br.rotation.x = Math.PI / 2;
  add(G(rb(0.09, 0.13, 0.55, 0.02)), wlv === 0 || wlv === 1 ? mStock : mGun, 0, -0.03, -0.12, gunPitch);
  if (wlv === 0) { add(G(rb(0.07, 0.06, 0.28, 0.01)), mStock, 0, 0.0, 0.2, gunPitch); }
  if (wlv === 1) { const pump = add(G(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8)), mStock, 0, -0.08, 0.5, gunPitch); pump.rotation.x = Math.PI / 2; }
  if (wlv >= 2) { add(G(rb(0.06, 0.3, 0.12, 0.01)), mGun, 0, -0.2, 0.18, gunPitch); }
  if (wlv === 3) { const drum = add(G(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 14)), mGun, 0, -0.22, 0.3, gunPitch); drum.rotation.z = Math.PI / 2; }
  if (wlv >= 2) { // kalkan
    add(G(rb(0.7, 0.55, 0.05, 0.02)), mArmor, 0, 0.1, 0.15 + (wlv === 4 ? 0.25 : 0), gunYaw);
  }
  if (wlv === 4) {
    const jacket = add(G(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 10)), mChassis, 0, 0, 0.55, gunPitch); jacket.rotation.x = Math.PI / 2;
    add(G(rb(0.28, 0.2, 0.32, 0.03)), M(new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.7, metalness: 0.5 })), 0.22, -0.1, 0.0, gunPitch);
    for (let i = 0; i < 4; i++) add(G(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 5)), M(new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.9, roughness: 0.3 })), 0.14 + i * 0.01, -0.02 - i * 0.025, 0.0, gunPitch).rotation.z = 1;
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, barrelLen + 0.15); gunPitch.add(muzzle);

  // ---------------- patlayıcı sistem
  const mineDrop = new THREE.Object3D(); mineDrop.position.set(0, 0.7, bedZ - bedLen / 2 - 0.4); body.add(mineDrop);
  let launcher: THREE.Object3D | null = null;
  if (u.explosive >= 1) {
    add(G(rb(0.9, 0.06, 0.45, 0.02)), mChassis, 0, 0.7, bedZ - bedLen / 2 - 0.3);
    for (let i = 0; i < Math.min(u.explosive + 1, 4); i++) add(G(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14)), M(new THREE.MeshStandardMaterial({ color: 0x4a5b36, roughness: 0.6, metalness: 0.5 })), -0.32 + i * 0.22, 0.77 + (i % 2) * 0.0, bedZ - bedLen / 2 - 0.3);
  }
  if (u.explosive >= 2) {
    launcher = new THREE.Group(); launcher.position.set(1.05, 2.0, -1.0); body.add(launcher);
    const cnt = u.explosive >= 4 ? 3 : u.explosive >= 3 ? 2 : 1;
    for (let i = 0; i < cnt; i++) {
      const tube = new THREE.Mesh(G(new THREE.CylinderGeometry(0.09, 0.1, 0.9, 10)), mChassis); tube.rotation.x = -Math.PI / 2 - 0.5; tube.position.set(-0.0 + i * 0.22 - (cnt - 1) * 0.11, 0.0, -0.3); tube.castShadow = true; launcher.add(tube);
    }
    const stand = new THREE.Mesh(G(rb(0.7, 0.1, 0.4, 0.02)), mChassis); stand.position.y = -0.2; launcher.add(stand);
    launcher.position.set(0, 1.95, -0.62); launcher.rotation.y = Math.PI;
  }

  // ---------------- kargo görsel hasarı
  const setCargo = (hp: number) => {
    const n = cargoPieces.length;
    cargoPieces.forEach((p, i) => {
      const mat = p.m.material as THREE.MeshStandardMaterial;
      const f = Math.max(0.25, hp / 100);
      mat.color.setScalar(0.35 + 0.65 * f);
      const keep = hp > 0 ? Math.ceil((hp / 100) * n - 0.01) : 0;
      p.m.visible = i < Math.max(keep, hp > 0 ? 1 : 0);
      const dmg = 1 - hp / 100;
      p.m.rotation.z = (i % 2 ? 1 : -1) * dmg * 0.35;
      p.m.rotation.x = ((i % 3) - 1) * dmg * 0.25;
      p.m.position.y = p.y - dmg * 0.06;
      p.m.scale.y = 1 - dmg * 0.18;
    });
  };
  const setLights = (on: boolean, spots: boolean) => {
    headMats.forEach((m) => (m.emissiveIntensity = on ? 3.2 : 0.3));
    headSpots.forEach((s) => { s.visible = on && spots; s.intensity = on ? 90 : 0; });
    cones.forEach((c) => (c.visible = on));
  };
  const setBrake = (b: number) => { mTail.emissiveIntensity = 0.15 + b * 2.4; };
  const updateLoose = (dt: number, ax: number, az: number, vy: number) => {
    for (const l of loose) {
      const inp = (l.axis === 'x' ? -az * 0.04 : ax * 0.04) + vy * 0.03;
      l.vel += (-l.k * l.ang - 2.2 * l.vel + inp * l.k * l.gain * 4) * dt;
      l.ang += l.vel * dt;
      l.ang = Math.max(-0.9, Math.min(0.9, l.ang));
      if (l.axis === 'x') l.obj.rotation.x = l.base + l.ang; else l.obj.rotation.z = l.base + l.ang;
    }
  };
  const dispose = () => {
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
    headSpots.forEach((s) => s.dispose());
  };
  return { group, body, wheels, gunBase, gunYaw, gunPitch, muzzle, exhaust, exhaust2, headSpots, headMats, tailMats: [mTail], cones, cargoPieces, loose, magnet, wheelR: wr, mineDrop, launcher, setLights, setBrake, setCargo, updateLoose, dispose };
}
