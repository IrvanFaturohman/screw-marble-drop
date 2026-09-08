/**
 * The whole game, with no renderer in it.
 *
 *   TAP A SCREW
 *      -> a plank loses a support, swings or leaves
 *      -> a sand reservoir built into that plank opens
 *      -> sand pours faster than its narrow outlet can pass, and PILES UP
 *      -> the pile squeezes through, collects again above the funnel neck
 *      -> it enters the shared channel as a run of one colour
 *      -> a matching receiver peels it off and fills from 0% to 100%
 *      -> that receiver closes, the next one rises, and a colour that had
 *         nowhere to go starts draining on its own
 *
 * There is no physics engine. Sand is VOLUME moving between nodes at authored
 * rates, so `npm run validate` plays this exact code in Node and its result is
 * the phone's result — there is no simulation gap left to chase.
 */

import { LAYOUT, TUNING, type MarbleColor } from '../config/GameConfig';
import type { LevelDef } from '../config/LevelConfig';
import { SourceModel, type Plate, type Pocket, type Screw } from './SourceModel';
import { SandModel, type Receiver, type Reservoir } from './SandModel';

export type Phase = 'play' | 'won' | 'lost';

export interface GameEvents {
  onTap?: (s: Screw) => void;
  onBlockedTap?: (s: Screw, blocker: Plate | null) => void;
  onScrewOut?: (s: Screw, p: Plate) => void;
  onPlatePartial?: (p: Plate) => void;
  onPlateRelease?: (p: Plate) => void;
  onPlateGone?: (p: Plate) => void;
  onPocketOpen?: (pk: Pocket) => void;
  onUnlocked?: (s: Screw) => void;
  /** Sand crossing a reservoir's throat this tick. Drives the falling stream. */
  onThroatFlow?: (r: Reservoir, volume: number) => void;
  onNeckFlow?: (color: MarbleColor, volume: number) => void;
  onReceiverFlow?: (r: Receiver, volume: number) => void;
  onReceiverComplete?: (r: Receiver) => void;
  onReceiverExposed?: (r: Receiver) => void;
  onWin?: () => void;
  onLose?: () => void;
}

export class GameModel {
  readonly source: SourceModel;
  readonly sand: SandModel;

  events: GameEvents = {};
  phase: Phase = 'play';
  elapsed = 0;
  taps = 0;
  /** Held after an overflow so the player watches it back up before losing. */
  private overflowHold = 0;

  constructor(readonly level: LevelDef) {
    this.source = new SourceModel(level);
    this.sand = new SandModel(level.receiverStacks);

    // Every reservoir on the board becomes a node in the flow network. Its
    // outlet sits at one end of the plank, so a draining reservoir slides
    // toward the hole rather than shrinking in place.
    for (const pk of this.source.pockets) {
      const plate = this.source.plateById.get(pk.def.plate)!;
      const dir = pk.def.outlet ?? -1;
      const c = Math.cos(plate.def.rot ?? 0), s = Math.sin(plate.def.rot ?? 0);
      const half = pk.def.span / 2;
      this.sand.addReservoir({
        id: pk.def.id,
        color: pk.color,
        total: pk.def.volume,
        outX: pk.def.x + dir * half * c,
        outY: pk.def.y + dir * half * s,
        outZ: plate.z,
      });
    }

    // Own every sub-model event, then re-emit. Internal bookkeeping runs first,
    // so a view handler can never pre-empt it.
    this.source.events.onScrewOut = (s, p) => this.events.onScrewOut?.(s, p);
    this.source.events.onPlatePartial = (p) => this.events.onPlatePartial?.(p);
    this.source.events.onPlateRelease = (p) => this.events.onPlateRelease?.(p);
    this.source.events.onPlateGone = (p) => this.events.onPlateGone?.(p);
    this.source.events.onUnlocked = (s) => this.events.onUnlocked?.(s);
    this.source.events.onPocketOpen = (pk) => {
      // The plank moved; the gate is now open. Material still takes its time.
      this.sand.open(pk.def.id);
      this.events.onPocketOpen?.(pk);
    };

    this.sand.events.onThroatFlow = (r, v) => this.events.onThroatFlow?.(r, v);
    this.sand.events.onNeckFlow = (c, v) => this.events.onNeckFlow?.(c, v);
    this.sand.events.onReceiverFlow = (r, v) => this.events.onReceiverFlow?.(r, v);
    this.sand.events.onReceiverComplete = (r) => this.events.onReceiverComplete?.(r);
    this.sand.events.onReceiverExposed = (r) => this.events.onReceiverExposed?.(r);
    this.sand.events.onOverflow = () => { if (this.overflowHold <= 0) this.overflowHold = 900; };
  }

  // ------------------------------------------------------------------- input

  /** The game's only verb: tap a screw. */
  tap(wx: number, wy: number): { hit: Screw | null; blocked: Screw | null } {
    if (this.phase !== 'play') return { hit: null, blocked: null };
    const { screw, blocked } = this.source.pick(wx, wy, LAYOUT.screwR * 2.6);
    if (blocked) {
      this.events.onBlockedTap?.(blocked, this.source.blockerOf(blocked));
      return { hit: null, blocked };
    }
    if (!screw) return { hit: null, blocked: null };
    this.pull(screw);
    return { hit: screw, blocked: null };
  }

  /** Programmatic pull (debug harness + validator). */
  pull(s: Screw): boolean {
    if (this.phase !== 'play') return false;
    if (!this.source.pull(s)) return false;
    this.taps++;
    this.events.onTap?.(s);
    return true;
  }

  // -------------------------------------------------------------- simulation

  update(dtMs: number) {
    const scaled = dtMs * TUNING.GAME_SPEED;
    // Fixed sub-steps so 4x debug speed, a 120Hz screen and the validator all
    // march the flow network identically.
    const step = 1000 / 120;
    let left = Math.min(scaled, 200);
    while (left > 0) {
      const h = Math.min(step, left);
      this.substep(h);
      left -= h;
    }
  }

  private substep(ms: number) {
    this.elapsed += ms;
    this.source.update(ms / 1000);
    this.sand.update(ms);
    if (this.overflowHold > 0) {
      this.overflowHold -= ms;
      if (this.overflowHold <= 0) this.fail();
    }
    this.checkEnd();
  }

  // ------------------------------------------------------------- end states

  /** Sand anywhere between the structure and the receivers. */
  get inFlight() { return this.sand.inFlight; }

  private checkEnd() {
    if (this.phase !== 'play') return;
    if (
      this.source.allEmpty &&
      this.sand.idle &&
      this.sand.allDone
    ) {
      this.phase = 'won';
      this.events.onWin?.();
    }
  }

  private fail() {
    if (this.phase !== 'play') return;
    this.phase = 'lost';
    this.events.onLose?.();
  }

  // ------------------------------------------------------------------ debug

  debugClearBuffer() { this.sand.debugClearBuffer(); }
  debugFillBuffer(fraction = 0.9) { this.sand.debugFillBuffer(fraction); }
  debugCompleteExposed() { this.sand.debugCompleteExposed(); }

  /** Snapshot for assertions and the console harness. */
  state() {
    return {
      phase: this.phase,
      taps: this.taps,
      screwsLeft: this.source.remaining().length,
      platesLeft: this.source.platesLeft,
      sandInStructure: +this.sand.sourceLeft.toFixed(1),
      accessible: this.source.accessible().map((s) => s.id),
      inFlight: +this.sand.inFlight.toFixed(1),
      buffer: `${Math.round(this.sand.bufferPercent)}%`,
      bufferByColor: this.sand.bufferByColor(),
      exposed: this.sand.activeReceivers().map((r) => `${r.color}:${Math.round(r.fill)}%`),
      receiversLeft: this.sand.receiversLeft,
    };
  }
}

export type { Plate, Pocket, Screw, Receiver, Reservoir };
