import { TUNING } from '../config/GameConfig';

/** Thin navigator.vibrate wrapper with a toggle + rate limit. No-op when unsupported. */
export class HapticsSystem {
  readonly supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  private last = 0;

  constructor() {
    try { const v = localStorage.getItem('smd_haptics'); if (v !== null) TUNING.hapticEnabled = v === '1'; } catch { /* ignore */ }
  }

  get enabled() { return TUNING.hapticEnabled; }
  toggle() {
    TUNING.hapticEnabled = !TUNING.hapticEnabled;
    try { localStorage.setItem('smd_haptics', TUNING.hapticEnabled ? '1' : '0'); } catch { /* ignore */ }
    if (TUNING.hapticEnabled) this.pulse(12, 0);
    return TUNING.hapticEnabled;
  }

  pulse(pattern: number | number[], minGap = 60) {
    if (!this.supported || !TUNING.hapticEnabled) return;
    const now = performance.now();
    if (now - this.last < minGap) return;
    this.last = now;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  twist() { this.pulse(5, 40); }
  pop() { this.pulse(8, 40); }
  thud(k: number) { this.pulse(Math.round(8 + k * 22), 60); }
  snap(i: number) { this.pulse(5 + i * 3, 0); }
  complete() { this.pulse([12, 26, 18], 0); }
  blocked() { this.pulse([5, 40, 5], 0); }
  warn() { this.pulse(16, 400); }
  fail() { this.pulse([30, 60, 30, 60, 90], 0); }
  win() { this.pulse([16, 40, 16, 40, 16, 40, 70], 0); }
}
