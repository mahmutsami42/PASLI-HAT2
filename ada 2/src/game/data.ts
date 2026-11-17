import { POIS } from './terrain';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type UpgradeKey = 'armor' | 'engine' | 'tires' | 'bumper' | 'cargo' | 'weapon' | 'explosive' | 'aux';
export type Upgrades = Record<UpgradeKey, number>;
export type CargoType = 'crate' | 'fragile' | 'urgent';
export type Weather = 'clear' | 'rain';
export type TimeOfDay = 'day' | 'sunset' | 'night';

export interface Settings { quality: Quality; master: number; music: number; sfx: number; shake: boolean; resScale: number }
export interface TruckCond { hull: number; engine: number; tires: number; fuel: number }
export interface SaveData {
  money: number; scrap: number; upgrades: Upgrades; truck: TruckCond;
  completed: number; stars: Record<string, number>; bossDefeated: boolean; seed: number; settings: Settings; intro: boolean;
  totalScrap: number;
}

export const MAX_LEVEL = 4;

export const UPGRADE_INFO: Record<UpgradeKey, { name: string; icon: string; blurb: string; levels: { name: string; effect: string }[] }> = {
  armor: {
    name: 'Zırh', icon: '🛡️', blurb: 'Gövde, cam ve motor bölümünü korur; gelen hasarı azaltır.',
    levels: [
      { name: 'Çıplak sac', effect: 'Hasar azaltma: %0' },
      { name: 'Kaynaklı yamalar', effect: 'Gelen hasar -%10' },
      { name: 'Kapı ve kaput plakaları', effect: 'Gelen hasar -%20' },
      { name: 'Cam kafesleri', effect: 'Gelen hasar -%30' },
      { name: 'Ağır zırh kaplama', effect: 'Gelen hasar -%40, motor korunur' },
    ],
  },
  engine: {
    name: 'Motor & Turbo', icon: '⚙️', blurb: 'İvmelenme, azami hız ve kısa süreli nitro.',
    levels: [
      { name: 'Öksüren dizel', effect: 'Standart güç, nitro yok' },
      { name: 'Hava filtresi + nitro', effect: '+%10 ivme, +%5 hız, 3 sn nitro' },
      { name: 'Turbo kit', effect: '+%20 ivme, +%10 hız, 5 sn nitro' },
      { name: 'Çift egzoz', effect: '+%30 ivme, +%15 hız, 7 sn nitro' },
      { name: 'Kompresör', effect: '+%40 ivme, +%20 hız, 9 sn nitro' },
    ],
  },
  tires: {
    name: 'Lastik & Süspansiyon', icon: '🛞', blurb: 'Çukur sarsıntısını ve kargo hasarını azaltır, tutuşu artırır.',
    levels: [
      { name: 'Aşınmış lastikler', effect: 'Standart tutuş' },
      { name: 'Yeni arazi lastiği', effect: 'Tutuş +%8, çukur şoku -%15' },
      { name: 'Güçlendirilmiş yaylar', effect: 'Tutuş +%14, çukur şoku -%30' },
      { name: 'Amortisör seti', effect: 'Tutuş +%20, çukur şoku -%45' },
      { name: 'Ağır hizmet süspansiyon', effect: 'Tutuş +%26, çukur şoku -%60' },
    ],
  },
  bumper: {
    name: 'Ön Tampon', icon: '🔩', blurb: 'Barikat ve haydut araçlarına çarpınca daha az hasar, daha çok darbe.',
    levels: [
      { name: 'Paslı tampon', effect: 'Çarpışma hasarı standart' },
      { name: 'Çelik tampon', effect: 'Çarpışma hasarı -%20' },
      { name: 'Koç kafası', effect: '-%35 hasar, barikat kırar' },
      { name: 'Dikenli tampon', effect: '-%50 hasar, düşmana +%60 hasar' },
      { name: 'Ağır kama', effect: '-%65 hasar, düşmana +%120 hasar' },
    ],
  },
  cargo: {
    name: 'Kargo Kasası', icon: '📦', blurb: 'Ek kutu taşı (ek ödül) ve kargoyu daha iyi koru.',
    levels: [
      { name: 'Ahşap kasa', effect: '2 kutu' },
      { name: 'Takviyeli kasa', effect: '3 kutu, kargo hasarı -%10, +%6 ödül' },
      { name: 'Branda + çerçeve', effect: '4 kutu, hasar -%20, +%12 ödül' },
      { name: 'Çelik yan paneller', effect: '5 kutu, hasar -%30, +%18 ödül' },
      { name: 'Zırhlı kasa', effect: '6 kutu, hasar -%40, +%24 ödül' },
    ],
  },
  weapon: {
    name: 'Arka Silah', icon: '🔫', blurb: 'Haydutlara karşı arka silah. Daha güçlü silahlar daha çok cephane taşır.',
    levels: [
      { name: 'Av tüfeği (kırma)', effect: '34 hasar, 6 mermi, yavaş' },
      { name: 'Pompalı tüfek', effect: '5x14 saçma, 8 mermi' },
      { name: 'Yarı otomatik', effect: '22 hasar, hızlı, 15 mermi' },
      { name: 'Hafif makineli', effect: '12 hasar, seri atış, 40 mermi' },
      { name: 'Ağır makineli', effect: '18 hasar, çok seri, 80 mermi' },
    ],
  },
  explosive: {
    name: 'Patlayıcı Sistem', icon: '💣', blurb: 'Arkaya bırakılan mayınlar (Q) ve bomba atıcı (sağ tık / silah kamerası).',
    levels: [
      { name: 'Yok', effect: 'Patlayıcı yok' },
      { name: 'Mayın rafı', effect: '3 mayın (Q tuşu)' },
      { name: 'Bomba atıcı', effect: '4 mayın + 3 bomba (sağ tık)' },
      { name: 'Çift namlu', effect: '5 mayın + 5 bomba, daha geniş alan' },
      { name: 'Ağır topçu', effect: '6 mayın + 8 bomba, çok geniş alan' },
    ],
  },
  aux: {
    name: 'Yardımcı Sistemler', icon: '🧰', blurb: 'Hurda mıknatısı, tamir kitleri, yakıt deposu ve otomatik sürüş.',
    levels: [
      { name: 'Standart', effect: '1 acil tamir kiti (R)' },
      { name: 'Hurda mıknatısı', effect: 'Hurdayı 12 m çekim' },
      { name: 'Tamir kiti çantası', effect: '+1 tamir kiti (toplam 2)' },
      { name: 'Büyük yakıt deposu', effect: 'Depo 25 L → 40 L' },
      { name: 'Pro otomatik sürüş', effect: 'Daha iyi oto sürüş, mıknatıs 22 m' },
    ],
  },
};

const BASE_COST: Record<UpgradeKey, number> = { armor: 260, engine: 320, tires: 240, bumper: 220, cargo: 200, weapon: 300, explosive: 280, aux: 240 };
export function upgradeCost(key: UpgradeKey, nextLevel: number) {
  const m = Math.round(BASE_COST[key] * Math.pow(1.85, nextLevel - 1) / 10) * 10;
  const s = Math.round(3 + (nextLevel - 1) * 5 + nextLevel * nextLevel * 0.8);
  return { money: m, scrap: s };
}

export interface WeaponDef { name: string; dmg: number; pellets: number; cd: number; mag: number; reload: number; spread: number; auto: boolean; sfx: string; recoil: number }
export const WEAPONS: WeaponDef[] = [
  { name: 'Av Tüfeği', dmg: 34, pellets: 1, cd: 0.85, mag: 6, reload: 2.4, spread: 0.004, auto: false, sfx: 'shot0', recoil: 1.0 },
  { name: 'Pompalı', dmg: 14, pellets: 5, cd: 0.8, mag: 8, reload: 2.8, spread: 0.035, auto: false, sfx: 'shot1', recoil: 1.2 },
  { name: 'Yarı Otomatik', dmg: 22, pellets: 1, cd: 0.28, mag: 15, reload: 2.1, spread: 0.01, auto: false, sfx: 'shot2', recoil: 0.7 },
  { name: 'Hafif Makineli', dmg: 12, pellets: 1, cd: 0.1, mag: 40, reload: 2.4, spread: 0.02, auto: true, sfx: 'shot3', recoil: 0.35 },
  { name: 'Ağır Makineli', dmg: 18, pellets: 1, cd: 0.075, mag: 80, reload: 3.4, spread: 0.022, auto: true, sfx: 'shot4', recoil: 0.5 },
];

export interface Derived {
  accel: number; topSpeed: number; nitro: number; grip: number; shock: number; cargoDmg: number; dmgTaken: number; bumperDmg: number; ram: number;
  crates: number; payBonus: number; tank: number; kits: number; magnet: number; mines: number; grenades: number; blast: number; autoSkill: number; wheelR: number;
}
export function derive(u: Upgrades): Derived {
  return {
    accel: 1 + 0.1 * u.engine, topSpeed: 1 + 0.05 * u.engine, nitro: [0, 3, 5, 7, 9][u.engine],
    grip: 1 + 0.06 * u.tires + (u.tires > 0 ? 0.02 : 0), shock: 1 - [0, 0.15, 0.3, 0.45, 0.6][u.tires], cargoDmg: 1 - 0.1 * u.cargo,
    dmgTaken: 1 - 0.1 * u.armor, bumperDmg: 1 - [0, 0.2, 0.35, 0.5, 0.65][u.bumper], ram: [1, 1, 1.2, 1.6, 2.2][u.bumper],
    crates: 2 + u.cargo, payBonus: 0.06 * u.cargo, tank: u.aux >= 3 ? 40 : 25, kits: 1 + (u.aux >= 2 ? 1 : 0),
    magnet: u.aux >= 4 ? 22 : u.aux >= 1 ? 12 : 3.5, mines: [0, 3, 4, 5, 6][u.explosive], grenades: [0, 0, 3, 5, 8][u.explosive],
    blast: [0, 6, 8, 10, 13][u.explosive], autoSkill: u.aux >= 4 ? 1 : 0.55, wheelR: 0.55 + 0.015 * u.tires,
  };
}

export const defaultSettings = (): Settings => ({ quality: 'medium', master: 0.8, music: 0.6, sfx: 0.9, shake: true, resScale: 1 });
export const defaultSave = (): SaveData => ({
  money: 320, scrap: 6, upgrades: { armor: 0, engine: 0, tires: 0, bumper: 0, cargo: 0, weapon: 0, explosive: 0, aux: 0 },
  truck: { hull: 100, engine: 100, tires: 100, fuel: 25 }, completed: 0, stars: {}, bossDefeated: false, seed: 1, settings: defaultSettings(), intro: false, totalScrap: 0,
});
const KEY = 'rustline-save-v1';
export function loadSave(): SaveData | null {
  try { const s = localStorage.getItem(KEY); if (!s) return null; const d = JSON.parse(s); return { ...defaultSave(), ...d, upgrades: { ...defaultSave().upgrades, ...d.upgrades }, settings: { ...defaultSettings(), ...d.settings } }; } catch { return null; }
}
export function writeSave(s: SaveData) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } }
export function hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } }
export function wipeSave() { try { localStorage.removeItem(KEY); } catch { /* */ } }

// ---------------------------------------------------------------- görevler
export const CARGO_INFO: Record<CargoType, { name: string; desc: string; pay: number; dmg: number; icon: string }> = {
  crate: { name: 'Normal Sandık', desc: 'Hasara dayanıklı, standart ödül.', pay: 1, dmg: 0.5, icon: '📦' },
  fragile: { name: 'Kırılabilir Yük', desc: 'Yüksek ödül ama çukurlarda kolay hasar alır.', pay: 1.9, dmg: 1.7, icon: '🍷' },
  urgent: { name: 'Acil Teslimat', desc: 'Süre içinde ulaşırsan büyük ek ödül.', pay: 1.35, dmg: 1, icon: '⏱️' },
};
export interface Dest { id: string; name: string; node: string; unlock: number; tag: string }
export const DESTS: Dest[] = [
  { id: 'camlik', name: 'Çamlık', node: 'C', unlock: 0, tag: 'Orman köyü' },
  { id: 'yelkaya', name: 'Yelkaya', node: 'Y', unlock: 1, tag: 'Kayalık köy · köprü ötesi' },
  { id: 'maden', name: 'Madenköy', node: 'M', unlock: 3, tag: 'Taş ocağı köyü' },
];
export interface Contract {
  id: string; dest: Dest | null; cargo: CargoType; difficulty: number; title: string; time: TimeOfDay; weather: Weather;
  boss?: boolean; free?: boolean; routeLen: number; reward: number; timeLimit: number; parTime: number;
}
export const START = { name: POIS.liman.name };

export function genContracts(save: SaveData, routeLens: Record<string, number>): Contract[] {
  const out: Contract[] = [];
  const c = save.completed;
  let s = (save.seed * 9301 + 49297) % 233280;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const dests = DESTS.filter((d) => c >= d.unlock);
  const cargos: CargoType[] = ['crate', 'fragile', 'urgent'];
  const n = c === 0 ? 1 : Math.min(4, 2 + dests.length);
  for (let i = 0; i < n; i++) {
    const dest = c === 0 ? dests[0] : dests[Math.floor(r() * dests.length)];
    const cargo: CargoType = c === 0 ? 'crate' : cargos[Math.floor(r() * 3)];
    const diff = c === 0 ? 1 : Math.max(1, Math.min(4, 1 + Math.floor(c / 2) + (dest.id === 'maden' ? 1 : 0) + (r() < 0.3 ? 1 : 0)));
    const time: TimeOfDay = c === 0 ? 'day' : (['day', 'sunset', 'day', 'night'] as TimeOfDay[])[Math.floor(r() * (c >= 2 ? 4 : 2))];
    const weather: Weather = c >= 1 && r() < 0.35 ? 'rain' : 'clear';
    out.push(mk(dest, cargo, diff, time, weather, routeLens[dest.id], `${cargo === 'crate' ? 'Sandık' : cargo === 'fragile' ? 'Hassas yük' : 'Acil kargo'} → ${dest.name}`));
  }
  if (c >= 4 && !save.bossDefeated) {
    const d = DESTS[2];
    const k = mk(d, 'crate', 4, 'sunset', 'clear', routeLens[d.id], 'Yol Temizliği: Haydut Lideri');
    k.boss = true; k.reward = Math.round(k.reward * 2.2); k.id = 'boss';
    out.push(k);
  }
  return out;
}
function mk(dest: Dest, cargo: CargoType, diff: number, time: TimeOfDay, weather: Weather, len: number, title: string): Contract {
  const info = CARGO_INFO[cargo];
  const reward = Math.round((len * 0.17 * info.pay * (1 + (diff - 1) * 0.25) + 40) / 5) * 5;
  const par = len / 10.5 + 8;
  return { id: `${dest.id}-${cargo}-${diff}-${time}-${weather}`, dest, cargo, difficulty: diff, title, time, weather, routeLen: len, reward, parTime: par, timeLimit: cargo === 'urgent' ? par * 0.95 + 6 : 0 };
}
export const TIME_LABEL: Record<TimeOfDay, string> = { day: 'Gündüz', sunset: 'Gün batımı', night: 'Gece' };
export const WEATHER_LABEL: Record<Weather, string> = { clear: 'Açık', rain: 'Yağmurlu' };
export const QUALITY_LABEL: Record<Quality, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', ultra: 'Ultra' };
