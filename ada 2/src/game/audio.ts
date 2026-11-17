// Prosedürel WebAudio: motor, yüzey sesleri, efektler, konumsal düşman motorları, uyarlanabilir müzik.
export type Mood = 'off' | 'garage' | 'drive' | 'tension' | 'relief';
type Pos = { x: number; y: number; z: number };

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode; musicBus!: GainNode; sfxBus!: GainNode; engBus!: GainNode; echoSend!: GainNode;
  white!: AudioBuffer; brown!: AudioBuffer; crack!: AudioBuffer;
  vols = { master: 0.8, music: 0.5, sfx: 0.8 };
  // motor
  eng: any = null; tire: any = null; amb: any = null; skid: any = null; rope: any = null;
  voices: any[] = [];
  mood: Mood = 'off';
  mus: any = null;
  nextStep = 0; step = 0; timer: number | null = null; bpm = 80; chordSet: 'minor' | 'major' = 'minor';
  coughT = 0;
  muted = false;

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    this.master = ctx.createGain(); this.master.connect(comp); comp.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.engBus = ctx.createGain(); this.engBus.connect(this.master);
    // yankı
    const dl = ctx.createDelay(1); dl.delayTime.value = 0.21;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0.35;
    this.echoSend.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
    // tamponlar
    const mk = (f: (i: number, p: number) => number) => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = b.getChannelData(0); let p = 0;
      for (let i = 0; i < d.length; i++) { p = f(i, p); d[i] = p; }
      return b;
    };
    this.white = mk(() => Math.random() * 2 - 1);
    this.brown = mk((_i, p) => { const v = (p + (Math.random() * 2 - 1) * 0.04) / 1.02; return Math.max(-1, Math.min(1, v * 1)); });
    this.crack = mk(() => (Math.random() < 0.06 ? (Math.random() * 2 - 1) * 1.4 : (Math.random() * 2 - 1) * 0.12));
    this.applyVolumes();
    this.buildEngine(); this.buildTire(); this.buildAmbience(); this.buildVoices();
    this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vols.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vols.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vols.sfx, t, 0.05);
    this.engBus.gain.setTargetAtTime(this.vols.sfx * 0.9, t, 0.05);
  }
  setVolumes(m: number, mu: number, s: number) { this.vols = { master: m, music: mu, sfx: s }; this.applyVolumes(); }
  setMuted(m: boolean) { this.muted = m; this.applyVolumes(); }

  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource(); s.buffer = buf; s.loop = true;
    s.loopStart = Math.random(); s.start(0, Math.random() * 2); return s;
  }

  // ---------------------------------------------------------------- motor
  private buildEngine() {
    const ctx = this.ctx!;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
    g1.gain.value = 0.5; g2.gain.value = 0.35; g3.gain.value = 0.15;
    const sh = ctx.createWaveShaper();
    const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.6); }
    sh.curve = c;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.2; lp.frequency.value = 400;
    const amp = ctx.createGain(); amp.gain.value = 0;
    const lope = ctx.createOscillator(); lope.frequency.value = 7;
    const lopeG = ctx.createGain(); lopeG.gain.value = 0.12;
    lope.connect(lopeG); lopeG.connect(amp.gain);
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(sh); g2.connect(sh); g3.connect(sh);
    sh.connect(lp); lp.connect(amp); amp.connect(this.engBus);
    // emme / mekanik gürültü
    const ns = this.loop(this.white);
    const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 900; nbp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0;
    ns.connect(nbp); nbp.connect(ng); ng.connect(this.engBus);
    // mekanik tıkırtı (supap) - çatlak tamponu
    const cs = this.loop(this.crack);
    const cbp = ctx.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 2400; cbp.Q.value = 1.4;
    const cg = ctx.createGain(); cg.gain.value = 0;
    cs.connect(cbp); cbp.connect(cg); cg.connect(this.engBus);
    o1.start(); o2.start(); o3.start(); lope.start();
    this.eng = { o1, o2, o3, lp, amp, lope, ng, nbp, cg, base: 0 };
  }

  updateEngine(p: { rpm: number; throttle: number; health: number; on: boolean; boost: boolean }) {
    if (!this.ctx || !this.eng) return;
    const e = this.eng, t = this.ctx.currentTime;
    const f = Math.max(18, (p.rpm / 60) * 3);
    this.coughT -= 0.016;
    let cough = 1;
    if (this.coughT < 0) {
      this.coughT = 0.6 + Math.random() * (2.6 + p.health * 0.05);
      if (Math.random() < 0.55 + (100 - p.health) * 0.006) cough = 0.3;
    }
    const tgt = p.on ? (0.16 + p.throttle * 0.16 + (p.boost ? 0.06 : 0)) * cough : 0;
    e.amp.gain.setTargetAtTime(tgt, t, cough < 1 ? 0.01 : 0.06);
    const fd = cough < 1 ? 0.88 : 1;
    e.o1.frequency.setTargetAtTime(f * fd, t, 0.04);
    e.o2.frequency.setTargetAtTime(f * 0.5 * fd, t, 0.04);
    e.o3.frequency.setTargetAtTime(f * 2.01 * fd, t, 0.04);
    e.lp.frequency.setTargetAtTime(260 + p.rpm * 0.55 + p.throttle * 520, t, 0.05);
    e.lope.frequency.setTargetAtTime(2 + f / 12, t, 0.1);
    e.ng.gain.setTargetAtTime(p.on ? 0.012 + p.throttle * 0.03 : 0, t, 0.08);
    e.nbp.frequency.setTargetAtTime(500 + p.rpm * 0.4, t, 0.1);
    e.cg.gain.setTargetAtTime(p.on ? 0.02 + (100 - p.health) * 0.0008 : 0, t, 0.1);
  }

  // ---------------------------------------------------------------- tekerlek yüzeyi
  private buildTire() {
    const ctx = this.ctx!;
    const mkL = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number) => {
      const s = this.loop(buf), fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.sfxBus); return { g, fl };
    };
    this.tire = {
      asphalt: mkL(this.white, 'bandpass', 1100, 0.5), gravel: mkL(this.crack, 'highpass', 500, 0.5),
      mud: mkL(this.brown, 'lowpass', 420, 0.7), wet: mkL(this.white, 'bandpass', 3200, 0.4), grass: mkL(this.brown, 'bandpass', 800, 0.6),
    };
    const sk = ctx.createOscillator(); sk.type = 'sawtooth'; sk.frequency.value = 620;
    const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 1500; sbp.Q.value = 4;
    const sg = ctx.createGain(); sg.gain.value = 0;
    sk.connect(sbp); sbp.connect(sg); sg.connect(this.sfxBus); sk.start();
    this.skid = { sk, sg, sbp };
    // halat gerilimi
    const ro = ctx.createOscillator(); ro.type = 'sawtooth'; ro.frequency.value = 90;
    const rbp = ctx.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 400; rbp.Q.value = 6;
    const rg = ctx.createGain(); rg.gain.value = 0;
    const rl = ctx.createOscillator(); rl.frequency.value = 7; const rlg = ctx.createGain(); rlg.gain.value = 40;
    rl.connect(rlg); rlg.connect(ro.frequency);
    ro.connect(rbp); rbp.connect(rg); rg.connect(this.sfxBus); ro.start(); rl.start();
    this.rope = { rg, ro };
  }

  updateTires(p: { speed: number; surf: number; wet: boolean; offroad: boolean; slip: number; rough: number }) {
    if (!this.ctx || !this.tire) return;
    const t = this.ctx.currentTime, T = this.tire;
    const v = Math.min(1, p.speed / 22);
    const set = (k: any, g: number) => k.g.gain.setTargetAtTime(g, t, 0.08);
    const asph = !p.offroad && p.surf === 0 ? 1 : 0;
    const grav = !p.offroad && p.surf === 1 ? 1 : 0;
    const mud = !p.offroad && p.surf === 2 ? 1 : 0;
    set(T.asphalt, asph * v * (p.wet ? 0.04 : 0.1));
    set(T.wet, asph * v * (p.wet ? 0.12 : 0));
    set(T.gravel, (grav + (p.offroad ? 0.5 : 0)) * v * 0.28);
    set(T.mud, (mud + (p.wet && grav ? 0.5 : 0)) * v * 0.55);
    set(T.grass, (p.offroad ? 1 : 0) * v * 0.25);
    T.asphalt.fl.frequency.setTargetAtTime(700 + v * 1200, t, 0.1);
    this.skid.sg.gain.setTargetAtTime(Math.min(0.12, Math.max(0, p.slip - 2.5) * 0.02) * (p.speed > 3 ? 1 : 0), t, 0.05);
    this.skid.sk.frequency.setTargetAtTime(500 + p.slip * 30, t, 0.1);
  }
  ropeTension(a: number) { if (this.ctx && this.rope) { this.rope.rg.gain.setTargetAtTime(a * 0.08, this.ctx.currentTime, 0.1); this.rope.ro.frequency.setTargetAtTime(70 + a * 60, this.ctx.currentTime, 0.2); } }

  // ---------------------------------------------------------------- ortam
  private buildAmbience() {
    const ctx = this.ctx!;
    const mk = (buf: AudioBuffer, type: BiquadFilterType, f: number, q = 0.7) => {
      const s = this.loop(buf), fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.sfxBus); return { g, fl };
    };
    const sea = mk(this.brown, 'lowpass', 500);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.25;
    lfo.connect(lg); lg.connect(sea.g.gain); lfo.start();
    const wind = mk(this.white, 'bandpass', 420, 0.5);
    const rain = mk(this.white, 'highpass', 1500, 0.4);
    this.amb = { sea, wind, rain };
  }
  setAmbience(sea: number, wind: number, rain: number) {
    if (!this.ctx || !this.amb) return;
    const t = this.ctx.currentTime;
    this.amb.sea.g.gain.setTargetAtTime(sea * 0.5, t, 0.5);
    this.amb.wind.g.gain.setTargetAtTime(wind * 0.08, t, 0.5);
    this.amb.rain.g.gain.setTargetAtTime(rain * 0.1, t, 0.5);
  }

  // ---------------------------------------------------------------- yardımcılar
  private panner(pos: Pos) {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 10; p.rolloffFactor = 1.1; p.maxDistance = 400;
    this.setPannerPos(p, pos);
    p.connect(this.sfxBus);
    return p;
  }
  private setPannerPos(p: PannerNode, pos: Pos) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else (p as any).setPosition(pos.x, pos.y, pos.z);
  }
  setListener(pos: Pos, fwd: Pos) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { (l as any).setPosition(pos.x, pos.y, pos.z); (l as any).setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  private nb(dest: AudioNode, t: number, dur: number, o: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; g: number; buf?: AudioBuffer; atk?: number }) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = o.buf || this.white; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.Q.value = o.q ?? 1;
    fl.frequency.setValueAtTime(o.f0, t); if (o.f1) fl.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = ctx.createGain(); const a = o.atk ?? 0.003;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.g, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  private tn(dest: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, g0: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- tek seferlik efektler
  sfx(name: string, vol = 1, pos?: Pos) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    let dest: AudioNode = this.sfxBus;
    let pn: PannerNode | null = null;
    if (pos) { pn = this.panner(pos); dest = pn; }
    const g = ctx.createGain(); g.gain.value = vol; g.connect(dest);
    const echo = (a: number) => { const s = ctx.createGain(); s.gain.value = a; g.connect(s); s.connect(this.echoSend); };
    const nb = (dur: number, o: any) => this.nb(g, t, dur, o);
    const tn = (dur: number, type: OscillatorType, f0: number, f1: number, g0: number, at = 0) => this.tn(g, t + at, dur, type, f0, f1, g0);
    switch (name) {
      case 'thud': nb(0.35, { type: 'lowpass', f0: 500, f1: 80, g: 1.2, buf: this.brown, q: 0.7 }); tn(0.25, 'sine', 90, 35, 1.0); nb(0.25, { f0: 3000, f1: 1500, g: 0.25, q: 2 }); break;
      case 'rattle': for (let i = 0; i < 6; i++) nb(0.06, { f0: 1800 + Math.random() * 2500, g: 0.25, q: 5, atk: 0.001 }), void 0; for (let i = 0; i < 5; i++) this.nb(g, t + i * 0.045 + Math.random() * 0.02, 0.05, { f0: 1500 + Math.random() * 3000, g: 0.3, q: 6, atk: 0.001 }); break;
      case 'crate': nb(0.18, { f0: 700, f1: 300, g: 0.8, q: 1.5 }); tn(0.12, 'triangle', 220, 100, 0.5); this.nb(g, t + 0.07, 0.12, { f0: 1500, g: 0.4, q: 3 }); break;
      case 'glass': for (let i = 0; i < 9; i++) this.nb(g, t + i * 0.03 + Math.random() * 0.03, 0.12, { type: 'highpass', f0: 3500 + Math.random() * 3000, g: 0.35, q: 8, atk: 0.001 }); break;
      case 'sling': nb(0.35, { f0: 600, f1: 2500, g: 0.35, q: 2, atk: 0.12 }); break;
      case 'stone': nb(0.1, { f0: 1200, g: 0.7, q: 3 }); tn(0.1, 'triangle', 500, 200, 0.4); break;
      case 'metalhit': nb(0.2, { f0: 2200, f1: 900, g: 0.6, q: 8 }); tn(0.25, 'square', 900, 500, 0.15); nb(0.12, { f0: 300, g: 0.7, buf: this.brown, type: 'lowpass' }); break;
      case 'shot0': nb(0.28, { type: 'lowpass', f0: 3500, f1: 400, g: 1.4, q: 0.7 }); tn(0.2, 'sine', 160, 40, 1.1); echo(0.8); break;
      case 'shot1': nb(0.45, { type: 'lowpass', f0: 4200, f1: 300, g: 1.8, q: 0.7 }); tn(0.3, 'sine', 120, 30, 1.4); this.nb(g, t + 0.01, 0.3, { f0: 900, f1: 200, g: 0.5 }); echo(1); break;
      case 'shot2': nb(0.18, { type: 'lowpass', f0: 4000, f1: 500, g: 1.2 }); tn(0.12, 'sine', 200, 50, 0.9); echo(0.6); break;
      case 'shot3': nb(0.09, { type: 'lowpass', f0: 5000, f1: 700, g: 1.0 }); tn(0.07, 'sine', 240, 80, 0.6); echo(0.4); break;
      case 'shot4': nb(0.16, { type: 'lowpass', f0: 3000, f1: 300, g: 1.5 }); tn(0.14, 'sine', 100, 30, 1.2); tn(0.1, 'sawtooth', 180, 60, 0.2); echo(0.7); break;
      case 'enemyshot': nb(0.15, { type: 'lowpass', f0: 3800, f1: 600, g: 0.9 }); tn(0.1, 'sine', 190, 60, 0.6); echo(0.5); break;
      case 'reload': tn(0.04, 'square', 1800, 900, 0.25); tn(0.05, 'square', 1200, 600, 0.25, 0.28); tn(0.07, 'square', 700, 300, 0.3, 0.5); nb(0.06, { f0: 2500, g: 0.3, q: 5 }); break;
      case 'empty': tn(0.05, 'square', 1500, 800, 0.2); break;
      case 'hit': tn(0.06, 'sine', 1900, 1300, 0.4); break;
      case 'kill': tn(0.12, 'sine', 900, 1800, 0.35); tn(0.18, 'sine', 1350, 2400, 0.3, 0.07); break;
      case 'hook': nb(0.3, { f0: 800, f1: 2800, g: 0.5, q: 3 }); tn(0.3, 'sawtooth', 300, 800, 0.1); break;
      case 'hookhit': nb(0.12, { f0: 1000, g: 0.9, q: 6 }); tn(0.15, 'square', 200, 100, 0.4); tn(0.3, 'sawtooth', 100, 60, 0.2); break;
      case 'snap': nb(0.12, { type: 'highpass', f0: 2000, g: 1, q: 1, atk: 0.001 }); tn(0.25, 'sine', 800, 120, 0.5); break;
      case 'explode': nb(1.4, { type: 'lowpass', f0: 2500, f1: 60, g: 2.2, buf: this.brown, q: 0.7 }); nb(0.6, { type: 'lowpass', f0: 4000, f1: 200, g: 1.2 }); tn(0.9, 'sine', 80, 22, 1.6); echo(1); break;
      case 'smallboom': nb(0.6, { type: 'lowpass', f0: 2200, f1: 100, g: 1.4, buf: this.brown }); tn(0.4, 'sine', 90, 30, 1); echo(0.6); break;
      case 'crash': nb(0.5, { type: 'lowpass', f0: 3000, f1: 200, g: 1.2, buf: this.brown }); for (let i = 0; i < 5; i++) this.nb(g, t + i * 0.05, 0.1, { f0: 800 + Math.random() * 2000, g: 0.5, q: 4 }); tn(0.4, 'sine', 100, 30, 0.9); break;
      case 'pickup': tn(0.12, 'sine', 880, 1320, 0.35); tn(0.2, 'sine', 1320, 1760, 0.3, 0.08); break;
      case 'fuel': nb(0.35, { f0: 500, f1: 900, g: 0.4, q: 2 }); tn(0.3, 'sine', 400, 800, 0.2); break;
      case 'coin': tn(0.1, 'square', 1568, 1568, 0.12); tn(0.25, 'square', 2093, 2093, 0.12, 0.08); break;
      case 'click': tn(0.05, 'square', 900, 500, 0.15); break;
      case 'buy': tn(0.1, 'square', 523, 523, 0.15); tn(0.1, 'square', 659, 659, 0.15, 0.09); tn(0.25, 'square', 784, 784, 0.15, 0.18); break;
      case 'deny': tn(0.18, 'sawtooth', 200, 120, 0.2); break;
      case 'repair': for (let i = 0; i < 5; i++) { this.tn(g, t + i * 0.09, 0.05, 'square', 1400, 900, 0.14); this.nb(g, t + i * 0.09, 0.05, { f0: 3000, g: 0.2, q: 6 }); } break;
      case 'gear': nb(0.12, { type: 'lowpass', f0: 600, f1: 150, g: 0.9, buf: this.brown }); this.nb(g, t + 0.04, 0.05, { f0: 2200, g: 0.35, q: 6 }); break;
      case 'horn': { const o = ctx.createOscillator(), o2 = ctx.createOscillator(); o.type = o2.type = 'sawtooth'; o.frequency.value = 330; o2.frequency.value = 415; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(0.3, t + 0.03); gg.gain.setValueAtTime(0.3, t + 0.4); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55); o.connect(lp); o2.connect(lp); lp.connect(gg); gg.connect(g); o.start(t); o2.start(t); o.stop(t + 0.6); o2.stop(t + 0.6); break; }
      case 'warn': for (let i = 0; i < 4; i++) { this.tn(g, t + i * 0.35, 0.3, 'sawtooth', 620, 620, 0.2); this.tn(g, t + i * 0.35 + 0.17, 0.17, 'sawtooth', 840, 840, 0.2); } break;
      case 'mine': tn(0.08, 'square', 600, 300, 0.2); nb(0.08, { f0: 1500, g: 0.3, q: 3 }); break;
      case 'nitro': nb(0.9, { f0: 400, f1: 2500, g: 0.7, q: 0.8, atk: 0.1 }); tn(0.7, 'sawtooth', 120, 260, 0.15); break;
      case 'thunder': nb(3, { type: 'lowpass', f0: 600, f1: 60, g: 2.2, buf: this.brown, atk: 0.4 }); echo(0.5); break;
      case 'barricade': nb(0.4, { f0: 500, f1: 200, g: 1, q: 1.2 }); tn(0.3, 'triangle', 150, 60, 0.7); this.nb(g, t + 0.1, 0.25, { f0: 1500, g: 0.5, q: 2 }); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tn(g, t + i * 0.13, 0.5, 'triangle', f, f, 0.25)); break;
      case 'fail': [392, 330, 262, 196].forEach((f, i) => this.tn(g, t + i * 0.22, 0.6, 'sawtooth', f, f * 0.98, 0.14)); break;
      case 'engstart': nb(1.2, { type: 'lowpass', f0: 300, f1: 200, g: 0.9, buf: this.brown, atk: 0.1 }); for (let i = 0; i < 10; i++) this.tn(g, t + i * 0.1, 0.08, 'sawtooth', 60 + i * 6, 40, 0.3); break;
    }
    if (pn) setTimeout(() => { try { pn!.disconnect(); } catch { /* */ } }, 4000);
    setTimeout(() => { try { g.disconnect(); } catch { /* */ } }, 4500);
  }

  // ---------------------------------------------------------------- düşman motorları (konumsal)
  private buildVoices() {
    const ctx = this.ctx!;
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 50;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 12; p.rolloffFactor = 1.3; p.maxDistance = 600;
      const tm = ctx.createOscillator(); tm.frequency.value = 22; const tg = ctx.createGain(); tg.gain.value = 0.3; tm.connect(tg); tg.connect(g.gain);
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(p); p.connect(this.sfxBus);
      o.start(); o2.start(); tm.start();
      this.voices.push({ o, o2, g, p, lp, tm, id: -1 });
    }
  }
  updateEnemies(list: { id: number; x: number; y: number; z: number; speed: number; kind: number }[]) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach((v, i) => {
      const e = list[i];
      if (!e) { v.g.gain.setTargetAtTime(0, t, 0.1); return; }
      this.setPannerPos(v.p, e);
      const car = e.kind === 1 || e.kind === 5;
      const f = (car ? 48 : 85) + Math.min(1, e.speed / 30) * (car ? 55 : 110);
      v.o.frequency.setTargetAtTime(f, t, 0.1); v.o2.frequency.setTargetAtTime(f * 0.5, t, 0.1);
      v.tm.frequency.setTargetAtTime(car ? 14 : 24 + e.speed * 0.5, t, 0.1);
      v.lp.frequency.setTargetAtTime(car ? 500 : 1100, t, 0.1);
      v.g.gain.setTargetAtTime(0.5, t, 0.2);
    });
  }
  silenceEnemies() { this.updateEnemies([]); }

  // ---------------------------------------------------------------- müzik
  setMood(m: Mood) { this.mood = m; this.chordSet = m === 'relief' ? 'major' : 'minor'; this.bpm = m === 'tension' ? 138 : m === 'garage' ? 70 : m === 'relief' ? 84 : 92; this.applyMood(); }
  private startMusic() {
    const ctx = this.ctx!;
    const mkG = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.musicBus); return g; };
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(this.musicBus);
    const padG = mkG(), pluckG = mkG(), bassG = mkG(), kickG = mkG(), hatG = mkG(), droneG = mkG();
    // drone
    const d1 = ctx.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = 55;
    const d2 = ctx.createOscillator(); d2.type = 'sawtooth'; d2.frequency.value = 58.3;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 220;
    const dlfo = ctx.createOscillator(); dlfo.frequency.value = 0.25; const dlg = ctx.createGain(); dlg.gain.value = 120; dlfo.connect(dlg); dlg.connect(dl.frequency);
    d1.connect(dl); d2.connect(dl); dl.connect(droneG); d1.start(); d2.start(); dlfo.start();
    this.mus = { padG, pluckG, bassG, kickG, hatG, droneG, lp };
    this.nextStep = ctx.currentTime + 0.1; this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 90);
    this.applyMood();
  }
  private applyMood() {
    if (!this.ctx || !this.mus) return;
    const t = this.ctx.currentTime, m = this.mus;
    const S: Record<Mood, number[]> = { // pad, pluck, bass, kick, hat, drone
      off: [0, 0, 0, 0, 0, 0], garage: [0.5, 0.35, 0, 0, 0, 0], drive: [0.4, 0.4, 0.25, 0.12, 0.05, 0], tension: [0.3, 0.1, 0.5, 0.7, 0.25, 0.22], relief: [0.55, 0.45, 0, 0, 0, 0],
    };
    const v = S[this.mood];
    [m.padG, m.pluckG, m.bassG, m.kickG, m.hatG, m.droneG].forEach((g: GainNode, i: number) => g.gain.setTargetAtTime(v[i], t, 0.8));
  }
  private schedule() {
    if (!this.ctx || !this.mus || this.mood === 'off') return;
    const ctx = this.ctx;
    while (this.nextStep < ctx.currentTime + 0.25) {
      this.playStep(this.nextStep, this.step);
      this.nextStep += 60 / this.bpm / 4;
      this.step++;
    }
  }
  private playStep(t: number, step: number) {
    const m = this.mus, ctx = this.ctx!;
    const minor = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]];
    const major = [[48, 55, 60, 64, 67], [43, 50, 55, 59, 62], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60]];
    const chords = this.chordSet === 'major' ? major : minor;
    const bar = Math.floor(step / 16) % 4, s16 = step % 16;
    const ch = chords[bar];
    const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    const env = (g: GainNode, a: number, dur: number, peak: number) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
    if (s16 === 0) { // pad
      const dur = 60 / this.bpm * 4;
      [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12].forEach((n, i) => {
        const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = hz(n); o.detune.value = (i - 1.5) * 6;
        const g = ctx.createGain(); env(g, dur * 0.4, dur * 1.1, 0.16);
        o.connect(g); g.connect(m.padG); o.start(t); o.stop(t + dur * 1.2);
      });
    }
    if (s16 % 2 === 0) { // pluck arpeggio
      const pat = [0, 2, 3, 2, 4, 3, 2, 1];
      const n = ch[pat[(s16 / 2) % 8] % ch.length] + 12;
      if (this.mood !== 'tension' || s16 % 4 === 0) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(n + (this.mood === 'tension' ? 0 : 12));
        const g = ctx.createGain(); env(g, 0.005, 0.5, 0.22);
        o.connect(g); g.connect(m.pluckG); o.start(t); o.stop(t + 0.6);
      }
    }
    if (this.mood === 'tension' || this.mood === 'drive') {
      if (s16 % 2 === 0 && (this.mood === 'tension' || s16 % 8 === 0)) { // bas
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(ch[0] + (this.mood === 'tension' && s16 % 8 === 6 ? 1 : 0));
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
        const g = ctx.createGain(); env(g, 0.005, 0.22, 0.4);
        o.connect(lp); lp.connect(g); g.connect(m.bassG); o.start(t); o.stop(t + 0.3);
      }
      if (s16 % 4 === 0 || (this.mood === 'drive' && s16 % 8 === 0)) { // davul
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
        const g = ctx.createGain(); env(g, 0.003, 0.22, 0.9);
        o.connect(g); g.connect(m.kickG); o.start(t); o.stop(t + 0.3);
      }
      if (this.mood === 'tension') {
        if (s16 === 4 || s16 === 12) { // trampa
          const s = ctx.createBufferSource(); s.buffer = this.white; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; const g = ctx.createGain(); env(g, 0.002, 0.15, 0.5);
          s.connect(f); f.connect(g); g.connect(m.hatG); s.start(t, Math.random()); s.stop(t + 0.2);
        }
        const s = ctx.createBufferSource(); s.buffer = this.white; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); env(g, 0.001, 0.04, 0.25);
        s.connect(f); f.connect(g); g.connect(m.hatG); s.start(t, Math.random()); s.stop(t + 0.06);
      }
    }
  }
}

export const audio = new AudioEngine();
