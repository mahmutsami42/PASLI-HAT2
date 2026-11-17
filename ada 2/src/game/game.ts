import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { audio } from './audio';
import {
  CARGO_INFO, CargoType, Contract, DESTS, Derived, Quality, SaveData, UpgradeKey, WEAPONS, MAX_LEVEL, defaultSave, derive, genContracts, loadSave, upgradeCost, writeSave,
} from './data';
import { Debris, Particles, Rain, Tracers, makeParticleSystems } from './fx';
import { createPickup } from './models';
import { Raid } from './raid';
import {
  BRIDGE, Hazard, POIS, RouteField, adj, clamp, groundY, hazards, nearestSample, nodeIndex, onBridge, roadIdx, routePolyline, routeTo, samples, sampleAtDistanceAlong, terrainH,
  slopeAt, smoothstep, lerp, vnoise,
} from './terrain';
import { TruckRig, buildTruck } from './truck';
import { World } from './world';

export interface HudState {
  speed: number; progress: number; hull: number; engine: number; tires: number; fuel: number; fuelMax: number; cargo: number; cargoType: CargoType | null; scrap: number;
  weapon: { name: string; mag: number; magMax: number; reserve: number; reload: number; level: number }; mines: number; grenades: number; nitro: number; nitroMax: number;
  cam: 'drive' | 'rear'; raid: string; enemies: number; banner: { text: string; sub: string } | null; timeLeft: number | null; elapsed: number; hint: string; deliver: number; kits: number;
  paused: boolean; hurt: number; hit: number; kill: number; boss: number | null; hooked: boolean; wet: boolean; dest: string; free: boolean; gear: number; aiming: boolean; reloadKey: boolean; rpm: number;
}
export interface MissionResult {
  success: boolean; reason: string; title: string; dest: string; cargoName: string; cargoHP: number; time: number; par: number; stars: number; lines: { label: string; value: string; good?: boolean }[];
  money: number; scrap: number; kills: number; note: string; canContinue: boolean; boss: boolean;
}
export interface Events {
  onHud: (h: HudState) => void; onNotice: (t: string, kind: 'good' | 'danger' | 'info') => void; onEnd: (r: MissionResult) => void; onSave: (s: SaveData) => void; onReady: () => void;
  onMode: (m: 'menu' | 'garage' | 'drive') => void;
}
interface Mission { c: Contract; route: RouteField | null; first: boolean; free: boolean; poly: [number, number][]; dest: { x: number; z: number } | null; startFuel: number }
interface Pickup { mesh: THREE.Group; kind: 'scrap' | 'part' | 'fuel' | 'ammo'; x: number; z: number; taken: boolean; ph: number; pulled: boolean }

const wrapAng = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const SURF_GRIP = [7.5, 5.2, 4.4, 4.0];
const SURF_TOP = [1, 0.93, 0.85, 0.6];
const SURF_DRAG = [0.8, 1.4, 1.9, 3.4];

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uVig: { value: 0.35 }, uGrain: { value: 0.03 }, uHurt: { value: 0 }, uBlur: { value: 0 }, uSat: { value: 1.05 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; uniform float uGrain; uniform float uHurt; uniform float uBlur; uniform float uSat; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = length(c);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (uBlur > 0.001) { vec3 acc = col; for (int i = 1; i <= 6; i++) { acc += texture2D(tDiffuse, vUv - c * uBlur * float(i) * 0.06).rgb; } col = acc / 7.0; }
      vec2 ca = c * d * 0.006; col.r = mix(col.r, texture2D(tDiffuse, vUv + ca).r, 0.6); col.b = mix(col.b, texture2D(tDiffuse, vUv - ca).b, 0.6);
      float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, uSat);
      col *= 1.0 - smoothstep(0.35, 0.85, d) * uVig;
      col += (rnd(vUv * 1000.0) - 0.5) * uGrain;
      col = mix(col, vec3(0.9, 0.1, 0.05), uHurt * smoothstep(0.2, 0.8, d) * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Game {
  canvas: HTMLCanvasElement; ev: Events;
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null = null; bloom: UnrealBloomPass | null = null; gradePass: ShaderPass | null = null;
  world!: World; fx!: { smoke: Particles; glow: Particles; debris: Debris; tracers: Tracers }; rain: Rain | null = null;
  rig!: TruckRig; raid!: Raid;
  save: SaveData; d: Derived;
  mode: 'menu' | 'garage' | 'drive' = 'menu';
  paused = false; ended = false; time = 0; running = true; raf = 0;
  mission: Mission | null = null; progressMax = 0; progress = 0; nearestIdx = -1;
  run = { kills: 0, bonusMoney: 0, scrap: 0, elapsed: 0, pickups: 0, startHull: 100 };
  // kamyon
  tk = {
    x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, lat: 0, steer: 0, yawRate: 0, pitchG: 0, rollG: 0, bounce: 0, bounceV: 0, pitchX: 0, pitchXV: 0, rollX: 0, rollXV: 0,
    hull: 100, engine: 100, tires: 100, fuel: 25, cargo: 100, nitro: 0, nitroOn: false, throttle: 0, brake: 0, hand: 0, rpm: 800, gear: 1, shiftT: 0, surf: 0, wet: false, slip: 0, onRoad: true,
    accel: 0, hurt: 0, spin: 0, inMud: false, offroad: false, trauma: 0,
  };
  cargoType: CargoType | null = null;
  hooked = 0; killMarker = 0; hitMarker = 0; lastDelivery = 0; deliverT = 0; bossDead = false; kitsLeft = 1;
  // girdi
  keys: Record<string, boolean> = {}; mouse = { x: 0, y: 0, down: false, right: false }; camMode: 'drive' | 'rear' = 'drive';
  weapon = { mag: 6, reserve: 30, cd: 0, reload: 0, mines: 0, grenades: 0, recoil: 0, kick: 0 };
  // kamera
  camPos = new THREE.Vector3(); camLook = new THREE.Vector3(); camYaw = 0; camFov = 60; orbit = 0.6; orbitDrag = 0; orbitDist = 11; orbitShift = 0; camBlend = 0; camStart = 0; intro = 0; garageShift = 0;
  menuView: 'menu' | 'garage' = 'menu'; snapCam = false;
  // yardımcılar
  pickups: Pickup[] = []; hazardGrid = new Map<number, Hazard[]>(); hazardHit = new Map<Hazard, number>();
  flashL: THREE.PointLight; flashT = 0; muzzleL: THREE.PointLight; muzzleT = 0;
  hudT = 0; frameAcc: number[] = []; dynScale = 1; partLight = 1; lightningT = 8; thunderQ: number[] = [];
  minimapBase: HTMLCanvasElement | null = null; coughT = 3; smokeAcc = 0; dustAcc = 0; autoWob = 0; autoWobT = 0; lastCollide = 0; hitPothole = 0; nextRaidWarn = false;
  clock = performance.now(); notices = new Set<string>(); lowFuelWarned = false; lowHullWarned = false; reloadingKey = false; lastGear = 1;
  spawn = { x: -436, z: 251, yaw: Math.PI / 2 };

  constructor(canvas: HTMLCanvasElement, ev: Events) {
    this.canvas = canvas; this.ev = ev;
    this.save = loadSave() || defaultSave();
    this.d = derive(this.save.upgrades);
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false }));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2400);
    this.scene.add(this.camera);
    this.flashL = new THREE.PointLight(0xffa860, 0, 40, 2); this.scene.add(this.flashL);
    this.muzzleL = new THREE.PointLight(0xffd090, 0, 18, 2); this.scene.add(this.muzzleL);
    this.world = new World(this.scene, renderer);
    this.fx = { ...makeParticleSystems(this.scene, 1), debris: new Debris(this.scene, 120), tracers: new Tracers(this.scene) };
    this.raid = new Raid(this);
    this.hazardsIndex();
    this.initSpawn();
    this.world.setAtmosphere('sunset', 'clear', this.save.settings.quality);
    this.world.preload(this.spawn.x, this.spawn.z, 150);
    this.world.runAllPOIsNow(1);
    this.rebuildTruck(null);
    this.placeTruckAtSpawn();
    this.applyQuality(this.save.settings.quality, true);
    audio.vols = { master: this.save.settings.master, music: this.save.settings.music, sfx: this.save.settings.sfx };
    window.addEventListener('resize', this.onResize); window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMove); canvas.addEventListener('mousedown', this.onDown); window.addEventListener('mouseup', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); canvas.addEventListener('wheel', this.onWheel, { passive: true });
    this.onResize();
    this.enterMenu();
    setTimeout(() => this.makeMinimap(), 30);
    this.loop();
    setTimeout(() => this.ev.onReady(), 50);
  }

  dispose() {
    this.running = false; cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize); window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMove); window.removeEventListener('mouseup', this.onUp);
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ kurulum
  hazardsIndex() {
    this.hazardGrid.clear();
    for (const h of hazards) { const k = Math.floor(h.x / 16) * 4096 + Math.floor(h.z / 16); const a = this.hazardGrid.get(k) || []; a.push(h); this.hazardGrid.set(k, a); }
  }
  nearHazards(x: number, z: number, fn: (h: Hazard) => void) {
    const ci = Math.floor(x / 16), cj = Math.floor(z / 16);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const arr = this.hazardGrid.get((ci + a) * 4096 + (cj + b)); if (arr) for (const h of arr) if (!h.dead) fn(h); }
  }
  initSpawn() {
    const L = nodeIndex.L;
    const nxt = adj[L][0];
    const s = samples[L], n = samples[nxt];
    this.spawn = { x: s.x - 6, z: s.z + 1, yaw: Math.atan2(n.x - s.x, n.z - s.z) };
  }
  placeTruckAtSpawn() {
    const tk = this.tk;
    tk.x = this.spawn.x; tk.z = this.spawn.z; tk.yaw = this.spawn.yaw; tk.vx = tk.vz = tk.speed = tk.lat = tk.steer = tk.yawRate = 0; tk.y = groundY(tk.x, tk.z);
    this.applyTruckTransform(0.016, true);
  }
  rebuildTruck(cargo: CargoType | null) {
    if (this.rig) { this.scene.remove(this.rig.group); this.rig.dispose(); }
    this.cargoType = cargo;
    this.rig = buildTruck(this.save.upgrades, cargo, this.save.settings.quality !== 'low');
    this.rig.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(this.rig.group);
    this.rig.setCargo(this.tk.cargo);
    const night = this.world.time === 'night' || this.world.weather === 'rain';
    this.rig.setLights(night, this.save.settings.quality !== 'low');
    this.d = derive(this.save.upgrades);
  }
  applyQuality(q: Quality, first = false) {
    this.save.settings.quality = q;
    const r = this.renderer;
    this.world.setQuality(q);
    if (!first) this.world.updateEnv();
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const maxPR = { low: 1, medium: 1.25, high: 1.5, ultra: 2 }[q];
    const pr = Math.min(window.devicePixelRatio || 1, maxPR) * this.save.settings.resScale * this.dynScale;
    r.setPixelRatio(pr); r.setSize(w, h, false);
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (q === 'high' || q === 'ultra') {
      const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
      const c = new EffectComposer(r, rt); c.setPixelRatio(pr); c.setSize(w, h);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (q === 'ultra') {
        try { const ao = new GTAOPass(this.scene, this.camera, w, h); ao.blendIntensity = 0.9; ao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 10, distanceFallOff: 1, screenSpaceRadius: false }); c.addPass(ao); } catch { /* AO desteklenmiyor */ }
      }
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), q === 'ultra' ? 0.42 : 0.3, 0.65, 0.92); c.addPass(this.bloom);
      c.addPass(new OutputPass());
      this.gradePass = new ShaderPass(GRADE); this.gradePass.uniforms.uGrain.value = q === 'ultra' ? 0.035 : 0.02; c.addPass(this.gradePass);
      this.composer = c;
    }
    // parçacık/yağmur yoğunluğu
    this.fx.smoke.n = Math.round(1600 * (q === 'low' ? 0.4 : q === 'medium' ? 0.7 : q === 'high' ? 1 : 1)); this.fx.smoke.n = Math.min(this.fx.smoke.n, this.fx.smoke.life.length);
    this.setupRain();
    this.onResize();
  }
  setupRain() {
    if (this.rain) { this.rain.dispose(this.scene); this.rain = null; }
    if (this.world.weather === 'rain') this.rain = new Rain(this.scene, { low: 1500, medium: 3000, high: 5000, ultra: 8000 }[this.save.settings.quality]);
  }
  onResize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    this.fx.smoke.setScale(h * pr, this.camera.fov); this.fx.glow.setScale(h * pr, this.camera.fov);
  };
  updateSettings(s: Partial<SaveData['settings']>) {
    const prevQ = this.save.settings.quality, prevRes = this.save.settings.resScale;
    this.save.settings = { ...this.save.settings, ...s };
    audio.setVolumes(this.save.settings.master, this.save.settings.music, this.save.settings.sfx);
    if (s.quality && s.quality !== prevQ) this.applyQuality(s.quality);
    else if (s.resScale !== undefined && s.resScale !== prevRes) this.applyQuality(this.save.settings.quality);
    this.persist();
  }
  persist() { writeSave(this.save); this.ev.onSave({ ...this.save, upgrades: { ...this.save.upgrades }, truck: { ...this.save.truck }, settings: { ...this.save.settings } }); }

  // ------------------------------------------------------------------ girdiler
  onKey = (e: KeyboardEvent) => {
    if (e.repeat && e.code !== 'KeyH') { if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
    this.keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (this.mode !== 'drive') return;
    if (e.code === 'Escape') { this.setPaused(!this.paused); return; }
    if (this.paused || this.ended) return;
    if (e.code === 'KeyV') this.toggleRear();
    if (e.code === 'KeyR') this.useKitOrReload(e.shiftKey);
    if (e.code === 'KeyQ') this.dropMine();
    if (e.code === 'KeyE') this.shootGrenade();
    if (e.code === 'KeyH') audio.sfx('horn', 0.8);
    if (e.code === 'KeyF') this.reload();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.tryNitro();
  };
  onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };
  onMove = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    if (this.orbitDrag && this.mode !== 'drive') { this.orbit -= e.movementX * 0.006; }
  };
  onDown = (e: MouseEvent) => {
    audio.init();
    if (this.mode !== 'drive') { this.orbitDrag = 1; return; }
    if (this.paused || this.ended) return;
    if (e.button === 0) { this.mouse.down = true; if (this.camMode === 'rear') this.fire(true); }
    if (e.button === 2) { this.mouse.right = true; if (this.camMode === 'rear') this.shootGrenade(); }
  };
  onUp = (e: MouseEvent) => { if (e.button === 0) { this.mouse.down = false; this.orbitDrag = 0; } if (e.button === 2) this.mouse.right = false; };
  onWheel = (e: WheelEvent) => { if (this.mode !== 'drive') this.orbitDist = clamp(this.orbitDist + e.deltaY * 0.01, 6.5, 18); };

  setPaused(p: boolean) {
    this.paused = p;
    const c = audio.ctx; if (c) { if (p) c.suspend(); else c.resume(); }
    this.pushHud(true);
  }
  toggleRear() {
    if (this.mode !== 'drive' || this.ended) return;
    this.camMode = this.camMode === 'drive' ? 'rear' : 'drive';
    this.camStart = this.time; audio.sfx('click', 0.5);
    if (this.camMode === 'rear') this.notice('Silah kamerası: nişan al, sol tık ateş, sağ tık bomba. Oto-sürüş devrede. (V ile dön)', 'info');
  }
  setCam(m: 'drive' | 'rear') { if (this.camMode !== m) this.toggleRear(); }

  // ------------------------------------------------------------------ ekran geçişleri
  enterMenu() { this.enterStatic('menu'); }
  enterGarage() { this.enterStatic('garage'); }
  private enterStatic(view: 'menu' | 'garage') {
    const wasDrive = this.mode === 'drive';
    this.mode = view; this.menuView = view; this.ended = false; this.paused = false; this.camMode = 'drive';
    if (wasDrive || !this.rig) { this.raid.reset(); this.clearPickups(); }
    audio.ctx?.resume();
    this.world.setAtmosphere('sunset', 'clear', this.save.settings.quality); this.setupRain();
    this.resetTruckCond();
    this.rebuildTruck(null);
    this.placeTruckAtSpawn();
    this.world.preload(this.spawn.x, this.spawn.z, 150);
    this.rig.setLights(false, false);
    this.orbit = view === 'menu' ? 0.9 : 2.2; this.orbitDist = view === 'menu' ? 12 : 10.5;
    this.garageShift = view === 'garage' ? 3.2 : -2.8;
    this.snapCam = true;
    audio.setMood(view === 'menu' ? 'garage' : 'garage'); audio.setAmbience(0.9, 0.2, 0);
    audio.updateEngine({ rpm: 800, throttle: 0, health: 100, on: false, boost: false }); audio.updateTires({ speed: 0, surf: 0, wet: false, offroad: false, slip: 0, rough: 0 }); audio.silenceEnemies(); audio.ropeTension(0);
    this.ev.onMode(view);
  }
  resetTruckCond() {
    const c = this.save.truck, tk = this.tk;
    tk.hull = c.hull; tk.engine = c.engine; tk.tires = c.tires; tk.fuel = Math.min(c.fuel, this.d.tank); tk.cargo = 100; tk.hurt = 0;
  }

  // ------------------------------------------------------------------ garaj işlemleri
  buyUpgrade(key: UpgradeKey): { ok: boolean; msg: string } {
    const lv = this.save.upgrades[key];
    if (lv >= MAX_LEVEL) return { ok: false, msg: 'Zaten en üst seviye' };
    const c = upgradeCost(key, lv + 1);
    if (this.save.money < c.money) { audio.sfx('deny'); return { ok: false, msg: 'Yetersiz para' }; }
    if (this.save.scrap < c.scrap) { audio.sfx('deny'); return { ok: false, msg: 'Yetersiz hurda' }; }
    this.save.money -= c.money; this.save.scrap -= c.scrap; this.save.upgrades[key] = lv + 1;
    this.d = derive(this.save.upgrades);
    audio.sfx('buy'); audio.sfx('repair', 0.6);
    this.rebuildTruck(null); this.placeTruckAtSpawn(); this.rig.setLights(false, false);
    this.persist();
    return { ok: true, msg: 'Satın alındı' };
  }
  repairCost() {
    const c = this.save.truck;
    const m = Math.round((100 - c.hull) * 2.2 + (100 - c.engine) * 1.8 + (100 - c.tires) * 1.2);
    return m;
  }
  fuelCost() { return Math.round((this.d.tank - this.save.truck.fuel) * 3); }
  repairAll() {
    const cost = this.repairCost();
    if (cost <= 0) return { ok: false, msg: 'Kamyon zaten sağlam' };
    if (this.save.money < cost) { audio.sfx('deny'); return { ok: false, msg: 'Yetersiz para' }; }
    this.save.money -= cost; this.save.truck.hull = 100; this.save.truck.engine = 100; this.save.truck.tires = 100;
    audio.sfx('repair'); this.resetTruckCond(); this.persist(); return { ok: true, msg: 'Tamir edildi' };
  }
  refuel() {
    const cost = this.fuelCost();
    if (cost <= 0) return { ok: false, msg: 'Depo dolu' };
    const fuelNeeded = this.d.tank - this.save.truck.fuel;
    if (this.save.money < cost) {
      const can = Math.floor(this.save.money / 3); if (can <= 0) { audio.sfx('deny'); return { ok: false, msg: 'Yetersiz para' }; }
      this.save.money -= can * 3; this.save.truck.fuel += can; audio.sfx('fuel'); this.resetTruckCond(); this.persist(); return { ok: true, msg: 'Kısmen dolduruldu' };
    }
    this.save.money -= cost; this.save.truck.fuel = this.d.tank; void fuelNeeded;
    audio.sfx('fuel'); this.resetTruckCond(); this.persist(); return { ok: true, msg: 'Depo dolduruldu' };
  }
  contracts(): Contract[] {
    const lens: Record<string, number> = {};
    DESTS.forEach((d) => { lens[d.id] = routeTo(d.node, 'L').total; });
    return genContracts(this.save, lens);
  }
  freeContract(): Contract {
    return { id: 'free', dest: null, cargo: 'crate', difficulty: 1, title: 'Serbest Sürüş', time: 'day', weather: 'clear', free: true, routeLen: 0, reward: 0, timeLimit: 0, parTime: 0 };
  }
  previewCargo(c: CargoType | null) { if (this.mode === 'garage') { this.rebuildTruck(c); this.placeTruckAtSpawn(); this.rig.setLights(false, false); this.rig.setCargo(100); } }
  resetSave() { this.save = defaultSave(); this.persist(); this.d = derive(this.save.upgrades); this.enterMenu(); }

  // ------------------------------------------------------------------ görev başlangıcı
  startMission(c: Contract) {
    audio.init(); audio.ctx?.resume();
    this.raid.reset(); this.clearPickups();
    const tk = this.tk;
    const route = c.dest ? routeTo(c.dest.node, 'L') : null;
    const first = this.save.completed === 0 && !c.free;
    this.mission = { c, route, first, free: !!c.free, poly: route ? routePolyline(route, 'L') : [], dest: c.dest ? { x: samples[nodeIndex[c.dest.node]].x, z: samples[nodeIndex[c.dest.node]].z } : null, startFuel: tk.fuel };
    this.world.setAtmosphere(c.time, c.weather, this.save.settings.quality); this.setupRain();
    this.d = derive(this.save.upgrades);
    this.resetTruckCond();
    tk.fuel = Math.min(this.save.truck.fuel, this.d.tank);
    tk.nitro = this.d.nitro; tk.cargo = 100; tk.hurt = 0;
    this.cargoType = c.free ? null : c.cargo;
    this.rebuildTruck(this.cargoType);
    this.kitsLeft = this.d.kits;
    const wd = WEAPONS[this.save.upgrades.weapon];
    this.weapon = { mag: wd.mag, reserve: wd.mag * 4, cd: 0, reload: 0, mines: this.d.mines, grenades: this.d.grenades, recoil: 0, kick: 0 };
    this.run = { kills: 0, bonusMoney: 0, scrap: 0, elapsed: 0, pickups: 0, startHull: tk.hull };
    this.progress = 0; this.progressMax = 0; this.ended = false; this.paused = false; this.bossDead = false; this.deliverT = 0; this.hooked = 0;
    this.lowFuelWarned = false; this.lowHullWarned = false;
    this.camMode = 'drive'; this.mode = 'drive';
    this.spawn.yaw = this.spawn.yaw;
    if (route) { const n = nodeIndex.L; const nx = samples[route.next[n] >= 0 ? route.next[n] : adj[n][0]]; this.spawn.yaw = Math.atan2(nx.x - samples[n].x, nx.z - samples[n].z); }
    this.placeTruckAtSpawn();
    this.world.preload(tk.x, tk.z, 200);
    if (!c.free) this.raid.begin(c.difficulty, !!c.boss, this.save.completed * 31 + c.difficulty * 7 + Math.floor(Math.random() * 1000)); else this.raid.reset();
    this.spawnPickups();
    this.camPos.copy(this.camera.position); this.camYaw = tk.yaw; this.intro = 2.2; this.camStart = this.time;
    this.rig.setLights(c.time === 'night' || c.weather === 'rain', this.save.settings.quality !== 'low');
    audio.sfx('engstart', 0.9); audio.setMood('drive'); audio.setAmbience(0.35, 0.5, c.weather === 'rain' ? 1 : 0);
    this.ev.onMode('drive');
    this.notice(c.free ? 'Serbest sürüş: adayı keşfet, hurda topla.' : `Yük alındı: ${CARGO_INFO[c.cargo].name} → ${c.dest!.name}`, 'info');
    if (first) setTimeout(() => this.notice('İpucu: W gaz, A/D direksiyon, çukurlardan kaçın. Sarı hurdaları topla!', 'info'), 2500);
    this.pushHud(true);
  }
  clearPickups() { this.pickups.forEach((p) => this.scene.remove(p.mesh)); this.pickups = []; }
  spawnPickups() {
    const m = this.mission!; const r = (() => { let s = 12345 + this.save.completed * 17; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const place = (x: number, z: number, kind: Pickup['kind']) => {
      const g = createPickup(kind); g.position.set(x, groundY(x, z) + 0.9, z); this.scene.add(g);
      this.pickups.push({ mesh: g, kind, x, z, taken: false, ph: r() * 6, pulled: false });
    };
    const pickKind = (): Pickup['kind'] => { const v = r(); return v < 0.6 ? 'scrap' : v < 0.7 ? 'part' : v < 0.85 ? 'fuel' : 'ammo'; };
    const polys: number[][] = [];
    if (m.route) { let u = nodeIndex.L; const ids: number[] = []; let g = 0; while (u >= 0 && g++ < 4000) { ids.push(u); u = m.route.next[u]; } polys.push(ids); }
    else roadIdx.forEach((l) => polys.push(l));
    polys.forEach((ids) => {
      let acc = 0;
      for (let i = 1; i < ids.length - 1; i++) {
        const s = samples[ids[i]], p = samples[ids[i - 1]];
        acc += Math.hypot(s.x - p.x, s.z - p.z);
        if (acc < 34 + r() * 26) continue;
        acc = 0;
        if (Object.values(POIS).some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 25) || s.bridge) continue;
        const nx = samples[ids[i + 1]].x - p.x, nz = samples[ids[i + 1]].z - p.z; const L = Math.hypot(nx, nz) || 1;
        const off = (r() < 0.5 ? -1 : 1) * (s.hw - 0.2 + r() * 2.5);
        place(s.x - (nz / L) * off, s.z + (nx / L) * off, pickKind());
        if (r() < 0.25) place(s.x - (nz / L) * -off * 0.6, s.z + (nx / L) * -off * 0.6 + 4, 'scrap');
      }
    });
    // özel noktalar
    const g = POIS.gas; for (let i = 0; i < 3; i++) place(g.x + 10 + i * 4, g.z - 12 + i * 3, 'fuel');
    for (let i = 0; i < 5; i++) place(g.x - 14 + i * 5, g.z + 24 + (i % 2) * 6, 'scrap');
    const q = POIS.quarry; for (let i = 0; i < 3; i++) place(q.x - 6 + i * 6, q.z + 10 + i * 2, 'part');
    this.pickups = this.pickups.filter((p) => terrainH(p.x, p.z) > 1);
  }
  hookPoint() { const tk = this.tk; return new THREE.Vector3(tk.x - Math.sin(tk.yaw) * 3.8, tk.y + 1.4, tk.z - Math.cos(tk.yaw) * 3.8); }
  notice(t: string, kind: 'good' | 'danger' | 'info' = 'info') { this.ev.onNotice(t, kind); }
  addTrauma(a: number) { this.tk.trauma = Math.min(1, this.tk.trauma + a); }
  flashLight(x: number, y: number, z: number, i: number, dur: number) { this.flashL.position.set(x, y, z); this.flashL.intensity = i; this.flashT = dur; }
  onBossDown() { this.bossDead = true; this.notice('Haydut lideri devrildi!', 'good'); this.raid.finish(); }

  // ------------------------------------------------------------------ hasar
  hurtTruck(a: number, src: string) {
    if (this.ended || this.mode !== 'drive') return;
    const tk = this.tk;
    const dmg = a * this.d.dmgTaken;
    tk.hull -= dmg;
    tk.engine = Math.max(0, tk.engine - dmg * 0.28 * (this.save.upgrades.armor >= 4 ? 0.5 : 1) * (src === 'pothole' ? 0.3 : 1));
    if (src === 'pothole' || src === 'rock') tk.tires = Math.max(0, tk.tires - dmg * 0.9);
    tk.hurt = Math.min(1, tk.hurt + dmg * 0.05);
    if (tk.hull < 30 && !this.lowHullWarned) { this.lowHullWarned = true; this.notice('Gövde kritik! Tamir kiti: R', 'danger'); }
    if (tk.hull <= 0) { tk.hull = 0; this.fail('wrecked'); }
  }
  hurtCargo(a: number, src: string) {
    if (this.ended || !this.cargoType) return;
    const tk = this.tk;
    const k = CARGO_INFO[this.cargoType].dmg * this.d.cargoDmg;
    const prev = tk.cargo;
    tk.cargo = Math.max(0, tk.cargo - a * k);
    this.rig.setCargo(tk.cargo);
    if (Math.floor(prev / 25) !== Math.floor(tk.cargo / 25) || a > 6) { audio.sfx(this.cargoType === 'fragile' ? 'glass' : 'crate', 0.8); if (tk.cargo < 50) this.notice('Kargo ciddi hasar aldı!', 'danger'); }
    else audio.sfx('rattle', 0.5);
    void src;
    if (tk.cargo <= 0) this.fail('cargo');
  }
  useKitOrReload(shift: boolean) { if (shift) this.reload(); else this.useKit(); }
  useKit() {
    const tk = this.tk;
    if (this.kitsLeft <= 0) { this.notice('Tamir kiti kalmadı', 'danger'); audio.sfx('deny'); return; }
    if (tk.hull > 95 && tk.engine > 95) { this.notice('Kamyon sağlam', 'info'); return; }
    this.kitsLeft--; tk.hull = Math.min(100, tk.hull + 38); tk.engine = Math.min(100, tk.engine + 25); tk.tires = Math.min(100, tk.tires + 20);
    audio.sfx('repair'); this.notice('Tamir kiti kullanıldı', 'good'); this.lowHullWarned = false;
  }

  // ------------------------------------------------------------------ silah
  reload() {
    const w = WEAPONS[this.save.upgrades.weapon];
    if (this.weapon.reload > 0 || this.weapon.mag >= w.mag || this.weapon.reserve <= 0) return;
    this.weapon.reload = w.reload; audio.sfx('reload', 0.8);
  }
  aimRay() {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
    return ray.ray;
  }
  fire(initial: boolean) {
    const w = WEAPONS[this.save.upgrades.weapon], wp = this.weapon;
    if (this.camMode !== 'rear' || this.ended || this.paused) return;
    if (wp.reload > 0) return;
    if (!w.auto && !initial) return;
    if (wp.cd > 0) return;
    if (wp.mag <= 0) { if (wp.reserve > 0) this.reload(); else { audio.sfx('empty', 0.7); wp.cd = 0.3; } return; }
    wp.cd = w.cd; wp.mag--; wp.recoil = 1; wp.kick = Math.min(0.12, wp.kick + 0.025 * w.recoil);
    const ray = this.aimRay();
    const aimHit = this.raid.hitscan(ray.origin, ray.direction);
    const mpos = new THREE.Vector3(); this.rig.muzzle.getWorldPosition(mpos);
    const base = aimHit.point.clone().sub(mpos); if (base.lengthSq() < 4) base.copy(ray.direction);
    base.normalize();
    audio.sfx(w.sfx, 0.9);
    this.addTrauma(0.05 * w.recoil + 0.02);
    this.muzzleL.position.copy(mpos); this.muzzleL.intensity = 70; this.muzzleT = 0.05;
    for (let i = 0; i < 6; i++) this.fx.glow.emit(mpos.x, mpos.y, mpos.z, base.x * 12 + (Math.random() - 0.5) * 4, base.y * 12 + (Math.random() - 0.5) * 4, base.z * 12 + (Math.random() - 0.5) * 4 + this.tk.vz * 0.5, 0.08 + Math.random() * 0.05, 0.5, 0.1, 1, 0.8, 0.45, 1, 0, 3);
    this.fx.smoke.emit(mpos.x, mpos.y, mpos.z, base.x * 2, 0.5, base.z * 2, 0.8, 0.3, 1.4, 0.5, 0.5, 0.5, 0.25, -0.2, 1);
    // kovan
    this.fx.debris.emit(mpos.x + 0.2, mpos.y - 0.1, mpos.z, (Math.random() - 0.3) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.07, 0xc9a23a, 1.2);
    for (let i = 0; i < w.pellets; i++) {
      const dir = base.clone(); dir.x += (Math.random() - 0.5) * w.spread * 2; dir.y += (Math.random() - 0.5) * w.spread * 2; dir.z += (Math.random() - 0.5) * w.spread * 2; dir.normalize();
      const h = this.raid.hitscan(mpos, dir);
      if (i < 2 || w.pellets === 1) this.fx.tracers.add(mpos, h.point);
      if (h.kind === 'enemy' && h.enemy) { this.raid.damageEnemy(h.enemy, w.dmg, h.point); this.hitMarker = 0.18; }
      else if (h.kind === 'rope' && h.hookOwner) { h.hookOwner.hook!.hp -= w.dmg * 1.6; this.hitMarker = 0.18; audio.sfx('hit', 0.6); for (let k = 0; k < 4; k++) this.fx.glow.emit(h.point.x, h.point.y, h.point.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.2, 0.2, 0.03, 1, 0.9, 0.6, 1, 6, 1); if (h.hookOwner.hook!.hp <= 0) this.raid.releaseHook(h.hookOwner, true); }
      else if (h.kind === 'barricade' && h.barricade) { h.barricade.hp -= w.dmg * 1.2; this.hitMarker = 0.12; audio.sfx('metalhit', 0.4); if (h.barricade.hp <= 0) this.raid.breakBarricade(h.barricade); }
      else if (h.kind === 'ground') {
        const p = h.point; this.fx.smoke.emit(p.x, p.y + 0.1, p.z, 0, 1.2, 0, 0.9, 0.3, 1.4, 0.5 * this.partLight, 0.42 * this.partLight, 0.3 * this.partLight, 0.55, 0, 1);
        if (i < 2) this.fx.debris.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.07, 0x6a5a40, 1);
      }
    }
    if (wp.mag <= 0 && wp.reserve > 0) setTimeout(() => this.reload(), 220);
  }
  tryNitro() {
    const tk = this.tk;
    if (this.d.nitro <= 0) { if (!this.notices.has('nitro')) { this.notices.add('nitro'); this.notice('Nitro için Motor & Turbo geliştirmesi gerekli', 'info'); } return; }
    if (tk.nitro > 0.2 && !tk.nitroOn) { audio.sfx('nitro', 0.9); }
  }
  dropMine() {
    if (this.camMode !== 'drive' && this.camMode !== 'rear') return;
    const wp = this.weapon;
    if (this.d.mines <= 0) { this.notice('Mayın rafı için Patlayıcı Sistem gerekli', 'info'); return; }
    if (wp.mines <= 0) { audio.sfx('deny'); this.notice('Mayın kalmadı', 'danger'); return; }
    wp.mines--; const p = new THREE.Vector3(); this.rig.mineDrop.getWorldPosition(p);
    this.raid.dropMine(p.x, p.z, this.d.blast); audio.sfx('mine', 0.9);
  }
  shootGrenade() {
    const wp = this.weapon;
    if (this.d.grenades <= 0) { this.notice('Bomba atıcı için Patlayıcı Sistem seviye 2 gerekli', 'info'); return; }
    if (this.camMode !== 'rear') { this.notice('Bomba için silah kamerasına geç (V)', 'info'); return; }
    if (wp.grenades <= 0) { audio.sfx('deny'); this.notice('Bomba kalmadı', 'danger'); return; }
    if (this.grenCd > 0) return;
    this.grenCd = 0.8;
    wp.grenades--;
    const ray = this.aimRay(); const h = this.raid.hitscan(ray.origin, ray.direction);
    const o = new THREE.Vector3(); (this.rig.launcher || this.rig.muzzle).getWorldPosition(o); o.y += 0.5;
    const to = h.point.clone(); const dist = Math.max(8, o.distanceTo(to)); const T0 = dist / 42;
    const v = to.sub(o).divideScalar(T0); v.y += 8 * T0;
    this.raid.fireGrenade(o, v, this.d.blast);
    audio.sfx('smallboom', 0.9); this.addTrauma(0.2);
    for (let i = 0; i < 8; i++) this.fx.smoke.emit(o.x, o.y, o.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.9, 0.5, 2.2, 0.6, 0.6, 0.6, 0.5, 0, 1);
  }
  grenCd = 0;

  // ------------------------------------------------------------------ bitiş
  fail(reason: string) {
    if (this.ended) return;
    this.ended = true; audio.sfx('fail', 0.9); audio.setMood('garage'); audio.silenceEnemies(); audio.ropeTension(0);
    this.camMode = 'drive'; this.mouse.down = false;
    const tk = this.tk; const m = this.mission!;
    const txt: Record<string, [string, string]> = {
      wrecked: ['Kamyon kullanılamaz hale geldi', 'Gövde tamamen çöktü. Haydutlar yükü yağmaladı.'],
      cargo: ['Kargo tamamen yok oldu', 'Müşteri teslim alacak bir şey bulamadı.'],
      fuel: ['Yakıt bitti', 'Kamyon yolda kaldı. Yakıt almadan ilerleyemezsin.'],
    };
    const canContinue = reason !== 'cargo' && this.kitsLeft > 0;
    this.saveTruckCond(reason === 'wrecked');
    this.ev.onEnd({
      success: false, reason, title: txt[reason][0], dest: m.c.dest?.name || 'Serbest', cargoName: m.c.free ? '-' : CARGO_INFO[m.c.cargo].name, cargoHP: tk.cargo, time: this.run.elapsed, par: m.c.parTime, stars: 0,
      lines: [{ label: 'Neden', value: txt[reason][1] }, { label: 'Tamir kiti', value: this.kitsLeft > 0 ? `${this.kitsLeft} adet kaldı` : 'Kalmadı' }], money: 0, scrap: this.run.scrap, kills: this.run.kills, note: txt[reason][1], canContinue, boss: !!m.c.boss,
    });
  }
  continueAfterFail() {
    if (!this.ended || this.kitsLeft <= 0) return;
    const tk = this.tk; this.kitsLeft--; tk.hull = Math.max(tk.hull, 35); tk.engine = Math.max(tk.engine, 40); tk.fuel = Math.max(tk.fuel, 6);
    this.ended = false; this.lowHullWarned = false; audio.sfx('repair'); audio.setMood(this.raid.state === 'active' ? 'tension' : 'drive'); this.notice('Acil tamir yapıldı, devam!', 'good');
  }
  saveTruckCond(wrecked: boolean) {
    const tk = this.tk;
    this.save.truck = { hull: wrecked ? 25 : Math.max(5, tk.hull), engine: wrecked ? 30 : Math.max(10, tk.engine), tires: Math.max(10, tk.tires), fuel: Math.max(4, tk.fuel) };
    if (wrecked) this.save.money = Math.max(0, this.save.money - 60);
    this.save.scrap += this.run.scrap; this.save.totalScrap += this.run.scrap;
    this.persist();
  }
  deliver() {
    if (this.ended) return;
    this.ended = true; audio.sfx('win', 0.9); audio.setMood('relief'); audio.silenceEnemies(); audio.ropeTension(0); this.camMode = 'drive'; this.mouse.down = false;
    const m = this.mission!, c = m.c, tk = this.tk;
    const cargoF = 0.3 + 0.7 * (tk.cargo / 100);
    const t = this.run.elapsed;
    let timeBonus = 0;
    const urgentOk = c.cargo === 'urgent' && t <= c.timeLimit;
    if (c.cargo === 'urgent') { if (urgentOk) timeBonus = Math.round(c.reward * 0.6); } else if (t <= c.parTime) timeBonus = Math.round(c.reward * 0.15);
    const base = Math.round(c.reward * cargoF * (1 + this.d.payBonus));
    const scrapBonus = this.run.scrap * 8;
    const total = base + timeBonus + scrapBonus + this.run.bonusMoney;
    const s1 = tk.cargo >= 50, s2 = c.cargo === 'urgent' ? urgentOk : t <= c.parTime, s3 = this.run.scrap >= 3;
    const stars = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0);
    const notes = tk.cargo > 92 ? 'Kusursuz teslimat! Müşteri çok memnun.' : tk.cargo > 60 ? 'Kargoda ufak çizikler var ama sorun yok.' : 'Kargo epey yara almış. Daha yavaş ve dikkatli sür.';
    this.save.money += total; this.save.completed += 1; this.save.seed += 1;
    if (!c.free) this.save.stars[c.id] = Math.max(this.save.stars[c.id] || 0, stars);
    if (c.boss && this.bossDead) this.save.bossDefeated = true;
    this.saveTruckCond(false);
    this.notices.clear();
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    this.ev.onEnd({
      success: true, reason: 'ok', title: 'Teslimat tamamlandı!', dest: c.dest!.name, cargoName: CARGO_INFO[c.cargo].name, cargoHP: tk.cargo, time: t, par: c.parTime, stars,
      lines: [
        { label: 'Temel ödül', value: `${c.reward} ₺` }, { label: `Kargo durumu (%${Math.round(tk.cargo)})`, value: `${base - c.reward >= 0 ? '+' : ''}${base - c.reward} ₺`, good: base >= c.reward * 0.9 },
        { label: `Süre ${mm}:${String(ss).padStart(2, '0')}`, value: timeBonus > 0 ? `+${timeBonus} ₺` : 'Bonus yok', good: timeBonus > 0 },
        { label: `Toplanan hurda (${this.run.scrap})`, value: `+${scrapBonus} ₺`, good: this.run.scrap > 0 }, { label: `Haydut avı (${this.run.kills})`, value: `+${this.run.bonusMoney} ₺`, good: this.run.kills > 0 },
      ],
      money: total, scrap: this.run.scrap, kills: this.run.kills, note: notes, canContinue: false, boss: !!c.boss && this.bossDead,
    });
  }
  quitToGarage() { this.setPaused(false); this.ended = false; this.saveTruckCond(this.tk.hull <= 0); this.enterGarage(); }
  quitToMenu() { this.setPaused(false); this.ended = false; if (this.mode === 'drive') this.saveTruckCond(false); this.enterMenu(); }

  // ------------------------------------------------------------------ fizik
  surfaceAt(x: number, z: number) {
    if (onBridge(x, z)) return { surf: 0 as 0 | 1 | 2 | 3, road: true };
    const ns = nearestSample(x, z, 10);
    if (ns.idx >= 0 && ns.d < samples[ns.idx].hw + 0.9) return { surf: samples[ns.idx].surf as 0 | 1 | 2 | 3, road: true };
    return { surf: 3 as 0 | 1 | 2 | 3, road: false };
  }
  autopilot(dt: number) {
    const tk = this.tk; const m = this.mission;
    const skill = this.d.autoSkill;
    this.autoWobT -= dt;
    if (this.autoWobT <= 0) { this.autoWobT = 0.8 + Math.random() * 1.4; this.autoWob = (Math.random() - 0.5) * (1 - skill) * 0.9 + (Math.random() - 0.5) * 0.08; }
    if (this.nearestIdx < 0) return { steer: 0, thr: 0.3, brk: 0 };
    const L = 11 + tk.speed * 0.75;
    let ai = -1;
    if (m?.route) ai = sampleAtDistanceAlong(m.route, this.nearestIdx, L);
    else {
      let cur = this.nearestIdx, prev = -1, acc = 0, hx = Math.sin(tk.yaw), hz = Math.cos(tk.yaw), g = 0;
      while (acc < L && g++ < 40) {
        let best = -1, bd = -2;
        for (const n of adj[cur]) { if (n === prev) continue; const dx = samples[n].x - samples[cur].x, dz = samples[n].z - samples[cur].z; const l = Math.hypot(dx, dz) || 1; const dd = (dx * hx + dz * hz) / l; if (dd > bd) { bd = dd; best = n; } }
        if (best < 0 || bd < -0.2) break;
        const dx = samples[best].x - samples[cur].x, dz = samples[best].z - samples[cur].z; const l = Math.hypot(dx, dz) || 1; hx = dx / l; hz = dz / l; acc += l; prev = cur; cur = best;
      }
      ai = cur;
    }
    const tgt = samples[ai];
    let err = wrapAng(Math.atan2(tgt.x - tk.x, tgt.z - tk.z) - tk.yaw);
    err += this.autoWob;
    const steer = clamp(-err * 1.9, -1, 1);
    const mm = this.mission?.dest; const dd = mm ? Math.hypot(mm.x - tk.x, mm.z - tk.z) : 999;
    let target = 0.62 * 21 * this.d.topSpeed;
    if (Math.abs(err) > 0.45) target *= 0.6;
    if (dd < 50) target = Math.max(0, (dd - 8) * 0.35);
    const thr = tk.speed < target ? 1 : 0, brk = tk.speed > target + 3 ? 0.6 : 0;
    return { steer, thr, brk };
  }
  inputs() {
    const k = this.keys;
    let thr = (k.KeyW || k.ArrowUp ? 1 : 0), brk = (k.KeyS || k.ArrowDown ? 1 : 0);
    let st = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const hand = k.Space ? 1 : 0;
    if (this.camMode === 'rear') { const a = this.autopilot(0.016); st = clamp(a.steer + st * 0.5, -1, 1); thr = a.thr; brk = a.brk; }
    return { thr, brk, st, hand, nitro: !!(k.ShiftLeft || k.ShiftRight) };
  }
  stepTruck(dt: number) {
    const tk = this.tk, d = this.d, w = this.world;
    const inp = this.ended ? { thr: 0, brk: 0.6, st: 0, hand: 0, nitro: false } : this.intro > 0.5 ? { thr: 0, brk: 0, st: 0, hand: 0, nitro: false } : this.inputs();
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw), lx = Math.cos(tk.yaw), lz = -Math.sin(tk.yaw);
    let vf = tk.vx * fx + tk.vz * fz, vl = tk.vx * lx + tk.vz * lz;
    // yüzey
    const sf = this.surfaceAt(tk.x, tk.z);
    let inMud = false; let surf = sf.surf;
    this.nearHazards(tk.x, tk.z, (h) => { if (h.kind === 'mud' && Math.hypot(h.x - tk.x, h.z - tk.z) < h.r * 0.9) inMud = true; });
    tk.inMud = inMud; tk.surf = surf; tk.onRoad = sf.road; tk.offroad = !sf.road;
    const rain = w.weather === 'rain'; tk.wet = rain;
    // yakıt / motor
    const engF = 0.55 + 0.45 * (tk.engine / 100);
    const fuelOk = tk.fuel > 0;
    tk.throttle += (inp.thr - tk.throttle) * Math.min(1, dt * 6); tk.brake = inp.brk;
    const slopeL = (groundY(tk.x + fx * 2, tk.z + fz * 2) - groundY(tk.x - fx * 2, tk.z - fz * 2)) / 4;
    // nitro
    tk.nitroOn = inp.nitro && tk.nitro > 0 && inp.thr > 0 && d.nitro > 0 && fuelOk;
    if (tk.nitroOn) { tk.nitro = Math.max(0, tk.nitro - dt); }
    let top = 21 * d.topSpeed * SURF_TOP[surf] * (inMud ? 0.62 : 1) * (0.9 + 0.1 * engF) * (tk.nitroOn ? 1.28 : 1);
    if (this.hooked > 0) top *= 1 - 0.34 * Math.min(2, this.hooked);
    let acc = 0;
    if (fuelOk && inp.thr > 0) {
      const s = clamp(vf / top, 0, 1.2);
      acc = 4.7 * d.accel * engF * tk.throttle * (1 - s * s * s) * (tk.shiftT > 0 ? 0.25 : 1) * (tk.nitroOn ? 1.9 : 1);
      if (vf < -0.5) acc = 9;
    }
    // frenleme / geri vites
    if (inp.brk > 0) {
      if (vf > 0.6) acc -= 9.5 * (surf === 0 && !rain ? 1 : 0.8);
      else acc -= 3.4 * d.accel * engF * (vf > -6 ? 1 : 0);
    }
    if (inp.hand > 0) acc -= vf > 0 ? 4.5 : -4.5 * Math.sign(vf);
    // direnç
    const coast = SURF_DRAG[surf] * (inMud ? 1.6 : 1);
    if (inp.thr === 0 && inp.brk === 0 || !fuelOk) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, coast + 0.0025 * vf * vf);
    else acc -= Math.sign(vf) * (0.35 + 0.0016 * vf * vf);
    acc -= 9.8 * slopeL * 0.55;
    if (this.hooked > 0) acc -= Math.min(1, vf / 6) * 3.4 * this.hooked;
    vf += acc * dt;
    if (vf > top * 1.02 && !tk.nitroOn) vf -= (vf - top) * Math.min(1, dt * 1.5);
    // direksiyon
    const steerTarget = inp.st;
    tk.steer += (steerTarget - tk.steer) * Math.min(1, dt * (steerTarget === 0 ? 5 : 3.1));
    const maxAng = lerp(0.52, 0.16, clamp(Math.abs(vf) / 21, 0, 1));
    const wetK = rain && surf !== 3 ? 0.9 : 1;
    const target = -tk.steer * maxAng * vf / 3.9 * wetK * (0.8 + 0.2 * (tk.tires / 100));
    tk.yawRate += (target - tk.yawRate) * Math.min(1, dt * (inp.hand ? 5.5 : 3.6));
    if (inp.hand && Math.abs(vf) > 4) tk.yawRate *= 1 + dt * 1.5 * Math.abs(tk.steer);
    tk.yaw += tk.yawRate * dt;
    // yanal tutuş
    let grip = SURF_GRIP[surf] * d.grip * (0.8 + 0.2 * (tk.tires / 100)) * (rain ? (surf === 0 ? 0.62 : surf === 3 ? 0.8 : 0.78) : 1) * (inMud ? 0.66 : 1);
    if (inp.hand) grip *= 0.22;
    const slipPrev = Math.abs(vl);
    vl *= Math.exp(-grip * dt);
    tk.slip = Math.abs(vl) + Math.abs(tk.yawRate) * Math.abs(vf) * 0.2; void slipPrev;
    // yeni yaw'a göre dünya hızı (yaw değişti → bileşenleri yeniden hesapla)
    const nfx = Math.sin(tk.yaw), nfz = Math.cos(tk.yaw), nlx = Math.cos(tk.yaw), nlz = -Math.sin(tk.yaw);
    // yönlenme: hızın bir kısmı yeni yöne taşınır (ağırlık hissi için grip ile)
    const vxo = tk.vx, vzo = tk.vz;
    const keep = 1 - Math.exp(-grip * 0.5 * dt);
    const nvx = nfx * vf + nlx * vl, nvz = nfz * vf + nlz * vl;
    tk.vx = vxo + (nvx - vxo) * Math.min(1, 0.55 + keep); tk.vz = vzo + (nvz - vzo) * Math.min(1, 0.55 + keep);
    // uzun yöndeki ivme (yalpa/yunuslama için)
    tk.accel += (acc - tk.accel) * Math.min(1, dt * 5);
    tk.x += tk.vx * dt; tk.z += tk.vz * dt;
    tk.speed = tk.vx * nfx + tk.vz * nfz;
    // yakıt tüketimi
    if (tk.fuel > 0) { tk.fuel = Math.max(0, tk.fuel - (0.03 + 0.085 * tk.throttle + (tk.nitroOn ? 0.25 : 0)) * dt * (this.mission?.free ? 0.6 : 1)); }
    if (tk.fuel < 5 && !this.lowFuelWarned) { this.lowFuelWarned = true; this.notice('Yakıt azalıyor! Yol kenarındaki kırmızı bidonları topla.', 'danger'); }
    if (tk.fuel <= 0 && Math.abs(tk.speed) < 1.2 && !this.ended && this.mission && !this.mission.free) this.fail('fuel');
    // deniz sınırı
    const hh = terrainH(tk.x, tk.z);
    if (hh < -0.3 && !onBridge(tk.x, tk.z)) {
      const l = Math.hypot(tk.x, tk.z) || 1; tk.vx -= (tk.x / l) * 12 * dt + tk.vx * dt * 3; tk.vz -= (tk.z / l) * 12 * dt + tk.vz * dt * 3;
      if (!this.notices.has('sea')) { this.notices.add('sea'); this.notice('Deniz! Geri dön.', 'danger'); setTimeout(() => this.notices.delete('sea'), 4000); }
    }
    // köprü korkulukları
    if (Math.abs(tk.x - BRIDGE.cx) < BRIDGE.halfLen + 1 && Math.abs(tk.z - BRIDGE.z) < BRIDGE.halfWid + 3) {
      const lim = BRIDGE.halfWid - 1.35;
      if (Math.abs(tk.x - BRIDGE.cx) < BRIDGE.halfLen) {
        const dz = tk.z - BRIDGE.z;
        if (Math.abs(dz) > lim) { const sg = Math.sign(dz); tk.z = BRIDGE.z + sg * lim; if (tk.vz * sg > 1) { const imp = tk.vz * sg; tk.vz *= -0.2; if (imp > 2) { this.hurtTruck(imp * 0.5, 'collision'); this.addTrauma(0.25); audio.sfx('metalhit', 0.8); for (let i = 0; i < 6; i++) this.fx.glow.emit(tk.x, tk.y + 1, tk.z + sg * 1.2, (Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4, 0.3, 0.2, 0.03, 1, 0.7, 0.3, 1, 8, 1); } } }
      }
    }
    // çarpışmalar
    this.collisions();
    // çukur & engel
    this.hazardsStep();
    // vites / rpm
    const v = Math.abs(tk.speed);
    const gears = [0, 5.5, 10.5, 16, 22, 99];
    let gear = 1; for (let i = 1; i < 5; i++) if (v >= gears[i]) gear = i + 1;
    if (gear !== tk.gear) { if (v > 1.5) { tk.shiftT = 0.3; audio.sfx('gear', 0.6); if (Math.random() < 0.6) this.coughSmoke(1.4); } tk.gear = gear; }
    tk.shiftT = Math.max(0, tk.shiftT - dt);
    const lo = gears[gear - 1], hi = gears[gear];
    const targetRpm = v < 0.8 ? 800 + tk.throttle * 1400 : 1000 + clamp((v - lo) / Math.min(hi - lo, 12), 0, 1) * 2600 + tk.throttle * 350 - (tk.shiftT > 0 ? 900 : 0) + (tk.nitroOn ? 400 : 0);
    tk.rpm += (targetRpm - tk.rpm) * Math.min(1, dt * 7);
    // hasar duman bayrakları
    tk.hurt = Math.max(0, tk.hurt - dt * 1.6);
    tk.trauma = Math.max(0, tk.trauma - dt * 1.5);
  }

  collisions() {
    const tk = this.tk, d = this.d;
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw);
    const circles: [number, number][] = [[2.5, 1.35], [0.2, 1.4], [-2.5, 1.35]];
    const hit = (cxo: number, czo: number, r: number, front: boolean, ox: number, oz: number, or: number, kind: string, onBreak?: () => void) => {
      const dx = cxo - ox, dz = czo - oz; const dist = Math.hypot(dx, dz); const min = or + r;
      if (dist >= min || dist < 0.001) return;
      const nx = dx / dist, nz = dz / dist, pen = min - dist;
      tk.x += nx * pen; tk.z += nz * pen;
      const vn = tk.vx * nx + tk.vz * nz;
      if (vn < 0) {
        tk.vx -= 1.25 * vn * nx; tk.vz -= 1.25 * vn * nz; const imp = -vn;
        if (imp > 2.2 && this.time - this.lastCollide > 0.2) {
          this.lastCollide = this.time;
          this.hurtTruck((imp - 1.5) * 1.35 * (front ? d.bumperDmg : 1.0), kind);
          if (imp > 4.5) this.hurtCargo((imp - 4) * 0.9, kind);
          this.addTrauma(clamp(imp * 0.06, 0.1, 0.7)); audio.sfx(imp > 7 ? 'crash' : 'metalhit', clamp(imp / 8, 0.4, 1));
          for (let i = 0; i < 6; i++) this.fx.glow.emit(cxo - nx * 1.2, tk.y + 0.9, czo - nz * 1.2, (Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5, 0.3, 0.25, 0.03, 1, 0.7, 0.3, 1, 8, 1);
          if (onBreak) onBreak();
        }
      }
    };
    for (let ci = 0; ci < circles.length; ci++) {
      const [zo, r] = circles[ci];
      const cx = tk.x + fx * zo, cz = tk.z + fz * zo;
      this.world.queryColliders(cx, cz, (ox, oz, or) => hit(cx, cz, r, ci === 0, ox, oz, or, 'tree'));
      this.nearHazards(cx, cz, (h) => { if (h.kind === 'rock') hit(cx, cz, r, ci === 0, h.x, h.z, h.r * 0.9, 'rock'); });
      // barikatlar
      for (const b of this.raid.barricades) {
        if (b.dead) continue;
        for (const k of [-3, -1.5, 0, 1.5, 3]) {
          const ox = b.x + Math.cos(b.yaw) * k, oz = b.z - Math.sin(b.yaw) * k;
          const dd = Math.hypot(cx - ox, cz - oz);
          if (dd < 0.95 + r) {
            const sp = Math.max(0, tk.speed); const need = [11, 11, 8, 7, 5][this.save.upgrades.bumper];
            if (ci === 0 && sp > need) {
              this.raid.breakBarricade(b); tk.vx *= 0.7; tk.vz *= 0.7; this.hurtTruck(sp * 0.35 * d.bumperDmg, 'collision'); this.addTrauma(0.5); this.notice('Barikat parçalandı!', 'good');
            } else hit(cx, cz, r, ci === 0, ox, oz, 0.95, 'barricade', () => { b.hp -= sp * 2.2 * d.ram; if (b.hp <= 0) this.raid.breakBarricade(b); });
          }
        }
      }
    }
  }

  hazardsStep() {
    const tk = this.tk, d = this.d, world = this.world;
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw), lx = Math.cos(tk.yaw), lz = -Math.sin(tk.yaw);
    const wheels: [number, number][] = [[0.98, 1.95], [-0.98, 1.95], [0.98, -1.95], [-0.98, -1.95]];
    const spd = Math.abs(tk.speed);
    for (const [wx0, wz0] of wheels) {
      const wx = tk.x + fx * wz0 + lx * wx0, wz = tk.z + fz * wz0 + lz * wx0;
      this.nearHazards(wx, wz, (h) => {
        const dist = Math.hypot(h.x - wx, h.z - wz);
        if (h.kind === 'pothole' && dist < h.r * 1.1) {
          const last = this.hazardHit.get(h) || -9;
          if (this.time - last > 0.5) {
            this.hazardHit.set(h, this.time);
            if (spd < 2) return;
            const imp = (2 + spd * 0.38) * d.shock * (0.8 + 0.4 * (1 - tk.tires / 100));
            tk.bounceV -= imp * 0.55; tk.pitchXV += (wz0 > 0 ? 1 : -1) * imp * 0.05; tk.rollXV += (wx0 > 0 ? 1 : -1) * imp * 0.05;
            this.addTrauma(clamp(imp * 0.035, 0.08, 0.55) * (this.save.settings.shake ? 1 : 0.4));
            this.hurtTruck((0.5 + spd * 0.08) * d.shock, 'pothole');
            if (spd > 7) this.hurtCargo((spd - 5) * 0.42 * d.shock, 'pothole');
            audio.sfx('thud', clamp(spd / 18, 0.4, 1)); if (spd > 9) audio.sfx('rattle', 0.5);
            for (let i = 0; i < 6; i++) this.fx.smoke.emit(wx, tk.y + 0.2, wz, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.9, 0.4, 1.8, 0.4 * this.partLight, 0.33 * this.partLight, 0.25 * this.partLight, 0.55, -0.2, 1);
            for (let i = 0; i < 4; i++) this.fx.debris.emit(wx, tk.y + 0.3, wz, (Math.random() - 0.5) * 5 - tk.vx * 0.1, 3 + Math.random() * 3, (Math.random() - 0.5) * 5 - tk.vz * 0.1, 0.06 + Math.random() * 0.08, 0x6a5a48, 1.4);
          }
        }
      });
    }
    // enkaz ve variller (dinamik)
    const cs: [number, number][] = [[2.5, 1.2], [0.2, 1.2], [-2.5, 1.2]];
    for (const [zo, r] of cs) {
      const cx = tk.x + fx * zo, cz = tk.z + fz * zo;
      this.nearHazards(cx, cz, (h) => {
        if ((h.kind === 'debris' || h.kind === 'barrel') && Math.hypot(h.x - cx, h.z - cz) < h.r + r + (h.kind === 'debris' ? 0.9 : 0)) {
          if (spd < 1) return;
          world.killHazard(h); world.killHazard(h);
          audio.sfx(h.kind === 'barrel' ? 'metalhit' : 'crate', 0.8); this.addTrauma(h.kind === 'barrel' ? 0.3 : 0.18);
          this.hurtTruck((h.kind === 'barrel' ? 2.5 : 1.4) + spd * 0.1, 'debris'); if (spd > 10) this.hurtCargo(h.kind === 'barrel' ? 3 : 1.5, 'debris');
          const n = h.kind === 'barrel' ? 6 : 8;
          for (let i = 0; i < n; i++) this.fx.debris.emit(h.x, tk.y + 0.6, h.z, tk.vx * 0.6 + (Math.random() - 0.5) * 8, 4 + Math.random() * 5, tk.vz * 0.6 + (Math.random() - 0.5) * 8, 0.1 + Math.random() * 0.2, h.kind === 'barrel' ? 0x8a3a22 : 0x7a5a38, 2.5);
        }
      });
    }
  }

  coughSmoke(k: number) {
    const p = new THREE.Vector3(); this.rig.exhaust.getWorldPosition(p);
    const n = Math.round(5 * k);
    for (let i = 0; i < n; i++) this.fx.smoke.emit(p.x, p.y, p.z, this.tk.vx * 0.5 + (Math.random() - 0.5) * 1.2, 2 + Math.random(), this.tk.vz * 0.5 + (Math.random() - 0.5) * 1.2, 1.8, 0.35, 2.4, 0.05, 0.05, 0.05, 0.7, -0.5, 0.5);
  }

  applyTruckTransform(dt: number, snap = false) {
    const tk = this.tk, rig = this.rig;
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw), lx = Math.cos(tk.yaw), lz = -Math.sin(tk.yaw);
    const L = 1.95, Wd = 0.98;
    const h = (a: number, b: number) => groundY(tk.x + fx * a + lx * b, tk.z + fz * a + lz * b);
    const hFL = h(L, Wd), hFR = h(L, -Wd), hRL = h(-L, Wd), hRR = h(-L, -Wd);
    const avg = (hFL + hFR + hRL + hRR) / 4;
    const pitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, L * 2), roll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, Wd * 2);
    const k = snap ? 1 : Math.min(1, dt * 14);
    tk.y += (avg - tk.y) * k; tk.pitchG += (pitch - tk.pitchG) * k; tk.rollG += (roll - tk.rollG) * k;
    // yaylı gövde
    const tPitch = clamp(tk.accel * 0.0065, -0.05, 0.05), tRoll = clamp(tk.speed * tk.yawRate * 0.0065, -0.1, 0.1);
    const kk = 55, cc = 7;
    tk.pitchXV += (-kk * (tk.pitchX - tPitch) - cc * tk.pitchXV) * dt; tk.pitchX += tk.pitchXV * dt;
    tk.rollXV += (-kk * (tk.rollX - tRoll) - cc * tk.rollXV) * dt; tk.rollX += tk.rollXV * dt;
    tk.bounceV += (-110 * tk.bounce - 9 * tk.bounceV) * dt; tk.bounce += tk.bounceV * dt;
    tk.bounce = clamp(tk.bounce, -0.45, 0.45);
    // zemin sarsıntısı (çakıl / arazi)
    if (!snap && Math.abs(tk.speed) > 2) {
      const rough = tk.offroad ? 1 : tk.surf === 2 ? 0.6 : tk.surf === 1 ? 0.35 : 0.08;
      tk.bounceV += (Math.random() - 0.5) * rough * Math.min(1, Math.abs(tk.speed) / 12) * 1.6 * (0.6 + 0.4 * this.d.shock);
    }
    rig.group.position.set(tk.x, tk.y, tk.z);
    rig.group.rotation.set(-tk.pitchG, tk.yaw, tk.rollG, 'YXZ');
    rig.body.position.y = tk.bounce; rig.body.rotation.set(-tk.pitchX, 0, tk.rollX);
    // tekerlekler
    const wr = rig.wheelR;
    const resid = [hFL, hFR, hRL, hRR];
    const planeAt = (a: number, b: number) => avg + Math.tan(pitch) * a + Math.tan(roll) * b;
    rig.wheels.forEach((w, i) => {
      const idx = i < 4 ? i : (i === 4 ? 2 : 3);
      const a = w.front ? L : -L, b = w.x > 0 ? Wd : -Wd;
      const r = clamp(resid[idx] - planeAt(a, b), -0.3, 0.3);
      w.pivot.position.y = wr + r + (w.front ? 0 : 0) - 0.0;
      w.spin.rotation.x += (tk.speed * dt) / wr;
      w.pivot.rotation.y = w.front ? -tk.steer * 0.45 * (1 - clamp(Math.abs(tk.speed) / 40, 0, 0.5)) : 0;
    });
    // yaylı gevşek parçalar
    rig.updateLoose(dt, tk.speed * tk.yawRate, tk.accel, tk.bounceV);
    rig.setBrake(tk.brake > 0 ? 1 : 0);
    if (rig.magnet) rig.magnet.rotation.y += dt * 2;
    rig.group.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ kamera
  updateCamera(dt: number) {
    const cam = this.camera, tk = this.tk;
    const shk = this.save.settings.shake ? 1 : 0.35;
    const tr = tk.trauma * tk.trauma * shk;
    if (this.mode !== 'drive') {
      this.orbit += this.orbitDrag ? 0 : dt * 0.1;
      const cx = tk.x, cz = tk.z;
      const dist = this.orbitDist, ang = this.orbit;
      const px = cx + Math.sin(ang) * dist, pz = cz + Math.cos(ang) * dist;
      const py = Math.max(groundY(px, pz) + 1.4, tk.y + (this.menuView === 'menu' ? 1.8 : 3.4));
      if (this.snapCam) { this.camPos.set(px, py, pz); this.camLook.set(tk.x, tk.y + 1.3, tk.z); this.snapCam = false; }
      this.camPos.lerp(new THREE.Vector3(px, py, pz), 1 - Math.exp(-dt * 3));
      const rx = Math.cos(ang), rz = -Math.sin(ang);
      const tgt = new THREE.Vector3(cx + rx * this.garageShift, tk.y + 1.3, cz + rz * this.garageShift);
      this.camLook.lerp(tgt, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.camPos); cam.lookAt(this.camLook); cam.fov = 48; cam.updateProjectionMatrix();
      return;
    }
    // sürüş kameraları
    const sp = Math.abs(tk.speed);
    this.camYaw += wrapAng(tk.yaw - this.camYaw) * Math.min(1, dt * (this.camMode === 'rear' ? 8 : 3.2));
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    let fovT = 58 + clamp(sp, 0, 32) * 0.45 + (tk.nitroOn ? 8 : 0);
    let posT: THREE.Vector3, lookT: THREE.Vector3;
    const base = new THREE.Vector3(tk.x, tk.y + tk.bounce, tk.z);
    if (this.intro > 0) {
      this.intro -= dt;
      const t = clamp(1 - this.intro / 2.2, 0, 1), e = t * t * (3 - 2 * t);
      const a = lerp(this.spawn.yaw + 1.9, this.camYaw + Math.PI, e);
      const dist = lerp(8, 9.2, e);
      posT = new THREE.Vector3(tk.x - Math.sin(a - Math.PI) * dist, tk.y + lerp(2.2, 4.2, e), tk.z - Math.cos(a - Math.PI) * dist);
      lookT = base.clone().add(new THREE.Vector3(fx * 5 * e, 1.6, fz * 5 * e));
      this.camPos.lerp(posT, 1 - Math.exp(-dt * 6)); this.camLook.lerp(lookT, 1 - Math.exp(-dt * 6));
    } else if (this.camMode === 'rear') {
      const yawA = this.camYaw + Math.PI - this.mouse.x * 0.3, pit = -0.07 + this.mouse.y * 0.14 + this.weapon.kick;
      const bx = -Math.sin(this.camYaw), bz = -Math.cos(this.camYaw);
      posT = new THREE.Vector3(tk.x + bx * 6.3, tk.y + 3.7 + tk.bounce, tk.z + bz * 6.3);
      const dir = new THREE.Vector3(Math.sin(yawA) * Math.cos(pit), Math.sin(pit), Math.cos(yawA) * Math.cos(pit));
      lookT = posT.clone().addScaledVector(dir, 30);
      const k = 1 - Math.exp(-dt * 9);
      this.camPos.lerp(posT, k); this.camLook.lerp(lookT, k);
      fovT = 56 + (tk.nitroOn ? 4 : 0);
    } else {
      const dist = 9.4 + sp * 0.03;
      posT = new THREE.Vector3(tk.x - fx * dist, tk.y + 4.2 + sp * 0.01, tk.z - fz * dist);
      posT.y = Math.max(posT.y, terrainH(posT.x, posT.z) + 1.6);
      lookT = base.clone().add(new THREE.Vector3(fx * 6, 1.8, fz * 6));
      const k = 1 - Math.exp(-dt * 7);
      this.camPos.lerp(posT, k); this.camLook.lerp(lookT, k * 1.2);
    }
    this.camFov += (fovT - this.camFov) * Math.min(1, dt * 3);
    // sarsıntı
    const t = this.time * 38;
    const sx = (vnoise(t, 1.3) - 0.5) * 2, sy = (vnoise(t, 7.9) - 0.5) * 2, sz = (vnoise(t, 4.2) - 0.5) * 2;
    cam.position.set(this.camPos.x + sx * tr * 0.5, this.camPos.y + sy * tr * 0.4, this.camPos.z + sz * tr * 0.5);
    cam.lookAt(this.camLook.x + sx * tr * 0.4, this.camLook.y + sy * tr * 0.3, this.camLook.z + sz * tr * 0.4);
    cam.rotateZ(sx * tr * 0.035 + (this.camMode === 'drive' ? -tk.rollX * 0.4 : 0));
    // yer altına inme koruması
    const gh = terrainH(cam.position.x, cam.position.z) + 0.8; if (cam.position.y < gh && !onBridge(cam.position.x, cam.position.z)) cam.position.y = gh;
    if (Math.abs(cam.fov - this.camFov) > 0.05) { cam.fov = this.camFov; cam.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ efektler
  effects(dt: number) {
    const tk = this.tk, rig = this.rig, w = this.world;
    const sp = Math.abs(tk.speed);
    const light = w.time === 'night' ? 0.22 : w.time === 'sunset' ? 0.65 : w.weather === 'rain' ? 0.55 : 1; this.partLight = light;
    // egzoz
    this.smokeAcc += dt * (4 + tk.throttle * 14);
    const ex = new THREE.Vector3(); rig.exhaust.getWorldPosition(ex);
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1;
      const bad = 1 - tk.engine / 100; const dark = 0.08 + bad * 0.1 + tk.throttle * 0.05;
      this.fx.smoke.emit(ex.x, ex.y, ex.z, tk.vx * 0.55 + (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.8, tk.vz * 0.55 + (Math.random() - 0.5) * 0.6, 1.6 + Math.random(), 0.25, 1.8 + tk.throttle, dark + 0.05, dark + 0.05, dark + 0.05, 0.28 + tk.throttle * 0.25, -0.4, 0.6);
    }
    if (tk.nitroOn) {
      for (const o of [rig.exhaust, rig.exhaust2]) { if (!o) continue; const p = new THREE.Vector3(); o.getWorldPosition(p); this.fx.glow.emit(p.x, p.y, p.z, tk.vx * 0.9 - Math.sin(tk.yaw) * 4, 0.5, tk.vz * 0.9 - Math.cos(tk.yaw) * 4, 0.3, 0.7, 0.1, 0.3, 0.55, 1, 0.8, 0, 2); }
    }
    this.coughT -= dt; if (this.coughT < 0) { this.coughT = 3 + Math.random() * 6 * (tk.engine / 100 + 0.3); if (tk.throttle > 0.3) this.coughSmoke(1.2 + (1 - tk.engine / 100) * 2); }
    // hasarlı kaput dumanı / ateşi
    if (tk.hull < 40 && this.mode === 'drive') {
      const p = new THREE.Vector3(0, 1.95, 2.0).applyMatrix4(rig.group.matrixWorld);
      if (Math.random() < 0.7) this.fx.smoke.emit(p.x, p.y, p.z, tk.vx * 0.4, 1.8, tk.vz * 0.4, 1.8, 0.4, 2.8, 0.1, 0.1, 0.1, tk.hull < 20 ? 0.6 : 0.4, -0.4, 0.4);
      if (tk.hull < 18 && Math.random() < 0.5) this.fx.glow.emit(p.x, p.y, p.z, tk.vx * 0.3, 1.5, tk.vz * 0.3, 0.45, 0.6, 0.1, 1, 0.55, 0.15, 0.9, -1, 1);
    }
    // teker tozu
    if (sp > 3.5 && this.mode === 'drive') {
      this.dustAcc += dt * sp * (tk.offroad ? 1.5 : tk.surf === 0 ? (tk.wet ? 1.2 : 0.1) : 1.1);
      const col = tk.wet && tk.surf === 0 ? [0.75, 0.8, 0.85] : tk.inMud ? [0.3, 0.22, 0.14] : tk.surf === 0 ? [0.5, 0.5, 0.48] : tk.surf === 1 ? [0.62, 0.55, 0.43] : tk.surf === 2 ? [0.42, 0.33, 0.22] : [0.38, 0.4, 0.2];
      while (this.dustAcc > 2.2) {
        this.dustAcc -= 2.2;
        const sgn = Math.random() < 0.5 ? 1 : -1;
        const p = new THREE.Vector3(sgn * 1.0, 0.3, -2.0).applyMatrix4(rig.group.matrixWorld);
        const a = tk.wet && tk.surf === 0 ? 0.3 : 0.4;
        this.fx.smoke.emit(p.x, p.y, p.z, tk.vx * 0.3 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.5, tk.vz * 0.3 + (Math.random() - 0.5) * 2, 1.2 + Math.random() * 0.9, 0.5, 2.6, col[0] * light, col[1] * light, col[2] * light, a, -0.1, 1.2);
        if ((tk.inMud || tk.surf >= 1) && Math.random() < 0.25) this.fx.debris.emit(p.x, p.y, p.z, -tk.vx * 0.15 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, -tk.vz * 0.15 + (Math.random() - 0.5) * 4, 0.05 + Math.random() * 0.07, tk.inMud ? 0x4a3826 : 0x7a6c58, 1.3);
      }
    }
    // kamp dumanı ve baca
    const cam = this.camera.position;
    for (const f of w.fires) {
      const d = Math.hypot(f.x - cam.x, f.z - cam.z);
      if (d < 900) {
        if (d < 150 && Math.random() < 0.7) this.fx.glow.emit(f.x + (Math.random() - 0.5) * 0.7, f.y, f.z + (Math.random() - 0.5) * 0.7, 0, 1.6 + Math.random(), 0, 0.5, 0.7, 0.1, 1, 0.5, 0.12, 0.8, -1.5, 1);
        if (Math.random() < 0.5) this.fx.smoke.emit(f.x, f.y + 1, f.z, 1.3 + Math.random(), 4 + Math.random() * 2, (Math.random() - 0.5), 14, 2, 22, 0.11 * light + 0.04, 0.1 * light + 0.04, 0.1 * light + 0.04, 0.38, -0.05, 0.15);
      }
    }
    if (w.chimneys.length) {
      this.chimT -= dt;
      if (this.chimT < 0) { this.chimT = 0.25; for (const c of w.chimneys) if (Math.hypot(c.x - cam.x, c.z - cam.z) < 220 && Math.random() < 0.5) this.fx.smoke.emit(c.x, c.y, c.z, 0.6, 1.2, 0.2, 5, 0.4, 3, 0.55 * light + 0.1, 0.55 * light + 0.1, 0.55 * light + 0.1, 0.22, -0.05, 0.1); }
    }
    // flaş ışıkları
    this.flashT -= dt; if (this.flashT <= 0) this.flashL.intensity = 0; else this.flashL.intensity *= Math.max(0, 1 - dt * 6);
    this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleL.intensity = 0;
    // yağmur & şimşek
    if (this.rain) {
      this.rain.update(this.time, this.camera.position);
      this.lightningT -= dt;
      if (this.lightningT < 0) { this.lightningT = 9 + Math.random() * 16; w.flash = 1; this.thunderQ.push(this.time + 0.6 + Math.random() * 1.8); }
    }
    w.flash = Math.max(0, w.flash - dt * 3.2);
    if (this.thunderQ.length && this.time > this.thunderQ[0]) { this.thunderQ.shift(); audio.sfx('thunder', 0.8); }
    this.fx.smoke.update(dt); this.fx.glow.update(dt); this.fx.debris.update(dt); this.fx.tracers.update(dt);
  }
  chimT = 0;

  // ------------------------------------------------------------------ toplanabilirler
  pickupsStep(dt: number) {
    const tk = this.tk, d = this.d;
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw);
    for (const p of this.pickups) {
      if (p.taken) continue;
      const dist = Math.hypot(p.x - tk.x, p.z - tk.z);
      p.mesh.visible = dist < 260;
      if (!p.mesh.visible) continue;
      p.ph += dt * 2;
      const spin = p.mesh.getObjectByName('spin'); if (spin) spin.rotation.y += dt * 1.8;
      p.mesh.position.y = groundY(p.x, p.z) + 0.95 + Math.sin(p.ph) * 0.12;
      const mag = (p.kind === 'scrap' || p.kind === 'part') ? d.magnet : 3.5;
      if (dist < mag + 1 && dist > 2.8 && (this.save.upgrades.aux >= 1) && (p.kind === 'scrap' || p.kind === 'part')) {
        const k = Math.min(1, dt * (6 + (mag - dist)));
        p.x += (tk.x - p.x) * k; p.z += (tk.z - p.z) * k; p.pulled = true; p.mesh.position.x = p.x; p.mesh.position.z = p.z;
      } else { p.mesh.position.x = p.x; p.mesh.position.z = p.z; }
      if (dist < 3.0 && Math.abs((p.x - tk.x) * fx + (p.z - tk.z) * fz) < 5) {
        p.taken = true; this.scene.remove(p.mesh); this.run.pickups++;
        audio.sfx(p.kind === 'fuel' ? 'fuel' : 'pickup', 0.9);
        for (let i = 0; i < 8; i++) this.fx.glow.emit(p.x, tk.y + 1.2, p.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.5, 0.35, 0.05, 1, 0.85, 0.35, 1, 3, 1);
        if (p.kind === 'scrap') { this.run.scrap += 1; this.notice('+1 hurda parçası', 'good'); }
        else if (p.kind === 'part') { this.run.scrap += 3; this.notice('+3 yedek parça', 'good'); }
        else if (p.kind === 'fuel') { tk.fuel = Math.min(d.tank, tk.fuel + 6); this.lowFuelWarned = tk.fuel < 5; this.notice('+6 L yakıt', 'good'); }
        else { const wd = WEAPONS[this.save.upgrades.weapon]; this.weapon.reserve += wd.mag; this.notice(`+${wd.mag} mermi`, 'good'); }
      }
    }
  }

  // ------------------------------------------------------------------ ana döngü
  loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.clock) / 1000; this.clock = now;
    dt = Math.min(dt, 0.05);
    this.perf(dt);
    if (this.paused) { this.render(); return; }
    this.time += dt;
    this.grenCd = Math.max(0, this.grenCd - dt);
    this.killMarker = Math.max(0, this.killMarker - dt); this.hitMarker = Math.max(0, this.hitMarker - dt);
    if (this.mode === 'drive') this.updateDrive(dt);
    else this.updateStatic(dt);
    this.updateCamera(dt);
    this.world.update(dt, this.mode === 'drive' ? this.tk.x : this.spawn.x, this.mode === 'drive' ? this.tk.z : this.spawn.z, this.camera, new THREE.Vector3(this.tk.x, this.tk.y, this.tk.z));
    this.effects(dt);
    // ses dinleyici
    const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
    audio.setListener(this.camera.position, f);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.1; this.pushHud(false); }
    this.render();
  };
  render() {
    const sc = (this.gradePass?.uniforms as any);
    if (sc) { sc.uTime.value = this.time % 100; sc.uHurt.value = this.tk.hurt * 0.9; sc.uBlur.value = this.tk.nitroOn ? 0.7 : clamp((Math.abs(this.tk.speed) - 22) * 0.04, 0, 0.3); sc.uVig.value = this.world.time === 'night' ? 0.55 : 0.38; }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
  perf(dt: number) {
    this.frameAcc.push(dt);
    if (this.frameAcc.length >= 90) {
      const avg = this.frameAcc.reduce((a, b) => a + b, 0) / this.frameAcc.length; this.frameAcc = [];
      if (avg > 0.031 && this.dynScale > 0.55) { this.dynScale = Math.max(0.55, this.dynScale - 0.1); this.applyDyn(); }
      else if (avg < 0.0185 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.05); this.applyDyn(); }
    }
  }
  applyDyn() {
    const q = this.save.settings.quality; const maxPR = { low: 1, medium: 1.25, high: 1.5, ultra: 2 }[q];
    const pr = Math.min(window.devicePixelRatio || 1, maxPR) * this.save.settings.resScale * this.dynScale;
    this.renderer.setPixelRatio(pr); const w = this.canvas.clientWidth, h = this.canvas.clientHeight; this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    this.fx.smoke.setScale(h * pr, this.camera.fov); this.fx.glow.setScale(h * pr, this.camera.fov);
  }
  updateStatic(dt: number) {
    const tk = this.tk;
    tk.speed = 0; tk.vx = tk.vz = 0; tk.throttle = 0.0;
    this.applyTruckTransform(dt);
    tk.trauma = 0;
    // rölanti
    this.smokeAcc += dt * 4;
    audio.updateEngine({ rpm: 780, throttle: 0, health: 70, on: this.menuView === 'garage' && false, boost: false });
    audio.updateTires({ speed: 0, surf: 0, wet: false, offroad: false, slip: 0, rough: 0 });
    this.rig.group.rotation.y = tk.yaw + Math.sin(this.time * 0.4) * 0.0;
  }
  updateDrive(dt: number) {
    const tk = this.tk, m = this.mission!;
    const sub = 2; const h = dt / sub;
    for (let i = 0; i < sub; i++) this.stepTruck(h);
    this.applyTruckTransform(dt);
    if (!this.ended && this.intro <= 0) this.run.elapsed += dt;
    // rota ilerlemesi
    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = 0.08;
      const ns = nearestSample(tk.x, tk.z, 60); this.nearestIdx = ns.idx;
      if (m.route && ns.idx >= 0) { this.progress = clamp(1 - m.route.dist[ns.idx] / Math.max(1, m.route.total), 0, 1); this.progressMax = Math.max(this.progressMax, this.progress); }
    }
    if (!this.ended) this.raid.update(dt);
    // silah
    const wp = this.weapon, wd = WEAPONS[this.save.upgrades.weapon];
    wp.cd = Math.max(0, wp.cd - dt); wp.recoil = Math.max(0, wp.recoil - dt * 8); wp.kick = Math.max(0, wp.kick - dt * 0.3);
    if (wp.reload > 0) { wp.reload -= dt; if (wp.reload <= 0) { const need = wd.mag - wp.mag; const take = Math.min(need, wp.reserve); wp.mag += take; wp.reserve -= take; } }
    if (this.camMode === 'rear' && this.mouse.down && wd.auto) this.fire(false);
    this.aimGun(dt);
    this.pickupsStep(dt);
    // teslimat
    if (m.dest && !this.ended) {
      const dd = Math.hypot(m.dest.x - tk.x, m.dest.z - tk.z);
      const bossBlock = m.c.boss && !this.bossDead;
      if (dd < 14 && !bossBlock) {
        if (Math.abs(tk.speed) < 4.5) { this.deliverT += dt; if (this.deliverT >= 1.1) this.deliver(); } else this.deliverT = Math.max(0, this.deliverT - dt);
      } else this.deliverT = Math.max(0, this.deliverT - dt);
    }
    // ses
    const near = this.raid.enemies.filter((e) => e.state !== 'dead').map((e) => ({ id: e.id, x: e.x, y: e.y + 0.8, z: e.z, speed: e.speed, kind: e.type === 'sling' ? 0 : e.type === 'ram' ? 1 : e.type === 'hook' ? 2 : e.type === 'block' ? 3 : e.type === 'gun' ? 4 : 5, d: Math.hypot(e.x - tk.x, e.z - tk.z) })).sort((a, b) => a.d - b.d).slice(0, 5);
    audio.updateEnemies(near);
    audio.updateEngine({ rpm: tk.rpm, throttle: tk.throttle, health: tk.engine, on: tk.fuel > 0 && !this.paused, boost: tk.nitroOn });
    audio.updateTires({ speed: Math.abs(tk.speed), surf: tk.surf, wet: tk.wet || tk.inMud, offroad: tk.offroad, slip: tk.slip, rough: 0 });
    if (this.raid.state === 'idle' && !this.ended && audio.mood === 'relief') audio.setMood('drive');
    // gündüz/rüzgar ortamı
    if (this.ended && audio.mood === 'tension') audio.setMood('garage');
    // Düşman yaklaşırken ek uyarı
    this.rig.group.visible = true;
  }
  navT = 0;
  aimGun(dt: number) {
    const rig = this.rig;
    let target: THREE.Vector3;
    if (this.camMode === 'rear') { const ray = this.aimRay(); const h = this.raid.hitscan(ray.origin, ray.direction); target = h.point; }
    else target = new THREE.Vector3(this.tk.x - Math.sin(this.tk.yaw) * 30, this.tk.y + 1.5, this.tk.z - Math.cos(this.tk.yaw) * 30);
    const local = rig.gunBase.worldToLocal(target.clone());
    let yaw = Math.atan2(local.x, local.z); const pitch = Math.atan2(local.y - 0.3, Math.hypot(local.x, local.z));
    yaw = clamp(yaw, -1.3, 1.3);
    rig.gunYaw.rotation.y += (yaw - rig.gunYaw.rotation.y) * Math.min(1, dt * 14);
    rig.gunPitch.rotation.x += (-clamp(pitch, -0.3, 0.7) - rig.gunPitch.rotation.x) * Math.min(1, dt * 14);
    rig.gunPitch.position.z = -this.weapon.recoil * 0.12;
  }

  // ------------------------------------------------------------------ HUD
  pushHud(force: boolean) {
    void force;
    const tk = this.tk, m = this.mission, wd = WEAPONS[this.save.upgrades.weapon], wp = this.weapon;
    const bossE = this.raid.enemies.find((e) => e.type === 'boss' && e.state !== 'dead');
    let hint = '';
    if (m?.dest && this.mode === 'drive') {
      const dd = Math.hypot(m.dest.x - tk.x, m.dest.z - tk.z);
      if (dd < 60) hint = m.c.boss && !this.bossDead ? 'Önce haydut liderini durdur!' : dd < 14 ? 'Teslimat noktası — dur!' : 'Teslimat noktası yakın';
    }
    if (this.hooked > 0) hint = 'Halat takıldı! Halatı veya halat atan aracı vur (V)';
    const h: HudState = {
      speed: Math.abs(tk.speed) * 3.6, progress: this.progressMax * 100, hull: tk.hull, engine: tk.engine, tires: tk.tires, fuel: tk.fuel, fuelMax: this.d.tank, cargo: tk.cargo, cargoType: this.cargoType, scrap: this.run.scrap,
      weapon: { name: wd.name, mag: wp.mag, magMax: wd.mag, reserve: wp.reserve, reload: wp.reload > 0 ? 1 - wp.reload / wd.reload : 0, level: this.save.upgrades.weapon }, mines: wp.mines, grenades: wp.grenades, nitro: tk.nitro, nitroMax: this.d.nitro,
      cam: this.camMode, raid: this.raid.state, enemies: this.raid.enemies.filter((e) => e.state !== 'dead' && e.state !== 'leave').length,
      banner: this.raid.banner && (this.raid.state === 'warn' || (this.raid.state === 'active' && this.raid.timer < 5.5) || (this.raid.state === 'done' && this.raid.timer < this.raid.duration + 8)) ? this.raid.banner : null,
      timeLeft: m && m.c.timeLimit > 0 ? Math.max(0, m.c.timeLimit - this.run.elapsed) : null, elapsed: this.run.elapsed, hint, deliver: this.deliverT / 1.1, kits: this.kitsLeft, paused: this.paused, hurt: tk.hurt, hit: this.hitMarker, kill: this.killMarker,
      boss: bossE ? bossE.hp / bossE.maxHp : null, hooked: this.hooked > 0, wet: tk.wet, dest: m?.c.dest?.name || '', free: !!m?.free, gear: tk.gear, aiming: this.camMode === 'rear', reloadKey: wp.reload > 0, rpm: tk.rpm,
    };
    this.ev.onHud(h);
  }
  getMapData() {
    const tk = this.tk, m = this.mission;
    return {
      x: tk.x, z: tk.z, yaw: tk.yaw, dest: m?.dest || null, poly: m?.poly || [], enemies: this.raid.enemies.filter((e) => e.state !== 'dead').map((e) => ({ x: e.x, z: e.z, boss: e.type === 'boss' })),
      barricades: this.raid.barricades.map((b) => ({ x: b.x, z: b.z })), pickups: this.pickups.filter((p) => !p.taken && Math.hypot(p.x - tk.x, p.z - tk.z) < 140).map((p) => ({ x: p.x, z: p.z })),
    };
  }
  makeMinimap() {
    const S = 240, R = 700;
    const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d')!;
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const wx = (i / S) * 2 * R - R, wz = (j / S) * 2 * R - R;
      const h = terrainH(wx, wz); const o = (j * S + i) * 4;
      let r: number, g: number, b: number;
      if (h < -0.2) { const k = clamp(-h / 8, 0, 1); r = 24 - k * 10; g = 70 - k * 25; b = 96 - k * 25; }
      else { const k = clamp(h / 50, 0, 1); r = 70 + k * 80; g = 98 + k * 40; b = 52 + k * 50; if (h < 2) { r = 150; g = 140; b = 100; } }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.lineCap = 'round'; x.lineJoin = 'round';
    roadIdx.forEach((l, ri) => {
      x.strokeStyle = ri < 2 ? 'rgba(235,225,190,0.95)' : 'rgba(200,170,120,0.9)'; x.lineWidth = 2; x.beginPath();
      l.forEach((id, k) => { const s = samples[id]; const px = ((s.x + R) / (2 * R)) * S, py = ((s.z + R) / (2 * R)) * S; if (k === 0) x.moveTo(px, py); else x.lineTo(px, py); });
      x.stroke();
    });
    // yerler
    x.font = 'bold 9px sans-serif'; x.textAlign = 'center';
    for (const k of ['liman', 'camlik', 'yelkaya', 'maden']) { const p = POIS[k]; const px = ((p.x + R) / (2 * R)) * S, py = ((p.z + R) / (2 * R)) * S; x.fillStyle = '#fff'; x.beginPath(); x.arc(px, py, 3, 0, 6.3); x.fill(); x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillText(p.name, px + 1, py - 5); x.fillStyle = '#fff'; x.fillText(p.name, px, py - 6); }
    const camp = POIS.camp; x.fillStyle = '#ff3a2a'; x.beginPath(); x.arc(((camp.x + R) / (2 * R)) * S, ((camp.z + R) / (2 * R)) * S, 4, 0, 6.3); x.fill();
    const g = POIS.gas; x.fillStyle = '#e8a23a'; x.fillRect(((g.x + R) / (2 * R)) * S - 3, ((g.z + R) / (2 * R)) * S - 3, 6, 6);
    const q = POIS.quarry; x.fillStyle = '#c0c0c0'; x.fillRect(((q.x + R) / (2 * R)) * S - 3, ((q.z + R) / (2 * R)) * S - 3, 6, 6);
    this.minimapBase = c; this.mapRange = R;
  }
  mapRange = 700;
}

export { smoothstep, slopeAt };
