import { useEffect, useMemo, useState } from 'react';
import type { Game, MissionResult } from '../game/game';
import {
  CARGO_INFO, Contract, MAX_LEVEL, QUALITY_LABEL, Quality, SaveData, TIME_LABEL, UPGRADE_INFO, UpgradeKey, WEATHER_LABEL, DESTS, upgradeCost, derive,
} from '../game/data';
import { audio } from '../game/audio';

const click = () => { audio.init(); audio.sfx('click', 0.6); };

export function Shell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`fixed inset-0 ${className}`}>{children}</div>;
}

// ------------------------------------------------------------------ ayarlar
const QDESC: Record<Quality, string> = {
  low: 'Gölge yok, hafif bitki örtüsü, düşük çözünürlük. En akıcı.',
  medium: 'Gölgeler, yansımalar, orta bitki yoğunluğu.',
  high: 'MSAA, bloom, 2K gölgeler, çim, geniş görüş.',
  ultra: 'Ortam gölgelendirme (GTAO), 4K gölgeler, bloom, yoğun efektler.',
};
export function SettingsModal({ game, save, onClose }: { game: Game; save: SaveData; onClose: () => void }) {
  const s = save.settings;
  const [confirm, setConfirm] = useState(false);
  const set = (p: Partial<SaveData['settings']>) => { game.updateSettings(p); };
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 anim-fadein" onMouseDown={(e) => e.stopPropagation()}>
      <div className="panel scroll-thin max-h-[90vh] w-[min(760px,94vw)] overflow-y-auto rounded-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="title-text text-3xl text-rust">AYARLAR</h2>
          <button onClick={() => { click(); onClose(); }} className="btn btn-ghost rounded px-4 py-1.5 text-sm">Kapat ✕</button>
        </div>
        <div className="mb-2 text-xs uppercase tracking-widest text-cream/60">Grafik kalitesi (oyun içinde değiştirilebilir)</div>
        <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          {(['low', 'medium', 'high', 'ultra'] as Quality[]).map((q) => (
            <button key={q} onClick={() => { click(); set({ quality: q }); }} className={`btn rounded p-3 text-left ${s.quality === q ? 'btn-primary' : 'btn-ghost'}`}>
              <div className="text-lg">{QUALITY_LABEL[q]}</div>
              <div className="mt-1 font-sans text-[10px] normal-case leading-snug tracking-normal opacity-80">{QDESC[q]}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {([['Ana ses', 'master'], ['Müzik', 'music'], ['Efekt sesleri', 'sfx']] as const).map(([lab, k]) => (
            <label key={k} className="block text-sm">
              <div className="mb-1 flex justify-between text-cream/80"><span>{lab}</span><span>{Math.round(s[k] * 100)}%</span></div>
              <input type="range" min={0} max={1} step={0.05} value={s[k]} onChange={(e) => set({ [k]: parseFloat(e.target.value) } as never)} className="w-full" />
            </label>
          ))}
          <label className="block text-sm">
            <div className="mb-1 flex justify-between text-cream/80"><span>Çözünürlük ölçeği</span><span>{Math.round(s.resScale * 100)}%</span></div>
            <input type="range" min={0.5} max={1} step={0.05} value={s.resScale} onChange={(e) => set({ resScale: parseFloat(e.target.value) })} className="w-full" />
          </label>
          <label className="flex items-center gap-3 text-sm md:col-span-2">
            <input type="checkbox" checked={s.shake} onChange={(e) => set({ shake: e.target.checked })} className="h-4 w-4 accent-orange-500" /> Kamera sarsıntısı
          </label>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-black/30 p-3 text-xs text-cream/80 md:grid-cols-3">
          <div><b>W / ↑</b> gaz</div><div><b>S / ↓</b> fren / geri</div><div><b>A D / ← →</b> direksiyon</div>
          <div><b>Space</b> el freni</div><div><b>Shift</b> nitro</div><div><b>V</b> kamera değiştir</div>
          <div><b>Mouse</b> nişan</div><div><b>Sol tık</b> ateş</div><div><b>Sağ tık / E</b> bomba</div>
          <div><b>Q</b> mayın bırak</div><div><b>R</b> tamir kiti</div><div><b>Shift+R / F</b> şarjör doldur</div>
          <div><b>H</b> korna</div><div><b>M</b> harita boyutu</div><div><b>Esc</b> duraklat</div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-cream/50">
          <span>Oyun ilerlemesi tarayıcıda (LocalStorage) otomatik kaydedilir. Düşük FPS'te çözünürlük otomatik ayarlanır.</span>
          {confirm ? (
            <span className="flex gap-2"><button onClick={() => { click(); game.resetSave(); setConfirm(false); onClose(); }} className="btn rounded bg-red-700 px-3 py-1 text-white">Evet, sil</button><button onClick={() => setConfirm(false)} className="btn btn-ghost rounded px-3 py-1">Vazgeç</button></span>
          ) : <button onClick={() => setConfirm(true)} className="btn btn-ghost rounded px-3 py-1 text-red-300">Kaydı sil</button>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ana menü
export function MainMenu({ game, hasSave, onNew, onContinue, onSettings }: { game: Game; hasSave: boolean; onNew: () => void; onContinue: () => void; onSettings: () => void }) {
  const [howto, setHowto] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <Shell>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(8,8,8,.88) 0%, rgba(8,8,8,.55) 35%, rgba(8,8,8,0) 62%), linear-gradient(0deg, rgba(0,0,0,.6), transparent 30%)' }} />
      <div className="absolute left-[6vw] top-1/2 w-[min(520px,88vw)] -translate-y-1/2 anim-fadeup">
        <div className="mb-2 text-xs uppercase tracking-[.5em] text-rust">Açık dünya · teslimat · hayatta kalma</div>
        <h1 className="title-text text-[clamp(56px,9vw,120px)] leading-[.9] text-cream">PASLI<br /><span className="text-rust">HAT</span></h1>
        <div className="title-text mt-2 text-2xl text-cream/90">ADA KURYESİ</div>
        <div className="mt-1 text-xs uppercase tracking-[.35em] text-cream/45">Rustline: Island Delivery</div>
        <div className="mt-8 flex w-72 flex-col gap-3">
          {hasSave && <button onClick={() => { click(); onContinue(); }} className="btn btn-primary rounded px-6 py-3 text-xl">▶ Devam Et</button>}
          {confirm ? (
            <div className="panel rounded p-3 text-sm">Mevcut ilerleme silinip yeni oyun başlayacak. Emin misin?
              <div className="mt-2 flex gap-2"><button onClick={() => { click(); setConfirm(false); onNew(); }} className="btn btn-primary flex-1 rounded py-1.5">Evet</button><button onClick={() => setConfirm(false)} className="btn btn-ghost flex-1 rounded py-1.5">Hayır</button></div>
            </div>
          ) : <button onClick={() => { click(); if (hasSave) setConfirm(true); else onNew(); }} className={`btn rounded px-6 py-3 text-xl ${hasSave ? 'btn-ghost' : 'btn-primary'}`}>{hasSave ? 'Yeni Oyun' : '▶ Oyuna Başla'}</button>}
          <button onClick={() => { click(); onSettings(); }} className="btn btn-ghost rounded px-6 py-3 text-xl">⚙ Ayarlar</button>
          <button onClick={() => { click(); setHowto(true); }} className="btn btn-ghost rounded px-6 py-2 text-base">? Nasıl Oynanır</button>
        </div>
        <div className="mt-6 text-[11px] text-cream/40">Grafik: {QUALITY_LABEL[game.save.settings.quality]} · tarayıcıda WebGL 2.0</div>
      </div>
      {howto && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 anim-fadein" onClick={() => setHowto(false)}>
          <div className="panel max-w-xl rounded-lg p-6 text-sm leading-relaxed" onClick={(e) => e.stopPropagation()}>
            <h3 className="title-text mb-3 text-2xl text-rust">NASIL OYNANIR</h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-cream/90">
              <li>Garajdaki <b>sipariş panosundan</b> bir teslimat seç. Kargo kasana yüklenir.</li>
              <li>Adanın yollarını sürerek hedef köye git. Rota yüzdesi üstte, harita sağ üstte.</li>
              <li><b>Çukurlardan</b> ve engellerden kaç; yüksek hızda kargon hasar görür. Yol kenarındaki <b>hurdaları</b> topla.</li>
              <li>Rotanın %35–%70 aralığında <b>haydut baskını</b> başlar. <b>V</b> veya silah ikonu ile arka silah kamerasına geç, nişan al, ateş et. Oto-sürüş seni yolda tutar ama çukurlardan kaçmaz!</li>
              <li>Halat atanları vur, barikatları kır, mayın bırak (Q), bomba at (sağ tık).</li>
              <li>Teslimat yerinde dur. Ödül; kargo sağlığına, süreye ve topladığın hurdaya bağlı.</li>
              <li>Garajda kamyonu tamir et, <b>8 kategoride</b> geliştir; yeni köyler ve değerli kargolar açılsın.</li>
            </ol>
            <button onClick={() => setHowto(false)} className="btn btn-primary mt-4 rounded px-6 py-2">Anladım</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function StoryModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 anim-fadein">
      <div className="panel max-w-xl rounded-lg p-7">
        <div className="text-xs uppercase tracking-[.4em] text-rust">Bölüm 1</div>
        <h2 className="title-text mb-3 text-4xl text-cream">YOLLAR SUSTU</h2>
        <p className="mb-3 leading-relaxed text-cream/85">Adanın köyleri birbirinden koptu. Yollar bakımsız, çukurlarla dolu; haydutlar ise her virajda pusuda. Ticaret durma noktasına geldi.</p>
        <p className="mb-5 leading-relaxed text-cream/85">Sen, Limanköy'deki küçük garajın tek şoförüsün. Elinde paslı, ağır ama inatçı eski bir kamyon var. Teslimat yap, hurda topla, kamyonu güçlendir… ve adanın yollarını yeniden güvenli hale getir.</p>
        <button onClick={() => { click(); onClose(); }} className="btn btn-primary rounded px-8 py-3 text-xl">Garaja Gir</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ garaj
function Pips({ n }: { n: number }) {
  return <div className="flex gap-1">{Array.from({ length: MAX_LEVEL }).map((_, i) => <div key={i} className={`h-2 w-6 rounded-sm ${i < n ? 'bg-rust shadow shadow-orange-500/50' : 'bg-white/10'}`} />)}</div>;
}
function Cond({ label, v, c = '#d9a441', max = 100 }: { label: string; v: number; c?: string; max?: number }) {
  const p = Math.max(0, Math.min(100, (v / max) * 100));
  return <div><div className="mb-0.5 flex justify-between text-xs uppercase tracking-wider text-cream/70"><span>{label}</span><span>{Math.round(p)}%</span></div><div className="h-2.5 overflow-hidden rounded-sm bg-black/60"><div className="h-full" style={{ width: `${p}%`, background: p < 30 ? '#e0352b' : c }} /></div></div>;
}

export function Garage({ game, save, onStart, onMenu, onSettings }: { game: Game; save: SaveData; onStart: (c: Contract) => void; onMenu: () => void; onSettings: () => void }) {
  const [tab, setTab] = useState<'orders' | 'upgrades' | 'repair'>('orders');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const contracts = useMemo(() => game.contracts(), [save.completed, save.seed, game]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = derive(save.upgrades);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(''), 2200); return () => clearTimeout(t); } }, [msg]);
  useEffect(() => {
    const c = contracts.find((x) => x.id === sel);
    game.previewCargo(tab === 'orders' && c ? c.cargo : null);
  }, [sel, tab, contracts, game, save.upgrades]);
  const locked = DESTS.filter((x) => x.unlock > save.completed);
  const repairCost = game.repairCost(), fuelCost = game.fuelCost();
  const tr = save.truck;
  return (
    <Shell>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(270deg, rgba(8,8,8,.88) 0%, rgba(8,8,8,.5) 40%, rgba(8,8,8,0) 62%)' }} />
      {/* üst bar */}
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4">
        <div className="pointer-events-auto">
          <div className="title-text text-3xl text-cream">USTA GARAJI <span className="text-rust">· LİMANKÖY</span></div>
          <div className="text-[11px] uppercase tracking-[.3em] text-cream/55">Teslimat #{save.completed + 1} · Kamyonu sürükleyerek döndür · tekerlekle yakınlaş</div>
        </div>
        <div className="panel pointer-events-auto flex items-center gap-5 rounded-md px-5 py-2">
          <div className="text-xl">💰 <b className="text-amber-300">{save.money}</b> <span className="text-xs text-cream/60">₺</span></div>
          <div className="text-xl">⚙️ <b className="text-amber-300">{save.scrap}</b> <span className="text-xs text-cream/60">hurda</span></div>
        </div>
      </div>
      {/* alt sol */}
      <div className="pointer-events-auto absolute bottom-4 left-4 flex gap-2">
        <button onClick={() => { click(); onMenu(); }} className="btn btn-ghost rounded px-4 py-2">← Ana Menü</button>
        <button onClick={() => { click(); onSettings(); }} className="btn btn-ghost rounded px-4 py-2">⚙ Ayarlar</button>
      </div>
      {msg && <div className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded bg-black/80 px-5 py-2 text-amber-200 anim-fadeup">{msg}</div>}
      {/* sağ panel */}
      <div className="pointer-events-auto absolute bottom-4 right-4 top-24 flex w-[min(500px,94vw)] flex-col">
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          {([['orders', '📋 Siparişler'], ['upgrades', '🔧 Geliştirme'], ['repair', '🛠 Tamir']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { click(); setTab(k); }} className={`btn rounded py-2 text-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`}>{l}</button>
          ))}
        </div>
        <div className="panel scroll-thin flex-1 overflow-y-auto rounded-lg p-3">
          {tab === 'orders' && (
            <div className="flex flex-col gap-3">
              <div className="text-xs uppercase tracking-widest text-cream/55">Sipariş panosu</div>
              {contracts.map((c) => {
                const info = CARGO_INFO[c.cargo];
                const stars = save.stars[c.id] || 0;
                const active = sel === c.id;
                return (
                  <div key={c.id} onClick={() => { audio.init(); setSel(c.id); }} className={`cursor-pointer rounded-md border p-3 transition ${active ? 'border-rust bg-orange-950/40' : 'border-white/10 bg-black/30 hover:border-white/30'} ${c.boss ? 'ring-1 ring-red-600/70' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-display text-lg uppercase tracking-wide">{c.boss && '☠ '}{c.title}</div>
                        <div className="text-xs text-cream/60">{c.dest!.tag} · {(c.routeLen / 1000).toFixed(1)} km</div>
                      </div>
                      <div className="text-right"><div className="font-display text-2xl text-amber-300">{c.reward} ₺</div><div className="text-[10px] text-cream/50">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</div></div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded bg-white/10 px-2 py-0.5">{info.icon} {info.name}</span>
                      <span className="rounded bg-white/10 px-2 py-0.5">{c.time === 'night' ? '🌙' : c.time === 'sunset' ? '🌇' : '☀️'} {TIME_LABEL[c.time]}</span>
                      <span className="rounded bg-white/10 px-2 py-0.5">{c.weather === 'rain' ? '🌧' : '⛅'} {WEATHER_LABEL[c.weather]}</span>
                      <span className="rounded bg-red-900/60 px-2 py-0.5">Zorluk {'💀'.repeat(c.difficulty)}</span>
                      {c.timeLimit > 0 && <span className="rounded bg-amber-900/70 px-2 py-0.5">⏱ {Math.floor(c.timeLimit / 60)}:{String(Math.floor(c.timeLimit % 60)).padStart(2, '0')}</span>}
                    </div>
                    {active && (
                      <div className="mt-2 anim-fadeup">
                        <div className="mb-2 text-xs text-cream/75">{info.desc} {c.boss && 'Haydut liderini yenmeden teslim edemezsin!'} {d.crates} kutu taşınacak (+%{Math.round(d.payBonus * 100)} ödül).</div>
                        <button onClick={(e) => { e.stopPropagation(); click(); onStart(c); }} className="btn btn-primary w-full rounded py-2.5 text-lg">🚚 Yükle ve Yola Çık</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {locked.length > 0 && <div className="rounded border border-dashed border-white/15 p-2 text-xs text-cream/50">🔒 {locked.map((l) => `${l.name} (${l.unlock} teslimat)`).join(' · ')} — başarılı teslimatlarla açılır.</div>}
              {save.completed >= 4 && !save.bossDefeated && false}
              <div onClick={() => { click(); onStart(game.freeContract()); }} className="cursor-pointer rounded-md border border-white/10 bg-black/30 p-3 hover:border-white/30">
                <div className="font-display text-lg uppercase">🧭 Serbest Sürüş</div>
                <div className="text-xs text-cream/60">Adayı keşfet: haydut yok, hurda ve yakıt topla. Yeni yolları öğren.</div>
              </div>
            </div>
          )}
          {tab === 'upgrades' && (
            <div className="flex flex-col gap-3">
              {(Object.keys(UPGRADE_INFO) as UpgradeKey[]).map((k) => {
                const inf = UPGRADE_INFO[k]; const lv = save.upgrades[k]; const max = lv >= MAX_LEVEL;
                const cost = max ? null : upgradeCost(k, lv + 1);
                const can = cost && save.money >= cost.money && save.scrap >= cost.scrap;
                return (
                  <div key={k} className="rounded-md border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-display text-lg uppercase tracking-wide">{inf.icon} {inf.name}</div>
                      <Pips n={lv} />
                    </div>
                    <div className="mb-1.5 text-[11px] text-cream/55">{inf.blurb}</div>
                    <div className="text-xs"><span className="text-cream/50">Şimdi:</span> <b>{inf.levels[lv].name}</b> — <span className="text-emerald-300">{inf.levels[lv].effect}</span></div>
                    {!max ? (
                      <>
                        <div className="mt-1 text-xs"><span className="text-cream/50">Sonraki (Sv.{lv + 1}):</span> <b className="text-amber-200">{inf.levels[lv + 1].name}</b> — <span className="text-amber-300">{inf.levels[lv + 1].effect}</span></div>
                        <button disabled={!can} onClick={() => { const r = game.buyUpgrade(k); setMsg(r.msg); }} className="btn btn-primary mt-2 flex w-full items-center justify-between rounded px-3 py-2 text-sm">
                          <span>Satın al</span><span>{cost!.money} ₺ + {cost!.scrap} ⚙</span>
                        </button>
                        {!can && <div className="mt-1 text-[10px] text-red-300">{save.money < cost!.money ? `${cost!.money - save.money} ₺ eksik ` : ''}{save.scrap < cost!.scrap ? `${cost!.scrap - save.scrap} hurda eksik` : ''}</div>}
                      </>
                    ) : <div className="mt-2 rounded bg-emerald-900/40 py-1 text-center text-xs uppercase tracking-widest text-emerald-300">Maksimum seviye</div>}
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'repair' && (
            <div className="flex flex-col gap-4 p-1">
              <div className="text-xs uppercase tracking-widest text-cream/55">Kamyon durumu</div>
              <div className="flex flex-col gap-2.5 rounded-md bg-black/30 p-3">
                <Cond label="Gövde" v={tr.hull} /><Cond label="Motor" v={tr.engine} c="#e0762e" /><Cond label="Lastik & süspansiyon" v={tr.tires} c="#9aa7b0" /><Cond label={`Yakıt (${tr.fuel.toFixed(0)} / ${d.tank} L)`} v={tr.fuel} max={d.tank} c="#e8c23a" />
              </div>
              <button disabled={repairCost <= 0} onClick={() => setMsg(game.repairAll().msg)} className="btn btn-primary flex items-center justify-between rounded px-4 py-3 text-lg"><span>🛠 Tam Tamir</span><span>{repairCost > 0 ? `${repairCost} ₺` : 'Sağlam'}</span></button>
              <button disabled={fuelCost <= 0} onClick={() => setMsg(game.refuel().msg)} className="btn btn-primary flex items-center justify-between rounded px-4 py-3 text-lg"><span>⛽ Depoyu Doldur</span><span>{fuelCost > 0 ? `${fuelCost} ₺` : 'Dolu'}</span></button>
              <div className="rounded bg-black/30 p-3 text-xs leading-relaxed text-cream/70">
                <div className="mb-1 font-display text-sm uppercase text-cream">Mevcut donanım</div>
                Hız <b>{Math.round(21 * d.topSpeed * 3.6)} km/h</b> · İvme ×{d.accel.toFixed(2)} · Nitro {d.nitro}s · Hasar azaltma %{Math.round((1 - d.dmgTaken) * 100)} · Çukur şoku ×{d.shock.toFixed(2)} · {d.crates} kutu · Yakıt {d.tank} L · Tamir kiti {d.kits} · Mayın {d.mines} · Bomba {d.grenades}
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ duraklatma
export function PauseMenu({ game, onResume, onSettings, onGarage, onMenu }: { game: Game; onResume: () => void; onSettings: () => void; onGarage: () => void; onMenu: () => void }) {
  void game;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm anim-fadein" onMouseDown={(e) => e.stopPropagation()}>
      <div className="panel w-80 rounded-lg p-6">
        <h2 className="title-text mb-4 text-center text-4xl text-rust">DURAKLATILDI</h2>
        <div className="flex flex-col gap-2.5">
          <button onClick={() => { click(); onResume(); }} className="btn btn-primary rounded py-3 text-xl">▶ Devam Et</button>
          <button onClick={() => { click(); onSettings(); }} className="btn btn-ghost rounded py-3 text-lg">⚙ Ayarlar</button>
          <button onClick={() => { click(); onGarage(); }} className="btn btn-ghost rounded py-2.5">🔧 Görevi Bırak · Garaj</button>
          <button onClick={() => { click(); onMenu(); }} className="btn btn-ghost rounded py-2.5">🏠 Ana Menü</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sonuç
export function ResultScreen({ r, kits, onGarage, onContinue }: { r: MissionResult; kits: number; onGarage: () => void; onContinue: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { if (!r.success) return; const t = setInterval(() => setShown((s) => (s < r.stars ? s + 1 : s)), 450); return () => clearInterval(t); }, [r]);
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 anim-fadein" onMouseDown={(e) => e.stopPropagation()}>
      <div className="panel scroll-thin max-h-[94vh] w-[min(520px,94vw)] overflow-y-auto rounded-lg p-6 anim-fadeup">
        <div className={`mb-1 text-xs uppercase tracking-[.4em] ${r.success ? 'text-emerald-400' : 'text-red-400'}`}>{r.success ? 'Görev tamamlandı' : 'Görev başarısız'}</div>
        <h2 className="title-text mb-1 text-4xl text-cream">{r.title}</h2>
        <div className="mb-3 text-sm text-cream/60">{r.dest} · {r.cargoName}</div>
        {r.success && (
          <div className="mb-3 flex justify-center gap-3">
            {[0, 1, 2].map((i) => <div key={i} className={`text-5xl ${i < shown ? 'text-amber-400' : 'text-white/15'}`} style={i < shown ? { animation: 'popStar .5s both' } : undefined}>★</div>)}
          </div>
        )}
        <div className="flex flex-col gap-1.5 rounded-md bg-black/35 p-3 text-sm">
          {r.lines.map((l, i) => <div key={i} className="flex justify-between gap-4"><span className="text-cream/75">{l.label}</span><b className={l.good ? 'text-emerald-300' : ''}>{l.value}</b></div>)}
          {r.success && <>
            <div className="mt-1 flex justify-between border-t border-white/15 pt-2 text-lg"><span>Toplam kazanç</span><b className="font-display text-2xl text-amber-300">+{r.money} ₺</b></div>
            <div className="flex justify-between"><span className="text-cream/75">Kazanılan hurda</span><b className="text-amber-300">+{r.scrap} ⚙</b></div>
          </>}
        </div>
        <div className="mt-3 rounded border-l-4 border-rust bg-black/30 px-3 py-2 text-sm italic text-cream/80">“{r.note}” — teslimat notu</div>
        <div className="mt-4 flex flex-col gap-2">
          {!r.success && r.canContinue && <button onClick={() => { click(); onContinue(); }} className="btn btn-primary rounded py-3 text-lg">🧰 Tamir kitini kullan ve devam et ({kits})</button>}
          <button onClick={() => { click(); onGarage(); }} className={`btn rounded py-3 text-lg ${r.success || !r.canContinue ? 'btn-primary' : 'btn-ghost'}`}>🔧 Garaja dön</button>
        </div>
      </div>
    </div>
  );
}
