import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, HudState, MissionResult } from './game/game';
import { Contract, SaveData, hasSave, loadSave, defaultSave } from './game/data';
import Hud, { Notice } from './ui/Hud';
import { Garage, MainMenu, PauseMenu, ResultScreen, SettingsModal, StoryModal } from './ui/Menus';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<'menu' | 'garage' | 'drive'>('menu');
  const [save, setSave] = useState<SaveData>(() => loadSave() || defaultSave());
  const [hud, setHud] = useState<HudState | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [result, setResult] = useState<MissionResult | null>(null);
  const [settings, setSettings] = useState(false);
  const [story, setStory] = useState(false);
  const [saved, setSaved] = useState(() => hasSave());
  const [paused, setPaused] = useState(false);
  const nid = useRef(1);

  useEffect(() => {
    if (gameRef.current || !canvasRef.current) return;
    try {
      const g = new Game(canvasRef.current, {
        onHud: (h) => { setHud(h); setPaused((p) => (p !== g.paused ? g.paused : p)); },
        onNotice: (text, kind) => {
          const id = nid.current++;
          setNotices((n) => [...n.slice(-3), { id, text, kind }]);
          setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 3600);
        },
        onEnd: (r) => setResult(r),
        onSave: (s) => { setSave(s); setSaved(true); },
        onReady: () => setReady(true),
        onMode: (m) => { setScreen(m); if (m !== 'drive') { setHud(null); setNotices([]); setPaused(false); } },
      });
      gameRef.current = g; (window as any).__game = g; setGame(g); setSave({ ...g.save });
    } catch (e) {
      console.error(e); setError('WebGL 2.0 başlatılamadı. Lütfen donanım hızlandırmalı bir tarayıcı kullan.');
    }
    return () => { /* oyun sayfa ömrü boyunca yaşar */ };
  }, []);

  const startNew = useCallback(() => { const g = gameRef.current!; g.resetSave(); setStory(true); }, []);
  const afterStory = useCallback(() => { setStory(false); gameRef.current!.enterGarage(); }, []);
  const cont = useCallback(() => { gameRef.current!.enterGarage(); }, []);
  const start = useCallback((c: Contract) => { setResult(null); gameRef.current!.startMission(c); }, []);

  return (
    <div className="fixed inset-0 bg-black">
      <canvas id="game" ref={canvasRef} tabIndex={0} />
      {error && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black p-8 text-center text-lg text-red-300">{error}</div>}
      {!ready && !error && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#0b0d0e]">
          <div className="title-text text-6xl text-cream">PASLI <span className="text-rust">HAT</span></div>
          <div className="mt-3 text-xs uppercase tracking-[.4em] text-cream/50">Ada hazırlanıyor…</div>
          <div className="mt-6 h-1 w-56 overflow-hidden rounded bg-white/10"><div className="h-full w-1/2 animate-pulse bg-rust" /></div>
        </div>
      )}
      {game && ready && (
        <>
          {screen === 'menu' && !story && <MainMenu game={game} hasSave={saved} onNew={startNew} onContinue={cont} onSettings={() => setSettings(true)} />}
          {story && <StoryModal onClose={afterStory} />}
          {screen === 'garage' && <Garage game={game} save={save} onStart={start} onMenu={() => game.enterMenu()} onSettings={() => setSettings(true)} />}
          {screen === 'drive' && hud && <Hud game={game} hud={hud} notices={notices} />}
          {screen === 'drive' && paused && !settings && <PauseMenu game={game} onResume={() => { game.setPaused(false); setPaused(false); }} onSettings={() => setSettings(true)} onGarage={() => { setPaused(false); game.quitToGarage(); }} onMenu={() => { setPaused(false); game.quitToMenu(); }} />}
          {screen === 'drive' && result && <ResultScreen r={result} kits={hud?.kits ?? 0} onGarage={() => { setResult(null); game.quitToGarage(); }} onContinue={() => { setResult(null); game.continueAfterFail(); }} />}
          {settings && <SettingsModal game={game} save={save} onClose={() => setSettings(false)} />}
        </>
      )}
    </div>
  );
}
