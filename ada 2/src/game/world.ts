import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BRIDGE, POIS, QUARRY_PIT, WORLD_HALF, Hazard, buildHazards, buildWorld, clamp, fbm, groundY, hazards, lerp, nearestSample, rng,
  riverX, roadIdx, roadMeta, roadWeight, samples, smoothstep, terrainH, vnoise,
} from './terrain';
import { T } from './textures';
import { createBarricade, createHouse, createWreckCar, mat, signMesh } from './models';
import type { Quality, TimeOfDay, Weather } from './data';

export const CHUNK = 100;
const ckey = (i: number, j: number) => (i + 20) * 100 + (j + 20);

interface QP { radius: number; unload: number; tree: number; treeHi: number; treeLo: number; bushD: number; grassD: number; grass: number; shadows: boolean; rockD: number; terrN: number }
export const QUALITY: Record<Quality, QP> = {
  low: { radius: 260, unload: 420, tree: 0.4, treeHi: 70, treeLo: 220, bushD: 60, grassD: 0, grass: 0, shadows: false, rockD: 160, terrN: 20 },
  medium: { radius: 340, unload: 520, tree: 0.7, treeHi: 100, treeLo: 300, bushD: 100, grassD: 0, grass: 0, shadows: true, rockD: 220, terrN: 28 },
  high: { radius: 440, unload: 640, tree: 1, treeHi: 140, treeLo: 380, bushD: 150, grassD: 90, grass: 0.8, shadows: true, rockD: 300, terrN: 36 },
  ultra: { radius: 540, unload: 780, tree: 1.3, treeHi: 190, treeLo: 460, bushD: 220, grassD: 130, grass: 1.4, shadows: true, rockD: 380, terrN: 44 },
};

interface Chunk {
  i: number; j: number; group: THREE.Group; near: THREE.Mesh; far: THREE.Mesh; cx: number; cz: number;
  treeHi: THREE.InstancedMesh[]; treeLo: THREE.InstancedMesh[]; bush: THREE.InstancedMesh[]; rock: THREE.InstancedMesh[]; grass: THREE.InstancedMesh[];
  colliders: number[]; geos: THREE.BufferGeometry[]; nearBuilt: boolean;
}

// ---- paylaşılan bitki geometrileri
function colorize(g: THREE.BufferGeometry, c: THREE.Color, jitter = 0) {
  const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const k = 1 + (vnoise(pos.getX(i) * 3.1, pos.getZ(i) * 3.1 + pos.getY(i) * 2) - 0.5) * jitter;
    const shade = 0.75 + 0.25 * clamp((pos.getY(i) + 1) / 5, 0, 1.5);
    a[i * 3] = c.r * k * shade; a[i * 3 + 1] = c.g * k * shade; a[i * 3 + 2] = c.b * k * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
let VEG: { pineHi: THREE.BufferGeometry; pineLo: THREE.BufferGeometry; broadHi: THREE.BufferGeometry; broadLo: THREE.BufferGeometry; bush: THREE.BufferGeometry; rock: THREE.BufferGeometry; grass: THREE.BufferGeometry } | null = null;
function vegGeos() {
  if (VEG) return VEG;
  const trunkC = new THREE.Color(0x4a3524);
  const strip = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
  const trunk = (h: number, r: number) => { const g = new THREE.CylinderGeometry(r * 0.6, r, h, 6); g.translate(0, h / 2, 0); return colorize(strip(g), trunkC, 0.3); };
  const cone = (r: number, h: number, y: number, c: number, seg: number) => { const g = new THREE.ConeGeometry(r, h, seg); g.translate(0, y + h / 2, 0); return colorize(strip(g), new THREE.Color(c), 0.5); };
  const pineHi = mergeGeometries([trunk(2.5, 0.28), cone(2.4, 3.0, 1.6, 0x22401f, 9), cone(1.9, 2.8, 3.3, 0x2a4a24, 9), cone(1.4, 2.6, 5.0, 0x2f5427, 8), cone(0.9, 2.2, 6.6, 0x35602c, 7)])!;
  const pineLo = mergeGeometries([trunk(2.5, 0.28), cone(2.2, 5.5, 1.8, 0x27481f, 6), cone(1.2, 4.0, 5.2, 0x2f5427, 5)])!;
  const blob = (r: number, x: number, y: number, z: number, c: number, det: number) => { const g = new THREE.IcosahedronGeometry(r, det); g.translate(x, y, z); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (vnoise(p.getX(i) * 2.3 + 9, p.getZ(i) * 2.3 + p.getY(i)) - 0.5) * 0.45; p.setXYZ(i, (p.getX(i) - x) * k + x, (p.getY(i) - y) * k * 0.85 + y, (p.getZ(i) - z) * k + z); } g.deleteAttribute('uv'); return colorize(strip(g), new THREE.Color(c), 0.5); };
  const broadHi = mergeGeometries([trunk(3.0, 0.32), blob(2.0, 0, 4.6, 0, 0x3f6b2a, 1), blob(1.5, 1.3, 3.9, 0.3, 0x4a7830, 1), blob(1.4, -1.1, 4.0, -0.5, 0x37622a, 1), blob(1.3, 0.2, 5.8, 0.4, 0x558238, 1)])!;
  const broadLo = mergeGeometries([trunk(3.0, 0.32), blob(2.6, 0, 4.7, 0, 0x426e2c, 0)])!;
  const bush = mergeGeometries([blob(0.8, 0, 0.45, 0, 0x3d6228, 1), blob(0.6, 0.6, 0.35, 0.2, 0x4a7030, 0), blob(0.55, -0.5, 0.3, -0.3, 0x35582a, 0)])!;
  const rockG = new THREE.IcosahedronGeometry(1, 2); { const p = rockG.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.75 + vnoise(x * 1.7 + 3, z * 1.7 + y * 1.3) * 0.55; p.setXYZ(i, x * k * 1.15, y * k * 0.75, z * k); } rockG.deleteAttribute('uv'); }
  const rock = colorize(strip(rockG), new THREE.Color(0x77736b), 0.7);
  rock.computeVertexNormals();
  const gg = new THREE.PlaneGeometry(1.1, 0.8); gg.translate(0, 0.4, 0);
  const g2 = gg.clone(); g2.rotateY(Math.PI / 2);
  const grass = mergeGeometries([gg, g2])!;
  VEG = { pineHi, pineLo, broadHi, broadLo, bush, rock, grass };
  return VEG;
}

// ---- gökyüzü
const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`;
const SKY_FS = `
varying vec3 vDir; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uTime; uniform float uCloud; uniform float uNight; uniform float uGray; uniform float uFlash;
float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=n(p)*a; p=p*2.02+11.; a*=.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float y = max(d.y, 0.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.25, y)); col = mix(col, uTop, smoothstep(0.2, 0.9, y));
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.25 + pow(sd, 64.0) * 0.6 + smoothstep(0.9995, 0.9999, sd) * 40.0) * (1.0 - uGray*0.8);
  col += uHor * pow(1.0 - y, 5.0) * 0.4;
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.25) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(uv * 1.6); float cov = mix(0.58, 0.28, uCloud);
    float m = smoothstep(cov, cov + 0.28, c) * smoothstep(0.0, 0.18, d.y);
    vec3 cc = mix(vec3(1.0), uHor * 1.2 + 0.2, 0.35) * (0.55 + 0.6 * sd) ; cc = mix(cc, uSunCol * 0.9 + 0.1, pow(sd, 3.0) * 0.4);
    cc *= mix(1.0, 0.45, uGray);
    cc = mix(cc, vec3(0.08, 0.1, 0.16), uNight * 0.9);
    col = mix(col, cc, m * mix(0.85, 1.0, uCloud));
    float st = step(0.9965, h(floor(d.xz / (d.y + 0.2) * 220.0))) * uNight * (1.0 - m) * smoothstep(0.05, 0.4, d.y);
    col += vec3(st);
  }
  col += uFlash * vec3(0.7, 0.75, 0.95);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Atmos { top: number; mid: number; hor: number; sunCol: number; sunI: number; sunEl: number; sunAz: number; hemiS: number; hemiG: number; hemiI: number; fog: number; fogD: number; night: number; exposure: number }
const ATM: Record<TimeOfDay, Atmos> = {
  day: { top: 0x3b78c8, mid: 0x78aee4, hor: 0xcfe0e8, sunCol: 0xfff0d8, sunI: 3.4, sunEl: 0.85, sunAz: 2.2, hemiS: 0xa8c8f0, hemiG: 0x5a5a40, hemiI: 1.1, fog: 0xb4cde0, fogD: 0.0013, night: 0, exposure: 0.95 },
  sunset: { top: 0x28406e, mid: 0xc98060, hor: 0xf4aa70, sunCol: 0xff9a4a, sunI: 3.0, sunEl: 0.17, sunAz: 2.4, hemiS: 0xe0a080, hemiG: 0x4a3a30, hemiI: 1.5, fog: 0xd0a080, fogD: 0.0016, night: 0, exposure: 1.2 },
  night: { top: 0x03060e, mid: 0x0a1424, hor: 0x1b2640, sunCol: 0x8aa4e0, sunI: 0.55, sunEl: 0.6, sunAz: 1.0, hemiS: 0x2a3a66, hemiG: 0x10141c, hemiI: 0.55, fog: 0x0a111e, fogD: 0.0026, night: 1, exposure: 1.15 },
};

export class World {
  scene: THREE.Scene;
  q: QP = QUALITY.medium; quality: Quality = 'medium';
  chunks = new Map<number, Chunk>();
  loadQueue: [number, number][] = [];
  statics = new Map<number, number[]>();
  hazardMesh: Record<string, THREE.InstancedMesh> = {};
  hazardIdx = new Map<Hazard, { m: THREE.InstancedMesh; i: number; mat: THREE.Matrix4 }>();
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight;
  sky: THREE.Mesh; skyU: Record<string, { value: any }>;
  water!: THREE.Mesh; waterMat!: THREE.MeshStandardMaterial;
  terrMat: THREE.MeshStandardMaterial;
  lampSpots: { x: number; y: number; z: number }[] = [];
  lampLights: THREE.PointLight[] = [];
  chimneys: { x: number; y: number; z: number }[] = [];
  fires: { x: number; y: number; z: number }[] = [];
  staticGroup = new THREE.Group();
  poiQueue: (() => void)[] = [];
  winMat: THREE.MeshStandardMaterial;
  time: TimeOfDay = 'day'; weather: Weather = 'clear';
  pmrem: THREE.PMREMGenerator | null = null; envRT: THREE.WebGLRenderTarget | null = null;
  roadMats: THREE.MeshStandardMaterial[] = [];
  atm: Atmos = ATM.day;
  flash = 0;
  elapsed = 0;
  onChunkLoaded: (() => void) | null = null;
  truckStart = new THREE.Vector3(); truckYaw = 0;
  tmpM = new THREE.Matrix4();

  constructor(scene: THREE.Scene, public renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    buildWorld(); buildHazards();
    this.terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: T.ground(), bumpMap: T.groundBump(), bumpScale: 2.2, roughness: 0.96, metalness: 0 });
    this.terrMat.map!.repeat.set(1, 1);
    this.winMat = mat('winlit', () => new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.skyU = { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uTime: { value: 0 }, uCloud: { value: 0 }, uNight: { value: 0 }, uGray: { value: 0 }, uFlash: { value: 0 } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU as any, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    scene.add(this.sky);
    scene.add(this.staticGroup);
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffb060, 0, 26, 1.6); l.visible = false; scene.add(l); this.lampLights.push(l); }
    this.buildWater();
    this.buildRoads();
    this.buildHazardMeshes();
    this.queuePOIs();
  }

  // ------------------------------------------------------------- atmosfer
  setAtmosphere(time: TimeOfDay, weather: Weather, quality: Quality) {
    this.time = time; this.weather = weather;
    const a = ATM[time]; this.atm = a;
    const rain = weather === 'rain';
    const gray = rain ? 1 : 0;
    const tint = (hex: number, g: number, f = 0.5) => { const c = new THREE.Color(hex); const l = (c.r + c.g + c.b) / 3 * (time === 'night' ? 1.4 : 0.9); return c.lerp(new THREE.Color(l * 0.95, l, l * 1.05), gray * f * g); };
    (this.skyU.uTop.value as THREE.Color).copy(tint(a.top, 1, 0.7)); (this.skyU.uMid.value as THREE.Color).copy(tint(a.mid, 1, 0.85)); (this.skyU.uHor.value as THREE.Color).copy(tint(a.hor, 1, 0.8));
    const sd = new THREE.Vector3(Math.cos(a.sunAz) * Math.cos(a.sunEl), Math.sin(a.sunEl), Math.sin(a.sunAz) * Math.cos(a.sunEl));
    (this.skyU.uSun.value as THREE.Vector3).copy(sd);
    (this.skyU.uSunCol.value as THREE.Color).set(a.sunCol);
    this.skyU.uCloud.value = rain ? 1 : 0.35; this.skyU.uNight.value = a.night; this.skyU.uGray.value = gray;
    this.sun.color.set(a.sunCol); this.sun.intensity = a.sunI * (rain ? 0.28 : 1);
    this.sun.userData.dir = sd;
    this.hemi.color.set(a.hemiS); this.hemi.groundColor.set(a.hemiG); this.hemi.intensity = a.hemiI * (rain ? 0.85 : 1);
    this.scene.fog = new THREE.FogExp2(tint(a.fog, 1, 0.9).getHex(), a.fogD * (rain ? 2.2 : 1));
    this.renderer.toneMappingExposure = a.exposure;
    // gece pencere ışıkları
    const wm = this.winMat as THREE.MeshStandardMaterial; wm.emissiveIntensity = time === 'day' && !rain ? 0 : 2.2;
    // asfalt ıslaklığı
    this.roadMats.forEach((m, i) => { m.roughness = rain ? (i === 0 ? 0.28 : 0.45) : (i === 0 ? 0.85 : 0.95); m.color.setScalar(rain ? 0.62 : 1); m.envMapIntensity = rain ? 2.2 : 0.6; });
    this.waterMat.color.set(time === 'night' ? 0x0a2230 : rain ? 0x2a4a52 : 0x1f6272);
    this.terrMat.color.setScalar(rain ? 0.78 : 1);
    this.terrMat.roughness = rain ? 0.75 : 0.96;
    this.setQuality(quality);
    this.updateEnv();
  }
  updateEnv() {
    if (this.quality === 'low') { this.scene.environment = null; return; }
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene();
    const m = this.sky.clone(); m.position.set(0, 0, 0); m.scale.setScalar(1); es.add(m);
    if (this.envRT) this.envRT.dispose();
    const wasFog = this.scene.fog;
    this.envRT = this.pmrem.fromScene(es, 0, 1, 3000);
    this.scene.fog = wasFog;
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.time === 'night' ? 0.35 : this.weather === 'rain' ? 0.6 : 0.8;
  }
  setQuality(q: Quality) {
    this.quality = q; this.q = QUALITY[q];
    const sh = this.q.shadows;
    this.renderer.shadowMap.enabled = sh;
    this.sun.castShadow = sh;
    const size = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    const R = q === 'ultra' ? 90 : 70;
    const c = this.sun.shadow.camera; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 400; c.updateProjectionMatrix();
    this.waterMat.envMapIntensity = q === 'low' ? 0 : 1;
    this.chunks.forEach((ch) => this.applyChunkVis(ch, null));
  }

  // ------------------------------------------------------------- su
  buildWater() {
    const n = T.waterN(); n.repeat.set(220, 220);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1f6272, normalMap: n, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.06, metalness: 0.05, transparent: true, opacity: 0.86 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600), this.waterMat);
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = 0;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  // ------------------------------------------------------------- yollar
  buildRoads() {
    const tex = [T.asphalt(), T.gravel(), T.dirt()];
    const geos: { pos: number[]; uv: number[]; idx: number[] }[] = [0, 1, 2].map(() => ({ pos: [], uv: [], idx: [] }));
    roadIdx.forEach((list, ri) => {
      const meta = roadMeta[ri];
      const G = geos[meta.surf];
      const base = G.pos.length / 3;
      let acc = 0;
      const widen = 1.18;
      for (let k = 0; k < list.length; k++) {
        const s = samples[list[k]];
        const a = samples[list[Math.max(0, k - 1)]], b = samples[list[Math.min(list.length - 1, k + 1)]];
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        if (k > 0) { const p = samples[list[k - 1]]; acc += Math.hypot(s.x - p.x, s.z - p.z); }
        const w = s.hw * widen;
        for (let c = 0; c < 5; c++) {
          const f = c / 4 * 2 - 1;
          const x = s.x + nx * w * f, z = s.z + nz * w * f;
          const y = groundY(x, z) + 0.06 + ri * 0.004 + (1 - f * f) * 0.015;
          G.pos.push(x, y, z); G.uv.push(c / 4, acc / 8);
        }
        if (k > 0) {
          const o = base + (k - 1) * 5;
          for (let c = 0; c < 4; c++) { const i0 = o + c, i1 = o + c + 1, i2 = o + c + 5, i3 = o + c + 6; G.idx.push(i0, i2, i1, i1, i2, i3); }
        }
      }
    });
    geos.forEach((G, si) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
      g.setIndex(G.idx); g.computeVertexNormals();
      // indeks tabanlı yanlış yön olursa normalleri yukarı çevir
      const n = g.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
      const m = new THREE.MeshStandardMaterial({ map: tex[si], bumpMap: tex[si], bumpScale: si === 0 ? 0.6 : 1.4, roughness: si === 0 ? 0.85 : 0.95, metalness: si === 0 ? 0.1 : 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaTest: 0.04 });
      this.roadMats.push(m);
      const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.renderOrder = 1; mesh.frustumCulled = false;
      this.scene.add(mesh);
    });
  }

  // ------------------------------------------------------------- çukur/çamur/kaya
  buildHazardMeshes() {
    const potTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
      const g = x.createRadialGradient(64, 64, 8, 64, 64, 62);
      g.addColorStop(0, 'rgba(6,6,6,0.97)'); g.addColorStop(0.62, 'rgba(14,12,10,0.92)'); g.addColorStop(0.8, 'rgba(60,52,44,0.7)'); g.addColorStop(1, 'rgba(60,52,44,0)');
      x.fillStyle = g; x.beginPath();
      for (let a = 0; a < 40; a++) { const r = 60 - Math.random() * 12 * (a % 2); const ang = a / 40 * Math.PI * 2; x.lineTo(64 + Math.cos(ang) * r, 64 + Math.sin(ang) * r); }
      x.closePath(); x.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const mudTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
      const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(60,44,26,0.95)'); g.addColorStop(0.7, 'rgba(70,52,32,0.85)'); g.addColorStop(1, 'rgba(70,52,32,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const by: Record<string, Hazard[]> = { pothole: [], mud: [], rock: [], debris: [], barrel: [] };
    hazards.forEach((h) => by[h.kind].push(h));
    const make = (kind: string, geo: THREE.BufferGeometry, m: THREE.Material, place: (h: Hazard, mtx: THREE.Matrix4) => void, shadow: boolean) => {
      const list = by[kind]; if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, m, list.length);
      list.forEach((h, i) => { const mt = new THREE.Matrix4(); place(h, mt); im.setMatrixAt(i, mt); this.hazardIdx.set(h, { m: im, i, mat: mt }); });
      im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; im.renderOrder = 2;
      this.scene.add(im); this.hazardMesh[kind] = im;
    };
    const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const flat = new THREE.CircleGeometry(1, 20); flat.rotateX(-Math.PI / 2);
    make('pothole', flat, new THREE.MeshStandardMaterial({ map: potTex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), (h, mt) => { p.set(h.x, groundY(h.x, h.z) + 0.1, h.z); e.set(0, h.ang, 0); q.setFromEuler(e); sc.set(h.r * 1.3, 1, h.r * 1.3); mt.compose(p, q, sc); }, false);
    make('mud', flat, new THREE.MeshStandardMaterial({ map: mudTex, transparent: true, depthWrite: false, roughness: 0.12, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), (h, mt) => { p.set(h.x, groundY(h.x, h.z) + 0.09, h.z); e.set(0, h.ang, 0); q.setFromEuler(e); sc.set(h.r, 1, h.r * 0.8); mt.compose(p, q, sc); }, false);
    make('rock', vegGeos().rock, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), (h, mt) => { p.set(h.x, groundY(h.x, h.z) + h.r * 0.25, h.z); e.set(0, h.ang, 0); q.setFromEuler(e); sc.set(h.r * 1.1, h.r * 0.9, h.r); mt.compose(p, q, sc); }, true);
    make('debris', new THREE.BoxGeometry(1.8, 0.12, 0.22), new THREE.MeshStandardMaterial({ map: T.wood(0x6a4c30), roughness: 0.95 }), (h, mt) => { p.set(h.x, groundY(h.x, h.z) + 0.15, h.z); e.set(0.08, h.ang, 0.1); q.setFromEuler(e); sc.set(1, 1, 1); mt.compose(p, q, sc); }, true);
    make('barrel', new THREE.CylinderGeometry(0.4, 0.4, 0.95, 12), new THREE.MeshStandardMaterial({ map: T.corrugated(0x8a3a22), roughness: 0.7, metalness: 0.6 }), (h, mt) => { p.set(h.x, groundY(h.x, h.z) + 0.45, h.z); e.set(0, h.ang, h.ang > 3.1 ? Math.PI / 2 : 0); q.setFromEuler(e); sc.set(1, 1, 1); mt.compose(p, q, sc); }, true);
  }
  killHazard(h: Hazard) {
    h.dead = true;
    const r = this.hazardIdx.get(h); if (!r) return;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    r.m.setMatrixAt(r.i, m); r.m.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------- çarpışma
  addStatic(x: number, z: number, r: number) {
    const k = ckey(Math.floor(x / 20), Math.floor(z / 20));
    let a = this.statics.get(k); if (!a) { a = []; this.statics.set(k, a); }
    a.push(x, z, r);
  }
  queryColliders(x: number, z: number, fn: (cx: number, cz: number, r: number) => void) {
    const ci = Math.floor(x / 20), cj = Math.floor(z / 20);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this.statics.get(ckey(ci + a, cj + b));
      if (arr) for (let i = 0; i < arr.length; i += 3) fn(arr[i], arr[i + 1], arr[i + 2]);
    }
    const i0 = Math.floor(x / CHUNK), j0 = Math.floor(z / CHUNK);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const ch = this.chunks.get(ckey(i0 + a, j0 + b));
      if (!ch) continue;
      const c = ch.colliders;
      for (let i = 0; i < c.length; i += 3) { const dx = c[i] - x, dz = c[i + 1] - z; if (dx * dx + dz * dz < 36) fn(c[i], c[i + 1], c[i + 2]); }
    }
  }

  // ------------------------------------------------------------- parçalar (chunk)
  private terrColor(x: number, z: number, h: number, slope: number, out: THREE.Color) {
    const n1 = fbm(x * 0.02, z * 0.02, 3), n2 = vnoise(x * 0.18, z * 0.18);
    const forest = clamp(fbm(x * 0.006 + 50, z * 0.006 - 20, 3) * 1.4 - 0.2 + Math.exp(-(Math.pow(x + 250, 2) + Math.pow(z + 200, 2)) / 60000) * 0.7, 0, 1);
    if (h < 0.1) { out.setRGB(0.42, 0.4, 0.33).lerp(new THREE.Color(0.2, 0.28, 0.28), clamp(-h / 5, 0, 1)); return out; }
    const sand = new THREE.Color(0.66, 0.6, 0.45), grass = new THREE.Color(0.27, 0.38, 0.15).lerp(new THREE.Color(0.38, 0.4, 0.17), n1).lerp(new THREE.Color(0.13, 0.26, 0.1), forest * 0.8);
    grass.multiplyScalar(0.82 + n2 * 0.35);
    out.copy(grass);
    const dry = smoothstep(0.55, 0.8, fbm(x * 0.012 - 30, z * 0.012 + 40, 3));
    out.lerp(new THREE.Color(0.45, 0.42, 0.22), dry * 0.5);
    out.lerp(sand, 1 - smoothstep(1.2, 3.6, h + (n1 - 0.5) * 1.2));
    const rockC = new THREE.Color(0.42, 0.4, 0.37).multiplyScalar(0.8 + n2 * 0.5);
    out.lerp(rockC, smoothstep(0.38, 0.62, slope) );
    out.lerp(rockC, smoothstep(40, 62, h) * 0.5);
    // yol kenarı toprak
    const rw = roadWeight(x, z);
    if (rw > 0) out.lerp(new THREE.Color(0.32, 0.26, 0.17), rw * 0.65);
    // yerleşim alanları / taş ocağı
    for (const k in POIS) { const p = POIS[k]; const d = Math.hypot(x - p.x, z - p.z); if (d < p.r * 0.85) out.lerp(new THREE.Color(0.38, 0.33, 0.25), (1 - d / (p.r * 0.85)) * 0.8); }
    const q = QUARRY_PIT; const dq = Math.hypot(x - q.x, z - q.z); if (dq < q.r + 14) out.lerp(new THREE.Color(0.5, 0.46, 0.4), 0.85 * (1 - smoothstep(q.r * 0.9, q.r + 14, dq)));
    // nehir yatağı çakılı
    const dr = Math.abs(x - riverX(z)); if (dr < 28 && h < 3) out.lerp(new THREE.Color(0.36, 0.34, 0.3), 1 - dr / 28);
    return out;
  }
  private terrGeo(x0: number, z0: number, N: number): THREE.BufferGeometry {
    const S = CHUNK / N, V = N + 1;
    const hs = new Float32Array((V + 2) * (V + 2));
    for (let j = -1; j <= V; j++) for (let i = -1; i <= V; i++) hs[(j + 1) * (V + 2) + i + 1] = terrainH(x0 + i * S, z0 + j * S);
    const H = (i: number, j: number) => hs[(j + 1) * (V + 2) + i + 1];
    const tot = V * V + 4 * V;
    const pos = new Float32Array(tot * 3), nor = new Float32Array(tot * 3), col = new Float32Array(tot * 3), uv = new Float32Array(tot * 2);
    const c = new THREE.Color();
    const put = (o: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, cc: THREE.Color) => {
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z; nor[o * 3] = nx; nor[o * 3 + 1] = ny; nor[o * 3 + 2] = nz;
      col[o * 3] = cc.r; col[o * 3 + 1] = cc.g; col[o * 3 + 2] = cc.b; uv[o * 2] = x / 14; uv[o * 2 + 1] = z / 14;
    };
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = x0 + i * S, z = z0 + j * S, h = H(i, j);
      let nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1); const ny = 2 * S;
      const l = Math.hypot(nx, ny, nz); nx /= l; nz /= l;
      const slope = Math.hypot(nx, nz) / (ny / l);
      this.terrColor(x, z, h, slope, c);
      put(j * V + i, x, h, z, nx, ny / l, nz, c);
    }
    // etek
    let o = V * V;
    const edge = (fi: (k: number) => number, fj: (k: number) => number) => { for (let k = 0; k < V; k++) { const i = fi(k), j = fj(k); const b = j * V + i; put(o++, pos[b * 3], pos[b * 3 + 1] - 6, pos[b * 3 + 2], nor[b * 3], nor[b * 3 + 1], nor[b * 3 + 2], c.setRGB(col[b * 3], col[b * 3 + 1], col[b * 3 + 2])); } };
    edge((k) => k, () => 0); edge((k) => k, () => V - 1); edge(() => 0, (k) => k); edge(() => V - 1, (k) => k);
    const idx: number[] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * V + i, b = a + 1, d = a + V, e = d + 1; idx.push(a, d, b, b, d, e); }
    const sk = (base: number, top: (k: number) => number, flip: boolean) => { for (let k = 0; k < N; k++) { const a = top(k), b = top(k + 1), a2 = base + k, b2 = base + k + 1; if (flip) idx.push(a, b, a2, b, b2, a2); else idx.push(a, a2, b, b, a2, b2); } };
    sk(V * V, (k) => k, false); sk(V * V + V, (k) => (V - 1) * V + k, true); sk(V * V + 2 * V, (k) => k * V, true); sk(V * V + 3 * V, (k) => k * V + V - 1, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, 20, z0 + CHUNK / 2), CHUNK * 1.0 + 40);
    g.boundingBox = null;
    return g;
  }

  private loadChunk(i: number, j: number) {
    const key = ckey(i, j);
    if (this.chunks.has(key)) return;
    const x0 = i * CHUNK, z0 = j * CHUNK;
    const group = new THREE.Group();
    const q = this.q;
    const farG = this.terrGeo(x0, z0, 10), nearG = this.terrGeo(x0, z0, q.terrN);
    const near = new THREE.Mesh(nearG, this.terrMat), far = new THREE.Mesh(farG, this.terrMat);
    near.receiveShadow = true; far.receiveShadow = true;
    group.add(near, far);
    const ch: Chunk = { i, j, group, near, far, cx: x0 + CHUNK / 2, cz: z0 + CHUNK / 2, treeHi: [], treeLo: [], bush: [], rock: [], grass: [], colliders: [], geos: [nearG, farG], nearBuilt: true };
    // ---- bitki örtüsü
    const v = vegGeos();
    const r = rng((i + 50) * 7919 + (j + 50) * 104729);
    const pineM = this.vegMat('pine'), broadM = this.vegMat('broad');
    const bushM = this.vegMat('bush');
    const rockM = this.vegMat('rock');
    const tries = Math.round(260 * q.tree);
    const T1: THREE.Matrix4[] = [], T2: THREE.Matrix4[] = [], B: THREE.Matrix4[] = [], R: THREE.Matrix4[] = [], Gr: THREE.Matrix4[] = [];
    const TC: THREE.Color[] = [], T2C: THREE.Color[] = [];
    const qt = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const polyPlaces = Object.values(POIS);
    const mk = (arr: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number) => { e.set(0, r() * 6.28, 0); qt.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sx); const m = new THREE.Matrix4().compose(p, qt, s); arr.push(m); };
    for (let t = 0; t < tries; t++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK;
      const h = terrainH(x, z);
      if (h < 2.4) continue;
      const slope = Math.abs(terrainH(x + 2, z) - h) / 2 + Math.abs(terrainH(x, z + 2) - h) / 2;
      if (slope > 0.62) continue;
      const rw = roadWeight(x, z);
      if (rw > 0.03) { const ns = nearestSample(x, z, 9); if (ns.idx >= 0 && ns.d < samples[ns.idx].hw + 3.2) continue; }
      if (polyPlaces.some((pl) => Math.hypot(pl.x - x, pl.z - z) < pl.r + 6)) continue;
      const q2 = QUARRY_PIT; if (Math.hypot(x - q2.x, z - q2.z) < q2.r + 14) continue;
      if (Math.abs(x - riverX(z)) < 18 && h < 6) continue;
      const forest = clamp(fbm(x * 0.006 + 50, z * 0.006 - 20, 3) * 1.4 - 0.2 + Math.exp(-(Math.pow(x + 250, 2) + Math.pow(z + 200, 2)) / 60000) * 0.7, 0, 1);
      const rockyEast = Math.exp(-(Math.pow(x - 340, 2) + Math.pow(z + 130, 2)) / 40000);
      const dens = 0.2 + forest * 0.95 - rockyEast * 0.8;
      if (r() > dens) {
        if (r() < 0.5 * dens + 0.1) { mk(B, x, h - 0.05, z, 0.8 + r() * 0.9, 0.7 + r() * 0.6); }
        continue;
      }
      const sc = 0.75 + r() * 0.8;
      const isPine = r() < 0.45 + forest * 0.35 || h > 28;
      if (isPine) { mk(T1, x, h - 0.15, z, sc, sc * (0.9 + r() * 0.4)); TC.push(new THREE.Color().setHSL(0.3 + r() * 0.05, 0.3, 0.82 + r() * 0.3)); }
      else { mk(T2, x, h - 0.15, z, sc * 1.05, sc); T2C.push(new THREE.Color().setHSL(0.18 + r() * 0.12, 0.35, 0.85 + r() * 0.3)); }
      ch.colliders.push(x, z, 0.5 * sc + 0.3);
    }
    // kayalar
    const rockN = Math.round(22 + 40 * Math.exp(-(Math.pow(x0 + 50 - 340, 2) + Math.pow(z0 + 50 + 130, 2)) / 90000));
    for (let t = 0; t < rockN; t++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, h = terrainH(x, z);
      if (h < 0.6) continue;
      if (roadWeight(x, z) > 0.03) { const ns = nearestSample(x, z, 10); if (ns.idx >= 0 && ns.d < samples[ns.idx].hw + 2.2) continue; }
      if (polyPlaces.some((pl) => Math.hypot(pl.x - x, pl.z - z) < pl.r)) continue;
      const sc = 0.5 + Math.pow(r(), 2.2) * 3.2;
      mk(R, x, h + sc * 0.15, z, sc, sc * (0.7 + r() * 0.5));
      if (sc > 1.1) ch.colliders.push(x, z, sc * 0.85);
    }
    // çim
    if (q.grass > 0) {
      const gn = Math.round(260 * q.grass);
      for (let t = 0; t < gn; t++) {
        const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK, h = terrainH(x, z);
        if (h < 2.2 || Math.hypot(x, z) > 1000) continue;
        if (roadWeight(x, z) > 0.5) continue;
        mk(Gr, x, h, z, 0.9 + r() * 0.9, 0.7 + r() * 0.8);
      }
    }
    const mkInst = (g: THREE.BufferGeometry, m: THREE.Material, arr: THREE.Matrix4[], list: THREE.InstancedMesh[], cast: boolean, cols?: THREE.Color[]) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(g, m, arr.length);
      arr.forEach((mt, k) => { im.setMatrixAt(k, mt); if (cols) im.setColorAt(k, cols[k]); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = cast; im.receiveShadow = true;
      group.add(im); list.push(im);
    };
    mkInst(v.pineHi, pineM, T1, ch.treeHi, true, TC); mkInst(v.pineLo, pineM, T1, ch.treeLo, false, TC);
    mkInst(v.broadHi, broadM, T2, ch.treeHi, true, T2C); mkInst(v.broadLo, broadM, T2, ch.treeLo, false, T2C);
    mkInst(v.bush, bushM, B, ch.bush, false); mkInst(v.rock, rockM, R, ch.rock, true);
    mkInst(v.grass, this.vegMat('grass'), Gr, ch.grass, false);
    this.scene.add(group);
    this.chunks.set(key, ch);
    this.applyChunkVis(ch, null);
  }
  private vm = new Map<string, THREE.Material>();
  private vegMat(k: string) {
    let m = this.vm.get(k);
    if (!m) {
      if (k === 'grass') m = new THREE.MeshStandardMaterial({ map: T.grassTuft(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: 0xc0d090 });
      else if (k === 'rock') m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, map: T.ground(), bumpMap: T.groundBump(), bumpScale: 3 });
      else m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: k !== 'bush' });
      this.vm.set(k, m);
    }
    return m;
  }
  private applyChunkVis(ch: Chunk, d: number | null) {
    const q = this.q;
    if (d === null) d = 0;
    const nearT = d < 190;
    ch.near.visible = nearT; ch.far.visible = !nearT;
    const vis = (arr: THREE.InstancedMesh[], v: boolean) => arr.forEach((m) => (m.visible = v));
    vis(ch.treeHi, d < q.treeHi); vis(ch.treeLo, d >= q.treeHi && d < q.treeLo);
    vis(ch.bush, d < q.bushD); vis(ch.rock, d < q.rockD); vis(ch.grass, q.grassD > 0 && d < q.grassD);
    const sh = q.shadows && d < 110;
    ch.treeHi.forEach((m) => (m.castShadow = sh && this.quality !== 'medium' ? true : sh && d < 70));
    ch.rock.forEach((m) => (m.castShadow = sh));
  }
  private unloadChunk(key: number) {
    const ch = this.chunks.get(key); if (!ch) return;
    this.scene.remove(ch.group);
    ch.geos.forEach((g) => g.dispose());
    [...ch.treeHi, ...ch.treeLo, ...ch.bush, ...ch.rock, ...ch.grass].forEach((m) => m.dispose());
    this.chunks.delete(key);
  }

  /** Verilen konum çevresindeki parçaları hemen yükler */
  preload(x: number, z: number, radius: number) {
    const i0 = Math.floor((x - radius) / CHUNK), i1 = Math.floor((x + radius) / CHUNK), j0 = Math.floor((z - radius) / CHUNK), j1 = Math.floor((z + radius) / CHUNK);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.isLand(i, j)) this.loadChunk(i, j);
  }
  private isLand(i: number, j: number) {
    const cx = i * CHUNK + CHUNK / 2, cz = j * CHUNK + CHUNK / 2;
    return Math.hypot(cx, cz) < 780 && Math.abs(cx) < WORLD_HALF && Math.abs(cz) < WORLD_HALF;
  }
  ready(x: number, z: number) { return this.chunks.has(ckey(Math.floor(x / CHUNK), Math.floor(z / CHUNK))); }

  update(dt: number, px: number, pz: number, cam: THREE.Camera, focus: THREE.Vector3) {
    this.elapsed += dt;
    const q = this.q;
    // kuyruğu doldur
    this.queueTimer -= dt;
    if (this.queueTimer <= 0) {
      this.queueTimer = 0.4;
      const R = q.radius, i0 = Math.floor((px - R) / CHUNK), i1 = Math.floor((px + R) / CHUNK), j0 = Math.floor((pz - R) / CHUNK), j1 = Math.floor((pz + R) / CHUNK);
      const want: [number, number, number][] = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (this.chunks.has(ckey(i, j)) || !this.isLand(i, j)) continue;
        const d = Math.hypot(i * CHUNK + 50 - px, j * CHUNK + 50 - pz);
        if (d < R) want.push([i, j, d]);
      }
      want.sort((a, b) => a[2] - b[2]);
      this.loadQueue = want.map((w) => [w[0], w[1]]);
      this.chunks.forEach((ch, key) => { if (Math.hypot(ch.cx - px, ch.cz - pz) > q.unload) this.unloadChunk(key); });
    }
    const budget = 1;
    for (let b = 0; b < budget && this.loadQueue.length; b++) { const [i, j] = this.loadQueue.shift()!; this.loadChunk(i, j); }
    if (this.poiQueue.length && this.chunks.size > 4) this.poiQueue.shift()!();
    // LOD
    this.chunks.forEach((ch) => this.applyChunkVis(ch, Math.hypot(ch.cx - px, ch.cz - pz) - 50));
    // güneş gölge kamerası
    const sd = this.sun.userData.dir as THREE.Vector3 | undefined;
    if (sd) {
      const step = this.quality === 'ultra' ? 0.05 : 0.1;
      const sx = Math.round(focus.x / step) * step, sz = Math.round(focus.z / step) * step;
      this.sun.target.position.set(sx, focus.y, sz);
      this.sun.position.set(sx + sd.x * 200, focus.y + sd.y * 200, sz + sd.z * 200);
      this.sun.target.updateMatrixWorld();
    }
    this.sky.position.copy(cam.position);
    this.skyU.uTime.value = this.elapsed;
    this.skyU.uFlash.value = this.flash;
    this.water.position.x = Math.round(px / 50) * 50; this.water.position.z = Math.round(pz / 50) * 50;
    const wn = this.waterMat.normalMap!; wn.offset.set(this.elapsed * 0.004, this.elapsed * 0.0025);
    // lamba havuzu
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.5;
      const night = this.time !== 'day' || this.weather === 'rain';
      const sorted = this.lampSpots.map((l) => ({ l, d: Math.hypot(l.x - px, l.z - pz) })).filter((o) => o.d < 90).sort((a, b) => a.d - b.d).slice(0, 3);
      this.lampLights.forEach((li, k) => { const o = sorted[k]; if (o && night) { li.visible = true; li.position.set(o.l.x, o.l.y, o.l.z); li.intensity = this.time === 'night' ? 60 : 24; } else li.visible = false; });
    }
  }
  queueTimer = 0; lampTimer = 0;

  // ------------------------------------------------------------- yapılar
  private place(o: THREE.Object3D, x: number, z: number, rotY = 0, dy = 0) {
    o.position.set(x, terrainH(x, z) + dy, z); o.rotation.y = rotY; this.staticGroup.add(o);
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    return o;
  }
  private box(w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  }
  private freeSpot(cx: number, cz: number, rmin: number, rmax: number, clear: number, rnd: () => number, avoid: [number, number, number][], angRange?: [number, number]) {
    for (let t = 0; t < 120; t++) {
      const a = angRange ? lerp(angRange[0], angRange[1], rnd()) : rnd() * 6.283, d = rmin + rnd() * (rmax - rmin);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const ns = nearestSample(x, z, clear + 6);
      if (ns.idx >= 0 && ns.d < clear + samples[ns.idx].hw) continue;
      if (avoid.some((o) => Math.hypot(o[0] - x, o[1] - z) < o[2] + 1)) continue;
      if (terrainH(x, z) < 1.5) continue;
      return [x, z] as [number, number];
    }
    return null;
  }

  private queuePOIs() {
    const q = this.poiQueue;
    q.push(() => this.buildLiman());
    q.push(() => this.buildVillage(POIS.camlik, 11, 8));
    q.push(() => this.buildBridge());
    q.push(() => this.buildGas());
    q.push(() => this.buildVillage(POIS.yelkaya, 23, 8));
    q.push(() => this.buildQuarry());
    q.push(() => this.buildVillage(POIS.maden, 37, 8));
    q.push(() => this.buildCamp());
    q.push(() => this.buildPoles());
    q.push(() => this.buildSigns());
  }
  runAllPOIsNow(n = 99) { while (n-- > 0 && this.poiQueue.length) this.poiQueue.shift()!(); }

  buildVillage(poi: typeof POIS.liman, seed: number, count: number) {
    const r = rng(seed * 101);
    const placed: [number, number, number][] = [];
    const g = new THREE.Group(); this.staticGroup.add(g);
    for (let k = 0; k < count; k++) {
      const spot = this.freeSpot(poi.x, poi.z, 14, poi.r * 0.95, 8.5, r, placed);
      if (!spot) continue;
      const [x, z] = spot;
      const h = createHouse(seed + k);
      this.place(h, x, z, Math.atan2(poi.x - x, poi.z - z) + (r() - 0.5) * 0.5, -0.2);
      placed.push([x, z, 8]);
      this.addStatic(x - Math.cos(0) * 1.8, z, 3.6); this.addStatic(x + 1.8, z, 3.6);
      this.chimneys.push({ x: x + 1.5, y: terrainH(x, z) + 6.2, z });
      // lamba
      if (k % 3 === 0) { const lx = x + 2, lz = z + 4.6; this.lamp(lx, lz); }
    }
    // kuyu
    const well = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ map: T.ground(), color: 0x8a8578, roughness: 1 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1.0, 14), stone); ring.position.y = 0.5; well.add(ring);
    this.box(0.15, 2.0, 0.15, mat('wwood', () => new THREE.MeshStandardMaterial({ map: T.wood(), roughness: 1 })), 1.1, 1.8, 0, well); this.box(0.15, 2.0, 0.15, mat('wwood', () => new THREE.MeshStandardMaterial({ map: T.wood(), roughness: 1 })), -1.1, 1.8, 0, well);
    const rf = this.box(3, 0.12, 1.8, mat('wroof', () => new THREE.MeshStandardMaterial({ map: T.roofTile(), roughness: 0.9 })), 0, 2.9, 0, well); rf.rotation.z = 0.0;
    const wx = poi.x + 7, wz = poi.z + 6;
    this.place(well, wx, wz); this.addStatic(wx, wz, 1.6);
    // çit ve saman
    for (let i = 0; i < 10; i++) {
      const spot = this.freeSpot(poi.x, poi.z, 18, poi.r, 7, r, placed);
      if (!spot) continue;
      const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.0, 10), new THREE.MeshStandardMaterial({ color: 0xb59b52, roughness: 1 }));
      bale.rotation.z = Math.PI / 2; bale.position.y = 0.7; const grp = new THREE.Group(); grp.add(bale); this.place(grp, spot[0], spot[1], r() * 6); placed.push([spot[0], spot[1], 2]);
    }
    // teslimat işareti (köy meydanı) için düz bir levha
    const board = signMesh(poi.name.toUpperCase(), '#2f4a3a', '#e9e2cc', 'KÖY');
    const bs = nearestSample(poi.x, poi.z, 30); const sp = bs.idx >= 0 ? samples[bs.idx] : null;
    if (sp) this.place(board, poi.x + 7, poi.z - 7, 0.4);
  }

  lamp(x: number, z: number) {
    const g = new THREE.Group();
    const m = mat('lampPole', () => new THREE.MeshStandardMaterial({ map: T.rust(), roughness: 0.8, metalness: 0.6 }));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4.2, 6), m); pole.position.y = 2.1; pole.castShadow = true; g.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat('bulb', () => new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb860, emissiveIntensity: 3 }))); bulb.position.set(0.4, 4.1, 0); g.add(bulb);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), m); arm.position.set(0.2, 4.2, 0); g.add(arm);
    this.place(g, x, z); this.lampSpots.push({ x: x + 0.4, y: terrainH(x, z) + 4.0, z });
    this.addStatic(x, z, 0.3);
  }

  buildLiman() {
    const p = POIS.liman, r = rng(5);
    const placed: [number, number, number][] = [];
    // garaj binası (yola bakan açık kapı)
    const gar = new THREE.Group();
    const corr = mat('garWall', () => new THREE.MeshStandardMaterial({ map: T.corrugated(0x5f7f78), roughness: 0.75, metalness: 0.5 }));
    const corr2 = mat('garWall2', () => new THREE.MeshStandardMaterial({ map: T.corrugated(0x8a5a3a), roughness: 0.75, metalness: 0.5 }));
    const dark = mat('garDark', () => new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 }));
    this.box(0.3, 4.2, 9, corr, -6, 2.1, 0, gar); this.box(0.3, 4.2, 9, corr2, 6, 2.1, 0, gar); this.box(12.3, 4.2, 0.3, corr, 0, 2.1, -4.5, gar);
    this.box(3.6, 1.4, 0.3, corr2, -4.2, 3.5, 4.5, gar); this.box(3.6, 4.2, 0.3, corr, -4.2, 2.1, 4.5, gar); this.box(3.6, 4.2, 0.3, corr2, 4.2, 2.1, 4.5, gar); this.box(12.3, 0.9, 0.3, corr, 0, 3.75, 4.5, gar);
    const roof = this.box(13.4, 0.2, 10.4, mat('garRoof', () => new THREE.MeshStandardMaterial({ map: T.corrugated(0x6a6a62), roughness: 0.8, metalness: 0.6 })), 0, 4.45, 0, gar); roof.rotation.x = 0.07;
    this.box(12, 0.1, 9, dark, 0, 0.05, 0, gar);
    // ışıklı tabela
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.15), new THREE.MeshStandardMaterial({ map: T.sign('PASLI HAT', '#2a2622', '#e8a23a', 'USTA GARAJ'), roughness: 0.6, metalness: 0.3 }));
    sign.position.set(0, 5.1, 4.8); gar.add(sign);
    // alet tezgahı, lastikler, varil
    this.box(3, 1.0, 0.9, mat('bench', () => new THREE.MeshStandardMaterial({ map: T.wood(0x5a4a38), roughness: 0.9 })), -3.7, 0.5, -3.7, gar);
    for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.22, 8, 16), mat('stk', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }))); t.rotation.x = Math.PI / 2; t.position.set(4.7, 0.25 + i * 0.4, -3.4); t.castShadow = true; gar.add(t); }
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.95, 12), new THREE.MeshStandardMaterial({ map: T.corrugated([0x3a5f8a, 0x8a3a22, 0x5a6a3a][i]), roughness: 0.7, metalness: 0.6 })); b.position.set(-5, 0.48, 2 - i * 1.0); b.castShadow = true; gar.add(b); }
    // asılı lamba
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat('bulb', () => new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb860, emissiveIntensity: 3 }))); bulb.position.set(0, 3.7, 0); gar.add(bulb);
    const gx = p.x - 22, gz = p.z + 4;
    const ang = Math.atan2(p.x - gx, p.z - gz);
    this.place(gar, gx, gz, ang + 0.0, -0.15);
    this.lampSpots.push({ x: gx, y: terrainH(gx, gz) + 3.6, z: gz });
    placed.push([gx, gz, 11]);
    // statik çarpışma (duvarlar)
    for (let t = -5; t <= 5; t += 2.5) { this.addStatic(gx + Math.cos(ang) * t - Math.sin(ang) * 4.5, gz - Math.sin(ang) * t - Math.cos(ang) * 4.5 * 0 + Math.cos(ang) * 0 - 4.5 * Math.cos(ang) * 0, 2.2); }
    this.addStatic(gx, gz, 5.5);
    this.buildVillage(p, 3, 9);
    // iskele ve tekneler
    const dock = new THREE.Group();
    const wood = mat('dockwood', () => new THREE.MeshStandardMaterial({ map: T.wood(0x6a5238), roughness: 1 }));
    this.box(3, 0.2, 26, wood, 0, 0.7, 0, dock);
    for (let z = -12; z <= 12; z += 4) for (const sx of [-1.4, 1.4]) this.box(0.28, 3.6, 0.28, wood, sx, -0.6, z, dock);
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 6), new THREE.MeshStandardMaterial({ map: T.paint(0x2f5a7a, 71, 0.6), roughness: 0.7, metalness: 0.2 })); hull.position.y = 0.2; boat.add(hull);
    this.box(1.4, 1.2, 1.6, mat('cabinw', () => new THREE.MeshStandardMaterial({ map: T.wood(0xd8d0b8), roughness: 0.8 })), 0, 1.0, -0.6, boat);
    boat.position.set(3.2, 0.0, -2); boat.rotation.y = 0.05; dock.add(boat);
    // iskeleyi denize doğru uzat: sahile yakın uygun nokta
    let dx = p.x - 60, dz = p.z + 60;
    for (let t = 0; t < 40; t++) { const ax = p.x - 20 - t * 6, az = p.z + 10 + t * 6; if (terrainH(ax, az) < 0.2) { dx = ax + 10; dz = az - 10; break; } }
    dock.position.set(dx, 0, dz); dock.rotation.y = -Math.atan2(-1, 1) + Math.PI / 2 + 0.0;
    dock.rotation.y = Math.atan2(1, -1) * 0 + 0.78;
    this.staticGroup.add(dock);
    // sahil yaşam: fener
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 6), dark); b.visible = false; void b;
    void r;
  }

  buildBridge() {
    const B = BRIDGE;
    const g = new THREE.Group();
    const deckM = new THREE.MeshStandardMaterial({ map: T.wood(0x6a5238), roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ map: T.rust(), roughness: 0.85, metalness: 0.7 });
    const stone = new THREE.MeshStandardMaterial({ map: T.ground(), color: 0x9a968a, roughness: 1 });
    const L = B.halfLen * 2, W = B.halfWid * 2 + 0.8;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, W), deckM); deck.position.set(0, -0.3, 0); deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
    // alt kirişler
    for (const sz of [-3, 0, 3]) this.box(L, 0.5, 0.4, steel, 0, -0.75, sz, g);
    // taşıyıcı kafes (iki yan)
    const parts: THREE.BufferGeometry[] = [];
    const bay = 6, n = Math.round(L / bay);
    for (const sz of [-1, 1]) {
      const zz = sz * (B.halfWid + 0.15);
      const top = new THREE.BoxGeometry(L, 0.22, 0.22); top.translate(0, 3.2, zz); parts.push(top);
      const bot = new THREE.BoxGeometry(L, 0.25, 0.25); bot.translate(0, 0.0, zz); parts.push(bot);
      for (let i = 0; i <= n; i++) {
        const x = -L / 2 + i * bay;
        const v = new THREE.BoxGeometry(0.2, 3.2, 0.2); v.translate(x, 1.6, zz); parts.push(v);
        if (i < n && !(i === 5 && sz > 0)) { const d = new THREE.BoxGeometry(0.14, Math.hypot(bay, 3.2), 0.14); d.rotateZ(Math.atan2(bay, 3.2) * (i % 2 ? -1 : 1)); d.translate(x + bay / 2, 1.6, zz); parts.push(d); }
      }
    }
    for (let i = 1; i < n; i += 2) { const cb = new THREE.BoxGeometry(0.15, 0.15, W); cb.translate(-L / 2 + i * bay, 3.2, 0); parts.push(cb); }
    const truss = new THREE.Mesh(mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); return q; }).map((p) => { if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); return p; }))!, steel);
    truss.castShadow = true; truss.receiveShadow = true; g.add(truss);
    // ayaklar
    for (const px of [-L / 4, L / 4]) { const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.9, B.deckY + 9, 10), stone); pier.position.set(px, -(B.deckY + 9) / 2 + 0.2 - 0.6 + B.deckY * 0 - 0.0, 0); pier.position.y = -(B.deckY + 9) / 2 + 0 - 0.8; pier.castShadow = true; g.add(pier); }
    g.position.set(B.cx, B.deckY, B.z);
    this.staticGroup.add(g);
  }

  buildGas() {
    const p = POIS.gas, r = rng(77);
    const g = new THREE.Group();
    const concrete = mat('conc', () => new THREE.MeshStandardMaterial({ map: T.plaster(0xb8b2a2, 9), roughness: 1 }));
    const rust = mat('gRust', () => new THREE.MeshStandardMaterial({ map: T.corrugated(0xb04a2a), roughness: 0.8, metalness: 0.5 }));
    const dark = mat('gdark', () => new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 1 }));
    // saçak
    const roof = this.box(12, 0.35, 8, rust, 0, 5, 0, g); roof.rotation.z = 0.02; roof.rotation.x = -0.03;
    for (const sx of [-5, 5]) for (const sz of [-3, 3]) this.box(0.4, 5, 0.4, concrete, sx, 2.5, sz, g);
    for (const sx of [-2, 2]) {
      const pump = new THREE.Group();
      this.box(0.9, 1.7, 0.7, mat('pump', () => new THREE.MeshStandardMaterial({ map: T.paint(0xb8b090, 61, 0.9), roughness: 0.7, metalness: 0.4 })), 0, 0.85, 0, pump);
      this.box(0.7, 0.5, 0.05, dark, 0, 1.3, 0.37, pump);
      pump.position.set(sx, 0, 0); pump.rotation.y = sx * 0.01; pump.rotation.z = sx > 0 ? 0.12 : 0; g.add(pump);
    }
    const shop = new THREE.Group();
    this.box(8, 3.6, 6, concrete, 0, 1.8, 0, shop);
    this.box(8.6, 0.3, 6.6, rust, 0, 3.8, 0, shop);
    this.box(3, 1.4, 0.1, dark, 0, 1.7, 3.03, shop); this.box(1.5, 2.2, 0.1, dark, 2.6, 1.1, 3.03, shop);
    const sg = signMesh('BENZİN', '#9a2a1c', '#f2e8d0', 'AÇIK 24 SAAT');
    const sx = p.x - 22, sz = p.z + 16;
    this.place(sg, sx, sz, 0.8); this.addStatic(sx, sz, 0.4);
    const gx = p.x + 6, gz = p.z + 26;
    const spotG = this.freeSpot(p.x, p.z, 18, 28, 7, r, []) ?? [gx, gz];
    const ang = Math.atan2(p.x - spotG[0], p.z - spotG[1]);
    this.place(g, spotG[0], spotG[1], ang, 0); this.addStatic(spotG[0], spotG[1], 6);
    const shopSpot = this.freeSpot(p.x, p.z, 20, 33, 8, r, [[spotG[0], spotG[1], 13]]) ?? [p.x - 14, p.z - 24];
    this.place(shop, shopSpot[0], shopSpot[1], Math.atan2(p.x - shopSpot[0], p.z - shopSpot[1]), 0); this.addStatic(shopSpot[0], shopSpot[1], 5);
    this.lampSpots.push({ x: shopSpot[0], y: terrainH(shopSpot[0], shopSpot[1]) + 3, z: shopSpot[1] });
    // hurda araçlar
    for (let i = 0; i < 7; i++) {
      const spot = this.freeSpot(p.x, p.z, 14, 52, 9, r, [[spotG[0], spotG[1], 8], [shopSpot[0], shopSpot[1], 7]]);
      if (!spot) continue;
      const w = createWreckCar(i + 3); this.place(w, spot[0], spot[1], r() * 6.28, 0); this.addStatic(spot[0], spot[1], 2.4);
    }
  }

  buildQuarry() {
    const p = POIS.quarry, q = QUARRY_PIT, r = rng(55);
    const yellow = mat('qyel', () => new THREE.MeshStandardMaterial({ map: T.paint(0xc89a2a, 81, 0.75), roughness: 0.7, metalness: 0.4 }));
    const steel = mat('qsteel', () => new THREE.MeshStandardMaterial({ map: T.rust(), roughness: 0.85, metalness: 0.7 }));
    // vinç kulesi
    const crane = new THREE.Group();
    this.box(1.2, 14, 1.2, yellow, 0, 7, 0, crane);
    const jib = this.box(18, 0.8, 0.8, yellow, 6, 14.4, 0, crane);
    for (let i = 0; i < 6; i++) this.box(0.15, 0.15, 1.4, steel, -2 + i * 3, 13.8, 0, crane).rotation.z = 0.4;
    this.box(2.5, 1.8, 1.6, steel, -3.5, 13.5, 0, crane);
    const cable = this.box(0.06, 8, 0.06, steel, 13, 10, 0, crane);
    void jib; void cable;
    const ang = Math.atan2(q.x - p.x, q.z - p.z);
    const cx = q.x - 22 * Math.sin(ang) * -1 * 0 + (p.x - q.x) * 0.35 + (q.x - p.x) * 0, cz = q.z + (p.z - q.z) * 0.35;
    this.place(crane, cx, cz, 1.2); this.addStatic(cx, cz, 1.4);
    // baraka, konveyör, kamyon enkazları
    const shack = new THREE.Group();
    this.box(6, 3, 4, mat('qshack', () => new THREE.MeshStandardMaterial({ map: T.corrugated(0x9a7a3a), roughness: 0.8, metalness: 0.5 })), 0, 1.5, 0, shack);
    this.box(6.6, 0.25, 4.6, steel, 0, 3.1, 0, shack);
    const sp = this.freeSpot(p.x, p.z, 10, 30, 9, r, [[cx, cz, 4]]) ?? [p.x + 12, p.z + 10];
    this.place(shack, sp[0], sp[1], r() * 6); this.addStatic(sp[0], sp[1], 3.6);
    this.lampSpots.push({ x: sp[0], y: terrainH(sp[0], sp[1]) + 3.5, z: sp[1] });
    for (let i = 0; i < 6; i++) {
      const s = this.freeSpot(p.x, p.z, 8, 42, 8, r, [[cx, cz, 4], [sp[0], sp[1], 5]]); if (!s) continue;
      const w = createWreckCar(i * 3 + 1); w.scale.setScalar(i % 2 ? 1.3 : 1); this.place(w, s[0], s[1], r() * 6.28); this.addStatic(s[0], s[1], 2.6);
    }
    // taş yığınları (kaya instansları sahnede zaten var); kasa yığınları
    for (let i = 0; i < 8; i++) {
      const s = this.freeSpot(p.x, p.z, 8, 40, 7, r, []); if (!s) continue;
      const pile = new THREE.Mesh(new THREE.ConeGeometry(2 + r() * 2, 2 + r() * 1.5, 7), new THREE.MeshStandardMaterial({ map: T.ground(), color: 0x8a8274, roughness: 1, flatShading: true }));
      pile.position.y = 1; const gg = new THREE.Group(); gg.add(pile); this.place(gg, s[0], s[1], 0); this.addStatic(s[0], s[1], 2.4);
    }
    const t = signMesh('TEHLİKE', '#d8b02a', '#1a1a1a', 'TAŞ OCAĞI');
    this.place(t, p.x - 8, p.z + 8, 1.0);
  }

  buildCamp() {
    const p = POIS.camp, r = rng(99);
    const cloth = mat('tent', () => new THREE.MeshStandardMaterial({ map: T.plaster(0x6a5a44, 17), roughness: 1, side: THREE.DoubleSide }));
    const wood = mat('campwood', () => new THREE.MeshStandardMaterial({ map: T.wood(0x5a4430), roughness: 1 }));
    const metal = mat('campmetal', () => new THREE.MeshStandardMaterial({ map: T.rust(), roughness: 0.9, metalness: 0.6 }));
    const placed: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const s = this.freeSpot(p.x, p.z, 8, 30, 6, r, placed, [-Math.PI * 1.05, -Math.PI * -0.05 - Math.PI * 0]) ?? this.freeSpot(p.x, p.z, 8, 30, 6, r, placed);
      if (!s) continue;
      const tent = new THREE.Group();
      const c = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.8, 4, 1, true), cloth); c.position.y = 1.4; c.rotation.y = Math.PI / 4; c.castShadow = true; tent.add(c);
      this.place(tent, s[0], s[1], r() * 6); placed.push([s[0], s[1], 4.5]); this.addStatic(s[0], s[1], 2.2);
    }
    // gözetleme kulesi
    const tw = new THREE.Group();
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) this.box(0.28, 10, 0.28, wood, x, 5, z, tw).rotation.z = x * 0.02;
    this.box(4.2, 0.3, 4.2, wood, 0, 9, 0, tw);
    for (const sz of [-1, 1]) { this.box(4.2, 1, 0.12, wood, 0, 9.7, sz * 2, tw); this.box(0.12, 1, 4.2, wood, sz * 2, 9.7, 0, tw); }
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 4), cloth); cone.position.y = 12; cone.rotation.y = Math.PI / 4; tw.add(cone);
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) this.box(0.1, 3.0, 0.1, wood, x, 10.5, z, tw);
    const tx = p.x + 2, tz = p.z - 26;
    this.place(tw, tx, tz, 0.2); this.addStatic(tx, tz, 2.4);
    this.lampSpots.push({ x: tx, y: terrainH(tx, tz) + 9.5, z: tz });
    // siperlik çit (dikenli)
    for (let a = -2.7; a <= -0.4; a += 0.28) {
      const x = p.x + Math.cos(a) * 36, z = p.z + Math.sin(a) * 36;
      const f = new THREE.Group(); this.box(0.2, 2.2, 0.2, wood, 0, 1.1, 0, f);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.2, 5), metal); sp.position.y = 2.4; f.add(sp);
      this.place(f, x, z, 0); this.addStatic(x, z, 0.5);
    }
    // kamp ateşi
    const fx = p.x + 2, fz = p.z - 4;
    const fire = new THREE.Group();
    for (let i = 0; i < 6; i++) { const lg = this.box(0.15, 0.15, 1.1, wood, 0, 0.15, 0, fire); lg.rotation.y = i * 1.05; lg.rotation.z = 0.35; }
    this.place(fire, fx, fz, 0); this.fires.push({ x: fx, y: terrainH(fx, fz) + 0.6, z: fz });
    this.lampSpots.push({ x: fx, y: terrainH(fx, fz) + 1.6, z: fz });
    // bayrak
    const flag = new THREE.Group();
    this.box(0.12, 6, 0.12, wood, 0, 3, 0, flag);
    const c2 = document.createElement('canvas'); c2.width = 128; c2.height = 96; const x2 = c2.getContext('2d')!;
    x2.fillStyle = '#7a1612'; x2.fillRect(0, 0, 128, 96); x2.fillStyle = '#e8e0cc'; x2.font = '64px serif'; x2.textAlign = 'center'; x2.fillText('☠', 64, 70);
    const ft = new THREE.CanvasTexture(c2); ft.colorSpace = THREE.SRGBColorSpace;
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), new THREE.MeshStandardMaterial({ map: ft, side: THREE.DoubleSide, roughness: 1 })); fm.position.set(1.15, 5.1, 0); flag.add(fm);
    this.place(flag, p.x - 6, p.z - 12, 0.3);
    // kasalar, motosiklet iskeleleri
    for (let i = 0; i < 6; i++) {
      const s = this.freeSpot(p.x, p.z, 6, 24, 6, r, placed); if (!s) continue;
      const c = new THREE.Group(); this.box(1, 1, 1, mat('cc', () => new THREE.MeshStandardMaterial({ map: T.crate('crate'), roughness: 0.9 })), 0, 0.5, 0, c); this.place(c, s[0], s[1], r() * 6); placed.push([s[0], s[1], 2]); this.addStatic(s[0], s[1], 0.8);
    }
  }

  buildPoles() {
    const g = new THREE.CylinderGeometry(0.11, 0.15, 8, 6); g.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(2.4, 0.12, 0.12); arm.translate(0, 7.4, 0);
    const arm2 = new THREE.BoxGeometry(1.8, 0.1, 0.1); arm2.translate(0, 6.5, 0);
    const geo = mergeGeometries([g.toNonIndexed(), arm.toNonIndexed(), arm2.toNonIndexed()])!;
    const spots: { x: number; z: number; ry: number }[] = [];
    [0, 1, 2].forEach((ri) => {
      const list = roadIdx[ri]; let acc = 0;
      for (let k = 1; k < list.length - 1; k++) {
        const s = samples[list[k]], pr = samples[list[k - 1]];
        acc += Math.hypot(s.x - pr.x, s.z - pr.z);
        if (acc < 44) continue;
        if (s.bridge) continue;
        if (Object.values(POIS).some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 30)) continue;
        acc = 0;
        const nx = samples[list[k + 1]].x - pr.x, nz = samples[list[k + 1]].z - pr.z; const l = Math.hypot(nx, nz) || 1;
        spots.push({ x: s.x - (nz / l) * (s.hw + 5), z: s.z + (nx / l) * (s.hw + 5), ry: Math.atan2(nx, nz) });
      }
    });
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: T.wood(0x4a3a2a), roughness: 1 }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const wire: number[] = [];
    spots.forEach((s, i) => {
      const y = terrainH(s.x, s.z);
      e.set((Math.random() - 0.5) * 0.04, s.ry, (Math.random() - 0.5) * 0.06); q.setFromEuler(e); p.set(s.x, y, s.z); m.compose(p, q, one); im.setMatrixAt(i, m);
      this.addStatic(s.x, s.z, 0.35);
      const nx = spots[i + 1];
      if (nx && Math.hypot(nx.x - s.x, nx.z - s.z) < 60) {
        const y2 = terrainH(nx.x, nx.z);
        for (const off of [-1.1, 0, 1.1]) {
          const ax = Math.cos(s.ry) * off, az = -Math.sin(s.ry) * off;
          const bx = Math.cos(nx.ry) * off, bz = -Math.sin(nx.ry) * off;
          let px0 = s.x + ax, py0 = y + 7.4, pz0 = s.z + az;
          for (let k = 1; k <= 8; k++) {
            const t = k / 8;
            const px1 = lerp(s.x + ax, nx.x + bx, t), pz1 = lerp(s.z + az, nz2(nx.z + bz), t), py1 = lerp(y + 7.4, y2 + 7.4, t) - Math.sin(t * Math.PI) * 1.1;
            wire.push(px0, py0, pz0, px1, py1, pz1); px0 = px1; py0 = py1; pz0 = pz1;
          }
        }
      }
    });
    function nz2(v: number) { return v; }
    im.castShadow = true; this.scene.add(im);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const lines = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x151515 })); lines.frustumCulled = false; this.scene.add(lines);
  }

  buildSigns() {
    const defs: [string, string, string, string, number[]][] = [
      ['ÇAMLIK →', '#2f4a3a', '#e9e2cc', '4 KM', [-215, -48]], ['YELKAYA →', '#2f4a3a', '#e9e2cc', 'KÖPRÜ ÖTESİ', [cx0(-30), 70]],
      ['TEHLİKE', '#8a1c14', '#f2e8d0', 'HAYDUTLAR', [-62, -246]], ['KÖPRÜ', '#d8b02a', '#1a1a1a', 'AĞIR YÜK YASAK', [BRIDGE.cx - 56, 36]],
      ['MADEN →', '#2f4a3a', '#e9e2cc', 'TAŞ OCAĞI', [275, -85]], ['LİMAN ←', '#2f4a3a', '#e9e2cc', 'GARAJ', [-195, 140]],
    ];
    function cx0(d: number) { return BRIDGE.cx + d - 40; }
    defs.forEach(([a, b, c, d, pos], i) => { const s = signMesh(a, b, c, d); const ns = nearestSample(pos[0], pos[1], 30); const o = ns.idx >= 0 ? samples[ns.idx] : null; const x = o ? o.x + 6 : pos[0], z = o ? o.z + 3 : pos[1]; this.place(s, x, z, 0.6 + i); this.addStatic(x, z, 0.3); });
  }
}

export { createBarricade };
