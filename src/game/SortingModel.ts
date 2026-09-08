/**
 * The shared conveyor and the receiver stacks.
 *
 * Pure TypeScript, same reason as SourceModel: the validator plays a whole level
 * in Node with this exact code, so "this level is solvable without overflowing"
 * is a proof rather than a hope.
 *
 * Once a marble is captured by the belt it stops being a rigid body and becomes
 * an arc position `s` on the loop. That is deliberate — free-body simulation on
 * a circulating track gives neither predictable capacity nor clean visuals, and
 * the brief asks for a guided conveyor state.
 */

import { LAYOUT, TUNING, type MarbleColor } from '../config/GameConfig';
import { LoopPath } from './Geometry';

export interface BeltMarble {
  id: number;
  color: MarbleColor;
  /** Arc position along the loop. */
  s: number;
  /** Laps completed. Drives the "this one has been stuck a while" dimming. */
  laps: number;
  spin: number;
}

export interface Receiver {
  id: string;
  color: MarbleColor;
  filled: number;
  column: number;
  index: number;
  state: 'queued' | 'active' | 'completing' | 'done';
}

export interface Delivery {
  marble: BeltMarble;
  receiver: Receiver;
  socket: number;
  t: number;
  fromX: number; fromY: number;
  toX: number; toY: number; toZ: number;
}

export interface SortingEvents {
  onDispatch?: (m: BeltMarble, r: Receiver, socket: number) => void;
  onSocketFilled?: (r: Receiver, socket: number) => void;
  onReceiverComplete?: (r: Receiver) => void;
  onReceiverExposed?: (r: Receiver) => void;
  /** A marble reached a full belt and had to wait. Not fatal. */
  onRefused?: (color: MarbleColor) => void;
}

export class SortingModel {
  readonly path: LoopPath;
  readonly belt: BeltMarble[] = [];
  readonly columns: Receiver[][] = [];
  readonly deliveries: Delivery[] = [];

  events: SortingEvents = {};
  private sortTimer = 0;

  constructor(stacks: MarbleColor[][]) {
    this.path = new LoopPath(LAYOUT.loopCX, LAYOUT.loopCY, LAYOUT.loopRX, LAYOUT.loopRY);
    stacks.forEach((colors, ci) => {
      this.columns.push(colors.map((color, i) => ({
        id: `r${ci}-${i}`, color, filled: 0, column: ci, index: i,
        state: (i === 0 ? 'active' : 'queued') as Receiver['state'],
      })));
    });
  }

  // ------------------------------------------------------------------ query

  /** Marbles the conveyor system is holding — on the belt or mid-delivery. */
  get load() { return this.belt.length + this.deliveries.length; }
  get capacity() { return TUNING.CONVEYOR_CAPACITY; }
  get full() { return this.load >= this.capacity; }
  get idle() { return this.belt.length === 0 && this.deliveries.length === 0; }

  activeReceivers(): Receiver[] {
    return this.columns.map((c) => c.find((r) => r.state === 'active')).filter((r): r is Receiver => !!r);
  }
  exposedColors(): Set<MarbleColor> {
    return new Set(this.activeReceivers().filter((r) => r.filled < TUNING.RECEIVER_CAPACITY).map((r) => r.color));
  }
  /** Receiver that would take this colour right now, if any. Prefers the
   *  fullest, so boxes close sooner and chains start earlier. */
  destinationFor(color: MarbleColor): Receiver | null {
    let best: Receiver | null = null;
    for (const r of this.activeReceivers()) {
      if (r.color !== color || r.filled >= TUNING.RECEIVER_CAPACITY) continue;
      if (!best || r.filled > best.filled) best = r;
    }
    return best;
  }
  /**
   * DEADLOCK — the only thing that actually loses the game.
   *
   * The belt is full and not one marble on it has an open receiver, so nothing
   * can drain, so no box can complete, so no new colour can ever be exposed.
   * A full belt that still holds one servable colour is merely tight: that
   * marble leaves, a slot opens, and the queue above the entry moves down.
   *
   * Deliveries in flight are excluded deliberately — a marble halfway to a box
   * may be the one that completes it and reveals the colour that frees
   * everything.
   */
  get jammed() {
    if (this.load < this.capacity) return false;
    if (this.deliveries.length) return false;
    return !this.belt.some((b) => !!this.destinationFor(b.color));
  }

  get allDone() { return this.columns.every((c) => c.every((r) => r.state === 'done')); }
  /** Boxes still to fill, for the HUD. */
  get boxesLeft() { return this.columns.flat().filter((r) => r.state !== 'done').length; }
  get boxesTotal() { return this.columns.reduce((n, c) => n + c.length, 0); }

  // ------------------------------------------------------------------ entry

  /**
   * A marble has reached the belt.
   *
   * A FULL BELT IS NOT A LOSS. It refuses the marble, which then queues above
   * the entry and tries again — and as soon as a matching receiver pulls one
   * off, the queue moves. Congestion is pressure, not death.
   *
   * What kills you is `jammed` below: full AND nothing on it can leave.
   */
  admit(id: number, color: MarbleColor, s: number): BeltMarble | null {
    if (this.load >= this.capacity) {
      this.events.onRefused?.(color);
      return null;
    }
    const m: BeltMarble = { id, color, s: this.path.wrap(s), laps: 0, spin: 0 };
    // Slot in behind anything already sitting on the entry point.
    let entry = m.s;
    for (const b of this.belt) {
      if (Math.abs(this.path.delta(b.s, entry)) < TUNING.CONVEYOR_MIN_GAP) {
        entry = this.path.wrap(b.s - TUNING.CONVEYOR_MIN_GAP);
      }
    }
    m.s = entry;
    this.belt.push(m);
    this.sortBelt();
    return m;
  }

  private sortBelt() { this.belt.sort((a, b) => a.s - b.s); }

  // ------------------------------------------------------------- simulation

  update(dt: number) {
    this.sortTimer = Math.max(0, this.sortTimer - dt * 1000);
    this.advance(dt);
    this.tryDispatch();
    this.stepDeliveries(dt);
  }

  private advance(dt: number) {
    if (!this.belt.length) return;
    const L = this.path.length;
    const exposed = this.exposedColors();
    for (const b of this.belt) {
      // A marble with somewhere to go hustles; one with no open receiver idles
      // round at base speed. The difference in pace IS the tell.
      const rush = exposed.has(b.color) ? TUNING.CONVEYOR_RUSH_MULT : 1;
      b.s += TUNING.CONVEYOR_SPEED * rush * dt;
      b.spin += dt * 6 * rush;
      if (b.s >= L) b.laps++;
      b.s = this.path.wrap(b.s);
    }
    this.sortBelt();
    this.enforceGaps();
  }

  /**
   * No two marbles overlap. Walk the ring once starting from the largest gap so
   * the chain has a free head; followers get pushed back. The visible result is
   * a queue bunching behind a stuck marble, which is the congestion readout.
   */
  private enforceGaps() {
    const n = this.belt.length;
    if (n < 2) return;
    const gap = TUNING.CONVEYOR_MIN_GAP;
    if (n * gap >= this.path.length) return;
    let startIdx = 0, biggest = -1;
    for (let i = 0; i < n; i++) {
      const d = this.path.wrap(this.belt[(i + 1) % n].s - this.belt[i].s);
      if (d > biggest) { biggest = d; startIdx = (i + 1) % n; }
    }
    for (let k = 1; k < n; k++) {
      const prev = this.belt[(startIdx + k - 1) % n];
      const cur = this.belt[(startIdx + k) % n];
      if (this.path.wrap(cur.s - prev.s) < gap) cur.s = this.path.wrap(prev.s + gap);
    }
    this.sortBelt();
  }

  /**
   * Auto-sorting. Any marble sitting in the exit gate whose colour has an open
   * receiver leaves. The interval is short on purpose: nine reds arriving on an
   * open red column must read as tik-tik-tik-SNAP, not as a slow trickle.
   */
  private tryDispatch() {
    if (this.sortTimer > 0) return;
    const gate = this.path.length / 2;
    let best: BeltMarble | null = null, bestR: Receiver | null = null, bestD = Infinity;
    for (const b of this.belt) {
      const d = Math.abs(this.path.delta(b.s, gate));
      if (d > TUNING.EXIT_GATE_HALF) continue;
      const r = this.destinationFor(b.color);
      if (!r) continue;
      if (d < bestD) { bestD = d; best = b; bestR = r; }
    }
    if (!best || !bestR) return;

    this.belt.splice(this.belt.indexOf(best), 1);
    const socket = bestR.filled;
    bestR.filled++;
    this.sortTimer = TUNING.AUTO_SORT_INTERVAL;
    const from = this.path.point(best.s);
    const to = socketPos(bestR, socket);
    this.deliveries.push({
      marble: best, receiver: bestR, socket, t: 0,
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, toZ: to.z,
    });
    this.events.onDispatch?.(best, bestR, socket);
  }

  private stepDeliveries(dt: number) {
    for (let i = this.deliveries.length - 1; i >= 0; i--) {
      const d = this.deliveries[i];
      d.t += (dt * 1000) / TUNING.SORT_FLIGHT_DURATION;
      if (d.t < 1) continue;
      this.deliveries.splice(i, 1);
      this.events.onSocketFilled?.(d.receiver, d.socket);
      // Only close the box once every marble already committed to it has
      // landed. `filled` increments at DISPATCH so the belt stops over-feeding,
      // so it reaches 3/3 while two are still in the air.
      const stillFlying = this.deliveries.some((x) => x.receiver === d.receiver);
      if (!stillFlying && d.receiver.filled >= TUNING.RECEIVER_CAPACITY && d.receiver.state === 'active') {
        d.receiver.state = 'completing';
        this.events.onReceiverComplete?.(d.receiver);
      }
    }
  }

  /**
   * Retire a finished box and expose the next in its column. The very next
   * `update` re-tests the belt, which is what makes a reveal chain-drain
   * marbles that were already circulating with nowhere to go.
   */
  advanceColumn(r: Receiver) {
    if (r.state !== 'completing') return;
    r.state = 'done';
    const next = this.columns[r.column].find((x) => x.state === 'queued');
    if (next) { next.state = 'active'; this.events.onReceiverExposed?.(next); }
  }

  // ------------------------------------------------------------------ debug
  debugCompleteExposed() {
    for (const r of this.activeReceivers()) {
      r.filled = TUNING.RECEIVER_CAPACITY;
      r.state = 'completing';
      this.events.onReceiverComplete?.(r);
    }
  }
  debugClear() { this.belt.length = 0; this.deliveries.length = 0; }
}

/** World position of socket `i` in a receiver box. Shared by model + renderer. */
export function socketPos(r: Receiver, i: number) {
  return {
    x: LAYOUT.recvColX[r.column] + (i - 1) * LAYOUT.recvSocketDX,
    y: LAYOUT.recvBoxY + LAYOUT.recvSocketDY,
    z: LAYOUT.beltZ,
  };
}
