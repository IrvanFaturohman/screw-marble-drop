import { TUNING, type TuningType } from '../config/GameConfig';

type Row = { key: keyof TuningType; label: string; min: number; max: number; step: number };
type Section = { title: string; rows: Row[] };

/**
 * Dev-only live tuning panel (press D). Deliberately DOM, not in-canvas: it must
 * never be reachable on the mobile build's normal input path, and gameplay code
 * reads TUNING every frame so every slider is live.
 */
const SECTIONS: Section[] = [
  { title: 'SCREWS + PLATES', rows: [
    { key: 'DEFAULT_BATCH_SIZE', label: 'batch size', min: 3, max: 16, step: 1 },
    { key: 'BATCH_RELEASE_INTERVAL', label: 'release gap ms', min: 4, max: 160, step: 2 },
    { key: 'BATCH_RELEASE_SPREAD', label: 'release spread', min: 0, max: 14, step: 0.2 },
    { key: 'UNSCREW_DURATION', label: 'unscrew ms', min: 120, max: 1200, step: 20 },
    { key: 'UNSCREW_TURNS', label: 'unscrew turns', min: 0.5, max: 8, step: 0.1 },
    { key: 'PLATE_PARTIAL_MS', label: 'plate swing ms', min: 120, max: 1400, step: 20 },
    { key: 'PLATE_RELEASE_MS', label: 'plate leave ms', min: 150, max: 1600, step: 20 },
    { key: 'PLATE_FALL_GRAVITY', label: 'plate gravity', min: -160, max: -8, step: 2 },
  ] },
  { title: 'MARBLE PHYSICS', rows: [
    { key: 'MARBLE_GRAVITY', label: 'gravity', min: -180, max: -10, step: 2 },
    { key: 'MARBLE_RESTITUTION', label: 'restitution', min: 0, max: 0.95, step: 0.02 },
    { key: 'MARBLE_FRICTION', label: 'friction', min: 0, max: 1, step: 0.02 },
    { key: 'MARBLE_LINEAR_DAMPING', label: 'lin damping', min: 0, max: 1.5, step: 0.02 },
    { key: 'MARBLE_MAX_SPEED', label: 'max speed', min: 20, max: 200, step: 2 },
    { key: 'FUNNEL_ASSIST_STRENGTH', label: 'funnel assist', min: 0, max: 160, step: 2 },
    { key: 'SLAB_ASSIST_STRENGTH', label: 'slab assist', min: 0, max: 120, step: 2 },
  ] },
  { title: 'CONVEYOR', rows: [
    { key: 'CONVEYOR_CAPACITY', label: 'capacity', min: 8, max: 40, step: 1 },
    { key: 'CONVEYOR_SPEED', label: 'speed', min: 3, max: 45, step: 0.5 },
    { key: 'CONVEYOR_RUSH_MULT', label: 'rush mult', min: 1, max: 5, step: 0.1 },
    { key: 'CONVEYOR_MIN_GAP', label: 'min gap', min: 1.6, max: 6, step: 0.1 },
    { key: 'CONVEYOR_INTAKE_MS', label: 'intake ms', min: 60, max: 700, step: 10 },
  ] },
  { title: 'SORTING', rows: [
    { key: 'AUTO_SORT_INTERVAL', label: 'sort interval', min: 25, max: 500, step: 5 },
    { key: 'EXIT_GATE_HALF', label: 'gate half', min: 2, max: 20, step: 0.5 },
    { key: 'SORT_FLIGHT_DURATION', label: 'sort flight ms', min: 80, max: 800, step: 10 },
    { key: 'RECEIVER_CAPACITY', label: 'sockets', min: 1, max: 6, step: 1 },
    { key: 'RECEIVER_COMPLETE_DELAY', label: 'complete ms', min: 0, max: 700, step: 10 },
    { key: 'RECEIVER_SWAP_DURATION', label: 'swap ms', min: 60, max: 900, step: 10 },
  ] },
  { title: 'FEEL', rows: [
    { key: 'GAME_SPEED', label: 'game speed', min: 0.25, max: 4, step: 0.05 },
    { key: 'cameraShakeIntensity', label: 'shake', min: 0, max: 3, step: 0.05 },
    { key: 'particleMultiplier', label: 'particles', min: 0, max: 3, step: 0.05 },
    { key: 'audioVolume', label: 'volume', min: 0, max: 1, step: 0.02 },
  ] },
];

export interface DebugHooks {
  restart(): void;
  releaseBatch(): void;
  clearConveyor(): void;
  fillConveyor(): void;
  completeExposed(): void;
  toggleDebug(): void;
  stats(): string;
}

export class DebugPanel {
  private el: HTMLElement | null = null;
  private hooks: DebugHooks | null = null;
  private statsEl: HTMLElement | null = null;
  private outputs: { row: Row; out: HTMLOutputElement; input: HTMLInputElement }[] = [];
  visible = false;

  attach(hooks: DebugHooks) {
    this.hooks = hooks;
    if (!this.el) this.build();
  }

  toggle() {
    if (!this.el) return;
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
    if (this.visible) this.sync();
  }

  /** Re-read TUNING into the widgets (after a hotkey changed it elsewhere). */
  sync() {
    for (const o of this.outputs) {
      const v = TUNING[o.row.key] as unknown as number;
      o.input.value = String(v);
      o.out.textContent = fmt(v);
    }
  }

  tick() { if (this.visible && this.statsEl && this.hooks) this.statsEl.textContent = this.hooks.stats(); }

  private build() {
    const el = document.getElementById('debug-panel');
    if (!el) return;
    this.el = el;
    el.innerHTML = '';

    const head = div('dbg-head');
    head.innerHTML = '<b>DEBUG</b>';
    this.statsEl = div('dbg-stats');
    head.appendChild(this.statsEl);
    const close = document.createElement('button');
    close.textContent = '×';
    close.onclick = () => this.toggle();
    head.appendChild(close);
    el.appendChild(head);

    const body = div('dbg-body');
    for (const sec of SECTIONS) {
      const t = div('dbg-sec'); t.textContent = sec.title; body.appendChild(t);
      for (const row of sec.rows) {
        const r = div('dbg-row');
        const label = document.createElement('span'); label.textContent = row.label;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(row.min); input.max = String(row.max); input.step = String(row.step);
        input.value = String(TUNING[row.key] as unknown as number);
        const out = document.createElement('output');
        out.textContent = fmt(TUNING[row.key] as unknown as number);
        input.oninput = () => {
          const v = parseFloat(input.value);
          (TUNING as unknown as Record<string, number>)[row.key as string] = v;
          out.textContent = fmt(v);
        };
        r.append(label, input, out);
        body.appendChild(r);
        this.outputs.push({ row, out, input });
      }
    }
    el.appendChild(body);

    const foot = div('dbg-foot');
    const btn = (text: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = text; b.onclick = fn; foot.appendChild(b);
    };
    btn('R restart', () => this.hooks?.restart());
    btn('B batch', () => this.hooks?.releaseBatch());
    btn('C clear', () => this.hooks?.clearConveyor());
    btn('F fill', () => this.hooks?.fillConveyor());
    btn('N next recv', () => this.hooks?.completeExposed());
    btn('D debug', () => this.hooks?.toggleDebug());
    btn('juice', () => { TUNING.juiceEnabled = !TUNING.juiceEnabled; });
    el.appendChild(foot);
  }
}

const div = (cls: string) => { const d = document.createElement('div'); d.className = cls; return d; };
const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2));
