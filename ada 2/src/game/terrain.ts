// Saf hesaplama: ada yüksekliği, nehir, yol ağı, rota grafiği. (three.js bağımlılığı yok)

export const WORLD_HALF = 720;

export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
export function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, z: number, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- yerler
export interface POI { id: string; name: string; x: number; z: number; r: number; minH: number }
export const POIS: Record<string, POI> = {
  liman: { id: 'liman', name: 'Limanköy', x: -430, z: 250, r: 62, minH: 2.8 },
  camlik: { id: 'camlik', name: 'Çamlık', x: -260, z: -250, r: 48, minH: 3 },
  yelkaya: { id: 'yelkaya', name: 'Yelkaya', x: 400, z: 60, r: 48, minH: 3 },
  maden: { id: 'maden', name: 'Madenköy', x: 390, z: -300, r: 48, minH: 3 },
  gas: { id: 'gas', name: 'Terk Edilmiş İstasyon', x: -130, z: 110, r: 34, minH: 3 },
  quarry: { id: 'quarry', name: 'Taş Ocağı', x: 285, z: -255, r: 38, minH: 3 },
  camp: { id: 'camp', name: 'Haydut Kampı', x: -40, z: -370, r: 46, minH: 3 },
};
export const QUARRY_PIT = { x: 335, z: -185, r: 58 };

export const riverX = (z: number) => 150 + 40 * Math.sin(z / 150 + 1.0);
const riverW = (z: number) => 9 + 3 * Math.sin(z / 60);

export const BRIDGE = { z: 30, cx: riverX(30), halfLen: 42, halfWid: 4.6, deckY: 0 };

function bump(x: number, z: number, cx: number, cz: number, r: number, h: number) {
  const d = Math.hypot(x - cx, z - cz) / r;
  return d >= 1 ? 0 : h * (1 - d * d) * (1 - d * d);
}

function islandRaw(x: number, z: number) {
  const d = Math.hypot(x, z);
  const ang = Math.atan2(z, x);
  const R = 560 + 50 * Math.sin(ang * 3 + 1) + 30 * Math.sin(ang * 5 + 2) + (fbm(x * 0.004 + 9, z * 0.004, 3) - 0.5) * 90;
  const t = (R - d) / 150;
  if (t < 0) return clamp(-2.5 + t * 25, -16, 0);
  const shore = smoothstep(0, 1, t);
  const hills = fbm(x * 0.0045, z * 0.0045, 5);
  let h = shore * (8 + 38 * hills * hills + (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 6) - 2.5;
  h += bump(x, z, 335, -130, 130, 52) * (0.7 + 0.5 * Math.abs(fbm(x * 0.02, z * 0.02, 3) * 2 - 1)); // doğu dağı
  h += bump(x, z, -40, -400, 100, 26); // kamp tepesi
  h += bump(x, z, -260, -150, 120, 14); // orman sırtı
  return h;
}

function poiFlatten(h: number, x: number, z: number) {
  for (const k in POIS) {
    const p = POIS[k];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 40) {
      const base = poiH[k];
      const w = 1 - smoothstep(p.r, p.r + 40, d);
      h = lerp(h, base, w);
    }
  }
  return h;
}
const poiH: Record<string, number> = {};

export function hPre(x: number, z: number) {
  return poiFlatten(islandRaw(x, z), x, z);
}

function carve(h: number, x: number, z: number) {
  // nehir
  const rx = riverX(z);
  const dx = Math.abs(x - rx);
  const w = riverW(z);
  if (dx < w + 30) {
    const c = 1 - smoothstep(w * 0.55, w + 28, dx);
    h = lerp(h, Math.min(h, -2.6), c);
  }
  // taş ocağı terasları
  const q = QUARRY_PIT;
  const dq = Math.hypot(x - q.x, z - q.z);
  if (dq < q.r + 8) {
    const p = 1 - smoothstep(q.r * 0.45, q.r, dq);
    const s = p * 5, f = Math.floor(s), fr = s - f;
    const v = (f + smoothstep(0.65, 1, fr)) / 5;
    h -= 22 * v;
  }
  return h;
}

// ---------------------------------------------------------------- yollar
export type Surf = 0 | 1 | 2; // asfalt, çakıl, çamurlu toprak
export interface RoadSample { x: number; z: number; y: number; hw: number; surf: Surf; bridge: boolean; road: number }

interface RoadDef { id: string; a: string; b: string; mid: [number, number][]; surf: Surf; hw: number }
const NODE_POS: Record<string, [number, number]> = {
  L: [POIS.liman.x, POIS.liman.z], J1: [POIS.gas.x, POIS.gas.z], J2: [-190, -80], C: [POIS.camlik.x, POIS.camlik.z],
  J3: [262, -60], Q: [POIS.quarry.x, POIS.quarry.z], M: [POIS.maden.x, POIS.maden.z], Y: [POIS.yelkaya.x, POIS.yelkaya.z],
  K: [-40, -255], CAMP: [POIS.camp.x, POIS.camp.z],
};
const cx = BRIDGE.cx;
const ROAD_DEFS: RoadDef[] = [
  { id: 'sahil', a: 'L', b: 'J1', mid: [[-350, 262], [-290, 215], [-225, 160], [-175, 125]], surf: 0, hw: 3.6 },
  { id: 'köprü', a: 'J1', b: 'J3', mid: [[-60, 82], [0, 52], [60, 38], [cx - 70, 30], [cx - 30, 30], [cx + 30, 30], [cx + 70, 30], [cx + 100, 12], [cx + 140, -30], [230, -52]], surf: 0, hw: 3.6 },
  { id: 'yelkaya', a: 'J3', b: 'Y', mid: [[300, -30], [335, 20], [365, 50]], surf: 1, hw: 3.3 },
  { id: 'ocak', a: 'J3', b: 'Q', mid: [[285, -105], [262, -170], [265, -215]], surf: 1, hw: 3.3 },
  { id: 'maden', a: 'Q', b: 'M', mid: [[325, -285], [360, -295]], surf: 1, hw: 3.3 },
  { id: 'orman', a: 'J1', b: 'C', mid: [[-155, 40], [-185, -10], [-200, -45], [-190, -80 + 0], [-225, -130], [-245, -190]], surf: 2, hw: 3.0 },
  { id: 'kamp', a: 'J2', b: 'CAMP', mid: [[-130, -120], [-80, -175], [-40, -215], [-52, -255], [-35, -300], [-48, -335]], surf: 1, hw: 3.0 },
  { id: 'kıyı', a: 'L', b: 'J2', mid: [[-448, 175], [-420, 90], [-345, 15], [-262, -45]], surf: 2, hw: 3.0 },
];
// orman yolu J2 noktasından geçsin diye J2'yi orta kontrol noktası yapıyoruz

export const samples: RoadSample[] = [];
export const adj: number[][] = [];
export const roadIdx: number[][] = [];
export const nodeIndex: Record<string, number> = {};
export const roadMeta = ROAD_DEFS.map((d) => ({ id: d.id, surf: d.surf, hw: d.hw }));

function catmull(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

// yol alanı ızgarası
const CELL = 3;
const GN = Math.ceil((WORLD_HALF * 2) / CELL);
let fw: Float32Array, fwh: Float32Array;
const hash = new Map<number, number[]>();
const HC = 14;
const hkey = (cx: number, cz: number) => (cx + 200) * 1000 + (cz + 200);

let built = false;
export function buildWorld() {
  if (built) return;
  built = true;
  for (const k in POIS) poiH[k] = Math.max(islandRaw(POIS[k].x, POIS[k].z), POIS[k].minH);
  BRIDGE.deckY = (hPre(BRIDGE.cx - 50, BRIDGE.z) + hPre(BRIDGE.cx + 50, BRIDGE.z)) / 2;
  BRIDGE.deckY = Math.max(BRIDGE.deckY, 8);

  // düğümler
  for (const k in NODE_POS) {
    nodeIndex[k] = samples.length;
    samples.push({ x: NODE_POS[k][0], z: NODE_POS[k][1], y: 0, hw: 3.3, surf: 0, bridge: false, road: -1 });
    adj.push([]);
  }
  ROAD_DEFS.forEach((rd, ri) => {
    const pts: number[][] = [NODE_POS[rd.a], ...rd.mid, NODE_POS[rd.b]];
    // J2 düğümünü 'orman' yolundan geçirme gerekmiyor; kıyı & kamp yolları J2'ye bağlanır
    const ext = [pts[0], ...pts, pts[pts.length - 1]];
    const list: number[] = [nodeIndex[rd.a]];
    for (let i = 1; i < ext.length - 2; i++) {
      const segLen = Math.hypot(ext[i + 1][0] - ext[i][0], ext[i + 1][1] - ext[i][1]);
      const n = Math.max(2, Math.round(segLen / 3));
      for (let s = (i === 1 ? 1 : 0); s < n; s++) {
        const p = catmull(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], s / n);
        const id = samples.length;
        samples.push({ x: p[0], z: p[1], y: 0, hw: rd.hw, surf: rd.surf, bridge: false, road: ri });
        adj.push([]);
        list.push(id);
      }
    }
    list.push(nodeIndex[rd.b]);
    for (let i = 0; i < list.length - 1; i++) { adj[list[i]].push(list[i + 1]); adj[list[i + 1]].push(list[i]); }
    roadIdx.push(list);
  });
  // J2: kıyı & kamp yolları J2'ye bağlanır; orman yolu da J2'ye en yakın örneğe bağlanır
  {
    const j2 = nodeIndex.J2;
    let best = -1, bd = 1e9;
    roadIdx[5].forEach((id) => { const s = samples[id]; const d = Math.hypot(s.x - samples[j2].x, s.z - samples[j2].z); if (d < bd) { bd = d; best = id; } });
    if (best >= 0) { adj[best].push(j2); adj[j2].push(best); }
  }
  // köprü bayrakları
  samples.forEach((s) => {
    if (Math.abs(s.x - BRIDGE.cx) < BRIDGE.halfLen && Math.abs(s.z - BRIDGE.z) < 14) s.bridge = true;
  });
  // yükseklikler (düzleştirilmiş)
  roadIdx.forEach((list) => {
    const raw = list.map((id) => hPre(samples[id].x, samples[id].z));
    const sm = raw.map((_, i) => {
      let sum = 0, c = 0;
      for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < raw.length) { sum += raw[j]; c++; } }
      return sum / c;
    });
    list.forEach((id, i) => {
      const s = samples[id];
      let y = Math.max(sm[i], 1.4);
      const dx = Math.max(0, Math.abs(s.x - BRIDGE.cx) - BRIDGE.halfLen);
      if (Math.abs(s.z - BRIDGE.z) < 50) y = lerp(BRIDGE.deckY, y, smoothstep(0, 70, dx));
      const e = Math.min(i, list.length - 1 - i);
      if (e < 12 && (i === 0 || i === list.length - 1 || true)) {
        const nid = i < list.length / 2 ? list[0] : list[list.length - 1];
        const nh = Math.max(hPre(samples[nid].x, samples[nid].z), 1.4);
        y = lerp(nh, y, smoothstep(0, 12, e));
      }
      s.y = y;
    });
  });
  // yol alanı ızgarası
  fw = new Float32Array(GN * GN);
  fwh = new Float32Array(GN * GN);
  samples.forEach((s, idx) => {
    // örnek ızgarası (spatial hash)
    const k = hkey(Math.floor(s.x / HC), Math.floor(s.z / HC));
    let arr = hash.get(k);
    if (!arr) { arr = []; hash.set(k, arr); }
    arr.push(idx);
    if (s.bridge) return;
    const R = s.hw + 17;
    const i0 = Math.floor((s.x - R + WORLD_HALF) / CELL), i1 = Math.floor((s.x + R + WORLD_HALF) / CELL);
    const j0 = Math.floor((s.z - R + WORLD_HALF) / CELL), j1 = Math.floor((s.z + R + WORLD_HALF) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
      const px = i * CELL - WORLD_HALF, pz = j * CELL - WORLD_HALF;
      const d = Math.hypot(px - s.x, pz - s.z);
      const w = 1 - smoothstep(s.hw + 2.6, s.hw + 17, d);
      const o = j * GN + i;
      if (w > fw[o]) { fw[o] = w; fwh[o] = w * s.y; }
    }
  });
}

function roadBlend(x: number, z: number): [number, number] {
  const fx = (x + WORLD_HALF) / CELL, fz = (z + WORLD_HALF) / CELL;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= GN - 1 || j >= GN - 1) return [0, 0];
  const u = fx - i, v = fz - j;
  const o = j * GN + i;
  const w = (fw[o] * (1 - u) + fw[o + 1] * u) * (1 - v) + (fw[o + GN] * (1 - u) + fw[o + GN + 1] * u) * v;
  const wh = (fwh[o] * (1 - u) + fwh[o + 1] * u) * (1 - v) + (fwh[o + GN] * (1 - u) + fwh[o + GN + 1] * u) * v;
  return [w, wh];
}

export function terrainH(x: number, z: number) {
  let h = carve(hPre(x, z), x, z);
  const [w, wh] = roadBlend(x, z);
  if (w > 0.002) {
    const hr = wh / w;
    h = lerp(h, hr, Math.min(1, w));
  }
  return h;
}

export function onBridge(x: number, z: number) {
  return Math.abs(x - BRIDGE.cx) < BRIDGE.halfLen && Math.abs(z - BRIDGE.z) < BRIDGE.halfWid + 0.3;
}
export function groundY(x: number, z: number) {
  if (onBridge(x, z)) return BRIDGE.deckY;
  return terrainH(x, z);
}
export function roadWeight(x: number, z: number) { return roadBlend(x, z)[0]; }

export function slopeAt(x: number, z: number) {
  const e = 2;
  const dx = terrainH(x + e, z) - terrainH(x - e, z);
  const dz = terrainH(x, z + e) - terrainH(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

export function nearestSample(x: number, z: number, maxD = 40): { idx: number; d: number } {
  const cx0 = Math.floor(x / HC), cz0 = Math.floor(z / HC);
  let best = -1, bd = maxD * maxD;
  const rad = Math.ceil(maxD / HC);
  for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) {
    const arr = hash.get(hkey(cx0 + a, cz0 + b));
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const s = samples[arr[i]];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) { bd = d; best = arr[i]; }
    }
  }
  return { idx: best, d: best < 0 ? 999 : Math.sqrt(bd) };
}

// Dijkstra: hedeften tüm örneklere uzaklık
export interface RouteField { dist: Float64Array; next: Int32Array; total: number }
export function routeTo(destNode: string, fromNode = 'L'): RouteField {
  const n = samples.length;
  const dist = new Float64Array(n).fill(1e9);
  const next = new Int32Array(n).fill(-1);
  const src = nodeIndex[destNode];
  dist[src] = 0;
  // basit ikili yığın yerine O(n log n) için sıralı dizi kullanıyoruz (n küçük)
  const heap: [number, number][] = [[0, src]];
  const pop = () => {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
    const r = heap[bi]; heap[bi] = heap[heap.length - 1]; heap.pop(); return r;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    for (const v of adj[u]) {
      const nd = d + Math.hypot(samples[u].x - samples[v].x, samples[u].z - samples[v].z);
      if (nd < dist[v]) { dist[v] = nd; next[v] = u; heap.push([nd, v]); }
    }
  }
  return { dist, next, total: dist[nodeIndex[fromNode]] };
}

export function routePolyline(rf: RouteField, fromNode = 'L') {
  const pts: [number, number][] = [];
  let u = nodeIndex[fromNode];
  let guard = 0;
  while (u >= 0 && guard++ < 5000) { pts.push([samples[u].x, samples[u].z]); u = rf.next[u]; }
  return pts;
}

export function sampleAtDistanceAlong(rf: RouteField, from: number, meters: number) {
  let u = from, acc = 0, guard = 0;
  while (rf.next[u] >= 0 && acc < meters && guard++ < 500) {
    const v = rf.next[u];
    acc += Math.hypot(samples[u].x - samples[v].x, samples[u].z - samples[v].z);
    u = v;
  }
  return u;
}

// Çukur / çamur / enkaz yerleşimi (yol örneklerine bağlı, deterministik)
export interface Hazard { kind: 'pothole' | 'mud' | 'rock' | 'debris' | 'barrel'; x: number; z: number; r: number; ang: number; dead?: boolean }
export const hazards: Hazard[] = [];
export function buildHazards() {
  if (hazards.length) return;
  const r = rng(777);
  roadIdx.forEach((list, ri) => {
    const rd = ROAD_DEFS[ri];
    let acc = 0;
    for (let i = 8; i < list.length - 8; i++) {
      const s = samples[list[i]];
      const p = samples[list[i - 1]];
      acc += Math.hypot(s.x - p.x, s.z - p.z);
      if (s.bridge && Math.abs(s.z - BRIDGE.z) < 14 && r() > 0.2) continue;
      const nearPoi = Object.values(POIS).some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 40);
      if (nearPoi) continue;
      const gap = rd.surf === 0 ? 55 : 38;
      if (acc > gap + r() * 40) {
        acc = 0;
        const nx = samples[list[i + 1]].x - p.x, nz = samples[list[i + 1]].z - p.z;
        const L = Math.hypot(nx, nz) || 1;
        const px = -nz / L, pz = nx / L;
        const off = (r() - 0.5) * (rd.hw * 1.5);
        const roll = r();
        const kind: Hazard['kind'] = roll < 0.5 ? 'pothole' : roll < 0.68 ? 'mud' : roll < 0.82 ? 'rock' : roll < 0.93 ? 'debris' : 'barrel';
        const rr = kind === 'pothole' ? 1.0 + r() * 0.9 : kind === 'mud' ? 3 + r() * 2.5 : kind === 'rock' ? 0.9 + r() * 0.7 : kind === 'debris' ? 0.7 : 0.5;
        hazards.push({ kind, x: s.x + px * off, z: s.z + pz * off, r: rr, ang: r() * 6.28 });
        if (kind === 'pothole' && r() < 0.35) hazards.push({ kind, x: s.x + px * (off * 0.4 + 1.5), z: s.z + pz * (off * 0.4 + 1.5) + 2, r: 0.8 + r() * 0.5, ang: r() * 6.28 });
      }
    }
  });
}
