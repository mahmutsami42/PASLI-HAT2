import * as THREE from 'three';
import { rng } from './terrain';

// --- döngüsel (tileable) değer gürültüsü
function h2(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function tn(x: number, y: number, px: number, py: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const m = (a: number, p: number) => ((a % p) + p) % p;
  const a = h2(m(ix, px), m(iy, py), seed), b = h2(m(ix + 1, px), m(iy, py), seed);
  const c = h2(m(ix, px), m(iy + 1, py), seed), d = h2(m(ix + 1, px), m(iy + 1, py), seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function tfbm(u: number, v: number, base: number, oct: number, seed = 1) {
  // u,v 0..1 ; base = ilk oktav periyodu
  let s = 0, a = 0.5, n = 0, p = base;
  for (let i = 0; i < oct; i++) { s += tn(u * p, v * p, p, p, seed + i * 7) * a; n += a; a *= 0.5; p *= 2; }
  return s / n;
}

type PixFn = (u: number, v: number, x: number, y: number) => [number, number, number, number?];
function pix(w: number, h: number, fn: PixFn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = fn(x / w, y / h, x, y);
    const o = (y * w + x) * 4;
    img.data[o] = p[0]; img.data[o + 1] = p[1]; img.data[o + 2] = p[2]; img.data[o + 3] = p[3] ?? 255;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx };
}
function tex(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const hexRGB = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const cache = new Map<string, THREE.Texture>();
function memo(key: string, f: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) { t = f(); cache.set(key, t); }
  return t;
}

export const T = {
  ground: () => memo('ground', () => {
    const { c } = pix(256, 256, (u, v) => {
      const n = tfbm(u, v, 6, 5, 3), g = tn(u * 128, v * 128, 128, 128, 9);
      const k = 0.72 + (n - 0.5) * 0.7 + (g - 0.5) * 0.22;
      return [k * 255, k * 252, k * 245];
    });
    return tex(c);
  }),
  groundBump: () => memo('groundBump', () => {
    const { c } = pix(256, 256, (u, v) => {
      const k = (tfbm(u, v, 16, 4, 11) * 0.7 + tn(u * 64, v * 64, 64, 64, 5) * 0.3) * 255;
      return [k, k, k];
    });
    return tex(c, false);
  }),
  asphalt: () => memo('asphalt', () => {
    const r = rng(5);
    const { c, ctx } = pix(256, 512, (u, v) => {
      const n = tfbm(u, v, 4, 5, 21), g = tn(u * 160, v * 320, 160, 320, 33);
      const wheel = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2));
      let k = 0.2 + n * 0.13 + g * 0.1 - wheel * 0.05;
      const edge = Math.min(u, 1 - u);
      const stain = tfbm(u, v, 3, 3, 77) > 0.62 ? -0.04 : 0;
      k += stain;
      const a = edge < 0.035 ? edge / 0.035 * (0.5 + n) : 1;
      return [k * 255, k * 252, k * 248, Math.min(255, a * 300)];
    });
    ctx.strokeStyle = 'rgba(8,8,8,0.7)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = 0.8 + r() * 1.6;
      ctx.beginPath();
      let x = r() * 256, y = r() * 512;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (r() - 0.5) * 40; y += (r() - 0.3) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // orta çizgi (yıpranmış)
    ctx.fillStyle = 'rgba(200,185,120,0.75)';
    for (let y = 0; y < 512; y += 128) ctx.fillRect(124, y + 10, 7, 70);
    ctx.fillStyle = 'rgba(190,190,180,0.5)';
    ctx.fillRect(18, 0, 4, 512); ctx.fillRect(234, 0, 4, 512);
    // kırık çizgi lekeleri
    const id = ctx.getImageData(0, 0, 256, 512);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = Math.random();
      if (n > 0.55 && id.data[i] > 90) { id.data[i] *= 0.55; id.data[i + 1] *= 0.55; id.data[i + 2] *= 0.55; }
    }
    ctx.putImageData(id, 0, 0);
    return tex(c);
  }),
  gravel: () => memo('gravel', () => {
    const { c } = pix(256, 512, (u, v) => {
      const n = tfbm(u, v, 4, 5, 41), g = tn(u * 200, v * 400, 200, 400, 13);
      const rut = Math.exp(-Math.pow((u - 0.3) / 0.08, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.08, 2));
      const mid = Math.exp(-Math.pow((u - 0.5) / 0.1, 2));
      const k = 0.5 + n * 0.25 + g * 0.18 - rut * 0.12 + mid * 0.06;
      const edge = Math.min(u, 1 - u);
      const a = Math.min(1, edge / 0.12 + tn(u * 40, v * 80, 40, 80, 8) * 0.3);
      return [k * 205, k * 185, k * 150, a * 255];
    });
    return tex(c);
  }),
  dirt: () => memo('dirt', () => {
    const { c } = pix(256, 512, (u, v) => {
      const n = tfbm(u, v, 4, 5, 51), g = tn(u * 160, v * 300, 160, 300, 23);
      const rut = Math.exp(-Math.pow((u - 0.3) / 0.09, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.09, 2));
      const puddle = tfbm(u, v, 3, 3, 61) > 0.58 ? 1 : 0;
      const k = 0.35 + n * 0.2 + g * 0.12 - rut * 0.09 - puddle * 0.1;
      const edge = Math.min(u, 1 - u);
      const a = Math.min(1, edge / 0.14 + tn(u * 30, v * 60, 30, 60, 4) * 0.35);
      return [k * 190, k * 150, k * 105, a * 255];
    });
    return tex(c);
  }),
  paint: (hex: number, seed = 1, rust = 0.5) => memo(`paint${hex}-${seed}-${rust}`, () => {
    const [R, G, B] = hexRGB(hex);
    const { c, ctx } = pix(384, 384, (u, v) => {
      const big = tfbm(u, v, 3, 4, seed * 3);
      const rustN = tfbm(u, v, 6, 5, seed * 5 + 1);
      const grad = Math.pow(1 - v, 2.2);
      let rv = smooth01((rustN + grad * 0.55 * rust + (tn(u * 120, v * 120, 120, 120, seed) - 0.5) * 0.08 - (0.62 - rust * 0.18)) * 7);
      rv = Math.max(rv, 0);
      const fade = 0.8 + big * 0.35;
      let r = R * fade, g = G * fade, b = B * fade;
      // pas
      const rr = 120 + rustN * 90, rg = 58 + rustN * 36, rb = 28 + rustN * 18;
      r = r + (rr - r) * rv; g = g + (rg - g) * rv; b = b + (rb - b) * rv;
      // çamur (alt kısım)
      const mud = smooth01((0.28 - v) * 5 + (rustN - 0.5) * 1.2);
      r = r + (84 - r) * mud * 0.7; g = g + (66 - g) * mud * 0.7; b = b + (46 - b) * mud * 0.7;
      return [r, g, b];
    });
    const rg = rng(seed * 99);
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = rg() > 0.5 ? 'rgba(235,225,205,0.28)' : 'rgba(25,20,15,0.3)';
      ctx.lineWidth = 0.5 + rg() * 1.1;
      const x = rg() * 384, y = rg() * 384, l = 10 + rg() * 60, a = rg() * 6.28;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    return tex(c);
  }),
  paintBump: () => memo('paintBump', () => {
    const { c } = pix(256, 256, (u, v) => {
      const k = (tfbm(u, v, 5, 5, 71) * 0.8 + tn(u * 90, v * 90, 90, 90, 3) * 0.3) * 255;
      return [k, k, k];
    });
    return tex(c, false);
  }),
  rust: () => memo('rust', () => {
    const { c } = pix(256, 256, (u, v) => {
      const n = tfbm(u, v, 5, 5, 8), s = tn(u * 6, v * 90, 6, 90, 1);
      const k = 0.35 + n * 0.5 + (s - 0.5) * 0.25;
      return [k * 190, k * 100, k * 55];
    });
    return tex(c);
  }),
  darkMetal: () => memo('darkMetal', () => {
    const { c } = pix(256, 256, (u, v) => {
      const n = tfbm(u, v, 5, 5, 18), g = tn(u * 100, v * 100, 100, 100, 6);
      const r = tfbm(u, v, 4, 4, 28) > 0.6 ? 1 : 0;
      const k = 0.2 + n * 0.2 + g * 0.06;
      return [k * 230 + r * 60, k * 235 + r * 22, k * 240 - r * 6];
    });
    return tex(c);
  }),
  corrugated: (hex: number) => memo(`corr${hex}`, () => {
    const [R, G, B] = hexRGB(hex);
    const { c } = pix(256, 256, (u, v) => {
      const rib = 0.78 + 0.22 * Math.sin(u * Math.PI * 2 * 16);
      const n = tfbm(u, v, 4, 5, 12);
      const rv = smooth01((tfbm(u, v, 5, 5, 31) + Math.pow(1 - v, 3) * 0.35 - 0.55) * 6);
      const f = rib * (0.75 + n * 0.4);
      return [R * f * (1 - rv) + 150 * rv * rib, G * f * (1 - rv) + 70 * rv * rib, B * f * (1 - rv) + 36 * rv * rib];
    });
    return tex(c);
  }),
  wood: (hex = 0x7a5a3a) => memo(`wood${hex}`, () => {
    const [R, G, B] = hexRGB(hex);
    const { c, ctx } = pix(256, 256, (u, v) => {
      const plank = Math.floor(v * 6);
      const pv = h2(plank, 1, 4);
      const grain = tn(u * 3, v * 120, 3, 120, 5 + plank);
      const k = 0.55 + pv * 0.4 + grain * 0.35 - 0.2;
      const gap = (v * 6 - plank) < 0.05 ? 0.35 : 1;
      return [R * k * gap, G * k * gap, B * k * gap];
    });
    ctx.strokeStyle = 'rgba(20,12,6,0.5)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, i * (256 / 6)); ctx.lineTo(256, i * (256 / 6)); ctx.stroke(); }
    return tex(c);
  }),
  plaster: (hex: number, seed = 1) => memo(`plaster${hex}${seed}`, () => {
    const [R, G, B] = hexRGB(hex);
    const { c, ctx } = pix(256, 256, (u, v) => {
      const n = tfbm(u, v, 4, 5, seed * 4), g = tn(u * 100, v * 100, 100, 100, seed);
      const damp = smooth01((tfbm(u, v, 3, 4, seed + 9) + Math.pow(1 - v, 2) * 0.3 - 0.6) * 6);
      const f = 0.72 + n * 0.45 + (g - 0.5) * 0.12;
      return [R * f * (1 - damp * 0.4), G * f * (1 - damp * 0.35), B * f * (1 - damp * 0.3)];
    });
    ctx.strokeStyle = 'rgba(30,25,20,0.35)';
    const r = rng(seed * 7);
    for (let i = 0; i < 8; i++) { ctx.beginPath(); let x = r() * 256, y = r() * 256; ctx.moveTo(x, y); for (let s = 0; s < 5; s++) { x += (r() - 0.5) * 24; y += r() * 20; ctx.lineTo(x, y); } ctx.stroke(); }
    return tex(c);
  }),
  roofTile: () => memo('roof', () => {
    const { c } = pix(256, 256, (u, v) => {
      const row = Math.floor(v * 10), col = u * 8 + (row % 2) * 0.5;
      const fx = col - Math.floor(col), fy = v * 10 - row;
      const k = 0.55 + h2(Math.floor(col), row, 3) * 0.4 - (fy < 0.12 ? 0.35 : 0) - (fx < 0.05 ? 0.2 : 0);
      const moss = tfbm(u, v, 5, 4, 13) > 0.6 ? 0.8 : 1;
      return [150 * k, 62 * k * moss + 18, 40 * k * moss];
    });
    return tex(c);
  }),
  tread: () => memo('tread', () => {
    const { c } = pix(128, 128, (u, v) => {
      const a = ((u * 12 + Math.abs(v - 0.5) * 6) % 1);
      const k = (a < 0.55 ? 0.15 : 0.06) + tn(u * 60, v * 60, 60, 60, 2) * 0.05;
      return [k * 255, k * 252, k * 250];
    });
    return tex(c);
  }),
  glass: () => memo('glass', () => {
    const { c, ctx } = pix(256, 256, (u, v) => {
      const dirt = tfbm(u, v, 4, 4, 5);
      const a = 0.35 + dirt * 0.25 + Math.pow(1 - v, 3) * 0.2;
      return [60, 78, 74, a * 255];
    });
    const r = rng(9);
    ctx.strokeStyle = 'rgba(240,250,250,0.75)';
    const cx = 150, cy = 90;
    for (let i = 0; i < 14; i++) {
      const a = r() * 6.28; let x = cx, y = cy; ctx.lineWidth = 0.8 + r() * 0.8; ctx.beginPath(); ctx.moveTo(x, y);
      const L = 40 + r() * 110;
      for (let s = 0; s < 5; s++) { x += Math.cos(a + (r() - 0.5) * 0.5) * L / 5; y += Math.sin(a + (r() - 0.5) * 0.5) * L / 5; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.lineWidth = 0.6;
    for (let rr = 12; rr < 60; rr += 16) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.28); ctx.stroke(); }
    return tex(c, true, false);
  }),
  sign: (text: string, bg: string, fg: string, sub = '') => memo(`sign${text}${bg}${sub}`, () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = fg; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 42px Impact, Arial Narrow, sans-serif';
    ctx.fillText(text, 128, sub ? 50 : 64, 230);
    if (sub) { ctx.font = 'bold 24px Arial'; ctx.fillText(sub, 128, 96, 230); }
    // pas ve yıpranma
    const id = ctx.getImageData(0, 0, 256, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
      const n = tfbm(x / 256, y / 128, 5, 5, 3) + Math.pow(y / 128, 2) * 0.15;
      if (n > 0.6) { const o = (y * 256 + x) * 4; const m = Math.min(1, (n - 0.6) * 6); id.data[o] = id.data[o] * (1 - m) + 130 * m; id.data[o + 1] = id.data[o + 1] * (1 - m) + 62 * m; id.data[o + 2] = id.data[o + 2] * (1 - m) + 30 * m; }
    }
    ctx.putImageData(id, 0, 0);
    return tex(c, true, false);
  }),
  crate: (kind: 'crate' | 'fragile' | 'urgent') => memo('crate' + kind, () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    const base = kind === 'crate' ? '#8a6a44' : kind === 'fragile' ? '#c9b48a' : '#c8501e';
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    const r = rng(kind.length * 31);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${r() > 0.5 ? '255,235,200' : '30,18,8'},${r() * 0.12})`; ctx.fillRect(r() * 256, r() * 256, 1 + r() * 30, 1); }
    if (kind === 'crate') {
      ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 6;
      ctx.strokeRect(5, 5, 246, 246);
      for (let i = 1; i < 4; i++) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke(); }
      ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(248, 248); ctx.stroke();
    } else if (kind === 'fragile') {
      ctx.fillStyle = '#d8d0b8'; ctx.fillRect(0, 100, 256, 56);
      ctx.fillStyle = '#b3201a'; ctx.font = 'bold 40px Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('KIRILIR', 128, 140);
      ctx.strokeStyle = '#7a6f58'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, 236, 236);
      ctx.fillStyle = '#222'; ctx.font = '22px Arial'; ctx.fillText('🍷 ↑ ↑', 128, 60);
    } else {
      ctx.fillStyle = '#f0e8d0';
      for (let i = -4; i < 8; i++) { ctx.save(); ctx.translate(i * 48, 0); ctx.transform(1, 0, -0.6, 1, 0, 0); ctx.fillRect(0, 0, 18, 256); ctx.restore(); }
      ctx.fillStyle = '#c8501e'; ctx.fillRect(60, 86, 136, 84);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 54px Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ACİL', 128, 146);
    }
    return tex(c);
  }),
  waterN: () => memo('waterN', () => {
    const S = 256;
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = tfbm(x / S, y / S, 6, 4, 90);
    const { c } = pix(S, S, (_u, _v, x, y) => {
      const l = hgt[y * S + ((x + S - 1) % S)], r = hgt[y * S + ((x + 1) % S)], d = hgt[((y + S - 1) % S) * S + x], u2 = hgt[((y + 1) % S) * S + x];
      const nx = (l - r) * 6, ny = (d - u2) * 6;
      const L = Math.hypot(nx, ny, 1);
      return [(nx / L * 0.5 + 0.5) * 255, (ny / L * 0.5 + 0.5) * 255, (1 / L * 0.5 + 0.5) * 255];
    });
    return tex(c, false);
  }),
  soft: () => memo('soft', () => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return tex(c, true, false);
  }),
  puff: () => memo('puff', () => {
    const { c } = pix(128, 128, (u, v) => {
      const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy) * 2;
      const n = tfbm(u, v, 4, 4, 15);
      const a = Math.max(0, 1 - d) * Math.min(1, (0.4 + n * 1.1)) ;
      return [255, 255, 255, Math.pow(a, 1.3) * 255];
    });
    return tex(c, true, false);
  }),
  grassTuft: () => memo('tuft', () => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d')!;
    const r = rng(3);
    for (let i = 0; i < 36; i++) {
      const x = 64 + (r() - 0.5) * 90, h = 50 + r() * 70, lean = (r() - 0.5) * 36;
      const g = 90 + r() * 90;
      ctx.strokeStyle = `rgb(${g * 0.55},${g},${g * 0.3})`; ctx.lineWidth = 2 + r() * 2;
      ctx.beginPath(); ctx.moveTo(x, 128); ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); ctx.stroke();
    }
    return tex(c, true, false);
  }),
  mapPaper: () => memo('map', () => {
    const { c } = pix(128, 128, (u, v) => { const n = tfbm(u, v, 6, 4, 2); return [180 * (0.7 + n * 0.4), 160 * (0.7 + n * 0.4), 120 * (0.7 + n * 0.4)]; });
    return tex(c);
  }),
};

function smooth01(x: number) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
