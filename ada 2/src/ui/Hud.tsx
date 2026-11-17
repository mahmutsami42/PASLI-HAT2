import { useEffect, useRef, useState } from 'react';
import type { Game, HudState } from '../game/game';
import { CARGO_INFO } from '../game/data';

export interface Notice { id: number; text: string; kind: 'good' | 'danger' | 'info' }

function Bar({ label, icon, value, max = 100, color, warn = 30 }: { label: string; icon: string; value: number; max?: number; color: string; warn?: number }) {
  const p = Math.max(0, Math.min(100, (value / max) * 100));
  const low = p < warn;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-5 text-center text-sm">{icon}</span>
      <div className="w-28">
        <div className="mb-0.5 flex justify-between uppercase tracking-wider text-cream/70"><span>{label}</span><span className={low ? 'text-red-400' : ''}>{Math.round(p)}%</span></div>
        <div className="h-2 overflow-hidden rounded-sm bg-black/60 ring-1 ring-white/10">
          <div className="h-full transition-all duration-200" style={{ width: `${p}%`, background: low ? '#e0352b' : color, boxShadow: low ? '0 0 8px #e0352b' : undefined }} />
        </div>
      </div>
    </div>
  );
}

function Minimap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'KeyM') setBig((b) => !b); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const S = big ? 300 : 200;
    const c = ref.current!; const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = S * dpr; c.height = S * dpr;
    const x = c.getContext('2d')!;
    const id = setInterval(() => {
      const m = game.getMapData(); const base = game.minimapBase; const R = game.mapRange;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, S, S);
      x.save(); x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); x.clip();
      x.fillStyle = '#10181a'; x.fillRect(0, 0, S, S);
      const win = big ? 420 : 250; // dünya birimi yarıçap
      const k = S / 2 / win;
      const wx = (px: number) => S / 2 + (px - m.x) * k, wz = (pz: number) => S / 2 + (pz - m.z) * k;
      if (base) { const sz = base.width; const sx = ((m.x - win + R) / (2 * R)) * sz, sy = ((m.z - win + R) / (2 * R)) * sz, sw = ((win * 2) / (2 * R)) * sz; x.imageSmoothingEnabled = true; x.drawImage(base, sx, sy, sw, sw, 0, 0, S, S); }
      x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, 0, S, S);
      if (m.poly.length) { x.strokeStyle = '#ffb347'; x.lineWidth = 3; x.setLineDash([6, 4]); x.beginPath(); m.poly.forEach((p, i) => (i ? x.lineTo(wx(p[0]), wz(p[1])) : x.moveTo(wx(p[0]), wz(p[1])))); x.stroke(); x.setLineDash([]); }
      x.fillStyle = '#ffd34a'; m.pickups.forEach((p) => { x.fillRect(wx(p.x) - 1.5, wz(p.z) - 1.5, 3, 3); });
      x.fillStyle = '#ff7a2a'; m.barricades.forEach((b) => { x.fillRect(wx(b.x) - 4, wz(b.z) - 2, 8, 4); });
      m.enemies.forEach((e) => { x.fillStyle = '#ff3a2a'; x.beginPath(); x.arc(wx(e.x), wz(e.z), e.boss ? 5 : 3, 0, 6.3); x.fill(); });
      if (m.dest) {
        let dx = wx(m.dest.x), dy = wz(m.dest.z);
        const r = S / 2 - 12; const dd = Math.hypot(dx - S / 2, dy - S / 2);
        if (dd > r) { dx = S / 2 + ((dx - S / 2) / dd) * r; dy = S / 2 + ((dy - S / 2) / dd) * r; }
        x.fillStyle = '#4af0a0'; x.strokeStyle = '#06301c'; x.lineWidth = 2; x.beginPath(); x.moveTo(dx, dy - 8); x.lineTo(dx + 6, dy); x.lineTo(dx, dy + 8); x.lineTo(dx - 6, dy); x.closePath(); x.fill(); x.stroke();
      }
      x.save(); x.translate(S / 2, S / 2); x.rotate(Math.PI - m.yaw);
      x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, -9); x.lineTo(6.5, 8); x.lineTo(0, 4); x.lineTo(-6.5, 8); x.closePath(); x.fill(); x.stroke(); x.restore();
      x.restore();
      x.strokeStyle = 'rgba(224,122,46,.85)'; x.lineWidth = 3; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#f1e7d0'; x.font = 'bold 11px sans-serif'; x.textAlign = 'center'; x.fillText('K', S / 2, 14);
    }, 100);
    return () => clearInterval(id);
  }, [big, game]);
  return (
    <div className="flex flex-col items-end gap-1">
      <canvas ref={ref} style={{ width: big ? 300 : 200, height: big ? 300 : 200 }} className="rounded-full shadow-2xl shadow-black/70" />
      <div className="text-[10px] uppercase tracking-widest text-cream/50">M: harita boyutu</div>
    </div>
  );
}

function GunIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 64 32" className="h-8 w-16" fill="currentColor">
      <rect x="2" y="12" width={level >= 3 ? 38 : 44} height={level === 4 ? 6 : 3} rx="1" />
      <rect x="40" y="10" width="20" height="9" rx="2" />
      <rect x="46" y="18" width="6" height="11" rx="1" transform="rotate(8 49 23)" />
      {level >= 2 && <rect x="30" y="18" width="6" height="10" rx="1" />}
      {level === 3 && <circle cx="33" cy="25" r="6" />}
      {level === 4 && <rect x="26" y="6" width="14" height="5" rx="1" />}
    </svg>
  );
}

export default function Hud({ game, hud, notices }: { game: Game; hud: HudState; notices: Notice[] }) {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [showHelp, setShowHelp] = useState(true);
  useEffect(() => {
    const mv = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', mv);
    const t = setTimeout(() => setShowHelp(false), 22000);
    return () => { window.removeEventListener('mousemove', mv); clearTimeout(t); };
  }, []);
  const h = hud;
  const w = h.weapon;
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const speedPct = Math.min(1, h.speed / 125);
  const circ = 2 * Math.PI * 52;
  return (
    <div className="pointer-events-none fixed inset-0 select-none">
      {/* hasar vinyeti */}
      <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 ${60 + h.hurt * 160}px rgba(220,30,20,${Math.min(0.75, h.hurt * 1.4)})` }} />
      {h.hull < 25 && <div className="absolute inset-0 animate-pulse" style={{ boxShadow: 'inset 0 0 120px rgba(200,20,10,.35)' }} />}

      {/* üst orta: rota ilerlemesi */}
      {!h.free ? (
        <div className="absolute left-1/2 top-3 w-[min(520px,52vw)] -translate-x-1/2">
          <div className="panel-soft rounded-md px-3 py-2">
            <div className="mb-1 flex items-end justify-between text-xs uppercase tracking-widest text-cream/80">
              <span>📍 {h.dest}</span>
              <span className="font-display text-xl leading-none text-rust">{Math.round(h.progress)}<span className="text-xs">%</span></span>
              {h.timeLeft !== null ? <span className={h.timeLeft < 20 ? 'font-bold text-red-400' : ''}>⏱ {mm(h.timeLeft)}</span> : <span>⏱ {mm(h.elapsed)}</span>}
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-sm bg-black/60 ring-1 ring-white/10">
              <div className="h-full bg-gradient-to-r from-amber-600 to-rust transition-all duration-200" style={{ width: `${h.progress}%` }} />
              <div className="absolute top-0 h-full w-px bg-red-500/70" style={{ left: '35%' }} /><div className="absolute top-0 h-full w-px bg-red-500/70" style={{ left: '70%' }} />
            </div>
          </div>
          {h.boss !== null && (
            <div className="panel-soft mt-1 rounded-md px-3 py-1.5">
              <div className="mb-0.5 text-[10px] uppercase tracking-widest text-red-300">☠ Haydut Lideri</div>
              <div className="h-2 overflow-hidden rounded-sm bg-black/60"><div className="h-full bg-red-600" style={{ width: `${h.boss * 100}%` }} /></div>
            </div>
          )}
        </div>
      ) : (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 panel-soft rounded-md px-4 py-1.5 text-xs uppercase tracking-widest text-cream/80">Serbest sürüş · ESC menü</div>
      )}

      {/* baskın uyarısı */}
      {h.banner && (
        <div className="absolute left-1/2 top-[18%] -translate-x-1/2 text-center" style={{ animation: 'raidPulse .7s infinite' }}>
          <div className="title-text text-5xl text-red-500 md:text-6xl" style={{ textShadow: '0 0 30px rgba(255,40,20,.8), 0 4px 0 #400' }}>{h.banner.text}</div>
          <div className="mt-1 text-sm uppercase tracking-[.25em] text-cream">{h.banner.sub}</div>
        </div>
      )}

      {/* bildirimler */}
      <div className="absolute left-4 top-4 flex w-72 flex-col gap-1.5">
        {notices.map((n) => (
          <div key={n.id} className="anim-slide rounded-sm border-l-4 px-3 py-1.5 text-sm shadow-lg backdrop-blur" style={{ background: 'rgba(12,12,11,.78)', borderColor: n.kind === 'good' ? '#4af0a0' : n.kind === 'danger' ? '#ff5a4a' : '#e0a050', color: n.kind === 'danger' ? '#ffd0c8' : '#f1e7d0' }}>
            {n.text}
          </div>
        ))}
      </div>

      {/* sağ üst: mini harita + hurda */}
      <div className="absolute right-4 top-3 flex flex-col items-end gap-2">
        <Minimap game={game} />
        <div className="panel-soft flex items-center gap-3 rounded-md px-3 py-1.5 text-sm">
          <span>⚙️ <b className="text-amber-300">{h.scrap}</b> hurda</span>
          <span className="text-cream/40">|</span>
          <span>🧰 {h.kits}</span>
        </div>
      </div>

      {/* sol alt: durum */}
      <div className="absolute bottom-4 left-4">
        <div className="panel-soft flex flex-col gap-1.5 rounded-md p-3">
          <Bar label="Gövde" icon="🛡️" value={h.hull} color="#d9a441" />
          <Bar label="Motor" icon="⚙️" value={h.engine} color="#e0762e" />
          <Bar label="Lastik" icon="🛞" value={h.tires} color="#9aa7b0" />
          <Bar label="Yakıt" icon="⛽" value={h.fuel} max={h.fuelMax} color="#e8c23a" warn={20} />
          {h.cargoType && <Bar label={CARGO_INFO[h.cargoType].name} icon={CARGO_INFO[h.cargoType].icon} value={h.cargo} color="#4abf8a" />}
        </div>
      </div>

      {/* sağ alt: hız göstergesi */}
      <div className="absolute bottom-4 right-4 flex items-end gap-3">
        <div className="relative h-36 w-36">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-[225deg]">
            <circle cx="60" cy="60" r="52" fill="rgba(10,10,9,.72)" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="7" strokeDasharray={`${circ * 0.75} ${circ}`} strokeLinecap="round" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={h.nitro > 0 && speedPct > 0.85 ? '#4ab0ff' : '#e07a2e'} strokeWidth="7" strokeDasharray={`${circ * 0.75 * speedPct} ${circ}`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-display text-4xl leading-none text-cream">{Math.round(h.speed)}</div>
            <div className="text-[10px] uppercase tracking-widest text-cream/60">km/h</div>
            <div className="mt-1 rounded bg-black/50 px-2 text-xs text-amber-300">V{h.gear}</div>
          </div>
        </div>
        {h.nitroMax > 0 && (
          <div className="flex h-28 w-4 flex-col justify-end overflow-hidden rounded-sm bg-black/60 ring-1 ring-white/10" title="Nitro (Shift)">
            <div className="w-full bg-gradient-to-t from-blue-600 to-cyan-300" style={{ height: `${(h.nitro / h.nitroMax) * 100}%` }} />
          </div>
        )}
      </div>

      {/* alt orta: silah paneli */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-end gap-2">
        <button
          onClick={() => { game.toggleRear(); }}
          className={`pointer-events-auto panel flex items-center gap-3 rounded-md px-4 py-2 text-left transition hover:brightness-125 ${h.aiming ? 'ring-2 ring-rust' : ''}`}
          title="Silah kamerasına geç / sürüşe dön (V)"
        >
          <div className={h.aiming ? 'text-rust' : 'text-cream'}><GunIcon level={w.level} /></div>
          <div>
            <div className="font-display text-sm uppercase tracking-wider">{w.name}</div>
            <div className="text-xs text-cream/70">{h.aiming ? 'Sürüşe dön [V]' : 'Silah kamerası [V]'}</div>
          </div>
          <div className="relative ml-2 text-right">
            <div className="font-display text-2xl leading-none text-amber-300">{w.mag}<span className="text-sm text-cream/60">/{w.reserve}</span></div>
            {h.reloadKey ? <div className="text-[10px] uppercase text-red-300">dolduruluyor…</div> : w.mag === 0 ? <div className="text-[10px] uppercase text-red-300">R: doldur</div> : <div className="text-[10px] uppercase text-cream/50">mermi</div>}
            {h.reloadKey && <div className="absolute -bottom-1 left-0 h-0.5 bg-amber-300" style={{ width: `${w.reload * 100}%` }} />}
          </div>
        </button>
        {(h.mines > 0 || h.grenades > 0) && (
          <div className="panel-soft flex flex-col gap-0.5 rounded-md px-3 py-1.5 text-xs">
            <div>💣 Mayın <b className="text-amber-300">{h.mines}</b> <span className="text-cream/50">[Q]</span></div>
            <div>🧨 Bomba <b className="text-amber-300">{h.grenades}</b> <span className="text-cream/50">[sağ tık]</span></div>
          </div>
        )}
      </div>

      {/* ipucu */}
      {h.hint && <div className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded bg-black/70 px-4 py-1.5 text-sm uppercase tracking-widest text-amber-200 shadow-xl">{h.hint}</div>}
      {h.deliver > 0.02 && <div className="absolute left-1/2 top-[58%] h-2 w-56 -translate-x-1/2 overflow-hidden rounded bg-black/70"><div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, h.deliver * 100)}%` }} /></div>}
      {h.hooked && <div className="absolute left-1/2 top-[30%] -translate-x-1/2 rounded border border-red-500 bg-black/70 px-4 py-1 text-sm font-bold uppercase tracking-widest text-red-300" style={{ animation: 'raidPulse .5s infinite' }}>⛓ Halat takıldı — yavaşlıyorsun!</div>}
      {showHelp && !h.aiming && (
        <div className="absolute left-4 top-[34%] hidden max-w-xs rounded bg-black/55 p-2 text-[11px] leading-relaxed text-cream/75 md:block">
          <b>W/↑</b> gaz · <b>S/↓</b> fren/geri · <b>A D</b> direksiyon · <b>Space</b> el freni · <b>Shift</b> nitro<br /><b>V</b> silah kamerası · <b>R</b> tamir kiti · <b>Q</b> mayın · <b>H</b> korna · <b>Esc</b> duraklat
        </div>
      )}

      {/* nişangah */}
      {h.aiming && (
        <>
          <div className="absolute" style={{ left: mouse.x, top: mouse.y, transform: 'translate(-50%,-50%)' }}>
            <div className="relative h-9 w-9">
              <div className="absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 bg-white shadow shadow-black" /><div className="absolute bottom-0 left-1/2 h-2.5 w-0.5 -translate-x-1/2 bg-white shadow shadow-black" />
              <div className="absolute left-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-white shadow shadow-black" /><div className="absolute right-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-white shadow shadow-black" />
              <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
              <div className="absolute inset-0 rounded-full border border-white/30" />
            </div>
            {h.hit > 0 && <div className="absolute left-1/2 top-1/2 text-2xl font-black text-white" style={{ animation: 'hitX .18s forwards' }}>✕</div>}
            {h.kill > 0 && <div className="absolute left-1/2 top-1/2 text-4xl font-black text-red-500" style={{ animation: 'hitX .45s forwards' }}>✕</div>}
          </div>
          <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded bg-black/55 px-3 py-1 text-xs uppercase tracking-widest text-cream/80">Silah kamerası · oto-sürüş açık · sol tık ateş · sağ tık bomba · V: sürüş</div>
        </>
      )}
    </div>
  );
}
