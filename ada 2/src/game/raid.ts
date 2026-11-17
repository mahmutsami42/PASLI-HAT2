import * as THREE from 'three';
import { audio } from './audio';
import { BikeRig, CarRig, createBarricade, createBike, createRaiderCar } from './models';
import { clamp, groundY, nearestSample, rng, samples, sampleAtDistanceAlong } from './terrain';
import type { Game } from './game';

export type EType = 'sling' | 'ram' | 'hook' | 'block' | 'gun' | 'boss';
const ACCENT: Record<EType, number> = { sling: 0xb02a22, ram: 0xb02a22, hook: 0xe08a22, block: 0xd8c030, gun: 0x4a8ad8, boss: 0xc0201a };

export interface Enemy {
  id: number; type: EType; x: number; z: number; y: number; yaw: number; speed: number; hp: number; maxHp: number;
  state: 'approach' | 'orbit' | 'retreat' | 'lunge' | 'dead' | 'run' | 'place' | 'flee' | 'leave';
  t: number; side: number; cd: number; retreat: number; flash: number; deadT: number; dvx: number; dvz: number; spin: number;
  bike: BikeRig | null; car: CarRig | null; group: THREE.Group; radius: number; arrive: number; knockX: number; knockZ: number; turnRate: number;
  hook: { state: 'none' | 'fly' | 'on'; t: number; hp: number; line: THREE.Line; dur: number } | null;
  place?: { x: number; z: number; yaw: number }; phase: number; burst: number; burstT: number; anim: number; lastHitT: number; burning: boolean;
}
export interface Barricade { group: THREE.Group; x: number; z: number; yaw: number; hp: number; life: number; dead: boolean }
interface Proj { mesh: THREE.Mesh; vel: THREE.Vector3; type: 'stone' | 'bullet' | 'grenade'; life: number; dmg: number; active: boolean; blast: number }
interface Mine { mesh: THREE.Mesh; x: number; z: number; arm: number; blast: number; dead: boolean }

let eid = 1;

export class Raid {
  g: Game;
  state: 'idle' | 'warn' | 'active' | 'done' = 'idle';
  enemies: Enemy[] = []; barricades: Barricade[] = []; mines: Mine[] = []; projs: Proj[] = [];
  threshold = 0.5; timer = 0; duration = 40; diff = 1; boss = false; warnT = 0; kills = 0; second = false;
  r = rng(1);
  stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 1 });
  bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd080 });
  gMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6, metalness: 0.5 });
  mineGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.1, 12);
  mineMat = new THREE.MeshStandardMaterial({ color: 0x4a5b36, roughness: 0.6, metalness: 0.5, emissive: 0x330000 });
  stoneGeo = new THREE.SphereGeometry(0.11, 6, 5);
  bulGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5);
  gGeo = new THREE.SphereGeometry(0.16, 8, 6);
  pool: Proj[] = [];
  warned = false;
  banner: { text: string; sub: string } | null = null;

  constructor(g: Game) { this.g = g; }

  reset() {
    this.enemies.forEach((e) => this.g.scene.remove(e.group)); this.enemies = [];
    this.barricades.forEach((b) => this.g.scene.remove(b.group)); this.barricades = [];
    this.mines.forEach((m) => this.g.scene.remove(m.mesh)); this.mines = [];
    this.projs.forEach((p) => this.g.scene.remove(p.mesh)); this.projs = [];
    this.state = 'idle'; this.kills = 0; this.second = false; this.timer = 0;
  }
  begin(diff: number, boss: boolean, seed: number) {
    this.reset(); this.diff = diff; this.boss = boss; this.r = rng(seed * 7919 + 13);
    this.threshold = diff === 1 ? 0.4 + this.r() * 0.18 : 0.35 + this.r() * 0.35;
    if (boss) this.threshold = 0.45;
    this.duration = 26 + diff * 9 + this.r() * 12;
  }

  // ---------------------------------------------------------------- doğurma
  private makeEnemy(type: EType, x: number, z: number, yaw: number, arrive: number): Enemy {
    const hpBase: Record<EType, number> = { sling: 52, hook: 66, block: 56, gun: 62, ram: 150, boss: 680 };
    const hp = hpBase[type] * (0.85 + this.diff * 0.1) * (this.g.mission?.first ? 0.8 : 1);
    const id = eid++;
    let bike: BikeRig | null = null, car: CarRig | null = null; let group: THREE.Group;
    if (type === 'ram' || type === 'boss') { car = createRaiderCar(ACCENT[type], id, type === 'boss'); group = car.group; }
    else { bike = createBike(ACCENT[type], id); group = bike.group; if (type === 'hook') bike.hookGun.visible = true; }
    group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
    const e: Enemy = {
      id, type, x, z, y: groundY(x, z), yaw, speed: 28, hp, maxHp: hp, state: type === 'block' ? 'run' : 'approach', t: 0, side: this.r() < 0.5 ? -1 : 1, cd: 2 + this.r() * 1.5,
      retreat: 0, flash: 0, deadT: 0, dvx: 0, dvz: 0, spin: 0, bike, car, group, radius: type === 'boss' ? 2.6 : car ? 1.7 : 1.1, arrive, knockX: 0, knockZ: 0, turnRate: car ? 2.0 : 3.0,
      hook: null, phase: 0, burst: 0, burstT: 0, anim: 0, lastHitT: 0, burning: false,
    };
    if (type === 'hook') {
      const pts = Array.from({ length: 10 }, () => new THREE.Vector3());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2a2018 }));
      line.frustumCulled = false; line.visible = false; this.g.scene.add(line);
      e.hook = { state: 'none', t: 0, hp: 40, line, dur: 0 };
    }
    group.position.set(x, e.y, z); group.rotation.y = yaw;
    this.g.scene.add(group);
    this.enemies.push(e);
    return e;
  }
  private spawnPoint(back: number, lat: number): { x: number; z: number } {
    const tk = this.g.tk;
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw), lx = Math.cos(tk.yaw), lz = -Math.sin(tk.yaw);
    let x = tk.x - fx * back + lx * lat, z = tk.z - fz * back + lz * lat;
    const ns = nearestSample(x, z, 70);
    if (ns.idx >= 0) { const s = samples[ns.idx]; x = s.x; z = s.z; }
    return { x, z };
  }
  start() {
    const g = this.g;
    this.state = 'warn'; this.warnT = 3.2; this.timer = 0;
    const d = this.diff;
    const pattern = this.r() < 0.4 ? 'rear' : this.r() < 0.6 ? 'ambush' : 'flank';
    const list: EType[] = [];
    const R = () => this.r();
    if (this.boss) list.push('boss', 'sling', 'sling', 'hook');
    else if (d <= 1) { list.push('sling', 'sling'); if (g.save.completed > 1 && R() < 0.5) list.push('sling'); }
    else if (d === 2) list.push('sling', 'sling', 'hook', 'ram', ...(R() < 0.5 ? ['sling' as EType] : []));
    else if (d === 3) list.push('sling', 'sling', 'hook', 'ram', 'gun', 'block');
    else list.push('sling', 'sling', 'hook', 'hook', 'ram', 'ram', 'gun', 'gun', 'block');
    const ambushBlock = pattern === 'ambush' && d >= 2 && !list.includes('block') && !this.boss;
    if (ambushBlock) list.push('block');
    list.forEach((type, i) => {
      if (type === 'block') {
        const rt = g.mission?.route; const ni = g.nearestIdx;
        if (rt && ni >= 0) {
          const ahead = sampleAtDistanceAlong(rt, ni, 150); const s = samples[ahead];
          const pre = sampleAtDistanceAlong(rt, ni, 185);
          const nxt = samples[rt.next[ahead] >= 0 ? rt.next[ahead] : ahead];
          const e = this.makeEnemy('block', samples[pre].x, samples[pre].z, 0, 0);
          e.place = { x: s.x, z: s.z, yaw: Math.atan2(nxt.x - s.x, nxt.z - s.z) };
          e.yaw = Math.atan2(s.x - e.x, s.z - e.z);
        } else this.makeEnemy('sling', ...(Object.values(this.spawnPoint(100, 0)) as [number, number]), 0, 0);
        return;
      }
      let back = 100 + i * 9, lat = (i % 2 ? 1 : -1) * (4 + R() * 4);
      if (pattern === 'flank') { back = 70 + i * 6; lat = (i % 2 ? 1 : -1) * 12; }
      const sp = this.spawnPoint(back, lat);
      const e = this.makeEnemy(type, sp.x, sp.z, g.tk.yaw, 1.5 + i * 0.45);
      e.yaw = Math.atan2(g.tk.x - sp.x, g.tk.z - sp.z);
      e.side = i % 2 ? 1 : -1;
    });
    this.banner = { text: '⚠ HAYDUT BASKINI!', sub: this.boss ? 'Haydut lideri geliyor!' : pattern === 'ambush' ? 'Yolu kesmeye çalışıyorlar!' : 'Arkadan yaklaşıyorlar — silah kamerası için V' };
    audio.sfx('warn', 0.8);
    g.notice(this.boss ? 'Haydut Lideri yaklaşıyor!' : 'Motor sesleri yaklaşıyor!', 'danger');
    audio.setMood('tension');
  }

  // ---------------------------------------------------------------- yardımcılar
  private angDiff(a: number, b: number) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  private fire(kind: Proj['type'], from: THREE.Vector3, to: THREE.Vector3, speed: number, dmg: number, blast = 0) {
    let p = this.pool.pop();
    if (!p) {
      const mesh = new THREE.Mesh(this.stoneGeo, this.stoneMat); this.g.scene.add(mesh);
      p = { mesh, vel: new THREE.Vector3(), type: 'stone', life: 0, dmg: 0, active: false, blast: 0 };
    }
    p.type = kind; p.mesh.geometry = kind === 'bullet' ? this.bulGeo : kind === 'grenade' ? this.gGeo : this.stoneGeo;
    p.mesh.material = kind === 'bullet' ? this.bulletMat : kind === 'grenade' ? this.gMat : this.stoneMat;
    p.mesh.position.copy(from); p.mesh.visible = true;
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    p.vel.copy(dir).multiplyScalar(speed);
    if (kind === 'stone') p.vel.y += dist / speed * 4.5; // hafif balistik
    if (kind === 'bullet') p.mesh.lookAt(from.clone().add(dir)), p.mesh.rotateX(Math.PI / 2);
    p.life = 4; p.dmg = dmg; p.active = true; p.blast = blast;
    this.projs.push(p);
  }
  fireGrenade(from: THREE.Vector3, vel: THREE.Vector3, blast: number) {
    const to = from.clone().add(vel);
    this.fire('grenade', from, to, vel.length(), 0, blast);
    this.projs[this.projs.length - 1].vel.copy(vel);
  }
  dropMine(x: number, z: number, blast: number) {
    const mesh = new THREE.Mesh(this.mineGeo, this.mineMat); mesh.position.set(x, groundY(x, z) + 0.06, z); this.g.scene.add(mesh);
    this.mines.push({ mesh, x, z, arm: 0.8, blast, dead: false });
  }

  // ---------------------------------------------------------------- hasar
  damageEnemy(e: Enemy, dmg: number, p?: THREE.Vector3) {
    if (e.state === 'dead') return;
    e.hp -= dmg; e.flash = 0.12; e.lastHitT = 0;
    const g = this.g;
    if (p) for (let i = 0; i < 6; i++) g.fx.glow.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7, 0.3, 0.25, 0.04, 1, 0.75, 0.35, 1, 9, 1);
    if (e.hook && e.hook.state !== 'none') { e.hook.hp -= dmg * 0.5; if (e.hook.hp <= 0) this.releaseHook(e, true); }
    if (e.hp <= 0) { this.kill(e); return; }
    if (e.type !== 'boss' || e.hp < e.maxHp * 0.5) e.retreat = e.type === 'boss' ? 0.9 : e.type === 'ram' ? 2 : 1.7;
    if (e.type === 'ram') e.state = 'retreat';
    audio.sfx('hit', 0.7);
  }
  private kill(e: Enemy) {
    const g = this.g;
    e.state = 'dead'; e.deadT = 0; this.kills++;
    if (e.hook && e.hook.state !== 'none') this.releaseHook(e, true);
    if (e.hook) e.hook.line.visible = false;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    e.dvx = fx * e.speed * 0.8 + (Math.random() - 0.5) * 3; e.dvz = fz * e.speed * 0.8 + (Math.random() - 0.5) * 3; e.spin = (Math.random() - 0.5) * 7;
    const big = !!e.car;
    this.explosion(e.x, e.y + 0.8, e.z, big ? 6 : 3.5, 0, big ? 1.4 : 0.7, false);
    audio.sfx(big ? 'explode' : 'crash', big ? 0.7 : 0.9, { x: e.x, y: e.y, z: e.z });
    e.burning = true;
    const val = e.type === 'boss' ? 250 : e.type === 'ram' ? 45 : 22;
    g.run.kills++; g.run.bonusMoney += val;
    if (Math.random() < (e.type === 'boss' ? 1 : 0.55)) { const n = e.type === 'boss' ? 8 : e.car ? 3 : 1; g.run.scrap += n; g.notice(`+${n} hurda (haydut enkazı)`, 'good'); }
    audio.sfx('kill', 0.8);
    g.killMarker = 0.45;
    for (let i = 0; i < 6; i++) g.fx.debris.emit(e.x, e.y + 1, e.z, (Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8, 0.2 + Math.random() * 0.25, 0x222222, 2.5);
    if (e.type === 'boss') g.onBossDown();
  }
  releaseHook(e: Enemy, broke: boolean) {
    if (!e.hook || e.hook.state === 'none') return;
    const was = e.hook.state === 'on';
    e.hook.state = 'none'; e.hook.line.visible = false; e.hook.hp = 40; e.cd = 5;
    if (was) { audio.sfx('snap', 0.9); if (broke) this.g.notice('Halat koptu!', 'good'); }
  }

  explosion(x: number, y: number, z: number, radius: number, dmg: number, power = 1, sound = true) {
    const g = this.g;
    const n = Math.round(26 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, u = Math.random() * 2 - 1, sp = (3 + Math.random() * 8) * power;
      g.fx.glow.emit(x, y, z, Math.cos(a) * sp * (1 - Math.abs(u) * 0.4), Math.max(0, u) * sp * 0.8 + 2, Math.sin(a) * sp * (1 - Math.abs(u) * 0.4), 0.5 + Math.random() * 0.5, 1.8 * power, 0.4, 1, 0.55 + Math.random() * 0.2, 0.15, 1, 0, 2.5);
    }
    for (let i = 0; i < n; i++) g.fx.smoke.emit(x + (Math.random() - 0.5) * 1.5, y + Math.random(), z + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 3.5, (Math.random() - 0.5) * 4, 2.2 + Math.random() * 1.8, 1.4 * power, 6 * power, 0.12, 0.11, 0.1, 0.7, -0.6, 0.8);
    for (let i = 0; i < Math.round(10 * power); i++) g.fx.debris.emit(x, y, z, (Math.random() - 0.5) * 14 * power, 5 + Math.random() * 10 * power, (Math.random() - 0.5) * 14 * power, 0.12 + Math.random() * 0.3, [0x3a3a3a, 0x6a4a2a, 0x5a2a1a][i % 3], 2.5);
    g.flashLight(x, y + 1, z, 140 * power, 0.25);
    if (sound) audio.sfx('explode', 1, { x, y, z });
    const dk = Math.hypot(x - g.tk.x, z - g.tk.z);
    g.addTrauma(clamp(0.9 - dk / 60, 0, 0.8) * power);
    if (radius > 0) {
      this.enemies.forEach((e) => { if (e.state === 'dead') return; const d = Math.hypot(e.x - x, e.z - z); if (d < radius + e.radius) this.damageEnemy(e, dmg * (1 - clamp(d / (radius + e.radius), 0, 1) * 0.6)); });
      this.barricades.forEach((b) => { if (!b.dead && Math.hypot(b.x - x, b.z - z) < radius + 3) this.breakBarricade(b); });
      if (dk < radius * 0.5 && dmg > 0) g.hurtTruck(dmg * 0.15, 'blast');
    }
  }

  breakBarricade(b: Barricade) {
    if (b.dead) return;
    b.dead = true; this.g.scene.remove(b.group);
    audio.sfx('barricade', 1, { x: b.x, y: 1, z: b.z });
    for (let i = 0; i < 14; i++) this.g.fx.debris.emit(b.x + (Math.random() - 0.5) * 6, 1 + Math.random(), b.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8, 3 + Math.random() * 6, (Math.random() - 0.5) * 8, 0.18 + Math.random() * 0.25, i % 2 ? 0x7a5a38 : 0x5a2a1a, 3);
    for (let i = 0; i < 10; i++) this.g.fx.smoke.emit(b.x + (Math.random() - 0.5) * 6, 0.8, b.z + (Math.random() - 0.5) * 6, 0, 1, 0, 1.4, 1, 3.5, 0.5, 0.42, 0.32, 0.5, -0.3, 1);
  }

  // ---------------------------------------------------------------- isabet testi
  hitscan(o: THREE.Vector3, d: THREE.Vector3): { kind: 'enemy' | 'rope' | 'barricade' | 'ground' | 'none'; t: number; point: THREE.Vector3; enemy?: Enemy; hookOwner?: Enemy; barricade?: Barricade } {
    let best: { kind: 'enemy' | 'rope' | 'barricade' | 'ground' | 'none'; t: number; point: THREE.Vector3; enemy?: Enemy; hookOwner?: Enemy; barricade?: Barricade } = { kind: 'none', t: 400, point: o.clone().addScaledVector(d, 120) };
    const c = new THREE.Vector3();
    const sph = (center: THREE.Vector3, r: number) => {
      const oc = center.clone().sub(o); const tca = oc.dot(d); if (tca < 0) return -1;
      const d2 = oc.lengthSq() - tca * tca; if (d2 > r * r) return -1;
      return tca - Math.sqrt(r * r - d2);
    };
    for (const e of this.enemies) {
      if (e.state === 'dead') continue;
      c.set(e.x, e.y + (e.car ? 1.3 : 1.0), e.z);
      const t = sph(c, e.radius * 1.05);
      if (t > 0 && t < best.t) best = { kind: 'enemy', t, point: o.clone().addScaledVector(d, t), enemy: e };
      if (e.hook && e.hook.state === 'on') { // halat
        const a = c, b = this.g.hookPoint();
        const u = b.clone().sub(a); const w0 = o.clone().sub(a); const aa = d.dot(d), bb = d.dot(u), cc = u.dot(u), dd = d.dot(w0), ee = u.dot(w0);
        const den = aa * cc - bb * bb; let sc = den > 1e-5 ? (bb * ee - cc * dd) / den : 0; let tc = den > 1e-5 ? (aa * ee - bb * dd) / den : 0;
        tc = clamp(tc, 0, 1); sc = Math.max(0, sc);
        const pr = o.clone().addScaledVector(d, sc), pq = a.clone().addScaledVector(u, tc);
        if (pr.distanceTo(pq) < 0.9 && sc < best.t) best = { kind: 'rope', t: sc, point: pq, hookOwner: e };
      }
    }
    for (const b of this.barricades) {
      if (b.dead) continue;
      for (const k of [-2.7, -0.9, 0.9, 2.7]) {
        c.set(b.x + Math.cos(b.yaw) * k, groundY(b.x, b.z) + 0.9, b.z - Math.sin(b.yaw) * k);
        const t = sph(c, 1.3); if (t > 0 && t < best.t) best = { kind: 'barricade', t, point: o.clone().addScaledVector(d, t), barricade: b };
      }
    }
    // zemin
    for (let t = 2; t < Math.min(best.t, 160); t += 2.5) {
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      if (py < groundY(px, pz)) { best = best.kind === 'none' || t < best.t ? { kind: 'ground', t, point: new THREE.Vector3(px, groundY(px, pz), pz) } : best; break; }
    }
    return best;
  }

  // ---------------------------------------------------------------- ana güncelleme
  update(dt: number) {
    const g = this.g, tk = g.tk;
    const fx = Math.sin(tk.yaw), fz = Math.cos(tk.yaw), lx = Math.cos(tk.yaw), lz = -Math.sin(tk.yaw);
    if (this.state === 'idle' && g.mission && !g.mission.free && g.progressMax >= this.threshold) this.start();
    if (this.state === 'warn') { this.warnT -= dt; if (this.warnT <= 0) this.state = 'active'; }
    if (this.state === 'active' || this.state === 'warn') {
      this.timer += dt;
      const alive = this.enemies.filter((e) => e.state !== 'dead' && e.state !== 'leave').length;
      const bossAlive = this.boss && this.enemies.some((e) => e.type === 'boss' && e.state !== 'dead');
      if (this.state === 'active' && !this.second && this.diff >= 3 && this.timer > this.duration * 0.55 && alive <= 2 && !bossAlive) {
        this.second = true;
        const sp = this.spawnPoint(95, 5); const e1 = this.makeEnemy('sling', sp.x, sp.z, tk.yaw, 1); e1.yaw = Math.atan2(tk.x - sp.x, tk.z - sp.z);
        const sp2 = this.spawnPoint(110, -5); const e2 = this.makeEnemy('gun', sp2.x, sp2.z, tk.yaw, 1.5); e2.yaw = e1.yaw;
        g.notice('Takviye geliyor!', 'danger');
      }
      if (this.state === 'active' && (this.timer > this.duration && !bossAlive)) {
        this.enemies.forEach((e) => { if (e.state !== 'dead') { e.state = 'leave'; if (e.hook) this.releaseHook(e, false); } });
      }
      if (this.state === 'active' && !bossAlive && this.enemies.every((e) => e.state === 'dead' || e.state === 'leave' || e.state === 'flee')) {
        if (this.enemies.filter((e) => e.state === 'flee').every((e) => Math.hypot(e.x - tk.x, e.z - tk.z) > 90) || this.enemies.every((e) => e.state === 'dead' || e.state === 'leave')) this.finish();
      }
    }
    // düşmanlar
    let hooked = 0;
    for (let k = this.enemies.length - 1; k >= 0; k--) {
      const e = this.enemies[k];
      this.updateEnemy(e, dt, fx, fz, lx, lz);
      if (e.hook && e.hook.state === 'on') hooked++;
      if (e.state === 'leave' && Math.hypot(e.x - tk.x, e.z - tk.z) > 140) { this.g.scene.remove(e.group); if (e.hook) this.g.scene.remove(e.hook.line); this.enemies.splice(k, 1); }
      else if (e.state === 'dead' && e.deadT > 6) { this.g.scene.remove(e.group); this.enemies.splice(k, 1); }
    }
    g.hooked = hooked;
    audio.ropeTension(hooked > 0 ? Math.min(1, 0.6 + hooked * 0.2) : 0);
    // barikatlar
    for (const b of this.barricades) { if (b.dead) continue; b.life -= dt; if (b.life <= 0) { b.dead = true; this.g.scene.remove(b.group); } }
    this.barricades = this.barricades.filter((b) => !b.dead);
    // mayınlar
    for (const m of this.mines) {
      if (m.dead) continue;
      m.arm -= dt; if (m.arm > 0) continue;
      (m.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(Math.floor(this.g.time * 4) % 2 ? 0xff1a0a : 0x330000);
      for (const e of this.enemies) { if (e.state === 'dead') continue; if (Math.hypot(e.x - m.x, e.z - m.z) < 3.2 + e.radius * 0.5) { m.dead = true; this.g.scene.remove(m.mesh); this.explosion(m.x, groundY(m.x, m.z) + 0.5, m.z, m.blast * 0.8, 140, 1.1); break; } }
    }
    this.mines = this.mines.filter((m) => !m.dead);
    // mermiler
    for (const p of this.projs) {
      if (!p.active) continue;
      p.life -= dt;
      const prev = p.mesh.position.clone();
      if (p.type !== 'bullet') p.vel.y -= (p.type === 'grenade' ? 16 : 9) * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;
      if (p.type === 'grenade') {
        let hit = pos.y < groundY(pos.x, pos.z) + 0.1;
        for (const e of this.enemies) if (!hit && e.state !== 'dead' && Math.hypot(e.x - pos.x, e.z - pos.z) < e.radius + 0.6 && Math.abs(pos.y - e.y - 1) < 2) hit = true;
        if (hit || p.life <= 0) { this.deactivate(p); this.explosion(pos.x, pos.y + 0.3, pos.z, p.blast, 150, 1.25); }
        else g.fx.smoke.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.6, 0.3, 0.8, 0.5, 0.5, 0.5, 0.3, 0, 1);
        continue;
      }
      // kamyona çarpma
      const rx = pos.x - tk.x, rz = pos.z - tk.z;
      const llx = rx * lx + rz * lz, llz = rx * fx + rz * fz;
      const near = Math.abs(llx) < 1.45 && llz > -4.1 && llz < 3.2 && pos.y < tk.y + 3.2 && pos.y > tk.y;
      const segHit = near || (prev.distanceToSquared(pos) > 1 && Math.abs(llx) < 1.45 && llz > -4.1 && llz < 3.2 && pos.y < tk.y + 3.2 && pos.y > tk.y);
      if (segHit) {
        this.deactivate(p);
        const cargoHit = llz < -0.7 && pos.y > tk.y + 1.0 && this.r() < 0.6;
        if (cargoHit) g.hurtCargo(p.dmg * 1.1, 'stone'); else g.hurtTruck(p.dmg, p.type);
        audio.sfx(p.type === 'stone' ? 'stone' : 'metalhit', 0.8);
        g.addTrauma(0.22);
        for (let i = 0; i < 5; i++) g.fx.glow.emit(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.25, 0.2, 0.03, 1, 0.8, 0.4, 1, 8, 1);
        continue;
      }
      if (pos.y < groundY(pos.x, pos.z)) { this.deactivate(p); g.fx.smoke.emit(pos.x, pos.y + 0.1, pos.z, 0, 0.6, 0, 0.8, 0.4, 1.4, 0.5, 0.42, 0.3, 0.5, 0, 1); continue; }
      if (p.life <= 0) this.deactivate(p);
    }
    this.projs = this.projs.filter((p) => p.active);
    if (this.banner && this.state !== 'idle') { /* UI okur */ }
  }
  private deactivate(p: Proj) { p.active = false; p.mesh.visible = false; this.pool.push(p); }
  finish() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.banner = { text: '✔ Baskın atlatıldı', sub: 'Yola devam et' };
    this.g.notice('Baskın atlatıldı!', 'good');
    audio.setMood('drive');
    this.enemies.forEach((e) => { if (e.state !== 'dead') e.state = 'leave'; });
  }

  // ---------------------------------------------------------------- tek düşman
  private updateEnemy(e: Enemy, dt: number, fx: number, fz: number, lx: number, lz: number) {
    const g = this.g, tk = g.tk;
    e.t += dt; e.flash = Math.max(0, e.flash - dt); e.retreat = Math.max(0, e.retreat - dt); e.cd -= dt; e.arrive -= dt; e.anim = Math.max(0, e.anim - dt);
    const bike = e.bike, car = e.car;
    if (e.state === 'dead') {
      e.deadT += dt;
      e.speed *= Math.max(0, 1 - 1.6 * dt);
      e.x += e.dvx * dt; e.z += e.dvz * dt; e.dvx *= Math.max(0, 1 - 1.4 * dt); e.dvz *= Math.max(0, 1 - 1.4 * dt);
      e.yaw += e.spin * dt * Math.min(1, 1 - e.deadT * 0.3);
      e.y = groundY(e.x, e.z);
      e.group.position.set(e.x, e.y, e.z); e.group.rotation.set(0, e.yaw, bike ? Math.min(1.5, e.deadT * 4) * (e.spin > 0 ? 1 : -1) : 0);
      if (bike) e.group.position.y += 0.2 * Math.min(1, e.deadT * 4) * 0.5;
      if (e.deadT > 4.5) e.group.scale.setScalar(Math.max(0.01, 1 - (e.deadT - 4.5) / 1.5));
      if (e.burning && Math.random() < 0.6) {
        g.fx.glow.emit(e.x + (Math.random() - 0.5), e.y + 0.8, e.z + (Math.random() - 0.5), 0, 2.5 + Math.random(), 0, 0.5, 0.9, 0.2, 1, 0.5, 0.15, 0.9, -1, 1);
        g.fx.smoke.emit(e.x, e.y + 1, e.z, (Math.random() - 0.5), 2.5, (Math.random() - 0.5), 2.2, 0.8, 4, 0.08, 0.08, 0.08, 0.6, -0.5, 0.4);
      }
      return;
    }
    // ---- hedef belirleme
    let fo = -14, lo = e.side * 5, vmax = bike ? 31 : 28, speedGain = 1.0;
    const dist = Math.hypot(tk.x - e.x, tk.z - e.z);
    const attacking = e.arrive <= 0 && dist < 70;
    switch (e.type) {
      case 'sling': case 'gun': {
        const orbit = e.t * (0.5 + e.id % 3 * 0.1) + e.id;
        fo = -9 + Math.sin(orbit) * 9; lo = e.side * (5.5 + Math.sin(orbit * 1.3 + 1) * 2.5);
        if (Math.sin(orbit * 0.7) > 0.5) e.side *= (Math.random() < 0.002 ? -1 : 1);
        if (e.retreat > 0) { fo = -34; lo = e.side * 9; }
        if (attacking && e.retreat <= 0 && e.cd <= 0 && dist < 36) this.attackRanged(e);
        break;
      }
      case 'hook': {
        fo = -12; lo = e.side * 3.5;
        if (e.retreat > 0 && e.hook?.state !== 'on') { fo = -30; lo = e.side * 8; }
        const h = e.hook!;
        if (attacking && h.state === 'none' && e.cd <= 0 && dist < 24 && e.retreat <= 0) { h.state = 'fly'; h.t = 0; h.dur = 0.45; h.line.visible = true; e.anim = 0.5; audio.sfx('hook', 0.9, { x: e.x, y: e.y + 1, z: e.z }); }
        if (h.state === 'fly') { h.t += dt; if (h.t >= h.dur) { h.state = 'on'; h.t = 0; audio.sfx('hookhit', 1); g.notice('Halat takıldı! Halatı veya aracı vur!', 'danger'); g.addTrauma(0.35); } }
        if (h.state === 'on') { h.t += dt; if (h.t > 11) this.releaseHook(e, false); }
        break;
      }
      case 'ram': {
        const ph = e.state === 'lunge';
        fo = ph ? 0.4 : -3; lo = e.side * (ph ? 0.4 : 5.6);
        if (e.state === 'approach') { if (attacking && Math.abs(dist) < 12 && e.t > 2) { e.state = 'lunge'; e.cd = 3; } }
        if (e.state === 'lunge') { e.cd -= 0; e.turnRate = 2.6; if (e.cd <= 0 || e.retreat > 0) { e.state = 'retreat'; e.retreat = 2.2; e.side *= -1; } }
        if (e.state === 'retreat') { fo = -30; lo = e.side * 6; if (e.retreat <= 0) { e.state = 'approach'; e.t = 0; e.turnRate = 2.0; } }
        vmax = 29;
        break;
      }
      case 'boss': {
        const rage = e.hp < e.maxHp * 0.5 ? 1 : 0;
        const ph = e.state === 'lunge';
        e.phase += dt;
        if (e.state === 'approach' || e.state === 'orbit') {
          fo = -10 + Math.sin(e.t * 0.5) * 3; lo = e.side * 6;
          if (e.phase > (rage ? 5 : 8) && dist < 16) { e.state = 'lunge'; e.phase = 0; e.cd = 3; }
          if (attacking && e.burst <= 0 && e.cd <= 0 && dist < 38) this.attackRanged(e);
        }
        if (ph) { fo = 0.5; lo = e.side * 0.5; if (e.phase > 3) { e.state = 'retreat'; e.retreat = 2.2; e.phase = 0; e.side *= -1; } }
        if (e.state === 'retreat') { fo = -26; lo = e.side * 7; if (e.retreat <= 0) { e.state = 'approach'; } }
        vmax = rage ? 30 : 27;
        break;
      }
      case 'block': break;
    }
    // ---- blokaj
    if (e.type === 'block') {
      vmax = 33;
      if (e.state === 'run' && e.place) {
        const d = Math.hypot(e.place.x - e.x, e.place.z - e.z);
        this.steer(e, e.place.x, e.place.z, dt, 32);
        if (d < 6) { e.state = 'place'; e.t = 0; e.speed = 3; audio.sfx('sling', 0.4, { x: e.x, y: e.y, z: e.z }); }
      } else if (e.state === 'place' && e.place) {
        e.speed *= 0.9; e.x += Math.sin(e.yaw) * e.speed * dt; e.z += Math.cos(e.yaw) * e.speed * dt;
        if (e.t > 0.9) {
          const grp = createBarricade(); const y = groundY(e.place.x, e.place.z);
          grp.position.set(e.place.x, y, e.place.z); grp.rotation.y = e.place.yaw + Math.PI / 2;
          grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          const lamp = new THREE.PointLight(0xff3a1a, 12, 14, 2); lamp.position.set(0, 1.9, 0.3); grp.add(lamp);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4a2a })); bulb.position.set(0, 1.9, 0.3); grp.add(bulb);
          this.g.scene.add(grp);
          this.barricades.push({ group: grp, x: e.place.x, z: e.place.z, yaw: e.place.yaw + Math.PI / 2, hp: 70, life: 16, dead: false });
          audio.sfx('barricade', 0.7, { x: e.place.x, y: 1, z: e.place.z });
          e.state = 'flee'; e.t = 0;
          this.g.notice('Barikat! Fren yap, kır veya vur!', 'danger');
        }
      } else if (e.state === 'flee') {
        // yoldan çekil
        const ahead = nearestSample(e.x + Math.sin(e.yaw) * 60, e.z + Math.cos(e.yaw) * 60, 80);
        if (ahead.idx >= 0) this.steer(e, samples[ahead.idx].x, samples[ahead.idx].z, dt, 30); else this.steer(e, e.x + Math.sin(e.yaw) * 50, e.z + Math.cos(e.yaw) * 50, dt, 30);
        if (e.t > 5 || Math.hypot(e.x - tk.x, e.z - tk.z) > 160) e.state = 'leave';
      } else if (e.state === 'retreat' || e.state === 'approach') {
        e.state = 'run'; if (!e.place) e.state = 'leave';
      }
    } else if (e.state === 'leave') {
      const tx = e.x - Math.sin(tk.yaw) * 100 + Math.cos(tk.yaw) * e.side * 30, tz = e.z - Math.cos(tk.yaw) * 100;
      this.steer(e, tx, tz, dt, 25);
    } else {
      // ---- hedef nokta + yola yapıştır
      let tx = tk.x + fx * fo + lx * lo + tk.vx * 0.25, tz = tk.z + fz * fo + lz * lo + tk.vz * 0.25;
      const ns = nearestSample(tx, tz, 16);
      if (ns.idx >= 0) { const s = samples[ns.idx]; const lim = s.hw + 1.6; if (ns.d > lim) { const k = lim / ns.d; tx = s.x + (tx - s.x) * k; tz = s.z + (tz - s.z) * k; } }
      const d2 = Math.hypot(tx - e.x, tz - e.z);
      const behind = (e.x - tk.x) * fx + (e.z - tk.z) * fz;
      let vt = Math.max(0, tk.speed) + d2 * 1.4 * speedGain;
      if (e.arrive > 0) vt = 36;
      vt = clamp(vt, 0, vmax * (e.arrive > 0 ? 1.2 : 1));
      if (behind < -6 && d2 < 6 && e.state !== 'lunge') vt = Math.max(0, tk.speed - 2);
      this.steer(e, tx, tz, dt, vt);
    }
    // ---- vurulma / çarpışma (kamyon)
    if (e.state !== 'leave' || true) {
      const rx = e.x - tk.x, rz = e.z - tk.z;
      const llx = rx * lx + rz * lz, llz = rx * fx + rz * fz;
      const halfW = 1.2 + e.radius * 0.7, halfL = 3.7 + e.radius * 0.7;
      if (Math.abs(llx) < halfW && llz > -halfL && llz < halfL - 0.4 && e.type !== 'block') {
        // itme
        const pushX = llx >= 0 ? halfW - Math.abs(llx) : -(halfW - Math.abs(llx));
        e.x += lx * pushX * 0.9; e.z += lz * pushX * 0.9;
        const rel = Math.abs(e.speed - tk.speed) + Math.abs(llx) * 0.2 + 3;
        if (g.time - e.lastHitT > 0.5) {
          e.lastHitT = g.time;
          const front = llz > 2;
          const mult = e.type === 'boss' ? 2.2 : e.car ? 1.2 : 0.5;
          g.hurtTruck(rel * 0.9 * mult * (front ? g.d.bumperDmg : 1), 'collision');
          this.damageEnemy(e, rel * 5 * g.d.ram * (front ? 1.4 : 0.8), new THREE.Vector3(e.x, e.y + 0.8, e.z));
          g.addTrauma(0.35 + mult * 0.15); audio.sfx('crash', 0.9, { x: e.x, y: e.y, z: e.z });
          e.knockX = lx * Math.sign(llx || 1) * 8; e.knockZ = lz * Math.sign(llx || 1) * 8;
          if (e.type === 'ram' || e.type === 'boss') { if (e.state === 'lunge') { e.state = 'retreat'; e.retreat = 2.2; e.side *= -1; } }
          for (let i = 0; i < 8; i++) g.fx.glow.emit(e.x - lx * Math.sign(llx || 1) * 0.8, e.y + 0.7, e.z - lz * Math.sign(llx || 1) * 0.8, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.35, 0.3, 0.05, 1, 0.75, 0.4, 1, 8, 1);
        }
      }
    }
    e.x += e.knockX * dt; e.z += e.knockZ * dt; e.knockX *= Math.max(0, 1 - 5 * dt); e.knockZ *= Math.max(0, 1 - 5 * dt);
    // ---- görseller
    const gy = groundY(e.x, e.z); e.y += (gy - e.y) * Math.min(1, dt * 14);
    const len = car ? 2 : 0.8;
    const hF = groundY(e.x + Math.sin(e.yaw) * len, e.z + Math.cos(e.yaw) * len), hB = groundY(e.x - Math.sin(e.yaw) * len, e.z - Math.cos(e.yaw) * len);
    e.group.position.set(e.x, e.y, e.z);
    const turn = this.lastTurn.get(e.id) || 0;
    e.group.rotation.set(-Math.atan2(hF - hB, len * 2), e.yaw, 0, 'YXZ');
    const spinRate = e.speed * dt / 0.36;
    if (bike) {
      bike.lean.rotation.z = -turn * 0.18 * clamp(e.speed / 20, 0, 1.6) + Math.sin(e.t * 9) * 0.01;
      bike.fork.rotation.y = turn * 0.12;
      bike.wheels.forEach((w) => (w.rotation.x += spinRate));
      bike.rider.scarf.rotation.x = -0.12 - clamp(e.speed / 60, 0, 0.5) + Math.sin(e.t * 18) * 0.06;
      bike.rider.scarf.rotation.y = Math.sin(e.t * 11) * 0.12;
      bike.rider.arm.rotation.x = e.anim > 0 ? -1.6 + (0.5 - e.anim) * 4 : -0.1;
      bike.rider.group.position.y = 0.7 + Math.sin(e.t * 16) * 0.004;
      bike.flame.visible = Math.random() < 0.2 && e.speed > 20;
      if (e.type === 'hook' && bike.hookGun) bike.hookGun.rotation.y = 0;
    }
    if (car) {
      car.wheels.forEach((w) => (w.rotation.x += spinRate * 0.9));
      car.fronts.forEach((f) => (f.rotation.y = turn * 0.3));
      car.group.rotation.z = -turn * 0.03 * clamp(e.speed / 20, 0, 1.5);
      car.riders.forEach((r) => { r.scarf.rotation.x = -0.15 - clamp(e.speed / 60, 0, 0.5) + Math.sin(e.t * 18) * 0.06; });
      if (car.riders[1]) car.riders[1].arm.rotation.x = e.anim > 0 ? -1.6 + (0.5 - e.anim) * 4 : -0.1;
      car.hookGun.visible = false;
    }
    // hasar tepkisi (beyaz parıltı) ve duman
    const mats = (e.group as any).__mats as { m: THREE.MeshStandardMaterial; c: THREE.Color }[] | undefined;
    if (!mats) {
      const arr: { m: THREE.MeshStandardMaterial; c: THREE.Color }[] = [];
      e.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if ((o as THREE.Mesh).isMesh && m && m.emissive && !arr.some((a) => a.m === m)) arr.push({ m, c: m.emissive.clone() }); });
      (e.group as any).__mats = arr;
    } else mats.forEach((a) => { if (e.flash > 0) a.m.emissive.setRGB(0.9, 0.9, 0.8); else a.m.emissive.copy(a.c); });
    if (e.hp < e.maxHp * 0.4 && Math.random() < 0.35) g.fx.smoke.emit(e.x - Math.sin(e.yaw) * 0.5, e.y + 0.9, e.z - Math.cos(e.yaw) * 0.5, 0, 1.5, 0, 1.4, 0.5, 2.6, 0.15, 0.15, 0.15, 0.55, -0.4, 0.5);
    // kanca ipi
    if (e.hook && e.hook.state !== 'none') this.updateRope(e);
  }
  lastTurn = new Map<number, number>();
  private steer(e: Enemy, tx: number, tz: number, dt: number, vt: number) {
    const want = Math.atan2(tx - e.x, tz - e.z);
    const dy = this.angDiff(want, e.yaw);
    const maxT = e.turnRate * dt * (0.6 + Math.min(1, (e.speed + 4) / 14) * 0.6);
    const st = clamp(dy, -maxT, maxT);
    e.yaw += st; this.lastTurn.set(e.id, clamp(-st / (maxT || 1), -1, 1));
    const acc = e.car ? 11 : 15;
    e.speed += clamp(vt - e.speed, -16 * dt, acc * dt);
    e.x += Math.sin(e.yaw) * e.speed * dt; e.z += Math.cos(e.yaw) * e.speed * dt;
  }
  private attackRanged(e: Enemy) {
    const g = this.g, tk = g.tk, d = this.diff;
    const start = new THREE.Vector3(e.x, e.y + 1.5, e.z);
    const lead = Math.hypot(tk.x - e.x, tk.z - e.z) / (e.type === 'sling' ? 24 : 55);
    const err = (e.type === 'sling' ? 2.2 : 2.8) * [0, 1.2, 0.9, 0.7, 0.55][d] + (g.mission?.first ? 1.4 : 0);
    const to = new THREE.Vector3(tk.x + tk.vx * lead + (Math.random() - 0.5) * err * 2, tk.y + 1.4 + (Math.random() - 0.5) * 0.8, tk.z + tk.vz * lead + (Math.random() - 0.5) * err * 2);
    if (e.type === 'sling') {
      this.fire('stone', start, to, 24, (3.5 + d * 1.4) * (g.mission?.first ? 0.8 : 1));
      e.cd = (2.9 - d * 0.35) * (0.8 + Math.random() * 0.5) + (g.mission?.first ? 0.8 : 0); e.anim = 0.5;
      audio.sfx('sling', 0.7, { x: e.x, y: e.y + 1, z: e.z });
    } else {
      const shots = e.type === 'boss' ? 3 : 2;
      for (let i = 0; i < shots; i++) setTimeout(() => {
        if (e.state === 'dead' || this.g.ended) return;
        const s2 = new THREE.Vector3(e.x, e.y + 1.7, e.z);
        const t2 = new THREE.Vector3(tk.x + tk.vx * lead + (Math.random() - 0.5) * err * 2, tk.y + 1.4, tk.z + tk.vz * lead + (Math.random() - 0.5) * err * 2);
        this.fire('bullet', s2, t2, 60, e.type === 'boss' ? 8 : 5 + d);
        audio.sfx('enemyshot', 0.55, { x: e.x, y: e.y + 1, z: e.z });
        this.g.fx.glow.emit(s2.x, s2.y, s2.z, 0, 0, 0, 0.08, 0.7, 0.2, 1, 0.8, 0.4, 1, 0, 1);
      }, i * 140);
      e.cd = (e.type === 'boss' ? 2.2 : 2.6) * (0.8 + Math.random() * 0.5); e.anim = 0.4;
    }
  }
  private updateRope(e: Enemy) {
    const h = e.hook!; const g = this.g;
    const a = new THREE.Vector3(e.x, e.y + 1.0, e.z);
    const b = g.hookPoint();
    const pos = h.line.geometry.attributes.position as THREE.BufferAttribute;
    const prog = h.state === 'fly' ? Math.min(1, h.t / h.dur) : 1;
    const slack = h.state === 'fly' ? 1.2 : 0.35;
    for (let i = 0; i < 10; i++) {
      const t = i / 9 * prog;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(i / 9 * Math.PI) * slack * (1 - (h.state === 'on' ? 0.6 : 0));
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  }
}
