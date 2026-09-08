import { TUNING } from '../config/GameConfig';

/**
 * Procedural WebAudio SFX — no asset files. Everything is synthesised, so pitch
 * can track game state.
 *
 * Musical rule: a receiver's three sockets climb a major triad, so a half-full
 * box sounds unresolved and 3/3 is the resolution. The player hears the box
 * fill before reading the number. The belt hum rises with pressure, which makes
 * a clogged conveyor audible before it is countable.
 */

const ROOT = 523.25; // C5
const semi = (n: number) => ROOT * Math.pow(2, n / 12);
const SOCKET = [0, 4, 7];

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noiseBuf: AudioBuffer | null = null;
  private humOsc: OscillatorNode | null = null;
  private humOsc2: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private humFilter: BiquadFilterNode | null = null;
  private lastClack = 0;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('smd_muted') === '1'; } catch { /* ignore */ }
  }

  /** Must run inside a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    this.ctx = new AC();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.12;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : TUNING.audioVolume;
    this.master.connect(this.comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startHum();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem('smd_muted', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : TUNING.audioVolume, this.ctx.currentTime, 0.02);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  refreshVolume() { if (this.ctx && !this.muted) this.master.gain.value = TUNING.audioVolume; }

  // ------------------------------------------------------------ primitives --
  private tone(o: { f: number; f2?: number; type?: OscillatorType; dur: number; gain: number; attack?: number; delay?: number; filter?: number; q?: number }) {
    if (!this.ready) return;
    const c = this.ctx!;
    const t0 = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter; f.Q.value = o.q ?? 0.7;
      osc.connect(f); node = f;
    }
    node.connect(g).connect(this.master);
    osc.start(t0); osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: { dur: number; gain: number; filter?: number; type?: BiquadFilterType; q?: number; delay?: number; f2?: number }) {
    if (!this.ready || !this.noiseBuf) return;
    const c = this.ctx!;
    const t0 = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.filter ?? 2000, t0); f.Q.value = o.q ?? 1;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t0 + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + o.dur + 0.02);
  }

  private startHum() {
    const c = this.ctx!;
    this.humOsc = c.createOscillator(); this.humOsc.type = 'sawtooth'; this.humOsc.frequency.value = 46;
    this.humOsc2 = c.createOscillator(); this.humOsc2.type = 'sine'; this.humOsc2.frequency.value = 93;
    this.humFilter = c.createBiquadFilter(); this.humFilter.type = 'lowpass'; this.humFilter.frequency.value = 170; this.humFilter.Q.value = 2;
    this.humGain = c.createGain(); this.humGain.gain.value = 0;
    this.humOsc.connect(this.humFilter); this.humOsc2.connect(this.humFilter);
    this.humFilter.connect(this.humGain).connect(this.master);
    this.humOsc.start(); this.humOsc2.start();
  }

  /** Belt ambience. `load` 0..1 is conveyor pressure — it audibly tightens. */
  setHum(load: number) {
    if (!this.ready || !this.humGain || !this.humFilter) return;
    const t = this.ctx!.currentTime;
    this.humGain.gain.setTargetAtTime(0.020 + load * 0.048, t, 0.12);
    this.humFilter.frequency.setTargetAtTime(150 + load * 220, t, 0.12);
  }

  // ----------------------------------------------------------------- events --
  /** Ratchet while the head backs out of the thread. */
  twist() {
    for (let i = 0; i < 4; i++) {
      this.noise({ dur: 0.035, gain: 0.09, filter: 2300 + i * 320, q: 5, delay: i * 0.055 });
    }
  }
  /** The head pops free. */
  pop() {
    this.tone({ f: 720, f2: 300, type: 'triangle', dur: 0.10, gain: 0.17 });
    this.noise({ dur: 0.05, gain: 0.09, filter: 1700, q: 1.2 });
  }
  /** Marble clatter — glass-on-plastic, not metal. `k` 0..1 = impact strength. */
  tick(k: number) {
    const now = performance.now();
    if (now - this.lastClack < 22) return;
    this.lastClack = now;
    this.tone({ f: 620 + k * 520, f2: 300, type: 'sine', dur: 0.05, gain: 0.045 + k * 0.07 });
    this.noise({ dur: 0.03, gain: 0.025 + k * 0.04, filter: 3400, q: 3 });
  }
  /** Plate landing on the bench lip. */
  thud(k: number) {
    this.tone({ f: 150 - k * 30, f2: 58, type: 'sine', dur: 0.20 + k * 0.10, gain: 0.16 + k * 0.14, filter: 420 });
    this.noise({ dur: 0.12, gain: 0.07 + k * 0.06, filter: 700, f2: 220, q: 0.9 });
  }
  /** The gate tipping open. */
  detach() {
    this.tone({ f: 300, f2: 150, type: 'sawtooth', dur: 0.10, gain: 0.07, filter: 900 });
    this.noise({ dur: 0.09, gain: 0.05, filter: 1500, f2: 500 });
  }
  /** A marble dropping onto the belt. */
  land() {
    this.tone({ f: 260, f2: 170, type: 'sine', dur: 0.07, gain: 0.09, filter: 900 });
    this.noise({ dur: 0.05, gain: 0.05, filter: 1400, q: 1.3 });
  }
  /** A screw snapping into socket `i` of a receiver. Climbs the triad. */
  snap(i: number) {
    const n = SOCKET[Math.min(i, 2)];
    this.tone({ f: semi(n), type: 'triangle', dur: 0.13, gain: 0.15 });
    this.tone({ f: semi(n + 12), type: 'sine', dur: 0.09, gain: 0.06, delay: 0.008 });
    this.noise({ dur: 0.04, gain: 0.05, filter: 3400, q: 3 });
  }
  /** 3/3 — the resolution the three snaps were building toward. */
  complete() {
    [0, 4, 7, 12].forEach((n, i) => this.tone({ f: semi(n), type: 'triangle', dur: 0.28 - i * 0.03, gain: 0.13, delay: i * 0.045 }));
    this.noise({ dur: 0.18, gain: 0.05, filter: 5200, f2: 1800, q: 1.2, delay: 0.02 });
  }
  /** A fresh receiver arriving in the active slot. */
  reveal() {
    this.tone({ f: semi(-5), f2: semi(7), type: 'sine', dur: 0.16, gain: 0.10 });
    this.noise({ dur: 0.10, gain: 0.04, filter: 900, f2: 2600 });
  }
  /** Tapped a buried screw. Deliberately dull, not punishing. */
  blocked() {
    this.tone({ f: 165, f2: 130, type: 'square', dur: 0.07, gain: 0.05, filter: 500 });
  }
  /** Belt crossing into the danger band. */
  warn() {
    this.tone({ f: semi(-2), type: 'square', dur: 0.09, gain: 0.06, filter: 1300 });
    this.tone({ f: semi(-2), type: 'square', dur: 0.09, gain: 0.06, filter: 1300, delay: 0.13 });
  }
  fail() {
    [0, -3, -7, -12].forEach((n, i) => this.tone({ f: semi(n), type: 'sawtooth', dur: 0.42, gain: 0.11, filter: 1100, delay: i * 0.08 }));
    this.noise({ dur: 0.5, gain: 0.07, filter: 700, f2: 140 });
  }
  win() {
    [0, 4, 7, 12, 16, 19].forEach((n, i) => this.tone({ f: semi(n), type: 'triangle', dur: 0.36, gain: 0.13, delay: i * 0.075 }));
    this.noise({ dur: 0.5, gain: 0.05, filter: 2000, f2: 6000, delay: 0.1 });
  }
}
