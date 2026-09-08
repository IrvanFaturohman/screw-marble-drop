/**
 * THE SAND FLOW NETWORK — the authoritative layer.
 *
 * Sand is VOLUME, never objects. Nothing here knows about particles, meshes or
 * Three.js; the view reads these numbers and draws grains, and losing a grain
 * can never lose a unit. That separation is what lets `npm run validate` play a
 * whole level in Node and prove it drains.
 *
 * The material moves through four stages, and it must pass through all of them —
 * a receiver's percentage may never move at the instant a screw is pulled:
 *
 *     RESERVOIR  ──SOURCE_FLOW_RATE──▶  PILE      (above its own narrow outlet)
 *     PILE       ──MAIN_THROAT_RATE──▶  FUNNEL    (the shared V above the neck)
 *     FUNNEL     ──BUFFER_INPUT_RATE─▶  CHANNEL   (the oval, per-colour segments)
 *     CHANNEL    ──RECEIVER_DRAIN────▶  RECEIVER  (0..100, which IS the percent)
 *
 * The pile exists because SOURCE_FLOW_RATE is much larger than the rate the
 * outlet under it can pass. That inequality is the entire accumulation feature:
 * more arrives than can leave, so it stacks. Set the two equal and the sand
 * drains like water and the revision is pointless.
 */

import { TUNING, type MarbleColor } from '../config/GameConfig';
import { LoopPath } from './Geometry';
import { LAYOUT } from '../config/GameConfig';

export type SandColor = MarbleColor;

/** Where a reservoir's material currently is. Surfaced in the debug overlay. */
export type ReservoirState = 'sealed' | 'opening' | 'flowing' | 'draining' | 'empty';

export interface Reservoir {
  id: string;
  color: SandColor;
  /** Authored volume. Never changes — the fraction left drives the visible fill. */
  total: number;
  /** Still inside the structure. */
  remaining: number;
  /** Waiting on top of this reservoir's outlet. THE PILE. */
  pile: number;
  state: ReservoirState;
  /** ms left of the gate animation before material actually starts moving. */
  openTimer: number;
  /** World position of the outlet, for the mound and the stream. */
  outX: number;
  outY: number;
  outZ: number;
  /** Set once the source is dry, so the mound keeps draining for a beat. */
  settleTimer: number;
}

/** A run of one colour in the channel. Keeping colours as runs is what makes
 *  the oval read as "red section, then blue section" instead of a mud gradient. */
export interface Segment {
  id: number;
  color: SandColor;
  volume: number;
  /** Arc position of the segment's leading edge. */
  s: number;
  laps: number;
}

export interface Receiver {
  id: string;
  color: SandColor;
  /** 0..RECEIVER_CAPACITY. With capacity 100 this is literally the percentage. */
  fill: number;
  column: number;
  index: number;
  state: 'queued' | 'active' | 'completing' | 'done';
  /** Sand sitting in this receiver's mouth, so the inlet piles a little too. */
  inlet: number;
  /** Drives the completion pulse. */
  pulse: number;
}

export interface SandEvents {
  onGateOpen?: (r: Reservoir) => void;
  onReservoirEmpty?: (r: Reservoir) => void;
  onReceiverProgress?: (r: Receiver, delta: number) => void;
  onReceiverComplete?: (r: Receiver) => void;
  onReceiverExposed?: (r: Receiver) => void;
  onOverflow?: (color: SandColor) => void;
  /** Volume actually crossing a throat this tick, so the view can emit grains. */
  onThroatFlow?: (r: Reservoir, volume: number) => void;
  onNeckFlow?: (color: SandColor, volume: number) => void;
  onReceiverFlow?: (r: Receiver, volume: number) => void;
}

const ALL: SandColor[] = ['red', 'blue', 'yellow', 'green'];

export class SandModel {
  readonly path: LoopPath;
  readonly reservoirs: Reservoir[] = [];
  readonly byId = new Map<string, Reservoir>();
  readonly columns: Receiver[][] = [];
  /** The oval's contents, ordered around the ring. */
  readonly segments: Segment[] = [];

  /** The shared V above the buffer neck. Holds colour identity in order. */
  readonly funnel: { color: SandColor; volume: number }[] = [];

  events: SandEvents = {};
  overflowed = false;
  private nextSegId = 1;

  constructor(stacks: SandColor[][]) {
    this.path = new LoopPath(LAYOUT.loopCX, LAYOUT.loopCY, LAYOUT.loopRX, LAYOUT.loopRY);
    stacks.forEach((colors, ci) => {
      this.columns.push(colors.map((color, i) => ({
        id: `r${ci}-${i}`, color, fill: 0, column: ci, index: i, inlet: 0, pulse: 0,
        state: (i === 0 ? 'active' : 'queued') as Receiver['state'],
      })));
    });
  }

  addReservoir(r: Omit<Reservoir, 'remaining' | 'pile' | 'state' | 'openTimer' | 'settleTimer'>) {
    const full: Reservoir = {
      ...r, remaining: r.total, pile: 0, state: 'sealed', openTimer: 0, settleTimer: 0,
    };
    this.reservoirs.push(full);
    this.byId.set(full.id, full);
    return full;
  }

  // ------------------------------------------------------------------ query

  /** Everything the channel is holding, across every colour. */
  get bufferVolume() { return this.segments.reduce((n, s) => n + s.volume, 0); }
  get bufferPercent() { return Math.min(100, (this.bufferVolume / TUNING.BUFFER_CAPACITY) * 100); }
  get bufferFree() { return Math.max(0, TUNING.BUFFER_CAPACITY - this.bufferVolume); }
  get full() { return this.bufferVolume >= TUNING.BUFFER_CAPACITY - 1e-6; }

  bufferByColor(): Record<SandColor, number> {
    const out = { red: 0, blue: 0, yellow: 0, green: 0 } as Record<SandColor, number>;
    for (const s of this.segments) out[s.color] += s.volume;
    return out;
  }

  /** Material still in the structure, above the throats, or in the funnel. */
  get inFlight() {
    return this.reservoirs.reduce((n, r) => n + r.pile, 0)
      + this.funnel.reduce((n, f) => n + f.volume, 0);
  }
  get sourceLeft() { return this.reservoirs.reduce((n, r) => n + r.remaining, 0); }
  /** Nothing anywhere between the structure and the receivers. */
  get idle() { return this.segments.length === 0 && this.inFlight < 1e-6; }

  activeReceivers(): Receiver[] {
    return this.columns.map((c) => c.find((r) => r.state === 'active')).filter((r): r is Receiver => !!r);
  }
  exposedColors(): Set<SandColor> {
    return new Set(this.activeReceivers()
      .filter((r) => r.fill < TUNING.RECEIVER_CAPACITY)
      .map((r) => r.color));
  }
  /** Which receiver takes this colour now. Prefers the fullest, so boxes close
   *  sooner and a stuck colour starts moving earlier. */
  destinationFor(color: SandColor): Receiver | null {
    let best: Receiver | null = null;
    for (const r of this.activeReceivers()) {
      if (r.color !== color || r.fill >= TUNING.RECEIVER_CAPACITY) continue;
      if (!best || r.fill > best.fill) best = r;
    }
    return best;
  }
  get allDone() { return this.columns.every((c) => c.every((r) => r.state === 'done')); }
  get receiversLeft() { return this.columns.flat().filter((r) => r.state !== 'done').length; }
  get receiversTotal() { return this.columns.reduce((n, c) => n + c.length, 0); }

  // ------------------------------------------------------------------- gate

  /** The structure opened this reservoir. Material does not move until the gate
   *  animation finishes — a percentage must never twitch on the tap itself. */
  open(id: string) {
    const r = this.byId.get(id);
    if (!r || r.state !== 'sealed') return;
    r.state = 'opening';
    r.openTimer = TUNING.GATE_OPEN_MS;
    this.events.onGateOpen?.(r);
  }

  // ------------------------------------------------------------- simulation

  update(ms: number) {
    const dt = ms / 1000;
    this.stepReservoirs(ms, dt);
    this.stepNeck(dt);
    this.stepChannel(dt);
    this.stepReceivers(dt);
  }

  /** RESERVOIR -> PILE -> FUNNEL. Where the accumulation actually happens. */
  private stepReservoirs(ms: number, dt: number) {
    for (const r of this.reservoirs) {
      if (r.state === 'sealed' || r.state === 'empty') continue;
      if (r.state === 'opening') {
        r.openTimer -= ms;
        if (r.openTimer > 0) continue;
        r.state = 'flowing';
      }

      // Source pushes hard into its own pile. Nothing throttles this — the
      // throttle is downstream, which is exactly why material collects.
      if (r.remaining > 0) {
        const push = Math.min(r.remaining, TUNING.SOURCE_FLOW_RATE * dt);
        r.remaining -= push;
        r.pile += push;
        if (r.remaining <= 1e-6) {
          r.remaining = 0;
          r.state = 'draining';
          r.settleTimer = TUNING.PILE_SETTLE_MS;
          this.events.onReservoirEmpty?.(r);
        }
      } else if (r.settleTimer > 0) {
        r.settleTimer -= ms;
      }

      // The narrow outlet. This is the rate that makes the mound.
      if (r.pile > 0) {
        const through = Math.min(r.pile, TUNING.MAIN_THROAT_FLOW_RATE * dt);
        r.pile -= through;
        this.pushFunnel(r.color, through);
        this.events.onThroatFlow?.(r, through);
        if (r.pile <= 1e-6) r.pile = 0;
      }

      if (r.remaining === 0 && r.pile === 0 && r.settleTimer <= 0) r.state = 'empty';
    }
  }

  /** Merge into the tail run so the funnel keeps colour order without growing
   *  an unbounded list of tiny slices. */
  private pushFunnel(color: SandColor, volume: number) {
    if (volume <= 0) return;
    const tail = this.funnel[this.funnel.length - 1];
    if (tail && tail.color === color) tail.volume += volume;
    else this.funnel.push({ color, volume });
  }

  /** FUNNEL -> CHANNEL, through the shared neck. A second, smaller pile. */
  private stepNeck(dt: number) {
    let budget = TUNING.BUFFER_INPUT_RATE * dt;
    while (budget > 1e-6 && this.funnel.length) {
      const head = this.funnel[0];
      const free = this.bufferFree;
      if (free <= 1e-6) {
        // The channel is full and material is still arriving. The brief is
        // explicit that this must be allowed to happen and be watched.
        this.overflowed = true;
        this.events.onOverflow?.(head.color);
        return;
      }
      const move = Math.min(head.volume, budget, free);
      head.volume -= move;
      budget -= move;
      this.admit(head.color, move);
      this.events.onNeckFlow?.(head.color, move);
      if (head.volume <= 1e-6) this.funnel.shift();
    }
  }

  /**
   * Material lands on the channel at the inlet.
   *
   * It keeps growing the run currently under the inlet rather than starting a
   * new one every tick. Without that the list grows by 120 segments a second and
   * the renderer, which draws one mesh per run, falls over — a genuine freeze
   * the first time a reservoir opened.
   */
  private inletSeg: Segment | null = null;

  private admit(color: SandColor, volume: number) {
    if (volume <= 0) return;
    const inlet = 0;
    const cur = this.inletSeg;
    if (cur && cur.color === color && this.segments.includes(cur)
        && cur.volume < TUNING.BUFFER_CAPACITY * 0.35) {
      cur.volume += volume;
      return;
    }
    const seg: Segment = { id: this.nextSegId++, color, volume, s: inlet, laps: 0 };
    this.segments.push(seg);
    this.inletSeg = seg;
  }

  /** Everything on the oval advances. A colour with somewhere to go hurries. */
  private stepChannel(dt: number) {
    const exposed = this.exposedColors();
    const L = this.path.length;
    for (const seg of this.segments) {
      const rush = exposed.has(seg.color) ? TUNING.BUFFER_RUSH_MULT : 1;
      seg.s += TUNING.BUFFER_FLOW_SPEED * rush * dt;
      if (seg.s >= L) { seg.s -= L; seg.laps++; }
    }
    this.segments.sort((a, b) => a.s - b.s);
    // Adjacent runs of the same colour are one run. Bounded work, and it keeps
    // the ring readable as "red section, then blue section".
    for (let i = this.segments.length - 1; i > 0; i--) {
      const a = this.segments[i - 1], b = this.segments[i];
      if (a.color !== b.color) continue;
      if (Math.abs(a.s - b.s) > 8) continue;
      a.volume += b.volume;
      if (this.inletSeg === b) this.inletSeg = a;
      this.segments.splice(i, 1);
    }
  }

  /** CHANNEL -> RECEIVER. Peels the matching colour off the ring. */
  private stepReceivers(dt: number) {
    const byColor = new Map<SandColor, Receiver>();
    for (const c of ALL) {
      const r = this.destinationFor(c);
      if (r) byColor.set(c, r);
    }

    for (const [color, rec] of byColor) {
      let budget = TUNING.RECEIVER_DRAIN_RATE * dt;
      // Take from the run closest to the exit first, so the channel visibly
      // empties from one place rather than everywhere at once.
      const runs = this.segments.filter((s) => s.color === color)
        .sort((a, b) => b.s - a.s);
      for (const seg of runs) {
        if (budget <= 1e-6) break;
        const room = TUNING.RECEIVER_CAPACITY - rec.fill - rec.inlet;
        if (room <= 1e-6) break;
        const move = Math.min(seg.volume, budget, room);
        seg.volume -= move;
        budget -= move;
        rec.inlet += move;
        this.events.onReceiverFlow?.(rec, move);
      }
    }
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.segments[i].volume <= 1e-6) this.segments.splice(i, 1);
    }

    // The mouth drains into the body a touch slower than it fills, so a small
    // heap sits in the inlet while a stream is running.
    for (const col of this.columns) {
      for (const rec of col) {
        if (rec.pulse > 0) rec.pulse = Math.max(0, rec.pulse - dt * 2.4);
        if (rec.inlet > 0 && rec.state !== 'done') {
          const move = Math.min(rec.inlet, TUNING.RECEIVER_DRAIN_RATE * 0.85 * dt);
          rec.inlet -= move;
          rec.fill = Math.min(TUNING.RECEIVER_CAPACITY, rec.fill + move);
          this.events.onReceiverProgress?.(rec, move);
        }
        if (rec.state === 'active' && rec.fill >= TUNING.RECEIVER_CAPACITY - 1e-6 && rec.inlet <= 1e-6) {
          rec.fill = TUNING.RECEIVER_CAPACITY;
          rec.state = 'completing';
          rec.pulse = 1;
          this.events.onReceiverComplete?.(rec);
          this.advanceColumn(rec);
        }
      }
    }
  }

  /** A finished receiver slides out and the next one rises. */
  advanceColumn(rec: Receiver) {
    rec.state = 'done';
    const col = this.columns[rec.column];
    const next = col.find((r) => r.state === 'queued');
    if (next) {
      next.state = 'active';
      this.events.onReceiverExposed?.(next);
    }
  }

  // ---------------------------------------------------------------- debug --

  debugFillBuffer(fraction: number) {
    const want = TUNING.BUFFER_CAPACITY * fraction - this.bufferVolume;
    if (want <= 0) return;
    // A colour nobody is waiting for, so the fill actually creates pressure.
    const exposed = this.exposedColors();
    const color = ALL.find((c) => !exposed.has(c)) ?? 'green';
    this.admit(color, want);
  }
  debugClearBuffer() { this.segments.length = 0; this.funnel.length = 0; }
  debugCompleteExposed() {
    for (const r of this.activeReceivers()) {
      r.fill = TUNING.RECEIVER_CAPACITY; r.inlet = 0; r.state = 'completing';
      r.pulse = 1;
      this.events.onReceiverComplete?.(r);
      this.advanceColumn(r);
    }
  }

  state() {
    return {
      buffer: `${Math.round(this.bufferPercent)}%`,
      byColor: this.bufferByColor(),
      funnel: +this.funnel.reduce((n, f) => n + f.volume, 0).toFixed(1),
      piles: this.reservoirs.filter((r) => r.pile > 0.5)
        .map((r) => `${r.id}:${r.pile.toFixed(0)}`),
      sourceLeft: +this.sourceLeft.toFixed(1),
      exposed: this.activeReceivers().map((r) => `${r.color}:${Math.round(r.fill)}%`),
    };
  }
}
